#!/usr/bin/env node
/**
 * audit_b2_transparent_keys.mjs — verify the dedicated MAG/YEL transparent
 * buttons exist, render with the right colors, and set drawFg/drawBg.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import {
  setupVerifier, waitForSessionHydration, waitForWholeSheetMount,
  writeJsonArtifact, screenshot,
} from '../xp_fidelity_test/verifier_lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

async function main() {
  const { page, browser, outDir, cliArgs } = await setupVerifier('audit_b2_keys', { requireOutDir: false });
  const absXp = path.resolve(REPO_ROOT, cliArgs.getArg('--xp', 'sprites/player-0000.xp'));
  await page.waitForSelector('#xpImportFile', { state: 'attached', timeout: 10000 });
  await page.locator('#xpImportFile').setInputFiles(absXp);
  await page.click('#xpImportBtn');
  await waitForSessionHydration(page);
  await waitForWholeSheetMount(page);
  await page.waitForTimeout(400);
  await page.dblclick('.frame-cell[data-row="0"][data-col="0"]').catch(()=>{});
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 1400, height: 2400 });

  const found = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.ws-transparent-btn'));
    return btns.map((b) => ({
      text: b.textContent,
      title: b.title,
      bg: getComputedStyle(b).backgroundColor,
    }));
  });

  // LMB on MAG button → FG should be (255,0,255)
  await page.locator('.ws-transparent-btn').nth(0).click();
  await page.waitForTimeout(150);
  const afterMagClick = await page.evaluate(() => {
    const s = window.__wholeSheetEditor?.getState?.();
    return { drawFg: s?.drawFg, drawBg: s?.drawBg };
  });

  // RMB on YEL button → BG should be (255,255,0)
  await page.locator('.ws-transparent-btn').nth(1).click({ button: 'right' });
  await page.waitForTimeout(150);
  const afterYelRight = await page.evaluate(() => {
    const s = window.__wholeSheetEditor?.getState?.();
    return { drawFg: s?.drawFg, drawBg: s?.drawBg };
  });

  const result = {
    btns: found,
    afterMagClick, afterYelRight,
    pass:
      found.length === 2 &&
      afterMagClick.drawFg?.[0] === 255 && afterMagClick.drawFg?.[1] === 0 && afterMagClick.drawFg?.[2] === 255 &&
      afterYelRight.drawBg?.[0] === 255 && afterYelRight.drawBg?.[1] === 255 && afterYelRight.drawBg?.[2] === 0,
  };
  writeJsonArtifact(outDir, 'b2_transparent_keys.json', result);
  await screenshot(page, outDir, 'b2_buttons');
  console.log(JSON.stringify(result, null, 2));
  console.log('VERDICT:', result.pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(result.pass ? 0 : 2);
}
main().catch(e => { console.error(e); process.exit(1); });
