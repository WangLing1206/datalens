/**
 * Bilingual consistency audit.
 *
 * The assignment requires the two languages to say the same thing. The type
 * system already guarantees every key exists in both dictionaries; this checks
 * the other half — that no hardcoded Chinese copy leaks into the English UI
 * (and vice versa for obviously-Chinese-only chrome).
 *
 *   node tools/i18n-audit.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
const OUT = 'shots/i18n';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.split('\n')[0]}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) problems.push(`console: ${m.text().split('\n')[0]}`);
});

const NAV_ZH = ['总览', '数据表', '数据清洗', '描述统计', '分组聚合', '透视表', '相关分析', '时间序列', '图表工作室', '高级分析', '分析报告'];
const NAV_EN = ['Overview', 'Data table', 'Clean', 'Describe', 'Group by', 'Pivot table', 'Correlation', 'Time series', 'Chart studio', 'Advanced', 'Report'];
const VIEW_IDS = ['overview', 'data', 'clean', 'describe', 'groupby', 'pivot', 'correlate', 'timeseries', 'studio', 'advanced', 'report'];

await page.addInitScript(() => {
  try {
    localStorage.setItem('datalens.tourSeen', '1');
  } catch {
    /* ignore */
  }
});
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2800);

/** All visible text inside the main canvas. */
async function canvasText() {
  return page.evaluate(() => {
    const main = document.getElementById('main');
    if (!main) return '';
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const out = [];
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (parent && parent.offsetParent !== null) {
        const t = node.textContent?.trim();
        if (t) out.push(t);
      }
      node = walker.nextNode();
    }
    return out.join('\n');
  });
}

async function goNav(label) {
  await page.locator('nav[aria-label]').first().getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(900);
}

const CJK = /[\u4e00-\u9fff]/;

/** Chinese chrome that is intentionally Chinese. */
const ZH_ALLOW = [/^中$/, /^第\s*\d+\s*步/, /^行$/, /^列$/];

async function sweepEnglish() {
  // Make sure we start in Chinese, then switch.
  const toggle = page.getByRole('button', { name: /切换语言|Switch language/ });
  await toggle.click();
  await page.waitForTimeout(900);

  for (let i = 0; i < VIEW_IDS.length; i++) {
    await goNav(NAV_EN[i]);
    const text = await canvasText();
    const leaks = [...new Set(text.split('\n').filter((t) => CJK.test(t) && !ZH_ALLOW.some((re) => re.test(t))))];
    if (leaks.length) {
      problems.push(`[en/${VIEW_IDS[i]}] Chinese text in English UI: ${leaks.slice(0, 5).join(' | ')}`);
    }
    await page.screenshot({ path: `${OUT}/en-${VIEW_IDS[i]}.png` });
    console.log(`en/${VIEW_IDS[i]}: ${leaks.length ? `${leaks.length} leak(s)` : 'clean'}`);
  }
}

async function sweepLightTheme() {
  // Runs after the Chinese sweep, so the UI is in Chinese here.
  await page.getByRole('button', { name: /Toggle dark or light theme|切换深色\/浅色主题/ }).click();
  await page.waitForTimeout(800);
  for (let i = 0; i < VIEW_IDS.length; i++) {
    await goNav(NAV_ZH[i]);
    await page.screenshot({ path: `${OUT}/light-${VIEW_IDS[i]}.png` });
  }
  console.log('light theme captured');
  await page.getByRole('button', { name: /Toggle dark or light theme|切换深色\/浅色主题/ }).click();
  await page.waitForTimeout(600);
}

async function sweepChinese() {
  await page.getByRole('button', { name: /切换语言|Switch language/ }).click();
  await page.waitForTimeout(900);
  for (let i = 0; i < VIEW_IDS.length; i++) {
    await goNav(NAV_ZH[i]);
    const text = await canvasText();
    // A Chinese screen should not be showing whole English sentences.
    const leaks = [...new Set(
      text
        .split('\n')
        .filter((t) => !CJK.test(t) && /\b[a-z]{2,}\s+[a-z]{2,}\s+[a-z]{2,}/.test(t) && !/pandas|df\.|numpy|int64|float64|object/.test(t)),
    )];
    if (leaks.length) problems.push(`[zh/${VIEW_IDS[i]}] English sentence in Chinese UI: ${leaks.slice(0, 5).join(' | ')}`);
    await page.screenshot({ path: `${OUT}/zh-${VIEW_IDS[i]}.png` });
    console.log(`zh/${VIEW_IDS[i]}: ${leaks.length ? `${leaks.length} leak(s)` : 'clean'}`);
  }
}

await sweepEnglish();
await sweepChinese();
await sweepLightTheme();

// The report preview must be fully localised too.
await goNav(NAV_ZH[10]);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/zh-report-preview.png` });

await browser.close();

console.log('\n=== problems ===');
const uniq = [...new Set(problems)];
if (!uniq.length) console.log('none');
else uniq.forEach((p) => console.log(p));
console.log(`\ntotal: ${uniq.length}`);
process.exit(uniq.length ? 1 : 0);
