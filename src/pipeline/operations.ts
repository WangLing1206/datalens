import type { DataFrame } from '../core/DataFrame.ts';
import type { DType, Scalar } from '../core/types.ts';
import { isMissing } from '../core/types.ts';
import {
  binColumn,
  castColumns,
  dropDuplicates,
  dropna,
  evaluateExpression,
  fillna,
  melt,
  normalizeColumn,
  oneHotEncode,
  sortValues,
  applyFilter,
  countFilter,
} from '../core/ops.ts';
import type { FillStrategy, FilterGroup, NormalizeMethod, SortSpec } from '../core/ops.ts';
import { boxStats, mean, numericValues, quantile, sortedAsc } from '../core/stats.ts';
import type { MessageKey } from '../i18n/index.tsx';

/**
 * The operation vocabulary of the analysis pipeline.
 *
 * Every user action that changes the data becomes one of these serialisable
 * records. A record carries everything needed to (a) re-derive the frame,
 * (b) describe itself in the UI, and (c) print the equivalent pandas line.
 * Keeping those three in one place is what lets the pipeline rail and the code
 * mirror stay in sync automatically.
 */

export type OutlierAction = 'drop' | 'clip' | 'median';

export type Operation =
  | { kind: 'filter'; groups: FilterGroup[] }
  | { kind: 'dropna'; how: 'any' | 'all'; thresh?: number; subset?: string[] }
  | { kind: 'fillna'; columns: string[]; strategy: FillStrategy; value?: Scalar }
  | { kind: 'dedupe'; subset?: string[]; keep: 'first' | 'last' | false }
  | { kind: 'cast'; mapping: Record<string, DType> }
  | { kind: 'rename'; mapping: Record<string, string> }
  | { kind: 'dropColumns'; columns: string[] }
  | { kind: 'sort'; specs: SortSpec[]; naPosition: 'first' | 'last' }
  | { kind: 'assign'; name: string; expression: string }
  | { kind: 'bin'; column: string; method: 'equal' | 'quantile'; bins: number; outputName: string }
  | { kind: 'normalize'; column: string; method: NormalizeMethod; outputName: string }
  | { kind: 'onehot'; columns: string[]; dropFirst: boolean; maxCategories: number; separator: string }
  | { kind: 'melt'; idVars: string[]; valueVars: string[] }
  | { kind: 'outlier'; column: string; method: 'iqr' | 'zscore'; action: OutlierAction; threshold: number }
  | { kind: 'head'; n: number }
  | { kind: 'sample'; n: number; seed: number };

export type OperationKind = Operation['kind'];

export interface PipelineStep {
  id: string;
  op: Operation;
  /** Row/column counts before and after, for the delta badges. */
  rowsBefore: number;
  rowsAfter: number;
  colsBefore: number;
  colsAfter: number;
  missingBefore: number;
  missingAfter: number;
  /** Optional extra note, e.g. how many values failed a cast. */
  note?: string;
}

export interface ApplyResult {
  df: DataFrame;
  note?: string;
}

/** A single "label: value" line in a step card. */
export interface ParamLine {
  key: MessageKey;
  value: string;
}

export interface OperationSpec<O extends Operation = Operation> {
  /** i18n key for the operation name. */
  labelKey: MessageKey;
  /** Short one-line summary of what this op does, for tooltips. */
  summarize: (op: O, lang: 'zh' | 'en') => string;
  /** Parameter rows rendered inside the step card. */
  params: (op: O, lang: 'zh' | 'en') => ParamLine[];
  apply: (df: DataFrame, op: O) => ApplyResult;
  /** pandas statements, as an array of lines. */
  code: (op: O, lang: 'zh' | 'en') => string[];
}

const q = (name: string): string => `"${name}"`;
const list = (names: string[]): string => `[${names.map(q).join(', ')}]`;

const FILL_METHOD: Record<FillStrategy, string> = {
  mean: 'mean',
  median: 'median',
  mode: 'mode',
  constant: 'constant',
  ffill: 'ffill',
  bfill: 'bfill',
  zero: 'zero',
  interpolate: 'interpolate',
};

