const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const workbench = fs.readFileSync(path.join(root, 'web/workbench.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'web/termpp_flat_map_bootstrap.js'), 'utf8');

assert.ok(!workbench.includes('u.searchParams.set("_wb"'));
assert.ok(!workbench.includes('frame.src = "about:blank"'));
assert.ok(workbench.includes('frame.src = nextSrc'));
assert.ok(bootstrap.includes('scheduleAutoStartGame();'));
assert.ok(bootstrap.includes('window.StartGame()'));
assert.ok(bootstrap.includes('window._wasmReady !== true'));

console.log('skin dock runtime contract tests passed');
