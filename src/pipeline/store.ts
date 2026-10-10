import { create } from 'zustand';
import type { DataFrame } from '../core/DataFrame.ts';
import { countMissing, applyOperations, opsKey, OPERATIONS } from './operations.ts';
import type { Operation, OperationSpec, PipelineStep } from './operations.ts';

/**
 * The analysis store.
 *
 * `steps` is the committed pipeline; `viewCount` is the time-travel cursor
 * (null = looking at the latest state). Frames for any prefix are re-derived on
 * demand and memoised, so scrubbing back through history is instant and the
 * memory cost stays flat instead of holding a snapshot per step.
 */

const frameCache = new Map<string, DataFrame>();
const CACHE_LIMIT = 48;

function cacheGet(key: string): DataFrame | undefined {
  return frameCache.get(key);
}

function cacheSet(key: string, df: DataFrame): void {
  if (frameCache.size >= CACHE_LIMIT) {
    const oldest = frameCache.keys().next().value;
    if (oldest !== undefined) frameCache.delete(oldest);
  }
  frameCache.set(key, df);
}

export interface DatasetMeta {
  id: string;
  name: string;
  /** Where it came from: a bundled sample, an uploaded file, or pasted text. */
  sourceKind: 'sample' | 'file' | 'paste';
  sourceLabel: string;
  warnings: string[];
}

export interface PipelineState {
  base: DataFrame | null;
  baseKey: string;
  dataset: DatasetMeta | null;

  steps: PipelineStep[];
  redoStack: PipelineStep[];
  viewCount: number | null;
  lastError: string | null;

  /* actions */
  loadDataset: (df: DataFrame, meta: DatasetMeta) => void;
  /** Replace the pipeline with a recorded one, replaying it against new data. */
  restoreProject: (df: DataFrame, meta: DatasetMeta, ops: Operation[]) => number;
  run: (op: Operation) => void;
  undo: () => void;
  redo: () => void;
  clearPipeline: () => void;
  viewStep: (count: number | null) => void;
  revertTo: (count: number) => void;
  resetData: () => void;
  setError: (msg: string | null) => void;
}

let stepSeq = 0;
function nextId(): string {
  stepSeq += 1;
  return `s${stepSeq}`;
}

function buildStep(op: Operation, before: DataFrame, after: DataFrame, note?: string): PipelineStep {
  return {
    id: nextId(),
    op,
    rowsBefore: before.nRows,
    rowsAfter: after.nRows,
    colsBefore: before.nCols,
    colsAfter: after.nCols,
    missingBefore: countMissing(before),
    missingAfter: countMissing(after),
    ...(note ? { note } : {}),
  };
}

export const usePipeline = create<PipelineState>((set, get) => ({
  base: null,
  baseKey: 'empty',
  dataset: null,
  steps: [],
  redoStack: [],
  viewCount: null,
  lastError: null,

  loadDataset: (df, meta) => {
    frameCache.clear();
    set({
      base: df,
      baseKey: `${meta.id}:${df.nRows}x${df.nCols}`,
      dataset: meta,
      steps: [],
      redoStack: [],
      viewCount: null,
      lastError: null,
    });
  },

  restoreProject: (df, meta, ops) => {
    frameCache.clear();
    const steps: PipelineStep[] = [];
    let current = df;
    for (const op of ops) {
      const spec = OPERATIONS[op.kind] as OperationSpec | undefined;
      if (!spec) break;
      try {
        const result = spec.apply(current, op);
        steps.push(buildStep(op, current, result.df, result.note));
        current = result.df;
      } catch {
        // A step that no longer applies (the data changed) ends the replay but
        // keeps everything that did apply.
        break;
      }
    }
    set({
      base: df,
      baseKey: `${meta.id}:${df.nRows}x${df.nCols}`,
      dataset: meta,
      steps,
      redoStack: [],
      viewCount: null,
      lastError: null,
    });
    return steps.length;
  },

  run: (op) => {
    const { base, steps, viewCount } = get();
    if (!base) return;
    // Running a new operation while scrubbed back forks the pipeline from there.
    const committed = viewCount === null ? steps : steps.slice(0, viewCount);
    const before = resolveFrame(base, committed);
    const spec = OPERATIONS[op.kind] as OperationSpec;
    let after: DataFrame;
    let note: string | undefined;
    try {
      const result = spec.apply(before, op);
      after = result.df;
      note = result.note;
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
      return;
    }
    const step = buildStep(op, before, after, note);
    cacheSet(opsKey(committed.map((s) => s.op)), before);
    set({
      steps: [...committed, step],
      redoStack: [],
      viewCount: null,
      lastError: null,
    });
  },

  undo: () => {
    const { steps } = get();
    if (steps.length === 0) return;
    const last = steps[steps.length - 1];
    set({ steps: steps.slice(0, -1), redoStack: [...get().redoStack, last], viewCount: null });
  },

  redo: () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return;
    const step = redoStack[redoStack.length - 1];
    set({ steps: [...get().steps, step], redoStack: redoStack.slice(0, -1), viewCount: null });
  },

  clearPipeline: () => set({ steps: [], redoStack: [], viewCount: null }),

  viewStep: (count) => set({ viewCount: count }),

  revertTo: (count) => {
    const { steps } = get();
    set({
      steps: steps.slice(0, count),
      redoStack: [],
      viewCount: null,
    });
  },

  resetData: () => set({ steps: [], redoStack: [], viewCount: null, lastError: null }),

  setError: (msg) => set({ lastError: msg }),
}));

