# DataLens · A Visual pandas

> The complete pandas analysis workflow, done visually: load → clean → describe → group → pivot → correlate → forecast → model → report.
> Pure front-end, no backend. Your data is processed entirely in the browser.

**Live site (Vercel)**: https://datalens-steel-iota.vercel.app
**Live site (GitHub Pages, same build)**: https://wangling1206.github.io/datalens/
**Repository**: https://github.com/WangLing1206/datalens
**Chinese documentation**: [README.md](./README.md)

---

## 1. What this is

DataLens turns every core pandas operation into a visual interaction, and makes **the analysis process itself a first-class citizen**: each action is recorded in the pipeline rail, mirrored as equivalent pandas code, and can be replayed, undone or reverted at any time.

It is not a dashboard. It is an **analysis workbench**.

### Three headline features

| Feature | What it does |
|---|---|
| **Analysis pipeline** | Every action becomes a card: bilingual name, parameter summary, and **row/column delta badges** (`891 → 182, −709`). Supports undo/redo, **time travel** (click any historical step to see the data as it was), forking from a step, and exporting the whole chain as a `.daproj.json` project file — **import it back to restore the pipeline exactly** (the file records operations, never data). |
| **Live pandas code mirror** | The equivalent pandas script grows alongside the pipeline: `df.dropna(subset=["Age"])`, `df.groupby("Pclass")["Survived"].mean()`. Makes the "one click = one line of pandas" relationship concrete. |
| **Automatic insight engine** | On load, the frame is scanned and findings are surfaced by category (data quality / distribution / relationships / group differences / time patterns / suggested actions). Each card has an **Analyze →** link that jumps to the right view with parameters pre-filled. |

---

## 2. Getting started

```bash
npm install
npm run dev          # dev server on http://localhost:5173
npm run build        # production build → dist/
npm run preview      # preview the build on http://localhost:4173
npm test             # 126 unit + parity tests
npm run e2e          # 14 end-to-end tests in a real browser
```

### Deployment

`vercel.json` is already configured (SPA rewrite + asset cache headers):

```bash
npx vercel --prod --name datalens
```

Any static host works too (Netlify / Cloudflare Pages / GitHub Pages / nginx) — serve `dist/` as the root and rewrite unknown paths to `index.html`.

---

## 3. Feature tour

Eleven pages covering the full pandas workflow:

| Page | pandas equivalent | Capabilities |
|---|---|---|
| **Overview** | `df.info()` `df.shape` | KPI tiles, data-health score with penalty breakdown, per-column profile (type / missing bar / mini-distribution / tags), automatic insights, first-look charts, data preview |
| **Data table** | `head/loc/iloc` | Virtualised large table, multi-column sort, global search, Excel-style filter builder (15 operators, effect previewed before applying), column menu (sort / rename / cast / drop / hide / stats), cell inspector, outlier highlighting |
| **Clean** | `isna/dropna/fillna/drop_duplicates/astype` | Missingness heatmap, per-column missing stats, drop missing (any/all/thresh/subset), 8 fill strategies, duplicate grouping and removal, **IQR and Z-score outlier detection** (drop / clip / replace with median), type casting with failure reporting and smart suggestions |
| **Describe** | `describe/skew/kurt/quantile` | 20-metric statistics table, histogram with density overlay, box plot, empirical CDF, multi-column distribution comparison (box / violin / ridgeline / overlaid histograms), statistics by group, **plain-language statistical interpretation** |
| **Group by** | `groupby().agg()` | Multi-key grouping, column × function matrix (12 aggregations), quick-aggregation templates, result table, 8 chart types, sorting and Top-N, **automatic dual-axis when magnitudes differ wildly** |
| **Pivot table** | `pivot_table()` | Rows / columns / values / aggregation, fill value, margins, heatmap with colour scale, treemap, stacked bar, colour-scaled data table, CSV export |
| **Correlation** | `corr(method=)` | Pearson / Spearman / Kendall, correlation matrix heatmap (diverging scale), click any cell for a scatter plot with OLS fit line and R² / slope / p-value, strongest-pairs ranking, **automatic bubble mode for discrete variables (dot size = row count)**, correlation-is-not-causation warning |
| **Time series** | `resample/rolling/expanding/diff/shift` | Date column auto-detection, 6 granularities, 7 window functions, expanding windows, 7 derived series (diff / pct change / lag / cumsum / cummax / cummin / log), seasonal profiles (month / weekday / hour / week / quarter), trend decomposition, ACF, **forecasting with MAE / RMSE / MAPE hold-out validation** |
| **Chart studio** | — | 16 chart types, free encoding shelf (X / Y / colour / size / aggregate / sort / Top-N / log axes / stacking / smoothing), 5 templates, PNG export, **add to report** |
| **Advanced** | — | Multiple linear regression (coefficients / std errors / t / p / VIF / standardised coefficients / residual plots / predicted vs actual), K-means (elbow + silhouette + cluster profiles), PCA (scree + loadings + 2-D projection), anomaly detection (IQR / Z-score / LOF), forecasting |
| **Report** | — | 10 optional sections, live WYSIWYG preview (light/dark), **single-file HTML export** with charts and tables inlined, Markdown export, CSV/Excel export, project JSON export |

