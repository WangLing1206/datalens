/**
 * Statistics primitives.
 *
 * Every function here is written to reproduce pandas/numpy semantics exactly
 * (skipna=True, sample std with ddof=1, linear quantile interpolation,
 * adjusted Fisher-Pearson skew, sample-corrected excess kurtosis). The values
 * are pinned by fixtures generated from real pandas — see tools/gen_pandas_fixtures.py
 * and tests/pandas-parity.test.ts.
 */
import type { Scalar } from './types.ts';
import { isMissing } from './types.ts';

/** Extract the numeric, non-missing values of a column as a plain Float64 array-ish list. */
export function numericValues(data: Scalar[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (isMissing(v)) continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function count(values: Scalar[]): number {
  let c = 0;
  for (const v of values) if (!isMissing(v)) c++;
  return c;
}

export function missingCount(values: Scalar[]): number {
  return values.length - count(values);
}

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return sum(xs) / xs.length;
}

/** Sample variance, ddof = 1 (pandas default). */
export function variance(xs: number[], ddof = 1): number {
  const n = xs.length;
  if (n - ddof <= 0) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) {
    const d = x - m;
    s += d * d;
  }
  return s / (n - ddof);
}

export function std(xs: number[], ddof = 1): number {
  return Math.sqrt(variance(xs, ddof));
}

export function min(xs: number[]): number {
  let m = Infinity;
  for (const x of xs) if (x < m) m = x;
  return xs.length ? m : NaN;
}

export function max(xs: number[]): number {
  let m = -Infinity;
  for (const x of xs) if (x > m) m = x;
  return xs.length ? m : NaN;
}

export function sortedAsc(xs: number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

/**
 * Quantile with linear interpolation — identical to
 * `numpy.percentile(x, q*100, method='linear')`, which is what
 * `pandas.Series.quantile` uses by default.
 */
export function quantile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  if (q <= 0) return sorted[0];
  if (q >= 1) return sorted[n - 1];
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

export function median(xs: number[]): number {
  return quantile(sortedAsc(xs), 0.5);
}

/**
 * Adjusted Fisher-Pearson standardized moment coefficient (bias=False),
 * matching `pandas.Series.skew()`:
 *   g1 * sqrt(n(n-1)) / (n-2)
 */
export function skew(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const m = mean(xs);
  let m2 = 0;
  let m3 = 0;
  for (const x of xs) {
    const d = x - m;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= n;
  m3 /= n;
  if (m2 === 0) return NaN;
  const g1 = m3 / Math.pow(m2, 1.5);
  return (g1 * Math.sqrt(n * (n - 1))) / (n - 2);
}

/**
 * Excess kurtosis with the sample correction (bias=False), matching
 * `pandas.Series.kurt()`:
 *   ((n+1) * g2 + 6) * (n-1) / ((n-2)(n-3)),  g2 = m4/m2^2 - 3
 */
export function kurtosis(xs: number[]): number {
  const n = xs.length;
  if (n < 4) return NaN;
  const m = mean(xs);
  let m2 = 0;
  let m4 = 0;
  for (const x of xs) {
    const d = x - m;
    const d2 = d * d;
    m2 += d2;
    m4 += d2 * d2;
  }
  m2 /= n;
  m4 /= n;
  if (m2 === 0) return NaN;
  const g2 = m4 / (m2 * m2) - 3;
  return (((n + 1) * g2 + 6) * (n - 1)) / ((n - 2) * (n - 3));
}

/** Coefficient of variation (std/mean). pandas has no direct method; this is the standard definition. */
export function cv(xs: number[]): number {
  const m = mean(xs);
  if (m === 0 || !Number.isFinite(m)) return NaN;
  return std(xs) / Math.abs(m);
}

export function mode(xs: number[]): number[] {
  const counts = new Map<number, number>();
  let best = 0;
  for (const x of xs) {
    const c = (counts.get(x) ?? 0) + 1;
    counts.set(x, c);
    if (c > best) best = c;
  }
  if (best === 0) return [];
  const out: number[] = [];
  for (const [v, c] of counts) if (c === best) out.push(v);
  return out.sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ *
 * Correlation
 * ------------------------------------------------------------------ */

/** Pair up two columns keeping only rows where both values are present. */
export function pairwise(xs: Scalar[], ys: Scalar[]): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const a = xs[i];
    const b = ys[i];
    if (isMissing(a) || isMissing(b)) continue;
    const an = typeof a === 'number' ? a : Number(a);
    const bn = typeof b === 'number' ? b : Number(b);
    if (!Number.isFinite(an) || !Number.isFinite(bn)) continue;
    x.push(an);
    y.push(bn);
  }
  return { x, y };
}

export function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const den = Math.sqrt(sxx * syy);
  return den === 0 ? NaN : sxy / den;
}

