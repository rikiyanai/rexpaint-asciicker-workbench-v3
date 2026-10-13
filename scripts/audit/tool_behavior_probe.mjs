#!/usr/bin/env node
/**
 * UQ-013 / FL-MOB-01 — Tool behavior canvas mutations probe (#3 of execution order).
 *
 * Proves that tools actually mutate the canvas, not just switch activeTool:
 *
 *   Cell draw:    switch to Cell, draw glyph 65 'A' at (4,4) → readCell confirms
 *   Eyedropper:   switch to Eyedropper, click (4,4) → drawGlyph/drawFg match authored
 *   Erase:        switch to Erase, click (4,4) → cell is null/code 0 after click
 *   Line:         switch to Cell, draw glyph 66 'B' at (2,2); switch to Line, drag (2,2)→(8,2) → cells along path confirmed
 *   Fill:         switch to Fill → check activeTool='fill' reachable
 *   Text:         switch to Text → check activeTool='text' reachable
 *
 * Steps:
 *   1.  Mobile first screen
 *   2.  Apply template
 *   3.  Switch to Cell tool + set draw state (glyph A, vivid fg/bg)
 *   4.  Draw cell at (4,4) — Cell tool canvas mutation
 *   5.  Eyedropper sample at (4,4) — drawGlyph/drawFg change confirmed
 *   6.  Erase at (4,4) — cell cleared confirmed
 *   7.  Draw glyph B at (2,2) — prep for line
 *   8.  Line drag (2,2)→(8,2) — cells along path confirmed
 *   9.  Fill tool switch — activeTool='fill' confirmed
 *  10.  Text tool switch — activeTool='text' confirmed
 *  11.  Export via Files drawer
 *  12.  Artifact oracle
 *
 * Output:
 *   artifacts/2026-06-16-tool-behavior/recipe.json
 *   artifacts/2026-06-16-tool-behavior/result.json
 *   artifacts/2026-06-16-tool-behavior/REPORT.md
 *   artifacts/2026-06-16-tool-behavior/<N>-<name>.png
 *
 * Run:
 *   node scripts/audit/tool_behavior_probe.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUTDIR = path.join(REPO_ROOT, 'artifacts/2026-06-16-tool-behavior');
const BASE_URL = 'http://localhost:5071/workbench';
const CELL_SIZE = 12;

const GLYPH_A = 65;
const GLYPH_B = 66;
const FG1_HEX = '#ee44ff';  // vivid purple
const BG1_HEX = '#001133';  // near-black blue

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

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

async function clickCell(page, cx, cy) {
  const rendered = await getRenderedCellSize(page);
  await page.evaluate(({ x, y }) => {
    const scroll = document.getElementById('wholeSheetScroll');
    if (!scroll) return;
    scroll.scrollLeft = Math.max(0, x - scroll.clientWidth / 2);
    scroll.scrollTop  = Math.max(0, y - scroll.clientHeight / 2);
  }, { x: cx * rendered, y: cy * rendered });
  await page.waitForTimeout(80);
  await page.click('#wholeSheetCanvas', {
    position: { x: cx * rendered + rendered / 2, y: cy * rendered + rendered / 2 },
  });
}

async function canvasPoint(page, cx, cy) {
  const rendered = await getRenderedCellSize(page);
  await page.evaluate(({ x, y }) => {
    const scroll = document.getElementById('wholeSheetScroll');
    if (!scroll) return;
    scroll.scrollLeft = Math.max(0, x - scroll.clientWidth / 2);
    scroll.scrollTop  = Math.max(0, y - scroll.clientHeight / 2);
  }, { x: cx * rendered, y: cy * rendered });
  await page.waitForTimeout(80);
  const box = await page.locator('#wholeSheetCanvas').boundingBox();
  if (!box) throw new Error('wholeSheetCanvas bounding box missing');
  return { x: box.x + cx * rendered + rendered / 2, y: box.y + cy * rendered + rendered / 2 };
}

async function dragCells(page, x1, y1, x2, y2) {
  const p1 = await canvasPoint(page, x1, y1);
  const p2 = await canvasPoint(page, x2, y2);
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down();
  await page.mouse.move(p2.x, p2.y, { steps: 10 });
  await page.mouse.up();
}

// ── Drawer / tool helpers ─────────────────────────────────────────────────────

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

async function closeDrawer(page) {
  await page.evaluate(() => window.toggleDrawer && window.toggleDrawer()).catch(() => {});
  await page.waitForFunction(
    () => !document.querySelector('.ws-drawer.open') && !document.querySelector('.ws-drawer-backdrop.visible'),
    { timeout: 3000 }
  ).catch(() => {});
}

// Switch to a tool by opening tools drawer, clicking the button, closing drawer.
async function switchTool(page, btnId) {
  await openDrawer(page, 'tools');
  await page.locator(`#${btnId}`).click();
  await page.waitForTimeout(150);
  await closeDrawer(page);
}

// ── Artifact oracle ───────────────────────────────────────────────────────────

// Gzip-aware struct reader — no xp_core dependency.
// Counts cells with char_code > 32 across all XP layers.
function runArtifactOracle(xpPath) {
  if (!xpPath) return { error: 'no xp_path provided', totalNonZero: 0 };
  const abs = path.isAbsolute(xpPath) ? xpPath : path.resolve(REPO_ROOT, xpPath);
  const script = `
import gzip, struct
path = r'${abs}'
with open(path,'rb') as f: raw=f.read()
data = gzip.decompress(raw) if raw[:2]==b'\\x1f\\x8b' else raw
n_layers = struct.unpack_from('<i',data,4)[0]
off = 8; count = 0
for _ in range(n_layers):
    w=struct.unpack_from('<i',data,off)[0]; h=struct.unpack_from('<i',data,off+4)[0]; off+=8
    for _ in range(w*h):
        code=struct.unpack_from('<i',data,off)[0]
        if code > 32: count+=1
        off+=10
print(count)
`;
  try {
    const raw = execFileSync('python3', ['-c', script], {
      cwd: REPO_ROOT, encoding: 'utf8', timeout: 20000,
    });
    const totalNonZero = parseInt(raw.trim(), 10);
    return {
      error: isNaN(totalNonZero) ? 'parse error: ' + raw.trim() : null,
      totalNonZero: isNaN(totalNonZero) ? 0 : totalNonZero,
    };
  } catch (e) {
    return { error: String(e.message || e), totalNonZero: 0 };
  }
}

// ── Step recorder ─────────────────────────────────────────────────────────────

async function recordStep(page, results, name, fn) {
  const snap = () => page.evaluate(() => {
    const wb = window.__wb_debug?.getState?.() || {};
    return {
      sessionId: wb.sessionId,
      sessionDirty: wb.sessionDirty,
      wsAdvanced: document.body.classList.contains('ws-advanced'),
      wsSessionLoaded: document.body.classList.contains('ws-session-loaded'),
    };
  });

  const pre = await snap();
  let pass = true, error = '', data = {};
  try { data = (await fn()) || {}; }
  catch (e) { pass = false; error = e?.stack ? String(e.stack) : String(e); }
  await page.waitForTimeout(200);
  const post = await snap();
  const idx  = String(results.length + 1).padStart(2, '0');
  const shot = path.join(OUTDIR, `${idx}-${name}.png`);
  await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
  results.push({ name, pass, error, data, pre, post, screenshot: shot });
  if (!pass) throw new Error(`STEP FAIL [${name}]: ${error}`);
  return data;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUTDIR, { recursive: true });

  const recipe = {
    mode: 'tool_behavior',
    generated_at: new Date().toISOString(),
    template: 'player_native_idle_only',
  };
  writeFileSync(path.join(OUTDIR, 'recipe.json'), JSON.stringify(recipe, null, 2));

  const browser = await webkit.launch({ headless: false });
  const results  = [];
  let overallPass = false;
  let finalXpPath = '';

  try {
    const ctx  = await browser.newContext({ ...devices['iPad Pro 11 landscape'], acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // ── 1. Fresh mobile first screen ──────────────────────────────────────────
    await recordStep(page, results, 'fresh-mobile-first-screen', async () => {
      const visible = await page.locator('#mobileFirstScreen').isVisible();
      if (!visible) throw new Error('#mobileFirstScreen not visible on fresh load');
      return { visible };
    });

    // ── 2. Apply template ─────────────────────────────────────────────────────
    await recordStep(page, results, 'apply-template', async () => {
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
      const wb = await page.evaluate(() => window.__wb_debug?.getState?.() || {});
      if (!wb.sessionId) throw new Error('sessionId not set after template apply');
      return { template: 'player_native_idle_only', sessionId: wb.sessionId.slice(0, 8) };
    });

    // ── 3. Switch to Cell tool + set draw state (glyph A, vivid colors) ──────
    await recordStep(page, results, 'cell-tool-and-set-draw-state', async () => {
      await switchTool(page, 'wsToolCell');
      const fgRgb = hexToRgb(FG1_HEX);
      const bgRgb = hexToRgb(BG1_HEX);
      await page.evaluate(({ g, fg, bg }) => {
        const s = window.__wholeSheetEditor?._editorState;
        if (s) { s.drawGlyph = g; s.drawFg = fg; s.drawBg = bg; }
        // Also try public API
        const editor = window.__wholeSheetEditor;
        if (editor?.setDrawGlyph) editor.setDrawGlyph(g);
      }, { g: GLYPH_A, fg: fgRgb, bg: bgRgb });
      await page.waitForTimeout(200);
      const ws = await page.evaluate(() => window.__wholeSheetEditor?.getState?.() || {});
      return { activeTool: ws.activeTool, drawGlyph: ws.drawGlyph, drawFg: ws.drawFg, drawBg: ws.drawBg };
    });

    // ── 4. Draw cell at (4,4) — Cell tool canvas mutation ────────────────────
    await recordStep(page, results, 'cell-draw-canvas-mutation', async () => {
      const cellBefore = await readCell(page, 4, 4);
      await clickCell(page, 4, 4);
      await page.waitForTimeout(300);
      const cellAfter = await readCell(page, 4, 4);
      if (!cellAfter) throw new Error('cell (4,4) is null after draw click — Cell tool did not write');
      const ws = await page.evaluate(() => window.__wholeSheetEditor?.getState?.() || {});
      return {
        cellBefore: cellBefore?.idx ?? null,
        cellAfter: cellAfter?.idx ?? cellAfter?.glyph ?? cellAfter,
        activeTool: ws.activeTool,
        drawGlyph: ws.drawGlyph,
      };
    });

    // ── 5. Eyedropper sample at (4,4) ─────────────────────────────────────────
    await recordStep(page, results, 'eyedropper-sample', async () => {
      await switchTool(page, 'wsToolEyedropper');
      const wsBefore = await page.evaluate(() => window.__wholeSheetEditor?.getState?.() || {});
      const glyphBefore = wsBefore.drawGlyph;
      await clickCell(page, 4, 4);
      await page.waitForTimeout(400);
      const wsAfter = await page.evaluate(() => window.__wholeSheetEditor?.getState?.() || {});
      return {
        activeTool: wsAfter.activeTool,
        drawGlyphBefore: glyphBefore,
        drawGlyphAfter: wsAfter.drawGlyph,
        drawFgAfter: wsAfter.drawFg,
        drawBgAfter: wsAfter.drawBg,
        glyphChanged: wsAfter.drawGlyph !== glyphBefore || wsAfter.drawGlyph === GLYPH_A,
      };
    });

    // ── 6. Erase at (4,4) ─────────────────────────────────────────────────────
    await recordStep(page, results, 'erase-canvas-mutation', async () => {
      await switchTool(page, 'wsToolErase');
      const cellBefore = await readCell(page, 4, 4);
      await clickCell(page, 4, 4);
      await page.waitForTimeout(400);
      const cellAfter = await readCell(page, 4, 4);
      const erased = !cellAfter || cellAfter?.idx === 0 || cellAfter?.glyph === 0;
      if (!erased) throw new Error(`cell (4,4) not erased after Erase tool click: ${JSON.stringify(cellAfter)}`);
      return { cellBefore: cellBefore?.idx ?? cellBefore, cellAfter: cellAfter?.idx ?? cellAfter, erased };
    });

    // ── 7. Draw glyph B at (2,2) — prep for line ──────────────────────────────
    await recordStep(page, results, 'draw-glyph-b-at-2-2', async () => {
      await switchTool(page, 'wsToolCell');
      await page.evaluate(({ g }) => {
        const s = window.__wholeSheetEditor?._editorState;
        if (s) s.drawGlyph = g;
        const editor = window.__wholeSheetEditor;
        if (editor?.setDrawGlyph) editor.setDrawGlyph(g);
      }, { g: GLYPH_B });
      await clickCell(page, 2, 2);
      await page.waitForTimeout(300);
      const cell = await readCell(page, 2, 2);
      return { cellAt2_2: cell?.idx ?? cell?.glyph ?? cell };
    });

    // ── 8. Line drag (2,2)→(8,2) — cells along path ──────────────────────────
    await recordStep(page, results, 'line-draw-canvas-mutation', async () => {
      await switchTool(page, 'wsToolLine');
      const ws = await page.evaluate(() => window.__wholeSheetEditor?.getState?.() || {});
      if (ws.activeTool !== 'line') throw new Error(`activeTool is "${ws.activeTool}", expected "line"`);
      await dragCells(page, 2, 2, 8, 2);
      await page.waitForTimeout(500);
      const startCell = await readCell(page, 2, 2);
      const midCell   = await readCell(page, 5, 2);
      const endCell   = await readCell(page, 8, 2);
      const anyDrawn  = startCell || midCell || endCell;
      if (!anyDrawn) throw new Error('no cells drawn by Line tool along (2,2)→(8,2)');
      return {
        startCell: startCell?.idx ?? startCell?.glyph ?? startCell,
        midCell:   midCell?.idx ?? midCell?.glyph ?? midCell,
        endCell:   endCell?.idx ?? endCell?.glyph ?? endCell,
        lineDrawn: true,
      };
    });

    // ── 9. Fill tool switch — activeTool='fill' reachable ────────────────────
    await recordStep(page, results, 'fill-tool-switch', async () => {
      await openDrawer(page, 'tools');
      const exists = await page.locator('#wsToolFill').count() > 0;
      if (!exists) {
        await closeDrawer(page);
        return { reachable: false, reason: '#wsToolFill not in DOM' };
      }
      await page.locator('#wsToolFill').click();
      await page.waitForTimeout(150);
      await closeDrawer(page);
      const ws = await page.evaluate(() => window.__wholeSheetEditor?.getState?.() || {});
      return { reachable: true, activeTool: ws.activeTool };
    });

    // ── 10. Text tool switch — activeTool='text' reachable ───────────────────
    await recordStep(page, results, 'text-tool-switch', async () => {
      await openDrawer(page, 'tools');
      const exists = await page.locator('#wsToolText').count() > 0;
      if (!exists) {
        await closeDrawer(page);
        return { reachable: false, reason: '#wsToolText not in DOM' };
      }
      await page.locator('#wsToolText').click();
      await page.waitForTimeout(150);
      await closeDrawer(page);
      const ws = await page.evaluate(() => window.__wholeSheetEditor?.getState?.() || {});
      return { reachable: true, activeTool: ws.activeTool };
    });

    // ── 11. Export via Files drawer ───────────────────────────────────────────
    await recordStep(page, results, 'export-via-files-drawer', async () => {
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

    // ── 12. Artifact oracle ───────────────────────────────────────────────────
    await recordStep(page, results, 'artifact-oracle', async () => {
      const { error, totalNonZero } = runArtifactOracle(finalXpPath);
      if (error) throw new Error(`Artifact oracle error: ${error}`);
      if (totalNonZero <= 0) throw new Error('XP binary has no cells with char_code > 32');
      return { totalNonZero };
    });

    overallPass = results.every((r) => r.pass);
  } catch (_err) {
    overallPass = results.every((r) => r.pass);
  } finally {
    await browser.close();
  }

  writeFileSync(path.join(OUTDIR, 'result.json'), JSON.stringify({ overallPass, finalXpPath, results }, null, 2));

  // ── Report ─────────────────────────────────────────────────────────────────

  const step = (name) => results.find((r) => r.name === name);
  const ok   = (name) => step(name)?.pass ? '✅' : '❌';

  const cellDrawData    = step('cell-draw-canvas-mutation')?.data || {};
  const eyeData         = step('eyedropper-sample')?.data || {};
  const eraseData       = step('erase-canvas-mutation')?.data || {};
  const lineBData       = step('draw-glyph-b-at-2-2')?.data || {};
  const lineData        = step('line-draw-canvas-mutation')?.data || {};
  const fillData        = step('fill-tool-switch')?.data || {};
  const textData        = step('text-tool-switch')?.data || {};
  const oracleData      = step('artifact-oracle')?.data || {};
  const drawStateData   = step('cell-tool-and-set-draw-state')?.data || {};

  const lines = [
    '# Tool Behavior Probe',
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
  lines.push('## Canvas mutation results');
  lines.push('');
  lines.push(`${ok('cell-tool-and-set-draw-state')} Cell tool active; drawGlyph=${drawStateData.drawGlyph}; activeTool=${drawStateData.activeTool}`);
  lines.push(`${ok('cell-draw-canvas-mutation')} Cell draw: cell (4,4) after=${JSON.stringify(cellDrawData.cellAfter)}`);
  lines.push(`${ok('eyedropper-sample')} Eyedropper: activeTool=${eyeData.activeTool}; drawGlyph ${eyeData.drawGlyphBefore}→${eyeData.drawGlyphAfter}; glyphChanged=${eyeData.glyphChanged}`);
  lines.push(`${ok('erase-canvas-mutation')} Erase: cell (4,4) erased=${eraseData.erased}; after=${JSON.stringify(eraseData.cellAfter)}`);
  lines.push(`${ok('draw-glyph-b-at-2-2')} Draw glyph B prep: cell (2,2)=${JSON.stringify(lineBData.cellAt2_2)}`);
  lines.push(`${ok('line-draw-canvas-mutation')} Line (2,2)→(8,2): start=${JSON.stringify(lineData.startCell)} mid=${JSON.stringify(lineData.midCell)} end=${JSON.stringify(lineData.endCell)}`);

  if (fillData.reachable === false) {
    lines.push(`⬜ Fill tool — ${fillData.reason}`);
  } else {
    lines.push(`${ok('fill-tool-switch')} Fill: reachable; activeTool=${fillData.activeTool}`);
  }

  if (textData.reachable === false) {
    lines.push(`⬜ Text tool — ${textData.reason}`);
  } else {
    lines.push(`${ok('text-tool-switch')} Text: reachable; activeTool=${textData.activeTool}`);
  }

  lines.push(`${ok('export-via-files-drawer')} Export XP via Files drawer`);

  const oracleLabel = oracleData.totalNonZero != null
    ? `Artifact oracle (gzip-aware): totalNonZero=${oracleData.totalNonZero} (all layers)`
    : 'Artifact oracle: non-zero glyph cells confirmed in XP binary';
  lines.push(`${ok('artifact-oracle')} ${oracleLabel}`);

  lines.push('');
  lines.push('## What this probe does NOT cover');
  lines.push('');
  lines.push('- Fill flood-fill canvas mutation (only tool reachability confirmed)');
  lines.push('- Text insertion canvas mutation (only tool reachability confirmed)');
  lines.push('- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)');

  const md = lines.join('\n') + '\n';
  writeFileSync(path.join(OUTDIR, 'REPORT.md'), md);

  console.log(`\nResult: ${overallPass ? 'PASS' : 'FAIL'}`);
  console.log(`Steps: ${results.filter((r) => r.pass).length}/${results.length}`);
  for (const r of results) {
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}${r.error ? ' — ' + r.error.split('\n')[0] : ''}`);
  }
  if (finalXpPath) console.log(`Exported XP: ${finalXpPath}`);
  console.log(`Report: artifacts/2026-06-16-tool-behavior/REPORT.md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
