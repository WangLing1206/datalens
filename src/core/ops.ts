import type { Column, DType, Scalar } from './types.ts';
import { isMissing, isNumericDtype } from './types.ts';
import { DataFrame, frameFromRows, mulberry32, range } from './DataFrame.ts';
import { castColumn, toNumber } from './dtype.ts';
import { boxStats, mean, median, mode as modeOf, numericValues, quantile, sortedAsc, std } from './stats.ts';

/* ------------------------------------------------------------------ *
 * Missing values
 * ------------------------------------------------------------------ */

export interface DropNaOptions {
  how: 'any' | 'all';
  thresh?: number;
  subset?: string[];
}

export function whichRowsDropped(df: DataFrame, opts: DropNaOptions): number[] {
  const subset = opts.subset?.length ? opts.subset : df.columnNames;
  const cols = subset.map((n) => df.require(n));
  const keep: number[] = [];
  const need = opts.thresh ?? (opts.how === 'any' ? cols.length : 1);
  for (let i = 0; i < df.nRows; i++) {
    let present = 0;
    for (const c of cols) if (!isMissing(c.data[i])) present++;
    const keepRow = opts.how === 'any' ? present === cols.length : present >= Math.max(1, need);
    if (!keepRow) keep.push(i);
  }
  return keep;
}

export function dropna(df: DataFrame, opts: DropNaOptions): DataFrame {
  const drop = new Set(whichRowsDropped(df, opts));
  const keep = range(0, df.nRows).filter((i) => !drop.has(i));
  return df.take(keep);
}

export type FillStrategy =
  | 'mean'
  | 'median'
  | 'mode'
  | 'constant'
  | 'ffill'
  | 'bfill'
  | 'zero'
  | 'interpolate';

export interface FillNaOptions {
  columns: string[];
  strategy: FillStrategy;
  value?: Scalar;
  /** Restrict filling to cells that were missing (always true in practice). */
  limit?: number;
}

