"""
Generate ground-truth fixtures from *real* pandas.

The JS engine in src/core is meant to reproduce pandas semantics exactly, so the
only honest way to test it is to run pandas and compare. This script emits:

  tests/fixtures/pandas_sample.csv   - the deterministic input frame
  tests/fixtures/pandas_expected.json - statistics computed by pandas itself

Run with:  python tools/gen_pandas_fixtures.py
"""
from __future__ import annotations

import json
import math
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "tests", "fixtures")
os.makedirs(OUT, exist_ok=True)


def build_frame() -> pd.DataFrame:
    """A frame that exercises int/float/bool/datetime/object plus missing values."""
    rng = np.random.default_rng(20261009)
    n = 240

    group = rng.choice(["alpha", "beta", "gamma", "delta"], size=n, p=[0.4, 0.3, 0.2, 0.1])
    site = rng.choice(["north", "south", "east"], size=n)
    ival = rng.integers(1, 60, size=n).astype("int64")
    fval = np.round(rng.normal(50, 12, size=n), 4)
    skewed = np.round(rng.lognormal(0.4, 0.8, size=n), 4)
    flag = rng.random(n) > 0.45
    dates = pd.to_datetime("2024-01-01") + pd.to_timedelta(rng.integers(0, 400, size=n), unit="D")

    df = pd.DataFrame(
        {
            "group": group,
            "site": site,
            "ival": ival,
            "fval": fval,
            "skewed": skewed,
            "flag": flag,
            "when": dates,
        }
    )
    # Punch holes so skipna / dropna / fillna paths are exercised.
    df.loc[df.index[:37], "fval"] = np.nan
    df.loc[df.index[10:29], "ival"] = np.nan
    df.loc[df.index[5:51], "group"] = np.nan
    df.loc[df.index[100:108], "when"] = pd.NaT
    # A few duplicated rows.
    dup = df.iloc[[3, 7, 11]].copy()
    df = pd.concat([df, dup], ignore_index=True)
    return df


def jnum(x):
    """JSON-safe float: never emit NaN/Infinity (invalid JSON)."""
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, 10)