function fmtValue(v: Scalar | undefined): string {
  if (v === undefined || v === null) return 'null';
  if (typeof v === 'string') return v;
  return String(v);
}

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

export const OPERATIONS: { [K in OperationKind]: OperationSpec<Extract<Operation, { kind: K }>> } = {
  filter: {
    labelKey: 'op.filter',
    summarize: (op, lang) => {
      const n = op.groups.reduce((a, g) => a + g.conditions.length, 0);
      return lang === 'zh' ? `${n} 个筛选条件` : `${n} filter condition(s)`;
    },
    params: (op) => [
      {
        key: 'common.filter',
        value: op.groups
          .filter((g) => g.conditions.length)
          .map((g) =>
            g.conditions
              .map((c) => `${c.column} ${c.op} ${c.values ? c.values.join('|') : c.value ?? ''}`.trim())
              .join(` ${g.logic.toUpperCase()} `),
          )
          .join(' | '),
      },
    ],
    apply: (df, op) => ({ df: applyFilter(df, op.groups) }),
    code: (op) => {
      const active = op.groups.filter((g) => g.conditions.length);
      const clause = (g: FilterGroup): string => {
        const parts = g.conditions.map((c) => {
          const col = `df[${q(c.column)}]`;
          const val = typeof c.value === 'string' ? `"${c.value}"` : fmtValue(c.value);
          switch (c.op) {
            case 'contains':
              return `${col}.str.contains("${c.value}", na=False)`;
            case 'not_contains':
              return `~${col}.str.contains("${c.value}", na=False)`;
            case 'starts_with':
              return `${col}.str.startswith("${c.value}", na=False)`;
            case 'ends_with':
              return `${col}.str.endswith("${c.value}", na=False)`;
            case 'is_null':
              return `${col}.isna()`;
            case 'not_null':
              return `${col}.notna()`;
            case 'in':
              return `${col}.isin([${(c.values ?? []).map((v) => (typeof v === 'string' ? `"${v}"` : v)).join(', ')}])`;
            case 'not_in':
              return `~${col}.isin([${(c.values ?? []).map((v) => (typeof v === 'string' ? `"${v}"` : v)).join(', ')}])`;
            case 'between':
              return `${col}.between(${val}, ${fmtValue(c.value2)})`;
            default:
              return `${col} ${c.op} ${val}`;
          }
        });
        return parts.length > 1 ? `(${parts.join(g.logic === 'and' ? ') & (' : ') | (')})` : parts[0];
      };
      const joined = active.map(clause).join(' & ');
      return [`df = df[${active.length > 1 ? `${joined}` : joined}]`];
    },
  },

  dropna: {
    labelKey: 'op.dropna',
    summarize: (op, lang) =>
      op.how === 'any'
        ? lang === 'zh' ? '删除任何含缺失的行' : 'Drop rows with any missing value'
        : lang === 'zh' ? `至少保留 ${op.thresh ?? 1} 个有效值` : `Require at least ${op.thresh ?? 1} values`,
    params: (op) => [
      { key: 'clean.dropHow', value: op.how === 'any' ? 'any' : 'all' },
      ...(op.thresh !== undefined ? [{ key: 'clean.dropThresh', value: String(op.thresh) } as ParamLine] : []),
      ...(op.subset?.length ? [{ key: 'clean.dropSubset', value: op.subset.join(', ') } as ParamLine] : []),
    ],
    apply: (df, op) => ({
      df: dropna(df, {
        how: op.how,
        ...(op.thresh !== undefined ? { thresh: op.thresh } : {}),
        ...(op.subset ? { subset: op.subset } : {}),
      }),
    }),
    code: (op) => {
      const args: string[] = [];
      if (op.subset?.length) args.push(`subset=${list(op.subset)}`);
      if (op.how === 'all') args.push('how="all"');
      if (op.thresh !== undefined) args.push(`thresh=${op.thresh}`);
      return [`df = df.dropna(${args.join(', ')})`];
    },
  },

  fillna: {
    labelKey: 'op.fillna',
    summarize: (op, lang) =>
      lang === 'zh' ? `用 ${op.strategy} 填充 ${op.columns.length} 列` : `Fill ${op.columns.length} column(s) with ${op.strategy}`,
    params: (op) => [
      { key: 'clean.fillStrategy', value: op.strategy },
      { key: 'clean.fillColumns', value: op.columns.join(', ') },
      ...(op.strategy === 'constant' ? [{ key: 'clean.fillValue', value: fmtValue(op.value) } as ParamLine] : []),
    ],
    apply: (df, op) => ({
      df: fillna(df, {
        columns: op.columns,
        strategy: op.strategy,
        ...(op.value !== undefined ? { value: op.value } : {}),
      }),
    }),
    code: (op) => {
      const lines: string[] = [];
      const fillExpr = (col: string): string => {
        switch (op.strategy) {
          case 'mean':
            return `df[${q(col)}].mean()`;
          case 'median':
            return `df[${q(col)}].median()`;
          case 'mode':
            return `df[${q(col)}].mode()[0]`;
          case 'constant':
            return typeof op.value === 'string' ? `"${op.value}"` : fmtValue(op.value);
          case 'zero':
            return '0';
          default:
            return '';
        }
      };
      for (const col of op.columns) {
        if (op.strategy === 'ffill' || op.strategy === 'bfill') {
          lines.push(`df[${q(col)}] = df[${q(col)}].${FILL_METHOD[op.strategy]}()`);
        } else if (op.strategy === 'interpolate') {
          lines.push(`df[${q(col)}] = df[${q(col)}].interpolate()`);
        } else {
          lines.push(`df[${q(col)}] = df[${q(col)}].fillna(${fillExpr(col)})`);
        }
      }
      return lines;
    },
  },

  dedupe: {
    labelKey: 'op.dedupe',
    summarize: (op, lang) =>
      lang === 'zh'
        ? `保留${op.keep === 'first' ? '第一条' : op.keep === 'last' ? '最后一条' : '无'}`
        : `Keep ${op.keep === false ? 'none' : String(op.keep)}`,
    params: (op) => [
      { key: 'clean.dupKeep', value: op.keep === false ? 'none' : op.keep },
      ...(op.subset?.length ? [{ key: 'clean.dupSubset', value: op.subset.join(', ') } as ParamLine] : []),
    ],
    apply: (df, op) => ({ df: dropDuplicates(df, op.subset, op.keep) }),
    code: (op) => {
      const args: string[] = [];
      if (op.subset?.length) args.push(`subset=${list(op.subset)}`);
      args.push(`keep=${op.keep === false ? 'False' : `"${op.keep}"`}`);
      return [`df = df.drop_duplicates(${args.join(', ')})`];
    },
  },

  cast: {
    labelKey: 'op.cast',
    summarize: (op, lang) => {
      const entries = Object.entries(op.mapping);
      return lang === 'zh'
        ? `${entries.length} 列转换类型`
        : `${entries.length} column(s) recast`;
    },
    params: (op) => Object.entries(op.mapping).map(([col, t]) => ({ key: 'dtype.castTo', value: `${col} → ${t}` })),
    apply: (df, op) => {
      const r = castColumns(df, op.mapping);
      const failed = Object.values(r.failures).reduce((a, b) => a + b.length, 0);
      return {
        df: r.df,
        ...(failed > 0 ? { note: `cast-failed:${failed}` } : {}),
      };
    },
    code: (op) => {
      const entries = Object.entries(op.mapping);
      const inner = entries.map(([c, t]) => `${q(c)}: ${dtypeLiteral(t)}`).join(', ');
      return [`df = df.astype({${inner}})`];
    },
  },

  rename: {
    labelKey: 'op.rename',
    summarize: (op, lang) => {
      const entries = Object.entries(op.mapping);
      return lang === 'zh' ? `重命名 ${entries.length} 列` : `Rename ${entries.length} column(s)`;
    },
    params: (op) => Object.entries(op.mapping).map(([a, b]) => ({ key: 'common.rename', value: `${a} → ${b}` })),
    apply: (df, op) => ({ df: df.rename(op.mapping) }),
    code: (op) => {
      const inner = Object.entries(op.mapping)
        .map(([a, b]) => `${q(a)}: ${q(b)}`)
        .join(', ');
      return [`df = df.rename(columns={${inner}})`];
    },
  },

  dropColumns: {
    labelKey: 'op.dropColumns',
    summarize: (op, lang) => (lang === 'zh' ? `删除 ${op.columns.length} 列` : `Drop ${op.columns.length} column(s)`),
    params: (op) => [{ key: 'common.column', value: op.columns.join(', ') }],
    apply: (df, op) => ({ df: df.drop(op.columns) }),
    code: (op) => [`df = df.drop(columns=${list(op.columns)})`],
  },

  sort: {
    labelKey: 'op.sort',
    summarize: (op, lang) =>
      lang === 'zh'
        ? `按 ${op.specs.map((s) => s.column).join(', ')} 排序`
        : `Sort by ${op.specs.map((s) => s.column).join(', ')}`,
    params: (op) => [
      { key: 'common.sort', value: op.specs.map((s) => `${s.column} ${s.ascending ? '↑' : '↓'}`).join(', ') },
    ],
    apply: (df, op) => ({ df: sortValues(df, op.specs, op.naPosition) }),
    code: (op) => {
      const by = op.specs.map((s) => q(s.column)).join(', ');
      const asc = op.specs.map((s) => (s.ascending ? 'True' : 'False')).join(', ');
      return [`df = df.sort_values([${by}], ascending=[${asc}], na_position="${op.naPosition}")`];
    },
  },

  assign: {
    labelKey: 'op.assign',
    summarize: (op) => op.expression,
    params: (op) => [
      { key: 'data.newName', value: op.name },
      { key: 'common.value', value: op.expression },
    ],
    apply: (df, op) => {
      const r = evaluateExpression(df, op.expression);
      if (r.error) throw new Error(r.error);
      return { df: df.withColumn(op.name, r.data) };
    },
    code: (op) => [`df[${q(op.name)}] = df.eval("${op.expression.replace(/"/g, '\\"')}")`],
  },

  bin: {
    labelKey: 'op.bin',
    summarize: (op, lang) =>
      lang === 'zh' ? `${op.column} 等${op.method === 'equal' ? '宽' : '频'}分成 ${op.bins} 箱` : `${op.bins} bins on ${op.column}`,
    params: (op) => [
      { key: 'common.column', value: op.column },
      { key: 'clean.outlierMethod', value: op.method === 'equal' ? 'equal width' : 'quantile' },
      { key: 'describe.bins', value: String(op.bins) },
      { key: 'data.newName', value: op.outputName },
    ],
    apply: (df, op) => ({
      df: binColumn(df, {
        column: op.column,
        method: op.method,
        bins: op.bins,
        outputName: op.outputName,
      }).df,
    }),
    code: (op) => {
      const edges = computeEdgesCode(df => df, op);
      return [
        `df[${q(op.outputName)}] = pd.${op.method === 'equal' ? 'cut' : 'qcut'}(df[${q(op.column)}], bins=${op.bins})`,
        `# 边界 / edges: ${edges}`,
      ];
    },
  },

  normalize: {
    labelKey: 'op.normalize',
    summarize: (op, lang) => (lang === 'zh' ? `${op.column} → ${op.method}` : `${op.column} → ${op.method}`),
    params: (op) => [
      { key: 'common.column', value: op.column },
      { key: 'common.method', value: op.method },
      { key: 'data.newName', value: op.outputName },
    ],
    apply: (df, op) => ({ df: normalizeColumn(df, op.column, op.method, op.outputName) }),
    code: (op) => {
      const c = `df[${q(op.column)}]`;
      const t = `df[${q(op.outputName)}]`;
      switch (op.method) {
        case 'minmax':
          return [`${t} = (${c} - ${c}.min()) / (${c}.max() - ${c}.min())`];
        case 'zscore':
          return [`${t} = (${c} - ${c}.mean()) / ${c}.std()`];
        case 'robust':
          return [`${t} = (${c} - ${c}.median()) / (${c}.quantile(.75) - ${c}.quantile(.25))`];
        case 'log1p':
          return [`${t} = np.log1p(${c})`];
      }
    },
  },

  onehot: {
    labelKey: 'op.onehot',
    summarize: (op, lang) =>
      lang === 'zh' ? `${op.columns.length} 列独热编码` : `One-hot ${op.columns.length} column(s)`,
    params: (op) => [
      { key: 'common.column', value: op.columns.join(', ') },
      { key: 'common.options', value: op.dropFirst ? 'drop_first=True' : 'drop_first=False' },
    ],
    apply: (df, op) => ({
      df: oneHotEncode(df, {
        columns: op.columns,
        dropFirst: op.dropFirst,
        maxCategories: op.maxCategories,
        separator: op.separator,
      }).df,
    }),
    code: (op) => [
      `df = pd.get_dummies(df, columns=${list(op.columns)}, drop_first=${op.dropFirst ? 'True' : 'False'}, dtype=int)`,
    ],
  },

  melt: {
    labelKey: 'op.melt',
    summarize: (op, lang) =>
      lang === 'zh' ? `${op.valueVars.length} 列转为长表` : `Melt ${op.valueVars.length} column(s) to long`,
    params: (op) => [
      { key: 'pivot.rows', value: op.idVars.join(', ') },
      { key: 'pivot.values', value: op.valueVars.join(', ') },
    ],
    apply: (df, op) => ({ df: melt(df, op.idVars, op.valueVars) }),
    code: (op) => [
      `df = df.melt(id_vars=${list(op.idVars)}, value_vars=${list(op.valueVars)}, var_name="variable", value_name="value")`,
    ],
  },

  outlier: {
    labelKey: 'op.outlier',
    summarize: (op, lang) =>
      lang === 'zh'
        ? `${op.column}：${op.action === 'drop' ? '删除' : op.action === 'clip' ? '截断' : '替换中位数'}`
        : `${op.column}: ${op.action}`,
    params: (op) => [
      { key: 'common.column', value: op.column },
      { key: 'clean.outlierMethod', value: op.method },
      { key: 'clean.outlierAction', value: op.action },
    ],
    apply: (df, op) => ({ df: applyOutlierAction(df, op) }),
    code: (op) => {
      const c = `df[${q(op.column)}]`;
      if (op.method === 'iqr') {
        const lines = [
          `q1, q3 = ${c}.quantile(.25), ${c}.quantile(.75)`,
          `iqr = q3 - q1`,
          `lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr`,
        ];
        if (op.action === 'drop') lines.push(`df = df[${c}.between(lo, hi)]`);
        else if (op.action === 'clip') lines.push(`${c} = ${c}.clip(lo, hi)`);
        else lines.push(`df.loc[~${c}.between(lo, hi), ${q(op.column)}] = ${c}.median()`);
        return lines;
      }
      const lines = [
        `mu, sigma = ${c}.mean(), ${c}.std()`,
        `lo, hi = mu - ${op.threshold} * sigma, mu + ${op.threshold} * sigma`,
      ];
      if (op.action === 'drop') lines.push(`df = df[${c}.between(lo, hi)]`);
      else if (op.action === 'clip') lines.push(`${c} = ${c}.clip(lo, hi)`);
      else lines.push(`df.loc[~${c}.between(lo, hi), ${q(op.column)}] = ${c}.median()`);
      return lines;
    },
  },

  head: {
    labelKey: 'op.head',
    summarize: (op, lang) => (lang === 'zh' ? `取前 ${op.n} 行` : `First ${op.n} rows`),
    params: (op) => [{ key: 'common.rows', value: String(op.n) }],
    apply: (df, op) => ({ df: df.head(op.n) }),
    code: (op) => [`df = df.head(${op.n})`],
  },

  sample: {
    labelKey: 'op.sample',
    summarize: (op, lang) => (lang === 'zh' ? `随机抽取 ${op.n} 行` : `Sample ${op.n} rows`),
    params: (op) => [
      { key: 'common.rows', value: String(op.n) },
      { key: 'common.options', value: `random_state=${op.seed}` },
    ],
    apply: (df, op) => ({ df: df.sample(op.n, op.seed) }),
    code: (op) => [`df = df.sample(n=${op.n}, random_state=${op.seed})`],
  },
};

