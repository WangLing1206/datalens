import type { AggFunc, Column, Scalar } from './types.ts';
import { isMissing } from './types.ts';
import { DataFrame } from './DataFrame.ts';
import { aggregateValues } from './groupby.ts';
import { inferDtype } from './dtype.ts';

/**
 * `df.pivot_table(index=..., columns=..., values=..., aggfunc=...)`.
 *
 * Returns a rectangular grid (`rowValues` x `columnLabels`) of numbers-or-null,
 * which is exactly the shape a heatmap or a grouped table wants. Margins
 * (`margins=True`) append an "All" row and column like pandas does.
 */

export interface PivotOptions {
  index: string[];
  columns: string[];
  values: string[];
  aggfunc: AggFunc;
  fillValue?: Scalar;
  margins?: boolean;
  dropna?: boolean;
  /** Cap on distinct column keys; extra keys are folded into "<other>". */
  maxColumns?: number;
}

export interface PivotResult {
  rowValues: string[][];
  /** Column header labels; when multiple value columns, "colKey · valueName". */
  columnLabels: string[];
  /** Numeric cells, same shape as [rowValues.length][columnLabels.length]. */
  cells: (number | null)[][];
  /** Raw aggregated scalars (may be non-numeric for first/last/mode). */
  rawCells: Scalar[][];
  valueColumns: string[];
  rowKeyNames: string[];
  columnKeyNames: string[];
  marginsRow: (number | null)[] | null;
  marginsColumn: (number | null)[] | null;
  grandTotal: number | null;
  droppedRows: number;
  isEmpty: boolean;
  maxColumnsTruncated: boolean;
}

export const OTHER_LABEL = '<other>';

