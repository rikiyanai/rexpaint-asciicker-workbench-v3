/**
 * UQ-013 / FL-MOB-01 / FL-MOB-02: Mobile first screen + editor-first shell
 *
 * Runs in Playwright's WebKit build under iPad viewport/UA emulation —
 * headless:false per playwright.config.js. Playwright WebKit is NOT Apple's
 * shipping iOS Safari: it shares the WebKit core but differs in UA, JIT, and
 * platform integration. This is engine-family emulation, NOT a physical iPad;
 * the real iOS Safari device pass (UQ-013 step 6) is still required separately.
 *
 * These are structural + layout assertions. They do NOT replace the headed
 * WebKit screenshot proof in scripts/audit/capture_mobile_states.mjs — visual
 * usability is judged from those screenshots, not from selectors alone.
 *
 * Covered:
 * - first screen appears on fresh load (portrait + landscape via coarse pointer)
 * - Continue Draft no-draft state keeps the first screen
 * - Advanced Workbench bypass dismisses the first screen (sets ws-advanced)
 * - New From Template reaches an EDITOR-FIRST shell (dashboard hidden, editor shown)
 * - debug ID overlay is OFF by default (toggle reads "show IDs")
 * - scroll chrome present and not occluding the canvas
 * - desktop layout unaffected (wide viewport keeps the dense dashboard)
 */

import { test, expect, devices } from '@playwright/test';

// Real WebKit engine for the whole file (config has no projects, so a
// file-scope browserName override is permitted).
test.use({ browserName: 'webkit' });

const BASE = 'http://localhost:5071';
const WORKBENCH = `${BASE}/workbench`;

// iPad Pro 11 profile — touch enabled so (pointer: coarse) matches in both
// orientations. Landscape (1194px) is the case a width-only breakpoint missed.
const IPAD_PORTRAIT = {
  viewport: { width: 820, height: 1180 },
  userAgent: devices['iPad Pro 11'].userAgent,
  hasTouch: true,
};
const IPAD_LANDSCAPE = {
  viewport: { width: 1194, height: 834 },
  userAgent: devices['iPad Pro 11'].userAgent,
  hasTouch: true,
};

async function applyTemplateToEditor(page) {
  await page.locator('#fsTemplateSelect').selectOption('player_native_idle_only');
  await page.waitForTimeout(200);
  await page.locator('#fsTemplateApplyBtn').click();
  await page.waitForFunction(
    () => document.getElementById('mobileFirstScreen')?.classList.contains('hidden'),
    { timeout: 25000 }
  );
  await page.waitForTimeout(1000);
}

