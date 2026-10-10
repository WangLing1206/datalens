import { useMemo, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { useFrame, useInsights, useProfile } from '../app/hooks.ts';
import { useUI } from '../app/store.ts';
import { usePipeline, pipelineToPandas } from '../pipeline/store.ts';
import { ViewHeader, SplitView, ControlGroup, SectionTitle } from '../components/layout/ViewShell.tsx';
import { Badge, Button, Callout, Card, Checkbox, EmptyState, Field, Segmented, TextArea, TextInput, cx, useToast } from '../components/ui/index.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { downloadBlob } from '../components/charts/EChart.tsx';
import { INSIGHT_META } from './OverviewView.tsx';
import { OPERATIONS, stepDelta } from '../pipeline/operations.ts';
import type { OperationSpec } from '../pipeline/operations.ts';
import { dtypeLabel } from '../core/dtype.ts';
import { groupBy } from '../core/groupby.ts';
import type { Insight } from '../core/insights.ts';
import type { MessageKey } from '../i18n/index.tsx';

type SectionKey =
  | 'dataset' | 'quality' | 'insights' | 'stats' | 'pipeline' | 'code' | 'charts' | 'groupby' | 'correlation' | 'advanced';

const SECTION_LABEL: Record<SectionKey, MessageKey> = {
  dataset: 'report.sectionDataset',
  quality: 'report.sectionQuality',
  insights: 'report.sectionInsights',
  stats: 'report.sectionStats',
  pipeline: 'report.sectionPipeline',
  code: 'report.sectionCode',
  charts: 'report.sectionCharts',
  groupby: 'report.sectionGroupby',
  correlation: 'report.sectionCorrelation',
  advanced: 'report.sectionAdvanced',
};

const DEFAULT_SECTIONS: SectionKey[] = ['dataset', 'quality', 'insights', 'stats', 'pipeline', 'code', 'charts'];

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function ReportView() {
  const { t, n, pct, lang } = useI18n();
  const frame = useFrame();
  const profile = useProfile(frame.frame);
  const insights = useInsights(frame.frame, profile);
  const toast = useToast();
  const setView = useUI((s) => s.setView);
  const savedCharts = useUI((s) => s.savedCharts);
  const removeChart = useUI((s) => s.removeChart);
  const steps = usePipeline((s) => s.steps);
  const dataset = usePipeline((s) => s.dataset);

  const df = frame.frame;

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [sections, setSections] = useState<SectionKey[]>(DEFAULT_SECTIONS);
  const [reportTheme, setReportTheme] = useState<'light' | 'dark'>('light');

  const on = (k: SectionKey) => sections.includes(k);
  const toggle = (k: SectionKey) => setSections((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const grouped = useMemo(() => {
    if (!df || !on('groupby')) return null;
    const key = df.categoricalColumns()[0]?.name;
    const value = df.numericColumnNames()[0];
    if (!key || !value) return null;
    try {
      const g = groupBy(df, { keys: [key], aggs: [{ column: value, funcs: ['count', 'mean', 'median', 'std'] }] });
      return { key, value, result: g };
    } catch {
      return null;
    }
  }, [df, sections.join(',')]);

  const code = useMemo(() => pipelineToPandas(usePipeline.getState(), lang), [steps, dataset, lang]);

  const reportTitle = title.trim() || (dataset ? `${t('report.title')} · ${dataset.name}` : t('report.title'));
  const generatedAt = useMemo(() => new Date(), []);

  /* ---------------- HTML export ---------------- */

  const buildHtml = (): string => {
    if (!df || !profile) return '';
    const prof = profile;
    const isDark = reportTheme === 'dark';
    const bg = isDark ? '#0b0e14' : '#ffffff';
    const fg = isDark ? '#e8ebf2' : '#141824';
    const muted = isDark ? '#8592a8' : '#757f96';
    const line = isDark ? '#232b3a' : '#e2e5ee';
    const surface = isDark ? '#121722' : '#f7f8fb';
    const accent = isDark ? '#7c6cff' : '#5b52e8';

    const parts: string[] = [];
    parts.push(`<!doctype html><html lang="${lang === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(reportTitle)}</title>
<style>
  :root{color-scheme:${isDark ? 'dark' : 'light'}}
  *{box-sizing:border-box}
  body{margin:0;background:${bg};color:${fg};font:14px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:960px;margin:0 auto;padding:48px 28px 72px}
  h1{font-size:27px;margin:0 0 6px;letter-spacing:-.02em}
  h2{font-size:17px;margin:40px 0 12px;padding-bottom:8px;border-bottom:1px solid ${line}}
  h3{font-size:14px;margin:20px 0 8px}
  .meta{color:${muted};font-size:12.5px;margin-bottom:4px}
  .card{background:${surface};border:1px solid ${line};border-radius:12px;padding:16px;margin:14px 0}
  table{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}
  th,td{padding:7px 10px;border-bottom:1px solid ${line};text-align:left}
  th{color:${muted};font-weight:600;font-size:11.5px}
  td.num,th.num{text-align:right}
  .badge{display:inline-block;padding:2px 7px;border-radius:6px;background:${isDark ? '#1e2634' : '#eceef5'};color:${muted};font-size:11px;margin-right:6px}
  .insight{border-left:3px solid ${accent};padding:10px 14px;margin:10px 0;background:${surface};border-radius:0 8px 8px 0}
  .insight p{margin:4px 0 0;font-size:13px}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:14px 0}
  .kpi{background:${surface};border:1px solid ${line};border-radius:10px;padding:12px}
  .kpi .k{font-size:11.5px;color:${muted}}
  .kpi .v{font-size:20px;font-weight:600;margin-top:2px}
  pre{background:${surface};border:1px solid ${line};border-radius:10px;padding:14px;overflow:auto;font-size:12px;line-height:1.6}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .chart{background:${surface};border:1px solid ${line};border-radius:12px;padding:14px;margin:14px 0}
  .chart svg{max-width:100%;height:auto}
  footer{margin-top:56px;padding-top:18px;border-top:1px solid ${line};color:${muted};font-size:12px}
  .step{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid ${line};font-size:12.5px}
  .step .i{width:22px;height:22px;border-radius:6px;background:${isDark ? '#1e2634' : '#eceef5'};color:${muted};display:flex;align-items:center;justify-content:center;font-size:11px;flex:none}
  .delta{color:${muted};font-size:11.5px;margin-left:auto;white-space:nowrap}
</style></head><body><div class="wrap">`);

    parts.push(`<h1>${esc(reportTitle)}</h1>`);
    if (author.trim()) parts.push(`<p class="meta">${esc(author)}</p>`);
    parts.push(
      `<p class="meta">${t('report.generatedAt')}: ${generatedAt.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')}</p>`,
    );
    if (description.trim()) parts.push(`<div class="card">${esc(description)}</div>`);

    // Dataset
    if (on('dataset')) {
      parts.push(`<h2>${t('report.sectionDataset')}</h2>`);
      parts.push(
        `<div class="kpis">
        <div class="kpi"><div class="k">${t('overview.metricRows')}</div><div class="v">${n(df.nRows, 0)}</div></div>
        <div class="kpi"><div class="k">${t('overview.metricCols')}</div><div class="v">${n(df.nCols, 0)}</div></div>
        <div class="kpi"><div class="k">${t('overview.metricNumeric')}</div><div class="v">${profile.numericCount}</div></div>
        <div class="kpi"><div class="k">${t('overview.metricCategorical')}</div><div class="v">${profile.categoricalCount}</div></div>
        <div class="kpi"><div class="k">${t('overview.metricMissing')}</div><div class="v">${profile.cells ? pct(profile.missingCells / profile.cells) : '0%'}</div></div>
        <div class="kpi"><div class="k">${t('overview.metricDuplicates')}</div><div class="v">${n(profile.duplicateRows, 0)}</div></div>
      </div>`,
      );
      parts.push(
        `<p>${t('report.datasetSummary', {
          name: esc(dataset?.name ?? 'df'),
          rows: n(df.nRows, 0),
          cols: n(df.nCols, 0),
          numeric: profile.numericCount,
          categorical: profile.categoricalCount,
          datetime: profile.datetimeCount,
          missing: (profile.cells ? (profile.missingCells / profile.cells) * 100 : 0).toFixed(1),
        })}</p>`,
      );
    }

    // Quality
    if (on('quality')) {
      parts.push(`<h2>${t('report.sectionQuality')}</h2>`);
      parts.push(
        `<p><span class="badge">${t('overview.health')} ${profile.healthScore}</span>${
          profile.healthBreakdown.length === 0 ? t('overview.qualityPass') : ''
        }</p>`,
      );
      if (profile.healthBreakdown.length) {
        parts.push(
          `<table><thead><tr><th>${t('common.column')}</th><th class="num">${t('common.count')}</th></tr></thead><tbody>` +
            profile.healthBreakdown
              .map(
                (b) =>
                  `<tr><td>${t(
                    b.key === 'missing'
                      ? 'overview.penaltyMissing'
                      : b.key === 'duplicates'
                        ? 'overview.penaltyDuplicates'
                        : b.key === 'small'
                          ? 'overview.penaltySmall'
                          : b.key === 'empty-columns'
                            ? 'overview.penaltyEmptyColumns'
                            : 'overview.penaltyConstantColumns',
                  )}</td><td class="num">${esc(b.detail)}</td></tr>`,
              )
              .join('') +
            `</tbody></table>`,
        );
      }
      parts.push(
        `<table><thead><tr><th>${t('overview.colName')}</th><th>${t('overview.colType')}</th><th class="num">${t('overview.colNonNull')}</th><th class="num">${t('overview.colMissing')}</th><th class="num">${t('overview.colUnique')}</th></tr></thead><tbody>` +
          profile.columns
            .map(
              (c) =>
                `<tr><td>${esc(c.name)}</td><td>${dtypeLabel(c.dtype)}</td><td class="num">${c.count}</td><td class="num">${pct(c.missingPct)}</td><td class="num">${c.uniqueCount}</td></tr>`,
            )
            .join('') +
          `</tbody></table>`,
      );
    }

    // Insights
    if (on('insights') && insights.length) {
      parts.push(`<h2>${t('report.sectionInsights')}</h2>`);
      for (const i of insights) {
        parts.push(
          `<div class="insight"><span class="badge">${t(INSIGHT_META[i.category].labelKey)}</span>${
            i.metric ? `<span class="badge">${esc(i.metric)}</span>` : ''
          }<p>${esc(i.body)}</p></div>`,
        );
      }
    }

    // Stats
    if (on('stats')) {
      parts.push(`<h2>${t('report.sectionStats')}</h2>`);
      const stats: { key: string; label: string; get: (c: (typeof prof.columns)[number]) => string }[] = [
        { key: 'count', label: t('describe.count'), get: (c) => n(c.count, 0) },
        { key: 'missing', label: t('describe.missing'), get: (c) => n(c.missing, 0) },
        { key: 'mean', label: t('describe.mean'), get: (c) => (c.numeric ? n(c.numeric.mean, 3) : '—') },
        { key: 'std', label: t('describe.std'), get: (c) => (c.numeric ? n(c.numeric.std, 3) : '—') },
        { key: 'min', label: t('describe.min'), get: (c) => (c.numeric ? n(c.numeric.min, 3) : '—') },
        { key: 'q1', label: t('describe.q1'), get: (c) => (c.numeric ? n(c.numeric.q1, 3) : '—') },
        { key: 'median', label: t('describe.median'), get: (c) => (c.numeric ? n(c.numeric.median, 3) : '—') },
        { key: 'q3', label: t('describe.q3'), get: (c) => (c.numeric ? n(c.numeric.q3, 3) : '—') },
        { key: 'max', label: t('describe.max'), get: (c) => (c.numeric ? n(c.numeric.max, 3) : '—') },
        { key: 'skew', label: t('describe.skew'), get: (c) => (c.numeric ? n(c.numeric.skew, 3) : '—') },
      ];
      parts.push(
        `<table><thead><tr><th>${t('overview.colName')}</th>${stats.map((s) => `<th class="num">${s.label}</th>`).join('')}</tr></thead><tbody>` +
          profile.columns
            .map((c) => `<tr><td>${esc(c.name)}</td>${stats.map((s) => `<td class="num">${s.get(c)}</td>`).join('')}</tr>`)
            .join('') +
          `</tbody></table>`,
      );
    }

    // Pipeline
    if (on('pipeline')) {
      parts.push(`<h2>${t('report.sectionPipeline')}</h2>`);
      parts.push(`<p>${t('report.pipelineSummary', { n: steps.length })}</p>`);
      parts.push(
        steps
          .map((s, i) => {
            const spec = OPERATIONS[s.op.kind] as OperationSpec;
            const d = stepDelta(s);
            return `<div class="step"><span class="i">${i + 1}</span><span><b>${t(spec.labelKey)}</b><br><span style="color:${muted}">${esc(
              spec.summarize(s.op, lang),
            )}</span></span><span class="delta">${s.rowsBefore} → ${s.rowsAfter} (${d.rows >= 0 ? '+' : ''}${d.rows})</span></div>`;
          })
          .join('') || `<p>${t('ops.pipelineEmpty')}</p>`,
      );
    }

    // Code
    if (on('code') && steps.length) {
      parts.push(`<h2>${t('report.sectionCode')}</h2><pre><code>${esc(code)}</code></pre>`);
    }

    // Charts
    if (on('charts') && savedCharts.length) {
      parts.push(`<h2>${t('report.sectionCharts')}</h2>`);
      for (const c of savedCharts) {
        parts.push(`<div class="chart"><h3>${esc(c.title)}</h3>${c.svg ?? `<p>${t('chart.noChartData')}</p>`}</div>`);
      }
    }

    // Grouped results
    if (on('groupby') && grouped) {
      parts.push(`<h2>${t('report.sectionGroupby')}</h2>`);
      parts.push(`<p>${grouped.key} → ${grouped.value}</p>`);
      const cols = grouped.result.valueColumns;
      parts.push(
        `<table><thead><tr><th>${esc(grouped.key)}</th>${cols.map((c) => `<th class="num">${esc(c)}</th>`).join('')}</tr></thead><tbody>` +
          grouped.result.df.index
            .map((_, i) => {
              const k = grouped.result.df.require(grouped.key).data[i];
              return `<tr><td>${esc(String(k ?? 'NaN'))}</td>${cols
                .map((c) => {
                  const v = grouped.result.df.require(c).data[i];
                  return `<td class="num">${typeof v === 'number' ? n(v, 3) : '—'}</td>`;
                })
                .join('')}</tr>`;
            })
            .join('') +
          `</tbody></table>`,
      );
    }

    parts.push(
      `<footer>${t('app.name')} · ${t('app.tagline')} · ${t('report.generatedAt')} ${generatedAt.toISOString().slice(0, 10)}</footer>`,
    );
    parts.push(`</div></body></html>`);
    return parts.join('\n');
  };

  const buildMarkdown = (): string => {
    const lines: string[] = [];
    lines.push(`# ${reportTitle}`, '');
    if (author.trim()) lines.push(`**${t('report.author')}**: ${author}`, '');
    lines.push(`_${t('report.generatedAt')}: ${generatedAt.toISOString().slice(0, 10)}_`, '');
    if (description.trim()) lines.push(description, '');

    if (on('dataset') && df) {
      lines.push(`## ${t('report.sectionDataset')}`, '');
      lines.push(
        `- ${t('overview.metricRows')}: **${n(df.nRows, 0)}**`,
        `- ${t('overview.metricCols')}: **${n(df.nCols, 0)}**`,
        `- ${t('overview.metricNumeric')}: ${profile?.numericCount ?? 0}`,
        `- ${t('overview.metricCategorical')}: ${profile?.categoricalCount ?? 0}`,
        `- ${t('overview.metricMissing')}: ${profile && profile.cells ? pct(profile.missingCells / profile.cells) : '0%'}`,
        `- ${t('overview.metricDuplicates')}: ${n(profile?.duplicateRows ?? 0, 0)}`,
        '',
      );
    }
    if (on('insights') && insights.length) {
      lines.push(`## ${t('report.sectionInsights')}`, '');
      for (const i of insights) lines.push(`- **[${t(INSIGHT_META[i.category].labelKey)}]** ${i.body}`);
      lines.push('');
    }
    if (on('stats') && profile) {
      lines.push(`## ${t('report.sectionStats')}`, '');
      lines.push(
        `| ${t('overview.colName')} | ${t('describe.count')} | ${t('describe.mean')} | ${t('describe.std')} | ${t('describe.min')} | ${t('describe.median')} | ${t('describe.max')} |`,
        '|---|---:|---:|---:|---:|---:|---:|',
      );
      for (const c of profile.columns) {
        lines.push(
          `| ${c.name} | ${c.count} | ${c.numeric ? n(c.numeric.mean, 3) : '—'} | ${c.numeric ? n(c.numeric.std, 3) : '—'} | ${c.numeric ? n(c.numeric.min, 3) : '—'} | ${c.numeric ? n(c.numeric.median, 3) : '—'} | ${c.numeric ? n(c.numeric.max, 3) : '—'} |`,
        );
      }
      lines.push('');
    }
    if (on('pipeline')) {
      lines.push(`## ${t('report.sectionPipeline')}`, '');
      steps.forEach((s, i) => {
        const spec = OPERATIONS[s.op.kind] as OperationSpec;
        lines.push(`${i + 1}. **${t(spec.labelKey)}** — ${spec.summarize(s.op, lang)} (${s.rowsBefore} → ${s.rowsAfter})`);
      });
      lines.push('');
    }
    if (on('code') && steps.length) {
      lines.push(`## ${t('report.sectionCode')}`, '', '```python', code, '```', '');
    }
    return lines.join('\n');
  };

  const exportCsv = () => {
    if (!df) return;
    const header = df.columnNames;
    const lines = [header.join(',')];
    for (let i = 0; i < df.nRows; i++) {
      lines.push(
        header
          .map((h) => {
            const v = df.require(h).data[i];
            if (v === null) return '';
            const s = String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(','),
      );
    }
    downloadBlob(lines.join('\n'), 'data.csv', 'text/csv');
    toast.show(t('report.exported', { name: 'data.csv' }), { tone: 'good' });
  };

  const exportXlsx = async () => {
    if (!df) return;
    const XLSX = await import('xlsx');
    const aoa: (string | number | boolean | null)[][] = [df.columnNames];
    for (let i = 0; i < df.nRows; i++) {
      aoa.push(
        df.columns.map((c) => {
          const v = c.data[i];
          if (v === null) return null;
          if (c.dtype === 'datetime') return new Date(Number(v)).toISOString().slice(0, 10);
          return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
        }),
      );
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'data');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    downloadBlob(out, 'data.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast.show(t('report.exported', { name: 'data.xlsx' }), { tone: 'good' });
  };

  const exportProject = () => {
    const payload = { version: 1, dataset, ops: steps.map((s) => s.op) };
    downloadBlob(JSON.stringify(payload, null, 2), 'analysis.daproj.json', 'application/json');
    toast.show(t('ops.projectExported'), { tone: 'good' });
  };

  if (!df || !profile) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader
        titleKey="report.title"
        subtitleKey="report.subtitle"
        meta={
          <Badge tone="accent" className="tnum">
            {t('ops.stepCount', { n: steps.length })} · {savedCharts.length} {t('report.sectionCharts')}
          </Badge>
        }
        actions={
          <>
            <Button size="sm" variant="secondary" icon="download" onClick={exportCsv}>
              {t('report.exportCsv')}
            </Button>
            <Button size="sm" variant="secondary" icon="download" onClick={exportXlsx}>
              {t('report.exportXlsx')}
            </Button>
            <Button size="sm" variant="secondary" icon="code" onClick={exportProject}>
              {t('report.exportJson')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon="report"
              onClick={() => {
                downloadBlob(buildHtml(), 'analysis-report.html', 'text/html');
                toast.show(t('report.exported', { name: 'analysis-report.html' }), { tone: 'good' });
              }}
            >
              {t('report.exportHtml')}
            </Button>
          </>
        }
      />

      <SplitView
        width={320}
        controls={
          <>
            <ControlGroup titleKey="report.meta">
              <div className="space-y-3">
                <Field label={t('report.reportTitle')}>
                  <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder={reportTitle} />
                </Field>
                <Field label={t('report.author')}>
                  <TextInput value={author} onChange={(e) => setAuthor(e.target.value)} placeholder={t('report.authorPlaceholder')} />
                </Field>
                <Field label={t('report.description')}>
                  <TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('report.descriptionPlaceholder')} />
                </Field>
              </div>
            </ControlGroup>

            <ControlGroup
              titleKey="report.sections"
              hintKey="report.sectionsHint"
              actions={
                <Button size="sm" variant="ghost" icon="refresh" onClick={() => setSections(DEFAULT_SECTIONS)}>
                  {t('common.reset')}
                </Button>
              }
            >
              <div className="space-y-2">
                {(Object.keys(SECTION_LABEL) as SectionKey[]).map((k) => (
                  <Checkbox
                    key={k}
                    checked={on(k)}
                    onChange={() => toggle(k)}
                    label={t(SECTION_LABEL[k])}
                    hint={
                      k === 'charts' && savedCharts.length === 0
                        ? t('report.noChartsHint')
                        : k === 'code' && steps.length === 0
                          ? t('ops.pipelineEmpty')
                          : undefined
                    }
                  />
                ))}
              </div>
            </ControlGroup>

            <ControlGroup titleKey="report.colorMode">
              <Segmented
                className="w-full"
                value={reportTheme}
                onChange={setReportTheme}
                options={[
                  { value: 'light', label: t('report.colorLight'), icon: 'sun' },
                  { value: 'dark', label: t('report.colorDark'), icon: 'moon' },
                ]}
              />
              <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('report.htmlHint')}</p>
            </ControlGroup>

            <ControlGroup titleKey="report.savedCharts">
              {savedCharts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line p-3 text-center">
                  <p className="text-[12px] text-ink-muted">{t('report.noCharts')}</p>
                  <Button size="sm" variant="ghost" icon="chart" className="mt-2" onClick={() => setView('studio')}>
                    {t('nav.studio')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {savedCharts.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1.5">
                      <Icon name="chart" size={12} className="shrink-0 text-accent" />
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink" title={c.title}>
                        {c.title}
                      </span>
                      <button
                        type="button"
                        aria-label={t('report.removeChart')}
                        onClick={() => removeChart(c.id)}
                        className="shrink-0 rounded p-0.5 text-ink-faint hover:text-bad"
                      >
                        <Icon name="x" size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </ControlGroup>
          </>
        }
      >
        <div className="space-y-5">
          {steps.length === 0 && savedCharts.length === 0 && (
            <Callout tone="accent" icon="bulb" title={t('report.noCharts')}>
              {t('report.noChartsHint')}
            </Callout>
          )}

          <Card
            title={t('report.preview')}
            subtitle={t('report.previewHint')}
            icon="report"
            actions={
              <Button
                size="sm"
                variant="ghost"
                icon="download"
                onClick={() => {
                  downloadBlob(buildMarkdown(), 'analysis-report.md', 'text/markdown');
                  toast.show(t('report.exported', { name: 'analysis-report.md' }), { tone: 'good' });
                }}
              >
                {t('report.exportMd')}
              </Button>
            }
          >
            <article
              className={cx(
                'rounded-xl border p-6',
                reportTheme === 'light' ? 'border-line bg-white text-[#141824]' : 'border-line bg-[#0b0e14] text-[#e8ebf2]',
              )}
            >
              <h1 className="text-[21px] font-semibold tracking-tight">{reportTitle}</h1>
              {author.trim() && <p className="mt-1 text-[12.5px] opacity-70">{author}</p>}
              <p className="mt-0.5 text-[12px] opacity-60">
                {t('report.generatedAt')}: {generatedAt.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')}
              </p>
              {description.trim() && (
                <p className="mt-3 rounded-lg border border-current/10 p-3 text-[12.5px] leading-relaxed opacity-80">{description}</p>
              )}

              {on('dataset') && (
                <section className="mt-6">
                  <h2 className="border-b border-current/15 pb-1.5 text-[15px] font-semibold">{t('report.sectionDataset')}</h2>
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {[
                      [t('overview.metricRows'), n(df.nRows, 0)],
                      [t('overview.metricCols'), n(df.nCols, 0)],
                      [t('overview.metricNumeric'), String(profile.numericCount)],
                      [t('overview.metricCategorical'), String(profile.categoricalCount)],
                      [t('overview.metricMissing'), profile.cells ? pct(profile.missingCells / profile.cells) : '0%'],
                      [t('overview.metricDuplicates'), n(profile.duplicateRows, 0)],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-lg border border-current/12 p-2.5">
                        <p className="text-[10.5px] opacity-60">{k}</p>
                        <p className="tnum mt-0.5 text-[16px] font-semibold">{v}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[12.5px] leading-relaxed opacity-80">
                    {t('report.datasetSummary', {
                      name: dataset?.name ?? 'df',
                      rows: n(df.nRows, 0),
                      cols: n(df.nCols, 0),
                      numeric: profile.numericCount,
                      categorical: profile.categoricalCount,
                      datetime: profile.datetimeCount,
                      missing: (profile.cells ? (profile.missingCells / profile.cells) * 100 : 0).toFixed(1),
                    })}
                  </p>
                </section>
              )}

              {on('quality') && (
                <section className="mt-6">
                  <h2 className="border-b border-current/15 pb-1.5 text-[15px] font-semibold">{t('report.sectionQuality')}</h2>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-current/15 px-2 py-0.5 text-[11.5px]">
                      {t('overview.health')} <b>{profile.healthScore}</b>
                    </span>
                    {profile.healthBreakdown.map((b) => (
                      <span key={b.key} className="rounded-md border border-current/15 px-2 py-0.5 text-[11.5px] opacity-75">
                        {b.key} {b.detail} (−{b.penalty})
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-current/15 opacity-60">
                          <th className="py-1.5 text-left font-medium">{t('overview.colName')}</th>
                          <th className="py-1.5 text-left font-medium">{t('overview.colType')}</th>
                          <th className="py-1.5 text-right font-medium">{t('overview.colNonNull')}</th>
                          <th className="py-1.5 text-right font-medium">{t('overview.colMissing')}</th>
                          <th className="py-1.5 text-right font-medium">{t('overview.colUnique')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.columns.map((c) => (
                          <tr key={c.name} className="border-b border-current/8">
                            <td className="py-1.5 font-medium">{c.name}</td>
                            <td className="py-1.5 opacity-70">{dtypeLabel(c.dtype)}</td>
                            <td className="tnum py-1.5 text-right">{n(c.count, 0)}</td>
                            <td className="tnum py-1.5 text-right">{pct(c.missingPct)}</td>
                            <td className="tnum py-1.5 text-right">{n(c.uniqueCount, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {on('insights') && insights.length > 0 && (
                <section className="mt-6">
                  <h2 className="border-b border-current/15 pb-1.5 text-[15px] font-semibold">{t('report.sectionInsights')}</h2>
                  <div className="mt-3 space-y-2">
                    {insights.map((i: Insight) => (
                      <div key={i.id} className="rounded-r-lg border-l-[3px] border-l-[var(--c-accent)] bg-current/5 py-2.5 pr-3 pl-3">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-current/10 px-1.5 py-0.5 text-[10.5px] opacity-80">
                            {t(INSIGHT_META[i.category].labelKey)}
                          </span>
                          {i.metric && <span className="tnum text-[10.5px] opacity-60">{i.metric}</span>}
                        </div>
                        <p className="mt-1 text-[12.5px] leading-relaxed">{i.body}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {on('pipeline') && (
                <section className="mt-6">
                  <h2 className="border-b border-current/15 pb-1.5 text-[15px] font-semibold">{t('report.sectionPipeline')}</h2>
                  <p className="mt-2 text-[12.5px] opacity-75">{t('report.pipelineSummary', { n: steps.length })}</p>
                  <ol className="mt-3 space-y-0">
                    {steps.map((s, i) => {
                      const spec = OPERATIONS[s.op.kind] as OperationSpec;
                      const d = stepDelta(s);
                      return (
                        <li key={s.id} className="flex items-center gap-3 border-b border-current/8 py-2 text-[12.5px]">
                          <span className="grid size-5 shrink-0 place-items-center rounded bg-current/10 text-[10.5px] opacity-70">
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <b>{t(spec.labelKey)}</b>
                            <span className="ml-2 opacity-60">{spec.summarize(s.op, lang)}</span>
                          </span>
                          <span className="tnum shrink-0 text-[11.5px] opacity-60">
                            {s.rowsBefore} → {s.rowsAfter} ({d.rows >= 0 ? '+' : ''}
                            {d.rows})
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}

              {on('code') && steps.length > 0 && (
                <section className="mt-6">
                  <h2 className="border-b border-current/15 pb-1.5 text-[15px] font-semibold">{t('report.sectionCode')}</h2>
                  <pre className="scroll-thin mt-3 overflow-x-auto rounded-lg border border-current/15 bg-current/5 p-3 font-mono text-[11.5px] leading-relaxed">
                    <code>{code}</code>
                  </pre>
                </section>
              )}

              {on('charts') && savedCharts.length > 0 && (
                <section className="mt-6">
                  <h2 className="border-b border-current/15 pb-1.5 text-[15px] font-semibold">{t('report.sectionCharts')}</h2>
                  <div className="mt-3 space-y-3">
                    {savedCharts.map((c) => (
                      <div key={c.id} className="rounded-lg border border-current/15 p-3">
                        <p className="mb-2 text-[12.5px] font-medium">{c.title}</p>
                        {c.svg ? (
                          <div className="overflow-hidden rounded" dangerouslySetInnerHTML={{ __html: c.svg }} />
                        ) : (
                          <p className="text-[12px] opacity-60">{t('chart.noChartDataHint')}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {on('groupby') && grouped && (
                <section className="mt-6">
                  <h2 className="border-b border-current/15 pb-1.5 text-[15px] font-semibold">{t('report.sectionGroupby')}</h2>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-current/15 opacity-60">
                          <th className="py-1.5 text-left font-medium">{grouped.key}</th>
                          {grouped.result.valueColumns.map((c) => (
                            <th key={c} className="py-1.5 text-right font-medium">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {grouped.result.df.index.map((_, i) => (
                          <tr key={i} className="border-b border-current/8">
                            <td className="py-1.5 font-medium">{String(grouped.result.df.require(grouped.key).data[i] ?? 'NaN')}</td>
                            {grouped.result.valueColumns.map((c) => {
                              const v = grouped.result.df.require(c).data[i];
                              return (
                                <td key={c} className="tnum py-1.5 text-right opacity-80">
                                  {typeof v === 'number' ? n(v, 3) : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <footer className="mt-8 border-t border-current/15 pt-3 text-[11.5px] opacity-55">
                {t('app.name')} · {t('app.tagline')} · {generatedAt.toISOString().slice(0, 10)}
              </footer>
            </article>
          </Card>

          {on('charts') && savedCharts.length === 0 && (
            <Card>
              <EmptyState
                icon="chart"
                title={t('report.noCharts')}
                hint={t('report.noChartsHint')}
                action={
                  <Button variant="primary" icon="chart" onClick={() => setView('studio')}>
                    {t('nav.studio')}
                  </Button>
                }
              />
            </Card>
          )}

          <SectionTitle titleKey="report.exportData" hint={t('report.htmlHint')} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Button variant="secondary" icon="download" onClick={exportCsv} block>
              {t('report.exportCsv')}
            </Button>
            <Button variant="secondary" icon="download" onClick={exportXlsx} block>
              {t('report.exportXlsx')}
            </Button>
            <Button variant="secondary" icon="code" onClick={exportProject} block>
              {t('report.exportJson')}
            </Button>
            <Button variant="secondary" icon="report" onClick={() => window.print()} block>
              {t('report.printPdf')}
            </Button>
          </div>
        </div>
      </SplitView>
    </div>
  );
}
