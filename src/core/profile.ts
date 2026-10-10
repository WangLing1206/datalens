import type { Column, DType, Scalar } from './types.ts';
import { isMissing, isNumericDtype } from './types.ts';
import { DataFrame } from './DataFrame.ts';
import {
  boxStats,
  cv,
  histogram,
  kurtosis,
  mean,
  numericValues,
  skew,
  std,
  sum as sumOf,
  variance,
} from './stats.ts';
import type { HistogramResult } from './stats.ts';

/**
 * Per-column profiling. This is what powers `df.info()` plus the descriptive
 * statistics table, and it is computed once per frame and memoised by the
 * store so every view can read from a single pass.
 */

export interface NumericSummary {
  count: number;
  sum: number;
  mean: number;
  std: number;
  variance: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  iqr: number;
  range: number;
  cv: number;
  skew: number;
  kurtosis: number;
  zeros: number;
  negatives: number;
  outliersIqr: number;
}

export interface CategorySummary {
  /** Most frequent values, descending. */
  top: { value: string; count: number; pct: number }[];
  /** Shannon entropy normalised to [0,1] — 0 means a single constant value. */
  entropy: number;
  balance: number;
}

export interface TimeSummary {
  min: number;
  max: number;
  spanDays: number;
  /** Distinct calendar days covered, useful for detecting gaps. */
  days: number;
}

export interface ColumnProfile {
  name: string;
  dtype: DType;
  position: number;
  n: number;
  count: number;
  missing: number;
  missingPct: number;
  uniqueCount: number;
  /** Percentage of values that are the column's most frequent value. */
  topShare: number;
  memoryBytes: number;
  numeric?: NumericSummary;
  category?: CategorySummary;
  time?: TimeSummary;
  histogram?: HistogramResult;
  /** Up to 5 sample values, used in the column inspector. */
  samples: Scalar[];
  /** Heuristic hints that drive the "suggested next step" affordances. */
  hints: ColumnHint[];
}

export type ColumnHint =
  | 'high-missing'
  | 'all-missing'
  | 'constant'
  | 'identifier'
  | 'likely-categorical'
  | 'high-cardinality'
  | 'right-skewed'
  | 'left-skewed'
  | 'heavy-outliers'
  | 'likely-datetime'
  | 'binary'
  | 'date-like';

export interface FrameProfile {
  nRows: number;
  nCols: number;
  columns: ColumnProfile[];
  /** Total cells and how many are missing across the whole frame. */
  cells: number;
  missingCells: number;
  /** Rows that are exact duplicates of an earlier row. */
  duplicateRows: number;
  numericCount: number;
  categoricalCount: number;
  datetimeCount: number;
  memoryBytes: number;
  /** 0-100 composite quality score. */
  healthScore: number;
  healthBreakdown: { key: string; penalty: number; detail: string }[];
}

function bytesFor(v: Scalar): number {
  if (v === null) return 0;
  if (typeof v === 'number') return 8;
  if (typeof v === 'boolean') return 1;
  return String(v).length * 2;
}

