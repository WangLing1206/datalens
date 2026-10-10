import { create } from 'zustand';
import type { ViewId } from '../core/insights.ts';
import type { FilterGroup } from '../core/ops.ts';

/**
 * UI state that is deliberately kept out of the data pipeline store, so that
 * opening a panel or switching a tab never invalidates a derived frame.
 */

export type ThemeMode = 'dark' | 'light';

export interface SavedChart {
  id: string;
  title: string;
  view: ViewId;
  /** Serialised chart configuration, replayed by the Chart studio on restore. */
  config: Record<string, unknown>;
  /** Pre-rendered SVG, inlined into the exported report. */
  svg?: string;
  addedAt: number;
}

export interface UIState {
  view: ViewId;
  theme: ThemeMode;
  pipelineOpen: boolean;
  commandOpen: boolean;
  shortcutsOpen: boolean;
  tourOpen: boolean;
  loadPanelOpen: boolean;
  /** Params a view should adopt on mount, set by an insight deep link. */
  viewParams: Record<string, unknown> | null;
  savedCharts: SavedChart[];
  /** Persistent filter builder state, owned by the Data table view. */
  filters: FilterGroup[];

  setView: (v: ViewId, params?: Record<string, unknown>) => void;
  consumeViewParams: () => Record<string, unknown> | null;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
  togglePipeline: () => void;
  setPipelineOpen: (v: boolean) => void;
  setCommandOpen: (v: boolean) => void;
  setShortcutsOpen: (v: boolean) => void;
  setTourOpen: (v: boolean) => void;
  setLoadPanelOpen: (v: boolean) => void;
  addChart: (chart: Omit<SavedChart, 'id' | 'addedAt'>) => void;
  removeChart: (id: string) => void;
  clearCharts: () => void;
  setFilters: (f: FilterGroup[]) => void;
}

const THEME_KEY = 'datalens.theme';
const TOUR_KEY = 'datalens.tourSeen';

/** View ids, in sidebar order — also the set of valid URL hashes. */
export const VIEW_ORDER: ViewId[] = [
  'overview',
  'data',
  'clean',
  'describe',
  'groupby',
  'pivot',
  'correlate',
  'timeseries',
  'studio',
  'advanced',
  'report',
];

/**
 * The view named by the URL hash (`#/groupby`), so a view can be linked to and
 * the browser's back/forward buttons move between views.
 */
export function readHashView(): ViewId | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  return (VIEW_ORDER as string[]).includes(raw) ? (raw as ViewId) : null;
}

function readTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    return window.localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function tourSeen(): boolean {
  try {
    return window.localStorage.getItem(TOUR_KEY) === '1';
  } catch {
    return false;
  }
}

let chartSeq = 0;

export const useUI = create<UIState>((set, get) => ({
  view: readHashView() ?? 'overview',
  theme: readTheme(),
  pipelineOpen: true,
  commandOpen: false,
  shortcutsOpen: false,
  tourOpen: !tourSeen(),
  loadPanelOpen: false,
  viewParams: null,
  savedCharts: [],
  filters: [],

  setView: (v, params) => {
    set({ view: v, viewParams: params ?? null });
    // Mirror the view into the URL so links are shareable and back/forward
    // move between views. pushState (not location.hash) keeps this from firing
    // an extra hashchange for a change we already applied.
    if (typeof window !== 'undefined') {
      const target = `#/${v}`;
      if (window.location.hash !== target) window.history.pushState(null, '', target);
    }
  },
  consumeViewParams: () => {
    const p = get().viewParams;
    if (p) set({ viewParams: null });
    return p;
  },

  setTheme: (t) => {
    set({ theme: t });
    document.documentElement.classList.toggle('dark', t === 'dark');
    try {
      window.localStorage.setItem(THEME_KEY, t);
    } catch {
      /* ignore */
    }
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),

  togglePipeline: () => set({ pipelineOpen: !get().pipelineOpen }),
  setPipelineOpen: (v) => set({ pipelineOpen: v }),
  setCommandOpen: (v) => set({ commandOpen: v }),
  setShortcutsOpen: (v) => set({ shortcutsOpen: v }),
  setTourOpen: (v) => {
    set({ tourOpen: v });
    if (!v) {
      try {
        window.localStorage.setItem(TOUR_KEY, '1');
      } catch {
        /* ignore */
      }
    }
  },
  setLoadPanelOpen: (v) => set({ loadPanelOpen: v }),

  addChart: (chart) => {
    chartSeq += 1;
    set({ savedCharts: [...get().savedCharts, { ...chart, id: `c${chartSeq}`, addedAt: Date.now() }] });
  },
  removeChart: (id) => set({ savedCharts: get().savedCharts.filter((c) => c.id !== id) }),
  clearCharts: () => set({ savedCharts: [] }),

  setFilters: (f) => set({ filters: f }),
}));
