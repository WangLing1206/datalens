/**
 * Core-engine unit tests: the delimited-text parser, frame semantics, the
 * cleaning operations, the filter AST and the expression evaluator.
 */
import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCSV, parseDelimited, frameFromJSONValue, coerceCell } from '../src/core/io.ts';
import { DataFrame, frameFromRows } from '../src/core/DataFrame.ts';
import {
  binColumn,
  castColumns,
  crosstab,
  dropDuplicates,
  dropna,
  duplicateGroups,
  duplicatedPositions,
  evaluateExpression,
  fillna,
  fillValueFor,
  matchesGroup,
  melt,
  normalizeColumn,
  oneHotEncode,
  validateExpression,
  whichRowsDropped,
} from '../src/core/ops.ts';
import type { FilterGroup } from '../src/core/ops.ts';
import { inferDtype, makeColumn, parseDateString, toNumber } from '../src/core/dtype.ts';
import { profileColumn, profileFrame } from '../src/core/profile.ts';
import { histogram, lttb, quantile, rankAverage } from '../src/core/stats.ts';

describe('delimited-text parser', () => {
  it('detects the delimiter across candidates', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
  });

  it('handles quoted fields with embedded delimiters and newlines', () => {
    const t = parseDelimited('name,note\n"Smith, John","line1\nline2"\n"O""Brien",plain');
    expect(t.headers).toEqual(['name', 'note']);
    expect(t.rows[0]).toEqual(['Smith, John', 'line1\nline2']);
    expect(t.rows[1]).toEqual(['O"Brien', 'plain']);
  });

  it('strips a UTF-8 BOM', () => {
    const t = parseDelimited('\uFEFFa,b\n1,2');
    expect(t.headers).toEqual(['a', 'b']);
  });

  it('handles CRLF line endings', () => {
    const t = parseDelimited('a,b\r\n1,2\r\n3,4\r\n');
    expect(t.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('pads ragged rows and flags them', () => {
    const t = parseDelimited('a,b,c\n1,2\n1,2,3,4');
    expect(t.ragged).toBe(true);
    expect(t.rows[0]).toEqual(['1', '2', '']);
    expect(t.rows[1]).toEqual(['1', '2', '3']);
  });

  it('de-duplicates repeated header names the way pandas does', () => {
    const df = parseCSV('a,a,a\n1,2,3');
    expect(df.columnNames).toEqual(['a', 'a.1', 'a.2']);
  });

  it('names unnamed columns Unnamed: N', () => {
    const df = parseCSV('a,,c\n1,2,3');
    expect(df.columnNames).toEqual(['a', 'Unnamed: 1', 'c']);
  });

  it('treats NA tokens as missing', () => {
    const df = parseCSV('x,y\n1,NA\n2,\n3,NULL');
    expect(df.require('y').data).toEqual([null, null, null]);
  });

  it('infers per-column types from text', () => {
    const df = parseCSV('i,f,b,d,s\n1,1.5,True,2024-01-05,hi\n2,2.5,False,2024-02-06,yo');
    expect(df.columnNames).toEqual(['i', 'f', 'b', 'd', 's']);
    expect(df.dtypeOf('i')).toBe('int');
    expect(df.dtypeOf('f')).toBe('float');
    expect(df.dtypeOf('b')).toBe('bool');
    expect(df.dtypeOf('d')).toBe('datetime');
    expect(df.dtypeOf('s')).toBe('string');
    expect(df.require('d').data).toEqual([Date.UTC(2024, 0, 5), Date.UTC(2024, 1, 6)]);
  });

  it('parses a headerless table with generated column names', () => {
    const df = parseCSV('1,2\n3,4', { hasHeader: false });
    expect(df.columnNames).toEqual(['col_0', 'col_1']);
    expect(df.nRows).toBe(2);
  });

  it('honours a forced dtype override', () => {
    const df = parseCSV('zip\n01234\n00567', { dtypes: { zip: 'string' } });
    expect(df.require('zip').data).toEqual(['01234', '00567']);
  });
});

describe('date parsing', () => {
  it('accepts the common layouts', () => {
    expect(parseDateString('2024-01-15')).toBe(Date.UTC(2024, 0, 15));
    expect(parseDateString('2024/1/5')).toBe(Date.UTC(2024, 0, 5));
    expect(parseDateString('2024-01-15 13:45')).toBe(Date.UTC(2024, 0, 15, 13, 45));
    expect(parseDateString('01/15/2024')).toBe(Date.UTC(2024, 0, 15));
    expect(parseDateString('2024-01-15T10:00:00Z')).toBe(Date.UTC(2024, 0, 15, 10, 0, 0));
  });

  it('rejects non-dates and impossible dates', () => {
    expect(parseDateString('hello')).toBeNull();
    expect(parseDateString('2024')).toBeNull(); // a bare year stays an integer
    expect(parseDateString('2024-02-31')).toBeNull(); // rolls over -> rejected
    expect(parseDateString('2024-13-01')).toBeNull();
  });

  it('prefers integers over booleans so a 1/0 column stays numeric', () => {
    expect(inferDtype(['1', '0', '1'])).toBe('int');
    expect(inferDtype(['true', 'false'])).toBe('bool');
    expect(inferDtype(['True', 'False', 'True'])).toBe('bool');
    expect(inferDtype(['1', 'true'])).toBe('string');
    expect(inferDtype([null, null])).toBe('string');
  });

  it('coerces with thousands separators', () => {
    expect(toNumber('1,234.5')).toBe(1234.5);
  });
});

describe('DataFrame semantics', () => {
  const df = frameFromRows(
    ['a', 'b'],
    [
      [1, 'x'],
      [2, 'y'],
      [3, 'z'],
      [4, 'x'],
    ],
    'test',
  );

  it('reports shape and columns', () => {
    expect(df.shape).toEqual([4, 2]);
    expect(df.columnNames).toEqual(['a', 'b']);
  });

  it('preserves original row ids through filtering', () => {
    const filtered = df.filter((r) => r.num('a') > 2);
    expect(filtered.nRows).toBe(2);
    expect(filtered.index).toEqual([2, 3]);
  });

  it('takes rows by position without mutating the source', () => {
    const t = df.take([0, 2]);
    expect(t.require('a').data).toEqual([1, 3]);
    expect(df.nRows).toBe(4);
  });

  it('head/tail/sample return the expected slices', () => {
    expect(df.head(2).require('a').data).toEqual([1, 2]);
    expect(df.tail(2).require('a').data).toEqual([3, 4]);
    expect(df.sample(2, 1).nRows).toBe(2);
    expect(df.sample(2, 1).require('a').data).toEqual(df.sample(2, 1).require('a').data);
  });

  it('select/drop/rename produce new frames', () => {
    expect(df.select(['b']).columnNames).toEqual(['b']);
    expect(df.drop(['b']).columnNames).toEqual(['a']);
    expect(df.rename({ a: 'A' }).columnNames).toEqual(['A', 'b']);
  });

  it('withColumn appends and replaces', () => {
    const withNew = df.withColumn('c', [10, 20, 30, 40]);
    expect(withNew.columnNames).toEqual(['a', 'b', 'c']);
    const replaced = df.withColumn('a', [9, 9, 9, 9]);
    expect(replaced.columnNames).toEqual(['a', 'b']);
    expect(replaced.require('a').data).toEqual([9, 9, 9, 9]);
  });

  it('concatRows pads missing columns with null', () => {
    const other = frameFromRows(['a'], [[5]], 'o');
    const joined = df.concatRows(other);
    expect(joined.nRows).toBe(5);
    expect(joined.require('b').data[4]).toBeNull();
  });

  it('classifies columns by role', () => {
    const mixed = parseCSV('n,s,d,b\n1,hi,2024-01-01,True\n2,yo,2024-01-02,False');
    expect(mixed.numericColumnNames()).toEqual(['n']);
    expect(mixed.datetimeColumns().map((c) => c.name)).toEqual(['d']);
    expect(mixed.categoricalColumns().map((c) => c.name).sort()).toEqual(['b', 's']);
  });
});

describe('missing-value operations', () => {
  const df = frameFromRows(
    ['a', 'b', 'c'],
    [
      [1, null, 'x'],
      [null, null, 'y'],
      [3, 2, null],
      [4, 3, 'w'],
    ],
  );

  it('dropna(how="any") keeps only fully-populated rows', () => {
    expect(dropna(df, { how: 'any' }).nRows).toBe(1);
  });

  it('dropna(how="all") keeps any row with at least one value', () => {
    expect(dropna(df, { how: 'all' }).nRows).toBe(4);
  });

  it('dropna(thresh=n) keeps rows with at least n values', () => {
    expect(dropna(df, { how: 'all', thresh: 2 }).nRows).toBe(3);
  });

  it('dropna(subset) ignores other columns', () => {
    expect(dropna(df, { how: 'any', subset: ['a'] }).nRows).toBe(3);
  });

  it('whichRowsDropped reports positions', () => {
    expect(whichRowsDropped(df, { how: 'any' })).toEqual([0, 1, 2]);
  });

  it('fillna(median) replaces only the holes', () => {
    const f = fillna(df, { columns: ['b'], strategy: 'median' });
    // non-null values are 2 and 3 -> median 2.5
    expect(f.require('b').data).toEqual([2.5, 2.5, 2, 3]);
  });

  it('fillna(ffill) and (bfill) carry neighbours', () => {
    const ff = fillna(df, { columns: ['b'], strategy: 'ffill' });
    expect(ff.require('b').data).toEqual([null, null, 2, 3]);
    const bf = fillna(df, { columns: ['b'], strategy: 'bfill' });
    expect(bf.require('b').data).toEqual([2, 2, 2, 3]);
  });

  it('fillna(interpolate) linearly bridges gaps', () => {
    const gapped = frameFromRows(['v'], [[1], [null], [null], [4]]);
    const f = fillna(gapped, { columns: ['v'], strategy: 'interpolate' });
    expect(f.require('v').data).toEqual([1, 2, 3, 4]);
  });

  it('fillValueFor computes the strategy value without mutating', () => {
    const col = makeColumn('x', [1, 2, 3, null, 4]);
    expect(fillValueFor(col, 'mean')).toBe(2.5);
    expect(fillValueFor(col, 'median')).toBe(2.5);
    expect(fillValueFor(col, 'mode')).toBe(1);
    expect(col.data[3]).toBeNull();
  });
});

describe('duplicate detection', () => {
  const df = frameFromRows(
    ['a', 'b'],
    [
      [1, 'x'],
      [2, 'y'],
      [1, 'x'],
      [3, 'z'],
      [1, 'x'],
    ],
  );

  it('finds duplicates keeping the first occurrence', () => {
    expect(duplicatedPositions(df, undefined, 'first')).toEqual([2, 4]);
  });

  it('keeps the last occurrence instead', () => {
    expect(duplicatedPositions(df, undefined, 'last')).toEqual([0, 2]);
  });

  it('marks every member of a duplicate set when keep=false', () => {
    expect(duplicatedPositions(df, undefined, false)).toEqual([0, 2, 4]);
  });

  it('dropDuplicates shrinks the frame', () => {
    expect(dropDuplicates(df, undefined, 'first').nRows).toBe(3);
  });

  it('honours a subset of columns', () => {
    expect(duplicatedPositions(df, ['b'], 'first')).toEqual([2, 4]);
  });

  it('groups duplicates for inspection', () => {
    const groups = duplicateGroups(df, undefined);
    expect(groups.length).toBe(1);
    expect(groups[0].positions).toEqual([0, 2, 4]);
  });
});

describe('type casting', () => {
  const df = frameFromRows(['mixed'], [['1'], ['2'], ['oops'], [null]]);

  it('casts and reports the values that failed', () => {
    const r = castColumns(df, { mixed: 'int' });
    expect(r.df.require('mixed').data).toEqual([1, 2, null, null]);
    expect(r.failures.mixed).toEqual([2]);
  });

  it('casts strings to datetime', () => {
    const d = frameFromRows(['d'], [['2024-01-01'], ['bad'], [null]]);
    const r = castColumns(d, { d: 'datetime' });
    expect(r.df.require('d').data).toEqual([Date.UTC(2024, 0, 1), null, null]);
    expect(r.failures.d).toEqual([1]);
  });
});

describe('filter AST', () => {
  const df = frameFromRows(
    ['name', 'age', 'city'],
    [
      ['ann', 25, 'beijing'],
      ['bob', 34, 'shanghai'],
      ['cid', 41, 'beijing'],
      [null, 19, 'shenzhen'],
    ],
  );

  const g = (conditions: FilterGroup['conditions'], logic: 'and' | 'or' = 'and'): FilterGroup => ({
    id: 'g',
    logic,
    conditions,
  });

  it('numeric comparisons', () => {
    const r = g([{ id: '1', column: 'age', op: '>', value: 30 }]);
    expect(df.filter((_row, i) => matchesGroup(df, i, r)).nRows).toBe(2);
  });

  it('string operators', () => {
    const r = g([{ id: '1', column: 'city', op: 'contains', value: 'jing' }]);
    expect(df.filter((_row, i) => matchesGroup(df, i, r)).nRows).toBe(2);
  });

  it('is_null finds the hole', () => {
    const r = g([{ id: '1', column: 'name', op: 'is_null' }]);
    expect(df.filter((_row, i) => matchesGroup(df, i, r)).nRows).toBe(1);
  });

  it('between is inclusive on both ends', () => {
    const r = g([{ id: '1', column: 'age', op: 'between', value: 25, value2: 34 }]);
    expect(df.filter((_row, i) => matchesGroup(df, i, r)).nRows).toBe(2);
  });

  it('in / not_in', () => {
    const r = g([{ id: '1', column: 'city', op: 'in', values: ['beijing', 'shenzhen'] }]);
    expect(df.filter((_row, i) => matchesGroup(df, i, r)).nRows).toBe(3);
    const r2 = g([{ id: '1', column: 'city', op: 'not_in', values: ['beijing'] }]);
    expect(df.filter((_row, i) => matchesGroup(df, i, r2)).nRows).toBe(2);
  });

  it('AND requires all conditions, OR requires one', () => {
    const conds = [
      { id: '1', column: 'city', op: '==' as const, value: 'beijing' },
      { id: '2', column: 'age', op: '<' as const, value: 30 },
    ];
    expect(df.filter((_r, i) => matchesGroup(df, i, g(conds, 'and'))).nRows).toBe(1);
    expect(df.filter((_r, i) => matchesGroup(df, i, g(conds, 'or'))).nRows).toBe(3);
  });

  it('a null never satisfies a comparison', () => {
    const r = g([{ id: '1', column: 'name', op: '==', value: 'ann' }]);
    expect(df.filter((_r, i) => matchesGroup(df, i, r)).nRows).toBe(1);
  });
});

describe('expression column builder', () => {
  const df = frameFromRows(['a', 'b'], [[2, 3], [4, 5], [6, 7]]);

  it('evaluates arithmetic with precedence and parentheses', () => {
    expect(evaluateExpression(df, 'a + b * 2').data).toEqual([8, 14, 20]);
    expect(evaluateExpression(df, '(a + b) * 2').data).toEqual([10, 18, 26]);
  });

  it('supports bracket references for names with spaces', () => {
    const spaced = frameFromRows(['my col'], [[5], [6]]);
    expect(evaluateExpression(spaced, '[my col] * 2').data).toEqual([10, 12]);
  });

  it('supports functions', () => {
    expect(evaluateExpression(df, 'round(sqrt(a) + 0.5, 2)').data).toEqual([1.91, 2.5, 2.95]);
    expect(evaluateExpression(df, 'max(a, b)').data).toEqual([3, 5, 7]);
    expect(evaluateExpression(df, 'pow(a, 2)').data).toEqual([4, 16, 36]);
  });

  it('exponent operator', () => {
    expect(evaluateExpression(df, 'a ^ 3').data).toEqual([8, 64, 216]);
  });

  it('reports unknown columns and syntax errors instead of throwing', () => {
    const bad = evaluateExpression(df, 'nope + 1');
    expect(bad.error).toMatch(/Unknown column/);
    expect(evaluateExpression(df, 'a +').error).toBeTruthy();
    expect(validateExpression('a +', df).ok).toBe(false);
    expect(validateExpression('a + b', df).ok).toBe(true);
  });

  it('propagates null through null inputs', () => {
    const withNull = frameFromRows(['a', 'b'], [[1, null], [2, 3]]);
    expect(evaluateExpression(withNull, 'a + b').data).toEqual([null, 5]);
  });
});

describe('reshape operations', () => {
  const df = frameFromRows(
    ['id', 'q1', 'q2'],
    [
      [1, 10, 20],
      [2, 30, 40],
    ],
  );

  it('melt goes wide -> long', () => {
    const m = melt(df, ['id'], ['q1', 'q2']);
    expect(m.columnNames).toEqual(['id', 'q1', 'q2'].slice(0, 1).concat(['variable', 'value']));
    expect(m.nRows).toBe(4);
    expect(m.require('variable').data).toEqual(['q1', 'q2', 'q1', 'q2']);
  });

  it('crosstab counts co-occurrences', () => {
    const ct = crosstab(df, { row: 'id', col: 'q1' });
    expect(ct.rowValues).toEqual(['1', '2']);
    expect(ct.counts).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(ct.total).toBe(2);
  });

  it('binColumn produces right-closed intervals like pd.cut', () => {
    const nums = frameFromRows(['v'], [[0], [1], [2], [3], [4], [5], [6], [7], [8], [9]]);
    const { df: binned, info } = binColumn(nums, { column: 'v', method: 'equal', bins: 2 });
    expect(info.edges).toEqual([0, 4.5, 9]);
    const labels = binned.require('v_bin').data;
    expect(labels[0]).toBe('(0, 4.5]');
    expect(labels[9]).toBe('(4.5, 9]');
  });

  it('qcut-style binning keeps roughly equal counts', () => {
    const nums = frameFromRows(['v'], Array.from({ length: 100 }, (_, i) => [i]));
    const { info } = binColumn(nums, { column: 'v', method: 'quantile', bins: 4 });
    expect(info.labels.length).toBe(4);
    expect(info.edges[1]).toBeCloseTo(24.75, 6);
  });

  it('normalizeColumn min-max and z-score', () => {
    const nums = frameFromRows(['v'], [[0], [5], [10]]);
    const mm = normalizeColumn(nums, 'v', 'minmax');
    expect(mm.require('v_mm').data).toEqual([0, 0.5, 1]);
    const z = normalizeColumn(nums, 'v', 'zscore');
    expect(z.require('v_z').data![0]).toBeCloseTo(-1, 10);
    expect(z.require('v_z').data![1]).toBeCloseTo(0, 10);
    expect(z.require('v_z').data![2]).toBeCloseTo(1, 10);
  });

  it('oneHotEncode creates indicator columns and can drop the first', () => {
    const cats = frameFromRows(['c'], [['a'], ['b'], ['a'], [null]]);
    const full = oneHotEncode(cats, { columns: ['c'], dropFirst: false, maxCategories: 10, separator: '_' });
    expect(full.created).toEqual(['c_a', 'c_b']);
    expect(full.df.require('c_a').data).toEqual([1, 0, 1, null]);
    const dropped = oneHotEncode(cats, { columns: ['c'], dropFirst: true, maxCategories: 10, separator: '_' });
    expect(dropped.created).toEqual(['c_b']);
  });

  it('oneHotEncode skips columns that are too high-cardinality', () => {
    const many = frameFromRows(['c'], Array.from({ length: 20 }, (_, i) => [`v${i}`]));
    const r = oneHotEncode(many, { columns: ['c'], dropFirst: false, maxCategories: 5, separator: '_' });
    expect(r.skipped).toEqual(['c']);
    expect(r.created).toEqual([]);
  });
});

describe('JSON ingestion', () => {
  it('reads an array of records', () => {
    const df = frameFromJSONValue([
      { a: 1, b: 'x' },
      { a: 2, c: true },
    ]);
    expect(df.columnNames.sort()).toEqual(['a', 'b', 'c']);
    expect(df.require('c').data).toEqual([null, true]);
  });

  it('reads pandas orient="split"', () => {
    const df = frameFromJSONValue({ columns: ['a', 'b'], data: [[1, 2], [3, 4]] });
    expect(df.columnNames).toEqual(['a', 'b']);
    expect(df.require('a').data).toEqual([1, 3]);
  });

  it('reads an object of column arrays', () => {
    const df = frameFromJSONValue({ a: [1, 2], b: ['x', 'y'] });
    expect(df.shape).toEqual([2, 2]);
  });

  it('reads an array of primitives as one column', () => {
    const df = frameFromJSONValue([1, 2, 3]);
    expect(df.columnNames).toEqual(['value']);
    expect(df.nRows).toBe(3);
  });
});

describe('profiling', () => {
  it('computes a per-column profile with hints', () => {
    const df = frameFromRows(
      ['const', 'id', 'sparse', 'num'],
      Array.from({ length: 12 }, (_, i) => [1, i + 1, i === 0 ? 5 : null, i + 1]),
    );
    const p = profileColumn(df.require('const'), 0);
    expect(p.hints).toContain('constant');

    const idp = profileColumn(df.require('id'), 1);
    expect(idp.hints).toContain('identifier');

    const sp = profileColumn(df.require('sparse'), 2);
    expect(sp.hints).toContain('high-missing');
    expect(sp.missingPct).toBeCloseTo(11 / 12, 10);
  });

  it('scores frame health and explains the penalties', () => {
    const clean = frameFromRows(['a', 'b'], Array.from({ length: 50 }, (_, i) => [i, i * 2]));
    expect(profileFrame(clean).healthScore).toBe(100);

    const messy = frameFromRows(
      ['a', 'b'],
      Array.from({ length: 50 }, (_, i) => [i, i % 3 === 0 ? null : i]),
    );
    const pf = profileFrame(messy);
    expect(pf.healthScore).toBeLessThan(100);
    expect(pf.healthBreakdown.some((b) => b.key === 'missing')).toBe(true);
  });

  it('counts duplicate rows for the health score', () => {
    const df = frameFromRows(['a'], [[1], [1], [1], [2]]);
    expect(profileFrame(df).duplicateRows).toBe(2);
  });
});

describe('statistics helpers', () => {
  it('quantile interpolates linearly', () => {
    const s = [1, 2, 3, 4];
    expect(quantile(s, 0)).toBe(1);
    expect(quantile(s, 1)).toBe(4);
    expect(quantile(s, 0.5)).toBe(2.5);
    expect(quantile(s, 0.25)).toBe(1.75);
    expect(quantile([5], 0.5)).toBe(5);
  });

  it('rankAverage averages tied ranks', () => {
    expect(rankAverage([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it('histogram counts every value exactly once', () => {
    const h = histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(h.counts.length).toBe(3);
    expect(h.binEdges.length).toBe(4);
  });

  it('histogram handles a constant column', () => {
    const h = histogram([5, 5, 5], 4);
    expect(h.counts).toEqual([3]);
  });

  it('lttb keeps the endpoints and hits the target size', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i);
    const ys = xs.map((x) => Math.sin(x / 20));
    const out = lttb(xs, ys, 100);
    expect(out.x.length).toBe(100);
    expect(out.x[0]).toBe(0);
    expect(out.x[out.x.length - 1]).toBe(999);
  });

  it('lttb is a no-op below the threshold', () => {
    const out = lttb([1, 2, 3], [1, 2, 3], 10);
    expect(out.x).toEqual([1, 2, 3]);
  });
});

describe('column construction', () => {
  it('makeColumn infers when no dtype is given', () => {
    expect(makeColumn('x', [1, 2]).dtype).toBe('int');
    expect(makeColumn('x', [1, null]).dtype).toBe('int');
    expect(makeColumn('x', [1.5]).dtype).toBe('float');
  });

  it('coerceCell maps NA tokens to null for every dtype', () => {
    expect(coerceCell('', 'int')).toBeNull();
    expect(coerceCell('NA', 'float')).toBeNull();
    expect(coerceCell('null', 'string')).toBeNull();
  });

  it('coerces every token that inference accepts as boolean', () => {
    // Regression: inference accepts yes/no but coercion once only handled
    // True/False/1/0, which silently blanked a whole column.
    for (const t of ['true', 'True', 'TRUE', 'yes', 'Yes', 'YES', 't', 'T', '1']) {
      expect(coerceCell(t, 'bool'), t).toBe(true);
    }
    for (const f of ['false', 'False', 'FALSE', 'no', 'No', 'NO', 'f', 'F', '0']) {
      expect(coerceCell(f, 'bool'), f).toBe(false);
    }
    expect(coerceCell('maybe', 'bool')).toBeNull();
  });

  it('keeps a yes/no column intact end to end', () => {
    const df = parseCSV('id,alive\n1,yes\n2,no\n3,yes');
    expect(df.dtypeOf('alive')).toBe('bool');
    expect(df.require('alive').data).toEqual([true, false, true]);
  });

  it('empty frame stays usable', () => {
    const empty = new DataFrame([]);
    expect(empty.nRows).toBe(0);
    expect(empty.isEmpty).toBe(true);
    expect(empty.columnNames).toEqual([]);
  });
});
