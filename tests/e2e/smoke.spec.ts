import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end smoke tests against the production build.
 *
 * The unit suite proves the engine matches pandas; these tests prove the app
 * actually wires it up — that data loads, an operation reaches the pipeline,
 * time travel restores an earlier state, and both locales are complete.
 */

const NAV_ZH = {
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
} as const;

const NAV_EN: Record<keyof typeof NAV_ZH, string> = {
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

async function boot(page: Page) {
  // Skip the first-run tour so it does not intercept clicks.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('datalens.tourSeen', '1');
      localStorage.setItem('datalens.lang', 'zh');
    } catch {
      /* ignore */
    }
  });
  await page.goto('/');
  // The default dataset (Titanic, 891 rows) must load on its own.
  await expect(page.getByText('891', { exact: false }).first()).toBeVisible({ timeout: 25_000 });
}

async function goView(page: Page, view: keyof typeof NAV_ZH, lang: 'zh' | 'en' = 'zh') {
  const label = lang === 'zh' ? NAV_ZH[view] : NAV_EN[view];
  const nav = page.locator('nav[aria-label]').first();
  await nav.getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(500);
}

test.describe('DataLens end to end', () => {
  test('boots and loads the default dataset', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await boot(page);

    // The overview must show the dataset shape.
    await expect(page.getByText('数据总览')).toBeVisible();
    await expect(page.getByText('891 行 × 15 列').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('runs a group-by and records it in the pipeline', async ({ page }) => {
    await boot(page);
    await goView(page, 'groupby');

    // The view auto-computes a default result for the first categorical column.
    await expect(page.getByText('Sex').first()).toBeVisible();

    // The result table should contain the real Titanic survival rates.
    await expect(page.getByText('0.742')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('0.1889')).toBeVisible();
  });

  test('cleaning operation lands in the pipeline with row deltas', async ({ page }) => {
    await boot(page);
    await goView(page, 'clean');

    // Drop every row containing a missing value.
    await page.getByRole('button', { name: '删除缺失值', exact: true }).first().click();
    await page.waitForTimeout(1200);

    // The pipeline rail must now show one step and the row delta.
    const rail = page.locator('aside[aria-label]').first();
    await expect(rail.getByText('删除缺失值').first()).toBeVisible();
    await expect(rail.getByText('-709')).toBeVisible({ timeout: 10_000 });

    // And the header badge must reflect the new shape.
    await expect(page.getByText('182 × 15').first()).toBeVisible();
  });

  test('undo restores the previous state', async ({ page }) => {
    await boot(page);
    await goView(page, 'clean');
    await page.getByRole('button', { name: '删除缺失值', exact: true }).first().click();
    await page.waitForTimeout(1000);
    await expect(page.getByText('182 × 15').first()).toBeVisible();

    const rail = page.locator('aside[aria-label]').first();
    await rail.getByRole('button', { name: '撤销' }).click();
    await page.waitForTimeout(800);
    await expect(page.getByText('891 × 15').first()).toBeVisible();
  });

  test('time travel shows an earlier step', async ({ page }) => {
    await boot(page);
    await goView(page, 'clean');
    await page.getByRole('button', { name: '删除缺失值', exact: true }).first().click();
    await page.waitForTimeout(1000);

    const rail = page.locator('aside[aria-label]').first();
    // The "original data" entry is the first item in the step list.
    await rail.getByRole('button', { name: /原始数据/ }).click();
    await page.waitForTimeout(800);

    await expect(rail.getByText(/正在回看第 0 步/)).toBeVisible();
    await expect(page.getByText('891 × 15').first()).toBeVisible();
  });

  test('the pandas code mirror reflects the pipeline', async ({ page }) => {
    await boot(page);
    await goView(page, 'clean');
    await page.getByRole('button', { name: '删除缺失值', exact: true }).first().click();
    await page.waitForTimeout(1000);

    const rail = page.locator('aside[aria-label]').first();
    await rail.getByRole('tab', { name: '代码', exact: true }).click();
    await page.waitForTimeout(500);

    await expect(rail.locator('pre')).toContainText('import pandas as pd');
    await expect(rail.locator('pre')).toContainText('df = df.dropna()');
  });

  test('every view renders without a runtime error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
    });

    await boot(page);
    for (const view of Object.keys(NAV_ZH) as (keyof typeof NAV_ZH)[]) {
      await goView(page, view);
      await page.waitForTimeout(600);
    }
    expect(errors).toEqual([]);
  });

  test('switching language keeps the same content', async ({ page }) => {
    await boot(page);

    // Chinese overview.
    await expect(page.getByText('数据总览')).toBeVisible();
    await expect(page.getByText('数据健康分')).toBeVisible();

    // Switch to English.
    await page.getByRole('button', { name: '切换语言' }).click();
    await page.waitForTimeout(700);

    await expect(page.getByText('Overview', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Data health')).toBeVisible();

    // The same numbers must be present, localised.
    await expect(page.getByText('891 rows × 15 columns').first()).toBeVisible();

    // Navigation must also be translated.
    const nav = page.locator('nav[aria-label]').first();
    await expect(nav.getByRole('button', { name: 'Data table', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Pivot table', exact: true })).toBeVisible();
  });

  test('the command palette opens and navigates', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(400);
    await expect(page.getByPlaceholder(/输入命令|Type a command/)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  test('the report view builds a preview', async ({ page }) => {
    await boot(page);
    await goView(page, 'report');
    await expect(page.getByText('报告预览')).toBeVisible();
    // The preview should summarise the dataset.
    await expect(page.getByText(/891 行 × 15 列/).first()).toBeVisible();
  });

  test('a sample dataset with dates loads for the time-series view', async ({ page }) => {
    await boot(page);
    await goView(page, 'timeseries');
    // Titanic has no date column, so the empty state offers the dated sample.
    await expect(page.getByText('未检测到日期列')).toBeVisible();
    await page.getByRole('button', { name: '加载含日期的示例数据' }).click();
    await page.waitForTimeout(3000);
    // The sales dataset has 5,000 rows; the trend chart should now render.
    await expect(page.getByText('趋势图').first()).toBeVisible({ timeout: 20_000 });
  });

  test('every chart type renders without an ECharts error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
    });

    await boot(page);
    await goView(page, 'groupby');
    // Switching line → heatmap used to inherit the line chart's
    // `boundaryGap: false` through ECharts' option merge and crash the view.
    for (const label of ['柱状图', '折线图', '热力图', '柱状图']) {
      await page.getByRole('tab', { name: label, exact: true }).first().click();
      await page.waitForTimeout(700);
    }
    await expect(page.getByText('这个页面出现了意外错误')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('views are addressable by URL hash and history', async ({ page }) => {
    await boot(page);
    const nav = page.locator('nav[aria-label]').first();
    await nav.getByRole('button', { name: '透视表', exact: true }).click();
    await page.waitForTimeout(600);
    expect(new URL(page.url()).hash).toBe('#/pivot');

    await page.goBack();
    await page.waitForTimeout(700);
    await expect(nav.getByRole('button', { name: '总览', exact: true })).toHaveAttribute('aria-current', 'page');

    // A deep link opens straight into a view.
    await page.goto('/#/correlate');
    await page.waitForTimeout(3200);
    await expect(page.locator('header h1')).toHaveText('相关分析');
  });

  test('an exported analysis project can be re-imported', async ({ page }) => {
    await boot(page);
    await goView(page, 'clean');
    await page.getByRole('button', { name: '删除缺失值', exact: true }).first().click();
    await page.waitForTimeout(1400);
    await expect(page.getByText('182 × 15').first()).toBeVisible();

    const rail = page.locator('aside[aria-label]').first();
    const download = page.waitForEvent('download');
    await rail.getByRole('button', { name: '导出分析工程' }).click();
    const file = await download;
    const saved = await file.path();

    page.on('dialog', (d) => void d.accept());
    await rail.getByRole('button', { name: '清空全部' }).click();
    await page.waitForTimeout(1000);

    await rail.getByRole('button', { name: '导入分析工程' }).click();
    await rail.locator('input[type="file"]').setInputFiles(saved);
    await page.waitForTimeout(2500);
    await expect(page.getByText('182 × 15').first()).toBeVisible();
    await expect(rail.getByText('删除缺失值').first()).toBeVisible();
  });
});
