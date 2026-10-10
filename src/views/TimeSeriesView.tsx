import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { useFrame, useProfile } from '../app/hooks.ts';
import { useUI } from '../app/store.ts';
import { usePipeline } from '../pipeline/store.ts';
import { loadSample } from '../app/datasets.ts';
import { clearProfileCache } from '../app/hooks.ts';
import { ViewHeader, SplitView, ControlGroup } from '../components/layout/ViewShell.tsx';
import { Badge, Button, Callout, Card, EmptyState, Field, NumberInput, Segmented, Select, StatTile, Switch, cx, useToast } from '../components/ui/index.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { EChart, useChartTheme } from '../components/charts/EChart.tsx';
import { acfOption, barOption, lineOption } from '../components/charts/builders.ts';
import {
  autocorrelation,
  candidateTimeColumns,
  decompose,
  resample,
  seasonality,
  transformSeries,
} from '../core/timeseries.ts';
import type { Freq, SeasonPart, TransformOp, WindowFunc } from '../core/timeseries.ts';
import { forecast } from '../core/advanced.ts';
import type { ForecastModel } from '../core/advanced.ts';
import { AGG_FUNCS } from '../core/types.ts';
import type { AggFunc } from '../core/types.ts';
import type { MessageKey } from '../i18n/index.tsx';

const FREQ_LABEL: Record<Freq, MessageKey> = {
  hour: 'timeseries.freqHour',
  day: 'timeseries.freqDay',
  week: 'timeseries.freqWeek',
  month: 'timeseries.freqMonth',
  quarter: 'timeseries.freqQuarter',
  year: 'timeseries.freqYear',
};

