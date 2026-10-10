/**
 * Deep interaction audit.
 *
 * Unlike tools/screenshot.mjs (which only visits views), this drives the real
 * controls in every view and reports anything that throws, plus a screenshot of
 * each view after interaction so the layout can be eyeballed.
 *
 *   node tools/audit.mjs [baseUrl] [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
const OUT = process.argv[3] ?? 'shots/audit';

/**
 * Launch Chromium, honouring PLAYWRIGHT_NO_PROXY=1. A machine with an
 * unreachable system proxy (a VPN client, say) will otherwise hang on external
 * URLs, so set that variable when pointing these tools at a deployed site.
 */
async function launchBrowser() {
  const args = process.env.PLAYWRIGHT_NO_PROXY ? ['--no-proxy-server'] : [];
  return chromium.launch({ args }).catch(() => chromium.launch({ channel: 'chrome', args }));
}

mkdirSync(OUT, { recursive: true });

const problems = [];
let currentPhase = 'boot';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (text.includes('favicon') || text.includes('Download the React DevTools')) return;
  if (text.includes('Failed to load resource') && text.includes('favicon')) return;
  problems.push(`[console @${currentPhase}] ${text}`);
});
page.on('pageerror', (err) => problems.push(`[pageerror @${currentPhase}] ${err.message}`));
page.on('requestfailed', (req) => {
  const u = req.url();
  if (u.includes('favicon')) return;
  problems.push(`[netfail @${currentPhase}] ${req.method()} ${u} — ${req.failure()?.errorText}`);
});

const log = (...a) => console.log(`  ${a.join(' ')}`);

async function boot() {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('datalens.tourSeen', '1');
      localStorage.setItem('datalens.lang', 'zh');
      localStorage.removeItem('datalens.theme');
    } catch {
      /* ignore */
    }
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
}

const NAV = {
  overview: '总览',
  data: '数据表',
  clean: '数据清洗',
  describe: '描述统计',
  groupby: '分组聚合',
  pivot: '透视表',
  correlate: '相关分析',
  timeseries: '时间序列',
  studio: '图表工作室',
  advanced: '高级分析',
  report: '分析报告',
};

async function goView(view) {
  const nav = page.locator('nav[aria-label]').first();
  await nav.getByRole('button', { name: NAV[view], exact: true }).click();
  await page.waitForTimeout(700);
}

/** Click a control by role+name if it exists; never throws. */
async function click(role, name, { nth = 0, wait = 700, optional = true } = {}) {
  try {
    const loc = page.getByRole(role, { name }).nth(nth);
    if ((await loc.count()) === 0) {
      if (!optional) problems.push(`[missing @${currentPhase}] ${role} "${name}" not found`);
      return false;
    }
    await loc.click({ timeout: 5000 });
    await page.waitForTimeout(wait);
    return true;
  } catch (e) {
    problems.push(`[clickfail @${currentPhase}] ${role} "${name}": ${e.message.split('\n')[0]}`);
    return false;
  }
}

async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

/* ------------------------------------------------------------------ *
 * Sweep: click every button/select/tab inside the main canvas
 * ------------------------------------------------------------------ */

async function sweepCanvas(label) {
  const main = page.locator('#main');
  const buttons = main.locator('button:visible');
  const count = Math.min(await buttons.count(), 40);
  let clicked = 0;
  for (let i = 0; i < count; i++) {
    const btn = buttons.nth(i);
    try {
      if (!(await btn.isEnabled())) continue;
      await btn.scrollIntoViewIfNeeded({ timeout: 2000 });
      await btn.click({ timeout: 3000 });
      clicked++;
      await page.waitForTimeout(260);
    } catch {
      /* a control moved or was covered — keep going */
    }
  }
  log(`${label}: clicked ${clicked}/${count} controls`);
}

/* ------------------------------------------------------------------ *
 * Per-view targeted flows
 * ------------------------------------------------------------------ */

async function auditOverview() {
  currentPhase = 'overview';
  await goView('overview');
  await shot('01-overview');
  // Insight deep links: the first 「去分析」 chip.
  const links = page.getByRole('button', { name: /去分析/ });
  const n = await links.count();
  log(`overview: ${n} insight deep-links`);
  if (n > 0) {
    await links.first().click();
    await page.waitForTimeout(900);
    await shot('01b-insight-deeplink');
    await goView('overview');
  }
}