/** Average ranks (1-based) with ties resolved to their mean rank, like `scipy.stats.rankdata`. */
export function rankAverage(xs: number[]): number[] {
  const n = xs.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => xs[a] - xs[b]);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]] = avg;
    i = j + 1;
  }
  return ranks;
}

export function spearman(x: number[], y: number[]): number {
  if (x.length < 2) return NaN;
  return pearson(rankAverage(x), rankAverage(y));
}

/**
 * Kendall's tau-b. O(n^2) over concordant/discordant pairs with the standard
 * tie corrections, which is exact and instant up to a few thousand rows.
 * Beyond `maxN` we deterministically subsample (and report `sampled: true` so
 * the UI can say so) rather than freezing the main thread on 100k^2 pairs.
 */
export function kendall(x: number[], y: number[], maxN = 5000): { value: number; sampled: boolean } {
  let xs = x;
  let ys = y;
  let sampled = false;
  if (x.length > maxN) {
    const step = Math.ceil(x.length / maxN);
    xs = [];
    ys = [];
    for (let i = 0; i < x.length; i += step) {
      xs.push(x[i]);
      ys.push(y[i]);
    }
    sampled = true;
  }
  const n = xs.length;
  if (n < 2) return { value: NaN, sampled };
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = xs[i] - xs[j];
      const dy = ys[i] - ys[j];
      const s = dx * dy;
      if (s > 0) concordant++;
      else if (s < 0) discordant++;
    }
  }
  const n0n = (n * (n - 1)) / 2;
  const t1 = tieSum(xs);
  const t2 = tieSum(ys);
  const den = Math.sqrt((n0n - t1) * (n0n - t2));
  return { value: den === 0 ? NaN : (concordant - discordant) / den, sampled };
}

function tieSum(xs: number[]): number {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let s = 0;
  for (const c of counts.values()) s += (c * (c - 1)) / 2;
  return s;
}

/* ------------------------------------------------------------------ *
 * Distribution helpers used by the chart layer
 * ------------------------------------------------------------------ */

export interface HistogramResult {
  binEdges: number[];
  counts: number[];
  /** Bin centre, convenient for a line overlay. */
  centers: number[];
}

export function histogram(xs: number[], binCount?: number): HistogramResult {
  if (xs.length === 0) return { binEdges: [], counts: [], centers: [] };
  const lo = min(xs);
  const hi = max(xs);
  const k = binCount && binCount > 0 ? binCount : defaultBins(xs);
  if (lo === hi) {
    return { binEdges: [lo - 0.5, hi + 0.5], counts: [xs.length], centers: [lo] };
  }
  const w = (hi - lo) / k;
  const edges = Array.from({ length: k + 1 }, (_, i) => lo + i * w);
  const counts = new Array<number>(k).fill(0);
  for (const x of xs) {
    let b = Math.floor((x - lo) / w);
    if (b >= k) b = k - 1;
    if (b < 0) b = 0;
    counts[b]++;
  }
  const centers = Array.from({ length: k }, (_, i) => (edges[i] + edges[i + 1]) / 2);
  return { binEdges: edges, counts, centers };
}

/** Sturges' rule clamped to a readable range — pandas' `hist` defaults to 10. */
export function defaultBins(xs: number[]): number {
  const n = xs.length;
  if (n <= 1) return 1;
  const k = Math.ceil(Math.log2(n) + 1);
  return Math.max(5, Math.min(40, k));
}

export interface KdeResult {
  x: number[];
  y: number[];
}

/** Gaussian KDE on a Silverman bandwidth — mirrors `pandas.Series.plot.kde()`. */
export function kde(xs: number[], points = 128): KdeResult {
  const n = xs.length;
  if (n < 2) return { x: [], y: [] };
  const s = std(xs);
  const q1 = quantile(sortedAsc(xs), 0.25);
  const q3 = quantile(sortedAsc(xs), 0.75);
  const sigma = Math.min(s || 1, (q3 - q1) / 1.349 || s || 1) || 1;
  const h = 0.9 * sigma * Math.pow(n, -0.2) || 1;
  const lo = min(xs) - 3 * h;
  const hi = max(xs) + 3 * h;
  const step = (hi - lo) / (points - 1);
  const out: number[] = new Array(points);
  const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
  for (let i = 0; i < points; i++) {
    const x = lo + i * step;
    let acc = 0;
    for (let j = 0; j < n; j++) {
      const u = (x - xs[j]) / h;
      acc += Math.exp(-0.5 * u * u);
    }
    out[i] = acc * norm;
  }
  return { x: Array.from({ length: points }, (_, i) => lo + i * step), y: out };
}

