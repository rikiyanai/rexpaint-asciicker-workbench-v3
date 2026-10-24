#!/usr/bin/env node
// Edited-time UI demonstrations, not synthetic canvas output. Short commands
// share one owned headed browser/server; raw frames and receipts are retained.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fork, spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'artifacts/2026-10-21-authoring-demos/run-2');
const MEDIA = path.join(ROOT, 'docs/demos');
const URL = 'http://127.0.0.1:5073/xpedit/workbench';
const CONTROL = 'http://127.0.0.1:5094';
const PNG = path.join(ROOT, 'output/24px-mini-characters/source_sheets/knight1-player-source.png');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (process.argv.includes('--start')) {
  const child = fork(fileURLToPath(import.meta.url), ['--daemon'], {
    cwd: ROOT, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const timer = setTimeout(() => { console.error('Recorder startup timed out'); process.exit(1); }, 20000);
  child.once('message', (message) => {
    clearTimeout(timer); console.log(JSON.stringify(message)); child.disconnect(); child.unref();
  });
} else if (!process.argv.includes('--daemon')) {
  const step = process.argv[process.argv.indexOf('--step') + 1];
  assert.ok(step && process.argv.includes('--step'), 'Use --start or --step <name>');
  const response = await fetch(`${CONTROL}/${step}`, {signal: AbortSignal.timeout(28000)});
  const body = await response.text(); console.log(body);
  if (!response.ok) process.exitCode = 1;
} else {
  const { chromium } = await import('playwright');
  await fs.mkdir(OUT, {recursive: true});
  await fs.mkdir(MEDIA, {recursive: true});
  const receipt = {sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
    url: URL, browser: 'headed system Chrome', timing: 'edited-time; 8 sampled screenshots per output second; waits between commands omitted',
    runtimeScope: 'embedded legacy termpp-web-flat Skin Dock, not the external Y9-2 game or Godot',
    stages: [], flows: {}, errors: []};
  const serverLog = await fs.open(path.join(OUT, 'server.log'), 'a');
  // Isolate every writable backend directory before importing the real app.
  // Existing user sessions on :5071 and repo data/ are never touched.
  const app = spawn('python3', ['-c', `from pathlib import Path
from pipeline_v2 import config
config.DATA_DIR = Path(${JSON.stringify(path.join(OUT, 'data'))})
for name in ('UPLOAD_DIR','JOBS_DIR','SESSIONS_DIR','EXPORT_DIR','PREVIEWS_DIR','GATES_DIR','TRACES_DIR','BUNDLES_DIR','BUG_REPORTS_DIR'):
    setattr(config, name, config.DATA_DIR / name.removesuffix('_DIR').lower())
from pipeline_v2.app import create_app
create_app().run(host='127.0.0.1', port=5073)
`], {cwd: ROOT,
    env: {...process.env, PIPELINE_PORT: '5073', PIPELINE_BASE_PATH: '/xpedit', PYTHONPATH: 'src'},
    stdio: ['ignore', 'pipe', 'pipe']});
  for (const stream of [app.stdout, app.stderr]) stream.on('data', (data) => serverLog.appendFile(data));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned app did not listen')), 10000);
    app.stderr.on('data', (data) => { if (String(data).includes('Running on http://127.0.0.1:5073')) { clearTimeout(timer); resolve(); } });
    app.once('exit', (code) => reject(new Error(`Owned app exited ${code}`)));
  });
  receipt.serverPid = app.pid;
  const browser = await chromium.launch({channel: 'chrome', headless: false});
  let context, page, currentFlow, recording = false, busy = false;
  const persist = () => fs.writeFile(path.join(OUT, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  async function open(flow) {
    if (context) await context.close();
    context = await browser.newContext({viewport: {width: 1440, height: 1000}, serviceWorkers: 'block'});
    page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => receipt.errors.push({flow, message: error.stack}));
    page.on('request', (request) => {
      if (request.url().endsWith('/api/run')) receipt.conversionRequest = request.postDataJSON();
    });
    page.on('response', async (response) => {
      if (response.url().endsWith('/api/run') && response.ok()) receipt.conversionResponse = await response.json();
    });
    currentFlow = flow;
    receipt.flows[flow] = {frames: 0};
    await fs.mkdir(path.join(OUT, flow), {recursive: true});
    await page.goto(URL, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => document.querySelector('#wsBrowseStatus')?.textContent.includes('287 upstream XP sprites'));
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => window.__wb_debug && document.querySelector('#registryActionSelect option[value="player_native_idle_only:idle"]'));
  }
  async function frame() {
    const flow = receipt.flows[currentFlow];
    const name = `frame-${String(flow.frames++).padStart(5, '0')}.png`;
    await page.screenshot({path: path.join(OUT, currentFlow, name)});
  }
  async function record(fn) {
    recording = true;
    const sampling = (async () => { while (recording) { await frame(); await sleep(100); } })();
    try { return await fn(); } finally { recording = false; await sampling; }
  }
  async function hold(ms = 1200) { await sleep(ms); }
  async function show(selector) { await page.locator(selector).first().scrollIntoViewIfNeeded(); await hold(350); }
  async function anchor(name) { await page.screenshot({path: path.join(OUT, `${currentFlow}-${name}.png`)}); }
  const wb = () => page.evaluate(() => window.__wb_debug.getState());
  const ed = () => page.evaluate(() => window.__wholeSheetEditor.getState());
  const doc = () => page.evaluate(() => window.__wholeSheetEditor.getDocumentSnapshot());
  async function applyIdle() {
    await page.locator('#productActionNavigation > summary').click();
    await page.locator('#registryActionSelect').selectOption('player_native_idle_only:idle');
    assert.equal(await page.locator('#templateSelect').inputValue(), 'player_native_idle_only');
    await page.locator('#registryTemplateApplyBtn').click();
    await page.waitForFunction(() => window.__wholeSheetEditor?.getState().mounted && window.__wholeSheetEditor.getState().sessionKind === 'template_owned');
    await page.locator('#productActionNavigation > summary').click();
  }
  async function probe() {
    const runtime = page.frame({url: /\/termpp-web-flat\/index.html/});
    assert.ok(runtime, 'embedded runtime frame exists');
    return runtime.evaluate(() => {
      const p = [0, 0, 0]; window.ak?.getPos?.(p, 0);
      const overlay = document.querySelector('#login-overlay');
      return {pos: p, worldReady: window.GameWorldReady?.(), menu: window.GameMainMenuActive?.(),
        wasmReady: window._wasmReady, raf: window.__ak_diag?.raf,
        overlayVisible: overlay && !overlay.hidden && getComputedStyle(overlay).display !== 'none',
        skin: window.__legacySkinPreview};
    });
  }
  const steps = {
    async browse() {
      await open('browse-xp-sprites');
      await record(async () => {
        await page.locator('#wsBrowseSource').selectOption('upstream'); await hold(1400);
        await page.locator('#wsBrowseSearch').pressSequentially('player-', {delay: 95}); await hold(1100);
        await page.locator('.ws-browse-item').filter({hasText: 'player-0100.xp'}).click(); await hold(1800);
        await anchor('selected');
        receipt.flows[currentFlow].selected = await page.locator('#productBrowsePanel').innerText();
        await page.locator('#wsBrowseOpen').click();
        await page.waitForFunction(() => window.__wholeSheetEditor?.getState().mounted && window.__wholeSheetEditor.getState().sessionKind === 'raw_xp');
        await show('#wholeSheetScroll'); await hold(1600); await anchor('editable-copy');
        receipt.flows[currentFlow].editor = await ed();
      });
    },
    async 'stroke-setup'() {
      await open('stroke-to-runtime');
      await record(async () => {
        await applyIdle();
        await show('#wsToolSlope'); await page.locator('#wsToolSlope').click();
        await page.locator('#wsFgColor').fill('#ffcc00'); await page.locator('#wsFgColor').dispatchEvent('input');
        await show('#wholeSheetScroll'); await hold(900); await anchor('blank-template');
      });
      receipt.flows[currentFlow].before = await doc();
    },
    async 'stroke-draw'() {
      await record(async () => {
        const state = await ed();
        const canvas = page.locator('#wholeSheetCanvas');
        const box = await canvas.boundingBox();
        const size = box.width / state.gridCols;
        // Author every angle's idle frame via real pointer strokes, so facing
        // changes keep the hand-drawn yellow figure rather than a blank sprite.
        for (let angle = 0; angle < 8; angle++) {
          const points = [[3,2],[1,4],[3,3],[5,4],[3,3],[3,6],[1,8],[3,6],[5,8]];
          const point = ([x,y]) => ({x: box.x+(x+0.5)*size, y: box.y+(angle*10+y+0.5)*size});
          const first = point(points[0]); await page.mouse.move(first.x, first.y); await page.mouse.down();
          for (const p of points.slice(1)) { const q = point(p); await page.mouse.move(q.x,q.y,{steps:4}); }
          await page.mouse.up();
        }
        await hold(1100); await anchor('authored');
        const after = await doc();
        const before = receipt.flows[currentFlow].before;
        const changed = after.layers[2].flatMap((c,i) => JSON.stringify(c) !== JSON.stringify(before.layers[2][i]) ? [i] : []);
        assert.ok(changed.length > 40, 'pointer strokes authored all eight idle angles');
        receipt.flows[currentFlow].authored = {changedCells: changed.length, glyphs: [...new Set(changed.map(i=>after.layers[2][i].glyph))], layer0Unchanged: JSON.stringify(before.layers[0]) === JSON.stringify(after.layers[0])};
        delete receipt.flows[currentFlow].before;
        const save = page.waitForResponse(r => r.url().endsWith('/save-session') && r.ok() && r.request().postDataJSON()?.layers?.[2]?.some(c => c.fg?.[0] === 255 && c.fg?.[1] === 204));
        await page.locator('#btnSave').click(); await save;
        const event = page.waitForEvent('download'); await page.locator('#btnExport').click();
        await (await event).saveAs(path.join(OUT, 'authored-player.xp'));
        await show('#webbuildQuickTestBtn'); await hold(900);
        await page.locator('#webbuildQuickTestBtn').click();
      });
    },
    async 'stroke-runtime'() {
      await page.waitForFunction(() => window.__wb_debug.getWebbuildDebugState().iframe?.legacyPreview?.runtime_activation_status === 'activated', null, {timeout: 18000});
      await record(async () => {
        await show('#webbuildFrame'); await hold(1300); await anchor('runtime');
        receipt.flows[currentFlow].runtimeBefore = await probe();
        const runtime = page.frame({url: /\/termpp-web-flat\/index.html/});
        await runtime.locator('#asciicker_canvas').click();
        await page.keyboard.down('w'); await hold(1200); await page.keyboard.up('w');
        await page.keyboard.down('d'); await hold(1200); await page.keyboard.up('d');
        receipt.flows[currentFlow].runtimeAfter = await probe();
        const flow = receipt.flows[currentFlow];
        assert.equal(flow.runtimeAfter.worldReady, 1);
        assert.equal(flow.runtimeAfter.skin.runtime_activation_status, 'activated');
        assert.notDeepEqual(flow.runtimeBefore.pos, flow.runtimeAfter.pos, 'real keyboard input moves the player');
        flow.dock = await page.locator('#docContractDock').innerText();
        assert.match(flow.dock, /tracks current document/);
        flow.debug = await page.evaluate(() => window.__wb_debug.getWebbuildDebugState());
        await hold(900); await anchor('runtime-after-movement');
      });
    },
    async 'png-setup'() {
      await open('png-sheet-glyph-filter');
      await record(async () => {
        await applyIdle(); await show('#uploadConvertPanel');
        await page.locator('#wbName').fill('knight-cp437-demo');
        await page.locator('#wbFile').setInputFiles(PNG);
        await page.locator('#wbAssignmentMode').selectOption('rich');
        await hold(1600); await anchor('rich-filter-selected');
        await page.locator('#wbUpload').click();
        await page.waitForFunction(() => !document.querySelector('#wbRun').disabled);
        await hold(900); await page.locator('#wbRun').click();
      });
      receipt.flows[currentFlow].input = {path: path.relative(ROOT, PNG), sha256: sha(await fs.readFile(PNG)), mode: 'rich'};
    },
    async 'png-result'() {
      await page.waitForFunction(() => window.__wb_debug.getState().jobId && window.__wholeSheetEditor?.getState().sessionKind === 'pipeline_job', null, {timeout: 18000});
      await record(async () => {
        await show('#uploadConvertPanel'); await hold(1200);
        await show('#wholeSheetScroll'); await hold(1800); await anchor('converted');
        const document = await doc();
        const glyphs = [...new Set(document.layers[2].filter(c=>c.glyph > 32).map(c=>c.glyph))];
        assert.ok(glyphs.some(g=>![219,220,223].includes(g)), 'Rich filter produces CP437 glyphs beyond half blocks');
        assert.equal(receipt.conversionRequest.assignment_mode, 'rich');
        receipt.flows[currentFlow].conversion = {glyphs, state: await wb(), documentSha256: sha(JSON.stringify(document))};
        const event = page.waitForEvent('download'); await page.locator('#btnExport').click();
        await (await event).saveAs(path.join(OUT, 'knight-cp437.xp'));
        await hold(700);
      });
    },
    async encode() {
      const titles = {'browse-xp-sprites': 'Browse 287 upstream XP sprites / Open editable copy',
        'stroke-to-runtime': 'Slope-brush strokes / Save XP / Test This Skin / Keyboard movement',
        'png-sheet-glyph-filter': 'PNG sprite sheet / Rich CP437 glyph filter / Converted XP'};
      for (const [name, flow] of Object.entries(receipt.flows)) {
        assert.ok(flow.frames > 10, `${name} has a real capture sequence`);
        const output = path.join(MEDIA, `${name}.gif`);
        execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-framerate','8','-i',path.join(OUT,name,'frame-%05d.png'),
          '-filter_complex', `scale=1080:-1:flags=lanczos,pad=iw:ih+44:0:44:color=0x141b26,drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text='${titles[name]}':fontsize=21:fontcolor=white:x=18:y=12,split[a][b];[a]palettegen=max_colors=192[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
          '-loop','0',output], {timeout: 20000});
        const bytes = await fs.readFile(output);
        flow.gif = {path: path.relative(ROOT,output), bytes: bytes.length, sha256: sha(bytes), durationSeconds: flow.frames / 8};
      }
      await persist();
    },
    async close() { await context?.close(); await browser.close(); app.kill('SIGTERM'); await serverLog.close(); },
  };
  const server = http.createServer(async (request,response) => {
    const step = request.url.slice(1);
    if (!steps[step] || busy) { response.writeHead(400); response.end('Unknown step or busy'); return; }
    busy = true;
    const entry = {step, started: new Date().toISOString()};
    try { await steps[step](); entry.passed = true; }
    catch (error) { entry.passed = false; entry.error = error.stack; if (page && !page.isClosed()) await page.screenshot({path:path.join(OUT, `${step}-failure.png`)}).catch(()=>{}); }
    entry.finished = new Date().toISOString(); receipt.stages.push(entry); await persist(); busy = false;
    response.writeHead(entry.passed ? 200 : 500, {'Content-Type':'application/json'});
    response.end(JSON.stringify({entry, flows: Object.fromEntries(Object.entries(receipt.flows).map(([key,value])=>[key,{frames:value.frames,gif:value.gif}]))}));
    if (step === 'close') server.close();
  });
  server.listen(5094, '127.0.0.1', () => process.send?.({ready: true, pid: process.pid, serverPid: app.pid, control: CONTROL, outDir: OUT}));
}
