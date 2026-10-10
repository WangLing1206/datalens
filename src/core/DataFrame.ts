import type { Column, DType, Scalar } from './types.ts';
import { isNumericDtype, isMissing } from './types.ts';
import { inferDtype, makeColumn } from './dtype.ts';

/**
 * An immutable, column-oriented frame — the in-browser counterpart to a
 * `pandas.DataFrame`.
 *
 * Every transformation returns a *new* DataFrame; nothing is mutated in place.
 * That is what makes the analysis pipeline (undo/redo/time-travel) trivial: the
 * store just keeps the list of operations and re-derives any intermediate frame
 * on demand.
 *
 * `index` carries the originating row number of each row, so filtering and
 * sorting stay traceable back to the source data — the UI shows both the
 * current position and the original row id.
 */
export class DataFrame {
  readonly columns: Column[];
  readonly index: number[];
  readonly name: string;
  /** Set when the frame came out of an aggregation/reshape rather than a row filter. */
  readonly derived: boolean;

  constructor(columns: Column[], index?: number[], name = 'df', derived = false) {
    this.columns = columns;
    this.index = index ?? Array.from({ length: columns[0]?.data.length ?? 0 }, (_, i) => i);
    this.name = name;
    this.derived = derived;
  }

  get nRows(): number {
    return this.index.length;
  }

  get nCols(): number {
    return this.columns.length;
  }

  get shape(): [number, number] {
    return [this.nRows, this.nCols];
  }

  get columnNames(): string[] {
    return this.columns.map((c) => c.name);
  }

  get isEmpty(): boolean {
    return this.nCols === 0 || this.nRows === 0;
  }

  has(name: string): boolean {
    return this.columns.some((c) => c.name === name);
  }

  col(name: string): Column | undefined {
    return this.columns.find((c) => c.name === name);
  }

  require(name: string): Column {
    const c = this.col(name);
    if (!c) throw new Error(`Column not found: ${name}`);
    return c;
  }

  colIndex(name: string): number {
    return this.columns.findIndex((c) => c.name === name);
  }

  /** Every column's values, skipping a lookup per row. */
  values(name: string): Scalar[] {
    return this.require(name).data;
  }

  dtypeOf(name: string): DType {
    return this.require(name).dtype;
  }

  numericColumns(): Column[] {
    return this.columns.filter((c) => isNumericDtype(c.dtype));
  }

  nonNumericColumns(): Column[] {
    return this.columns.filter((c) => !isNumericDtype(c.dtype));
  }

  datetimeColumns(): Column[] {
    return this.columns.filter((c) => c.dtype === 'datetime');
  }

  categoricalColumns(): Column[] {
    return this.columns.filter((c) => c.dtype === 'string' || c.dtype === 'category' || c.dtype === 'bool');
  }

  numericColumnNames(): string[] {
    return this.numericColumns().map((c) => c.name);
  }

  /* ---------------------------------------------------------------- *
   * Column-level transforms
   * ---------------------------------------------------------------- */

  select(names: string[]): DataFrame {
    const cols: Column[] = [];
    for (const n of names) {
      const c = this.col(n);
      if (c) cols.push({ ...c });
    }
    return new DataFrame(cols, [...this.index], this.name, this.derived);
  }

  drop(names: string[]): DataFrame {
    const drop = new Set(names);
    const cols = this.columns.filter((c) => !drop.has(c.name)).map((c) => ({ ...c }));
    return new DataFrame(cols, [...this.index], this.name, this.derived);
  }

  rename(mapping: Record<string, string>): DataFrame {
    const cols = this.columns.map((c) =>
      mapping[c.name] !== undefined && mapping[c.name] !== c.name
        ? { ...c, name: mapping[c.name] }
        : { ...c },
    );
    return new DataFrame(cols, [...this.index], this.name, this.derived);
  }

  /** Append a computed column. `data` must already be `nRows` long. */
  withColumn(name: string, data: Scalar[], dtype?: DType): DataFrame {
    const existing = this.colIndex(name);
    const col = makeColumn(name, data, dtype);
    const cols = this.columns.map((c) => ({ ...c }));
    if (existing >= 0) cols[existing] = col;
    else cols.push(col);
    return new DataFrame(cols, [...this.index], this.name, this.derived);
  }

  withColumns(newCols: Column[]): DataFrame {
    const cols = this.columns.map((c) => ({ ...c }));
    for (const nc of newCols) {
      const at = cols.findIndex((c) => c.name === nc.name);
      if (at >= 0) cols[at] = nc;
      else cols.push(nc);
    }
    return new DataFrame(cols, [...this.index], this.name, this.derived);
  }

  replaceColumn(name: string, data: Scalar[], dtype?: DType): DataFrame {
    const at = this.colIndex(name);
    if (at < 0) return this.withColumn(name, data, dtype);
    const cols = this.columns.map((c) => ({ ...c }));
    cols[at] = makeColumn(name, data, dtype ?? this.columns[at].dtype);
    return new DataFrame(cols, [...this.index], this.name, this.derived);
  }

  /** Insert a column at a specific visual position (used by "insert after"). */
  insertColumn(afterName: string | null, col: Column): DataFrame {
    const cols = this.columns.map((c) => ({ ...c }));
    const at = afterName === null ? cols.length : cols.findIndex((c) => c.name === afterName) + 1;
    cols.splice(at, 0, col);
    return new DataFrame(cols, [...this.index], this.name, this.derived);
  }

  /* ---------------------------------------------------------------- *
   * Row-level transforms
   * ---------------------------------------------------------------- */

