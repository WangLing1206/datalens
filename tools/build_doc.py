"""
Build the bilingual highlights document (DOCX + Markdown).

Content lives here as structured data so the two output formats, and the two
languages, can never drift apart.

Run:  python tools/build_doc.py
Out:  deliverables/DataLens-亮点说明.docx
      deliverables/DataLens-highlights.md
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "deliverables")
SHOTS = os.path.join(ROOT, "shots")
os.makedirs(OUT, exist_ok=True)

LIVE_URL = "https://datalens-steel-iota.vercel.app"

ACCENT = RGBColor(0x4B, 0x41, 0xD6)
MUTED = RGBColor(0x6B, 0x72, 0x86)


# --------------------------------------------------------------------------- #
# Content
# --------------------------------------------------------------------------- #

@dataclass
class Section:
    zh_title: str
    en_title: str
    zh_paras: list[str] = field(default_factory=list)
    en_paras: list[str] = field(default_factory=list)
    table: tuple[list[str], list[list[str]]] | None = None
    image: str | None = None
    image_caption: tuple[str, str] | None = None


@dataclass
class Bullet:
    zh: str
    en: str


SECTIONS: list[Section | Bullet] = [
    Section(
        zh_title="一、项目概述",
        en_title="1. Overview",
        zh_paras=[
            "DataLens 是一个「可视化 pandas」数据分析工作台。它把 pandas 的核心操作——加载、清洗、描述统计、"
            "分组聚合、透视、相关分析、时间序列、建模——全部做成可视化交互，并且把「分析过程」本身变成了一等公民："
            "每一步操作都会记录进分析流水线，同步生成等价的 pandas 代码，可随时回看、撤销、复现。",
            "它不是一个数据看板，而是一个分析工作台。看板只呈现结果，而 DataLens 呈现的是「从原始数据到结论」"
            "的完整推理链条——这正是数据分析课程最需要学生建立的能力。",
            "技术形态上，它是一个纯前端单页应用：零后端、零上传，所有计算在浏览器本地完成。"
            "这既保护了数据隐私，也让它可以部署在任何静态托管上。",
        ],
        en_paras=[
            "DataLens is a visual pandas analysis workbench. It turns pandas' core operations — load, clean, describe, "
            "group, pivot, correlate, forecast, model — into visual interactions, and makes the analysis process itself "
            "a first-class citizen: every action is recorded in the pipeline, mirrored as equivalent pandas code, and can "
            "be replayed, undone or reverted at any time.",
            "It is not a dashboard. A dashboard shows results; DataLens shows the whole chain of reasoning from raw data "
            "to conclusion — which is exactly the skill a data-analysis course needs students to build.",
            "Technically it is a pure front-end single-page application: no backend, no uploads, all computation local to "
            "the browser. That protects data privacy and lets it be hosted anywhere.",
        ],
    ),
    Section(
        zh_title="二、关键亮点",
        en_title="2. Key highlights",
        zh_paras=[
            "以下六点是本项目与普通「数据可视化」作业的分水岭。",
            "The six points below are what separate this project from an ordinary data-visualisation exercise.",
        ],
        en_paras=[],
    ),
    Bullet(
        zh="亮点 1 · 分析流水线（Pipeline）——让过程可见。每一步操作都成为一张卡片：双语名称、参数摘要、"
           "行数与列数的变化徽章（如 891 → 182，−709）、空值数量变化。支持撤销/重做，"
           "并且可以「时间旅行」——点击任意历史步骤即可回看当时的数据状态，也可以从某一步分叉重来。"
           "整条流水线可导出为 .daproj.json 工程文件，拖回来或点「导入分析工程」即可原样复现整条分析链路，"
           "文件里只有操作与参数，原始数据始终留在本地。",
        en="Highlight 1 · Analysis pipeline — making the process visible. Every action becomes a card: bilingual name, "
           "parameter summary, row/column delta badges (e.g. 891 → 182, −709) and null-count changes. Undo/redo is "
           "supported, and so is time travel — click any historical step to see the data as it was, or fork from there. "
           "The whole chain exports to a .daproj.json project file and re-imports to reproduce the analysis exactly; "
           "the file records operations and parameters only, never the data.",
    ),
    Bullet(
        zh="亮点 2 · 实时 pandas 代码镜像。流水线旁同步生成等价 pandas 代码，随操作实时增长，"
           "并且带有中文注释说明每一步在做什么。这让「一次点击 = 一行 pandas」的关系变得具体可感，"
           "学生可以复制代码到 Jupyter 中继续工作，也可以反过来通过看代码理解可视化操作的含义。",
        en="Highlight 2 · Live pandas code mirror. The equivalent pandas script grows alongside the pipeline in real time, "
           "annotated so each step explains itself. This makes the 'one click = one line of pandas' relationship concrete: "
           "students can copy the code into Jupyter to continue, or read the code to understand what a visual action means.",
    ),
    Bullet(
        zh="亮点 3 · 自动洞察引擎。加载数据后自动扫描，按类别产出洞察：数据质量、分布形态、变量关系、"
           "分组差异、时间规律、行动建议。每条洞察都带有量化指标和一句自然语言结论，"
           "并附带「去分析 →」按钮，点击后直接跳转到对应分析页面且参数已预填。"
           "例如它会指出「Deck 列缺失 77.2%，建议填充或删除」「Fare 明显右偏（偏度 4.787），均值高于中位数」"
           "「头等舱生存率显著高于三等舱」等。",
        en="Highlight 3 · Automatic insight engine. On load the frame is scanned and findings are produced by category: "
           "data quality, distribution shape, relationships, group differences, time patterns and suggested actions. "
           "Each carries a quantitative metric plus a plain-language conclusion and an 'Analyze →' button that jumps to "
           "the right page with parameters pre-filled. It will point out, for example, that Deck is 77.2% missing, that "
           "Fare is strongly right-skewed (skew 4.787) with the mean above the median, or that first-class survival far "
           "exceeds third class.",
    ),
    Bullet(
        zh="亮点 4 · 用真实 pandas 做基准测试。项目的核心引擎不是「看起来像 pandas」，而是用真实 pandas 2.2.3 "
           "逐项比对验证。tools/gen_pandas_fixtures.py 用真实 pandas 计算一份确定性数据集的全部统计量，"
           "生成基准 JSON；测试套件让 TypeScript 引擎在同样输入上运行并逐项对比：describe 的八项统计量、"
           "分位数线性插值、三种相关系数矩阵、groupby 聚合、pivot_table、rolling/expanding/resample、"
           "dropna 四种形式、sort_values 多列排序等，共 38 个一致性测试全部通过。",
        en="Highlight 4 · Benchmarked against real pandas. The core engine is not 'pandas-shaped' — it is verified "
           "field-by-field against real pandas 2.2.3. tools/gen_pandas_fixtures.py runs real pandas over a deterministic "
           "dataset and emits a ground-truth JSON; the test suite runs the TypeScript engine over the same input and "
           "compares: all eight describe statistics, linear quantile interpolation, three correlation matrices, groupby "
           "aggregation, pivot_table, rolling/expanding/resample, four dropna forms, multi-key sort_values and more. "
           "All 38 parity tests pass.",
    ),
    Bullet(
        zh="亮点 5 · 完整的分析闭环，而不只是画图。从加载数据到导出报告是一条完整链路："
           "清洗（缺失值/重复值/异常值/类型转换）→ 描述统计（含自然语言解读）→ 分组与透视 → 相关与回归 → "
           "时间序列与预测 → 聚类与主成分 → 图表工作室 → 一键导出单文件 HTML 报告。"
           "高级分析是真正的建模：OLS 回归会给出系数、标准误、t 值、p 值、方差膨胀因子与残差图；"
           "K-Means 会给出肘部图与轮廓系数；PCA 会给出碎石图、载荷矩阵与二维投影。",
        en="Highlight 5 · A complete analysis loop, not just charting. Loading data through to exporting a report is one "
           "continuous chain: cleaning (missing / duplicates / outliers / type casting) → descriptive statistics with "
           "plain-language interpretation → grouping and pivoting → correlation and regression → time series and "
           "forecasting → clustering and PCA → chart studio → one-click single-file HTML report. The advanced module does "
           "real modelling: OLS reports coefficients, standard errors, t, p, VIF and residual plots; K-means reports the "
           "elbow plot and silhouette score; PCA reports the scree plot, loadings and a 2-D projection.",
    ),
    Bullet(
        zh="亮点 6 · 中英双语由类型系统强制保证。双语不是「翻译一遍」，而是由编译器约束："
           "src/i18n/zh.ts 是唯一事实来源，英文词典的类型由它推导，漏翻任何一个键都无法通过编译。"
           "语言写入 URL（?lang=en）与 localStorage，数字、日期、百分比全部走 Intl 按当前语言格式化，"
           "图表轴标签、图例、提示框、洞察文案、导出的报告内容也全部双语。"
           "此外还有一条自动化的「双语一致性审计」：脚本会在两种语言下逐页抓取页面上的全部可见文本，"
           "检查英文界面里是否漏出中文、中文界面里是否漏出英文句子。",
        en="Highlight 6 · Bilingual by compiler, not by discipline. The two languages are not maintained by hand: "
           "src/i18n/zh.ts is the single source of truth and the English dictionary is typed from it, so a missing "
           "translation fails the build. The language lives in the URL (?lang=en) and localStorage; numbers, dates and "
           "percentages are formatted with Intl for the active locale; and chart axes, legends, tooltips, insight text "
           "and the exported report are all localised. On top of that, an automated bilingual audit walks every page in "
           "both languages, collects all visible text and fails if Chinese leaks into the English UI or English "
           "sentences leak into the Chinese one.",
    ),
    Bullet(
        zh="亮点 7 · 每个页面都有自己的网址。视图写入 URL 哈希（#/groupby），因此链接可以直接分享、"
           "可以在浏览器里前进后退，也可以作为书签下次直接打开；配合 ?lang=en 还能指定语言。"
           "这让「把这一步的分析发给我看看」变成一件可以真的做到的事。",
        en="Highlight 7 · Every view has its own URL. The active view is written to the URL hash (#/groupby), so links "
           "are shareable, browser back and forward work, views can be bookmarked, and ?lang=en pins the language. "
           "It turns 'send me that analysis' into something that actually works.",
    ),
    Section(
        zh_title="三、功能清单",
        en_title="3. Feature list",
        zh_paras=["11 个分析页面覆盖 pandas 的完整工作流。以下表格同时给出对应的 pandas 写法。",
                  "Eleven pages cover the full pandas workflow. The table also gives the pandas equivalent for each."],
        en_paras=[],
        table=(
            ["页面 / Page", "对应 pandas / pandas equivalent", "主要能力 / Capabilities"],
            [
                ["总览 / Overview", "df.info(), df.shape",
                 "KPI 磁贴、数据健康分（含扣分原因）、逐列画像、自动洞察、初览图表、数据预览"],
                ["数据表 / Data table", "head/loc/iloc",
                 "虚拟滚动大表、多列排序、全表搜索、15 种运算符的条件筛选（先预览影响再应用）、列菜单、单元格详情、离群值高亮"],
                ["数据清洗 / Clean", "isna/dropna/fillna/drop_duplicates/astype",
                 "缺失分布热力图、删除缺失（any/all/thresh/subset）、8 种填充策略、重复行分组、IQR 与 Z-Score 异常检测、类型转换与失败报告"],
                ["描述统计 / Describe", "describe/skew/kurt/quantile",
                 "20 项统计指标、直方图+密度曲线、箱线图、经验分布、多列分布对比（箱线/小提琴/山脊）、分组统计表、自然语言统计解读"],
                ["分组聚合 / Group by", "groupby().agg()",
                 "多键分组、列×函数矩阵（12 种聚合）、快捷模板、8 种图表、排序与 Top-N、量纲差异大时自动双坐标轴"],
                ["透视表 / Pivot", "pivot_table()",
                 "行列值配置、填充空值、行列总计、热力图、矩形树图、堆叠柱、带色阶数据表、导出 CSV"],
                ["相关分析 / Correlation", "corr(method=)",
                 "Pearson/Spearman/Kendall、相关矩阵热力图、点击查看散点+OLS 回归+R²/p 值、强相关排行、离散变量自动气泡图"],
                ["时间序列 / Time series", "resample/rolling/expanding/diff/shift",
                 "自动识别日期列、6 种粒度重采样、7 种窗口函数、累计窗口、7 种派生指标、季节性轮廓、趋势分解、ACF、预测与误差评估"],
                ["图表工作室 / Chart studio", "—",
                 "16 种图表类型、自由编码架、5 个模板、导出 PNG、一键加入报告"],
                ["高级分析 / Advanced", "—",
                 "OLS 回归（系数/t/p/VIF/残差图）、K-Means（肘部图+轮廓系数+簇画像）、PCA（碎石图+载荷+投影）、异常检测（IQR/Z/LOF）、预测"],
                ["分析报告 / Report", "—",
                 "10 个可选章节、实时预览（浅/深色）、导出单文件 HTML、导出 Markdown/CSV/Excel、"
                 "导出并重新导入分析工程 JSON"],
                ["视图链接 / View URLs", "—",
                 "视图写入 URL 哈希（#/groupby）：链接可分享、可收藏，浏览器前进/后退在页面间切换"],
            ],
        ),
    ),
    Section(
        zh_title="四、内置示例数据",
        en_title="4. Bundled sample datasets",
        zh_paras=["内置六份数据，覆盖不同的分析场景；同时支持拖拽上传（CSV/TSV/TXT/JSON/Excel）与粘贴文本，"
                  "自动检测分隔符与编码（UTF-8 / GBK / GB18030 / Big5 / Windows-1252）。"],
        en_paras=["Six datasets are bundled, covering different scenarios. Drag-and-drop upload "
                  "(CSV/TSV/TXT/JSON/Excel) and text pasting are also supported, with automatic delimiter and encoding "
                  "detection (UTF-8 / GBK / GB18030 / Big5 / Windows-1252)."],
        table=(
            ["数据集 / Dataset", "规模 / Size", "设计意图 / Why it is here"],
            [
                ["泰坦尼克号 / Titanic（默认）", "891 × 15", "真实数据，含缺失值与混合类型，经典的清洗与分组素材"],
                ["电商销售订单 / E-commerce orders", "5,000 × 17", "含日期、地区、品类、渠道、金额，适合时序与透视"],
                ["鸢尾花 / Iris", "150 × 5", "干净数据，适合相关性与聚类"],
                ["空气质量监测 / Air quality", "1,461 × 11", "大量缺失与异常读数，专为演示清洗而设计"],
                ["全球发展指标 / Global development", "1,704 × 6", "各国历年人均 GDP 与预期寿命"],
                ["大规模订单 / Large orders", "100,000 × 11", "用于展示大数据量下的性能表现"],
            ],
        ),
        image="zh-overview.png",
        image_caption=("总览页面：数据健康分、自动洞察与逐列画像",
                       "Overview: health score, automatic insights and per-column profile"),
    ),
    Section(
        zh_title="五、技术架构",
        en_title="5. Architecture",
        zh_paras=["项目分为四层，核心引擎与框架完全解耦，可以独立单元测试。",
                  "The project has four layers; the core engine is fully decoupled from the UI framework and is "
                  "independently unit-testable."],
        en_paras=[],
        table=(
            ["层 / Layer", "内容 / Contents"],
            [
                ["core/ — pandas 引擎",
                 "DataFrame（列式不可变存储，保留原始行号）、dtype（类型推断与转换）、stats（统计原语 + 直方图/KDE/ECDF/箱线/LTTB 降采样）、"
                 "io（RFC 4180 解析器 + JSON/Excel + 编码嗅探）、ops（清洗与变换 + 筛选 AST + 安全表达式求值器）、"
                 "groupby、pivot、timeseries、advanced（OLS/K-Means/PCA/异常检测/预测，含 t 分布 p 值）、profile、insights"],
                ["pipeline/ — 流水线",
                 "operations.ts 是操作注册表：每个操作的「如何计算」「如何描述」「生成什么 pandas 代码」定义在同一个对象里；"
                 "store.ts 管理撤销/重做/时间旅行/工程导入导出"],
                ["components/ — 界面",
                 "ui/ 设计系统原语；charts/ ECharts 封装 + 18 个图表 option 工厂；layout/ 外壳、侧边栏、顶栏、分析流水线栏、加载面板、命令面板"],
                ["views/ — 页面", "11 个分析页面"],
            ],
        ),
    ),
    Section(
        zh_title="六、关键设计决策",
        en_title="6. Key design decisions",
        zh_paras=[],
        en_paras=[],
    ),
    Bullet(
        zh="不可变 DataFrame。每个操作返回新帧，从不原地修改。这让撤销/重做/时间旅行变得平凡——只需保存操作列表，"
           "任意中间状态都能重新推导，而不需要为每一步保存数据快照（10 万行 × 20 步的快照会撑爆内存）。",
        en="Immutable DataFrame. Every operation returns a new frame; nothing mutates in place. That makes "
           "undo/redo/time-travel trivial — keep the operation list and re-derive any intermediate state, instead of "
           "holding a snapshot per step (100k rows × 20 steps would blow up memory).",
    ),
    Bullet(
        zh="操作注册表。每个操作的「计算逻辑」「参数描述」「pandas 代码生成」定义在同一个对象里。"
           "这从根本上保证了流水线卡片与代码镜像永远不会不同步——它们读的是同一份定义。",
        en="Operation registry. Each operation's computation, parameter description and pandas codegen live in one object. "
           "That structurally guarantees the pipeline cards and the code mirror can never drift apart — they read the "
           "same definition.",
    ),
    Bullet(
        zh="按帧指纹缓存。10 万行数据的逐列画像是最昂贵的操作，用帧指纹做记忆化，切换页面时不会重复计算。",
        en="Fingerprint-keyed caching. Profiling a 100k-row frame is the most expensive thing the UI does; results are "
           "memoised by frame fingerprint so switching pages never recomputes.",
    ),
    Bullet(
        zh="性能策略。表格虚拟滚动（只挂载可见行）、散点与折线用 LTTB 降采样（保形压缩到 8000 点）、"
           "透视表列数上限与「其他」合并、Kendall 系数超限抽样、图表点位上限。",
        en="Performance strategy. Table virtualisation (only visible rows mount), LTTB downsampling for scatter and line "
           "charts (shape-preserving reduction to 8,000 points), a pivot column cap that merges the tail into '<other>', "
           "sampled Kendall coefficients, and chart point limits.",
    ),
    Bullet(
        zh="安全优先的实现细节。可视化筛选器与计算列不使用 eval，而是实现了独立的词法分析器与递归下降解析器，"
           "因此导入别人分享的分析工程文件不会执行任意代码。CSV 解析器也是手写的 RFC 4180 实现，"
           "以正确处理引号、转义、跨行字段与 BOM。",
        en="Security-conscious implementation. The visual filter builder and computed columns avoid eval entirely — there "
           "is a hand-written tokenizer and recursive-descent parser — so importing someone else's shared project file "
           "cannot execute arbitrary code. The CSV reader is likewise a hand-written RFC 4180 parser so quoting, escapes, "
           "embedded newlines and BOMs are handled correctly.",
    ),
    Section(
        zh_title="七、质量保证",
        en_title="7. Quality assurance",
        zh_paras=["项目共有 126 个单元测试，全部通过：38 个 pandas 一致性测试 + 78 个引擎单元测试 + 10 个回归测试；"
                  "另有 14 个端到端测试在真实浏览器里跑通全流程。此外还有 TypeScript 严格模式全量类型检查、"
                  "逐页截图与控制台错误检查、以及会真实操作控件的交互审计脚本。",
                  "The project has 126 unit tests, all passing: 38 pandas-parity tests, 78 engine unit tests and 10 "
                  "regression tests — plus 14 end-to-end tests that drive the real app in a browser. There is also a full "
                  "strict-mode TypeScript check, a per-page screenshot and console-error check, and an interaction audit "
                  "that clicks its way through the real controls."],
        en_paras=[],
        table=(
            ["测试类别 / Test suite", "覆盖内容 / Coverage"],
            [
                ["pandas 一致性 / pandas parity（38）",
                 "describe 八项统计量、扩展统计量（sum/var/skew/kurt/median/range/IQR）、分位数线性插值（10 个概率点）、"
                 "Pearson/Spearman/Kendall 相关矩阵、value_counts、nunique、isna、groupby 六种聚合、双键分组命名聚合、"
                 "pivot_table（mean/count + fill_value）、rolling/expanding/resample、dropna 四种形式、fillna(median)、"
                 "duplicated/drop_duplicates、多列 sort_values、布尔列聚合"],
                ["引擎单元测试 / engine unit tests（78）",
                 "CSV 解析器边界情况（引号/转义/跨行/BOM/CRLF/参差行/重名表头/NA 标记/类型推断）、日期解析、"
                 "DataFrame 语义（行号保留、切片、拼接）、缺失值操作、重复检测、类型转换、筛选 AST 全部运算符、"
                 "表达式求值器、长宽转换、分箱、标准化、独热编码、JSON 摄取、画像与健康分、统计辅助函数、LTTB 降采样"],
                ["回归测试 / regression tests（10）",
                 "本轮实测中发现的缺陷固化为测试：列特征标签去重（布尔列重复标为「二值」）、"
                 "热力图坐标轴必须显式声明 boundaryGap（否则切换图表类型时会崩溃）、柱状图与折线图的边界设置互不污染、"
                 "密集类目轴自动抽稀标签、分析工程文件的解析与校验"],
                ["端到端 / end-to-end（14，Playwright）",
                 "默认数据自动加载、分组聚合并写入流水线、清洗操作的行数徽章、撤销/重做、时间旅行、"
                 "代码镜像、逐页无运行时错误、语言切换内容一致、命令面板、报告预览、含日期示例数据、"
                 "切换全部图表类型不崩溃、URL 深链与浏览器历史、分析工程导出后重新导入"],
            ],
        ),
    ),
    Section(
        zh_title="八、设计与交互",
        en_title="8. Design and interaction",
        zh_paras=["界面采用暗色为主、精修浅色主题的设计系统。语义化颜色令牌集中在 CSS 变量中，"
                  "图表配色与界面配色同源，两个主题下的对比度都经过检查。中文字体使用系统字体栈"
                  "（PingFang SC / 微软雅黑），避免加载庞大的 CJK 字体，保证首屏秒开。",
                  "交互上遵循三条原则：任意操作不超过两次点击；所有破坏性操作先预览影响（"
                  "例如「将删除 709 行，保留 182 行」）；空态、加载态、错误态都有专门设计。"
                  "另有命令面板（Ctrl/Cmd + K）、键盘快捷键、以及逐页的错误边界保护。",
                  "特别地，当图表中的多个指标量纲差异过大时（例如 0–1 的比率与 0–600 的计数），"
                  "系统会自动启用双坐标轴，避免把小的那组压成一条直线；当散点图的两个变量都是离散值时，"
                  "会自动切换为气泡图，用点的大小表示该组合出现的记录数。"],
        en_paras=["The interface uses a dark-first design system with a polished light theme. Semantic colour tokens live in "
                  "CSS variables, chart colours come from the same source as the UI palette, and contrast is checked in both "
                  "themes. Chinese text uses the system font stack (PingFang SC / Microsoft YaHei) so no large CJK webfont "
                  "is downloaded and first paint is instant.",
                  "Three interaction principles: any operation takes at most two clicks; every destructive action previews "
                  "its effect first (for example, 'drops 709 rows, keeps 182'); and empty, loading and error states are all "
                  "designed. There is also a command palette (Ctrl/Cmd + K), keyboard shortcuts, and a per-page error "
                  "boundary.",
                  "Two notable touches: when metrics in one chart differ wildly in magnitude (a 0–1 rate beside a 0–600 "
                  "count) the system automatically switches on a second axis so the smaller series is not flattened into a "
                  "line; and when both axes of a scatter are discrete, it switches to a bubble plot where dot size shows "
                  "how many rows share that pair.",
                  "The interface was tuned by driving it, not by reading it: a scripted audit clicks through every control "
                  "on every page in both languages and reports anything that throws. That is how the chart-type crash, the "
                  "duplicate column tag and the untranslated strings in this build were found and fixed."],
        image="zh-groupby.png",
        image_caption=("分组聚合：女性生存率 74% 与男性 19%，量纲差异时自动双坐标轴",
                       "Group by: 74% vs 19% survival, with automatic dual axes when magnitudes differ"),
    ),
    Section(
        zh_title="九、交付物与运行方式",
        en_title="9. Deliverables and how to run",
        zh_paras=[],
        en_paras=[],
        table=(
            ["交付物 / Deliverable", "说明 / Notes"],
            [
                ["在线地址 / Live URL", LIVE_URL],
                ["源代码 / Source", "本压缩包（不含 node_modules），含双语 README、示例数据与全部工具脚本"],
                ["演示视频 / Demo video", "datalens-demo.mp4，中文讲解 + 中英双语字幕，约 4 分 40 秒（另附 SRT 字幕文件）"],
                ["亮点文档 / This document", "DataLens-亮点说明.docx（中英对照）"],
            ],
        ),
    ),
    Bullet(
        zh="运行方式：npm install 安装依赖，npm run dev 启动开发服务器（localhost:5173），"
           "npm run build 生产构建，npm test 运行全部单元测试，npm run e2e 在真实浏览器里跑端到端测试。"
           "部署方面，项目已配置好 vercel.json，执行 npx vercel --prod 即可发布；"
           "也可以把 dist/ 目录部署到任意静态托管。",
        en="To run: npm install, then npm run dev for the dev server (localhost:5173), npm run build for a production "
           "build, npm test for the unit suite, and npm run e2e to drive the real app in a browser. For deployment, "
           "vercel.json is already configured — run npx vercel --prod, or serve the dist/ directory from any static host.",
    ),
    Bullet(
        zh="随源码附带的验证脚本：node tools/repro.mjs 逐个操练 11 个页面的关键控件；"
           "node tools/interaction.mjs 验证 URL 路由、撤销重做与工程导入导出；"
           "node tools/i18n-audit.mjs 逐页检查双语一致性；node tools/screenshot.mjs 逐页截图并收集控制台错误；"
           "python tools/gen_pandas_fixtures.py 用真实 pandas 重新生成基准数据；"
           "tools/video/ 下是完整的录屏、配音与合成脚本。",
        en="Verification scripts shipped with the source: node tools/repro.mjs exercises the key controls on all eleven "
           "pages; node tools/interaction.mjs checks URL routing, undo/redo and project import/export; "
           "node tools/i18n-audit.mjs audits bilingual consistency page by page; node tools/screenshot.mjs captures every "
           "page and collects console errors; python tools/gen_pandas_fixtures.py regenerates the pandas ground truth; "
           "and tools/video/ holds the full recording, narration and mux pipeline.",
    ),
]


# --------------------------------------------------------------------------- #
# DOCX rendering
# --------------------------------------------------------------------------- #

def set_cjk(run, font="Microsoft YaHei"):
    """python-docx needs the east-asian font set explicitly or Word falls back."""
    run.font.name = font
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), font)
    rfonts.set(qn("w:ascii"), font)
    rfonts.set(qn("w:hAnsi"), font)


def shade(cell, hex_color: str):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), hex_color)
    tc_pr.append(shd)


def build_docx() -> str:
    doc = Document()

    # Base style
    style = doc.styles["Normal"]
    style.font.size = Pt(10.5)
    style.font.name = "Microsoft YaHei"
    style.element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")

    for section in doc.sections:
        section.top_margin = Inches(0.85)
        section.bottom_margin = Inches(0.85)
        section.left_margin = Inches(0.9)
        section.right_margin = Inches(0.9)

    # ---- title block ----
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = title.add_run("DataLens · 可视化 pandas")
    r.font.size = Pt(26)
    r.font.bold = True
    r.font.color.rgb = ACCENT
    set_cjk(r)

    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = sub.add_run("A visual pandas — the whole analysis workflow, done visually")
    r.font.size = Pt(11)
    r.font.color.rgb = MUTED
    set_cjk(r)

    link = doc.add_paragraph()
    link.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = link.add_run(LIVE_URL)
    r.font.size = Pt(10)
    r.font.color.rgb = ACCENT
    r.font.underline = True
    set_cjk(r)

    doc.add_paragraph()

    def heading(text: str, level: int = 1):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(16 if level == 1 else 10)
        p.paragraph_format.space_after = Pt(6)
        r = p.add_run(text)
        r.font.size = Pt(15 if level == 1 else 12)
        r.font.bold = True
        r.font.color.rgb = ACCENT if level == 1 else RGBColor(0x22, 0x26, 0x33)
        set_cjk(r)
        return p

    def para(text: str, *, muted=False, size=10.5, indent=0):
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.line_spacing = 1.35
        if indent:
            p.paragraph_format.left_indent = Inches(indent)
        r = p.add_run(text)
        r.font.size = Pt(size)
        if muted:
            r.font.color.rgb = MUTED
        set_cjk(r)
        return p

    def bullet(zh: str, en: str):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.35
        p.paragraph_format.left_indent = Inches(0.16)
        r = p.add_run("▪ ")
        r.font.size = Pt(10.5)
        r.font.color.rgb = ACCENT
        r = p.add_run(zh)
        r.font.size = Pt(10.5)
        set_cjk(r)
        q = doc.add_paragraph()
        q.paragraph_format.space_after = Pt(8)
        q.paragraph_format.line_spacing = 1.3
        q.paragraph_format.left_indent = Inches(0.16)
        r = q.add_run(en)
        r.font.size = Pt(9.5)
        r.font.color.rgb = MUTED
        r.font.italic = True
        set_cjk(r)

    def table(headers: list[str], rows: list[list[str]]):
        t = doc.add_table(rows=1, cols=len(headers))
        t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        hdr = t.rows[0].cells
        for i, h in enumerate(headers):
            hdr[i].text = ""
            p = hdr[i].paragraphs[0]
            r = p.add_run(h)
            r.font.bold = True
            r.font.size = Pt(9.5)
            set_cjk(r)
            shade(hdr[i], "EEECFF")
        for row in rows:
            cells = t.add_row().cells
            for i, v in enumerate(row):
                cells[i].text = ""
                p = cells[i].paragraphs[0]
                r = p.add_run(v)
                r.font.size = Pt(9)
                set_cjk(r)
        doc.add_paragraph()

    def image(name: str, caption: tuple[str, str]):
        path = os.path.join(SHOTS, name)
        if not os.path.exists(path):
            return
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run().add_picture(path, width=Inches(6.4))
        c = doc.add_paragraph()
        c.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = c.add_run(caption[0])
        r.font.size = Pt(9)
        r.font.color.rgb = MUTED
        set_cjk(r)
        c2 = doc.add_paragraph()
        c2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = c2.add_run(caption[1])
        r.font.size = Pt(8.5)
        r.font.color.rgb = MUTED
        r.font.italic = True
        set_cjk(r)
        doc.add_paragraph()

    for item in SECTIONS:
        if isinstance(item, Bullet):
            bullet(item.zh, item.en)
            continue

        heading(f"{item.zh_title} / {item.en_title}")
        for zh, en in zip(item.zh_paras, item.en_paras):
            para(zh)
            if en:
                para(en, muted=True, size=9.5)
        # Any paragraphs without a pair still need to render.
        for extra in item.zh_paras[len(item.en_paras):]:
            para(extra)
        if item.table:
            table(*item.table)
        if item.image and item.image_caption:
            image(item.image, item.image_caption)

    path = os.path.join(OUT, "DataLens-亮点说明.docx")
    doc.save(path)
    return path


# --------------------------------------------------------------------------- #
# Markdown rendering
# --------------------------------------------------------------------------- #

def build_markdown() -> str:
    lines = [
        "# DataLens · 可视化 pandas",
        "",
        "> A visual pandas — the whole analysis workflow, done visually",
        "",
        f"**在线地址 / Live URL**: <{LIVE_URL}>",
        "",
        "---",
        "",
    ]
    for item in SECTIONS:
        if isinstance(item, Bullet):
            lines += [f"- {item.zh}", f"  - *{item.en}*", ""]
            continue
        lines += [f"## {item.zh_title} / {item.en_title}", ""]
        for zh in item.zh_paras:
            lines += [zh, ""]
        for en in item.en_paras:
            lines += [f"*{en}*", ""]
        if item.table:
            headers, rows = item.table
            lines.append("| " + " | ".join(headers) + " |")
            lines.append("|" + "---|" * len(headers))
            for row in rows:
                lines.append("| " + " | ".join(c.replace("|", "\\|") for c in row) + " |")
            lines.append("")
        if item.image and item.image_caption:
            lines += [f"![{item.image_caption[0]}](../shots/{item.image})", "", f"*{item.image_caption[0]}*", ""]

    path = os.path.join(OUT, "DataLens-highlights.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return path


if __name__ == "__main__":
    print("docx :", build_docx())
    print("md   :", build_markdown())
