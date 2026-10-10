import type { EChartsOption } from 'echarts';
import type { ChartTheme } from './EChart.tsx';
import { axisLabel, baseOption, categoryAxis, valueAxis } from './EChart.tsx';
import type { BoxStats } from '../../core/stats.ts';
import { boxStats, kde, quantile, sortedAsc } from '../../core/stats.ts';

/**
 * Chart option factories.
 *
 * Each builder returns a complete ECharts option so views stay declarative and
 * every chart in the app inherits the same axis, tooltip and legend treatment.
 */

export interface SeriesSpec {
  name: string;
  data: (number | null)[];
  /** Optional per-point colour override (used to highlight anomalies). */
  colors?: string[];
  type?: 'bar' | 'line';
  yAxisIndex?: number;
}

export interface CartesianOptions {
  categories: string[];
  series: SeriesSpec[];
  horizontal?: boolean;
  stacked?: boolean;
  percentStack?: boolean;
  rotateLabels?: number;
  yName?: string;
  xName?: string;
  showLegend?: boolean;
  showValues?: boolean;
  logY?: boolean;
  smooth?: boolean;
  showPoints?: boolean;
  valueFormatter?: (v: number) => string;
  extraGridBottom?: number;
  /** Label for the right-hand axis when series are split across two scales. */
  secondaryName?: string;
}

export function barOption(theme: ChartTheme, o: CartesianOptions): EChartsOption {
  const base = baseOption(theme, { legend: o.series.length > 1 && o.showLegend !== false });
  // Bars sit between gridlines; make it explicit so switching in from a line
  // chart (which sets boundaryGap: false) does not inherit that setting.
  const cat = { ...categoryAxis(theme, o.categories, o.rotateLabels ?? (o.categories.length > 8 ? 30 : 0)), boundaryGap: true };
  const val = valueAxis(theme, o.yName);
  if (o.logY) (val as { type: string }).type = 'log';

  const stackName = o.stacked || o.percentStack ? 'total' : undefined;
  const fmt = o.valueFormatter ?? ((v: number) => String(Math.round(v * 1000) / 1000));

  const series = o.series.map((s, i) => {
    let data = s.data;
    if (o.percentStack) {
      data = o.categories.map((_, ci) => {
        let total = 0;
        for (const ss of o.series) total += ss.data[ci] ?? 0;
        const v = s.data[ci];
        return total === 0 || v === null ? null : v / total;
      });
    }
    return {
      name: s.name,
      type: 'bar' as const,
      yAxisIndex: s.yAxisIndex ?? 0,
      data:
        s.colors && !o.percentStack
          ? data.map((v, di) => ({ value: v, itemStyle: { color: s.colors?.[di] } }))
          : data,
      stack: stackName,
      barMaxWidth: o.horizontal ? 22 : 34,
      barGap: o.stacked ? undefined : '12%',
      itemStyle: { borderRadius: o.stacked ? 2 : o.horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] },
      emphasis: { focus: 'series' as const },
      label:
        o.showValues && data.length <= 30
          ? {
              show: true,
              position: o.horizontal ? ('right' as const) : ('top' as const),
              fontSize: 10,
              color: theme.textMuted,
              formatter: (p: { value: number | null }) =>
                p.value === null || p.value === undefined ? '' : fmt(p.value),
            }
          : { show: false },
      animationDelay: (idx: number) => idx * 18 + i * 8,
    };
  });

  const secondary = o.series.some((s) => s.yAxisIndex === 1);
  const rightAxis = { ...valueAxis(theme, o.secondaryName), position: 'right' as const, splitLine: { show: false } };

  return {
    ...base,
    grid: { left: 8, right: secondary ? 46 : o.showValues && o.horizontal ? 48 : 14, top: 26, bottom: o.extraGridBottom ?? 6, containLabel: true },
    xAxis: o.horizontal ? val : cat,
    yAxis: o.horizontal
      ? secondary
        ? [val, rightAxis]
        : val
      : secondary
        ? [val, rightAxis]
        : val,
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: theme.grid, opacity: 0.4 } },
      valueFormatter: o.percentStack
        ? (v: unknown) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '')
        : (v: unknown) => (typeof v === 'number' ? fmt(v) : ''),
    },
    series: series as EChartsOption['series'],
  };
}