### Bundled sample datasets

| Dataset | Size | Why it is here |
|---|---|---|
| Titanic (default) | 891 × 15 | Real data with missing values and mixed types — the classic cleaning and grouping exercise |
| E-commerce orders | 5,000 × 17 | Dated order lines across regions, categories and channels — time series and pivots |
| Iris | 150 × 5 | Clean data for correlation and clustering |
| Air quality | 1,461 × 11 | Heavy missingness and bad readings — built to demonstrate cleaning |
| Global development | 1,704 × 6 | GDP per capita and life expectancy by country over time |
| Large orders | 100,000 × 11 | To show performance on a large frame |

Beyond the bundled data, you can **drag and drop** files (CSV / TSV / TXT / JSON / JSONL / Excel) or **paste text**. Delimiter and encoding are detected automatically (UTF-8 / GBK / GB18030 / Big5 / Windows-1252).

---

## 4. Bilingual by construction

The two languages are not maintained by hand — **the type system keeps them in step**:

- `src/i18n/zh.ts` is the single source of truth; `en.ts` is typed as `DeepString<typeof zh>`. **A missing translation fails the build.**
- The language lives in the URL (`?lang=en`) and localStorage, so a language-specific link is shareable.
- The active view lives in the URL hash (`#/groupby`), so a link opens straight into a page and the browser's back/forward buttons move between views.
- Numbers, dates and percentages are formatted with `Intl` for the active locale.
- Chart axes, legends, tooltips, insight text and the exported report are all localised.
- Switch from the top bar, or with the `L` shortcut.

---

## 5. Architecture

```
src/
├── core/                     ← framework-free pandas engine (independently testable)
│   ├── DataFrame.ts          immutable column-oriented frame (tracks original row ids)
│   ├── dtype.ts              type inference and casting
│   ├── stats.ts              statistics primitives (+ histogram, KDE, ECDF, box stats, LTTB downsampling)
│   ├── io.ts                 RFC 4180 parser + JSON/Excel readers + encoding sniffing
│   ├── ops.ts                cleaning and transforms (+ filter AST, safe expression evaluator)
│   ├── groupby.ts            groupby().agg() with 12 aggregations
│   ├── pivot.ts              pivot_table() with margins and a column cap
│   ├── timeseries.ts         resample / rolling / expanding / seasonality / decomposition / ACF
│   ├── advanced.ts           OLS, K-means, PCA, anomaly detection, forecasting
│   ├── profile.ts            per-column profiling and the health score
│   └── insights.ts           automatic insight generation
├── pipeline/
│   ├── operations.ts         operation registry: apply + describe + codegen in one place
│   └── store.ts              pipeline state (undo/redo/time travel/project import-export)
├── components/
│   ├── ui/                   design-system primitives
│   ├── charts/               ECharts wrapper + 18 chart option factories
│   └── layout/               shell, sidebar, top bar, **pipeline rail**, load panel, command palette
├── views/                    the eleven analysis pages
└── i18n/                     locale dictionaries and runtime
```

