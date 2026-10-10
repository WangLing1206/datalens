import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { useI18n } from './i18n/index.tsx';
import { readHashView, useUI, VIEW_ORDER } from './app/store.ts';
import { usePipeline } from './pipeline/store.ts';
import { DEFAULT_DATASET_ID, loadSample } from './app/datasets.ts';
import { clearProfileCache, useFrame } from './app/hooks.ts';
import { BootScreen, Sidebar, TopBar, WelcomeTour } from './components/layout/Shell.tsx';
import { PipelineRail } from './components/layout/PipelineRail.tsx';
import { CommandPalette, ShortcutsDialog } from './components/layout/CommandPalette.tsx';
import { InlineDropZone, LoadPanel } from './components/layout/LoadPanel.tsx';
import { Button, EmptyState, cx } from './components/ui/index.tsx';
import { Icon } from './components/ui/Icon.tsx';

import { OverviewView } from './views/OverviewView.tsx';
import { DataView } from './views/DataView.tsx';
import { CleanView } from './views/CleanView.tsx';
import { DescribeView } from './views/DescribeView.tsx';
import { GroupByView } from './views/GroupByView.tsx';
import { PivotView } from './views/PivotView.tsx';
import { CorrelateView } from './views/CorrelateView.tsx';
import { TimeSeriesView } from './views/TimeSeriesView.tsx';
import { StudioView } from './views/StudioView.tsx';
import { AdvancedView } from './views/AdvancedView.tsx';
import { ReportView } from './views/ReportView.tsx';

/* ------------------------------------------------------------------ *
 * Error boundary — keeps a render crash from losing the user's analysis
 * ------------------------------------------------------------------ */

class Boundary extends Component<{ children: ReactNode; title: string; hint: string; reload: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surfaced in the console for debugging; the user sees a friendly panel.
    console.error('Render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-[420px] text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-xl bg-bad-soft text-bad">
            <Icon name="alert" size={20} />
          </span>
          <p className="mt-3 text-[14px] font-semibold text-ink">{this.props.title}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{this.props.hint}</p>
          <pre className="scroll-thin mt-3 max-h-32 overflow-auto rounded-lg border border-line bg-surface-2 p-2 text-left font-mono text-[11px] text-ink-muted">
            {this.state.error.message}
          </pre>
          <Button className="mt-3" variant="primary" icon="refresh" onClick={() => window.location.reload()}>
            {this.props.reload}
          </Button>
        </div>
      </div>
    );
  }
}

/* ------------------------------------------------------------------ *
 * Global keyboard shortcuts
 * ------------------------------------------------------------------ */

function useShortcuts() {
  // Browser back/forward (and hand-edited hashes) move between views, the same
  // way an in-app navigation does.
  useEffect(() => {
    const sync = () => {
      const v = readHashView() ?? 'overview';
      if (useUI.getState().view !== v) useUI.setState({ view: v, viewParams: null });
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable || target.tagName === 'SELECT');
      const ui = useUI.getState();
      const pipeline = usePipeline.getState();

      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setCommandOpen(true);
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) pipeline.redo();
        else pipeline.undo();
        return;
      }
      if (typing) return;

      switch (e.key) {
        case '?':
          e.preventDefault();
          ui.setShortcutsOpen(true);
          break;
        case 'p':
        case 'P':
          ui.togglePipeline();
          break;
        case 'd':
        case 'D':
          ui.toggleTheme();
          break;
        case 'l':
        case 'L':
          window.dispatchEvent(new CustomEvent('datalens:toggle-lang'));
          break;
        case '[': {
          const i = VIEW_ORDER.indexOf(ui.view);
          ui.setView(VIEW_ORDER[(i - 1 + VIEW_ORDER.length) % VIEW_ORDER.length]);
          break;
        }
        case ']': {
          const i = VIEW_ORDER.indexOf(ui.view);
          ui.setView(VIEW_ORDER[(i + 1) % VIEW_ORDER.length]);
          break;
        }
        default:
          break;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

/* ------------------------------------------------------------------ *
 * View router
 * ------------------------------------------------------------------ */

function CurrentView() {
  const view = useUI((s) => s.view);
  const { t } = useI18n();
  const frame = useFrame();
  // Column selections are per-view component state. When the dataset changes,
  // those names may no longer exist (Titanic's "Age" is not in the sales data),
  // so remount the view to reset it. Keying on the dataset id is the simplest
  // correct fix and covers every view at once.
  const datasetKey = usePipeline((s) => s.dataset?.id ?? 'none');

  if (!frame.frame) {
    return (
      <div className="p-6">
        <EmptyState icon="database" title={t('common.noData')} hint={t('common.noDataHint')} />
        <div className="mx-auto max-w-[520px]">
          <InlineDropZone />
        </div>
      </div>
    );
  }

  const render = () => {
    switch (view) {
      case 'overview':
        return <OverviewView />;
      case 'data':
        return <DataView />;
      case 'clean':
        return <CleanView />;
      case 'describe':
        return <DescribeView />;
      case 'groupby':
        return <GroupByView />;
      case 'pivot':
        return <PivotView />;
      case 'correlate':
        return <CorrelateView />;
      case 'timeseries':
        return <TimeSeriesView />;
      case 'studio':
        return <StudioView />;
      case 'advanced':
        return <AdvancedView />;
      case 'report':
        return <ReportView />;
      default:
        return <OverviewView />;
    }
  };

  // `contents` keeps the wrapper out of the layout box tree.
  return (
    <div key={datasetKey} className="contents">
      {render()}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

export function App() {
  const { t, toggleLang } = useI18n();
  const pipelineOpen = useUI((s) => s.pipelineOpen);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);
  const bootedRef = useRef(false);
  const hasData = usePipeline((s) => s.base !== null);

  useShortcuts();

  // Language toggle is also reachable from the global shortcut handler.
  useEffect(() => {
    const handler = () => toggleLang();
    window.addEventListener('datalens:toggle-lang', handler);
    return () => window.removeEventListener('datalens:toggle-lang', handler);
  }, [toggleLang]);

  // Load the default dataset once on first mount.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void (async () => {
      try {
        const { df, meta } = await loadSample(DEFAULT_DATASET_ID);
        clearProfileCache();
        usePipeline.getState().loadDataset(df, meta);
        setBooted(true);
      } catch (e) {
        setBootError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[80] focus:rounded focus:bg-accent focus:px-3 focus:py-1.5 focus:text-white"
      >
        {t('a11y.skipToContent')}
      </a>

      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((v) => !v)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" className="flex min-h-0 flex-1">
          <div className="scroll-thin min-w-0 flex-1 overflow-y-auto">
            {!hasData && !booted ? (
              <BootScreen error={bootError} />
            ) : (
              <Boundary title={t('errors.boundary')} hint={t('errors.boundaryHint')} reload={t('errors.reload')}>
                <CurrentView />
              </Boundary>
            )}
          </div>
          {pipelineOpen && hasData && (
            <div className={cx('hidden lg:flex')}>
              <PipelineRail />
            </div>
          )}
        </main>
      </div>

      <LoadPanel />
      <CommandPalette />
      <ShortcutsDialog />
      <WelcomeTour />
    </div>
  );
}
