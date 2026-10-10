import type { AggFunc, Column, Scalar } from './types.ts';
import { isMissing, isNumericDtype } from './types.ts';
import { DataFrame } from './DataFrame.ts';
import { aggregateValues } from './groupby.ts';
import { mean, std } from './stats.ts';

/**
 * Time-series operations mirroring `resample`, `rolling`, `expanding`,
 * `diff`, `pct_change`, `shift`, and `cumsum`.
 *
 * Datetime columns are stored as epoch milliseconds, so every bucket key here
 * is computed in UTC. That keeps a date-only CSV ("2024-01-15") stable no
 * matter what timezone the viewer's browser is in — bucketing by local time
 * would otherwise shift rows across day boundaries.
 */

export type Freq = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export const FREQS: Freq[] = ['hour', 'day', 'week', 'month', 'quarter', 'year'];

export interface Bucket {
  /** Start of the bucket, epoch ms (UTC). */
  start: number;
  /** End of the bucket, epoch ms (UTC), exclusive. */
  end: number;
  label: string;
}

export function bucketStart(ts: number, freq: Freq): number {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  switch (freq) {
    case 'hour':
      return Date.UTC(y, m, day, d.getUTCHours());
    case 'day':
      return Date.UTC(y, m, day);
    case 'week': {
      // pandas' 'W' is week-ending Sunday; we anchor on ISO Monday for the label
      // but the bucket boundary is the Monday 00:00 UTC.
      const dow = d.getUTCDay();
      const delta = (dow + 6) % 7;
      return Date.UTC(y, m, day - delta);
    }
    case 'month':
      return Date.UTC(y, m, 1);
    case 'quarter':
      return Date.UTC(y, Math.floor(m / 3) * 3, 1);
    case 'year':
      return Date.UTC(y, 0, 1);
  }
}

export function bucketEnd(start: number, freq: Freq): number {
  const d = new Date(start);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (freq) {
    case 'hour':
      return start + 3600_000;
    case 'day':
      return start + 86_400_000;
    case 'week':
      return start + 7 * 86_400_000;
    case 'month':
      return Date.UTC(y, m + 1, 1);
    case 'quarter':
      return Date.UTC(y, m + 3, 1);
    case 'year':
      return Date.UTC(y + 1, 0, 1);
  }
}

export function formatBucket(ts: number, freq: Freq): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  switch (freq) {
    case 'hour':
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:00`;
    case 'day':
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    case 'week':
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    case 'month':
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}`;
    case 'quarter':
      return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    case 'year':
      return String(d.getUTCFullYear());
  }
}

export interface ResampleOptions {
  timeColumn: string;
  freq: Freq;
  valueColumns: string[];
  aggFuncs: AggFunc[];
  /** Emit buckets with no observations (pandas' behaviour with `.resample()`). */
  includeEmpty?: boolean;
}

export interface ResampleResult {
  df: DataFrame;
  buckets: Bucket[];
  valueColumns: string[];
  outColumns: string[];
  /** Rows whose timestamp was missing and therefore excluded. */
  droppedRows: number;
}

