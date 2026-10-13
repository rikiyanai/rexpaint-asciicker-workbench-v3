/**
 * UQ-013 / FL-MOB-01 — mobile workbench PARITY probe (headed WebKit, iPad profile)
 *
 * Proves the reparented drawers expose the real desktop mechanics in editor-first
 * mode WITHOUT entering Advanced. For each drawer it:
 *   - clicks the top-bar toggle (editor-first, body has NO ws-advanced),
 *   - asserts the matching .ws-drawer[data-drawer] is .open,
 *   - enumerates the enabled interactive controls inside (the actual mechanics),
 *   - screenshots the open drawer.
 *
 * It then writes a markdown report listing exactly which mechanics are reachable
 * in mobile mode without Advanced — the artifact requested in the review.
 *
 * Output: artifacts/2026-06-16-mobile-parity/<orientation>-drawer-<name>.png
 *         artifacts/2026-06-16-mobile-parity/PARITY_REPORT.md
 * Run:    node scripts/audit/probe_mobile_parity.mjs
 *
 * NOTE: Playwright WebKit is engine-family emulation under the iPad profile, NOT
 * Apple's shipping iOS Safari. The real-device pass (UQ-013 step 6) is separate.
 */
import { webkit, devices } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5071';
const WORKBENCH = `${BASE}/workbench`;
const OUTDIR = 'artifacts/2026-06-16-mobile-parity-v2';
mkdirSync(OUTDIR, { recursive: true });

// Drawers expected reachable in editor-first mode (no Advanced).
// 'origin' = reparented dashboard panel (new this pass) or in-editor (pre-existing).
// kind: 'control' = a control-parity surface (real desktop controls expected);
//       'status'  = a status/list-only surface (zero buttons is BY DESIGN —
//                   browse is a session list, info is a cell readout).
const DRAWERS = [
  { name: 'tools',    kind: 'control', origin: 'in-editor (Panel 18 tools)' },
  { name: 'frames',   kind: 'control', origin: 'reparented Panel 9 (grid/frame nav)' },
  { name: 'layers',   kind: 'control', origin: 'in-editor (layer stack)' },
  { name: 'files',    kind: 'control', origin: 'reparented Panel 5 (session ops)' },
  { name: 'source',   kind: 'control', origin: 'reparented Panel 8 (slice/canvas)' },
  { name: 'import',   kind: 'control', origin: 'reparented Panel 7 (upload/convert)' },
  { name: 'template', kind: 'control', origin: 'reparented Panel 4+4b (template/bundle/domain)' },
  { name: 'anim',     kind: 'control', origin: 'reparented Panel 11 (anim+metadata+jitter)' },
  { name: 'preview',  kind: 'control', origin: 'reparented Panel 12+13 (xp-preview+session)' },
  { name: 'test',     kind: 'control', origin: 'reparented Panel 14 (skin-test-dock)' },
  { name: 'export',   kind: 'control', origin: 'reparented Panel 16+17 (verification+export)' },
  { name: 'browse',   kind: 'status',  origin: 'in-editor session list (mode-gated to BROWSE; list-only)' },
  { name: 'info',     kind: 'status',  origin: 'in-editor cell readout (status-only)' },
];

async function dismissViaTemplate(page) {
  await page.locator('#fsTemplateSelect').selectOption('player_native_idle_only').catch(() => {});
  await page.waitForTimeout(200);
  await page.locator('#fsTemplateApplyBtn').click().catch(() => {});
  await page.waitForFunction(
    () => document.getElementById('mobileFirstScreen')?.classList.contains('hidden'),
    { timeout: 25000 }
  ).catch(() => {});
  await page.waitForTimeout(1200);
}

// Enumerate the enabled, visible interactive controls inside a drawer.
async function enumerateControls(page, drawerName) {
  return page.evaluate((name) => {
    const drawer = document.querySelector(`.ws-drawer[data-drawer="${name}"]`);
    if (!drawer) return { found: false, controls: [] };
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const out = [];
    drawer.querySelectorAll('button, select, input').forEach((el) => {
      if (!isVisible(el)) return;
      const label = (el.textContent || el.value || el.id || el.type || '').trim().slice(0, 32);
      out.push({ tag: el.tagName.toLowerCase(), id: el.id || '', label, disabled: !!el.disabled });
    });
    return { found: true, controls: out };
  }, drawerName);
}

const lines = [];
lines.push('# Mobile Workbench Parity — reachable mechanics WITHOUT Advanced');
lines.push('');
lines.push('Captured by `scripts/audit/probe_mobile_parity.mjs` (headed WebKit, iPad profile).');
lines.push('Each drawer below was opened in editor-first mode with `body.ws-advanced` **absent**.');
lines.push('Playwright WebKit is engine-family emulation, NOT a physical iPad / iOS Safari.');
lines.push('');