/** Compute the per-column fill value for a strategy, without mutating anything. */
export function fillValueFor(col: Column, strategy: FillStrategy, constant?: Scalar): Scalar {
  switch (strategy) {
    case 'mean':
      return isNumericDtype(col.dtype) ? mean(numericValues(col.data)) : null;
    case 'median':
      return isNumericDtype(col.dtype) ? median(numericValues(col.data)) : null;
    case 'mode': {
      if (isNumericDtype(col.dtype)) {
        const m = modeOf(numericValues(col.data));
        return m.length ? m[0] : null;
      }
      const counts = new Map<string, number>();
      for (const v of col.data) {
        if (isMissing(v)) continue;
        const k = String(v);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      let best: string | null = null;
      let bestN = 0;
      for (const [k, n] of counts) {
        if (n > bestN || (n === bestN && best !== null && k < best)) {
          best = k;
          bestN = n;
        }
      }
      return best;
    }
    case 'zero':
      return isNumericDtype(col.dtype) ? 0 : '';
    case 'constant':
      return constant ?? 0;
    default:
      return null;
  }
}

export function fillna(df: DataFrame, opts: FillNaOptions): DataFrame {
  const targets = opts.columns.length ? opts.columns : df.columnNames;
  const cols: Column[] = df.columns.map((c) => {
    if (!targets.includes(c.name)) return { ...c };
    const data = [...c.data];

    if (opts.strategy === 'ffill' || opts.strategy === 'bfill') {
      const fwd = opts.strategy === 'ffill';
      let last: Scalar = null;
      const order = fwd ? range(0, data.length) : range(0, data.length).reverse();
      for (const i of order) {
        if (isMissing(data[i])) data[i] = last;
        else last = data[i];
      }
      return { ...c, data };
    }

    if (opts.strategy === 'interpolate') {
      if (!isNumericDtype(c.dtype)) return { ...c, data };
      const nums = data.map((v) => (isMissing(v) ? NaN : Number(v)));
      let i = 0;
      while (i < nums.length) {
        if (Number.isNaN(nums[i])) {
          let j = i;
          while (j < nums.length && Number.isNaN(nums[j])) j++;
          const prev = i > 0 ? nums[i - 1] : NaN;
          const next = j < nums.length ? nums[j] : NaN;
          if (!Number.isNaN(prev) && !Number.isNaN(next)) {
            const step = (next - prev) / (j - i + 1);
            for (let k = i; k < j; k++) nums[k] = prev + step * (k - i + 1);
          } else if (!Number.isNaN(prev)) {
            for (let k = i; k < j; k++) nums[k] = prev;
          } else if (!Number.isNaN(next)) {
            for (let k = i; k < j; k++) nums[k] = next;
          }
          i = j;
        } else i++;
      }
      return { ...c, data: nums.map((v) => (Number.isNaN(v) ? null : v)) };
    }

    const fillValue = fillValueFor(c, opts.strategy, opts.value);
    if (fillValue === null) return { ...c, data };
    const limit = opts.limit ?? Infinity;
    let filled = 0;
    for (let i = 0; i < data.length; i++) {
      if (isMissing(data[i]) && filled < limit) {
        data[i] = fillValue;
        filled++;
      }
    }
    return { ...c, data };
  });
  return new DataFrame(cols, [...df.index], df.name, df.derived);
}

/* ------------------------------------------------------------------ *
 * Duplicates
 * ------------------------------------------------------------------ */

export function rowKey(df: DataFrame, i: number, subset?: string[]): string {
  const cols = subset?.length ? subset : df.columnNames;
  let s = '';
  for (const n of cols) {
    const v = df.require(n).data[i];
    s += v === null ? '\u0000' : `${typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(10)) : String(v)}`;
    s += '\u0001';
  }
  return s;
}

/** Positions of every row that is a duplicate under `keep`. */
export function duplicatedPositions(df: DataFrame, subset: string[] | undefined, keep: 'first' | 'last' | false): number[] {
  const byKey = new Map<string, number[]>();
  for (let i = 0; i < df.nRows; i++) {
    const k = rowKey(df, i, subset);
    const arr = byKey.get(k);
    if (arr) arr.push(i);
    else byKey.set(k, [i]);
  }
  const out: number[] = [];
  for (const positions of byKey.values()) {
    if (positions.length < 2) continue;
    if (keep === false) out.push(...positions);
    else if (keep === 'first') out.push(...positions.slice(1));
    else out.push(...positions.slice(0, -1));
  }
  return out.sort((a, b) => a - b);
}

export function dropDuplicates(df: DataFrame, subset: string[] | undefined, keep: 'first' | 'last' | false): DataFrame {
  const drop = new Set(duplicatedPositions(df, subset, keep));
  return df.take(range(0, df.nRows).filter((i) => !drop.has(i)));
}

export interface DuplicateGroup {
  key: string;
  positions: number[];
}

export function duplicateGroups(df: DataFrame, subset: string[] | undefined, limit = 200): DuplicateGroup[] {
  const byKey = new Map<string, number[]>();
  for (let i = 0; i < df.nRows; i++) {
    const k = rowKey(df, i, subset);
    const arr = byKey.get(k);
    if (arr) arr.push(i);
    else byKey.set(k, [i]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, positions] of byKey) {
    if (positions.length > 1) groups.push({ key, positions });
    if (groups.length >= limit) break;
  }
  return groups.sort((a, b) => b.positions.length - a.positions.length);
}

/* ------------------------------------------------------------------ *
 * Columns
 * ------------------------------------------------------------------ */

export interface CastReport {
  df: DataFrame;
  failures: Record<string, number[]>;
}

export function castColumns(df: DataFrame, mapping: Record<string, DType>): CastReport {
  const failures: Record<string, number[]> = {};
  const cols: Column[] = df.columns.map((c) => {
    const target = mapping[c.name];
    if (!target || target === c.dtype) return { ...c };
    const r = castColumn(c, target);
    if (r.failures.length) failures[c.name] = r.failures;
    return { name: c.name, dtype: target, data: r.data };
  });
  return { df: new DataFrame(cols, [...df.index], df.name, df.derived), failures };
}

export function renameColumns(df: DataFrame, mapping: Record<string, string>): DataFrame {
  return df.rename(mapping);
}

export function dropColumns(df: DataFrame, names: string[]): DataFrame {
  return df.drop(names);
}

export interface SortSpec {
  column: string;
  ascending: boolean;
}

export function sortValues(df: DataFrame, specs: SortSpec[], naPosition: 'first' | 'last' = 'last'): DataFrame {
  if (specs.length === 0) return df;
  const cols = specs.map((s) => df.require(s.column));
  const pos = range(0, df.nRows);
  const dir = specs.map((s) => (s.ascending ? 1 : -1));
  pos.sort((a, b) => {
    for (let k = 0; k < cols.length; k++) {
      const av = cols[k].data[a];
      const bv = cols[k].data[b];
      const aNull = isMissing(av);
      const bNull = isMissing(bv);
      if (aNull || bNull) {
        if (aNull && bNull) continue;
        return aNull ? (naPosition === 'first' ? -1 : 1) : naPosition === 'first' ? 1 : -1;
      }
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else if (typeof av === 'boolean' && typeof bv === 'boolean') cmp = (av ? 1 : 0) - (bv ? 1 : 0);
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
      if (cmp !== 0) return cmp * dir[k];
    }
    return a - b;
  });
  return df.take(pos);
}

/* ------------------------------------------------------------------ *
 * Feature engineering
 * ------------------------------------------------------------------ */

export interface BinOptions {
  column: string;
  method: 'equal' | 'quantile';
  bins: number;
  /** Column name to write; defaults to `<column>_bin`. */
  outputName?: string;
  labels?: string[];
}

export interface BinEdgeInfo {
  edges: number[];
  labels: string[];
}

export function computeBinEdges(df: DataFrame, opts: BinOptions): BinEdgeInfo {
  const vals = numericValues(df.require(opts.column).data);
  if (vals.length === 0) return { edges: [], labels: [] };
  const s = sortedAsc(vals);
  const k = Math.max(1, opts.bins);
  const edges: number[] = [];
  if (opts.method === 'equal') {
    const lo = s[0];
    const hi = s[s.length - 1];
    for (let i = 0; i <= k; i++) edges.push(lo + ((hi - lo) * i) / k);
  } else {
    edges.push(s[0]);
    for (let i = 1; i < k; i++) edges.push(quantile(s, i / k));
    edges.push(s[s.length - 1]);
  }
  const labels =
    opts.labels ??
    edges.slice(0, -1).map((lo, i) => `(${fmtEdge(lo)}, ${fmtEdge(edges[i + 1])}]`);
  return { edges, labels };
}

function fmtEdge(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 1000 || (a > 0 && a < 0.01)) return v.toExponential(2);
  return String(Math.round(v * 1000) / 1000);
}

