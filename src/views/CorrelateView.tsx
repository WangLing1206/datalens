import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { useFrame, useProfile } from '../app/hooks.ts';
import { useUI } from '../app/store.ts';
import { ViewHeader, SplitView, ControlGroup } from '../components/layout/ViewShell.tsx';
import { Badge, Button, Callout, Card, CheckList, EmptyState, Field, Segmented, StatTile, Switch, cx } from '../components/ui/index.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { EChart, useChartTheme } from '../components/charts/EChart.tsx';
import { heatmapOption, scatterOption } from '../components/charts/builders.ts';
import { kendall, lttb, pearson, spearman } from '../core/stats.ts';
import { linearRegression } from '../core/advanced.ts';

type Method = 'pearson' | 'spearman' | 'kendall';

/** Pairwise-complete correlation between two columns. */
function corrPair(a: (number | null)[], b: (number | null)[], method: Method): { r: number; n: number; sampled: boolean } {
  const x: number[] = [];
  const y: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === null || bv === null) continue;
    if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;
    x.push(av);
    y.push(bv);
  }
  if (method === 'kendall') {
    const k = kendall(x, y);
    return { r: k.value, n: x.length, sampled: k.sampled };
  }
  return { r: method === 'spearman' ? spearman(x, y) : pearson(x, y), n: x.length, sampled: false };
}