export function resample(df: DataFrame, opts: ResampleOptions): ResampleResult {
  const tcol = df.require(opts.timeColumn);
  const vcols = opts.valueColumns.map((n) => df.require(n));
  const funcs = opts.aggFuncs.length ? opts.aggFuncs : (['mean'] as AggFunc[]);

  const buckets = new Map<number, number[]>();
  let droppedRows = 0;
  for (let i = 0; i < df.nRows; i++) {
    const t = tcol.data[i];
    if (isMissing(t)) {
      droppedRows++;
      continue;
    }
    const ts = typeof t === 'number' ? t : new Date(String(t)).getTime();
    if (!Number.isFinite(ts)) {
      droppedRows++;
      continue;
    }
    const key = bucketStart(ts, opts.freq);
    const arr = buckets.get(key);
    if (arr) arr.push(i);
    else buckets.set(key, [i]);
  }

  const starts = [...buckets.keys()].sort((a, b) => a - b);
  const outColumns: string[] = [];
  for (const v of vcols) for (const f of funcs) outColumns.push(`${v.name}_${f}`);

  const headers = [opts.timeColumn, ...outColumns];
  const rows: Scalar[][] = [];
  for (const start of starts) {
    const positions = buckets.get(start)!;
    const row: Scalar[] = [start];
    for (const v of vcols) {
      const values = positions.map((p) => v.data[p]);
      const agg = aggregateValues(values, funcs, v.dtype);
      for (const f of funcs) row.push(agg[f]);
    }
    rows.push(row);
  }

  const columns: Column[] = headers.map((h, j) => ({
    name: h,
    dtype: j === 0 ? 'datetime' : 'float',
    data: rows.map((r) => r[j]),
  }));

  const bucketList: Bucket[] = starts.map((s) => ({
    start: s,
    end: bucketEnd(s, opts.freq),
    label: formatBucket(s, opts.freq),
  }));

  return {
    df: new DataFrame(columns, undefined, `${df.name}_resampled`, true),
    buckets: bucketList,
    valueColumns: opts.valueColumns,
    outColumns,
    droppedRows,
  };
}

/* ------------------------------------------------------------------ *
 * Window operations — these add columns rather than reshaping.
 * ------------------------------------------------------------------ */

export type WindowFunc = 'mean' | 'sum' | 'std' | 'min' | 'max' | 'median' | 'count';

export const WINDOW_FUNCS: WindowFunc[] = ['mean', 'sum', 'std', 'min', 'max', 'median', 'count'];

