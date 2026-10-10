import type { Column, DType, Scalar } from './types.ts';
import { isMissing } from './types.ts';

/* ------------------------------------------------------------------ *
 * Type inference — mirrors what pandas' read_csv does by default:
 * int64 -> float64 -> bool -> datetime64 -> object.
 * ------------------------------------------------------------------ */

const INT_RE = /^[+-]?\d+$/;
const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const BOOL_TRUE = new Set(['true', 'True', 'TRUE', 'yes', 'Yes', 'YES', 't', 'T', '1']);
const BOOL_FALSE = new Set(['false', 'False', 'FALSE', 'no', 'No', 'NO', 'f', 'F', '0']);

/** `2024-01-15`, `2024/1/5`, optionally with a time part. */
const DATE_RE =
  /^(?:(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}))(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function parseDateString(s: string): number | null {
  const m = DATE_RE.exec(s.trim());
  if (!m) return null;
  let y: number, mo: number, d: number;
  if (m[1] !== undefined) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
  } else {
    // Ambiguous d/m/Y vs m/d/Y: use month-first (matches most exported CSVs
    // and pandas' dayfirst=False default).
    mo = +m[4];
    d = +m[5];
    y = +m[6];
    if (mo > 12 && d <= 12) {
      const t = mo;
      mo = d;
      d = t;
    }
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const hh = m[7] ? +m[7] : 0;
  const mi = m[8] ? +m[8] : 0;
  const ss = m[9] ? +m[9] : 0;
  const t = Date.UTC(y, mo - 1, d, hh, mi, ss);
  const dt = new Date(t);
  // Reject rolled-over dates such as 2024-02-31.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return t;
}

export function looksLikeDate(v: Scalar): boolean {
  return typeof v === 'string' && DATE_RE.test(v.trim());
}

/**
 * Infer the most specific dtype that fits every non-null value.
 *
 * Note this must recognise *numeric-looking strings*, because CSV parsing hands
 * us raw text and inference runs before coercion. Precedence follows pandas'
 * read_csv: integers win over booleans (so a "1"/"0" column is int64, not bool),
 * and four-digit years stay integers rather than becoming dates.
 */
export function inferDtype(data: Scalar[], sampleLimit = 20_000): DType {
  const n = Math.min(data.length, sampleLimit);
  let seenAny = false;
  let allInt = true;
  let allFloat = true;
  let allBool = true;
  let allDate = true;

  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (isMissing(v)) continue;
    seenAny = true;

    if (typeof v === 'number') {
      allBool = false;
      allDate = false;
      if (!Number.isInteger(v)) allInt = false;
      continue;
    }
    if (typeof v === 'boolean') {
      allInt = false;
      allFloat = false;
      allDate = false;
      continue;
    }

    const s = String(v).trim();
    if (INT_RE.test(s)) {
      allBool = false;
      allDate = false;
      continue;
    }
    if (FLOAT_RE.test(s)) {
      allInt = false;
      allBool = false;
      allDate = false;
      continue;
    }
    if (BOOL_TRUE.has(s) || BOOL_FALSE.has(s)) {
      allInt = false;
      allFloat = false;
      allDate = false;
      continue;
    }
    if (DATE_RE.test(s)) {
      allInt = false;
      allFloat = false;
      allBool = false;
      continue;
    }
    allInt = false;
    allFloat = false;
    allBool = false;
    allDate = false;
  }

  if (!seenAny) return 'string';
  if (allBool) return 'bool';
  if (allInt) return 'int';
  if (allFloat) return 'float';
  if (allDate) return 'datetime';
  return 'string';
}

/* ------------------------------------------------------------------ *
 * Casting
 * ------------------------------------------------------------------ */

export interface CastResult {
  data: Scalar[];
  /** 0-based positions that could not be converted (became null). */
  failures: number[];
}

export function toNumber(v: Scalar): number | null {
  if (isMissing(v)) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v).trim().replace(/,/g, '').replace(/%$/, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function toBool(v: Scalar): boolean | null {
  if (isMissing(v)) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim();
  if (BOOL_TRUE.has(s)) return true;
  if (BOOL_FALSE.has(s)) return false;
  return null;
}

export function toDatetime(v: Scalar): number | null {
  if (isMissing(v)) return null;
  if (typeof v === 'number') {
    // Heuristic: treat 1e9..1e13 as epoch seconds/millis.
    if (v > 1e12) return v;
    if (v > 1e9) return v * 1000;
    return null;
  }
  if (typeof v === 'boolean') return null;
  return parseDateString(String(v));
}

export function castValue(v: Scalar, target: DType): Scalar {
  switch (target) {
    case 'int': {
      const n = toNumber(v);
      return n === null ? null : Math.trunc(n);
    }
    case 'float':
      return toNumber(v);
    case 'bool':
      return toBool(v);
    case 'datetime':
      return toDatetime(v);
    case 'string':
    case 'category':
      return v === null ? null : String(v);
    default:
      return v;
  }
}

export function castColumn(col: Column, target: DType): CastResult {
  const out: Scalar[] = new Array(col.data.length);
  const failures: number[] = [];
  for (let i = 0; i < col.data.length; i++) {
    const src = col.data[i];
    const v = castValue(src, target);
    if (v === null && !isMissing(src)) failures.push(i);
    out[i] = v;
  }
  return { data: out, failures };
}

export function makeColumn(name: string, data: Scalar[], dtype?: DType): Column {
  return { name, dtype: dtype ?? inferDtype(data), data };
}

/* ------------------------------------------------------------------ *
 * Display helpers (locale-aware; used by tables and chart axes)
 * ------------------------------------------------------------------ */

export function dtypeLabel(dtype: DType): string {
  switch (dtype) {
    case 'int':
      return 'int64';
    case 'float':
      return 'float64';
    case 'bool':
      return 'bool';
    case 'datetime':
      return 'datetime64';
    case 'category':
      return 'category';
    case 'string':
      return 'object';
  }
}

/** The pandas constructor call users would type to get this dtype. */
export function dtypePandasHint(dtype: DType): string {
  switch (dtype) {
    case 'int':
      return "'int64'";
    case 'float':
      return "'float64'";
    case 'bool':
      return "'bool'";
    case 'datetime':
      return "'datetime64[ns]'";
    case 'category':
      return "'category'";
    case 'string':
      return "'string'";
  }
}
