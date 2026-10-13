/**
 * UX fixes probe: tools-always-visible + Request Desktop Site
 *
 * Step 1: iPad landscape → sidebar permanently visible, no tools toggle needed
 * Step 2: Desktop UA on touch device (ws-force-desktop) → full desktop workbench, no mobile first screen
 *
 * Output directory precedence:
 *   1. --outdir <path> or --outdir=<path>
 *   2. UX_FIXES_ARTIFACT_DIR
 *   3. artifacts/2026-06-20-ux-fixes (historical default)
 */

import { chromium, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:5071/workbench';
const DEFAULT_ARTIFACT_DIR = 'artifacts/2026-06-20-ux-fixes';

function outputDirectory(argv, env) {
  let cliValue = null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--outdir') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--outdir requires a non-empty path');
      }
      cliValue = next;
      index += 1;
    } else if (value.startsWith('--outdir=')) {
      cliValue = value.slice('--outdir='.length);
      if (!cliValue) {
        throw new Error('--outdir requires a non-empty path');
      }
    }
  }

  const envValue = String(env.UX_FIXES_ARTIFACT_DIR || '').trim();
  return path.normalize(cliValue || envValue || DEFAULT_ARTIFACT_DIR);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node scripts/audit/ux_fixes_probe.mjs [--outdir <path>]');
  console.log('Environment: UX_FIXES_ARTIFACT_DIR=<path>');
  process.exit(0);
}

let ARTIFACT_DIR;
try {
  ARTIFACT_DIR = outputDirectory(process.argv.slice(2), process.env);
} catch (error) {
  console.error(`Argument error: ${error.message}`);
  process.exit(2);
}

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const IPAD = devices['iPad Pro 11 landscape'];

let passed = 0;
let failed = 0;
const results = [];

function ok(name, detail = '') {
  passed++;
  results.push({ name, status: 'PASS', detail });
  console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
}

function fail(name, detail = '') {
  failed++;
  results.push({ name, status: 'FAIL', detail });
  console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
}

async function waitForSession(page, timeout = 20000) {
  await page.waitForFunction(
    () => document.body.classList.contains('ws-session-loaded'),
    { timeout }
  );
}

// ─── STEP 1: Tools always visible in landscape ───────────────────────────────
console.log('\n[1] iPad landscape — tools sidebar permanently visible');

{
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    ...IPAD,
    acceptDownloads: true,
  });
  const page = await ctx.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    // Navigate past mobile first screen using known selectors
    await page.waitForSelector('#mobileFirstScreen', { state: 'visible', timeout: 15000 });
    await page.locator('#fsTemplateSelect').selectOption('player_native_idle_only');
    await page.locator('#fsTemplateApplyBtn').click();
    await page.waitForFunction(
      () => document.getElementById('mobileFirstScreen')?.classList.contains('hidden') &&
        document.body.classList.contains('ws-session-loaded') &&
        !!document.getElementById('wholeSheetCanvas'),
      { timeout: 30000 }
    );

    // Screenshot of initial state
    await page.screenshot({ path: `${ARTIFACT_DIR}/step1-initial.png`, fullPage: false });

    // Check sidebar visible without any click
    const sidebarDisplay = await page.evaluate(() => {
      const sidebar = document.querySelector('.ws-sidebar');
      if (!sidebar) return 'MISSING';
      return getComputedStyle(sidebar).display;
    });
    if (sidebarDisplay !== 'none' && sidebarDisplay !== 'MISSING') {
      ok('sidebar-visible-without-toggle', `display=${sidebarDisplay}`);
    } else {
      fail('sidebar-visible-without-toggle', `display=${sidebarDisplay}`);
    }

    // Check tools drawer inside sidebar is also visible (not collapsed)
    const toolsDrawerDisplay = await page.evaluate(() => {
      const drawer = document.querySelector('.ws-drawer[data-drawer="tools"]');
      if (!drawer) return 'MISSING';
      const s = getComputedStyle(drawer);
      return s.display;
    });
    // flex or block = visible; none = hidden
    if (toolsDrawerDisplay !== 'none' && toolsDrawerDisplay !== 'MISSING') {
      ok('tools-drawer-visible', `display=${toolsDrawerDisplay}`);
    } else {
      fail('tools-drawer-visible', `display=${toolsDrawerDisplay}`);
    }

    // Check tools toggle button in top bar is hidden
    const toggleHidden = await page.evaluate(() => {
      const toggleBtn = document.querySelector('[data-drawer-toggle="tools"]');
      if (!toggleBtn) return true; // not present = hidden is fine
      const s = getComputedStyle(toggleBtn);
      return s.display === 'none';
    });
    if (toggleHidden) {
      ok('tools-toggle-hidden');
    } else {
      fail('tools-toggle-hidden', 'drawer toggle button still visible');
    }

    // Check layout has padding-left (canvas pushed right)
    const layoutPaddingLeft = await page.evaluate(() => {
      const layout = document.querySelector('.ws-layout');
      if (!layout) return '0';
      return getComputedStyle(layout).paddingLeft;
    });
    // Expect ~200px
    const plNum = parseFloat(layoutPaddingLeft);
    if (plNum >= 180 && plNum <= 240) {
      ok('layout-offset', `paddingLeft=${layoutPaddingLeft}`);
    } else {
      fail('layout-offset', `paddingLeft=${layoutPaddingLeft} (expected ~200px)`);
    }

    // Check ws-first-screen is NOT shown (we're past the first screen)
    const firstScreenHidden = await page.evaluate(() => {
      const el = document.getElementById('mobileFirstScreen');
      if (!el) return true;
      return el.classList.contains('hidden') || getComputedStyle(el).display === 'none';
    });
    if (firstScreenHidden) {
      ok('first-screen-hidden-after-load');
    } else {
      fail('first-screen-hidden-after-load', 'mobile first screen still visible after session load');
    }

    await page.screenshot({ path: `${ARTIFACT_DIR}/step1-final.png`, fullPage: false });

  } catch (e) {
    fail('step1-exception', e.message);
    await page.screenshot({ path: `${ARTIFACT_DIR}/step1-error.png`, fullPage: false }).catch(() => {});
  }

  await browser.close();
}

