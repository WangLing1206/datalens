import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n/index.tsx';
import { useUI, VIEW_ORDER } from '../../app/store.ts';
import { usePipeline } from '../../pipeline/store.ts';
import { SAMPLE_DATASETS, loadSample } from '../../app/datasets.ts';
import { clearProfileCache } from '../../app/hooks.ts';
import { Modal, cx, useToast } from '../ui/index.tsx';
import { Icon } from '../ui/Icon.tsx';
import { VIEW_ICON, VIEW_LABEL } from './Shell.tsx';

interface Command {
  id: string;
  group: string;
  label: string;
  icon: string;
  hint?: string;
  run: () => void;
}

/** ⌘K palette: jump to any view, load any sample, or run a global action. */
export function CommandPalette() {
  const { t, lang, toggleLang } = useI18n();
  const open = useUI((s) => s.commandOpen);
  const setOpen = useUI((s) => s.setCommandOpen);
  const setView = useUI((s) => s.setView);
  const toast = useToast();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = VIEW_ORDER.map((v) => ({
      id: `nav:${v}`,
      group: t('command.categoryNav'),
      label: t('command.switchTo', { name: t(VIEW_LABEL[v]) }),
      icon: VIEW_ICON[v],
      hint: t(VIEW_LABEL[v]),
      run: () => setView(v),
    }));

    const samples: Command[] = SAMPLE_DATASETS.map((s) => ({
      id: `sample:${s.id}`,
      group: t('command.categoryData'),
      label: t('command.loadSample', { name: t(s.nameKey) }),
      icon: s.icon,
      hint: `${s.rows.toLocaleString()} × ${s.cols}`,
      run: () => {
        void (async () => {
          const { df, meta } = await loadSample(s.id);
          clearProfileCache();
          usePipeline.getState().loadDataset(df, meta);
          toast.show(t('load.currentDataset'), { tone: 'good', detail: t(s.nameKey) });
        })();
      },
    }));

    const actions: Command[] = [
      {
        id: 'act:theme',
        group: t('command.categoryView'),
        label: t('command.toggleTheme'),
        icon: 'sun',
        run: () => useUI.getState().toggleTheme(),
      },
      {
        id: 'act:lang',
        group: t('command.categoryView'),
        label: t('command.toggleLanguage'),
        icon: 'globe',
        run: () => toggleLang(),
      },
      {
        id: 'act:undo',
        group: t('command.categoryAction'),
        label: t('command.undo'),
        icon: 'undo',
        run: () => usePipeline.getState().undo(),
      },
      {
        id: 'act:redo',
        group: t('command.categoryAction'),
        label: t('command.redo'),
        icon: 'redo',
        run: () => usePipeline.getState().redo(),
      },
      {
        id: 'act:reset',
        group: t('command.categoryAction'),
        label: t('command.resetData'),
        icon: 'refresh',
        run: () => {
          usePipeline.getState().resetData();
          toast.show(t('command.resetData'), { tone: 'info' });
        },
      },
      {
        id: 'act:report',
        group: t('command.categoryAction'),
        label: t('command.exportReport'),
        icon: 'report',
        run: () => setView('report'),
      },
    ];

    return [...nav, ...actions, ...samples];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, lang, setView, toggleLang, toast]);

  const filtered = useMemo(() => {
    if (!q.trim()) return commands;
    const needle = q.trim().toLowerCase();
    return commands.filter(
      (c) => c.label.toLowerCase().includes(needle) || c.group.toLowerCase().includes(needle) || (c.hint ?? '').toLowerCase().includes(needle),
    );
  }, [commands, q]);

  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of filtered) {
      const arr = map.get(c.group);
      if (arr) arr.push(c);
      else map.set(c.group, [c]);
    }
    return [...map.entries()];
  }, [filtered]);

  const flat = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);

  useEffect(() => setCursor(0), [q, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, flat.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = flat[cursor];
        if (cmd) {
          setOpen(false);
          setQ('');
          cmd.run();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, flat, cursor, setOpen]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  return (
    <Modal open={open} onClose={() => setOpen(false)} width={540} closeLabel={t('common.close')}>
      <div className="-m-4">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Icon name="search" size={15} className="shrink-0 text-ink-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('command.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <span className="shrink-0 rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-faint">
            esc
          </span>
        </div>
        <div ref={listRef} className="scroll-thin max-h-[380px] overflow-y-auto p-2">
          {flat.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-ink-faint">{t('command.noResults')}</p>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group} className="mb-2">
                <p className="px-2 py-1 text-[10px] font-semibold tracking-widest text-ink-faint uppercase">{group}</p>
                {items.map((c) => {
                  const idx = flat.indexOf(c);
                  return (
                    <button
                      key={c.id}
                      data-idx={idx}
                      type="button"
                      onMouseEnter={() => setCursor(idx)}
                      onClick={() => {
                        setOpen(false);
                        setQ('');
                        c.run();
                      }}
                      className={cx(
                        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                        idx === cursor ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-surface-2',
                      )}
                    >
                      <Icon name={c.icon} size={14} className="shrink-0 opacity-75" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">{c.label}</span>
                      {c.hint && <span className="shrink-0 text-[11px] text-ink-faint">{c.hint}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

/** `?` overlay listing the keyboard shortcuts. */
export function ShortcutsDialog() {
  const { t } = useI18n();
  const open = useUI((s) => s.shortcutsOpen);
  const setOpen = useUI((s) => s.setShortcutsOpen);
  const rows: { keys: string[]; label: string }[] = [
    { keys: ['⌘', 'K'], label: t('shortcuts.commandPalette') },
    { keys: ['Ctrl', 'K'], label: t('shortcuts.commandPalette') },
    { keys: ['P'], label: t('shortcuts.togglePipeline') },
    { keys: ['D'], label: t('shortcuts.toggleTheme') },
    { keys: ['L'], label: t('shortcuts.toggleLanguage') },
    { keys: ['⌘', 'Z'], label: t('shortcuts.undo') },
    { keys: ['⌘', '⇧', 'Z'], label: t('shortcuts.redo') },
    { keys: ['['], label: t('shortcuts.prevView') },
    { keys: [']'], label: t('shortcuts.nextView') },
    { keys: ['?'], label: t('shortcuts.title') },
  ];
  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t('shortcuts.title')} width={420} closeLabel={t('common.close')}>
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 hover:bg-surface-2">
            <span className="text-[12.5px] text-ink-soft">{r.label}</span>
            <span className="flex shrink-0 items-center gap-1">
              {r.keys.map((k, j) => (
                <kbd
                  key={j}
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1.5 font-mono text-[10.5px] text-ink-muted"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
