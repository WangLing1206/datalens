import { mean, std, quantile, sortedAsc, variance } from './stats.ts';

/**
 * Modelling primitives: OLS regression, k-means, PCA, anomaly scoring and a
 * trend+seasonal forecaster.
 *
 * Everything here is plain, dependency-free linear algebra. Frames are small
 * (thousands of rows, a handful of columns), so an explicit normal-equations
 * solve with partial pivoting is both fast enough and far easier to verify
 * than a general SVD.
 */

/* ------------------------------------------------------------------ *
 * Linear algebra helpers
 * ------------------------------------------------------------------ */

/** Solve A x = b by Gauss-Jordan elimination with partial pivoting. Returns null when singular. */
export function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const pv = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

/** Invert a square matrix, or null when singular. */
export function invertMatrix(A: number[][]): number[][] | null {
  const n = A.length;
  const m = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const pv = m[col][col];
    for (let c = 0; c < 2 * n; c++) m[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let c = 0; c < 2 * n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row.slice(n));
}

/** Standardise each column to mean 0 / sd 1 (columns with zero variance are left as zeros). */
export function standardize(X: number[][]): { Z: number[][]; means: number[]; sds: number[] } {
  const n = X.length;
  if (n === 0) return { Z: [], means: [], sds: [] };
  const p = X[0].length;
  const means = new Array<number>(p).fill(0);
  const sds = new Array<number>(p).fill(0);
  for (let j = 0; j < p; j++) {
    const col = X.map((r) => r[j]);
    means[j] = mean(col);
    sds[j] = std(col) || 1;
  }
  return { Z: X.map((r) => r.map((v, j) => (v - means[j]) / sds[j])), means, sds };
}

/* ------------------------------------------------------------------ *
 * OLS regression
 * ------------------------------------------------------------------ */

export interface RegressionResult {
  /** [intercept, ...slopes] — index 0 is the intercept. */
  coefficients: number[];
  stdErrors: number[];
  tStats: number[];
  pValues: number[];
  r2: number;
  adjustedR2: number;
  rmse: number;
  n: number;
  k: number;
  fitted: number[];
  residuals: number[];
  /** Standardised slopes, so effects on different scales can be compared. */
  standardized: number[];
  /** Design-matrix column order: ['(Intercept)', ...featureNames]. */
  names: string[];
  singular: boolean;
}

/** Two-sided p-value from a t statistic using the incomplete beta function. */
export function tDistPValue(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return NaN;
  const x = df / (df + t * t);
  return clamp01(incompleteBeta(df / 2, 0.5, x));
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Regularised incomplete beta via the continued-fraction expansion (Lentz's method). */
function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  let f = 1;
  let c = 1;
  let d = 0;
  for (let i = 0; i <= 200; i++) {
    const m = i >> 1;
    let numerator: number;
    if (i === 0) numerator = 1;
    else if (i % 2 === 0) numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= c * d;
    if (Math.abs(1 - c * d) < 1e-10) break;
  }
  const result = front * (f - 1);
  // Use the symmetry relation when the continued fraction converges poorly.
  return x < (a + 1) / (a + b + 2) ? result : 1 - incompleteBeta(b, a, 1 - x);
}

/** Lanczos approximation of log Γ(x). */
function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  const t = z + 7.5;
  for (let i = 0; i < g.length; i++) a += g[i] / (z + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

export function linearRegression(X: number[][], y: number[], featureNames: string[]): RegressionResult {
  const n = X.length;
  const k = X[0]?.length ?? 0;
  const names = ['(Intercept)', ...featureNames];
  const empty: RegressionResult = {
    coefficients: [],
    stdErrors: [],
    tStats: [],
    pValues: [],
    r2: NaN,
    adjustedR2: NaN,
    rmse: NaN,
    n,
    k,
    fitted: [],
    residuals: [],
    standardized: [],
    names,
    singular: true,
  };
  if (n < k + 2 || k === 0) return empty;

  // Design matrix with an intercept column.
  const D = X.map((row) => [1, ...row]);
  const p = k + 1;

  // XtX and Xty
  const XtX: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] += D[i][a] * y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += D[i][a] * D[i][b];
    }
  }

  const XtXinv = invertMatrix(XtX);
  if (!XtXinv) return empty;
  const beta = solveLinearSystem(XtX, Xty);
  if (!beta) return empty;

  const fitted = new Array<number>(n);
  const residuals = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let f = 0;
    for (let a = 0; a < p; a++) f += D[i][a] * beta[a];
    fitted[i] = f;
    residuals[i] = y[i] - f;
  }

  const yMean = mean(y);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (y[i] - yMean) ** 2;
    ssRes += residuals[i] ** 2;
  }
  const r2 = ssTot === 0 ? NaN : 1 - ssRes / ssTot;
  const dfRes = n - p;
  const adjustedR2 = dfRes > 0 && Number.isFinite(r2) ? 1 - (1 - r2) * ((n - 1) / dfRes) : NaN;
  const mse = dfRes > 0 ? ssRes / dfRes : NaN;

  const stdErrors = new Array<number>(p).fill(NaN);
  const tStats = new Array<number>(p).fill(NaN);
  const pValues = new Array<number>(p).fill(NaN);
  for (let a = 0; a < p; a++) {
    const se = Math.sqrt(Math.max(0, XtXinv[a][a] * mse));
    stdErrors[a] = se;
    if (se > 0) {
      tStats[a] = beta[a] / se;
      pValues[a] = tDistPValue(tStats[a], dfRes);
    }
  }

  // Standardised coefficients: beta_j * sd(x_j) / sd(y).
  const ySd = std(y) || 1;
  const standardized = new Array<number>(p).fill(0);
  for (let j = 1; j < p; j++) {
    const xSd = std(X.map((r) => r[j - 1])) || 1;
    standardized[j] = (beta[j] * xSd) / ySd;
  }

  return {
    coefficients: beta,
    stdErrors,
    tStats,
    pValues,
    r2,
    adjustedR2,
    rmse: Number.isFinite(mse) ? Math.sqrt(mse) : NaN,
    n,
    k,
    fitted,
    residuals,
    standardized,
    names,
    singular: false,
  };
}