export function profileColumn(col: Column, position: number): ColumnProfile {
  const n = col.data.length;
  const count = countNonNull(col.data);
  const missing = n - count;
  const missingPct = n === 0 ? 0 : missing / n;

  const uniq = new Set<string>();
  let memoryBytes = 0;
  let samples: Scalar[] = [];
  const freq = new Map<string, { value: string; count: number }>();
  let dateLike = 0;

  for (let i = 0; i < n; i++) {
    const v = col.data[i];
    if (isMissing(v)) continue;
    memoryBytes += bytesFor(v);
    const key = typeof v === 'number' ? String(v) : String(v);
    if (uniq.size < 200_000) uniq.add(key);
    const f = freq.get(key);
    if (f) f.count++;
    else freq.set(key, { value: key, count: 1 });
    if (samples.length < 5) samples.push(v);
    if (typeof v === 'string' && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v)) dateLike++;
  }

  const uniqueCount = uniq.size;
  let topShare = 0;
  for (const f of freq.values()) if (f.count > topShare) topShare = f.count;
  topShare = count === 0 ? 0 : topShare / count;

  const profile: ColumnProfile = {
    name: col.name,
    dtype: col.dtype,
    position,
    n,
    count,
    missing,
    missingPct,
    uniqueCount,
    topShare,
    memoryBytes,
    samples,
    hints: [],
  };

  if (isNumericDtype(col.dtype)) {
    const nums = numericValues(col.data);
    if (nums.length > 0) {
      const b = boxStats(nums);
      profile.numeric = {
        count: nums.length,
        sum: sumOf(nums),
        mean: mean(nums),
        std: std(nums),
        variance: variance(nums),
        min: b.min,
        q1: b.q1,
        median: b.median,
        q3: b.q3,
        max: b.max,
        iqr: b.iqr,
        range: b.max - b.min,
        cv: cv(nums),
        skew: skew(nums),
        kurtosis: kurtosis(nums),
        zeros: nums.filter((v) => v === 0).length,
        negatives: nums.filter((v) => v < 0).length,
        outliersIqr: b.outliers.length,
      };
      profile.histogram = histogram(nums, Math.max(6, Math.min(30, Math.ceil(Math.sqrt(nums.length)))));
    }
  } else if (col.dtype === 'datetime') {
    const ts = numericValues(col.data);
    if (ts.length) {
      const lo = Math.min(...ts);
      const hi = Math.max(...ts);
      const days = new Set(ts.map((t) => new Date(t).toISOString().slice(0, 10))).size;
      profile.time = { min: lo, max: hi, spanDays: (hi - lo) / 86_400_000, days };
    }
  }

  // Categorical summary applies to text/bool columns (and low-cardinality ints).
  const treatAsCategory =
    col.dtype === 'string' ||
    col.dtype === 'category' ||
    col.dtype === 'bool' ||
    (col.dtype === 'int' && uniqueCount <= 30 && uniqueCount < count);
  if (treatAsCategory && count > 0) {
    const tops = [...freq.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, 12);
    let entropy = 0;
    if (count > 0 && uniqueCount > 1) {
      let h = 0;
      for (const f of freq.values()) {
        const p = f.count / count;
        if (p > 0) h -= p * Math.log(p);
      }
      entropy = h / Math.log(Math.max(2, uniqueCount));
    }
    profile.category = {
      top: tops.map((t) => ({ value: t.value, count: t.count, pct: t.count / count })),
      entropy: Number.isFinite(entropy) ? entropy : 0,
      balance: count > 0 && tops.length ? tops[0].count / count : 0,
    };
  }

  profile.hints = deriveHints(profile, col, dateLike, count);
  return profile;
}

function countNonNull(data: Scalar[]): number {
  let c = 0;
  for (const v of data) if (!isMissing(v)) c++;
  return c;
}

function deriveHints(
  p: ColumnProfile,
  col: Column,
  dateLike: number,
  count: number,
): ColumnHint[] {
  const hints: ColumnHint[] = [];
  if (count === 0) {
    hints.push('all-missing');
    return hints;
  }
  if (p.missingPct > 0.3) hints.push('high-missing');
  if (p.uniqueCount === 1) hints.push('constant');
  // Every value distinct (and enough rows for that to mean something) reads as
  // a row key rather than a feature worth charting.
  if (p.uniqueCount === count && count >= 10 && col.dtype !== 'datetime') hints.push('identifier');
  // A boolean column always has two distinct values, so both tests would fire
  // and the hint list would carry 'binary' twice.
  if (col.dtype === 'bool' || (p.uniqueCount === 2 && count > 4)) hints.push('binary');

  if ((col.dtype === 'string' || col.dtype === 'category') && count > 0) {
    const ratio = p.uniqueCount / count;
    if (p.uniqueCount <= 50 && ratio < 0.5) hints.push('likely-categorical');
    if (ratio > 0.9 && p.uniqueCount > 50) hints.push('high-cardinality');
    if (dateLike > count * 0.9 && count >= 5) hints.push('date-like');
  }

  if (p.numeric) {
    const s = p.numeric.skew;
    if (Number.isFinite(s) && s > 1) hints.push('right-skewed');
    if (Number.isFinite(s) && s < -1) hints.push('left-skewed');
    const outRatio = count > 0 ? p.numeric.outliersIqr / count : 0;
    if (outRatio > 0.03) hints.push('heavy-outliers');
  }
  return hints;
}

