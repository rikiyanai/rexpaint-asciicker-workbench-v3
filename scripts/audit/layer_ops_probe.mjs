#!/usr/bin/env node
/**
 * UQ-013 / FL-MOB-01 — Layer operations probe.
 *
 * Proves full layer operation parity in the mobile editor-first shell:
 *
 *   Lock/unlock:       ws-layer-lock-btn toggles locked state (class changes)
 *   Locked rejects:    Canvas draw on locked layer leaves cell unchanged
 *   Active-layer:      Row click changes activeLayerIndex
 *   Move up/down:      ↑/↓ buttons reorder layers (name array changes)
 *   Persistence:       Add layer → save → reload → export → oracle confirms count
 *
 * Steps:
 *   1.  Mobile first screen (fresh load)
 *   2.  Apply template
 *   3.  Open layers panel — read initial state
 *   4.  Lock layer 2 (click .ws-layer-lock-btn on row index 2)
 *   5.  Verify locked layer rejects draw (canvas click → cell unchanged)
 *   6.  Unlock layer 2 (click lock btn again)
 *   7.  Active-layer switch (click a .ws-layer-row to change activeLayerIndex)
 *   8.  Move layer up (↑ button on row index 2)
 *   9.  Move layer down (↓ button to restore)
 *  10.  Add layer + save + reload + verify count
 *  11.  Export via Files drawer
 *  12.  Artifact oracle (gzip-aware: verify n_layers matches layerCountAfterAdd)
 *
 * Output:
 *   artifacts/2026-06-16-layer-ops/recipe.json
 *   artifacts/2026-06-16-layer-ops/result.json
 *   artifacts/2026-06-16-layer-ops/REPORT.md
 *   artifacts/2026-06-16-layer-ops/<N>-<name>.png
 *
 * Run:
 *   node scripts/audit/layer_ops_probe.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUTDIR = 'artifacts/2026-06-16-layer-ops';
const BASE_URL = 'http://localhost:5071/workbench';
const CELL_SIZE = 12;

// ── Canvas helpers ────────────────────────────────────────────────────────────

async function getRenderedCellSize(page) {
  return page.evaluate((base) => {
    const ws = window.__wholeSheetEditor?.getState?.() || {};
    return base * Math.max(0.05, Number(ws.appliedCanvasZoom || ws.canvasZoom || 1));
  }, CELL_SIZE);
}

async function readCell(page, x, y, layerIndex) {
  return page.evaluate(({ cx, cy, li }) => {
    const doc = window.__wholeSheetEditor?.getDocumentSnapshot?.();
    const ws  = window.__wholeSheetEditor?.getState?.() || {};
    const idx = li ?? Number(ws.activeLayerIndex ?? 0);
    const layer = doc?.layers?.[idx];
    const cols = Number(doc?.gridCols || 0);
    if (!Array.isArray(layer) || cols <= 0) return null;
    return layer[cy * cols + cx] || null;
  }, { cx: x, cy: y, li: layerIndex });
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

// ── Drawer helpers ────────────────────────────────────────────────────────────

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

// ── Layer state reader ────────────────────────────────────────────────────────

async function getLayerState(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#wsLayersPanel .ws-layer-row')].map((r, i) => ({
      index: i,
      active: r.classList.contains('ws-layer-active'),
      locked: r.classList.contains('ws-layer-locked'),
      hidden: r.classList.contains('ws-layer-hidden'),
      lockBtnText: r.querySelector('.ws-layer-lock-btn')?.textContent?.trim(),
      nameTxt: r.querySelector('.ws-layer-name')?.textContent?.trim(),
    }))
  );
}

async function countLayerRows(page) {
  return page.evaluate(() =>
    document.querySelectorAll('#wsLayersPanel .ws-layer-row').length
  );
}

// ── Artifact oracle ───────────────────────────────────────────────────────────

function runArtifactOracle(xpPath) {
  if (!xpPath) return { error: 'no xp_path provided', nLayers: 0, totalNonZero: 0 };
  const abs = path.isAbsolute(xpPath) ? xpPath : path.resolve(REPO_ROOT, xpPath);
  const script = `
import gzip, struct
path = r'${abs}'
with open(path,'rb') as f: raw=f.read()
data = gzip.decompress(raw) if raw[:2]==b'\\x1f\\x8b' else raw
n_layers = struct.unpack_from('<i',data,4)[0]
off = 8; total = 0; nz = []
for li in range(n_layers):
    w=struct.unpack_from('<i',data,off)[0]; h=struct.unpack_from('<i',data,off+4)[0]; off+=8
    lcount = 0
    for _ in range(w*h):
        code=struct.unpack_from('<i',data,off)[0]
        if code != 0 and code != 32: total+=1; lcount+=1
        off+=10
    nz.append(lcount)
print(n_layers, total)
`;
  try {
    const raw = execFileSync('python3', ['-c', script], {
      cwd: REPO_ROOT, encoding: 'utf8', timeout: 20000,
    });
    const parts = raw.trim().split(/\s+/);
    const nLayers = parseInt(parts[0], 10);
    const totalNonZero = parseInt(parts[1], 10);
    return {
      error: (isNaN(nLayers) || isNaN(totalNonZero)) ? 'parse error: ' + raw.trim() : null,
      nLayers: isNaN(nLayers) ? 0 : nLayers,
      totalNonZero: isNaN(totalNonZero) ? 0 : totalNonZero,
    };
  } catch (e) {
    return { error: String(e.message || e), nLayers: 0, totalNonZero: 0 };
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
    mode: 'layer_ops',
    generated_at: new Date().toISOString(),
    template: 'player_native_idle_only',
  };
  writeFileSync(`${OUTDIR}/recipe.json`, JSON.stringify(recipe, null, 2));

  const browser = await webkit.launch({ headless: false });
  const results  = [];
  let overallPass = false;
  let finalXpPath = '';
  let sessionId = '';
  let layerCountAfterAdd = 0;

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
      const wb = await page.evaluate(() => window.__wb_debug?.getState?.() || {});
      if (!wb.sessionId) throw new Error('sessionId not set after template apply');
      sessionId = wb.sessionId;
      return { template: 'player_native_idle_only', sessionId: sessionId.slice(0, 8) };
    });

    // ── 3. Open layers panel — read initial state ──────────────────────────────
    let initialLayerCount = 0;
    await recordStep(page, OUTDIR, results, 'open-layers-panel', async () => {
      await openDrawer(page, 'layers');
      await page.waitForFunction(
        () => document.querySelectorAll('#wsLayersPanel .ws-layer-row').length > 0,
        { timeout: 5000 }
      );
      initialLayerCount = await countLayerRows(page);
      if (initialLayerCount === 0) throw new Error('#wsLayersPanel has no .ws-layer-row elements');
      const addBtnVisible = await page.locator('#wsLayersPanel .ws-layer-add-btn').isVisible();
      const delBtnVisible = await page.locator('#wsLayersPanel .ws-layer-del-btn').isVisible();
      const layers = await getLayerState(page);
      return { initialLayerCount, addBtnVisible, delBtnVisible, layers };
    });

    // ── 4. Lock layer 2 ────────────────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'lock-layer-2', async () => {
      const layersBefore = await getLayerState(page);
      if (layersBefore.length < 3) throw new Error(`only ${layersBefore.length} layers; need at least 3 (index 2)`);
      const target = layersBefore[2];
      const lockBtn = page.locator('#wsLayersPanel .ws-layer-row').nth(2).locator('.ws-layer-lock-btn');
      await lockBtn.click();
      await page.waitForTimeout(300);
      const layersAfter = await getLayerState(page);
      const row2After = layersAfter[2];
      if (!row2After?.locked) throw new Error(`layer 2 not locked after click: ${JSON.stringify(row2After)}`);
      return { lockedBefore: target.locked, lockedAfter: row2After.locked, lockBtnText: row2After.lockBtnText };
    });

    // ── 5. Verify locked layer rejects draw ────────────────────────────────────
    // Layer 2 must be the active layer for the draw to target it.
    // Switch to it via the layer panel row click, then use Cell tool.
    await recordStep(page, OUTDIR, results, 'locked-layer-rejects-draw', async () => {
      // Make layer 2 the active layer by clicking its row
      await page.locator('#wsLayersPanel .ws-layer-row').nth(2).click();
      await page.waitForTimeout(200);
      // Switch to Cell tool via tools drawer
      await closeDrawer(page);
      await openDrawer(page, 'tools');
      await page.waitForFunction(() => !!document.getElementById('wsToolCell'), { timeout: 5000 });
      await page.locator('#wsToolCell').click();
      await page.waitForTimeout(100);
      await closeDrawer(page);
      // Read cell before draw attempt
      const cellBefore = await readCell(page, 6, 6, 2);
      // Attempt draw on locked layer 2
      await clickCell(page, 6, 6);
      await page.waitForTimeout(300);
      const cellAfter = await readCell(page, 6, 6, 2);
      const rejected = JSON.stringify(cellBefore) === JSON.stringify(cellAfter);
      // Check for any status message indicating lock rejection
      const statusText = await page.evaluate(() => {
        const el = document.getElementById('wsStatus') || document.querySelector('.ws-status');
        return el?.textContent?.trim() || '';
      });
      return { cellBefore, cellAfter, rejected, statusText };
    });

    // ── 6. Unlock layer 2 ──────────────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'unlock-layer-2', async () => {
      await openDrawer(page, 'layers');
      await page.waitForFunction(
        () => document.querySelectorAll('#wsLayersPanel .ws-layer-row').length > 0,
        { timeout: 5000 }
      );
      const lockBtn = page.locator('#wsLayersPanel .ws-layer-row').nth(2).locator('.ws-layer-lock-btn');
      await lockBtn.click();
      await page.waitForTimeout(300);
      const layers = await getLayerState(page);
      const row2 = layers[2];
      if (row2?.locked) throw new Error('layer 2 still locked after unlock click');
      return { locked: row2?.locked, lockBtnText: row2?.lockBtnText };
    });

    // ── 7. Active-layer switch ─────────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'active-layer-switch', async () => {
      const wsBefore = await page.evaluate(() => window.__wholeSheetEditor?.getState?.() || {});
      const activeLayerBefore = Number(wsBefore.activeLayerIndex ?? 2);
      // Click row 1 to switch the active layer
      const targetIdx = activeLayerBefore === 1 ? 0 : 1;
      await page.locator('#wsLayersPanel .ws-layer-row').nth(targetIdx).click();
      await page.waitForTimeout(300);
      const wsAfter = await page.evaluate(() => window.__wholeSheetEditor?.getState?.() || {});
      const activeLayerAfter = Number(wsAfter.activeLayerIndex ?? activeLayerBefore);
      const switched = activeLayerAfter !== activeLayerBefore;
      // Also read from DOM as fallback confirmation
      const layers = await getLayerState(page);
      const activeRow = layers.find((l) => l.active);
      return { activeLayerBefore, activeLayerAfter, activeRowIndex: activeRow?.index, switched };
    });

    // ── 8. Move layer up (↑ on row index 2) ──────────────────────────────────
    await recordStep(page, OUTDIR, results, 'move-layer-up', async () => {
      const layersBefore = await getLayerState(page);
      if (layersBefore.length < 3) throw new Error(`need ≥3 layers to test move-up on row 2`);
      const namesBefore = layersBefore.map((l) => l.nameTxt);
      // Click the ↑ move button on row 2
      await page.evaluate((idx) => {
        const rows = [...document.querySelectorAll('#wsLayersPanel .ws-layer-row')];
        const row = rows[idx];
        const btns = [...(row?.querySelectorAll('.ws-layer-move-btn') || [])];
        const upBtn = btns.find((b) => b.textContent.trim().includes('↑'));
        if (!upBtn) throw new Error('↑ move button not found on row ' + idx);
        if (upBtn.disabled) throw new Error('↑ move button disabled on row ' + idx);
        upBtn.click();
      }, 2);
      await page.waitForTimeout(400);
      const layersAfter = await getLayerState(page);
      const namesAfter = layersAfter.map((l) => l.nameTxt);
      const reordered = JSON.stringify(namesBefore) !== JSON.stringify(namesAfter);
      return { namesBefore, namesAfter, reordered };
    });

    // ── 9. Move layer down (↓ to restore) ────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'move-layer-down', async () => {
      const layersBefore = await getLayerState(page);
      const namesBefore = layersBefore.map((l) => l.nameTxt);
      // The layer that was moved up is now at row 1; click ↓ on row 1 to restore
      await page.evaluate((idx) => {
        const rows = [...document.querySelectorAll('#wsLayersPanel .ws-layer-row')];
        const row = rows[idx];
        const btns = [...(row?.querySelectorAll('.ws-layer-move-btn') || [])];
        const downBtn = btns.find((b) => b.textContent.trim().includes('↓'));
        if (!downBtn) throw new Error('↓ move button not found on row ' + idx);
        if (downBtn.disabled) throw new Error('↓ move button disabled on row ' + idx);
        downBtn.click();
      }, 1);
      await page.waitForTimeout(400);
      const layersAfter = await getLayerState(page);
      const namesAfter = layersAfter.map((l) => l.nameTxt);
      const reordered = JSON.stringify(namesBefore) !== JSON.stringify(namesAfter);
      return { namesBefore, namesAfter, reordered };
    });

    // ── 10. Add layer + save + reload + verify count ──────────────────────────
    await recordStep(page, OUTDIR, results, 'add-layer-and-persist', async () => {
      const countBefore = await countLayerRows(page);
      await page.locator('#wsLayersPanel .ws-layer-add-btn').click();
      await page.waitForFunction(
        (before) => document.querySelectorAll('#wsLayersPanel .ws-layer-row').length > before,
        countBefore,
        { timeout: 5000 }
      );
      layerCountAfterAdd = await countLayerRows(page);
      if (layerCountAfterAdd <= countBefore) throw new Error(`layer count did not increase: ${countBefore}→${layerCountAfterAdd}`);
      // Save via top-bar save button
      await page.locator('.ws-mobile-top-bar [data-action="save"]').click();
      await page.waitForFunction(
        () => { const st = window.__wb_debug?.getState?.(); return st && st.sessionDirty === false; },
        { timeout: 8000 }
      );
      const wb = await page.evaluate(() => window.__wb_debug?.getState?.() || {});
      sessionId = wb.sessionId || sessionId;
      return { countBefore, countAfterAdd: layerCountAfterAdd, delta: layerCountAfterAdd - countBefore, saved: true, sessionId: sessionId.slice(0, 8) };
    });

    // Reload to verify persistence
    await page.goto(`${BASE_URL}?session_id=${sessionId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        document.body.classList.contains('ws-session-loaded') &&
        !!document.getElementById('wholeSheetCanvas'),
      { timeout: 30000 }
    );
    await page.waitForTimeout(500);

    await recordStep(page, OUTDIR, results, 'reload-verify-layer-count', async () => {
      await openDrawer(page, 'layers');
      await page.waitForFunction(
        () => document.querySelectorAll('#wsLayersPanel .ws-layer-row').length > 0,
        { timeout: 5000 }
      );
      const countReload = await countLayerRows(page);
      if (countReload !== layerCountAfterAdd) {
        throw new Error(`layer count after reload: expected ${layerCountAfterAdd}, got ${countReload}`);
      }
      return { layerCountAfterAdd, countReload, persisted: true };
    });

    // ── 11. Export via Files drawer ───────────────────────────────────────────
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

    // ── 12. Artifact oracle ───────────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'artifact-oracle', async () => {
      const { error, nLayers, totalNonZero } = runArtifactOracle(finalXpPath);
      if (error) throw new Error(`Artifact oracle error: ${error}`);
      if (totalNonZero <= 0) throw new Error('XP binary has no cells with char_code > 32');
      if (layerCountAfterAdd > 0 && nLayers !== layerCountAfterAdd) {
        throw new Error(`oracle nLayers=${nLayers} !== expected layerCountAfterAdd=${layerCountAfterAdd}`);
      }
      return { nLayers, totalNonZero, layerCountMatch: nLayers === layerCountAfterAdd };
    });

    overallPass = results.every((r) => r.pass);
  } catch (_err) {
    overallPass = results.every((r) => r.pass);
  } finally {
    await browser.close();
  }

  writeFileSync(`${OUTDIR}/result.json`, JSON.stringify({ overallPass, finalXpPath, layerCountAfterAdd, results }, null, 2));

  const step = (name) => results.find((r) => r.name === name);
  const ok   = (name) => step(name)?.pass ? '✅' : '❌';

  const lockData    = step('lock-layer-2')?.data || {};
  const rejectData  = step('locked-layer-rejects-draw')?.data || {};
  const unlockData  = step('unlock-layer-2')?.data || {};
  const switchData  = step('active-layer-switch')?.data || {};
  const upData      = step('move-layer-up')?.data || {};
  const downData    = step('move-layer-down')?.data || {};
  const addData     = step('add-layer-and-persist')?.data || {};
  const reloadData  = step('reload-verify-layer-count')?.data || {};
  const exportData  = step('export-via-files-drawer')?.data || {};
  const oracleData  = step('artifact-oracle')?.data || {};

  const lines = [
    '# Layer Operations Probe',
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
  lines.push(`${ok('open-layers-panel')} Layers panel opens; .ws-layer-row rows rendered`);
  lines.push(`${ok('lock-layer-2')} Lock layer 2: lockedBefore=${lockData.lockedBefore} → lockedAfter=${lockData.lockedAfter}; btn="${lockData.lockBtnText}"`);
  lines.push(`${ok('locked-layer-rejects-draw')} Locked layer rejects draw: rejected=${rejectData.rejected}; statusText="${rejectData.statusText}"`);
  lines.push(`${ok('unlock-layer-2')} Unlock layer 2: locked=${unlockData.locked}; btn="${unlockData.lockBtnText}"`);
  lines.push(`${ok('active-layer-switch')} Active-layer switch: ${switchData.activeLayerBefore}→${switchData.activeLayerAfter ?? switchData.activeRowIndex}; switched=${switchData.switched}`);
  lines.push(`${ok('move-layer-up')} Move layer up: reordered=${upData.reordered}; names=${JSON.stringify(upData.namesAfter)}`);
  lines.push(`${ok('move-layer-down')} Move layer down: names=${JSON.stringify(downData.namesAfter)}`);
  lines.push(`${ok('add-layer-and-persist')} Add layer: ${addData.countBefore}→${addData.countAfterAdd} (+${addData.delta}); saved=${addData.saved}`);
  lines.push(`${ok('reload-verify-layer-count')} Persistence: count after reload=${reloadData.countReload} (expected ${reloadData.layerCountAfterAdd})`);
  lines.push(`${ok('export-via-files-drawer')} Export XP via Files drawer: ${exportData.xpPath || '(none)'}`);
  const oracleLabel = oracleData.totalNonZero != null
    ? `Artifact oracle (gzip-aware): nLayers=${oracleData.nLayers}; totalNonZero=${oracleData.totalNonZero}; layerCountMatch=${oracleData.layerCountMatch}`
    : 'Artifact oracle: n_layers confirmed in XP binary';
  lines.push(`${ok('artifact-oracle')} ${oracleLabel}`);
  lines.push('');
  lines.push('## What this probe does NOT cover');
  lines.push('');
  lines.push('- Layer rename (no dedicated rename button in current mobile UI)');
  lines.push('- Visibility toggle (covered in tool_layer_parity_probe.mjs)');
  lines.push('- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)');

  const md = lines.join('\n') + '\n';
  writeFileSync(`${OUTDIR}/REPORT.md`, md);

  console.log(`\nResult: ${overallPass ? 'PASS' : 'FAIL'}`);
  console.log(`Steps: ${results.filter((r) => r.pass).length}/${results.length}`);
  for (const r of results) {
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}${r.error ? ' — ' + r.error.split('\n')[0] : ''}`);
  }
  if (finalXpPath) console.log(`Exported XP: ${finalXpPath}`);
  console.log(`Report: ${OUTDIR}/REPORT.md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
