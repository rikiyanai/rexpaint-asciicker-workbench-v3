#!/usr/bin/env node
/**
 * audit_2026_06_03_post_codex.mjs — boots the Flask workbench locally and
 * probes all FL-2026-06-03 post-codex-review fixes via DOM + canvas pixel.
 *
 *   A2-revert : sample pixel at (0,0) — must be black, not magenta.
 *   A1-toast  : .ws-status-toast CSS rule exists in any stylesheet.
 *   B3        : right-click FG opens .ws-recents-ctx with at least one swatch
 *               after at least one fg push.
 *   B4        : .ws-recents-row exists; pushing a fg color renders ≥ 1 swatch.
 *   B5        : .ws-fbg-combo-row has ≥ 8 .ws-fbg-combo-btn buttons.
 *   B6        : .ws-paste-ghost CSS rule exists (full DOM toggle needs
 *               internal state we don't expose).
 *
 * Headed only (project rule). Exits 0 on full pass, 2 on any miss.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { launchChromium } from '../ui_tests/core/playwright_loader.mjs';
import { ensureFlaskWorkbenchServer, stopServer } from '../ui_tests/core/server_control.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

async function main() {
  const serverHandle = await ensureFlaskWorkbenchServer({
    baseUrl: 'http://127.0.0.1:5071/workbench',
    cwd: REPO_ROOT,
    timeoutMs: 30000,
  });
  const url = serverHandle.url;
  console.log(`[audit] workbench at ${url}`);

  const browser = await launchChromium({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const findings = {};

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#wsPaletteCanvas', { timeout: 15000 });
    await page.waitForTimeout(1200);

    // --- A2-revert: sample pixel at (1,1) of the main canvas. Virgin grid
    // (nothing painted) must be BLACK now that we reverted the MAG fallback.
    findings.a2_revert = await page.evaluate(() => {
      const canvasEl = document.querySelector('#wholeSheetCanvas, .ws-canvas-area canvas');
      if (!canvasEl) return { ok: false, reason: 'no canvas el' };
      const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { ok: false, reason: 'no 2d ctx' };
      // Sample 5 different scattered pixels to avoid grid-line bias.
      const samples = [[2,2],[40,40],[80,80],[120,120],[20,150]];
      const pixels = samples.map(([x,y]) => Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3));
      const anyMag = pixels.some((p) => p[0] === 255 && p[1] === 0 && p[2] === 255);
      const allBlackish = pixels.every((p) => p[0] < 50 && p[1] < 50 && p[2] < 50);
      return { ok: !anyMag && allBlackish, samples, pixels };
    });

    // --- B5: FBG combo subpalette row + buttons ---
    findings.b5_fbg = await page.evaluate(() => {
      const row = document.querySelector('.ws-fbg-combo-row');
      const btns = document.querySelectorAll('.ws-fbg-combo-btn');
      return { ok: !!row && btns.length >= 8, rowExists: !!row, count: btns.length };
    });

    // --- B4: recents row exists; pushing a fg color via fg input lands a swatch ---
    findings.b4_recents = await page.evaluate(() => {
      const row = document.getElementById('wsRecentsRow');
      if (!row) return { ok: false, reason: 'wsRecentsRow missing' };
      const fgInput = document.getElementById('wsFgColor');
      if (!fgInput) return { ok: false, reason: 'wsFgColor missing' };
      fgInput.value = '#abcdef';
      fgInput.dispatchEvent(new Event('input', { bubbles: true }));
      const bgInput = document.getElementById('wsBgColor');
      bgInput.value = '#123456';
      bgInput.dispatchEvent(new Event('input', { bubbles: true }));
      const swatches = row.querySelectorAll('.ws-recent-swatch');
      return { ok: swatches.length >= 2, swatchCount: swatches.length };
    });

    // --- B3: contextmenu on fg input opens .ws-recents-ctx ---
    findings.b3_ctx = await page.evaluate(() => {
      const fgInput = document.getElementById('wsFgColor');
      if (!fgInput) return { ok: false, reason: 'wsFgColor missing' };
      const rect = fgInput.getBoundingClientRect();
      const ev = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window,
        clientX: rect.left + 4, clientY: rect.top + 4, button: 2,
      });
      fgInput.dispatchEvent(ev);
      const menu = document.getElementById('wsRecentsContextMenu');
      const swatches = menu ? menu.querySelectorAll('.ws-recents-ctx-swatch') : [];
      const ok = !!menu && swatches.length > 0;
      if (menu) menu.remove();
      return { ok, swatchCount: swatches.length };
    });

    // --- A1-toast: .ws-status-toast CSS rule must exist (proves shipped). ---
    findings.a1_toast = await page.evaluate(() => {
      let hasCss = false;
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules || []) {
            if (rule.selectorText && rule.selectorText.includes('ws-status-toast')) {
              hasCss = true; break;
            }
          }
          if (hasCss) break;
        } catch (_) {}
      }
      return { ok: hasCss, hasCss };
    });

    // --- B6: .ws-paste-ghost CSS rule shipped. ---
    findings.b6_ghost = await page.evaluate(() => {
      let hasCss = false;
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules || []) {
            if (rule.selectorText && rule.selectorText.includes('ws-paste-ghost')) {
              hasCss = true; break;
            }
          }
          if (hasCss) break;
        } catch (_) {}
      }
      return { ok: hasCss, hasCss };
    });

  } finally {
    await browser.close();
    if (serverHandle.started) await stopServer(serverHandle);
  }

  const outDir = path.resolve(REPO_ROOT, 'artifacts/2026-06-03-post-codex-audit');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'findings.json'), JSON.stringify(findings, null, 2));
  console.log(JSON.stringify(findings, null, 2));

  const allOk = Object.values(findings).every((f) => f && f.ok);
  console.log(`\nVERDICT: ${allOk ? 'PASS' : 'FAIL'} — see ${path.join(outDir, 'findings.json')}`);
  process.exit(allOk ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });
