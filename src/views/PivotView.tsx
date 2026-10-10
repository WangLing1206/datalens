import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { useFrame, useProfile } from '../app/hooks.ts';
import { ViewHeader, SplitView, ControlGroup } from '../components/layout/ViewShell.tsx';
import { Badge, Button, Card, EmptyState, Field, NumberInput, Segmented, Select, StatTile, Switch, useToast } from '../components/ui/index.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { EChart, useChartTheme, downloadBlob } from '../components/charts/EChart.tsx';
import { barOption, heatmapOption, treemapOption } from '../components/charts/builders.ts';
import { OTHER_LABEL, pivotTable, pivotToFrame } from '../core/pivot.ts';
import { AGG_FUNCS } from '../core/types.ts';
import type { AggFunc } from '../core/types.ts';
import type { MessageKey } from '../i18n/index.tsx';

type View = 'table' | 'heatmap' | 'treemap' | 'stacked';

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

export function PivotView() {
  const { t, n } = useI18n();
  const frame = useFrame();
  const profile = useProfile(frame.frame);
  const theme = useChartTheme();
  const toast = useToast();

  const df = frame.frame;

  const [rowKeys, setRowKeys] = useState<string[]>([]);
  const [colKeys, setColKeys] = useState<string[]>([]);
  const [values, setValues] = useState<string[]>([]);
  const [aggFunc, setAggFunc] = useState<AggFunc>('mean');
  const [fillEmpty, setFillEmpty] = useState(true);
  const [margins, setMargins] = useState(false);
  const [maxColumns, setMaxColumns] = useState(20);
  const [view, setView] = useState<View>('heatmap');
  const [showValues, setShowValues] = useState(true);

  const numeric = useMemo(() => df?.numericColumnNames() ?? [], [df]);
  const allCols = useMemo(() => df?.columnNames ?? [], [df]);
  const categorical = useMemo(() => df?.categoricalColumns().map((c) => c.name) ?? [], [df]);

  useEffect(() => {
    if (!df || rowKeys.length > 0) return;
    if (categorical.length && numeric.length) {
      setRowKeys([categorical[0]]);
      setColKeys(categorical[1] ? [categorical[1]] : []);
      setValues([numeric[0]]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [df]);

  const result = useMemo(() => {
    if (!df || rowKeys.length === 0 || values.length === 0) return null;
    try {
      return pivotTable(df, {
        index: rowKeys,
        columns: colKeys,
        values,
        aggfunc: aggFunc,
        ...(fillEmpty ? { fillValue: 0 } : {}),
        margins,
        maxColumns,
      });
    } catch {
      return null;
    }
  }, [df, rowKeys, colKeys, values, aggFunc, fillEmpty, margins, maxColumns]);

  const option = useMemo(() => {
    if (!result || !theme || result.isEmpty) return null;
    const yLabels = result.rowValues.map((r) => r.join(' · '));
    if (view === 'heatmap') {
      return heatmapOption(theme, {
        xLabels: result.columnLabels,
        yLabels,
        cells: result.cells,
        xName: colKeys.join(' · ') || values[0],
        yName: rowKeys.join(' · '),
        showValues,
        formatter: (v) => n(v, 2),
      });
    }
    if (view === 'treemap') {
      const items = yLabels.map((name, i) => ({
        name,
        value: result.cells[i].reduce<number>((a, v) => a + (v ?? 0), 0),
      }));
      return treemapOption(theme, { items, valueFormatter: (v) => n(v, 2) });
    }
    // stacked bar
    return barOption(theme, {
      categories: yLabels,
      series: result.columnLabels.slice(0, 12).map((label, c) => ({
        name: label,
        data: result.cells.map((row) => row[c] ?? null),
      })),
      stacked: true,
      showLegend: true,
      rotateLabels: yLabels.length > 10 ? 30 : 0,
      extraGridBottom: 26,
      valueFormatter: (v) => n(v, 2),
    });
  }, [result, theme, view, showValues, n, rowKeys, colKeys, values]);

  if (!df || !profile) return null;

  const configured = rowKeys.length > 0 && values.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader
        titleKey="pivot.title"
        subtitleKey="pivot.subtitle"
        meta={
          result && (
            <Badge tone="accent" className="tnum">
              {result.rowValues.length} × {result.columnLabels.length}
            </Badge>
          )
        }
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              onClick={() => {
                const r = rowKeys;
                setRowKeys(colKeys);
                setColKeys(r);
              }}
            >
              {t('pivot.swap')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="download"
              disabled={!result}
              onClick={() => {
                if (!result) return;
                const out = pivotToFrame(result);
                const header = out.columnNames;
                const lines = [header.join(',')];
                for (let i = 0; i < out.nRows; i++) {
                  lines.push(header.map((h) => {
                    const v = out.require(h).data[i];
                    if (v === null) return '';
                    const s = String(v);
                    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
                  }).join(','));
                }
                downloadBlob(lines.join('\n'), 'pivot.csv', 'text/csv');
                toast.show(t('report.exported', { name: 'pivot.csv' }), { tone: 'good' });
              }}
            >
              {t('pivot.exportTable')}
            </Button>
          </>
        }
      />

      <SplitView
        width={310}
        controls={
          <>
            <ControlGroup titleKey="pivot.rows">
              <Select
                multiple
                size={Math.min(6, Math.max(2, categorical.length))}
                value={rowKeys}
                onChange={(e) => setRowKeys(Array.from(e.target.selectedOptions, (o) => o.value))}
                className="!h-auto !py-1"
                options={allCols.map((c) => ({ value: c, label: c }))}
              />
            </ControlGroup>
            <ControlGroup titleKey="pivot.columns">
              <Select
                multiple
                size={Math.min(6, Math.max(2, categorical.length))}
                value={colKeys}
                onChange={(e) => setColKeys(Array.from(e.target.selectedOptions, (o) => o.value))}
                className="!h-auto !py-1"
                options={allCols.map((c) => ({ value: c, label: c }))}
              />
            </ControlGroup>
            <ControlGroup titleKey="pivot.values" hintKey="clean.fillNotNumeric">
              <Select
                multiple
                size={Math.min(6, Math.max(2, numeric.length))}
                value={values}
                onChange={(e) => setValues(Array.from(e.target.selectedOptions, (o) => o.value))}
                className="!h-auto !py-1"
                options={allCols.map((c) => ({ value: c, label: c }))}
              />
            </ControlGroup>
            <ControlGroup titleKey="pivot.aggFunc">
              <div className="space-y-3">
                <Select
                  value={aggFunc}
                  onChange={(e) => setAggFunc(e.target.value as AggFunc)}
                  options={AGG_FUNCS.map((f) => ({ value: f, label: t(AGG_LABEL[f]) }))}
                />
                <Field label={t('pivot.fillValue')} inline>
                  <Switch checked={fillEmpty} onChange={setFillEmpty} />
                </Field>
                <Field label={t('pivot.margins')} inline>
                  <Switch checked={margins} onChange={setMargins} />
                </Field>
                <Field label={t('pivot.maxColumns')} inline>
                  <NumberInput value={maxColumns} onChange={(v) => setMaxColumns(Math.round(v))} min={4} max={60} className="!w-20" />
                </Field>
              </div>
            </ControlGroup>
            <ControlGroup titleKey="pivot.viewAs">
              <div className="space-y-3">
                <Segmented
                  className="w-full"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'heatmap', label: t('pivot.viewHeatmap'), icon: 'grid' },
                    { value: 'table', label: t('pivot.viewTable'), icon: 'table' },
                  ]}
                />
                <Segmented
                  className="w-full"
                  value={view === 'treemap' ? 'treemap' : view === 'stacked' ? 'stacked' : 'heatmap'}
                  onChange={(v) => setView(v as View)}
                  options={[
                    { value: 'treemap', label: t('pivot.viewTreemap'), icon: 'layers' },
                    { value: 'stacked', label: t('pivot.viewStacked'), icon: 'chart' },
                  ]}
                />
                <Field label={t('pivot.showValues')} inline>
                  <Switch checked={showValues} onChange={setShowValues} />
                </Field>
              </div>
            </ControlGroup>
          </>
        }
      >
        {!configured ? (
          <Card>
            <EmptyState icon="grid" title={t('pivot.empty')} hint={t('pivot.subtitle')} />
          </Card>
        ) : !result || result.isEmpty ? (
          <Card>
            <EmptyState icon="grid" title={t('chart.noChartData')} hint={t('chart.noChartDataHint')} />
          </Card>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label={t('pivot.rows')} value={n(result.rowValues.length, 0)} icon="list" tone="accent" />
              <StatTile label={t('pivot.columns')} value={n(result.columnLabels.length, 0)} icon="columns" />
              <StatTile label={t('pivot.values')} value={values.join(', ')} icon="sigma" />
              <StatTile
                label={t('describe.missing')}
                value={n(result.droppedRows, 0)}
                tone={result.droppedRows > 0 ? 'warn' : 'good'}
                icon="alert"
              />
            </div>

            {result.maxColumnsTruncated && (
              <div className="flex items-center gap-2 rounded-lg bg-warn-soft p-3 text-[12px] text-ink-soft">
                <Icon name="alert" size={14} className="shrink-0 text-warn" />
                {t('pivot.truncated')}
              </div>
            )}
            {result.droppedRows > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-3 text-[12px] text-ink-soft">
                <Icon name="info" size={14} className="shrink-0 text-ink-muted" />
                {t('pivot.droppedRows', { n: n(result.droppedRows, 0) })}
              </div>
            )}

            {view !== 'table' && option && (
              <Card title={t('pivot.result')} subtitle={`${aggFunc}(${values.join(', ')})`} icon="chart">
                <EChart height={Math.max(320, Math.min(620, result.rowValues.length * 26 + 120))} option={option} />
              </Card>
            )}

            <Card title={t('pivot.result')} subtitle={t('pivot.heatmapHint')} icon="table" dense>
              <div className="scroll-thin max-h-[560px] overflow-auto">
                <table className="text-[12px]">
                  <thead className="sticky top-0 z-10 bg-surface-2">
                    <tr className="border-b border-line text-left text-[11px] text-ink-muted">
                      {result.rowKeyNames.map((k) => (
                        <th key={k} className="sticky left-0 z-20 bg-surface-2 px-3 py-2 font-medium whitespace-nowrap">
                          {k}
                        </th>
                      ))}
                      {result.columnLabels.map((c) => (
                        <th key={c} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                          {c === OTHER_LABEL ? t('chart.other') : c}
                        </th>
                      ))}
                      {result.marginsRow && (
                        <th className="px-3 py-2 text-right font-semibold text-ink whitespace-nowrap">{t('pivot.grandTotal')}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rowValues.map((rv, r) => {
                      const rowTotal = result.marginsColumn?.[r];
                      const max = Math.max(...result.cells[r].filter((v): v is number => v !== null), 0);
                      return (
                        <tr key={r} className="border-b border-line/50 last:border-0 hover:bg-surface-2">
                          {rv.map((v, k) => (
                            <td key={k} className="sticky left-0 z-10 bg-inherit px-3 py-1.5 font-medium whitespace-nowrap text-ink">
                              {v === '\u0000NULL' ? 'NaN' : v === '\u0000OTHER' ? t('chart.other') : v}
                            </td>
                          ))}
                          {result.cells[r].map((v, c) => (
                            <td
                              key={c}
                              className="tnum px-3 py-1.5 text-right whitespace-nowrap"
                              style={{
                                background:
                                  v === null || max === 0
                                    ? undefined
                                    : `color-mix(in srgb, var(--viz-1) ${Math.round((v / max) * 42)}%, transparent)`,
                              }}
                            >
                              {v === null ? <span className="italic text-ink-faint">NaN</span> : n(v, 2)}
                            </td>
                          ))}
                          {result.marginsRow && (
                            <td className="tnum px-3 py-1.5 text-right font-medium text-ink whitespace-nowrap">
                              {rowTotal === null || rowTotal === undefined ? '—' : n(rowTotal, 2)}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {result.marginsRow && (
                      <tr className="border-t-2 border-line bg-surface-2">
                        {result.rowKeyNames.map((_, k) => (
                          <td key={k} className="sticky left-0 z-10 bg-surface-2 px-3 py-2 font-semibold text-ink">
                            {k === 0 ? t('pivot.grandTotal') : ''}
                          </td>
                        ))}
                        {result.marginsRow.map((v, c) => (
                          <td key={c} className="tnum px-3 py-2 text-right font-medium text-ink whitespace-nowrap">
                            {v === null ? '—' : n(v, 2)}
                          </td>
                        ))}
                        {result.marginsRow && (
                          <td className="tnum px-3 py-2 text-right font-semibold text-ink whitespace-nowrap">
                            {result.grandTotal === null ? '—' : n(result.grandTotal, 2)}
                          </td>
                        )}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title={t('ops.codeMirror')} subtitle={t('ops.codeMirrorHint')} icon="code">
              <pre className="scroll-thin overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11.5px] text-ink-soft">
                <code>{`df.pivot_table(\n  index=${JSON.stringify(rowKeys)},\n  columns=${JSON.stringify(colKeys)},\n  values=${JSON.stringify(values)},\n  aggfunc="${aggFunc}"${fillEmpty ? ',\n  fill_value=0' : ''}${margins ? ',\n  margins=True' : ''}\n)`}</code>
              </pre>
            </Card>
          </div>
        )}
      </SplitView>
    </div>
  );
}