async function auditData() {
  currentPhase = 'data';
  await goView('data');
  await shot('02-data');

  // Sort via a column header.
  const headers = page.locator('#main table thead th button, #main table thead th [role="button"]');
  const hc = await headers.count();
  log(`data: ${hc} interactive column headers`);
  if (hc > 0) {
    await headers.nth(0).click().catch(() => {});
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // Search box.
  const search = page.locator('#main input[type="search"], #main input[placeholder*="搜索"], #main input[placeholder*="earch"]').first();
  if (await search.count()) {
    await search.fill('Rose');
    await page.waitForTimeout(800);
    await shot('02b-data-search');
    await search.fill('');
    await page.waitForTimeout(400);
  } else {
    problems.push('[missing @data] search input not found');
  }

  // Filter builder.
  await click('button', /筛选|Filter/, { wait: 600 });
  await shot('02c-data-filter');

  // Pagination / page-size control.
  const pager = page.getByRole('button', { name: /下一页|Next/ });
  if (await pager.count()) {
    await pager.first().click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Column menu on the first header.
  if (hc > 0) {
    const menu = page.locator('#main table thead th').nth(0).locator('button').last();
    await menu.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    await shot('02d-column-menu');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

async function auditClean() {
  currentPhase = 'clean';
  await goView('clean');
  await shot('03-clean');
  await sweepCanvas('clean');
  await shot('03b-clean-after-sweep');
}

async function auditDescribe() {
  currentPhase = 'describe';
  await goView('describe');
  await shot('04-describe');
  await sweepCanvas('describe');
  await shot('04b-describe-after-sweep');
}

async function auditGroupBy() {
  currentPhase = 'groupby';
  await goView('groupby');
  await shot('05-groupby');
  await sweepCanvas('groupby');
  await shot('05b-groupby-after-sweep');
}

async function auditPivot() {
  currentPhase = 'pivot';
  await goView('pivot');
  await shot('06-pivot');
  await sweepCanvas('pivot');
  await shot('06b-pivot-after-sweep');
}

async function auditCorrelate() {
  currentPhase = 'correlate';
  await goView('correlate');
  await shot('07-correlate');
  // Click a heatmap cell → the scatter panel.
  const cell = page.locator('#main canvas').first();
  if (await cell.count()) {
    const box = await cell.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.4);
      await page.waitForTimeout(900);
      await shot('07b-correlate-cell');
    }
  }
  await sweepCanvas('correlate');
  await shot('07c-correlate-after-sweep');
}

async function auditTimeSeries() {
  currentPhase = 'timeseries';
  await goView('timeseries');
  await shot('08-timeseries-empty');
  // Titanic has no date column — load the dated sample from the empty state.
  await click('button', /加载含日期的示例数据|dated sample/, { wait: 3500 });
  await shot('08b-timeseries-loaded');
  await sweepCanvas('timeseries');
  await shot('08c-timeseries-after-sweep');
}

async function auditStudio() {
  currentPhase = 'studio';
  await goView('studio');
  await shot('09-studio');
  await sweepCanvas('studio');
  await shot('09b-studio-after-sweep');
}

async function auditAdvanced() {
  currentPhase = 'advanced';
  await goView('advanced');
  await shot('10-advanced');
  await sweepCanvas('advanced');
  await shot('10b-advanced-after-sweep');
}

async function auditReport() {
  currentPhase = 'report';
  await goView('report');
  await shot('11-report');
  await sweepCanvas('report');
  await shot('11b-report-after-sweep');
}

/* ------------------------------------------------------------------ *
 * Cross-cutting flows
 * ------------------------------------------------------------------ */

async function auditPipeline() {
  currentPhase = 'pipeline';
  const rail = page.locator('aside[aria-label]').first();
  if (!(await rail.count())) {
    problems.push('[missing @pipeline] pipeline rail not found');
    return;
  }
  await rail.getByRole('tab', { name: /代码|Code/ }).click().catch(() => {});
  await page.waitForTimeout(600);
  await shot('12-code-mirror');

  const copy = rail.getByRole('button', { name: /复制|Copy/ }).first();
  if (await copy.count()) {
    await copy.click().catch((e) => problems.push(`[clickfail @pipeline] copy: ${e.message.split('\n')[0]}`));
    await page.waitForTimeout(500);
  }

  await click('button', /导出工程|Export project/, { wait: 1500 });
  await click('button', /导入工程|Import project/, { wait: 800 });
  await shot('12b-project-io');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

async function auditDatasets() {
  currentPhase = 'datasets';
  const samples = [
    [/泰坦尼克号|Titanic/, 'titanic'],
    [/电商销售|E-commerce/, 'sales'],
    [/鸢尾花|Iris/, 'iris'],
    [/空气质量|Air quality/, 'airquality'],
    [/全球发展|Global development/, 'gapminder'],
    [/大规模订单|Large orders/, 'bigsales'],
  ];
  for (const [re, id] of samples) {
    await click('button', /加载数据|Load data|数据|Load/, { wait: 400 });
    await page.waitForTimeout(400);
    const card = page.getByRole('button', { name: re }).first();
    if ((await card.count()) === 0) {
      problems.push(`[missing @datasets] sample card ${re} not found`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      continue;
    }
    await card.click();
    await page.waitForTimeout(id === 'bigsales' ? 6000 : 2500);
    const ok = await page.locator('#main').first().isVisible();
    log(`dataset ${id}: loaded=${ok}`);
    await shot(`13-dataset-${id}`);
    // Per-dataset smoke: overview + describe must render.
    await goView('overview');
    await goView('describe');
  }
  currentPhase = 'datasets-restore';
  await click('button', /加载数据|Load data|数据|Load/, { wait: 400 });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /泰坦尼克号/ }).first().click();
  await page.waitForTimeout(2500);
}

async function auditUpload() {
  currentPhase = 'upload';
  await page.getByRole('button', { name: /加载数据|Load data/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  const input = page.locator('input[type="file"]');
  if (await input.count()) {
    await input.setInputFiles('tests/fixtures/pandas_sample.csv');
    await page.waitForTimeout(2200);
    await shot('14-uploaded');
    log('upload: file loaded');
  } else {
    problems.push('[missing @upload] file input not found');
  }

  // Paste path.
  await page.getByRole('button', { name: /加载数据|Load data/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  await click('button', /粘贴|Paste/, { wait: 500 });
  const ta = page.locator('textarea').last();
  if (await ta.count()) {
    await ta.fill('a,b,c\n1,2,3\n4,5,6\n7,8,9');
    await click('button', /加载数据|Load data|解析|Parse/, { wait: 2000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    log('upload: paste path exercised');
  } else {
    problems.push('[missing @upload] paste textarea not found');
  }
  await shot('14b-after-upload');
}

async function auditLanguageAndTheme() {
  currentPhase = 'i18n';
  // English sweep.
  await page.getByRole('button', { name: /切换语言|Switch language/ }).click();
  await page.waitForTimeout(900);
  const EN_NAV = {
    overview: 'Overview',
    data: 'Data table',
    clean: 'Clean',
    describe: 'Describe',
    groupby: 'Group by',
    pivot: 'Pivot table',
    correlate: 'Correlation',
    timeseries: 'Time series',
    studio: 'Chart studio',
    advanced: 'Advanced',
    report: 'Report',
  };
  const nav = page.locator('nav[aria-label]').first();
  for (const [view, label] of Object.entries(EN_NAV)) {
    const btn = nav.getByRole('button', { name: label, exact: true });
    if ((await btn.count()) === 0) {
      problems.push(`[missing @i18n] English nav item "${label}" (${view})`);
      continue;
    }
    await btn.click();
    await page.waitForTimeout(650);
    await shot(`15-en-${view}`);
  }
  // Light theme on the overview.
  await page.getByRole('button', { name: /Toggle theme|切换主题/ }).click().catch(() => {});
  await page.waitForTimeout(700);
  await shot('16-light-overview');
  await page.getByRole('button', { name: /Toggle theme|切换主题/ }).click().catch(() => {});
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /切换语言|Switch language/ }).click();
  await page.waitForTimeout(700);
}

async function auditCommandPalette() {
  currentPhase = 'palette';
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(500);
  await shot('17-palette');
  const input = page.getByPlaceholder(/输入命令|Type a command/);
  if (await input.count()) {
    await input.fill('pivot');
    await page.waitForTimeout(600);
    await shot('17b-palette-query');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    log('palette: enter navigated');
  } else {
    problems.push('[missing @palette] palette input not found');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

async function auditShortcutsAndTour() {
  currentPhase = 'shortcuts';
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('?');
  await page.waitForTimeout(600);
  await shot('18-shortcuts');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Keyboard view cycling.
  await page.keyboard.press(']');
  await page.waitForTimeout(500);
  await page.keyboard.press('[');
  await page.waitForTimeout(500);
  // Pipeline + theme toggles.
  await page.keyboard.press('p');
  await page.waitForTimeout(500);
  await shot('19-pipeline-collapsed');
  await page.keyboard.press('p');
  await page.waitForTimeout(400);
  await page.keyboard.press('d');
  await page.waitForTimeout(500);
  await page.keyboard.press('d');
  await page.waitForTimeout(400);
}

async function auditExports() {
  currentPhase = 'exports';
  await goView('report');
  for (const [re, label] of [
    [/导出 HTML|Export HTML/, 'html'],
    [/导出 Markdown|Export Markdown/, 'md'],
    [/导出 CSV|Export CSV/, 'csv'],
    [/导出 Excel|Export Excel|xlsx/i, 'xlsx'],
    [/导出工程|Export project|工程/, 'project'],
  ]) {
    const btn = page.getByRole('button', { name: re }).first();
    if ((await btn.count()) === 0) {
      log(`export ${label}: control not present (may be behind a menu)`);
      continue;
    }
    try {
      const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
      await btn.click({ timeout: 5000 });
      const file = await dl;
      log(`export ${label}: ${file ? `downloaded ${await file.suggestedFilename()}` : 'no download event'}`);
      await page.waitForTimeout(600);
    } catch (e) {
      problems.push(`[exportfail @exports] ${label}: ${e.message.split('\n')[0]}`);
    }
  }
}

async function auditBranchAndTimeTravel() {
  currentPhase = 'timetravel';
  const rail = page.locator('aside[aria-label]').first();
  const steps = rail.locator('ol li');
  const n = await steps.count();
  log(`pipeline has ${n} entries`);
  if (n > 1) {
    await steps.nth(0).click().catch(() => {});
    await page.waitForTimeout(900);
    await shot('20-time-travel');
    const branch = rail.getByRole('button', { name: /从这里分叉|分支|Fork|Branch/ }).first();
    if (await branch.count()) {
      await branch.click().catch(() => {});
      await page.waitForTimeout(900);
      log('time travel: branch button clicked');
      await shot('20b-branch');
    } else {
      log('time travel: no branch control found');
    }
    await rail.getByRole('button', { name: /回到最新|最新|Latest/ }).first().click().catch(() => {});
    await page.waitForTimeout(700);
  }
}

/* ------------------------------------------------------------------ */

console.log(`Auditing ${BASE} …\n`);
await boot();
await shot('00-boot');

for (const fn of [
  auditOverview,
  auditData,
  auditClean,
  auditDescribe,
  auditGroupBy,
  auditPivot,
  auditCorrelate,
  auditTimeSeries,
  auditStudio,
  auditAdvanced,
  auditReport,
  auditPipeline,
  auditDatasets,
  auditUpload,
  auditBranchAndTimeTravel,
  auditLanguageAndTheme,
  auditCommandPalette,
  auditShortcutsAndTour,
  auditExports,
]) {
  console.log(`▶ ${fn.name}`);
  try {
    await fn();
  } catch (e) {
    problems.push(`[flowfail @${currentPhase}] ${fn.name}: ${e.message.split('\n')[0]}`);
  }
}

await browser.close();

console.log('\n=== problems ===');
const uniq = [...new Set(problems)];
if (uniq.length === 0) console.log('none');
else for (const p of uniq) console.log(p);
console.log(`\ntotal: ${uniq.length} unique problem(s)`);
process.exit(uniq.length ? 1 : 0);