### Key design decisions

- **Immutable DataFrame.** Every operation returns a new frame; nothing mutates in place. That makes undo/redo/time-travel trivial — keep the list of operations and re-derive any intermediate state on demand.
- **Operation registry.** Each operation's *computation*, *description* and *generated pandas code* live in one object, so the pipeline cards and the code mirror can never drift apart.
- **Fingerprint-keyed caching.** Profiling a 100k-row frame is the most expensive thing the UI does; results are memoised by frame fingerprint so switching pages never recomputes.
- **Performance.** Table virtualisation, LTTB downsampling for scatter/line charts, pivot column caps, sampled Kendall coefficients, and chart point limits.

---

## 6. How pandas fidelity is verified

Not "looks like pandas" — **benchmarked against real pandas**.

`tools/gen_pandas_fixtures.py` runs real pandas (2.2.3) over a deterministic dataset and writes every statistic to `tests/fixtures/pandas_expected.json`. `tests/pandas-parity.test.ts` runs the TypeScript engine over the same input and compares field by field:

```
✓ df.describe() — count/mean/std/min/25%/50%/75%/max
✓ extended stats — sum/var/skew/kurt/median/range/IQR
✓ linear quantile interpolation at 10 probabilities
✓ Pearson / Spearman / Kendall correlation matrices
✓ value_counts / nunique / isna().sum()
✓ groupby().agg() — count/sum/std/min/max/median/nunique
✓ two-key grouping with named aggregation
✓ pivot_table() — mean / count with fill_value
✓ rolling(5).mean() / rolling(4).std() / expanding(3).sum()
✓ resample("ME").mean() / resample("ME").count()
✓ dropna in all four forms (any / all / thresh / subset)
✓ fillna(median) / duplicated() / drop_duplicates()
✓ sort_values with multiple keys and na_position
✓ boolean mean/sum/astype(int)
```

**126 tests in total** (38 pandas-parity + 78 engine unit tests + 10 regression tests), all passing — plus 14 Playwright end-to-end tests that drive the real app in a browser.

> Semantics follow pandas exactly: sample standard deviation (ddof=1), linear quantile interpolation, adjusted Fisher-Pearson skew, sample-corrected excess kurtosis, `count` over non-null values only, and `sum` returning 0 for an all-null group.

---

## 7. Tests and tooling

```bash
npm test                              # 126 unit, parity and regression tests
npm run typecheck                     # strict TypeScript across the project
npm run e2e                           # 14 Playwright end-to-end tests (builds and previews for you)
node tools/repro.mjs                  # exercises the key controls on all 11 pages, reports anything that throws
node tools/interaction.mjs            # URL routing, undo/redo and project import/export
node tools/i18n-audit.mjs             # bilingual audit: fails if either language leaks into the other's UI
node tools/screenshot.mjs             # per-page screenshots + console error check (needs preview running)
python tools/gen_pandas_fixtures.py   # regenerate the pandas ground truth
python tools/build_datasets.py        # regenerate the sample datasets
```

---

## 8. Browser support

A modern browser (Chrome / Edge / Firefox / Safari from the last two years). Newer features used: `Intl.NumberFormat` compact notation, `ResizeObserver`, `TextDecoder` (GBK decoding), CSS `color-mix()`.

---

## 9. Licence

A coursework project, shared for learning. The Titanic, Iris and Gapminder samples come from public datasets.
