#!/usr/bin/env node
/**
 * audit_a1_locked_visible.mjs — confirm paste now works even when a locked
 * layer is visible (the FL-2026-06-03 silent no-op scenario).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import {
  setupVerifier, waitForSessionHydration, waitForWholeSheetMount,
  writeJsonArtifact,
} from '../xp_fidelity_test/verifier_lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CELL_SIZE = 12;

async function cellSize(p) { return p.evaluate((b) => b * Math.max(0.05, Number(window.__wholeSheetEditor?.getState?.()?.appliedCanvasZoom || 1)), CELL_SIZE); }
async function scrollTo(p, x, y) { const sz = await cellSize(p); await p.evaluate(({tx,ty}) => { const s = document.getElementById('wholeSheetScroll'); if (s) { s.scrollLeft = Math.max(0, tx - s.clientWidth/2); s.scrollTop = Math.max(0, ty - s.clientHeight/2); } }, {tx: x*sz, ty: y*sz}); await p.waitForTimeout(100); }
async function clickAt(p, x, y) { await scrollTo(p, x, y); const sz = await cellSize(p); const box = await p.locator('#wholeSheetCanvas').boundingBox(); await p.mouse.click(box.x + x*sz + sz/2, box.y + y*sz + sz/2); }
async function dragAt(p, x1, y1, x2, y2) { await scrollTo(p, x1, y1); const sz = await cellSize(p); const box = await p.locator('#wholeSheetCanvas').boundingBox(); await p.mouse.move(box.x + x1*sz + sz/2, box.y + y1*sz + sz/2); await p.mouse.down(); await p.mouse.move(box.x + x2*sz + sz/2, box.y + y2*sz + sz/2, {steps: 5}); await p.mouse.up(); }
async function setDraw(p, glyph, fg, bg) { await p.fill('#wsGlyphCode', String(glyph)); await p.locator('#wsGlyphCode').dispatchEvent('change'); await p.fill('#wsFgColor', fg); await p.locator('#wsFgColor').dispatchEvent('input'); await p.fill('#wsBgColor', bg); await p.locator('#wsBgColor').dispatchEvent('input'); await p.waitForTimeout(60); }
async function readCell(p, li, x, y) { return p.evaluate(([l, cx, cy]) => { const st = window.__wb_debug?._state?.(); const w = Number(st?.gridCols || 0); const layer = st?.layers?.[l]; if (!w || !Array.isArray(layer)) return null; const c = layer[cy * w + cx]; return c ? { glyph: Number(c.glyph||0), fg: [...(c.fg||[0,0,0])], bg: [...(c.bg||[0,0,0])] } : null; }, [li, x, y]); }

async function main() {
  const { page, browser, outDir, cliArgs } = await setupVerifier('audit_a1_locked_visible', { requireOutDir: false });
  const absXp = path.resolve(REPO_ROOT, cliArgs.getArg('--xp', 'sprites/player-0000.xp'));
  await page.waitForSelector('#xpImportFile', { state: 'attached', timeout: 10000 });
  await page.locator('#xpImportFile').setInputFiles(absXp);
  await page.click('#xpImportBtn');
  await waitForSessionHydration(page);
  await waitForWholeSheetMount(page);
  await page.waitForTimeout(400);
  await page.dblclick('.frame-cell[data-row="0"][data-col="0"]').catch(()=>{});
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 1400, height: 2400 });

  // SHOW L0 (locked) explicitly — this is the failure mode pre-fix
  const l0Row = page.locator('.ws-layer-row').nth(0);
  const l0VisBtn = l0Row.locator('.ws-layer-vis-btn');
  if ((await l0VisBtn.textContent())?.trim() !== 'V') {
    await l0VisBtn.click(); await page.waitForTimeout(100);
  }
  // Confirm L0 visible AND locked
  const layerInfo = await page.evaluate(() => window.__wholeSheetEditor?.getLayerInfo?.());

  // Active layer = 2, paint at (10,10) and (11,10)
  await page.locator('.ws-layer-row').nth(2).click(); await page.waitForTimeout(80);
  await page.click('#wsToolCell'); await page.waitForTimeout(60);
  await setDraw(page, 65, '#00ffff', '#222200');
  await clickAt(page, 10, 10); await page.waitForTimeout(80);
  await clickAt(page, 11, 10); await page.waitForTimeout(80);

  // Select + Copy + Paste (sticky)
  await page.click('#wsToolSelect'); await page.waitForTimeout(80);
  await dragAt(page, 10, 10, 11, 10);
  await page.waitForTimeout(200);
  await page.click('#wsCopySelection'); await page.waitForTimeout(180);

  const beforePaste = await readCell(page, 2, 20, 20);
  await page.click('#wsPasteSelection'); await page.waitForTimeout(150);
  const armed = await page.evaluate(() => {
    const b = document.getElementById('wsPasteSelection');
    const s = window.__wholeSheetEditor?.getState?.();
    return { armed: b?.classList.contains('ws-tool-active'), greenArmed: b?.classList.contains('ws-paste-armed'), pasteMode: s?.pasteMode };
  });
  await clickAt(page, 20, 20); await page.waitForTimeout(250);
  const after20 = await readCell(page, 2, 20, 20);
  const after21 = await readCell(page, 2, 21, 20);

  // Second sticky paste
  await clickAt(page, 30, 25); await page.waitForTimeout(250);
  const after30 = await readCell(page, 2, 30, 25);

  const result = {
    layerInfo,
    armed,
    beforePaste,
    after20_20: after20,
    after21_20: after21,
    after30_25: after30,
    pasteWorkedWithLockedVisible: after20?.glyph === 65 && after30?.glyph === 65,
    greenPlusAffordance: !!armed.greenArmed,
  };
  writeJsonArtifact(outDir, 'a1_locked_visible.json', result);
  console.log(JSON.stringify(result, null, 2));
  console.log('VERDICT:', result.pasteWorkedWithLockedVisible && result.greenPlusAffordance ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(result.pasteWorkedWithLockedVisible && result.greenPlusAffordance ? 0 : 2);
}
main().catch(e => { console.error(e); process.exit(1); });
