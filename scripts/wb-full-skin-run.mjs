import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:5071/workbench';
const PNG = path.resolve('output/24px-mini-characters/source_sheets/knight1-player-source.png');
const OUT = path.resolve('artifacts/wb-skin-run-3s');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const log = (m) => console.log(`[wbfull] ${m}`);
const show = async (sel, pauseMs = 1500) => {
  await page.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(pauseMs);
};
const shots = [];
const writeShots = () => {
  let f = 0;
  for (const b64 of shots) {
    try { fs.writeFileSync(path.join(OUT, `frame-${String(f++).padStart(3, '0')}.jpg`), Buffer.from(b64, 'base64')); } catch {}
  }
  return f;
};

try {
  log(`opening ${BASE}`);
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('#wbUpload', { timeout: 15000 });

  // Record EVERYTHING from here: upload, slice, preview, skin run.
  const cdp = await context.newCDPSession(page);

  cdp.on('Page.screencastFrame', async (payload) => {
    try { await cdp.send('Page.screencastFrameAck', { sessionId: payload.sessionId }); } catch {}
    shots.push(payload.data);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 65, maxWidth: 1280, maxHeight: 800, everyNthFrame: 3 });
  log('recording started');

  // 1. New session.
  await page.waitForFunction(() => !document.getElementById('btnNewXp')?.disabled, null, { timeout: 30000 });
  await show('#btnNewXp', 800);
  await page.click('#btnNewXp');
  await page.waitForFunction(() => /New XP ready/.test(document.getElementById('wbStatus')?.textContent || ''), null, { timeout: 60000 });
  log('session ready');
  await page.screenshot({ path: path.join(OUT, '00-session.png') });
  await page.waitForTimeout(1000);

  // 2. Upload PNG (knight sheet), visible on screen.
  await show('#uploadConvertPanel', 800);
  await page.fill('#wbName', 'knight1');
  await page.setInputFiles('#wbFile', PNG);
  log('file selected: knight1-player-source.png (468x416)');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, '01-selected.png') });
  await page.click('#wbUpload');
  await page.waitForFunction(() => !document.getElementById('wbRun')?.disabled, null, { timeout: 90000 });
  log('upload ok, Convert enabled');
  await page.screenshot({ path: path.join(OUT, '02-uploaded.png') });
  await page.waitForTimeout(1500);

  // 3. Convert / slice to XP.
  await page.click('#wbRun');
  await page.waitForFunction(() => !document.getElementById('webbuildQuickTestBtn')?.disabled, null, { timeout: 180000 });
  const runOut = await page.textContent('#wbRunOut').catch(() => '?');
  log(`convert ok: ${(runOut || '').slice(0, 160)}`);
  await page.screenshot({ path: path.join(OUT, '03-converted.png') });
  await page.waitForTimeout(1500);

  // 4. Show the sliced spritesheet grid.
  await show('#wholeSheetPanel', 2500);
  await page.screenshot({ path: path.join(OUT, '04-grid.png') });
  log('grid shown');

  // 5. XP Preview: press Play, watch the sheet animate (come to life).
  // (Desktop renders drawers inline via display:contents — no toggle needed;
  // calling toggleDrawer here opens a backdrop sheet that hides the button.)
  // The preview drawer lives inside a closed <details>: open it first.
  await page.evaluate(() => { const d = document.getElementById('advancedDiagnostics'); if (d) d.open = true; });
  await show('#previewCanvas', 1200);
  await page.click('#playBtn');
  log('preview playing');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, '05-preview-playing.png') });
  await page.click('#stopBtn');
  log('preview stopped');

  // (Same: Test panel is already in page flow on desktop.)
  await show('#webbuildDockPanel', 1000);
  await page.locator('#webbuildQuickTestBtn:visible').first().click();
  await page.waitForSelector('#webbuildFrame:not(.hidden)', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => /ready|error|fail|stuck/i.test(document.getElementById('webbuildState')?.textContent || ''), null, { timeout: 150000 });
  const state = await page.textContent('#webbuildState').catch(() => '?');
  log(`skin state: ${state?.slice(0, 120)}`);
  const dockText = await page.locator('#webbuildDockPanel').textContent().catch(() => '');
  const dockSkin = (dockText.match(/dock skin:[^\n]*/) || ['?'])[0];
  log(`dock skin line: ${dockSkin.slice(0, 160)}`);
  await page.locator('#webbuildFrame:visible').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '06-skin-dock.png') });

  // 7. Run around in the world ~3s via proven in-iframe Keyb path.
  const frameHandle = page.frame({ url: /\/termpp-web-flat\/index\.html/ });
  if (!frameHandle) throw new Error('game iframe not found');
  const overlay = await frameHandle.evaluate(() => {
    const ov = document.getElementById('login-overlay');
    if (!ov) return { exists: false };
    const cs = getComputedStyle(ov);
    return { exists: true, visible: !ov.hidden && cs.display !== 'none' && cs.visibility !== 'hidden', wasm: !!window._wasmReady };
  });
  log(`overlay: ${JSON.stringify(overlay)}`);
  if (overlay.visible) {
    const playBtn = frameHandle.locator('#play-btn');
    if (await playBtn.count() && await playBtn.isEnabled().catch(() => false)) {
      await playBtn.click({ timeout: 5000 });
      await page.waitForTimeout(1500);
      log('clicked play');
    }
  }
  const canvas = frameHandle.locator('#asciicker_canvas');
  await canvas.waitFor({ state: 'attached', timeout: 20000 });
  await canvas.click({ timeout: 10000 });
  await frameHandle.evaluate(() => { const c = document.getElementById('asciicker_canvas'); if (c) c.focus(); });
  const CODE = { w: 50, a: 28, s: 46, d: 31 };
  const hold = async (k, ms) => {
    await frameHandle.evaluate((code) => {
      try { const c = document.getElementById('asciicker_canvas'); if (c) c.focus(); } catch {}
      try { if (typeof window.Keyb === 'function') window.Keyb(0, code); } catch {}
    }, CODE[k]);
    await page.waitForTimeout(ms);
    await frameHandle.evaluate((code) => {
      try { if (typeof window.Keyb === 'function') window.Keyb(1, code); } catch {}
    }, CODE[k]);
    await page.waitForTimeout(80);
  };
  const t0 = Date.now();
  for (const k of ['w', 'd', 's', 'a']) { if (Date.now() - t0 > 3400) break; await hold(k, 750); }
  log(`ran ${Date.now() - t0}ms`);
  await page.waitForTimeout(600);
  // Re-read after the run: skin injection settles after ready.
  const stateAfter = await page.textContent('#webbuildState').catch(() => '?');
  const dockTextAfter = await page.locator('#webbuildDockPanel').first().textContent().catch(() => '');
  const dockSkinAfter = (dockTextAfter.match(/dock skin:[^\n]*/) || ['?'])[0];
  log(`after-run skin: ${dockSkinAfter.slice(0, 160)}`);
  const skinOk = /tracks current document/.test(dockSkinAfter);
  await cdp.send('Page.stopScreencast').catch(() => {});
  await cdp.detach().catch(() => {});
  const f = writeShots();
  log(`${f} video frames`);
  await page.screenshot({ path: path.join(OUT, '07-after-run.png') });
  console.log(JSON.stringify({ pass: /ready/i.test(stateAfter || '') && skinOk && f > 10, frames: f, skinState: (stateAfter || '').slice(0, 120), dockSkin: dockSkinAfter.slice(0, 120) }));
} catch (e) {
  const f = writeShots();
  log(`${f} partial video frames salvaged`);
  await page.screenshot({ path: path.join(OUT, 'FAIL.png') }).catch(() => {});
  console.log(JSON.stringify({ pass: false, salvagedFrames: f, error: String(e?.message || e).slice(0, 500) }));
  process.exitCode = 1;
} finally {
  const race = (p, ms) => Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
  await race(page.close(), 8000);
  await race(context.close(), 8000);
  await race(browser.close(), 8000);
  try {
    const { execFileSync } = await import('node:child_process');
    const NORM = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=8,format=yuv420p';
    const ff = (args) => execFileSync('ffmpeg', args, { cwd: OUT, stdio: 'pipe', timeout: 120000 });
    // A: step cards slideshow (1s each) so static stages are watchable.
    ff(['-y', '-framerate', '1', '-pattern_type', 'glob', '-i', '0[0-7]-*.png', '-vf', NORM, 'cards.mp4']);
    const frames = fs.readdirSync(OUT).filter((x) => /^frame-\d+\.jpg$/.test(x));
    if (!frames.length) {
      fs.renameSync(path.join(OUT, 'cards.mp4'), path.join(OUT, 'run-3s.mp4'));
      console.log('[wbfull] no live frames; cards-only video');
    } else {
      ff(['-y', '-framerate', '8', '-i', 'frame-%03d.jpg', '-vf', NORM, 'live.mp4']);
      ff(['-y', '-i', 'cards.mp4', '-i', 'live.mp4', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0', '-pix_fmt', 'yuv420p', 'run-3s.mp4']);
      console.log('[wbfull] encoded run-3s.mp4 (cards + live)');
    }
  } catch (e) { console.log(`[wbfull] ffmpeg encode failed: ${String(e?.message || e).slice(0, 200)}`); }
  process.exit(process.exitCode || 0);
}
