import { useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n/index.tsx';
import { pipelineToPandas, usePipeline } from '../../pipeline/store.ts';
import { OPERATIONS, stepDelta } from '../../pipeline/operations.ts';
import type { OperationSpec, PipelineStep } from '../../pipeline/operations.ts';
import { importProject } from '../../app/project.ts';
import { Badge, Button, EmptyState, IconButton, Segmented, cx, useToast } from '../ui/index.tsx';
import { Icon } from '../ui/Icon.tsx';
import { downloadBlob } from '../charts/EChart.tsx';

/**
 * The analysis pipeline rail.
 *
 * Two views of the same thing: the ordered list of operations the analyst
 * performed, and the pandas script those operations add up to. Together they
 * make the *process* visible — which is the point of the whole tool.
 */

const OP_ICON: Record<string, string> = {
  filter: 'filter',
  dropna: 'broom',
  fillna: 'wand',
  dedupe: 'copy',
  cast: 'refresh',
  rename: 'edit',
  dropColumns: 'trash',
  sort: 'sortAsc',
  assign: 'plus',
  bin: 'crop',
  normalize: 'scale',
  onehot: 'grid',
  melt: 'layers',
  outlier: 'alert',
  head: 'list',
  sample: 'target',
};

function Delta({ before, after, unit, invert }: { before: number; after: number; unit: string; invert?: boolean }) {
  const d = after - before;
  if (d === 0) {
    return (
      <span className="tnum text-[11px] text-ink-faint">
        {after.toLocaleString()} {unit}
      </span>
    );
  }
  const good = invert ? d > 0 : d < 0;
  return (
    <span className="inline-flex items-center gap-1 text-[11px]">
      <span className="tnum text-ink-faint">{before.toLocaleString()}</span>
      <Icon name="arrowRight" size={10} className="text-ink-faint" />
      <span className="tnum font-medium text-ink">{after.toLocaleString()}</span>
      <span
        className={cx(
          'tnum rounded px-1 py-px text-[10.5px] font-medium',
          good ? 'bg-good-soft text-good' : 'bg-warn-soft text-warn',
        )}
      >
        {d > 0 ? '+' : ''}
        {d.toLocaleString()}
      </span>
    </span>
  );
}

function StepCard({
  step,
  index,
  active,
  isLast,
  onView,
  onRevert,
}: {
  step: PipelineStep;
  index: number;
  active: boolean;
  isLast: boolean;
  onView: () => void;
  onRevert: () => void;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const spec = OPERATIONS[step.op.kind] as OperationSpec;
  const delta = stepDelta(step);
  const params = spec.params(step.op, lang);

  return (
    <li className="relative">
      {/* connector line */}
      {!isLast && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-line" aria-hidden />}
      <div
        className={cx(
          'group relative rounded-lg border p-2.5 transition-colors duration-150',
          active ? 'border-accent/50 bg-accent-soft/50' : 'border-line bg-surface hover:border-line-strong',
        )}
      >
        <div className="flex items-start gap-2">
          <span
            className={cx(
              'mt-0.5 grid size-6 shrink-0 place-items-center rounded-md',
              active ? 'bg-accent text-white' : 'bg-surface-3 text-ink-muted',
            )}
          >
            <Icon name={OP_ICON[step.op.kind] ?? 'settings'} size={12} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="tnum shrink-0 text-[10.5px] font-medium text-ink-faint">{index + 1}</span>
              <button
                type="button"
                onClick={onView}
                className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-ink hover:text-accent-ink"
                title={t('ops.viewingHistory', { n: index + 1 })}
              >
                {t(spec.labelKey)}
              </button>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-label={open ? t('common.less') : t('common.more')}
                className="shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
              >
                <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} />
              </button>
            </div>

            <p className="mt-0.5 truncate text-[11px] text-ink-muted">{spec.summarize(step.op, lang)}</p>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <Icon name="table" size={10} className="text-ink-faint" />
                <Delta before={step.rowsBefore} after={step.rowsAfter} unit={t('units.rows')} />
              </span>
              {delta.cols !== 0 && (
                <span className="inline-flex items-center gap-1">
                  <Icon name="columns" size={10} className="text-ink-faint" />
                  <Delta before={step.colsBefore} after={step.colsAfter} unit={t('units.cols')} />
                </span>
              )}
              {delta.missing !== 0 && (
                <span className="inline-flex items-center gap-1">
                  <Icon name="alert" size={10} className="text-ink-faint" />
                  <Delta before={step.missingBefore} after={step.missingAfter} unit="" invert />
                </span>
              )}
            </div>

            {step.note?.startsWith('cast-failed:') && (
              <p className="mt-1.5 text-[11px] text-warn">
                {t('dtype.castFailed', { n: step.note.split(':')[1], type: '' })}
              </p>
            )}

            {open && params.length > 0 && (
              <dl className="mt-2 space-y-1 rounded-md border border-line bg-surface-2 p-2">
                {params.map((p, i) => (
                  <div key={i} className="flex gap-2 text-[11px]">
                    <dt className="shrink-0 text-ink-faint">{t(p.key)}</dt>
                    <dd className="min-w-0 flex-1 truncate font-mono text-ink-soft" title={p.value}>
                      {p.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>

        {active && (
          <div className="mt-2 flex items-center gap-1.5 border-t border-accent/20 pt-2">
            <Badge tone="accent" icon="history">
              {t('ops.stepOf', { n: index + 1 })}
            </Badge>
            <Button size="sm" variant="ghost" onClick={onRevert} className="ml-auto">
              {t('ops.revertHere')}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

export function PipelineRail() {
  const { t, lang } = useI18n();
  const steps = usePipeline((s) => s.steps);
  const redoStack = usePipeline((s) => s.redoStack);
  const viewCount = usePipeline((s) => s.viewCount);
  const undo = usePipeline((s) => s.undo);
  const redo = usePipeline((s) => s.redo);
  const clearPipeline = usePipeline((s) => s.clearPipeline);
  const viewStep = usePipeline((s) => s.viewStep);
  const revertTo = usePipeline((s) => s.revertTo);
  const dataset = usePipeline((s) => s.dataset);
  // Row/column counts of the frame currently on screen, taken from the step
  // deltas rather than by re-deriving the frame. Kept as primitives so the
  // zustand selector returns a stable value.
  const baseRows = usePipeline((s) => s.base?.nRows ?? null);
  const appliedTail = usePipeline((s) => {
    const applied = s.viewCount === null ? s.steps : s.steps.slice(0, s.viewCount);
    const last = applied[applied.length - 1];
    if (!last) return null;
    return `${last.rowsAfter}/${last.colsAfter}`;
  });
  const shape = useMemo(() => {
    if (baseRows === null) return null;
    const [rows, cols] = appliedTail ? appliedTail.split('/') : [String(baseRows), '0'];
    return {
      baseRows: baseRows.toLocaleString(),
      rows: Number(rows).toLocaleString(),
      cols: Number(cols),
    };
  }, [baseRows, appliedTail]);

  const [tab, setTab] = useState<'steps' | 'code'>('steps');
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const projectInput = useRef<HTMLInputElement | null>(null);

  const code = useMemo(
    () => pipelineToPandas(usePipeline.getState(), lang),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, dataset, lang, viewCount],
  );

  const isViewingHistory = viewCount !== null && viewCount < steps.length;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // The clipboard can be blocked (insecure context, denied permission);
      // say so rather than appearing to do nothing, since the code is
      // selectable by hand as a fallback.
      toast.show(t('common.copyFailed'), { tone: 'warn' });
    }
  };

  return (
    <aside
      aria-label={t('ops.aria')}
      className="flex w-[300px] shrink-0 flex-col border-l border-line bg-elevated"
    >
      <div className="flex h-14 items-center gap-2 border-b border-line px-3">
        <Icon name="history" size={15} className="text-accent" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-ink">{t('ops.pipeline')}</p>
          <p className="truncate text-[10.5px] text-ink-faint">
            {steps.length === 0 ? t('ops.pipelineEmpty') : t('ops.stepCount', { n: steps.length })}
          </p>
        </div>
        <IconButton icon="undo" label={t('ops.undo')} onClick={undo} disabled={steps.length === 0} />
        <IconButton icon="redo" label={t('ops.redo')} onClick={redo} disabled={redoStack.length === 0} />
      </div>

      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'steps', label: t('common.step'), icon: 'list' },
            { value: 'code', label: t('common.code'), icon: 'code' },
          ]}
        />
        <div className="ml-auto flex items-center gap-1">
          {tab === 'code' ? (
            <>
              <IconButton
                icon={copied ? 'check' : 'copy'}
                label={t('common.copyCode')}
                onClick={copyCode}
                disabled={steps.length === 0}
              />
              <IconButton
                icon="download"
                label={t('common.download')}
                onClick={() => downloadBlob(code, 'analysis.py', 'text/x-python')}
                disabled={steps.length === 0}
              />
            </>
          ) : (
            <>
              <IconButton
                icon="download"
                label={t('ops.exportProject')}
                onClick={() => {
                  const payload = {
                    version: 1,
                    dataset: usePipeline.getState().dataset,
                    ops: steps.map((s) => s.op),
                  };
                  downloadBlob(JSON.stringify(payload, null, 2), 'analysis.daproj.json', 'application/json');
                }}
                disabled={steps.length === 0}
              />
              <IconButton icon="upload" label={t('ops.importProject')} onClick={() => projectInput.current?.click()} />
              <input
                ref={projectInput}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  const result = await importProject(await file.text());
                  if (result.ok) {
                    toast.show(t('ops.projectImported', { name: result.datasetName ?? file.name }), {
                      tone: 'good',
                      detail: t('ops.importSteps', { n: result.applied ?? 0, total: result.total ?? 0 }),
                    });
                    if (result.total !== undefined && result.applied !== undefined && result.applied < result.total) {
                      toast.show(t('ops.importPartial', { n: result.applied, total: result.total }), { tone: 'warn' });
                    }
                  } else if (result.reason === 'needDataset') {
                    toast.show(t('ops.importNeedData', { name: result.datasetName ?? '' }), { tone: 'warn' });
                  } else {
                    toast.show(t('ops.projectInvalid'), { tone: 'bad' });
                  }
                }}
              />
              <IconButton
                icon="trash"
                label={t('ops.clearAll')}
                onClick={() => {
                  if (steps.length === 0) return;
                  if (window.confirm(t('ops.clearConfirm'))) clearPipeline();
                }}
                disabled={steps.length === 0}
              />
            </>
          )}
        </div>
      </div>

      {isViewingHistory && (
        <div className="flex items-center gap-2 border-b border-line bg-warn-soft px-3 py-2">
          <Icon name="history" size={13} className="shrink-0 text-warn" />
          <span className="min-w-0 flex-1 text-[11.5px] text-ink-soft">
            {t('ops.viewingHistory', { n: viewCount ?? 0 })}
          </span>
          <Button size="sm" variant="ghost" onClick={() => viewStep(null)}>
            {t('ops.backToCurrent')}
          </Button>
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
        {steps.length === 0 ? (
          <EmptyState icon="history" title={t('ops.pipelineEmpty')} hint={t('ops.pipelineEmptyHint')} compact />
        ) : tab === 'steps' ? (
          <ol className="space-y-2">
            <li className="relative">
              <span className="absolute left-[15px] top-6 bottom-0 w-px bg-line" aria-hidden />
              <button
                type="button"
                onClick={() => viewStep(0)}
                className={cx(
                  'flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors',
                  viewCount === 0 ? 'border-accent/50 bg-accent-soft/50' : 'border-line bg-surface hover:border-line-strong',
                )}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-3 text-ink-muted">
                  <Icon name="database" size={12} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{t('ops.original')}</span>
                <Badge tone="neutral" className="tnum">
                  {shape?.baseRows ?? '—'}
                </Badge>
              </button>
            </li>
            {steps.map((step, i) => (
              <StepCard
                key={step.id}
                step={step}
                index={i}
                active={viewCount === i + 1}
                isLast={i === steps.length - 1}
                onView={() => viewStep(i + 1)}
                onRevert={() => revertTo(i + 1)}
              />
            ))}
          </ol>
        ) : (
          <div className="relative">
            <pre className="scroll-thin overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed text-ink-soft">
              <code>{code}</code>
            </pre>
            <p className="mt-2 px-1 text-[10.5px] leading-snug text-ink-faint">{t('ops.codeMirrorHint')}</p>
          </div>
        )}
      </div>

      {steps.length > 0 && tab === 'steps' && (
        <div className="border-t border-line px-3 py-2">
          <button
            type="button"
            onClick={() => viewStep(null)}
            className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[11.5px] text-ink-muted hover:text-ink"
          >
            <Icon name="arrowRight" size={12} />
            {t('ops.current')}
            <span className="tnum ml-auto font-medium text-ink">
              {shape ? `${shape.rows} × ${shape.cols}` : '—'}
            </span>
          </button>
        </div>
      )}
    </aside>
  );
}