function windowAgg(values: number[], func: WindowFunc): number {
  if (values.length === 0) return NaN;
  switch (func) {
    case 'mean':
      return mean(values);
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'std':
      return values.length >= 2 ? std(values) : NaN;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'median': {
      const s = [...values].sort((a, b) => a - b);
      const mid = s.length >> 1;
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
    case 'count':
      return values.length;
  }
}

export interface RollingOptions {
  column: string;
  window: number;
  funcs: WindowFunc[];
  minPeriods?: number;
  center?: boolean;
}

/** `df[col].rolling(w).mean()` — leading edges are null until minPeriods is met. */
export function rolling(df: DataFrame, opts: RollingOptions): { df: DataFrame; outColumns: string[] } {
  const col = df.require(opts.column);
  if (!isNumericDtype(col.dtype)) return { df, outColumns: [] };
  const w = Math.max(1, Math.floor(opts.window));
  const minP = opts.minPeriods ?? w;
  const funcs = opts.funcs.length ? opts.funcs : (['mean'] as WindowFunc[]);
  const outColumns = funcs.map((f) => `${opts.column}_roll${w}_${f}`);
  const n = df.nRows;

  const results: Scalar[][] = funcs.map(() => new Array<Scalar>(n).fill(null));
  for (let i = 0; i < n; i++) {
    const half = opts.center ? Math.floor(w / 2) : w - 1;
    const from = opts.center ? Math.max(0, i - half) : Math.max(0, i - w + 1);
    const to = opts.center ? Math.min(n, i + (w - 1 - half) + 1) : i + 1;
    const vals: number[] = [];
    for (let k = from; k < to; k++) {
      const v = col.data[k];
      if (!isMissing(v)) {
        const num = Number(v);
        if (Number.isFinite(num)) vals.push(num);
      }
    }
    if (vals.length < Math.max(1, minP)) continue;
    for (let f = 0; f < funcs.length; f++) {
      const r = windowAgg(vals, funcs[f]);
      results[f][i] = Number.isFinite(r) ? r : null;
    }
  }

  let out = df;
  funcs.forEach((_, f) => {
    out = out.withColumn(outColumns[f], results[f], 'float');
  });
  return { df: out, outColumns };
}

export function expanding(
  df: DataFrame,
  opts: { column: string; funcs: WindowFunc[]; minPeriods?: number },
): { df: DataFrame; outColumns: string[] } {
  const col = df.require(opts.column);
  if (!isNumericDtype(col.dtype)) return { df, outColumns: [] };
  const minP = opts.minPeriods ?? 1;
  const funcs = opts.funcs.length ? opts.funcs : (['mean'] as WindowFunc[]);
  const outColumns = funcs.map((f) => `${opts.column}_exp_${f}`);
  const n = df.nRows;

  const results: Scalar[][] = funcs.map(() => new Array<Scalar>(n).fill(null));
  let runningSum = 0;
  let runningCount = 0;
  const seen: number[] = [];

  for (let i = 0; i < n; i++) {
    const v = col.data[i];
    if (!isMissing(v)) {
      const num = Number(v);
      if (Number.isFinite(num)) {
        runningSum += num;
        runningCount++;
        seen.push(num);
      }
    }
    if (runningCount < minP) continue;
    for (let f = 0; f < funcs.length; f++) {
      const fn = funcs[f];
      let r: number;
      if (fn === 'sum') r = runningSum;
      else if (fn === 'mean') r = runningSum / runningCount;
      else if (fn === 'count') r = runningCount;
      else r = windowAgg(seen, fn);
      results[f][i] = Number.isFinite(r) ? r : null;
    }
  }

  let out = df;
  funcs.forEach((_, f) => {
    out = out.withColumn(outColumns[f], results[f], 'float');
  });
  return { df: out, outColumns };
}

export type TransformOp = 'diff' | 'pct_change' | 'shift' | 'cumsum' | 'cummax' | 'cummin' | 'log';

export function transformSeries(
  df: DataFrame,
  opts: { column: string; op: TransformOp; periods?: number; outputName?: string },
): { df: DataFrame; outputName: string } {
  const col = df.require(opts.column);
  const n = df.nRows;
  const p = opts.periods ?? 1;
  const out: Scalar[] = new Array(n);
  const name = opts.outputName ?? `${opts.column}_${opts.op === 'pct_change' ? 'pct' : opts.op}`;

  let acc = 0;
  let accMax = -Infinity;
  let accMin = Infinity;

  for (let i = 0; i < n; i++) {
    const cur = isMissing(col.data[i]) ? NaN : Number(col.data[i]);
    const prev = i - p >= 0 && !isMissing(col.data[i - p]) ? Number(col.data[i - p]) : NaN;
    switch (opts.op) {
      case 'diff':
        out[i] = Number.isFinite(cur) && Number.isFinite(prev) ? cur - prev : null;
        break;
      case 'pct_change':
        out[i] = Number.isFinite(cur) && Number.isFinite(prev) && prev !== 0 ? (cur - prev) / prev : null;
        break;
      case 'shift':
        out[i] = i - p >= 0 ? col.data[i - p] : null;
        break;
      case 'cumsum':
        acc = acc + (Number.isFinite(cur) ? cur : 0);
        out[i] = Number.isFinite(cur) ? acc : null;
        break;
      case 'cummax':
        if (Number.isFinite(cur)) accMax = Math.max(accMax, cur);
        out[i] = Number.isFinite(accMax) ? accMax : null;
        break;
      case 'cummin':
        if (Number.isFinite(cur)) accMin = Math.min(accMin, cur);
        out[i] = Number.isFinite(accMin) ? accMin : null;
        break;
      case 'log':
        out[i] = Number.isFinite(cur) && cur > 0 ? Math.log(cur) : null;
        break;
    }
  }

  return { df: df.withColumn(name, out, opts.op === 'shift' ? col.dtype : 'float'), outputName: name };
}

/* ------------------------------------------------------------------ *
 * Seasonality
 * ------------------------------------------------------------------ */

export type SeasonPart = 'monthOfYear' | 'dayOfWeek' | 'hourOfDay' | 'weekOfYear' | 'quarterOfYear';

export const SEASON_PARTS: SeasonPart[] = ['monthOfYear', 'dayOfWeek', 'hourOfDay', 'weekOfYear', 'quarterOfYear'];

export function seasonPart(ts: number, part: SeasonPart): number {
  const d = new Date(ts);
  switch (part) {
    case 'monthOfYear':
      return d.getUTCMonth() + 1;
    case 'dayOfWeek':
      return d.getUTCDay();
    case 'hourOfDay':
      return d.getUTCHours();
    case 'weekOfYear': {
      const start = Date.UTC(d.getUTCFullYear(), 0, 1);
      return Math.floor((ts - start) / (7 * 86_400_000)) + 1;
    }
    case 'quarterOfYear':
      return Math.floor(d.getUTCMonth() / 3) + 1;
  }
}

export interface SeasonalityResult {
  labels: string[];
  keys: number[];
  values: number[];
  counts: number[];
}

/** Mean of `valueColumn` per calendar bucket — the classic "seasonal profile". */
export function seasonality(
  df: DataFrame,
  opts: { timeColumn: string; valueColumn: string; part: SeasonPart; aggFunc?: AggFunc },
): SeasonalityResult {
  const tcol = df.require(opts.timeColumn);
  const vcol = df.require(opts.valueColumn);
  const agg = opts.aggFunc ?? 'mean';
  const map = new Map<number, Scalar[]>();
  for (let i = 0; i < df.nRows; i++) {
    const t = tcol.data[i];
    const v = vcol.data[i];
    if (isMissing(t) || isMissing(v)) continue;
    const ts = typeof t === 'number' ? t : new Date(String(t)).getTime();
    if (!Number.isFinite(ts)) continue;
    const k = seasonPart(ts, opts.part);
    const arr = map.get(k);
    if (arr) arr.push(v);
    else map.set(k, [v]);
  }
  const keys = [...map.keys()].sort((a, b) => a - b);
  const values = keys.map((k) => {
    const aggResult = aggregateValues(map.get(k)!, [agg], vcol.dtype)[agg];
    const n = typeof aggResult === 'number' ? aggResult : Number(aggResult);
    return Number.isFinite(n) ? n : NaN;
  });
  const counts = keys.map((k) => map.get(k)!.filter((v) => !isMissing(v)).length);
  return {
    labels: keys.map((k) => seasonLabel(k, opts.part)),
    keys,
    values,
    counts,
  };
}

const MONTHS_ZH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekday/month names are locale-dependent; the caller passes the active language. */
export function seasonLabel(key: number, part: SeasonPart, locale: 'zh' | 'en' = 'zh'): string {
  switch (part) {
    case 'monthOfYear':
      return locale === 'zh' ? MONTHS_ZH[key - 1] : MONTHS_EN[key - 1];
    case 'dayOfWeek':
      return locale === 'zh' ? DOW_ZH[key] : DOW_EN[key];
    case 'hourOfDay':
      return `${key}:00`;
    case 'weekOfYear':
      return locale === 'zh' ? `第${key}周` : `W${key}`;
    case 'quarterOfYear':
      return locale === 'zh' ? `Q${key}` : `Q${key}`;
  }
}

/* ------------------------------------------------------------------ *
 * Trend / seasonal decomposition (additive, classic 3-part)
 * ------------------------------------------------------------------ */

export interface Decomposition {
  index: number[];
  observed: number[];
  trend: number[];
  seasonal: number[];
  residual: number[];
  /** Seasonal index keyed by calendar position. */
  seasonalProfile: { key: number; value: number }[];
}

export function decompose(
  df: DataFrame,
  opts: { timeColumn: string; valueColumn: string; freq: Freq; part: SeasonPart },
): Decomposition {
  const { df: rs } = resample(df, {
    timeColumn: opts.timeColumn,
    freq: opts.freq,
    valueColumns: [opts.valueColumn],
    aggFuncs: ['mean'],
  });
  const n = rs.nRows;
  const index = rs.require(opts.timeColumn).data.map((v) => Number(v));
  const observed = rs.require(`${opts.valueColumn}_mean`).data.map((v) => (isMissing(v) ? NaN : Number(v)));

  // Trend = centred moving average with the period of the seasonal cycle.
  const cycle = freqCycle(opts.freq);
  const trend: number[] = new Array(n).fill(NaN);
  const w = cycle;
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - Math.floor(w / 2));
    const to = Math.min(n, i + Math.ceil(w / 2) + (w % 2 === 0 ? 0 : 1));
    const vals = observed.slice(from, to).filter((v) => Number.isFinite(v));
    if (vals.length >= Math.max(2, Math.floor(w / 2))) trend[i] = mean(vals);
  }

  // Seasonal index: average residual per calendar position, then de-mean.
  const sums = new Map<number, { s: number; n: number }>();
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(observed[i]) || !Number.isFinite(trend[i])) continue;
    const k = seasonPart(index[i], opts.part);
    const e = sums.get(k);
    const d = observed[i] - trend[i];
    if (e) {
      e.s += d;
      e.n++;
    } else sums.set(k, { s: d, n: 1 });
  }
  const profile = new Map<number, number>();
  const rawVals = [...sums.entries()].map(([k, v]) => ({ k, v: v.s / v.n }));
  if (rawVals.length) {
    const m = mean(rawVals.map((r) => r.v));
    for (const r of rawVals) profile.set(r.k, r.v - m);
  }

  const seasonal = index.map((t) => profile.get(seasonPart(t, opts.part)) ?? 0);
  const residual = observed.map((o, i) =>
    Number.isFinite(o) && Number.isFinite(trend[i]) ? o - trend[i] - seasonal[i] : NaN,
  );

  return {
    index,
    observed,
    trend,
    seasonal,
    residual,
    seasonalProfile: [...profile.entries()].sort((a, b) => a[0] - b[0]).map(([key, value]) => ({ key, value })),
  };
}

