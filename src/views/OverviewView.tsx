import { useMemo, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { useFrame, useInsights, useProfile } from '../app/hooks.ts';
import { useUI } from '../app/store.ts';
import { ViewHeader, SectionTitle } from '../components/layout/ViewShell.tsx';
import { Badge, Button, Card, EmptyState, StatTile, cx } from '../components/ui/index.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { EChart, useChartTheme } from '../components/charts/EChart.tsx';
import { histogramOption, pieOption } from '../components/charts/builders.ts';
import type { Insight, InsightCategory } from '../core/insights.ts';
import { histogram, kde } from '../core/stats.ts';
import { dtypeLabel } from '../core/dtype.ts';
import type { ColumnProfile } from '../core/profile.ts';
import type { MessageKey } from '../i18n/index.tsx';

/** Insight category → icon + tone, shared by the overview and the report. */
export const INSIGHT_META: Record<InsightCategory, { icon: string; tone: 'bad' | 'warn' | 'accent' | 'info' | 'good'; labelKey: MessageKey }> = {
  quality: { icon: 'alert', tone: 'bad', labelKey: 'settle.quality' },
  distribution: { icon: 'chart', tone: 'warn', labelKey: 'settle.distribution' },
  relation: { icon: 'link', tone: 'accent', labelKey: 'settle.relation' },
  group: { icon: 'group', tone: 'info', labelKey: 'settle.groupDifference' },
  time: { icon: 'clock', tone: 'info', labelKey: 'settle.timePattern' },
  action: { icon: 'bulb', tone: 'good', labelKey: 'settle.action' },
};

const SEVERITY_TONE = { high: 'bad', medium: 'warn', low: 'neutral' } as const;

/** A single finding card, with a deep link into the view that explores it. */
export function InsightCard({ insight, compact }: { insight: Insight; compact?: boolean }) {
  const { t } = useI18n();
  const setView = useUI((s) => s.setView);
  const meta = INSIGHT_META[insight.category];
  return (
    <article
      className={cx(
        'group flex items-start gap-3 rounded-lg border border-line bg-surface p-3 transition-colors hover:border-line-strong',
        compact && 'p-2.5',
      )}
    >
      <span
        className={cx(
          'mt-0.5 grid shrink-0 place-items-center rounded-md',
          compact ? 'size-6' : 'size-7',
          meta.tone === 'bad'
            ? 'bg-bad-soft text-bad'
            : meta.tone === 'warn'
              ? 'bg-warn-soft text-warn'
              : meta.tone === 'accent'
                ? 'bg-accent-soft text-accent-ink'
                : meta.tone === 'good'
                  ? 'bg-good-soft text-good'
                  : 'bg-info-soft text-info',
        )}
      >
        <Icon name={meta.icon} size={compact ? 12 : 14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10.5px] font-semibold tracking-wide text-ink-faint uppercase">{t(meta.labelKey)}</span>
          {insight.severity !== 'low' && (
            <Badge tone={SEVERITY_TONE[insight.severity]}>
              {t(insight.severity === 'high' ? 'settle.severityHigh' : 'settle.severityMedium')}
            </Badge>
          )}
          {insight.metric && (
            <span className="tnum ml-auto shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-soft">
              {insight.metric}
            </span>
          )}
        </div>
        <p className={cx('mt-1 leading-relaxed text-ink', compact ? 'text-[12px]' : 'text-[12.5px]')}>{insight.body}</p>
        {insight.action && (
          <button
            type="button"
            onClick={() => setView(insight.action!.view, insight.action!.params)}
            className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent-ink hover:underline"
          >
            {t('settle.goAnalyze')}
            <Icon name="arrowRight" size={11} />
          </button>
        )}
      </div>
    </article>
  );
}

function HealthRing({ score, label }: { score: number; label: string }) {
  const tone = score >= 85 ? 'good' : score >= 70 ? 'accent' : score >= 50 ? 'warn' : 'bad';
  const stroke =
    tone === 'good' ? 'var(--c-good)' : tone === 'accent' ? 'var(--c-accent)' : tone === 'warn' ? 'var(--c-warn)' : 'var(--c-bad)';
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width={72} height={72} viewBox="0 0 72 72" className="shrink-0" aria-hidden>
        <circle cx={36} cy={36} r={r} fill="none" stroke="var(--c-surface-3)" strokeWidth={7} />
        <circle
          cx={36}
          cy={36}
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          transform="rotate(-90 36 36)"
          style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.22,1,.36,1)' }}
        />
        <text x={36} y={36} textAnchor="middle" dominantBaseline="central" className="tnum" fill="var(--c-text)" fontSize={17} fontWeight={600}>
          {Math.round(score)}
        </text>
      </svg>
      <div>
        <p className="text-[12px] text-ink-muted">{label}</p>
        <p className="mt-0.5 text-[13px] font-semibold text-ink">{score >= 85 ? '≥85' : score >= 70 ? '≥70' : score >= 50 ? '≥50' : '<50'}</p>
      </div>
    </div>
  );
}