const browser = await webkit.launch({ headless: false });
let anyFail = false;
try {
  for (const o of [
    { name: 'portrait', device: devices['iPad Pro 11'] },
    { name: 'landscape', device: devices['iPad Pro 11 landscape'] },
  ]) {
    const ctx = await browser.newContext({ ...o.device });
    const page = await ctx.newPage();
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await dismissViaTemplate(page);

    const advanced = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
    lines.push(`## ${o.name}  (editor-first, ws-advanced=${advanced})`);
    lines.push('');

    for (const d of DRAWERS) {
      const btn = page.locator(`.ws-mobile-top-bar [data-drawer-toggle="${d.name}"]`).first();
      const hasBtn = (await btn.count()) > 0;
      if (!hasBtn) {
        lines.push(`### ${d.name} — ❌ NO top-bar toggle (${d.origin})`);
        lines.push('');
        anyFail = true;
        continue;
      }
      // ensure a clean closed state, then open via a real tap (tests that the
      // toggle is reachable over the backdrop — the z-index:101 fix)
      await page.evaluate(() => window.toggleDrawer && window.toggleDrawer()).catch(() => {});
      await page.waitForTimeout(150);
      await btn.click().catch(() => {});
      await page.waitForTimeout(450);

      const open = await page.evaluate(
        (n) => !!document.querySelector(`.ws-drawer[data-drawer="${n}"].open`),
        d.name
      );
      const stillEditorFirst = !(await page.evaluate(() => document.body.classList.contains('ws-advanced')));
      const { found, controls } = await enumerateControls(page, d.name);
      const enabled = controls.filter((c) => !c.disabled);

      await page.screenshot({ path: `${OUTDIR}/${o.name}-drawer-${d.name}.png` });

      // control drawers must expose ≥1 control; status drawers (browse/info)
      // are list/readout-only by design, so zero controls is expected.
      const ok = open && stillEditorFirst && found && (d.kind === 'status' || controls.length > 0);
      if (!ok) anyFail = true;
      lines.push(`### ${d.name} — ${ok ? '✅' : '❌'} [${d.kind}] (${d.origin})`);
      lines.push(`- opened: ${open} · still editor-first (no Advanced): ${stillEditorFirst} · drawer in DOM: ${found}`);
      if (d.kind === 'status') {
        lines.push(`- status/list surface — ${controls.length} controls (zero is by design; populated on use, not a parity surface)`);
      } else {
        lines.push(`- controls: ${controls.length} total, ${enabled.length} enabled`);
        const sample = controls.slice(0, 24).map((c) => `${c.label || c.id}${c.disabled ? '(disabled)' : ''}`);
        lines.push(`- ${sample.join(' · ')}`);
      }
      lines.push('');

      // close before next (deterministic — avoids backdrop intercept artifacts)
      await page.evaluate(() => window.toggleDrawer && window.toggleDrawer()).catch(() => {});
      await page.waitForTimeout(250);
      console.log(`✓ ${o.name} drawer ${d.name}: open=${open} editorFirst=${stillEditorFirst} controls=${controls.length}`);
    }
    await ctx.close();
  }

  // ── End-to-end execution (not just reachability): drive the headline
  // reparented mechanic — Frames "Add Frame" — and confirm it mutates state. ──
  lines.push('## End-to-end execution (mobile, no Advanced)');
  lines.push('');
  {
    const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
    const page = await ctx.newPage();
    await page.goto(WORKBENCH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await dismissViaTemplate(page);
    await page.locator('.ws-mobile-top-bar [data-drawer-toggle="frames"]').click().catch(() => {});
    await page.waitForTimeout(400);

    const countFrames = () => page.evaluate(
      () => document.querySelectorAll('#gridPanel .frame-cell').length
    );
    const before = await countFrames();
    const addEnabled = await page.evaluate(
      () => { const b = document.getElementById('addFrameBtn'); return !!b && !b.disabled; }
    );
    await page.locator('.ws-drawer[data-drawer="frames"] #addFrameBtn').click().catch(() => {});
    await page.waitForTimeout(600);
    const after = await countFrames();
    await page.screenshot({ path: `${OUTDIR}/landscape-e2e-add-frame.png` });

    const advancedDuring = await page.evaluate(() => document.body.classList.contains('ws-advanced'));
    const addWorked = after > before;
    if (!addWorked || advancedDuring) anyFail = true;
    lines.push(`### Frames › Add Frame — ${addWorked ? '✅ executed' : '❌ no state change'}`);
    lines.push(`- Add Frame enabled: ${addEnabled} · frame cells before: ${before} → after: ${after} · stayed editor-first: ${!advancedDuring}`);
    lines.push('- NOTE: other reparented actions (source slicing, export, PNG upload, file save) are proven REACHABLE/enabled only; full end-to-end on those still needs the real-device pass.');
    lines.push('');
    console.log(`✓ e2e Add Frame: before=${before} after=${after} worked=${addWorked}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}

lines.push('---');
lines.push(`Overall: ${anyFail ? '❌ one or more drawers failed' : '✅ all probed drawers reachable in editor-first'}`);
writeFileSync(`${OUTDIR}/PARITY_REPORT.md`, lines.join('\n'));
console.log(`\nReport: ${OUTDIR}/PARITY_REPORT.md`);
console.log(anyFail ? 'RESULT: FAIL' : 'RESULT: PASS');
