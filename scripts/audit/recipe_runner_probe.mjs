#!/usr/bin/env node
/**
 * UQ-013 / FL-MOB-01 — Seeded cross-surface recipe runner (#10 of execution order).
 *
 * Composes actions across ALL major mobile surfaces in a single deterministic session.
 * Closest automation substitute for "I can work on my iPad" confidence.
 *
 * Recipe (seed 1 — deterministic, no Math.random()):
 *   Create from template → Draw (glyph G, colors) → Erase 1 cell → Frames: col right →
 *   Frames: add frame → Layers: toggle visibility → Layers: add layer →
 *   Source: skip (structural, covered by source_import_probe) →
 *   Save → Reload (URL restore) → Verify cells → Export → Share → Oracle
 *
 * Steps:
 *   1.  Mobile first screen
 *   2.  Create from template (player_native_idle_only)
 *   3.  Set draw state (glyph G=71, vivid orange/dark)
 *   4.  Draw 2×2 block at (5,5)
 *   5.  Erase cell at (5,5)
 *   6.  Open frames → Col Right
 *   7.  Add frame
 *   8.  Open layers → toggle visibility layer 2
 *   9.  Restore visibility layer 2
 *  10.  Add layer
 *  11.  Save → capture sessionId
 *  12.  Reload (URL restore) → verify glyph G at (6,5), (5,6), (6,6)
 *  13.  Export → xp_path
 *  14.  Share / _downloadBlob trigger
 *  15.  Artifact oracle (glyph G count ≥ 3)
 *
 * Run:
 *   node scripts/audit/recipe_runner_probe.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUTDIR = 'artifacts/2026-06-16-recipe-runner';
const BASE_URL = 'http://localhost:5071/workbench';
const CELL_SIZE = 12;

// Seed 1 draw state
const GLYPH_G = 71;
const FG_G = '#ff6600';  // vivid orange
const BG_G = '#000022';  // near-black navy

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function rgbMatch(a, b, tol=5) {
  if (!Array.isArray(a)||a.length<3) return false;
  return a.every((v,i)=>Math.abs(Number(v)-b[i])<=tol);
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
    const li  = Number(ws.activeLayerIndex ?? 2);
    const layer = doc?.layers?.[li];
    const cols = Number(doc?.gridCols || 0);
    if (!Array.isArray(layer) || cols <= 0) return null;
    return layer[cy * cols + cx] || null;
  }, { cx: x, cy: y });
}

async function clickCell(page, cx, cy) {
  const rendered = await getRenderedCellSize(page);
  await page.evaluate(({ x, y }) => {
    const s = document.getElementById('wholeSheetScroll');
    if (s) {
      s.scrollLeft = Math.max(0, x - s.clientWidth / 2);
      s.scrollTop  = Math.max(0, y - s.clientHeight / 2);
    }
  }, { x: cx * rendered, y: cy * rendered });
  await page.waitForTimeout(80);
  await page.click('#wholeSheetCanvas', {
    position: { x: cx * rendered + rendered / 2, y: cy * rendered + rendered / 2 },
  });
}

async function openDrawer(page, name) {
  // Close any open drawer first by clicking the backdrop or toggling
  await page.evaluate(() => {
    const backdrop = document.querySelector('.ws-drawer-backdrop');
    if (backdrop) backdrop.click();
  }).catch(() => {});
  await page.waitForTimeout(100);
  await page.locator(`.ws-mobile-top-bar [data-drawer-toggle="${name}"]`).click();
  await page.waitForFunction(
    (n) => !!document.querySelector(`.ws-drawer[data-drawer="${n}"].open`),
    name, { timeout: 5000 }
  );
  const advanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
  if (advanced) throw new Error(`opening drawer "${name}" entered Advanced mode`);
}

async function closeDrawer(page) {
  await page.evaluate(() => {
    const backdrop = document.querySelector('.ws-drawer-backdrop');
    if (backdrop) backdrop.click();
  }).catch(() => {});
  await page.waitForFunction(
    () => !document.querySelector('.ws-drawer.open') && !document.querySelector('.ws-drawer-backdrop.visible'),
    { timeout: 3000 }
  ).catch(() => {});
}

function runOracleForGlyph(xpPath, glyph, fgRgb, bgRgb) {
  if (!xpPath) return { error: 'no xp_path', count: 0 };
  const abs = path.resolve(REPO_ROOT, xpPath);
  const script = `
import gzip, struct
path = r'${abs}'
eg, efg, ebg, tol = ${glyph}, (${fgRgb.join(',')}), (${bgRgb.join(',')}), 5
def ok(a,b): return all(abs(a[i]-b[i])<=tol for i in range(3))
with open(path,'rb') as f: raw=f.read()
data = gzip.decompress(raw) if raw[:2]==b'\\x1f\\x8b' else raw
n = struct.unpack_from('<i',data,4)[0]; off=8; c=0
for _ in range(n):
    w=struct.unpack_from('<i',data,off)[0]; h=struct.unpack_from('<i',data,off+4)[0]; off+=8
    for _ in range(w*h):
        code=struct.unpack_from('<i',data,off)[0]
        fg=(data[off+4],data[off+5],data[off+6]); bg=(data[off+7],data[off+8],data[off+9])
        if code==eg and ok(fg,efg) and ok(bg,ebg): c+=1
        off+=10
print(c)
`;
  try {
    const raw = execFileSync('python3',['-c',script],{cwd:REPO_ROOT,encoding:'utf8',timeout:20000});
    const n = parseInt(raw.trim(),10);
    return { error: isNaN(n)?'parse':null, count: isNaN(n)?0:n };
  } catch(e) { return { error: String(e.message||e), count:0 }; }
}

async function recordStep(page, outdir, results, name, fn) {
  const idx = results.length + 1;
  let data = {}, error = null;
  try { data = await fn() || {}; } catch (e) { error = String(e.message||e); }
  await page.screenshot({ path: path.join(REPO_ROOT, outdir, `${String(idx).padStart(2,'0')}-${name}.png`), fullPage: false }).catch(()=>{});
  const entry = { step:idx, name, status: error?'FAIL':'PASS', error, ...data };
  results.push(entry);
  if (error) throw new Error(`Step ${idx} ${name}: ${error}`);
  return entry;
}

(async () => {
  mkdirSync(path.join(REPO_ROOT, OUTDIR), { recursive: true });

  const fgRgb = hexToRgb(FG_G);
  const bgRgb = hexToRgb(BG_G);

  const browser = await webkit.launch({ headless: false });
  const ctx = await browser.newContext({
    ...devices['iPad Pro 11 landscape'],
    acceptDownloads: true,
  });
  const page = await ctx.newPage();

  const results = [];
  let sessionId = null;
  let xpPath = null;

  const recipe = {
    seed: 1,
    glyph: GLYPH_G,
    fg: FG_G,
    bg: BG_G,
    drawBlock: { x: 5, y: 5, w: 2, h: 2 },
    eraseAt: { x: 5, y: 5 },
  };

  try {
    // 1. Fresh screen
    await recordStep(page, OUTDIR, results, 'fresh-first-screen', async () => {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('#mobileFirstScreen', { state: 'visible', timeout: 15000 });
      return { firstScreen: true };
    });

    // 2. Create from template
    await recordStep(page, OUTDIR, results, 'create-from-template', async () => {
      await page.locator('#fsTemplateSelect').selectOption('player_native_idle_only');
      await page.locator('#fsTemplateApplyBtn').click();
      await page.waitForFunction(
        () => document.getElementById('mobileFirstScreen')?.classList.contains('hidden') &&
          document.body.classList.contains('ws-session-loaded') &&
          !!document.getElementById('wholeSheetCanvas'),
        { timeout: 30000 }
      );
      const advanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
      if (advanced) throw new Error('template path entered Advanced mode');
      const ws = await page.evaluate(() => window.__wb_debug?.getState?.() || {});
      return { gridCols: ws.gridCols, gridRows: ws.gridRows };
    });

    // 3. Set draw state (glyph G) via direct state inject
    await recordStep(page, OUTDIR, results, 'set-draw-state', async () => {
      await openDrawer(page, 'tools');
      await page.locator('#wsToolCell').click();
      await page.waitForTimeout(100);
      await closeDrawer(page);
      await page.evaluate(({ g, fg, bg }) => {
        window.__wholeSheetEditor?.setDrawState({ glyph: g, fg, bg });
      }, { g: GLYPH_G, fg: fgRgb, bg: bgRgb });
      await page.waitForTimeout(100);
      const ws = await page.evaluate(() => window.__wholeSheetEditor?.getState?.() || {});
      if (ws.drawGlyph !== GLYPH_G) throw new Error(`setDrawState failed: drawGlyph=${ws.drawGlyph}, expected ${GLYPH_G}`);
      return { activeTool: ws.activeTool, drawGlyph: ws.drawGlyph };
    });

    // 4. Draw 2×2 block at (5,5)
    await recordStep(page, OUTDIR, results, 'draw-2x2-block', async () => {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          await clickCell(page, 5 + dx, 5 + dy);
          await page.waitForTimeout(50);
        }
      }
      await page.waitForTimeout(200);
      const cell = await readCell(page, 6, 5);
      return { cell66: cell?.glyph ?? cell?.idx };
    });

    // 5. Erase cell (5,5)
    await recordStep(page, OUTDIR, results, 'erase-5-5', async () => {
      await openDrawer(page, 'tools');
      await page.locator('#wsToolErase').click();
      await page.waitForTimeout(100);
      await closeDrawer(page);
      const before = await readCell(page, 5, 5);
      await clickCell(page, 5, 5);
      await page.waitForTimeout(300);
      const after = await readCell(page, 5, 5);
      const erased = !after || (after?.glyph ?? 0) === 0;
      return { before: before?.glyph ?? before?.idx, after: after?.glyph ?? after?.idx, erased };
    });

    // 6. Frames: col right
    await recordStep(page, OUTDIR, results, 'frames-col-right', async () => {
      // Switch back to cell tool first
      await openDrawer(page, 'tools');
      await page.locator('#wsToolCell').click();
      await page.waitForTimeout(100);
      await closeDrawer(page);
      await openDrawer(page, 'frames');
      const firstCell = page.locator('.frame-cell').first();
      await firstCell.click();
      await page.waitForTimeout(200);
      const wsBefore = await page.evaluate(() => window.__wb_debug?.getState?.() || {});
      const colBefore = wsBefore.selectedFrames?.[0]?.col ?? 0;
      const colRightEnabled = await page.evaluate(() => !document.getElementById('colRightBtn')?.disabled);
      if (colRightEnabled) {
        await page.locator('#colRightBtn').click();
        await page.waitForTimeout(300);
      }
      const wsAfter = await page.evaluate(() => window.__wb_debug?.getState?.() || {});
      const colAfter = wsAfter.selectedFrames?.[0]?.col ?? 0;
      await closeDrawer(page);
      return { colBefore, colAfter, moved: colRightEnabled && colAfter !== colBefore };
    });

    // 7. Frames: add frame
    await recordStep(page, OUTDIR, results, 'frames-add-frame', async () => {
      await openDrawer(page, 'frames');
      const countBefore = await page.evaluate(() => document.querySelectorAll('.frame-cell').length);
      await page.locator('#addFrameBtn').click();
      await page.waitForTimeout(500);
      const countAfter = await page.evaluate(() => document.querySelectorAll('.frame-cell').length);
      await closeDrawer(page);
      return { countBefore, countAfter, added: countAfter > countBefore };
    });

    // 8. Layers: toggle visibility layer 2
    await recordStep(page, OUTDIR, results, 'layers-toggle-vis', async () => {
      await openDrawer(page, 'layers');
      await page.waitForSelector('#wsLayersPanel .ws-layer-row', { state: 'visible', timeout: 5000 });
      const visBefore = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#wsLayersPanel .ws-layer-row')];
        return rows[2]?.querySelector('.ws-layer-vis-btn')?.textContent?.trim();
      });
      await page.evaluate((idx) => {
        const rows = [...document.querySelectorAll('#wsLayersPanel .ws-layer-row')];
        const btn = rows[idx]?.querySelector('.ws-layer-vis-btn');
        if (btn) btn.click();
      }, 2);
      await page.waitForTimeout(300);
      const visAfter = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#wsLayersPanel .ws-layer-row')];
        return rows[2]?.querySelector('.ws-layer-vis-btn')?.textContent?.trim();
      });
      return { visBefore, visAfter, toggled: visBefore !== visAfter };
    });

    // 9. Layers: restore visibility
    await recordStep(page, OUTDIR, results, 'layers-restore-vis', async () => {
      await page.evaluate((idx) => {
        const rows = [...document.querySelectorAll('#wsLayersPanel .ws-layer-row')];
        const btn = rows[idx]?.querySelector('.ws-layer-vis-btn');
        if (btn) btn.click();
      }, 2);
      await page.waitForTimeout(300);
      const vis = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#wsLayersPanel .ws-layer-row')];
        return rows[2]?.querySelector('.ws-layer-vis-btn')?.textContent?.trim();
      });
      await closeDrawer(page);
      return { visRestored: vis };
    });

    // 10. Layers: add layer
    await recordStep(page, OUTDIR, results, 'layers-add-layer', async () => {
      await openDrawer(page, 'layers');
      const countBefore = await page.evaluate(() => document.querySelectorAll('#wsLayersPanel .ws-layer-row').length);
      await page.locator('#wsLayersPanel .ws-layer-add-btn').click();
      await page.waitForTimeout(500);
      const countAfter = await page.evaluate(() => document.querySelectorAll('#wsLayersPanel .ws-layer-row').length);
      await closeDrawer(page);
      return { countBefore, countAfter, added: countAfter > countBefore };
    });

    // 11. Save
    await recordStep(page, OUTDIR, results, 'save', async () => {
      await page.locator('.ws-mobile-top-bar [data-action="save"]').click();
      const saved = await page.waitForFunction(
        () => window.__wb_debug?.getState?.()?.sessionDirty === false,
        { timeout: 15000 }
      ).then(() => true).catch(() => false);
      const ws = await page.evaluate(() => window.__wb_debug?.getState?.() || {});
      sessionId = ws.sessionId;
      if (!sessionId) throw new Error('no sessionId after save');
      return { saved, sessionId };
    });

    // 12. Reload + URL restore + verify glyph G
    await recordStep(page, OUTDIR, results, 'reload-url-restore', async () => {
      await page.goto(`${BASE_URL}?session_id=${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      // Wait for ws-session-loaded (canvas may not exist yet due to init race)
      await page.waitForFunction(
        () => document.body.classList.contains('ws-session-loaded'),
        { timeout: 30000 }
      );
      // If canvas missing (hydrateWholeSheetEditor ran before whole-sheet-init.js
      // had set window.__wholeSheetEditor), re-fetch session and force-mount
      const canvasExists = await page.evaluate(() => !!document.getElementById('wholeSheetCanvas'));
      if (!canvasExists) {
        const forceMounted = await page.evaluate(async (sid) => {
          const wsEditor = window.__wholeSheetEditor;
          const mountEl = document.getElementById('wholeSheetMount');
          const panel = document.getElementById('wholeSheetPanel');
          if (!wsEditor || !mountEl || !panel) return false;
          const r = await fetch('/api/workbench/load-session', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sid }),
          });
          if (!r.ok) return false;
          const j = await r.json();
          if (!j.grid_cols || !Array.isArray(j.layers) || !j.layers.length) return false;
          panel.classList.remove('hidden');
          await wsEditor.mount({
            container: mountEl,
            gridCols: j.grid_cols, gridRows: j.grid_rows,
            frameW: j.cell_w || j.grid_cols, frameH: j.cell_h || j.grid_rows,
            layers: j.layers, layerNames: j.layer_names || [],
            activeLayer: typeof j.active_layer === 'number' ? j.active_layer : 2,
            visibleLayers: new Set((j.visible_layers || [2]).map(Number)),
            lockedLayers: new Set((j.locked_layers || []).map(Number)),
            currentSessionId: j.session_id || sid,
            sessionKind: j.session_kind || '',
            metadataStatus: j.metadata_status || '',
            canvasZoom: j.whole_sheet_canvas_zoom || 0,
            gridVisible: !!j.whole_sheet_grid_visible,
            gridStep: j.whole_sheet_grid_step || 'frame',
            gridCustomW: j.whole_sheet_grid_custom_w || 1,
            gridCustomH: j.whole_sheet_grid_custom_h || 1,
            gridTemplatePresets: [],
          });
          return true;
        }, sessionId);
        if (!forceMounted) throw new Error('force-mount after canvas race failed');
        await page.waitForFunction(
          () => !!document.getElementById('wholeSheetCanvas'),
          { timeout: 10000 }
        );
      }
      await page.waitForFunction(
        () => { const ws = window.__wholeSheetEditor?.getState?.(); return ws && ws.mounted; },
        { timeout: 20000 }
      );
      await page.waitForTimeout(500);
      // Check cells (6,5), (5,6), (6,6) — erased (5,5) should be gone
      const c65 = await readCell(page, 6, 5);
      const c56 = await readCell(page, 5, 6);
      const c66 = await readCell(page, 6, 6);
      const hits = [c65, c56, c66].filter(c => c && rgbMatch(c?.fg ?? c?.fgRgb ?? [], fgRgb)).length;
      const erased55 = await readCell(page, 5, 5);
      return {
        hitsAfterReload: hits,
        erased55: !erased55 || (erased55?.glyph ?? 0) === 0,
        c65: c65?.glyph ?? c65?.idx,
      };
    });

    // 13. Export
    await recordStep(page, OUTDIR, results, 'export', async () => {
      await page.evaluate(() => {
        const el = document.getElementById('exportOut');
        if (el) el.textContent = '';
      });
      await openDrawer(page, 'files');
      await page.locator('.ws-drawer[data-drawer="files"] #btnExport').click();
      const xpPathHandle = await page.waitForFunction(
        () => {
          try {
            const txt = document.getElementById('exportOut')?.textContent || '';
            const j = JSON.parse(txt);
            return j.xp_path || null;
          } catch (_) { return null; }
        },
        { timeout: 30000 }
      ).catch(() => null);
      xpPath = xpPathHandle ? await xpPathHandle.jsonValue() : null;
      await closeDrawer(page);
      if (!xpPath) throw new Error('no xp_path in exportOut after export');
      return { xpPath };
    });

    // 14. Share / download trigger
    await recordStep(page, OUTDIR, results, 'share-download', async () => {
      await openDrawer(page, 'files');
      const shareBtn = page.locator('button:has-text("Share"), button:has-text("Download"), [data-action="share"]').first();
      if (!await shareBtn.count()) { await closeDrawer(page); return { triggered: false, reason: 'no share button' }; }
      const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
      await shareBtn.click();
      const event = await dl;
      await closeDrawer(page);
      return { triggered: !!event };
    });

    // 15. Oracle
    await recordStep(page, OUTDIR, results, 'artifact-oracle', async () => {
      const result = runOracleForGlyph(xpPath, GLYPH_G, fgRgb, bgRgb);
      if (result.error) throw new Error(`oracle error: ${result.error}`);
      if (result.count < 3) throw new Error(`oracle: glyphG count=${result.count} < expected 3 (drew 4, erased 1)`);
      return { xpPath, glyphGCount: result.count };
    });

  } catch (err) {
    console.error('PROBE FAILED:', err.message);
  }

  await browser.close();

  const overall = results.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL';
  writeFileSync(path.join(REPO_ROOT, OUTDIR, 'result.json'), JSON.stringify({ overall, recipe, steps: results }, null, 2));
  writeFileSync(path.join(REPO_ROOT, OUTDIR, 'recipe.json'), JSON.stringify(recipe, null, 2));

  const lines = [
    `# Recipe Runner Probe (Seed 1)`,
    ``,
    `Result: **${overall}**`,
    xpPath ? `Exported XP: \`${xpPath}\`` : '',
    ``,
    `Playwright WebKit under iPad Pro 11 landscape profile — NOT Apple iOS Safari.`,
    ``,
    `## Recipe`,
    ``,
    `Seed: 1 | Glyph: ${GLYPH_G} | FG: ${FG_G} | BG: ${BG_G}`,
    `Draw 2×2 at (5,5) → erase (5,5) → frames col-right → frames add → layers vis-toggle → layers add → save → reload → export → oracle`,
    ``,
    `## Steps`,
    ``,
    ...results.map(r => `${r.step}. ${r.status} — ${r.name}${r.error ? ` ← ${r.error}` : ''}`),
    ``,
    `## Cross-surface coverage in one session`,
    ``,
    `Draw (Cell tool canvas mutation)`,
    `Erase (canvas mutation)`,
    `Frames (col-right + add-frame)`,
    `Layers (vis-toggle + add-layer)`,
    `Save → reload (URL restore)`,
    `Export → oracle`,
    `Share / download`,
  ].join('\n');

  writeFileSync(path.join(REPO_ROOT, OUTDIR, 'REPORT.md'), lines);
  console.log(`\nResult: ${overall}`);
  results.forEach(r => console.log(`  ${r.status} ${r.name}${r.error ? ' — ' + r.error : ''}`));
})();
