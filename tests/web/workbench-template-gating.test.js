/**
 * Unit tests for web/workbench-template-gating.js
 *
 * Covers isTemplateActionAuthorable() and getEnabledActions() with full branch
 * coverage including the proof_only:true exclusion called out in the Step 11
 * canonical spec (2026-04-18).
 *
 * Run with: node tests/web/workbench-template-gating.test.js
 */

"use strict";

const {
  isTemplateActionAuthorable,
  getEnabledActions,
} = require("../../web/workbench-template-gating");

// ── minimal test harness (matches pattern used across tests/web/) ─────────────

class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  describe(suiteName, suiteFunc) {
    console.log(`\n${suiteName}`);
    suiteFunc();
  }

  it(testName, testFunc) {
    try {
      testFunc();
      this.passed++;
      console.log(`  \u2713 ${testName}`);
    } catch (error) {
      this.failed++;
      console.log(`  \u2717 ${testName}`);
      console.log(`    ${error.message}`);
    }
  }

  report() {
    console.log(`\n${this.passed} passed, ${this.failed} failed`);
    process.exit(this.failed > 0 ? 1 : 0);
  }
}

const expect = (value) => ({
  toBe(expected) {
    if (value !== expected) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
    }
  },
  toEqual(expected) {
    const a = JSON.stringify(value);
    const b = JSON.stringify(expected);
    if (a !== b) {
      throw new Error(`Expected ${b}, got ${a}`);
    }
  },
  toBeTrue() {
    if (value !== true) throw new Error(`Expected true, got ${JSON.stringify(value)}`);
  },
  toBeFalse() {
    if (value !== false) throw new Error(`Expected false, got ${JSON.stringify(value)}`);
  },
  toDeepEqual(expected) {
    const a = JSON.stringify(value);
    const b = JSON.stringify(expected);
    if (a !== b) {
      throw new Error(`Expected ${b}, got ${a}`);
    }
  },
});

const runner = new TestRunner();
const describe = runner.describe.bind(runner);
const it = runner.it.bind(runner);

// ── shared fixtures ───────────────────────────────────────────────────────────

/** Minimal valid registry with one skin family and one prefix. */
function makeRegistry({ authorable = true, proof_only = false } = {}) {
  return {
    schema_version: 2,
    skin_family_scope: {
      humanoid: {
        authorable,
        proof_only,
        on_foot_prefixes: ["hero_idle"],
        mounted_prefixes: [],
        deferred_prefixes: [],
      },
    },
    prefix_catalog: {
      "hero_idle": {
        filename_prefix: "hero_idle",
        skin_family: "humanoid",
        preview_xp: "assets/hero_idle_preview.xp",
        l0_ref: "assets/hero_idle_l0.xp",
        authorable: true,
        template_actions: [],
      },
    },
    template_sets: {},
  };
}

/** Template-set descriptor (ts) for tests. */
function makeTs({ skin_family_scope = null, actions = null } = {}) {
  const ts = {};
  if (skin_family_scope !== null) ts.skin_family_scope = skin_family_scope;
  if (actions !== null) ts.actions = actions;
  return ts;
}

/** Minimal valid action spec. */
function makeSpec(overrides = {}) {
  return {
    filename_prefix: "hero_idle",
    skin_family: "humanoid",
    ...overrides,
  };
}

// ── isTemplateActionAuthorable tests ─────────────────────────────────────────

describe("isTemplateActionAuthorable — happy path", () => {
  it("returns true when all conditions are satisfied (no template_actions list)", () => {
    const registry = makeRegistry();
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeTrue();
  });

  it("returns true when template_actions list has a matching entry", () => {
    const registry = makeRegistry();
    registry.prefix_catalog["hero_idle"].template_actions = [
      { template_set_key: "base", action_key: "idle" },
    ];
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "base")).toBeTrue();
  });

  it("falls back to spec.family when spec.filename_prefix is absent", () => {
    const registry = makeRegistry();
    // The prefix_catalog key must match the resolved prefix.
    registry.prefix_catalog["hero_idle"].filename_prefix = "hero_idle";
    const ts = makeTs();
    const spec = { family: "hero_idle", skin_family: "humanoid" }; // no filename_prefix
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeTrue();
  });
});

describe("isTemplateActionAuthorable — spec guard failures", () => {
  it("returns false when spec.filename_prefix and spec.family are both empty", () => {
    const registry = makeRegistry();
    const ts = makeTs();
    const spec = { filename_prefix: "", skin_family: "humanoid" };
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });

  it("returns false when spec.skin_family is empty", () => {
    const registry = makeRegistry();
    const ts = makeTs();
    const spec = { filename_prefix: "hero_idle", skin_family: "" };
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });

  it("returns false when spec is null", () => {
    const registry = makeRegistry();
    const ts = makeTs();
    expect(isTemplateActionAuthorable(ts, "idle", null, registry, "")).toBeFalse();
  });

  it("returns false when spec is undefined", () => {
    const registry = makeRegistry();
    const ts = makeTs();
    expect(isTemplateActionAuthorable(ts, "idle", undefined, registry, "")).toBeFalse();
  });
});