export function binColumn(df: DataFrame, opts: BinOptions): { df: DataFrame; info: BinEdgeInfo } {
  const info = computeBinEdges(df, opts);
  const src = df.require(opts.column);
  const name = opts.outputName ?? `${opts.column}_bin`;
  if (info.edges.length < 2) return { df, info };
  const data: Scalar[] = src.data.map((v) => {
    if (isMissing(v)) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    // Right-closed intervals, matching pd.cut(right=True).
    for (let i = 0; i < info.labels.length; i++) {
      const lo = info.edges[i];
      const hi = info.edges[i + 1];
      if (i === 0 ? n >= lo && n <= hi : n > lo && n <= hi) return info.labels[i];
    }
    return null;
  });
  return { df: df.withColumn(name, data, 'category'), info };
}

export type NormalizeMethod = 'minmax' | 'zscore' | 'robust' | 'log1p';

export function normalizeColumn(df: DataFrame, column: string, method: NormalizeMethod, outputName?: string): DataFrame {
  const src = df.require(column);
  if (!isNumericDtype(src.dtype)) return df;
  const vals = numericValues(src.data);
  if (vals.length === 0) return df;
  const m = mean(vals);
  const s = std(vals);
  const b = boxStats(vals);
  const data: Scalar[] = src.data.map((v) => {
    if (isMissing(v)) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    switch (method) {
      case 'minmax': {
        const lo = b.min;
        const hi = b.max;
        return hi === lo ? 0 : (n - lo) / (hi - lo);
      }
      case 'zscore':
        return s === 0 ? 0 : (n - m) / s;
      case 'robust':
        return b.iqr === 0 ? 0 : (n - b.median) / b.iqr;
      case 'log1p':
        return n > -1 ? Math.log1p(n) : null;
    }
  });
  const suffix = { minmax: 'mm', zscore: 'z', robust: 'robust', log1p: 'log' }[method];
  return df.withColumn(outputName ?? `${column}_${suffix}`, data, 'float');
}

