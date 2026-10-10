/**
 * Records the demo video.
 *
 * Drives the real app through a scripted walkthrough at 1920x1080, showing a
 * bilingual subtitle bar as part of the page DOM. Putting the captions in the
 * page (rather than burning them in with ffmpeg) means no libass dependency
 * and captions that are pixel-identical to the rest of the UI.
 *
 * Scene timings come from tools/video/out/timeline.json, which is derived from
 * the actual TTS audio durations, so picture and narration stay in step.
 *
 *   node tools/video/record.mjs [baseUrl]
 * Out: tools/video/out/demo.webm + tools/video/out/recorded.json
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const BASE = process.argv[2] ?? 'http://localhost:4173';

mkdirSync(OUT, { recursive: true });
const timeline = JSON.parse(readFileSync(join(OUT, 'timeline.json'), 'utf8'));

const VIEWPORT = { width: 1920, height: 1080 };

const browser = await chromium
  .launch()
  .catch(() => chromium.launch({ channel: 'chrome' }));

const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: VIEWPORT },
  locale: 'zh-CN',
});

// Skip the first-run tour and start in Chinese.
await context.addInitScript(() => {
  try {
    localStorage.setItem('datalens.tourSeen', '1');
    localStorage.setItem('datalens.lang', 'zh');
    localStorage.setItem('datalens.theme', 'dark');
  } catch {
    /* ignore */
  }
});

const page = await context.newPage();

/* ---------------- subtitle overlay ---------------- */

const SUBTITLE_CSS = `
#__cap {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483000;
  display: flex; justify-content: center; pointer-events: none;
  padding: 0 60px 42px;
  font-family: ui-sans-serif, system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
#__cap .box {
  max-width: 1320px; text-align: center;
  background: rgba(8, 11, 18, .80);
  backdrop-filter: blur(14px) saturate(140%);
  border: 1px solid rgba(255,255,255,.10);
  border-radius: 14px; padding: 14px 26px 15px;
  box-shadow: 0 18px 48px -16px rgba(0,0,0,.8);
}
#__cap .zh { color: #fff; font-size: 27px; font-weight: 600; line-height: 1.38; letter-spacing: .01em; }
#__cap .en { color: #a9b4c8; font-size: 17px; line-height: 1.42; margin-top: 6px; }
#__cap.brand .box { background: transparent; border: none; box-shadow: none; backdrop-filter: none; padding: 0; }
/* A stand-in for the browser's address bar, so URL routing is visible on video. */
#__url {
  position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
  z-index: 2147483001; pointer-events: none;
  display: none; align-items: center; gap: 9px;
  max-width: 900px; padding: 9px 16px;
  background: rgba(8, 11, 18, .86);
  backdrop-filter: blur(14px) saturate(140%);
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 999px;
  box-shadow: 0 14px 36px -14px rgba(0,0,0,.85);
  font: 15px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #e8ebf2;
}
#__url.on { display: inline-flex; }
#__url .dot { width: 9px; height: 9px; border-radius: 999px; background: #3ddc97; box-shadow: 0 0 10px #3ddc97; }
#__url .host { color: #8592a8; }
#__url .hash { color: #a99cff; font-weight: 600; }
/* A badge used to call out what just happened. */
#__badge {
  position: fixed; top: 14px; right: 18px; z-index: 2147483001; pointer-events: none;
  display: none; padding: 9px 15px; border-radius: 999px;
  background: rgba(124, 108, 255, .95); color: #fff;
  font-family: ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 15px; font-weight: 600;
  box-shadow: 0 14px 36px -14px rgba(124,108,255,.9);
}
#__badge.on { display: block; }
`;

async function installOverlay() {
  await page.addStyleTag({ content: SUBTITLE_CSS });
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = '__cap';
    el.innerHTML = '<div class="box"><div class="zh"></div><div class="en"></div></div>';
    document.body.appendChild(el);

    const url = document.createElement('div');
    url.id = '__url';
    url.innerHTML = '<span class="dot"></span><span class="host"></span><span class="hash"></span>';
    document.body.appendChild(url);

    const badge = document.createElement('div');
    badge.id = '__badge';
    document.body.appendChild(badge);
  });
}

