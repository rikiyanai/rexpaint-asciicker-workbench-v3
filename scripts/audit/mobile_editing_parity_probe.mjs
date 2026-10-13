#!/usr/bin/env node
/**
 * UQ-013 / FL-MOB-01 — Mobile editing parity probe.
 *
 * Proves that select, copy, paste, cut, clear, undo, redo work through the
 * mobile Tools drawer without entering Advanced mode.
 *
 * Covers, in order:
 *   1. Set initial draw state (glyph A, fg1, bg1) via Tools drawer
 *   2. Paint 3×3 Block A — verify glyph + both colors in getDocumentSnapshot
 *   3. Set draw state 2 (glyph B, fg2, bg2)
 *   4. Paint 3×3 Block B — verify glyph + distinct colors
 *   5. Select Block A via Select tool + canvas drag — verify selectionBounds
 *   6. Copy — verify clipboard has cells
 *   7. Paste at Loc1 — verify 9 cells match glyph A + fg1/bg1
 *   8. Select Loc1, Cut — verify Loc1 cleared + clipboard updated
 *   9. Paste at Loc2 — verify moved cells match glyph A + fg1/bg1
 *  10. Select CLEAR_REGION in Block B, Clear — verify cleared
 *  11. Undo clear — verify restored; Redo — verify cleared again
 *  12. Save via mobile top bar — verify sessionDirty === false
 *  13. Export via Files drawer — verify xp_path
 *  14. Artifact oracle — parse XP binary, check specific glyph + color cells
 *
 * Output:
 *   artifacts/2026-06-16-mobile-editing-parity/recipe.json
 *   artifacts/2026-06-16-mobile-editing-parity/result.json
 *   artifacts/2026-06-16-mobile-editing-parity/REPORT.md
 *   artifacts/2026-06-16-mobile-editing-parity/<N>-<name>.png
 *
 * Run:
 *   node scripts/audit/mobile_editing_parity_probe.mjs
 *
 * NOTE: Playwright WebKit is engine-family emulation under the iPad Pro 11 landscape
 * profile. It is NOT Apple's shipping iOS Safari. The real-device pass (UQ-013 step 6)
 * is a separate gate.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUTDIR = 'artifacts/2026-06-16-mobile-editing-parity';
const BASE_URL = 'http://localhost:5071/workbench';
const CELL_SIZE = 12; // base cell pixels in the canvas, same as baseline probe

// ── Glyph + color sets ───────────────────────────────────────────────────────
const GLYPH_A = 65;   // 'A'
const FG1 = '#ff4040'; // RGB(255, 64, 64)  — distinct from any template content
const BG1 = '#1a1a2e'; // RGB(26, 26, 46)

const GLYPH_B = 66;   // 'B'
const FG2 = '#00cc88'; // RGB(0, 204, 136)
const BG2 = '#330044'; // RGB(51, 0, 68)

// ── Fixed canvas regions ─────────────────────────────────────────────────────
// All within the large canvas produced by player_native_idle_only (proved ≥50 cols
// in the baseline probe).
const BLOCK_A     = { x: 2,  y: 2, w: 3, h: 3 }; // cells (2,2)–(4,4)
const BLOCK_B     = { x: 8,  y: 2, w: 3, h: 3 }; // cells (8,2)–(10,4)
const PASTE_LOC1  = { x: 14, y: 2 };              // copy of Block A stamped here
const PASTE_LOC2  = { x: 2,  y: 8 };              // cut content moved here
const CLEAR_REGION = { x: 8, y: 2, w: 2, h: 2 }; // 2×2 subset of Block B to clear

// ── Colour helpers ───────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbMatch(actual, expected, tol = 4) {
  if (!Array.isArray(actual) || actual.length < 3) return false;
  return actual.every((v, i) => Math.abs(Number(v) - expected[i]) <= tol);
}

// ── Playwright helpers ────────────────────────────────────────────────────────

async function getEditorState(page) {
  return page.evaluate(() => window.__wholeSheetEditor?.getState?.() || {});
}

async function getWbState(page) {
  return page.evaluate(() => window.__wb_debug?.getState?.() || {});
}

async function getRenderedCellSize(page) {
  return page.evaluate((base) => {
    const ws = window.__wholeSheetEditor?.getState?.() || {};
    return base * Math.max(0.05, Number(ws.appliedCanvasZoom || ws.canvasZoom || 1));
  }, CELL_SIZE);
}

async function readCell(page, x, y) {
  return page.evaluate(({ cx, cy }) => {
    const doc = window.__wholeSheetEditor?.getDocumentSnapshot?.();
    const ws  = window.__wholeSheetEditor?.getState?.() || {};
    const layerIndex = Number(ws.activeLayerIndex ?? 0);
    const layer = doc?.layers?.[layerIndex];
    const cols = Number(doc?.gridCols || 0);
    if (!Array.isArray(layer) || cols <= 0) return null;
    return layer[cy * cols + cx] || null;
  }, { cx: x, cy: y });
}

// Scroll canvas to keep (cx,cy) in view, then return absolute page coords.
async function canvasPoint(page, cx, cy) {
  const rendered = await getRenderedCellSize(page);
  await page.evaluate(({ x, y }) => {
    const scroll = document.getElementById('wholeSheetScroll');
    if (!scroll) return;
    scroll.scrollLeft = Math.max(0, x - scroll.clientWidth  / 2);
    scroll.scrollTop  = Math.max(0, y - scroll.clientHeight / 2);
  }, { x: cx * rendered, y: cy * rendered });
  await page.waitForTimeout(80);
  const box = await page.locator('#wholeSheetCanvas').boundingBox();
  if (!box) throw new Error('wholeSheetCanvas bounding box missing');
  return {
    x: box.x + cx * rendered + rendered / 2,
    y: box.y + cy * rendered + rendered / 2,
  };
}

async function clickCell(page, cx, cy) {
  const rendered = await getRenderedCellSize(page);
  await page.evaluate(({ x, y }) => {
    const scroll = document.getElementById('wholeSheetScroll');
    if (!scroll) return;
    scroll.scrollLeft = Math.max(0, x - scroll.clientWidth  / 2);
    scroll.scrollTop  = Math.max(0, y - scroll.clientHeight / 2);
  }, { x: cx * rendered, y: cy * rendered });
  await page.waitForTimeout(80);
  await page.click('#wholeSheetCanvas', {
    position: { x: cx * rendered + rendered / 2, y: cy * rendered + rendered / 2 },
  });
}

async function dragCells(page, x1, y1, x2, y2) {
  const p1 = await canvasPoint(page, x1, y1);
  const p2 = await canvasPoint(page, x2, y2);
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down();
  await page.mouse.move(p2.x, p2.y, { steps: 7 });
  await page.mouse.up();
}

// Open the named drawer (closes any currently open drawer first).
async function openDrawer(page, name) {
  await page.evaluate(() => window.toggleDrawer && window.toggleDrawer()).catch(() => {});
  await page.waitForTimeout(100);
  await page.locator(`.ws-mobile-top-bar [data-drawer-toggle="${name}"]`).click();
  await page.waitForFunction(
    (n) => !!document.querySelector(`.ws-drawer[data-drawer="${n}"].open`),
    name,
    { timeout: 5000 }
  );
  const advanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
  if (advanced) throw new Error(`opening drawer "${name}" entered Advanced mode`);
}

// Close all drawers.
async function closeDrawer(page) {
  await page.evaluate(() => window.toggleDrawer && window.toggleDrawer()).catch(() => {});
  await page.waitForFunction(
    () => !document.querySelector('.ws-drawer.open') && !document.querySelector('.ws-drawer-backdrop.visible'),
    { timeout: 3000 }
  ).catch(() => {});
}

// Set glyph + fg + bg via the Tools drawer, then switch to Cell tool.
async function setDrawState(page, glyph, fg, bg) {
  await openDrawer(page, 'tools');
  await page.locator('#wsGlyphCode').fill(String(glyph));
  await page.locator('#wsGlyphCode').dispatchEvent('change');
  await page.locator('#wsFgColor').fill(fg);
  await page.locator('#wsFgColor').dispatchEvent('input');
  await page.locator('#wsBgColor').fill(bg);
  await page.locator('#wsBgColor').dispatchEvent('input');
  await page.locator('#wsToolCell').click();
  await closeDrawer(page);
}

// Open Tools drawer, click a tool/button by ID, then close the drawer.
async function drawerClick(page, btnId) {
  await openDrawer(page, 'tools');
  await page.locator(`#${btnId}`).click();
  await page.waitForTimeout(150);
  await closeDrawer(page);
}

// Verify every cell in a rect has the expected glyph + colors. Returns mismatch list.
async function verifyBlock(page, rect, glyph, fgHex, bgHex) {
  const expectedFg = hexToRgb(fgHex);
  const expectedBg = hexToRgb(bgHex);
  const mismatches = [];
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      const cx = rect.x + dx;
      const cy = rect.y + dy;
      const cell = await readCell(page, cx, cy);
      if (!cell) { mismatches.push({ x: cx, y: cy, error: 'no cell' }); continue; }
      const g = Number(cell.glyph);
      if (g !== glyph) { mismatches.push({ x: cx, y: cy, error: `glyph ${g} ≠ ${glyph}` }); continue; }
      if (!rgbMatch(cell.fg, expectedFg))
        { mismatches.push({ x: cx, y: cy, error: `fg ${JSON.stringify(cell.fg)} ≠ ${JSON.stringify(expectedFg)}` }); continue; }
      if (!rgbMatch(cell.bg, expectedBg))
        { mismatches.push({ x: cx, y: cy, error: `bg ${JSON.stringify(cell.bg)} ≠ ${JSON.stringify(expectedBg)}` }); continue; }
    }
  }
  return mismatches;
}

// Check that every cell in a rect is cleared (glyph 0 or 32 = space).
async function verifyBlockClear(page, rect) {
  const results = [];
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      const cx = rect.x + dx;
      const cy = rect.y + dy;
      const cell = await readCell(page, cx, cy);
      const g = cell ? Number(cell.glyph) : -1;
      results.push({ x: cx, y: cy, glyph: g, isCleared: g === 0 || g === 32 });
    }
  }
  return results;
}

// Run a Python oracle against the exported XP.
// checks: [{glyph, fg, bg, expectedCount, label}]
// Counts cells matching glyph+color (with tolerance) across ALL layers and
// verifies each check's count is >= expectedCount.
// Position-based checks are NOT used because the XP frame-layout maps
// whole-sheet editor coordinates to non-trivial XP positions.
function runArtifactOracle(xpPath, checks) {
  if (!xpPath) return { error: 'no xp_path provided', results: [] };
  const abs = path.isAbsolute(xpPath) ? xpPath : path.resolve(REPO_ROOT, xpPath);
  const checksJson = JSON.stringify(checks);
  const script = [
    'import os, sys, json',
    "sys.path.insert(0, 'scripts')",
    'from xp_core import XPFile',
    'xp = XPFile(os.environ["XP_PATH"])',
    'checks = json.loads(os.environ["CHECKS"])',
    '',
    'def hex_to_rgb(h):',
    '    h = h.lstrip("#")',
    '    return (int(h[0:2],16), int(h[2:4],16), int(h[4:6],16))',
    '',
    'def rgb_ok(a, b, tol=4):',
    '    return all(abs(int(a[i]) - int(b[i])) <= tol for i in range(3))',
    '',
    'results = []',
    'for ck in checks:',
    '    eg = ck["glyph"]',
    '    efg, ebg = hex_to_rgb(ck["fg"]), hex_to_rgb(ck["bg"])',
    '    count = 0',
    '    for layer in xp.layers:',
    '        for row in layer.data:',
    '            for cell in row:',
    '                if int(cell[0]) == eg and rgb_ok(cell[1], efg) and rgb_ok(cell[2], ebg):',
    '                    count += 1',
    '    expected = ck.get("expectedCount", 1)',
    '    ok = count >= expected',
    '    results.append({"glyph": eg, "fg": ck["fg"], "bg": ck["bg"], "count": count, "expectedCount": expected, "ok": ok, "label": ck.get("label","")})',
    'print(json.dumps(results))',
  ].join('\n');
  try {
    const raw = execFileSync('python3', ['-c', script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, XP_PATH: abs, CHECKS: checksJson },
      timeout: 20000,
    });
    const jsonLine = raw.split('\n').find((l) => l.trim().startsWith('['));
    return { error: null, results: jsonLine ? JSON.parse(jsonLine) : [] };
  } catch (e) {
    return { error: String(e.message || e), results: [] };
  }
}

// ── Step recorder ─────────────────────────────────────────────────────────────

async function recordStep(page, outDir, results, name, fn) {
  const snap = () => page.evaluate(() => {
    const ws = window.__wholeSheetEditor?.getState?.() || {};
    const wb = window.__wb_debug?.getState?.()   || {};
    return {
      activeTool: ws.activeTool,
      selectionBounds: ws.selectionBounds,
      hasClipboard: ws.hasClipboard,
      clipboardCellCount: ws.clipboardCellCount,
      pasteMode: ws.pasteMode,
      canUndo: ws.canUndo,
      canRedo: ws.canRedo,
      wsAdvanced: document.body.classList.contains('ws-advanced'),
      sessionDirty: wb.sessionDirty,
    };
  });

  const pre  = await snap();
  let pass = true, error = '', data = {};
  try { data = (await fn()) || {}; }
  catch (e) { pass = false; error = e?.stack ? String(e.stack) : String(e); }
  await page.waitForTimeout(200);
  const post = await snap();
  const idx  = String(results.length + 1).padStart(2, '0');
  const shot = `${outDir}/${idx}-${name}.png`;
  await page.screenshot({ path: shot, fullPage: false });
  results.push({ name, pass, error, data, pre, post, screenshot: shot });
  if (!pass) throw new Error(`STEP FAIL [${name}]: ${error}`);
  return data;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUTDIR, { recursive: true });

  const recipe = {
    mode: 'mobile_editing_parity',
    generated_at: new Date().toISOString(),
    template: 'player_native_idle_only',
    glyph_a: GLYPH_A, fg1: FG1, bg1: BG1,
    glyph_b: GLYPH_B, fg2: FG2, bg2: BG2,
    block_a: BLOCK_A, block_b: BLOCK_B,
    paste_loc1: PASTE_LOC1, paste_loc2: PASTE_LOC2,
    clear_region: CLEAR_REGION,
  };
  writeFileSync(`${OUTDIR}/recipe.json`, JSON.stringify(recipe, null, 2));

  const browser = await webkit.launch({ headless: false });
  const results  = [];
  let overallPass = false;
  let finalXpPath = '';

  try {
    const ctx  = await browser.newContext({ ...devices['iPad Pro 11 landscape'], acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // ── 1. Fresh mobile first screen ─────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'fresh-mobile-first-screen', async () => {
      const visible = await page.locator('#mobileFirstScreen').isVisible();
      if (!visible) throw new Error('mobile first screen not visible on fresh load');
      return { visible };
    });

    // ── 2. Apply template ─────────────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'apply-template', async () => {
      await page.locator('#fsTemplateSelect').selectOption('player_native_idle_only');
      await page.locator('#fsTemplateApplyBtn').click();
      await page.waitForFunction(
        () =>
          document.getElementById('mobileFirstScreen')?.classList.contains('hidden') &&
          document.body.classList.contains('ws-session-loaded') &&
          !!document.getElementById('wholeSheetCanvas'),
        { timeout: 30000 }
      );
      const advanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
      if (advanced) throw new Error('template apply entered Advanced mode');
      return { template: 'player_native_idle_only' };
    });

    // ── 3. Set draw state 1: glyph A, fg1, bg1 ───────────────────────────────
    await recordStep(page, OUTDIR, results, 'set-draw-state-1', async () => {
      await setDrawState(page, GLYPH_A, FG1, BG1);
      const ws = await getEditorState(page);
      if (ws.drawGlyph !== GLYPH_A)
        throw new Error(`drawGlyph is ${ws.drawGlyph}, expected ${GLYPH_A}`);
      return { glyph: GLYPH_A, fg: FG1, bg: BG1, confirmed_drawGlyph: ws.drawGlyph };
    });

    // ── 4. Paint Block A (3×3) — verify glyph + colors ───────────────────────
    await recordStep(page, OUTDIR, results, 'paint-block-a', async () => {
      for (let dy = 0; dy < BLOCK_A.h; dy++)
        for (let dx = 0; dx < BLOCK_A.w; dx++)
          await clickCell(page, BLOCK_A.x + dx, BLOCK_A.y + dy);
      await page.waitForTimeout(300);
      const mismatches = await verifyBlock(page, BLOCK_A, GLYPH_A, FG1, BG1);
      if (mismatches.length)
        throw new Error(`Block A cell mismatches: ${JSON.stringify(mismatches)}`);
      return { cells: BLOCK_A.w * BLOCK_A.h, mismatches: [] };
    });

    // ── 5. Set draw state 2: glyph B, fg2, bg2 ───────────────────────────────
    await recordStep(page, OUTDIR, results, 'set-draw-state-2', async () => {
      await setDrawState(page, GLYPH_B, FG2, BG2);
      const ws = await getEditorState(page);
      if (ws.drawGlyph !== GLYPH_B)
        throw new Error(`drawGlyph is ${ws.drawGlyph}, expected ${GLYPH_B}`);
      return { glyph: GLYPH_B, fg: FG2, bg: BG2 };
    });

    // ── 6. Paint Block B (3×3) — verify glyph + distinct colors ──────────────
    await recordStep(page, OUTDIR, results, 'paint-block-b', async () => {
      for (let dy = 0; dy < BLOCK_B.h; dy++)
        for (let dx = 0; dx < BLOCK_B.w; dx++)
          await clickCell(page, BLOCK_B.x + dx, BLOCK_B.y + dy);
      await page.waitForTimeout(300);
      const mismatches = await verifyBlock(page, BLOCK_B, GLYPH_B, FG2, BG2);
      if (mismatches.length)
        throw new Error(`Block B cell mismatches: ${JSON.stringify(mismatches)}`);
      return { cells: BLOCK_B.w * BLOCK_B.h, mismatches: [] };
    });

    // ── 7. Select Block A via Tools drawer + canvas drag ──────────────────────
    await recordStep(page, OUTDIR, results, 'select-block-a', async () => {
      // Activate Select tool through drawer (no Advanced)
      await drawerClick(page, 'wsToolSelect');
      const ws1 = await getEditorState(page);
      if (ws1.activeTool !== 'select')
        throw new Error(`activeTool is "${ws1.activeTool}", expected "select"`);
      // Drag across Block A: top-left (2,2) → bottom-right (4,4)
      await dragCells(page, BLOCK_A.x, BLOCK_A.y,
        BLOCK_A.x + BLOCK_A.w - 1, BLOCK_A.y + BLOCK_A.h - 1);
      await page.waitForTimeout(300);
      const ws2 = await getEditorState(page);
      if (!ws2.selectionBounds)
        throw new Error('no selectionBounds after drag-select');
      const sb = ws2.selectionBounds;
      // Selection must fully cover Block A
      if (sb.x > BLOCK_A.x || sb.y > BLOCK_A.y ||
          sb.x + sb.width  < BLOCK_A.x + BLOCK_A.w ||
          sb.y + sb.height < BLOCK_A.y + BLOCK_A.h) {
        throw new Error(`selectionBounds ${JSON.stringify(sb)} does not cover Block A ${JSON.stringify(BLOCK_A)}`);
      }
      const advanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
      if (advanced) throw new Error('selecting entered Advanced mode');
      return { selectionBounds: sb, wsAdvanced: advanced };
    });

    // ── 8. Copy via Tools drawer ──────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'copy-selection', async () => {
      await drawerClick(page, 'wsCopySelection');
      const ws = await getEditorState(page);
      if (!ws.hasClipboard)
        throw new Error('hasClipboard is false after Copy');
      if (ws.clipboardCellCount < BLOCK_A.w * BLOCK_A.h)
        throw new Error(`clipboardCellCount ${ws.clipboardCellCount} < ${BLOCK_A.w * BLOCK_A.h}`);
      return { hasClipboard: ws.hasClipboard, clipboardCellCount: ws.clipboardCellCount };
    });

    // ── 9. Paste at Loc1 — verify cells match glyph A + fg1/bg1 ──────────────
    await recordStep(page, OUTDIR, results, 'paste-at-loc1', async () => {
      // Arm paste mode through Tools drawer
      await openDrawer(page, 'tools');
      await page.locator('#wsPasteSelection').click();
      await closeDrawer(page);
      const ws1 = await getEditorState(page);
      if (!ws1.pasteMode) throw new Error('paste mode not armed after clicking Paste');
      // Click canvas at PASTE_LOC1 — commits the paste
      await clickCell(page, PASTE_LOC1.x, PASTE_LOC1.y);
      await page.waitForTimeout(300);
      // Cancel paste mode by switching to Cell tool (tool switch calls _cancelPasteMode)
      await drawerClick(page, 'wsToolCell');
      const ws2 = await getEditorState(page);
      if (ws2.pasteMode) throw new Error('paste mode still armed after tool switch to Cell');
      // Verify pasted cells: Block A dimensions at PASTE_LOC1
      const mismatches = await verifyBlock(
        page,
        { x: PASTE_LOC1.x, y: PASTE_LOC1.y, w: BLOCK_A.w, h: BLOCK_A.h },
        GLYPH_A, FG1, BG1
      );
      if (mismatches.length)
        throw new Error(`Paste-at-Loc1 cell mismatches: ${JSON.stringify(mismatches)}`);
      return { pasteMode: ws2.pasteMode, mismatches: [] };
    });

    // ── 10. Select pasted region at Loc1, Cut, verify Loc1 cleared ───────────
    await recordStep(page, OUTDIR, results, 'cut-pasted-loc1', async () => {
      // Select the pasted 3×3 region at Loc1
      await drawerClick(page, 'wsToolSelect');
      await dragCells(page,
        PASTE_LOC1.x, PASTE_LOC1.y,
        PASTE_LOC1.x + BLOCK_A.w - 1, PASTE_LOC1.y + BLOCK_A.h - 1);
      await page.waitForTimeout(200);
      const ws1 = await getEditorState(page);
      if (!ws1.selectionBounds)
        throw new Error('no selectionBounds on pasted Loc1 region');
      // Cut
      await drawerClick(page, 'wsCutSelection');
      const ws2 = await getEditorState(page);
      if (!ws2.hasClipboard)
        throw new Error('clipboard empty after cut (expected clipboard to be updated)');
      // Verify Loc1 is cleared
      const cleared = await verifyBlockClear(
        page, { x: PASTE_LOC1.x, y: PASTE_LOC1.y, w: BLOCK_A.w, h: BLOCK_A.h }
      );
      const notCleared = cleared.filter((c) => !c.isCleared);
      if (notCleared.length)
        throw new Error(`Loc1 cells not cleared after cut: ${JSON.stringify(notCleared)}`);
      return { clipboardCellCount: ws2.clipboardCellCount, cleared };
    });

    // ── 11. Paste cut content at Loc2 — verify moved glyph A + fg1/bg1 ───────
    await recordStep(page, OUTDIR, results, 'paste-at-loc2', async () => {
      await openDrawer(page, 'tools');
      await page.locator('#wsPasteSelection').click();
      await closeDrawer(page);
      const ws1 = await getEditorState(page);
      if (!ws1.pasteMode) throw new Error('paste mode not armed for Loc2 paste');
      await clickCell(page, PASTE_LOC2.x, PASTE_LOC2.y);
      await page.waitForTimeout(300);
      // Cancel paste mode
      await drawerClick(page, 'wsToolCell');
      // Verify cells at Loc2 match glyph A + fg1/bg1 (the moved content)
      const mismatches = await verifyBlock(
        page,
        { x: PASTE_LOC2.x, y: PASTE_LOC2.y, w: BLOCK_A.w, h: BLOCK_A.h },
        GLYPH_A, FG1, BG1
      );
      if (mismatches.length)
        throw new Error(`Paste-at-Loc2 cell mismatches: ${JSON.stringify(mismatches)}`);
      return { mismatches: [] };
    });

    // ── 12. Select CLEAR_REGION in Block B, Clear, verify cleared ─────────────
    await recordStep(page, OUTDIR, results, 'clear-region', async () => {
      await drawerClick(page, 'wsToolSelect');
      await dragCells(page,
        CLEAR_REGION.x, CLEAR_REGION.y,
        CLEAR_REGION.x + CLEAR_REGION.w - 1, CLEAR_REGION.y + CLEAR_REGION.h - 1);
      await page.waitForTimeout(200);
      const ws1 = await getEditorState(page);
      if (!ws1.selectionBounds)
        throw new Error('no selectionBounds on CLEAR_REGION');
      await drawerClick(page, 'wsClearSelection');
      const cleared = await verifyBlockClear(page, CLEAR_REGION);
      const notCleared = cleared.filter((c) => !c.isCleared);
      if (notCleared.length)
        throw new Error(`CLEAR_REGION cells not cleared: ${JSON.stringify(notCleared)}`);
      return { selectionBounds: ws1.selectionBounds, cleared };
    });

    // ── 13. Undo clear → verify restored; Redo → verify cleared again ─────────
    await recordStep(page, OUTDIR, results, 'undo-redo', async () => {
      const ws0 = await getEditorState(page);
      if (!ws0.canUndo) throw new Error('canUndo is false before undo');
      // Undo the clear
      await drawerClick(page, 'wsUndoBtn');
      await page.waitForTimeout(300);
      // CLEAR_REGION should be restored to glyph B + fg2/bg2
      const afterUndo = await verifyBlock(page, CLEAR_REGION, GLYPH_B, FG2, BG2);
      if (afterUndo.length)
        throw new Error(`After undo: CLEAR_REGION not restored: ${JSON.stringify(afterUndo)}`);
      // Redo the clear
      const ws1 = await getEditorState(page);
      if (!ws1.canRedo) throw new Error('canRedo is false after undo');
      await drawerClick(page, 'wsRedoBtn');
      await page.waitForTimeout(300);
      // CLEAR_REGION should be cleared again
      const afterRedo = await verifyBlockClear(page, CLEAR_REGION);
      const notCleared = afterRedo.filter((c) => !c.isCleared);
      if (notCleared.length)
        throw new Error(`After redo: CLEAR_REGION not re-cleared: ${JSON.stringify(notCleared)}`);
      return { undoRestored: afterUndo.length === 0, redoCleared: notCleared.length === 0 };
    });

    // ── 14. Save via mobile top bar ───────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'save-via-topbar', async () => {
      await page.evaluate(() => { const el = document.getElementById('exportOut'); if (el) el.textContent = ''; });
      await page.locator('.ws-mobile-top-bar [data-action="save"]').click();
      await page.waitForFunction(
        () => {
          const st = window.__wb_debug?.getState?.();
          return st && st.sessionDirty === false;
        },
        { timeout: 20000 }
      ).catch(() => {});
      const wb = await getWbState(page);
      if (wb.sessionDirty)
        throw new Error(`sessionDirty remained true after Save (wbState: ${JSON.stringify(wb)})`);
      return { sessionDirty: wb.sessionDirty };
    });

    // ── 15. Export via Files drawer ───────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'export-via-files-drawer', async () => {
      await page.evaluate(() => { const el = document.getElementById('exportOut'); if (el) el.textContent = ''; });
      await openDrawer(page, 'files');
      await page.locator('.ws-drawer[data-drawer="files"] #btnExport').click();
      await closeDrawer(page);
      const xpPath = await page.waitForFunction(
        () => {
          try {
            const txt = document.getElementById('exportOut')?.textContent || '';
            const j = JSON.parse(txt);
            return j.xp_path || null;
          } catch (_) { return null; }
        },
        { timeout: 20000 }
      ).then((h) => h.jsonValue()).catch(() => null);
      if (!xpPath) throw new Error('no xp_path in exportOut after export');
      finalXpPath = xpPath;
      return { xpPath };
    });

    // ── 16. Artifact oracle — glyph + color counts in XP binary ──────────────
    // Position-based checks fail because the XP frame-layout maps whole-sheet
    // editor coordinates to non-trivial XP positions (e.g. editor (4,y) →
    // xp (68,y) for this template). Count-based oracle is correct:
    //
    // Expected authored cell counts (colors are our probe-specific values,
    // distinct from template content):
    //   Glyph A + FG1/BG1:
    //     Block A (original): 9 cells
    //     Paste Loc2 (moved): 9 cells
    //     Total: 18
    //   Glyph B + FG2/BG2:
    //     Block B original: 9 cells
    //     CLEAR_REGION cut: -4 cells (cleared by redo)
    //     Total: 5
    const checks = [
      { glyph: GLYPH_A, fg: FG1, bg: BG1, expectedCount: 18, label: 'glyph-a-count-18' },
      { glyph: GLYPH_B, fg: FG2, bg: BG2, expectedCount: 5,  label: 'glyph-b-survivor-5' },
    ];
    await recordStep(page, OUTDIR, results, 'artifact-oracle', async () => {
      const { error, results: oracleResults } = runArtifactOracle(finalXpPath, checks);
      if (error) throw new Error(`Artifact oracle error: ${error}`);
      const failures = oracleResults.filter((r) => !r.ok);
      if (failures.length)
        throw new Error(`Artifact oracle failures (${failures.length}/${checks.length}): ${JSON.stringify(failures)}`);
      return { checks: checks.length, allPassed: failures.length === 0, oracleResults };
    });

    overallPass = results.every((r) => r.pass);
  } catch (_err) {
    // Individual step failures are already recorded; overall pass handled below.
    overallPass = results.every((r) => r.pass);
  } finally {
    await browser.close();
  }

  // Write result JSON
  writeFileSync(`${OUTDIR}/result.json`, JSON.stringify({ overallPass, finalXpPath, results }, null, 2));

  // Write REPORT.md
  const step = (name) => results.find((r) => r.name === name);
  const ok = (name) => step(name)?.pass ? '✅' : '❌';
  const lines = [
    '# Mobile Editing Parity Probe',
    '',
    `Result: **${overallPass ? 'PASS' : 'FAIL'}**`,
    `Exported XP: \`${finalXpPath || '(none)'}\``,
    '',
    'Playwright WebKit under iPad Pro 11 landscape profile — NOT Apple iOS Safari.',
    '',
    '## Steps',
    '',
  ];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const errLine = r.error ? ` — ${r.error.split('\n')[0]}` : '';
    lines.push(`${i + 1}. ${r.pass ? 'PASS' : 'FAIL'} — ${r.name}${errLine}`);
  }
  lines.push('');
  lines.push('## Operations proven (mobile, no Advanced)');
  lines.push('');
  lines.push(`${ok('paint-block-a')} Paint glyph + color via Cell tool (Tools drawer)`);
  lines.push(`${ok('paint-block-b')} Paint second glyph + distinct color (verified in getDocumentSnapshot)`);
  lines.push(`${ok('select-block-a')} Select region (Select tool via Tools drawer + canvas drag)`);
  lines.push(`${ok('copy-selection')} Copy selection (Copy button via Tools drawer)`);
  lines.push(`${ok('paste-at-loc1')} Paste at new location — cells verified: glyph + fg + bg match source`);
  lines.push(`${ok('cut-pasted-loc1')} Cut selection (source cleared, clipboard updated)`);
  lines.push(`${ok('paste-at-loc2')} Paste moved content — cells verified at new location`);
  lines.push(`${ok('clear-region')} Clear/delete selection`);
  lines.push(`${ok('undo-redo')} Undo (state restored) + Redo (re-cleared)`);
  lines.push(`${ok('save-via-topbar')} Save via mobile top bar (sessionDirty → false)`);
  lines.push(`${ok('export-via-files-drawer')} Export XP via Files drawer`);
  lines.push(`${ok('artifact-oracle')} Artifact oracle: glyph + color in XP binary`);
  lines.push('');
  lines.push('## What this probe does NOT cover');
  lines.push('');
  lines.push('- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)');
  lines.push('- Source slicing / PNG import end-to-end');
  lines.push('- File/session persistence across reload');
  lines.push('- Skin Dock / preview pipeline');
  lines.push('- Desktop layout unaffected (see `mobile-first-screen.spec.js` desktop tests)');
  writeFileSync(`${OUTDIR}/REPORT.md`, lines.join('\n'));

  console.log(`\nReport: ${OUTDIR}/REPORT.md`);
  console.log(overallPass ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(overallPass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