export function lineOption(theme: ChartTheme, o: CartesianOptions): EChartsOption {
  const base = baseOption(theme, { legend: o.series.length > 1 && o.showLegend !== false });
  const cat = categoryAxis(theme, o.categories, o.rotateLabels ?? (o.categories.length > 10 ? 30 : 0));
  const val = valueAxis(theme, o.yName);
  if (o.logY) (val as { type: string }).type = 'log';

  const fmt = o.valueFormatter ?? ((v: number) => String(Math.round(v * 1000) / 1000));

  const secondary = o.series.some((s) => s.yAxisIndex === 1);
  const rightAxis = { ...valueAxis(theme, o.secondaryName), position: 'right' as const, splitLine: { show: false } };

  return {
    ...base,
    grid: { left: 8, right: secondary ? 46 : 14, top: 26, bottom: o.extraGridBottom ?? 6, containLabel: true },
    xAxis: { ...cat, boundaryGap: false },
    yAxis: secondary ? [val, rightAxis] : val,
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: theme.axis, type: 'dashed' } },
      valueFormatter: (v: unknown) => (typeof v === 'number' ? fmt(v) : ''),
    },
    series: o.series.map((s, i) => ({
      name: s.name,
      type: 'line' as const,
      yAxisIndex: s.yAxisIndex ?? 0,
      data: s.data,
      smooth: o.smooth ?? o.categories.length > 40,
      symbol: o.showPoints === false ? 'none' : 'circle',
      symbolSize: o.categories.length > 60 ? 0 : 5,
      showSymbol: o.showPoints !== false && o.categories.length <= 60,
      lineStyle: { width: 2, ...(s.colors ? { color: s.colors[0] } : {}) },
      itemStyle: s.colors ? { color: s.colors[0] } : undefined,
      areaStyle: o.series.length === 1 ? { opacity: 0.1 } : undefined,
      connectNulls: false,
      emphasis: { focus: 'series' as const },
      animationDelay: (idx: number) => idx * 8 + i * 20,
    })) as EChartsOption['series'],
  };
}

export function pieOption(
  theme: ChartTheme,
  o: {
    data: { name: string; value: number }[];
    donut?: boolean;
    showValues?: boolean;
    maxItems?: number;
    otherLabel?: string;
    valueFormatter?: (v: number) => string;
  },
): EChartsOption {
  const base = baseOption(theme, { legend: true, grid: false });
  const fmt = o.valueFormatter ?? ((v: number) => String(Math.round(v * 100) / 100));
  let data = [...o.data].sort((a, b) => b.value - a.value);
  const max = o.maxItems ?? 12;
  if (data.length > max) {
    const head = data.slice(0, max - 1);
    const rest = data.slice(max - 1).reduce((a, b) => a + b.value, 0);
    data = [...head, { name: o.otherLabel ?? 'Other', value: rest }];
  }
  return {
    ...base,
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'item',
      formatter: (p: unknown) => {
        const params = p as { name: string; value: number; percent: number };
        return `${params.name}<br/><b>${fmt(params.value)}</b> · ${params.percent}%`;
      },
    },
    legend: {
      ...(base.legend as object),
      orient: 'vertical',
      right: 0,
      top: 'middle',
      bottom: undefined,
      itemGap: 8,
      formatter: (name: string) => (name.length > 16 ? `${name.slice(0, 15)}…` : name),
    },
    series: [
      {
        type: 'pie',
        radius: o.donut ? ['48%', '74%'] : ['0%', '72%'],
        center: ['38%', '50%'],
        avoidLabelOverlap: true,
        padAngle: 1,
        itemStyle: { borderRadius: 3, borderColor: theme.surface, borderWidth: 1.5 },
        label: o.showValues
          ? {
              show: true,
              fontSize: 11,
              color: theme.textMuted,
              formatter: (p: { name: string; percent?: number }) =>
                `${p.name.length > 10 ? `${p.name.slice(0, 9)}…` : p.name} ${p.percent ?? 0}%`,
            }
          : { show: false },
        labelLine: { show: o.showValues, length: 8, length2: 8, lineStyle: { color: theme.axis } },
        emphasis: { scale: true, scaleSize: 4, label: { show: true, fontWeight: 'bold' } },
        data,
      },
    ],
  };
}

