/**
 * workbench-template-gating.js
 *
 * Pure template-action authorability logic extracted from workbench.js for
 * unit testing.  Functions here take registry/templateSetKey as explicit
 * parameters so they can be exercised without a live browser state closure.
 *
 * workbench.js keeps thin wrapper functions that forward state.templateRegistry
 * and state.templateSetKey into these pure implementations.
 *
 * Dual-export: browser (<script> tag sets window.__workbenchTemplateGating)
 *              Node.js  (module.exports for unit tests via require())
 */

"use strict";

/**
 * Pure implementation of the template-action authorability gate.
 *
 * Returns true iff the action described by (ts, actionKey, spec) is
 * authorable given the supplied registry snapshot and template-set key.
 *
 * @param {object|null}  ts             - Template-set descriptor (from registry.template_sets[key])
 * @param {string}       actionKey      - Action key (e.g. "idle", "attack")
 * @param {object|null}  spec           - Action spec from ts.actions[actionKey]
 * @param {object|null}  registry       - Full normalized template registry object
 * @param {string}       templateSetKey - Current state.templateSetKey
 * @returns {boolean}
 */
function isTemplateActionAuthorable(ts, actionKey, spec, registry, templateSetKey) {
  const prefix = String(spec?.filename_prefix || spec?.family || "").trim();
  const skinFamily = String(spec?.skin_family || "").trim();
  if (!prefix || !skinFamily) return false;

  const templateScope = Array.isArray(ts?.skin_family_scope)
    ? new Set(ts.skin_family_scope.map((value) => String(value || "").trim()).filter(Boolean))
    : null;
  if (templateScope !== null && (!templateScope.size || !templateScope.has(skinFamily))) return false;

  const familyScope = registry?.skin_family_scope?.[skinFamily];
  if (!familyScope || familyScope.authorable === false || familyScope.proof_only === true) return false;

  const allowedTemplateSets = Array.isArray(familyScope.authorable_template_sets)
    ? familyScope.authorable_template_sets.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const tsk = String(templateSetKey || "").trim();
  if (allowedTemplateSets.length && (!tsk || !allowedTemplateSets.includes(tsk))) return false;

  const prefixSpec = registry?.prefix_catalog?.[prefix];
  if (!prefixSpec) return false;
  if (String(prefixSpec.filename_prefix || "").trim() !== prefix) return false;
  if (String(prefixSpec.skin_family || "").trim() !== skinFamily) return false;
  if (prefixSpec.authorable === false) return false;

  const templateActions = Array.isArray(prefixSpec.template_actions) ? prefixSpec.template_actions : [];
  if (templateActions.length) {
    if (!tsk) return false;
    const linked = templateActions.some((entry) => (
      String(entry?.template_set_key || "").trim() === tsk &&
      String(entry?.action_key || "").trim() === actionKey
    ));
    if (!linked) return false;
  }
  return true;
}

/**
 * Build the stable action order from the normalized registry's prefix topology.
 * Family prefix arrays are authoritative; unlisted prefixes fall back to a
 * deterministic lexical order rather than a hard-coded action vocabulary.
 */
function compareTemplateActions(registry, left, right) {
  const resolve = ([actionKey, spec]) => {
    const prefix = String(spec?.filename_prefix || spec?.family || "").trim();
    const skinFamily = String(spec?.skin_family || "").trim();
    const familyScope = registry?.skin_family_scope?.[skinFamily];
    const prefixOrder = [
      ...(Array.isArray(familyScope?.on_foot_prefixes) ? familyScope.on_foot_prefixes : []),
      ...(Array.isArray(familyScope?.mounted_prefixes) ? familyScope.mounted_prefixes : []),
      ...(Array.isArray(familyScope?.deferred_prefixes) ? familyScope.deferred_prefixes : []),
    ].map((value) => String(value || "").trim());
    const rank = prefixOrder.indexOf(prefix);
    return {
      actionKey,
      prefix,
      skinFamily,
      rank: rank < 0 ? Number.MAX_SAFE_INTEGER : rank,
    };
  };

  const a = resolve(left);
  const b = resolve(right);
  return a.skinFamily.localeCompare(b.skinFamily)
    || a.rank - b.rank
    || a.prefix.localeCompare(b.prefix)
    || a.actionKey.localeCompare(b.actionKey);
}

/**
 * Returns the subset of ts.actions that are authorable, ordered by registry
 * family/prefix topology (with deterministic fallback for unlisted prefixes).
 *
 * @param {object|null}  ts             - Template-set descriptor
 * @param {object|null}  registry       - Full normalized template registry object
 * @param {string}       templateSetKey - Current state.templateSetKey
 * @returns {object}  Plain object keyed by action key, canonical order first
 */
function getEnabledActions(ts, registry, templateSetKey) {
  if (!ts || !ts.actions) return {};
  const entries = [];
  for (const [key, spec] of Object.entries(ts.actions)) {
    if (isTemplateActionAuthorable(ts, key, spec, registry, templateSetKey)) entries.push([key, spec]);
  }
  entries.sort((left, right) => compareTemplateActions(registry, left, right));
  const out = {};
  for (const [key, spec] of entries) out[key] = spec;
  return out;
}

// ── exports ──────────────────────────────────────────────────────────────────

if (typeof module !== "undefined" && module.exports) {
  // Node.js / CommonJS (unit tests)
  module.exports = { isTemplateActionAuthorable, getEnabledActions };
} else if (typeof window !== "undefined") {
  // Browser (<script src="/workbench-template-gating.js"> loaded before workbench.js)
  window.__workbenchTemplateGating = { isTemplateActionAuthorable, getEnabledActions };
}
