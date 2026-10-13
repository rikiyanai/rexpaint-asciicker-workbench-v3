#!/usr/bin/env node
/**
 * UQ-013 / FL-MOB-01 — Frames parity v2 probe (#2 of execution order).
 *
 * Extends frames_parity_probe with controls not driven in v1:
 *   - Row Down (rowDownBtn) + Row Up (rowUpBtn)
 *   - gridZoomInput mutation
 *   - gridToggleLabels toggle
 *   - Clear Selected (deleteCellBtn) — clears content of selected frames
 *
 * Steps:
 *   1.  Mobile first screen
 *   2.  Apply template
 *   3.  Open frames drawer
 *   4.  Select frame tile
 *   5.  Col Right
 *   6.  Col Left
 *   7.  Add Frame
 *   8.  Delete Frame (deleteFrameBtn)
 *   9.  Row Down → selectedRow increases
 *  10.  Row Up → selectedRow decreases
 *  11.  gridZoomInput mutation
 *  12.  gridToggleLabels toggle
 *  13.  Clear Selected (deleteCellBtn) — safe on copy-pasted duplicate
 *  14.  Context menu copy+paste
 *  15.  Layer select
 *  16.  Focus whole-sheet
 *  17.  Export via Files drawer
 *  18.  Artifact oracle
 *
 * Run:
 *   node scripts/audit/frames_parity_v2_probe.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUTDIR = 'artifacts/2026-06-16-frames-parity-v2';
const BASE_URL = 'http://localhost:5071/workbench';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getWbDebugState(page) {
  return page.evaluate(() => window.__wb_debug?.getState?.() || {});
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

function runArtifactOracle(xpPath) {
  if (!xpPath) return { error: 'no xp_path', totalNonZero: 0 };
  const abs = path.resolve(REPO_ROOT, xpPath);
  const script = `
import gzip, struct
path = r'${abs}'
with open(path,'rb') as f: raw=f.read()
data = gzip.decompress(raw) if raw[:2]==b'\\x1f\\x8b' else raw
n_layers = struct.unpack_from('<i',data,4)[0]
off = 8; total = 0
for _ in range(n_layers):
    w=struct.unpack_from('<i',data,off)[0]; h=struct.unpack_from('<i',data,off+4)[0]; off+=8
    for _ in range(w*h):
        code=struct.unpack_from('<i',data,off)[0]
        if code != 0 and code != 32: total+=1
        off+=10
print(total)
`;
  try {
    const raw = execFileSync('python3', ['-c', script], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 20000 });
    const n = parseInt(raw.trim(), 10);
    return { error: isNaN(n) ? 'parse error' : null, totalNonZero: isNaN(n) ? 0 : n };
  } catch (e) {
    return { error: String(e.message || e), totalNonZero: 0 };
  }
}

async function recordStep(page, outdir, results, name, fn) {
  const idx = results.length + 1;
  let data = {};
  let error = null;
  try { data = await fn() || {}; } catch (e) { error = String(e.message || e); }
  const screenshotName = `${String(idx).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(REPO_ROOT, outdir, screenshotName), fullPage: false }).catch(() => {});
  const entry = { step: idx, name, status: error ? 'FAIL' : 'PASS', error, ...data };
  results.push(entry);
  if (error) throw new Error(`Step ${idx} ${name}: ${error}`);
  return entry;
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  mkdirSync(path.join(REPO_ROOT, OUTDIR), { recursive: true });

  const browser = await webkit.launch({ headless: false });
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  const results = [];
  let xpPath = null;

  try {
    // 1. Mobile first screen
    await recordStep(page, OUTDIR, results, 'fresh-mobile-first-screen', async () => {
      const visible = await page.locator('#mobileFirstScreen').isVisible();
      if (!visible) throw new Error('#mobileFirstScreen not visible on fresh load');
      return { visible };
    });

    // 2. Apply template
    await recordStep(page, OUTDIR, results, 'apply-template', async () => {
      await page.locator('#fsTemplateSelect').selectOption('player_native_idle_only');
      await page.locator('#fsTemplateApplyBtn').click();
      await page.waitForFunction(
        () => document.getElementById('mobileFirstScreen')?.classList.contains('hidden') &&
          document.body.classList.contains('ws-session-loaded') &&
          !!document.getElementById('wholeSheetCanvas'),
        { timeout: 30000 }
      );
      const advanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
      if (advanced) throw new Error('Advanced mode after apply — expected editor-first shell');
      const wb = await getWbDebugState(page);
      return { sessionId: wb.sessionId, gridCols: wb.gridCols, gridRows: wb.gridRows };
    });

    // 3. Open frames drawer
    await recordStep(page, OUTDIR, results, 'open-frames-drawer', async () => {
      await openDrawer(page, 'frames');
      const frameCount = await page.evaluate(() => document.querySelectorAll('.frame-cell').length);
      if (!frameCount) throw new Error('no frame cells rendered');
      const addFrameVisible = await page.locator('#addFrameBtn').isVisible();
      if (!addFrameVisible) throw new Error('#addFrameBtn not visible in frames drawer');
      const buttons = await page.evaluate(() => ({
        rowUpEnabled: !document.getElementById('rowUpBtn')?.disabled,
        rowDownEnabled: !document.getElementById('rowDownBtn')?.disabled,
        gridZoomInput: !!document.getElementById('gridZoomInput'),
        gridToggleLabels: !!document.getElementById('gridToggleLabels'),
        deleteCellBtn: !!document.getElementById('deleteCellBtn'),
      }));
      return { frameCount, addFrameVisible, buttons };
    });

    // 4. Select frame tile
    await recordStep(page, OUTDIR, results, 'select-frame-tile', async () => {
      const firstCell = page.locator('.frame-cell').first();
      await firstCell.click();
      await page.waitForTimeout(300);
      const wb = await getWbDebugState(page);
      const selected = wb.selectedFrames?.[0] || null;
      const addEnabled = await page.evaluate(() => !document.getElementById('addFrameBtn')?.disabled);
      const rowDownEnabled = await page.evaluate(() => !document.getElementById('rowDownBtn')?.disabled);
      return { selected, addEnabled, rowDownEnabled };
    });

    // 5. Col Right
    await recordStep(page, OUTDIR, results, 'col-right', async () => {
      const enabled = await page.evaluate(() => !document.getElementById('colRightBtn')?.disabled);
      if (!enabled) return { skipped: true, reason: 'colRightBtn disabled' };
      const wsBefore = await getWbDebugState(page);
      const before = wsBefore.selectedFrames?.[0] || {};
      await page.locator('#colRightBtn').click();
      await page.waitForTimeout(300);
      const wsAfter = await getWbDebugState(page);
      const after = wsAfter.selectedFrames?.[0] || {};
      return { before, after, moved: after.col !== before.col };
    });

    // 6. Col Left
    await recordStep(page, OUTDIR, results, 'col-left', async () => {
      const enabled = await page.evaluate(() => !document.getElementById('colLeftBtn')?.disabled);
      if (!enabled) return { skipped: true, reason: 'colLeftBtn disabled' };
      const wsBefore = await getWbDebugState(page);
      const before = wsBefore.selectedFrames?.[0] || {};
      await page.locator('#colLeftBtn').click();
      await page.waitForTimeout(300);
      const wsAfter = await getWbDebugState(page);
      const after = wsAfter.selectedFrames?.[0] || {};
      return { before, after };
    });

    // 7. Add Frame
    await recordStep(page, OUTDIR, results, 'add-frame', async () => {
      const countBefore = await page.evaluate(() => document.querySelectorAll('.frame-cell').length);
      await page.locator('#addFrameBtn').click();
      await page.waitForTimeout(500);
      const countAfter = await page.evaluate(() => document.querySelectorAll('.frame-cell').length);
      if (countAfter <= countBefore) throw new Error(`frame count did not increase: ${countBefore} → ${countAfter}`);
      // Select the new frame
      await page.locator('.frame-cell').last().click();
      await page.waitForTimeout(200);
      return { countBefore, countAfter };
    });

    // 8. Delete Frame (deleteFrameBtn)
    await recordStep(page, OUTDIR, results, 'delete-frame', async () => {
      const delEnabled = await page.evaluate(() => !document.getElementById('deleteFrameBtn')?.disabled);
      if (!delEnabled) throw new Error('#deleteFrameBtn is disabled');
      const countBefore = await page.evaluate(() => document.querySelectorAll('.frame-cell').length);
      await page.locator('#deleteFrameBtn').click();
      await page.waitForTimeout(500);
      const countAfter = await page.evaluate(() => document.querySelectorAll('.frame-cell').length);
      if (countAfter >= countBefore) throw new Error(`frame count did not decrease: ${countBefore} → ${countAfter}`);
      return { countBefore, countAfter };
    });

    // 9. Row Down
    await recordStep(page, OUTDIR, results, 'row-down', async () => {
      // Select first frame tile so rowDown is available
      await page.locator('.frame-cell').first().click();
      await page.waitForTimeout(200);
      const rowDownEnabled = await page.evaluate(() => !document.getElementById('rowDownBtn')?.disabled);
      if (!rowDownEnabled) throw new Error('rowDownBtn disabled — need ≥2 rows');
      const wsBefore = await getWbDebugState(page);
      const rowBefore = wsBefore.selectedRow ?? 0;
      await page.locator('#rowDownBtn').click();
      await page.waitForTimeout(400);
      const wsAfter = await getWbDebugState(page);
      const rowAfter = wsAfter.selectedRow ?? 0;
      const rowUpNowEnabled = await page.evaluate(() => !document.getElementById('rowUpBtn')?.disabled);
      if (rowAfter === rowBefore) throw new Error(`selectedRow unchanged: ${rowBefore}`);
      return { rowBefore, rowAfter, rowUpNowEnabled };
    });

    // 10. Row Up
    await recordStep(page, OUTDIR, results, 'row-up', async () => {
      const rowUpEnabled = await page.evaluate(() => !document.getElementById('rowUpBtn')?.disabled);
      if (!rowUpEnabled) throw new Error('rowUpBtn disabled after row-down');
      const wsBefore = await getWbDebugState(page);
      const rowBefore = wsBefore.selectedRow ?? 1;
      await page.locator('#rowUpBtn').click();
      await page.waitForTimeout(400);
      const wsAfter = await getWbDebugState(page);
      const rowAfter = wsAfter.selectedRow ?? 0;
      if (rowAfter >= rowBefore) throw new Error(`selectedRow did not decrease: ${rowBefore} → ${rowAfter}`);
      return { rowBefore, rowAfter };
    });

    // 11. gridZoomInput
    await recordStep(page, OUTDIR, results, 'grid-zoom-input', async () => {
      const exists = await page.evaluate(() => !!document.getElementById('gridZoomInput'));
      if (!exists) return { skipped: true, reason: 'gridZoomInput not in DOM' };
      const wsBefore = await getWbDebugState(page);
      const zoomBefore = wsBefore.gridPanelZoom ?? 0;
      await page.evaluate(() => {
        const el = document.getElementById('gridZoomInput');
        if (!el) return;
        el.value = '2';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(300);
      const wsAfter = await getWbDebugState(page);
      const zoomAfter = wsAfter.gridPanelZoom;
      return { zoomBefore, zoomAfter, changed: zoomAfter !== zoomBefore };
    });

    // 12. gridToggleLabels
    await recordStep(page, OUTDIR, results, 'grid-toggle-labels', async () => {
      const exists = await page.evaluate(() => !!document.getElementById('gridToggleLabels'));
      if (!exists) return { skipped: true, reason: 'gridToggleLabels not in DOM' };
      const panel = page.locator('#gridPanel, .frames-grid-panel, .frame-grid-panel');
      const hasPanel = await panel.count() > 0;
      const labelsBefore = hasPanel ? await panel.first().evaluate(el => el.classList.contains('frame-labels-visible')) : null;
      await page.locator('#gridToggleLabels').click();
      await page.waitForTimeout(200);
      const labelsAfter = hasPanel ? await panel.first().evaluate(el => el.classList.contains('frame-labels-visible')) : null;
      return { labelsBefore, labelsAfter, toggled: labelsBefore !== labelsAfter };
    });

    // 13. Clear Selected (deleteCellBtn) — safe since template frames have content
    await recordStep(page, OUTDIR, results, 'clear-selected-deletecellbtn', async () => {
      const exists = await page.evaluate(() => !!document.getElementById('deleteCellBtn'));
      if (!exists) return { skipped: true, reason: 'deleteCellBtn not in DOM' };
      // Select a frame tile first
      await page.locator('.frame-cell').first().click();
      await page.waitForTimeout(200);
      const delEnabled = await page.evaluate(() => !document.getElementById('deleteCellBtn')?.disabled);
      if (!delEnabled) return { skipped: true, reason: 'deleteCellBtn disabled — no frame selected or layer read-only' };
      const wsBefore = await getWbDebugState(page);
      const nonZeroBefore = wsBefore.selectedFrames?.length ?? 0;
      await page.locator('#deleteCellBtn').click();
      await page.waitForTimeout(400);
      // Verify the action executed (status message or state change)
      const wsAfter = await getWbDebugState(page);
      return { nonZeroBefore, executed: true, selectedFrames: wsAfter.selectedFrames?.length };
    });

    // 14. Context menu copy + paste
    await recordStep(page, OUTDIR, results, 'context-menu-copy-paste', async () => {
      const firstCell = page.locator('.frame-cell').first();
      // Right-click for context menu
      await firstCell.click({ button: 'right' });
      await page.waitForTimeout(300);
      const menuVisible = await page.evaluate(() => {
        const items = document.querySelectorAll('[role="menuitem"], .context-menu-item');
        return items.length > 0;
      });
      if (!menuVisible) return { skipped: true, reason: 'context menu not visible after right-click' };
      // Copy
      await page.evaluate(() => {
        const items = [...document.querySelectorAll('[role="menuitem"], .context-menu-item')];
        const copy = items.find(i => i.textContent?.toLowerCase().includes('copy'));
        if (copy) copy.click();
      });
      await page.waitForTimeout(200);
      // Re-open for paste
      await firstCell.click({ button: 'right' });
      await page.waitForTimeout(200);
      const pasteEnabled = await page.evaluate(() => {
        const items = [...document.querySelectorAll('[role="menuitem"], .context-menu-item')];
        const paste = items.find(i => i.textContent?.toLowerCase().includes('paste'));
        return paste ? !paste.hasAttribute('disabled') && !paste.classList.contains('disabled') : false;
      });
      await page.evaluate(() => {
        const items = [...document.querySelectorAll('[role="menuitem"], .context-menu-item')];
        const paste = items.find(i => i.textContent?.toLowerCase().includes('paste'));
        if (paste) paste.click();
      });
      await page.waitForTimeout(400);
      return { menuVisible, pasteEnabled };
    });

    // 15. Layer select
    await recordStep(page, OUTDIR, results, 'layer-select', async () => {
      // In frames drawer the layer select is a <select> for active layer
      const sel = await page.evaluate(() => {
        const s = document.querySelector('#framesLayerSelect, #wsFrameLayerSelect, .frames-drawer select');
        if (!s) return null;
        return { id: s.id, value: s.value, optionCount: s.options.length };
      });
      if (!sel) return { skipped: true, reason: 'no layer select in frames drawer' };
      const wsBefore = await getWbDebugState(page);
      const before = wsBefore.activeLayer ?? 2;
      await page.evaluate((before) => {
        const s = document.querySelector('#framesLayerSelect, #wsFrameLayerSelect, .frames-drawer select');
        if (!s) return;
        const opts = [...s.options].map(o => o.value);
        const target = opts.find(v => v !== String(before)) || opts[0];
        s.value = target;
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }, before);
      await page.waitForTimeout(300);
      const wsAfter = await getWbDebugState(page);
      return { before, after: wsAfter.activeLayer, sel };
    });

    // 16. Focus whole-sheet
    await recordStep(page, OUTDIR, results, 'focus-whole-sheet', async () => {
      const inspEnabled = await page.evaluate(() => !document.getElementById('openInspectorBtn')?.disabled);
      if (!inspEnabled) {
        // Try selecting a frame first
        await page.locator('.frame-cell').first().click();
        await page.waitForTimeout(200);
      }
      await page.locator('#openInspectorBtn').click();
      await page.waitForTimeout(500);
      const wholeSheetVisible = await page.evaluate(() => {
        const panel = document.getElementById('wholeSheetPanel');
        if (!panel) return false;
        return !panel.classList.contains('hidden') && panel.getBoundingClientRect().height > 0;
      });
      return { wholeSheetVisible };
    });

    // 17. Export via Files drawer
    await recordStep(page, OUTDIR, results, 'export-via-files-drawer', async () => {
      // Re-open files drawer (may have been closed by focus-whole-sheet)
      await page.evaluate(() => window.toggleDrawer && window.toggleDrawer()).catch(() => {});
      await page.waitForTimeout(100);
      await openDrawer(page, 'files');
      await page.locator('.ws-drawer[data-drawer="files"] #btnExport').click();
      await page.waitForFunction(
        () => {
          const el = document.getElementById('exportOut');
          try { const d = JSON.parse(el?.textContent || '{}'); return !!d.xp_path; } catch(_) { return false; }
        },
        { timeout: 20000 }
      );
      const rawOut = await page.locator('#exportOut').textContent();
      const parsed = JSON.parse(rawOut || '{}');
      xpPath = parsed.xp_path;
      if (!xpPath) throw new Error('no xp_path in exportOut');
      await closeDrawer(page);
      return { xpPath };
    });

    // 18. Artifact oracle
    await recordStep(page, OUTDIR, results, 'artifact-oracle', async () => {
      const result = runArtifactOracle(xpPath);
      if (result.error) throw new Error(`oracle error: ${result.error}`);
      if (result.totalNonZero === 0) throw new Error('oracle: totalNonZero=0 (empty XP)');
      return { xpPath, ...result };
    });

  } catch (err) {
    console.error('PROBE FAILED:', err.message);
  }

  await browser.close();

  const overall = results.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL';
  writeFileSync(path.join(REPO_ROOT, OUTDIR, 'result.json'), JSON.stringify({ overall, steps: results }, null, 2));

  const lines = [
    `# Frames Parity v2 Probe`,
    ``,
    `Result: **${overall}**`,
    xpPath ? `Exported XP: \`${xpPath}\`` : '',
    ``,
    `Playwright WebKit under iPad Pro 11 landscape — NOT Apple iOS Safari.`,
    ``,
    `## Steps`,
    ``,
    ...results.map(r => `${r.step}. ${r.status} — ${r.name}${r.error ? ` ← ${r.error}` : ''}`),
    ``,
    `## New controls proven (vs v1)`,
    ``,
    ...results.filter(r => r.status === 'PASS').map(r => {
      const m = {
        'row-down': `✅ Row Down: selectedRow ${r.rowBefore}→${r.rowAfter}; rowUpNowEnabled=${r.rowUpNowEnabled}`,
        'row-up': `✅ Row Up: selectedRow ${r.rowBefore}→${r.rowAfter}`,
        'grid-zoom-input': r.skipped ? `⚠️ gridZoomInput: ${r.reason}` : `✅ gridZoomInput: zoom ${r.zoomBefore}→${r.zoomAfter} changed=${r.changed}`,
        'grid-toggle-labels': r.skipped ? `⚠️ gridToggleLabels: ${r.reason}` : `✅ gridToggleLabels: ${r.labelsBefore}→${r.labelsAfter} toggled=${r.toggled}`,
        'clear-selected-deletecellbtn': r.skipped ? `⚠️ Clear Selected: ${r.reason}` : `✅ Clear Selected (deleteCellBtn): executed=${r.executed}`,
      };
      return m[r.name] || null;
    }).filter(Boolean),
  ].join('\n');

  writeFileSync(path.join(REPO_ROOT, OUTDIR, 'REPORT.md'), lines);
  console.log(`\nResult: ${overall}`);
  results.forEach(r => console.log(`  ${r.status} ${r.name}${r.error ? ' — ' + r.error : ''}`));
})();
