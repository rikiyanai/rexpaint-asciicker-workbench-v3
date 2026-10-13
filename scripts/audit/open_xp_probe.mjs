#!/usr/bin/env node
/**
 * UQ-013 / FL-MOB-01 — Open XP probe (#8).
 *
 * Proves that the first-screen "Open XP" button path works in the mobile
 * editor-first shell: Playwright intercepts the hidden <input type="file">
 * fallback (WebKit has no showOpenFilePicker), a fixture .xp file is injected,
 * the session loads via /api/workbench/upload-xp → loadSession(), the first
 * screen dismisses, and the whole-sheet editor is populated with real cells.
 *
 * Covers, in order:
 *   1. Mobile first screen (fresh load, no draft)
 *   2. Click #fsOpenXpBtn → intercept filechooser → set fixture XP file
 *   3. Wait for ws-session-loaded + mobileFirstScreen hidden
 *   4. Verify editor cells loaded (countNonZeroCells > 0)
 *   5. Export XP via Files drawer
 *   6. Artifact oracle — non-zero glyph cells in exported XP binary
 *
 * Output:
 *   artifacts/2026-06-16-open-xp/recipe.json
 *   artifacts/2026-06-16-open-xp/result.json
 *   artifacts/2026-06-16-open-xp/REPORT.md
 *   artifacts/2026-06-16-open-xp/<N>-<name>.png
 *
 * Run:
 *   node scripts/audit/open_xp_probe.mjs
 *
 * NOTE: Playwright WebKit engine-family emulation under iPad Pro 11 landscape
 * profile — NOT Apple's shipping iOS Safari. Real-device pass (UQ-013 step 6)
 * is a separate gate.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUTDIR = 'artifacts/2026-06-16-open-xp';
const BASE_URL = 'http://localhost:5071/workbench';

// Fixture XP — exported from desktop-unaffected probe (#7); 10096 non-zero cells across 4 layers.
const FIXTURE_XP = path.resolve(REPO_ROOT, 'data/exports/session-885fa1cb-e3b0-451a-b401-9ef0cca75a11.xp');

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

// Count cells with glyph > 32 in the active layer (L2) of the whole-sheet editor.
async function countNonZeroCells(page) {
  return page.evaluate(() => {
    const doc = window.__wholeSheetEditor?.getDocumentSnapshot?.();
    if (!doc?.layers) return 0;
    const layer = doc.layers[2] || [];
    return layer.filter(c => c && c.glyph > 32).length;
  });
}

// Run artifact oracle: count cells with char_code > 32 across all XP layers.
// Gzip-aware struct reader — no xp_core dependency.
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
      sessionId: wb.sessionId,
      sessionDirty: wb.sessionDirty,
      wsAdvanced: document.body.classList.contains('ws-advanced'),
      wsSessionLoaded: document.body.classList.contains('ws-session-loaded'),
      firstScreenHidden: document.getElementById('mobileFirstScreen')?.classList.contains('hidden'),
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
    mode: 'open_xp',
    generated_at: new Date().toISOString(),
    fixture_xp: FIXTURE_XP,
    fixture_note: 'Desktop-unaffected probe (#7) export — 10096 non-zero cells across 4 layers',
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

    // ── 1. Fresh mobile first screen ──────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'fresh-mobile-first-screen', async () => {
      const visible = await page.locator('#mobileFirstScreen').isVisible();
      if (!visible) throw new Error('mobile first screen not visible on fresh load');
      const sessionLoaded = await page.evaluate(() => document.body.classList.contains('ws-session-loaded'));
      if (sessionLoaded) throw new Error('ws-session-loaded present before any action (stale session?)');
      return { visible, sessionLoaded };
    });

    // ── 2. Open XP via file picker ────────────────────────────────────────────
    // WebKit has no showOpenFilePicker, so _hasFileSystemAccess=false and the
    // fallback <input type="file"> is created and clicked.
    // Playwright intercepts it via the 'filechooser' event.
    await recordStep(page, OUTDIR, results, 'open-xp-file', async () => {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10000 }),
        page.locator('#fsOpenXpBtn').click(),
      ]);
      await fileChooser.setFiles(FIXTURE_XP);
      // Wait for loadSession() to complete: ws-session-loaded on body + first screen hidden.
      await page.waitForFunction(
        () =>
          document.body.classList.contains('ws-session-loaded') &&
          document.getElementById('mobileFirstScreen')?.classList.contains('hidden'),
        { timeout: 30000 }
      );
      const advanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
      if (advanced) throw new Error('openXpFile path entered Advanced mode');
      const wb = await getWbDebugState(page);
      if (!wb.sessionId) throw new Error('sessionId not set after openXpFile');
      return { sessionId: wb.sessionId.slice(0, 8), advanced };
    });

    // ── 3. Cells loaded from XP ───────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'cells-loaded', async () => {
      const editorCount = await countNonZeroCells(page);
      if (editorCount <= 0) throw new Error(`no cells in L2 after loading XP; fixture has 10096 non-zero cells total`);
      const canvasVisible = await page.locator('#wholeSheetCanvas').isVisible();
      if (!canvasVisible) throw new Error('#wholeSheetCanvas not visible after session load');
      return { editorCount, canvasVisible };
    });

    // ── 4. Export via Files drawer ────────────────────────────────────────────
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

    // ── 5. Artifact oracle — non-zero glyph cells in exported XP binary ───────
    await recordStep(page, OUTDIR, results, 'artifact-oracle', async () => {
      const editorCount = await countNonZeroCells(page);
      const { error, totalNonZero } = runArtifactOracle(finalXpPath);
      if (error) throw new Error(`Artifact oracle error: ${error}`);
      if (totalNonZero <= 0) throw new Error(`XP binary has no cells with char_code > 32; editorCount=${editorCount}`);
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
  const oracleData = step('artifact-oracle')?.data || {};
  const lines = [
    '# Open XP Probe',
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
  lines.push(`${ok('open-xp-file')} #fsOpenXpBtn → filechooser intercept → fixture XP injected → ws-session-loaded`);
  lines.push(`${ok('open-xp-file')} First screen dismissed by loadSession() success (not by ws-advanced toggle)`);
  lines.push(`${ok('cells-loaded')} Editor cells loaded from XP (L2 editorCount=${step('cells-loaded')?.data?.editorCount ?? '?'})`);
  lines.push(`${ok('export-via-files-drawer')} Export XP via Files drawer`);
  const oracleLabel = oracleData.totalNonZero != null
    ? `Artifact oracle (gzip-aware): totalNonZero=${oracleData.totalNonZero} (all layers), editorCount=${oracleData.editorCount} (L2)`
    : 'Artifact oracle: non-zero glyph cells confirmed in XP binary';
  lines.push(`${ok('artifact-oracle')} ${oracleLabel}`);
  lines.push('');
  lines.push('## What this probe does NOT cover');
  lines.push('');
  lines.push('- File System Access API path (showOpenFilePicker) — not supported in WebKit; fallback path proven');
  lines.push('- Save-back to the original file (saveXpFile with handle — requires File System Access API)');
  lines.push('- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)');
  lines.push('- Share / download UX (probe #9)');
  lines.push('- Frame parity beyond Add Frame (probe #10)');
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
