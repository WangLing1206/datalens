/**
 * Core value types for the visual pandas engine.
 *
 * Storage model: column-oriented, one plain JS array per column. Datetime
 * columns store epoch milliseconds as numbers (with `dtype: 'datetime'`) so
 * that arithmetic and resampling stay cheap; formatting happens at the view
 * layer. JS arrays of numbers are backed by packed double arrays in V8, which
 * keeps 100k+ row frames responsive without a typed-array null-mask dance.
 */

export type DType = 'int' | 'float' | 'bool' | 'datetime' | 'category' | 'string';

/** A single cell. `null` is the one and only missing-value marker (like NaN/NaT). */
export type Scalar = number | string | boolean | null;

export interface Column {
  name: string;
  dtype: DType;
  /** Always exactly `nRows` long, aligned with `DataFrame.index`. */
  data: Scalar[];
}

export type AggFunc =
  | 'count'
  | 'sum'
  | 'mean'
  | 'median'
  | 'min'
  | 'max'
  | 'std'
  | 'var'
  | 'nunique'
  | 'first'
  | 'last'
  | 'mode';

export const AGG_FUNCS: AggFunc[] = [
  'count',
  'sum',
  'mean',
  'median',
  'min',
  'max',
  'std',
  'var',
  'nunique',
  'first',
  'last',
  'mode',
];

/** Aggregations that only make sense on numeric columns. */
export const NUMERIC_AGG_FUNCS: AggFunc[] = [
  'count',
  'sum',
  'mean',
  'median',
  'min',
  'max',
  'std',
  'var',
  'nunique',
  'first',
  'last',
  'mode',
];

export const NUMERIC_DTYPES: DType[] = ['int', 'float', 'bool'];

export function isNumericDtype(d: DType): boolean {
  return d === 'int' || d === 'float';
}

export function isMissing(v: Scalar): boolean {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}