/* ------------------------------------------------------------------ *
 * Derived selectors (kept outside the store so components can memoise)
 * ------------------------------------------------------------------ */

/** Derive the frame produced by the first `count` steps of the pipeline. */
export function resolveFrame(base: DataFrame, steps: PipelineStep[]): DataFrame {
  const key = `${base.nRows}x${base.nCols}|${opsKey(steps.map((s) => s.op))}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const { df } = applyOperations(base, steps.map((s) => s.op));
  cacheSet(key, df);
  return df;
}

export interface FrameView {
  /** The frame the user is looking at (respects the time-travel cursor). */
  frame: DataFrame | null;
  /** The latest frame, ignoring the cursor. */
  current: DataFrame | null;
  /** Number of steps currently applied to `frame`. */
  appliedCount: number;
  isViewingHistory: boolean;
  error?: string;
}

export function selectFrame(state: PipelineState): FrameView {
  if (!state.base) {
    return { frame: null, current: null, appliedCount: 0, isViewingHistory: false };
  }
  const applied = state.viewCount === null ? state.steps : state.steps.slice(0, state.viewCount);
  const { df, error } = applyOperations(state.base, applied.map((s) => s.op));
  const isViewingHistory = state.viewCount !== null && state.viewCount < state.steps.length;
  return {
    frame: df,
    current: isViewingHistory ? resolveFrame(state.base, state.steps) : df,
    appliedCount: applied.length,
    isViewingHistory,
    ...(error ? { error } : {}),
  };
}

/** Full pandas script for the committed pipeline, ready to copy. */
export function pipelineToPandas(
  state: PipelineState,
  lang: 'zh' | 'en',
  opts: { includeComments?: boolean } = {},
): string {
  if (!state.dataset) return '';
  const lines: string[] = ['import pandas as pd', 'import numpy as np', ''];
  const meta = state.dataset;
  switch (meta.sourceKind) {
    case 'file':
      if (/\.xlsx?$/i.test(meta.sourceLabel)) {
        lines.push(`df = pd.read_excel("${meta.sourceLabel}")`);
      } else if (/\.json$/i.test(meta.sourceLabel)) {
        lines.push(`df = pd.read_json("${meta.sourceLabel}")`);
      } else {
        lines.push(`df = pd.read_csv("${meta.sourceLabel}")`);
      }
      break;
    case 'paste':
      lines.push('# 数据由粘贴导入 / data was pasted in');
      lines.push('df = pd.read_csv("pasted.csv")');
      break;
    default:
      lines.push(`df = pd.read_csv("datasets/${meta.id}.csv")`);
      break;
  }
  lines.push('');

  const steps = state.viewCount === null ? state.steps : state.steps.slice(0, state.viewCount);
  steps.forEach((step, i) => {
    const spec = OPERATIONS[step.op.kind] as OperationSpec;
    if (opts.includeComments !== false) {
      const label = lang === 'zh' ? '第' : 'step';
      const detail =
        lang === 'zh'
          ? `# ${label} ${i + 1} 步：${spec.summarize(step.op, 'zh')}`
          : `# ${label} ${i + 1}: ${spec.summarize(step.op, 'en')}`;
      lines.push(detail);
    }
    lines.push(...spec.code(step.op, lang));
    lines.push('');
  });

  if (steps.length === 0) {
    lines.push('# 还没有任何操作 / no operations yet');
  }
  return lines.join('\n');
}

export function redoAvailable(state: PipelineState): boolean {
  return state.redoStack.length > 0;
}