export function scatterOption(
  theme: ChartTheme,
  o: {
    points: [number, number][];
    name?: string;
    xName?: string;
    yName?: string;
    groups?: { name: string; points: [number, number][] }[];
    symbolSize?: number | ((v: [number, number]) => number);
    logX?: boolean;
    logY?: boolean;
    fitLine?: { x: number[]; y: number[]; label: string };
    pointFormatter?: (v: number[]) => string;
    colorByIndex?: string[];
    opacity?: number;
  },
): EChartsOption {
  const base = baseOption(theme, { legend: !!o.groups && o.groups.length > 1, grid: true });
  const xAxis = { ...valueAxis(theme, o.xName), scale: true };
  const yAxis = { ...valueAxis(theme, o.yName), scale: true };
  if (o.logX) (xAxis as { type: string }).type = 'log';
  if (o.logY) (yAxis as { type: string }).type = 'log';

  const series: Record<string, unknown>[] = [];
  if (o.groups && o.groups.length > 0) {
    o.groups.forEach((g, i) => {
      series.push({
        name: g.name,
        type: 'scatter',
        data: g.points,
        symbolSize: typeof o.symbolSize === 'function' ? undefined : o.symbolSize ?? 8,
        itemStyle: { opacity: o.opacity ?? 0.72, color: o.colorByIndex?.[i] },
        emphasis: { focus: 'series' },
      });
    });
  } else {
    series.push({
      name: o.name ?? '',
      type: 'scatter',
      data: o.points,
      symbolSize: typeof o.symbolSize === 'function' ? o.symbolSize : o.symbolSize ?? 7,
      itemStyle: { opacity: o.opacity ?? 0.66 },
      emphasis: { focus: 'series' },
      large: o.points.length > 2000,
      largeThreshold: 2000,
    });
  }

  if (o.fitLine) {
    series.push({
      name: o.fitLine.label,
      type: 'line',
      data: o.fitLine.x.map((x, i) => [x, o.fitLine!.y[i]]),
      smooth: false,
      symbol: 'none',
      lineStyle: { width: 2, color: theme.palette[6], type: 'dashed' },
      z: 10,
    });
  }

  return {
    ...base,
    grid: { left: 8, right: 16, top: 26, bottom: 6, containLabel: true },
    xAxis,
    yAxis,
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'item',
      formatter: (p: unknown) => {
        const params = p as { seriesName: string; value: number[] };
        if (!Array.isArray(params.value)) return '';
        const body = o.pointFormatter
          ? o.pointFormatter(params.value)
          : `${o.xName ?? 'x'}: <b>${round(params.value[0])}</b><br/>${o.yName ?? 'y'}: <b>${round(params.value[1])}</b>`;
        return params.seriesName ? `${params.seriesName}<br/>${body}` : body;
      },
    },
    series: series as EChartsOption['series'],
  };
}

function round(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return String(Math.round(v * 1000) / 1000);
}

export function histogramOption(
  theme: ChartTheme,
  o: {
    binEdges: number[];
    counts: number[];
    xName?: string;
    yName?: string;
    kdeCurve?: { x: number[]; y: number[] };
    meanLine?: number;
    medianLine?: number;
    labels?: { mean: string; median: string };
    showKde?: boolean;
    density?: boolean;
  },
): EChartsOption {
  const base = baseOption(theme, { legend: false });
  const total = o.counts.reduce((a, b) => a + b, 0) || 1;
  const labels = o.binEdges.slice(0, -1).map((lo, i) => `${round(lo)}–${round(o.binEdges[i + 1])}`);
  const values = o.density ? o.counts.map((c) => c / total) : o.counts;

  const markLines: Record<string, unknown>[] = [];
  if (o.meanLine !== undefined && Number.isFinite(o.meanLine)) {
    markLines.push({
      xAxis: o.meanLine,
      label: { formatter: o.labels?.mean ?? 'mean', fontSize: 10, color: theme.palette[6] },
      lineStyle: { color: theme.palette[6], type: 'dashed', width: 1.5 },
    });
  }
  if (o.medianLine !== undefined && Number.isFinite(o.medianLine)) {
    markLines.push({
      xAxis: o.medianLine,
      label: { formatter: o.labels?.median ?? 'median', fontSize: 10, color: theme.palette[4] },
      lineStyle: { color: theme.palette[4], type: 'dotted', width: 1.5 },
    });
  }

  // Category axis keyed on bin centre keeps the bars aligned with the KDE line,
  // so the density curve is resampled at those same centres.
  const centers = o.binEdges.slice(0, -1).map((lo, i) => (lo + o.binEdges[i + 1]) / 2);

  let kdeData: number[] | null = null;
  if (o.kdeCurve && o.kdeCurve.x.length && o.showKde !== false) {
    const sampled = centers.map((c) => sampleCurve(o.kdeCurve!, c));
    const maxKde = Math.max(...sampled);
    const maxBar = Math.max(...values);
    // Put the density on the count axis so a single y-axis serves both series.
    const scale = o.density ? 1 : maxKde > 0 ? (maxBar * 0.9) / maxKde : 1;
    kdeData = sampled.map((v) => v * scale);
  }

  return {
    ...base,
    grid: { left: 8, right: 14, top: 26, bottom: 6, containLabel: true },
    xAxis: { ...categoryAxis(theme, labels), axisLabel: { ...axisLabel(theme), rotate: labels.length > 12 ? 30 : 0 } },
    yAxis: valueAxis(theme, o.yName),
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (p: unknown) => {
        const arr = p as { axisValue: string; seriesName: string; value: number }[];
        if (!Array.isArray(arr) || arr.length === 0) return '';
        const bar = arr.find((a) => a.seriesName !== 'kde');
        return `${o.xName ?? ''} ${arr[0].axisValue}<br/>${bar ? `${bar.seriesName}: <b>${round(bar.value)}</b>` : ''}`;
      },
    },
    series: [
      {
        name: o.yName ?? 'count',
        type: 'bar',
        data: values,
        barCategoryGap: '2%',
        itemStyle: { borderRadius: [2, 2, 0, 0], opacity: 0.88 },
        ...(markLines.length ? { markLine: { silent: true, symbol: 'none', data: markLines } } : {}),
      },
      ...(kdeData
        ? [
            {
              name: 'kde',
              type: 'line' as const,
              smooth: true,
              symbol: 'none',
              data: kdeData,
              lineStyle: { width: 2, color: theme.palette[5] },
              z: 5,
            },
          ]
        : []),
    ] as EChartsOption['series'],
  };
}