export interface EcdfResult {
  x: number[];
  y: number[];
}

export function ecdf(xs: number[]): EcdfResult {
  const s = sortedAsc(xs);
  const n = s.length;
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0 && s[i] === s[i - 1]) {
      y[y.length - 1] = (i + 1) / n;
      continue;
    }
    x.push(s[i]);
    y.push((i + 1) / n);
  }
  return { x, y };
}

export interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  iqr: number;
  /** Whisker ends (Tukey: furthest point within 1.5*IQR of the box). */
  lowerFence: number;
  upperFence: number;
  outliers: number[];
  n: number;
}

export function boxStats(xs: number[]): BoxStats {
  if (xs.length === 0) {
    return {
      min: NaN,
      q1: NaN,
      median: NaN,
      q3: NaN,
      max: NaN,
      iqr: NaN,
      lowerFence: NaN,
      upperFence: NaN,
      outliers: [],
      n: 0,
    };
  }
  const s = sortedAsc(xs);
  const q1 = quantile(s, 0.25);
  const q2 = quantile(s, 0.5);
  const q3 = quantile(s, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const within = s.filter((v) => v >= lo && v <= hi);
  return {
    min: s[0],
    q1,
    median: q2,
    q3,
    max: s[s.length - 1],
    iqr,
    lowerFence: within.length ? within[0] : q1,
    upperFence: within.length ? within[within.length - 1] : q3,
    outliers: s.filter((v) => v < lo || v > hi),
    n: s.length,
  };
}

export interface OutlierResult {
  method: 'iqr' | 'zscore';
  positions: number[];
  values: number[];
  lower: number;
  upper: number;
}

/** Locate outliers in-place so the UI can jump to the offending rows. */
export function findOutliers(values: Scalar[], method: 'iqr' | 'zscore', threshold = 3): OutlierResult {
  const positions: number[] = [];
  const vals: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isMissing(v)) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) {
        positions.push(i);
        vals.push(n);
      }
    }
  }
  if (vals.length === 0) return { method, positions: [], values: [], lower: NaN, upper: NaN };

  if (method === 'iqr') {
    const b = boxStats(vals);
    const lo = b.q1 - 1.5 * b.iqr;
    const hi = b.q3 + 1.5 * b.iqr;
    const keepP: number[] = [];
    const keepV: number[] = [];
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] < lo || vals[i] > hi) {
        keepP.push(positions[i]);
        keepV.push(vals[i]);
      }
    }
    return { method, positions: keepP, values: keepV, lower: lo, upper: hi };
  }

  const m = mean(vals);
  const s = std(vals);
  const lower = m - threshold * s;
  const upper = m + threshold * s;
  const keepP: number[] = [];
  const keepV: number[] = [];
  if (s > 0) {
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] < lower || vals[i] > upper) {
        keepP.push(positions[i]);
        keepV.push(vals[i]);
      }
    }
  }
  return { method, positions: keepP, values: keepV, lower, upper };
}

/**
 * Largest-Triangle-Three-Buckets downsampling. Preserves the visual shape of a
 * line/scatter while cutting the number of rendered points, which is what keeps
 * 100k-row charts smooth.
 */
export function lttb(xs: number[], ys: number[], threshold: number): { x: number[]; y: number[] } {
  const n = xs.length;
  if (threshold >= n || threshold < 3) return { x: xs, y: ys };
  const outX: number[] = [xs[0]];
  const outY: number[] = [ys[0]];
  const every = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const rangeStart = Math.floor((i + 1) * every) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * every) + 1, n);
    let avgX = 0;
    let avgY = 0;
    const len = rangeEnd - rangeStart;
    if (len > 0) {
      for (let j = rangeStart; j < rangeEnd; j++) {
        avgX += xs[j];
        avgY += ys[j];
      }
      avgX /= len;
      avgY /= len;
    }
    const from = Math.floor(i * every) + 1;
    const to = Math.floor((i + 1) * every) + 1;
    const ax = xs[a];
    const ay = ys[a];
    let bestArea = -1;
    let best = from;
    for (let j = from; j < to; j++) {
      const area = Math.abs((ax - avgX) * (ys[j] - ay) - (ax - xs[j]) * (avgY - ay)) * 0.5;
      if (area > bestArea) {
        bestArea = area;
        best = j;
      }
    }
    outX.push(xs[best]);
    outY.push(ys[best]);
    a = best;
  }
  outX.push(xs[n - 1]);
  outY.push(ys[n - 1]);
  return { x: outX, y: outY };
}