/* ------------------------------------------------------------------ *
 * k-means
 * ------------------------------------------------------------------ */

export interface KMeansResult {
  assignments: number[];
  centroids: number[][];
  inertia: number;
  k: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dist2(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

/** k-means++ seeding, then Lloyd iterations until assignments stabilise. */
export function kmeans(X: number[][], k: number, seed = 42, maxIter = 120): KMeansResult {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (n === 0 || k < 1) return { assignments: [], centroids: [], inertia: 0, k };
  const kk = Math.min(k, n);
  const rnd = mulberry32(seed);

  // k-means++ initialisation
  const centroids: number[][] = [[...X[Math.floor(rnd() * n)]]];
  while (centroids.length < kk) {
    const d2 = X.map((row) => Math.min(...centroids.map((c) => dist2(row, c))));
    const total = d2.reduce((a, b) => a + b, 0);
    if (total <= 0) {
      centroids.push([...X[Math.floor(rnd() * n)]]);
      continue;
    }
    let target = rnd() * total;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      target -= d2[i];
      if (target <= 0) {
        idx = i;
        break;
      }
    }
    centroids.push([...X[idx]]);
  }

  const assignments = new Array<number>(n).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = dist2(X[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }
    // Recompute centroids
    const sums = centroids.map(() => new Array<number>(p).fill(0));
    const counts = centroids.map(() => 0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let j = 0; j < p; j++) sums[c][j] += X[i][j];
    }
    for (let c = 0; c < centroids.length; c++) {
      if (counts[c] === 0) {
        // Re-seed an empty cluster on the furthest point.
        let far = 0;
        let farD = -1;
        for (let i = 0; i < n; i++) {
          const d = dist2(X[i], centroids[assignments[i]]);
          if (d > farD) {
            farD = d;
            far = i;
          }
        }
        centroids[c] = [...X[far]];
        assignments[far] = c;
        continue;
      }
      for (let j = 0; j < p; j++) centroids[c][j] = sums[c][j] / counts[c];
    }
    if (!changed && iter > 0) break;
  }

  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += dist2(X[i], centroids[assignments[i]]);
  return { assignments, centroids, inertia, k: centroids.length };
}

