import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as echarts from 'echarts/core';
import {
  BarChart,
  BoxplotChart,
  CustomChart,
  FunnelChart,
  HeatmapChart,
  LineChart,
  ParallelChart,
  PieChart,
  RadarChart,
  ScatterChart,
  TreemapChart,
} from 'echarts/charts';
import {
  BrushComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  ParallelComponent,
  RadarComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { useI18n } from '../../i18n/index.tsx';
import { cx } from '../ui/index.tsx';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  BoxplotChart,
  HeatmapChart,
  TreemapChart,
  RadarChart,
  ParallelChart,
  FunnelChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  DataZoomComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkPointComponent,
  BrushComponent,
  RadarComponent,
  ParallelComponent,
  CanvasRenderer,
  SVGRenderer,
]);

export interface ChartTheme {
  palette: string[];
  grid: string;
  axis: string;
  text: string;
  textMuted: string;
  surface: string;
  surfaceElevated: string;
  line: string;
  accent: string;
  fontFamily: string;
  isDark: boolean;
}

function readTheme(): ChartTheme {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => s.getPropertyValue(name).trim() || fallback;
  return {
    palette: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--viz-${i}`, '#7c6cff')),
    grid: v('--viz-grid', '#1f2735'),
    axis: v('--viz-axis', '#6b788e'),
    text: v('--c-text', '#e8ebf2'),
    textMuted: v('--c-text-muted', '#8592a8'),
    surface: v('--c-surface', '#121722'),
    surfaceElevated: v('--c-bg-elevated', '#10141d'),
    line: v('--c-line', '#232b3a'),
    accent: v('--c-accent', '#7c6cff'),
    fontFamily: s.getPropertyValue('--font-sans').trim() || 'system-ui, sans-serif',
    isDark: document.documentElement.classList.contains('dark'),
  };
}

/** Shared axis/grid/tooltip styling so every chart in the app looks like one family. */
export function baseOption(theme: ChartTheme, opts: { legend?: boolean; grid?: boolean } = {}): EChartsOption {
  return {
    color: theme.palette,
    textStyle: { fontFamily: theme.fontFamily, color: theme.text, fontSize: 12 },
    animationDuration: 340,
    animationEasing: 'cubicOut',
    grid: opts.grid === false ? undefined : { left: 8, right: 14, top: 14, bottom: 6, containLabel: true },
    legend:
      opts.legend === false
        ? undefined
        : {
            type: 'scroll',
            bottom: 0,
            icon: 'roundRect',
            itemWidth: 9,
            itemHeight: 9,
            itemGap: 12,
            textStyle: { color: theme.textMuted, fontSize: 11.5 },
            pageIconColor: theme.textMuted,
            pageTextStyle: { color: theme.textMuted },
          },
    tooltip: {
      trigger: 'item',
      backgroundColor: theme.surfaceElevated,
      borderColor: theme.line,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: theme.text, fontSize: 12, fontFamily: theme.fontFamily },
      extraCssText: 'box-shadow: 0 8px 28px -10px rgba(0,0,0,.45); border-radius: 8px;',
    },
  };
}

export function axisLabel(theme: ChartTheme) {
  return { color: theme.textMuted, fontSize: 11, fontFamily: theme.fontFamily };
}

/**
 * A cheap description of a chart's structure — series types plus axis/renderer
 * counts. Two options with the same shape can be merged safely; different
 * shapes must replace each other outright.
 */
function optionShape(option: EChartsOption): string {
  const series = (option.series as { type?: string }[] | undefined) ?? [];
  const axisCount = (a: unknown): number => (Array.isArray(a) ? a.length : a === undefined ? 0 : 1);
  const polar = option.polar !== undefined ? 1 : 0;
  return [
    Array.isArray(option.series) ? 'a' : 'o',
    series.map((s) => s?.type ?? '?').join(','),
    axisCount(option.xAxis),
    axisCount(option.yAxis),
    polar,
    option.visualMap !== undefined ? 1 : 0,
    option.dataZoom !== undefined ? 1 : 0,
  ].join('|');
}

export function categoryAxis(theme: ChartTheme, data: string[], rotate = 0) {
  return {
    type: 'category' as const,
    data,
    axisLine: { lineStyle: { color: theme.line } },
    axisTick: { show: false },
    axisLabel: {
      ...axisLabel(theme),
      rotate,
      hideOverlap: true,
      // Labelling all 800 rows of a series produces an unreadable smear, so
      // dense axes thin their labels out instead of showing every one.
      interval: (data.length > 24 ? 'auto' : 0) as 0 | 'auto',
      overflow: 'truncate' as const,
      width: 110,
    },
    splitLine: { show: false },
  };
}

export function valueAxis(theme: ChartTheme, name?: string) {
  return {
    type: 'value' as const,
    name,
    // `containLabel` reserves room for the tick labels but not the axis name,
    // so pull the name clear of the plot area.
    nameGap: 14,
    nameTextStyle: { color: theme.textMuted, fontSize: 11 },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: axisLabel(theme),
    splitLine: { lineStyle: { color: theme.grid, type: 'dashed' as const } },
  };
}

export interface EChartProps {
  option: EChartsOption;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
  /** Set when the chart should show the zoom slider. */
  onEvents?: Record<string, (params: unknown) => void>;
  ariaLabel?: string;
  /** Use the SVG renderer — required for the report export to inline vectors. */
  svg?: boolean;
  notMerge?: boolean;
}

export interface ChartHandle {
  instance: echarts.ECharts | null;
  toDataURL: (type?: 'png' | 'jpeg') => string | null;
  toSVG: () => string | null;
}

export function EChart({
  option,
  height = 300,
  className,
  style,
  onEvents,
  ariaLabel,
  svg,
  notMerge,
}: EChartProps) {
  const { lang } = useI18n();
  const holder = useRef<HTMLDivElement | null>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const [ready, setReady] = useState(false);
  const themeKey = useRef<string>('');
  const shapeKey = useRef<string>('');

  // Re-read the design tokens whenever the theme or language changes.
  const theme = useMemo(() => {
    void lang;
    return readTheme();
  }, [lang]);

  useEffect(() => {
    if (!holder.current) return;
    const instance = echarts.init(holder.current, undefined, {
      renderer: svg ? 'svg' : 'canvas',
      useDirtyRect: true,
    });
    chart.current = instance;
    setReady(true);
    const ro = new ResizeObserver(() => instance.resize({ animation: { duration: 160 } }));
    ro.observe(holder.current);
    return () => {
      ro.disconnect();
      instance.dispose();
      chart.current = null;
      setReady(false);
    };
  }, [svg]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance || !ready) return;
    const key = `${theme.isDark}|${lang}`;
    const force = themeKey.current !== key;
    themeKey.current = key;
    // setOption merges by default, so a chart type change would leave the old
    // option's axis/series structure behind (a heatmap inheriting a line
    // chart's `boundaryGap: false`, a second y-axis surviving a switch back to
    // one). Compare a cheap structural signature and start clean when it moves.
    const shape = optionShape(option);
    const shapeChanged = shapeKey.current !== shape;
    shapeKey.current = shape;
    instance.setOption(option, {
      notMerge: force || shapeChanged || notMerge === true,
      lazyUpdate: false,
    });
  }, [option, ready, theme.isDark, lang, notMerge]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance || !onEvents) return;
    for (const [name, handler] of Object.entries(onEvents)) {
      instance.on(name, handler);
    }
    return () => {
      for (const name of Object.keys(onEvents)) instance.off(name);
    };
  }, [onEvents, ready]);

  return (
    <div
      ref={holder}
      role="img"
      aria-label={ariaLabel}
      className={cx('w-full', className)}
      style={{ height, ...style }}
    />
  );
}

/** Imperative access to the underlying instance, for PNG/SVG export. */
export function useChartRef() {
  const ref = useRef<echarts.ECharts | null>(null);
  return ref;
}

/**
 * Read the design tokens as a chart theme, and re-read them whenever the
 * `dark` class flips. Views use this to build options without each of them
 * re-implementing CSS-variable plumbing.
 */
export function useChartTheme(): ChartTheme | null {
  const { lang } = useI18n();
  const [theme, setTheme] = useState<ChartTheme | null>(null);
  useEffect(() => {
    const read = () => setTheme(readTheme());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [lang]);
  return theme;
}

export function exportChartImage(
  container: HTMLElement | null,
  filename: string,
  type: 'png' | 'jpeg' = 'png',
): void {
  if (!container) return;
  const instance = echarts.getInstanceByDom(container);
  if (!instance) return;
  const url = instance.getDataURL({
    type,
    pixelRatio: 2,
    backgroundColor: readTheme().surfaceElevated,
  });
  triggerDownload(url, filename);
}

export function triggerDownload(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadBlob(content: BlobPart, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export { echarts };
export type { EChartsOption };
