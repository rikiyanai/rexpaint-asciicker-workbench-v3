"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = process.cwd();
const webScriptPath = path.join(repoRoot, "web", "termpp_skin_lab.js");
const runtimeScriptPath = path.join(repoRoot, "runtime", "termpp-skin-lab-static", "termpp_skin_lab.js");
const workbenchPath = path.join(repoRoot, "web", "workbench.js");
const bootstrapPath = path.join(
  repoRoot,
  "runtime",
  "termpp-skin-lab-static",
  "termpp-web-flat",
  "legacy_skin_preview_bootstrap.js",
);
const runtimeIndexPath = path.join(
  repoRoot,
  "runtime",
  "termpp-skin-lab-static",
  "termpp-web-flat",
  "index.html",
);

const webScript = fs.readFileSync(webScriptPath, "utf8");
const runtimeScript = fs.readFileSync(runtimeScriptPath, "utf8");
const workbench = fs.readFileSync(workbenchPath, "utf8");
const bootstrap = fs.readFileSync(bootstrapPath, "utf8");
const runtimeIndex = fs.readFileSync(runtimeIndexPath, "utf8");

assert.strictEqual(webScript, runtimeScript, "Skin Lab source and packaged copy must remain byte-identical");

for (const removedOwner of [
  "FS_createDataFile",
  "FS.writeFile",
  "emfsReplaceFile",
  "injectXp",
  "/assets/sprites/",
]) {
  assert.ok(!webScript.includes(removedOwner), `Skin Lab must not retain post-init writer ${removedOwner}`);
}

assert.ok(webScript.includes('/api/workbench/legacy-preview-token'));
assert.ok(webScript.includes('skin_preview_token'));
assert.ok(webScript.includes('/termpp-web-flat/index.html'));

assert.ok(bootstrap.includes('module.preRun.push'));
assert.ok(bootstrap.includes('module.addRunDependency'));
assert.ok(bootstrap.includes('var allowedFamilies = { player: 0, wolfie: 1 }'));
assert.ok(bootstrap.includes('expectedTargets.push("/sprites/" + family'));
assert.ok(bootstrap.includes('waitForPackagedTarget(fs, targetPath'));
assert.ok(bootstrap.includes('fs.writeFile(installPath, bytes.slice()'));
assert.ok(bootstrap.includes('actual_sha256_by_path'));
assert.ok(bootstrap.includes('installed_target_count'));
assert.ok(bootstrap.includes('runtime_activation_status'));
assert.ok(bootstrap.includes('window.Keyb(0, 108)'));
assert.ok(bootstrap.includes('window.Keyb(1, 108)'));
assert.ok(workbench.includes('waitForLegacyPreviewRuntimeActivation(tokenPayload.family)'));
assert.ok(!bootstrap.includes('player-nude.xp'));
assert.ok(!bootstrap.includes('/assets/sprites/'));

const bootstrapIndex = runtimeIndex.indexOf('legacy_skin_preview_bootstrap.js');
const engineIndex = runtimeIndex.indexOf('src=index.js');
assert.ok(bootstrapIndex >= 0, "preview bootstrap script must be present");
assert.ok(engineIndex >= 0, "engine script must be present");
assert.ok(bootstrapIndex < engineIndex, "preview bootstrap must execute before index.js");

console.log("termpp skin lab preview ownership checks passed");