/** Show or hide the stand-in address bar. */
async function setUrlBar(on) {
  await page.evaluate((v) => document.getElementById('__url')?.classList.toggle('on', v), on);
  if (on) await refreshUrlBar();
}

/** Paint the current URL into the stand-in address bar. */
async function refreshUrlBar() {
  const hash = await page.evaluate(() => window.location.hash || '#/overview');
  await page.evaluate(
    ({ hash }) => {
      const el = document.getElementById('__url');
      if (!el) return;
      el.querySelector('.host').textContent = 'datalens.vercel.app/';
      el.querySelector('.hash').textContent = hash;
    },
    { hash },
  );
}

async function setBadge(text) {
  await page.evaluate((t) => {
    const el = document.getElementById('__badge');
    if (!el) return;
    el.textContent = t ?? '';
    el.classList.toggle('on', Boolean(t));
  }, text);
}

async function setSubtitle(zh, en, brand = false) {
  await page.evaluate(
    ({ zh, en, brand }) => {
      const el = document.getElementById('__cap');
      if (!el) return;
      el.classList.toggle('brand', brand);
      el.querySelector('.zh').textContent = zh ?? '';
      el.querySelector('.en').textContent = en ?? '';
    },
    { zh, en, brand },
  );
}

/* ---------------- navigation helpers ---------------- */

const NAV = {
  overview: ['总览', 'Overview'],
  data: ['数据表', 'Data table'],
  clean: ['数据清洗', 'Clean'],
  describe: ['描述统计', 'Describe'],
  groupby: ['分组聚合', 'Group by'],
  pivot: ['透视表', 'Pivot table'],
  correlate: ['相关分析', 'Correlation'],
  timeseries: ['时间序列', 'Time series'],
  studio: ['图表工作室', 'Chart studio'],
  advanced: ['高级分析', 'Advanced'],
  report: ['分析报告', 'Report'],
};

let lang = 'zh';

async function go(view) {
  const label = NAV[view][lang === 'zh' ? 0 : 1];
  const nav = page.locator('nav[aria-label]').first();
  const btn = nav.getByRole('button', { name: label, exact: true });
  await btn.click({ timeout: 15000 });
  await page.waitForTimeout(700);
}

/** Click a button by a regex on its accessible name, if it exists. */
async function clickIf(re, opts = {}) {
  const b = page.getByRole('button', { name: re }).first();
  try {
    if (await b.count()) {
      await b.click({ timeout: 6000, ...opts });
      return true;
    }
  } catch {
    /* the control may be disabled or covered — the scene still works */
  }
  return false;
}

/** Wait until `startedAt + budget` has elapsed, so scenes match the narration. */
async function fill(startedAt, budget) {
  const elapsed = (Date.now() - startedAt) / 1000;
  const remaining = budget - elapsed;
  if (remaining > 0) await page.waitForTimeout(remaining * 1000);
}

/* ---------------- scene actions ---------------- */