  /** Materialise a row filter as a positional index array (0-based). */
  mask(pred: (values: (name: string) => Scalar, position: number, rowId: number) => boolean): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.nRows; i++) {
      if (pred((n) => this.require(n).data[i], i, this.index[i])) out.push(i);
    }
    return out;
  }

  /** Take rows by position; `index` values are carried over from this frame. */
  take(pos: number[]): DataFrame {
    const cols = this.columns.map((c) => ({
      name: c.name,
      dtype: c.dtype,
      data: pos.map((p) => c.data[p]),
    }));
    return new DataFrame(cols, pos.map((p) => this.index[p]), this.name, this.derived);
  }

  filter(pred: (row: RowAccessor, position: number) => boolean): DataFrame {
    const pos: number[] = [];
    for (let i = 0; i < this.nRows; i++) {
      if (pred(new RowAccessor(this, i), i)) pos.push(i);
    }
    return this.take(pos);
  }

  head(n = 5): DataFrame {
    return this.take(range(0, Math.min(n, this.nRows)));
  }

  tail(n = 5): DataFrame {
    return this.take(range(Math.max(0, this.nRows - n), this.nRows));
  }

  /** Deterministic sample so repeated renders do not reshuffle the table. */
  sample(n: number, seed = 42): DataFrame {
    const count = Math.min(n, this.nRows);
    const idx = range(0, this.nRows);
    const rnd = mulberry32(seed);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return this.take(idx.slice(0, count));
  }

  /** Stack another frame underneath (row bind / `pd.concat`). */
  concatRows(other: DataFrame): DataFrame {
    const cols: Column[] = [];
    for (const c of this.columns) {
      const oc = other.col(c.name);
      cols.push({
        name: c.name,
        dtype: c.dtype,
        data: [...c.data, ...(oc ? oc.data : new Array(other.nRows).fill(null))],
      });
    }
    return new DataFrame(cols, [...this.index, ...other.index], this.name, this.derived);
  }

  /** Column bind (`pd.concat(axis=1)`). Row count must match. */
  concatCols(other: DataFrame): DataFrame {
    const cols = [
      ...this.columns.map((c) => ({ ...c })),
      ...other.columns.map((c) => ({ ...c, data: c.data.slice(0, this.nRows) })),
    ];
    return new DataFrame(cols, [...this.index], this.name, this.derived);
  }

  /** Force every column to a fresh dtype inference (used after type casting). */
  reinfer(): DataFrame {
    const cols = this.columns.map((c) => ({ ...c, dtype: inferDtype(c.data) }));
    return new DataFrame(cols, [...this.index], this.name, this.derived);
  }

  withName(name: string): DataFrame {
    return new DataFrame(this.columns, [...this.index], name, this.derived);
  }

  /* ---------------------------------------------------------------- *
   * Export
   * ---------------------------------------------------------------- */

  toObjects(): Record<string, Scalar>[] {
    return this.index.map((_, i) => {
      const o: Record<string, Scalar> = {};
      for (const c of this.columns) o[c.name] = c.data[i];
      return o;
    });
  }

  toRows(limit = this.nRows): Scalar[][] {
    const n = Math.min(limit, this.nRows);
    const out: Scalar[][] = new Array(n);
    for (let i = 0; i < n; i++) {
      const r: Scalar[] = new Array(this.nCols);
      for (let j = 0; j < this.nCols; j++) r[j] = this.columns[j].data[i];
      out[i] = r;
    }
    return out;
  }

  /** A stable cache key describing the frame's provenance (used to memoise analysis). */
  fingerprint(): string {
    const shape = `${this.nRows}x${this.nCols}`;
    const head = this.columns.map((c) => `${c.name}:${c.dtype}`).join(',');
    let h = 2166136261;
    const s = `${shape}|${head}|${this.index.length}|${this.index[0] ?? -1}|${this.index[this.index.length - 1] ?? -1}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }
}

/** Fast, positional row reader handed to `DataFrame.filter`. */
export class RowAccessor {
  constructor(private df: DataFrame, private pos: number) {}
  get(name: string): Scalar {
    return this.df.require(name).data[this.pos];
  }
  num(name: string): number {
    const v = this.get(name);
    return isMissing(v) ? NaN : typeof v === 'number' ? v : Number(v);
  }
  str(name: string): string {
    const v = this.get(name);
    return v === null ? '' : String(v);
  }
  has(name: string): boolean {
    const v = this.get(name);
    return v !== null && v !== undefined && !(typeof v === 'number' && Number.isNaN(v));
  }
}

export function range(from: number, to: number): number[] {
  const out: number[] = new Array(Math.max(0, to - from));
  for (let i = 0; i < out.length; i++) out[i] = from + i;
  return out;
}

/** Small deterministic PRNG so `df.sample()` is reproducible across renders. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a frame from plain rows + a header — the shape CSV/JSON parsing produces. */
export function frameFromRows(
  headers: string[],
  rows: Scalar[][],
  name = 'df',
  dtypes?: Record<string, DType>,
): DataFrame {
  const columns: Column[] = headers.map((h, j) => {
    const data: Scalar[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) data[i] = rows[i][j] ?? null;
    return makeColumn(h, data, dtypes?.[h]);
  });
  return new DataFrame(columns, undefined, name);
}

/** Build a frame from objects — the shape JSON parsing produces. */
export function frameFromObjects(objs: Record<string, Scalar>[], name = 'df'): DataFrame {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const o of objs) {
    for (const k of Object.keys(o)) {
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
  }
  const columns: Column[] = headers.map((h) => makeColumn(h, objs.map((o) => o[h] ?? null)));
  return new DataFrame(columns, undefined, name);
}
