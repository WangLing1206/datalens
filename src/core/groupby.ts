import type { AggFunc, Column, Scalar } from './types.ts';
import { isMissing, isNumericDtype } from './types.ts';
import { DataFrame } from './DataFrame.ts';
import { inferDtype } from './dtype.ts';
import { max as maxOf, mean, median, min as minOf, numericValues, std, sum as sumOf, variance } from './stats.ts';

/**
 * `df.groupby(keys).agg({...})` returning a long-format frame — the equivalent
 * of always calling `.reset_index()` afterwards, which is what an analyst
 * actually wants to chart. Aggregate columns are named `col_func`, mirroring
 * pandas' named-aggregation idiom.
 */

export interface AggSpec {
  column: string;
  funcs: AggFunc[];
}

export interface GroupByOptions {
  keys: string[];
  aggs: AggSpec[];
  /** pandas `dropna=True` (default) omits rows whose key is missing. */
  dropna?: boolean;
  sort?: boolean;
}

export interface GroupByResult {
  df: DataFrame;
  keyColumns: string[];
  valueColumns: string[];
  /** Rows dropped because a key was missing. */
  droppedRows: number;
  /** Number of distinct groups before aggregation. */
  groupCount: number;
}

export function aggregateValues(values: Scalar[], funcs: AggFunc[], dtype: Column['dtype']): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  const numeric = isNumericDtype(dtype) || dtype === 'bool';
  const nonNull: Scalar[] = [];
  for (const v of values) if (!isMissing(v)) nonNull.push(v);
  const nums = numeric ? numericValues(values) : [];

  for (const f of funcs) {
    switch (f) {
      case 'count':
        out[f] = nonNull.length;
        break;
      case 'nunique':
        out[f] = new Set(nonNull.map((v) => String(v))).size;
        break;
      case 'sum':
        // pandas: sum of an all-NaN group is 0, and bools sum as 0/1.
        out[f] = numeric ? sumOf(nums) : null;
        break;
      case 'mean':
        out[f] = nums.length ? mean(nums) : null;
        break;
      case 'median':
        out[f] = nums.length ? median(nums) : null;
        break;
      case 'std':
        out[f] = nums.length >= 2 ? std(nums) : null;
        break;
      case 'var':
        out[f] = nums.length >= 2 ? variance(nums) : null;
        break;
      case 'min':
        out[f] = nums.length ? minOf(nums) : nonNull.length ? (nonNull[0] as Scalar) : null;
        break;
      case 'max':
        out[f] = nums.length ? maxOf(nums) : nonNull.length ? (nonNull[0] as Scalar) : null;
        break;
      case 'first':
        // pandas first() skips NaN.
        out[f] = nonNull.length ? nonNull[0] : null;
        break;
      case 'last':
        out[f] = nonNull.length ? nonNull[nonNull.length - 1] : null;
        break;
      case 'mode':
        out[f] = nonNull.length ? modeOfScalars(nonNull, numeric) : null;
        break;
    }
  }
  return out;
}

function modeOfScalars(values: Scalar[], numeric: boolean): Scalar {
  const counts = new Map<string, { v: Scalar; n: number }>();
  for (const v of values) {
    const k = String(v);
    const e = counts.get(k);
    if (e) e.n++;
    else counts.set(k, { v, n: 1 });
  }
  let best: { v: Scalar; n: number } | null = null;
  for (const e of counts.values()) {
    if (!best || e.n > best.n) best = e;
    else if (best && e.n === best.n && numeric && Number(e.v) < Number(best.v)) best = e;
  }
  return best ? best.v : null;
}

