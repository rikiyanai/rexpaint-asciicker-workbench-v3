#!/usr/bin/env node
/**
 * audit_a1_button_trace.mjs — instrument paste-mode interceptor to trace
 * what cell data the BUTTON-driven path receives at paste click.
 *
 * Hypothesis: the button path was failing in audit_2026_06_03_gaps.mjs due
 * to either (a) a clipboard mutation between copy click and canvas click, or
 * (b) an event-ordering bug where the canvas pointerdown is consumed by a
 * different listener first.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  setupVerifier, waitForSessionHydration, waitForWholeSheetMount,
  writeJsonArtifact, screenshot,
} from '../xp_fidelity_test/verifier_lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CELL_SIZE = 12;

async function cellSize(page) {
  return page.evaluate((b) => {
    const s = window.__wholeSheetEditor?.getState?.();
    return b * Math.max(0.05, Number(s?.appliedCanvasZoom || 1));
  }, CELL_SIZE);
}
async function scrollTo(page, cx, cy) {
  const sz = await cellSize(page);
  await page.evaluate(({ tx, ty }) => {
    const s = document.getElementById('wholeSheetScroll');
    if (s) { s.scrollLeft = Math.max(0, tx - s.clientWidth/2); s.scrollTop = Math.max(0, ty - s.clientHeight/2); }
  }, { tx: cx*sz, ty: cy*sz });
  await page.waitForTimeout(120);
}
async function clickAt(page, cx, cy) {
  await scrollTo(page, cx, cy);
  const sz = await cellSize(page);
  const box = await page.locator('#wholeSheetCanvas').boundingBox();
  await page.mouse.click(box.x + cx*sz + sz/2, box.y + cy*sz + sz/2);
}
async function dragAt(page, x1, y1, x2, y2) {
  await scrollTo(page, x1, y1);
  const sz = await cellSize(page);
  const box = await page.locator('#wholeSheetCanvas').boundingBox();
  await page.mouse.move(box.x + x1*sz + sz/2, box.y + y1*sz + sz/2);
  await page.mouse.down();
  await page.mouse.move(box.x + x2*sz + sz/2, box.y + y2*sz + sz/2, { steps: 5 });
  await page.mouse.up();
}
async function setDraw(page, glyph, fg, bg) {
  await page.fill('#wsGlyphCode', String(glyph)); await page.locator('#wsGlyphCode').dispatchEvent('change');
  await page.fill('#wsFgColor', fg); await page.locator('#wsFgColor').dispatchEvent('input');
  await page.fill('#wsBgColor', bg); await page.locator('#wsBgColor').dispatchEvent('input');
  await page.waitForTimeout(60);
}
async function readAllLayers(page, x, y) {
  return page.evaluate(([cx, cy]) => {
    const st = window.__wb_debug?._state?.();
    const w = Number(st?.gridCols || 0);
    if (!w) return null;
    const idx = cy * w + cx;
    return (st.layers || []).map((layer, li) => {
      const c = layer && layer[idx];
      return c ? { layerIndex: li, glyph: Number(c.glyph||0), fg: [...(c.fg||[0,0,0])], bg: [...(c.bg||[0,0,0])] } : null;
    });
  }, [x, y]);
}

async function main() {
  const { page, browser, outDir, cliArgs } = await setupVerifier('audit_a1_button_trace', { requireOutDir: false });
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Capture browser console
  const consoleLog = [];
  page.on('console', (msg) => {
    consoleLog.push({ type: msg.type(), text: msg.text() });
  });

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

  // Activate layer 2, paint at (10,10) and (11,10)
  await page.locator('.ws-layer-row').nth(2).click(); await page.waitForTimeout(80);
  await page.click('#wsToolCell'); await page.waitForTimeout(60);
  await setDraw(page, 65, '#00ffff', '#222200');
  await clickAt(page, 10, 10); await page.waitForTimeout(80);
  await clickAt(page, 11, 10); await page.waitForTimeout(80);

  // Inject a tracer that wraps _pasteAt-related primitives by patching the public API
  await page.evaluate(() => {
    window.__pasteTrace = { copyResult: null, enterResult: null, callsBefore: [], callsAfter: [], clipboardSnapshotAfterCopy: null };
    const ws = window.__wholeSheetEditor;
    const origCopy = ws.copySelection;
    ws.copySelection = function () {
      const r = origCopy.apply(this, arguments);
      window.__pasteTrace.copyResult = r;
      // Snapshot the public state right after
      const s = ws.getState();
      window.__pasteTrace.clipboardSnapshotAfterCopy = {
        hasClipboard: s.hasClipboard,
        clipboardCellCount: s.clipboardCellCount,
        selectionBounds: s.selectionBounds,
        activeLayerIndex: s.activeLayerIndex,
        activeTool: s.activeTool,
      };
      console.log(`[trace] copySelection returned ${r}, cellCount=${s.clipboardCellCount}`);
      return r;
    };
    const origPaste = ws.pasteClipboard;
    ws.pasteClipboard = function () {
      const r = origPaste.apply(this, arguments);
      window.__pasteTrace.enterResult = r;
      const s = ws.getState();
      console.log(`[trace] pasteClipboard returned ${r}, pasteMode=${s.pasteMode}, cellCount=${s.clipboardCellCount}`);
      return r;
    };
    // Watch the canvas pointerdown events
    const canvasEl = document.getElementById('wholeSheetCanvas');
    if (canvasEl) {
      canvasEl.addEventListener('pointerdown', (e) => {
        const s = ws.getState();
        const trace = { phase: 'beforeHandlers', pasteMode: s.pasteMode, hasClipboard: s.hasClipboard, cellCount: s.clipboardCellCount, clientX: e.clientX, clientY: e.clientY };
        window.__pasteTrace.callsBefore.push(trace);
        console.log('[trace] pointerdown ' + JSON.stringify(trace));
      }, true);  // capture phase BEFORE the paste interceptor
      canvasEl.addEventListener('pointerdown', (e) => {
        const s = ws.getState();
        const trace = { phase: 'afterHandlers', pasteMode: s.pasteMode, hasClipboard: s.hasClipboard, cellCount: s.clipboardCellCount };
        window.__pasteTrace.callsAfter.push(trace);
        console.log('[trace] post-pointerdown ' + JSON.stringify(trace));
      }, false);  // bubble phase AFTER
    }
  });

  // BUTTON PATH: select tool → drag → click Copy → click Paste → canvas click
  await page.click('#wsToolSelect'); await page.waitForTimeout(80);
  await dragAt(page, 10, 10, 11, 10);
  await page.waitForTimeout(180);

  await page.click('#wsCopySelection'); await page.waitForTimeout(200);

  await page.click('#wsPasteSelection'); await page.waitForTimeout(150);

  // Canvas click to trigger paste — at (20,20)
  await clickAt(page, 20, 20); await page.waitForTimeout(300);

  const trace = await page.evaluate(() => window.__pasteTrace);
  const after = await readAllLayers(page, 20, 20);
  const after21 = await readAllLayers(page, 21, 20);

  const report = { trace, after_20_20: after, after_21_20: after21, consoleLog };
  writeJsonArtifact(outDir, 'a1_button_trace.json', report);
  await screenshot(page, outDir, 'a1_button_trace');
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