/** Mean silhouette coefficient; -1 (wrong cluster) to 1 (well separated). */
export function silhouetteScore(X: number[][], assignments: number[], maxN = 3000): number {
  const n = X.length;
  if (n < 3) return NaN;
  let idx = Array.from({ length: n }, (_, i) => i);
  if (n > maxN) {
    const rnd = mulberry32(7);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    idx = idx.slice(0, maxN);
  }
  const clusters = [...new Set(assignments)];
  if (clusters.length < 2) return NaN;

  const sums = new Map<number, number[]>();
  for (const i of idx) {
    const a = assignments[i];
    const arr = sums.get(a);
    if (arr) for (let j = 0; j < X[i].length; j++) arr[j] += X[i][j];
    else sums.set(a, [...X[i]]);
  }

  let total = 0;
  for (const i of idx) {
    const own = assignments[i];
    // a(i): mean distance to the same cluster
    let aSum = 0;
    let aCount = 0;
    for (const j of idx) {
      if (j === i || assignments[j] !== own) continue;
      aSum += Math.sqrt(dist2(X[i], X[j]));
      aCount++;
    }
    const a = aCount > 0 ? aSum / aCount : 0;
    // b(i): lowest mean distance to any other cluster
    let b = Infinity;
    for (const c of clusters) {
      if (c === own) continue;
      let s = 0;
      let cnt = 0;
      for (const j of idx) {
        if (assignments[j] !== c) continue;
        s += Math.sqrt(dist2(X[i], X[j]));
        cnt++;
      }
      if (cnt > 0) b = Math.min(b, s / cnt);
    }
    const denom = Math.max(a, b);
    total += denom === 0 ? 0 : (b - a) / denom;
  }
  return total / idx.length;
}

/* ------------------------------------------------------------------ *
 * PCA via the covariance matrix
 * ------------------------------------------------------------------ */

export interface PcaResult {
  /** Explained variance ratio per component. */
  explained: number[];
  cumulative: number[];
  /** Component vectors (loadings), one per component. */
  components: number[][];
  /** Projected data, one row per observation. */
  scores: number[][];
  /** Correlation between each original variable and each component. */
  loadings: number[][];
  featureNames: string[];
  means: number[];
  sds: number[];
}

/**
 * PCA on standardised data. The eigenvectors come from the Jacobi method, which
 * is stable for the small symmetric matrices we deal with here.
 */
export function pca(X: number[][], featureNames: string[]): PcaResult {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (n < 2 || p === 0) {
    return { explained: [], cumulative: [], components: [], scores: [], loadings: [], featureNames, means: [], sds: [] };
  }

  const { Z, means, sds } = standardize(X);

  // Covariance matrix of the standardised data.
  const C: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      for (let b = a; b < p; b++) C[a][b] += Z[i][a] * Z[i][b];
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = a; b < p; b++) {
      const v = C[a][b] / Math.max(1, n - 1);
      C[a][b] = v;
      C[b][a] = v;
    }
  }

  // Jacobi eigen-decomposition
  const A = C.map((r) => [...r]);
  const V: number[][] = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let a = 0; a < p; a++) for (let b = a + 1; b < p; b++) off += A[a][b] * A[a][b];
    if (off < 1e-14) break;
    for (let a = 0; a < p; a++) {
      for (let b = a + 1; b < p; b++) {
        if (Math.abs(A[a][b]) < 1e-15) continue;
        const theta = (A[b][b] - A[a][a]) / (2 * A[a][b]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let i = 0; i < p; i++) {
          const ai = A[i][a];
          const bi = A[i][b];
          A[i][a] = c * ai - s * bi;
          A[i][b] = s * ai + c * bi;
        }
        for (let i = 0; i < p; i++) {
          const ai = A[a][i];
          const bi = A[b][i];
          A[a][i] = c * ai - s * bi;
          A[b][i] = s * ai + c * bi;
        }
        for (let i = 0; i < p; i++) {
          const vi = V[i][a];
          const wi = V[i][b];
          V[i][a] = c * vi - s * wi;
          V[i][b] = s * vi + c * wi;
        }
      }
    }
  }

  const pairs = Array.from({ length: p }, (_, i) => ({ value: A[i][i], vec: V.map((row) => row[i]) }));
  pairs.sort((a, b) => b.value - a.value);
  const totalVar = pairs.reduce((a, b) => a + Math.max(0, b.value), 0) || 1;

  const explained = pairs.map((e) => Math.max(0, e.value) / totalVar);
  const cumulative: number[] = [];
  let acc = 0;
  for (const e of explained) {
    acc += e;
    cumulative.push(acc);
  }
  const components = pairs.map((e) => e.vec);

  const scores = Z.map((row) => components.map((comp) => row.reduce((a, v, j) => a + v * comp[j], 0)));
  // On standardised data the correlation between variable j and component k is
  // simply v_jk * sqrt(eigenvalue_k), which is what a loadings plot should show.
  const loadings = components.map((comp, k) => comp.map((v) => v * Math.sqrt(Math.max(0, pairs[k].value))));

  return {
    explained,
    cumulative,
    components,
    scores,
    loadings,
    featureNames,
    means,
    sds,
  };
}