/** Sparkline-ish distribution cell used in the column profile table. */
function MiniDist({ col }: { col: ColumnProfile }) {
  if (col.histogram && col.histogram.counts.length > 1) {
    const max = Math.max(...col.histogram.counts) || 1;
    return (
      <div className="flex h-6 items-end gap-px" aria-hidden>
        {col.histogram.counts.map((c, i) => (
          <span
            key={i}
            className="flex-1 rounded-[1px] bg-accent/60"
            style={{ height: `${Math.max(6, (c / max) * 100)}%` }}
          />
        ))}
      </div>
    );
  }
  if (col.category && col.category.top.length > 1) {
    const max = col.category.top[0].count || 1;
    return (
      <div className="space-y-px" aria-hidden>
        {col.category.top.slice(0, 4).map((c) => (
          <div key={c.value} className="flex items-center gap-1">
            <span className="w-0 flex-1 truncate text-[9.5px] text-ink-faint">{c.value}</span>
            <span className="h-1.5 rounded-full bg-accent/60" style={{ width: `${Math.max(4, (c.count / max) * 42)}px` }} />
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-[11px] text-ink-faint">—</span>;
}

function MissingBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cx('h-full rounded-full', pct > 0.3 ? 'bg-bad' : pct > 0.05 ? 'bg-warn' : 'bg-good')}
          style={{ width: `${Math.max(2, pct * 100)}%` }}
        />
      </div>
      <span className="tnum w-9 text-[10.5px] text-ink-muted">{pct === 0 ? '0%' : `${(pct * 100).toFixed(1)}%`}</span>
    </div>
  );
}

/** Auto-generated "first look" charts: the most informative numeric and categorical columns. */
function FirstLook() {
  const { t, n } = useI18n();
  const frame = useFrame();
  const profile = useProfile(frame.frame);
  const theme = useChartTheme();

  const picks = useMemo(() => {
    if (!profile || !frame.frame) return { nums: [] as string[], cats: [] as string[] };
    const nums = profile.columns
      .filter((c) => c.numeric && c.numeric.count > 3 && !c.hints.includes('identifier') && !c.hints.includes('constant'))
      .sort((a, b) => (b.numeric!.std / (Math.abs(b.numeric!.mean) || 1)) - (a.numeric!.std / (Math.abs(a.numeric!.mean) || 1)))
      .slice(0, 2)
      .map((c) => c.name);
    const cats = profile.columns
      .filter((c) => c.category && c.uniqueCount >= 2 && c.uniqueCount <= 10)
      .sort((a, b) => a.uniqueCount - b.uniqueCount)
      .slice(0, 2)
      .map((c) => c.name);
    return { nums, cats };
  }, [profile, frame.frame]);

  if (!theme || !frame.frame || (picks.nums.length === 0 && picks.cats.length === 0)) return null;

  return (
    <section>
      <SectionTitle titleKey="overview.firstLook" hint={t('overview.firstLookHint')} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {picks.nums.map((name) => {
          const vals = frame.frame!.require(name).data.filter((v) => v !== null).map(Number);
          const h = histogram(vals, Math.max(8, Math.min(26, Math.ceil(Math.sqrt(vals.length)))));
          const k = kde(vals, 80);
          const p = profile!.columns.find((c) => c.name === name)!;
          return (
            <Card key={name} title={name} subtitle={t('describe.histogram')} icon="chart">
              <EChart
                height={200}
                option={histogramOption(theme, {
                  binEdges: h.binEdges,
                  counts: h.counts,
                  kdeCurve: k,
                  xName: name,
                  meanLine: p.numeric?.mean,
                  medianLine: p.numeric?.median,
                  labels: { mean: t('chart.meanLine'), median: t('chart.medianLine') },
                })}
              />
            </Card>
          );
        })}
        {picks.cats.map((name) => {
          const counts = new Map<string, number>();
          for (const v of frame.frame!.require(name).data) {
            if (v === null) continue;
            const k = String(v);
            counts.set(k, (counts.get(k) ?? 0) + 1);
          }
          const data = [...counts.entries()].map(([k, value]) => ({ name: k, value })).sort((a, b) => b.value - a.value);
          return (
            <Card key={name} title={name} subtitle={t('groupby.pie')} icon="chart">
              <EChart
                height={200}
                option={pieOption(theme, { data, donut: true, showValues: false, otherLabel: t('chart.other'), valueFormatter: (v) => n(v, 0) })}
              />
            </Card>
          );
        })}
      </div>
    </section>
  );
}

export function OverviewView() {
  const { t, n, pct } = useI18n();
  const frame = useFrame();
  const profile = useProfile(frame.frame);
  const insights = useInsights(frame.frame, profile);
  const setView = useUI((s) => s.setView);
  const [filter, setFilter] = useState<'all' | InsightCategory>('all');
  const [showAllCols, setShowAllCols] = useState(false);

  const shown = useMemo(
    () => (filter === 'all' ? insights : insights.filter((i) => i.category === filter)),
    [insights, filter],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of insights) c[i.category] = (c[i.category] ?? 0) + 1;
    return c;
  }, [insights]);

  if (!frame.frame || !profile) return null;
  const df = frame.frame;

  const healthLabel =
    profile.healthScore >= 85
      ? t('overview.healthExcellent')
      : profile.healthScore >= 70
        ? t('overview.healthGood')
        : profile.healthScore >= 50
          ? t('overview.healthFair')
          : t('overview.healthPoor');

  const columns = showAllCols ? profile.columns : profile.columns.slice(0, 12);

  return (
    <div className="pb-10">
      <ViewHeader
        titleKey="overview.title"
        subtitleKey="overview.subtitle"
        actions={
          <>
            <Button size="sm" variant="secondary" icon="broom" onClick={() => setView('clean')}>
              {t('nav.clean')}
            </Button>
            <Button size="sm" variant="primary" icon="group" onClick={() => setView('groupby')}>
              {t('nav.groupby')}
            </Button>
          </>
        }
      />

      <div className="space-y-5 p-5">
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile label={t('overview.metricRows')} value={n(df.nRows, 0)} icon="table" />
          <StatTile label={t('overview.metricCols')} value={n(df.nCols, 0)} icon="columns" />
          <StatTile
            label={t('overview.metricNumeric')}
            value={n(profile.numericCount, 0)}
            icon="sigma"
            onClick={() => setView('describe')}
          />
          <StatTile
            label={t('overview.metricCategorical')}
            value={n(profile.categoricalCount, 0)}
            icon="group"
            onClick={() => setView('groupby')}
          />
          <StatTile
            label={t('overview.metricMissing')}
            value={profile.cells === 0 ? '0%' : pct(profile.missingCells / profile.cells)}
            hint={`${n(profile.missingCells, 0)} / ${n(profile.cells, 0)}`}
            icon="alert"
            tone={profile.missingCells > 0 ? 'warn' : 'good'}
            onClick={() => setView('clean')}
          />
          <StatTile
            label={t('overview.metricDuplicates')}
            value={n(profile.duplicateRows, 0)}
            icon="copy"
            tone={profile.duplicateRows > 0 ? 'warn' : 'good'}
            onClick={() => setView('clean')}
          />
        </div>

        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          {/* Health */}
          <Card title={t('overview.health')} subtitle={t('overview.healthExplain')} icon="target">
            <HealthRing score={profile.healthScore} label={healthLabel} />
            <div className="mt-3 space-y-1.5">
              {profile.healthBreakdown.length === 0 ? (
                <div className="flex items-center gap-1.5 text-[12px] text-good">
                  <Icon name="check" size={13} />
                  {t('overview.qualityPass')}
                </div>
              ) : (
                profile.healthBreakdown.map((b) => (
                  <div key={b.key} className="flex items-center gap-2 text-[11.5px]">
                    <span className="min-w-0 flex-1 truncate text-ink-soft">
                      {t(
                        b.key === 'missing'
                          ? 'overview.penaltyMissing'
                          : b.key === 'duplicates'
                            ? 'overview.penaltyDuplicates'
                            : b.key === 'small'
                              ? 'overview.penaltySmall'
                              : b.key === 'empty-columns'
                                ? 'overview.penaltyEmptyColumns'
                                : 'overview.penaltyConstantColumns',
                      )}
                    </span>
                    <span className="tnum shrink-0 text-ink-faint">{b.detail}</span>
                    <span className="tnum shrink-0 font-medium text-warn">−{b.penalty}</span>
                  </div>
                ))
              )}
            </div>
            <div className="mt-3 space-y-2 border-t border-line pt-3 text-[11.5px]">
              <div className="flex justify-between">
                <span className="text-ink-muted">{t('overview.metricCells')}</span>
                <span className="tnum text-ink">{n(profile.cells, 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">{t('overview.memory')}</span>
                <span className="tnum text-ink">
                  {profile.memoryBytes > 1024 * 1024
                    ? `${(profile.memoryBytes / 1024 / 1024).toFixed(1)} MB`
                    : `${(profile.memoryBytes / 1024).toFixed(1)} KB`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">{t('overview.metricDatetime')}</span>
                <span className="tnum text-ink">{profile.datetimeCount}</span>
              </div>
            </div>
          </Card>

          {/* Insights */}
          <Card
            title={t('settle.title')}
            subtitle={t('settle.subtitle')}
            icon="bulb"
            actions={<Badge tone="accent">{t('settle.findingsCount', { n: insights.length })}</Badge>}
          >
            <div className="mb-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={cx(
                  'rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors',
                  filter === 'all' ? 'bg-accent text-white' : 'bg-surface-2 text-ink-soft hover:bg-surface-3',
                )}
              >
                {t('common.all')} {insights.length}
              </button>
              {(Object.keys(INSIGHT_META) as InsightCategory[])
                .filter((c) => counts[c])
                .map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFilter(c)}
                    className={cx(
                      'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors',
                      filter === c ? 'bg-accent text-white' : 'bg-surface-2 text-ink-soft hover:bg-surface-3',
                    )}
                  >
                    <Icon name={INSIGHT_META[c].icon} size={11} />
                    {t(INSIGHT_META[c].labelKey)} {counts[c]}
                  </button>
                ))}
            </div>
            <div className="scroll-thin max-h-[520px] space-y-2 overflow-y-auto pr-1">
              {shown.length === 0 ? (
                <EmptyState icon="check" title={t('settle.noInsights')} hint={t('settle.noInsightsHint')} compact />
              ) : (
                shown.map((i) => <InsightCard key={i.id} insight={i} />)
              )}
            </div>
          </Card>
        </div>

        {/* Column profile */}
        <Card
          title={t('overview.columnProfile')}
          subtitle={t('overview.columnProfileHint')}
          icon="columns"
          actions={
            profile.columns.length > 12 ? (
              <Button size="sm" variant="ghost" onClick={() => setShowAllCols((v) => !v)}>
                {showAllCols ? t('common.less') : `${t('common.showMore')} (${profile.columns.length})`}
              </Button>
            ) : null
          }
          dense
        >
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] text-ink-muted">
                  <th className="px-4 py-2 font-medium">{t('overview.colName')}</th>
                  <th className="px-3 py-2 font-medium">{t('overview.colType')}</th>
                  <th className="px-3 py-2 font-medium">{t('overview.colNonNull')}</th>
                  <th className="px-3 py-2 font-medium">{t('overview.colMissing')}</th>
                  <th className="px-3 py-2 font-medium">{t('overview.colUnique')}</th>
                  <th className="px-3 py-2 font-medium">{t('overview.colDistribution')}</th>
                  <th className="px-3 py-2 font-medium">{t('overview.colTags')}</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr
                    key={c.name}
                    className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2"
                    onClick={() => setView('describe', { column: c.name })}
                  >
                    <td className="max-w-[220px] truncate px-4 py-2 font-medium text-ink" title={c.name}>
                      {c.name}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone="neutral" mono>
                        {dtypeLabel(c.dtype)}
                      </Badge>
                    </td>
                    <td className="tnum px-3 py-2 text-ink-soft">
                      {n(c.count, 0)}
                      <span className="ml-1 text-[10.5px] text-ink-faint">/ {n(c.n, 0)}</span>
                    </td>
                    <td className="px-3 py-2">
                      <MissingBar pct={c.missingPct} />
                    </td>
                    <td className="tnum px-3 py-2 text-ink-soft">{n(c.uniqueCount, 0)}</td>
                    <td className="px-3 py-2">
                      <div className="w-[150px]">
                        <MiniDist col={c} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {c.hints.slice(0, 2).map((h) => (
                          <Badge
                            key={h}
                            tone={h === 'high-missing' || h === 'all-missing' ? 'bad' : h === 'constant' || h === 'identifier' ? 'neutral' : 'warn'}
                          >
                            {t(`hint.${h}` as MessageKey)}
                          </Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <FirstLook />

        {/* Preview */}
        <Card
          title={t('overview.dataPreview')}
          subtitle={t('data.rowsShown', { from: 1, to: Math.min(8, df.nRows), total: n(df.nRows, 0) })}
          icon="table"
          actions={
            <Button size="sm" variant="ghost" iconRight="arrowRight" onClick={() => setView('data')}>
              {t('nav.data')}
            </Button>
          }
          dense
        >
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[10.5px] text-ink-muted">
                  <th className="px-3 py-1.5 font-medium">#</th>
                  {df.columns.slice(0, 10).map((c) => (
                    <th key={c.name} className="max-w-[160px] truncate px-3 py-1.5 font-medium" title={c.name}>
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.min(8, df.nRows) }, (_, i) => (
                  <tr key={i} className="border-b border-line/50 last:border-0">
                    <td className="tnum px-3 py-1.5 text-ink-faint">{i + 1}</td>
                    {df.columns.slice(0, 10).map((c) => {
                      const v = c.data[i];
                      return (
                        <td
                          key={c.name}
                          className={cx(
                            'max-w-[160px] truncate px-3 py-1.5',
                            v === null ? 'text-ink-faint italic' : 'text-ink-soft',
                            typeof v === 'number' && 'tnum text-right',
                          )}
                        >
                          {v === null
                            ? 'NaN'
                            : c.dtype === 'datetime'
                              ? new Date(Number(v)).toISOString().slice(0, 10)
                              : String(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
