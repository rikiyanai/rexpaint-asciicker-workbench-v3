/**
 * workbench-action-navigation.js
 *
 * Registry-backed action/family model for browse-shell navigation. This module
 * does not own UI state or runtime identity; it projects the normalized
 * template registry into ordered authorable and not-yet-authorable rows.
 *
 * Load workbench-template-gating.js before this file in browser pages.
 * Dual-export: browser window.__workbenchActionNavigation / Node.js CommonJS.
 */

"use strict";

const templateGating = (() => {
  if (typeof module !== "undefined" && module.exports) {
    return require("./workbench-template-gating");
  }
  if (typeof window !== "undefined") return window.__workbenchTemplateGating || null;
  return null;
})();

const PREFIX_GROUPS = [
  ["on_foot_prefixes", "on-foot"],
  ["mounted_prefixes", "mounted"],
  ["deferred_prefixes", "deferred"],
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function registryErrors(registry) {
  const errors = [];
  if (!isRecord(registry)) return ["registry must be an object"];
  if (registry.schema_version !== 2) errors.push("registry schema_version must be 2");

  for (const key of ["skin_family_scope", "prefix_catalog", "template_sets"]) {
    if (!isRecord(registry[key])) errors.push(`registry.${key} must be an object`);
  }
  if (errors.length) return errors;

  for (const [family, scope] of Object.entries(registry.skin_family_scope)) {
    if (!isRecord(scope)) {
      errors.push(`registry.skin_family_scope.${family} must be an object`);
      continue;
    }
    for (const [field] of PREFIX_GROUPS) {
      if (scope[field] !== undefined && (!Array.isArray(scope[field])
        || scope[field].some((prefix) => typeof prefix !== "string" || !prefix.trim()))) {
        errors.push(`registry.skin_family_scope.${family}.${field} must be an array of non-empty strings`);
      }
    }
  }

  for (const [prefix, spec] of Object.entries(registry.prefix_catalog)) {
    if (!isRecord(spec)) {
      errors.push(`registry.prefix_catalog.${prefix} must be an object`);
      continue;
    }
    if (String(spec.filename_prefix || "").trim() !== prefix) {
      errors.push(`registry.prefix_catalog.${prefix}.filename_prefix must match its key`);
    }
    if (typeof spec.skin_family !== "string" || !spec.skin_family.trim()) {
      errors.push(`registry.prefix_catalog.${prefix}.skin_family must be a non-empty string`);
    }
    if (spec.template_actions !== undefined && !Array.isArray(spec.template_actions)) {
      errors.push(`registry.prefix_catalog.${prefix}.template_actions must be an array`);
    }
  }

  for (const [templateSetKey, templateSet] of Object.entries(registry.template_sets)) {
    if (!isRecord(templateSet)) {
      errors.push(`registry.template_sets.${templateSetKey} must be an object`);
    } else if (!isRecord(templateSet.actions)) {
      errors.push(`registry.template_sets.${templateSetKey}.actions must be an object`);
    }
  }
  return errors;
}

function familyClassification(scope) {
  if (scope?.proof_only === true) return "proof-only";
  if (scope?.authorable === true) return "authorable";
  if (scope?.status === "deferred") return "deferred";
  return "unavailable";
}

function prefixClassification(scope, prefixSpec, group) {
  if (scope?.proof_only === true) return "proof-only";
  if (group === "deferred" || prefixSpec?.status === "deferred") return "deferred";
  if (scope?.authorable === true && prefixSpec?.authorable === true) return "authorable";
  return "unavailable";
}

function actionClassification(scope, prefixSpec, group, ts, actionKey, spec, registry, templateSetKey) {
  if (scope?.proof_only === true) return "proof-only";
  if (group === "deferred" || prefixSpec?.status === "deferred") return "deferred";
  if (typeof templateGating?.isTemplateActionAuthorable !== "function") return "unavailable";
  try {
    return templateGating.isTemplateActionAuthorable(ts, actionKey, spec, registry, templateSetKey)
      ? "authorable"
      : "unavailable";
  } catch (_error) {
    return "unavailable";
  }
}

function actionBlockers(classification, scope, prefixSpec, actionKey, spec, templateSetKey) {
  if (classification === "authorable") return [];
  if (classification === "proof-only") return ["skin_family_proof_only"];
  if (classification === "deferred") {
    const blockers = Array.isArray(prefixSpec?.authoring_blockers)
      ? prefixSpec.authoring_blockers.filter((value) => typeof value === "string")
      : [];
    return blockers.length ? blockers : ["prefix_deferred_in_registry"];
  }
  if (!scope) return ["skin_family_not_registered"];
  if (scope.authorable === false) return ["skin_family_not_authorable"];
  if (!prefixSpec) return ["prefix_not_registered"];
  if (prefixSpec.authorable === false) return ["prefix_not_authorable"];
  if (typeof templateGating?.isTemplateActionAuthorable !== "function") {
    return ["template_authorability_gate_unavailable"];
  }
  const allowedSets = Array.isArray(scope.authorable_template_sets) ? scope.authorable_template_sets : [];
  if (allowedSets.length && !allowedSets.includes(templateSetKey)) return ["template_set_not_authorable_for_family"];
  const templateActions = Array.isArray(prefixSpec.template_actions) ? prefixSpec.template_actions : [];
  if (templateActions.length && !templateActions.some((entry) => (
    entry?.template_set_key === templateSetKey && entry?.action_key === actionKey
  ))) return ["template_action_not_linked_by_prefix"];
  if (String(spec?.skin_family || "").trim() !== String(prefixSpec.skin_family || "").trim()) {
    return ["action_skin_family_mismatch"];
  }
  return ["template_action_not_authorized"];
}

function prefixRowsForFamily(registry, skinFamily, scope) {
  const rows = [];
  const seen = new Set();
  for (const [field, group] of PREFIX_GROUPS) {
    for (const value of (Array.isArray(scope?.[field]) ? scope[field] : [])) {
      const prefix = String(value || "").trim();
      if (!prefix || seen.has(prefix)) continue;
      seen.add(prefix);
      rows.push({ prefix, group });
    }
  }

  const extraPrefixes = Object.entries(registry.prefix_catalog)
    .filter(([, spec]) => spec.skin_family === skinFamily)
    .map(([prefix]) => prefix)
    .filter((prefix) => !seen.has(prefix))
    .sort((left, right) => left.localeCompare(right));
  for (const prefix of extraPrefixes) {
    const prefixSpec = registry.prefix_catalog[prefix];
    rows.push({ prefix, group: prefixSpec.mounted === true ? "mounted" : "other" });
  }
  return rows;
}

function familyStatusRank(classification) {
  return classification === "authorable" ? 0
    : classification === "proof-only" ? 1
      : classification === "deferred" ? 2 : 3;
}

/**
 * Project all registry families, prefixes, and template actions into a
 * deterministic model. A malformed/missing registry returns valid:false and
 * empty collections; it never falls back to a built-in action list.
 */
function buildRegistryActionCoverage(registry) {
  const errors = registryErrors(registry);
  const warnings = [];
  if (typeof templateGating?.isTemplateActionAuthorable !== "function") {
    warnings.push("template_authorability_gate_unavailable");
  }
  if (errors.length) {
    return {
      valid: false,
      errors,
      warnings,
      families: [],
      actions: [],
      templateSets: [],
    };
  }

  const familyDescriptors = Object.entries(registry.skin_family_scope).map(([skinFamily, scope]) => ({
    skinFamily,
    scope,
    classification: familyClassification(scope),
    prefixes: prefixRowsForFamily(registry, skinFamily, scope),
  }));
  familyDescriptors.sort((left, right) => familyStatusRank(left.classification) - familyStatusRank(right.classification)
    || left.skinFamily.localeCompare(right.skinFamily));

  const familyRanks = new Map();
  const prefixRanks = new Map();
  for (let familyIndex = 0; familyIndex < familyDescriptors.length; familyIndex += 1) {
    const family = familyDescriptors[familyIndex];
    familyRanks.set(family.skinFamily, familyIndex);
    family.prefixes.forEach((prefix, prefixIndex) => {
      prefixRanks.set(`${family.skinFamily}\u0000${prefix.prefix}`, prefixIndex);
    });
  }

  const linkRanks = new Map();
  for (const [prefix, prefixSpec] of Object.entries(registry.prefix_catalog)) {
    const links = Array.isArray(prefixSpec.template_actions) ? prefixSpec.template_actions : [];
    links.forEach((link, index) => {
      if (!isRecord(link)) return;
      linkRanks.set(`${prefix}\u0000${link.template_set_key}\u0000${link.action_key}`, index);
    });
  }

  const actions = [];
  for (const [templateSetKey, ts] of Object.entries(registry.template_sets)) {
    for (const [actionKey, spec] of Object.entries(ts.actions)) {
      const prefix = String(spec?.filename_prefix || spec?.family || "").trim();
      const skinFamily = String(spec?.skin_family || "").trim();
      const scope = registry.skin_family_scope[skinFamily];
      const prefixSpec = registry.prefix_catalog[prefix];
      const family = familyDescriptors.find((entry) => entry.skinFamily === skinFamily);
      const prefixRow = family?.prefixes.find((entry) => entry.prefix === prefix);
      const group = prefixRow?.group || (prefixSpec?.mounted === true ? "mounted" : "other");
      const classification = actionClassification(
        scope, prefixSpec, group, ts, actionKey, spec, registry, templateSetKey,
      );
      const row = {
        id: `${templateSetKey}:${actionKey}`,
        templateSetKey,
        templateSetLabel: String(ts.label || templateSetKey),
        actionKey,
        label: String(spec?.label || actionKey),
        prefix,
        skinFamily,
        runtimeRole: prefixSpec?.runtime_role || null,
        group,
        mounted: group === "mounted" || prefixSpec?.mounted === true,
        required: spec?.required === true,
        classification,
        authorable: classification === "authorable",
        proofOnly: classification === "proof-only",
        deferred: classification === "deferred",
        blockers: actionBlockers(classification, scope, prefixSpec, actionKey, spec, templateSetKey),
      };
      actions.push(row);
    }
  }

  actions.sort((left, right) => (
    (familyRanks.get(left.skinFamily) ?? Number.MAX_SAFE_INTEGER)
      - (familyRanks.get(right.skinFamily) ?? Number.MAX_SAFE_INTEGER)
    || (prefixRanks.get(`${left.skinFamily}\u0000${left.prefix}`) ?? Number.MAX_SAFE_INTEGER)
      - (prefixRanks.get(`${right.skinFamily}\u0000${right.prefix}`) ?? Number.MAX_SAFE_INTEGER)
    || (linkRanks.get(`${left.prefix}\u0000${left.templateSetKey}\u0000${left.actionKey}`) ?? Number.MAX_SAFE_INTEGER)
      - (linkRanks.get(`${right.prefix}\u0000${right.templateSetKey}\u0000${right.actionKey}`) ?? Number.MAX_SAFE_INTEGER)
    || left.templateSetKey.localeCompare(right.templateSetKey)
    || left.actionKey.localeCompare(right.actionKey)
  ));

  const families = familyDescriptors.map(({ skinFamily, scope, classification, prefixes }) => ({
    skinFamily,
    label: String(scope.label || skinFamily),
    classification,
    authorable: classification === "authorable",
    proofOnly: classification === "proof-only",
    deferred: classification === "deferred",
    prefixes: prefixes.map(({ prefix, group }) => {
      const prefixSpec = registry.prefix_catalog[prefix];
      const prefixActions = actions.filter((action) => action.skinFamily === skinFamily && action.prefix === prefix);
      const prefixStatus = prefixClassification(scope, prefixSpec, group);
      return {
        prefix,
        label: String(prefixSpec?.label || prefix),
        group,
        mounted: group === "mounted" || prefixSpec?.mounted === true,
        runtimeRole: prefixSpec?.runtime_role || null,
        classification: prefixStatus,
        authorable: prefixStatus === "authorable",
        proofOnly: prefixStatus === "proof-only",
        deferred: prefixStatus === "deferred",
        blockers: Array.isArray(prefixSpec?.authoring_blockers) ? [...prefixSpec.authoring_blockers] : [],
        actions: prefixActions,
      };
    }),
  }));

  const templateSets = Object.keys(registry.template_sets).sort((left, right) => left.localeCompare(right))
    .map((templateSetKey) => ({
      templateSetKey,
      label: String(registry.template_sets[templateSetKey].label || templateSetKey),
      actions: actions.filter((action) => action.templateSetKey === templateSetKey),
    }));

  return {
    valid: true,
    errors: [],
    warnings,
    families,
    actions,
    templateSets,
  };
}

/**
 * Return a navigation-ready model. With a templateSetKey, selectedActions is
 * limited to that set; the full families/actions collections remain available
 * so proof-only and deferred classifications are not hidden by selection.
 */
function getRegistryActionNavigation(registry, options = {}) {
  const model = buildRegistryActionCoverage(registry);
  const templateSetKey = typeof options === "string"
    ? options
    : String(options?.templateSetKey || "").trim();
  const selected = templateSetKey
    ? model.actions.filter((action) => action.templateSetKey === templateSetKey)
    : model.actions;
  const selectionValid = !templateSetKey || Object.prototype.hasOwnProperty.call(registry?.template_sets || {}, templateSetKey);
  return {
    ...model,
    selectedTemplateSetKey: templateSetKey || null,
    selectionValid,
    selectionError: selectionValid ? null : `template set not found: ${templateSetKey}`,
    selectedActions: selectionValid ? selected : [],
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildRegistryActionCoverage, getRegistryActionNavigation };
} else if (typeof window !== "undefined") {
  window.__workbenchActionNavigation = { buildRegistryActionCoverage, getRegistryActionNavigation };
}