export function groupBy(df: DataFrame, opts: GroupByOptions): GroupByResult {
  const { keys, aggs } = opts;
  const dropna = opts.dropna ?? true;
  const sort = opts.sort ?? true;

  const keyCols = keys.map((k) => df.require(k));
  const aggCols = aggs
    .map((a) => ({ spec: a, col: df.require(a.column) }))
    .filter((a) => a.spec.funcs.length > 0);

  const groups = new Map<string, { keyValues: Scalar[]; positions: number[] }>();
  let droppedRows = 0;

  for (let i = 0; i < df.nRows; i++) {
    const keyValues: Scalar[] = new Array(keyCols.length);
    let hasNull = false;
    for (let k = 0; k < keyCols.length; k++) {
      const v = keyCols[k].data[i];
      keyValues[k] = v;
      if (isMissing(v)) hasNull = true;
    }
    if (hasNull && dropna) {
      droppedRows++;
      continue;
    }
    const gk = keyValues.map((v) => (isMissing(v) ? '\u0000NULL' : `${typeof v === 'number' ? v : String(v)}`)).join('\u0001');
    const g = groups.get(gk);
    if (g) g.positions.push(i);
    else groups.set(gk, { keyValues, positions: [i] });
  }

  const entries = [...groups.values()];
  const groupCount = entries.length;
  if (sort) {
    entries.sort((a, b) => compareKeyRows(a.keyValues, b.keyValues));
  }

  const headers: string[] = [...keys];
  const valueColumns: string[] = [];
  const colSpecs: { col: Column; funcs: AggFunc[]; outName: string }[] = [];
  for (const { spec, col } of aggCols) {
    for (const f of spec.funcs) {
      const outName = `${spec.column}_${f}`;
      headers.push(outName);
      valueColumns.push(outName);
      const existing = colSpecs.find((c) => c.col.name === col.name);
      if (existing) existing.funcs.push(f);
      else colSpecs.push({ col, funcs: [f], outName });
    }
  }

  const rows: Scalar[][] = entries.map((entry) => {
    const row: Scalar[] = [...entry.keyValues];
    for (const spec of colSpecs) {
      const values = entry.positions.map((p) => spec.col.data[p]);
      const agg = aggregateValues(values, spec.funcs, spec.col.dtype);
      for (const f of spec.funcs) row.push(agg[f]);
    }
    return row;
  });

  // Assign explicit dtypes rather than re-inferring, so an all-null aggregate
  // column stays numeric instead of silently becoming a string column.
  const columns: Column[] = headers.map((h, j) => {
    const data = rows.map((r) => r[j]);
    if (j < keys.length) return { name: h, dtype: keyCols[j].dtype, data };
    const isNumericAgg = !h.endsWith('_count') && !h.endsWith('_nunique') && !h.endsWith('_first') && !h.endsWith('_last') && !h.endsWith('_mode');
    if (h.endsWith('_count') || h.endsWith('_nunique')) return { name: h, dtype: 'int', data };
    if (isNumericAgg) return { name: h, dtype: 'float', data };
    return { name: h, dtype: inferDtype(data), data };
  });

  const out = new DataFrame(columns, undefined, df.name, true);
  return { df: out, keyColumns: keys, valueColumns, droppedRows, groupCount };
}

function compareKeyRows(a: Scalar[], b: Scalar[]): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y;
    } else if (typeof x === 'string' && typeof y === 'string') {
      const c = x.localeCompare(y, undefined, { numeric: true });
      if (c !== 0) return c;
    } else {
      const c = String(x).localeCompare(String(y), undefined, { numeric: true });
      if (c !== 0) return c;
    }
  }
  return 0;
}

/* ------------------------------------------------------------------ *
 * Grouped distribution summary — powers the "compare distributions"
 * view without materialising every row of every group.
 * ------------------------------------------------------------------ */

export interface GroupDistribution {
  key: string;
  values: number[];
  count: number;
}

export function groupDistributions(
  df: DataFrame,
  keyColumn: string,
  valueColumn: string,
  opts: { maxGroups?: number; maxValuesPerGroup?: number } = {},
): GroupDistribution[] {
  const maxGroups = opts.maxGroups ?? 12;
  const maxValues = opts.maxValuesPerGroup ?? 4000;
  const kc = df.require(keyColumn);
  const vc = df.require(valueColumn);
  const map = new Map<string, number[]>();
  for (let i = 0; i < df.nRows; i++) {
    const k = kc.data[i];
    const v = vc.data[i];
    if (isMissing(k) || isMissing(v)) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const key = String(k);
    const arr = map.get(key);
    if (arr) {
      if (arr.length < maxValues) arr.push(n);
    } else map.set(key, [n]);
  }
  return [...map.entries()]
    .map(([key, values]) => ({ key, values, count: values.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, maxGroups);
}
