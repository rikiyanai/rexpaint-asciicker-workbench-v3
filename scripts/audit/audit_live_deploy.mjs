#!/usr/bin/env node
/**
 * audit_live_deploy.mjs — E2E sanity check against the live production
 * URL after deploy. Confirms the FL-2026-06-03 fixes are actually shipped.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { launchChromium } from '../ui_tests/core/playwright_loader.mjs';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const URLS = [
  'https://rikiworld.com/xpedit/workbench',
  'https://asciicker-xpedit-6abo3pnlfa-uc.a.run.app/xpedit/workbench',
];

async function main() {
  const browser = await launchChromium({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const findings = {};
  for (const url of URLS) {
    const label = url.replace(/^https?:\/\//, '');
    console.log(`=== ${label} ===`);
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const status = resp ? resp.status() : 'no-response';
      await page.waitForTimeout(2500);

      const probe = await page.evaluate(() => {
        // Did the new transparent-key row ship?
        const transparentRow = !!document.querySelector('.ws-transparent-row');
        const transparentBtns = document.querySelectorAll('.ws-transparent-btn');
        const transparentLabels = Array.from(transparentBtns).map((b) => b.textContent.trim());
        // Does the new ws-paste-armed CSS rule exist (FL-2026-06-03 paste-armed affordance)?
        let pasteArmedCss = false;
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules || []) {
              if (rule.selectorText && rule.selectorText.includes('ws-paste-armed')) {
                pasteArmedCss = true; break;
              }
            }
            if (pasteArmedCss) break;
          } catch (e) {}
        }
        // Does Upload PNG button exist?
        const uploadBtn = !!document.getElementById('wbUpload');
        // Does the IDs toggle exist?
        const idsBtn = !!document.getElementById('gridToggleLabels');
        return { transparentRow, transparentLabels, pasteArmedCss, uploadBtn, idsBtn };
      });
      findings[label] = { status, probe };
      console.log(JSON.stringify(probe, null, 2));
    } catch (e) {
      findings[label] = { error: String(e) };
      console.error(`  ERROR: ${e}`);
    }
  }
  const outDir = path.resolve(REPO_ROOT, 'artifacts/2026-06-03-gap-audit');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'live_deploy.json'), JSON.stringify(findings, null, 2));

  const allPass = Object.values(findings).every(
    (f) => !f.error && f.status === 200 && f.probe?.transparentRow && f.probe?.pasteArmedCss && f.probe?.uploadBtn && f.probe?.idsBtn
  );
  console.log('\nVERDICT:', allPass ? 'PASS — all FL-2026-06-03 fixes live' : 'FAIL');
  await browser.close();
  process.exit(allPass ? 0 : 2);
}
main().catch(e => { console.error(e); process.exit(1); });
