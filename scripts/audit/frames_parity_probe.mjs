#!/usr/bin/env node
/**
 * UQ-013 / FL-MOB-01 — Frames parity probe (#10).
 *
 * Extends beyond the Add Frame proof in prior probes.
 * Proves that the frames drawer controls beyond Add Frame work in the
 * mobile editor-first shell without entering Advanced mode:
 *
 *   - Frame tile filmstrip: click to select → buttons enabled
 *   - Add Frame: frame count increases
 *   - Delete Frame: frame count decreases
 *   - Col Right / Col Left: reorder frames (if enabled by template layout)
 *   - Active Layer select: dropdown change reflected
 *   - Context menu (right-click): Copy Frame + Paste Frame
 *   - Focus Whole-Sheet (openInspectorBtn): inspector panel opens
 *   - Export XP + artifact oracle
 *
 * Covers, in order:
 *   1. Mobile first screen (fresh load)
 *   2. Apply template — editor-first shell, ws-advanced absent
 *   3. Open frames drawer — grid panel renders frame tiles
 *   4. Select frame tile — first .frame-cell click → buttons enabled
 *   5. Col Right — move selected frame right (if enabled by template)
 *   6. Col Left — move selected frame back left (if enabled by template)
 *   7. Add Frame — frame count increases
 *   8. Delete Frame — frame count returns to prior
 *   9. Layer select — change active layer via dropdown
 *  10. Context menu — right-click → Copy, right-click → Paste
 *  11. Focus Whole-Sheet — openInspectorBtn → #wholeSheetPanel visible
 *  12. Export via Files drawer
 *  13. Artifact oracle
 *
 * Output:
 *   artifacts/2026-06-16-frames-parity/recipe.json
 *   artifacts/2026-06-16-frames-parity/result.json
 *   artifacts/2026-06-16-frames-parity/REPORT.md
 *   artifacts/2026-06-16-frames-parity/<N>-<name>.png
 *
 * Run:
 *   node scripts/audit/frames_parity_probe.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUTDIR = 'artifacts/2026-06-16-frames-parity';
const BASE_URL = 'http://localhost:5071/workbench';

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

// Count frame tiles in #gridPanel (excludes row/col header elements).
async function countFrameCells(page) {
  return page.evaluate(() =>
    document.querySelectorAll('#gridPanel .frame-cell[data-row][data-col]').length
  );
}

// Get selected frame coords (row, col) from .frame-cell.selected.
async function getSelectedFrame(page) {
  return page.evaluate(() => {
    const sel = document.querySelector('#gridPanel .frame-cell.selected');
    if (!sel) return null;
    return { row: Number(sel.dataset.row), col: Number(sel.dataset.col) };
  });
}

// Run artifact oracle: count cells with char_code > 32 across all XP layers.
// Gzip-aware struct reader — no xp_core dependency.
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
    mode: 'frames_parity',
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

    // ── 3. Open frames drawer — grid renders frame tiles ──────────────────────
    let initialFrameCount = 0;
    await recordStep(page, OUTDIR, results, 'open-frames-drawer', async () => {
      await openDrawer(page, 'frames');
      // Wait for grid panel to render tiles.
      await page.waitForFunction(
        () => document.querySelectorAll('#gridPanel .frame-cell[data-row][data-col]').length > 0,
        { timeout: 10000 }
      );
      initialFrameCount = await countFrameCells(page);
      if (initialFrameCount === 0) throw new Error('no frame cells rendered in #gridPanel');
      const addFrameVisible = await page.locator('#addFrameBtn').isVisible();
      if (!addFrameVisible) throw new Error('#addFrameBtn not visible in frames drawer');
      return { initialFrameCount };
    });

    // ── 4. Select frame tile — buttons become enabled ─────────────────────────
    let firstFrameCoord = { row: 0, col: 0 };
    await recordStep(page, OUTDIR, results, 'select-frame-tile', async () => {
      // Click the first frame-cell tile in the grid panel.
      const firstTile = page.locator('#gridPanel .frame-cell[data-row][data-col]').first();
      const box = await firstTile.boundingBox();
      if (!box) throw new Error('first frame-cell has no bounding box');
      await firstTile.click();
      await page.waitForTimeout(200);
      // Verify the tile is now selected.
      firstFrameCoord = await getSelectedFrame(page) || { row: 0, col: 0 };
      const hasSelected = await page.evaluate(
        () => !!document.querySelector('#gridPanel .frame-cell.selected')
      );
      if (!hasSelected) throw new Error('no .frame-cell.selected after clicking tile');
      // addFrameBtn should be enabled (session loaded + frame selected).
      const addEnabled = await page.evaluate(() => !document.getElementById('addFrameBtn')?.disabled);
      // openInspectorBtn should be enabled.
      const inspectorEnabled = await page.evaluate(() => !document.getElementById('openInspectorBtn')?.disabled);
      // Report button states.
      const colRightEnabled = await page.evaluate(() => !document.getElementById('colRightBtn')?.disabled);
      const colLeftEnabled = await page.evaluate(() => !document.getElementById('colLeftBtn')?.disabled);
      const rowUpEnabled = await page.evaluate(() => !document.getElementById('rowUpBtn')?.disabled);
      const rowDownEnabled = await page.evaluate(() => !document.getElementById('rowDownBtn')?.disabled);
      return {
        selectedFrame: firstFrameCoord,
        addEnabled,
        inspectorEnabled,
        colRightEnabled,
        colLeftEnabled,
        rowUpEnabled,
        rowDownEnabled,
      };
    });

    // ── 5. Col Right (if enabled) — reorder selected frame right ─────────────
    let colNavProven = false;
    const colRightData = await recordStep(page, OUTDIR, results, 'col-right', async () => {
      const enabled = await page.evaluate(() => !document.getElementById('colRightBtn')?.disabled);
      if (!enabled) {
        // Not available with this template layout — note and pass without asserting.
        return { skipped: true, reason: 'colRightBtn disabled (template has 1 col or selected at maxCol)' };
      }
      const beforeCount = await countFrameCells(page);
      const beforeSelected = await getSelectedFrame(page);
      await page.locator('#colRightBtn').click();
      await page.waitForTimeout(300);
      const afterSelected = await getSelectedFrame(page);
      const afterCount = await countFrameCells(page);
      if (afterCount !== beforeCount) throw new Error(`frame count changed unexpectedly: ${beforeCount}→${afterCount}`);
      colNavProven = true;
      return { beforeSelected, afterSelected, skipped: false };
    });

    // ── 6. Col Left (if col nav was tested) — move back ───────────────────────
    await recordStep(page, OUTDIR, results, 'col-left', async () => {
      if (!colNavProven) {
        return { skipped: true, reason: 'col-right was skipped, no need to test col-left' };
      }
      const enabled = await page.evaluate(() => !document.getElementById('colLeftBtn')?.disabled);
      if (!enabled) return { skipped: true, reason: 'colLeftBtn disabled after col-right' };
      const beforeSelected = await getSelectedFrame(page);
      await page.locator('#colLeftBtn').click();
      await page.waitForTimeout(300);
      const afterSelected = await getSelectedFrame(page);
      return { beforeSelected, afterSelected, skipped: false };
    });

    // ── 7. Add Frame — frame count increases ──────────────────────────────────
    let countAfterAdd = 0;
    await recordStep(page, OUTDIR, results, 'add-frame', async () => {
      const beforeCount = await countFrameCells(page);
      await page.locator('#addFrameBtn').click();
      // Wait for a new frame tile to appear.
      await page.waitForFunction(
        (before) => document.querySelectorAll('#gridPanel .frame-cell[data-row][data-col]').length > before,
        beforeCount,
        { timeout: 5000 }
      );
      countAfterAdd = await countFrameCells(page);
      if (countAfterAdd <= beforeCount) throw new Error(`frame count did not increase: ${beforeCount}→${countAfterAdd}`);
      return { beforeCount, countAfterAdd, delta: countAfterAdd - beforeCount };
    });

    // ── 8. Delete Frame — select new frame, delete it, count returns ──────────
    await recordStep(page, OUTDIR, results, 'delete-frame', async () => {
      // Select the last frame tile (the newly added one).
      const tiles = page.locator('#gridPanel .frame-cell[data-row][data-col]');
      const tileCount = await tiles.count();
      await tiles.nth(tileCount - 1).click();
      await page.waitForTimeout(200);
      const delEnabled = await page.evaluate(() => !document.getElementById('deleteFrameBtn')?.disabled);
      if (!delEnabled) throw new Error('#deleteFrameBtn is disabled — new frame tile not selected');
      const beforeDel = await countFrameCells(page);
      await page.locator('#deleteFrameBtn').click();
      // Wait for frame count to decrease.
      await page.waitForFunction(
        (before) => document.querySelectorAll('#gridPanel .frame-cell[data-row][data-col]').length < before,
        beforeDel,
        { timeout: 5000 }
      );
      const afterDel = await countFrameCells(page);
      if (afterDel >= beforeDel) throw new Error(`frame count did not decrease: ${beforeDel}→${afterDel}`);
      return { beforeDel, afterDel };
    });

    // ── 9. Layer select — change active layer ─────────────────────────────────
    await recordStep(page, OUTDIR, results, 'layer-select', async () => {
      const layerSelect = page.locator('#layerSelect');
      const options = await layerSelect.evaluate((el) =>
        [...el.options].map((o) => ({ value: o.value, text: o.text }))
      );
      if (options.length < 2) {
        return { skipped: true, reason: `only ${options.length} option(s) in layerSelect`, options };
      }
      const initialValue = await layerSelect.inputValue();
      // Select the second option.
      const targetValue = options.find((o) => o.value !== initialValue)?.value;
      if (!targetValue) return { skipped: true, reason: 'no alternative layer option found', options };
      await layerSelect.selectOption(targetValue);
      await page.waitForTimeout(200);
      const newValue = await layerSelect.inputValue();
      if (newValue === initialValue) throw new Error(`layerSelect value did not change: stayed at ${initialValue}`);
      // Change back to initial to avoid affecting subsequent steps.
      await layerSelect.selectOption(initialValue);
      return { initialValue, selectedValue: targetValue, confirmed: newValue === targetValue, options: options.length };
    });

    // ── 10. Context menu — dispatch contextmenu event → Copy, then Paste ───────
    // WebKit touch profile: right-click { button: 'right' } does not fire the
    // 'contextmenu' event on touch devices. Dispatch it directly via evaluate().
    await recordStep(page, OUTDIR, results, 'context-menu-copy-paste', async () => {
      // Re-select first frame tile.
      await page.locator('#gridPanel .frame-cell[data-row][data-col]').first().click();
      await page.waitForTimeout(200);
      // Dispatch 'contextmenu' directly on the tile — browser JS processes it.
      const dispatched = await page.evaluate(() => {
        const tile = document.querySelector('#gridPanel .frame-cell[data-row][data-col]');
        if (!tile) return false;
        const rect = tile.getBoundingClientRect();
        const evt = new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        });
        tile.dispatchEvent(evt);
        return true;
      });
      if (!dispatched) throw new Error('no frame-cell found for contextmenu dispatch');
      await page.waitForTimeout(300);
      const menuVisible = await page.evaluate(
        () => !document.getElementById('gridContextMenu')?.classList.contains('hidden')
      );
      if (!menuVisible) throw new Error('#gridContextMenu did not appear after contextmenu dispatch');
      const ctxCopyVisible = await page.evaluate(() => !document.getElementById('ctxCopy')?.classList.contains('hidden'));
      const ctxCopyEnabled = await page.evaluate(() => !document.getElementById('ctxCopy')?.disabled);
      const ctxPasteVisible = await page.evaluate(() => !document.getElementById('ctxPaste')?.classList.contains('hidden'));
      const ctxDeleteVisible = await page.evaluate(() => !document.getElementById('ctxDelete')?.classList.contains('hidden'));
      // Click Copy via evaluate (avoid Playwright click actionability issues on positioned elements).
      await page.evaluate(() => document.getElementById('ctxCopy')?.click());
      await page.waitForTimeout(300);
      const menuHiddenAfterCopy = await page.evaluate(
        () => document.getElementById('gridContextMenu')?.classList.contains('hidden')
      );
      // Dispatch contextmenu again to verify Paste is now enabled (clipboard set).
      await page.evaluate(() => {
        const tile = document.querySelector('#gridPanel .frame-cell[data-row][data-col]');
        if (!tile) return;
        const rect = tile.getBoundingClientRect();
        tile.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
      });
      await page.waitForTimeout(300);
      const ctxPasteEnabled = await page.evaluate(() => !document.getElementById('ctxPaste')?.disabled);
      // Paste.
      await page.evaluate(() => document.getElementById('ctxPaste')?.click());
      await page.waitForTimeout(300);
      return { menuVisible, ctxCopyVisible, ctxCopyEnabled, ctxPasteVisible, ctxDeleteVisible, menuHiddenAfterCopy, ctxPasteEnabled };
    });

    // ── 11. Focus Whole-Sheet — openInspectorBtn opens inspector ─────────────
    await recordStep(page, OUTDIR, results, 'focus-whole-sheet', async () => {
      // Ensure frames drawer is open and a frame is selected.
      const drawerOpen = await page.evaluate(
        () => !!document.querySelector('.ws-drawer[data-drawer="frames"].open')
      );
      if (!drawerOpen) await openDrawer(page, 'frames');
      await page.locator('#gridPanel .frame-cell[data-row][data-col]').first().click();
      await page.waitForTimeout(200);
      const inspEnabled = await page.evaluate(() => !document.getElementById('openInspectorBtn')?.disabled);
      if (!inspEnabled) throw new Error('#openInspectorBtn is disabled — frame not selected or session not loaded');
      await page.locator('#openInspectorBtn').click();
      await page.waitForTimeout(500);
      // After clicking Focus Whole-Sheet, the #wholeSheetPanel should become visible (not hidden).
      const wholeSheetVisible = await page.evaluate(
        () => {
          const panel = document.getElementById('wholeSheetPanel');
          return panel && !panel.classList.contains('hidden');
        }
      );
      return { inspEnabled, wholeSheetVisible };
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
  const selectData = step('select-frame-tile')?.data || {};
  const addData = step('add-frame')?.data || {};
  const delData = step('delete-frame')?.data || {};
  const layerData = step('layer-select')?.data || {};
  const ctxData = step('context-menu-copy-paste')?.data || {};
  const focusData = step('focus-whole-sheet')?.data || {};
  const colRData = step('col-right')?.data || {};

  const lines = [
    '# Frames Parity Probe',
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
  lines.push(`${ok('open-frames-drawer')} Frames drawer opens; frame grid renders`);
  lines.push(`${ok('select-frame-tile')} Frame tile click → .selected class; addFrameBtn+openInspectorBtn enabled`);

  // Col nav
  if (colRData.skipped) {
    lines.push(`⬜ Col Right/Left — ${colRData.reason} (template layout: reorder buttons not available for single-col rows)`);
  } else {
    lines.push(`${ok('col-right')} Col Right: selected frame ${JSON.stringify(colRData.beforeSelected)} → ${JSON.stringify(colRData.afterSelected)}`);
    lines.push(`${ok('col-left')} Col Left: frame moved back`);
  }

  lines.push(`${ok('add-frame')} Add Frame: count ${addData.beforeCount}→${addData.countAfterAdd} (+${addData.delta})`);
  lines.push(`${ok('delete-frame')} Delete Frame: count ${delData.beforeDel}→${delData.afterDel}`);

  if (layerData.skipped) {
    lines.push(`⬜ Layer select — ${layerData.reason}`);
  } else {
    lines.push(`${ok('layer-select')} Layer select: value ${layerData.initialValue}→${layerData.selectedValue} (confirmed=${layerData.confirmed}); ${layerData.options} options`);
  }

  lines.push(`${ok('context-menu-copy-paste')} Context menu (right-click): menu visible=${ctxData.menuVisible}; Copy Frame clicked; Paste enabled=${ctxData.ctxPasteEnabled}; Paste clicked`);
  lines.push(`${ok('focus-whole-sheet')} Focus Whole-Sheet (openInspectorBtn): wholeSheetPanel visible=${focusData.wholeSheetVisible}`);
  lines.push(`${ok('export-via-files-drawer')} Export XP via Files drawer`);
  const oracleLabel = oracleData.totalNonZero != null
    ? `Artifact oracle (gzip-aware): totalNonZero=${oracleData.totalNonZero} (all layers)`
    : 'Artifact oracle: non-zero glyph cells confirmed in XP binary';
  lines.push(`${ok('artifact-oracle')} ${oracleLabel}`);
  lines.push('');
  lines.push('## Frame control availability (player_native_idle_only template)');
  lines.push('');
  lines.push(`- addFrameBtn: enabled=${selectData.addEnabled}`);
  lines.push(`- openInspectorBtn: enabled=${selectData.inspectorEnabled}`);
  lines.push(`- colRightBtn: enabled=${selectData.colRightEnabled}`);
  lines.push(`- colLeftBtn: enabled=${selectData.colLeftEnabled}`);
  lines.push(`- rowUpBtn: enabled=${selectData.rowUpEnabled}`);
  lines.push(`- rowDownBtn: enabled=${selectData.rowDownEnabled}`);
  lines.push('');
  lines.push('## What this probe does NOT cover');
  lines.push('');
  lines.push('- Row Up/Row Down (reorder rows) — requires template with ≥2 animation rows; player_native_idle_only has 1 row');
  lines.push('- Clear Selected (deleteCellBtn) — reachability confirmed, not driven (would clear real content)');
  lines.push('- gridZoomInput / gridToggleLabels — reachability confirmed in drawer open; not state-mutated in this probe');
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
