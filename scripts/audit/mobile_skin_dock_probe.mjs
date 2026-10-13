#!/usr/bin/env node
/**
 * Mobile Skin Dock — Author → Save → Export → Test Skin probe (#6).
 *
 * Proves the full Test-Skin pipeline from authored cells to the flat test
 * arena preview, on the mobile workbench top bar (Playwright WebKit iPad
 * Pro 11 landscape).
 *
 * Steps:
 *   1. Mobile first screen (fresh load)
 *   2. Apply player_native_idle_only template
 *   3. Author 3×3 glyph block (glyph 68 'D', vivid colors)
 *   4. Save via mobile top bar (sessionDirty → false)
 *   5. Export XP via Files drawer (native #btnExport)
 *   6. Open Test drawer — verify preflight ok + button enabled
 *   7. Click "Test This Skin"
 *   8. webbuild iframe appears with src set (iframe load event)
 *   9. state.webbuild.ready === true (skin injection complete in WASM)
 *  10. Screenshot of preview surface after ready
 *
 * Honesty labels:
 *   - Proves local XP preview in the flat test arena (termpp-web-flat)
 *   - Step 9 requires the WASM game to finish downloading (~24MB), may take 30-120s
 *   - Does NOT prove the skin renders visually in the WASM game (EMFS injection
 *     limitation: engine caches sprites at init, post-init writes are not re-read)
 *   - Does NOT prove live Y9-2 game integration
 *   - Playwright WebKit iPad Pro 11 landscape — NOT Apple iOS Safari
 *
 * Run:
 *   node scripts/audit/mobile_skin_dock_probe.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const OUTDIR = 'artifacts/2026-06-16-mobile-skin-dock';
const BASE_URL = 'http://localhost:5071/workbench';
const CELL_SIZE = 12;
const GLYPH_D = 68;       // 'D' — same as probe #5 for comparability
const FG_D = '#ee44ff';   // vivid purple
const BG_D = '#001133';   // near-black blue
const PERSIST_BLOCK = { x: 3, y: 3, w: 3, h: 3 };

// ── Playwright helpers ────────────────────────────────────────────────────────

async function getWbDebugState(page) {
  return page.evaluate(() => window.__wb_debug?.getState?.() || {});
}

async function getWebbuildState(page) {
  return page.evaluate(() => window.__wb_debug?.getWebbuildDebugState?.() || {});
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

async function clickCell(page, cellX, cellY) {
  const canvas = page.locator('#wholeSheetCanvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('wholeSheetCanvas not found');
  await page.mouse.click(box.x + cellX * CELL_SIZE + CELL_SIZE / 2, box.y + cellY * CELL_SIZE + CELL_SIZE / 2);
}

// ── Step recorder ─────────────────────────────────────────────────────────────

async function recordStep(page, outDir, results, name, fn) {
  const snap = () => page.evaluate(() => {
    const wb = window.__wb_debug?.getState?.() || {};
    const wbd = window.__wb_debug?.getWebbuildDebugState?.() || {};
    return {
      sessionId: wb.sessionId,
      sessionDirty: wb.sessionDirty,
      wsAdvanced: document.body.classList.contains('ws-advanced'),
      firstScreenHidden: document.getElementById('mobileFirstScreen')?.classList.contains('hidden'),
      webbuildLoaded: !!wbd.loaded,
      webbuildReady: !!wbd.ready,
      webbuildState: String(wbd.webbuildState || ''),
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

    // ── 3. Author 3×3 glyph block ─────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'author-cells', async () => {
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

      const wb = await getWbDebugState(page);
      if (!wb.sessionDirty) throw new Error('sessionDirty not set after painting');
      return { cells: PERSIST_BLOCK.w * PERSIST_BLOCK.h, sessionDirty: wb.sessionDirty };
    });

    // ── 4. Save via mobile top bar ────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'save-session', async () => {
      await page.locator('.ws-mobile-top-bar [data-action="save"]').click();
      await page.waitForFunction(
        () => { const st = window.__wb_debug?.getState?.(); return st && st.sessionDirty === false; },
        { timeout: 20000 }
      );
      const wb = await getWbDebugState(page);
      if (wb.sessionDirty) throw new Error('sessionDirty remained true after save');
      return { sessionDirty: false, sessionId: wb.sessionId?.slice(0, 8) };
    });

    // ── 5. Export XP via Files drawer (native #btnExport) ────────────────────
    await recordStep(page, OUTDIR, results, 'export-xp', async () => {
      await page.evaluate(() => {
        const el = document.getElementById('exportOut');
        if (el) el.textContent = '';
      });
      await openDrawer(page, 'files');
      const btnDisabled = await page.locator('#btnExport').getAttribute('disabled');
      if (btnDisabled !== null) throw new Error('#btnExport disabled — session not loaded properly');
      await page.locator('#btnExport').click();
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
      if (!exportResult.xp_path) throw new Error(`export failed: ${rawOut.slice(0, 200)}`);
      await closeDrawer(page);
      finalXpPath = exportResult.xp_path;
      return { xpPath: exportResult.xp_path };
    });

    // ── 6. Open Test drawer — preflight ok + button enabled ──────────────────
    await recordStep(page, OUTDIR, results, 'open-test-drawer', async () => {
      await openDrawer(page, 'test');
      // Wait for preflight to run and button to enable
      await page.waitForFunction(
        () => {
          const btn = document.getElementById('webbuildQuickTestBtn');
          return btn && !btn.disabled;
        },
        { timeout: 15000 }
      );
      const wbd = await getWebbuildState(page);
      const preflightOk = wbd.runtimePreflight?.ok === true;
      if (!preflightOk) {
        const missing = wbd.runtimePreflight?.missing_files || [];
        throw new Error(`runtime preflight failed: missing=${JSON.stringify(missing)}`);
      }
      const stateText = await page.locator('#webbuildState').textContent().catch(() => '');
      await closeDrawer(page);
      return { preflightOk, stateText };
    });

    // ── 7. Click "Test This Skin" ─────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'click-test-this-skin', async () => {
      await openDrawer(page, 'test');
      const wbStateBefore = await page.locator('#webbuildState').textContent().catch(() => '');
      await page.locator('#webbuildQuickTestBtn').click();
      // Wait for webbuildState to change (button click triggers async pipeline)
      await page.waitForFunction(
        (before) => {
          const el = document.getElementById('webbuildState');
          const txt = el ? el.textContent : '';
          return txt !== before && txt.length > 0;
        },
        wbStateBefore,
        { timeout: 15000 }
      );
      const wbStateAfter = await page.locator('#webbuildState').textContent().catch(() => '');
      await closeDrawer(page);
      return { wbStateBefore, wbStateAfter };
    });

    // ── 8. webbuild iframe appears with src ───────────────────────────────────
    await recordStep(page, OUTDIR, results, 'webbuild-loading', async () => {
      await page.waitForFunction(
        () => {
          const frame = document.getElementById('webbuildFrame');
          return frame && !frame.classList.contains('hidden') && (frame.src || frame.getAttribute('src'));
        },
        { timeout: 20000 }
      );
      const frameSrc = await page.evaluate(() =>
        document.getElementById('webbuildFrame')?.getAttribute('src') || ''
      );
      const wbState = await getWebbuildState(page);
      return {
        frameSrc: frameSrc.slice(0, 80),
        webbuildLoaded: wbState.loaded,
        webbuildReady: wbState.ready,
        webbuildState: wbState.webbuildState,
      };
    });

    // ── 9. state.webbuild.ready === true (skin injection complete) ────────────
    // This requires the WASM game to download (~24MB) and initialize, then the
    // skin to be injected. First load can take 30-120s.
    await recordStep(page, OUTDIR, results, 'webbuild-ready', async () => {
      await page.waitForFunction(
        () => {
          const wbd = window.__wb_debug?.getWebbuildDebugState?.() || {};
          return !!wbd.ready;
        },
        { timeout: 240000 }  // 4 minutes for cold-cache game download + inject
      );
      const wbState = await getWebbuildState(page);
      return {
        loaded: wbState.loaded,
        ready: wbState.ready,
        webbuildState: wbState.webbuildState,
        actionInFlight: wbState.actionInFlight,
      };
    });

    // ── 10. Screenshot of preview surface after ready ─────────────────────────
    await recordStep(page, OUTDIR, results, 'preview-screenshot', async () => {
      // Give the game a moment to render after skin injection
      await page.waitForTimeout(2000);
      const wbState = await getWebbuildState(page);
      // Screenshot is captured automatically by recordStep
      return {
        ready: wbState.ready,
        webbuildState: wbState.webbuildState,
        note: 'local flat test arena only — skin rendered in termpp-web-flat, not Y9-2',
      };
    });

    overallPass = results.every((r) => r.pass);
  } catch (_err) {
    overallPass = results.every((r) => r.pass);
  } finally {
    await browser.close();
  }

  writeFileSync(`${OUTDIR}/result.json`, JSON.stringify({ overallPass, results }, null, 2));

  const ok = (n) => results.find((r) => r.name === n)?.pass ? '✅' : '❌';
  const lines = [
    '# Mobile Skin Dock — Author → Save → Export → Test Skin',
    '',
    `Result: **${overallPass ? 'PASS' : 'FAIL'}**`,
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
  lines.push('## Skin Dock pipeline proven (mobile, no Advanced)');
  lines.push('');
  lines.push(`${ok('author-cells')} Authored 3×3 glyph block (glyph 68 'D') into session`);
  lines.push(`${ok('save-session')} Saved via mobile top bar (sessionDirty → false)`);
  lines.push(`${ok('export-xp')} Exported XP via native #btnExport in Files drawer`);
  if (finalXpPath) lines.push(`   XP: \`${finalXpPath}\``);
  lines.push(`${ok('open-test-drawer')} Test drawer reachable; runtime preflight ok; button enabled`);
  lines.push(`${ok('click-test-this-skin')} "Test This Skin" clicked — webbuildState changed`);
  lines.push(`${ok('webbuild-loading')} webbuildFrame visible with src set`);
  lines.push(`${ok('webbuild-ready')} state.webbuild.ready === true (skin injection complete)`);
  lines.push(`${ok('preview-screenshot')} Screenshot captured after ready`);
  lines.push('');
  lines.push('## What this probe does NOT prove');
  lines.push('');
  lines.push('- Visual rendering of the skin in the WASM game (EMFS injection limitation:');
  lines.push('  engine caches sprites at init — post-init FS writes are not re-read)');
  lines.push('- Live Y9-2 game integration (this is local flat test arena only: termpp-web-flat)');
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
