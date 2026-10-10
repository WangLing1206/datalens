import type { DType, Scalar } from './types.ts';
import { DataFrame, frameFromObjects, frameFromRows } from './DataFrame.ts';
import { inferDtype, parseDateString, toBool } from './dtype.ts';

/* ------------------------------------------------------------------ *
 * Delimited-text parsing (RFC 4180)
 *
 * Hand-rolled rather than pulled from a parser library: we need the raw
 * string cells before type inference so that leading zeros, thousands
 * separators and date-like text are handled the same way pandas' read_csv
 * handles them (i.e. per column, consistently).
 * ------------------------------------------------------------------ */

const CANDIDATE_DELIMITERS = [',', '\t', ';', '|', ':'];

export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 64 * 1024);
  const lines = sample.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 20);
  if (lines.length === 0) return ',';
  let best = ',';
  let bestScore = -Infinity;
  for (const d of CANDIDATE_DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const first = counts[0];
    if (first <= 0) continue;
    // A good delimiter appears the same number of times on every line.
    const consistent = counts.filter((c) => c === first).length / counts.length;
    const score = consistent * 10 + Math.min(first, 20) - (first > 60 ? 30 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delim: string): number {
  let n = 0;
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') i++;
      else inQ = !inQ;
    } else if (ch === delim && !inQ) n++;
  }
  return n;
}

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
  /** True when rows had to be padded/truncated to the header width. */
  ragged: boolean;
}

/**
 * Parse delimited text into raw string cells. Handles quoted fields,
 * embedded delimiters and newlines, doubled quotes, CRLF, and a UTF-8 BOM.
 */
export function parseDelimited(
  input: string,
  opts: { delimiter?: string; hasHeader?: boolean; maxRows?: number } = {},
): ParsedTable {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const hasHeader = opts.hasHeader ?? true;
  const maxRows = opts.maxRows ?? Infinity;

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let fieldWasQuoted = false;

  const pushField = () => {
    row.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };
  const pushRow = () => {
    pushField();
    // Skip lines that are entirely empty (common trailing newline).
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      fieldWasQuoted = true;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      continue;
    }
    if (ch === '\n') {
      pushRow();
      if (rows.length >= maxRows + (hasHeader ? 1 : 0)) break;
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      pushRow();
      if (rows.length >= maxRows + (hasHeader ? 1 : 0)) break;
      continue;
    }
    field += ch;
  }
  if (field !== '' || row.length > 0) pushRow();

  let headers: string[];
  let body: string[][];
  if (hasHeader && rows.length > 0) {
    headers = dedupeHeaders(rows[0]);
    body = rows.slice(1);
  } else {
    headers = rows.length ? rows[0].map((_, i) => `col_${i}`) : [];
    body = rows;
  }

  // Normalise ragged rows to the header width (pandas raises, but for an
  // interactive tool padding with empty is the friendlier behaviour; we
  // surface a warning in the UI).
  let ragged = false;
  const width = headers.length;
  const normalised = body.map((r) => {
    if (r.length === width) return r;
    ragged = true;
    if (r.length < width) return [...r, ...new Array(width - r.length).fill('')];
    return r.slice(0, width);
  });

  return { headers, rows: normalised, delimiter, ragged };
}

function dedupeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = (h ?? '').trim();
    if (name === '') name = `Unnamed: ${i}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return n === 0 ? name : `${name}.${n}`;
  });
}

/**
 * Coerce a raw string cell to the value pandas would produce.
 * `''` and pandas' default NA tokens become null.
 */
const NA_TOKENS = new Set(['', 'NA', 'N/A', 'na', 'n/a', 'NaN', 'nan', 'NULL', 'null', 'None', '-', '--', '?']);

export function coerceCell(raw: string, dtype: DType): Scalar {
  if (raw === undefined || raw === null) return null;
  const s = raw;
  if (NA_TOKENS.has(s)) return null;
  switch (dtype) {
    case 'int': {
      const n = Number(s);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case 'float': {
      const n = Number(s.replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    case 'bool':
      // Must accept exactly the tokens `inferDtype` treats as boolean. If the
      // two disagree, a "yes"/"no" column infers as bool and then coerces to
      // all-null — silently destroying the column.
      return toBool(s);
    case 'datetime': {
      const t = parseDateString(s);
      return t;
    }
    default:
      return s;
  }
}

export interface ParseOptions {
  delimiter?: string;
  hasHeader?: boolean;
  /** Force specific columns to a dtype; otherwise inferred. */
  dtypes?: Record<string, DType>;
  name?: string;
  maxRows?: number;
}

export function parseCSV(text: string, opts: ParseOptions = {}): DataFrame {
  const table = parseDelimited(text, {
    ...(opts.delimiter !== undefined ? { delimiter: opts.delimiter } : {}),
    ...(opts.hasHeader !== undefined ? { hasHeader: opts.hasHeader } : {}),
    ...(opts.maxRows !== undefined ? { maxRows: opts.maxRows } : {}),
  });
  return tableToFrame(table, opts);
}

export function tableToFrame(table: ParsedTable, opts: ParseOptions = {}): DataFrame {
  const { headers, rows } = table;
  // Infer per column from the raw strings, then coerce once.
  const dtypes: DType[] = headers.map((h, j) => {
    if (opts.dtypes?.[h]) return opts.dtypes[h];
    const col: Scalar[] = new Array(Math.min(rows.length, 2000));
    for (let i = 0; i < col.length; i++) {
      const raw = rows[i][j];
      col[i] = raw === undefined || NA_TOKENS.has(raw) ? null : raw;
    }
    return inferDtype(col);
  });

  const out: Scalar[][] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r: Scalar[] = new Array(headers.length);
    for (let j = 0; j < headers.length; j++) r[j] = coerceCell(rows[i][j], dtypes[j]);
    out[i] = r;
  }

  // Pin the dtypes we just decided. Re-inferring here would be wrong: a
  // datetime column has already become epoch milliseconds, which re-infers as
  // a plain integer column.
  const resolved: Record<string, DType> = { ...(opts.dtypes ?? {}) };
  headers.forEach((h, j) => {
    if (resolved[h] === undefined) resolved[h] = dtypes[j];
  });
  return frameFromRows(headers, out, opts.name ?? 'df', resolved);
}

/* ------------------------------------------------------------------ *
 * JSON
 * ------------------------------------------------------------------ */

export function parseJSON(text: string, name = 'df'): DataFrame {
  const data = JSON.parse(text);
  return frameFromJSONValue(data, name);
}

export function frameFromJSONValue(data: unknown, name = 'df'): DataFrame {
  if (Array.isArray(data)) {
    if (data.length === 0) return new DataFrame([]);
    // Array of objects -> records orientation.
    if (typeof data[0] === 'object' && data[0] !== null && !Array.isArray(data[0])) {
      const objs = data as Record<string, unknown>[];
      const keys: string[] = [];
      const seen = new Set<string>();
      for (const o of objs) for (const k of Object.keys(o)) if (!seen.has(k)) (seen.add(k), keys.push(k));
      return frameFromObjects(
        objs.map((o) => {
          const r: Record<string, Scalar> = {};
          for (const k of keys) r[k] = normaliseJSONScalar(o[k]);
          return r;
        }),
        name,
      );
    }
    // Array of arrays -> split orientation (pandas' default).
    if (Array.isArray(data[0])) {
      const arr = data as unknown[][];
      const headers = arr[0].map((h, i) => String(h ?? `col_${i}`));
      const rows = arr.slice(1).map((r) => headers.map((_, j) => normaliseJSONScalar(r[j])));
      return frameFromRows(headers, rows, name);
    }
    // Array of primitives -> single unnamed column.
    return frameFromRows(['value'], (data as unknown[]).map((v) => [normaliseJSONScalar(v)]), name);
  }

  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    // pandas `orient='split'`
    if (Array.isArray(obj.columns) && Array.isArray(obj.data)) {
      const headers = (obj.columns as unknown[]).map(String);
      const rows = (obj.data as unknown[][]).map((r) => headers.map((_, j) => normaliseJSONScalar(r[j])));
      return frameFromRows(headers, rows, name);
    }
    // pandas `orient='records'`
    if (Array.isArray(obj.records)) return frameFromJSONValue(obj.records, name);
    // Plain object of columns
    const keys = Object.keys(obj);
    if (keys.length && keys.every((k) => Array.isArray(obj[k]))) {
      const len = Math.max(...keys.map((k) => (obj[k] as unknown[]).length));
      const rows: Scalar[][] = new Array(len);
      for (let i = 0; i < len; i++) {
        rows[i] = keys.map((k) => normaliseJSONScalar((obj[k] as unknown[])[i]));
      }
      return frameFromRows(keys, rows, name);
    }
    // Single record -> one-row frame
    return frameFromRows(
      keys,
      [keys.map((k) => normaliseJSONScalar(obj[k]))],
      name,
    );
  }

  throw new Error('Unsupported JSON shape: expected an array of objects, an array of arrays, or an object of columns.');
}

function normaliseJSONScalar(v: unknown): Scalar {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean' || typeof v === 'string') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/* ------------------------------------------------------------------ *
 * Excel — the xlsx library is imported lazily so it stays out of the
 * initial bundle and only loads when a workbook is actually opened.
 * ------------------------------------------------------------------ */

export async function parseWorkbook(buffer: ArrayBuffer, opts: ParseOptions = {}): Promise<DataFrame> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true, dense: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('The workbook contains no sheets.');
  const sheet = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
  if (aoa.length === 0) throw new Error('The first sheet is empty.');

  const headerRow = aoa[0] as unknown[];
  const headers = dedupeHeaders(headerRow.map((h) => (h === null || h === undefined ? '' : String(h))));
  const body = aoa.slice(1) as unknown[][];

  // Excel cells arrive already typed, so infer from the real values rather than
  // from text — and carry an explicit dtype for anything the sheet marked as a
  // date, since those become epoch numbers and would otherwise re-infer as ints.
  const dtypes: Record<string, DType> = { ...(opts.dtypes ?? {}) };
  const rows: Scalar[][] = new Array(body.length);
  for (let i = 0; i < body.length; i++) {
    const r: Scalar[] = new Array(headers.length);
    for (let j = 0; j < headers.length; j++) {
      const v = body[i][j];
      if (v instanceof Date) {
        r[j] = v.getTime();
        if (dtypes[headers[j]] === undefined) dtypes[headers[j]] = 'datetime';
      } else {
        r[j] = normaliseJSONScalar(v);
      }
    }
    rows[i] = r;
  }
  return frameFromRows(headers, rows, opts.name ?? sheetName, dtypes);
}

export async function parseExcelFile(file: File): Promise<DataFrame> {
  const buf = await file.arrayBuffer();
  return parseWorkbook(buf, { name: file.name.replace(/\.[^.]+$/, '') });
}

/* ------------------------------------------------------------------ *
 * File dispatch
 * ------------------------------------------------------------------ */

export interface LoadedDataset {
  df: DataFrame;
  /** Non-fatal problems worth telling the user about. */
  warnings: string[];
}

export async function loadFile(file: File): Promise<LoadedDataset> {
  const name = file.name.replace(/\.[^.]+$/, '');
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const warnings: string[] = [];

  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm' || ext === 'ods') {
    return { df: await parseWorkbook(await file.arrayBuffer(), { name }), warnings };
  }

  const text = await readTextSmart(file);
  if (ext === 'json' || ext === 'jsonl' || ext === 'ndjson') {
    if (ext === 'jsonl' || ext === 'ndjson') {
      const objs = text
        .split(/\r?\n/)
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as Record<string, Scalar>);
      return { df: frameFromObjects(objs, name), warnings };
    }
    return { df: parseJSON(text, name), warnings };
  }

  const table = parseDelimited(text, {});
  if (table.ragged) {
    warnings.push('ragged-rows');
  }
  return { df: tableToFrame(table, { name }), warnings };
}

/** Read as UTF-8, falling back to GBK for Chinese CSVs exported from Excel. */
async function readTextSmart(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);

  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // U+FFFD density is a reliable tell that the bytes were not UTF-8.
  const bad = (utf8.match(/\uFFFD/g) ?? []).length;
  if (bad > 0 && bad / Math.max(1, utf8.length) > 0.002) {
    for (const enc of ['gbk', 'gb18030', 'big5', 'windows-1252']) {
      try {
        const alt = new TextDecoder(enc, { fatal: true }).decode(buf);
        return alt;
      } catch {
        /* try the next candidate */
      }
    }
  }
  return utf8;
}

export async function fetchDataset(url: string, name?: string): Promise<LoadedDataset> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const table = parseDelimited(text, {});
  const warnings: string[] = [];
  if (table.ragged) warnings.push('ragged-rows');
  return { df: tableToFrame(table, { name: name ?? url.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'df' }), warnings };
}