describe("isTemplateActionAuthorable — template-set scope guard", () => {
  it("returns false when ts.skin_family_scope is set but does not include the spec skin_family", () => {
    const registry = makeRegistry();
    const ts = makeTs({ skin_family_scope: ["beast"] }); // 'humanoid' is not in scope
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });

  it("returns true when ts.skin_family_scope includes the spec skin_family", () => {
    const registry = makeRegistry();
    const ts = makeTs({ skin_family_scope: ["humanoid", "beast"] });
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeTrue();
  });

  it("returns false when ts.skin_family_scope is an empty array", () => {
    const registry = makeRegistry();
    const ts = makeTs({ skin_family_scope: [] });
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });

  it("skips template-set scope check when ts.skin_family_scope is absent (null case)", () => {
    const registry = makeRegistry();
    const ts = makeTs(); // no skin_family_scope key
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeTrue();
  });
});

describe("isTemplateActionAuthorable — familyScope registry guard", () => {
  it("returns false when skin_family is not present in registry.skin_family_scope", () => {
    const registry = makeRegistry();
    delete registry.skin_family_scope["humanoid"]; // remove the family
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });

  it("returns false when familyScope.authorable === false", () => {
    const registry = makeRegistry({ authorable: false });
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });

  it("returns false when familyScope.proof_only === true (Step 11 explicit blocker)", () => {
    const registry = makeRegistry({ proof_only: true });
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });

  it("returns false when familyScope.proof_only === true even if authorable is not set to false", () => {
    const registry = makeRegistry({ authorable: true, proof_only: true });
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });

  it("honors an explicit family authorable_template_sets allowlist", () => {
    const registry = makeRegistry();
    registry.skin_family_scope.humanoid.authorable_template_sets = ["approved"];
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "approved")).toBeTrue();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "other")).toBeFalse();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });

  it("returns false when registry itself is null", () => {
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, null, "")).toBeFalse();
  });

  it("returns false when registry.skin_family_scope is missing", () => {
    const registry = makeRegistry();
    delete registry.skin_family_scope;
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });
});

describe("isTemplateActionAuthorable — prefixSpec catalog guard", () => {
  it("returns false when prefix is not in registry.prefix_catalog", () => {
    const registry = makeRegistry();
    delete registry.prefix_catalog["hero_idle"];
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });

  it("returns false when prefixSpec.filename_prefix does not match the resolved prefix", () => {
    const registry = makeRegistry();
    registry.prefix_catalog["hero_idle"].filename_prefix = "hero_attack"; // mismatch
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });

  it("returns false when prefixSpec.skin_family does not match spec.skin_family", () => {
    const registry = makeRegistry();
    registry.prefix_catalog["hero_idle"].skin_family = "beast"; // mismatch
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });

  it("returns false when prefixSpec.authorable === false", () => {
    const registry = makeRegistry();
    registry.prefix_catalog["hero_idle"].authorable = false;
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });

  it("returns false when registry.prefix_catalog is missing", () => {
    const registry = makeRegistry();
    delete registry.prefix_catalog;
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });
});

describe("isTemplateActionAuthorable — template_actions linking guard", () => {
  it("returns false when template_actions exist but templateSetKey is empty", () => {
    const registry = makeRegistry();
    registry.prefix_catalog["hero_idle"].template_actions = [
      { template_set_key: "base", action_key: "idle" },
    ];
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "")).toBeFalse();
  });

  it("returns false when template_actions exist but no entry matches actionKey", () => {
    const registry = makeRegistry();
    registry.prefix_catalog["hero_idle"].template_actions = [
      { template_set_key: "base", action_key: "attack" }, // wrong action
    ];
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "base")).toBeFalse();
  });

  it("returns false when template_actions exist but no entry matches templateSetKey", () => {
    const registry = makeRegistry();
    registry.prefix_catalog["hero_idle"].template_actions = [
      { template_set_key: "special", action_key: "idle" }, // wrong template_set_key
    ];
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "base")).toBeFalse();
  });

  it("returns true when template_actions has an entry matching both keys", () => {
    const registry = makeRegistry();
    registry.prefix_catalog["hero_idle"].template_actions = [
      { template_set_key: "special", action_key: "attack" },
      { template_set_key: "base", action_key: "idle" }, // this one matches
    ];
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "base")).toBeTrue();
  });

  it("handles template_actions entries with null/undefined values gracefully", () => {
    const registry = makeRegistry();
    registry.prefix_catalog["hero_idle"].template_actions = [
      null,
      undefined,
      { template_set_key: null, action_key: undefined },
      { template_set_key: "base", action_key: "idle" },
    ];
    const ts = makeTs();
    const spec = makeSpec();
    expect(isTemplateActionAuthorable(ts, "idle", spec, registry, "base")).toBeTrue();
  });
});