export interface OneHotOptions {
  columns: string[];
  dropFirst: boolean;
  maxCategories: number;
  separator: string;
}

export function oneHotEncode(df: DataFrame, opts: OneHotOptions): { df: DataFrame; created: string[]; skipped: string[] } {
  const created: string[] = [];
  const skipped: string[] = [];
  let out = df;
  const newCols: Column[] = [];

  for (const name of opts.columns) {
    const col = df.col(name);
    if (!col) continue;
    const cats = [...new Set(col.data.filter((v) => !isMissing(v)).map((v) => String(v)))].sort();
    if (cats.length > opts.maxCategories) {
      skipped.push(name);
      continue;
    }
    const use = opts.dropFirst ? cats.slice(1) : cats;
    for (const cat of use) {
      const cname = `${name}${opts.separator}${cat}`;
      newCols.push({
        name: cname,
        dtype: 'int',
        data: col.data.map((v) => (isMissing(v) ? null : v === null ? 0 : String(v) === cat ? 1 : 0)),
      });
      created.push(cname);
    }
  }
  if (newCols.length) out = out.withColumns(newCols);
  return { df: out, created, skipped };
}

/* ------------------------------------------------------------------ *
 * Reshaping
 * ------------------------------------------------------------------ */

/** `pd.melt` — wide to long. */
export function melt(df: DataFrame, idVars: string[], valueVars: string[]): DataFrame {
  const ids = idVars.length ? idVars : df.columnNames.filter((n) => !valueVars.includes(n));
  const vals = valueVars.length ? valueVars : df.columnNames.filter((n) => !ids.includes(n));
  const headers = [...ids, 'variable', 'value'];
  const rows: Scalar[][] = [];
  for (let i = 0; i < df.nRows; i++) {
    const idRow = ids.map((n) => df.require(n).data[i]);
    for (const v of vals) rows.push([...idRow, v, df.require(v).data[i]]);
  }
  return frameFromRows(headers, rows, `${df.name}_melted`);
}

export interface CrosstabOptions {
  row: string;
  col: string;
  normalize?: 'none' | 'index' | 'columns' | 'all';
}

export interface CrosstabResult {
  rowValues: string[];
  colValues: string[];
  counts: number[][];
  /** Row/column totals before normalisation. */
  rowTotals: number[];
  colTotals: number[];
  total: number;
}

export function crosstab(df: DataFrame, opts: CrosstabOptions): CrosstabResult {
  const rc = df.require(opts.row);
  const cc = df.require(opts.col);
  const rowSet = new Set<string>();
  const colSet = new Set<string>();
  for (let i = 0; i < df.nRows; i++) {
    const a = rc.data[i];
    const b = cc.data[i];
    if (isMissing(a) || isMissing(b)) continue;
    rowSet.add(String(a));
    colSet.add(String(b));
  }
  const rowValues = [...rowSet].sort();
  const colValues = [...colSet].sort();
  const counts = rowValues.map(() => new Array<number>(colValues.length).fill(0));
  const rIdx = new Map(rowValues.map((v, i) => [v, i]));
  const cIdx = new Map(colValues.map((v, i) => [v, i]));
  for (let i = 0; i < df.nRows; i++) {
    const a = rc.data[i];
    const b = cc.data[i];
    if (isMissing(a) || isMissing(b)) continue;
    const r = rIdx.get(String(a));
    const c = cIdx.get(String(b));
    if (r === undefined || c === undefined) continue;
    counts[r][c]++;
  }
  const rowTotals = counts.map((r) => r.reduce((a, b) => a + b, 0));
  const colTotals = colValues.map((_, c) => counts.reduce((a, r) => a + r[c], 0));
  const total = rowTotals.reduce((a, b) => a + b, 0);
  return { rowValues, colValues, counts, rowTotals, colTotals, total };
}