const ACTIONS = {
  async intro() {
    await setSubtitle('DataLens · 可视化 pandas', 'DataLens · A visual pandas', true);
  },

  async overview() {
    await setSubtitle('数据总览：规模、健康分与逐列画像', 'Overview: size, health score and per-column profile');
    await go('overview');
  },

  async insights() {
    await setSubtitle('自动洞察 → 点击「去分析」直接跳转', 'Automatic insights → Analyze jumps straight there');
    await page.mouse.move(1200, 520);
    await page.waitForTimeout(900);
    // Jump via the first insight's action link.
    const link = page.getByRole('button', { name: /去分析|Analyze/ }).first();
    if (await link.count()) await link.click().catch(() => {});
    await page.waitForTimeout(1200);
    await go('overview');
  },

  async data() {
    await setSubtitle('数据表：排序、搜索、筛选前预览影响行数', 'Data table: sort, search, and filter previews');
    await go('data');
    await page.waitForTimeout(600);
    // Open the filter builder so the preview is visible.
    await clickIf(/^筛选$|^Filter$/);
    await page.waitForTimeout(1400);
  },

  async clean() {
    await setSubtitle('数据清洗：缺失分布图，操作先预览再执行', 'Cleaning: missingness map, effects previewed first');
    await go('clean');
    await page.waitForTimeout(900);
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(700);
  },

  async pipeline() {
    await setSubtitle('分析流水线：记录每一步的行数 / 空值变化', 'Pipeline: every step with its row and null deltas');
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(400);
    await clickIf(/^删除缺失值$|^Drop missing values$/);
    await page.waitForTimeout(1600);
    await setSubtitle('每一步都实时生成等价的 pandas 代码', 'Every step is mirrored as equivalent pandas code');
    await clickIf(/^代码$|^Code$/);
    await page.waitForTimeout(2000);
  },

  async timetravel() {
    await setSubtitle('时间旅行：点击历史步骤回看当时的数据', 'Time travel: click a step to see the data as it was');
    const rail = page.locator('aside[aria-label]').first();
    const steps = rail.locator('ol li button');
    if ((await steps.count()) > 1) {
      await steps.nth(1).click().catch(() => {});
      await page.waitForTimeout(1800);
      await steps.nth(0).click().catch(() => {});
      await page.waitForTimeout(900);
    }
    await clickIf(/^步骤$|^Step$/);
    await page.waitForTimeout(700);
  },

  async describe() {
    await setSubtitle('描述统计：20 项指标 + 自动统计解读', 'Describe: 20 metrics plus a plain-language read-out');
    await go('describe');
    await page.waitForTimeout(800);
    await page.mouse.wheel(0, 420);
    await page.waitForTimeout(1400);
  },

  async groupby() {
    await setSubtitle('分组聚合：女性生存率 74% vs 男性 19%', 'Group by: 74% survival for women vs 19% for men');
    await go('groupby');
    await page.waitForTimeout(1800);
  },

  async pivot() {
    await setSubtitle('透视表：性别 × 登船港口的生存率热力图', 'Pivot: survival across sex × embarkation port');
    await go('pivot');
    await page.waitForTimeout(2000);
  },

  async correlate() {
    await setSubtitle('相关分析：点击矩阵单元格查看散点与回归', 'Correlation: click a cell for scatter and regression');
    await go('correlate');
    await page.waitForTimeout(900);
    await page.mouse.wheel(0, 520);
    await page.waitForTimeout(2200);
  },

  async timeseries() {
    await setSubtitle('切换到含日期的电商销售数据…', 'Switching to the dated e-commerce dataset…');
    await go('overview');
    await clickIf(/^加载数据$|^Load data$/);
    await page.waitForTimeout(900);
    const card = page.getByRole('button', { name: /电商销售订单|E-commerce orders/ }).first();
    if (await card.count()) await card.click().catch(() => {});
    await page.waitForTimeout(2600);
    await setSubtitle('时间序列：重采样、滑动窗口、季节性与预测', 'Time series: resample, rolling, seasonality, forecast');
    await go('timeseries');
    await page.waitForTimeout(2600);
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(1600);
  },

  async advanced() {
    await setSubtitle('高级分析：回归系数、t 值、p 值与 VIF', 'Advanced: coefficients, t, p and VIF');
    await go('advanced');
    await page.waitForTimeout(2400);
    await setSubtitle('K-Means 聚类：肘部图与轮廓系数', 'K-means: elbow plot and silhouette score');
    await clickIf(/^聚类分析$|^Clustering$/);
    await page.waitForTimeout(2600);
  },

  async report() {
    await setSubtitle('图表工作室：把关键图表加入报告', 'Chart studio: collect the key charts');
    await go('studio');
    await page.waitForTimeout(1500);
    await clickIf(/^加入报告$|^Add to report$/);
    await page.waitForTimeout(900);
    await setSubtitle('一键导出单文件 HTML 报告（图表内联）', 'Export a single self-contained HTML report');
    await go('report');
    await page.waitForTimeout(2200);
  },

  async project() {
    await setSubtitle(
      '导出分析工程：文件里只有操作与参数，数据不出浏览器',
      'Export a project: the file records operations, not data',
    );
    // Re-load Titanic: it has missing values, so the drop step does real work.
    await go('overview');
    await clickIf(/^加载数据$|^Load data$/);
    await page.waitForTimeout(800);
    const titanic = page.getByRole('button', { name: /泰坦尼克号|Titanic/ }).first();
    if (await titanic.count()) await titanic.click().catch(() => {});
    await page.waitForTimeout(2600);
    await go('clean');
    await clickIf(/^删除缺失值$|^Drop missing values$/);
    await page.waitForTimeout(1500);

    const rail = page.locator('aside[aria-label]').first();
    // Export for real, and keep the file so it can be re-imported on camera.
    const download = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    await rail.getByRole('button', { name: /导出分析工程|Export project/ }).click().catch(() => {});
    const file = await download;
    let projectPath = null;
    if (file) {
      projectPath = join(OUT, '_demo.daproj.json');
      await file.saveAs(projectPath);
      await setBadge('✓ analysis.daproj.json');
      await page.waitForTimeout(1100);
    }

    // Clear everything, then restore it from the file.
    page.once('dialog', (d) => void d.accept());
    await rail.getByRole('button', { name: /清空全部|Clear all/ }).click().catch(() => {});
    await page.waitForTimeout(1500);
    await setSubtitle('清空流水线，恢复到未分析的状态', 'Pipeline cleared — back to the raw data');
    await setBadge('');
    await page.waitForTimeout(1100);

    if (projectPath) {
      await setSubtitle(
        '导入刚才的工程文件：每一步和结果原样恢复（891 → 182 行）',
        'Import the project file: every step and result comes back (891 → 182 rows)',
      );
      await rail.getByRole('button', { name: /导入分析工程|Import project/ }).click().catch(() => {});
      await page.waitForTimeout(400);
      await rail.locator('input[type="file"]').setInputFiles(projectPath).catch(() => {});
      await page.waitForTimeout(2200);
      await setBadge('✓ 已恢复：删除缺失值 891 → 182');
      await page.waitForTimeout(1200);
    }
    await setBadge('');
  },

  async share() {
    await setSubtitle(
      '每个页面都有自己的网址，直接把链接发给别人就能打开同一页',
      'Every view has its own URL — send the link and it opens the same page',
    );
    await setUrlBar(true);
    await go('correlate');
    await refreshUrlBar();
    await page.waitForTimeout(1200);
    await go('timeseries');
    await refreshUrlBar();
    await page.waitForTimeout(1000);
    await setSubtitle('浏览器的前进 / 后退在页面之间正常切换', 'Browser back and forward move between views');
    await page.goBack();
    await page.waitForTimeout(1200);
    await refreshUrlBar();
    await page.goForward();
    await page.waitForTimeout(1200);
    await refreshUrlBar();
    await page.waitForTimeout(700);
    // The address pill stays up until the next scene takes over.
  },

  async bilingual() {
    await setUrlBar(false);
    await setSubtitle('中英双语：由类型系统强制对齐', 'Bilingual, enforced by the type system');
    await clickIf(/切换语言|Switch language/);
    lang = 'en';
    await page.waitForTimeout(1500);
    await go('overview');
    await page.waitForTimeout(1200);
  },

  async outro() {
    await setSubtitle(
      'DataLens · 让分析过程可见、可复现、可分享',
      'DataLens · the process made visible, reproducible, shareable',
      true,
    );
    await go('overview');
  },
};

/* ---------------- run ---------------- */

await page.goto(BASE, { waitUntil: 'networkidle' });
const tAfterLoad = Date.now();
await page.waitForTimeout(2500);
await installOverlay();

const marks = [];
for (const scene of timeline.scenes) {
  const started = Date.now();
  marks.push({ id: scene.id, at: started });
  console.log(`scene ${scene.index} ${scene.id} (${scene.length}s)`);
  const action = ACTIONS[scene.id];
  if (action) {
    await action().catch((e) => console.warn(`  action ${scene.id} failed: ${e.message}`));
  }
  await fill(started, scene.length);
}

const planned = timeline.total;
const video = page.video();
await context.close();
await browser.close();

const path = video ? await video.path() : null;
writeFileSync(
  join(OUT, 'recorded.json'),
  JSON.stringify(
    {
      video: path,
      plannedSeconds: planned,
      // Wall-clock anchors: the muxer needs these to line the narration up
      // with the picture without guessing from the file's duration metadata.
      tAfterLoad,
      marks: marks.map((m) => m.at),
      scenes: timeline.scenes,
    },
    null,
    1,
  ),
);
console.log('\nrecorded:', path);
console.log('planned seconds:', planned);
