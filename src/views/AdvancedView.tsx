import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { useFrame, useProfile } from '../app/hooks.ts';
import { useUI } from '../app/store.ts';
import { ViewHeader, SplitView, ControlGroup } from '../components/layout/ViewShell.tsx';
import { Badge, Button, Callout, Card, CheckList, EmptyState, Field, NumberInput, Segmented, Select, StatTile, Switch, cx } from '../components/ui/index.tsx';
import { EChart, useChartTheme } from '../components/charts/EChart.tsx';
import { barOption, elbowOption, heatmapOption, lineOption, scatterOption, screeOption } from '../components/charts/builders.ts';
import { numericMatrix } from '../core/ops.ts';
import { lttb, mean } from '../core/stats.ts';
import { detectAnomalies, forecast, kmeans, linearRegression, pca, silhouetteScore, varianceInflation } from '../core/advanced.ts';
import type { AnomalyMethod, ForecastModel } from '../core/advanced.ts';

type Tab = 'regression' | 'cluster' | 'pca' | 'anomaly' | 'forecast';

export function AdvancedView() {
  const { t, n, pct } = useI18n();
  const frame = useFrame();
  const profile = useProfile(frame.frame);
  const theme = useChartTheme();
  const setView = useUI((s) => s.setView);

  const df = frame.frame;

  const [tab, setTab] = useState<Tab>('regression');
  const [themeReady, setThemeReady] = useState(false);

  /* --- regression --- */
  const [target, setTarget] = useState('');
  const [features, setFeatures] = useState<string[]>([]);
  /* --- clustering --- */
  const [clusterCols, setClusterCols] = useState<string[]>([]);
  const [k, setK] = useState(3);
  const [clusterX, setClusterX] = useState('');
  const [clusterY, setClusterY] = useState('');
  /* --- pca --- */
  const [pcaCols, setPcaCols] = useState<string[]>([]);
  /* --- anomaly --- */
  const [anomCols, setAnomCols] = useState<string[]>([]);
  const [anomMethod, setAnomMethod] = useState<AnomalyMethod>('zscore');
  const [anomThreshold, setAnomThreshold] = useState(3);
  /* --- forecast --- */
  const [fcCol, setFcCol] = useState('');
  const [fcModel, setFcModel] = useState<ForecastModel>('seasonal');
  const [fcHorizon, setFcHorizon] = useState(12);
  const [fcCycle, setFcCycle] = useState(12);
  /* --- toggles --- */
  const [showFit, setShowFit] = useState(true);

  const numeric = useMemo(() => df?.numericColumnNames() ?? [], [df]);

  useEffect(() => setThemeReady(true), []);

  useEffect(() => {
    if (!df || numeric.length === 0) return;
    if (!target) setTarget(numeric[numeric.length - 1]);
    if (features.length === 0) setFeatures(numeric.slice(0, Math.min(3, Math.max(1, numeric.length - 1))).filter((c) => c !== target));
    if (clusterCols.length === 0) setClusterCols(numeric.slice(0, Math.min(4, numeric.length)));
    if (pcaCols.length === 0) setPcaCols(numeric.slice(0, Math.min(6, numeric.length)));
    if (anomCols.length === 0) setAnomCols(numeric.slice(0, Math.min(4, numeric.length)));
    if (!fcCol) setFcCol(numeric[0]);
    if (!clusterX) setClusterX(numeric[0] ?? '');
    if (!clusterY) setClusterY(numeric[1] ?? numeric[0] ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [df, numeric.join(',')]);

  /* ---------------- regression ---------------- */
  const regression = useMemo(() => {
    if (!df || !target || features.length === 0) return null;
    const cols = [target, ...features].filter((c) => df.has(c));
    if (cols.length < 2) return null;
    const { matrix, completeRows } = numericMatrix(df, cols);
    if (matrix.length < cols.length + 2) return null;
    const X = matrix.map((r) => r.slice(1));
    const yv = matrix.map((r) => r[0]);
    const reg = linearRegression(X, yv, features);
    if (reg.singular) return null;
    const vif = varianceInflation(X, features);
    return { reg, completeRows, X, y: yv, vif, dropped: df.nRows - matrix.length };
  }, [df, target, features]);

  /* ---------------- clustering ---------------- */
  const cluster = useMemo(() => {
    if (!df || clusterCols.length < 2) return null;
    const cols = clusterCols.filter((c) => df.has(c));
    if (cols.length < 2) return null;
    const { matrix } = numericMatrix(df, cols);
    if (matrix.length < k * 2) return null;
    // Standardise so no single variable dominates the distance metric.
    const means = cols.map((_, j) => mean(matrix.map((r) => r[j])));
    const sds = cols.map((_, j) => {
      const m = means[j];
      return Math.sqrt(matrix.reduce((a, r) => a + (r[j] - m) ** 2, 0) / Math.max(1, matrix.length - 1)) || 1;
    });
    const Z = matrix.map((r) => r.map((v, j) => (v - means[j]) / sds[j]));
    const result = kmeans(Z, k, 42);
    const sil = silhouetteScore(Z, result.assignments);
    // Elbow sweep
    const ks = Array.from({ length: Math.min(8, Math.max(2, Math.floor(matrix.length / 3))) }, (_, i) => i + 2);
    const inertia = ks.map((kk) => kmeans(Z, kk, 42).inertia);
    const sils = ks.map((kk) => {
      const r = kmeans(Z, kk, 42);
      return silhouetteScore(Z, r.assignments, 800);
    });
    // Cluster profiles in the original units.
    const centroids = result.centroids.map((c) => c.map((v, j) => v * sds[j] + means[j]));
    const sizes = result.assignments.reduce<number[]>((a, c) => {
      a[c] = (a[c] ?? 0) + 1;
      return a;
    }, []);
    return { cols, matrix, Z, result, sil, ks, inertia, sils, centroids, sizes, means, sds };
  }, [df, clusterCols, k]);

  /* ---------------- pca ---------------- */
  const pcaResult = useMemo(() => {
    if (!df || pcaCols.length < 2) return null;
    const cols = pcaCols.filter((c) => df.has(c));
    if (cols.length < 2) return null;
    const { matrix } = numericMatrix(df, cols);
    if (matrix.length < 4) return null;
    const r = pca(matrix, cols);
    if (r.explained.length === 0) return null;
    return { ...r, n: matrix.length };
  }, [df, pcaCols]);

  /* ---------------- anomaly ---------------- */
  const anomaly = useMemo(() => {
    if (!df || anomCols.length === 0) return null;
    const cols = anomCols.filter((c) => df.has(c));
    if (cols.length === 0) return null;
    const { matrix, completeRows } = numericMatrix(df, cols);
    if (matrix.length < 10) return null;
    const means = cols.map((_, j) => mean(matrix.map((r) => r[j])));
    const sds = cols.map((_, j) => {
      const m = means[j];
      return Math.sqrt(matrix.reduce((a, r) => a + (r[j] - m) ** 2, 0) / Math.max(1, matrix.length - 1)) || 1;
    });
    const Z = matrix.map((r) => r.map((v, j) => (v - means[j]) / sds[j]));
    const res = detectAnomalies(Z, anomMethod, anomThreshold);
    return { cols, matrix, completeRows, res, means, sds };
  }, [df, anomCols, anomMethod, anomThreshold]);

  /* ---------------- forecast ---------------- */
  const fcResult = useMemo(() => {
    if (!df || !fcCol) return null;
    const vals: number[] = [];
    const col = df.require(fcCol).data;
    for (const v of col) {
      if (v === null) continue;
      const num = Number(v);
      if (Number.isFinite(num)) vals.push(num);
    }
    if (vals.length < 8) return null;
    return forecast(vals, fcHorizon, fcModel, fcCycle);
  }, [df, fcCol, fcHorizon, fcModel, fcCycle]);

  if (!df || !profile) return null;

  const numOptions = numeric.map((c) => ({ value: c, label: c }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader
        titleKey="advanced.title"
        subtitleKey="advanced.subtitle"
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'regression', label: t('advanced.tabRegression'), icon: 'axes' },
              { value: 'cluster', label: t('advanced.tabCluster'), icon: 'group' },
              { value: 'pca', label: t('advanced.tabPca'), icon: 'layers' },
              { value: 'anomaly', label: t('advanced.tabAnomaly'), icon: 'alert' },
              { value: 'forecast', label: t('advanced.tabForecast'), icon: 'clock' },
            ]}
          />
        }
      />

      <SplitView
        width={310}
        controls={
          <>
            {tab === 'regression' && (
              <ControlGroup titleKey="advanced.regTitle" hintKey="advanced.regHint">
                <div className="space-y-3">
                  <Field label={t('advanced.regTarget')}>
                    <Select value={target} onChange={(e) => setTarget(e.target.value)} options={numOptions} />
                  </Field>
                  <Field label={t('advanced.regFeatures')} hint={t('advanced.regFeaturesHint')}>
                    <CheckList
                      items={numOptions.filter((o) => o.value !== target)}
                      selected={features}
                      onToggle={(v) => setFeatures((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))}
                      onSelectAll={() => setFeatures(numeric.filter((c) => c !== target).slice(0, 5))}
                      onClear={() => setFeatures([])}
                      maxHeight={190}
                      labels={{ all: t('common.selectAll'), clear: t('common.clear') }}
                    />
                  </Field>
                  <Field label={t('advanced.regResidual')} inline>
                    <Switch checked={showFit} onChange={setShowFit} />
                  </Field>
                </div>
              </ControlGroup>
            )}

            {tab === 'cluster' && (
              <ControlGroup titleKey="advanced.clusterTitle" hintKey="advanced.clusterHint">
                <div className="space-y-3">
                  <Field label={t('advanced.clusterFeatures')}>
                    <CheckList
                      items={numOptions}
                      selected={clusterCols}
                      onToggle={(v) => setClusterCols((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))}
                      onSelectAll={() => setClusterCols(numeric.slice(0, 5))}
                      onClear={() => setClusterCols([])}
                      maxHeight={180}
                      labels={{ all: t('common.selectAll'), clear: t('common.clear') }}
                    />
                  </Field>
                  <Field label={t('advanced.clusterK')} hint={t('advanced.clusterKHint')} inline>
                    <NumberInput value={k} onChange={(v) => setK(Math.round(v))} min={2} max={10} className="!w-20" />
                  </Field>
                  <Field label={t('advanced.clusterAxisX')}>
                    <Select value={clusterX} onChange={(e) => setClusterX(e.target.value)} options={numOptions} />
                  </Field>
                  <Field label={t('advanced.clusterAxisY')}>
                    <Select value={clusterY} onChange={(e) => setClusterY(e.target.value)} options={numOptions} />
                  </Field>
                </div>
              </ControlGroup>
            )}

            {tab === 'pca' && (
              <ControlGroup titleKey="advanced.pcaTitle" hintKey="advanced.pcaHint">
                <Field label={t('advanced.clusterFeatures')}>
                  <CheckList
                    items={numOptions}
                    selected={pcaCols}
                    onToggle={(v) => setPcaCols((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))}
                    onSelectAll={() => setPcaCols(numeric.slice(0, 8))}
                    onClear={() => setPcaCols([])}
                    maxHeight={220}
                    labels={{ all: t('common.selectAll'), clear: t('common.clear') }}
                  />
                </Field>
              </ControlGroup>
            )}

            {tab === 'anomaly' && (
              <ControlGroup titleKey="advanced.anomalyTitle" hintKey="advanced.anomalyHint">
                <div className="space-y-3">
                  <Field label={t('advanced.anomalyColumns')}>
                    <CheckList
                      items={numOptions}
                      selected={anomCols}
                      onToggle={(v) => setAnomCols((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))}
                      onSelectAll={() => setAnomCols(numeric.slice(0, 5))}
                      onClear={() => setAnomCols([])}
                      maxHeight={180}
                      labels={{ all: t('common.selectAll'), clear: t('common.clear') }}
                    />
                  </Field>
                  <Field label={t('advanced.anomalyMethod')}>
                    <Select
                      value={anomMethod}
                      onChange={(e) => setAnomMethod(e.target.value as AnomalyMethod)}
                      options={[
                        { value: 'zscore', label: t('advanced.anomalyZ') },
                        { value: 'iqr', label: t('advanced.anomalyIqr') },
                        { value: 'lof', label: t('advanced.anomalyLof') },
                      ]}
                    />
                  </Field>
                  {anomMethod !== 'lof' && (
                    <Field label={t('advanced.anomalyThreshold')} inline>
                      <NumberInput value={anomThreshold} onChange={setAnomThreshold} min={1} max={8} step={0.5} className="!w-20" />
                    </Field>
                  )}
                </div>
              </ControlGroup>
            )}

            {tab === 'forecast' && (
              <ControlGroup titleKey="advanced.forecastTitle" hintKey="advanced.forecastHint">
                <div className="space-y-3">
                  <Field label={t('timeseries.valueColumn')}>
                    <Select value={fcCol} onChange={(e) => setFcCol(e.target.value)} options={numOptions} />
                  </Field>
                  <Field label={t('advanced.forecastModel')}>
                    <Select
                      value={fcModel}
                      onChange={(e) => setFcModel(e.target.value as ForecastModel)}
                      options={[
                        { value: 'linear', label: t('advanced.forecastLinear') },
                        { value: 'seasonal', label: t('advanced.forecastSeasonal') },
                        { value: 'movingAverage', label: t('advanced.forecastMovingAvg') },
                      ]}
                    />
                  </Field>
                  <Field label={t('advanced.forecastHorizon')} inline>
                    <NumberInput value={fcHorizon} onChange={(v) => setFcHorizon(Math.round(v))} min={1} max={60} className="!w-20" />
                  </Field>
                  {fcModel === 'seasonal' && (
                    <Field label={t('timeseries.seasonPart')} inline>
                      <NumberInput value={fcCycle} onChange={(v) => setFcCycle(Math.round(v))} min={2} max={52} className="!w-20" />
                    </Field>
                  )}
                </div>
              </ControlGroup>
            )}
          </>
        }
      >
        {/* ---------------- Regression ---------------- */}
        {tab === 'regression' && (
          <div className="space-y-5">
            {!regression ? (
              <Card>
                <EmptyState icon="axes" title={t('advanced.regNeedFeatures')} hint={t('advanced.regTooFewRows', { n: features.length + 3 })} />
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <StatTile label={t('advanced.regR2')} value={regression.reg.r2.toFixed(4)} icon="target" tone="accent" />
                  <StatTile label={t('advanced.regAdjR2')} value={Number.isFinite(regression.reg.adjustedR2) ? regression.reg.adjustedR2.toFixed(4) : '—'} icon="sigma" />
                  <StatTile label={t('advanced.regRMSE')} value={n(regression.reg.rmse, 4)} icon="sigma" />
                  <StatTile label={t('advanced.regN')} value={n(regression.reg.n, 0)} icon="table" hint={regression.dropped > 0 ? `−${regression.dropped}` : undefined} />
                  <StatTile label={t('advanced.regFeatures')} value={n(features.length, 0)} icon="columns" />
                </div>

                <Callout
                  tone={regression.reg.r2 >= 0.6 ? 'good' : regression.reg.r2 >= 0.3 ? 'info' : 'warn'}
                  icon="bulb"
                  title={t('advanced.regFit')}
                >
                  {t(
                    regression.reg.r2 >= 0.6 ? 'advanced.regFitGood' : regression.reg.r2 >= 0.3 ? 'advanced.regFitModerate' : 'advanced.regFitPoor',
                    { pct: (regression.reg.r2 * 100).toFixed(1) },
                  )}
                </Callout>

                <Card title={t('advanced.regCoefficients')} subtitle={`${target} ~ ${features.join(' + ')}`} icon="axes" dense>
                  <div className="scroll-thin overflow-x-auto">
                    <table className="w-full min-w-[620px] text-[12px]">
                      <thead className="bg-surface-2">
                        <tr className="border-b border-line text-left text-[11px] text-ink-muted">
                          <th className="px-4 py-2 font-medium">{t('advanced.regVariable')}</th>
                          <th className="px-3 py-2 text-right font-medium">{t('advanced.regCoef')}</th>
                          <th className="px-3 py-2 text-right font-medium">{t('advanced.regStdErr')}</th>
                          <th className="px-3 py-2 text-right font-medium">{t('advanced.regT')}</th>
                          <th className="px-3 py-2 text-right font-medium">{t('advanced.regP')}</th>
                          <th className="px-3 py-2 text-right font-medium">VIF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regression.reg.names.map((name, i) => {
                          const p = regression.reg.pValues[i];
                          const sig = Number.isFinite(p) && p < 0.05;
                          return (
                            <tr key={name} className="border-b border-line/50 last:border-0">
                              <td className="px-4 py-1.5 font-medium text-ink">
                                {i === 0 ? t('advanced.regIntercept') : name}
                              </td>
                              <td className="tnum px-3 py-1.5 text-right text-ink-soft">{n(regression.reg.coefficients[i], 5)}</td>
                              <td className="tnum px-3 py-1.5 text-right text-ink-muted">{n(regression.reg.stdErrors[i], 5)}</td>
                              <td className="tnum px-3 py-1.5 text-right text-ink-muted">{n(regression.reg.tStats[i], 3)}</td>
                              <td className={cx('tnum px-3 py-1.5 text-right', sig ? 'font-medium text-good' : 'text-ink-muted')}>
                                {Number.isFinite(p) ? (p < 0.0001 ? '<0.0001' : p.toFixed(4)) : '—'}
                              </td>
                              <td className="tnum px-3 py-1.5 text-right text-ink-muted">
                                {i === 0 ? '—' : n(regression.vif[i - 1]?.vif ?? NaN, 2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card title={t('advanced.regEquation')} icon="code">
                  <pre className="scroll-thin overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] text-ink-soft">
                    <code>
                      {`${target} = ${regression.reg.coefficients[0].toFixed(4)}` +
                        features.map((f, i) => ` ${regression.reg.coefficients[i + 1] >= 0 ? '+' : '−'} ${Math.abs(regression.reg.coefficients[i + 1]).toFixed(4)}·${f}`).join('')}
                    </code>
                  </pre>
                </Card>

                {theme && (
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <Card title={t('advanced.regImportance')} subtitle={t('advanced.regImportanceHint')} icon="chart">
                      <EChart
                        height={260}
                        option={barOption(theme, {
                          categories: features,
                          series: [{ name: t('advanced.regImportance'), data: regression.reg.standardized.slice(1) }],
                          horizontal: true,
                          showValues: true,
                          showLegend: false,
                          valueFormatter: (v) => n(v, 3),
                        })}
                      />
                    </Card>
                    <Card title={t('advanced.regPredVsActual')} icon="scatter">
                      <EChart
                        height={260}
                        option={scatterOption(theme, {
                          points:
                            regression.reg.fitted.length > 4000
                              ? (() => {
                                  const d = lttb(regression.reg.fitted, regression.y, 4000);
                                  return d.x.map((v, i) => [v, d.y[i]] as [number, number]);
                                })()
                              : regression.reg.fitted.map((v, i) => [v, regression.y[i]] as [number, number]),
                          xName: t('advanced.regPredVsActual'),
                          yName: target,
                          pointFormatter: (v) => `${t('advanced.regPredVsActual')}: <b>${n(v[0], 3)}</b><br/>${target}: <b>${n(v[1], 3)}</b>`,
                        })}
                      />
                    </Card>
                    {showFit && (
                      <Card title={t('advanced.regResidual')} subtitle={t('advanced.regResidualHint')} icon="scatter" className="xl:col-span-2">
                        <EChart
                          height={240}
                          option={scatterOption(theme, {
                            points: regression.reg.fitted.map((v, i) => [v, regression.reg.residuals[i]] as [number, number]),
                            xName: t('advanced.regPredVsActual'),
                            yName: t('timeseries.residualLine'),
                            pointFormatter: (v) => `${t('timeseries.residualLine')}: <b>${n(v[1], 4)}</b>`,
                          })}
                        />
                      </Card>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ---------------- Clustering ---------------- */}
        {tab === 'cluster' && (
          <div className="space-y-5">
            {!cluster ? (
              <Card>
                <EmptyState icon="group" title={t('advanced.clusterNeedFeatures')} hint={t('advanced.clusterHint')} />
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatTile label={t('advanced.clusterK')} value={n(k, 0)} icon="group" tone="accent" />
                  <StatTile label={t('advanced.clusterSize')} value={n(cluster.matrix.length, 0)} icon="table" />
                  <StatTile
                    label={t('advanced.clusterSilhouette')}
                    value={Number.isFinite(cluster.sil) ? cluster.sil.toFixed(3) : '—'}
                    icon="target"
                    tone={cluster.sil > 0.5 ? 'good' : cluster.sil > 0.25 ? 'warn' : 'bad'}
                  />
                  <StatTile label={t('describe.variance')} value={n(cluster.result.inertia, 2)} icon="sigma" />
                </div>

                {themeReady && theme && (
                  <Card title={t('advanced.clusterElbow')} subtitle={t('advanced.clusterElbowHint')} icon="chart">
                    <EChart height={260} option={elbowOption(theme, { k: cluster.ks, inertia: cluster.inertia, silhouette: cluster.sils })} />
                  </Card>
                )}

                {theme && (
                  <Card title={t('advanced.clusterScatter')} subtitle={`${clusterX} × ${clusterY}`} icon="scatter">
                    <EChart
                      height={340}
                      option={(() => {
                        const xi = cluster.cols.indexOf(clusterX);
                        const yi = cluster.cols.indexOf(clusterY);
                        if (xi < 0 || yi < 0) {
                          return scatterOption(theme, {
                            points: cluster.Z.map((r) => [r[0], r[1]] as [number, number]),
                            groups: [...new Set(cluster.result.assignments)].map((c) => ({
                              name: `Cluster ${c + 1}`,
                              points: cluster.Z.filter((_, i) => cluster.result.assignments[i] === c).map((r) => [r[0], r[1]] as [number, number]),
                            })),
                            xName: cluster.cols[0],
                            yName: cluster.cols[1] ?? cluster.cols[0],
                          });
                        }
                        return scatterOption(theme, {
                          points: [],
                          groups: [...new Set(cluster.result.assignments)].map((c) => ({
                            name: `Cluster ${c + 1}`,
                            points: cluster.matrix
                              .filter((_, i) => cluster.result.assignments[i] === c)
                              .map((r) => [r[xi], r[yi]] as [number, number]),
                          })),
                          xName: clusterX,
                          yName: clusterY,
                          pointFormatter: (v) => `${clusterX}: <b>${n(v[0], 3)}</b><br/>${clusterY}: <b>${n(v[1], 3)}</b>`,
                        });
                      })()}
                    />
                  </Card>
                )}

                <Card title={t('advanced.clusterProfile')} subtitle={cluster.cols.join(', ')} icon="table" dense>
                  <div className="scroll-thin overflow-x-auto">
                    <table className="w-full min-w-[520px] text-[12px]">
                      <thead className="bg-surface-2">
                        <tr className="border-b border-line text-left text-[11px] text-ink-muted">
                          <th className="px-4 py-2 font-medium">{t('advanced.clusterCentroid')}</th>
                          <th className="px-3 py-2 text-right font-medium">{t('advanced.clusterSize')}</th>
                          <th className="px-3 py-2 text-right font-medium">{t('common.percent')}</th>
                          {cluster.cols.map((c) => (
                            <th key={c} className="px-3 py-2 text-right font-medium">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cluster.centroids.map((cent, ci) => (
                          <tr key={ci} className="border-b border-line/50 last:border-0">
                            <td className="px-4 py-1.5 font-medium text-ink">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="size-2.5 rounded-full" style={{ background: `var(--viz-${(ci % 8) + 1})` }} />
                                Cluster {ci + 1}
                              </span>
                            </td>
                            <td className="tnum px-3 py-1.5 text-right text-ink-soft">{n(cluster.sizes[ci] ?? 0, 0)}</td>
                            <td className="tnum px-3 py-1.5 text-right text-ink-muted">
                              {pct((cluster.sizes[ci] ?? 0) / cluster.matrix.length)}
                            </td>
                            {cent.map((v, j) => (
                              <td key={j} className="tnum px-3 py-1.5 text-right text-ink-soft">
                                {n(v, 3)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Callout tone="info" icon="info">
                  {t('advanced.clusterSilhouetteHint')}
                </Callout>
              </>
            )}
          </div>
        )}

        {/* ---------------- PCA ---------------- */}
        {tab === 'pca' && (
          <div className="space-y-5">
            {!pcaResult ? (
              <Card>
                <EmptyState icon="layers" title={t('advanced.pcaNeedFeatures')} hint={t('advanced.pcaHint')} />
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatTile label={t('advanced.regN')} value={n(pcaResult.n, 0)} icon="table" />
                  <StatTile label={t('advanced.clusterFeatures')} value={n(pcaResult.featureNames.length, 0)} icon="columns" />
                  <StatTile label={`PC1 ${t('advanced.pcaVariance')}`} value={pct(pcaResult.explained[0])} icon="chart" tone="accent" />
                  <StatTile
                    label={t('advanced.pcaCumulative')}
                    value={pct(pcaResult.cumulative[Math.min(1, pcaResult.cumulative.length - 1)] ?? 0)}
                    icon="sigma"
                  />
                </div>

                {theme && (
                  <Card title={t('advanced.pcaScree')} subtitle={t('advanced.pcaScreeHint')} icon="chart">
                    <EChart
                      height={260}
                      option={screeOption(theme, {
                        labels: pcaResult.explained.map((_, i) => t('advanced.pcaPC', { n: i + 1 })),
                        explained: pcaResult.explained,
                        cumulative: pcaResult.cumulative,
                        labels2: { explained: t('advanced.pcaVariance'), cumulative: t('advanced.pcaCumulative') },
                      })}
                    />
                  </Card>
                )}

                {theme && pcaResult.scores.length > 0 && (
                  <Card title={t('advanced.pcaProjection')} subtitle={t('advanced.pcaProjectionHint')} icon="scatter">
                    <EChart
                      height={340}
                      option={scatterOption(theme, {
                        points:
                          pcaResult.scores.length > 5000
                            ? (() => {
                                const xs = pcaResult.scores.map((s) => s[0]);
                                const ys = pcaResult.scores.map((s) => s[1] ?? 0);
                                const d = lttb(xs, ys, 5000);
                                return d.x.map((v, i) => [v, d.y[i]] as [number, number]);
                              })()
                            : pcaResult.scores.map((s) => [s[0], s[1] ?? 0] as [number, number]),
                        xName: `${t('advanced.pcaPC', { n: 1 })} (${pct(pcaResult.explained[0])})`,
                        yName: `${t('advanced.pcaPC', { n: 2 })} (${pct(pcaResult.explained[1] ?? 0)})`,
                        pointFormatter: (v) => `PC1: <b>${n(v[0], 3)}</b><br/>PC2: <b>${n(v[1], 3)}</b>`,
                      })}
                    />
                  </Card>
                )}

                <Card title={t('advanced.pcaLoadings')} subtitle={t('advanced.pcaLoadingsHint')} icon="table" dense>
                  <div className="scroll-thin overflow-x-auto">
                    <table className="w-full min-w-[480px] text-[12px]">
                      <thead className="bg-surface-2">
                        <tr className="border-b border-line text-left text-[11px] text-ink-muted">
                          <th className="px-4 py-2 font-medium">{t('common.column')}</th>
                          {pcaResult.explained.slice(0, 5).map((_, i) => (
                            <th key={i} className="px-3 py-2 text-right font-medium">
                              {t('advanced.pcaPC', { n: i + 1 })}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pcaResult.featureNames.map((f, j) => (
                          <tr key={f} className="border-b border-line/50 last:border-0">
                            <td className="px-4 py-1.5 font-medium text-ink">{f}</td>
                            {pcaResult.explained.slice(0, 5).map((_, i) => {
                              const v = pcaResult.components[i]?.[j] ?? 0;
                              const intensity = Math.min(1, Math.abs(v));
                              return (
                                <td
                                  key={i}
                                  className="tnum px-3 py-1.5 text-right"
                                  style={{ background: `color-mix(in srgb, var(--viz-1) ${Math.round(intensity * 30)}%, transparent)` }}
                                >
                                  {v.toFixed(3)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {theme && (
                  <Card title={t('advanced.pcaLoadings')} subtitle={t('advanced.pcaLoadingsHint')} icon="grid">
                    <EChart
                      height={Math.max(240, pcaResult.featureNames.length * 26 + 120)}
                      option={heatmapOption(theme, {
                        xLabels: pcaResult.explained.slice(0, 5).map((_, i) => t('advanced.pcaPC', { n: i + 1 })),
                        yLabels: pcaResult.featureNames,
                        cells: pcaResult.featureNames.map((_, j) => pcaResult.explained.slice(0, 5).map((_, i) => pcaResult.components[i]?.[j] ?? 0)),
                        diverging: true,
                        showValues: true,
                        formatter: (v) => v.toFixed(2),
                      })}
                    />
                  </Card>
                )}
              </>
            )}
          </div>
        )}

        {/* ---------------- Anomaly ---------------- */}
        {tab === 'anomaly' && (
          <div className="space-y-5">
            {!anomaly ? (
              <Card>
                <EmptyState icon="alert" title={t('advanced.anomalyNeedColumns')} hint={t('advanced.anomalyHint')} />
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatTile label={t('advanced.anomalyDetected', { n: n(anomaly.res.flagged.length, 0) })} value={n(anomaly.res.flagged.length, 0)} icon="alert" tone={anomaly.res.flagged.length > 0 ? 'warn' : 'good'} />
                  <StatTile label={t('advanced.anomalyRate')} value={pct(anomaly.res.flagged.length / anomaly.matrix.length)} icon="percent" />
                  <StatTile label={t('advanced.anomalyThreshold')} value={n(anomaly.res.threshold, 2)} icon="target" />
                  <StatTile label={t('advanced.regN')} value={n(anomaly.matrix.length, 0)} icon="table" />
                </div>

                {theme && (
                  <Card title={t('advanced.anomalyScatter')} subtitle={anomaly.cols.join(' × ')} icon="scatter">
                    <EChart
                      height={340}
                      option={(() => {
                        const flagged = new Set(anomaly.res.flagged);
                        const normal: [number, number][] = [];
                        const bad: [number, number][] = [];
                        const step = Math.max(1, Math.ceil(anomaly.matrix.length / 5000));
                        for (let i = 0; i < anomaly.matrix.length; i += step) {
                          const pt: [number, number] = [anomaly.matrix[i][0], anomaly.matrix[i][1] ?? 0];
                          if (flagged.has(i)) bad.push(pt);
                          else normal.push(pt);
                        }
                        return scatterOption(theme, {
                          points: normal,
                          groups: [
                            { name: t('chart.outlierPoint'), points: bad },
                          ],
                          xName: anomaly.cols[0],
                          yName: anomaly.cols[1] ?? anomaly.cols[0],
                          pointFormatter: (v) => `${anomaly.cols[0]}: <b>${n(v[0], 3)}</b><br/>${anomaly.cols[1] ?? ''}: <b>${n(v[1], 3)}</b>`,
                        });
                      })()}
                    />
                  </Card>
                )}

                <Card title={t('advanced.anomalyList')} dense>
                  <div className="scroll-thin max-h-[420px] overflow-auto">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 bg-surface-2">
                        <tr className="border-b border-line text-left text-[11px] text-ink-muted">
                          <th className="px-4 py-2 font-medium">{t('data.originalIndex')}</th>
                          <th className="px-3 py-2 text-right font-medium">{t('advanced.anomalyScore')}</th>
                          {anomaly.cols.map((c) => (
                            <th key={c} className="px-3 py-2 text-right font-medium">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {anomaly.res.flagged
                          .map((row) => ({ row, score: anomaly.res.scores[row] }))
                          .sort((a, b) => b.score - a.score)
                          .slice(0, 100)
                          .map(({ row, score }) => (
                            <tr key={row} className="border-b border-line/50 last:border-0 hover:bg-surface-2">
                              <td className="tnum px-4 py-1.5 text-ink-faint">{df.index[anomaly.completeRows[row]] + 1}</td>
                              <td className="tnum px-3 py-1.5 text-right font-medium text-warn">{n(score, 3)}</td>
                              {anomaly.matrix[row].map((v, j) => (
                                <td key={j} className="tnum px-3 py-1.5 text-right text-ink-soft">
                                  {n(v, 3)}
                                </td>
                              ))}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" icon="broom" onClick={() => setView('clean', { focus: 'outliers', column: anomaly.cols[0] })}>
                    {t('nav.clean')}
                  </Button>
                  <Button size="sm" variant="secondary" icon="table" onClick={() => setView('data')}>
                    {t('nav.data')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ---------------- Forecast ---------------- */}
        {tab === 'forecast' && (
          <div className="space-y-5">
            {!fcResult ? (
              <Card>
                <EmptyState icon="clock" title={t('timeseries.minRows')} hint={t('advanced.forecastHint')} />
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatTile label={t('timeseries.mae')} value={Number.isFinite(fcResult.mae) ? n(fcResult.mae, 3) : '—'} icon="sigma" />
                  <StatTile label={t('timeseries.rmse')} value={Number.isFinite(fcResult.rmse) ? n(fcResult.rmse, 3) : '—'} icon="sigma" />
                  <StatTile label={t('timeseries.mape')} value={Number.isFinite(fcResult.mape) ? pct(fcResult.mape) : '—'} icon="percent" tone="accent" />
                  <StatTile label={t('timeseries.holdout')} value={n(fcResult.holdout, 0)} icon="target" />
                </div>

                {theme && (
                  <Card title={t('advanced.forecastChart')} subtitle={`${fcCol} · ${t('advanced.forecastHorizon')} ${fcHorizon}`} icon="target">
                    <EChart
                      height={340}
                      option={(() => {
                        const nObs = fcResult.fitted.length;
                        const step = Math.max(1, Math.ceil(nObs / 1500));
                        const cats: string[] = [];
                        const obs: (number | null)[] = [];
                        for (let i = 0; i < nObs; i += step) {
                          cats.push(String(i + 1));
                          obs.push(fcResult.fitted[i]);
                        }
                        const fCats = [...cats, ...Array.from({ length: fcHorizon }, (_, i) => `+${i + 1}`)];
                        const obsSeries: (number | null)[] = [...obs, ...new Array<number | null>(fcHorizon).fill(null)];
                        const fcSeries: (number | null)[] = [...new Array<number | null>(obs.length - 1).fill(null), obs[obs.length - 1], ...fcResult.forecast];
                        const upper: (number | null)[] = [...new Array<number | null>(obs.length - 1).fill(null), obs[obs.length - 1], ...fcResult.upper];
                        const lower: (number | null)[] = [...new Array<number | null>(obs.length - 1).fill(null), obs[obs.length - 1], ...fcResult.lower];
                        return lineOption(theme, {
                          categories: fCats,
                          series: [
                            { name: t('timeseries.observed'), data: obsSeries },
                            { name: t('timeseries.forecast'), data: fcSeries },
                            { name: t('timeseries.forecastUpper'), data: upper },
                            { name: t('timeseries.forecastLower'), data: lower },
                          ],
                          rotateLabels: fCats.length > 14 ? 30 : 0,
                          extraGridBottom: 22,
                          valueFormatter: (v) => n(v, 3),
                        });
                      })()}
                    />
                  </Card>
                )}

                <Callout tone="info" icon="info">
                  {t('timeseries.forecastHint')}
                </Callout>

                <Card title={t('advanced.forecastEval')} subtitle={t('advanced.forecastEvalHint')} icon="sigma">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-line bg-surface-2 p-3">
                      <p className="text-[11.5px] text-ink-muted">{t('timeseries.mae')}</p>
                      <p className="tnum mt-1 text-[17px] font-semibold text-ink">{Number.isFinite(fcResult.mae) ? n(fcResult.mae, 4) : '—'}</p>
                    </div>
                    <div className="rounded-lg border border-line bg-surface-2 p-3">
                      <p className="text-[11.5px] text-ink-muted">{t('timeseries.rmse')}</p>
                      <p className="tnum mt-1 text-[17px] font-semibold text-ink">{Number.isFinite(fcResult.rmse) ? n(fcResult.rmse, 4) : '—'}</p>
                    </div>
                    <div className="rounded-lg border border-line bg-surface-2 p-3">
                      <p className="text-[11.5px] text-ink-muted">{t('timeseries.mape')}</p>
                      <p className="tnum mt-1 text-[17px] font-semibold text-ink">{Number.isFinite(fcResult.mape) ? pct(fcResult.mape) : '—'}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {fcResult.forecast.slice(0, 12).map((v, i) => (
                      <Badge key={i} tone="neutral" mono>
                        +{i + 1}: {n(v, 2)}
                      </Badge>
                    ))}
                  </div>
                </Card>
              </>
            )}
          </div>
        )}
      </SplitView>
    </div>
  );
}

