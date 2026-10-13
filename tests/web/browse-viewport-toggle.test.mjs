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
const css = fs.readFileSync(path.join(repoRoot, 'web', 'styles.css'), 'utf8');

function matchingDetailsEnd(source, start) {
  const tags = /<\/?details\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tags.exec(source))) {
    if (match[0].startsWith('</')) depth -= 1;
    else depth += 1;
    if (depth === 0) return match.index + match[0].length;
  }
  return -1;
}

test('viewport toggle lives on Browse/home chrome, outside diagnostics', () => {
  const toolbar = html.match(/<div id="productToolbar"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
  assert.match(toolbar, /id="viewportToggleBtn"/, 'toggle must sit in the persistent product toolbar');
  assert.match(toolbar, /aria-pressed="false"/, 'toggle exposes pressed state for assistive tech');
  const advancedStart = html.indexOf('<details id="advancedDiagnostics"');
  const advancedEnd = matchingDetailsEnd(html, advancedStart);
  assert.ok(advancedStart >= 0 && advancedEnd > advancedStart);
  const toggleIndex = html.indexOf('id="viewportToggleBtn"');
  assert.ok(toggleIndex >= 0 && toggleIndex < advancedStart, 'toggle must be reachable without opening Advanced / Diagnostics');
  assert.equal((html.match(/id="viewportToggleBtn"/g) || []).length, 1, 'one toggle owner');
});

test('viewport toggle flips layout and persists as a Tier C UI preference', () => {
  assert.match(workbenchJs, /const VIEWPORT_MODE_STORAGE_KEY = "wb_viewport_mode_v1"/);
  assert.match(workbenchJs, /function getViewportMode\(\)/);
  assert.match(workbenchJs, /function setViewportMode\(mode\)/);
  assert.match(workbenchJs, /document\.body\.classList\.toggle\("wb-viewport-mobile", mobile\)/);
  assert.match(workbenchJs, /btn\.textContent = mobile \? "Desktop view" : "Mobile view"/);
  assert.match(workbenchJs, /\$\("viewportToggleBtn"\)\?\.addEventListener\("click"/);
  assert.match(workbenchJs, /setViewportMode\(getViewportMode\(\)\)/, 'persisted mode applies on boot');
  assert.match(workbenchJs, /localStorage\.setItem\(VIEWPORT_MODE_STORAGE_KEY, next\)/);
  assert.match(workbenchJs, /getViewportMode: \(\) => getViewportMode\(\)/, 'deterministic audit hook');
});

test('390px is clean: panels stack, fixed canvases stay contained', () => {
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.two-col \{\s*grid-template-columns: 1fr;/);
  assert.match(css, /\.two-col > \* \{\s*min-width: 0;/);
  assert.match(css, /body\.wb-viewport-mobile \.wrap \{\s*max-width: 390px;/);
  assert.match(css, /body\.wb-viewport-mobile \.ws-mobile-top-bar \{\s*display: flex;/);
  assert.match(css, /body\.wb-viewport-mobile \.ws-mobile-bottom-bar \{\s*display: flex;/);
  assert.match(css, /body\.wb-viewport-mobile \.ws-drawer \{/);
  assert.match(css, /body\.wb-viewport-mobile \.frame-grid \{/);
  assert.match(css, /grid-template-columns: none !important;/);
});

test('mobile controls cover select/import/tools/glyph/undo/save/export/test', () => {
  for (const toggle of ['tools', 'layers', 'info']) {
    assert.match(html, new RegExp(`data-drawer-toggle="${toggle}"`), `${toggle} drawer reachable from mobile chrome`);
  }
  assert.match(html, /id="productMobileBrowseBtn"/, 'Browse reachable from mobile chrome');
  assert.match(html, /data-action="import-png"/, 'Import reachable from mobile chrome');
  assert.match(html, /id="mobileKeyboardBtn"/, 'Keyboard reachable from mobile chrome');
  assert.match(html, /id="undoBtn"/, 'undo stays available');
  assert.match(html, /id="redoBtn"/, 'redo stays available');
  const toolbar = html.match(/<div id="productToolbar"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
  for (const id of ['btnSave', 'btnExport', 'webbuildQuickTestBtn']) {
    assert.match(toolbar, new RegExp(`id="${id}"`), `${id} stays in persistent chrome on small screens`);
  }
  assert.match(wholeSheetJs, /wsGlyphPickerCanvas/, 'glyph picker owned by the root editor');
  assert.match(wholeSheetJs, /wsGlyphCode/, 'glyph code input owned by the root editor');
});

test('keyboard reaches Text mode; emulation counts as narrow', () => {
  assert.match(workbenchJs, /\$\("mobileKeyboardBtn"\)\?\.addEventListener\("click", \(\) => \{\s*setProductShellMode\("edit"\)/);
  assert.match(wholeSheetJs, /function openMobileKeyboard\(\)/);
  assert.match(wholeSheetJs, /_setMode\('paint'\)[\s\S]*?_switchTool\('text'\)/);
  assert.match(wholeSheetJs, /document\.body\.classList\.contains\('wb-viewport-mobile'\)/);
  assert.match(wholeSheetJs, /if \(!input \|\| !narrowViewport\) return false;/);
});

test('PNG import promotes wbFile/wbUpload/wbRun in place with no cloned handlers', () => {
  assert.equal((html.match(/id="wbFile"/g) || []).length, 1, 'one file input owner');
  assert.equal((html.match(/id="wbUpload"/g) || []).length, 1, 'one upload button owner');
  assert.equal((html.match(/id="wbRun"/g) || []).length, 1, 'one convert button owner');
  assert.equal((workbenchJs.match(/\$\("wbUpload"\)\.addEventListener\("click", wbUpload\)/g) || []).length, 1);
  assert.equal((workbenchJs.match(/\$\("wbRun"\)\.addEventListener\("click", wbRun\)/g) || []).length, 1);
  assert.match(workbenchJs, /\$\("browseImportPngBtn"\)\?\.addEventListener\("click", focusPngImport\)/);
  assert.match(workbenchJs, /async function wbUpload\(\)/);
  assert.match(workbenchJs, /async function wbRun\(\)/);
  assert.match(html, /id="xpImportFile"/, 'XP import stays beside PNG conversion in the same flow');
  assert.match(workbenchJs, /onBrowseNewRaw: newRawXp/);
  assert.match(workbenchJs, /async function newRawXp\(\)/);
});

test('kind badges and metadata status surface without layer pollution', () => {
  // Kinds are backend-authored (service.py _SESSION_KINDS); the shell passes
  // session_kind/metadata_status through generically — no frontend kind list.
  assert.match(workbenchJs, /const sessionKind = String\(j\.session_kind \|\| ""\)/);
  assert.match(workbenchJs, /state\.sessionKind = String\(j\.session_kind \|\| ""\)/);
  assert.match(workbenchJs, /state\.metadataStatus = String\(j\.metadata_status \|\| ""\)/);
  assert.match(workbenchJs, /String\(state\.sessionKind \|\| "unknown"\)/);
  assert.match(wholeSheetJs, /if \(item\.session_kind\) details\.push\(String\(item\.session_kind\)\)/);
  assert.match(workbenchJs, /doc: \$\{doc\.session_short\} kind=\$\{doc\.session_kind\} meta=\$\{doc\.metadata_status\}/);
  assert.match(wholeSheetJs, /layersSection\.dataset\.modeScope = 'paint'/);
});
