import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { useFrame, useProfile } from '../app/hooks.ts';
import { useUI } from '../app/store.ts';
import { ViewHeader, SplitView, ControlGroup } from '../components/layout/ViewShell.tsx';
import { Badge, Button, Card, CheckList, EmptyState, Field, NumberInput, Select, Switch, cx } from '../components/ui/index.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { EChart, useChartTheme } from '../components/charts/EChart.tsx';
import { boxOption, ecdfOption, histogramOption, ridgeOption, violinOption } from '../components/charts/builders.ts';
import { ecdf, histogram, kde, numericValues } from '../core/stats.ts';
import { groupDistributions } from '../core/groupby.ts';
import type { MessageKey } from '../i18n/index.tsx';

type StatKey =
  | 'count' | 'missing' | 'mean' | 'std' | 'variance' | 'min' | 'q1' | 'median' | 'q3' | 'max'
  | 'iqr' | 'range' | 'cv' | 'skew' | 'kurtosis' | 'sum' | 'unique' | 'zeros' | 'negatives' | 'outliers';

const STAT_LABEL: Record<StatKey, MessageKey> = {
  count: 'describe.count',
  missing: 'describe.missing',
  mean: 'describe.mean',
  std: 'describe.std',
  variance: 'describe.variance',
  min: 'describe.min',
  q1: 'describe.q1',
  median: 'describe.median',
  q3: 'describe.q3',
  max: 'describe.max',
  iqr: 'describe.iqr',
  range: 'describe.range',
  cv: 'describe.cv',
  skew: 'describe.skew',
  kurtosis: 'describe.kurtosis',
  sum: 'describe.sum',
  unique: 'describe.unique',
  zeros: 'describe.zeros',
  negatives: 'describe.negatives',
  outliers: 'describe.outliers',
};

const DEFAULT_STATS: StatKey[] = ['count', 'missing', 'mean', 'std', 'min', 'q1', 'median', 'q3', 'max', 'iqr', 'skew'];