// ─── STEP 2: ws-force-desktop (Request Desktop Site) ─────────────────────────
console.log('\n[2] Desktop UA + touch device → ws-force-desktop, full workbench');

{
  // Simulate: touch device (maxTouchPoints) + non-mobile UA (desktop Safari)
  const DESKTOP_SAFARI_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    // iPad-sized viewport but desktop UA
    viewport: { width: 1194, height: 834 },
    userAgent: DESKTOP_SAFARI_UA,
    hasTouch: true,
    acceptDownloads: true,
  });
  const page = await ctx.newPage();

  // Override navigator.maxTouchPoints so the inline head script sees touch=true
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    // Check ws-force-desktop class applied
    const hasForceDesktop = await page.evaluate(() =>
      document.documentElement.classList.contains('ws-force-desktop')
    );
    if (hasForceDesktop) {
      ok('ws-force-desktop-class-applied');
    } else {
      fail('ws-force-desktop-class-applied', 'class not on <html>');
    }

    // Mobile first screen must not be visible at all
    const firstScreenHidden = await page.evaluate(() => {
      const el = document.getElementById('mobileFirstScreen');
      if (!el) return true;
      const s = getComputedStyle(el);
      return s.display === 'none';
    });
    if (firstScreenHidden) {
      ok('mobile-first-screen-suppressed');
    } else {
      fail('mobile-first-screen-suppressed', 'mobile first screen visible on force-desktop');
    }

    // Mobile bars must not be visible
    const mobileBarsHidden = await page.evaluate(() => {
      const topBar = document.querySelector('.ws-mobile-top-bar');
      const botBar = document.querySelector('.ws-mobile-bottom-bar');
      const topHidden = !topBar || getComputedStyle(topBar).display === 'none';
      const botHidden = !botBar || getComputedStyle(botBar).display === 'none';
      return topHidden && botHidden;
    });
    if (mobileBarsHidden) {
      ok('mobile-bars-suppressed');
    } else {
      fail('mobile-bars-suppressed', 'mobile top/bottom bars visible on force-desktop');
    }

    // _isMobileLike must return false
    const isMobileResult = await page.evaluate(() => window._isMobileLike?.());
    if (isMobileResult === false) {
      ok('_isMobileLike-returns-false');
    } else {
      fail('_isMobileLike-returns-false', `got ${isMobileResult}`);
    }

    await page.screenshot({ path: `${ARTIFACT_DIR}/step2-initial.png`, fullPage: false });

    // Navigate into workbench (should go straight to dashboard without mobile first screen)
    // Wait a moment to see if any mobile-specific redirect happens
    await page.waitForTimeout(2000);

    // Re-check — still no mobile first screen
    const stillHidden = await page.evaluate(() => {
      const el = document.getElementById('mobileFirstScreen');
      if (!el) return true;
      return getComputedStyle(el).display === 'none';
    });
    if (stillHidden) {
      ok('mobile-first-screen-stays-suppressed');
    } else {
      fail('mobile-first-screen-stays-suppressed', 'appeared after initial load');
    }

    await page.screenshot({ path: `${ARTIFACT_DIR}/step2-final.png`, fullPage: false });

  } catch (e) {
    fail('step2-exception', e.message);
    await page.screenshot({ path: `${ARTIFACT_DIR}/step2-error.png`, fullPage: false }).catch(() => {});
  }

  await browser.close();
}

// ─── Summary ──────────────────────────────────────────────────────────────────
const total = passed + failed;
const oracle = {
  run: new Date().toISOString(),
  probe: 'ux_fixes_probe',
  summary: `${passed}/${total} PASS`,
  results,
};
fs.writeFileSync(`${ARTIFACT_DIR}/oracle.json`, JSON.stringify(oracle, null, 2));

console.log(`\n──────────────────────────────────────────`);
console.log(`RESULT: ${passed}/${total} PASS  ${failed > 0 ? '← FAILURES' : '← ALL PASS'}`);
console.log(`Artifacts: ${ARTIFACT_DIR}/`);
if (failed > 0) process.exit(1);