// ── getEnabledActions tests ───────────────────────────────────────────────────

describe("getEnabledActions — basic cases", () => {
  it("returns {} when ts is null", () => {
    expect(getEnabledActions(null, makeRegistry(), "")).toDeepEqual({});
  });

  it("returns {} when ts is undefined", () => {
    expect(getEnabledActions(undefined, makeRegistry(), "")).toDeepEqual({});
  });

  it("returns {} when ts.actions is absent", () => {
    expect(getEnabledActions({}, makeRegistry(), "")).toDeepEqual({});
  });

  it("returns {} when ts.actions is empty", () => {
    const ts = makeTs({ actions: {} });
    expect(getEnabledActions(ts, makeRegistry(), "")).toDeepEqual({});
  });

  it("returns only the authorable action from a single-action ts", () => {
    const registry = makeRegistry();
    const spec = makeSpec();
    const ts = makeTs({ actions: { idle: spec } });
    const result = getEnabledActions(ts, registry, "");
    expect(result).toDeepEqual({ idle: spec });
  });

  it("excludes actions that fail the authorability gate", () => {
    const registry = makeRegistry();
    const goodSpec = makeSpec(); // hero_idle / humanoid — passes
    const badSpec = { filename_prefix: "ghost_idle", skin_family: "undead" }; // undead not in registry
    const ts = makeTs({ actions: { idle: goodSpec, death: badSpec } });
    const result = getEnabledActions(ts, registry, "");
    expect(Object.keys(result)).toDeepEqual(["idle"]);
  });
});

describe("getEnabledActions — registry-declared ordering", () => {
  it("orders actions by the family prefix topology, not action-name constants", () => {
    // Registry supports three prefixes so all three actions can pass.
    const registry = makeRegistry();
    registry.skin_family_scope.humanoid.on_foot_prefixes = [
      "hero_idle",
      "hero_attack",
      "hero_death",
    ];
    for (const key of ["hero_attack", "hero_death"]) {
      registry.prefix_catalog[key] = {
        filename_prefix: key,
        skin_family: "humanoid",
        preview_xp: `assets/${key}_preview.xp`,
        l0_ref: `assets/${key}_l0.xp`,
        authorable: true,
        template_actions: [],
      };
    }
    const actions = {
      death: makeSpec({ filename_prefix: "hero_death" }),
      attack: makeSpec({ filename_prefix: "hero_attack" }),
      idle: makeSpec({ filename_prefix: "hero_idle" }),
    };
    const ts = makeTs({ actions });
    const result = getEnabledActions(ts, registry, "");
    expect(Object.keys(result)).toDeepEqual(["idle", "attack", "death"]);
  });

  it("places an unlisted prefix after registry-listed prefixes", () => {
    const registry = makeRegistry();
    registry.prefix_catalog["hero_taunt"] = {
      filename_prefix: "hero_taunt",
      skin_family: "humanoid",
      preview_xp: "assets/hero_taunt_preview.xp",
      l0_ref: "assets/hero_taunt_l0.xp",
      authorable: true,
      template_actions: [],
    };
    const actions = {
      taunt: makeSpec({ filename_prefix: "hero_taunt" }),
      idle: makeSpec({ filename_prefix: "hero_idle" }),
    };
    const ts = makeTs({ actions });
    const result = getEnabledActions(ts, registry, "");
    const keys = Object.keys(result);
    expect(keys[0]).toBe("idle");
    expect(keys[1]).toBe("taunt");
  });
});

describe("getEnabledActions — integration with proof_only exclusion", () => {
  it("excludes all actions when skin family has proof_only: true", () => {
    const registry = makeRegistry({ proof_only: true });
    const ts = makeTs({ actions: { idle: makeSpec() } });
    expect(getEnabledActions(ts, registry, "")).toDeepEqual({});
  });

  it("excludes all actions when skin family has authorable: false", () => {
    const registry = makeRegistry({ authorable: false });
    const ts = makeTs({ actions: { idle: makeSpec() } });
    expect(getEnabledActions(ts, registry, "")).toDeepEqual({});
  });
});

// ── run ───────────────────────────────────────────────────────────────────────

runner.report();