/** Linear interpolation of a sampled curve at an arbitrary x. */
function sampleCurve(curve: { x: number[]; y: number[] }, x: number): number {
  const xs = curve.x;
  if (xs.length === 0) return 0;
  if (x <= xs[0]) return curve.y[0];
  if (x >= xs[xs.length - 1]) return curve.y[curve.y.length - 1];
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = xs[hi] - xs[lo] || 1;
  return curve.y[lo] + ((x - xs[lo]) / span) * (curve.y[hi] - curve.y[lo]);
}

export function boxOption(
  theme: ChartTheme,
  o: {
    groups: { name: string; values: number[] }[];
    horizontal?: boolean;
    yName?: string;
    outlierLabel?: string;
  },
): EChartsOption {
  const base = baseOption(theme, { legend: false });
  const stats: BoxStats[] = o.groups.map((g) => boxStats(g.values));
  // ECharts boxplot wants [min, Q1, median, Q3, max] in that order.
  const boxData = stats.map((s) => [s.lowerFence, s.q1, s.median, s.q3, s.upperFence]);
  const outliers = stats.map((s, i) =>
    s.outliers.map((v) => [i, v]),
  );

  const cat = categoryAxis(theme, o.groups.map((g) => g.name), o.groups.length > 8 ? 30 : 0);
  const val = valueAxis(theme, o.yName);

  return {
    ...base,
    grid: { left: 8, right: 14, top: 26, bottom: 6, containLabel: true },
    xAxis: o.horizontal ? val : cat,
    yAxis: o.horizontal ? cat : val,
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'item',
      formatter: (p: unknown) => {
        const params = p as { seriesType: string; name: string; value: number[] };
        if (params.seriesType === 'scatter') {
          const v = Array.isArray(params.value) ? params.value[1] : params.value;
          return `${o.outlierLabel ?? 'outlier'}: <b>${round(Number(v))}</b>`;
        }
        const [, min, q1, med, q3, max] = params.value as unknown as [number, number, number, number, number, number];
        return [
          `<b>${o.groups[params.value[0] as unknown as number]?.name ?? params.name}</b>`,
          `max ${round(max)}`,
          `Q3 ${round(q3)}`,
          `median ${round(med)}`,
          `Q1 ${round(q1)}`,
          `min ${round(min)}`,
        ].join('<br/>');
      },
    },
    series: [
      {
        name: 'box',
        type: 'boxplot',
        data: boxData,
        boxWidth: [12, 42],
        itemStyle: { color: theme.palette[0], opacity: 0.22, borderColor: theme.palette[0], borderWidth: 1.5 },
        emphasis: { itemStyle: { opacity: 0.34 } },
      },
      {
        name: o.outlierLabel ?? 'outlier',
        type: 'scatter',
        data: outliers.flat(),
        symbolSize: 4,
        itemStyle: { color: theme.palette[6], opacity: 0.6 },
        tooltip: { trigger: 'item' },
      },
    ] as EChartsOption['series'],
  };
}