/* ------------------------------------------------------------------ *
 * Filtering AST — shared by the visual filter builder and `df.query()`
 * ------------------------------------------------------------------ */

export type FilterOperator =
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'not_null'
  | 'between';

export interface FilterCondition {
  id: string;
  column: string;
  op: FilterOperator;
  value?: Scalar;
  value2?: Scalar;
  values?: Scalar[];
}

export interface FilterGroup {
  id: string;
  logic: 'and' | 'or';
  conditions: FilterCondition[];
}

function compareScalar(a: Scalar, op: FilterOperator, b: Scalar | undefined, b2?: Scalar): boolean {
  if (op === 'is_null') return isMissing(a);
  if (op === 'not_null') return !isMissing(a);

  if (op === 'contains' || op === 'not_contains' || op === 'starts_with' || op === 'ends_with') {
    if (isMissing(a)) return false;
    const s = String(a).toLowerCase();
    const t = String(b ?? '').toLowerCase();
    const hit =
      op === 'contains' ? s.includes(t)
      : op === 'not_contains' ? !s.includes(t)
      : op === 'starts_with' ? s.startsWith(t)
      : s.endsWith(t);
    return hit;
  }

  if (op === 'in' || op === 'not_in') {
    if (isMissing(a)) return false;
    const vals = (b2 !== undefined ? [b, b2] : []) as Scalar[];
    void vals;
    return false;
  }

  if (isMissing(a) || b === undefined || b === null) return false;

  const an = typeof a === 'number' ? a : typeof a === 'boolean' ? (a ? 1 : 0) : Number(a);
  const bn = typeof b === 'number' ? b : typeof b === 'boolean' ? (b ? 1 : 0) : Number(b);
  const bothNumeric = Number.isFinite(an) && Number.isFinite(bn) && !(typeof a === 'string' && !isNumericString(a)) && !(typeof b === 'string' && !isNumericString(b));

  const cmp = (x: number | string, y: number | string): number =>
    typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });

  const ax: number | string = bothNumeric ? an : String(a);
  const bx: number | string = bothNumeric ? bn : String(b);

  switch (op) {
    case '==':
      return cmp(ax, bx) === 0;
    case '!=':
      return cmp(ax, bx) !== 0;
    case '>':
      return cmp(ax, bx) > 0;
    case '>=':
      return cmp(ax, bx) >= 0;
    case '<':
      return cmp(ax, bx) < 0;
    case '<=':
      return cmp(ax, bx) <= 0;
    case 'between': {
      if (b2 === undefined || b2 === null) return false;
      const b2n = typeof b2 === 'number' ? b2 : Number(b2);
      const hi = bothNumeric && Number.isFinite(b2n) ? b2n : String(b2);
      return cmp(ax, bx) >= 0 && cmp(ax, hi as number | string) <= 0;
    }
    default:
      return false;
  }
}

function isNumericString(s: string): boolean {
  return s.trim() !== '' && Number.isFinite(Number(s));
}

export function matchesGroup(df: DataFrame, pos: number, group: FilterGroup): boolean {
  if (group.conditions.length === 0) return true;
  const test = (c: FilterCondition): boolean => {
    const col = df.col(c.column);
    if (!col) return true;
    const v = col.data[pos];
    if (c.op === 'in') {
      if (isMissing(v) || !c.values?.length) return false;
      return c.values.some((x) => String(x) === String(v));
    }
    if (c.op === 'not_in') {
      if (isMissing(v)) return false;
      return !c.values?.some((x) => String(x) === String(v));
    }
    return compareScalar(v, c.op, c.value, c.value2);
  };
  return group.logic === 'and' ? group.conditions.every(test) : group.conditions.some(test);
}

export function applyFilter(df: DataFrame, groups: FilterGroup[]): DataFrame {
  if (groups.length === 0 || groups.every((g) => g.conditions.length === 0)) return df;
  const active = groups.filter((g) => g.conditions.length > 0);
  const pos: number[] = [];
  for (let i = 0; i < df.nRows; i++) {
    if (active.every((g) => matchesGroup(df, i, g))) pos.push(i);
  }
  return df.take(pos);
}

