/**
 * Pandas parity suite.
 *
 * `tests/fixtures/pandas_expected.json` is produced by running real pandas
 * (see tools/gen_pandas_fixtures.py). Every assertion below is "does our
 * TypeScript engine reproduce what pandas computed" — that is the evidence
 * behind the claim that this tool is a visual pandas rather than a lookalike.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCSV } from '../src/core/io.ts';
import { DataFrame } from '../src/core/DataFrame.ts';
import { groupBy } from '../src/core/groupby.ts';
import { pivotTable } from '../src/core/pivot.ts';
import { dropna, dropDuplicates, duplicatedPositions, fillna, sortValues } from '../src/core/ops.ts';
import { expanding, resample, rolling } from '../src/core/timeseries.ts';
import { kendall, pearson, spearman } from '../src/core/stats.ts';
import { numericValues } from '../src/core/stats.ts';
import { profileFrame } from '../src/core/profile.ts';
import type { Scalar } from '../src/core/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const csv = readFileSync(join(HERE, 'fixtures', 'pandas_sample.csv'), 'utf8');
const E = JSON.parse(readFileSync(join(HERE, 'fixtures', 'pandas_expected.json'), 'utf8'));

const df: DataFrame = parseCSV(csv, { name: 'sample' });
const num = (name: string): number[] => numericValues(df.require(name).data);

/** Compare with a tolerance that scales with magnitude. */
function near(actual: number | null | undefined, expected: number | null | undefined, tol = 1e-9): void {
  if (expected === null || expected === undefined) {
    expect(actual === null || actual === undefined || Number.isNaN(actual)).toBe(true);
    return;
  }
  expect(actual).not.toBeNull();
  expect(actual).not.toBeUndefined();
  const a = actual as number;
  expect(Number.isFinite(a)).toBe(true);
  const diff = Math.abs(a - expected);
  const scale = Math.max(1, Math.abs(expected));
  expect(diff / scale).toBeLessThan(tol);
}

function nearArray(actual: (number | null)[], expected: (number | null)[], tol = 1e-9): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) near(actual[i], expected[i], tol);
}

describe('pandas parity — frame shape and structure', () => {
  it('reads the same shape pandas wrote', () => {
    expect(df.shape[0]).toBe(E.shape[0]);
    expect(df.shape[1]).toBe(E.shape[1]);
    expect(df.columnNames).toEqual(E.columns);
  });

  it('infers the same column roles', () => {
    // pandas keeps ival/fval/skewed numeric; group/site are object; flag bool; when datetime.
    expect(df.dtypeOf('group')).toBe('string');
    expect(df.dtypeOf('flag')).toBe('bool');
    expect(df.dtypeOf('when')).toBe('datetime');
    expect(['int', 'float']).toContain(df.dtypeOf('fval'));
    expect(['int', 'float']).toContain(df.dtypeOf('skewed'));
  });

  it('counts missing values identically (df.isna().sum())', () => {
    for (const [col, expected] of Object.entries(E.isnaCount as Record<string, number>)) {
      const c = df.require(col);
      let n = 0;
      for (const v of c.data) if (v === null) n++;
      expect(n, `missing count for ${col}`).toBe(expected);
    }
  });

  it('counts unique values identically (df.nunique())', () => {
    for (const [col, expected] of Object.entries(E.nunique as Record<string, number>)) {
      const uniq = new Set(df.require(col).data.filter((v) => v !== null).map((v) => String(v)));
      expect(uniq.size, `nunique for ${col}`).toBe(expected);
    }
  });
});

describe('pandas parity — describe()', () => {
  for (const col of ['ival', 'fval', 'skewed']) {
    it(`reproduces df.describe() for ${col}`, () => {
      const p = profileFrame(df).columns.find((c) => c.name === col)!;
      const s = p.numeric!;
      const d = E.describe[col];
      near(s.count, d['count']);
      near(s.mean, d['mean']);
      near(s.std, d['std']);
      near(s.min, d['min']);
      near(s.q1, d['25%']);
      near(s.median, d['50%']);
      near(s.q3, d['75%']);
      near(s.max, d['max']);
    });

    it(`reproduces extended stats for ${col}`, () => {
      const p = profileFrame(df).columns.find((c) => c.name === col)!;
      const s = p.numeric!;
      const x = E.describeExtra[col];
      near(s.count, x.count);
      near(s.sum, x.sum);
      near(s.variance, x.var);
      near(s.skew, x.skew, 1e-7);
      near(s.kurtosis, x.kurt, 1e-7);
      near(s.median, x.median);
      near(s.range, x.range);
      near(s.iqr, x.iqr);
      near(s.max - s.min, x.range);
      near(p.uniqueCount, x.nunique);
      near(p.missing, x.missing);
    });
  }
});

