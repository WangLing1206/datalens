import type { DataFrame } from '../core/DataFrame.ts';
import type { Operation } from '../pipeline/operations.ts';
import { OPERATIONS } from '../pipeline/operations.ts';
import { usePipeline } from '../pipeline/store.ts';
import type { DatasetMeta } from '../pipeline/store.ts';
import { SAMPLE_DATASETS, loadSample } from './datasets.ts';
import { clearProfileCache } from './hooks.ts';

/**
 * Analysis project files (`.daproj.json`).
 *
 * A project records the dataset identity plus the ordered list of operations, so
 * an analysis can be shared, re-run and audited without the data ever leaving
 * the machine that produced it.
 */

export interface ProjectFile {
  version: number;
  dataset: DatasetMeta | null;
  ops: Operation[];
}

export type ImportFailure = 'notProject' | 'needDataset' | 'empty' | 'readFailed';

export interface ImportResult {
  ok: boolean;
  /** Steps replayed. */
  applied?: number;
  /** Steps the file declared. */
  total?: number;
  /** Dataset the project expects, when the user has to load it first. */
  datasetName?: string;
  reason?: ImportFailure;
}

/** Recognise a project payload; returns null for anything else. */
export function parseProjectPayload(text: string): ProjectFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = parsed as Partial<ProjectFile>;
  if (!Array.isArray(p.ops)) return null;
  if (p.version !== undefined && typeof p.version !== 'number') return null;
  // Guard against arbitrary JSON arrays being mistaken for a project.
  if (p.ops.length > 0 && !p.ops.every((o) => typeof o === 'object' && o !== null && typeof (o as Operation).kind === 'string')) {
    return null;
  }
  return {
    version: typeof p.version === 'number' ? p.version : 1,
    dataset: (p.dataset as DatasetMeta) ?? null,
    ops: p.ops as Operation[],
  };
}

export function isProjectFilename(name: string): boolean {
  return /\.daproj\.json$/i.test(name);
}

/**
 * Restore a project. Bundled sample datasets are re-fetched so the pipeline can
 * be replayed from scratch; uploaded or pasted data only exists in the session
 * that created it, so those projects require the user to load the same data
 * first (the returned `datasetName` is what to ask for).
 */
export async function importProject(text: string): Promise<ImportResult> {
  const project = parseProjectPayload(text);
  if (!project) return { ok: false, reason: 'notProject' };
  if (project.ops.length === 0) return { ok: false, reason: 'empty' };

  const pipeline = usePipeline.getState();
  const wanted = project.dataset;
  let df: DataFrame | null = null;
  let meta: DatasetMeta | null = null;

  const sample = wanted ? SAMPLE_DATASETS.find((s) => s.id === wanted.id) : undefined;
  if (sample) {
    try {
      const loaded = await loadSample(sample.id);
      df = loaded.df;
      meta = wanted ?? loaded.meta;
    } catch {
      return { ok: false, reason: 'readFailed' };
    }
  } else if (wanted && pipeline.dataset && pipeline.base && pipeline.dataset.id === wanted.id) {
    // Same file/paste dataset already loaded — replay onto it.
    df = pipeline.base;
    meta = pipeline.dataset;
  } else {
    return { ok: false, reason: 'needDataset', datasetName: wanted?.name ?? wanted?.id ?? '?' };
  }

  const applied = pipeline.restoreProject(df, meta as DatasetMeta, project.ops);
  clearProfileCache();
  return { ok: applied > 0 || project.ops.length === 0, applied, total: project.ops.length, datasetName: (meta as DatasetMeta).name };
}

/** True when every operation in the file is one this build understands. */
export function projectionKnowsAll(project: ProjectFile): boolean {
  return project.ops.every((o) => Boolean(OPERATIONS[o.kind]));
}
