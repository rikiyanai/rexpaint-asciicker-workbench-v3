#!/usr/bin/env node

/**
 * audit_2026_06_03_gaps.mjs — Headed CDP audit for FL gap log 2026-06-03.
 *
 * Audits four claim commits:
 *   A1: 90e374b sticky paste — pasteMode stays armed after stamp
 *   A2: af1e799 erase → MAG transparent (data and render path)
 *   A3: 2501a47 swap F/B button (#wsSwapFgBg) + X shortcut
 *   A4: 1db7052 hide frame IDs by default; #gridToggleLabels toggle
 *
 * Usage:
 *   node scripts/audit/audit_2026_06_03_gaps.mjs --xp sprites/player-0000.xp \
 *     --out-dir artifacts/2026-06-03-gap-audit --headed
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  setupVerifier, waitForSessionHydration, waitForWholeSheetMount,
  writeReport, writeJsonArtifact, screenshot,
} from '../xp_fidelity_test/verifier_lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CELL_SIZE = 12;
const MAG_RGB = [255, 0, 255];

async function getRenderedCellSize(page) {
  return page.evaluate((b) => {
    const s = window.__wholeSheetEditor?.getState?.();
    return b * Math.max(0.05, Number(s?.appliedCanvasZoom || 1));
  }, CELL_SIZE);
}

async function clickCell(page, cx, cy) {
  const sz = await getRenderedCellSize(page);
  await page.evaluate(({ tx, ty }) => {
    const s = document.getElementById('wholeSheetScroll');
    if (s) {
      s.scrollLeft = Math.max(0, tx - s.clientWidth / 2);
      s.scrollTop = Math.max(0, ty - s.clientHeight / 2);
    }
  }, { tx: cx * sz, ty: cy * sz });
  await page.waitForTimeout(120);
  const box = await page.locator('#wholeSheetCanvas').boundingBox();
  if (!box) throw new Error('wholeSheetCanvas not found');
  await page.mouse.click(box.x + cx * sz + sz / 2, box.y + cy * sz + sz / 2);
}

async function dragCells(page, x1, y1, x2, y2) {
  const sz = await getRenderedCellSize(page);
  await page.evaluate(({ tx, ty }) => {
    const s = document.getElementById('wholeSheetScroll');
    if (s) {
      s.scrollLeft = Math.max(0, tx - s.clientWidth / 2);
      s.scrollTop = Math.max(0, ty - s.clientHeight / 2);
    }
  }, { tx: x1 * sz, ty: y1 * sz });
  await page.waitForTimeout(120);
  const box = await page.locator('#wholeSheetCanvas').boundingBox();
  await page.mouse.move(box.x + x1 * sz + sz / 2, box.y + y1 * sz + sz / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + x2 * sz + sz / 2, box.y + y2 * sz + sz / 2, { steps: 5 });
  await page.mouse.up();
}

async function setDrawState(page, glyph, fgHex, bgHex) {
  await page.fill('#wsGlyphCode', String(glyph)); await page.locator('#wsGlyphCode').dispatchEvent('change');
  await page.fill('#wsFgColor', fgHex); await page.locator('#wsFgColor').dispatchEvent('input');
  await page.fill('#wsBgColor', bgHex); await page.locator('#wsBgColor').dispatchEvent('input');
  await page.waitForTimeout(80);
}

async function readLayerCell(page, layerIndex, x, y) {
  return page.evaluate(([li, cx, cy]) => {
    const st = window.__wb_debug?._state?.();
    const w = Number(st?.gridCols || 0);
    const layer = st?.layers?.[li];
    if (!w || !Array.isArray(layer)) return null;
    const c = layer[cy * w + cx]; if (!c) return null;
    return { glyph: Number(c.glyph || 0), fg: [...(c.fg || [0,0,0])], bg: [...(c.bg || [0,0,0])] };
  }, [layerIndex, x, y]);
}

async function setActiveLayer(page, li) { await page.locator('.ws-layer-row').nth(li).click(); await page.waitForTimeout(80); }

async function activate(page, sel) { await page.click(sel); await page.waitForTimeout(80); }

function rgbEq(a, b) { return a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }

async function getCompositedCellPixel(page, cellX, cellY) {
  const sz = await getRenderedCellSize(page);
  await page.evaluate(({ tx, ty }) => {
    const s = document.getElementById('wholeSheetScroll');
    if (s) { s.scrollLeft = Math.max(0, tx - s.clientWidth / 2); s.scrollTop = Math.max(0, ty - s.clientHeight / 2); }
  }, { tx: cellX * sz, ty: cellY * sz });
  await page.waitForTimeout(150);
  return page.evaluate(([cx, cy, cellSize]) => {
    const canvas = document.getElementById('wholeSheetCanvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    // Read the FONT-pixel position: canvas internal coord is cell index × CELL_SIZE pixels
    const px = cx * 12 + 6;  // CELL_SIZE base = 12, sample at center
    const py = cy * 12 + 6;
    try {
      const d = ctx.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    } catch (e) { return { error: String(e) }; }
  }, [cellX, cellY, sz]);
}

async function main() {
  const { page, browser, report, fail, outDir, cliArgs } =
    await setupVerifier('audit_2026_06_03_gaps', { requireOutDir: false });

  const xpRel = cliArgs.getArg('--xp', 'sprites/player-0000.xp');
  const absXp = path.resolve(REPO_ROOT, xpRel);
  if (!fs.existsSync(absXp)) { console.error(`XP not found: ${xpRel}`); await browser.close(); process.exit(1); }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const findings = {
    a1_sticky_paste: { name: 'A1 90e374b sticky paste', pass: false, observations: [] },
    a2_erase_mag_data: { name: 'A2 af1e799 erase to MAG (data)', pass: false, observations: [] },
    a2_erase_mag_pixel: { name: 'A2 erase to MAG (rendered pixel)', pass: false, observations: [] },
    a3_swap_fb: { name: 'A3 2501a47 swap F/B + X', pass: false, observations: [] },
    a4_hide_ids: { name: 'A4 1db7052 hide frame IDs by default', pass: false, observations: [] },
  };

  // A4: probe hide-IDs at workbench top-level
  console.log('=== A4: hide IDs by default ===');
  try {
    const idsBtn = await page.$('#gridToggleLabels');
    const idsBtnText = idsBtn ? (await idsBtn.textContent())?.trim() : null;
    const sampleLabel = await page.$('.frame-label');
    let labelDisplay = null;
    if (sampleLabel) labelDisplay = await sampleLabel.evaluate((el) => getComputedStyle(el).display);
    findings.a4_hide_ids.observations.push({ idsBtnPresent: !!idsBtn, idsBtnText, labelDisplay });
    findings.a4_hide_ids.pass = !!idsBtn && labelDisplay === 'none';
  } catch (e) { findings.a4_hide_ids.observations.push({ error: String(e) }); }
  await screenshot(page, outDir, 'a4_initial');

  // Setup: import XP and focus WS editor
  console.log('=== Setup: Import XP and focus WS editor ===');
  await page.waitForSelector('#xpImportFile', { state: 'attached', timeout: 10000 });
  await page.locator('#xpImportFile').setInputFiles(absXp);
  await page.click('#xpImportBtn');
  await waitForSessionHydration(page);
  await waitForWholeSheetMount(page);
  await page.waitForTimeout(400);
  await page.dblclick('.frame-cell[data-row="0"][data-col="0"]').catch(()=>{});
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 1400, height: 2400 });
  await page.waitForTimeout(200);
  await setActiveLayer(page, 2);

  // A3: swap F/B + X
  console.log('=== A3: swap F/B + X ===');
  try {
    await setDrawState(page, 65, '#ff0000', '#0000ff');
    const before = await page.evaluate(() => {
      const s = window.__wholeSheetEditor?.getState?.();
      return { drawFg: s?.drawFg, drawBg: s?.drawBg };
    });
    const swapBtn = await page.$('#wsSwapFgBg');
    findings.a3_swap_fb.observations.push({ swapBtnPresent: !!swapBtn });
    if (swapBtn) await swapBtn.click();
    await page.waitForTimeout(150);
    const afterClick = await page.evaluate(() => {
      const s = window.__wholeSheetEditor?.getState?.();
      return { drawFg: s?.drawFg, drawBg: s?.drawBg };
    });
    await page.keyboard.press('KeyX');
    await page.waitForTimeout(150);
    const afterKey = await page.evaluate(() => {
      const s = window.__wholeSheetEditor?.getState?.();
      return { drawFg: s?.drawFg, drawBg: s?.drawBg };
    });
    findings.a3_swap_fb.observations.push({ before, afterClick, afterKey });
    const swappedByClick = rgbEq(afterClick.drawFg, before.drawBg) && rgbEq(afterClick.drawBg, before.drawFg);
    const swappedByKey = rgbEq(afterKey.drawFg, before.drawFg) && rgbEq(afterKey.drawBg, before.drawBg);
    findings.a3_swap_fb.pass = !!swapBtn && swappedByClick && swappedByKey;
  } catch (e) { findings.a3_swap_fb.observations.push({ error: String(e) }); }
  await screenshot(page, outDir, 'a3_swap_fb');

  // A2: erase to MAG — data AND rendered pixel
  console.log('=== A2: erase to MAG (data + pixel) ===');
  try {
    await setActiveLayer(page, 2);
    await activate(page, '#wsToolCell');
    await setDrawState(page, 219, '#ffff00', '#222222');
    await clickCell(page, 5, 5); await page.waitForTimeout(180);
    const painted = await readLayerCell(page, 2, 5, 5);
    findings.a2_erase_mag_data.observations.push({ painted });

    await activate(page, '#wsToolErase');
    await clickCell(page, 5, 5); await page.waitForTimeout(220);
    const afterErase = await readLayerCell(page, 2, 5, 5);
    findings.a2_erase_mag_data.observations.push({ afterErase });

    // No-op test: second erase on already-MAG
    await clickCell(page, 5, 5); await page.waitForTimeout(180);
    const afterEraseTwice = await readLayerCell(page, 2, 5, 5);
    findings.a2_erase_mag_data.observations.push({ afterEraseTwice });

    findings.a2_erase_mag_data.pass =
      afterErase && rgbEq(afterErase.bg, MAG_RGB) && afterErase.glyph === 0 &&
      afterEraseTwice && rgbEq(afterEraseTwice.bg, MAG_RGB);

    // Pixel probe: composited render at (5,5) center should be MAG
    const pixel = await getCompositedCellPixel(page, 5, 5);
    findings.a2_erase_mag_pixel.observations.push({ pixel });
    findings.a2_erase_mag_pixel.pass = Array.isArray(pixel) &&
      pixel[0] === 255 && pixel[1] === 0 && pixel[2] === 255;
  } catch (e) {
    findings.a2_erase_mag_data.observations.push({ error: String(e) });
    findings.a2_erase_mag_pixel.observations.push({ error: String(e) });
  }
  await screenshot(page, outDir, 'a2_erase_mag');

  // A1: sticky paste — copy + paste twice without re-arming
  console.log('=== A1: sticky paste ===');
  try {
    await setActiveLayer(page, 2);
    await activate(page, '#wsToolCell');
    await setDrawState(page, 65, '#00ffff', '#222200');
    await clickCell(page, 10, 10); await page.waitForTimeout(120);
    await clickCell(page, 11, 10); await page.waitForTimeout(120);

    await activate(page, '#wsToolSelect');
    await dragCells(page, 10, 10, 11, 10);
    await page.waitForTimeout(200);
    await page.click('#wsCopySelection'); await page.waitForTimeout(180);

    await page.click('#wsPasteSelection'); await page.waitForTimeout(150);
    const armed1 = await page.evaluate(() => {
      const b = document.getElementById('wsPasteSelection');
      return { armed: b?.classList.contains('ws-tool-active'), pasteMode: window.__wholeSheetEditor?.getState?.()?.pasteMode };
    });
    findings.a1_sticky_paste.observations.push({ afterEnterPaste: armed1 });

    await clickCell(page, 20, 20); await page.waitForTimeout(250);
    const armed2 = await page.evaluate(() => {
      const b = document.getElementById('wsPasteSelection');
      return { armed: b?.classList.contains('ws-tool-active'), pasteMode: window.__wholeSheetEditor?.getState?.()?.pasteMode };
    });
    findings.a1_sticky_paste.observations.push({ afterFirstPaste: armed2 });

    await clickCell(page, 30, 25); await page.waitForTimeout(250);
    const at20 = await readLayerCell(page, 2, 20, 20);
    const at30 = await readLayerCell(page, 2, 30, 25);
    findings.a1_sticky_paste.observations.push({ pastedAt20_20: at20, pastedAt30_25: at30 });

    const firstStuck = at20 && at20.glyph === 65;
    const secondStuck = at30 && at30.glyph === 65;
    const stayedArmed = armed2 && armed2.armed && armed2.pasteMode === true;
    findings.a1_sticky_paste.pass = !!(firstStuck && secondStuck && stayedArmed);
  } catch (e) { findings.a1_sticky_paste.observations.push({ error: String(e) }); }
  await screenshot(page, outDir, 'a1_sticky_paste');

  writeJsonArtifact(outDir, 'findings.json', findings);
  report.findings = findings;
  report.overall_pass = Object.values(findings).every((f) => f.pass);
  writeReport(outDir, 'report.json', report);

  console.log('\n=== Summary ===');
  for (const v of Object.values(findings)) {
    console.log(`  ${v.pass ? '✅' : '❌'} ${v.name}`);
  }
  await browser.close();
  process.exit(report.overall_pass ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });
