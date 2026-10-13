#!/usr/bin/env node
/**
 * UQ-013 / FL-MOB-01 — Mobile source/import probe (#4).
 *
 * Proves that the Import drawer PNG upload and Source drawer controls work
 * in the mobile editor-first shell without entering Advanced mode, and that
 * "Convert to XP" populates the whole-sheet editor with real cells.
 *
 * Covers, in order:
 *   1. Mobile first screen (fresh load)
 *   2. Apply player_native_idle_only — editor-first, ws-advanced absent
 *   3. Upload PNG via Import drawer — sourceImageLoaded=true + wbRun enabled
 *   4. Source drawer visible — canvas shows image; Draw Box + Find Sprites reachable
 *   5. Draw source box — drawBoxBtn + canvas drag → drawCurrent set
 *   6. Find sprites — extractBtn clickable without Advanced mode
 *   7. Convert to XP — wbRun, wait for pipeline, verify cells changed in editor
 *   8. Save via mobile top bar — sessionDirty → false
 *   9. Export XP via Files drawer — xp_path obtained
 *  10. Artifact oracle — non-zero glyph cells confirmed in XP binary
 *
 * Output:
 *   artifacts/2026-06-16-mobile-source-import/recipe.json
 *   artifacts/2026-06-16-mobile-source-import/result.json
 *   artifacts/2026-06-16-mobile-source-import/REPORT.md
 *   artifacts/2026-06-16-mobile-source-import/<N>-<name>.png
 *
 * Run:
 *   node scripts/audit/mobile_source_import_probe.mjs
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
const OUTDIR = 'artifacts/2026-06-16-mobile-source-import';
const BASE_URL = 'http://localhost:5071/workbench';
const FIXTURE_PNG = path.resolve(REPO_ROOT, 'fixtures/player-sprite.png');

// ── Playwright helpers ────────────────────────────────────────────────────────

async function getWbDebugState(page) {
  return page.evaluate(() => window.__wb_debug?.getState?.() || {});
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

// Count cells with glyph > 32 in the active layer (L2).
async function countNonZeroCells(page) {
  return page.evaluate(() => {
    const doc = window.__wholeSheetEditor?.getDocumentSnapshot?.();
    if (!doc?.layers) return 0;
    const layer = doc.layers[2] || [];
    return layer.filter(c => c && c.glyph > 32).length;
  });
}

// Run artifact oracle: count cells with char_code > 32 across all XP layers.
// Gzip-aware struct reader — no xp_core dependency (avoids "Loading..." stdout noise).
// REXPaint XP format (after optional gzip decompress):
//   header: version (4B i32) + n_layers (4B i32)
//   per layer: width (4B i32) + height (4B i32) + w*h cells
//   per cell: char_code (4B i32) + fg_r/g/b (3B) + bg_r/g/b (3B) = 10B
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

async function recordStep(page, outDir, results, name, fn) {
  const snap = () => page.evaluate(() => {
    const wb = window.__wb_debug?.getState?.() || {};
    return {
      sourceImageLoaded: wb.sourceImageLoaded,
      extractedBoxes: wb.extractedBoxes,
      drawCurrent: wb.drawCurrent,
      sourceMode: wb.sourceMode,
      jobId: wb.jobId,
      sessionId: wb.sessionId,
      sessionDirty: wb.sessionDirty,
      wsAdvanced: document.body.classList.contains('ws-advanced'),
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
    mode: 'mobile_source_import',
    generated_at: new Date().toISOString(),
    template: 'player_native_idle_only',
    fixture_png: FIXTURE_PNG,
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
      const wb = await getWbDebugState(page);
      if (!wb.sessionId) throw new Error('sessionId not set after template apply');
      return { template: 'player_native_idle_only', sessionId: wb.sessionId.slice(0, 8) };
    });

    // ── 3. Upload PNG via Import drawer ───────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'upload-png', async () => {
      await openDrawer(page, 'import');
      // Set file input — fires 'change' event → loads image into state.sourceImage
      await page.setInputFiles('#wbFile', FIXTURE_PNG);
      await page.waitForTimeout(800);
      // Click Upload PNG → POST /api/upload → sets state.sourcePath
      await page.locator('#wbUpload').click();
      // Wait for sourceImageLoaded + #wbRun enabled (requires sourcePath AND sessionId)
      await page.waitForFunction(() => {
        const s = window.__wb_debug?.getState?.();
        return s && s.sourceImageLoaded && !document.getElementById('wbRun')?.disabled;
      }, { timeout: 20000 });
      const wb = await getWbDebugState(page);
      await closeDrawer(page);
      if (!wb.sourceImageLoaded) throw new Error('sourceImageLoaded is false after upload');
      const wbRunEnabled = await page.evaluate(() => !document.getElementById('wbRun')?.disabled);
      if (!wbRunEnabled) throw new Error('#wbRun is still disabled after upload + session active');
      return { sourceImageLoaded: wb.sourceImageLoaded };
    });

    // ── 4. Source drawer visible — canvas shows image, controls reachable ─────
    await recordStep(page, OUTDIR, results, 'source-drawer-visible', async () => {
      await openDrawer(page, 'source');
      const sourceCanvasVisible = await page.locator('#sourceCanvas').isVisible();
      if (!sourceCanvasVisible) throw new Error('#sourceCanvas not visible in Source drawer');
      const drawBoxVisible = await page.locator('#drawBoxBtn').isVisible();
      if (!drawBoxVisible) throw new Error('#drawBoxBtn not visible in Source drawer');
      const extractVisible = await page.locator('#extractBtn').isVisible();
      if (!extractVisible) throw new Error('#extractBtn not visible in Source drawer');
      const wb = await getWbDebugState(page);
      if (!wb.sourceImageLoaded) throw new Error('sourceImageLoaded false when Source drawer open');
      await closeDrawer(page);
      return {
        sourceCanvasVisible,
        drawBoxVisible,
        extractVisible,
        sourceImageLoaded: wb.sourceImageLoaded,
      };
    });

    // ── 5. Draw source box — drawBoxBtn + canvas drag → drawCurrent set ───────
    await recordStep(page, OUTDIR, results, 'draw-source-box', async () => {
      await openDrawer(page, 'source');
      // Activate draw_box mode
      await page.locator('#drawBoxBtn').click();
      await page.waitForTimeout(300);
      // Drag on source canvas to cover the 32x32 PNG at 1x zoom (top-left of 576x320 canvas)
      const canvasBox = await page.locator('#sourceCanvas').boundingBox();
      if (!canvasBox) throw new Error('#sourceCanvas has no bounding box');
      // Draw from (3,3) to (28,28) in canvas-relative pixels
      const sx = canvasBox.x + 3;
      const sy = canvasBox.y + 3;
      const ex = canvasBox.x + 28;
      const ey = canvasBox.y + 28;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move((sx + ex) / 2, (sy + ey) / 2, { steps: 3 });
      await page.mouse.move(ex, ey, { steps: 3 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      const wb = await getWbDebugState(page);
      await closeDrawer(page);
      if (!wb.drawCurrent) throw new Error('drawCurrent is null after drag in draw_box mode — pointer events may not have fired on sourceCanvas');
      return { drawCurrent: wb.drawCurrent };
    });

    // ── 6. Find sprites — extractBtn reachable without Advanced mode ──────────
    await recordStep(page, OUTDIR, results, 'find-sprites', async () => {
      await openDrawer(page, 'source');
      await page.locator('#extractBtn').click();
      await page.waitForTimeout(700);
      const wb = await getWbDebugState(page);
      await closeDrawer(page);
      const advanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
      if (advanced) throw new Error('extractBtn click entered Advanced mode');
      // extractedBoxes > 0 is a bonus; the key proof is that the button was reachable+clicked.
      return { extractedBoxes: wb.extractedBoxes, advanced };
    });

    // ── 7. Convert to XP — wbRun, wait for pipeline, verify cells changed ─────
    await recordStep(page, OUTDIR, results, 'convert-to-xp', async () => {
      // Record initial cell count (blank template → all glyph 0, count should be 0)
      const initialCount = await countNonZeroCells(page);

      // Clear wbRunOut to detect when /api/run completes
      await page.evaluate(() => { const el = document.getElementById('wbRunOut'); if (el) el.textContent = ''; });

      // Click Convert to XP (inside Import drawer)
      await openDrawer(page, 'import');
      const wbRunEnabled = await page.evaluate(() => !document.getElementById('wbRun')?.disabled);
      if (!wbRunEnabled) throw new Error('#wbRun disabled — need sourcePath AND sessionId');
      await page.locator('#wbRun').click();
      // Close drawer immediately; conversion runs async in background
      await closeDrawer(page);

      // Stage 1: wait for /api/run to return (wbRunOut has JSON with "run" field)
      await page.waitForFunction(() => {
        try {
          const txt = document.getElementById('wbRunOut')?.textContent || '';
          const j = JSON.parse(txt);
          return !!j.run;
        } catch { return false; }
      }, { timeout: 90000 });

      // Stage 2: wait for cells in whole-sheet editor to exceed initialCount
      // This confirms loadFromJob + hydrateLoadedSession + hydrateWholeSheetEditor completed.
      await page.waitForFunction((cnt) => {
        const doc = window.__wholeSheetEditor?.getDocumentSnapshot?.();
        if (!doc?.layers) return false;
        const layer = doc.layers[2] || [];
        return layer.filter(c => c && c.glyph > 32).length > cnt;
      }, initialCount, { timeout: 60000 });

      const newCount = await countNonZeroCells(page);
      const wb = await getWbDebugState(page);

      if (newCount <= initialCount) {
        throw new Error(`Cells not changed: initial=${initialCount}, after=${newCount}`);
      }
      return {
        initialCount,
        newCount,
        jobId: wb.jobId ? wb.jobId.slice(0, 8) : '',
        sessionId: wb.sessionId ? wb.sessionId.slice(0, 8) : '',
      };
    });

    // ── 8. Save via mobile top bar ─────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'save-via-topbar', async () => {
      await page.evaluate(() => { const el = document.getElementById('exportOut'); if (el) el.textContent = ''; });
      await page.locator('.ws-mobile-top-bar [data-action="save"]').click();
      await page.waitForFunction(
        () => { const st = window.__wb_debug?.getState?.(); return st && st.sessionDirty === false; },
        { timeout: 20000 }
      ).catch(() => {});
      const wb = await getWbDebugState(page);
      if (wb.sessionDirty) throw new Error(`sessionDirty remained true after Save`);
      return { sessionDirty: wb.sessionDirty };
    });

    // ── 9. Export via Files drawer ─────────────────────────────────────────────
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

    // ── 10. Artifact oracle — non-zero glyph cells in XP binary ──────────────
    await recordStep(page, OUTDIR, results, 'artifact-oracle', async () => {
      const editorCount = await countNonZeroCells(page);
      const { error, totalNonZero } = runArtifactOracle(finalXpPath);
      if (error) throw new Error(`Artifact oracle error: ${error}`);
      if (totalNonZero <= 0) throw new Error(`XP binary has no cells with char_code > 32 — conversion may have produced blank output; editorCount=${editorCount}`);
      return { totalNonZero, editorCount };
    });

    overallPass = results.every((r) => r.pass);
  } catch (_err) {
    overallPass = results.every((r) => r.pass);
  } finally {
    await browser.close();
  }

  writeFileSync(`${OUTDIR}/result.json`, JSON.stringify({ overallPass, finalXpPath, results }, null, 2));

  const step = (name) => results.find((r) => r.name === name);
  const ok = (name) => step(name)?.pass ? '✅' : '❌';
  const lines = [
    '# Mobile Source/Import Probe',
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
  lines.push(`${ok('upload-png')} PNG upload via Import drawer (sourceImageLoaded=true, wbRun enabled)`);
  lines.push(`${ok('source-drawer-visible')} Source drawer: canvas visible + Draw Box + Find Sprites reachable`);
  lines.push(`${ok('draw-source-box')} Draw Box on source canvas (drawCurrent set via pointer drag)`);
  lines.push(`${ok('find-sprites')} Find Sprites (extractBtn) clickable without Advanced mode`);
  lines.push(`${ok('convert-to-xp')} Convert to XP: pipeline ran, cells changed in whole-sheet editor`);
  lines.push(`${ok('save-via-topbar')} Save via mobile top bar (sessionDirty → false)`);
  lines.push(`${ok('export-via-files-drawer')} Export XP via Files drawer`);
  lines.push(`${ok('artifact-oracle')} Artifact oracle: non-zero glyph cells confirmed in XP binary`);
  lines.push('');
  lines.push('## What this probe does NOT cover');
  lines.push('');
  lines.push('- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)');
  lines.push('- File/session persistence across page reload (probe #5)');
  lines.push('- Skin Dock / preview pipeline (probe #6)');
  lines.push('- Desktop layout unaffected (broader gate — probe #7)');
  lines.push('- Specific glyph/color mapping from PNG pixels (oracle verifies non-zero count only)');
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