export function freqCycle(freq: Freq): number {
  switch (freq) {
    case 'hour':
      return 24;
    case 'day':
      return 7;
    case 'week':
      return 52;
    case 'month':
      return 12;
    case 'quarter':
      return 4;
    case 'year':
      return 1;
  }
}

/** Autocorrelation at a set of lags — the quantitative companion to the seasonal profile. */
export function autocorrelation(values: number[], maxLag = 24): { lag: number; acf: number }[] {
  const xs = values.filter((v) => Number.isFinite(v));
  const n = xs.length;
  if (n < 3) return [];
  const m = mean(xs);
  let denom = 0;
  for (const x of xs) denom += (x - m) ** 2;
  if (denom === 0) return [];
  const out: { lag: number; acf: number }[] = [];
  const cap = Math.min(maxLag, n - 2);
  for (let lag = 1; lag <= cap; lag++) {
    let num = 0;
    for (let i = 0; i + lag < n; i++) num += (xs[i] - m) * (xs[i + lag] - m);
    out.push({ lag, acf: num / denom });
  }
  return out;
}

/** Detect datetime-typed columns OR string columns that parse cleanly as dates. */
export function candidateTimeColumns(df: DataFrame): string[] {
  const out: string[] = [];
  for (const c of df.columns) {
    if (c.dtype === 'datetime') {
      out.push(c.name);
      continue;
    }
    if (c.dtype !== 'string') continue;
    const sample = c.data.filter((v) => !isMissing(v)).slice(0, 50) as string[];
    if (sample.length < 5) continue;
    const ok = sample.filter((s) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s)).length;
    if (ok / sample.length > 0.9) out.push(c.name);
  }
  return out;
}

/** Values as a clean numeric array for charting, with the matching x positions. */
export function seriesNumbers(col: Column): { values: number[]; positions: number[] } {
  const values: number[] = [];
  const positions: number[] = [];
  for (let i = 0; i < col.data.length; i++) {
    const v = col.data[i];
    if (isMissing(v)) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    values.push(n);
    positions.push(i);
  }
  return { values, positions };
}