export function DescribeView() {
  const { t, n, pct } = useI18n();
  const frame = useFrame();
  const profile = useProfile(frame.frame);
  const theme = useChartTheme();
  const setView = useUI((s) => s.setView);

  const df = frame.frame;

  const [selected, setSelected] = useState<string[]>([]);
  const [stats] = useState<StatKey[]>(DEFAULT_STATS);
  const [transpose, setTranspose] = useState(false);
  const [focus, setFocus] = useState('');
  const [bins, setBins] = useState(20);
  const [showKde, setShowKde] = useState(true);
  const [compareMode, setCompareMode] = useState<'hist' | 'box' | 'violin' | 'ridge'>('box');
  const [groupKey, setGroupKey] = useState('');
  const [showAllStats, setShowAllStats] = useState(false);

  const numeric = useMemo(() => df?.numericColumnNames() ?? [], [df]);
  const categorical = useMemo(() => df?.categoricalColumns().map((c) => c.name) ?? [], [df]);

  // Adopt the deep-link column, otherwise focus the first numeric column.
  const params = useUI((s) => s.viewParams);
  useEffect(() => {
    if (!df) return;
    const want = params?.column ? String(params.column) : null;
    if (want && df.has(want)) {
      setFocus(want);
      setSelected((p) => (p.includes(want) ? p : [want, ...p].slice(0, 6)));
      useUI.getState().consumeViewParams();
    } else if (!focus && numeric.length) {
      setFocus(numeric[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, df, numeric.join(',')]);

  const focusProfile = useMemo(() => profile?.columns.find((c) => c.name === focus) ?? null, [profile, focus]);

  const dist = useMemo(() => {
    if (!df || !focus || !df.has(focus)) return null;
    const vals = numericValues(df.require(focus).data);
    if (vals.length < 2) return null;
    const h = histogram(vals, bins);
    const k = kde(vals, 96);
    const e = ecdf(vals);
    return { vals, h, k, e };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [df, focus, bins]);

  const compare = useMemo(() => {
    if (!df) return [];
    const cols = selected.length ? selected : numeric.slice(0, 4);
    return cols
      .filter((c) => df.has(c))
      .map((c) => ({ name: c, values: numericValues(df.require(c).data) }))
      .filter((g) => g.values.length > 2);
  }, [df, selected, numeric]);

  const grouped = useMemo(() => {
    if (!df || !groupKey || !focus) return [];
    return groupDistributions(df, groupKey, focus, { maxGroups: 10 });
  }, [df, groupKey, focus]);

  const shownStats = showAllStats ? (Object.keys(STAT_LABEL) as StatKey[]) : stats;

  if (!df || !profile) return null;

  const valueFor = (colName: string, key: StatKey): number | null => {
    const c = profile.columns.find((x) => x.name === colName);
    if (!c) return null;
    if (key === 'count') return c.count;
    if (key === 'missing') return c.missing;
    if (key === 'unique') return c.uniqueCount;
    const s = c.numeric;
    if (!s) return null;
    switch (key) {
      case 'mean': return s.mean;
      case 'std': return s.std;
      case 'variance': return s.variance;
      case 'min': return s.min;
      case 'q1': return s.q1;
      case 'median': return s.median;
      case 'q3': return s.q3;
      case 'max': return s.max;
      case 'iqr': return s.iqr;
      case 'range': return s.range;
      case 'cv': return s.cv;
      case 'skew': return s.skew;
      case 'kurtosis': return s.kurtosis;
      case 'sum': return s.sum;
      case 'zeros': return s.zeros;
      case 'negatives': return s.negatives;
      case 'outliers': return s.outliersIqr;
      default: return null;
    }
  };

  const interpret = (): string[] => {
    const s = focusProfile?.numeric;
    if (!s) return [];
    const out: string[] = [];
    const rel = Math.abs(s.mean - s.median) / (Math.abs(s.median) || 1);
    out.push(
      t('describe.interpMeanMedian', {
        mean: n(s.mean, 3),
        median: n(s.median, 3),
        relation: rel < 0.05 ? t('describe.interpRelationClose') : s.mean > s.median ? t('describe.interpRelationMeanHigher') : t('describe.interpRelationMeanLower'),
      }),
    );
    out.push(t('describe.interpIqr', { lo: n(s.q1, 3), hi: n(s.q3, 3) }));
    if (Number.isFinite(s.skew)) {
      out.push(Math.abs(s.skew) < 0.5 ? t('describe.skewSymmetric') : s.skew > 0 ? t('describe.rightSkewExplain') : t('describe.leftSkewExplain'));
    }
    if (Number.isFinite(s.kurtosis)) {
      out.push(Math.abs(s.kurtosis) > 1 ? t('describe.kurtExplainHigh') : t('describe.kurtExplainLow'));
    }
    return out;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader
        titleKey="describe.title"
        subtitleKey="describe.subtitle"
        meta={<Badge tone="neutral" className="tnum">{numeric.length} {t('overview.metricNumeric')}</Badge>}
        actions={
          <>
            <Button size="sm" variant={showAllStats ? 'soft' : 'secondary'} icon="list" onClick={() => setShowAllStats((v) => !v)}>
              {t('describe.showStats')}
            </Button>
            <Button size="sm" variant={transpose ? 'soft' : 'secondary'} icon="crop" onClick={() => setTranspose((v) => !v)}>
              {t('describe.transpose')}
            </Button>
          </>
        }
      />

      <SplitView
        width={300}
        controls={
          <>
            <ControlGroup titleKey="describe.selectColumns" hintKey="describe.compareHint">
              <CheckList
                items={numeric.map((c) => ({ value: c, label: c, hint: `${profile.columns.find((p) => p.name === c)?.count ?? 0}` }))}
                selected={selected}
                onToggle={(v) => setSelected((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))}
                onSelectAll={() => setSelected(numeric.slice(0, 8))}
                onClear={() => setSelected([])}
                searchable
                maxHeight={190}
                emptyLabel={t('errors.noNumericColumns')}
                labels={{ search: t('common.searchPlaceholder'), all: t('common.selectAll'), clear: t('common.clear') }}
              />
            </ControlGroup>

            <ControlGroup titleKey="describe.distTitle" hintKey="describe.distHint">
              <div className="space-y-3">
                <Field label={t('common.column')}>
                  <Select
                    value={focus}
                    onChange={(e) => setFocus(e.target.value)}
                    options={numeric.map((c) => ({ value: c, label: c }))}
                    placeholder={t('common.column')}
                  />
                </Field>
                <Field label={t('describe.bins')} inline>
                  <NumberInput value={bins} onChange={(v) => setBins(Math.round(v))} min={4} max={80} className="!w-20" />
                </Field>
                <Field label={t('describe.kdeOverlay')} inline>
                  <Switch checked={showKde} onChange={setShowKde} />
                </Field>
              </div>
            </ControlGroup>

            <ControlGroup titleKey="describe.compareMode">
              <div className="space-y-3">
                {/* Four options do not fit one row in this column, so use a 2x2 grid. */}
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface-2 p-0.5">
                  {([
                    ['box', 'describe.compareBox', 'target'],
                    ['hist', 'describe.compareHist', 'chart'],
                    ['violin', 'describe.compareViolin', 'chart'],
                    ['ridge', 'describe.compareRidge', 'layers'],
                  ] as const).map(([value, labelKey, icon]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCompareMode(value)}
                      className={cx(
                        'inline-flex items-center justify-center gap-1 rounded-[6px] px-1.5 py-1 text-[11.5px] font-medium whitespace-nowrap transition-all duration-150',
                        compareMode === value
                          ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]'
                          : 'text-ink-muted hover:text-ink',
                      )}
                    >
                      <Icon name={icon} size={12} />
                      {t(labelKey)}
                    </button>
                  ))}
                </div>
                <Field label={t('describe.groupByColumn')}>
                  <Select
                    value={groupKey}
                    onChange={(e) => setGroupKey(e.target.value)}
                    options={[{ value: '', label: t('common.none') }, ...categorical.map((c) => ({ value: c, label: c }))]}
                  />
                </Field>
              </div>
            </ControlGroup>
          </>
        }
      >
        <div className="space-y-5">
          {/* Statistics table */}
          <Card title={t('describe.statTable')} dense>
            <div className="scroll-thin max-h-[520px] overflow-auto">
              {/* Width the table to the number of visible metrics so columns are
                  never squeezed; the wrapper scrolls horizontally instead. */}
              <table className="w-full text-[12px]" style={{ minWidth: 190 + shownStats.length * 92 }}>
                <thead className="sticky top-0 z-10 bg-surface-2">
                  <tr className="border-b border-line text-left text-[11px] text-ink-muted">
                    <th className="sticky left-0 z-20 bg-surface-2 px-3 py-2 font-medium">{t('overview.colName')}</th>
                    {shownStats.map((s) => (
                      <th key={s} className="px-2.5 py-2 text-right font-medium whitespace-nowrap">
                        {t(STAT_LABEL[s])}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {profile.columns.map((c) => (
                    <tr
                      key={c.name}
                      onClick={() => setFocus(c.name)}
                      className={cx(
                        'cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2',
                        focus === c.name && 'bg-accent-soft',
                      )}
                    >
                      <td
                        className="sticky left-0 z-10 max-w-[190px] truncate bg-surface px-3 py-1.5 font-medium text-ink"
                        title={c.name}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="truncate">{c.name}</span>
                          {!c.numeric && <Badge tone="neutral" className="!px-1 !py-0 !text-[9.5px]">{t('dtype.string')}</Badge>}
                        </span>
                      </td>
                      {shownStats.map((s) => {
                        const v = valueFor(c.name, s);
                        return (
                          <td key={s} className={cx('tnum px-2.5 py-1.5 text-right', v === null ? 'text-ink-faint' : 'text-ink-soft')}>
                            {v === null ? '—' : s === 'count' || s === 'missing' || s === 'unique' || s === 'zeros' || s === 'negatives' || s === 'outliers' ? n(v, 0) : n(v, 3)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Distribution detail */}
          {dist && focusProfile && theme && (
            <Card
              title={`${t('describe.distTitle')} · ${focus}`}
              subtitle={`n = ${n(dist.vals.length, 0)} · ${t('describe.mean')} ${n(focusProfile.numeric?.mean ?? NaN, 3)} · ${t('describe.std')} ${n(focusProfile.numeric?.std ?? NaN, 3)}`}
              icon="chart"
              actions={
                <Button size="sm" variant="ghost" icon="target" onClick={() => setView('clean', { column: focus, focus: 'outliers' })}>
                  {t('clean.outlierTitle')}
                </Button>
              }
            >
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11.5px] font-medium text-ink-muted">{t('describe.histogram')}</p>
                  <EChart
                    height={220}
                    option={histogramOption(theme, {
                      binEdges: dist.h.binEdges,
                      counts: dist.h.counts,
                      kdeCurve: dist.k,
                      showKde,
                      xName: focus,
                      meanLine: focusProfile.numeric?.mean,
                      medianLine: focusProfile.numeric?.median,
                      labels: { mean: t('chart.meanLine'), median: t('chart.medianLine') },
                    })}
                  />
                </div>
                <div>
                  <p className="mb-1.5 text-[11.5px] font-medium text-ink-muted">{t('describe.boxplot')}</p>
                  <EChart
                    height={220}
                    option={boxOption(theme, {
                      groups: [{ name: focus, values: dist.vals }],
                      yName: focus,
                      outlierLabel: t('chart.outlierPoint'),
                    })}
                  />
                </div>
                <div className="xl:col-span-2">
                  <p className="mb-1.5 text-[11.5px] font-medium text-ink-muted">{t('describe.ecdf')}</p>
                  <EChart
                    height={200}
                    option={ecdfOption(theme, { curves: [{ name: focus, x: dist.e.x, y: dist.e.y }], xName: focus })}
                  />
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
                <p className="mb-1.5 text-[11.5px] font-semibold text-ink">{t('describe.interpretation')}</p>
                <ul className="space-y-1">
                  {interpret().map((line, i) => (
                    <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-ink-soft">
                      <Icon name="chevronRight" size={11} className="mt-1 shrink-0 text-ink-faint" />
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          )}

          {/* Compare */}
          {compare.length >= 2 && theme && (
            <Card title={t('describe.compareTitle')} subtitle={t('describe.compareHint')} icon="layers">
              <EChart
                height={300}
                option={
                  compareMode === 'box'
                    ? boxOption(theme, { groups: compare, outlierLabel: t('chart.outlierPoint') })
                    : compareMode === 'violin'
                      ? violinOption(theme, { groups: compare })
                      : compareMode === 'ridge'
                        ? ridgeOption(theme, { groups: compare })
                        : histogramOption(theme, {
                            binEdges: histogram(compare[0].values, bins).binEdges,
                            counts: histogram(compare[0].values, bins).counts,
                            xName: compare[0].name,
                          })
                }
              />
              {compareMode === 'hist' && (
                <p className="mt-2 text-[11.5px] text-ink-faint">
                  {t('describe.compareBox')} · {compare.map((c) => c.name).join(', ')}
                </p>
              )}
            </Card>
          )}

          {/* Grouped distributions */}
          {grouped.length >= 2 && theme && (
            <Card title={t('describe.statsByGroup')} subtitle={`${groupKey} → ${focus}`} icon="group">
              <EChart height={300} option={violinOption(theme, { groups: grouped.map((g) => ({ name: g.key, values: g.values })), yName: focus })} />
              <div className="mt-3 scroll-thin overflow-x-auto">
                <table className="w-full min-w-[420px] text-[12px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] text-ink-muted">
                      <th className="px-3 py-1.5 font-medium">{groupKey}</th>
                      <th className="px-3 py-1.5 text-right font-medium">n</th>
                      <th className="px-3 py-1.5 text-right font-medium">{t('describe.mean')}</th>
                      <th className="px-3 py-1.5 text-right font-medium">{t('describe.median')}</th>
                      <th className="px-3 py-1.5 text-right font-medium">{t('describe.std')}</th>
                      <th className="px-3 py-1.5 text-right font-medium">{t('common.percent')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map((g) => {
                      const s = [...g.values].sort((a, b) => a - b);
                      const mean = g.values.reduce((a, b) => a + b, 0) / g.values.length;
                      const med = s[Math.floor(s.length / 2)];
                      const sd = Math.sqrt(g.values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, g.values.length - 1));
                      return (
                        <tr key={g.key} className="border-b border-line/50 last:border-0">
                          <td className="px-3 py-1.5 font-medium text-ink">{g.key}</td>
                          <td className="tnum px-3 py-1.5 text-right text-ink-soft">{n(g.count, 0)}</td>
                          <td className="tnum px-3 py-1.5 text-right text-ink-soft">{n(mean, 3)}</td>
                          <td className="tnum px-3 py-1.5 text-right text-ink-soft">{n(med, 3)}</td>
                          <td className="tnum px-3 py-1.5 text-right text-ink-soft">{n(sd, 3)}</td>
                          <td className="tnum px-3 py-1.5 text-right text-ink-muted">{pct(g.count / df.nRows)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {!dist && (
            <Card>
              <EmptyState icon="sigma" title={t('errors.noNumericColumns')} hint={t('common.noDataHint')} />
            </Card>
          )}
        </div>
      </SplitView>
    </div>
  );
}
