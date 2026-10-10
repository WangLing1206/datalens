/**
 * Focused bug repros. Each case gets a fresh page, so no state leaks between
 * them, and each is isolated so one throw does not abort the run.
 *
 *   node tools/repro.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
// PLAYWRIGHT_NO_PROXY=1 bypasses an unreachable system proxy (needed when
// pointing this at a deployed site from a machine behind a broken proxy).
const launchArgs = process.env.PLAYWRIGHT_NO_PROXY ? ['--no-proxy-server'] : [];
const browser = await chromium.launch({ args: launchArgs }).catch(() => chromium.launch({ channel: 'chrome', args: launchArgs }));

const results = [];
const firstLine = (e) => String(e && e.message ? e.message : e).split('\n')[0];
const report = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function withPage(fn) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message.split('\n')[0]}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (t.includes('favicon') || t.includes('Download the React DevTools')) return;
    errs.push(`console: ${t.split('\n')[0]}`);
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('datalens.tourSeen', '1');
      localStorage.setItem('datalens.lang', 'zh');
    } catch {
      /* ignore */
    }
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  try {
    await fn(page, errs);
  } finally {
    await page.close();
  }
}

const goView = async (page, label) => {
  await page.locator('nav[aria-label]').first().getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(800);
};

const openLoader = async (page) => {
  await page.getByRole('button', { name: '加载数据', exact: true }).first().click();
  await page.waitForTimeout(800);
};

const crashed = (page) => page.getByText(/出了点问题|渲染出错|Something went wrong/).count();

const cases = [
  [
    'groupby: line → heatmap renders',
    async (page, errs) => {
      await goView(page, '分组聚合');
      await page.getByRole('tab', { name: '折线图', exact: true }).first().click();
      await page.waitForTimeout(900);
      await page.getByRole('tab', { name: '热力图', exact: true }).first().click();
      await page.waitForTimeout(1400);
      await page.screenshot({ path: 'shots/audit/repro-1-groupby-heatmap.png' });
      const boundary = errs.filter((e) => e.includes('boundaryGap'));
      report(
        'groupby: line → heatmap renders',
        (await crashed(page)) === 0 && boundary.length === 0,
        boundary[0] ?? errs[0] ?? '',
      );
    },
  ],
  [
    'groupby: bar → line → heatmap → bar',
    async (page, errs) => {
      await goView(page, '分组聚合');
      for (const label of ['柱状图', '折线图', '热力图', '柱状图']) {
        await page.getByRole('tab', { name: label, exact: true }).first().click();
        await page.waitForTimeout(700);
      }
      await page.screenshot({ path: 'shots/audit/repro-2-bar-cycle.png' });
      report('groupby: bar → line → heatmap → bar', (await crashed(page)) === 0 && errs.length === 0, errs[0] ?? '');
    },
  ],
  [
    'pivot: every view mode',
    async (page, errs) => {
      await goView(page, '透视表');
      const bad = [];
      for (const label of ['热力图', '矩形树图', '堆叠柱状图', '数据表']) {
        const btn = page.getByRole('tab', { name: label, exact: true }).first();
        if ((await btn.count()) === 0) {
          bad.push(`${label}: control missing`);
          continue;
        }
        await btn.click();
        await page.waitForTimeout(900);
        if ((await crashed(page)) > 0 || errs.length > 0) bad.push(`${label}: ${errs[0] ?? 'error boundary'}`);
      }
      await page.screenshot({ path: 'shots/audit/repro-3-pivot.png' });
      report('pivot: every view mode', bad.length === 0, bad.join(' | '));
    },
  ],
  [
    'every sample dataset loads clean',
    async (page, errs) => {
      await openLoader(page);
      const cards = page.locator('[role="dialog"] button').filter({ hasText: /×/ });
      report('load panel: six sample cards', (await cards.count()) >= 6, `found ${await cards.count()}`);
      const bad = [];
      for (const name of ['鸢尾花', '空气质量', '全球发展指标', '电商销售订单', '大规模订单', '泰坦尼克号']) {
        const card = page.getByRole('button', { name: new RegExp(name) }).first();
        if ((await card.count()) === 0) {
          bad.push(`${name}: card missing`);
          continue;
        }
        await card.click();
        await page.waitForTimeout(name === '大规模订单' ? 7000 : 3000);
        if (errs.length > 0 || (await crashed(page)) > 0) bad.push(`${name}: ${errs[0] ?? 'error boundary'}`);
        await openLoader(page);
      }
      report('every sample dataset loads clean', bad.length === 0, bad.join(' | '));
    },
  ],
  [
    'paste: 4-row CSV loads',
    async (page, errs) => {
      await openLoader(page);
      await page.getByRole('button', { name: '粘贴数据', exact: true }).click();
      await page.waitForTimeout(500);
      await page
        .locator('textarea')
        .last()
        .fill('city,sales,month\nBeijing,120,2024-01\nShanghai,90,2024-02\nShenzhen,140,2024-03\nBeijing,160,2024-04');
      await page.getByRole('button', { name: '解析并加载', exact: true }).click();
      await page.waitForTimeout(2600);
      await page.screenshot({ path: 'shots/audit/repro-5-paste.png' });
      const seen = await page.getByText('city').first().count();
      report('paste: 4-row CSV loads', seen > 0 && errs.length === 0, errs[0] ?? '');
    },
  ],
  [
    'report: preview renders',
    async (page, errs) => {
      await goView(page, '分析报告');
      await page.waitForTimeout(1800);
      await page.screenshot({ path: 'shots/audit/repro-6-report.png' });
      const preview = await page.getByText('报告预览').count();
      report('report: preview renders', preview > 0 && (await crashed(page)) === 0, errs[0] ?? '');
    },
  ],
  [
    'timeseries: every window / granularity option',
    async (page, errs) => {
      await goView(page, '时间序列');
      const load = page.getByRole('button', { name: /加载含日期的示例数据/ });
      if (await load.count()) {
        await load.click();
        await page.waitForTimeout(3800);
      }
      const selects = page.locator('#main select');
      const sc = await selects.count();
      for (let i = 0; i < sc; i++) {
        const sel = selects.nth(i);
        const opts = await sel.locator('option').allTextContents();
        for (const o of opts.slice(0, 5)) {
          await sel.selectOption({ label: o }).catch(() => {});
          await page.waitForTimeout(380);
        }
      }
      await page.screenshot({ path: 'shots/audit/repro-7-timeseries.png' });
      report(
        'timeseries: every window / granularity option',
        (await crashed(page)) === 0 && errs.length === 0,
        errs.slice(0, 2).join(' | '),
      );
    },
  ],
  [
    'advanced: every algorithm runs',
    async (page, errs) => {
      await goView(page, '高级分析');
      const bad = [];
      for (const name of ['线性回归', '聚类分析', '主成分分析', '异常检测', '趋势预测']) {
        const btn = page.getByRole('tab', { name, exact: true }).first();
        if ((await btn.count()) === 0) {
          bad.push(`${name}: control missing`);
          continue;
        }
        await btn.click({ timeout: 6000 }).catch((e) => bad.push(`${name}: ${firstLine(e)}`));
        await page.waitForTimeout(3200);
        if ((await crashed(page)) > 0 || errs.length > 0) bad.push(`${name}: ${errs[0] ?? 'error boundary'}`);
      }
      await page.screenshot({ path: 'shots/audit/repro-8-advanced.png' });
      report('advanced: every algorithm runs', bad.length === 0, bad.join(' | '));
    },
  ],
  [
    'studio: sweep every chart type',
    async (page, errs) => {
      await goView(page, '图表工作室');
      const tabs = page.locator('#main [role="tablist"] button');
      const tc = Math.min(await tabs.count(), 24);
      for (let i = 0; i < tc; i++) {
        await tabs.nth(i).click().catch(() => {});
        await page.waitForTimeout(360);
      }
      await page.screenshot({ path: 'shots/audit/repro-9-studio.png' });
      report('studio: sweep every chart type', (await crashed(page)) === 0 && errs.length === 0, errs.slice(0, 2).join(' | '));
    },
  ],
  [
    'clean: every cleaning action',
    async (page, errs) => {
      await goView(page, '数据清洗');
      const bad = [];
      // Each section tab exposes its own apply button in the control column.
      for (const section of ['缺失值总览', '重复值处理', '异常值检测', '类型转换']) {
        const tab = page.getByRole('tab', { name: section, exact: true }).first();
        if ((await tab.count()) === 0) {
          bad.push(`${section}: tab missing`);
          continue;
        }
        await tab.click({ timeout: 6000 }).catch((e) => bad.push(`${section}: ${firstLine(e)}`));
        await page.waitForTimeout(900);
        // The primary apply button is the last enabled one in the control column.
        const apply = page.locator('#main button:enabled').filter({ hasText: /删除|填充|去重|处理|截断|替换|转换/ });
        const n = Math.min(await apply.count(), 2);
        for (let i = 0; i < n; i++) {
          await apply.nth(i).click({ timeout: 6000 }).catch(() => {});
          await page.waitForTimeout(1500);
        }
        if ((await crashed(page)) > 0 || errs.length > 0) bad.push(`${section}: ${errs[0] ?? 'error boundary'}`);
      }
      await page.screenshot({ path: 'shots/audit/repro-10-clean.png' });
      report('clean: every cleaning action', bad.length === 0, bad.join(' | '));
    },
  ],
  [
    'describe: chart mode switches',
    async (page, errs) => {
      await goView(page, '描述统计');
      const tabs = page.locator('#main [role="tablist"] button');
      const tc = Math.min(await tabs.count(), 16);
      for (let i = 0; i < tc; i++) {
        await tabs.nth(i).click().catch(() => {});
        await page.waitForTimeout(340);
      }
      await page.screenshot({ path: 'shots/audit/repro-11-describe.png' });
      report('describe: chart mode switches', (await crashed(page)) === 0 && errs.length === 0, errs.slice(0, 2).join(' | '));
    },
  ],
  [
    'correlate: method + cell selection',
    async (page, errs) => {
      await goView(page, '相关分析');
      const bad = [];
      for (const m of ['Pearson', 'Spearman', 'Kendall']) {
        const btn = page.getByRole('tab', { name: m, exact: true }).first();
        if ((await btn.count()) === 0) {
          bad.push(`${m}: control missing`);
          continue;
        }
        await btn.click();
        await page.waitForTimeout(1400);
      }
      const canvas = page.locator('#main canvas').first();
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);
        await page.waitForTimeout(1200);
      }
      await page.screenshot({ path: 'shots/audit/repro-12-correlate.png' });
      report('correlate: method + cell selection', bad.length === 0 && (await crashed(page)) === 0 && errs.length === 0, bad.concat(errs.slice(0, 1)).join(' | '));
    },
  ],
];

for (const [name, fn] of cases) {
  try {
    await withPage(fn);
  } catch (e) {
    report(name, false, `threw: ${String(e.message).split('\n')[0]}`);
  }
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log('failing:\n' + failed.map((f) => `  - ${f.name}: ${f.detail}`).join('\n'));
process.exit(failed.length ? 1 : 0);
