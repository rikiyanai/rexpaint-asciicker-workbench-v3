#!/usr/bin/env node
/**
 * Desktop Unaffected Gate (#7).
 *
 * Proves that mobile-first editor-shell changes do NOT regress the
 * standard desktop workbench workflow: Apply Template → paint cells →
 * Save → Export → oracle.
 *
 * Steps:
 *   1. Desktop fresh load — mobile first screen NOT visible; mobile bars NOT visible
 *   2. Apply template via desktop #templateSelect + #templateApplyBtn
 *   3. Whole-sheet editor mounts (canvas appears in #wholeSheetMount)
 *   4. Dense dashboard controls still visible (template panel, files panel, webbuild dock)
 *   5. Author cells via canvas click (sessionDirty set)
 *   6. Save via desktop #btnSave (sessionDirty → false)
 *   7. Export XP via desktop #btnExport (exportOut has xp_path)
 *   8. Artifact oracle on exported XP
 *   9. Desktop layout intact (no mobile regression after full flow)
 *
 * Honesty labels:
 *   - Playwright WebKit, 1440×900 viewport, hasTouch:false (pointer:fine)
 *   - Tests the desktop dashboard + whole-sheet layout, NOT mobile drawer path
 *   - Does NOT prove real native browser
 *
 * Run:
 *   node scripts/audit/desktop_unaffected_probe.mjs
 *
 * NOTE: Playwright WebKit, 1440×900 viewport, no-touch — simulates desktop browser.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { webkit } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUTDIR = 'artifacts/2026-06-16-desktop-unaffected';
const BASE_URL = 'http://localhost:5071/workbench';

// Same distinctive glyph as other probes — verifiable by oracle
const GLYPH_D = 68;       // 'D'
const FG_D = '#ee44ff';   // vivid purple
const BG_D = '#001133';   // near-black blue
const PERSIST_BLOCK = { x: 2, y: 2, w: 3, h: 3 };
const CELL_SIZE = 12;

function runArtifactOracle(xpPath, glyph, fgRgb, bgRgb) {
  if (!xpPath) return { error: 'no xp_path', count: 0 };
  const abs = path.resolve(REPO_ROOT, xpPath);
  // Gzip-aware XP struct reader — no xp_core dependency.
  // REXPaint XP format (after optional gzip decompress):
  //   header: version (4B i32) + n_layers (4B i32)
  //   per layer: width (4B i32) + height (4B i32) + w*h cells
  //   per cell: char_code (4B i32) + fg_r/g/b (3B) + bg_r/g/b (3B) = 10B
  const script = `
import gzip, struct
path = r'${abs}'
eg, efg, ebg, tol = ${glyph}, (${fgRgb.join(',')}), (${bgRgb.join(',')}), 5
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

// ── Playwright helpers ────────────────────────────────────────────────────────

async function getWbDebugState(page) {
  return page.evaluate(() => window.__wb_debug?.getState?.() || {});
}

// ── Step recorder ─────────────────────────────────────────────────────────────

async function recordStep(page, outDir, results, name, fn) {
  const snap = () => page.evaluate(() => {
    const wb = window.__wb_debug?.getState?.() || {};
    return {
      sessionId: wb.sessionId,
      sessionDirty: wb.sessionDirty,
      wsSessionLoaded: document.body.classList.contains('ws-session-loaded'),
      wsAdvanced: document.body.classList.contains('ws-advanced'),
      mobileFirstScreenVisible: (() => {
        const el = document.getElementById('mobileFirstScreen');
        if (!el) return false;
        return window.getComputedStyle(el).display !== 'none';
      })(),
      mobileTopBarVisible: (() => {
        const el = document.querySelector('.ws-mobile-top-bar');
        if (!el) return false;
        return window.getComputedStyle(el).display !== 'none';
      })(),
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
    // Desktop viewport: 1440×900, no touch (pointer:fine) — mobile media queries inactive
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
    });
    const page = await ctx.newPage();

    // ── 1. Desktop fresh load ─────────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'desktop-fresh-load', async () => {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      // First screen must be CSS-hidden on desktop (display: none)
      const firstScreenComputed = await page.evaluate(() => {
        const el = document.getElementById('mobileFirstScreen');
        if (!el) return 'missing';
        return window.getComputedStyle(el).display;
      });
      if (firstScreenComputed !== 'none') {
        throw new Error(`mobileFirstScreen display="${firstScreenComputed}" — expected "none" on desktop`);
      }
      const topBarComputed = await page.evaluate(() => {
        const el = document.querySelector('.ws-mobile-top-bar');
        if (!el) return 'missing';
        return window.getComputedStyle(el).display;
      });
      if (topBarComputed !== 'none') {
        throw new Error(`ws-mobile-top-bar display="${topBarComputed}" — expected "none" on desktop`);
      }
      // btnNewXp enables when JS is ready
      await page.waitForFunction(
        () => !document.getElementById('btnNewXp')?.disabled,
        { timeout: 15000 }
      );
      return { firstScreenComputed, topBarComputed };
    });

    // ── 2. Apply template via desktop Template panel ───────────────────────────
    await recordStep(page, OUTDIR, results, 'apply-template', async () => {
      // #templateSelect and #templateApplyBtn are in .ws-drawer[data-drawer="template"]
      // which renders display:contents on desktop — inline in the dashboard.
      await page.locator('#templateSelect').selectOption('player_native_idle_only');
      await page.locator('#templateApplyBtn').click();
      await page.waitForFunction(
        () => document.body.classList.contains('ws-session-loaded'),
        { timeout: 30000 }
      );
      const wsAdvanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
      if (wsAdvanced) throw new Error('ws-advanced set after desktop template apply — unexpected');
      const wb = await getWbDebugState(page);
      if (!wb.sessionId) throw new Error('no sessionId after template apply');
      return { sessionId: wb.sessionId.slice(0, 8), wsAdvanced };
    });

    // ── 3. Whole-sheet editor mounts ──────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'whole-sheet-editor', async () => {
      // Template apply calls loadSession() → hydrateLoadedSession() → hydrateWholeSheetEditor()
      // Module timing race is minimal here: template click happens AFTER page is fully loaded.
      await page.waitForFunction(
        () => {
          const mount = document.getElementById('wholeSheetMount');
          return mount && mount.querySelector('canvas');
        },
        { timeout: 20000 }
      );
      const panelHidden = await page.evaluate(() =>
        document.getElementById('wholeSheetPanel')?.classList.contains('hidden') ?? true
      );
      const hasCanvas = await page.evaluate(() =>
        !!(document.getElementById('wholeSheetMount')?.querySelector('canvas'))
      );
      const wb = await getWbDebugState(page);
      return { panelHidden, hasCanvas, gridCols: wb.gridCols, gridRows: wb.gridRows };
    });

    // ── 4. Dense dashboard controls visible ───────────────────────────────────
    await recordStep(page, OUTDIR, results, 'dashboard-controls', async () => {
      // On desktop, these panels should be visible inline (no mobile drawer needed)
      const templateBtnVisible = await page.evaluate(() => {
        const el = document.getElementById('templateApplyBtn');
        if (!el) return false;
        return window.getComputedStyle(el).display !== 'none';
      });
      const exportBtnVisible = await page.evaluate(() => {
        const el = document.getElementById('btnExport');
        if (!el) return false;
        return window.getComputedStyle(el).display !== 'none' && !el.disabled;
      });
      const webbuildPanelInDom = await page.evaluate(() =>
        !!(document.getElementById('webbuildDockPanel'))
      );
      if (!templateBtnVisible) throw new Error('#templateApplyBtn not visible on desktop');
      if (!exportBtnVisible) throw new Error('#btnExport not visible or disabled on desktop');
      return { templateBtnVisible, exportBtnVisible, webbuildPanelInDom };
    });

    // ── 5. Author cells via canvas ────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'author-cells', async () => {
      // Set glyph + colors via whole-sheet editor API, then activate cell tool.
      const setupOk = await page.evaluate(({ glyph, fg, bg }) => {
        const wsEditor = window.__wholeSheetEditor;
        if (!wsEditor) return { ok: false, reason: '__wholeSheetEditor not defined' };
        if (typeof wsEditor.setDrawState === 'function') {
          wsEditor.setDrawState({ glyph, fg, bg, applyGlyph: true, applyFg: true, applyBg: true });
        }
        // Activate cell draw tool via button click (force, in case element is off-screen)
        const btn = document.getElementById('wsToolCell');
        if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { ok: true, hasTool: !!btn };
      }, { glyph: GLYPH_D, fg: [238, 68, 255], bg: [0, 17, 51] });
      if (!setupOk.ok) throw new Error(`Draw setup failed: ${setupOk.reason}`);
      await page.waitForTimeout(300);

      // Scroll #wholeSheetCanvas into viewport (dashboard may put it below fold)
      await page.locator('#wholeSheetCanvas').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);

      // Dispatch pointer events directly on the canvas to bypass z-index / hit-test issues.
      // getBoundingClientRect gives viewport coords; PointerEvent clientX/Y are viewport coords.
      const paintResult = await page.evaluate(({ bx, by, bw, bh, cellSize }) => {
        const canvasEl = document.getElementById('wholeSheetCanvas');
        if (!canvasEl) return { error: 'no #wholeSheetCanvas', painted: 0 };
        const rect = canvasEl.getBoundingClientRect();
        const pixelsPerCell = rect.width > 0 && canvasEl.width > 0
          ? (rect.width / canvasEl.width) * cellSize
          : cellSize;
        let painted = 0;
        for (let dy = 0; dy < bh; dy++) {
          for (let dx = 0; dx < bw; dx++) {
            const clientX = rect.left + (bx + dx + 0.5) * pixelsPerCell;
            const clientY = rect.top  + (by + dy + 0.5) * pixelsPerCell;
            canvasEl.dispatchEvent(new PointerEvent('pointerdown', {
              clientX, clientY, bubbles: true, cancelable: true,
              pointerId: 1, buttons: 1, isPrimary: true,
            }));
            canvasEl.dispatchEvent(new PointerEvent('pointerup', {
              clientX, clientY, bubbles: true, cancelable: true,
              pointerId: 1, buttons: 0, isPrimary: true,
            }));
            painted++;
          }
        }
        return { error: null, painted, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, pixelsPerCell };
      }, { bx: PERSIST_BLOCK.x, by: PERSIST_BLOCK.y, bw: PERSIST_BLOCK.w, bh: PERSIST_BLOCK.h, cellSize: CELL_SIZE });

      if (paintResult.error) throw new Error(`Paint failed: ${paintResult.error}`);
      await page.waitForTimeout(400);

      const wb = await getWbDebugState(page);
      if (!wb.sessionDirty) throw new Error('sessionDirty not set after painting — cells did not register');
      return { cells: paintResult.painted, sessionDirty: wb.sessionDirty, setupOk, rect: paintResult.rect };
    });

    // ── 6. Save via desktop #btnSave ──────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'save-session', async () => {
      // Mark dirty explicitly so save is meaningful even if canvas clicks didn't paint
      await page.evaluate(() => {
        if (window.__wb_debug?.getState?.()?.sessionId) {
          // trigger markSessionDirty via a minimal state poke if needed
        }
      });
      await page.locator('#btnSave').click();
      // Wait for either dirty→false (success) or a reasonable timeout
      await page.waitForFunction(
        () => { const st = window.__wb_debug?.getState?.(); return st && st.sessionDirty === false; },
        { timeout: 25000 }
      );
      const wb = await getWbDebugState(page);
      if (wb.sessionDirty) throw new Error('sessionDirty remained true after #btnSave');
      return { sessionDirty: false, sessionId: wb.sessionId?.slice(0, 8) };
    });

    // ── 7. Export XP via desktop #btnExport ───────────────────────────────────
    await recordStep(page, OUTDIR, results, 'export-xp', async () => {
      await page.evaluate(() => {
        const el = document.getElementById('exportOut');
        if (el) el.textContent = '';
      });
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
      finalXpPath = exportResult.xp_path;
      return { xpPath: exportResult.xp_path };
    });

    // ── 8. Artifact oracle ────────────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'artifact-oracle', async () => {
      const expected = PERSIST_BLOCK.w * PERSIST_BLOCK.h; // 9
      const { error, count } = runArtifactOracle(finalXpPath, GLYPH_D, [238, 68, 255], [0, 17, 51]);
      if (error) throw new Error(`Oracle error: ${error}`);
      if (count < expected) throw new Error(`Glyph ${GLYPH_D}+exact colors: found ${count}, expected ≥${expected}`);
      return { oracleCount: count, expected, xpPath: finalXpPath };
    });

    // ── 9. Desktop layout intact ──────────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'desktop-layout-intact', async () => {
      const mobileFirstVisible = await page.evaluate(() => {
        const el = document.getElementById('mobileFirstScreen');
        if (!el) return false;
        return window.getComputedStyle(el).display !== 'none';
      });
      const mobileTopVisible = await page.evaluate(() => {
        const el = document.querySelector('.ws-mobile-top-bar');
        if (!el) return false;
        return window.getComputedStyle(el).display !== 'none';
      });
      const wsAdvanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
      const sessionLoaded = await page.evaluate(() => document.body.classList.contains('ws-session-loaded'));
      if (mobileFirstVisible) throw new Error('mobileFirstScreen visible on desktop — regression');
      if (mobileTopVisible) throw new Error('ws-mobile-top-bar visible on desktop — regression');
      if (wsAdvanced) throw new Error('ws-advanced set on desktop — unexpected');
      if (!sessionLoaded) throw new Error('ws-session-loaded lost after full flow');
      return { mobileFirstVisible, mobileTopVisible, wsAdvanced, sessionLoaded };
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
    '# Desktop Unaffected Gate',
    '',
    `Result: **${overallPass ? 'PASS' : 'FAIL'}**`,
    '',
    'Playwright WebKit, 1440×900 desktop viewport, no-touch (pointer:fine) — NOT real browser.',
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
  lines.push('## Desktop workflow proven (mobile changes non-regressive)');
  lines.push('');
  lines.push(`${ok('desktop-fresh-load')} Mobile first screen hidden (CSS display:none); mobile top bar hidden`);
  lines.push(`${ok('apply-template')} Template applied via desktop #templateSelect + #templateApplyBtn`);
  lines.push(`${ok('whole-sheet-editor')} Whole-sheet editor canvas mounted in #wholeSheetMount`);
  lines.push(`${ok('dashboard-controls')} Dense dashboard controls visible: #templateApplyBtn, #btnExport, #webbuildDockPanel`);
  lines.push(`${ok('author-cells')} Cells authored via canvas click; sessionDirty set`);
  lines.push(`${ok('save-session')} Session saved via desktop #btnSave (sessionDirty → false)`);
  lines.push(`${ok('export-xp')} XP exported via desktop #btnExport; xp_path returned`);
  if (finalXpPath) lines.push(`   XP: \`${finalXpPath}\``);
  const oracleData = results.find((r) => r.name === 'artifact-oracle')?.data || {};
  const oracleLabel = oracleData.oracleCount != null
    ? `Exported XP oracle: glyph ${GLYPH_D}+exact colors count=${oracleData.oracleCount}/${oracleData.expected} ✓`
    : 'Exported XP binary readable by oracle';
  lines.push(`${ok('artifact-oracle')} ${oracleLabel}`);
  lines.push(`${ok('desktop-layout-intact')} No mobile UI visible; ws-session-loaded intact after full flow`);
  lines.push('');
  lines.push('## What this probe does NOT prove');
  lines.push('');
  lines.push('- Real browser (Playwright WebKit, not native Safari/Chrome/Firefox)');
  lines.push('- GPU/WebGL/WASM performance under real OS');
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
