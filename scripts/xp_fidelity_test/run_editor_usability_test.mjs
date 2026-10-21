#!/usr/bin/env node
// Shipped-control acceptance: headed desktop Chrome and Chrome touch/viewport
// emulation. Diagnostic reads never create documents or paint cells.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { chromium, devices } from 'playwright';
import { expect } from '@playwright/test';

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes('--out-dir') || !process.argv.includes('--url')) throw new Error('--url and --out-dir are required');
const outDir = path.resolve(arg('--out-dir'));
await fs.mkdir(outDir, {recursive: true});
const url = arg('--url');
const api = (suffix) => url.replace(/\/workbench(?:\?.*)?$/, '') + '/api/workbench/' + suffix;
const browser = await chromium.launch({channel: 'chrome', headless: false});
const receipt = {url, scope: 'Headed Chrome; touch/viewport emulation is not physical iOS Safari', cases: []};
const profiles = [
  {name: 'desktop', options: {viewport: {width: 1440, height: 1000}}},
  {name: 'mobile-toggle', options: {viewport: {width: 1440, height: 1000}}, toggle: true},
  {name: 'phone-touch', options: {...devices['Pixel 7'], viewport: {width: 390, height: 844}}, touch: true},
  {name: 'tablet-landscape-touch', options: {...devices['iPad Pro 11 landscape']}, touch: true},
];

function xpCell(bytes, layer, x, y) {
  const data = gunzipSync(bytes);
  let offset = 8;
  for (let index = 0; index <= layer; index++) {
    const width = data.readInt32LE(offset), height = data.readInt32LE(offset + 4);
    offset += 8;
    if (index === layer) return data.readInt32LE(offset + (x * height + y) * 10);
    offset += width * height * 10;
  }
}

