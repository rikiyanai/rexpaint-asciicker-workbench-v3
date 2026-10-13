#!/usr/bin/env node

/**
 * UQ-013 / FL-MOB-01 — mobile authoring recipe probe.
 *
 * This is intentionally stronger than the drawer parity probe:
 *   - starts in an iPad landscape profile,
 *   - uses the mobile first screen to create a fresh template session,
 *   - stays in editor-first mode (no Advanced),
 *   - opens mobile drawers/top-bar controls through real clicks,
 *   - paints a deterministic seed-generated mark set on the whole-sheet canvas,
 *   - proves frame Add works through the Frames drawer,
 *   - saves and exports through mobile-reachable controls,
 *   - inspects the exported XP and verifies the authored glyph is present.
 *
 * Output:
 *   artifacts/2026-06-16-mobile-authoring-recipe/mobile-authoring-recipe.json
 *   artifacts/2026-06-16-mobile-authoring-recipe/mobile-authoring-result.json
 *   artifacts/2026-06-16-mobile-authoring-recipe/REPORT.md
 *
 * Run:
 *   node scripts/audit/mobile_authoring_recipe_probe.mjs --seed 42
 *
 * NOTE: Playwright WebKit is engine-family emulation under the iPad profile, not
 * Apple's shipping iOS Safari. The real iPad pass remains a separate gate.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const DEFAULT_OUTDIR = 'artifacts/2026-06-16-mobile-authoring-recipe';
const DEFAULT_URL = 'http://localhost:5071/workbench';
const CELL_SIZE = 12;

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

function makeRng(seed) {
  let s = Number(seed) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function rngInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function parseJsonText(text) {
  try { return JSON.parse(String(text || '{}')); } catch (_) { return {}; }
}

function extractGlyphCount(xpPath, glyph) {
  if (!xpPath) return 0;
  const abs = path.isAbsolute(xpPath) ? xpPath : path.resolve(REPO_ROOT, xpPath);
  const script = [
    'import os, sys',
    "sys.path.insert(0, 'scripts')",
    'from xp_core import XPFile',
    'xp = XPFile(os.environ["XP_PATH"])',
    'glyph = int(os.environ["GLYPH"])',
    'count = 0',
    'for layer in xp.layers:',
    '  for row in layer.data:',
    '    for cell in row:',
    '      if int(cell[0]) == glyph: count += 1',
    'print(count)',
  ].join('\n');
  const raw = execFileSync('python3', ['-c', script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, XP_PATH: abs, GLYPH: String(glyph) },
    timeout: 20000,
  });
  const numeric = raw.split('\n').map((s) => s.trim()).find((s) => /^\d+$/.test(s));
  return numeric ? Number(numeric) : 0;
}

async function screenshot(page, outDir, name) {
  const file = `${outDir}/${String(name).padStart(2, '0')}.png`;
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function snapshot(page) {
  return page.evaluate(() => {
    const wb = window.__wb_debug?.getState?.() || {};
    const ws = window.__wholeSheetEditor?.getState?.() || {};
    const mobileFirst = document.getElementById('mobileFirstScreen');
    const exportOut = document.getElementById('exportOut');
    let exportJson = {};
    try { exportJson = JSON.parse(exportOut?.textContent || '{}'); } catch (_) { exportJson = {}; }
    const drawer = document.querySelector('.ws-drawer.open');
    return {
      sessionId: wb.sessionId || '',
      templateSetKey: wb.templateSetKey || '',
      gridCols: wb.gridCols || 0,
      gridRows: wb.gridRows || 0,
      selectedRow: wb.selectedRow,
      selectedCols: wb.selectedCols || [],
      selectedFrames: wb.selectedFrames || [],
      historyDepth: wb.historyDepth || 0,
      futureDepth: wb.futureDepth || 0,
      sessionDirty: !!wb.sessionDirty,
      activeLayer: wb.activeLayer,
      layerCount: wb.layerCount,
      wsAdvanced: document.body.classList.contains('ws-advanced'),
      sessionLoadedClass: document.body.classList.contains('ws-session-loaded'),
      firstScreenHidden: !!mobileFirst?.classList.contains('hidden'),
      openDrawer: drawer?.getAttribute('data-drawer') || '',
      wholeSheetMounted: !!document.getElementById('wholeSheetCanvas'),
      activeTool: ws.activeTool || '',
      canvasZoom: ws.canvasZoom ?? null,
      appliedCanvasZoom: ws.appliedCanvasZoom ?? null,
      exportOut: exportJson,
    };
  });
}

async function recordStep(page, outDir, results, name, fn) {
  const pre = await snapshot(page);
  let pass = true;
  let error = '';
  let data = {};
  try {
    data = (await fn()) || {};
  } catch (e) {
    pass = false;
    error = e && e.stack ? String(e.stack) : String(e);
  }
  await page.waitForTimeout(250);
  const post = await snapshot(page);
  const shot = await screenshot(page, outDir, `${String(results.length + 1).padStart(2, '0')}-${name}`);
  results.push({ name, pass, error, data, pre, post, screenshot: shot });
  if (!pass) throw new Error(`${name}: ${error}`);
  return data;
}

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
  if (advanced) throw new Error(`opening drawer ${name} entered Advanced mode`);
}

async function setDrawState(page, glyph, fg, bg) {
  await openDrawer(page, 'tools');
  await page.locator('#wsGlyphCode').fill(String(glyph));
  await page.locator('#wsGlyphCode').dispatchEvent('change');
  await page.locator('#wsFgColor').fill(fg);
  await page.locator('#wsFgColor').dispatchEvent('input');
  await page.locator('#wsBgColor').fill(bg);
  await page.locator('#wsBgColor').dispatchEvent('input');
  await page.locator('#wsToolCell').click();
  await page.locator('.ws-mobile-top-bar [data-drawer-toggle="tools"]').click();
  await page.waitForFunction(
    () => !document.querySelector('.ws-drawer.open') && !document.querySelector('.ws-drawer-backdrop.visible'),
    { timeout: 5000 }
  );
}

async function getRenderedCellSize(page) {
  return page.evaluate((base) => {
    const ws = window.__wholeSheetEditor?.getState?.() || {};
    return base * Math.max(0.05, Number(ws.appliedCanvasZoom || ws.canvasZoom || 1));
  }, CELL_SIZE);
}

async function canvasPoint(page, cx, cy) {
  const rendered = await getRenderedCellSize(page);
  await page.evaluate(({ x, y }) => {
    const scroll = document.getElementById('wholeSheetScroll');
    if (!scroll) return;
    scroll.scrollLeft = Math.max(0, x - scroll.clientWidth / 2);
    scroll.scrollTop = Math.max(0, y - scroll.clientHeight / 2);
  }, { x: cx * rendered, y: cy * rendered });
  await page.waitForTimeout(100);
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
    scroll.scrollLeft = Math.max(0, x - scroll.clientWidth / 2);
    scroll.scrollTop = Math.max(0, y - scroll.clientHeight / 2);
  }, { x: cx * rendered, y: cy * rendered });
  await page.waitForTimeout(100);
  await page.click('#wholeSheetCanvas', {
    position: {
      x: cx * rendered + rendered / 2,
      y: cy * rendered + rendered / 2,
    },
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

async function readCell(page, x, y) {
  return page.evaluate(({ x: cx, y: cy }) => {
    const doc = window.__wholeSheetEditor?.getDocumentSnapshot?.();
    const layerIndex = window.__wb_debug?.getState?.()?.activeLayer ?? 2;
    const layer = doc?.layers?.[layerIndex];
    const cols = Number(doc?.gridCols || 0);
    return Array.isArray(layer) && cols > 0 ? (layer[cy * cols + cx] || null) : null;
  }, { x, y });
}

function buildRecipe(seed, opts = {}) {
  const rng = makeRng(seed);
  const glyph = 65 + (Number(seed) % 20);
  const fg = '#ffec27';
  const bg = '#1d2b53';
  const marks = [];
  for (let i = 0; i < 8; i += 1) {
    marks.push({ x: rngInt(rng, 2, 24), y: rngInt(rng, 2, 18) });
  }
  const rect = { x1: rngInt(rng, 28, 36), y1: rngInt(rng, 4, 10), x2: rngInt(rng, 40, 50), y2: rngInt(rng, 14, 22) };
  const steps = [
    { action: 'apply_mobile_first_screen_template', template: 'player_native_idle_only' },
    { action: 'open_drawer', drawer: 'tools' },
    { action: 'set_draw_state', glyph, fg, bg },
    ...marks.map((m) => ({ action: 'paint_cell', ...m, glyph })),
    { action: 'rect_drag', ...rect, glyph },
  ];
  if (opts.includeFrameAdd) steps.push({ action: 'frames_add_frame' });
  steps.push(
    { action: 'save_via_mobile_topbar' },
    { action: 'export_via_files_drawer' },
    { action: 'verify_export_contains_glyph', glyph },
  );
  return {
    mode: 'mobile_authoring',
    seed: Number(seed),
    generated_at: new Date().toISOString(),
    template: 'player_native_idle_only',
    glyph,
    fg,
    bg,
    include_frame_add: !!opts.includeFrameAdd,
    steps,
  };
}

async function main() {
  const seed = Number(arg('--seed', '42'));
  const outDir = arg('--out-dir', DEFAULT_OUTDIR);
  const url = arg('--url', DEFAULT_URL);
  const headed = flag('--headed') || !flag('--headless');
  mkdirSync(outDir, { recursive: true });

  const recipe = buildRecipe(seed, { includeFrameAdd: flag('--include-frame-add') });
  writeFileSync(`${outDir}/mobile-authoring-recipe.json`, JSON.stringify(recipe, null, 2));

  const browser = await webkit.launch({ headless: !headed });
  const results = [];
  let overallPass = false;
  let finalExportPath = '';
  let exportedGlyphCount = 0;
  try {
    const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    await recordStep(page, outDir, results, 'fresh-mobile-first-screen', async () => {
      const visible = await page.locator('#mobileFirstScreen').isVisible();
      if (!visible) throw new Error('mobile first screen is not visible');
      return { visible };
    });

    await recordStep(page, outDir, results, 'apply-template', async () => {
      await page.locator('#fsTemplateSelect').selectOption(recipe.template);
      await page.locator('#fsTemplateApplyBtn').click();
      await page.waitForFunction(
        () => document.getElementById('mobileFirstScreen')?.classList.contains('hidden') &&
          document.body.classList.contains('ws-session-loaded') &&
          !!document.getElementById('wholeSheetCanvas'),
        { timeout: 30000 }
      );
      const advanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
      if (advanced) throw new Error('template path entered Advanced mode');
      return { template: recipe.template };
    });

    await recordStep(page, outDir, results, 'set-draw-state-through-tools-drawer', async () => {
      await setDrawState(page, recipe.glyph, recipe.fg, recipe.bg);
      return { glyph: recipe.glyph, fg: recipe.fg, bg: recipe.bg };
    });

    await recordStep(page, outDir, results, 'paint-seed-cells', async () => {
      const marks = recipe.steps.filter((s) => s.action === 'paint_cell');
      const first = marks[0];
      const before = await readCell(page, first.x, first.y);
      for (const m of marks) await clickCell(page, m.x, m.y);
      await page.waitForTimeout(400);
      const painted = [];
      for (const m of marks) {
        const cell = await readCell(page, m.x, m.y);
        painted.push({ ...m, actualGlyph: cell?.glyph ?? null });
      }
      const misses = painted.filter((p) => Number(p.actualGlyph) !== recipe.glyph);
      if (misses.length) throw new Error(`paint misses: ${JSON.stringify(misses)}`);
      return { before, painted };
    });

    await recordStep(page, outDir, results, 'draw-rectangle-through-canvas', async () => {
      const rect = recipe.steps.find((s) => s.action === 'rect_drag');
      await openDrawer(page, 'tools');
      await page.locator('#wsToolRect').click();
      await page.locator('.ws-mobile-top-bar [data-drawer-toggle="tools"]').click();
      await page.waitForFunction(
        () => !document.querySelector('.ws-drawer.open') && !document.querySelector('.ws-drawer-backdrop.visible'),
        { timeout: 5000 }
      );
      await dragCells(page, rect.x1, rect.y1, rect.x2, rect.y2);
      await page.waitForTimeout(500);
      const tl = await readCell(page, rect.x1, rect.y1);
      const br = await readCell(page, rect.x2, rect.y2);
      if (Number(tl?.glyph) !== recipe.glyph && Number(br?.glyph) !== recipe.glyph) {
        throw new Error(`rectangle did not mark either corner: tl=${tl?.glyph} br=${br?.glyph}`);
      }
      return { rect, tl, br };
    });

    if (recipe.include_frame_add) {
      await recordStep(page, outDir, results, 'frames-add-frame-through-drawer', async () => {
        await openDrawer(page, 'frames');
        const before = await page.evaluate(() => document.querySelectorAll('#gridPanel .frame-cell').length);
        await page.locator('.ws-drawer[data-drawer="frames"] #addFrameBtn').click();
        await page.waitForTimeout(700);
        const after = await page.evaluate(() => document.querySelectorAll('#gridPanel .frame-cell').length);
        if (after <= before) throw new Error(`Add Frame did not increase cells: ${before} -> ${after}`);
        return { before, after };
      });
    }

    await recordStep(page, outDir, results, 'save-through-mobile-topbar', async () => {
      await page.evaluate(() => { const el = document.getElementById('exportOut'); if (el) el.textContent = ''; });
      await page.locator('.ws-mobile-top-bar [data-action="save"]').click();
      await page.waitForFunction(() => {
        const st = window.__wb_debug?.getState?.();
        if (st && st.sessionDirty === false) return true;
        const out = String(document.getElementById('exportOut')?.textContent || '');
        return /save_failed|Save failed|timed_out|error/i.test(out);
      }, { timeout: 20000 }).catch(() => {});
      const st = await snapshot(page);
      const diag = await page.evaluate(() => ({
        wbStatus: String(document.getElementById('wbStatus')?.textContent || ''),
        sessionDirtyBadge: String(document.getElementById('sessionDirtyBadge')?.textContent || ''),
        exportOut: String(document.getElementById('exportOut')?.textContent || ''),
        saveInFlight: !!window.__wb_debug?.getState?.()?.sessionSaveInFlight,
        wbState: window.__wb_debug?.getState?.() || null,
        wsState: window.__wholeSheetEditor?.getState?.() || null,
        wsSnapshotMeta: (() => {
          const snap = window.__wholeSheetEditor?.getDocumentSnapshot?.();
          return snap ? {
            gridCols: snap.gridCols,
            gridRows: snap.gridRows,
            frameW: snap.frameW,
            frameH: snap.frameH,
            layerLengths: Array.isArray(snap.layers) ? snap.layers.map((l) => Array.isArray(l) ? l.length : -1) : [],
          } : null;
        })(),
      }));
      if (st.sessionDirty) throw new Error(`sessionDirty remained true after Save: ${JSON.stringify(diag)}`);
      return { sessionDirty: st.sessionDirty, diag };
    });

    await recordStep(page, outDir, results, 'export-through-files-drawer', async () => {
      await openDrawer(page, 'files');
      await page.evaluate(() => { const el = document.getElementById('exportOut'); if (el) el.textContent = ''; });
      await page.locator('.ws-drawer[data-drawer="files"] #btnExport').click();
      await page.waitForFunction(() => {
        const text = String(document.getElementById('exportOut')?.textContent || '').trim();
        if (!text) return false;
        try {
          const j = JSON.parse(text);
          return !!j.xp_path || !!j.stage || !!j.error;
        } catch (_) {
          return false;
        }
      }, { timeout: 30000 });
      const exportOut = await page.evaluate(() => {
        try { return JSON.parse(document.getElementById('exportOut')?.textContent || '{}'); }
        catch (_) { return {}; }
      });
      if (!exportOut.xp_path) throw new Error(`export did not produce xp_path: ${JSON.stringify(exportOut)}`);
      finalExportPath = String(exportOut.xp_path);
      return { exportOut };
    });

    await recordStep(page, outDir, results, 'verify-exported-xp-glyph', async () => {
      exportedGlyphCount = extractGlyphCount(finalExportPath, recipe.glyph);
      if (exportedGlyphCount < 1) {
        throw new Error(`exported XP does not contain glyph ${recipe.glyph} at ${finalExportPath}`);
      }
      return { xpPath: finalExportPath, glyph: recipe.glyph, exportedGlyphCount };
    });

    const advanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
    if (advanced) throw new Error('recipe ended in Advanced mode');
    await ctx.close();
    overallPass = true;
  } finally {
    await browser.close();
  }

  const result = {
    result: overallPass ? 'PASS' : 'FAIL',
    url,
    seed,
    recipe_path: `${outDir}/mobile-authoring-recipe.json`,
    export_xp_path: finalExportPath,
    exported_glyph_count: exportedGlyphCount,
    steps: results,
  };
  writeFileSync(`${outDir}/mobile-authoring-result.json`, JSON.stringify(result, null, 2));

  const lines = [
    '# Mobile Authoring Recipe Probe',
    '',
    `Result: **${result.result}**`,
    `Seed: \`${seed}\``,
    `URL: \`${url}\``,
    `Recipe: \`${result.recipe_path}\``,
    `Exported XP: \`${finalExportPath || '(none)'}\``,
    `Authored glyph: \`${recipe.glyph}\` · exported count: \`${exportedGlyphCount}\``,
    '',
    'This probe uses Playwright WebKit under an iPad landscape profile. It is not real iOS Safari.',
    '',
    '## Steps',
    '',
    ...results.map((r, i) => `${i + 1}. ${r.pass ? 'PASS' : 'FAIL'} — ${r.name}${r.error ? ` — ${r.error}` : ''}`),
    '',
  ];
  writeFileSync(`${outDir}/REPORT.md`, lines.join('\n'));
  console.log(`Report: ${outDir}/REPORT.md`);
  console.log(`RESULT: ${result.result}`);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
