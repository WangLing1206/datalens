import type { DataFrame } from './DataFrame.ts';
import type { FrameProfile } from './profile.ts';
import { isMissing } from './types.ts';
import { mean, median, numericValues, pearson, quantile, sortedAsc } from './stats.ts';
import { groupBy } from './groupby.ts';
import { bucketStart, candidateTimeColumns, formatBucket } from './timeseries.ts';

/**
 * Automatic insight generation.
 *
 * This is what turns a loaded table into an *analysis*: instead of waiting for
 * the user to guess which chart to draw, we scan the frame and surface the
 * findings that actually matter — data-quality problems, distribution shape,
 * strong relationships, group differences and time trends — each with a
 * one-click jump into the view that can explore it further.
 *
 * Every insight carries its text in both languages in the same object literal,
 * so the two locales cannot drift apart.
 */

export type InsightCategory = 'quality' | 'distribution' | 'relation' | 'group' | 'time' | 'action';
export type Severity = 'high' | 'medium' | 'low';

export type ViewId =
  | 'overview'
  | 'data'
  | 'clean'
  | 'describe'
  | 'groupby'
  | 'pivot'
  | 'correlate'
  | 'timeseries'
  | 'studio'
  | 'advanced'
  | 'report';

export interface Insight {
  id: string;
  category: InsightCategory;
  severity: Severity;
  /** Localised sentence shown as the card body. */
  body: string;
  /** Optional short metric chip, e.g. "r = 0.87". */
  metric?: string;
  /** Deep link into the analysis view that explores this finding. */
  action?: { view: ViewId; params?: Record<string, unknown> };
}

export type Lang = 'zh' | 'en';

/** Localised templates. `zh` is the source; `en` must mirror its keys exactly. */
const zhT = {
  allMissing: '{col} 整列都是空值，无法参与任何计算',
  highMissing: '{col} 缺失 {pct}（{n} 个），建议填充或删除该列',
  someMissing: '{col} 缺失 {pct}，会影响相关分析的样本量',
  constant: '{col} 所有取值都是「{value}」，没有区分度，可以考虑删除',
  identifier: '{col} 每行取值都不同，看起来是主键，不适合参与统计',
  highCardinality: '{col} 有 {n} 种不同取值，直接分组会产生大量类别',
  dateText: '{col} 是文本形式的日期，转换为日期类型后即可使用时间序列分析',
  duplicateRows: '发现 {n} 行完全重复的数据（占 {pct}），建议去重后分析',
  rightSkew: '{col} 明显右偏（偏度 {skew}）：均值 {mean} 高于中位数 {median}，少数大值拉高了平均水平',
  leftSkew: '{col} 明显左偏（偏度 {skew}）：均值 {mean} 低于中位数 {median}，少数小值拉低了平均水平',
  outliers: '{col} 有 {n} 个离群点（占 {pct}），超出正常范围 {lo} ~ {hi}',
  outliersMinor: '{col} 存在少量离群点（{n} 个），建议查看确认是否为录入错误',
  strongCorr: '{a} 与 {b} 的相关系数为 {r}，呈{strength}{direction}相关',
  noCorr: '数值列之间没有发现明显的线性相关关系',
  groupDiff: '按 {key} 分组后，{value} 的均值从 {minKey} 的 {min} 到 {maxKey} 的 {max}，相差 {ratio} 倍',
  groupSpread: '按 {key} 分组后，{value} 的均值在 {min} 到 {max} 之间波动',
  timeTrendUp: '{value} 从 {from} 到 {to} 总体上升，期间增长了 {pct}',
  timeTrendDown: '{value} 从 {from} 到 {to} 总体下降，期间下降了 {pct}',
  seasonality: '{value} 存在明显的季节性：{peak} 平均最高（{peakVal}），{trough} 最低（{troughVal}）',
  smallSample: '数据只有 {n} 行，统计结论的稳定性有限',
  healthy: '数据整体质量良好，没有发现需要立即处理的问题',
  nextGroupBy: '试试按 {key} 分组，比较不同类别下 {value} 的差异',
  nextCorrelate: '数值列之间可能存在关系，试试相关分析',
  nextDescribe: '查看 {col} 的分布形态，判断是否需要变换',
  nextTimeSeries: '这份数据包含时间列，可以观察随时间的变化趋势',
};