function dtypeLiteral(t: DType): string {
  switch (t) {
    case 'int':
      return '"int64"';
    case 'float':
      return '"float64"';
    case 'bool':
      return '"bool"';
    case 'datetime':
      return '"datetime64[ns]"';
    case 'category':
      return '"category"';
    case 'string':
      return '"string"';
  }
}

/** Only used for the explanatory comment on a bin step. */
function computeEdgesCode(_get: (df: unknown) => unknown, op: Extract<Operation, { kind: 'bin' }>): string {
  void _get;
  return op.method === 'equal' ? 'equal width' : 'equal frequency';
}

/* ------------------------------------------------------------------ *
 * Outlier handling (drop / clip / replace-with-median)
 * ------------------------------------------------------------------ */

export function applyOutlierAction(df: DataFrame, op: Extract<Operation, { kind: 'outlier' }>): DataFrame {
  const col = df.require(op.column);
  const nums = numericValues(col.data);
  if (nums.length === 0) return df;
  const sorted = sortedAsc(nums);

  let lo: number;
  let hi: number;
  if (op.method === 'iqr') {
    const b = boxStats(nums);
    lo = b.q1 - 1.5 * b.iqr;
    hi = b.q3 + 1.5 * b.iqr;
  } else {
    const m = mean(nums);
    const s = Math.sqrt(nums.reduce((a, v) => a + (v - m) ** 2, 0) / Math.max(1, nums.length - 1));
    lo = m - op.threshold * s;
    hi = m + op.threshold * s;
  }

  const med = quantile(sorted, 0.5);

  if (op.action === 'drop') {
    const keep: number[] = [];
    for (let i = 0; i < df.nRows; i++) {
      const v = col.data[i];
      if (isMissing(v)) {
        // pandas' between() drops NaN, but silently losing those rows would be
        // surprising here — keep them and only remove true outliers.
        keep.push(i);
        continue;
      }
      const n = Number(v);
      if (n >= lo && n <= hi) keep.push(i);
    }
    return df.take(keep);
  }

  const data: Scalar[] = col.data.map((v) => {
    if (isMissing(v)) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || (n >= lo && n <= hi)) return v;
    return op.action === 'clip' ? Math.min(Math.max(n, lo), hi) : med;
  });
  return df.replaceColumn(op.column, data, col.dtype);
}

/* ------------------------------------------------------------------ *
 * Applying a whole pipeline
 * ------------------------------------------------------------------ */

export interface AppliedPipeline {
  df: DataFrame;
  error?: string;
}

export function applyOperations(base: DataFrame, ops: Operation[]): AppliedPipeline {
  let df = base;
  for (const op of ops) {
    try {
      df = (OPERATIONS[op.kind] as OperationSpec).apply(df, op).df;
    } catch (e) {
      return { df, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { df };
}

/** Stable cache key for a prefix of the pipeline. */
export function opsKey(ops: Operation[]): string {
  return ops.length === 0 ? 'base' : `${ops.length}:${JSON.stringify(ops)}`;
}

export function countMissing(df: DataFrame): number {
  let n = 0;
  for (const c of df.columns) for (const v of c.data) if (isMissing(v)) n++;
  return n;
}

export function stepDelta(step: PipelineStep): { rows: number; cols: number; missing: number } {
  return {
    rows: step.rowsAfter - step.rowsBefore,
    cols: step.colsAfter - step.colsBefore,
    missing: step.missingAfter - step.missingBefore,
  };
}

export { countFilter };
