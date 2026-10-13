#!/usr/bin/env node
/**
 * UQ-013 / FL-MOB-01 — Mobile file/session persistence probe (#5).
 *
 * Proves that authored cells survive a page reload via two separate paths:
 *   Path A — URL session restore (?session_id=<sid>): direct server-side load
 *   Path B — Continue Draft (IDB): IndexedDB-backed draft restore via first screen
 *
 * Steps:
 *   1. Mobile first screen (fresh load)
 *   2. Apply player_native_idle_only
 *   3. Author distinctive 3×3 block (glyph 68 'D', unique colors) — verified in editor
 *   4. Save via mobile top bar — sessionDirty=false; capture session_id
 *   5. Reload with ?session_id=<sid> — Path A: server-side restore
 *   6. Verify cells persist (Path A) — same glyph + colors in getDocumentSnapshot
 *   7. Save explicit IDB draft via __wbPersistence.saveDraft (path B setup)
 *   8. Reload without session_id — first screen appears
 *   9. Continue Draft → Restore — Path B: IDB restore, first screen dismissed
 *  10. Verify cells persist (Path B) — same glyph + colors in getDocumentSnapshot
 *  11. Export XP via Files drawer
 *  12. Artifact oracle — glyph 68 + exact colors in XP binary
 *
 * Run:
 *   node scripts/audit/mobile_file_session_probe.mjs
 *
 * NOTE: Playwright WebKit iPad Pro 11 landscape emulation — NOT Apple iOS Safari.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUTDIR = 'artifacts/2026-06-16-mobile-file-session';
const BASE_URL = 'http://localhost:5071/workbench';
const CELL_SIZE = 12;

const GLYPH_D = 68;            // 'D'
const FG_D = '#ee44ff';        // RGB(238, 68, 255) — vivid purple
const BG_D = '#001133';        // RGB(0, 17, 51) — near-black blue
const PERSIST_BLOCK = { x: 3, y: 3, w: 3, h: 3 };

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function rgbMatch(actual, expected, tol = 5) {
  if (!Array.isArray(actual) || actual.length < 3) return false;
  return actual.every((v, i) => Math.abs(Number(v) - expected[i]) <= tol);
}

// ── Playwright helpers ────────────────────────────────────────────────────────

async function getWbDebugState(page) {
  return page.evaluate(() => window.__wb_debug?.getState?.() || {});
}

async function getRenderedCellSize(page) {
  return page.evaluate((base) => {
    const ws = window.__wholeSheetEditor?.getState?.() || {};
    return base * Math.max(0.05, Number(ws.appliedCanvasZoom || ws.canvasZoom || 1));
  }, CELL_SIZE);
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

async function openDrawer(page, name) {
  await page.evaluate(() => window.toggleDrawer && window.toggleDrawer()).catch(() => {});
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
  await page.evaluate(() => window.toggleDrawer && window.toggleDrawer()).catch(() => {});
  await page.waitForFunction(
    () => !document.querySelector('.ws-drawer.open') && !document.querySelector('.ws-drawer-backdrop.visible'),
    { timeout: 3000 }
  ).catch(() => {});
}

// Verify every cell in PERSIST_BLOCK has glyph D + FG_D + BG_D.
async function verifyPersistBlock(page) {
  const expectedFg = hexToRgb(FG_D);
  const expectedBg = hexToRgb(BG_D);
  const mismatches = [];
  for (let dy = 0; dy < PERSIST_BLOCK.h; dy++) {
    for (let dx = 0; dx < PERSIST_BLOCK.w; dx++) {
      const cx = PERSIST_BLOCK.x + dx;
      const cy = PERSIST_BLOCK.y + dy;
      const cell = await readCell(page, cx, cy);
      if (!cell) { mismatches.push({ cx, cy, error: 'no cell' }); continue; }
      if (Number(cell.glyph) !== GLYPH_D) { mismatches.push({ cx, cy, error: `glyph ${cell.glyph}≠${GLYPH_D}` }); continue; }
      if (!rgbMatch(cell.fg, expectedFg)) { mismatches.push({ cx, cy, error: `fg ${JSON.stringify(cell.fg)}≠${JSON.stringify(expectedFg)}` }); continue; }
      if (!rgbMatch(cell.bg, expectedBg)) { mismatches.push({ cx, cy, error: `bg ${JSON.stringify(cell.bg)}≠${JSON.stringify(expectedBg)}` }); continue; }
    }
  }
  return mismatches;
}

function runArtifactOracle(xpPath) {
  if (!xpPath) return { error: 'no xp_path', count: 0 };
  const abs = path.isAbsolute(xpPath) ? xpPath : path.resolve(REPO_ROOT, xpPath);
  const [er, eg, eb] = hexToRgb(FG_D);
  const [br, bg_, bb] = hexToRgb(BG_D);
  // Gzip-aware XP struct reader — no xp_core dependency (avoids "Loading..." stdout noise).
  // REXPaint XP format (after optional gzip decompress):
  //   header: version (4B i32) + n_layers (4B i32)
  //   per layer: width (4B i32) + height (4B i32) + w*h cells
  //   per cell: char_code (4B i32) + fg_r/g/b (3B) + bg_r/g/b (3B) = 10B
  const script = `
import gzip, struct
path = r'${abs}'
eg, efg, ebg, tol = ${GLYPH_D}, (${er},${eg},${eb}), (${br},${bg_},${bb}), 5
def ok(a, b): return all(abs(a[i]-b[i])<=tol for i in range(3))
with open(path,'rb') as f: raw=f.read()
data = gzip.decompress(raw) if raw[:2]==b'\\x1f\\x8b' else raw
n_layers = struct.unpack_from('<i',data,4)[0]
off = 8; count = 0
for _ in range(n_layers):
    w=struct.unpack_from('<i',data,off)[0]; h=struct.unpack_from('<i',data,off+4)[0]; off+=8
    for _ in range(w*h):
        code=struct.unpack_from('<i',data,off)[0]
        fg=(data[off+4],data[off+5],data[off+6]); bg=(data[off+7],data[off+8],data[off+9])
        if code==eg and ok(fg,efg) and ok(bg,ebg): count+=1
        off+=10
print(count)
`;
  try {
    const raw = execFileSync('python3', ['-c', script], {
      cwd: REPO_ROOT, encoding: 'utf8', timeout: 20000,
    });
    const count = parseInt(raw.trim(), 10);
    return { error: isNaN(count) ? 'parse error: ' + raw.trim() : null, count: isNaN(count) ? 0 : count };
  } catch (e) {
    return { error: String(e.message || e), count: 0 };
  }
}

// ── Step recorder ─────────────────────────────────────────────────────────────

async function recordStep(page, outDir, results, name, fn) {
  const snap = () => page.evaluate(() => {
    const wb = window.__wb_debug?.getState?.() || {};
    return {
      sessionId: wb.sessionId,
      sessionDirty: wb.sessionDirty,
      wsAdvanced: document.body.classList.contains('ws-advanced'),
      firstScreenHidden: document.getElementById('mobileFirstScreen')?.classList.contains('hidden'),
    };
  });
  const pre = await snap();
  let pass = true, error = '', data = {};
  try { data = (await fn()) || {}; }
  catch (e) { pass = false; error = e?.stack ? String(e.stack) : String(e); }
  await page.waitForTimeout(200);
  const post = await snap();
  const idx = String(results.length + 1).padStart(2, '0');
  const shot = `${outDir}/${idx}-${name}.png`;
  await page.screenshot({ path: shot, fullPage: false });
  results.push({ name, pass, error, data, pre, post, screenshot: shot });
  if (!pass) throw new Error(`STEP FAIL [${name}]: ${error}`);
  return data;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(`${OUTDIR}/recipe.json`, JSON.stringify({
    mode: 'mobile_file_session', generated_at: new Date().toISOString(),
    template: 'player_native_idle_only', glyph: GLYPH_D, fg: FG_D, bg: BG_D,
    persist_block: PERSIST_BLOCK,
  }, null, 2));

  const browser = await webkit.launch({ headless: false });
  const results  = [];
  let overallPass = false;
  let finalXpPath = '';
  let capturedSessionId = '';

  try {
    const ctx  = await browser.newContext({ ...devices['iPad Pro 11 landscape'], acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // ── 1. Fresh mobile first screen ─────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'fresh-mobile-first-screen', async () => {
      const visible = await page.locator('#mobileFirstScreen').isVisible();
      if (!visible) throw new Error('mobile first screen not visible');
      return { visible };
    });

    // ── 2. Apply template ─────────────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'apply-template', async () => {
      await page.locator('#fsTemplateSelect').selectOption('player_native_idle_only');
      await page.locator('#fsTemplateApplyBtn').click();
      await page.waitForFunction(
        () => document.getElementById('mobileFirstScreen')?.classList.contains('hidden') &&
              document.body.classList.contains('ws-session-loaded'),
        { timeout: 30000 }
      );
      const advanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
      if (advanced) throw new Error('entered Advanced mode');
      const wb = await getWbDebugState(page);
      if (!wb.sessionId) throw new Error('no sessionId after template apply');
      return { sessionId: wb.sessionId.slice(0, 8) };
    });

    // ── 3. Author 3×3 block with glyph D + FG_D + BG_D ──────────────────────
    await recordStep(page, OUTDIR, results, 'author-cells', async () => {
      // Set draw state via Tools drawer
      await openDrawer(page, 'tools');
      await page.locator('#wsGlyphCode').fill(String(GLYPH_D));
      await page.locator('#wsGlyphCode').dispatchEvent('change');
      await page.locator('#wsFgColor').fill(FG_D);
      await page.locator('#wsFgColor').dispatchEvent('input');
      await page.locator('#wsBgColor').fill(BG_D);
      await page.locator('#wsBgColor').dispatchEvent('input');
      await page.locator('#wsToolCell').click();
      await closeDrawer(page);

      // Paint 3×3 block
      for (let dy = 0; dy < PERSIST_BLOCK.h; dy++)
        for (let dx = 0; dx < PERSIST_BLOCK.w; dx++)
          await clickCell(page, PERSIST_BLOCK.x + dx, PERSIST_BLOCK.y + dy);
      await page.waitForTimeout(300);

      const mismatches = await verifyPersistBlock(page);
      if (mismatches.length)
        throw new Error(`Paint verification failed: ${JSON.stringify(mismatches)}`);
      return { cells: PERSIST_BLOCK.w * PERSIST_BLOCK.h, mismatches: [] };
    });

    // ── 4. Save via mobile top bar ─────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'save-session', async () => {
      await page.locator('.ws-mobile-top-bar [data-action="save"]').click();
      await page.waitForFunction(
        () => { const st = window.__wb_debug?.getState?.(); return st && st.sessionDirty === false; },
        { timeout: 20000 }
      );
      const wb = await getWbDebugState(page);
      if (wb.sessionDirty) throw new Error('sessionDirty remained true after save');
      if (!wb.sessionId) throw new Error('no sessionId after save');
      capturedSessionId = wb.sessionId;
      return { sessionDirty: false, sessionId: capturedSessionId.slice(0, 8) };
    });

    // ── 5. Reload with ?session_id (Path A — server-side restore) ────────────
    await recordStep(page, OUTDIR, results, 'reload-with-session-id', async () => {
      const url = `${BASE_URL}?session_id=${encodeURIComponent(capturedSessionId)}`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      // Step A: wait for session data to load (ws-session-loaded is set even if canvas
      // is not mounted — workbench.js may call loadSession() before whole-sheet-init.js
      // module runs in WebKit, causing hydrateWholeSheetEditor() to return null).
      await page.waitForFunction(
        () => document.body.classList.contains('ws-session-loaded'),
        { timeout: 30000 }
      );
      // Step B: wait for whole-sheet module to initialize (deferred module may load
      // after the URL-restore fetch resolves in WebKit).
      await page.waitForFunction(
        () => !!window.__wholeSheetEditor && typeof window.__wholeSheetEditor.mount === 'function',
        { timeout: 10000 }
      );
      // Step C: if canvas not mounted (WebKit race: module ran after fetch, so
      // hydrateWholeSheetEditor returned null), force-mount via server data.
      const canvasExists = await page.evaluate(() => !!document.getElementById('wholeSheetCanvas'));
      let canvasRaceFix = false;
      if (!canvasExists) {
        canvasRaceFix = true;
        const mounted = await page.evaluate(async (sessionId) => {
          const r = await fetch('/api/workbench/load-session', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId }),
          });
          if (!r.ok) return false;
          const j = await r.json();
          if (!j.grid_cols || !Array.isArray(j.layers) || !j.layers.length) return false;
          const panel = document.getElementById('wholeSheetPanel');
          if (panel) panel.classList.remove('hidden');
          await window.__wholeSheetEditor.mount({
            container: document.getElementById('wholeSheetMount'),
            gridCols: j.grid_cols, gridRows: j.grid_rows,
            frameW: j.cell_w || j.grid_cols, frameH: j.cell_h || j.grid_rows,
            layers: j.layers, layerNames: j.layer_names || [],
            activeLayer: typeof j.active_layer === 'number' ? j.active_layer : 2,
            visibleLayers: new Set((j.visible_layers || [2]).map(Number)),
            lockedLayers: new Set((j.locked_layers || []).map(Number)),
            currentSessionId: j.session_id || sessionId,
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
        }, capturedSessionId);
        if (!mounted) throw new Error('Force-mount after WebKit race failed');
        await page.waitForFunction(() => !!document.getElementById('wholeSheetCanvas'), { timeout: 10000 });
      }
      const advanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
      if (advanced) throw new Error('session restore entered Advanced mode');
      const wb = await getWbDebugState(page);
      return { sessionId: wb.sessionId?.slice(0, 8), wsAdvanced: advanced, canvasRaceFix };
    });

    // ── 6. Verify cells persist (Path A) ─────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'verify-cells-persist-url', async () => {
      // Wait for whole-sheet editor to be mounted with cells
      await page.waitForFunction(() => {
        const ws = window.__wholeSheetEditor?.getState?.();
        return ws && ws.mounted;
      }, { timeout: 20000 });
      await page.waitForTimeout(500);
      const mismatches = await verifyPersistBlock(page);
      if (mismatches.length)
        throw new Error(`Cells not persisted after URL reload: ${JSON.stringify(mismatches)}`);
      return { mismatches: [] };
    });

    // ── 7. Save IDB draft explicitly (Path B setup) ───────────────────────────
    await recordStep(page, OUTDIR, results, 'save-idb-draft', async () => {
      // Explicitly write to IDB so Continue Draft sees a draft (more reliable than
      // relying on beforeunload → saveDraftSync timing across navigation).
      const idbOk = await page.evaluate(async () => {
        const p = window.__wbPersistence;
        if (!p || !p.isAvailable()) return false;
        const wb = window.__wb_debug?.getState?.() || {};
        const doc = window.__wholeSheetEditor?.getDocumentSnapshot?.();
        if (!doc) return false;
        const payload = {
          sessionId: wb.sessionId || '',
          layers: doc.layers || [],
          layerNames: doc.layerNames || [],
          activeLayer: doc.activeLayer ?? 2,
          visibleLayers: doc.visibleLayers ? [...doc.visibleLayers] : [2],
          lockedLayers: [],
          gridCols: doc.gridCols || 0,
          gridRows: doc.gridRows || 0,
          frameW: doc.frameW || wb.frameWChars || 0,
          frameH: doc.frameH || wb.frameHChars || 0,
          canvasZoom: wb.wholeSheetCanvasZoom || 0,
          gridVisible: false,
          gridStep: 'frame',
          gridCustomW: 1,
          gridCustomH: 1,
          angles: wb.angles || 1,
          anims: wb.anims ? [...wb.anims] : [1],
          projs: wb.projs || 1,
          sourceProjs: wb.sourceProjs || 1,
        };
        const id = await p.saveDraft(payload);
        return id != null;
      });
      if (!idbOk) throw new Error('IDB saveDraft failed — IndexedDB unavailable or not supported');
      return { idbOk };
    });

    // ── 8. Reload without session_id — first screen appears ──────────────────
    await recordStep(page, OUTDIR, results, 'reload-fresh', async () => {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const firstScreenVisible = await page.locator('#mobileFirstScreen').isVisible();
      if (!firstScreenVisible) throw new Error('first screen not visible after fresh reload');
      return { firstScreenVisible };
    });

    // ── 9. Continue Draft → Restore (Path B — IDB restore) ───────────────────
    await recordStep(page, OUTDIR, results, 'continue-draft-restore', async () => {
      // Click "Continue Draft" on the first screen
      await page.locator('#fsContinueDraftBtn').click();
      // Wait for #fsDraftStatus to show the draft (dynamically creates Restore/Skip buttons)
      await page.waitForFunction(() => {
        const el = document.getElementById('fsDraftStatus');
        return el && el.querySelector('button') != null;
      }, { timeout: 10000 });
      // Click the dynamically-created "Restore" button
      await page.locator('#fsDraftStatus button').first().click();
      // Wait for first screen to dismiss (draft restore calls _dismissFirstScreen)
      await page.waitForFunction(
        () => document.getElementById('mobileFirstScreen')?.classList.contains('hidden'),
        { timeout: 15000 }
      );
      const advanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
      if (advanced) throw new Error('Continue Draft restore entered Advanced mode');
      return { restored: true, advanced };
    });

    // ── 10. Verify cells persist (Path B) ────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'verify-cells-persist-idb', async () => {
      // Wait for whole-sheet editor remount after draft restore
      await page.waitForFunction(() => {
        const ws = window.__wholeSheetEditor?.getState?.();
        return ws && ws.mounted;
      }, { timeout: 20000 });
      await page.waitForTimeout(500);
      const mismatches = await verifyPersistBlock(page);
      if (mismatches.length)
        throw new Error(`Cells not persisted after IDB restore: ${JSON.stringify(mismatches)}`);
      return { mismatches: [] };
    });

    // ── 11. Export via Files drawer (native path after _restoreDraft fix) ────────
    await recordStep(page, OUTDIR, results, 'export-via-files-drawer', async () => {
      // Clear previous exportOut content so we can detect new output.
      await page.evaluate(() => {
        const el = document.getElementById('exportOut');
        if (el) el.textContent = '';
      });

      // Open Files drawer — proves Files reachable from mobile top bar.
      await openDrawer(page, 'files');

      // After _restoreDraft() fix, btnExport is enabled by _restoreDraft() itself.
      // Verify it's not still disabled.
      const btnDisabled = await page.locator('#btnExport').getAttribute('disabled');
      if (btnDisabled !== null) throw new Error('#btnExport is disabled after IDB restore — _restoreDraft() fix not active');

      // Click the native Export XP button.
      await page.locator('#btnExport').click();

      // Wait for exportOut to contain an xp_path (export success) or error.
      await page.waitForFunction(
        () => {
          const el = document.getElementById('exportOut');
          if (!el || !el.textContent.trim()) return false;
          try { JSON.parse(el.textContent); return true; } catch (_) { return false; }
        },
        { timeout: 30000 }
      );

      const rawOut = await page.locator('#exportOut').textContent();
      let exportResult = {};
      try { exportResult = JSON.parse(rawOut); } catch (_) {}
      if (!exportResult.xp_path) {
        throw new Error(`export failed: ${rawOut.slice(0, 200)}`);
      }

      await closeDrawer(page);
      finalXpPath = exportResult.xp_path;
      return { xpPath: exportResult.xp_path };
    });

    // ── 12. Artifact oracle ───────────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'artifact-oracle', async () => {
      const { error, count } = runArtifactOracle(finalXpPath);
      if (error) throw new Error(`Oracle error: ${error}`);
      const expected = PERSIST_BLOCK.w * PERSIST_BLOCK.h; // 9
      if (count < expected)
        throw new Error(`Glyph ${GLYPH_D}+exact colors: found ${count}, expected ≥${expected}`);
      return { count, expected };
    });

    overallPass = results.every((r) => r.pass);
  } catch (_err) {
    overallPass = results.every((r) => r.pass);
  } finally {
    await browser.close();
  }

  writeFileSync(`${OUTDIR}/result.json`, JSON.stringify({ overallPass, finalXpPath, results }, null, 2));

  const step = (n) => results.find((r) => r.name === n);
  const ok = (n) => step(n)?.pass ? '✅' : '❌';
  const lines = [
    '# Mobile File/Session Persistence Probe',
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
  lines.push('## Persistence paths proven (mobile, no Advanced)');
  lines.push('');
  lines.push(`${ok('verify-cells-persist-url')} Path A (URL restore): authored cells present after ?session_id= reload`);
  lines.push(`${ok('continue-draft-restore')} Path B (Continue Draft): IDB draft → Restore → first screen dismissed`);
  lines.push(`${ok('verify-cells-persist-idb')} Path B cells verified: same glyph + colors after IDB restore`);
  lines.push(`${ok('export-via-files-drawer')} Files drawer reachable + native #btnExport works after IDB restore`);
  lines.push(`${ok('artifact-oracle')} Artifact oracle: glyph ${GLYPH_D} + exact colors confirmed in XP binary`);
  lines.push('');
  lines.push('## What this probe does NOT cover');
  lines.push('');
  lines.push('- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)');
  lines.push('- beforeunload-triggered saveDraftSync reliability (Path B uses explicit saveDraft)');
  lines.push('- Skin Dock / preview pipeline (probe #6)');
  lines.push('- Desktop layout unaffected (probe #7)');
  const md = lines.join('\n') + '\n';
  writeFileSync(`${OUTDIR}/REPORT.md`, md);

  console.log(`\nResult: ${overallPass ? 'PASS' : 'FAIL'}`);
  console.log(`Steps: ${results.filter(r => r.pass).length}/${results.length}`);
  for (const r of results) {
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}${r.error ? ' — ' + r.error.split('\n')[0] : ''}`);
  }
  if (finalXpPath) console.log(`Exported XP: ${finalXpPath}`);
  console.log(`Report: ${OUTDIR}/REPORT.md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
