import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { useFrame, useProfile } from '../app/hooks.ts';
import { useUI } from '../app/store.ts';
import { ViewHeader, SplitView, ControlGroup } from '../components/layout/ViewShell.tsx';
import { Badge, Button, Card, CheckList, EmptyState, Field, NumberInput, Segmented, Select, StatTile, Switch, cx, useToast } from '../components/ui/index.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { EChart, useChartTheme } from '../components/charts/EChart.tsx';
import { barOption, heatmapOption, lineOption, pieOption } from '../components/charts/builders.ts';
import { groupBy } from '../core/groupby.ts';
import { AGG_FUNCS } from '../core/types.ts';
import type { AggFunc } from '../core/types.ts';
import type { MessageKey } from '../i18n/index.tsx';

type ChartKind = 'bar' | 'line' | 'stacked' | 'percent' | 'grouped' | 'pie' | 'donut' | 'heatmap';
type SortMode = 'none' | 'desc' | 'asc';

const AGG_LABEL: Record<AggFunc, MessageKey> = {
  count: 'common.count',
  sum: 'common.sum',
  mean: 'common.mean',
  median: 'common.median',
  min: 'common.min',
  max: 'common.max',
  std: 'common.std',
  var: 'describe.variance',
  nunique: 'describe.unique',
  first: 'common.first',
  last: 'common.last',
  mode: 'describe.mode',
};

