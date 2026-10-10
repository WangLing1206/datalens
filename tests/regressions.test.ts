/**
 * Regression tests for bugs found while auditing the running app, plus the
 * analysis-project file format that the pipeline rail reads and writes.
 */
import { describe, expect, it } from 'vitest';
import { parseCSV } from '../src/core/io.ts';
import { profileColumn, profileFrame } from '../src/core/profile.ts';
import { isProjectFilename, parseProjectPayload } from '../src/app/project.ts';
import { heatmapOption, barOption, lineOption } from '../src/components/charts/builders.ts';
import { categoryAxis } from '../src/components/charts/EChart.tsx';
import type { ChartTheme } from '../src/components/charts/EChart.tsx';

const THEME: ChartTheme = {
  palette: ['#1', '#2', '#3', '#4', '#5', '#6', '#7', '#8'],
  grid: '#grid',
  axis: '#axis',
  text: '#text',
  textMuted: '#muted',
  surface: '#surface',
  surfaceElevated: '#elevated',
  line: '#line',
  accent: '#accent',
  fontFamily: 'system-ui',
  isDark: true,
};

describe('column hints', () => {
  it('never reports the same hint twice for a boolean column', () => {
    const df = parseCSV('id,alive\n1,true\n2,false\n3,true\n4,false\n5,true\n6,false');
    const p = profileColumn(df.require('alive'), 1);
    const dupes = p.hints.filter((h, i) => p.hints.indexOf(h) !== i);
    expect(dupes).toEqual([]);
    expect(p.hints).toContain('binary');
    expect(p.hints.filter((h) => h === 'binary')).toHaveLength(1);
  });

  it('keeps every hint unique across a whole frame', () => {
    const df = parseCSV(
      'flag,n,cat\n' +
        Array.from({ length: 12 }, (_, i) => `${i % 2 === 0},${i},${i % 3 === 0 ? 'a' : 'b'}`).join('\n'),
    );
    for (const col of profileFrame(df).columns) {
      const unique = new Set(col.hints);
      expect(col.hints.length, col.name).toBe(unique.size);
    }
  });
});

describe('chart options survive ECharts option merging', () => {
  it('states boundaryGap explicitly on a cartesian heatmap', () => {
    const option = heatmapOption(THEME, { xLabels: ['a', 'b'], yLabels: ['x', 'y'], cells: [[1, 2], [3, 4]] });
    // ECharts merges successive options; a heatmap that leaves boundaryGap
    // unset inherits the false that a line chart sets and then throws.
    expect((option.xAxis as { boundaryGap?: boolean }).boundaryGap).toBe(true);
    expect((option.yAxis as { boundaryGap?: boolean }).boundaryGap).toBe(true);
  });

  it('states boundaryGap explicitly on a bar chart', () => {
    const option = barOption(THEME, { categories: ['a', 'b'], series: [{ name: 's', data: [1, 2] }] });
    expect((option.xAxis as { boundaryGap?: boolean }).boundaryGap).toBe(true);
  });

  it('leaves a line chart with a gap-free axis', () => {
    const option = lineOption(THEME, { categories: ['a', 'b'], series: [{ name: 's', data: [1, 2] }] });
    expect((option.xAxis as { boundaryGap?: boolean }).boundaryGap).toBe(false);
  });

  it('thins dense category axes but labels short ones fully', () => {
    const short = categoryAxis(THEME, ['a', 'b', 'c']);
    expect((short.axisLabel as { interval?: number | string }).interval).toBe(0);
    const long = categoryAxis(THEME, Array.from({ length: 60 }, (_, i) => String(i)));
    expect((long.axisLabel as { interval?: number | string }).interval).toBe('auto');
  });
});

describe('analysis project files', () => {
  const op = { kind: 'dropna', how: 'any' as const };

  it('recognises a project payload', () => {
    const text = JSON.stringify({ version: 1, dataset: { id: 'titanic', name: 'titanic', sourceKind: 'sample', sourceLabel: 'datasets/titanic.csv', warnings: [] }, ops: [op] });
    const parsed = parseProjectPayload(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.ops).toHaveLength(1);
    expect(parsed?.dataset?.id).toBe('titanic');
  });

  it('accepts a project with no operations yet', () => {
    const parsed = parseProjectPayload(JSON.stringify({ version: 1, dataset: null, ops: [] }));
    expect(parsed?.ops).toEqual([]);
  });

  it('rejects unrelated JSON', () => {
    expect(parseProjectPayload('{"a":1}')).toBeNull();
    expect(parseProjectPayload('[{"a":1}]')).toBeNull();
    expect(parseProjectPayload('not json')).toBeNull();
    expect(parseProjectPayload('{"ops":[{"nope":1}]}')).toBeNull();
    expect(parseProjectPayload('{"version":"1","ops":[]}')).toBeNull();
  });

  it('identifies project filenames', () => {
    expect(isProjectFilename('analysis.daproj.json')).toBe(true);
    expect(isProjectFilename('ANALYSIS.DAPROJ.JSON')).toBe(true);
    expect(isProjectFilename('data.json')).toBe(false);
  });
});
