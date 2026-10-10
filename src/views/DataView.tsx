import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { useDeferred, useFrame, useProfile } from '../app/hooks.ts';
import { useUI } from '../app/store.ts';
import { usePipeline } from '../pipeline/store.ts';
import { ViewHeader, SectionTitle } from '../components/layout/ViewShell.tsx';
import {
  Badge,
  Button,
  Callout,
  CheckList,
  EmptyState,
  Field,
  IconButton,
  MenuDivider,
  MenuItem,
  Popover,
  Segmented,
  Select,
  TextInput,
  cx,
  useToast,
} from '../components/ui/index.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import type { FilterCondition, FilterGroup, FilterOperator } from '../core/ops.ts';
import { countFilter, duplicatedPositions } from '../core/ops.ts';
import { dtypeLabel } from '../core/dtype.ts';
import type { DataFrame } from '../core/DataFrame.ts';
import type { Scalar } from '../core/types.ts';

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: '==', label: '=' },
  { value: '!=', label: '≠' },
  { value: '>', label: '>' },
  { value: '>=', label: '≥' },
  { value: '<', label: '<' },
  { value: '<=', label: '≤' },
  { value: 'between', label: '∈ [a, b]' },
  { value: 'contains', label: '⊃ contains' },
  { value: 'not_contains', label: '⊅ not contains' },
  { value: 'starts_with', label: '^ starts' },
  { value: 'ends_with', label: '$ ends' },
  { value: 'in', label: '∈ in' },
  { value: 'not_in', label: '∉ not in' },
  { value: 'is_null', label: '= NaN' },
  { value: 'not_null', label: '≠ NaN' },
];

const NO_VALUE_OPS: FilterOperator[] = ['is_null', 'not_null'];

let condSeq = 0;
function newCondition(column: string): FilterCondition {
  condSeq += 1;
  return { id: `c${condSeq}`, column, op: '==', value: '' };
}

function newGroup(column: string): FilterGroup {
  condSeq += 1;
  return { id: `g${condSeq}`, logic: 'and', conditions: [newCondition(column)] };
}

/** Format a cell for display, using the active locale. */
function formatCell(v: Scalar, dtype: string, nf: (v: number | null | undefined, d?: number) => string, d: (v: number | Date | null | undefined, t?: boolean) => string): string {
  if (v === null || v === undefined) return 'NaN';
  if (dtype === 'datetime') return d(Number(v));
  if (typeof v === 'number') return nf(v);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return String(v);
}