test.describe('Mobile first screen — portrait (iPad WebKit emulation)', () => {
  test.use({ ...IPAD_PORTRAIT });

  test('first screen appears on fresh load', async ({ page }) => {
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await expect(page.locator('#mobileFirstScreen')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('#fsOpenXpBtn')).toBeVisible();
    await expect(page.locator('#fsContinueDraftBtn')).toBeVisible();
    await expect(page.locator('#fsTemplateSelect')).toBeVisible();
    await expect(page.locator('#fsAdvancedBtn')).toBeVisible();
  });

  test('debug ID overlay is OFF by default (toggle reads "show IDs")', async ({ page }) => {
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const toggle = page.locator('#wb-id-toggle-btn');
    await expect(toggle).toHaveText('show IDs');
  });

  test('Continue Draft no-draft state keeps the first screen', async ({ page }) => {
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await page.locator('#fsContinueDraftBtn').click();
    await page.waitForTimeout(1500);
    const statusText = await page.locator('#fsDraftStatus').textContent();
    expect(statusText && statusText.trim().length).toBeGreaterThan(0);
    await expect(page.locator('#mobileFirstScreen')).toBeVisible();
  });

  test('New From Template reaches an editor-first shell (dashboard hidden)', async ({ page }) => {
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await applyTemplateToEditor(page);

    // First screen dismissed, session marked loaded
    await expect(page.locator('#mobileFirstScreen')).toBeHidden();
    expect(await page.evaluate(() => document.body.classList.contains('ws-session-loaded'))).toBe(true);
    expect(await page.evaluate(() => document.body.classList.contains('ws-advanced'))).toBe(false);

    // Editor surface present; inline dashboard chrome not in flow
    await expect(page.locator('#wholeSheetPanel')).toBeVisible();
    await expect(page.locator('#firstStepsGuide')).toBeHidden();
    // Template drawer is collapsed (not open) in editor-first shell
    await expect(page.locator('.ws-drawer[data-drawer="template"]:not(.open)')).toHaveCount(1);

    // Editor-first chrome: top bar + Advanced escape hatch present
    await expect(page.locator('.ws-mobile-top-bar [data-action="toggle-advanced"]')).toBeVisible();
  });

  test('Tools drawer opens with content', async ({ page }) => {
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await applyTemplateToEditor(page);
    await page.locator('.ws-mobile-top-bar [data-drawer-toggle="tools"]').click();
    await page.waitForTimeout(500);
    const openDrawer = page.locator('.ws-drawer.open');
    await expect(openDrawer).toBeVisible();
  });

  test('first-screen Advanced sets top-bar toggle label to "Editor"', async ({ page }) => {
    // Regression: entering Advanced via the first-screen button used to leave
    // the top-bar toggle reading "Advanced" while already in advanced mode.
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await page.locator('#fsAdvancedBtn').click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.body.classList.contains('ws-advanced'))).toBe(true);
    await expect(page.locator('.ws-mobile-top-bar [data-action="toggle-advanced"]')).toHaveText('Editor');
  });

  // ── Parity: reparented dashboard panels reachable as drawers WITHOUT Advanced ──
  // Each drawer wraps the REAL desktop panel (Panel 5/7/8/9) via display:contents,
  // so opening it must NOT enter advanced mode and must expose the real controls.
  const PARITY_DRAWERS = [
    { drawer: 'frames',   control: '#addFrameBtn',          origin: 'Panel 9 grid' },
    { drawer: 'files',    control: '#btnNewXp',              origin: 'Panel 5 session ops' },
    { drawer: 'source',   control: '#extractBtn',            origin: 'Panel 8 slice' },
    { drawer: 'import',   control: '#wbUpload',              origin: 'Panel 7 upload' },
    { drawer: 'template', control: '#templateApplyBtn',      origin: 'Panel 4 template' },
    { drawer: 'anim',     control: '#assignAnimCategoryBtn', origin: 'Panel 11 anim+meta' },
    { drawer: 'preview',  control: '#playBtn',               origin: 'Panel 12 xp-preview' },
    { drawer: 'test',     control: '#webbuildQuickTestBtn',  origin: 'Panel 14 skin-test-dock' },
    { drawer: 'export',   control: '#exportArtifactBtn',     origin: 'Panel 17 export' },
  ];
  for (const d of PARITY_DRAWERS) {
    test(`${d.drawer} drawer exposes ${d.origin} without Advanced`, async ({ page }) => {
      await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      await applyTemplateToEditor(page);
      await page.locator(`.ws-mobile-top-bar [data-drawer-toggle="${d.drawer}"]`).click();
      await page.waitForTimeout(450);
      // Stays editor-first (Advanced is fallback, not the only path)
      expect(await page.evaluate(() => document.body.classList.contains('ws-advanced'))).toBe(false);
      await expect(page.locator(`.ws-drawer[data-drawer="${d.drawer}"].open`)).toBeVisible();
      // The real desktop control is present inside the drawer
      await expect(page.locator(`.ws-drawer[data-drawer="${d.drawer}"] ${d.control}`)).toHaveCount(1);
    });
  }

  test('drawer toggles stay tappable while a drawer is open (z-index over backdrop)', async ({ page }) => {
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await applyTemplateToEditor(page);
    await page.locator('.ws-mobile-top-bar [data-drawer-toggle="frames"]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('.ws-drawer[data-drawer="frames"].open')).toBeVisible();
    // Switch directly to Files without dismissing first — backdrop must not block the tap
    await page.locator('.ws-mobile-top-bar [data-drawer-toggle="files"]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('.ws-drawer[data-drawer="files"].open')).toBeVisible();
    await expect(page.locator('.ws-drawer[data-drawer="frames"].open')).toHaveCount(0);
  });

  test('Advanced toggle restores the dense dashboard', async ({ page }) => {
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await applyTemplateToEditor(page);
    await page.locator('.ws-mobile-top-bar [data-action="toggle-advanced"]').click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.body.classList.contains('ws-advanced'))).toBe(true);
    await expect(page.locator('#templatePanel')).toBeVisible();
  });
});

test.describe('Mobile first screen — landscape (iPad WebKit emulation, 1194px)', () => {
  test.use({ ...IPAD_LANDSCAPE });

  test('first screen appears in landscape (coarse pointer, width > 1024)', async ({ page }) => {
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    // This is the case a width-only 1024px breakpoint missed.
    await expect(page.locator('#mobileFirstScreen')).toBeVisible({ timeout: 4000 });
  });

  test('editor-first shell + scroll chrome does not occlude canvas', async ({ page }) => {
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await applyTemplateToEditor(page);

    await expect(page.locator('#firstStepsGuide')).toBeHidden();
    await expect(page.locator('#wholeSheetPanel')).toBeVisible();

    const chrome = page.locator('.ws-scroll-chrome').first();
    await expect(chrome).toBeVisible();
    const canvas = page.locator('#wholeSheetCanvas');
    await expect(canvas).toBeVisible();

    // Pan chrome sits in the zoom row above the canvas, not over it.
    const cBox = await chrome.boundingBox();
    const vBox = await canvas.boundingBox();
    expect(cBox).not.toBeNull();
    expect(vBox).not.toBeNull();
    // chrome bottom edge should be at or above the canvas top edge
    expect(cBox.y + cBox.height).toBeLessThanOrEqual(vBox.y + 4);
  });
});

test.describe('Desktop layout unaffected (wide viewport, WebKit)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('desktop: first screen hidden, dashboard visible, IDs off', async ({ page }) => {
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    expect(await page.locator('#mobileFirstScreen').isVisible()).toBe(false);
    await expect(page.locator('#templatePanel')).toBeVisible();
    await expect(page.locator('h1')).toContainText('XPEdit');
    await expect(page.locator('#wb-id-toggle-btn')).toHaveText('show IDs');
  });

  test('desktop: scroll chrome hidden after a session loads', async ({ page }) => {
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await page.locator('#templateSelect').selectOption('player_native_idle_only');
    await page.locator('#templateApplyBtn').click();
    await page.waitForTimeout(8000);
    // Dashboard stays (no editor-first collapse on desktop)
    await expect(page.locator('#templatePanel')).toBeVisible();
    const chrome = page.locator('.ws-scroll-chrome').first();
    if (await chrome.count() > 0) {
      expect(await chrome.isVisible()).toBe(false);
    }
  });
});
