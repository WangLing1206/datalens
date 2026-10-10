import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n/index.tsx';
import { usePipeline } from '../../pipeline/store.ts';
import { useUI } from '../../app/store.ts';
import { loadSample } from '../../app/datasets.ts';
import { clearProfileCache, useFrame } from '../../app/hooks.ts';
import { Badge, Button, IconButton, cx } from '../ui/index.tsx';
import { Icon } from '../ui/Icon.tsx';
import type { ViewId } from '../../core/insights.ts';
import type { MessageKey } from '../../i18n/index.tsx';

/** Navigation groups, so eleven views read as three short lists. */
const SECTIONS: { titleKey: MessageKey; views: ViewId[] }[] = [
  { titleKey: 'nav.sectionAnalyze', views: ['overview', 'data', 'clean', 'describe', 'groupby', 'pivot', 'correlate', 'timeseries'] },
  { titleKey: 'nav.sectionModel', views: ['studio', 'advanced'] },
  { titleKey: 'nav.sectionDeliver', views: ['report'] },
];

export const VIEW_ICON: Record<ViewId, string> = {
  overview: 'overview',
  data: 'table',
  clean: 'broom',
  describe: 'sigma',
  groupby: 'group',
  pivot: 'grid',
  correlate: 'scatter',
  timeseries: 'clock',
  studio: 'chart',
  advanced: 'brain',
  report: 'report',
};