/* ------------------------------------------------------------------ *
 * Anomaly scoring
 * ------------------------------------------------------------------ */

export type AnomalyMethod = 'iqr' | 'zscore' | 'lof';

export interface AnomalyResult {
  /** Per-row score; higher means more anomalous. */
  scores: number[];
  /** Row positions flagged as anomalous. */
  flagged: number[];
  threshold: number;
  method: AnomalyMethod;
}

/**
 * Multi-column anomaly detection. The score is the mean absolute z-score across
 * the selected columns (or a simplified local-outlier-factor for `lof`), which
 * is robust enough for the interactive use case and cheap on 100k rows.
 */
export function detectAnomalies(
  X: number[][],
  method: AnomalyMethod,
  threshold = 3,
): AnomalyResult {
  const n = X.length;
  if (n === 0) return { scores: [], flagged: [], threshold, method };
  const p = X[0].length;

  if (method === 'lof') {
    // k-distance based local density, with k fixed at 10.
    const k = Math.min(10, n - 1);
    const knn: number[][] = [];
    for (let i = 0; i < n; i++) {
      const ds = X.map((row, j) => ({ j, d: j === i ? Infinity : Math.sqrt(dist2(X[i], row)) }));
      ds.sort((a, b) => a.d - b.d);
      knn.push(ds.slice(0, k).map((d) => d.j));
    }
    const kdist = knn.map((neigh, i) => Math.max(...neigh.map((j) => Math.sqrt(dist2(X[i], X[j])))));
    const lrd = knn.map((neigh, i) => {
      const sum = neigh.reduce((a, j) => a + Math.max(kdist[j], Math.sqrt(dist2(X[i], X[j]))), 0);
      return sum > 0 ? neigh.length / sum : 0;
    });
    const lof = knn.map((neigh, i) => {
      const avg = neigh.reduce((a, j) => a + lrd[j], 0) / neigh.length;
      return lrd[i] > 0 ? avg / lrd[i] : 1;
    });
    const flagged: number[] = [];
    for (let i = 0; i < n; i++) if (lof[i] > 1.5) flagged.push(i);
    return { scores: lof, flagged, threshold: 1.5, method };
  }

  const scores = new Array<number>(n).fill(0);
  for (let j = 0; j < p; j++) {
    const col = X.map((r) => r[j]);
    if (method === 'zscore') {
      const m = mean(col);
      const s = std(col) || 1;
      for (let i = 0; i < n; i++) scores[i] += Math.abs((col[i] - m) / s);
    } else {
      const s = sortedAsc(col);
      const q1 = quantile(s, 0.25);
      const q3 = quantile(s, 0.75);
      const iqr = q3 - q1 || 1;
      for (let i = 0; i < n; i++) scores[i] += Math.abs(col[i] - quantile(s, 0.5)) / iqr;
    }
  }
  for (let i = 0; i < n; i++) scores[i] /= p;

  const flagged: number[] = [];
  for (let i = 0; i < n; i++) if (scores[i] > threshold) flagged.push(i);
  return { scores, flagged, threshold, method };
}

/* ------------------------------------------------------------------ *
 * Forecasting
 * ------------------------------------------------------------------ */

export type ForecastModel = 'linear' | 'seasonal' | 'movingAverage';

export interface ForecastResult {
  /** Fitted values for the observed period. */
  fitted: number[];
  /** Point forecasts for the horizon. */
  forecast: number[];
  lower: number[];
  upper: number[];
  /** Evaluation metrics from the hold-out tail. */
  mae: number;
  rmse: number;
  mape: number;
  /** Number of periods used for the hold-out. */
  holdout: number;
  model: ForecastModel;
}

/**
 * Fit a simple trend (plus an optional seasonal term) and extrapolate.
 * The hold-out tail is used purely for reporting accuracy — the final forecast
 * is refit on the whole series.
 */
