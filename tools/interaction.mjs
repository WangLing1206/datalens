/**
 * Interaction checks for the ergonomics work: URL routing, back/forward,
 * deep links, pipeline round-trips and the shortcut surface.
 *
 *   node tools/interaction.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));

const results = [];
const firstLine = (e) => String(e && e.message ? e.message : e).split('\n')[0];
const report = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function withPage(fn) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${firstLine(e)}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (t.includes('favicon') || t.includes('React DevTools')) return;
    errs.push(`console: ${firstLine(t)}`);
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('datalens.tourSeen', '1');
      localStorage.setItem('datalens.lang', 'zh');
    } catch {
      /* ignore */
    }
  });
  try {
    await fn(page, errs);
  } finally {
    await page.close();
  }
}

const cases = [
  [
    'deep link #/groupby opens that view',
    async (page, errs) => {
      await page.goto(`${BASE}/#/groupby`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      const heading = await page.locator('#main h1, #main h2').first().textContent();
      const title = await page.locator('header h1').first().textContent();
      report(
        'deep link #/groupby opens that view',
        /分组聚合/.test(title ?? '') && (await page.getByText('分组依据').count()) > 0,
        `header "${title}" heading "${heading}" ${errs[0] ?? ''}`,
      );
    },
  ],
  [
    'clicking a nav item writes the hash',
    async (page, errs) => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await page.locator('nav[aria-label]').first().getByRole('button', { name: '相关分析', exact: true }).click();
      await page.waitForTimeout(800);
      const hash = await page.evaluate(() => window.location.hash);
      report('clicking a nav item writes the hash', hash === '#/correlate', `hash=${hash} ${errs[0] ?? ''}`);
    },
  ],
  [
    'browser back returns to the previous view',
    async (page, errs) => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      const nav = page.locator('nav[aria-label]').first();
      await nav.getByRole('button', { name: '数据表', exact: true }).click();
      await page.waitForTimeout(700);
      await nav.getByRole('button', { name: '透视表', exact: true }).click();
      await page.waitForTimeout(700);
      await page.goBack();
      await page.waitForTimeout(900);
      const title = await page.locator('header h1').first().textContent();
      report('browser back returns to the previous view', /数据表/.test(title ?? ''), `now "${title}" ${errs[0] ?? ''}`);
    },
  ],
  [
    'language survives a deep link with ?lang=en',
    async (page, errs) => {
      await page.goto(`${BASE}/?lang=en#/describe`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3200);
      const title = await page.locator('header h1').first().textContent();
      const body = await page.locator('#main').innerText();
      report(
        'language survives a deep link with ?lang=en',
        /Describe/.test(title ?? '') && /Describe/.test(body) && !/[\u4e00-\u9fff]/.test(body),
        `header "${title}" ${errs[0] ?? ''}`,
      );
    },
  ],
  [
    'pipeline: run, undo, redo keeps shapes in sync',
    async (page, errs) => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await page.locator('nav[aria-label]').first().getByRole('button', { name: '数据清洗', exact: true }).click();
      await page.waitForTimeout(900);
      await page.getByRole('button', { name: '删除缺失值', exact: true }).first().click();
      await page.waitForTimeout(1400);
      const after = await page.getByText('182 × 15').first().count();
      const rail = page.locator('aside[aria-label]').first();
      await rail.getByRole('button', { name: '撤销' }).click();
      await page.waitForTimeout(900);
      const undone = await page.getByText('891 × 15').first().count();
      await rail.getByRole('button', { name: '重做' }).click();
      await page.waitForTimeout(900);
      const redone = await page.getByText('182 × 15').first().count();
      report('pipeline: run, undo, redo keeps shapes in sync', after > 0 && undone > 0 && redone > 0, errs[0] ?? '');
    },
  ],
  [
    'project export → import round-trips',
    async (page, errs) => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await page.locator('nav[aria-label]').first().getByRole('button', { name: '数据清洗', exact: true }).click();
      await page.waitForTimeout(900);
      await page.getByRole('button', { name: '删除缺失值', exact: true }).first().click();
      await page.waitForTimeout(1400);
      const dl = page.waitForEvent('download', { timeout: 15_000 });
      const rail = page.locator('aside[aria-label]').first();
      await rail.getByRole('button', { name: '导出分析工程' }).click();
      const file = await dl;
      const path = await file.path();
      // Clear the pipeline, then re-import the project file.
      page.on('dialog', (d) => d.accept());
      await rail.getByRole('button', { name: '清空全部' }).click();
      await page.waitForTimeout(1200);
      const cleared = await page.getByText('还没有任何操作').count();
      // The rail's own import button, not the loader's file input.
      await rail.getByRole('button', { name: '导入分析工程' }).click();
      await page.waitForTimeout(300);
      await rail.locator('input[type="file"]').setInputFiles(path);
      await page.waitForTimeout(2500);
      const restored = await page.getByText('删除缺失值').first().count();
      const shape = await page.getByText('182 × 15').first().count();
      report('project export → import round-trips', cleared > 0 && restored > 0 && shape > 0, errs[0] ?? '');
    },
  ],
  [
    'command palette navigates to a view',
    async (page, errs) => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(500);
      await page.getByPlaceholder(/输入命令|Type a command/).fill('时间序列');
      await page.waitForTimeout(600);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(900);
      const title = await page.locator('header h1').first().textContent();
      const hash = await page.evaluate(() => window.location.hash);
      report('command palette navigates to a view', /时间序列/.test(title ?? ''), `"${title}" hash=${hash} ${errs[0] ?? ''}`);
    },
  ],
  [
    'insight deep link prefills the target view',
    async (page, errs) => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3200);
      const link = page.getByRole('button', { name: /去分析/ }).first();
      await link.click();
      await page.waitForTimeout(1500);
      const title = await page.locator('header h1').first().textContent();
      const hash = await page.evaluate(() => window.location.hash);
      report('insight deep link prefills the target view', hash.startsWith('#/') && !/总览/.test(title ?? ''), `"${title}" hash=${hash} ${errs[0] ?? ''}`);
    },
  ],
  [
    'keyboard: [ ] cycle, ? opens shortcuts, p toggles the rail',
    async (page, errs) => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      await page.keyboard.press(']');
      await page.waitForTimeout(600);
      const moved = await page.locator('header h1').first().textContent();
      await page.keyboard.press('[');
      await page.waitForTimeout(600);
      const back = await page.locator('header h1').first().textContent();
      await page.keyboard.press('?');
      await page.waitForTimeout(600);
      const dialog = await page.getByText(/快捷键|Shortcuts/).first().count();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const railBefore = await page.locator('aside[aria-label]').count();
      await page.keyboard.press('p');
      await page.waitForTimeout(600);
      const railAfter = await page.locator('aside[aria-label]').count();
      report(
        'keyboard: [ ] cycle, ? opens shortcuts, p toggles the rail',
        moved !== back && dialog > 0 && railBefore !== railAfter,
        `${moved} → ${back}; dialog=${dialog}; rail ${railBefore}→${railAfter} ${errs[0] ?? ''}`,
      );
    },
  ],
];

for (const [name, fn] of cases) {
  try {
    await withPage(fn);
  } catch (e) {
    report(name, false, `threw: ${firstLine(e)}`);
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log('failing:\n' + failed.map((f) => `  - ${f.name}: ${f.detail}`).join('\n'));
process.exit(failed.length ? 1 : 0);
