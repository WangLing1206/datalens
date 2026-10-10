import { useEffect, useMemo, useState } from 'react';
import type { DataFrame } from '../core/DataFrame.ts';
import { profileFrame } from '../core/profile.ts';
import type { FrameProfile } from '../core/profile.ts';
import { generateInsights } from '../core/insights.ts';
import type { Insight, InsightCategory } from '../core/insights.ts';
import type { FrameView } from '../pipeline/store.ts';
import type { PipelineStep } from '../pipeline/operations.ts';
import { applyOperations } from '../pipeline/operations.ts';
import { usePipeline } from '../pipeline/store.ts';
import { useI18n } from '../i18n/index.tsx';

/** Pure derivation of the visible frame — safe to call outside a selector. */
function computeFrameView(
  base: DataFrame | null,
  steps: PipelineStep[],
  viewCount: number | null,
): FrameView {
  if (!base) return { frame: null, current: null, appliedCount: 0, isViewingHistory: false };
  const applied = viewCount === null ? steps : steps.slice(0, viewCount);
  const { df, error } = applyOperations(base, applied.map((s) => s.op));
  const isViewingHistory = viewCount !== null && viewCount < steps.length;
  return {
    frame: df,
    current: isViewingHistory ? applyOperations(base, steps.map((s) => s.op)).df : df,
    appliedCount: applied.length,
    isViewingHistory,
    ...(error ? { error } : {}),
  };
}

/**
 * Derived-data hooks.
 *
 * Profiling a 100k-row frame is the single most expensive thing the UI does, so
 * results are memoised by a frame fingerprint: switching views or toggling a
 * panel never recomputes the same profile twice.
 */

const profileCache = new Map<string, FrameProfile>();
const PROFILE_CACHE_LIMIT = 12;

export function getProfile(df: DataFrame): FrameProfile {
  const key = `${df.fingerprint()}|${df.nRows}x${df.nCols}`;
  const hit = profileCache.get(key);
  if (hit) return hit;
  const p = profileFrame(df);
  if (profileCache.size >= PROFILE_CACHE_LIMIT) {
    const oldest = profileCache.keys().next().value;
    if (oldest !== undefined) profileCache.delete(oldest);
  }
  profileCache.set(key, p);
  return p;
}

export function clearProfileCache(): void {
  profileCache.clear();
}

/** The frame the user is looking at, honouring the time-travel cursor. */
export function useFrame(): FrameView {
  // Select the raw, reference-stable pieces of state and derive the view here.
  // Returning a freshly-built object straight out of a zustand selector makes
  // every render look like a state change, which loops forever.
  const base = usePipeline((s) => s.base);
  const steps = usePipeline((s) => s.steps);
  const viewCount = usePipeline((s) => s.viewCount);
  return useMemo(() => computeFrameView(base, steps, viewCount), [base, steps, viewCount]);
}

export function useCurrentFrame(): DataFrame | null {
  return useFrame().current;
}

export function useProfile(df: DataFrame | null): FrameProfile | null {
  return useMemo(() => (df ? getProfile(df) : null), [df]);
}

export interface UseInsightsOptions {
  categories?: InsightCategory[];
  maxRowsForScan?: number;
}

export function useInsights(df: DataFrame | null, profile: FrameProfile | null, opts: UseInsightsOptions = {}): Insight[] {
  const { lang } = useI18n();
  const cats = opts.categories?.join(',') ?? '';
  return useMemo(() => {
    if (!df || !profile) return [];
    return generateInsights(df, profile, lang, {
      ...(opts.categories ? { categories: opts.categories } : {}),
      ...(opts.maxRowsForScan !== undefined ? { maxRowsForScan: opts.maxRowsForScan } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [df, profile, lang, cats, opts.maxRowsForScan]);
}

/** Column lists by role, memoised per frame. */
export function useColumns(df: DataFrame | null) {
  return useMemo(() => {
    if (!df) {
      return { numeric: [] as string[], categorical: [] as string[], datetime: [] as string[], all: [] as string[] };
    }
    return {
      numeric: df.numericColumnNames(),
      categorical: df.categoricalColumns().map((c) => c.name),
      datetime: df.datetimeColumns().map((c) => c.name),
      all: df.columnNames,
    };
  }, [df]);
}

/**
 * Debounce a value — used by search boxes and slider-driven recomputation so a
 * drag does not kick off a heavy group-by on every frame.
 */
export function useDeferred<T>(value: T, delay = 180): T {
  const [state, setState] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setState(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return state;
}