try {
  for (const profile of profiles.filter((p) => !process.argv.includes('--profile') || p.name === arg('--profile'))) {
    const context = await browser.newContext(profile.options);
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const result = {name: profile.name, errors: [], assertions: []};
    const check = (condition, name) => { assert.ok(condition, name); result.assertions.push(name); };
    const shot = async (name) => page.screenshot({path: path.join(outDir, `${profile.name}-${name}.png`), fullPage: false});
    const editor = () => page.evaluate(() => window.__wholeSheetEditor.getState());
    const snapshot = () => page.evaluate(() => window.__wholeSheetEditor.getDocumentSnapshot());
    page.on('pageerror', (e) => result.errors.push(e.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('[whole-sheet]')) result.errors.push(message.text());
    });
    const drawer = async (name, open) => {
      const panel = page.locator(`.ws-sidebar .ws-drawer[data-drawer="${name}"]`);
      const toggle = page.locator(`.ws-mobile-top-bar [data-drawer-toggle="${name}"]`);
      if (await toggle.isVisible()) {
        const isOpen = await panel.evaluate((e) => e.classList.contains('open'));
        if (isOpen !== open) await toggle.click();
        await panel.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {}))));
        if (open) await expect(panel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
        else await expect(page.locator('.ws-drawer-backdrop')).not.toHaveClass(/visible/);
      }
    };
    try {
      await page.goto(url, {waitUntil: 'domcontentloaded'});
      if (await page.locator('#mobileFirstScreen').isVisible()) await page.locator('#fsBrowseBtn').click();
      if (profile.toggle) await page.locator('#viewportToggleBtn').click();
      await expect(page.locator('#wsBrowseStatus')).toContainText('287 upstream XP sprites');
      check(!(await page.locator('#productActionNavigation').evaluate((e) => e.open)), 'Skin/action collapsed by default');
      check(!(await page.locator('#wbRunOutShell').evaluate((e) => e.open)), 'Convert JSON collapsed by default');
      check(await page.locator('.sprite-editing-subheader').count() === 2, 'both sprite-editing subheaders exist');
      const banner = await page.locator('.alpha-banner-title').evaluate((e) => ({color: getComputedStyle(e).color, weight: Number(getComputedStyle(e).fontWeight)}));
      check(banner.color === 'rgb(176, 0, 32)' && banner.weight >= 800, 'pre-alpha banner is red and bold');

      await page.locator('#wsBrowseSource').selectOption('upstream');
      await page.locator('#wsBrowseSearch').fill('player-0100.xp');
      await expect(page.locator('.ws-browse-item')).toHaveCount(1);
      await page.locator('.ws-browse-item').click();
      await expect(page.locator('#wsBrowseOpen')).toHaveText('Open editable copy');
      await expect(page.locator('#wsBrowseDelete')).toBeDisabled();
      await shot('upstream-browse');
      await page.locator('#wsBrowseOpen').click();
      await page.waitForFunction(() => window.__wholeSheetEditor?.getState().mounted && window.__wholeSheetEditor.getState().sessionKind === 'raw_xp');
      await expect(page.locator('#productShell')).toBeVisible();
      check((await editor()).mode === 'paint', 'upstream copy opens in editable paint mode');
      await page.locator('#productActionNavigation > summary').click();
      await expect(page.locator('#registryActionSelect')).toHaveValue('');
      const layer0 = JSON.stringify((await snapshot()).layers[0]);
      const template = await page.locator('#registryActionSelect option[data-template-set-key]').first().getAttribute('value');
      let warning = '';
      page.once('dialog', async (dialog) => { warning = dialog.message(); await dialog.dismiss(); });
      await page.locator('#registryActionSelect').selectOption(template);
      await expect(page.locator('#registryActionSelect')).toHaveValue('');
      check(/layer 0/i.test(warning) && /inserts or rewrites/i.test(warning), 'template selection warns about layer 0 before mutation');
      check(JSON.stringify((await snapshot()).layers[0]) === layer0, 'cancelled template selection preserves raw layer 0');
      await page.locator('#productActionNavigation > summary').click();

      // New selects the art layer. Turn on the empty upper layer through the
      // actual Layers control: without the compositor repair it masks paint.
      await page.locator('#btnNewXp').click();
      await page.waitForFunction(() => window.__wholeSheetEditor?.getState().mounted && window.__wholeSheetEditor.getState().sessionKind === 'root_blank');
      check((await editor()).activeLayerIndex === 2, 'New selects art layer 2');
      await drawer('layers', true);
      await page.locator('#wsLayersPanel .ws-layer-row').nth(3).locator('.ws-layer-vis-btn').click();
      await drawer('layers', false);
      await drawer('tools', true);
      await page.locator('#wsGlyphCode').fill('219');
      await page.locator('#wsGlyphCode').press('Tab');
      const palette = page.locator('#wsPaletteCanvas');
      const paletteBox = await palette.boundingBox();
      assert.ok(paletteBox, 'palette must survive second-document mount');
      await palette.click({position: {x: paletteBox.width / 32, y: paletteBox.height * 3 / 8}});
      check((await editor()).drawGlyph === 219, 'glyph control reachable');
      check(JSON.stringify((await editor()).drawFg) === '[255,0,0]', 'palette control reachable');
      await shot('tools');
      await drawer('tools', false);

      const canvas = page.locator('#wholeSheetCanvas');
      await page.locator('#wholeSheetScroll').scrollIntoViewIfNeeded();
      const canvasBox = await canvas.boundingBox();
      const scrollBox = await page.locator('#wholeSheetScroll').boundingBox();
      const state = await editor();
      const cellSize = canvasBox.width / state.gridCols;
      const x = Math.floor((Math.max(canvasBox.x, scrollBox.x + 2, 0) - canvasBox.x) / cellSize) + 3;
      const y = Math.floor((Math.max(canvasBox.y, scrollBox.y + 2, 55) - canvasBox.y) / cellSize) + 3;
      const point = {x: canvasBox.x + (x + 0.5) * cellSize, y: canvasBox.y + (y + 0.5) * cellSize};
      const pixelBytes = () => canvas.evaluate((c, p) => Array.from(c.getContext('2d').getImageData(p.x * 12, p.y * 12, 12, 12).data), {x, y});
      const before = await pixelBytes();
      if (profile.touch) await page.touchscreen.tap(point.x, point.y);
      else await page.mouse.click(point.x, point.y);
      const after = await pixelBytes();
      check(JSON.stringify(before) !== JSON.stringify(after), 'pointer stroke visibly changes canvas under transparent upper layer');
      check(after.filter((v, i) => i % 4 === 0 && v > 200).length > 20, 'red glyph pixels are visible');
      const painted = (await snapshot()).layers[2][y * state.gridCols + x];
      check(painted.glyph === 219, 'pointer stroke changes the active layer cell');
      result.paint = {x, y, beforePixelSha256: createHash('sha256').update(Buffer.from(before)).digest('hex'), afterPixelSha256: createHash('sha256').update(Buffer.from(after)).digest('hex')};
      await shot('paint');

      const sessionId = await page.evaluate(() => window.__wb_debug.getState().sessionId);
      const savedResponse = page.waitForResponse((r) => r.url() === api('save-session') && r.request().method() === 'POST' && r.ok());
      await page.locator('#btnSave').click();
      await savedResponse;
      const loaded = await context.request.post(api('load-session'), {data: {session_id: sessionId}});
      check((await loaded.json()).layers[2][y * state.gridCols + x].glyph === 219, 'Save persists painted cell to backend');
      const downloadEvent = page.waitForEvent('download');
      await page.locator('#btnExport').click();
      const download = await downloadEvent;
      const exportedPath = path.join(outDir, `${profile.name}-painted.xp`);
      await download.saveAs(exportedPath);
      check(xpCell(await fs.readFile(exportedPath), 2, x, y) === 219, 'Exported XP contains painted glyph');
      if (profile.name === 'desktop') {
        await page.locator('#productActionNavigation > summary').click();
        const acceptWarning = async (dialog) => dialog.accept();
        page.on('dialog', acceptWarning);
        await page.locator('#registryActionSelect').selectOption('player_native_idle_only:idle');
        check(JSON.stringify((await snapshot()).layers[2][y * state.gridCols + x]) === JSON.stringify(painted), 'selecting a template does not mutate raw artwork before Apply');
        await page.locator('#registryTemplateApplyBtn').click();
        await page.waitForFunction(() => window.__wholeSheetEditor?.getState().sessionKind === 'template_owned' && window.__wholeSheetEditor.getState().mounted);
        page.off('dialog', acceptWarning);
        check((await page.locator('#registryActionSelect').inputValue()) === 'player_native_idle_only:idle', 'applied template is the actual selected option');
        const previous = await context.request.post(api('load-session'), {data: {session_id: sessionId}});
        check((await previous.json()).layers[2][y * state.gridCols + x].glyph === 219, 'template Apply preserves the original saved raw document');
        await shot('template-applied');
      }
      await page.locator('#productBrowseBtn').click();
      await expect(page.locator('#productBrowsePanel')).toBeVisible();
      await expect(page.locator('#viewportToggleBtn')).toBeVisible();
      check(await page.evaluate(() => document.body.scrollWidth <= innerWidth + 1), 'no horizontal page overflow');
      check(result.errors.length === 0, 'no page exceptions');
      result.passed = true;
    } catch (error) {
      result.passed = false;
      result.failure = error.stack;
      await shot('failure').catch(() => {});
    } finally {
      receipt.cases.push(result);
      console.log(JSON.stringify(result));
      await context.close();
    }
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(outDir, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
}
if (receipt.cases.some((result) => !result.passed)) process.exitCode = 1;