export function duplicateRowCount(df: DataFrame): number {
  const seen = new Set<string>();
  let dup = 0;
  for (let i = 0; i < df.nRows; i++) {
    let key = '';
    for (const c of df.columns) {
      const v = c.data[i];
      key += v === null ? '\u0000' : `${typeof v === 'number' ? v : String(v)}`;
      key += '\u0001';
    }
    if (seen.has(key)) dup++;
    else seen.add(key);
  }
  return dup;
}

export function profileFrame(df: DataFrame, opts: { skipDuplicates?: boolean } = {}): FrameProfile {
  const columns = df.columns.map((c, i) => profileColumn(c, i));
  const cells = df.nRows * df.nCols;
  const missingCells = columns.reduce((a, c) => a + c.missing, 0);
  const memoryBytes = columns.reduce((a, c) => a + c.memoryBytes, 0);
  const duplicateRows = opts.skipDuplicates ? 0 : duplicateRowCount(df);

  const numericCount = columns.filter((c) => c.numeric).length;
  const datetimeCount = columns.filter((c) => c.dtype === 'datetime').length;
  const categoricalCount = columns.length - numericCount - datetimeCount;

  const breakdown: { key: string; penalty: number; detail: string }[] = [];
  let score = 100;

  const completeness = cells === 0 ? 1 : 1 - missingCells / cells;
  if (completeness < 1) {
    const penalty = Math.round((1 - completeness) * 45);
    score -= penalty;
    breakdown.push({ key: 'missing', penalty, detail: `${(100 * (1 - completeness)).toFixed(1)}%` });
  }
  if (duplicateRows > 0 && df.nRows > 0) {
    const ratio = duplicateRows / df.nRows;
    const penalty = Math.min(15, Math.round(ratio * 60));
    score -= penalty;
    breakdown.push({ key: 'duplicates', penalty, detail: `${duplicateRows}` });
  }
  if (df.nRows < 30) {
    score -= 10;
    breakdown.push({ key: 'small', penalty: 10, detail: `${df.nRows}` });
  }
  const emptyCols = columns.filter((c) => c.count === 0).length;
  if (emptyCols) {
    const penalty = Math.min(15, emptyCols * 5);
    score -= penalty;
    breakdown.push({ key: 'empty-columns', penalty, detail: `${emptyCols}` });
  }
  const constCols = columns.filter((c) => c.hints.includes('constant')).length;
  if (constCols) {
    const penalty = Math.min(10, constCols * 3);
    score -= penalty;
    breakdown.push({ key: 'constant-columns', penalty, detail: `${constCols}` });
  }

  return {
    nRows: df.nRows,
    nCols: df.nCols,
    columns,
    cells,
    missingCells,
    duplicateRows,
    numericCount,
    categoricalCount,
    datetimeCount,
    memoryBytes,
    healthScore: Math.max(0, Math.min(100, score)),
    healthBreakdown: breakdown,
  };
}

/** Compact `df.info()`-style text, used by the copy-to-clipboard affordance. */
export function infoText(df: DataFrame, profile: FrameProfile): string {
  const lines: string[] = [];
  lines.push(`<class 'pandas.core.frame.DataFrame'>`);
  lines.push(`RangeIndex: ${df.nRows} entries, 0 to ${Math.max(0, df.nRows - 1)}`);
  lines.push(`Data columns (total ${df.nCols} columns):`);
  lines.push(` #   Column  Non-Null Count  Dtype`);
  lines.push(`---  ------  --------------  -----`);
  profile.columns.forEach((c, i) => {
    const idx = String(i).padStart(3);
    const name = c.name.padEnd(7).slice(0, 7);
    const nn = `${c.count} non-null`.padEnd(15);
    lines.push(`${idx}  ${name} ${nn} ${c.dtype}`);
  });
  lines.push(`dtypes: ${[...new Set(profile.columns.map((c) => c.dtype))].join(', ')}`);
  lines.push(`memory usage: ${(profile.memoryBytes / 1024).toFixed(1)} KB`);
  return lines.join('\n');
}
