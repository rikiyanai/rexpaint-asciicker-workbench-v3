import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(repoRoot, 'web', 'workbench.html'), 'utf8');
const workbenchJs = fs.readFileSync(path.join(repoRoot, 'web', 'workbench.js'), 'utf8');
const wholeSheetJs = fs.readFileSync(path.join(repoRoot, 'web', 'whole-sheet-init.js'), 'utf8');
const manifest = fs.readFileSync(path.join(repoRoot, 'web', 'manifest.json'), 'utf8');

function matchingDetailsEnd(source, start) {
  const tags = /<\/?details\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tags.exec(source))) {
    if (/^<details\b/i.test(match[0])) depth += 1;
    else depth -= 1;
    if (depth === 0) return tags.lastIndex;
  }
  return -1;
}

test('Browse is the front door and product actions stay in persistent chrome', () => {
  assert.match(html, /<header id="productShell"[^>]*data-mode="browse"/);
  const toolbar = html.match(/<div id="productToolbar"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
  for (const id of [
    'productBrowseBtn', 'productEditBtn', 'btnNewXp', 'btnOpenFile', 'btnSave',
    'btnExport', 'webbuildQuickTestBtn', 'reportBugBtn',
  ]) {
    assert.match(toolbar, new RegExp(`id="${id}"`), `${id} should be in persistent product chrome`);
  }
  for (const action of ['new', 'save', 'export', 'open-file']) {
    assert.doesNotMatch(html, new RegExp(`data-action="${action}"`), `${action} should not be duplicated in mobile chrome`);
  }
  assert.match(html, /id="productBrowsePanel"[\s\S]*?id="productBrowseSurface"/);
  assert.match(html, /id="productActionNavigation"[^>]*data-integration-hook="registry-action-navigation"/);
  assert.match(html, /<script src="\/workbench-action-navigation\.js"><\/script>[\s\S]*?<script src="\/workbench\.js"><\/script>/);
});

test('the same whole-sheet surface is public in Browse/Edit, diagnostics are collapsed', () => {
  const advancedStart = html.indexOf('<details id="advancedDiagnostics"');
  const advancedEnd = matchingDetailsEnd(html, advancedStart);
  assert.ok(advancedStart >= 0 && advancedEnd > advancedStart, 'expected one balanced Advanced / Diagnostics disclosure');

  const wholeSheetIndex = html.indexOf('id="wholeSheetPanel"');
  const browseIndex = html.indexOf('id="productBrowseSurface"');
  assert.ok(browseIndex >= 0 && browseIndex < advancedStart, 'Browse surface should be outside diagnostics');
  assert.ok(wholeSheetIndex >= 0 && wholeSheetIndex < advancedStart, 'whole-sheet editor should be outside diagnostics');

  const advanced = html.slice(advancedStart, advancedEnd);
  for (const id of ['uiRecorderStartBtn', 'verifyRunBtn', 'termppSkinLaunchBtn', 'cellInspectorPanel', 'reportBugWholeSheetBtn']) {
    assert.match(advanced, new RegExp(`id="${id}"`), `${id} should remain reachable under Advanced / Diagnostics`);
  }
  // PNG conversion is a first-class Browse/mobile step, not buried diagnostics.
  const convertIndex = html.indexOf('id="uploadConvertPanel"');
  assert.ok(convertIndex >= 0 && convertIndex < advancedStart, 'Upload + Convert panel should be top-level, ahead of Advanced / Diagnostics');
  assert.match(html.slice(convertIndex, convertIndex + 2000), /id="wbUpload"/, 'wbUpload should live in the top-level Upload + Convert panel');
  assert.equal((html.match(/id="wholeSheetPanel"/g) || []).length, 1, 'the root editor panel must have one owner');
  assert.equal((html.match(/id="bundleActionTabs"/g) || []).length, 1, 'the registry action-navigation hook must be unique');
  assert.equal((html.match(/id="bundleStatus"/g) || []).length, 1, 'the contextual readiness hook must be unique');
});

test('Browse list and Edit mode delegate to the root whole-sheet owner', () => {
  assert.match(wholeSheetJs, /mode: 'browse'/);
  assert.match(wholeSheetJs, /function mountBrowseApp\(/);
  assert.match(wholeSheetJs, /window\.__wholeSheetEditor\s*=\s*\{[\s\S]*mountBrowseApp[\s\S]*setMode:\s*_setMode/);
  assert.match(wholeSheetJs, /import \{ AdaptiveStrokeTool, SlopeStrokeTool \} from '.\/rexpaint-editor\/tools\/adaptive-stroke-tool\.js\?v=20261012-slope1'/);
  assert.match(wholeSheetJs, /toolSlopeBtn\.id\s*=\s*'wsToolSlope'/);
  assert.match(wholeSheetJs, /case 'slope':[\s\S]*toolActivated\(editorState\.slopeStrokeTool\)/);
  assert.match(wholeSheetJs, /toolAdaptiveBtn\.id\s*=\s*'wsToolAdaptive'/);
  assert.match(wholeSheetJs, /case 'adaptive':[\s\S]*toolActivated\(editorState\.adaptiveStrokeTool\)/);
  assert.match(workbenchJs, /editor\.mountBrowseApp\(\{[\s\S]*onBrowseOpen:\s*browseOpenSession/);
  assert.match(workbenchJs, /editor\.setMode\(next === "browse" \? "browse" : "paint"\)/);
  assert.match(workbenchJs, /whole-sheet-mode-change/);
  assert.match(workbenchJs, /function renderRegistryActionNavigation\(\)/);
  assert.match(workbenchJs, /actionSelect\.id = "registryActionSelect"/);
});

test('product branding and mobile keyboard belong to REXPaint Web', () => {
  assert.match(html, /<title>REXPaint Web — Asciicker<\/title>/);
  assert.match(html, /<h1>REXPaint Web /);
  assert.match(html, /id="mobileKeyboardBtn"/);
  assert.match(html, /id="mobileKeyboardInput"[^>]*inputmode="text"/);
  assert.match(wholeSheetJs, /function openMobileKeyboard\(\)/);
  assert.match(manifest, /"short_name": "REXPaint Web"/);
});

test('developer ID overlay is hidden by default and adds no production button', () => {
  assert.match(workbenchJs, /let on = false;/);
  assert.doesNotMatch(workbenchJs, /toggleBtn\.id = 'wb-id-toggle-btn'/);
});

test('Browse previews the selected whole sheet and Open stays on the visible sheet', () => {
  // Drawer owns a preview canvas + meta (whole sheet first-class, not rows only).
  assert.match(wholeSheetJs, /previewCanvas\.id = 'wsBrowsePreview'/);
  assert.match(wholeSheetJs, /previewMeta\.id = 'wsBrowsePreviewMeta'/);
  // Row select triggers a read-only preview; Open switches to the Edit workspace.
  assert.match(wholeSheetJs, /void _previewBrowseSelected\(\)/);
  assert.match(wholeSheetJs, /async function _previewBrowseSelected\(\)/);
  assert.match(wholeSheetJs, /function _drawBrowsePreview\(canvas, meta, item, preview\)/);
  assert.match(workbenchJs, /async function previewSessionForBrowse\(sessionId\)/);
  // Open leaves Browse: both the drawer and the shell switch to Edit/paint.
  assert.match(wholeSheetJs, /\/\/ Open leaves Browse: the loaded sheet stays visible in the Edit workspace\./);
  assert.match(workbenchJs, /\/\/ Open leaves Browse: the loaded sheet stays visible in Edit\./);
  assert.match(workbenchJs, /setProductShellMode\("edit"\)/);
});

test('Layers stay an Edit concern: no layer chrome in Browse', () => {
  assert.match(wholeSheetJs, /layersSection\.dataset\.modeScope = 'paint'/);
  assert.match(wholeSheetJs, /\/\/ Browse is documents \+ previews: layer chrome stays an Edit concern\./);
  assert.match(wholeSheetJs, /data-drawer="layers"/);
  assert.match(wholeSheetJs, /data-drawer-toggle="layers"/);
});

test('Direct raw-XP authoring is a primary Browse path without template/bundle gate', () => {
  assert.match(wholeSheetJs, /newRawBtn\.id = 'wsBrowseNewRaw'/);
  assert.match(wholeSheetJs, /async function _browseNewRawSelected\(\)/);
  assert.match(wholeSheetJs, /onBrowseNewRaw/);
  assert.match(workbenchJs, /async function newRawXp\(\)/);
  assert.match(workbenchJs, /onBrowseNewRaw: newRawXp/);
  assert.match(workbenchJs, /onBrowsePreview: previewSessionForBrowse/);
});

test('Browse rows surface document kind and link to source slicing', () => {
  assert.match(wholeSheetJs, /if \(item\.session_kind\) details\.push\(String\(item\.session_kind\)\)/);
  assert.match(wholeSheetJs, /sliceBtn\.id = 'wsBrowseSliceSource'/);
  assert.match(wholeSheetJs, /function _browseGotoSourceSlicing\(\)/);
});
