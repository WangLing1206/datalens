# DataLens · 可视化 pandas

> 用可视化方式完成 pandas 的全流程数据分析：加载 → 清洗 → 描述统计 → 分组聚合 → 透视 → 相关分析 → 时间序列 → 建模 → 报告。
> 纯前端、零后端，数据只在浏览器本地处理。

**在线地址**：https://datalens-steel-iota.vercel.app
**英文文档**：[README.en.md](./README.en.md)

---

## 1. 这是什么

DataLens 把 pandas 的每一个核心操作都做成了可视化交互，并且**把"分析过程"本身变成了一等公民**：你做的每一步都会记录进右侧的分析流水线，同步生成等价的 pandas 代码，可以随时回看、撤销、复现。

它不是一个"数据看板"，而是一个**分析工作台**。

### 三个核心亮点

| 亮点 | 说明 |
|---|---|
| **分析流水线（Pipeline）** | 每一步操作都成为一张卡片：双语名称、参数摘要、**行数/列数变化徽章**（`891 → 182，−709`）。支持撤销/重做、**时间旅行**（点击任意历史步骤回看当时的数据）、从某一步分叉重来；整条链路可导出为 `.daproj.json` 工程文件，**导入后原样恢复**（文件里只有操作与参数，数据不出本地）。 |
| **实时 pandas 代码镜像** | 流水线旁同步生成等价 pandas 代码，随操作实时增长：`df.dropna(subset=["Age"])`、`df.groupby("Pclass")["Survived"].mean()`。让"一次点击 = 一行 pandas"的关系一目了然。 |
| **自动洞察引擎** | 加载数据后自动扫描，产出分类洞察（数据质量 / 分布形态 / 变量关系 / 分组差异 / 时间规律 / 行动建议）。每条洞察带「去分析 →」，点击**直接跳转到对应视图并预填参数**。 |

---

## 2. 快速开始

```bash
npm install
npm run dev          # 开发模式 http://localhost:5173
npm run build        # 生产构建 → dist/
npm run preview      # 预览构建结果 http://localhost:4173
npm test             # 单元测试（126 个）
npm run e2e          # 端到端测试（14 个，真实浏览器）
```

### 部署

项目已配置好 `vercel.json`（SPA 重写 + 静态资源缓存头）：

```bash
npx vercel --prod --name datalens
```

也可以直接部署到任意静态托管（Netlify / Cloudflare Pages / GitHub Pages / Nginx），把 `dist/` 目录作为根目录即可。注意 SPA 需要把未知路径重写到 `index.html`。

---

## 3. 功能总览

11 个分析页面，覆盖 pandas 的完整工作流：

| 页面 | 对应 pandas | 能力 |
|---|---|---|
| **总览** | `df.info()` `df.shape` | KPI 磁贴、数据健康分（含扣分原因）、逐列画像（类型/缺失条/迷你分布/特征标签）、自动洞察、初览图表、数据预览 |
| **数据表** | `head/loc/iloc` | 虚拟滚动大表、多列排序、全表搜索、Excel 式条件筛选器（15 种运算符，先预览影响再应用）、列菜单（排序/改名/转换类型/删除/隐藏/统计）、单元格详情、离群值高亮 |
| **数据清洗** | `isna/dropna/fillna/drop_duplicates/astype` | 缺失分布热力图、按列缺失统计、删除缺失（any/all/thresh/subset）、8 种填充策略（均值/中位数/众数/固定值/前向/后向/零/线性插值）、重复行分组查看与去重、**IQR 与 Z-Score 异常值检测**（可删除/截断/替换中位数）、类型转换（含失败值报告与智能建议） |
| **描述统计** | `describe/skew/kurt/quantile` | 20 项统计指标表（count/missing/mean/std/var/min/Q1/median/Q3/max/IQR/range/CV/skew/kurt/sum/unique/zeros/negatives/outliers）、直方图 + 密度曲线、箱线图、经验分布函数、多列分布对比（箱线/小提琴/山脊/直方图叠加）、分组统计表、**统计解读**（自动用自然语言解释均值中位数关系、偏度、峰度） |
| **分组聚合** | `groupby().agg()` | 多键分组、列 × 函数矩阵（12 种聚合）、快捷聚合模板、结果表、8 种图表（柱/线/堆叠/百分比堆叠/分组柱/饼/环形/热力图）、排序与 Top-N、**量纲差异过大时自动启用双 Y 轴** |
| **透视表** | `pivot_table()` | 行/列/值/聚合方式配置、填充空值、行列总计、热力图（含色阶）、矩形树图、堆叠柱、数据表（带色阶）、一键导出 CSV |
| **相关分析** | `corr(method=)` | Pearson / Spearman / Kendall 三种系数、相关矩阵热力图（发散配色）、点击任意方格查看该变量对的散点图 + OLS 回归线 + R²/斜率/p 值、强相关变量对排行、**离散变量自动切换为气泡图（点大小 = 记录数）**、相关≠因果提示 |
| **时间序列** | `resample/rolling/expanding/diff/shift` | 自动识别日期列、6 种时间粒度重采样、7 种窗口函数、累计窗口、7 种派生指标（差分/环比/滞后/累计和/累计最值/对数）、季节性轮廓（月/周/星期/小时/季度）、趋势分解（趋势+季节+残差）、自相关 ACF、**趋势预测（含 MAE/RMSE/MAPE 留出验证）** |
| **图表工作室** | — | 16 种图表类型、自由编码架（X/Y/颜色/大小/聚合/排序/Top-N/对数轴/堆叠/平滑）、5 个快捷模板、导出 PNG、**一键加入报告** |
| **高级分析** | — | 多元线性回归（系数/标准误/t 值/p 值/VIF/标准化系数/残差图/预测 vs 实际）、K-Means 聚类（肘部图 + 轮廓系数 + 簇画像）、主成分分析（碎石图 + 载荷矩阵 + 二维投影）、异常检测（IQR/Z-Score/局部密度 LOF）、趋势预测 |
| **分析报告** | — | 10 个可选章节、实时 WYSIWYG 预览（浅色/深色主题）、**导出单文件 HTML 报告**（图表与表格全部内联，可直接分享）、导出 Markdown、导出 CSV/Excel、导出分析工程 JSON |

