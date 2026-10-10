import type { DataFrame } from '../core/DataFrame.ts';
import { fetchDataset, loadFile, parseCSV, parseJSON } from '../core/io.ts';
import type { DatasetMeta } from '../pipeline/store.ts';

/**
 * Bundled sample datasets and the single entry point the UI uses to load data
 * from any source (sample, file drop, or pasted text).
 */

export interface SampleDataset {
  id: string;
  /** i18n key for the display name. */
  nameKey: 'datasets.titanic' | 'datasets.sales' | 'datasets.iris' | 'datasets.airquality' | 'datasets.gapminder' | 'datasets.bigsales';
  descKey:
    | 'datasets.titanicDesc'
    | 'datasets.salesDesc'
    | 'datasets.irisDesc'
    | 'datasets.airqualityDesc'
    | 'datasets.gapminderDesc'
    | 'datasets.bigsalesDesc';
  file: string;
  rows: number;
  cols: number;
  /** Accent colour for the card, drawn from the viz palette. */
  tone: number;
  icon: string;
}

export const SAMPLE_DATASETS: SampleDataset[] = [
  { id: 'titanic', nameKey: 'datasets.titanic', descKey: 'datasets.titanicDesc', file: 'titanic.csv', rows: 891, cols: 15, tone: 0, icon: 'database' },
  { id: 'sales', nameKey: 'datasets.sales', descKey: 'datasets.salesDesc', file: 'sales.csv', rows: 5000, cols: 17, tone: 1, icon: 'chart' },
  { id: 'iris', nameKey: 'datasets.iris', descKey: 'datasets.irisDesc', file: 'iris.csv', rows: 150, cols: 5, tone: 2, icon: 'target' },
  { id: 'airquality', nameKey: 'datasets.airquality', descKey: 'datasets.airqualityDesc', file: 'airquality.csv', rows: 1461, cols: 11, tone: 3, icon: 'flask' },
  { id: 'gapminder', nameKey: 'datasets.gapminder', descKey: 'datasets.gapminderDesc', file: 'gapminder.csv', rows: 1704, cols: 6, tone: 4, icon: 'globe' },
  { id: 'bigsales', nameKey: 'datasets.bigsales', descKey: 'datasets.bigsalesDesc', file: 'bigsales.csv', rows: 100000, cols: 11, tone: 5, icon: 'layers' },
];

export const DEFAULT_DATASET_ID = 'titanic';

export interface LoadOutcome {
  df: DataFrame;
  meta: DatasetMeta;
}

export function sampleUrl(file: string): string {
  return `${import.meta.env.BASE_URL}datasets/${file}`.replace('//datasets', '/datasets');
}

export async function loadSample(id: string): Promise<LoadOutcome> {
  const sample = SAMPLE_DATASETS.find((s) => s.id === id) ?? SAMPLE_DATASETS[0];
  const { df, warnings } = await fetchDataset(sampleUrl(sample.file), sample.id);
  return {
    df,
    meta: {
      id: sample.id,
      name: sample.id,
      sourceKind: 'sample',
      sourceLabel: `datasets/${sample.file}`,
      warnings,
    },
  };
}

export async function loadFromFile(file: File): Promise<LoadOutcome> {
  const { df, warnings } = await loadFile(file);
  return {
    df,
    meta: {
      id: `file:${file.name}`,
      name: file.name.replace(/\.[^.]+$/, ''),
      sourceKind: 'file',
      sourceLabel: file.name,
      warnings,
    },
  };
}

export async function loadFromText(text: string, name = 'pasted'): Promise<LoadOutcome> {
  const trimmed = text.trim();
  if (trimmed === '') throw new Error('empty');
  const looksJson = trimmed.startsWith('[') || trimmed.startsWith('{');
  const df = looksJson ? parseJSON(trimmed, name) : parseCSV(trimmed, { name });
  return {
    df,
    meta: { id: `paste:${name}`, name, sourceKind: 'paste', sourceLabel: name, warnings: [] },
  };
}

/** Rough size estimate used to warn before parsing a very large file. */
export function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ACCEPTED_EXTENSIONS = '.csv,.tsv,.txt,.json,.jsonl,.ndjson,.xlsx,.xls,.xlsm,.ods';
