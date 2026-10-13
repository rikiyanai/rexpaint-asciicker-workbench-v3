#!/usr/bin/env node
/**
 * UQ-013 / FL-MOB-01 — Tool/Layer parity probe (#11).
 *
 * Extends beyond the Cell/Select/Copy/Paste/Cut/Clear/Undo/Redo coverage in
 * mobile_editing_parity_probe. Proves tool suite and layer drawer operations
 * are reachable and mutate state in the mobile editor-first shell.
 *
 * Covers, in order:
 *   1. Mobile first screen (fresh load)
 *   2. Apply template — editor-first shell, ws-advanced absent
 *   3. Open tools drawer — wsToolErase, wsToolLine, wsToolCell reachable
 *   4. Switch to Erase tool — activeTool changes to 'erase'
 *   5. Switch to Line tool — activeTool changes to 'line'
 *   6. Switch back to Cell tool — activeTool returns to 'cell'
 *   7. Open layers drawer — #wsLayersPanel renders layer rows
 *   8. Toggle layer visibility — ws-layer-vis-btn click → layer hidden/visible
 *   9. Restore layer visibility — toggle back
 *  10. Add layer — + button → layer count increases
 *  11. Delete layer — − button → layer count decreases
 *  12. Export via Files drawer
 *  13. Artifact oracle
 *
 * Output:
 *   artifacts/2026-06-16-tool-layer-parity/recipe.json
 *   artifacts/2026-06-16-tool-layer-parity/result.json
 *   artifacts/2026-06-16-tool-layer-parity/REPORT.md
 *   artifacts/2026-06-16-tool-layer-parity/<N>-<name>.png
 *
 * Run:
 *   node scripts/audit/tool_layer_parity_probe.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUTDIR = 'artifacts/2026-06-16-tool-layer-parity';
const BASE_URL = 'http://localhost:5071/workbench';

// ── Playwright helpers ────────────────────────────────────────────────────────

async function getWbDebugState(page) {
  return page.evaluate(() => window.__wb_debug?.getState?.() || {});
}

async function getEditorState(page) {
  return page.evaluate(() => window.__wholeSheetEditor?.getState?.() || {});
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

// Get current active tool from whole-sheet editor state.
async function getActiveTool(page) {
  return page.evaluate(() => window.__wholeSheetEditor?.getState?.()?.activeTool || null);
}

// Count layer rows in the layers panel.
async function countLayerRows(page) {
  return page.evaluate(() =>
    document.querySelectorAll('#wsLayersPanel .ws-layer-row').length
  );
}

// Run artifact oracle: count cells with char_code > 32 across all XP layers.
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
    mode: 'tool_layer_parity',
    generated_at: new Date().toISOString(),
    template: 'player_native_idle_only',
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

    // ── 3. Open tools drawer — tool buttons injected by whole-sheet-init ──────
    await recordStep(page, OUTDIR, results, 'open-tools-drawer', async () => {
      await openDrawer(page, 'tools');
      // Wait for the tool buttons to be present (injected by whole-sheet-init.js).
      await page.waitForFunction(
        () => !!document.getElementById('wsToolErase'),
        { timeout: 5000 }
      );
      const eraseVisible = await page.locator('#wsToolErase').isVisible();
      const lineVisible  = await page.locator('#wsToolLine').isVisible();
      const cellVisible  = await page.locator('#wsToolCell').isVisible();
      const selectVisible = await page.locator('#wsToolSelect').isVisible();
      const initialTool = await getActiveTool(page);
      return { eraseVisible, lineVisible, cellVisible, selectVisible, initialTool };
    });

    // ── 4. Switch to Erase tool ───────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'switch-erase-tool', async () => {
      await page.locator('#wsToolErase').click();
      await page.waitForTimeout(200);
      const activeTool = await getActiveTool(page);
      if (activeTool !== 'erase') throw new Error(`activeTool is '${activeTool}', expected 'erase'`);
      return { activeTool };
    });

    // ── 5. Switch to Line tool ────────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'switch-line-tool', async () => {
      await page.locator('#wsToolLine').click();
      await page.waitForTimeout(200);
      const activeTool = await getActiveTool(page);
      if (activeTool !== 'line') throw new Error(`activeTool is '${activeTool}', expected 'line'`);
      return { activeTool };
    });

    // ── 6. Restore to Cell tool ───────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'switch-cell-tool', async () => {
      await page.locator('#wsToolCell').click();
      await page.waitForTimeout(200);
      const activeTool = await getActiveTool(page);
      if (activeTool !== 'cell') throw new Error(`activeTool is '${activeTool}', expected 'cell'`);
      return { activeTool };
    });

    // ── 7. Open layers drawer — wsLayersPanel renders layer rows ──────────────
    let initialLayerCount = 0;
    await recordStep(page, OUTDIR, results, 'open-layers-drawer', async () => {
      await openDrawer(page, 'layers');
      await page.waitForFunction(
        () => document.querySelectorAll('#wsLayersPanel .ws-layer-row').length > 0,
        { timeout: 5000 }
      );
      initialLayerCount = await countLayerRows(page);
      if (initialLayerCount === 0) throw new Error('#wsLayersPanel has no .ws-layer-row elements');
      // Check the add and delete layer buttons exist.
      const addBtnVisible = await page.locator('#wsLayersPanel .ws-layer-add-btn').isVisible();
      const delBtnVisible = await page.locator('#wsLayersPanel .ws-layer-del-btn').isVisible();
      // Get layer names and visible state.
      const layerInfo = await page.evaluate(() =>
        [...document.querySelectorAll('#wsLayersPanel .ws-layer-row')].map((row) => ({
          index: row.querySelector('.ws-layer-index')?.textContent,
          name: row.querySelector('.ws-layer-name')?.textContent,
          visible: row.querySelector('.ws-layer-vis-btn')?.classList.contains('ws-layer-visible'),
        }))
      );
      return { initialLayerCount, addBtnVisible, delBtnVisible, layerInfo };
    });

    // ── 8. Toggle layer visibility on L0 ──────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'toggle-layer-visibility', async () => {
      // Click the visibility button on the first layer row.
      const visBtn = page.locator('#wsLayersPanel .ws-layer-row').first().locator('.ws-layer-vis-btn');
      const wasBefore = await visBtn.evaluate((el) => el.classList.contains('ws-layer-visible'));
      await visBtn.click();
      await page.waitForTimeout(200);
      const isAfter = await visBtn.evaluate((el) => el.classList.contains('ws-layer-visible'));
      if (isAfter === wasBefore) throw new Error('visibility toggle had no effect on button class');
      return { wasBefore, isAfter };
    });

    // ── 9. Restore layer visibility ───────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'restore-layer-visibility', async () => {
      const visBtn = page.locator('#wsLayersPanel .ws-layer-row').first().locator('.ws-layer-vis-btn');
      const wasBefore = await visBtn.evaluate((el) => el.classList.contains('ws-layer-visible'));
      await visBtn.click();
      await page.waitForTimeout(200);
      const isAfter = await visBtn.evaluate((el) => el.classList.contains('ws-layer-visible'));
      if (isAfter === wasBefore) throw new Error('restore visibility toggle had no effect');
      return { wasBefore, isAfter, restored: isAfter };
    });

    // ── 10. Add layer — layer count increases ─────────────────────────────────
    let countAfterAdd = 0;
    await recordStep(page, OUTDIR, results, 'add-layer', async () => {
      const beforeCount = await countLayerRows(page);
      await page.locator('#wsLayersPanel .ws-layer-add-btn').click();
      await page.waitForFunction(
        (before) => document.querySelectorAll('#wsLayersPanel .ws-layer-row').length > before,
        beforeCount,
        { timeout: 5000 }
      );
      countAfterAdd = await countLayerRows(page);
      if (countAfterAdd <= beforeCount) throw new Error(`layer count did not increase: ${beforeCount}→${countAfterAdd}`);
      return { beforeCount, countAfterAdd, delta: countAfterAdd - beforeCount };
    });

    // ── 11. Delete layer — select new layer, delete it ────────────────────────
    await recordStep(page, OUTDIR, results, 'delete-layer', async () => {
      // Click the last layer row to make it active.
      const rows = page.locator('#wsLayersPanel .ws-layer-row');
      const rowCount = await rows.count();
      await rows.nth(rowCount - 1).click();
      await page.waitForTimeout(200);
      const delBtn = page.locator('#wsLayersPanel .ws-layer-del-btn');
      const delEnabled = await delBtn.evaluate((el) => !el.disabled);
      if (!delEnabled) throw new Error('.ws-layer-del-btn is still disabled after selecting new layer');
      const beforeDel = await countLayerRows(page);
      await delBtn.click();
      await page.waitForFunction(
        (before) => document.querySelectorAll('#wsLayersPanel .ws-layer-row').length < before,
        beforeDel,
        { timeout: 5000 }
      );
      const afterDel = await countLayerRows(page);
      if (afterDel >= beforeDel) throw new Error(`layer count did not decrease: ${beforeDel}→${afterDel}`);
      return { beforeDel, afterDel };
    });

    // ── 12. Export via Files drawer ───────────────────────────────────────────
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

    // ── 13. Artifact oracle ───────────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'artifact-oracle', async () => {
      const { error, totalNonZero } = runArtifactOracle(finalXpPath);
      if (error) throw new Error(`Artifact oracle error: ${error}`);
      if (totalNonZero <= 0) throw new Error(`XP binary has no cells with char_code > 32`);
      return { totalNonZero };
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
  const toolsData = step('open-tools-drawer')?.data || {};
  const layersData = step('open-layers-drawer')?.data || {};
  const addLayerData = step('add-layer')?.data || {};
  const delLayerData = step('delete-layer')?.data || {};
  const visData = step('toggle-layer-visibility')?.data || {};

  const lines = [
    '# Tool/Layer Parity Probe',
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
  lines.push(`${ok('open-tools-drawer')} Tools drawer opens (injected by whole-sheet-init.js)`);
  lines.push(`${ok('open-tools-drawer')} Tool buttons reachable: cell=${toolsData.cellVisible}, erase=${toolsData.eraseVisible}, line=${toolsData.lineVisible}, select=${toolsData.selectVisible}`);
  lines.push(`${ok('switch-erase-tool')} Switch to Erase: activeTool='${step('switch-erase-tool')?.data?.activeTool}'`);
  lines.push(`${ok('switch-line-tool')} Switch to Line: activeTool='${step('switch-line-tool')?.data?.activeTool}'`);
  lines.push(`${ok('switch-cell-tool')} Restore to Cell: activeTool='${step('switch-cell-tool')?.data?.activeTool}'`);
  lines.push(`${ok('open-layers-drawer')} Layers drawer opens; ${layersData.initialLayerCount} layer rows rendered`);
  lines.push(`${ok('open-layers-drawer')} Layer row info: ${JSON.stringify(layersData.layerInfo)}`);
  lines.push(`${ok('toggle-layer-visibility')} Visibility toggle: ws-layer-visible ${visData.wasBefore}→${visData.isAfter}`);
  lines.push(`${ok('add-layer')} Add Layer: count ${addLayerData.beforeCount}→${addLayerData.countAfterAdd} (+${addLayerData.delta})`);
  lines.push(`${ok('delete-layer')} Delete Layer: count ${delLayerData.beforeDel}→${delLayerData.afterDel}`);
  lines.push(`${ok('export-via-files-drawer')} Export XP via Files drawer`);
  const oracleLabel = oracleData.totalNonZero != null
    ? `Artifact oracle (gzip-aware): totalNonZero=${oracleData.totalNonZero} (all layers)`
    : 'Artifact oracle: non-zero glyph cells confirmed in XP binary';
  lines.push(`${ok('artifact-oracle')} ${oracleLabel}`);
  lines.push('');
  lines.push('## What this probe does NOT cover');
  lines.push('');
  lines.push('- Erase/Line/Fill/Eyedropper/Text tool actual canvas usage (cell count change) — tools proven reachable and switchable');
  lines.push('- Layer lock/unlock toggle (reachable: ws-layer-lock-btn present in each row)');
  lines.push('- Layer rename (not a button in the current UI — editing the name span directly)');
  lines.push('- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)');
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
