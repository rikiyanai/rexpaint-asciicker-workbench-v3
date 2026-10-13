/**
 * UQ-013 / FL-MOB-01 / FL-MOB-02 — visual capture (headed WebKit, real iPad profile)
 *
 * Captures portrait + landscape screenshots of the mobile workbench across the
 * four required states so the shell can be judged visually, not by selectors:
 *   1. fresh load (first screen)
 *   2. template-created editor
 *   3. Advanced Workbench bypass
 *   4. scroll chrome visible (editor + zoom row)
 *
 * Output: artifacts/2026-06-16-mobile-visual/<orientation>-<state>.png
 * Run: node scripts/audit/capture_mobile_states.mjs
 */
import { webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:5071';
const WORKBENCH = `${BASE}/workbench`;
const OUTDIR = 'artifacts/2026-06-16-mobile-visual';
mkdirSync(OUTDIR, { recursive: true });

const ORIENTATIONS = [
  { name: 'portrait', device: devices['iPad Pro 11'] },
  { name: 'landscape', device: devices['iPad Pro 11 landscape'] },
];

async function dismissViaTemplate(page) {
  await page.locator('#fsTemplateSelect').selectOption('player_native_idle_only').catch(() => {});
  await page.waitForTimeout(200);
  await page.locator('#fsTemplateApplyBtn').click().catch(() => {});
  await page.waitForFunction(
    () => document.getElementById('mobileFirstScreen')?.classList.contains('hidden'),
    { timeout: 25000 }
  ).catch(() => {});
  await page.waitForTimeout(1200);
}

const browser = await webkit.launch({ headless: false });
try {
  for (const o of ORIENTATIONS) {
    const ctx = await browser.newContext({ ...o.device });
    const page = await ctx.newPage();

    // State 1 — fresh load
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUTDIR}/${o.name}-1-fresh-load.png` });
    console.log(`✓ ${o.name}-1-fresh-load`);

    // State 3 — Advanced Workbench bypass (no session)
    await page.locator('#fsAdvancedBtn').click().catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUTDIR}/${o.name}-3-advanced.png` });
    console.log(`✓ ${o.name}-3-advanced`);

    // State 2 — template-created editor (reload to get clean first screen)
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await dismissViaTemplate(page);
    await page.screenshot({ path: `${OUTDIR}/${o.name}-2-template-editor.png` });
    console.log(`✓ ${o.name}-2-template-editor`);

    // State 4 — scroll chrome visible (scroll the chrome into view if present)
    const chrome = page.locator('.ws-scroll-chrome').first();
    if (await chrome.count() > 0) {
      await chrome.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: `${OUTDIR}/${o.name}-4-scroll-chrome.png` });
    console.log(`✓ ${o.name}-4-scroll-chrome`);

    // State 5 — a drawer opens (proves the kept drawer buttons actually work)
    const toolsBtn = page.locator('.ws-mobile-top-bar [data-drawer-toggle="tools"]').first();
    if (await toolsBtn.count() > 0) {
      await toolsBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: `${OUTDIR}/${o.name}-5-tools-drawer.png` });
    console.log(`✓ ${o.name}-5-tools-drawer`);

    await ctx.close();
  }

  // Desktop unchanged — webkit, wide, fine pointer (no touch)
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dpage = await dctx.newPage();
  await dpage.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
  await dpage.waitForTimeout(1500);
  await dpage.screenshot({ path: `${OUTDIR}/desktop-1-fresh-load.png` });
  console.log('✓ desktop-1-fresh-load');
  // Desktop template apply via the dashboard's own controls
  await dpage.locator('#templateSelect').selectOption('player_native_idle_only').catch(() => {});
  await dpage.locator('#templateApplyBtn').click().catch(() => {});
  await dpage.waitForTimeout(6000);
  await dpage.screenshot({ path: `${OUTDIR}/desktop-2-template.png`, fullPage: false });
  console.log('✓ desktop-2-template');
  await dctx.close();
} finally {
  await browser.close();
}
console.log('DONE');
