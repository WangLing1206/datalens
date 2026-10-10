import { useCallback, useRef, useState } from 'react';
import { useI18n } from '../../i18n/index.tsx';
import { useUI } from '../../app/store.ts';
import { usePipeline } from '../../pipeline/store.ts';
import { ACCEPTED_EXTENSIONS, humanFileSize, loadFromFile, loadFromText, loadSample, SAMPLE_DATASETS } from '../../app/datasets.ts';
import { importProject, isProjectFilename } from '../../app/project.ts';
import { clearProfileCache } from '../../app/hooks.ts';
import { Badge, Button, Callout, Modal, TextArea, cx, useToast } from '../ui/index.tsx';
import { Icon } from '../ui/Icon.tsx';

/** Sample-dataset cards, paste box and file drop target — the single entry
 *  point for getting data into the tool. */
export function LoadPanel() {
  const { t } = useI18n();
  const open = useUI((s) => s.loadPanelOpen);
  const setOpen = useUI((s) => s.setLoadPanelOpen);
  const loadDataset = usePipeline((s) => s.loadDataset);
  const currentId = usePipeline((s) => s.dataset?.id);
  const toast = useToast();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileInput = useRef<HTMLInputElement | null>(null);

  const apply = useCallback(
    (df: Parameters<typeof loadDataset>[0], meta: Parameters<typeof loadDataset>[1]) => {
      clearProfileCache();
      loadDataset(df, meta);
      setOpen(false);
      setError(null);
      toast.show(t('load.currentDataset'), {
        tone: 'good',
        detail: t('load.datasetMeta', { rows: df.nRows.toLocaleString(), cols: df.nCols }),
      });
    },
    [loadDataset, setOpen, t, toast],
  );

  const handleSample = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const { df, meta } = await loadSample(id);
      apply(df, meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  /** Restore an exported analysis, reporting why when it cannot be applied. */
  const restoreProjectFile = async (file: File) => {
    const result = await importProject(await file.text());
    if (!result.ok) {
      setError(result.reason === 'needDataset' ? t('ops.importNeedData', { name: result.datasetName ?? '' }) : t('ops.projectInvalid'));
      return;
    }
    setOpen(false);
    toast.show(t('ops.projectImported', { name: result.datasetName ?? file.name }), {
      tone: 'good',
      detail: t('ops.importSteps', { n: result.applied ?? 0, total: result.total ?? 0 }),
    });
    if (result.total !== undefined && result.applied !== undefined && result.applied < result.total) {
      toast.show(t('ops.importPartial', { n: result.applied, total: result.total }), { tone: 'warn' });
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (!file) return;
    setBusy(file.name);
    setError(null);
    try {
      if (file.size === 0) throw new Error(t('load.emptyFile'));
      if (file.size > 25 * 1024 * 1024) toast.show(t('load.tooLarge', { size: humanFileSize(file.size) }), { tone: 'warn' });
      // A project file is a recorded analysis, not a dataset: restore the
      // pipeline instead of trying to parse it as a table.
      if (isProjectFilename(file.name)) {
        await restoreProjectFile(file);
        return;
      }
      const { df, meta } = await loadFromFile(file);
      apply(df, meta);
    } catch (e) {
      setError(t('load.loadFailed', { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  };

  const handlePaste = async () => {
    setBusy('paste');
    setError(null);
    try {
      const { df, meta } = await loadFromText(pasteText);
      apply(df, meta);
      setPasteText('');
      setPasteOpen(false);
    } catch (e) {
      setError(t('load.loadFailed', { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={t('load.title')}
      width={640}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={() => setPasteOpen((v) => !v)} icon="file">
            {t('load.paste')}
          </Button>
          <Button variant="primary" icon="upload" onClick={() => fileInput.current?.click()}>
            {t('load.browse')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInput.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click();
          }}
          className={cx(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-8 text-center transition-colors',
            dragging ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-2 hover:border-accent hover:bg-accent-soft/40',
          )}
        >
          <span className={cx('grid size-11 place-items-center rounded-xl transition-colors', dragging ? 'bg-accent text-white' : 'bg-surface text-accent')}>
            <Icon name="upload" size={20} />
          </span>
          <p className="text-[13.5px] font-medium text-ink">
            {busy && busy !== 'paste' ? t('load.loading') : t('load.dropTitle')}
          </p>
          <p className="max-w-[400px] text-[11.5px] leading-relaxed text-ink-muted">{t('load.dropHint')}</p>
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-faint">
            <Icon name="lock" size={11} />
            {t('app.dataStaysLocal')}
          </p>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {pasteOpen && (
          <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
            <p className="text-[12.5px] font-medium text-ink">{t('load.pasteTitle')}</p>
            <TextArea
              rows={6}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={t('load.pastePlaceholder')}
              className="font-mono !text-[11.5px]"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPasteText('')}>
                {t('common.clear')}
              </Button>
              <Button size="sm" variant="primary" icon="check" onClick={handlePaste} disabled={!pasteText.trim()} loading={busy === 'paste'}>
                {t('load.pasteSubmit')}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <Callout tone="bad" title={t('common.error')}>
            {error}
          </Callout>
        )}

        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-[12.5px] font-semibold text-ink">{t('load.sampleData')}</h3>
            <span className="text-[11px] text-ink-faint">{t('load.sampleHint')}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SAMPLE_DATASETS.map((s) => {
              const active = currentId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleSample(s.id)}
                  disabled={busy !== null}
                  className={cx(
                    'group relative flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-all duration-150',
                    active ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
                    busy !== null && busy !== s.id && 'opacity-50',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="grid size-7 shrink-0 place-items-center rounded-md text-white"
                      style={{ background: `var(--viz-${s.tone + 1})` }}
                    >
                      {busy === s.id ? (
                        <span className="spin inline-block size-3.5 rounded-full border-2 border-white/40 border-t-white" />
                      ) : (
                        <Icon name={s.icon} size={14} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{t(s.nameKey)}</span>
                    {active && <Icon name="check" size={13} className="shrink-0 text-accent" />}
                  </div>
                  <p className="clamp-3 text-[11px] leading-snug text-ink-muted">{t(s.descKey)}</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Badge tone="neutral" className="tnum">
                      {s.rows.toLocaleString()} × {s.cols}
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Small inline drop target used when no dataset is loaded yet. */
export function InlineDropZone() {
  const { t } = useI18n();
  const setOpen = useUI((s) => s.setLoadPanelOpen);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        setOpen(true);
      }}
      className={cx(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-16',
        dragging ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-2',
      )}
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-surface text-accent">
        <Icon name="upload" size={22} />
      </span>
      <p className="text-[14px] font-medium text-ink">{t('load.dropTitle')}</p>
      <p className="text-[12px] text-ink-muted">{t('load.dropHint')}</p>
      <Button variant="primary" icon="database" onClick={() => setOpen(true)}>
        {t('load.sampleData')}
      </Button>
    </div>
  );
}