export function pivotTable(df: DataFrame, opts: PivotOptions): PivotResult {
  const indexCols = opts.index.map((n) => df.require(n));
  const columnCols = opts.columns.map((n) => df.require(n));
  const valueCols = opts.values.map((n) => df.require(n));
  const dropna = opts.dropna ?? true;
  const maxColumns = opts.maxColumns ?? 60;

  const rowKeyNames = opts.index;
  const columnKeyNames = opts.columns;
  const valueColumns = opts.values;

  const rowKeyOf = (i: number): string[] =>
    indexCols.map((c) => (isMissing(c.data[i]) ? '\u0000NULL' : String(c.data[i])));
  const colKeyOf = (i: number): string[] =>
    columnCols.map((c) => (isMissing(c.data[i]) ? '\u0000NULL' : String(c.data[i])));

  const colFormat = (parts: string[]): string => parts.map((p, k) => formatKey(p, columnCols[k])).join(' | ');

  // ---- collect keys -------------------------------------------------
  const rowSet = new Map<string, string[]>();
  const colSet = new Map<string, string[]>();
  let droppedRows = 0;
  for (let i = 0; i < df.nRows; i++) {
    const rk = rowKeyOf(i);
    const ck = colKeyOf(i);
    if (dropna && (rk.some((r) => r === '\u0000NULL') || ck.some((c) => c === '\u0000NULL'))) {
      droppedRows++;
      continue;
    }
    const rj = rk.join('\u0001');
    if (!rowSet.has(rj)) rowSet.set(rj, rk);
    const cj = ck.join('\u0001');
    if (!colSet.has(cj)) colSet.set(cj, ck);
  }

  const rowEntries = [...rowSet.entries()].sort((a, b) => keyCompare(a[1], b[1]));
  let colEntries = [...colSet.entries()].sort((a, b) => keyCompare(a[1], b[1]));

  let truncated = false;
  if (colEntries.length > maxColumns) {
    truncated = true;
    const keep = colEntries.slice(0, maxColumns - 1);
    const rest = colEntries.slice(maxColumns - 1);
    const otherKey = '\u0000OTHER';
    const merged = new Map<string, string[]>();
    for (const [, parts] of rest) {
      const j = parts.join('\u0001');
      const cur = merged.get(j);
      if (!cur) merged.set(j, parts);
    }
    keep.push([otherKey, columnKeyNames.map(() => OTHER_LABEL)]);
    colEntries = keep;
  }

  const rowIndex = new Map(rowEntries.map(([k], i) => [k, i]));
  const colIndex = new Map(colEntries.map(([k], i) => [k, i]));

  // ---- bucket values ------------------------------------------------
  const nR = rowEntries.length;
  const nC = colEntries.length;
  const labels: string[] = [];
  for (const [, parts] of colEntries) {
    const base = colFormat(parts);
    if (valueCols.length === 1) labels.push(base);
    else for (const v of valueColumns) labels.push(`${base} · ${v}`);
  }
  const totalCols = nC * valueCols.length;

  const buckets: Scalar[][][][] = Array.from({ length: nR }, () =>
    Array.from({ length: totalCols }, () => valueCols.map(() => [] as Scalar[])),
  );

  for (let i = 0; i < df.nRows; i++) {
    const rk = rowKeyOf(i);
    const ck = colKeyOf(i);
    if (dropna && (rk.some((r) => r === '\u0000NULL') || ck.some((c) => c === '\u0000NULL'))) continue;
    const r = rowIndex.get(rk.join('\u0001'));
    let c = colIndex.get(ck.join('\u0001'));
    if (r === undefined) continue;
    if (c === undefined) {
      if (!truncated) continue;
      c = colIndex.get('\u0000OTHER');
      if (c === undefined) continue;
    }
    const bucket = buckets[r][c];
    for (let v = 0; v < valueCols.length; v++) bucket[v].push(valueCols[v].data[i]);
  }

  // ---- aggregate ----------------------------------------------------
  const rawCells: Scalar[][] = Array.from({ length: nR }, () => new Array<Scalar>(totalCols).fill(null));
  for (let r = 0; r < nR; r++) {
    for (let c = 0; c < totalCols; c++) {
      const vIdx = valueCols.length === 1 ? 0 : c % valueCols.length;
      const values = buckets[r][c][vIdx];
      if (values.length === 0) {
        rawCells[r][c] = opts.fillValue !== undefined ? opts.fillValue : null;
        continue;
      }
      rawCells[r][c] = aggregateValues(values, [opts.aggfunc], valueCols[vIdx].dtype)[opts.aggfunc];
    }
  }

  const cells: (number | null)[][] = rawCells.map((row) => row.map((v) => toNum(v)));

  // ---- margins ------------------------------------------------------
  let marginsRow: (number | null)[] | null = null;
  let marginsColumn: (number | null)[] | null = null;
  let grandTotal: number | null = null;

  if (opts.margins) {
    // Column of row-totals, then a bottom row of column-totals.
    const rowTotals: (number | null)[] = new Array(totalCols).fill(null);
    for (let c = 0; c < totalCols; c++) {
      const colVals = cells.map((r) => r[c]).filter((v): v is number => v !== null);
      rowTotals[c] = colVals.length ? sumForMargin(colVals) : null;
    }
    marginsRow = rowTotals;
    grandTotal = rowTotals.some((v) => v !== null) ? sumForMargin(rowTotals.filter((v): v is number => v !== null)) : null;

    const colTotals: (number | null)[] = new Array(nR).fill(null);
    for (let r = 0; r < nR; r++) {
      const vals = cells[r].filter((v): v is number => v !== null);
      colTotals[r] = vals.length ? sumForMargin(vals) : null;
    }
    marginsColumn = colTotals;
  }

  return {
    rowValues: rowEntries.map(([, parts]) => parts),
    columnLabels: labels,
    cells,
    rawCells,
    valueColumns,
    rowKeyNames,
    columnKeyNames,
    marginsRow,
    marginsColumn,
    grandTotal,
    droppedRows,
    isEmpty: nR === 0 || totalCols === 0,
    maxColumnsTruncated: truncated,
  };
}

function sumForMargin(vals: number[]): number {
  let s = 0;
  for (const v of vals) s += v;
  return s;
}

function toNum(v: Scalar): number | null {
  if (isMissing(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatKey(raw: string, col: Column): string {
  if (raw === '\u0000NULL') return 'NaN';
  if (raw === '\u0000OTHER') return OTHER_LABEL;
  if (col.dtype === 'datetime') {
    const n = Number(raw);
    if (Number.isFinite(n)) return new Date(n).toISOString().slice(0, 10);
  }
  return raw;
}

function keyCompare(a: string[], b: string[]): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === '\u0000NULL') return 1;
    if (y === '\u0000NULL') return -1;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny) && x.trim() !== '' && y.trim() !== '') {
      if (nx !== ny) return nx - ny;
    } else {
      const c = x.localeCompare(y, undefined, { numeric: true });
      if (c !== 0) return c;
    }
  }
  return 0;
}

/** Flatten a pivot into a tidy frame (what "导出为表格 / copy" hands the user). */
export function pivotToFrame(result: PivotResult): DataFrame {
  const headers = [...result.rowKeyNames, ...result.columnLabels];
  const rows: Scalar[][] = result.rowValues.map((rv, r) => [...rv, ...result.cells[r]]);
  if (result.marginsRow) rows.push([...result.rowKeyNames.map(() => 'All'), ...result.marginsRow]);
  const columns: Column[] = headers.map((h, j) => {
    const data = rows.map((r) => r[j]);
    return { name: h, dtype: j < result.rowKeyNames.length ? inferDtype(data) : 'float', data };
  });
  return new DataFrame(columns, undefined, 'pivot', true);
}
