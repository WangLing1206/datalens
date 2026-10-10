import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { useFrame, useProfile } from '../app/hooks.ts';
import { useUI } from '../app/store.ts';
import { ViewHeader, SplitView, ControlGroup } from '../components/layout/ViewShell.tsx';
import { Badge, Button, Card, EmptyState, Field, NumberInput, Select, Switch, useToast } from '../components/ui/index.tsx';
import { EChart, exportChartImage, useChartTheme } from '../components/charts/EChart.tsx';
import {
  barOption,
  boxOption,
  ecdfOption,
  funnelOption,
  heatmapOption,
  histogramOption,
  lineOption,
  parallelOption,
  pieOption,
  radarOption,
  scatterOption,
  treemapOption,
  violinOption,
} from '../components/charts/builders.ts';
import { ecdf, histogram, kde, lttb, numericValues } from '../core/stats.ts';
import { AGG_FUNCS } from '../core/types.ts';
import type { AggFunc } from '../core/types.ts';
import type { MessageKey } from '../i18n/index.tsx';

type ChartType =
  | 'bar' | 'line' | 'area' | 'scatter' | 'bubble' | 'pie' | 'donut'
  | 'hist' | 'box' | 'violin' | 'heatmap' | 'treemap' | 'radar' | 'parallel' | 'funnel' | 'ecdf';

const CHART_LABEL: Record<ChartType, MessageKey> = {
  bar: 'studio.chartBar',
  line: 'studio.chartLine',
  area: 'studio.chartArea',
  scatter: 'studio.chartScatter',
  bubble: 'studio.chartBubble',
  pie: 'studio.chartPie',
  donut: 'studio.chartDonut',
  hist: 'studio.chartHist',
  box: 'studio.chartBox',
  violin: 'studio.chartViolin',
  heatmap: 'studio.chartHeatmap',
  treemap: 'studio.chartTreemap',
  radar: 'studio.chartRadar',
  parallel: 'studio.chartParallel',
  funnel: 'studio.chartFunnel',
  ecdf: 'studio.chartEcdf',
};

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
  first: 'common.min',
  last: 'common.max',
  mode: 'describe.mode',
};

type SortMode = 'none' | 'x' | 'yDesc' | 'yAsc';