const PART_LABEL: Record<SeasonPart, MessageKey> = {
  monthOfYear: 'timeseries.monthOfYear',
  dayOfWeek: 'timeseries.dayOfWeek',
  hourOfDay: 'timeseries.hourOfDay',
  weekOfYear: 'timeseries.weekOfYear',
  quarterOfYear: 'timeseries.quarterOfYear',
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

const WINDOW_LABEL: Record<WindowFunc, MessageKey> = {
  mean: 'timeseries.rollingMean',
  sum: 'timeseries.rollingSum',
  std: 'timeseries.rollingStd',
  min: 'timeseries.rollingMin',
  max: 'timeseries.rollingMax',
  median: 'common.median',
  count: 'common.count',
};

const TRANSFORM_LABEL: Record<TransformOp, MessageKey> = {
  diff: 'timeseries.diff',
  pct_change: 'timeseries.pctChange',
  shift: 'timeseries.shift',
  cumsum: 'timeseries.cumsum',
  cummax: 'timeseries.cummax',
  cummin: 'timeseries.cummin',
  log: 'timeseries.logTransform',
};

export function TimeSeriesView() {
  const { t, n, pct } = useI18n();
  const frame = useFrame();
  const profile = useProfile(frame.frame);
  const theme = useChartTheme();
  const setView = useUI((s) => s.setView);
  const toast = useToast();
  const run = usePipeline((s) => s.run);
  const [loadingSample, setLoadingSample] = useState(false);

  const df = frame.frame;

  const [timeCol, setTimeCol] = useState('');
  const [valueCol, setValueCol] = useState('');
  const [freq, setFreq] = useState<Freq>('month');
  const [aggFunc, setAggFunc] = useState<AggFunc>('mean');
  const [windowSize, setWindowSize] = useState(7);
  const [windowFunc, setWindowFunc] = useState<WindowFunc>('mean');
  const [useExpanding, setUseExpanding] = useState(false);
  const [transform, setTransform] = useState<TransformOp>('diff');
  const [useTransform, setUseTransform] = useState(false);
  const [part, setPart] = useState<SeasonPart>('monthOfYear');
  const [showDecompose, setShowDecompose] = useState(false);
  const [showForecast, setShowForecast] = useState(true);
  const [horizon, setHorizon] = useState(6);
  const [forecastModel, setForecastModel] = useState<ForecastModel>('seasonal');

  const timeCols = useMemo(() => (df ? candidateTimeColumns(df) : []), [df]);
  const numeric = useMemo(() => df?.numericColumnNames() ?? [], [df]);

  const params = useUI((s) => s.viewParams);
  useEffect(() => {
    if (!df) return;
    const p = params;
    if (p?.timeColumn && df.has(String(p.timeColumn))) setTimeCol(String(p.timeColumn));
    else if (!timeCol && timeCols.length) setTimeCol(timeCols[0]);
    if (p?.valueColumn && df.has(String(p.valueColumn))) setValueCol(String(p.valueColumn));
    else if (!valueCol && numeric.length) setValueCol(numeric[0]);
    if (p?.part) setPart(p.part as SeasonPart);
    if (p) useUI.getState().consumeViewParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, df, timeCols.join(','), numeric.join(',')]);

  // The time column may be text; coerce to epoch milliseconds on the fly.
  const series = useMemo(() => {
    if (!df || !timeCol || !valueCol || !df.has(timeCol) || !df.has(valueCol)) return null;
    const tc = df.require(timeCol);
    const vc = df.require(valueCol);
    const times: number[] = [];
    const vals: number[] = [];
    const labels: string[] = [];
    for (let i = 0; i < df.nRows; i++) {
      const raw = tc.data[i];
      const v = vc.data[i];
      if (raw === null || v === null) continue;
      const ts = typeof raw === 'number' ? raw : new Date(String(raw)).getTime();
      const num = Number(v);
      if (!Number.isFinite(ts) || !Number.isFinite(num)) continue;
      times.push(ts);
      vals.push(num);
    }
    if (times.length < 3) return null;
    // Sort by time (stable) so resampling and rolling windows are meaningful.
    const order = times.map((_, i) => i).sort((a, b) => times[a] - times[b] || a - b);
    for (const i of order) labels.push(new Date(times[i]).toISOString().slice(0, 10));
    return {
      times: order.map((i) => times[i]),
      values: order.map((i) => vals[i]),
      labels,
    };
  }, [df, timeCol, valueCol]);

  const resampled = useMemo(() => {
    if (!df || !timeCol || !valueCol) return null;
    try {
      return resample(df, { timeColumn: timeCol, freq, valueColumns: [valueCol], aggFuncs: [aggFunc] });
    } catch {
      return null;
    }
  }, [df, timeCol, valueCol, freq, aggFunc]);

  const rolled = useMemo(() => {
    if (!series || series.values.length < windowSize + 1) return null;
    // Computed over a plain array so it stays independent of frame dtypes.
    const out: (number | null)[] = [];
    const vals = series.values;
    for (let i = 0; i < vals.length; i++) {
      const from = Math.max(0, i - windowSize + 1);
      const slice = vals.slice(from, i + 1);
      if (slice.length < windowSize) {
        out.push(null);
        continue;
      }
      let r: number;
      switch (windowFunc) {
        case 'mean': r = slice.reduce((a, b) => a + b, 0) / slice.length; break;
        case 'sum': r = slice.reduce((a, b) => a + b, 0); break;
        case 'min': r = Math.min(...slice); break;
        case 'max': r = Math.max(...slice); break;
        case 'median': {
          const s = [...slice].sort((a, b) => a - b);
          const m = s.length >> 1;
          r = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
          break;
        }
        case 'count': r = slice.length; break;
        case 'std': {
          const m = slice.reduce((a, b) => a + b, 0) / slice.length;
          r = Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, slice.length - 1));
          break;
        }
      }
      out.push(Number.isFinite(r) ? r : null);
    }
    return out;
  }, [series, windowSize, windowFunc]);

  const seasonal = useMemo(() => {
    if (!df || !timeCol || !valueCol) return null;
    try {
      return seasonality(df, { timeColumn: timeCol, valueColumn: valueCol, part, aggFunc });
    } catch {
      return null;
    }
  }, [df, timeCol, valueCol, part, aggFunc]);

  const decomposition = useMemo(() => {
    if (!df || !timeCol || !valueCol || !showDecompose) return null;
    try {
      return decompose(df, { timeColumn: timeCol, valueColumn: valueCol, freq, part });
    } catch {
      return null;
    }
  }, [df, timeCol, valueCol, freq, part, showDecompose]);

  const acf = useMemo(() => (series ? autocorrelation(series.values, 36) : []), [series]);

  const fc = useMemo(() => {
    if (!series || !showForecast) return null;
    const cycle = freq === 'month' ? 12 : freq === 'quarter' ? 4 : freq === 'week' ? 52 : freq === 'day' ? 7 : 24;
    return forecast(series.values, horizon, forecastModel, cycle);
  }, [series, horizon, forecastModel, freq, showForecast]);

  const trendOption = useMemo(() => {
    if (!resampled || !theme) return null;
    const outCol = resampled.outColumns[0];
    const categories = resampled.df.require(timeCol).data.map((v) => (v === null ? '' : new Date(Number(v)).toISOString().slice(0, 10)));
    const data = resampled.df.require(outCol).data as (number | null)[];
    return lineOption(theme, {
      categories,
      series: [{ name: `${valueCol} (${aggFunc})`, data }],
      rotateLabels: categories.length > 12 ? 30 : 0,
      extraGridBottom: 20,
      valueFormatter: (v) => n(v, 3),
    });
  }, [resampled, theme, timeCol, valueCol, aggFunc, n]);

  const rollingOption = useMemo(() => {
    if (!series || !rolled || !theme) return null;
    const step = Math.max(1, Math.ceil(series.labels.length / 2000));
    const cats = series.labels.filter((_, i) => i % step === 0);
    const raw = series.values.filter((_, i) => i % step === 0);
    const smooth = rolled.filter((_, i) => i % step === 0);
    return lineOption(theme, {
      categories: cats,
      series: [
        { name: t('timeseries.observed'), data: raw },
        { name: `${t(WINDOW_LABEL[windowFunc])} (${windowSize})`, data: smooth },
      ],
      rotateLabels: cats.length > 12 ? 30 : 0,
      extraGridBottom: 20,
      valueFormatter: (v) => n(v, 3),
    });
  }, [series, rolled, theme, windowSize, windowFunc, t, n]);

  const forecastOption = useMemo(() => {
    if (!series || !fc || !theme) return null;
    const cycle = freq === 'month' ? 12 : freq === 'quarter' ? 4 : freq === 'week' ? 52 : freq === 'day' ? 7 : 24;
    const step = Math.max(1, Math.ceil(series.labels.length / 1500));
    const cats: string[] = series.labels.filter((_, i) => i % step === 0);
    const observed = series.values.filter((_, i) => i % step === 0);
    // Future labels continue the seasonal cycle from the last observed bucket.
    const lastTs = series.times[series.times.length - 1];
    const futureLabels: string[] = [];
    for (let h = 1; h <= horizon; h++) {
      const d = new Date(lastTs);
      if (freq === 'month') d.setUTCMonth(d.getUTCMonth() + h);
      else if (freq === 'quarter') d.setUTCMonth(d.getUTCMonth() + h * 3);
      else if (freq === 'year') d.setUTCFullYear(d.getUTCFullYear() + h);
      else if (freq === 'week') d.setUTCDate(d.getUTCDate() + h * 7);
      else if (freq === 'day') d.setUTCDate(d.getUTCDate() + h);
      else d.setUTCHours(d.getUTCHours() + h);
      futureLabels.push(d.toISOString().slice(0, 10));
    }
    void cycle;
    const allCats = [...cats, ...futureLabels];
    const obsSeries: (number | null)[] = [...observed, ...new Array<number | null>(horizon).fill(null)];
    const fcSeries: (number | null)[] = [...new Array<number | null>(observed.length - 1).fill(null), observed[observed.length - 1], ...fc.forecast];
    const upper: (number | null)[] = [...new Array<number | null>(observed.length - 1).fill(null), observed[observed.length - 1], ...fc.upper];
    const lower: (number | null)[] = [...new Array<number | null>(observed.length - 1).fill(null), observed[observed.length - 1], ...fc.lower];

    return lineOption(theme, {
      categories: allCats,
      series: [
        { name: t('timeseries.observed'), data: obsSeries },
        { name: t('timeseries.forecast'), data: fcSeries },
        { name: t('timeseries.forecastUpper'), data: upper },
        { name: t('timeseries.forecastLower'), data: lower },
      ],
      rotateLabels: allCats.length > 12 ? 30 : 0,
      extraGridBottom: 20,
      valueFormatter: (v) => n(v, 3),
    });
  }, [series, fc, theme, horizon, freq, t, n]);

  const seasonOption = useMemo(() => {
    if (!seasonal || !theme) return null;
    return barOption(theme, {
      categories: seasonal.labels,
      series: [{ name: `${aggFunc}(${valueCol})`, data: seasonal.values }],
      showValues: seasonal.labels.length <= 16,
      rotateLabels: seasonal.labels.length > 8 ? 28 : 0,
      extraGridBottom: 20,
      valueFormatter: (v) => n(v, 3),
    });
  }, [seasonal, theme, aggFunc, valueCol, n]);

  const decomposeOption = useMemo(() => {
    if (!decomposition || !theme) return null;
    const cats = decomposition.index.map((v) => new Date(v).toISOString().slice(0, 10));
    return lineOption(theme, {
      categories: cats,
      series: [
        { name: t('timeseries.trendLine'), data: decomposition.trend.map((v) => (Number.isFinite(v) ? v : null)) },
        { name: t('timeseries.seasonalLine'), data: decomposition.seasonal.map((v) => (Number.isFinite(v) ? v : null)) },
        { name: t('timeseries.residualLine'), data: decomposition.residual.map((v) => (Number.isFinite(v) ? v : null)) },
      ],
      rotateLabels: cats.length > 12 ? 30 : 0,
      extraGridBottom: 20,
      valueFormatter: (v) => n(v, 3),
    });
  }, [decomposition, theme, t, n]);

  if (!df || !profile) return null;

  if (timeCols.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ViewHeader titleKey="timeseries.title" subtitleKey="timeseries.subtitle" />
        <div className="p-5">
          <Card>
            <EmptyState
              icon="clock"
              title={t('timeseries.noTimeColumn')}
              hint={t('timeseries.noTimeColumnHint')}
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="primary" icon="broom" onClick={() => setView('clean')}>
                    {t('nav.clean')}
                  </Button>
                  <Button
                    variant="secondary"
                    icon="database"
                    loading={loadingSample}
                    onClick={async () => {
                      setLoadingSample(true);
                      try {
                        const { df: next, meta } = await loadSample('sales');
                        clearProfileCache();
                        usePipeline.getState().loadDataset(next, meta);
                        toast.show(t('load.currentDataset'), { tone: 'good', detail: t('datasets.sales') });
                      } finally {
                        setLoadingSample(false);
                      }
                    }}
                  >
                    {t('timeseries.tryDatedSample')}
                  </Button>
                </div>
              }
            />
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader
        titleKey="timeseries.title"
        subtitleKey="timeseries.subtitle"
        meta={
          resampled && (
            <Badge tone="accent" className="tnum">
              {resampled.df.nRows} {t('units.groups')}
            </Badge>
          )
        }
      />

      <SplitView
        width={310}
        controls={
          <>
            <ControlGroup titleKey="timeseries.timeColumn">
              <div className="space-y-3">
                <Select
                  value={timeCol}
                  onChange={(e) => setTimeCol(e.target.value)}
                  options={timeCols.map((c) => ({ value: c, label: c }))}
                />
                <Field label={t('timeseries.valueColumn')}>
                  <Select
                    value={valueCol}
                    onChange={(e) => setValueCol(e.target.value)}
                    options={numeric.map((c) => ({ value: c, label: c }))}
                  />
                </Field>
                {series && (
                  <p className="tnum text-[11px] text-ink-faint">
                    {t('timeseries.range', {
                      from: series.labels[0],
                      to: series.labels[series.labels.length - 1],
                    })}
                  </p>
                )}
              </div>
            </ControlGroup>

            <ControlGroup titleKey="timeseries.freq">
              <div className="space-y-3">
                <Segmented
                  className="w-full"
                  value={freq}
                  onChange={setFreq}
                  options={(['day', 'week', 'month'] as Freq[]).map((f) => ({ value: f, label: t(FREQ_LABEL[f]) }))}
                />
                <Segmented
                  className="w-full"
                  value={freq}
                  onChange={setFreq}
                  options={(['hour', 'quarter', 'year'] as Freq[]).map((f) => ({ value: f, label: t(FREQ_LABEL[f]) }))}
                />
                <Field label={t('timeseries.aggFunc')}>
                  <Select
                    value={aggFunc}
                    onChange={(e) => setAggFunc(e.target.value as AggFunc)}
                    options={AGG_FUNCS.map((f) => ({ value: f, label: t(AGG_LABEL[f]) }))}
                  />
                </Field>
              </div>
            </ControlGroup>

            <ControlGroup titleKey="timeseries.rollingTitle" hintKey="timeseries.rollingHint">
              <div className="space-y-3">
                <Field label={t('timeseries.rollingWindow')} inline>
                  <NumberInput value={windowSize} onChange={(v) => setWindowSize(Math.round(v))} min={2} max={90} className="!w-20" />
                </Field>
                <Field label={t('timeseries.rollingFunc')}>
                  <Select
                    value={windowFunc}
                    onChange={(e) => setWindowFunc(e.target.value as WindowFunc)}
                    options={(Object.keys(WINDOW_LABEL) as WindowFunc[]).map((f) => ({ value: f, label: t(WINDOW_LABEL[f]) }))}
                  />
                </Field>
                <Field label={t('timeseries.expanding')} inline>
                  <Switch checked={useExpanding} onChange={setUseExpanding} />
                </Field>
              </div>
            </ControlGroup>

            <ControlGroup titleKey="timeseries.transformTitle">
              <div className="space-y-3">
                <Field label={t('common.apply')} inline>
                  <Switch checked={useTransform} onChange={setUseTransform} />
                </Field>
                {useTransform && (
                  <>
                    <Select
                      value={transform}
                      onChange={(e) => setTransform(e.target.value as TransformOp)}
                      options={(Object.keys(TRANSFORM_LABEL) as TransformOp[]).map((f) => ({ value: f, label: t(TRANSFORM_LABEL[f]) }))}
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      block
                      icon="plus"
                      onClick={() => {
                        const { outputName } = transformSeries(df, { column: valueCol, op: transform, periods: 1 });
                        run({
                          kind: 'assign',
                          name: outputName,
                          expression: `[${valueCol}]`,
                        });
                      }}
                    >
                      {t('op.assign')}
                    </Button>
                  </>
                )}
              </div>
            </ControlGroup>

            <ControlGroup titleKey="timeseries.seasonalityTitle" hintKey="timeseries.seasonalHint">
              <div className="space-y-3">
                <Field label={t('timeseries.seasonPart')}>
                  <Select
                    value={part}
                    onChange={(e) => setPart(e.target.value as SeasonPart)}
                    options={(Object.keys(PART_LABEL) as SeasonPart[]).map((p) => ({ value: p, label: t(PART_LABEL[p]) }))}
                  />
                </Field>
                <Field label={t('timeseries.decompose')} inline>
                  <Switch checked={showDecompose} onChange={setShowDecompose} />
                </Field>
              </div>
            </ControlGroup>

            <ControlGroup titleKey="timeseries.forecastTitle" hintKey="timeseries.forecastHint">
              <div className="space-y-3">
                <Field label={t('common.apply')} inline>
                  <Switch checked={showForecast} onChange={setShowForecast} />
                </Field>
                {showForecast && (
                  <>
                    <Field label={t('advanced.forecastModel')}>
                      <Select
                        value={forecastModel}
                        onChange={(e) => setForecastModel(e.target.value as ForecastModel)}
                        options={[
                          { value: 'linear', label: t('advanced.forecastLinear') },
                          { value: 'seasonal', label: t('advanced.forecastSeasonal') },
                          { value: 'movingAverage', label: t('advanced.forecastMovingAvg') },
                        ]}
                      />
                    </Field>
                    <Field label={t('timeseries.forecastHorizon')} inline>
                      <NumberInput value={horizon} onChange={(v) => setHorizon(Math.round(v))} min={1} max={36} className="!w-20" />
                    </Field>
                  </>
                )}
              </div>
            </ControlGroup>
          </>
        }
      >
        {!series ? (
          <Card>
            <EmptyState icon="clock" title={t('timeseries.minRows')} hint={t('timeseries.noTimeColumnHint')} />
          </Card>
        ) : (
          <div className="space-y-5">
            <Card title={t('timeseries.trend')} subtitle={`${valueCol} · ${t(FREQ_LABEL[freq])} · ${t(AGG_LABEL[aggFunc])}`} icon="clock">
              {trendOption && <EChart height={320} option={trendOption} />}
              {resampled && resampled.droppedRows > 0 && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-faint">
                  <Icon name="info" size={11} />
                  {t('timeseries.droppedRows', { n: n(resampled.droppedRows, 0) })}
                </p>
              )}
            </Card>

            {useExpanding && series && theme && (
              <Card title={t('timeseries.expanding')} subtitle={`${valueCol} · ${t(WINDOW_LABEL[windowFunc])}`} icon="chart">
                <EChart
                  height={280}
                  option={(() => {
                    const vals = series.values;
                    const out: (number | null)[] = [];
                    for (let i = 0; i < vals.length; i++) {
                      const slice = vals.slice(0, i + 1);
                      if (windowFunc === 'sum') out.push(slice.reduce((a, b) => a + b, 0));
                      else if (windowFunc === 'mean') out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
                      else if (windowFunc === 'max') out.push(Math.max(...slice));
                      else if (windowFunc === 'min') out.push(Math.min(...slice));
                      else if (windowFunc === 'count') out.push(slice.length);
                      else {
                        const m = slice.reduce((a, b) => a + b, 0) / slice.length;
                        out.push(Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, slice.length - 1)));
                      }
                    }
                    const step = Math.max(1, Math.ceil(series.labels.length / 1500));
                    return lineOption(theme, {
                      categories: series.labels.filter((_, i) => i % step === 0),
                      series: [{ name: `${t('timeseries.expanding')} ${t(WINDOW_LABEL[windowFunc])}`, data: out.filter((_, i) => i % step === 0) }],
                      rotateLabels: 30,
                      extraGridBottom: 20,
                      valueFormatter: (v) => n(v, 3),
                    });
                  })()}
                />
              </Card>
            )}

            {!useExpanding && rollingOption && (
              <Card title={t('timeseries.rollingTitle')} subtitle={t('timeseries.rollingHint')} icon="chart">
                <EChart height={300} option={rollingOption} />
              </Card>
            )}

            {showForecast && fc && forecastOption && (
              <Card title={t('timeseries.forecastTitle')} subtitle={t('timeseries.forecastHint')} icon="target">
                <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatTile label={t('timeseries.mae')} value={Number.isFinite(fc.mae) ? n(fc.mae, 3) : '—'} icon="sigma" />
                  <StatTile label={t('timeseries.rmse')} value={Number.isFinite(fc.rmse) ? n(fc.rmse, 3) : '—'} icon="sigma" />
                  <StatTile label={t('timeseries.mape')} value={Number.isFinite(fc.mape) ? pct(fc.mape) : '—'} icon="percent" tone="accent" />
                  <StatTile label={t('timeseries.holdout')} value={n(fc.holdout, 0)} icon="target" />
                </div>
                <EChart height={320} option={forecastOption} />
                <Callout tone="info" icon="info" className="mt-3">
                  {t('timeseries.forecastHint')}
                </Callout>
              </Card>
            )}

            {seasonOption && (
              <Card title={t('timeseries.seasonalProfile')} subtitle={`${t(PART_LABEL[part])} · ${t(AGG_LABEL[aggFunc])}`} icon="chart">
                <EChart height={260} option={seasonOption} />
                <p className="mt-2 text-[11.5px] text-ink-faint">{t('timeseries.seasonalHint')}</p>
              </Card>
            )}

            {acf.length > 0 && theme && (
              <Card title={t('timeseries.acf')} subtitle={t('timeseries.acfHint')} icon="axes">
                <EChart
                  height={240}
                  option={acfOption(theme, {
                    lags: acf.map((a) => a.lag),
                    values: acf.map((a) => a.acf),
                    band: 1.96 / Math.sqrt(series.values.length),
                  })}
                />
              </Card>
            )}

            {showDecompose && decomposition && decomposeOption && (
              <Card title={t('timeseries.decompose')} subtitle={t('timeseries.decomposeHint')} icon="layers">
                <EChart height={320} option={decomposeOption} />
              </Card>
            )}

            {resampled && (
              <Card title={t('timeseries.resampleTable')} subtitle={`${resampled.df.nRows} ${t('units.groups')}`} icon="table" dense>
                <div className="scroll-thin max-h-[360px] overflow-auto">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-surface-2">
                      <tr className="border-b border-line text-left text-[11px] text-ink-muted">
                        <th className="px-4 py-2 font-medium">{timeCol}</th>
                        {resampled.outColumns.map((c) => (
                          <th key={c} className="px-3 py-2 text-right font-medium">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {resampled.df.index.map((_, i) => {
                        const ts = resampled.df.require(timeCol).data[i];
                        return (
                          <tr key={i} className="border-b border-line/50 last:border-0 hover:bg-surface-2">
                            <td className="px-4 py-1.5 text-ink">
                              {ts === null ? '—' : new Date(Number(ts)).toISOString().slice(0, 10)}
                            </td>
                            {resampled.outColumns.map((c) => {
                              const v = resampled.df.require(c).data[i];
                              return (
                                <td key={c} className={cx('tnum px-3 py-1.5 text-right', v === null ? 'text-ink-faint italic' : 'text-ink-soft')}>
                                  {typeof v === 'number' ? n(v, 4) : 'NaN'}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            <Card title={t('ops.codeMirror')} subtitle={t('ops.codeMirrorHint')} icon="code">
              <pre className="scroll-thin overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11.5px] text-ink-soft">
                <code>{[
                  `df["${timeCol}"] = pd.to_datetime(df["${timeCol}"])`,
                  `ts = df.set_index("${timeCol}")["${valueCol}"].sort_index()`,
                  `resampled = ts.resample("${freq === 'month' ? 'ME' : freq === 'quarter' ? 'QE' : freq === 'year' ? 'YE' : freq === 'week' ? 'W' : freq === 'day' ? 'D' : 'h'}").${aggFunc}()`,
                  `smoothed = ts.rolling(${windowSize}).${windowFunc}()`,
                  ...(useExpanding ? [`expanded = ts.expanding().${windowFunc}()`] : []),
                  `seasonal = ts.groupby(ts.index.${part === 'monthOfYear' ? 'month' : part === 'dayOfWeek' ? 'dayofweek' : part === 'hourOfDay' ? 'hour' : part === 'weekOfYear' ? 'isocalendar().week' : 'quarter'}).${aggFunc}()`,
                ].join('\n')}</code>
              </pre>
            </Card>
          </div>
        )}
      </SplitView>
    </div>
  );
}