### 内置示例数据

| 数据集 | 规模 | 特点 |
|---|---|---|
| 泰坦尼克号（默认） | 891 × 15 | 真实数据，含缺失值与混合类型，经典清洗与分组素材 |
| 电商销售订单 | 5000 × 17 | 含日期、地区、品类、渠道、金额，适合时序与透视 |
| 鸢尾花 | 150 × 5 | 干净数据，适合相关性与聚类 |
| 空气质量监测 | 1461 × 11 | 大量缺失与异常读数，专为演示清洗而设计 |
| 全球发展指标 | 1704 × 6 | 各国历年人均 GDP 与预期寿命 |
| 大规模订单 | 100000 × 11 | 用于展示大数据量下的性能表现 |

除内置数据外，还支持**拖拽上传**（CSV / TSV / TXT / JSON / JSONL / Excel）与**直接粘贴文本**。上传时自动检测分隔符与编码（UTF-8 / GBK / GB18030 / Big5 / Windows-1252）。

---

## 4. 中英双语

双语不是"翻译一遍"，而是**由类型系统保证一致**：

- `src/i18n/zh.ts` 是唯一的事实来源，`en.ts` 的类型由它推导（`DeepString<typeof zh>`）。**漏翻任何一个键都无法通过编译。**
- 语言写入 URL（`?lang=en`）+ localStorage，可分享指定语言的链接。
- 当前视图写入 URL 哈希（`#/groupby`）：链接可直达指定页面，浏览器前进/后退在页面之间切换。
- 数字、日期、百分比全部走 `Intl` 按当前语言格式化。
- 图表轴标签、图例、提示框、洞察文案、报告内容全部双语。
- 右侧导航有语言切换按钮，快捷键 `L` 也可以切换。

---

## 5. 工程架构

```
src/
├── core/                     ← 与框架无关的 pandas 引擎（可独立单测）
│   ├── DataFrame.ts          列式存储的不可变数据框（含原始行号索引）
│   ├── dtype.ts              类型推断与转换（int/float/bool/datetime/category/string）
│   ├── stats.ts              统计原语（分位数/偏度/峰度/相关系数/直方图/KDE/ECDF/箱线/LTTB 降采样）
│   ├── io.ts                 RFC 4180 解析器 + JSON/Excel 读取 + 编码嗅探
│   ├── ops.ts                清洗与变换（dropna/fillna/去重/排序/分箱/标准化/独热/长宽转换/筛选 AST/表达式求值器）
│   ├── groupby.ts            groupby().agg()（12 种聚合）
│   ├── pivot.ts              pivot_table()（含总计与列数上限）
│   ├── timeseries.ts         resample/rolling/expanding/差分/季节性/分解/ACF
│   ├── advanced.ts           OLS 回归、K-Means、PCA、异常检测、预测（含 t 分布 p 值）
│   ├── profile.ts            逐列画像与数据健康分
│   └── insights.ts           自动洞察生成
├── pipeline/
│   ├── operations.ts         操作注册表：每步的 apply / 参数描述 / pandas 代码，三者在同一处定义
│   └── store.ts              流水线状态（撤销/重做/时间旅行/工程导入导出）
├── components/
│   ├── ui/                   设计系统原语（按钮/卡片/弹层/表格/开关…）
│   ├── charts/               ECharts 封装 + 18 个图表 option 工厂
│   └── layout/               外壳、侧边栏、顶栏、**分析流水线栏**、加载面板、命令面板
├── views/                    11 个分析页面
└── i18n/                     双语字典与运行时
```