export function StudioView() {
  const { t, n } = useI18n();
  const frame = useFrame();
  const profile = useProfile(frame.frame);
  const theme = useChartTheme();
  const toast = useToast();
  const addChart = useUI((s) => s.addChart);

  const df = frame.frame;

  const [chart, setChart] = useState<ChartType>('bar');
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [series, setSeries] = useState('');
  const [sizeField, setSizeField] = useState('');
  const [agg, setAgg] = useState<AggFunc | 'none'>('mean');
  const [sortMode, setSortMode] = useState<SortMode>('none');
  const [maxItems, setMaxItems] = useState(20);
  const [logX, setLogX] = useState(false);
  const [logY, setLogY] = useState(false);
  const [stacked, setStacked] = useState(false);
  const [showValues, setShowValues] = useState(false);
  const [smooth, setSmooth] = useState(false);
  const holder = useRef<HTMLDivElement | null>(null);

  const numeric = useMemo(() => df?.numericColumnNames() ?? [], [df]);
  const categorical = useMemo(() => df?.categoricalColumns().map((c) => c.name) ?? [], [df]);
  const allCols = useMemo(() => df?.columnNames ?? [], [df]);

  const params = useUI((s) => s.viewParams);
  useEffect(() => {
    if (!df) return;
    const p = params;
    if (p?.chart) setChart(p.chart as ChartType);
    if (p?.x && df.has(String(p.x))) setX(String(p.x));
    if (p?.y && df.has(String(p.y))) setY(String(p.y));
    if (p?.preset === 'relation' && numeric.length >= 2) {
      setChart('scatter');
      setX(numeric[0]);
      setY(numeric[1]);
    }
    if (p) useUI.getState().consumeViewParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, df]);

  // Sensible defaults per chart type.
  useEffect(() => {
    if (!df) return;
    const needsCat = chart === 'bar' || chart === 'pie' || chart === 'donut' || chart === 'funnel' || chart === 'treemap';
    const needsXY = chart === 'scatter' || chart === 'bubble' || chart === 'line' || chart === 'area';
    if (needsCat && (!x || !categorical.includes(x))) setX(categorical[0] ?? allCols[0] ?? '');
    if (needsCat && agg !== 'none' && (!y || !numeric.includes(y))) setY(numeric[0] ?? '');
    if (needsXY) {
      if (!x || !numeric.includes(x)) setX(numeric[0] ?? '');
      if (!y || !numeric.includes(y)) setY(numeric[1] ?? numeric[0] ?? '');
      setAgg('none');
    }
    if (chart === 'hist' || chart === 'box' || chart === 'violin' || chart === 'ecdf') {
      if (!x || !numeric.includes(x)) setX(numeric[0] ?? '');
      if (!y || !numeric.includes(y)) setY(numeric[0] ?? '');
    }
    if (chart === 'heatmap' || chart === 'parallel' || chart === 'radar') {
      if (!x || !numeric.includes(x)) setX(numeric[0] ?? '');
      if (!y || !numeric.includes(y)) setY(numeric[1] ?? numeric[0] ?? '');
      setAgg('none');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, df]);

  /* ---- build the plot data ---------------------------------------- */

  const plot = useMemo(() => {
    if (!df || !x) return null;
    const xIsNumeric = numeric.includes(x);

    // Aggregated categorical plot
    if (agg !== 'none' && !xIsNumeric) {
      const groups = new Map<string, number[]>();
      const seriesMap = series ? new Map<string, Map<string, number[]>>() : null;
      const yv = y && df.has(y) ? df.require(y).data : null;
      const xv = df.require(x).data;
      const sv = series && df.has(series) ? df.require(series).data : null;
      for (let i = 0; i < df.nRows; i++) {
        const k = xv[i];
        if (k === null) continue;
        const key = String(k);
        const val = yv ? yv[i] : 1;
        if (val === null) continue;
        const num = Number(val);
        if (!Number.isFinite(num)) continue;
        if (seriesMap && sv) {
          const sk = sv[i] === null ? 'NaN' : String(sv[i]);
          let inner = seriesMap.get(sk);
          if (!inner) {
            inner = new Map();
            seriesMap.set(sk, inner);
          }
          const arr = inner.get(key);
          if (arr) arr.push(num);
          else inner.set(key, [num]);
        } else {
          const arr = groups.get(key);
          if (arr) arr.push(num);
          else groups.set(key, [num]);
        }
      }
      const reduce = (vals: number[]): number => {
        switch (agg) {
          case 'count': return vals.length;
          case 'sum': return vals.reduce((a, b) => a + b, 0);
          case 'mean': return vals.reduce((a, b) => a + b, 0) / vals.length;
          case 'min': return Math.min(...vals);
          case 'max': return Math.max(...vals);
          case 'nunique': return new Set(vals).size;
          case 'median': {
            const s = [...vals].sort((a, b) => a - b);
            const m = s.length >> 1;
            return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
          }
          case 'std': {
            const m = vals.reduce((a, b) => a + b, 0) / vals.length;
            return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, vals.length - 1));
          }
          default: return vals.reduce((a, b) => a + b, 0) / vals.length;
        }
      };

      let categories = [...groups.keys()];
      if (seriesMap) {
        const all = new Set<string>();
        for (const inner of seriesMap.values()) for (const k of inner.keys()) all.add(k);
        categories = [...all];
      }
      let catSeries: { name: string; data: (number | null)[] }[];
      if (seriesMap) {
        catSeries = [...seriesMap.entries()].map(([name, inner]) => ({
          name,
          data: categories.map((c) => {
            const arr = inner.get(c);
            return arr && arr.length ? reduce(arr) : null;
          }),
        }));
      } else {
        catSeries = [
          {
            name: `${agg}(${y || t('common.rows')})`,
            data: categories.map((c) => {
              const arr = groups.get(c);
              return arr && arr.length ? reduce(arr) : null;
            }),
          },
        ];
      }

      // Sort by the first series' value.
      if (sortMode !== 'none' && catSeries.length) {
        const order = categories.map((_, i) => i);
        order.sort((a, b) => {
          const av = catSeries[0].data[a] ?? 0;
          const bv = catSeries[0].data[b] ?? 0;
          return sortMode === 'x' ? categories[a].localeCompare(categories[b], undefined, { numeric: true }) : sortMode === 'yDesc' ? bv - av : av - bv;
        });
        categories = order.map((i) => categories[i]);
        catSeries = catSeries.map((s) => ({ ...s, data: order.map((i) => s.data[i]) }));
      }
      if (maxItems > 0 && categories.length > maxItems) {
        categories = categories.slice(0, maxItems);
        catSeries = catSeries.map((s) => ({ ...s, data: s.data.slice(0, maxItems) }));
      }
      return { kind: 'category' as const, categories, series: catSeries };
    }

    // Raw numeric plots
    if (xIsNumeric) {
      const xv = df.require(x).data;
      const yv = y && df.has(y) ? df.require(y).data : null;
      const sv = series && df.has(series) ? df.require(series).data : null;
      const zv = sizeField && df.has(sizeField) ? df.require(sizeField).data : null;
      const pts: [number, number][] = [];
      const sizes: number[] = [];
      const groupsMap = new Map<string, [number, number][]>();
      for (let i = 0; i < df.nRows; i++) {
        const xr = xv[i];
        if (xr === null) continue;
        const xn = Number(xr);
        if (!Number.isFinite(xn)) continue;
        const yn = yv ? (yv[i] === null ? NaN : Number(yv[i])) : i;
        if (!Number.isFinite(yn)) continue;
        pts.push([xn, yn]);
        if (zv) {
          const zn = zv[i] === null ? 0 : Number(zv[i]);
          sizes.push(Number.isFinite(zn) ? zn : 0);
        }
        if (sv) {
          const k = sv[i] === null ? 'NaN' : String(sv[i]);
          const arr = groupsMap.get(k);
          if (arr) arr.push([xn, yn]);
          else groupsMap.set(k, [[xn, yn]]);
        }
      }
      return { kind: 'numeric' as const, pts, sizes, groups: groupsMap, hasY: !!yv };
    }

    return null;
  }, [df, x, y, series, sizeField, agg, sortMode, maxItems, numeric, t]);

  const option = useMemo(() => {
    if (!df || !plot || !theme) return null;
    const yName = y || '';

    if (plot.kind === 'category') {
      if (chart === 'pie' || chart === 'donut') {
        const first = plot.series[0];
        if (!first) return null;
        const data = plot.categories.map((c, i) => ({ name: c, value: Number(first.data[i] ?? 0) })).filter((d) => Number.isFinite(d.value));
        return pieOption(theme, { data, donut: chart === 'donut', otherLabel: t('chart.other'), valueFormatter: (v) => n(v, 3) });
      }
      if (chart === 'funnel') {
        const first = plot.series[0];
        if (!first) return null;
        return funnelOption(theme, {
          items: plot.categories.map((c, i) => ({ name: c, value: Number(first.data[i] ?? 0) })),
          valueFormatter: (v) => n(v, 3),
        });
      }
      if (chart === 'treemap') {
        const first = plot.series[0];
        if (!first) return null;
        return treemapOption(theme, {
          items: plot.categories.map((c, i) => ({ name: c, value: Number(first.data[i] ?? 0) })),
          valueFormatter: (v) => n(v, 3),
        });
      }
      if (chart === 'heatmap') {
        return heatmapOption(theme, {
          xLabels: plot.series.map((s) => s.name),
          yLabels: plot.categories,
          cells: plot.categories.map((_, r) => plot.series.map((s) => s.data[r])),
          showValues,
          xName: series,
          yName: x,
          formatter: (v) => n(v, 2),
        });
      }
      return barOption(theme, {
        categories: plot.categories,
        series: plot.series,
        stacked,
        percentStack: false,
        horizontal: plot.categories.length > 14 && !stacked,
        rotateLabels: plot.categories.length > 10 && !(plot.categories.length > 14 && !stacked) ? 32 : 0,
        showValues,
        showLegend: plot.series.length > 1,
        yName,
        logY,
        extraGridBottom: 22,
        valueFormatter: (v) => n(v, 3),
      });
    }

    // numeric
    if (chart === 'hist') {
      const vals = numericValues(df.require(x).data);
      const h = histogram(vals, Math.max(8, Math.min(60, Math.ceil(Math.sqrt(vals.length)))));
      return histogramOption(theme, {
        binEdges: h.binEdges,
        counts: h.counts,
        kdeCurve: kde(vals, 96),
        xName: x,
      });
    }
    if (chart === 'ecdf') {
      const vals = numericValues(df.require(x).data);
      const e = ecdf(vals);
      return ecdfOption(theme, { curves: [{ name: x, x: e.x, y: e.y }], xName: x });
    }
    if (chart === 'box' || chart === 'violin') {
      if (series && plot.groups.size > 1 && plot.groups.size <= 12) {
        const groups = [...plot.groups.entries()].map(([name, pts]) => ({ name, values: pts.map((p) => p[1]) }));
        return chart === 'box'
          ? boxOption(theme, { groups, yName, outlierLabel: t('chart.outlierPoint') })
          : violinOption(theme, { groups, yName });
      }
      const vals = numericValues(df.require(x).data);
      const groups = [{ name: x, values: vals }];
      return chart === 'box'
        ? boxOption(theme, { groups, yName: x, outlierLabel: t('chart.outlierPoint') })
        : violinOption(theme, { groups, yName: x });
    }
    if (chart === 'parallel') {
      const cols = [x, y, ...numeric.filter((c) => c !== x && c !== y).slice(0, 3)].filter((c) => c && df.has(c));
      const rows: number[][] = [];
      const step = Math.max(1, Math.ceil(df.nRows / 1200));
      for (let i = 0; i < df.nRows; i += step) {
        const r = cols.map((c) => {
          const v = df.require(c).data[i];
          return v === null ? NaN : Number(v);
        });
        if (r.every((v) => Number.isFinite(v))) rows.push(r);
      }
      return parallelOption(theme, { dimensions: cols, rows });
    }
    if (chart === 'radar') {
      const cols = [x, y, ...numeric.filter((c) => c !== x && c !== y).slice(0, 4)].filter((c) => c && df.has(c));
      const indicators = cols.map((c) => {
        const vals = numericValues(df.require(c).data);
        return { name: c, max: Math.max(...vals, 0) };
      });
      const groups = series && plot.groups.size > 1 && plot.groups.size <= 6 ? [...plot.groups.entries()] : null;
      const rowsFor = (pts: [number, number][]): number[] =>
        cols.map((_c, ci) => {
          if (ci === 0) return pts.reduce((a, p) => a + p[0], 0) / Math.max(1, pts.length);
          if (ci === 1) return pts.reduce((a, p) => a + p[1], 0) / Math.max(1, pts.length);
          return indicators[ci].max / 2;
        });
      return radarOption(theme, {
        indicators,
        series: groups
          ? groups.map(([name, pts]) => ({ name, values: rowsFor(pts) }))
          : [{ name: t('chart.value'), values: rowsFor(plot.pts) }],
      });
    }
    if (chart === 'line' || chart === 'area') {
      const step = Math.max(1, Math.ceil(plot.pts.length / 2000));
      const sampled = plot.pts.filter((_, i) => i % step === 0);
      if (plot.groups.size > 1 && plot.groups.size <= 10) {
        // Multi-series: align on the shared x axis.
        const xsSorted = [...new Set(sampled.map((p) => p[0]))].sort((a, b) => a - b);
        const seriesList = [...plot.groups.entries()].map(([name, pts]) => {
          const map = new Map(pts.map((p) => [p[0], p[1]]));
          return { name, data: xsSorted.map((v) => (map.has(v) ? (map.get(v) as number) : null)) };
        });
        return lineOption(theme, {
          categories: xsSorted.map((v) => String(Math.round(v * 1000) / 1000)),
          series: seriesList,
          smooth,
          showLegend: true,
          logY,
          rotateLabels: 30,
          extraGridBottom: 22,
          valueFormatter: (v) => n(v, 3),
        });
      }
      const xs = sampled.map((p) => p[0]);
      return lineOption(theme, {
        categories: xs.map((v) => String(Math.round(v * 1000) / 1000)),
        series: [{ name: yName, data: sampled.map((p) => p[1]) }],
        smooth,
        logY,
        rotateLabels: 30,
        extraGridBottom: 22,
        valueFormatter: (v) => n(v, 3),
      });
    }

    // scatter / bubble
    const isBubble = chart === 'bubble' && plot.sizes.length > 0;
    const minS = isBubble ? Math.min(...plot.sizes) : 0;
    const maxS = isBubble ? Math.max(...plot.sizes) : 1;
    const grouped = plot.groups.size > 1 && plot.groups.size <= 8 && !isBubble;
    const samplePts = plot.pts.length > 8000 ? lttb(plot.pts.map((p) => p[0]), plot.pts.map((p) => p[1]), 8000) : null;
    const points: [number, number][] = samplePts ? samplePts.x.map((v, i) => [v, samplePts.y[i]]) : plot.pts;

    return scatterOption(theme, {
      points: grouped ? [] : points,
      groups: grouped ? [...plot.groups.entries()].map(([name, pts]) => ({ name, points: pts.slice(0, 6000) })) : undefined,
      xName: x,
      yName,
      logX,
      logY,
      symbolSize: isBubble
        ? (v: [number, number]) => {
            const idx = plot.pts.findIndex((p) => p[0] === v[0] && p[1] === v[1]);
            const s = idx >= 0 ? plot.sizes[idx] : 0;
            return maxS === minS ? 10 : 6 + ((s - minS) / (maxS - minS)) * 34;
          }
        : 7,
      pointFormatter: (v) => `${x}: <b>${n(v[0], 3)}</b><br/>${yName}: <b>${n(v[1], 3)}</b>`,
    });
  }, [df, plot, theme, chart, x, y, series, stacked, showValues, logX, logY, smooth, n, t]);

  if (!df || !profile) return null;

  const canSave = !!option;

  const columnOptions = allCols.map((c) => ({ value: c, label: c }));
  const numericOptions = [{ value: '', label: t('studio.none') }, ...numeric.map((c) => ({ value: c, label: c }))];
  const seriesOptions = [{ value: '', label: t('studio.none') }, ...categorical.map((c) => ({ value: c, label: c }))];

  const presets: { key: string; labelKey: MessageKey; apply: () => void }[] = [
    {
      key: 'category',
      labelKey: 'studio.presetCategoryValue',
      apply: () => {
        setChart('bar');
        setX(categorical[0] ?? '');
        setY(numeric[0] ?? '');
        setAgg('mean');
        setSortMode('yDesc');
      },
    },
    {
      key: 'trend',
      labelKey: 'studio.presetTrend',
      apply: () => {
        setChart('line');
        const dt = df.datetimeColumns()[0]?.name ?? numeric[0] ?? '';
        setX(dt);
        setY(numeric[0] ?? '');
        setAgg('none');
      },
    },
    {
      key: 'relation',
      labelKey: 'studio.presetRelation',
      apply: () => {
        setChart('scatter');
        setX(numeric[0] ?? '');
        setY(numeric[1] ?? numeric[0] ?? '');
        setAgg('none');
      },
    },
    {
      key: 'distribution',
      labelKey: 'studio.presetDistribution',
      apply: () => {
        setChart('hist');
        setX(numeric[0] ?? '');
        setAgg('none');
      },
    },
    {
      key: 'composition',
      labelKey: 'studio.presetComposition',
      apply: () => {
        setChart('donut');
        setX(categorical[0] ?? '');
        setY(numeric[0] ?? '');
        setAgg('sum');
      },
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader
        titleKey="studio.title"
        subtitleKey="studio.subtitle"
        meta={<Badge tone="accent">{t(CHART_LABEL[chart])}</Badge>}
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              icon="download"
              disabled={!canSave}
              onClick={() => {
                exportChartImage(holder.current, `chart-${chart}.png`);
                toast.show(t('studio.exportPng'), { tone: 'good' });
              }}
            >
              {t('studio.exportPng')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon="plus"
              disabled={!canSave}
              onClick={() => {
                addChart({
                  title: `${t(CHART_LABEL[chart])} · ${x}${y ? ` × ${y}` : ''}`,
                  view: 'studio',
                  config: { chart, x, y, series, agg, sortMode, maxItems, stacked, logX, logY },
                });
                toast.show(t('studio.savedToReport'), { tone: 'good' });
              }}
            >
              {t('studio.saveToReport')}
            </Button>
          </>
        }
      />

      <SplitView
        width={320}
        controls={
          <>
            <ControlGroup titleKey="studio.preset" hintKey="studio.presetHint">
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={p.apply}
                    className="rounded-md border border-line bg-surface-2 px-2 py-1 text-[11.5px] text-ink transition-colors hover:border-accent hover:bg-accent-soft"
                  >
                    {t(p.labelKey)}
                  </button>
                ))}
              </div>
            </ControlGroup>

            <ControlGroup titleKey="studio.chartType">
              <div className="grid grid-cols-3 gap-1">
                {(Object.keys(CHART_LABEL) as ChartType[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChart(c)}
                    className={
                      c === chart
                        ? 'rounded-md bg-accent px-1.5 py-1.5 text-[10.5px] font-medium text-white'
                        : 'rounded-md bg-surface-2 px-1.5 py-1.5 text-[10.5px] text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink'
                    }
                  >
                    {t(CHART_LABEL[c])}
                  </button>
                ))}
              </div>
            </ControlGroup>

            <ControlGroup titleKey="studio.encoding">
              <div className="space-y-3">
                <Field label={t('studio.xAxis')}>
                  <Select value={x} onChange={(e) => setX(e.target.value)} options={columnOptions} placeholder={t('common.column')} />
                </Field>
                <Field label={t('studio.yAxis')}>
                  <Select value={y} onChange={(e) => setY(e.target.value)} options={[{ value: '', label: t('studio.none') }, ...columnOptions]} />
                </Field>
                <Field label={t('studio.seriesField')}>
                  <Select value={series} onChange={(e) => setSeries(e.target.value)} options={seriesOptions} />
                </Field>
                {(chart === 'bubble' || chart === 'scatter') && (
                  <Field label={t('studio.sizeField')}>
                    <Select value={sizeField} onChange={(e) => setSizeField(e.target.value)} options={numericOptions} />
                  </Field>
                )}
                <Field label={t('studio.aggregate')}>
                  <Select
                    value={agg}
                    onChange={(e) => setAgg(e.target.value as AggFunc | 'none')}
                    options={[{ value: 'none', label: t('studio.noAggregate') }, ...AGG_FUNCS.map((f) => ({ value: f, label: t(AGG_LABEL[f]) }))]}
                  />
                </Field>
                <Field label={t('studio.sortBy')}>
                  <Select
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as SortMode)}
                    options={[
                      { value: 'none', label: t('studio.sortNone') },
                      { value: 'x', label: t('studio.sortX') },
                      { value: 'yDesc', label: t('studio.sortDesc') },
                      { value: 'yAsc', label: t('studio.sortAsc') },
                    ]}
                  />
                </Field>
                <Field label={t('studio.maxItems')} inline>
                  <NumberInput value={maxItems} onChange={(v) => setMaxItems(Math.round(v))} min={0} max={200} className="!w-20" />
                </Field>
              </div>
            </ControlGroup>

            <ControlGroup titleKey="studio.appearance">
              <div className="space-y-2.5">
                <Field label={t('studio.logX')} inline>
                  <Switch checked={logX} onChange={setLogX} />
                </Field>
                <Field label={t('studio.logY')} inline>
                  <Switch checked={logY} onChange={setLogY} />
                </Field>
                <Field label={t('common.stacked')} inline>
                  <Switch checked={stacked} onChange={setStacked} />
                </Field>
                <Field label={t('common.showValues')} inline>
                  <Switch checked={showValues} onChange={setShowValues} />
                </Field>
                <Field label={t('studio.smooth')} inline>
                  <Switch checked={smooth} onChange={setSmooth} />
                </Field>
              </div>
            </ControlGroup>
          </>
        }
      >
        <Card
          title={t(CHART_LABEL[chart])}
          subtitle={`${x}${y ? ` × ${y}` : ''}${agg !== 'none' ? ` · ${t(AGG_LABEL[agg as AggFunc])}` : ''}`}
          icon="chart"
          actions={
            plot?.kind === 'numeric' && plot.pts.length > 8000 ? (
              <Badge tone="warn" icon="alert">
                {t('studio.tooManyPoints', { n: n(Math.min(8000, plot.pts.length), 0) })}
              </Badge>
            ) : null
          }
        >
          <div ref={holder}>
            {option ? (
              <EChart height={460} option={option} />
            ) : (
              <EmptyState icon="chart" title={t('chart.noChartData')} hint={t('chart.noChartDataHint')} />
            )}
          </div>
        </Card>

        <div className="mt-4">
          <Card title={t('ops.codeMirror')} subtitle={t('ops.codeMirrorHint')} icon="code">
            <pre className="scroll-thin overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11.5px] text-ink-soft">
              <code>
                {agg === 'none'
                  ? `df.plot.scatter(x="${x}", y="${y}")`
                  : `df.groupby("${x}")["${y || x}"].${agg}().plot(kind="${chart === 'line' ? 'line' : 'bar'}")`}
              </code>
            </pre>
          </Card>
        </div>
      </SplitView>
    </div>
  );
}