/** Positions this filter would keep — used for the "preview effect" affordance. */
export function countFilter(df: DataFrame, groups: FilterGroup[]): number {
  return applyFilter(df, groups).nRows;
}

/* ------------------------------------------------------------------ *
 * Free-expression column assignment
 * ------------------------------------------------------------------ */

/**
 * Evaluate a small arithmetic expression against one row.
 * Supports column references (bare or `[name]`), numbers, + - * / % ^,
 * parentheses and the functions below. No `eval`, so an expression from a
 * shared project file cannot execute arbitrary code.
 */
const EXPR_FUNCS: Record<string, (args: number[]) => number> = {
  abs: (a) => Math.abs(a[0]),
  round: (a) => (a.length > 1 ? roundTo(a[0], a[1]) : Math.round(a[0])),
  floor: (a) => Math.floor(a[0]),
  ceil: (a) => Math.ceil(a[0]),
  sqrt: (a) => Math.sqrt(a[0]),
  ln: (a) => Math.log(a[0]),
  log10: (a) => Math.log10(a[0]),
  exp: (a) => Math.exp(a[0]),
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  pow: (a) => Math.pow(a[0], a[1]),
  sign: (a) => Math.sign(a[0]),
};

function roundTo(v: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

export interface ExprEvalResult {
  ok: boolean;
  error?: string;
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'ref'; v: string }
  | { t: 'op'; v: string }
  | { t: 'fn'; v: string }
  | { t: 'lparen' }
  | { t: 'rparen' }
  | { t: 'comma' };

function tokenize(expr: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '[') {
      const end = expr.indexOf(']', i);
      if (end < 0) throw new Error('Unclosed [column] reference');
      out.push({ t: 'ref', v: expr.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[0-9.eE]/.test(expr[j])) {
        if ((expr[j] === 'e' || expr[j] === 'E') && /[+-]/.test(expr[j + 1] ?? '')) j++;
        j++;
      }
      const num = Number(expr.slice(i, j));
      if (!Number.isFinite(num)) throw new Error(`Bad number: ${expr.slice(i, j)}`);
      out.push({ t: 'num', v: num });
      i = j;
      continue;
    }
    if (/[A-Za-z_\u4e00-\u9fa5]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[A-Za-z0-9_\u4e00-\u9fa5.]/.test(expr[j])) j++;
      const word = expr.slice(i, j);
      let k = j;
      while (k < expr.length && /\s/.test(expr[k])) k++;
      if (expr[k] === '(') out.push({ t: 'fn', v: word.toLowerCase() });
      else out.push({ t: 'ref', v: word });
      i = j;
      continue;
    }
    if ('+-*/%^'.includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    if (ch === '(') {
      out.push({ t: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      out.push({ t: 'rparen' });
      i++;
      continue;
    }
    if (ch === ',') {
      out.push({ t: 'comma' });
      i++;
      continue;
    }
    throw new Error(`Unexpected character: ${ch}`);
  }
  return out;
}

class ExprParser {
  private pos = 0;
  constructor(private tokens: Token[], private get: (name: string) => number) {}

  parse(): number {
    const v = this.expr();
    if (this.pos < this.tokens.length) throw new Error('Unexpected trailing tokens in expression');
    return v;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private expr(): number {
    let left = this.term();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'op' && (t.v === '+' || t.v === '-')) {
        this.pos++;
        const right = this.term();
        left = t.v === '+' ? left + right : left - right;
      } else break;
    }
    return left;
  }

  private term(): number {
    let left = this.power();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        this.pos++;
        const right = this.power();
        left = t.v === '*' ? left * right : t.v === '/' ? left / right : left % right;
      } else break;
    }
    return left;
  }

  private power(): number {
    const base = this.unary();
    const t = this.peek();
    if (t && t.t === 'op' && t.v === '^') {
      this.pos++;
      return Math.pow(base, this.power());
    }
    return base;
  }

  private unary(): number {
    const t = this.peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
      this.pos++;
      const v = this.unary();
      return t.v === '-' ? -v : v;
    }
    return this.atom();
  }

  private atom(): number {
    const t = this.peek();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.t === 'num') {
      this.pos++;
      return t.v;
    }
    if (t.t === 'ref') {
      this.pos++;
      return this.get(t.v);
    }
    if (t.t === 'lparen') {
      this.pos++;
      const v = this.expr();
      const close = this.peek();
      if (!close || close.t !== 'rparen') throw new Error('Missing )');
      this.pos++;
      return v;
    }
    if (t.t === 'fn') {
      const fn = EXPR_FUNCS[t.v];
      if (!fn) throw new Error(`Unknown function: ${t.v}`);
      this.pos++;
      const open = this.peek();
      if (!open || open.t !== 'lparen') throw new Error(`Expected ( after ${t.v}`);
      this.pos++;
      const args: number[] = [];
      if (this.peek()?.t !== 'rparen') {
        args.push(this.expr());
        while (this.peek()?.t === 'comma') {
          this.pos++;
          args.push(this.expr());
        }
      }
      const close = this.peek();
      if (!close || close.t !== 'rparen') throw new Error('Missing )');
      this.pos++;
      return fn(args);
    }
    throw new Error('Unexpected token in expression');
  }
}