export function GroupByView() {
  const { t, n } = useI18n();
  const frame = useFrame();
  const profile = useProfile(frame.frame);
  const toast = useToast();
  const theme = useChartTheme();

  const df = frame.frame;

  const [keys, setKeys] = useState<string[]>([]);
  const [aggs, setAggs] = useState<{ column: string; funcs: AggFunc[] }[]>([]);
  const [chart, setChart] = useState<ChartKind>('bar');
  const [sortMode, setSortMode] = useState<SortMode>('desc');
  const [topN, setTopN] = useState(0);
  const [showLegend, setShowLegend] = useState(true);
  const [showValues, setShowValues] = useState(false);
  const [applied, setApplied] = useState<null | { keys: string[]; aggs: typeof aggs }>(null);

  const allCols = useMemo(() => df?.columnNames ?? [], [df]);
  const numeric = useMemo(() => df?.numericColumnNames() ?? [], [df]);
  const categorical = useMemo(() => df?.categoricalColumns().map((c) => c.name) ?? [], [df]);

  // Deep-link params from an insight, then sensible defaults.
  const params = useUI((s) => s.viewParams);
  useEffect(() => {
    if (!df) return;
    const p = params;
    if (p?.keys && Array.isArray(p.keys)) {
      setKeys(p.keys as string[]);
      const value = p.value ? String(p.value) : numeric[0];
      if (value && df.has(value)) {
        setAggs([{ column: value, funcs: ((p.funcs as AggFunc[]) ?? ['mean']) }]);
        setApplied({ keys: p.keys as string[], aggs: [{ column: value, funcs: ((p.funcs as AggFunc[]) ?? ['mean']) }] });
      }
      useUI.getState().consumeViewParams();
      return;
    }
    if (keys.length === 0 && categorical.length && numeric.length) {
      setKeys([categorical[0]]);
      setAggs([{ column: numeric[0], funcs: ['mean'] }]);
      setApplied({ keys: [categorical[0]], aggs: [{ column: numeric[0], funcs: ['mean'] }] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, df]);

  const result = useMemo(() => {
    if (!df || !applied || applied.keys.length === 0 || applied.aggs.length === 0) return null;
    const usable = applied.aggs.filter((a) => a.funcs.length > 0 && df.has(a.column));
    if (usable.length === 0) return null;
    try {
      return groupBy(df, { keys: applied.keys, aggs: usable });
    } catch {
      return null;
    }
  }, [df, applied]);


  const rows = useMemo(() => {
    if (!result) return null;
    let out = result.df;
    if (topN > 0 && out.nRows > topN && result.valueColumns.length) {
      const first = result.valueColumns[0];
      const col = out.require(first);
      const pos = Array.from({ length: out.nRows }, (_, i) => i);
      pos.sort((a, b) => {
        const av = col.data[a];
        const bv = col.data[b];
        if (typeof av !== 'number' || typeof bv !== 'number') return 0;
        return bv - av;
      });
      out = out.take(pos.slice(0, topN));
    }
    if (sortMode !== 'none' && result.valueColumns.length) {
      const first = result.valueColumns[0];
      const col = out.require(first);
      const pos = Array.from({ length: out.nRows }, (_, i) => i);
      pos.sort((a, b) => {
        const av = col.data[a];
        const bv = col.data[b];
        if (typeof av !== 'number' || typeof bv !== 'number') return 0;
        return sortMode === 'desc' ? bv - av : av - bv;
      });
      out = out.take(pos);
    }
    return out;
  }, [result, topN, sortMode]);

  // A heatmap of two groups in one column would otherwise stretch into a pair
  // of enormous cells, so size the canvas to the matrix it holds.
  const chartHeight = useMemo(() => {
    if (chart !== 'heatmap') return 340;
    const bands = rows?.nRows || result?.groupCount || 0;
    return Math.max(240, Math.min(560, bands * 30 + 150));
  }, [chart, rows, result]);

  const chartOption = useMemo(() => {
    if (!rows || !result || !theme || rows.nRows === 0) return null;
    const categories = rows.index.map((_, i) =>
      result.keyColumns.map((k) => String(rows.require(k).data[i] ?? 'NaN')).join(' · '),
    );
    const valueCols = result.valueColumns;
    const limit = valueCols.slice(0, 6);

    if (chart === 'pie' || chart === 'donut') {
      if (valueCols.length === 0) return null;
      const first = valueCols[0];
      const data = categories
        .map((name, i) => ({ name, value: Number(rows.require(first).data[i] ?? 0) }))
        .filter((d) => Number.isFinite(d.value));
      return pieOption(theme, { data, donut: chart === 'donut', otherLabel: t('chart.other'), valueFormatter: (v) => n(v, 2) });
    }

    if (chart === 'heatmap') {
      if (result.keyColumns.length >= 2) {
        const [rk, ck] = result.keyColumns;
        const rowVals = [...new Set(rows.require(rk).data.map((v) => String(v ?? 'NaN')))];
        const colVals = [...new Set(rows.require(ck).data.map((v) => String(v ?? 'NaN')))];
        const valueCol = valueCols[0];
        const cells: (number | null)[][] = rowVals.map(() => colVals.map(() => null));
        const rIdx = new Map(rowVals.map((v, i) => [v, i]));
        const cIdx = new Map(colVals.map((v, i) => [v, i]));
        for (let i = 0; i < rows.nRows; i++) {
          const r = rIdx.get(String(rows.require(rk).data[i] ?? 'NaN'));
          const c = cIdx.get(String(rows.require(ck).data[i] ?? 'NaN'));
          const v = rows.require(valueCol).data[i];
          if (r === undefined || c === undefined || typeof v !== 'number') continue;
          cells[r][c] = v;
        }
        return heatmapOption(theme, {
          xLabels: colVals,
          yLabels: rowVals,
          cells,
          xName: ck,
          yName: rk,
          showValues: showValues,
          formatter: (v) => n(v, 2),
        });
      }
      // Single key: fall back to a one-column heatmap so the option still works.
      const valueCol = valueCols[0];
      const cells = categories.map((_, i) => [Number(rows.require(valueCol).data[i] ?? 0)]);
      return heatmapOption(theme, {
        xLabels: [valueCol],
        yLabels: categories,
        cells,
        showValues: showValues,
        formatter: (v) => n(v, 2),
      });
    }

    const stacked = chart === 'stacked' || chart === 'percent';

    // Metrics live on wildly different scales (a 0-1 rate next to a 0-600
    // count). Plotting them on one axis flattens the small one to nothing, so
    // anything more than 15x smaller moves to a second axis.
    const magnitudes = limit.map((v) => {
      const vals = rows.require(v).data.filter((x): x is number => typeof x === 'number');
      return vals.length ? Math.max(...vals.map(Math.abs)) : 0;
    });
    const biggest = Math.max(...magnitudes, 0);
    const split = !stacked && magnitudes.some((m) => m > 0 && biggest / m > 15);

    const series = limit.map((v, i) => ({
      name: v,
      data: rows.require(v).data as (number | null)[],
      yAxisIndex: split && magnitudes[i] > 0 && biggest / magnitudes[i] > 15 ? 1 : 0,
    }));
    const secondaryName = split ? limit.find((_, i) => magnitudes[i] > 0 && biggest / magnitudes[i] > 15) : undefined;

    const common = {
      categories,
      series,
      showLegend,
      showValues,
      rotateLabels: categories.length > 10 ? 32 : 0,
      extraGridBottom: 22,
      valueFormatter: (v: number) => n(v, 3),
      ...(secondaryName ? { secondaryName } : {}),
    };

    return chart === 'line'
      ? lineOption(theme, common)
      : barOption(theme, {
          ...common,
          stacked,
          percentStack: chart === 'percent',
          horizontal: categories.length > 14 && !stacked,
        });
  }, [rows, result, theme, chart, showLegend, showValues, n, t]);

  if (!df || !profile) return null;

  const keyOptions = allCols.map((c) => ({
    value: c,
    label: c,
    hint: `${profile.columns.find((p) => p.name === c)?.uniqueCount ?? 0}`,
  }));

  const quick = [
    { key: keys[0] ?? categorical[0], value: numeric[0], func: 'mean' as AggFunc, labelKey: 'groupby.quickMeanBy' as MessageKey },
    { key: keys[0] ?? categorical[0], value: numeric[0], func: 'count' as AggFunc, labelKey: 'groupby.quickCountBy' as MessageKey },
    { key: keys[0] ?? categorical[0], value: numeric[1] ?? numeric[0], func: 'sum' as AggFunc, labelKey: 'groupby.quickSumBy' as MessageKey },
  ].filter((q) => q.key && q.value);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader
        titleKey="groupby.title"
        subtitleKey="groupby.subtitle"
        meta={
          result && (
            <Badge tone="accent" className="tnum">
              {t('groupby.resultHint', { groups: result.groupCount, dropped: n(result.droppedRows, 0) })}
            </Badge>
          )
        }
        actions={
          <Button
            size="sm"
            variant="primary"
            icon="plus"
            disabled={keys.length === 0 || aggs.every((a) => a.funcs.length === 0)}
            onClick={() => {
              setApplied({ keys: [...keys], aggs: aggs.map((a) => ({ ...a, funcs: [...a.funcs] })) });
              toast.show(t('groupby.result'), { tone: 'good' });
            }}
          >
            {t('groupby.result')}
          </Button>
        }
      />

      <SplitView
        width={310}
        controls={
          <>
            <ControlGroup titleKey="groupby.groupKeys" hintKey="groupby.groupKeysHint">
              <CheckList
                items={keyOptions}
                selected={keys}
                onToggle={(v) => {
                  setKeys((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
                  // Changing the grouping keys invalidates the rendered result.
                  setApplied(null);
                }}
                onSelectAll={() => {
                  setKeys(categorical.slice(0, 3));
                  setApplied(null);
                }}
                onClear={() => {
                  setKeys([]);
                  setApplied(null);
                }}
                searchable
                maxHeight={180}
                labels={{ search: t('common.searchPlaceholder'), all: t('common.selectAll'), clear: t('common.clear') }}
              />
              {keys.length === 0 && <p className="mt-2 text-[11px] text-warn">{t('groupby.noKeySelected')}</p>}
            </ControlGroup>

            {quick.length > 0 && (
              <ControlGroup titleKey="groupby.quickAgg" hintKey="groupby.quickAggHint">
                <div className="space-y-1.5">
                  {quick.map((q, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        const next = [{ column: q.value, funcs: [q.func] }];
                        setAggs(next);
                        setApplied({ keys: [q.key], aggs: next });
                        setKeys([q.key]);
                      }}
                      className="flex w-full items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-left text-[11.5px] text-ink transition-colors hover:border-accent hover:bg-accent-soft"
                    >
                      <Icon name="wand" size={12} className="shrink-0 text-accent" />
                      <span className="min-w-0 flex-1 truncate">
                        {t(q.labelKey, { key: q.key, value: q.value })}
                      </span>
                    </button>
                  ))}
                </div>
              </ControlGroup>
            )}

            <ControlGroup
              titleKey="groupby.aggConfig"
              hintKey="groupby.aggHint"
              actions={
                <Button size="sm" variant="ghost" icon="plus" onClick={() => setAggs((p) => [...p, { column: numeric[0] ?? allCols[0], funcs: ['mean'] }])}>
                  {t('common.add')}
                </Button>
              }
            >
              <div className="space-y-2.5">
                {aggs.length === 0 && <p className="text-[11.5px] text-ink-faint">{t('groupby.aggHint')}</p>}
                {aggs.map((a, i) => (
                  <div key={i} className="rounded-lg border border-line bg-surface-2 p-2.5">
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={a.column}
                        onChange={(e) => setAggs((p) => p.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))}
                        options={allCols.map((c) => ({ value: c, label: c, disabled: !numeric.includes(c) && c !== a.column }))}
                        className="!text-[11.5px]"
                      />
                      <button
                        type="button"
                        aria-label={t('common.remove')}
                        onClick={() => setAggs((p) => p.filter((_, j) => j !== i))}
                        className="shrink-0 rounded p-1 text-ink-faint hover:bg-surface-3 hover:text-bad"
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {AGG_FUNCS.map((f) => {
                        const on = a.funcs.includes(f);
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() =>
                              setAggs((p) =>
                                p.map((x, j) =>
                                  j === i ? { ...x, funcs: on ? x.funcs.filter((y) => y !== f) : [...x.funcs, f] } : x,
                                ),
                              )
                            }
                            className={cx(
                              'rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-colors',
                              on ? 'bg-accent text-white' : 'bg-surface-3 text-ink-muted hover:text-ink',
                            )}
                          >
                            {t(AGG_LABEL[f])}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </ControlGroup>

            <ControlGroup titleKey="groupby.chartType">
              <div className="space-y-3">
                <Segmented
                  className="w-full"
                  value={chart}
                  onChange={setChart}
                  options={[
                    { value: 'bar', label: t('groupby.bar') },
                    { value: 'line', label: t('groupby.line') },
                    { value: 'stacked', label: t('common.stacked') },
                  ]}
                />
                <Segmented
                  className="w-full"
                  value={chart === 'percent' ? 'percent' : chart === 'heatmap' ? 'heatmap' : 'grouped'}
                  onChange={(v) => setChart(v as ChartKind)}
                  options={[
                    { value: 'grouped', label: t('groupby.groupedBar') },
                    { value: 'percent', label: t('groupby.percentStack') },
                    { value: 'heatmap', label: t('groupby.heatmap') },
                  ]}
                />
                <Segmented
                  className="w-full"
                  value={chart === 'pie' ? 'pie' : chart === 'donut' ? 'donut' : 'bar'}
                  onChange={(v) => setChart(v as ChartKind)}
                  options={[
                    { value: 'pie', label: t('groupby.pie') },
                    { value: 'donut', label: t('groupby.donut') },
                  ]}
                />
                <Field label={t('groupby.sortByValue')}>
                  <Select
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as SortMode)}
                    options={[
                      { value: 'none', label: t('groupby.sortNone') },
                      { value: 'desc', label: t('groupby.sortDesc') },
                      { value: 'asc', label: t('groupby.sortAsc') },
                    ]}
                  />
                </Field>
                <Field label={t('groupby.topN')} inline>
                  <NumberInput value={topN} onChange={(v) => setTopN(Math.round(v))} min={0} max={200} className="!w-20" />
                </Field>
                <Field label={t('groupby.showLegend')} inline>
                  <Switch checked={showLegend} onChange={setShowLegend} />
                </Field>
                <Field label={t('common.showValues')} inline>
                  <Switch checked={showValues} onChange={setShowValues} />
                </Field>
              </div>
            </ControlGroup>
          </>
        }
      >
        {keys.length === 0 ? (
          <Card>
            <EmptyState icon="group" title={t('groupby.emptyKeys')} hint={t('groupby.groupKeysHint')} />
          </Card>
        ) : !result || !rows ? (
          <Card>
            <EmptyState
              icon="plus"
              title={t('groupby.aggConfig')}
              hint={t('groupby.aggHint')}
              action={
                <Button
                  variant="primary"
                  icon="check"
                  onClick={() => setApplied({ keys: [...keys], aggs: aggs.map((a) => ({ ...a, funcs: [...a.funcs] })) })}
                >
                  {t('groupby.result')}
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label={t('groupby.groupCount')} value={n(result.groupCount, 0)} icon="group" tone="accent" />
              <StatTile label={t('common.rows')} value={n(result.df.nRows, 0)} icon="table" />
              <StatTile label={t('overview.metricCols')} value={n(result.df.nCols, 0)} icon="columns" />
              <StatTile
                label={t('describe.missing')}
                value={n(result.droppedRows, 0)}
                hint={t('groupby.resultHint', { groups: result.groupCount, dropped: n(result.droppedRows, 0) })}
                tone={result.droppedRows > 0 ? 'warn' : 'good'}
              />
            </div>

            {chartOption && (
              <Card title={t('groupby.chartType')} subtitle={result.valueColumns.slice(0, 6).join(', ')} icon="chart">
                <EChart height={chartHeight} option={chartOption} />
              </Card>
            )}

            <Card
              title={t('groupby.result')}
              subtitle={t('groupby.resultHint', { groups: result.groupCount, dropped: n(result.droppedRows, 0) })}
              icon="table"
              dense
            >
              <div className="scroll-thin max-h-[520px] overflow-auto">
                <table className="w-full min-w-[520px] text-[12px]">
                  <thead className="sticky top-0 z-10 bg-surface-2">
                    <tr className="border-b border-line text-left text-[11px] text-ink-muted">
                      {result.keyColumns.map((k) => (
                        <th key={k} className="px-3 py-2 font-medium">
                          {k}
                        </th>
                      ))}
                      {result.valueColumns.map((v) => (
                        <th key={v} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                          {v}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.index.map((_, i) => (
                      <tr key={i} className="border-b border-line/50 last:border-0 hover:bg-surface-2">
                        {result.keyColumns.map((k) => (
                          <td key={k} className="px-3 py-1.5 font-medium text-ink">
                            {String(rows.require(k).data[i] ?? 'NaN')}
                          </td>
                        ))}
                        {result.valueColumns.map((v) => {
                          const val = rows.require(v).data[i];
                          return (
                            <td key={v} className="tnum px-3 py-1.5 text-right text-ink-soft">
                              {typeof val === 'number' ? n(val, 4) : val === null ? 'NaN' : String(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title={t('ops.codeMirror')} subtitle={t('ops.codeMirrorHint')} icon="code">
              <pre className="scroll-thin mt-2 overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11.5px] text-ink-soft">
                <code>{`df.groupby([${result.keyColumns.map((k) => `"${k}"`).join(', ')}]).agg(\n${result.valueColumns
                  .map((v) => {
                    const [col, fn] = [v.slice(0, v.lastIndexOf('_')), v.slice(v.lastIndexOf('_') + 1)];
                    return `    ${v}=("${col}", "${fn}")`;
                  })
                  .join(',\n')}\n).reset_index()`}</code>
              </pre>
            </Card>
          </div>
        )}
      </SplitView>
    </div>
  );
}