const enT: Record<keyof typeof zhT, string> = {
  allMissing: '{col} is entirely empty and cannot be used in any calculation',
  highMissing: '{col} is {pct} missing ({n} values) — consider imputing or dropping it',
  someMissing: '{col} is {pct} missing, which will reduce the sample for correlation analysis',
  constant: 'Every value of {col} is "{value}", so it cannot distinguish anything — consider dropping it',
  identifier: 'Every row of {col} is distinct, so it looks like a primary key rather than a feature',
  highCardinality: '{col} has {n} distinct values; grouping on it directly would create a lot of categories',
  dateText: '{col} holds dates as text — convert it to a datetime type to unlock time-series analysis',
  duplicateRows: 'Found {n} fully duplicated rows ({pct}) — deduplicate before analysing',
  rightSkew:
    '{col} is strongly right-skewed (skew {skew}): the mean ({mean}) sits above the median ({median}) because a few large values pull it up',
  leftSkew:
    '{col} is strongly left-skewed (skew {skew}): the mean ({mean}) sits below the median ({median}) because a few small values pull it down',
  outliers: '{col} has {n} outliers ({pct}), outside the normal range {lo} to {hi}',
  outliersMinor: '{col} has a few outliers ({n}) — worth checking whether they are data-entry errors',
  strongCorr: '{a} and {b} correlate at {r} — a {strength} {direction} relationship',
  noCorr: 'No notable linear relationships found among the numeric columns',
  groupDiff: 'Grouping by {key}, the mean of {value} runs from {min} ({minKey}) to {max} ({maxKey}) — a {ratio}× difference',
  groupSpread: 'Grouping by {key}, the mean of {value} ranges between {min} and {max}',
  timeTrendUp: '{value} rose overall from {from} to {to}, gaining {pct} over the period',
  timeTrendDown: '{value} fell overall from {from} to {to}, losing {pct} over the period',
  seasonality: '{value} shows a clear seasonal pattern: {peak} is highest on average ({peakVal}) and {trough} lowest ({troughVal})',
  smallSample: 'Only {n} rows are available, so statistical conclusions will be fragile',
  healthy: 'The data looks healthy overall — nothing needs attention first',
  nextGroupBy: 'Try grouping by {key} to compare {value} across categories',
  nextCorrelate: 'There may be relationships among the numeric columns — try correlation',
  nextDescribe: 'Look at the distribution of {col} to decide whether it needs a transform',
  nextTimeSeries: 'This dataset has a time column — look at how things change over time',
};

function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m,
  );
}

function t(key: keyof typeof zhT, lang: Lang, params: Record<string, string | number>): string {
  return fill(lang === 'zh' ? zhT[key] : enT[key], params);
}

const MAX_INSIGHTS = 14;

/* ------------------------------------------------------------------ *
 * Formatting helpers shared with the views
 * ------------------------------------------------------------------ */

function fmt(v: number, lang: Lang): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const opts: Intl.NumberFormatOptions =
    a >= 10000 ? { maximumFractionDigits: 0 } : a >= 100 ? { maximumFractionDigits: 1 } : { maximumFractionDigits: 3 };
  return new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US', opts).format(v);
}

function fmtPct(v: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(v);
}

const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_ZH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

/* ------------------------------------------------------------------ *
 * The generator
 * ------------------------------------------------------------------ */

export interface InsightOptions {
  /** Cap the work done on very large frames. */
  maxRowsForScan?: number;
  /** Restrict which detectors run — useful for the report view. */
  categories?: InsightCategory[];
}