/** Violin plots drawn as custom polygons on top of a thin box. */
export function violinOption(
  theme: ChartTheme,
  o: { groups: { name: string; values: number[] }[]; yName?: string; width?: number },
): EChartsOption {
  const base = baseOption(theme, { legend: false });
  const width = o.width ?? 0.42;
  const profiles = o.groups.map((g) => {
    const s = sortedAsc(g.values);
    if (s.length < 3) return { name: g.name, outline: [] as [number, number][], box: null as null | number[] };
    const k = kde(s, 64);
    const maxD = Math.max(...k.y) || 1;
    const lo = s[0];
    const hi = s[s.length - 1];
    const span = hi - lo || 1;
    const outline: [number, number][] = [];
    for (let i = 0; i < k.x.length; i++) {
      const half = ((k.y[i] / maxD) * width) / 2;
      outline.push([-half, k.x[i]]);
    }
    for (let i = k.x.length - 1; i >= 0; i--) {
      const half = ((k.y[i] / maxD) * width) / 2;
      outline.push([half, k.x[i]]);
    }
    void span;
    return { name: g.name, outline, box: [quantile(s, 0.25), quantile(s, 0.5), quantile(s, 0.75)] };
  });

  const boxData = profiles.map((p) => (p.box ? p.box : [NaN, NaN, NaN]));

  return {
    ...base,
    grid: { left: 8, right: 14, top: 26, bottom: 6, containLabel: true },
    xAxis: categoryAxis(theme, o.groups.map((g) => g.name), o.groups.length > 8 ? 30 : 0),
    yAxis: valueAxis(theme, o.yName),
    tooltip: { ...(base.tooltip as object), trigger: 'item' },
    series: [
      {
        name: 'violin',
        type: 'custom',
        renderItem: (params: unknown, api: unknown) => {
          const p = params as { dataIndex: number };
          const a = api as {
            coord: (v: number[]) => number[];
            value: (i: number) => number;
            style: () => Record<string, unknown>;
          };
          const outline = profiles[p.dataIndex]?.outline ?? [];
          if (outline.length === 0) return null;
          const pts = outline.map(([dx, y]) => {
            const c = a.coord([a.value(0) + dx, y]);
            return [c[0], c[1]];
          });
          return {
            type: 'polygon',
            shape: { points: pts },
            style: {
              fill: theme.palette[0],
              opacity: 0.22,
              stroke: theme.palette[0],
              lineWidth: 1.4,
            },
          };
        },
        data: o.groups.map((_, i) => i),
        silent: true,
        z: 2,
      },
      {
        name: 'box',
        type: 'custom',
        renderItem: (params: unknown, api: unknown) => {
          const p = params as { dataIndex: number };
          const a = api as { coord: (v: number[]) => number[]; value: (i: number) => number };
          const b = profiles[p.dataIndex]?.box;
          if (!b) return null;
          const x = a.value(0);
          const w = width * 0.28;
          const [q1, med, q3] = b;
          const top = a.coord([x, q3]);
          const bot = a.coord([x, q1]);
          const mid = a.coord([x, med]);
          const left = a.coord([x - w, q3])[0];
          const right = a.coord([x + w, q3])[0];
          return {
            type: 'group',
            children: [
              {
                type: 'rect',
                shape: { x: left, y: top[1], width: right - left, height: bot[1] - top[1] },
                style: { fill: theme.surfaceElevated, stroke: theme.text, lineWidth: 1.2, opacity: 0.9 },
              },
              {
                type: 'line',
                shape: { x1: left, y1: mid[1], x2: right, y2: mid[1] },
                style: { stroke: theme.palette[6], lineWidth: 2 },
              },
            ],
          };
        },
        data: o.groups.map((_, i) => i),
        silent: true,
        z: 3,
      },
      {
        name: 'values',
        type: 'scatter',
        data: boxData.map((b, i) => [i, b[1]]),
        symbolSize: 0,
        tooltip: {
          formatter: (p: unknown) => {
            const params = p as { value: number[] };
            const g = o.groups[params.value[0]];
            if (!g) return '';
            const s = boxStats(g.values);
            return [
              `<b>${g.name}</b>`,
              `n ${s.n}`,
              `median ${round(s.median)}`,
              `Q1 ${round(s.q1)} · Q3 ${round(s.q3)}`,
            ].join('<br/>');
          },
        },
      },
    ] as EChartsOption['series'],
  };
}

