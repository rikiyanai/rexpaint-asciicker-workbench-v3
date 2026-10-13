"use strict";

const assert = require("node:assert/strict");
const registry = require("../../config/template_registry.json");
const {
  buildRegistryActionCoverage,
  getRegistryActionNavigation,
} = require("../../web/workbench-action-navigation");

let passed = 0;
let failed = 0;

function test(name, run) {
  try {
    run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

console.log("workbench-action-navigation registry model");

test("exposes all currently authorable on-foot and mounted prefixes", () => {
  const model = buildRegistryActionCoverage(registry);
  assert.equal(model.valid, true);
  const activePrefixes = [...new Set(model.actions
    .filter((action) => action.classification === "authorable")
    .map((action) => action.prefix))].sort();
  assert.deepEqual(activePrefixes, ["attack", "player", "plydie", "wolack", "wolfie"]);

  const mounted = getRegistryActionNavigation(registry, "mounted_native_full");
  assert.equal(mounted.selectionValid, true);
  assert.deepEqual(mounted.selectedActions.map((action) => action.prefix), ["wolfie", "wolack"]);
  assert.ok(mounted.selectedActions.every((action) => action.authorable && action.mounted));
});

test("retains the deferred bigbee prefix and registry blockers", () => {
  const model = buildRegistryActionCoverage(registry);
  const human = model.families.find((family) => family.skinFamily === "human");
  const bigbee = human.prefixes.find((prefix) => prefix.prefix === "bigbee");
  assert.equal(bigbee.classification, "deferred");
  assert.equal(bigbee.authorable, false);
  assert.ok(bigbee.blockers.includes("explicitly_deferred_in_canon"));
});

test("retains proof-only green prefixes from family scope even without catalog actions", () => {
  const model = buildRegistryActionCoverage(registry);
  const green = model.families.find((family) => family.skinFamily === "green");
  assert.equal(green.classification, "proof-only");
  assert.deepEqual(green.prefixes.map((prefix) => prefix.prefix), [
    "player-green",
    "attack-green",
    "plydie-green",
  ]);
  assert.ok(green.prefixes.every((prefix) => prefix.classification === "proof-only"));
  assert.ok(green.prefixes.every((prefix) => prefix.actions.length === 0));
});

test("fails closed for a missing registry", () => {
  const model = buildRegistryActionCoverage(null);
  assert.equal(model.valid, false);
  assert.deepEqual(model.actions, []);
  assert.deepEqual(model.families, []);
  assert.ok(model.errors.includes("registry must be an object"));
});

test("fails closed for an invalid registry instead of inventing navigation", () => {
  const invalid = structuredClone(registry);
  invalid.prefix_catalog.player.filename_prefix = "not-player";
  const model = buildRegistryActionCoverage(invalid);
  assert.equal(model.valid, false);
  assert.deepEqual(model.actions, []);
  assert.ok(model.errors.some((error) => error.includes("filename_prefix must match its key")));
});

test("action order follows registry prefix topology despite reordered object keys", () => {
  const reordered = structuredClone(registry);
  const actions = Object.entries(reordered.template_sets.player_native_full.actions).reverse();
  reordered.template_sets.player_native_full.actions = Object.fromEntries(actions);
  const player = getRegistryActionNavigation(reordered, "player_native_full");
  assert.deepEqual(player.selectedActions.map((action) => action.actionKey), ["idle", "attack", "death"]);

  const mounted = getRegistryActionNavigation(reordered, "mounted_native_full");
  assert.deepEqual(mounted.selectedActions.map((action) => action.actionKey), ["mounted_idle", "mounted_attack"]);
});

test("unknown selected template set is reported without hiding registry classifications", () => {
  const model = getRegistryActionNavigation(registry, "missing-template-set");
  assert.equal(model.selectionValid, false);
  assert.deepEqual(model.selectedActions, []);
  assert.equal(model.families.find((family) => family.skinFamily === "green").classification, "proof-only");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