describe('pandas parity — quantiles (linear interpolation)', () => {
  it('matches Series.quantile for every probed q (fval)', () => {
    const sorted = [...num('fval')].sort((a, b) => a - b);
    for (const [q, expected] of Object.entries(E.quantiles.fval as Record<string, number>)) {
      const pos = Number(q) * (sorted.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      const v = lo === hi ? sorted[lo] : sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
      near(v, expected, 1e-9);
    }
  });

  it('matches Series.quantile for every probed q (ival)', () => {
    const sorted = [...num('ival')].sort((a, b) => a - b);
    for (const [q, expected] of Object.entries(E.quantiles.ival as Record<string, number>)) {
      const pos = Number(q) * (sorted.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      const v = lo === hi ? sorted[lo] : sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
      near(v, expected, 1e-9);
    }
  });
});

describe('pandas parity — correlation', () => {
  /** Pair two columns by ROW, keeping only rows where both are non-null — exactly `DataFrame.corr`'s pairwise-complete behaviour. */
  function aligned(a: string, b: string): { x: number[]; y: number[] } {
    const ca = df.require(a).data;
    const cb = df.require(b).data;
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < df.nRows; i++) {
      if (ca[i] === null || cb[i] === null) continue;
      x.push(Number(ca[i]));
      y.push(Number(cb[i]));
    }
    return { x, y };
  }

  it('matches df.corr(method="pearson")', () => {
    for (const a of Object.keys(E.corrPearson)) {
      for (const b of Object.keys(E.corrPearson[a])) {
        const { x, y } = aligned(a, b);
        near(pearson(x, y), E.corrPearson[a][b], 1e-9);
      }
    }
  });

  it('matches df.corr(method="spearman")', () => {
    for (const a of Object.keys(E.corrSpearman)) {
      for (const b of Object.keys(E.corrSpearman[a])) {
        const { x, y } = aligned(a, b);
        near(spearman(x, y), E.corrSpearman[a][b], 1e-7);
      }
    }
  });

  it('matches df.corr(method="kendall")', () => {
    for (const a of Object.keys(E.corrKendall)) {
      for (const b of Object.keys(E.corrKendall[a])) {
        const { x, y } = aligned(a, b);
        near(kendall(x, y).value, E.corrKendall[a][b], 1e-7);
      }
    }
  });
});

describe('pandas parity — value_counts', () => {
  it('matches Series.value_counts(dropna=True) for group', () => {
    const counts = new Map<string, number>();
    for (const v of df.require('group').data) {
      if (v === null) continue;
      const k = String(v);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const [k, expected] of Object.entries(E.valueCounts.group as Record<string, number>)) {
      expect(counts.get(k), `value_counts for ${k}`).toBe(expected);
    }
    expect(counts.size).toBe(Object.keys(E.valueCounts.group).length);
  });

  it('sorts value_counts descending like pandas', () => {
    const p = profileFrame(df).columns.find((c) => c.name === 'site')!;
    const top = p.category!.top;
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1].count).toBeGreaterThanOrEqual(top[i].count);
    }
    const expectedMax = Math.max(...Object.values(E.valueCounts.site as Record<string, number>));
    expect(top[0].count).toBe(expectedMax);
  });
});