export function heatmapOption(
  theme: ChartTheme,
  o: {
    xLabels: string[];
    yLabels: string[];
    cells: (number | null)[][];
    xName?: string;
    yName?: string;
    min?: number;
    max?: number;
    showValues?: boolean;
    formatter?: (v: number) => string;
    /** Diverging scale for correlation-style matrices. */
    diverging?: boolean;
    colors?: [string, string];
  },
): EChartsOption {
  const base = baseOption(theme, { legend: false, grid: false });
  const flat = o.cells.flat().filter((v): v is number => v !== null && Number.isFinite(v));
  const min = o.min ?? (flat.length ? Math.min(...flat) : 0);
  const max = o.max ?? (flat.length ? Math.max(...flat) : 1);
  const fmt = o.formatter ?? ((v: number) => round(v));

  const data: [number, number, number | null][] = [];
  for (let y = 0; y < o.yLabels.length; y++) {
    for (let x = 0; x < o.xLabels.length; x++) {
      data.push([x, y, o.cells[y]?.[x] ?? null]);
    }
  }

  const lowColor = o.colors?.[0] ?? theme.surface;
  const highColor = o.colors?.[1] ?? theme.palette[0];

  return {
    ...base,
    // Leave room on the right for the vertical colour scale, otherwise it
    // draws on top of the last data column.
    grid: {
      left: 8,
      right: o.diverging ? 16 : 58,
      top: o.yName ? 28 : 12,
      bottom: o.xLabels.length > 10 ? 44 : o.diverging ? 34 : 24,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: o.xLabels,
      name: o.xName,
      // ECharts merges successive options into one instance, so an axis this
      // chart needs `boundaryGap: true` on must say so: a previous line chart
      // leaves `boundaryGap: false` behind, which makes a cartesian heatmap throw.
      boundaryGap: true,
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: { color: theme.textMuted, fontSize: 11 },
      splitArea: { show: true },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        ...axisLabel(theme),
        rotate: o.xLabels.length > 6 ? 38 : 0,
        // Thin the labels out on large matrices, otherwise they overlap into an
        // unreadable band.
        interval: (o.xLabels.length > 24 ? 'auto' : 0) as 0 | 'auto',
        overflow: 'truncate',
        width: 92,
      },
    },
    yAxis: {
      type: 'category',
      data: o.yLabels,
      name: o.yName,
      boundaryGap: true,
      splitArea: { show: true },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        ...axisLabel(theme),
        interval: (o.yLabels.length > 24 ? 'auto' : 0) as 0 | 'auto',
        overflow: 'truncate',
        width: 110,
      },
    },
    visualMap: o.diverging
      ? {
          min: -1,
          max: 1,
          calculable: false,
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          itemWidth: 11,
          itemHeight: 90,
          textStyle: { color: theme.textMuted, fontSize: 10.5 },
          inRange: { color: [theme.palette[7], theme.surface, theme.palette[6]] },
        }
      : {
          min,
          max,
          calculable: false,
          orient: 'vertical',
          right: 4,
          top: 'middle',
          itemWidth: 10,
          itemHeight: 96,
          textStyle: { color: theme.textMuted, fontSize: 10.5 },
          inRange: { color: [lowColor, highColor] },
        },
    tooltip: {
      ...(base.tooltip as object),
      formatter: (p: unknown) => {
        const params = p as { value: [number, number, number | null] };
        const [x, y, v] = params.value;
        if (v === null || v === undefined) return `${o.yLabels[y]} × ${o.xLabels[x]}<br/>—`;
        return `${o.yLabels[y]} × ${o.xLabels[x]}<br/><b>${fmt(v)}</b>`;
      },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: {
          show: o.showValues ?? false,
          fontSize: 10,
          color: theme.text,
          formatter: (p: unknown) => {
            const v = (p as { value: [number, number, number | null] }).value[2];
            return v === null || v === undefined ? '' : fmt(v);
          },
        },
        itemStyle: { borderColor: theme.surface, borderWidth: 1.5, borderRadius: 2 },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,.3)' } },
        progressive: 2000,
      },
    ] as EChartsOption['series'],
  };
}

export function ecdfOption(
  theme: ChartTheme,
  o: { curves: { name: string; x: number[]; y: number[] }[]; xName?: string; yName?: string },
): EChartsOption {
  const base = baseOption(theme, { legend: o.curves.length > 1 });
  return {
    ...base,
    grid: { left: 8, right: 16, top: 26, bottom: 6, containLabel: true },
    xAxis: { ...valueAxis(theme, o.xName), scale: true },
    yAxis: {
      ...valueAxis(theme, o.yName ?? 'F(x)'),
      min: 0,
      max: 1,
      axisLabel: { ...axisLabel(theme), formatter: (v: number) => `${Math.round(v * 100)}%` },
    },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'axis',
      valueFormatter: (v: unknown) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : ''),
    },
    series: o.curves.map((c) => ({
      name: c.name,
      type: 'line' as const,
      data: c.x.map((x, i) => [x, c.y[i]]),
      smooth: false,
      symbol: 'none',
      lineStyle: { width: 2 },
      step: 'end' as const,
    })) as EChartsOption['series'],
  };
}

export function treemapOption(
  theme: ChartTheme,
  o: { items: { name: string; value: number }[]; valueFormatter?: (v: number) => string },
): EChartsOption {
  const base = baseOption(theme, { legend: false, grid: false });
  const fmt = o.valueFormatter ?? ((v: number) => round(v));
  return {
    ...base,
    tooltip: {
      ...(base.tooltip as object),
      formatter: (p: unknown) => {
        const params = p as { name: string; value: number };
        return `${params.name}<br/><b>${fmt(params.value)}</b>`;
      },
    },
    series: [
      {
        type: 'treemap',
        data: o.items,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: '100%',
        height: '100%',
        top: 2,
        left: 2,
        right: 2,
        bottom: 2,
        itemStyle: { borderColor: theme.surface, borderWidth: 2, gapWidth: 2, borderRadius: 4 },
        label: {
          show: true,
          fontSize: 11.5,
          color: '#fff',
          formatter: (p: { name: string }) => (p.name.length > 14 ? `${p.name.slice(0, 13)}…` : p.name),
        },
        upperLabel: { show: false },
      },
    ] as EChartsOption['series'],
  };
}