def main() -> None:
    df = build_frame()
    df.to_csv(os.path.join(OUT, "pandas_sample.csv"), index=False, date_format="%Y-%m-%d")

    exp: dict = {"pandasVersion": pd.__version__, "numpyVersion": np.__version__}

    # ---- shape / dtypes ------------------------------------------------
    exp["shape"] = list(df.shape)
    exp["columns"] = list(df.columns)

    # ---- describe() on numeric columns ---------------------------------
    desc = df.describe()
    exp["describe"] = {
        col: {k: jnum(v) for k, v in desc[col].items()} for col in desc.columns
    }
    # pandas quantiles are on the non-null subset
    exp["describeExtra"] = {
        col: {
            "count": int(df[col].count()),
            "sum": jnum(df[col].sum()),
            "var": jnum(df[col].var()),
            "skew": jnum(df[col].skew()),
            "kurt": jnum(df[col].kurt()),
            "median": jnum(df[col].median()),
            "range": jnum(df[col].max() - df[col].min()),
            "q10": jnum(df[col].quantile(0.10)),
            "q90": jnum(df[col].quantile(0.90)),
            "iqr": jnum(df[col].quantile(0.75) - df[col].quantile(0.25)),
            "nunique": int(df[col].nunique()),
            "missing": int(df[col].isna().sum()),
        }
        for col in ["ival", "fval", "skewed"]
    }

    # ---- quantiles at several interpolation points ---------------------
    exp["quantiles"] = {
        "fval": {str(q): jnum(df["fval"].quantile(q)) for q in [0.0, 0.01, 0.1, 0.25, 0.333, 0.5, 0.75, 0.9, 0.99, 1.0]},
        "ival": {str(q): jnum(df["ival"].quantile(q)) for q in [0.0, 0.05, 0.25, 0.5, 0.75, 0.95, 1.0]},
    }

    # ---- correlation matrices ------------------------------------------
    num = df[["ival", "fval", "skewed"]]
    exp["corrPearson"] = {a: {b: jnum(num[a].corr(num[b], method="pearson")) for b in num.columns} for a in num.columns}
    exp["corrSpearman"] = {a: {b: jnum(num[a].corr(num[b], method="spearman")) for b in num.columns} for a in num.columns}
    exp["corrKendall"] = {a: {b: jnum(num[a].corr(num[b], method="kendall")) for b in num.columns} for a in num.columns}

    # ---- value_counts ---------------------------------------------------
    exp["valueCounts"] = {
        "group": {str(k): int(v) for k, v in df["group"].value_counts(dropna=True).items()},
        "site": {str(k): int(v) for k, v in df["site"].value_counts(dropna=True).items()},
    }
    exp["nunique"] = {c: int(df[c].nunique()) for c in ["group", "site", "flag"]}
    exp["isnaCount"] = {c: int(df[c].isna().sum()) for c in df.columns}

    # ---- groupby --------------------------------------------------------
    gb = df.groupby("group", dropna=True)
    exp["groupby"] = {
        "keys": [str(k) for k in gb.size().index],
        "size": [int(v) for v in gb.size().values],
        "fval_mean": [jnum(v) for v in gb["fval"].mean().values],
        "fval_sum": [jnum(v) for v in gb["fval"].sum().values],
        "fval_count": [int(v) for v in gb["fval"].count().values],
        "fval_std": [jnum(v) for v in gb["fval"].std().values],
        "fval_min": [jnum(v) for v in gb["fval"].min().values],
        "fval_max": [jnum(v) for v in gb["fval"].max().values],
        "fval_median": [jnum(v) for v in gb["fval"].median().values],
        "ival_mean": [jnum(v) for v in gb["ival"].mean().values],
        "site_nunique": [int(v) for v in gb["site"].nunique().values],
        "flag_sum": [jnum(v) for v in gb["flag"].sum().values],
    }

    # Two-key grouping, multi-aggregation
    gb2 = df.groupby(["group", "site"], dropna=True).agg(
        fval_mean=("fval", "mean"), fval_count=("fval", "count"), ival_sum=("ival", "sum")
    )
    exp["groupby2"] = {
        "keys": [[str(a), str(b)] for a, b in gb2.index],
        "fval_mean": [jnum(v) for v in gb2["fval_mean"].values],
        "fval_count": [int(v) for v in gb2["fval_count"].values],
        "ival_sum": [jnum(v) for v in gb2["ival_sum"].values],
    }

    # ---- pivot_table ----------------------------------------------------
    pt = df.pivot_table(index="group", columns="site", values="fval", aggfunc="mean")
    exp["pivotMean"] = {
        "index": [str(i) for i in pt.index],
        "columns": [str(c) for c in pt.columns],
        "values": [[jnum(v) for v in row] for row in pt.to_numpy()],
    }
    ptc = df.pivot_table(index="group", columns="site", values="ival", aggfunc="count", fill_value=0)
    exp["pivotCount"] = {
        "index": [str(i) for i in ptc.index],
        "columns": [str(c) for c in ptc.columns],
        "values": [[jnum(v) for v in row] for row in ptc.to_numpy()],
    }

    # ---- rolling / resample --------------------------------------------
    # kind="stable" matters: pandas' default quicksort is unstable, and this
    # frame has many duplicate timestamps, so the tie order would otherwise be
    # arbitrary and impossible for a deterministic implementation to reproduce.
    ts = df.dropna(subset=["when"]).set_index("when")["fval"].sort_index(kind="stable")
    exp["rollingMean5"] = [jnum(v) for v in ts.rolling(5).mean().values]
    exp["rollingStd4"] = [jnum(v) for v in ts.rolling(4).std().values]
    exp["expandingSum"] = [jnum(v) for v in ts.expanding(3).sum().values]

    monthly = df.dropna(subset=["when"]).set_index("when")["fval"].resample("ME").mean()
    exp["resampleMonthlyMean"] = {
        "index": [d.strftime("%Y-%m") for d in monthly.index],
        "values": [jnum(v) for v in monthly.values],
    }
    monthly_count = df.dropna(subset=["when"]).set_index("when")["ival"].resample("ME").count()
    exp["resampleMonthlyCount"] = [int(v) for v in monthly_count.values]

    # ---- dropna / fillna / drop_duplicates ------------------------------
    exp["dropnaAny"] = list(df.dropna().shape)
    exp["dropnaSubsetFval"] = list(df.dropna(subset=["fval"]).shape)
    exp["dropnaThresh2"] = list(df.dropna(thresh=2).shape)
    filled = df["fval"].fillna(df["fval"].median())
    exp["fillnaMedian"] = {
        "first20": [jnum(v) for v in filled.values[:20]],
        "mean": jnum(filled.mean()),
        "std": jnum(filled.std()),
        "skew": jnum(filled.skew()),
    }
    exp["dropDuplicates"] = list(df.drop_duplicates().shape)
    exp["duplicatedCount"] = int(df.duplicated().sum())

    # ---- sort_values ----------------------------------------------------
    s = df.sort_values(["fval", "ival"], ascending=[True, False], na_position="last", kind="stable")
    exp["sortValues"] = {
        "fvalHead": [jnum(v) for v in s["fval"].values[:12]],
        "ivalHead": [jnum(v) for v in s["ival"].values[:12]],
    }

    # ---- string / boolean aggregation -----------------------------------
    exp["flagMean"] = jnum(df["flag"].mean())
    exp["flagSum"] = jnum(df["flag"].sum())
    # pandas: sum of a boolean column is the count of True (bool is still object-free)
    exp["boolAsInt"] = [int(v) for v in df["flag"].astype(int).values[:30]]

    # ---- unique of a categorical ----------------------------------------
    exp["groupUniqueSorted"] = sorted([str(v) for v in df["group"].dropna().unique()])

    with open(os.path.join(OUT, "pandas_expected.json"), "w", encoding="utf-8") as f:
        json.dump(exp, f, indent=1, ensure_ascii=False)

    print(f"pandas {pd.__version__} / numpy {np.__version__}")
    print("wrote", os.path.join(OUT, "pandas_sample.csv"))
    print("wrote", os.path.join(OUT, "pandas_expected.json"))
    print("shape", exp["shape"])


if __name__ == "__main__":
    main()
