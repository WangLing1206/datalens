import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { useFrame, useProfile } from '../app/hooks.ts';
import { usePipeline } from '../pipeline/store.ts';
import { useUI } from '../app/store.ts';
import { ViewHeader, SplitView, ControlGroup } from '../components/layout/ViewShell.tsx';
import {
  Badge,
  Button,
  Callout,
  Card,
  CheckList,
  EmptyState,
  Field,
  NumberInput,
  Segmented,
  Select,
  StatTile,
  TextInput,
  cx,
  useToast,
} from '../components/ui/index.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { EChart, useChartTheme } from '../components/charts/EChart.tsx';
import { boxOption, barOption } from '../components/charts/builders.ts';
import { findOutliers, numericValues } from '../core/stats.ts';
import { duplicateGroups, duplicatedPositions, whichRowsDropped } from '../core/ops.ts';
import { dtypeLabel } from '../core/dtype.ts';
import type { DType, Scalar } from '../core/types.ts';
import type { FillStrategy } from '../core/ops.ts';

type Section = 'missing' | 'duplicates' | 'outliers' | 'types';

const SUGGEST: Record<string, DType> = {
  'date-like': 'datetime',
  'likely-datetime': 'datetime',
  'likely-categorical': 'category',
};

/** Missingness map: one column per field, a bright mark where the row is null. */
function MissingMap({ columns, limitRows = 400 }: { columns: { name: string; data: Scalar[] }[]; limitRows?: number }) {
  const { t } = useI18n();
  const shown = columns.slice(0, 60);
  const step = Math.max(1, Math.ceil(columns[0]?.data.length / limitRows));
  const rows: number[] = [];
  for (let i = 0; i < (columns[0]?.data.length ?? 0); i += step) rows.push(i);

  return (
    <div>
      <div className="scroll-thin overflow-x-auto">
        <div className="inline-flex min-w-full gap-px">
          {shown.map((c) => (
            <div key={c.name} className="flex flex-col items-center gap-1" title={c.name}>
              <div className="flex flex-col gap-px">
                {rows.map((i) => (
                  <span
                    key={i}
                    className={cx('h-[3px] w-[9px] rounded-[1px]', c.data[i] === null ? 'bg-bad/80' : 'bg-surface-3')}
                  />
                ))}
              </div>
              <span className="max-h-16 origin-top-left rotate-[-52deg] truncate text-[9.5px] whitespace-nowrap text-ink-faint" style={{ width: 12 }}>
                {c.name}
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[10.5px] text-ink-faint">{t('clean.nullHeatmapNote')}</p>
    </div>
  );
}

export function CleanView() {
  const { t, n, pct } = useI18n();
  const frame = useFrame();
  const profile = useProfile(frame.frame);
  const run = usePipeline((s) => s.run);
  const toast = useToast();
  const theme = useChartTheme();

  const df = frame.frame;

  const [section, setSection] = useState<Section>('missing');
  const [focusColumn, setFocusColumn] = useState<string | null>(null);

  // --- missing
  const [dropHow, setDropHow] = useState<'any' | 'all' | 'thresh'>('any');
  const [dropThresh, setDropThresh] = useState(2);
  const [dropSubset, setDropSubset] = useState<string[]>([]);
  const [fillStrategy, setFillStrategy] = useState<FillStrategy>('median');
  const [fillColumns, setFillColumns] = useState<string[]>([]);
  const [fillConstant, setFillConstant] = useState('0');

  // --- duplicates
  const [dupSubset, setDupSubset] = useState<string[]>([]);
  const [dupKeep, setDupKeep] = useState<'first' | 'last' | 'none'>('first');

  // --- outliers
  const [outColumn, setOutColumn] = useState('');
  const [outMethod, setOutMethod] = useState<'iqr' | 'zscore'>('iqr');
  const [outThreshold, setOutThreshold] = useState(3);
  const [outAction, setOutAction] = useState<'drop' | 'clip' | 'median'>('clip');

  // --- types
  const [castMap, setCastMap] = useState<Record<string, DType>>({});

  const params = useUI((s) => s.viewParams);
  useEffect(() => {
    if (!params) return;
    if (params.column && df?.has(String(params.column))) setFocusColumn(String(params.column));
    if (params.focus === 'duplicates') setSection('duplicates');
    if (params.focus === 'outliers') {
      setSection('outliers');
      if (params.column) setOutColumn(String(params.column));
    }
    if (params.suggestCast && params.column) setCastMap({ [String(params.column)]: params.suggestCast as DType });
    useUI.getState().consumeViewParams();
  }, [params, df]);

  const numericCols = useMemo(() => df?.numericColumnNames() ?? [], [df]);
  const missingCols = useMemo(() => profile?.columns.filter((c) => c.missing > 0) ?? [], [profile]);

  useEffect(() => {
    if (!outColumn && numericCols.length) setOutColumn(numericCols[0]);
  }, [numericCols, outColumn]);

  const dupPositions = useMemo(() => (df ? duplicatedPositions(df, dupSubset.length ? dupSubset : undefined, dupKeep === 'none' ? false : dupKeep) : []), [df, dupSubset, dupKeep]);
  const dupGroupsList = useMemo(() => (df ? duplicateGroups(df, dupSubset.length ? dupSubset : undefined, 8) : []), [df, dupSubset]);

  const outliers = useMemo(() => {
    if (!df || !outColumn || !df.has(outColumn)) return null;
    return findOutliers(df.require(outColumn).data, outMethod, outThreshold);
  }, [df, outColumn, outMethod, outThreshold]);

  const dropPreview = useMemo(() => {
    if (!df) return 0;
    if (dropHow === 'thresh') return whichRowsDropped(df, { how: 'all', thresh: dropThresh, ...(dropSubset.length ? { subset: dropSubset } : {}) }).length;
    return whichRowsDropped(df, { how: dropHow, ...(dropSubset.length ? { subset: dropSubset } : {}) }).length;
  }, [df, dropHow, dropThresh, dropSubset]);

  const fillPreview = useMemo(() => {
    if (!df || !profile) return 0;
    const cols = fillColumns.length ? fillColumns : profile.columns.filter((c) => c.missing > 0).map((c) => c.name);
    return cols.reduce((a, name) => a + (profile.columns.find((c) => c.name === name)?.missing ?? 0), 0);
  }, [df, profile, fillColumns]);

  const outlierBox = useMemo(() => {
    if (!df || !outColumn || !df.has(outColumn)) return null;
    const vals = numericValues(df.require(outColumn).data);
    if (vals.length < 4) return null;
    return [{ name: outColumn, values: vals }];
  }, [df, outColumn]);

  const outlierScatter = useMemo(() => {
    if (!df || !outliers || !outColumn || outliers.positions.length === 0) return null;
    const set = new Set(outliers.positions);
    const normal: [number, number][] = [];
    const bad: [number, number][] = [];
    const step = Math.max(1, Math.ceil(df.nRows / 4000));
    for (let i = 0; i < df.nRows; i += step) {
      const v = df.require(outColumn).data[i];
      if (v === null) continue;
      const pt: [number, number] = [i, Number(v)];
      if (set.has(i)) bad.push(pt);
      else normal.push(pt);
    }
    return { normal, bad };
  }, [df, outliers, outColumn]);

  if (!df || !profile) return null;

  const castTargets = profile.columns.map((c) => c.name);
  const suggested = profile.columns.filter((c) => c.hints.some((h) => SUGGEST[h]));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader
        titleKey="clean.title"
        subtitleKey="clean.subtitle"
        meta={
          <>
            <Badge tone={profile.missingCells > 0 ? 'warn' : 'good'} className="tnum">
              {t('clean.missingCells')} {n(profile.missingCells, 0)}
            </Badge>
            {profile.duplicateRows > 0 && (
              <Badge tone="warn" className="tnum">
                {t('clean.dupCount')} {n(profile.duplicateRows, 0)}
              </Badge>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 px-5 py-4 md:grid-cols-4">
        <StatTile
          label={t('clean.completeRows')}
          value={n(df.nRows - whichRowsDropped(df, { how: 'any' }).length, 0)}
          icon="check"
          tone="good"
        />
        <StatTile
          label={t('clean.incompleteRows')}
          value={n(whichRowsDropped(df, { how: 'any' }).length, 0)}
          icon="alert"
          tone={profile.missingCells > 0 ? 'warn' : 'good'}
        />
        <StatTile label={t('clean.missingCells')} value={n(profile.missingCells, 0)} hint={t('clean.missingCellsOf', { total: n(profile.cells, 0) })} icon="minus" />
        <StatTile label={t('clean.dupCount')} value={n(profile.duplicateRows, 0)} icon="copy" tone={profile.duplicateRows > 0 ? 'warn' : 'good'} />
      </div>

      <div className="px-5">
        <Segmented
          value={section}
          onChange={setSection}
          options={[
            { value: 'missing', label: t('clean.missingOverview'), icon: 'alert' },
            { value: 'duplicates', label: t('clean.dupTitle'), icon: 'copy' },
            { value: 'outliers', label: t('clean.outlierTitle'), icon: 'target' },
            { value: 'types', label: t('clean.castTitle'), icon: 'refresh' },
          ]}
        />
      </div>

      <SplitView
        width={320}
        controls={
          <>
            {section === 'missing' && (
              <>
                <ControlGroup titleKey="clean.dropTitle" hintKey="clean.dropHow">
                  <div className="space-y-3">
                    <Select
                      value={dropHow}
                      onChange={(e) => setDropHow(e.target.value as typeof dropHow)}
                      options={[
                        { value: 'any', label: t('clean.dropHowAny') },
                        { value: 'all', label: t('clean.dropHowAll') },
                        { value: 'thresh', label: t('clean.dropHowThresh') },
                      ]}
                    />
                    {dropHow === 'thresh' && (
                      <Field label={t('clean.dropThresh')} inline>
                        <NumberInput value={dropThresh} onChange={setDropThresh} min={1} max={df.nCols} className="!w-20" />
                      </Field>
                    )}
                    <Field label={t('clean.dropSubset')} hint={t('clean.dropSubsetHint')}>
                      <CheckList
                        items={df.columnNames.map((c) => ({ value: c, label: c, hint: `${profile.columns.find((p) => p.name === c)?.missing ?? 0}` }))}
                        selected={dropSubset}
                        onToggle={(v) => setDropSubset((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))}
                        onSelectAll={() => setDropSubset(missingCols.map((c) => c.name))}
                        onClear={() => setDropSubset([])}
                        searchable
                        maxHeight={150}
                        labels={{ search: t('common.searchPlaceholder'), all: t('common.selectAll'), clear: t('common.clear') }}
                      />
                    </Field>
                    <Callout tone={dropPreview > 0 ? 'warn' : 'good'} icon={dropPreview > 0 ? 'alert' : 'check'}>
                      {t('clean.dropPreview', { n: n(dropPreview, 0), kept: n(df.nRows - dropPreview, 0) })}
                    </Callout>
                    <Button
                      variant="primary"
                      block
                      icon="broom"
                      disabled={dropPreview === 0}
                      onClick={() => {
                        run({
                          kind: 'dropna',
                          how: dropHow === 'thresh' ? 'all' : dropHow,
                          ...(dropHow === 'thresh' ? { thresh: dropThresh } : {}),
                          ...(dropSubset.length ? { subset: dropSubset } : {}),
                        });
                        toast.show(t('op.dropna'), { tone: 'good', detail: t('clean.dropPreview', { n: n(dropPreview, 0), kept: n(df.nRows - dropPreview, 0) }) });
                      }}
                    >
                      {t('op.dropna')}
                    </Button>
                  </div>
                </ControlGroup>

                <ControlGroup titleKey="clean.fillTitle">
                  <div className="space-y-3">
                    <Select
                      value={fillStrategy}
                      onChange={(e) => setFillStrategy(e.target.value as FillStrategy)}
                      options={[
                        { value: 'median', label: t('clean.fillMedian') },
                        { value: 'mean', label: t('clean.fillMean') },
                        { value: 'mode', label: t('clean.fillMode') },
                        { value: 'constant', label: t('clean.fillConstant') },
                        { value: 'ffill', label: t('clean.fillFfill') },
                        { value: 'bfill', label: t('clean.fillBfill') },
                        { value: 'zero', label: t('clean.fillZero') },
                        { value: 'interpolate', label: t('clean.fillInterpolate') },
                      ]}
                    />
                    {fillStrategy === 'constant' && (
                      <Field label={t('clean.fillValue')}>
                        <TextInput value={fillConstant} onChange={(e) => setFillConstant(e.target.value)} />
                      </Field>
                    )}
                    {(fillStrategy === 'mean' || fillStrategy === 'median' || fillStrategy === 'interpolate') && (
                      <p className="text-[11px] text-ink-faint">{t('clean.fillNotNumeric')}</p>
                    )}
                    <Field label={t('clean.fillColumns')}>
                      <CheckList
                        items={missingCols.map((c) => ({ value: c.name, label: c.name, hint: `${c.missing}` }))}
                        selected={fillColumns}
                        onToggle={(v) => setFillColumns((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))}
                        onSelectAll={() => setFillColumns(missingCols.map((c) => c.name))}
                        onClear={() => setFillColumns([])}
                        maxHeight={150}
                        emptyLabel={t('clean.noMissing')}
                        labels={{ all: t('common.selectAll'), clear: t('common.clear') }}
                      />
                    </Field>
                    <Callout tone="info" icon="wand">
                      {t('clean.fillPreview', { n: n(fillPreview, 0) })}
                    </Callout>
                    <Button
                      variant="primary"
                      block
                      icon="wand"
                      disabled={fillPreview === 0}
                      onClick={() => {
                        const cols = fillColumns.length ? fillColumns : missingCols.map((c) => c.name);
                        run({
                          kind: 'fillna',
                          columns: cols,
                          strategy: fillStrategy,
                          ...(fillStrategy === 'constant'
                            ? { value: Number.isFinite(Number(fillConstant)) && fillConstant.trim() !== '' ? Number(fillConstant) : fillConstant }
                            : {}),
                        });
                        toast.show(t('op.fillna'), { tone: 'good', detail: t('clean.fillPreview', { n: n(fillPreview, 0) }) });
                        setFillColumns([]);
                      }}
                    >
                      {t('op.fillna')}
                    </Button>
                  </div>
                </ControlGroup>
              </>
            )}

            {section === 'duplicates' && (
              <ControlGroup titleKey="clean.dupTitle">
                <div className="space-y-3">
                  <Field label={t('clean.dupSubset')} hint={t('clean.dupSubsetHint')}>
                    <CheckList
                      items={df.columnNames.map((c) => ({ value: c, label: c }))}
                      selected={dupSubset}
                      onToggle={(v) => setDupSubset((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))}
                      onSelectAll={() => setDupSubset(df.columnNames)}
                      onClear={() => setDupSubset([])}
                      searchable
                      maxHeight={170}
                      labels={{ search: t('common.searchPlaceholder'), all: t('common.selectAll'), clear: t('common.clear') }}
                    />
                  </Field>
                  <Field label={t('clean.dupKeep')}>
                    <Select
                      value={dupKeep}
                      onChange={(e) => setDupKeep(e.target.value as typeof dupKeep)}
                      options={[
                        { value: 'first', label: t('clean.dupKeepFirst') },
                        { value: 'last', label: t('clean.dupKeepLast') },
                        { value: 'none', label: t('clean.dupKeepNone') },
                      ]}
                    />
                  </Field>
                  <Callout tone={dupPositions.length > 0 ? 'warn' : 'good'} icon={dupPositions.length > 0 ? 'copy' : 'check'}>
                    {dupPositions.length > 0 ? t('clean.dupPreview', { n: n(dupPositions.length, 0) }) : t('clean.noDuplicates')}
                  </Callout>
                  <Button
                    variant="primary"
                    block
                    icon="copy"
                    disabled={dupPositions.length === 0}
                    onClick={() => {
                      run({
                        kind: 'dedupe',
                        ...(dupSubset.length ? { subset: dupSubset } : {}),
                        keep: dupKeep === 'none' ? false : dupKeep,
                      });
                      toast.show(t('op.dedupe'), { tone: 'good', detail: t('clean.dupPreview', { n: n(dupPositions.length, 0) }) });
                    }}
                  >
                    {t('op.dedupe')}
                  </Button>
                </div>
              </ControlGroup>
            )}

            {section === 'outliers' && (
              <ControlGroup titleKey="clean.outlierTitle">
                <div className="space-y-3">
                  <Field label={t('clean.outlierColumn')}>
                    <Select
                      value={outColumn}
                      onChange={(e) => setOutColumn(e.target.value)}
                      options={numericCols.map((c) => ({ value: c, label: c }))}
                      placeholder={t('clean.outlierColumn')}
                    />
                  </Field>
                  <Field label={t('clean.outlierMethod')}>
                    <Segmented
                      value={outMethod}
                      onChange={setOutMethod}
                      className="w-full"
                      options={[
                        { value: 'iqr', label: 'IQR' },
                        { value: 'zscore', label: 'Z-Score' },
                      ]}
                    />
                  </Field>
                  {outMethod === 'zscore' && (
                    <Field label={t('clean.outlierThreshold')} inline>
                      <NumberInput value={outThreshold} onChange={setOutThreshold} min={1} max={6} step={0.5} className="!w-20" />
                    </Field>
                  )}
                  {outliers && (
                    <Callout tone={outliers.positions.length > 0 ? 'warn' : 'good'} icon={outliers.positions.length > 0 ? 'alert' : 'check'}>
                      <div className="space-y-0.5">
                        <p>
                          {outliers.positions.length > 0
                            ? t('clean.outlierFound', { n: n(outliers.positions.length, 0) })
                            : t('clean.outlierNone')}
                        </p>
                        <p className="tnum text-[11px] text-ink-faint">
                          {t('clean.outlierRange', { lo: n(outliers.lower, 2), hi: n(outliers.upper, 2) })}
                        </p>
                      </div>
                    </Callout>
                  )}
                  <Field label={t('clean.outlierAction')}>
                    <Select
                      value={outAction}
                      onChange={(e) => setOutAction(e.target.value as typeof outAction)}
                      options={[
                        { value: 'clip', label: t('clean.outlierClip') },
                        { value: 'drop', label: t('clean.outlierDrop') },
                        { value: 'median', label: t('clean.outlierMedian') },
                      ]}
                    />
                  </Field>
                  <Button
                    variant="primary"
                    block
                    icon="target"
                    disabled={!outliers || outliers.positions.length === 0}
                    onClick={() => {
                      run({ kind: 'outlier', column: outColumn, method: outMethod, action: outAction, threshold: outThreshold });
                      toast.show(t('op.outlier'), { tone: 'good' });
                    }}
                  >
                    {t('clean.outlierAction')}
                  </Button>
                </div>
              </ControlGroup>
            )}

            {section === 'types' && (
              <>
                {suggested.length > 0 && (
                  <ControlGroup titleKey="clean.castSubtitle">
                    <div className="space-y-1.5">
                      {suggested.slice(0, 6).map((c) => {
                        const target = SUGGEST[c.hints.find((h) => SUGGEST[h])!];
                        return (
                          <button
                            key={c.name}
                            type="button"
                            onClick={() => setCastMap((p) => ({ ...p, [c.name]: target }))}
                            className="flex w-full items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-left transition-colors hover:border-accent hover:bg-accent-soft"
                          >
                            <Icon name="wand" size={12} className="shrink-0 text-accent" />
                            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">
                              {t('clean.castSuggest', { name: c.name, type: t(`dtype.${target}` as 'dtype.int') })}
                            </span>
                            <Icon name="arrowRight" size={11} className="shrink-0 text-ink-faint" />
                          </button>
                        );
                      })}
                    </div>
                  </ControlGroup>
                )}
                <ControlGroup titleKey="clean.castTitle" hintKey="dtype.castHint">
                  <div className="space-y-2">
                    {castTargets.slice(0, 24).map((name) => {
                      const current = df.dtypeOf(name);
                      const target = castMap[name] ?? current;
                      return (
                        <div key={name} className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink" title={name}>
                            {name}
                          </span>
                          <Badge tone="neutral" mono className="shrink-0">
                            {dtypeLabel(current)}
                          </Badge>
                          <Icon name="arrowRight" size={10} className="shrink-0 text-ink-faint" />
                          <Select
                            value={target}
                            onChange={(e) => setCastMap((p) => ({ ...p, [name]: e.target.value as DType }))}
                            options={(['int', 'float', 'bool', 'datetime', 'category', 'string'] as DType[]).map((d) => ({
                              value: d,
                              label: t(`dtype.${d}` as 'dtype.int'),
                            }))}
                            className="!h-6.5 !w-[104px] !text-[11px]"
                          />
                        </div>
                      );
                    })}
                  </div>
                  <Button
                    variant="primary"
                    block
                    icon="refresh"
                    className="mt-3"
                    disabled={Object.keys(castMap).length === 0}
                    onClick={() => {
                      run({ kind: 'cast', mapping: castMap });
                      toast.show(t('op.cast'), { tone: 'good' });
                      setCastMap({});
                    }}
                  >
                    {t('clean.castApply')}
                  </Button>
                  {Object.keys(castMap).length === 0 && (
                    <p className="mt-2 text-center text-[11px] text-ink-faint">{t('clean.castNoChange')}</p>
                  )}
                </ControlGroup>
              </>
            )}
          </>
        }
      >
        <div className="space-y-5">
          {section === 'missing' && (
            <>
              {profile.missingCells === 0 ? (
                <Card>
                  <EmptyState icon="check" title={t('clean.noMissing')} hint={t('clean.noMissingHint')} />
                </Card>
              ) : (
                <>
                  <Card title={t('clean.missingByColumn')} subtitle={t('clean.missingMapHint')} icon="alert">
                    <div className="space-y-1.5">
                      {missingCols.map((c) => (
                        <button
                          key={c.name}
                          type="button"
                          onClick={() => setFocusColumn(c.name)}
                          className={cx(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2',
                            focusColumn === c.name && 'bg-accent-soft',
                          )}
                        >
                          <span className="w-[150px] shrink-0 truncate text-[12px] font-medium text-ink">{c.name}</span>
                          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                            <div
                              className={cx('h-full rounded-full', c.missingPct > 0.3 ? 'bg-bad' : c.missingPct > 0.05 ? 'bg-warn' : 'bg-good')}
                              style={{ width: `${Math.max(1.5, c.missingPct * 100)}%` }}
                            />
                          </div>
                          <span className="tnum w-14 shrink-0 text-right text-[11.5px] text-ink-soft">{n(c.missing, 0)}</span>
                          <span className="tnum w-12 shrink-0 text-right text-[11.5px] text-ink-muted">{pct(c.missingPct)}</span>
                        </button>
                      ))}
                    </div>
                  </Card>

                  <Card title={t('clean.missingMap')} subtitle={t('clean.missingMapHint')} icon="grid">
                    <MissingMap columns={df.columns} />
                  </Card>
                </>
              )}
            </>
          )}

          {section === 'duplicates' && (
            <>
              {dupPositions.length === 0 ? (
                <Card>
                  <EmptyState icon="check" title={t('clean.noDuplicates')} />
                </Card>
              ) : (
                <>
                  <Card title={t('clean.dupCount')} subtitle={t('clean.dupPreview', { n: n(dupPositions.length, 0) })} icon="copy">
                    <div className="grid grid-cols-3 gap-3">
                      <StatTile label={t('clean.dupCount')} value={n(dupPositions.length, 0)} tone="warn" />
                      <StatTile label={t('common.percent')} value={pct(dupPositions.length / df.nRows)} />
                      <StatTile label={t('clean.dupGroups')} value={n(dupGroupsList.length, 0)} />
                    </div>
                  </Card>
                  <Card title={t('clean.dupGroups')} dense>
                    <div className="scroll-thin max-h-[420px] overflow-auto">
                      {dupGroupsList.map((g, i) => (
                        <div key={g.key} className="border-b border-line/60 p-3 last:border-0">
                          <div className="mb-1.5 flex items-center gap-2">
                            <Badge tone="warn">{t('clean.dupGroupN', { n: i + 1, n2: g.positions.length })}</Badge>
                            <span className="tnum text-[11px] text-ink-faint">
                              {t('data.index')} {g.positions.map((p) => p + 1).join(', ')}
                            </span>
                          </div>
                          <div className="scroll-thin overflow-x-auto">
                            <table className="text-[11.5px]">
                              <tbody>
                                {g.positions.slice(0, 4).map((p) => (
                                  <tr key={p} className="border-b border-line/40 last:border-0">
                                    {df.columns.slice(0, 8).map((c) => (
                                      <td key={c.name} className="max-w-[130px] truncate px-2 py-1 text-ink-soft" title={String(c.data[p] ?? 'NaN')}>
                                        {c.data[p] === null ? <span className="italic text-ink-faint">NaN</span> : String(c.data[p])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </>
              )}
            </>
          )}

          {section === 'outliers' && (
            <>
              {outlierBox && theme && (
                <Card title={t('describe.boxplot')} subtitle={outColumn} icon="target">
                  <EChart
                    height={220}
                    option={boxOption(theme, {
                      groups: outlierBox,
                      yName: outColumn,
                      outlierLabel: t('chart.outlierPoint'),
                    })}
                  />
                </Card>
              )}
              {outliers && outliers.positions.length > 0 && outlierScatter && theme && (
                <Card title={t('clean.outlierView')} subtitle={t('clean.outlierRange', { lo: n(outliers.lower, 2), hi: n(outliers.upper, 2) })} icon="scatter">
                  <EChart
                    height={240}
                    option={{
                      ...barOption(theme, { categories: [], series: [] }),
                      xAxis: { type: 'value', name: t('data.index'), axisLabel: { color: theme.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: theme.grid, type: 'dashed' } } },
                      yAxis: { type: 'value', name: outColumn, scale: true, axisLabel: { color: theme.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: theme.grid, type: 'dashed' } } },
                      series: [
                        {
                          name: 'normal',
                          type: 'scatter',
                          data: outlierScatter.normal,
                          symbolSize: 4,
                          itemStyle: { opacity: 0.45, color: theme.palette[0] },
                        },
                        {
                          name: t('chart.outlierPoint'),
                          type: 'scatter',
                          data: outlierScatter.bad,
                          symbolSize: 8,
                          itemStyle: { color: theme.palette[6], borderColor: theme.surface, borderWidth: 1 },
                          z: 10,
                        },
                      ],
                    }}
                  />
                </Card>
              )}
              {outliers && outliers.positions.length > 0 && (
                <Card title={t('clean.outlierView')} dense>
                  <div className="scroll-thin max-h-[300px] overflow-auto">
                    <table className="w-full text-[11.5px]">
                      <thead className="sticky top-0 bg-surface-2">
                        <tr className="text-left text-[10.5px] text-ink-muted">
                          <th className="px-3 py-1.5 font-medium">{t('data.originalIndex')}</th>
                          {df.columns.slice(0, 7).map((c) => (
                            <th key={c.name} className="px-3 py-1.5 font-medium">
                              {c.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {outliers.positions.slice(0, 60).map((p) => (
                          <tr key={p} className="border-b border-line/40 last:border-0">
                            <td className="tnum px-3 py-1 text-ink-faint">{df.index[p] + 1}</td>
                            {df.columns.slice(0, 7).map((c) => (
                              <td
                                key={c.name}
                                className={cx('max-w-[140px] truncate px-3 py-1', c.name === outColumn ? 'font-medium text-warn' : 'text-ink-soft')}
                              >
                                {c.data[p] === null ? <span className="italic text-ink-faint">NaN</span> : String(c.data[p])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
              {outliers && outliers.positions.length === 0 && (
                <Card>
                  <EmptyState icon="check" title={t('clean.outlierNone')} hint={t('clean.outlierRange', { lo: n(outliers.lower, 2), hi: n(outliers.upper, 2) })} />
                </Card>
              )}
            </>
          )}

          {section === 'types' && (
            <Card title={t('clean.castTitle')} subtitle={t('clean.castSubtitle')} dense>
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[560px] text-[12px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] text-ink-muted">
                      <th className="px-4 py-2 font-medium">{t('overview.colName')}</th>
                      <th className="px-3 py-2 font-medium">{t('clean.castCurrent')}</th>
                      <th className="px-3 py-2 font-medium">{t('common.example')}</th>
                      <th className="px-3 py-2 font-medium">{t('overview.colUnique')}</th>
                      <th className="px-3 py-2 font-medium">{t('overview.colTags')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.columns.map((c) => (
                      <tr key={c.name} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                        <td className="max-w-[200px] truncate px-4 py-2 font-medium text-ink">{c.name}</td>
                        <td className="px-3 py-2">
                          <Badge tone="neutral" mono>
                            {dtypeLabel(c.dtype)}
                          </Badge>
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-2 font-mono text-[11px] text-ink-muted">
                          {c.samples.slice(0, 3).map((s) => (s === null ? 'NaN' : String(s))).join(', ')}
                        </td>
                        <td className="tnum px-3 py-2 text-ink-soft">{n(c.uniqueCount, 0)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {c.hints.slice(0, 3).map((h) => (
                              <Badge key={h} tone="neutral" title={t(`hintExplain.${h}` as 'hintExplain.constant')}>
                                {t(`hint.${h}` as 'hint.constant')}
                              </Badge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </SplitView>
    </div>
  );
}
