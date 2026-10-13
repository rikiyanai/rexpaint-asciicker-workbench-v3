#!/usr/bin/env node
/**
 * UQ-013 / FL-MOB-01 — Export/Share probe (#9).
 *
 * Proves that the mobile "Share" button path works end-to-end:
 *   [data-action="share-file"] → shareXpFileLocal() → _getExportedXpBytes()
 *   (save → /api/workbench/export-xp → /api/workbench/download-xp binary)
 *   → shareXpFile() → navigator.canShare fails in WebKit → _downloadBlob()
 *   → <a download> click → Playwright download event → file bytes
 *
 * Covers, in order:
 *   1. Mobile first screen (fresh load)
 *   2. Apply template — editor-first shell, ws-advanced absent
 *   3. Share via mobile top bar — [data-action="share-file"] → download event
 *   4. Verify downloaded bytes: non-empty + valid XP binary header
 *   5. Artifact oracle — non-zero glyph cells in downloaded XP binary
 *
 * Output:
 *   artifacts/2026-06-16-share-xp/recipe.json
 *   artifacts/2026-06-16-share-xp/result.json
 *   artifacts/2026-06-16-share-xp/REPORT.md
 *   artifacts/2026-06-16-share-xp/<N>-<name>.png
 *
 * Run:
 *   node scripts/audit/share_xp_probe.mjs
 *
 * NOTE: Playwright WebKit engine-family emulation under iPad Pro 11 landscape
 * profile — NOT Apple's shipping iOS Safari. Web Share API (navigator.share)
 * with file objects is not automatable; this probe proves the download fallback.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUTDIR = 'artifacts/2026-06-16-share-xp';
const BASE_URL = 'http://localhost:5071/workbench';

// ── Playwright helpers ────────────────────────────────────────────────────────

async function getWbDebugState(page) {
  return page.evaluate(() => window.__wb_debug?.getState?.() || {});
}

// Open the named drawer (closes any currently open drawer first).
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

// Close all drawers.
async function closeDrawer(page) {
  await page.evaluate(() => window.toggleDrawer && window.toggleDrawer()).catch(() => {});
  await page.waitForFunction(
    () => !document.querySelector('.ws-drawer.open') && !document.querySelector('.ws-drawer-backdrop.visible'),
    { timeout: 3000 }
  ).catch(() => {});
}

// Run artifact oracle: count cells with char_code > 32 across all XP layers.
// Gzip-aware struct reader — no xp_core dependency.
function runArtifactOracle(xpPath) {
  if (!xpPath) return { error: 'no xp_path provided', totalNonZero: 0 };
  const abs = path.isAbsolute(xpPath) ? xpPath : path.resolve(REPO_ROOT, xpPath);
  const script = `
import gzip, struct
path = r'${abs}'
with open(path,'rb') as f: raw=f.read()
data = gzip.decompress(raw) if raw[:2]==b'\\x1f\\x8b' else raw
n_layers = struct.unpack_from('<i',data,4)[0]
off = 8; count = 0
for _ in range(n_layers):
    w=struct.unpack_from('<i',data,off)[0]; h=struct.unpack_from('<i',data,off+4)[0]; off+=8
    for _ in range(w*h):
        code=struct.unpack_from('<i',data,off)[0]
        if code > 32: count+=1
        off+=10
print(count)
`;
  try {
    const raw = execFileSync('python3', ['-c', script], {
      cwd: REPO_ROOT, encoding: 'utf8', timeout: 20000,
    });
    const totalNonZero = parseInt(raw.trim(), 10);
    return {
      error: isNaN(totalNonZero) ? 'parse error: ' + raw.trim() : null,
      totalNonZero: isNaN(totalNonZero) ? 0 : totalNonZero,
    };
  } catch (e) {
    return { error: String(e.message || e), totalNonZero: 0 };
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
    mode: 'share_xp',
    generated_at: new Date().toISOString(),
    template: 'player_native_idle_only',
    note: 'Proves mobile Share button download fallback (navigator.canShare not available for files in WebKit)',
  };
  writeFileSync(`${OUTDIR}/recipe.json`, JSON.stringify(recipe, null, 2));

  const browser = await webkit.launch({ headless: false });
  const results  = [];
  let overallPass = false;
  let downloadedXpPath = '';

  try {
    const ctx  = await browser.newContext({ ...devices['iPad Pro 11 landscape'], acceptDownloads: true });

    // Force _downloadBlob() fallback: navigator.canShare returns false for file objects.
    // navigator.share() is NOT automatable in Playwright WebKit (shows native share sheet
    // that Playwright cannot interact with). This probe proves the download fallback path.
    // The native Web Share API path is only testable on a physical iPad.
    await ctx.addInitScript(() => {
      try {
        Object.defineProperty(window.navigator, 'canShare', {
          configurable: true,
          writable: true,
          value: function (data) {
            if (data && data.files && data.files.length > 0) return false;
            return false;
          },
        });
      } catch (_) {}
    });

    const page = await ctx.newPage();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // ── 1. Fresh mobile first screen ──────────────────────────────────────────
    await recordStep(page, OUTDIR, results, 'fresh-mobile-first-screen', async () => {
      const visible = await page.locator('#mobileFirstScreen').isVisible();
      if (!visible) throw new Error('mobile first screen not visible on fresh load');
      return { visible };
    });

    // ── 2. Apply template → editor-first shell ────────────────────────────────
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
      const wb = await getWbDebugState(page);
      if (!wb.sessionId) throw new Error('sessionId not set after template apply');
      return { template: 'player_native_idle_only', sessionId: wb.sessionId.slice(0, 8) };
    });

    // ── 3. Share via mobile top bar — download fallback ───────────────────────
    // shareXpFileLocal() → _getExportedXpBytes() (save + export + download binary)
    // → shareXpFile() → navigator.canShare({files}) fails in WebKit → _downloadBlob()
    // → <a download> click → Playwright download event.
    await recordStep(page, OUTDIR, results, 'share-file', async () => {
      const shareBtn = page.locator('[data-action="share-file"]');
      const btnVisible = await shareBtn.isVisible();
      if (!btnVisible) throw new Error('[data-action="share-file"] not visible in mobile top bar');

      // Wait for download event and click in parallel.
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        shareBtn.click(),
      ]);

      // Await download completion and save to artifact dir.
      downloadedXpPath = path.resolve(REPO_ROOT, OUTDIR, 'downloaded-share.xp');
      await download.saveAs(downloadedXpPath);
      const suggestedFilename = download.suggestedFilename();
      return { suggestedFilename, savedTo: downloadedXpPath };
    });

    // ── 4. Downloaded bytes are a valid XP binary ─────────────────────────────
    await recordStep(page, OUTDIR, results, 'verify-download-header', async () => {
      // Run a minimal header check: gzip magic or REXPaint version bytes.
      const headerOk = await new Promise((resolve) => {
        const script = `
import gzip, struct, sys
path = r'${downloadedXpPath}'
try:
    with open(path,'rb') as f: raw=f.read()
    data = gzip.decompress(raw) if raw[:2]==b'\\x1f\\x8b' else raw
    version = struct.unpack_from('<i',data,0)[0]
    n_layers = struct.unpack_from('<i',data,4)[0]
    print(f'ok version={version} n_layers={n_layers}')
except Exception as e:
    print(f'fail {e}')
`;
        try {
          const out = execFileSync('python3', ['-c', script], { encoding: 'utf8', timeout: 10000 });
          resolve(out.trim());
        } catch (e) {
          resolve('fail ' + String(e));
        }
      });
      if (!headerOk.startsWith('ok')) throw new Error(`XP binary header invalid: ${headerOk}`);
      return { headerCheck: headerOk };
    });

    // ── 5. Artifact oracle — non-zero glyph cells in downloaded XP binary ─────
    await recordStep(page, OUTDIR, results, 'artifact-oracle', async () => {
      const { error, totalNonZero } = runArtifactOracle(downloadedXpPath);
      if (error) throw new Error(`Artifact oracle error: ${error}`);
      if (totalNonZero <= 0) throw new Error(`Downloaded XP binary has no cells with char_code > 32`);
      return { totalNonZero };
    });

    overallPass = results.every((r) => r.pass);
  } catch (_err) {
    overallPass = results.every((r) => r.pass);
  } finally {
    await browser.close();
  }

  writeFileSync(`${OUTDIR}/result.json`, JSON.stringify({ overallPass, downloadedXpPath, results }, null, 2));

  const step = (name) => results.find((r) => r.name === name);
  const ok = (name) => step(name)?.pass ? '✅' : '❌';
  const oracleData = step('artifact-oracle')?.data || {};
  const shareData = step('share-file')?.data || {};
  const lines = [
    '# Export/Share XP Probe',
    '',
    `Result: **${overallPass ? 'PASS' : 'FAIL'}**`,
    `Downloaded XP: \`${downloadedXpPath || '(none)'}\``,
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
  lines.push(`${ok('apply-template')} Template applied via mobile first screen — editor-first shell`);
  lines.push(`${ok('share-file')} [data-action="share-file"] visible in mobile top bar`);
  lines.push(`${ok('share-file')} Download fallback (_downloadBlob) triggered — file: ${shareData.suggestedFilename || '?'}`);
  lines.push(`${ok('verify-download-header')} Downloaded bytes are a valid XP binary (gzip + REXPaint header)`);
  const oracleLabel = oracleData.totalNonZero != null
    ? `Artifact oracle (gzip-aware): totalNonZero=${oracleData.totalNonZero} (all layers)`
    : 'Artifact oracle: non-zero glyph cells confirmed in downloaded XP binary';
  lines.push(`${ok('artifact-oracle')} ${oracleLabel}`);
  lines.push('');
  lines.push('## What this probe does NOT cover');
  lines.push('');
  lines.push('- navigator.share() with files (Web Share API) — requires real iOS Safari user gesture on device');
  lines.push('- iPad share sheet UX (AirDrop, Files app, etc.) — only testable on physical device');
  lines.push('- Real iOS Safari on a physical iPad (UQ-013 / FL-MOB-01 / FL-MOB-02 remain OPEN)');
  lines.push('- Frame parity beyond Add Frame (probe #10)');
  const md = lines.join('\n') + '\n';
  writeFileSync(`${OUTDIR}/REPORT.md`, md);

  console.log(`\nResult: ${overallPass ? 'PASS' : 'FAIL'}`);
  console.log(`Steps: ${results.filter(r => r.pass).length}/${results.length}`);
  for (const r of results) {
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}${r.error ? ' — ' + r.error.split('\n')[0] : ''}`);
  }
  if (downloadedXpPath) console.log(`Downloaded XP: ${downloadedXpPath}`);
  console.log(`Report: ${OUTDIR}/REPORT.md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