export function forecast(
  values: number[],
  horizon: number,
  model: ForecastModel,
  seasonLength = 12,
  holdout = Math.max(3, Math.min(12, Math.floor(values.length * 0.2))),
): ForecastResult {
  const y = values.filter((v) => Number.isFinite(v));
  const n = y.length;
  const empty: ForecastResult = {
    fitted: [],
    forecast: [],
    lower: [],
    upper: [],
    mae: NaN,
    rmse: NaN,
    mape: NaN,
    holdout: 0,
    model,
  };
  if (n < 4) return empty;

  const fit = (series: number[], steps: number): { fitted: number[]; ahead: number[]; sigma: number } => {
    const m = series.length;
    if (model === 'movingAverage') {
      const window = Math.max(2, Math.min(seasonLength, Math.floor(m / 3)));
      const fitted = series.map((_, i) => {
        const from = Math.max(0, i - window + 1);
        const slice = series.slice(from, i + 1);
        return slice.reduce((a, b) => a + b, 0) / slice.length;
      });
      const tail = series.slice(-window);
      const level = tail.reduce((a, b) => a + b, 0) / tail.length;
      const resid = series.map((v, i) => v - fitted[i]);
      const sigma = std(resid.slice(window)) || 0;
      return { fitted, ahead: new Array<number>(steps).fill(level), sigma };
    }

    // Linear trend via least squares on the index.
    const t = Array.from({ length: m }, (_, i) => i);
    const tm = mean(t);
    const ym = mean(series);
    let num = 0;
    let den = 0;
    for (let i = 0; i < m; i++) {
      num += (t[i] - tm) * (series[i] - ym);
      den += (t[i] - tm) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    const intercept = ym - slope * tm;
    let trendFitted = t.map((i) => intercept + slope * i);

    let seasonal: number[] = new Array(m).fill(0);
    if (model === 'seasonal' && m >= seasonLength * 2) {
      const sums = new Array<number>(seasonLength).fill(0);
      const counts = new Array<number>(seasonLength).fill(0);
      for (let i = 0; i < m; i++) {
        const s = i % seasonLength;
        sums[s] += series[i] - trendFitted[i];
        counts[s]++;
      }
      const idxAvg = sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0));
      const centre = mean(idxAvg);
      seasonal = idxAvg.map((v) => v - centre);
      trendFitted = trendFitted.map((v, i) => v + seasonal[i % seasonLength]);
    }

    const resid = series.map((v, i) => v - trendFitted[i]);
    const sigma = std(resid) || 0;
    const ahead: number[] = [];
    for (let h = 0; h < steps; h++) {
      const i = m + h;
      let v = intercept + slope * i;
      if (model === 'seasonal' && seasonal.length) v += seasonal[i % seasonLength];
      ahead.push(v);
    }
    return { fitted: trendFitted, ahead, sigma };
  };

  // Hold-out evaluation
  let mae = NaN;
  let rmse = NaN;
  let mape = NaN;
  const ho = Math.max(2, Math.min(holdout, Math.floor(n / 2)));
  if (ho >= 2) {
    const train = y.slice(0, n - ho);
    const test = y.slice(n - ho);
    const { ahead } = fit(train, ho);
    let sAbs = 0;
    let sSq = 0;
    let sPct = 0;
    let pctCount = 0;
    for (let i = 0; i < ho; i++) {
      const err = test[i] - ahead[i];
      sAbs += Math.abs(err);
      sSq += err * err;
      if (Math.abs(test[i]) > 1e-9) {
        sPct += Math.abs(err / test[i]);
        pctCount++;
      }
    }
    mae = sAbs / ho;
    rmse = Math.sqrt(sSq / ho);
    mape = pctCount > 0 ? sPct / pctCount : NaN;
  }

  const { fitted, ahead, sigma } = fit(y, horizon);
  const band = 1.96 * sigma;
  return {
    fitted,
    forecast: ahead,
    lower: ahead.map((v) => v - band),
    upper: ahead.map((v) => v + band),
    mae,
    rmse,
    mape,
    holdout: ho,
    model,
  };
}

/** Variance inflation factors — flags predictors that are collinear. */
export function varianceInflation(X: number[][], featureNames: string[]): { name: string; vif: number }[] {
  const p = featureNames.length;
  if (p < 2) return featureNames.map((name) => ({ name, vif: 1 }));
  const out: { name: string; vif: number }[] = [];
  for (let j = 0; j < p; j++) {
    const others = featureNames.map((_, i) => i).filter((i) => i !== j);
    const reg = linearRegression(
      X.map((r) => others.map((i) => r[i])),
      X.map((r) => r[j]),
      others.map((i) => featureNames[i]),
    );
    out.push({ name: featureNames[j], vif: Number.isFinite(reg.r2) ? 1 / Math.max(1e-9, 1 - reg.r2) : Infinity });
  }
  return out;
}

export { variance };