/** Validate syntax against a sample row before running on the whole frame. */
export function validateExpression(expr: string, df: DataFrame): ExprEvalResult {
  try {
    const tokens = tokenize(expr);
    if (tokens.length === 0) return { ok: false, error: 'Empty expression' };
    const get = (name: string): number => {
      const col = df.col(name);
      if (!col) throw new Error(`Unknown column: ${name}`);
      const v = col.data[0];
      return isMissing(v) ? NaN : Number(v);
    };
    new ExprParser(tokens, get).parse();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function evaluateExpression(df: DataFrame, expr: string): { data: Scalar[]; error?: string } {
  let tokens: Token[];
  try {
    tokens = tokenize(expr);
    if (tokens.length === 0) return { data: [], error: 'Empty expression' };
  } catch (e) {
    return { data: [], error: e instanceof Error ? e.message : String(e) };
  }

  const colData = new Map<string, Scalar[]>();
  for (const c of df.columns) colData.set(c.name, c.data);

  const out: Scalar[] = new Array(df.nRows);
  for (let i = 0; i < df.nRows; i++) {
    const get = (name: string): number => {
      const arr = colData.get(name);
      if (!arr) throw new Error(`Unknown column: ${name}`);
      const v = arr[i];
      return isMissing(v) ? NaN : Number(v);
    };
    try {
      const v = new ExprParser(tokens, get).parse();
      out[i] = Number.isFinite(v) ? v : null;
    } catch (e) {
      return { data: [], error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { data: out };
}

/* ------------------------------------------------------------------ *
 * Sampling helpers for large frames
 * ------------------------------------------------------------------ */

/** Deterministic resume of a large frame for chart rendering. */
export function sampleForChart(df: DataFrame, column: string, maxPoints = 8000): number[] {
  const col = df.require(column);
  const positions = range(0, df.nRows).filter((i) => !isMissing(col.data[i]));
  if (positions.length <= maxPoints) return positions;
  const rnd = mulberry32(7);
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions.slice(0, maxPoints).sort((a, b) => a - b);
}

/** Convert a column to numbers where possible (used by correlation and PCA). */
export function numericMatrix(df: DataFrame, columns: string[]): { matrix: number[][]; completeRows: number[] } {
  const cols = columns.map((c) => df.require(c));
  const rows: number[][] = [];
  const keep: number[] = [];
  for (let i = 0; i < df.nRows; i++) {
    const r: number[] = new Array(cols.length);
    let ok = true;
    for (let j = 0; j < cols.length; j++) {
      const v = toNumber(cols[j].data[i]);
      if (v === null) {
        ok = false;
        break;
      }
      r[j] = v;
    }
    if (ok) {
      rows.push(r);
      keep.push(i);
    }
  }
  return { matrix: rows, completeRows: keep };
}