export const VIEW_LABEL: Record<ViewId, MessageKey> = {
  overview: 'nav.overview',
  data: 'nav.data',
  clean: 'nav.clean',
  describe: 'nav.describe',
  groupby: 'nav.groupby',
  pivot: 'nav.pivot',
  correlate: 'nav.correlate',
  timeseries: 'nav.timeseries',
  studio: 'nav.studio',
  advanced: 'nav.advanced',
  report: 'nav.report',
};

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const steps = usePipeline((s) => s.steps.length);
  const dataset = usePipeline((s) => s.dataset);
  const base = usePipeline((s) => s.base);

  return (
    <nav
      aria-label={t('a11y.mainNavigation')}
      className={cx(
        'flex shrink-0 flex-col border-r border-line bg-elevated transition-[width] duration-200',
        collapsed ? 'w-[58px]' : 'w-[218px]',
      )}
    >
      <div className={cx('flex h-14 items-center gap-2 border-b border-line px-3', collapsed && 'justify-center px-0')}>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-white shadow-[0_2px_8px_-2px_var(--c-accent)]">
          <Icon name="layers" size={17} />
        </span>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold tracking-tight text-ink">{t('app.name')}</p>
            <p className="truncate text-[10.5px] text-ink-faint">{t('app.tagline')}</p>
          </div>
        )}
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto px-2 py-3">
        {SECTIONS.map((section) => (
          <div key={section.titleKey} className="mb-3">
            {!collapsed && (
              <p className="px-2 pb-1.5 text-[10px] font-semibold tracking-widest text-ink-faint uppercase">
                {t(section.titleKey)}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.views.map((v) => {
                const active = view === v;
                return (
                  <li key={v}>
                    <button
                      type="button"
                      onClick={() => setView(v)}
                      aria-current={active ? 'page' : undefined}
                      // Keep the accessible name stable: the step badge below
                      // is decoration, not part of the button's label.
                      aria-label={t(VIEW_LABEL[v])}
                      title={collapsed ? t(VIEW_LABEL[v]) : undefined}
                      className={cx(
                        'group flex w-full items-center gap-2.5 rounded-md py-1.5 text-left transition-colors duration-150',
                        collapsed ? 'justify-center px-0' : 'px-2',
                        active
                          ? 'bg-accent-soft font-medium text-accent-ink'
                          : 'text-ink-soft hover:bg-surface-2 hover:text-ink',
                      )}
                    >
                      <Icon name={VIEW_ICON[v]} size={15} className="shrink-0" />
                      {!collapsed && <span className="min-w-0 flex-1 truncate text-[12.5px]">{t(VIEW_LABEL[v])}</span>}
                      {!collapsed && v === 'report' && steps > 0 && (
                        <Badge tone="neutral" className="!px-1 !py-0 text-[10px]">
                          {steps}
                        </Badge>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-line p-2">
        {!collapsed && dataset && base && (
          <div className="mb-2 rounded-lg border border-line bg-surface-2 p-2">
            <p className="truncate text-[11.5px] font-medium text-ink">{dataset.name}</p>
            <p className="mt-0.5 text-[10.5px] text-ink-faint">
              {t('load.datasetMeta', { rows: base.nRows.toLocaleString(), cols: base.nCols })}
            </p>
          </div>
        )}
        <div className={cx('flex items-center gap-1', collapsed && 'flex-col')}>
          <Button
            size="sm"
            variant="secondary"
            icon="upload"
            onClick={() => useUI.getState().setLoadPanelOpen(true)}
            className={collapsed ? '!px-2' : 'flex-1'}
          >
            {collapsed ? '' : t('load.title')}
          </Button>
          <IconButton
            icon={collapsed ? 'chevronRight' : 'chevronLeft'}
            label={collapsed ? 'expand' : 'collapse'}
            onClick={onToggle}
          />
        </div>
      </div>
    </nav>
  );
}

export function TopBar() {
  const { t, lang, toggleLang } = useI18n();
  const dataset = usePipeline((s) => s.dataset);
  const frame = useFrame();
  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);
  const togglePipeline = useUI((s) => s.togglePipeline);
  const pipelineOpen = useUI((s) => s.pipelineOpen);
  const view = useUI((s) => s.view);

  const [reloading, setReloading] = useState(false);

  const loadDefault = async () => {
    setReloading(true);
    try {
      const { df, meta } = await loadSample('titanic');
      clearProfileCache();
      usePipeline.getState().loadDataset(df, meta);
    } finally {
      setReloading(false);
    }
  };

  return (
    <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-[14.5px] font-semibold tracking-tight text-ink">
          {t(VIEW_LABEL[view])}
        </h1>
        {frame.isViewingHistory && (
          <Badge tone="warn" icon="history">
            {t('ops.viewingHistory', { n: frame.appliedCount })}
          </Badge>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {dataset ? (
          <button
            type="button"
            onClick={() => useUI.getState().setLoadPanelOpen(true)}
            className="hidden items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left transition-colors hover:border-line-strong hover:bg-surface-2 sm:flex"
          >
            <Icon name="database" size={13} className="shrink-0 text-accent" />
            <span className="max-w-[190px] truncate text-[12px] font-medium text-ink">{dataset.name}</span>
            {frame.frame && (
              <span className="tnum shrink-0 text-[11px] text-ink-faint">
                {frame.frame.nRows.toLocaleString()} × {frame.frame.nCols}
              </span>
            )}
            <Icon name="chevronDown" size={12} className="shrink-0 text-ink-faint" />
          </button>
        ) : (
          <Button size="sm" variant="soft" icon="upload" onClick={loadDefault} loading={reloading}>
            {t('load.title')}
          </Button>
        )}

        <IconButton
          icon="search"
          label={t('shortcuts.commandPalette')}
          onClick={() => useUI.getState().setCommandOpen(true)}
        />
        <button
          type="button"
          onClick={toggleLang}
          aria-label={t('a11y.languageToggle')}
          title={t('a11y.languageToggle')}
          className="flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[11.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          <Icon name="globe" size={13} />
          {lang === 'zh' ? '中' : 'EN'}
        </button>
        <IconButton
          icon={theme === 'dark' ? 'sun' : 'moon'}
          label={t('a11y.themeToggle')}
          onClick={toggleTheme}
        />
        <IconButton
          icon="panelRight"
          label={t('ops.pipeline')}
          active={pipelineOpen}
          onClick={togglePipeline}
        />
      </div>
    </header>
  );
}

/** Shown while the default dataset is in flight on first load. */
export function BootScreen({ error }: { error?: string | null }) {
  const { t } = useI18n();
  return (
    <div className="grid-bg flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-accent text-white shadow-[0_8px_24px_-8px_var(--c-accent)]">
          <Icon name="layers" size={24} />
        </span>
        <p className="text-[15px] font-semibold text-ink">{t('app.name')}</p>
        <p className="max-w-[320px] text-[12.5px] leading-relaxed text-ink-muted">{t('app.taglineLong')}</p>
        {error ? (
          <p className="mt-1 text-[12px] text-bad">{error}</p>
        ) : (
          <span className="spin mt-1 inline-block size-4 rounded-full border-2 border-line-strong border-t-accent" />
        )}
        {error && (
          <Button size="sm" icon="refresh" onClick={() => window.location.reload()}>
            {t('common.retry')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** First-run tour: four cards explaining the workflow. */
export function WelcomeTour() {
  const { t } = useI18n();
  const open = useUI((s) => s.tourOpen);
  const setOpen = useUI((s) => s.setTourOpen);
  const [step, setStep] = useState(0);

  const steps = useMemo(
    () =>
      [
        { icon: 'upload', title: t('tour.step1Title'), body: t('tour.step1Body') },
        { icon: 'broom', title: t('tour.step2Title'), body: t('tour.step2Body') },
        { icon: 'history', title: t('tour.step3Title'), body: t('tour.step3Body') },
        { icon: 'report', title: t('tour.step4Title'), body: t('tour.step4Body') },
      ] as const,
    [t],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;
  const s = steps[step];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="fade-in absolute inset-0 bg-black/55 backdrop-blur-[3px]" />
      <div className="pop-in relative w-full max-w-[430px] overflow-hidden rounded-2xl border border-line bg-elevated shadow-pop">
        <div className="border-b border-line px-5 pt-5 pb-4">
          <p className="text-[16px] font-semibold tracking-tight text-ink">{t('tour.title')}</p>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">{t('tour.subtitle')}</p>
        </div>
        <div className="px-5 py-5">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
              <Icon name={s.icon} size={17} />
            </span>
            <div>
              <p className="text-[13.5px] font-semibold text-ink">{s.title}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{s.body}</p>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-1.5">
            {steps.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`step ${i + 1}`}
                onClick={() => setStep(i)}
                className={cx(
                  'h-1.5 rounded-full transition-all duration-200',
                  i === step ? 'w-5 bg-accent' : 'w-1.5 bg-line-strong hover:bg-ink-faint',
                )}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-2 px-5 py-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[12px] text-ink-muted hover:text-ink"
          >
            {t('tour.dontShow')}
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setStep(step - 1)}>
                {t('tour.prev')}
              </Button>
            )}
            {step < steps.length - 1 ? (
              <Button size="sm" variant="primary" iconRight="arrowRight" onClick={() => setStep(step + 1)}>
                {t('tour.next')}
              </Button>
            ) : (
              <Button size="sm" variant="primary" icon="check" onClick={() => setOpen(false)}>
                {t('tour.start')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