export function radarOption(
  theme: ChartTheme,
  o: { indicators: { name: string; max: number }[]; series: { name: string; values: number[] }[] },
): EChartsOption {
  const base = baseOption(theme, { legend: o.series.length > 1, grid: false });
  return {
    ...base,
    tooltip: { ...(base.tooltip as object), trigger: 'item' },
    radar: {
      indicator: o.indicators,
      radius: '66%',
      center: ['50%', '50%'],
      splitNumber: 4,
      axisName: { color: theme.textMuted, fontSize: 11 },
      splitLine: { lineStyle: { color: theme.grid } },
      splitArea: { areaStyle: { color: ['transparent'] } },
      axisLine: { lineStyle: { color: theme.grid } },
    },
    series: [
      {
        type: 'radar',
        data: o.series.map((s) => ({
          name: s.name,
          value: s.values,
          areaStyle: { opacity: 0.16 },
          lineStyle: { width: 2 },
          symbolSize: 4,
        })),
        emphasis: { focus: 'series' },
      },
    ] as EChartsOption['series'],
  };
}

export function parallelOption(
  theme: ChartTheme,
  o: { dimensions: string[]; rows: number[][]; colorBy?: number[]; categories?: string[] },
): EChartsOption {
  const base = baseOption(theme, { legend: false, grid: false });
  const mins = o.dimensions.map((_, i) => Math.min(...o.rows.map((r) => r[i])));
  const maxs = o.dimensions.map((_, i) => Math.max(...o.rows.map((r) => r[i])));

  return {
    ...base,
    tooltip: { ...(base.tooltip as object), trigger: 'item' },
    parallel: {
      left: 40,
      right: 40,
      top: 26,
      bottom: 22,
      parallelAxisDefault: {
        type: 'value',
        nameLocation: 'start',
        nameTextStyle: { color: theme.textMuted, fontSize: 10.5 },
        axisLine: { lineStyle: { color: theme.grid } },
        axisLabel: { color: theme.textMuted, fontSize: 9.5 },
        splitLine: { show: false },
      },
    },
    parallelAxis: o.dimensions.map((d, i) => ({
      dim: i,
      name: d.length > 12 ? `${d.slice(0, 11)}…` : d,
      min: mins[i],
      max: maxs[i],
    })),
    visualMap: o.colorBy
      ? {
          show: false,
          min: Math.min(...o.colorBy),
          max: Math.max(...o.colorBy),
          dimension: o.dimensions.length,
          inRange: { color: theme.palette },
        }
      : undefined,
    series: [
      {
        type: 'parallel',
        smooth: true,
        lineStyle: { width: 1.2, opacity: 0.28 },
        emphasis: { lineStyle: { width: 2.4, opacity: 0.85 } },
        progressive: 1500,
        data: o.colorBy ? o.rows.map((r, i) => [...r, o.colorBy![i]]) : o.rows,
      },
    ] as EChartsOption['series'],
  };
}

export function funnelOption(
  theme: ChartTheme,
  o: { items: { name: string; value: number }[]; valueFormatter?: (v: number) => string },
): EChartsOption {
  const base = baseOption(theme, { legend: false, grid: false });
  const fmt = o.valueFormatter ?? ((v: number) => round(v));
  return {
    ...base,
    tooltip: {
      ...(base.tooltip as object),
      formatter: (p: unknown) => {
        const params = p as { name: string; value: number };
        return `${params.name}<br/><b>${fmt(params.value)}</b>`;
      },
    },
    series: [
      {
        type: 'funnel',
        left: '8%',
        right: '8%',
        top: 12,
        bottom: 12,
        minSize: '22%',
        gap: 2,
        label: { position: 'inside', fontSize: 11.5, color: '#fff' },
        itemStyle: { borderColor: theme.surface, borderWidth: 1.5, borderRadius: 3 },
        data: o.items,
      },
    ] as EChartsOption['series'],
  };
}

/** Ridgeline: one overlaid density curve per group, offset vertically. */
export function ridgeOption(
  theme: ChartTheme,
  o: { groups: { name: string; values: number[] }[]; xName?: string; bandwidthScale?: number },
): EChartsOption {
  const base = baseOption(theme, { legend: false });
  const all = o.groups.flatMap((g) => g.values);
  if (all.length === 0) return base;
  const lo = Math.min(...all);
  const hi = Math.max(...all);

  const curves = o.groups.map((g) => {
    const k = kde(g.values, 96);
    const maxY = Math.max(...k.y) || 1;
    return { name: g.name, x: k.x, y: k.y.map((v) => v / maxY) };
  });

  return {
    ...base,
    grid: { left: 8, right: 16, top: 20, bottom: 6, containLabel: true },
    xAxis: { ...valueAxis(theme, o.xName), min: lo, max: hi, scale: true },
    yAxis: {
      ...valueAxis(theme),
      min: 0,
      max: curves.length + 0.4,
      axisLabel: { show: false },
      splitLine: { show: false },
      axisLine: { show: false },
    },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'item',
      formatter: (p: unknown) => {
        const params = p as { seriesName: string; value: number[] };
        if (!Array.isArray(params.value)) return '';
        return `${params.seriesName}<br/>${o.xName ?? 'x'}: <b>${round(params.value[0])}</b>`;
      },
    },
    series: curves.map((c, i) => ({
      name: c.name,
      type: 'line' as const,
      data: c.x.map((x, j) => [x, c.y[j] * 0.92 + i]),
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 1.8, opacity: 0.95 },
      areaStyle: { opacity: 0.2, origin: 'start' },
      silent: false,
      z: curves.length - i,
    })) as EChartsOption['series'],
  };
}