export function generateInsights(
  df: DataFrame,
  profile: FrameProfile,
  lang: Lang,
  opts: InsightOptions = {},
): Insight[] {
  const out: Insight[] = [];
  const enabled = new Set<InsightCategory>(
    opts.categories ?? ['quality', 'distribution', 'relation', 'group', 'time', 'action'],
  );
  const scanCap = opts.maxRowsForScan ?? 30_000;
  const scan = df.nRows > scanCap ? df.sample(scanCap, 99) : df;

  /* ---------- 1. data quality ---------- */
  if (enabled.has('quality')) {
    for (const col of profile.columns) {
      if (col.count === 0) {
        out.push({
          id: `all-missing:${col.name}`,
          category: 'quality',
          severity: 'high',
          body: t('allMissing', lang, { col: col.name }),
          action: { view: 'clean', params: { column: col.name } },
        });
        continue;
      }
      if (col.missingPct >= 0.3) {
        out.push({
          id: `high-missing:${col.name}`,
          category: 'quality',
          severity: col.missingPct >= 0.6 ? 'high' : 'medium',
          body: t('highMissing', lang, {
            col: col.name,
            pct: fmtPct(col.missingPct, lang),
            n: col.missing,
          }),
          metric: fmtPct(col.missingPct, lang),
          action: { view: 'clean', params: { column: col.name } },
        });
      } else if (col.missingPct > 0.02) {
        out.push({
          id: `some-missing:${col.name}`,
          category: 'quality',
          severity: 'low',
          body: t('someMissing', lang, { col: col.name, pct: fmtPct(col.missingPct, lang) }),
          action: { view: 'clean', params: { column: col.name } },
        });
      }

      if (col.hints.includes('constant') && col.samples[0] !== undefined) {
        out.push({
          id: `constant:${col.name}`,
          category: 'quality',
          severity: 'low',
          body: t('constant', lang, { col: col.name, value: String(col.samples[0]) }),
          action: { view: 'data', params: { column: col.name } },
        });
      }

      if (col.hints.includes('date-like')) {
        out.push({
          id: `date-text:${col.name}`,
          category: 'quality',
          severity: 'medium',
          body: t('dateText', lang, { col: col.name }),
          action: { view: 'clean', params: { column: col.name, suggestCast: 'datetime' } },
        });
      }

      if (col.hints.includes('identifier') && col.n === df.nRows && col.uniqueCount === col.count) {
        out.push({
          id: `identifier:${col.name}`,
          category: 'quality',
          severity: 'low',
          body: t('identifier', lang, { col: col.name }),
        });
      }

      if (col.hints.includes('high-cardinality')) {
        out.push({
          id: `high-card:${col.name}`,
          category: 'quality',
          severity: 'low',
          body: t('highCardinality', lang, { col: col.name, n: col.uniqueCount }),
        });
      }
    }

    if (profile.duplicateRows > 0) {
      const pct = profile.nRows ? profile.duplicateRows / profile.nRows : 0;
      out.push({
        id: 'duplicates',
        category: 'quality',
        severity: pct > 0.05 ? 'high' : 'medium',
        body: t('duplicateRows', lang, { n: profile.duplicateRows, pct: fmtPct(pct, lang) }),
        metric: `${profile.duplicateRows}`,
        action: { view: 'clean', params: { focus: 'duplicates' } },
      });
    }

    if (df.nRows < 30) {
      out.push({
        id: 'small-sample',
        category: 'quality',
        severity: 'low',
        body: t('smallSample', lang, { n: df.nRows }),
      });
    }
  }

  /* ---------- 2. distribution shape ---------- */
  if (enabled.has('distribution')) {
    for (const col of profile.columns) {
      const s = col.numeric;
      if (!s || s.count < 8) continue;
      if (Number.isFinite(s.skew) && Math.abs(s.skew) > 1.2) {
        const right = s.skew > 0;
        out.push({
          id: `skew:${col.name}`,
          category: 'distribution',
          severity: Math.abs(s.skew) > 2.5 ? 'medium' : 'low',
          body: t(right ? 'rightSkew' : 'leftSkew', lang, {
            col: col.name,
            skew: fmt(s.skew, lang),
            mean: fmt(s.mean, lang),
            median: fmt(s.median, lang),
          }),
          metric: `skew ${fmt(s.skew, lang)}`,
          action: { view: 'describe', params: { column: col.name } },
        });
      }
      const outRatio = s.count > 0 ? s.outliersIqr / s.count : 0;
      // A zero IQR means every value sits on the same quartile, so the Tukey
      // fence collapses to a single point and the "normal range" reads as
      // nonsense ("0 ~ 0"). Skip those columns.
      if (outRatio > 0.03 && s.iqr > 0) {
        const vals = numericValues(scan.require(col.name).data);
        const sorted = sortedAsc(vals);
        const q1 = quantile(sorted, 0.25);
        const q3 = quantile(sorted, 0.75);
        out.push({
          id: `outliers:${col.name}`,
          category: 'distribution',
          severity: outRatio > 0.08 ? 'medium' : 'low',
          body: t(outRatio > 0.08 ? 'outliers' : 'outliersMinor', lang, {
            col: col.name,
            n: s.outliersIqr,
            pct: fmtPct(outRatio, lang),
            lo: fmt(q1 - 1.5 * (q3 - q1), lang),
            hi: fmt(q3 + 1.5 * (q3 - q1), lang),
          }),
          metric: `${s.outliersIqr}`,
          action: { view: 'clean', params: { column: col.name, focus: 'outliers' } },
        });
      }
    }
  }

  /* ---------- 3. relationships ---------- */
  if (enabled.has('relation')) {
    const numeric = profile.columns.filter((c) => c.numeric && c.numeric.count >= 8).map((c) => c.name);
    const use = numeric.slice(0, 8);
    const pairs: { a: string; b: string; r: number }[] = [];
    for (let i = 0; i < use.length; i++) {
      for (let j = i + 1; j < use.length; j++) {
        const ca = scan.require(use[i]).data;
        const cb = scan.require(use[j]).data;
        const x: number[] = [];
        const y: number[] = [];
        for (let k = 0; k < scan.nRows; k++) {
          if (ca[k] === null || cb[k] === null) continue;
          const xn = Number(ca[k]);
          const yn = Number(cb[k]);
          if (Number.isFinite(xn) && Number.isFinite(yn)) {
            x.push(xn);
            y.push(yn);
          }
        }
        if (x.length < 8) continue;
        const r = pearson(x, y);
        if (Number.isFinite(r)) pairs.push({ a: use[i], b: use[j], r });
      }
    }
    pairs.sort((p, q2) => Math.abs(q2.r) - Math.abs(p.r));
    const strong = pairs.filter((p) => Math.abs(p.r) >= 0.3).slice(0, 3);
    for (const p of strong) {
      const abs = Math.abs(p.r);
      const strength = abs >= 0.7 ? (lang === 'zh' ? '强' : 'strong') : abs >= 0.5 ? (lang === 'zh' ? '中等' : 'moderate') : lang === 'zh' ? '较弱' : 'weak';
      const direction = p.r > 0 ? (lang === 'zh' ? '正' : 'positive') : lang === 'zh' ? '负' : 'negative';
      out.push({
        id: `corr:${p.a}:${p.b}`,
        category: 'relation',
        severity: abs >= 0.7 ? 'medium' : 'low',
        body: t('strongCorr', lang, { a: p.a, b: p.b, r: fmt(p.r, lang), strength, direction }),
        metric: `r = ${fmt(p.r, lang)}`,
        action: { view: 'correlate', params: { a: p.a, b: p.b } },
      });
    }
    if (strong.length === 0 && numeric.length >= 2) {
      out.push({
        id: 'no-corr',
        category: 'relation',
        severity: 'low',
        body: t('noCorr', lang, {}),
        action: { view: 'correlate' },
      });
    }
  }

  /* ---------- 4. group differences ---------- */
  if (enabled.has('group')) {
    const keys = profile.columns
      .filter((c) => (c.dtype === 'string' || c.dtype === 'bool' || c.dtype === 'category') && c.uniqueCount >= 2 && c.uniqueCount <= 8)
      .map((c) => c.name)
      .slice(0, 3);
    const measures = profile.columns.filter((c) => c.numeric && c.numeric.count >= 8).map((c) => c.name).slice(0, 3);

    const candidates: { key: string; value: string; ratio: number; spread: number; min: number; max: number; minKey: string; maxKey: string }[] = [];

    for (const key of keys) {
      for (const value of measures) {
        try {
          const g = groupBy(scan, { keys: [key], aggs: [{ column: value, funcs: ['mean'] }] });
          const means = g.df.require(`${value}_mean`).data;
          const names = g.df.require(key).data;
          const rows: { k: string; v: number }[] = [];
          for (let i = 0; i < g.df.nRows; i++) {
            const v = means[i];
            if (typeof v === 'number' && Number.isFinite(v)) rows.push({ k: String(names[i]), v });
          }
          if (rows.length < 2) continue;
          rows.sort((a, b) => a.v - b.v);
          const lo = rows[0];
          const hi = rows[rows.length - 1];
          if (lo.v === 0 && hi.v === 0) continue;
          const denom = Math.abs(lo.v) > 1e-9 ? Math.abs(lo.v) : Math.abs(hi.v);
          const ratio = denom > 1e-9 ? Math.abs(hi.v) / denom : Infinity;
          candidates.push({
            key,
            value,
            ratio,
            spread: Math.abs(hi.v - lo.v),
            min: lo.v,
            max: hi.v,
            minKey: lo.k,
            maxKey: hi.k,
          });
        } catch {
          /* a group-by can legitimately fail on degenerate columns */
        }
      }
    }

    candidates.sort((a, b) => b.ratio - a.ratio);
    for (const c of candidates.slice(0, 3)) {
      const notable = Number.isFinite(c.ratio) && c.ratio >= 1.5;
      out.push({
        id: `group:${c.key}:${c.value}`,
        category: 'group',
        severity: notable ? (c.ratio >= 3 ? 'medium' : 'low') : 'low',
        body: t(notable ? 'groupDiff' : 'groupSpread', lang, {
          key: c.key,
          value: c.value,
          min: fmt(c.min, lang),
          max: fmt(c.max, lang),
          minKey: c.minKey,
          maxKey: c.maxKey,
          ratio: Number.isFinite(c.ratio) ? fmt(c.ratio, lang) : '—',
        }),
        metric: Number.isFinite(c.ratio) && notable ? `${fmt(c.ratio, lang)}×` : undefined,
        action: {
          view: 'groupby',
          params: { keys: [c.key], value: c.value, funcs: ['mean'] },
        },
      });
    }
  }

  /* ---------- 5. time patterns ---------- */
  if (enabled.has('time')) {
    const timeCols = candidateTimeColumns(scan);
    const measures = profile.columns.filter((c) => c.numeric && c.numeric.count >= 8).map((c) => c.name).slice(0, 2);
    if (timeCols.length > 0 && measures.length > 0) {
      const timeCol = timeCols[0];
      const value = measures[0];
      const tcol = scan.require(timeCol);
      const vcol = scan.require(value);

      // Aggregate monthly, then compare the first and last complete buckets.
      const buckets = new Map<number, number[]>();
      for (let i = 0; i < scan.nRows; i++) {
        const raw = tcol.data[i];
        if (raw === null) continue;
        const ts = typeof raw === 'number' ? raw : new Date(String(raw)).getTime();
        if (!Number.isFinite(ts)) continue;
        const v = vcol.data[i];
        if (v === null) continue;
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        const k = bucketStart(ts, 'month');
        const arr = buckets.get(k);
        if (arr) arr.push(n);
        else buckets.set(k, [n]);
      }
      const keys = [...buckets.keys()].sort((a, b) => a - b);
      const series = keys.map((k) => ({ k, v: mean(buckets.get(k)!) }));
      if (series.length >= 3) {
        const first = series[0];
        const last = series[series.length - 1];
        const change = first.v !== 0 ? (last.v - first.v) / Math.abs(first.v) : 0;
        if (Math.abs(change) >= 0.15) {
          const up = change > 0;
          out.push({
            id: `trend:${value}`,
            category: 'time',
            severity: 'low',
            body: t(up ? 'timeTrendUp' : 'timeTrendDown', lang, {
              value,
              from: formatBucket(first.k, 'month'),
              to: formatBucket(last.k, 'month'),
              pct: fmtPct(Math.abs(change), lang),
            }),
            metric: `${change > 0 ? '+' : '−'}${fmtPct(Math.abs(change), lang)}`,
            action: { view: 'timeseries', params: { timeColumn: timeCol, valueColumn: value } },
          });
        }

        // Month-of-year seasonality across the whole span.
        const byMonth = new Map<number, number[]>();
        for (const k of keys) {
          const m = new Date(k).getUTCMonth();
          const arr = byMonth.get(m);
          const v = mean(buckets.get(k)!);
          if (arr) arr.push(v);
          else byMonth.set(m, [v]);
        }
        if (byMonth.size >= 6) {
          const profileRows = [...byMonth.entries()]
            .map(([m, vs]) => ({ m, v: mean(vs) }))
            .sort((a, b) => b.v - a.v);
          const peak = profileRows[0];
          const trough = profileRows[profileRows.length - 1];
          if (trough.v !== 0 && Math.abs(peak.v / trough.v - 1) >= 0.2) {
            out.push({
              id: `season:${value}`,
              category: 'time',
              severity: 'low',
              body: t('seasonality', lang, {
                value,
                peak: lang === 'zh' ? MONTH_ZH[peak.m] : MONTH_EN[peak.m],
                peakVal: fmt(peak.v, lang),
                trough: lang === 'zh' ? MONTH_ZH[trough.m] : MONTH_EN[trough.m],
                troughVal: fmt(trough.v, lang),
              }),
              metric: `${fmt(peak.v / trough.v, lang)}×`,
              action: { view: 'timeseries', params: { timeColumn: timeCol, valueColumn: value, part: 'monthOfYear' } },
            });
          }
        }
      }
    }
  }

  /* ---------- 6. suggested next steps ---------- */
  if (enabled.has('action')) {
    const cat = profile.columns.find(
      (c) => (c.dtype === 'string' || c.dtype === 'bool') && c.uniqueCount >= 2 && c.uniqueCount <= 12,
    );
    const num = profile.columns.find((c) => c.numeric && c.numeric.count >= 8);
    if (cat && num) {
      out.push({
        id: 'next-groupby',
        category: 'action',
        severity: 'low',
        body: t('nextGroupBy', lang, { key: cat.name, value: num.name }),
        action: { view: 'groupby', params: { keys: [cat.name], value: num.name, funcs: ['mean'] } },
      });
    }
    const numericCount = profile.columns.filter((c) => c.numeric).length;
    if (numericCount >= 3) {
      out.push({
        id: 'next-correlate',
        category: 'action',
        severity: 'low',
        body: t('nextCorrelate', lang, {}),
        action: { view: 'correlate' },
      });
    }
    if (candidateTimeColumns(df).length > 0) {
      out.push({
        id: 'next-timeseries',
        category: 'action',
        severity: 'low',
        body: t('nextTimeSeries', lang, {}),
        action: { view: 'timeseries' },
      });
    }
  }

  if (out.length === 0) {
    out.push({
      id: 'healthy',
      category: 'quality',
      severity: 'low',
      body: t('healthy', lang, {}),
    });
  }

  // Rank by severity, then keep a stable, readable ordering within a category.
  const order: Severity[] = ['high', 'medium', 'low'];
  out.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return out.slice(0, MAX_INSIGHTS);
}

export function severityRank(s: Severity): number {
  return s === 'high' ? 0 : s === 'medium' ? 1 : 2;
}

export function insightCounts(insights: Insight[]): Record<InsightCategory, number> {
  const out = { quality: 0, distribution: 0, relation: 0, group: 0, time: 0, action: 0 };
  for (const i of insights) out[i.category]++;
  return out;
}

export function medianOf(vals: number[]): number {
  return median(vals);
}

export function missingIn(df: DataFrame, column: string): number {
  const c = df.require(column);
  let n = 0;
  for (const v of c.data) if (isMissing(v)) n++;
  return n;
}