### 关键设计决策

- **不可变 DataFrame**：每个操作返回新帧，从不原地修改。这让撤销/重做/时间旅行变得平凡——只需保存操作列表，任意中间状态都能重新推导。
- **操作注册表**：每个操作的「如何计算」「如何描述」「生成什么 pandas 代码」定义在同一个对象里。这保证了流水线卡片与代码镜像永远不会不同步。
- **按帧指纹缓存**：10 万行数据的画像计算是最昂贵的操作，用帧指纹做记忆化，切换页面不会重复计算。
- **性能策略**：表格虚拟滚动、散点/折线 LTTB 降采样、透视表列数上限、Kendall 系数超限抽样、图表点位上限。

---

## 6. 与 pandas 的一致性如何保证

不是"看起来像"，而是**用真实 pandas 做基准测试**。

`tools/gen_pandas_fixtures.py` 用真实 pandas（2.2.3）计算一份确定性数据集的各项统计量，输出到 `tests/fixtures/pandas_expected.json`；`tests/pandas-parity.test.ts` 让 TypeScript 引擎在同样的输入上运行，逐项比对：

```
✓ df.describe() 的 count/mean/std/min/25%/50%/75%/max
✓ 扩展统计量 sum/var/skew/kurt/median/range/IQR
✓ 分位数线性插值（10 个概率点）
✓ Pearson / Spearman / Kendall 相关系数矩阵
✓ value_counts / nunique / isna().sum()
✓ groupby().agg() 的 count/sum/std/min/max/median/nunique
✓ 双键分组与命名聚合
✓ pivot_table() 的 mean / count + fill_value
✓ rolling(5).mean() / rolling(4).std() / expanding(3).sum()
✓ resample("ME").mean() / resample("ME").count()
✓ dropna 的 any / all / thresh / subset 四种形式
✓ fillna(median) / duplicated() / drop_duplicates()
✓ sort_values 多列升降序 + na_position
✓ 布尔列的 mean/sum/astype(int)
```

**测试总数 126 个**（38 个 pandas 一致性 + 78 个引擎单测 + 10 个回归测试）全部通过，另有 14 个 Playwright 端到端测试在真实浏览器里跑通全流程。

> 实现细节上严格对齐 pandas 语义：`std` 用样本标准差（ddof=1）、分位数用线性插值、偏度用调整后的 Fisher-Pearson 系数、峰度用带样本修正的超额峰度、`count` 只统计非空值、`sum` 对全空分组返回 0。

---

## 7. 测试

```bash
npm test                     # 126 个单元测试（引擎 + pandas 一致性 + 回归）
npm run typecheck            # TypeScript 严格模式全量检查
npm run e2e                  # 14 个端到端测试（Playwright，自动 build + preview）
node tools/repro.mjs         # 逐个操练 11 个页面的关键控件，报告任何异常
node tools/interaction.mjs   # URL 路由 / 撤销重做 / 工程导入导出
node tools/i18n-audit.mjs    # 双语一致性审计：逐页检查是否漏出另一种语言
node tools/screenshot.mjs    # 逐页截图 + 控制台错误检查（需先启动 preview）
python tools/gen_pandas_fixtures.py   # 重新生成 pandas 基准数据
python tools/build_datasets.py        # 重新生成示例数据集
```

---

## 8. 浏览器支持

需要现代浏览器（Chrome / Edge / Firefox / Safari 近两年版本）。用到的较新特性：`Intl.NumberFormat` 的 compact 记法、`ResizeObserver`、`TextDecoder`（GBK 解码）、CSS `color-mix()`。

---

## 9. 许可

课程作业项目，仅供学习交流使用。示例数据集中的泰坦尼克号、鸢尾花、全球发展指标来自公开数据集。
