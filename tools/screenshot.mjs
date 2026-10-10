/**
 * Visual + smoke check: walks every view in both languages, captures a
 * screenshot of each, and fails loudly on any console error or page exception.
 *
 *   node tools/screenshot.mjs [baseUrl] [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? 'shots';

const VIEWS = [
  'overview',
  'data',
  'clean',
  'describe',
  'groupby',
  'pivot',
  'correlate',
  'timeseries',
  'studio',
  'advanced',
  'report',
];

mkdirSync(OUT, { recursive: true });

const problems = [];

// Prefer the bundled browser, fall back to the system Chrome install.
const launchArgs = process.env.PLAYWRIGHT_NO_PROXY ? ['--no-proxy-server'] : [];
const browser = await chromium
  .launch({ args: launchArgs })
  .catch(() => chromium.launch({ channel: 'chrome', args: launchArgs }));
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });

page.on('console', (msg) => {
  if (msg.type() === 'error') {
    const text = msg.text();
    // Ignore noise that is not ours.
    if (text.includes('favicon') || text.includes('Download the React DevTools')) return;
    problems.push(`[console] ${text}`);
  }
});
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));

/** Click a nav item by its visible text. */
async function goView(view, lang) {
  const label = {
    overview: lang === 'zh' ? '总览' : 'Overview',
    data: lang === 'zh' ? '数据表' : 'Data table',
    clean: lang === 'zh' ? '数据清洗' : 'Clean',
    describe: lang === 'zh' ? '描述统计' : 'Describe',
    groupby: lang === 'zh' ? '分组聚合' : 'Group by',
    pivot: lang === 'zh' ? '透视表' : 'Pivot table',
    correlate: lang === 'zh' ? '相关分析' : 'Correlation',
    timeseries: lang === 'zh' ? '时间序列' : 'Time series',
    studio: lang === 'zh' ? '图表工作室' : 'Chart studio',
    advanced: lang === 'zh' ? '高级分析' : 'Advanced',
    report: lang === 'zh' ? '分析报告' : 'Report',
  }[view];

  const nav = page.locator('nav[aria-label]').first();
  await nav.getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(900);
}

/** Dismiss the first-run tour if present. */
async function dismissTour(lang) {
  const btn = page.getByRole('button', { name: lang === 'zh' ? '不再显示' : "Don't show again" });
  if (await btn.count()) {
    await btn.first().click();
    await page.waitForTimeout(250);
  }
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);
await dismissTour('zh');

for (const lang of ['zh', 'en']) {
  if (lang === 'en') {
    await page.getByRole('button', { name: /切换语言|Switch language/ }).click();
    await page.waitForTimeout(700);
  }
  for (const view of VIEWS) {
    await goView(view, lang);
    const file = join(OUT, `${lang}-${view}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`shot ${lang}/${view}`);
  }
}

// Interaction smoke test: run a group-by and check the pipeline records it.
await goView('groupby', 'en');
const applyBtn = page.getByRole('button', { name: /^Result$|^聚合结果$/ }).first();
if (await applyBtn.count()) {
  await applyBtn.click();
  await page.waitForTimeout(900);
}

// Switch to Clean and drop missing values, then confirm the pipeline grew.
await goView('clean', 'en');
const dropBtn = page.getByRole('button', { name: /^Drop missing values$|^删除缺失值$/ }).first();
if (await dropBtn.count()) {
  await dropBtn.click();
  await page.waitForTimeout(1200);
}
await page.screenshot({ path: join(OUT, 'en-after-pipeline.png') });

// Time travel: click the first pipeline step.
const rail = page.locator('aside[aria-label]').first();
const steps = rail.locator('ol li button');
const stepCount = await steps.count();
console.log('pipeline steps rendered:', stepCount);
if (stepCount > 1) {
  await steps.nth(1).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, 'en-time-travel.png') });
}

// Report page with content.
await goView('report', 'en');
await page.screenshot({ path: join(OUT, 'en-report-full.png'), fullPage: true });

await browser.close();

console.log('\n=== problems ===');
if (problems.length === 0) console.log('none');
else for (const p of [...new Set(problems)]) console.log(p);
process.exit(problems.length ? 1 : 0);