export function CorrelateView() {
  const { t, n } = useI18n();
  const frame = useFrame();
  const profile = useProfile(frame.frame);
  const theme = useChartTheme();
  const setView = useUI((s) => s.setView);

  const df = frame.frame;

  const [method, setMethod] = useState<Method>('pearson');
  const [selected, setSelected] = useState<string[]>([]);
  const [showValues, setShowValues] = useState(true);
  const [pair, setPair] = useState<{ a: string; b: string } | null>(null);
  const [showFit, setShowFit] = useState(true);

  const numeric = useMemo(() => df?.numericColumnNames() ?? [], [df]);

  // Adopt a deep-linked pair, else auto-pick up to 8 numeric columns.
  const params = useUI((s) => s.viewParams);
  useEffect(() => {
    if (!df || numeric.length === 0) return;
    if (params?.a && params?.b) {
      const a = String(params.a);
      const b = String(params.b);
      if (df.has(a) && df.has(b)) {
        setSelected([a, b]);
        setPair({ a, b });
      }
      useUI.getState().consumeViewParams();
      return;
    }
    if (selected.length === 0) {
      const pick = numeric.slice(0, 8);
      setSelected(pick);
      if (pick.length >= 2) setPair({ a: pick[0], b: pick[1] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, df, numeric.join(',')]);

  const matrix = useMemo(() => {
    if (!df) return null;
    const cols = (selected.length >= 2 ? selected : numeric.slice(0, 8)).filter((c) => df.has(c));
    if (cols.length < 2) return null;
    const data = cols.map((c) => df.require(c).data as (number | null)[]);
    const m: number[][] = cols.map(() => new Array<number>(cols.length).fill(NaN));
    let sampled = false;
    for (let i = 0; i < cols.length; i++) {
      m[i][i] = 1;
      for (let j = i + 1; j < cols.length; j++) {
        const { r, sampled: s } = corrPair(data[i], data[j], method);
        m[i][j] = r;
        m[j][i] = r;
        if (s) sampled = true;
      }
    }
    return { cols, m, sampled };
  }, [df, selected, numeric, method]);

  const pairs = useMemo(() => {
    if (!matrix) return [];
    const out: { a: string; b: string; r: number; n: number }[] = [];
    for (let i = 0; i < matrix.cols.length; i++) {
      for (let j = i + 1; j < matrix.cols.length; j++) {
        const r = matrix.m[i][j];
        if (!Number.isFinite(r)) continue;
        out.push({ a: matrix.cols[i], b: matrix.cols[j], r, n: 0 });
      }
    }
    return out.sort((p, q) => Math.abs(q.r) - Math.abs(p.r));
  }, [matrix]);

  const detail = useMemo(() => {
    if (!df || !pair) return null;
    if (!df.has(pair.a) || !df.has(pair.b)) return null;
    const ca = df.require(pair.a).data;
    const cb = df.require(pair.b).data;
    const pts: [number, number][] = [];
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < df.nRows; i++) {
      const av = ca[i];
      const bv = cb[i];
      if (av === null || bv === null) continue;
      const an = Number(av);
      const bn = Number(bv);
      if (!Number.isFinite(an) || !Number.isFinite(bn)) continue;
      pts.push([an, bn]);
      x.push(an);
      y.push(bn);
    }
    if (x.length < 3) return null;
    // When either variable is discrete (few distinct values), many rows share
    // the same (x, y) coordinate and the scatter degenerates into a couple of
    // dots. Collapse duplicates and size each point by how many rows it stands
    // for, which is the honest way to draw discrete data.
    const cellCounts = new Map<string, { x: number; y: number; n: number }>();
    for (let i = 0; i < pts.length; i++) {
      const k = `${pts[i][0]}\u0000${pts[i][1]}`;
      const e = cellCounts.get(k);
      if (e) e.n++;
      else cellCounts.set(k, { x: pts[i][0], y: pts[i][1], n: 1 });
    }
    const cells = [...cellCounts.values()];
    const distinct = new Set(x).size * new Set(y).size;
    const overplotted = cells.length < pts.length * 0.5 && cells.length < 400;
    void distinct;

    const corr = corrPair(ca as (number | null)[], cb as (number | null)[], method);
    const reg = linearRegression(
      x.map((v) => [v]),
      y,
      [pair.a],
    );
    const slope = reg.singular ? NaN : reg.coefficients[1];
    const intercept = reg.singular ? NaN : reg.coefficients[0];
    const fitX = [Math.min(...x), Math.max(...x)];
    const fitY = fitX.map((v) => intercept + slope * v);
    return { pts, x, y, corr, slope, intercept, r2: reg.r2, p: reg.pValues[1], reg, fitX, fitY, cells, overplotted };
  }, [df, pair, method]);

  const heatOption = useMemo(() => {
    if (!matrix || !theme) return null;
    return heatmapOption(theme, {
      xLabels: matrix.cols,
      yLabels: matrix.cols,
      cells: matrix.m,
      diverging: true,
      showValues,
      formatter: (v) => v.toFixed(2),
    });
  }, [matrix, theme, showValues]);

  const scatterData = useMemo(() => {
    if (!detail) return null;
    if (detail.pts.length <= 6000) return detail.pts;
    const xs = detail.pts.map((p) => p[0]);
    const ys = detail.pts.map((p) => p[1]);
    const d = lttb(xs, ys, 6000);
    return d.x.map((v, i) => [v, d.y[i]] as [number, number]);
  }, [detail]);

  if (!df || !profile) return null;

  const strengthLabel = (r: number): string => {
    const a = Math.abs(r);
    if (a >= 0.7) return t('correlate.strong');
    if (a >= 0.5) return t('correlate.moderate');
    if (a >= 0.3) return t('correlate.weak');
    return t('correlate.veryWeak');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader
        titleKey="correlate.title"
        subtitleKey="correlate.subtitle"
        meta={
          matrix && (
            <Badge tone="accent" className="tnum">
              {matrix.cols.length} × {matrix.cols.length}
            </Badge>
          )
        }
        actions={
          <Button size="sm" variant="secondary" icon="scatter" onClick={() => setView('studio', { preset: 'relation' })}>
            {t('studio.presetRelation')}
          </Button>
        }
      />

      <SplitView
        width={300}
        controls={
          <>
            <ControlGroup titleKey="correlate.method">
              <Segmented
                className="w-full"
                value={method}
                onChange={setMethod}
                options={[
                  { value: 'pearson', label: 'Pearson', title: t('correlate.pearson') },
                  { value: 'spearman', label: 'Spearman', title: t('correlate.spearman') },
                  { value: 'kendall', label: 'Kendall', title: t('correlate.kendall') },
                ]}
              />
              <p className="mt-2 text-[11px] leading-snug text-ink-faint">
                {t(method === 'pearson' ? 'correlate.linearHint' : 'correlate.rankHint')}
              </p>
            </ControlGroup>

            <ControlGroup titleKey="correlate.selectColumns" hintKey="correlate.selectHint">
              <CheckList
                items={numeric.map((c) => ({ value: c, label: c }))}
                selected={selected}
                onToggle={(v) => setSelected((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))}
                onSelectAll={() => setSelected(numeric.slice(0, 10))}
                onClear={() => setSelected([])}
                searchable
                maxHeight={200}
                emptyLabel={t('errors.noNumericColumns')}
                labels={{ search: t('common.searchPlaceholder'), all: t('common.selectAll'), clear: t('common.clear') }}
              />
            </ControlGroup>

            <ControlGroup titleKey="common.options">
              <div className="space-y-2.5">
                <Field label={t('correlate.showValues')} inline>
                  <Switch checked={showValues} onChange={setShowValues} />
                </Field>
                <Field label={t('correlate.showFit')} inline>
                  <Switch checked={showFit} onChange={setShowFit} />
                </Field>
              </div>
            </ControlGroup>

            {pairs.length > 0 && (
              <ControlGroup titleKey="correlate.pairs" hintKey="correlate.pairsHint">
                <div className="space-y-1">
                  {pairs.slice(0, 8).map((p) => (
                    <button
                      key={`${p.a}|${p.b}`}
                      type="button"
                      onClick={() => setPair({ a: p.a, b: p.b })}
                      className={cx(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        pair?.a === p.a && pair?.b === p.b ? 'bg-accent-soft' : 'hover:bg-surface-2',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">
                        {p.a} <span className="text-ink-faint">↔</span> {p.b}
                      </span>
                      <span
                        className={cx(
                          'tnum shrink-0 rounded px-1.5 py-0.5 font-mono text-[10.5px]',
                          Math.abs(p.r) >= 0.5 ? 'bg-accent-soft text-accent-ink' : 'bg-surface-3 text-ink-muted',
                        )}
                      >
                        {p.r.toFixed(3)}
                      </span>
                    </button>
                  ))}
                </div>
              </ControlGroup>
            )}
          </>
        }
      >
        {!matrix || matrix.cols.length < 2 ? (
          <Card>
            <EmptyState icon="scatter" title={t('correlate.selectHint')} hint={t('errors.noNumericColumns')} />
          </Card>
        ) : (
          <div className="space-y-5">
            <Card title={t('correlate.matrix')} subtitle={t('correlate.matrixHint')} icon="grid">
              {heatOption && (
                <EChart
                  height={Math.max(320, matrix.cols.length * 34 + 120)}
                  option={heatOption}
                  onEvents={{
                    click: (p) => {
                      const params = p as { value: [number, number, number] };
                      const [x, y] = params.value;
                      if (x === y) return;
                      setPair({ a: matrix.cols[y], b: matrix.cols[x] });
                    },
                  }}
                />
              )}
              {matrix.sampled && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-faint">
                  <Icon name="info" size={11} />
                  {t('correlate.sampled')}
                </p>
              )}
            </Card>

            {detail && pair && theme && (
              <Card
                title={`${pair.a} ↔ ${pair.b}`}
                subtitle={t('correlate.scatter')}
                icon="scatter"
                actions={
                  <>
                    <Badge tone={Math.abs(detail.corr.r) >= 0.5 ? 'accent' : 'neutral'} mono>
                      r = {detail.corr.r.toFixed(4)}
                    </Badge>
                    <Button size="sm" variant="ghost" icon="chart" onClick={() => setView('studio', { x: pair.a, y: pair.b, chart: 'scatter' })}>
                      {t('studio.title')}
                    </Button>
                  </>
                }
              >
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatTile label={t('correlate.n')} value={n(detail.corr.n, 0)} icon="table" />
                  <StatTile label={t('correlate.r2')} value={Number.isFinite(detail.r2) ? detail.r2.toFixed(4) : '—'} icon="target" tone="accent" />
                  <StatTile label={t('correlate.slope')} value={Number.isFinite(detail.slope) ? n(detail.slope, 5) : '—'} icon="axes" />
                  <StatTile
                    label={t('correlate.pvalue')}
                    value={Number.isFinite(detail.p) ? (detail.p < 0.0001 ? '<0.0001' : detail.p.toFixed(4)) : '—'}
                    icon="sigma"
                    tone={Number.isFinite(detail.p) && detail.p < 0.05 ? 'good' : 'neutral'}
                  />
                </div>

                <div className="mt-4">
                  {detail.overplotted && (
                    <p className="mb-2 flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                      <Icon name="info" size={12} />
                      {t('correlate.bubbleHint')}
                    </p>
                  )}
                  <EChart
                    height={320}
                    option={scatterOption(theme, {
                      points: detail.overplotted
                        ? detail.cells.map((c) => [c.x, c.y] as [number, number])
                        : scatterData ?? [],
                      xName: pair.a,
                      yName: pair.b,
                      symbolSize: detail.overplotted
                        ? (() => {
                            const maxN = Math.max(...detail.cells.map((c) => c.n), 1);
                            const byKey = new Map(detail.cells.map((c) => [`${c.x}\u0000${c.y}`, c.n]));
                            return (v: [number, number]) => {
                              const c = byKey.get(`${v[0]}\u0000${v[1]}`) ?? 1;
                              return 8 + Math.sqrt(c / maxN) * 26;
                            };
                          })()
                        : 7,
                      opacity: detail.overplotted ? 0.7 : 0.66,
                      ...(showFit && Number.isFinite(detail.slope)
                        ? { fitLine: { x: detail.fitX, y: detail.fitY, label: `${t('correlate.regression')}: y = ${detail.slope.toFixed(4)}x + ${detail.intercept.toFixed(4)}` } }
                        : {}),
                      pointFormatter: (v) => {
                        const c = detail.overplotted
                          ? detail.cells.find((cc) => cc.x === v[0] && cc.y === v[1])?.n
                          : undefined;
                        return `${pair.a}: <b>${n(v[0], 3)}</b><br/>${pair.b}: <b>${n(v[1], 3)}</b>${
                          c !== undefined ? `<br/>${t('correlate.observations', { n: n(c, 0) })}` : ''
                        }`;
                      },
                    })}
                  />
                </div>

                <Callout tone="accent" icon="bulb" className="mt-4">
                  {Math.abs(detail.corr.r) < 0.15
                    ? t('correlate.interpNone', { a: pair.a, b: pair.b, r: detail.corr.r.toFixed(3) })
                    : t(detail.corr.r > 0 ? 'correlate.interpPositive' : 'correlate.interpNegative', {
                        a: pair.a,
                        b: pair.b,
                        r: detail.corr.r.toFixed(3),
                        n: strengthLabel(detail.corr.r),
                      })}
                </Callout>

                <div className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-surface-2 p-3">
                  <Icon name="alert" size={14} className="mt-px shrink-0 text-warn" />
                  <div>
                    <p className="text-[12px] font-semibold text-ink">{t('correlate.warning')}</p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-muted">{t('correlate.warningDetail')}</p>
                  </div>
                </div>

                <pre className="scroll-thin mt-3 overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11.5px] text-ink-soft">
                  <code>{`df["${pair.a}"].corr(df["${pair.b}"], method="${method}")`}</code>
                </pre>
              </Card>
            )}

            <Card title={t('correlate.pairs')} subtitle={t('correlate.pairsHint')} dense>
              <div className="scroll-thin max-h-[380px] overflow-auto">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-surface-2">
                    <tr className="border-b border-line text-left text-[11px] text-ink-muted">
                      <th className="px-4 py-2 font-medium">{t('common.column')} A</th>
                      <th className="px-3 py-2 font-medium">{t('common.column')} B</th>
                      <th className="px-3 py-2 text-right font-medium">r</th>
                      <th className="px-3 py-2 font-medium">{t('correlate.strength')}</th>
                      <th className="px-3 py-2 font-medium">{t('correlate.direction')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.map((p) => (
                      <tr
                        key={`${p.a}|${p.b}`}
                        onClick={() => setPair({ a: p.a, b: p.b })}
                        className="cursor-pointer border-b border-line/50 last:border-0 hover:bg-surface-2"
                      >
                        <td className="px-4 py-1.5 font-medium text-ink">{p.a}</td>
                        <td className="px-3 py-1.5 font-medium text-ink">{p.b}</td>
                        <td className="tnum px-3 py-1.5 text-right">
                          <span
                            className={cx(
                              'rounded px-1.5 py-0.5 font-mono text-[11px]',
                              Math.abs(p.r) >= 0.7 ? 'bg-accent text-white' : Math.abs(p.r) >= 0.4 ? 'bg-accent-soft text-accent-ink' : 'text-ink-muted',
                            )}
                          >
                            {p.r.toFixed(4)}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-ink-soft">{strengthLabel(p.r)}</td>
                        <td className="px-3 py-1.5 text-ink-soft">
                          {p.r > 0 ? t('correlate.positive') : t('correlate.negative')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {pairs.length === 0 && (
              <Card>
                <EmptyState icon="check" title={t('correlate.noPairs')} />
              </Card>
            )}
          </div>
        )}
      </SplitView>
    </div>
  );
}