/** Autocorrelation bars with the 95% confidence band marked. */
export function acfOption(
  theme: ChartTheme,
  o: { lags: number[]; values: number[]; xName?: string; band?: number },
): EChartsOption {
  const base = baseOption(theme, { legend: false });
  return {
    ...base,
    grid: { left: 8, right: 16, top: 26, bottom: 6, containLabel: true },
    xAxis: { ...categoryAxis(theme, o.lags.map(String)), name: o.xName ?? 'lag' },
    yAxis: { ...valueAxis(theme), min: -1, max: 1 },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'axis',
      valueFormatter: (v: unknown) => (typeof v === 'number' ? v.toFixed(3) : ''),
    },
    series: [
      {
        type: 'bar',
        data: o.values.map((v) => ({
          value: v,
          itemStyle: { color: Math.abs(v) > (o.band ?? 0.1) ? theme.palette[0] : theme.axis },
        })),
        barMaxWidth: 16,
        itemStyle: { borderRadius: 2 },
        markLine:
          o.band !== undefined
            ? {
                silent: true,
                symbol: 'none',
                label: { show: false },
                data: [
                  { yAxis: o.band, lineStyle: { color: theme.palette[6], type: 'dashed', width: 1 } },
                  { yAxis: -o.band, lineStyle: { color: theme.palette[6], type: 'dashed', width: 1 } },
                ],
              }
            : undefined,
      },
    ] as EChartsOption['series'],
  };
}

/** Scree plot for PCA. */
export function screeOption(
  theme: ChartTheme,
  o: { labels: string[]; explained: number[]; cumulative: number[]; labels2?: { explained: string; cumulative: string } },
): EChartsOption {
  const base = baseOption(theme, { legend: true });
  return {
    ...base,
    grid: { left: 8, right: 46, top: 26, bottom: 6, containLabel: true },
    xAxis: categoryAxis(theme, o.labels),
    yAxis: [
      {
        ...valueAxis(theme),
        min: 0,
        max: Math.max(1, Math.max(...o.explained) * 1.2),
        axisLabel: { ...axisLabel(theme), formatter: (v: number) => `${Math.round(v * 100)}%` },
      },
      {
        ...valueAxis(theme),
        min: 0,
        max: 1,
        position: 'right',
        splitLine: { show: false },
        axisLabel: { ...axisLabel(theme), formatter: (v: number) => `${Math.round(v * 100)}%` },
      },
    ],
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'axis',
      valueFormatter: (v: unknown) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : ''),
    },
    series: [
      {
        name: o.labels2?.explained ?? 'explained',
        type: 'bar',
        data: o.explained,
        barMaxWidth: 28,
        itemStyle: { borderRadius: [3, 3, 0, 0] },
      },
      {
        name: o.labels2?.cumulative ?? 'cumulative',
        type: 'line',
        yAxisIndex: 1,
        data: o.cumulative,
        smooth: true,
        symbolSize: 6,
        lineStyle: { width: 2, color: theme.palette[6] },
        itemStyle: { color: theme.palette[6] },
      },
    ] as EChartsOption['series'],
  };
}

/** Elbow curve for choosing K. */
export function elbowOption(
  theme: ChartTheme,
  o: { k: number[]; inertia: number[]; silhouette: number[]; xName?: string },
): EChartsOption {
  const base = baseOption(theme, { legend: true });
  return {
    ...base,
    grid: { left: 8, right: 46, top: 26, bottom: 6, containLabel: true },
    xAxis: { ...categoryAxis(theme, o.k.map(String)), name: o.xName ?? 'K' },
    yAxis: [
      { ...valueAxis(theme), name: 'inertia' },
      { ...valueAxis(theme), min: 0, max: 1, position: 'right', splitLine: { show: false }, name: 'silhouette' },
    ],
    tooltip: { ...(base.tooltip as object), trigger: 'axis' },
    series: [
      {
        name: 'inertia',
        type: 'line',
        data: o.inertia,
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 2.2 },
        areaStyle: { opacity: 0.1 },
      },
      {
        name: 'silhouette',
        type: 'line',
        yAxisIndex: 1,
        data: o.silhouette,
        smooth: true,
        symbolSize: 7,
        lineStyle: { width: 2, color: theme.palette[3], type: 'dashed' },
        itemStyle: { color: theme.palette[3] },
      },
    ] as EChartsOption['series'],
  };
}

export { kde };
