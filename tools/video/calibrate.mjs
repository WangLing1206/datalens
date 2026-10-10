/**
 * Calibration recording.
 *
 * The mux needs to know where scene 0 begins inside the recorded webm. Rather
 * than guessing from the file's duration metadata, this records a short clip
 * with one unmistakable visual event (a switch to the light theme) and writes
 * the wall-clock timestamps involved, so the mapping between wall clock and
 * video time can be measured exactly.
 *
 *   node tools/video/calibrate.mjs [baseUrl]
 * Out: tools/video/out/calibration.json
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });
const BASE = process.argv[2] ?? 'http://localhost:4173';

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  locale: 'zh-CN',
});
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
const tGoto = Date.now();
await page.goto(BASE, { waitUntil: 'networkidle' });
const tAfterLoad = Date.now();
await page.waitForTimeout(2500);

// The event: flip to the light theme. A whole-screen change, easy to detect.
const tSwitch = Date.now();
await page.getByRole('button', { name: /切换深色|Toggle dark/ }).click();
await page.waitForTimeout(3000);

const video = page.video();
await context.close();
await browser.close();

const payload = {
  video: video ? await video.path() : null,
  tGoto,
  tAfterLoad,
  tSwitch,
  note: 'tSwitch is the wall-clock moment of the light-theme flip; find it in the video by luma.',
};
writeFileSync(join(OUT, 'calibration.json'), JSON.stringify(payload, null, 1));
console.log(JSON.stringify(payload, null, 1));
