#!/usr/bin/env node
/**
 * audit_a1_lock_check.mjs — verify hypothesis that paste silently no-ops
 * when ANY visible layer is locked (resolveWritableClipboardLayers → null).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import {
  setupVerifier, waitForSessionHydration, waitForWholeSheetMount,
  writeJsonArtifact,
} from '../xp_fidelity_test/verifier_lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

async function main() {
  const { page, browser, outDir, cliArgs } = await setupVerifier('audit_a1_lock_check', { requireOutDir: false });
  const absXp = path.resolve(REPO_ROOT, cliArgs.getArg('--xp', 'sprites/player-0000.xp'));
  await page.waitForSelector('#xpImportFile', { state: 'attached', timeout: 10000 });
  await page.locator('#xpImportFile').setInputFiles(absXp);
  await page.click('#xpImportBtn');
  await waitForSessionHydration(page);
  await waitForWholeSheetMount(page);
  await page.waitForTimeout(400);
  await page.dblclick('.frame-cell[data-row="0"][data-col="0"]').catch(()=>{});
  await page.waitForTimeout(400);

  // Inspect layer state after import
  const layerStateAfterImport = await page.evaluate(() => {
    const ws = window.__wholeSheetEditor;
    const info = ws?.getLayerInfo?.();
    return info;
  });

  // Now visualize layer rows in the DOM
  const layerRows = await page.evaluate(() => {
    const rows = document.querySelectorAll('.ws-layer-row');
    return Array.from(rows).map((r, i) => {
      const visBtn = r.querySelector('.ws-layer-vis-btn');
      const lockBtn = r.querySelector('.ws-layer-lock-btn, [class*="lock"]');
      return {
        i, html: r.outerHTML.slice(0, 200),
        visText: visBtn?.textContent?.trim(), visClasses: visBtn?.className,
        lockText: lockBtn?.textContent?.trim(), lockClasses: lockBtn?.className,
      };
    });
  });

  writeJsonArtifact(outDir, 'a1_lock_check.json', { layerStateAfterImport, layerRows });
  console.log(JSON.stringify({ layerStateAfterImport, layerRows }, null, 2));
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