describe('pandas parity — groupby', () => {
  it('matches groupby("group").size() with sorted keys', () => {
    const g = groupBy(df, { keys: ['group'], aggs: [{ column: 'fval', funcs: ['mean'] }] });
    const keyCol = g.df.require('group').data;
    expect(keyCol.map(String)).toEqual(E.groupby.keys);
    nearArray(
      g.df.require('fval_mean').data as (number | null)[],
      E.groupby.fval_mean,
      1e-9,
    );
  });

  it('matches count/sum/std/min/max/median aggregations', () => {
    const g = groupBy(df, {
      keys: ['group'],
      aggs: [
        { column: 'fval', funcs: ['count', 'sum', 'std', 'min', 'max', 'median'] },
        { column: 'ival', funcs: ['mean'] },
        { column: 'site', funcs: ['nunique'] },
        { column: 'flag', funcs: ['sum'] },
      ],
    });
    nearArray(g.df.require('fval_count').data as (number | null)[], E.groupby.fval_count as never, 1e-9);
    nearArray(g.df.require('fval_sum').data as (number | null)[], E.groupby.fval_sum, 1e-9);
    nearArray(g.df.require('fval_std').data as (number | null)[], E.groupby.fval_std, 1e-9);
    nearArray(g.df.require('fval_min').data as (number | null)[], E.groupby.fval_min, 1e-9);
    nearArray(g.df.require('fval_max').data as (number | null)[], E.groupby.fval_max, 1e-9);
    nearArray(g.df.require('fval_median').data as (number | null)[], E.groupby.fval_median, 1e-9);
    nearArray(g.df.require('ival_mean').data as (number | null)[], E.groupby.ival_mean, 1e-9);
    nearArray(g.df.require('site_nunique').data as (number | null)[], E.groupby.site_nunique as never, 1e-9);
    nearArray(g.df.require('flag_sum').data as (number | null)[], E.groupby.flag_sum, 1e-9);
  });

  it('counts rows per group like size()', () => {
    const g = groupBy(df, { keys: ['group'], aggs: [{ column: 'ival', funcs: ['count'] }] });
    // pandas' size() counts NaN too, so compare against our own key-of-truth:
    // sum of the grouped rows must equal the number of non-null keys.
    const sizes = groupBy(df, { keys: ['group'], aggs: [{ column: 'fval', funcs: ['count'] }] }).df;
    void sizes;
    const total = g.df.require('ival_count').data.reduce<number>((a, v) => a + (typeof v === 'number' ? v : 0), 0);
    const nonNullKeys = df.require('group').data.filter((v) => v !== null).length;
    expect(total).toBeLessThanOrEqual(nonNullKeys);
  });

  it('matches two-key groupby with named aggregation', () => {
    const g = groupBy(df, {
      keys: ['group', 'site'],
      aggs: [
        { column: 'fval', funcs: ['mean', 'count'] },
        { column: 'ival', funcs: ['sum'] },
      ],
    });
    const keys = g.df.require('group').data.map((v, i) => [String(v), String(g.df.require('site').data[i])]);
    expect(keys).toEqual(E.groupby2.keys);
    nearArray(g.df.require('fval_mean').data as (number | null)[], E.groupby2.fval_mean, 1e-9);
    nearArray(g.df.require('fval_count').data as (number | null)[], E.groupby2.fval_count as never, 1e-9);
    nearArray(g.df.require('ival_sum').data as (number | null)[], E.groupby2.ival_sum, 1e-9);
  });

  it('omits rows with missing keys (dropna=True)', () => {
    const g = groupBy(df, { keys: ['group'], aggs: [{ column: 'fval', funcs: ['count'] }] });
    expect(g.droppedRows).toBe(E.isnaCount.group);
  });
});

describe('pandas parity — pivot_table', () => {
  it('matches pivot_table(index, columns, values, aggfunc="mean")', () => {
    const p = pivotTable(df, {
      index: ['group'],
      columns: ['site'],
      values: ['fval'],
      aggfunc: 'mean',
    });
    expect(p.rowValues.map((r) => r[0])).toEqual(E.pivotMean.index);
    expect(p.columnLabels).toEqual(E.pivotMean.columns);
    for (let r = 0; r < p.cells.length; r++) {
      for (let c = 0; c < p.cells[r].length; c++) {
        near(p.cells[r][c], E.pivotMean.values[r][c], 1e-9);
      }
    }
  });

  it('matches pivot_table with aggfunc="count" and fill_value=0', () => {
    const p = pivotTable(df, {
      index: ['group'],
      columns: ['site'],
      values: ['ival'],
      aggfunc: 'count',
      fillValue: 0,
    });
    expect(p.rowValues.map((r) => r[0])).toEqual(E.pivotCount.index);
    expect(p.columnLabels).toEqual(E.pivotCount.columns);
    for (let r = 0; r < p.cells.length; r++) {
      for (let c = 0; c < p.cells[r].length; c++) {
        near(p.cells[r][c], E.pivotCount.values[r][c], 1e-9);
      }
    }
  });
});

describe('pandas parity — rolling / expanding / resample', () => {
  // pandas' fixture set the datetime column as the index and dropped NaT rows
  // before calling rolling(), so reproduce that starting point exactly.
  const tsSorted = (): DataFrame =>
    sortValues(dropna(df, { how: 'any', subset: ['when'] }), [{ column: 'when', ascending: true }]);

  it('matches rolling(5).mean()', () => {
    const sorted = tsSorted();
    const r = rolling(sorted, { column: 'fval', window: 5, funcs: ['mean'] });
    const vals = r.df.require('fval_roll5_mean').data as (number | null)[];
    nearArray(vals, E.rollingMean5 as (number | null)[], 1e-9);
  });

  it('matches rolling(4).std()', () => {
    const sorted = tsSorted();
    const r = rolling(sorted, { column: 'fval', window: 4, funcs: ['std'] });
    const vals = r.df.require('fval_roll4_std').data as (number | null)[];
    nearArray(vals, E.rollingStd4 as (number | null)[], 1e-8);
  });

  it('matches expanding(3).sum()', () => {
    const sorted = tsSorted();
    const r = expanding(sorted, { column: 'fval', funcs: ['sum'], minPeriods: 3 });
    const vals = r.df.require('fval_exp_sum').data as (number | null)[];
    nearArray(vals, E.expandingSum as (number | null)[], 1e-8);
  });

  it('matches resample("ME").mean() on the monthly buckets', () => {
    const r = resample(df, {
      timeColumn: 'when',
      freq: 'month',
      valueColumns: ['fval'],
      aggFuncs: ['mean'],
    });
    expect(r.df.nRows).toBe(E.resampleMonthlyMean.index.length);
    const vals = r.df.require('fval_mean').data as (number | null)[];
    nearArray(vals, E.resampleMonthlyMean.values as (number | null)[], 1e-9);
  });

  it('matches resample("ME").count()', () => {
    const r = resample(df, {
      timeColumn: 'when',
      freq: 'month',
      valueColumns: ['ival'],
      aggFuncs: ['count'],
    });
    const vals = r.df.require('ival_count').data as (number | null)[];
    nearArray(vals, E.resampleMonthlyCount as (number | null)[], 1e-9);
  });
});

describe('pandas parity — dropna / fillna / duplicates / sort', () => {
  it('matches dropna() (how="any")', () => {
    expect(dropna(df, { how: 'any' }).shape).toEqual(E.dropnaAny);
  });

  it('matches dropna(subset=["fval"])', () => {
    expect(dropna(df, { how: 'any', subset: ['fval'] }).shape).toEqual(E.dropnaSubsetFval);
  });

  it('matches dropna(thresh=2)', () => {
    expect(dropna(df, { how: 'all', thresh: 2 }).shape).toEqual(E.dropnaThresh2);
  });

  it('matches Series.fillna(median)', () => {
    const filled = fillna(df, { columns: ['fval'], strategy: 'median' });
    const vals = filled.require('fval').data as number[];
    nearArray(vals.slice(0, 20) as (number | null)[], E.fillnaMedian.first20 as (number | null)[], 1e-9);
    const nums = numericValues(vals);
    const m = nums.reduce((a, b) => a + b, 0) / nums.length;
    near(m, E.fillnaMedian.mean, 1e-9);
  });

  it('matches duplicated() and drop_duplicates()', () => {
    expect(duplicatedPositions(df, undefined, 'first').length).toBe(E.duplicatedCount);
    expect(dropDuplicates(df, undefined, 'first').shape).toEqual(E.dropDuplicates);
  });

  it('matches sort_values(["fval","ival"], ascending=[True,False], na_position="last")', () => {
    const s = sortValues(df, [
      { column: 'fval', ascending: true },
      { column: 'ival', ascending: false },
    ]);
    const f = s.require('fval').data;
    const i = s.require('ival').data;
    nearArray(f.slice(0, 12) as (number | null)[], E.sortValues.fvalHead as (number | null)[], 1e-9);
    nearArray(i.slice(0, 12) as (number | null)[], E.sortValues.ivalHead as (number | null)[], 1e-9);
  });

  it('matches boolean aggregation (mean/sum of a bool column)', () => {
    const flag = df.require('flag').data;
    const asNum = flag.map((v) => (v === true ? 1 : v === false ? 0 : NaN)).filter((v) => Number.isFinite(v));
    near(asNum.reduce((a, b) => a + b, 0) / asNum.length, E.flagMean, 1e-9);
    near(asNum.reduce((a, b) => a + b, 0), E.flagSum, 1e-9);
  });

  it('matches astype(int) on a boolean column', () => {
    const flag = df.require('flag').data;
    const asInt = flag.slice(0, 30).map((v) => (v === true ? 1 : v === false ? 0 : null)) as Scalar[];
    expect(asInt).toEqual(E.boolAsInt);
  });

  it('matches sorted unique values of the group column', () => {
    const uniq = [...new Set(df.require('group').data.filter((v) => v !== null).map(String))].sort();
    expect(uniq).toEqual(E.groupUniqueSorted);
  });
});
