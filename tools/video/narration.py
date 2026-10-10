"""
Narration script for the demo video, plus TTS synthesis.

Each scene carries:
  say  - the Chinese narration that gets spoken
  zh   - the on-screen Chinese subtitle
  en   - the on-screen English subtitle
  hold - extra seconds to linger after the narration ends

Run:  python tools/video/narration.py
Out:  tools/video/out/durations.json  +  seg-NN.mp3
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess

import edge_tts

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "+8%"

SCENES = [
    {
        "id": "intro",
        "say": "这是 DataLens，一个把 pandas 全流程可视化的数据分析工作台。"
               "加载、清洗、统计、分组、透视、相关、时序、建模、报告，全部在浏览器里完成。",
        "zh": "DataLens —— 把 pandas 全流程可视化的数据分析工作台",
        "en": "DataLens — the whole pandas workflow, done visually",
        "hold": 0.8,
    },
    {
        "id": "overview",
        "say": "打开就自动加载了泰坦尼克号数据。顶部是数据规模和缺失情况，"
               "左边是数据健康分，它综合了完整度、重复值和列的有效性，还会告诉你每一分是怎么扣的。",
        "zh": "默认加载泰坦尼克号数据；健康分综合完整度、重复值与列有效性，并给出扣分原因",
        "en": "The Titanic dataset loads by default. The health score combines completeness, duplicates and column validity — and shows what cost points",
        "hold": 0.6,
    },
    {
        "id": "insights",
        "say": "最右边是自动洞察。系统扫描数据后，主动告诉你哪里有问题："
               "Deck 列缺失超过七成，有重复行，Fare 明显右偏。"
               "点“去分析”，就直接跳到对应页面，参数都替你填好了。",
        "zh": "自动洞察主动指出问题，点击「去分析」即可跳转并预填参数",
        "en": "Automatic insights surface the problems; Analyze jumps straight there with parameters pre-filled",
        "hold": 0.6,
    },
    {
        "id": "data",
        "say": "数据表页面可以像 Excel 一样浏览。支持多列排序、全表搜索，"
               "空值会高亮显示。筛选器支持十五种运算符，而且会先告诉你这一步会影响多少行，确认了再应用。",
        "zh": "数据表：多列排序、全表搜索、空值高亮；筛选前先预览影响行数",
        "en": "Data table: multi-column sort, search, null highlighting; filters preview their effect before applying",
        "hold": 0.6,
    },
    {
        "id": "clean",
        "say": "数据清洗页面把缺失值分布画成了一张图，一眼就能看出哪些字段是成片缺失的。"
               "所有操作都先预览再执行，比如删除含缺失的行，会先告诉你将从八百九十一行删到一百八十二行。",
        "zh": "清洗页：缺失分布图 + 所有操作先预览再执行（891 行 → 182 行）",
        "en": "Cleaning: a missingness map, and every action previews its effect first (891 rows → 182)",
        "hold": 0.6,
    },
    {
        "id": "pipeline",
        "say": "这就是 DataLens 最核心的设计。每一步操作都会记录进右边的分析流水线，"
               "并标注行数和空值的变化。切到代码页，整条分析链路会实时生成等价的 pandas 代码，可以直接复制去用。",
        "zh": "分析流水线：记录每一步的行数/空值变化，并实时生成等价 pandas 代码",
        "en": "The pipeline records every step with its row/null deltas, and mirrors the whole chain as pandas code",
        "hold": 0.8,
    },
    {
        "id": "timetravel",
        "say": "点击任意一个历史步骤，就能回到当时的数据状态，看看那一步到底改了什么。"
               "也可以从这里继续，把后面的操作全部撤销重来。",
        "zh": "时间旅行：点任意历史步骤回看当时数据，也可从该步继续重做",
        "en": "Time travel: click any step to see the data as it was, then continue from there",
        "hold": 0.6,
    },
    {
        "id": "describe",
        "say": "描述统计页面给出二十项统计指标，并且会主动用自然语言解读："
               "均值和中位数差多少、偏度说明了什么、中间一半的数据落在哪个区间。",
        "zh": "描述统计：20 项指标 + 自动统计解读（均值/中位数关系、偏度、四分位区间）",
        "en": "Describe: 20 metrics plus a plain-language read-out of mean vs median, skew and the interquartile range",
        "hold": 0.6,
    },
    {
        "id": "groupby",
        "say": "分组聚合。按性别分组看生存率，女性百分之七十四，男性百分之十九，"
               "差异一目了然。柱状、堆叠、环形、热力图一共八种图表随选，"
               "当选的指标量纲差太多时，系统会自动启用双坐标轴，不会把小的那组压成一条线。",
        "zh": "分组聚合：女性生存率 74% vs 男性 19%；八种图表随选，量纲差异大时自动启用双坐标轴",
        "en": "Group by: 74% survival for women vs 19% for men; eight chart types, automatic dual axes when magnitudes differ",
        "hold": 0.6,
    },
    {
        "id": "pivot",
        "say": "透视表用行列交叉的方式重新组织数据。这里同时看性别和登船港口，"
               "颜色越深表示生存率越高，交叉结构一眼可见。",
        "zh": "透视表：性别 × 登船港口的生存率热力图",
        "en": "Pivot: survival rate across sex × embarkation port as a heatmap",
        "hold": 0.6,
    },
    {
        "id": "correlate",
        "say": "相关分析提供三种相关系数。点击矩阵里的任意一格，就能看到这两个变量的散点图和回归拟合，"
               "以及决定系数和显著性。如果变量是离散的，会自动切换成气泡图，用点的大小表示记录数。",
        "zh": "相关分析：点击矩阵单元格查看散点图与回归；离散变量自动切换气泡图",
        "en": "Correlation: click any cell for the scatter and regression fit; discrete variables switch to a bubble plot",
        "hold": 0.6,
    },
    {
        "id": "timeseries",
        "say": "换成电商销售数据，时间序列页面会自动识别日期列。"
               "可以按不同粒度重采样、做滑动平均、看季节性规律，还能基于趋势和季节项做预测，并给出误差指标。",
        "zh": "时间序列：自动识别日期列，重采样、滑动窗口、季节性、趋势预测（含误差评估）",
        "en": "Time series: auto-detected dates, resampling, rolling windows, seasonality and forecasting with error metrics",
        "hold": 0.6,
    },
    {
        "id": "advanced",
        "say": "高级分析里做了真正的建模。线性回归会给出每个变量的系数、显著性、"
               "方差膨胀因子和残差图；聚类会给出肘部图和轮廓系数，帮你选合适的分组数量。",
        "zh": "高级分析：线性回归（系数/t/p/VIF/残差图）与 K-Means 聚类（肘部图 + 轮廓系数）",
        "en": "Advanced: regression with coefficients, t, p, VIF and residuals; K-means with elbow plot and silhouette",
        "hold": 0.6,
    },
    {
        "id": "report",
        "say": "最后，把关键图表加入报告，一键导出成单文件 HTML。"
               "图表和表格全部内联在文件里，可以直接发给别人；也可以导出清洗后的数据。",
        "zh": "报告：一键导出单文件 HTML（图表内联），也可导出清洗后的数据",
        "en": "Report: export a single self-contained HTML file, or the cleaned data",
        "hold": 0.6,
    },
    {
        "id": "project",
        "say": "分析做到一半想给别人复现？导出一个分析工程文件，里面只记录操作和参数。"
               "清空之后重新导入，整条流水线和每一步的结果原样恢复——数据始终没有离开浏览器。",
        "zh": "导出分析工程 → 清空 → 导入：整条流水线与结果原样恢复，数据不出浏览器",
        "en": "Export the project file → clear → import: the whole pipeline and its results come back, with data never leaving the browser",
        "hold": 3.0,
    },
    {
        "id": "share",
        "say": "每个页面都有自己的网址，可以直接把链接发给同学，打开就是同一个分析页面。"
               "浏览器的前进和后退也能正常使用，就像浏览普通网页一样。",
        "zh": "每个页面都有独立网址，可分享、可直达；浏览器前进/后退正常可用",
        "en": "Every view has its own URL — shareable and deep-linkable, with browser back/forward working as usual",
        "hold": 0.5,
    },
    {
        "id": "bilingual",
        "say": "整个网站是中英双语的，而且两种语言的键值由类型系统强制对齐，"
               "漏翻任何一个词都无法通过编译。",
        "zh": "中英双语由类型系统强制对齐，漏翻一个键就无法编译",
        "en": "Both languages are enforced by the type system — a missing key fails the build",
        "hold": 0.5,
    },
    {
        "id": "outro",
        "say": "DataLens 让数据分析的过程本身变得可见、可复现、可分享。"
               "核心引擎与真实 pandas 逐项比对，一百二十六个单元测试全部通过；"
               "另有十四个端到端测试在真实浏览器里跑通全流程。",
        "zh": "让分析过程可见、可复现、可分享；引擎与真实 pandas 逐项比对，126 个单测 + 14 个端到端测试全部通过",
        "en": "The process made visible, reproducible and shareable. Verified against real pandas: 126 unit tests and 14 end-to-end tests passing",
        "hold": 1.4,
    },
]


async def synth() -> None:
    durations = []
    for i, scene in enumerate(SCENES):
        path = os.path.join(OUT, f"seg-{i:02d}.mp3")
        communicate = edge_tts.Communicate(scene["say"], VOICE, rate=RATE)
        await communicate.save(path)
        size = os.path.getsize(path)
        durations.append({"index": i, "id": scene["id"], "file": os.path.basename(path), "bytes": size})
        print(f"  [{i:02d}] {scene['id']:<12} {size / 1024:6.1f} KB")

    with open(os.path.join(OUT, "scenes.json"), "w", encoding="utf-8") as f:
        json.dump(SCENES, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, "tts.json"), "w", encoding="utf-8") as f:
        json.dump(durations, f, ensure_ascii=False, indent=1)
    print(f"\nwrote {len(SCENES)} segments to {OUT}")


if __name__ == "__main__":
    asyncio.run(synth())
    subprocess.run(["python", os.path.join(HERE, "durations.py")], check=True)