/** Virtualised body: only the visible window of rows is mounted. */
function DataGrid({
  df,
  visible,
  rowHeight,
  height,
  columnWidths,
  onCellClick,
  search,
  highlightOutliers,
  header,
}: {
  df: DataFrame;
  visible: string[];
  rowHeight: number;
  height: number;
  columnWidths: Record<string, number>;
  onCellClick: (rowIndex: number, col: string, value: Scalar) => void;
  search: string;
  highlightOutliers: boolean;
  /** Header cells, rendered sticky inside the same scroller as the body. */
  header: ReactNode;
}) {
  const { n, d } = useI18n();
  const [scrollTop, setScrollTop] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  const total = df.nRows;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 8);
  const end = Math.min(total, Math.ceil((scrollTop + height) / rowHeight) + 8);
  const rows = [];
  for (let i = start; i < end; i++) rows.push(i);

  const outlierSets = useMemo(() => {
    if (!highlightOutliers) return null;
    const out: Record<string, Set<number>> = {};
    for (const c of df.columns) {
      if (c.dtype !== 'int' && c.dtype !== 'float') continue;
      const vals: number[] = [];
      for (const v of c.data) if (typeof v === 'number') vals.push(v);
      if (vals.length < 10) continue;
      const s = [...vals].sort((a, b) => a - b);
      const q1 = s[Math.floor(s.length * 0.25)];
      const q3 = s[Math.floor(s.length * 0.75)];
      const iqr = q3 - q1;
      const lo = q1 - 1.5 * iqr;
      const hi = q3 + 1.5 * iqr;
      const set = new Set<number>();
      for (let i = 0; i < c.data.length; i++) {
        const v = c.data[i];
        if (typeof v === 'number' && (v < lo || v > hi)) set.add(i);
      }
      out[c.name] = set;
    }
    return out;
  }, [df, highlightOutliers]);

  const needle = search.trim().toLowerCase();

  const totalWidth = 56 + visible.reduce((a, c) => a + (columnWidths[c] ?? 140), 0);

  return (
    <div
      ref={ref}
      className="scroll-thin min-h-0 flex-1 overflow-auto"
      style={{ height }}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      <div style={{ width: totalWidth, minWidth: '100%' }}>
        {/* Sticky inside the same scroller, so the header tracks both axes. */}
        <div className="sticky top-0 z-20 flex border-b border-line bg-surface-2">{header}</div>
        <div style={{ height: total * rowHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${start * rowHeight}px)` }}>
            {rows.map((i) => (
              <div
                key={i}
                className="group flex border-b border-line/50 hover:bg-surface-2"
                style={{ height: rowHeight }}
              >
              <div className="tnum flex shrink-0 items-center px-2 text-[11px] text-ink-faint" style={{ width: 56 }}>
                {df.index[i] + 1}
              </div>
              {visible.map((name) => {
                const col = df.require(name);
                const v = col.data[i];
                const text = formatCell(v, col.dtype, n, d);
                const isNull = v === null || v === undefined;
                const isOutlier = outlierSets?.[name]?.has(i) ?? false;
                const hit = needle !== '' && text.toLowerCase().includes(needle);
                return (
                  <div
                    key={name}
                    onClick={() => onCellClick(i, name, v)}
                    title={text}
                    className={cx(
                      'flex shrink-0 cursor-pointer items-center truncate border-r border-line/40 px-2 text-[11.5px]',
                      isNull && 'bg-null italic text-ink-faint',
                      !isNull && (typeof v === 'number' ? 'tnum justify-end text-ink-soft' : 'text-ink-soft'),
                      isOutlier && 'bg-warn-soft',
                      hit && 'ring-1 ring-inset ring-accent/40',
                    )}
                    style={{ width: columnWidths[name] ?? 140 }}
                  >
                    <span className="truncate">{text}</span>
                  </div>
                );
              })}
            </div>
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DataView() {
  const { t, n } = useI18n();
  const frame = useFrame();
  const profile = useProfile(frame.frame);
  const run = usePipeline((s) => s.run);
  const toast = useToast();
  const setView = useUI((s) => s.setView);

  const df = frame.frame;

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [hidden, setHidden] = useState<string[]>([]);
  const [sortSpecs, setSortSpecs] = useState<{ column: string; ascending: boolean }[]>([]);
  const [filters, setFilters] = useState<FilterGroup[]>([]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuColumn, setMenuColumn] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [cell, setCell] = useState<{ row: number; col: string; value: Scalar } | null>(null);
  const [highlightOutliers, setHighlightOutliers] = useState(false);
  const [dense, setDense] = useState(false);

  const deferredSearch = useDeferred(search, 200);

  // Adopt params handed over by an insight deep link.
  const params = useUI((s) => s.viewParams);
  useEffect(() => {
    if (params?.column && df?.has(String(params.column))) {
      setMenuColumn(String(params.column));
      useUI.getState().consumeViewParams();
    }
  }, [params, df]);

  useEffect(() => {
    setPage(0);
  }, [deferredSearch, pageSize, filters, df]);

  const visible = useMemo(() => (df ? df.columnNames.filter((c) => !hidden.includes(c)) : []), [df, hidden]);

  const columnWidths = useMemo(() => {
    const out: Record<string, number> = {};
    if (!df) return out;
    for (const name of visible) {
      const col = df.require(name);
      const headerLen = name.length * 8 + 40;
      let sampleLen = 0;
      const step = Math.max(1, Math.floor(df.nRows / 200));
      for (let i = 0; i < df.nRows; i += step) {
        const v = col.data[i];
        const len = v === null ? 4 : String(v).length * 7;
        if (len > sampleLen) sampleLen = len;
      }
      out[name] = Math.max(84, Math.min(260, Math.max(headerLen, sampleLen + 26)));
    }
    return out;
  }, [df, visible]);

  const filtered = useMemo(() => {
    if (!df) return null;
    let out = df;
    if (deferredSearch.trim()) {
      const needle = deferredSearch.trim().toLowerCase();
      const cols = out.columns;
      const keep: number[] = [];
      for (let i = 0; i < out.nRows; i++) {
        for (const c of cols) {
          const v = c.data[i];
          if (v !== null && String(v).toLowerCase().includes(needle)) {
            keep.push(i);
            break;
          }
        }
      }
      out = out.take(keep);
    }
    return out;
  }, [df, deferredSearch]);

  const sorted = useMemo(() => {
    if (!filtered || sortSpecs.length === 0) return filtered;
    const cols = sortSpecs.map((s) => ({ col: filtered.require(s.column), asc: s.ascending }));
    const pos = Array.from({ length: filtered.nRows }, (_, i) => i);
    pos.sort((a, b) => {
      for (const { col, asc } of cols) {
        const av = col.data[a];
        const bv = col.data[b];
        const aN = av === null;
        const bN = bv === null;
        if (aN || bN) {
          if (aN && bN) continue;
          return aN ? 1 : -1;
        }
        let cmp: number;
        if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
        else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        if (cmp !== 0) return asc ? cmp : -cmp;
      }
      return a - b;
    });
    return filtered.take(pos);
  }, [filtered, sortSpecs]);

  const dupSet = useMemo(() => {
    if (!df) return new Set<number>();
    return new Set(duplicatedPositions(df, undefined, 'first'));
  }, [df]);

  const pages = sorted ? Math.max(1, Math.ceil(sorted.nRows / pageSize)) : 1;
  const pageStart = Math.min(page, pages - 1) * pageSize;
  const pageRows = useMemo(
    () => (sorted ? sorted.take(Array.from({ length: Math.min(pageSize, sorted.nRows - pageStart) }, (_, i) => pageStart + i)) : null),
    [sorted, pageSize, pageStart],
  );

  const filterPreview = useMemo(() => {
    if (!df) return 0;
    return countFilter(df, filters);
  }, [df, filters]);

  const toggleSort = useCallback((column: string, additive: boolean) => {
    setSortSpecs((prev) => {
      const existing = prev.findIndex((s) => s.column === column);
      if (!additive) {
        if (existing === 0 && prev.length === 1) {
          return prev[0].ascending ? [{ column, ascending: false }] : [];
        }
        return [{ column, ascending: true }];
      }
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { column, ascending: !next[existing].ascending };
        return next;
      }
      return [...prev, { column, ascending: true }];
    });
  }, []);

  if (!df || !sorted || !pageRows || !profile) return null;

  const applied = filters.filter((g) => g.conditions.length > 0);
  const hasFilter = applied.length > 0;


  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader
        titleKey="data.title"
        subtitleKey="data.subtitle"
        meta={
          <>
            <Badge tone="neutral" className="tnum">
              {n(sorted.nRows, 0)} × {visible.length}
            </Badge>
            {hasFilter && (
              <Badge tone="accent" icon="filter">
                {t('data.filterPreview', { n: n(filterPreview, 0), total: n(df.nRows, 0) })}
              </Badge>
            )}
          </>
        }
        actions={
          <>
            <Segmented
              size="sm"
              value={dense ? 'dense' : 'comfy'}
              onChange={(v) => setDense(v === 'dense')}
              options={[
                { value: 'comfy', label: t('data.comfortable') },
                { value: 'dense', label: t('data.dense') },
              ]}
            />
            <Button
              size="sm"
              variant={highlightOutliers ? 'soft' : 'secondary'}
              icon="alert"
              onClick={() => setHighlightOutliers((v) => !v)}
            >
              {t('data.highlightOutliers')}
            </Button>
            <Button size="sm" variant={hasFilter ? 'soft' : 'secondary'} icon="filter" onClick={() => setFilterOpen((v) => !v)}>
              {t('common.filter')}
              {hasFilter && <span className="tnum ml-1">{applied.length}</span>}
            </Button>
            <Popover
              open={columnsOpen}
              onClose={() => setColumnsOpen(false)}
              align="end"
              width={240}
              trigger={
                <Button size="sm" variant="secondary" icon="columns" onClick={() => setColumnsOpen((v) => !v)}>
                  {t('data.columnsVisibility')}
                </Button>
              }
            >
              <div className="p-1">
                <CheckList
                  items={df.columnNames.map((c) => ({ value: c, label: c, hint: dtypeLabel(df.dtypeOf(c)) }))}
                  selected={visible}
                  onToggle={(v) => setHidden((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))}
                  onSelectAll={() => setHidden([])}
                  onClear={() => setHidden(df.columnNames)}
                  searchable
                  maxHeight={280}
                  labels={{ search: t('common.searchPlaceholder'), all: t('common.selectAll'), clear: t('common.clear') }}
                />
              </div>
            </Popover>
          </>
        }
      />

      {hasFilter && (
        <div className="border-b border-line bg-surface-2 px-5 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {applied.map((g) => (
              <span key={g.id} className="inline-flex items-center gap-1">
                {g.conditions.map((c, i) => (
                  <span key={c.id} className="inline-flex items-center gap-1">
                    {i > 0 && <span className="text-[10.5px] text-ink-faint">{g.logic === 'and' ? t('common.and') : t('common.or')}</span>}
                    <Badge tone="accent" mono>
                      {c.column} {OPERATORS.find((o) => o.value === c.op)?.label} {c.values ? c.values.join(',') : c.value ?? ''}
                    </Badge>
                  </span>
                ))}
              </span>
            ))}
            <Button size="sm" variant="ghost" icon="x" onClick={() => setFilters([])} className="ml-1">
              {t('data.filterClear')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {filterOpen && (
          <div className="scroll-thin w-[320px] shrink-0 overflow-y-auto border-r border-line bg-elevated p-4">
            <SectionTitle titleKey="data.filterBuilder" />
            <div className="space-y-3">
              {filters.map((g) => (
                <div key={g.id} className="rounded-lg border border-line bg-surface p-2.5">
                  <div className="mb-2 flex items-center gap-1.5">
                    <Segmented
                      size="sm"
                      value={g.logic}
                      onChange={(v) =>
                        setFilters((prev) => prev.map((x) => (x.id === g.id ? { ...x, logic: v as 'and' | 'or' } : x)))
                      }
                      options={[
                        { value: 'and', label: t('common.and') },
                        { value: 'or', label: t('common.or') },
                      ]}
                    />
                    <IconButton
                      icon="trash"
                      label={t('common.remove')}
                      className="ml-auto"
                      onClick={() => setFilters((prev) => prev.filter((x) => x.id !== g.id))}
                    />
                  </div>
                  <div className="space-y-2">
                    {g.conditions.map((c) => {
                      const col = df.col(c.column);
                      const isNumeric = col?.dtype === 'int' || col?.dtype === 'float';
                      const needsValues = c.op === 'in' || c.op === 'not_in';
                      const needsTwo = c.op === 'between';
                      const noValue = NO_VALUE_OPS.includes(c.op);
                      const uniqueVals = needsValues && col ? [...new Set(col.data.filter((v) => v !== null).map(String))].slice(0, 60) : [];
                      return (
                        <div key={c.id} className="space-y-1.5 rounded-md border border-line bg-surface-2 p-2">
                          <Select
                            value={c.column}
                            onChange={(e) =>
                              setFilters((prev) =>
                                prev.map((x) =>
                                  x.id === g.id
                                    ? { ...x, conditions: x.conditions.map((cc) => (cc.id === c.id ? { ...cc, column: e.target.value, value: '' } : cc)) }
                                    : x,
                                ),
                              )
                            }
                            options={df.columnNames.map((name) => ({ value: name, label: name }))}
                            className="!text-[11.5px]"
                          />
                          <div className="flex gap-1.5">
                            <Select
                              value={c.op}
                              onChange={(e) =>
                                setFilters((prev) =>
                                  prev.map((x) =>
                                    x.id === g.id
                                      ? { ...x, conditions: x.conditions.map((cc) => (cc.id === c.id ? { ...cc, op: e.target.value as FilterOperator } : cc)) }
                                      : x,
                                  ),
                                )
                              }
                              options={OPERATORS.map((o) => ({ value: o.value, label: o.label }))}
                              className="!text-[11.5px]"
                            />
                            {needsValues ? (
                              <TextInput
                                value={(c.values ?? []).join(', ')}
                                placeholder={t('data.conditionValues')}
                                onChange={(e) =>
                                  setFilters((prev) =>
                                    prev.map((x) =>
                                      x.id === g.id
                                        ? {
                                            ...x,
                                            conditions: x.conditions.map((cc) =>
                                              cc.id === c.id
                                                ? { ...cc, values: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }
                                                : cc,
                                            ),
                                          }
                                        : x,
                                    ),
                                  )
                                }
                                className="!text-[11.5px]"
                              />
                            ) : noValue ? null : (
                              <>
                                <TextInput
                                  type={isNumeric ? 'number' : 'text'}
                                  value={c.value === undefined || c.value === null ? '' : String(c.value)}
                                  placeholder={t('data.conditionValue')}
                                  onChange={(e) =>
                                    setFilters((prev) =>
                                      prev.map((x) =>
                                        x.id === g.id
                                          ? {
                                              ...x,
                                              conditions: x.conditions.map((cc) =>
                                                cc.id === c.id
                                                  ? { ...cc, value: isNumeric && e.target.value !== '' ? Number(e.target.value) : e.target.value }
                                                  : cc,
                                              ),
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                  className="!text-[11.5px]"
                                />
                                {needsTwo && (
                                  <TextInput
                                    type={isNumeric ? 'number' : 'text'}
                                    value={c.value2 === undefined || c.value2 === null ? '' : String(c.value2)}
                                    placeholder={t('data.conditionValue2')}
                                    onChange={(e) =>
                                      setFilters((prev) =>
                                        prev.map((x) =>
                                          x.id === g.id
                                            ? {
                                                ...x,
                                                conditions: x.conditions.map((cc) =>
                                                  cc.id === c.id
                                                    ? { ...cc, value2: isNumeric && e.target.value !== '' ? Number(e.target.value) : e.target.value }
                                                    : cc,
                                                ),
                                              }
                                            : x,
                                        ),
                                      )
                                    }
                                    className="!text-[11.5px]"
                                  />
                                )}
                              </>
                            )}
                            <IconButton
                              icon="minus"
                              label={t('common.remove')}
                              onClick={() =>
                                setFilters((prev) =>
                                  prev.map((x) =>
                                    x.id === g.id ? { ...x, conditions: x.conditions.filter((cc) => cc.id !== c.id) } : x,
                                  ),
                                )
                              }
                            />
                          </div>
                          {needsValues && uniqueVals.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {uniqueVals.slice(0, 10).map((v) => (
                                <button
                                  key={v}
                                  type="button"
                                  onClick={() =>
                                    setFilters((prev) =>
                                      prev.map((x) =>
                                        x.id === g.id
                                          ? {
                                              ...x,
                                              conditions: x.conditions.map((cc) => {
                                                if (cc.id !== c.id) return cc;
                                                const cur = cc.values ?? [];
                                                return { ...cc, values: cur.includes(v) ? cur.filter((y) => y !== v) : [...cur, v] };
                                              }),
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                  className={cx(
                                    'rounded px-1.5 py-0.5 text-[10.5px] transition-colors',
                                    (c.values ?? []).includes(v) ? 'bg-accent text-white' : 'bg-surface-3 text-ink-muted hover:text-ink',
                                  )}
                                >
                                  {v}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="plus"
                    className="mt-2"
                    onClick={() =>
                      setFilters((prev) =>
                        prev.map((x) => (x.id === g.id ? { ...x, conditions: [...x.conditions, newCondition(df.columnNames[0])] } : x)),
                      )
                    }
                  >
                    {t('data.addCondition')}
                  </Button>
                </div>
              ))}

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon="plus"
                  onClick={() => setFilters((prev) => [...prev, newGroup(df.columnNames[0])])}
                >
                  {t('data.addGroup')}
                </Button>
              </div>

              {filters.length > 0 && (
                <>
                  <Callout tone="info" icon="info">
                    {t('data.filterPreview', { n: n(filterPreview, 0), total: n(df.nRows, 0) })}
                  </Callout>
                  <Button
                    variant="primary"
                    block
                    icon="filter"
                    onClick={() => {
                      run({ kind: 'filter', groups: applied });
                      setFilters([]);
                      setFilterOpen(false);
                      toast.show(t('op.filterOp'), { tone: 'good' });
                    }}
                    disabled={!hasFilter}
                  >
                    {t('data.filterApply')}
                  </Button>
                  <Button variant="ghost" block onClick={() => setFilters([])}>
                    {t('data.filterClear')}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
            <div className="relative min-w-[180px] flex-1 max-w-[360px]">
              <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('data.searchAll')}
                className="h-7.5 w-full rounded-md border border-line bg-surface pl-8 pr-2 text-[12.5px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
            </div>
            {sortSpecs.length > 0 && (
              <div className="flex items-center gap-1">
                {sortSpecs.map((s, i) => (
                  <Badge key={s.column} tone="accent" icon={s.ascending ? 'sortAsc' : 'sortDesc'}>
                    {s.column}
                    {sortSpecs.length > 1 && <span className="tnum ml-1 opacity-70">{i + 1}</span>}
                  </Badge>
                ))}
                <IconButton icon="x" label={t('data.clearSort')} onClick={() => setSortSpecs([])} />
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-[11px] text-ink-faint sm:inline">{t('data.virtualizationNote')}</span>
              <Select
                value={String(pageSize)}
                onChange={(e) => setPageSize(Number(e.target.value))}
                options={[25, 50, 100, 200].map((v) => ({ value: String(v), label: t('data.pageSize', { n: v }) }))}
                className="!h-7 !w-auto !text-[11.5px]"
              />
            </div>
          </div>

          {/* Table */}
          {pageRows.nRows === 0 ? (
            <EmptyState icon="filter" title={t('common.emptyResult')} hint={t('common.emptyResultHint')} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <DataGrid
                df={pageRows}
                visible={visible}
                rowHeight={dense ? 26 : 32}
                height={Math.max(240, (typeof window !== 'undefined' ? window.innerHeight : 800) - 320)}
                columnWidths={columnWidths}
                onCellClick={(rowIndex, col, value) => setCell({ row: pageRows.index[rowIndex] + 1, col, value })}
                search={deferredSearch}
                highlightOutliers={highlightOutliers}
                header={
                  <>
                <div className="flex shrink-0 items-center px-2 text-[10.5px] font-medium text-ink-faint" style={{ width: 56 }}>
                  {t('data.index')}
                </div>
                {visible.map((name) => {
                  const spec = sortSpecs.find((s) => s.column === name);
                  return (
                    <div
                      key={name}
                      className="flex shrink-0 items-center gap-1 border-r border-line/40 px-2 py-2"
                      style={{ width: columnWidths[name] ?? 140 }}
                    >
                      <button
                        type="button"
                        onClick={(e) => toggleSort(name, e.shiftKey)}
                        title={spec ? (spec.ascending ? t('a11y.sortAscending') : t('a11y.sortDescending')) : t('a11y.notSorted')}
                        className="min-w-0 flex-1 truncate text-left text-[11.5px] font-semibold text-ink hover:text-accent-ink"
                      >
                        {name}
                      </button>
                      {spec && <Icon name={spec.ascending ? 'sortAsc' : 'sortDesc'} size={11} className="shrink-0 text-accent" />}
                      <Popover
                        open={menuColumn === name}
                        onClose={() => setMenuColumn(null)}
                        align="end"
                        width={230}
                        trigger={
                          <button
                            type="button"
                            aria-label={t('data.columnMenu')}
                            onClick={() => setMenuColumn(menuColumn === name ? null : name)}
                            className={cx(
                              'shrink-0 rounded p-0.5 transition-colors',
                              menuColumn === name ? 'bg-accent-soft text-accent-ink' : 'text-ink-faint hover:bg-surface-3 hover:text-ink',
                            )}
                          >
                            <Icon name="chevronDown" size={11} />
                          </button>
                        }
                      >
                        <div className="p-1">
                          <MenuItem icon="sortAsc" onClick={() => { toggleSort(name, false); setMenuColumn(null); }}>
                            {t('data.sortAsc')}
                          </MenuItem>
                          <MenuItem icon="sortDesc" onClick={() => { setSortSpecs([{ column: name, ascending: false }]); setMenuColumn(null); }}>
                            {t('data.sortDesc')}
                          </MenuItem>
                          <MenuDivider />
                          <MenuItem
                            icon="rename"
                            onClick={() => {
                              setRenameTarget(name);
                              setRenameValue(name);
                              setMenuColumn(null);
                            }}
                          >
                            {t('data.renameColumn')}
                          </MenuItem>
                          <MenuItem icon="sigma" onClick={() => { setView('describe', { column: name }); setMenuColumn(null); }}>
                            {t('data.columnStats')}
                          </MenuItem>
                          <MenuItem icon="filter" onClick={() => { setFilters([newGroup(name)]); setFilterOpen(true); setMenuColumn(null); }}>
                            {t('data.filterColumn')}
                          </MenuItem>
                          <MenuItem icon="eyeOff" onClick={() => { setHidden((p) => [...p, name]); setMenuColumn(null); }}>
                            {t('data.hideColumn')}
                          </MenuItem>
                          <MenuDivider />
                          <MenuItem
                            icon="trash"
                            danger
                            onClick={() => {
                              if (window.confirm(t('data.dropColumnConfirm', { name }))) {
                                run({ kind: 'dropColumns', columns: [name] });
                                setSortSpecs((p) => p.filter((s) => s.column !== name));
                              }
                              setMenuColumn(null);
                            }}
                          >
                            {t('data.dropColumn')}
                          </MenuItem>
                        </div>
                      </Popover>
                    </div>
                  );
                })}
                  </>
                }
              />
            </div>
          )}

          {/* Pagination */}
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2">
            <span className="text-[11.5px] text-ink-muted">
              {t('data.rowsShown', {
                from: pageRows.nRows === 0 ? 0 : pageStart + 1,
                to: pageStart + pageRows.nRows,
                total: n(sorted.nRows, 0),
              })}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <IconButton icon="chevronLeft" label={t('data.first')} onClick={() => setPage(0)} disabled={page === 0} />
              <IconButton
                icon="chevronLeft"
                label={t('data.prevPage')}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              />
              <span className="tnum px-2 text-[11.5px] text-ink-muted">
                {t('data.pageOf', { page: Math.min(page + 1, pages), pages })}
              </span>
              <IconButton
                icon="chevronRight"
                label={t('data.nextPage')}
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                disabled={page >= pages - 1}
              />
              <IconButton icon="chevronRight" label={t('data.last')} onClick={() => setPage(pages - 1)} disabled={page >= pages - 1} />
            </div>
          </div>
        </div>
      </div>

      {/* Rename dialog */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRenameTarget(null)} />
          <div className="pop-in relative w-full max-w-[360px] rounded-xl border border-line bg-elevated p-4 shadow-pop">
            <h3 className="text-[13.5px] font-semibold text-ink">{t('data.renameTitle')}</h3>
            <Field label={t('data.newName')} className="mt-3">
              <TextInput value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
            </Field>
            {renameValue !== renameTarget && df.has(renameValue) && (
              <p className="mt-1 text-[11.5px] text-bad">{t('data.nameExists')}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRenameTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon="check"
                disabled={!renameValue.trim() || (renameValue !== renameTarget && df.has(renameValue))}
                onClick={() => {
                  run({ kind: 'rename', mapping: { [renameTarget]: renameValue.trim() } });
                  setRenameTarget(null);
                }}
              >
                {t('common.apply')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Cell inspector */}
      {cell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCell(null)} />
          <div className="pop-in relative w-full max-w-[380px] rounded-xl border border-line bg-elevated p-4 shadow-pop">
            <h3 className="text-[13.5px] font-semibold text-ink">{t('data.cellDetail')}</h3>
            <dl className="mt-3 space-y-2 text-[12px]">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">{t('data.cellPosition')}</dt>
                <dd className="tnum text-ink">
                  {cell.col} · {t('common.row')} {cell.row}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">{t('data.cellType')}</dt>
                <dd className="text-ink">{dtypeLabel(df.dtypeOf(cell.col))}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">{t('data.cellValue')}</dt>
                <dd className="mt-1 rounded-md border border-line bg-surface-2 p-2 font-mono text-[12px] break-all text-ink">
                  {cell.value === null ? <span className="text-ink-faint italic">NaN</span> : String(cell.value)}
                </dd>
              </div>
              {dupSet.has(cell.row - 1) && (
                <Callout tone="warn" icon="copy">
                  {t('clean.dupTitle')}
                </Callout>
              )}
            </dl>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                icon="copy"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(String(cell.value ?? ''));
                    toast.show(t('common.copied'), { tone: 'good' });
                  } catch {
                    // Clipboard access can be denied (insecure context, permissions).
                    toast.show(t('common.copyFailed'), { tone: 'warn' });
                  }
                }}
              >
                {t('data.copyCell')}
              </Button>
              <Button size="sm" variant="primary" onClick={() => setCell(null)}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
