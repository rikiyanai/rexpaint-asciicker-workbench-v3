"""Runtime contract adapter: normalized doc -> validate -> runtime payload.

Lane A (normalized XP/Y9 contract correctness inside Workbench / Test This Skin).

This module is the single backend owner of the CP437 runtime handoff chain:

    current doc -> normalized inspect -> validate -> runtime payload -> embedded runtime

Responsibilities:
  * resolve a workbench session's template identity (template_set_key/action_key)
    to its registry action spec ("normalized inspect");
  * run the G7-G12 structural gates on an exported XP against that spec
    ("validate"), fail-closed: gate breach raises, never fallback bytes;
  * record the A1 sibling-viewer audit (which surface supplies what), so the
    product shell never treats a viewer as runtime authority.

A1 audit (verified 2026-10-13, clean tree 993bec7):
  * normalized-xp-sprite-inspector (sibling repo
    AsciickerY92-normalized-xp-sprite-inspector, terminal, read-only):
    supplies normalized inspection evidence — upstream layer notes +
    body-region UV map. Only the player -> player-1100 stem invocation is
    verified; other families require manual navigation. NOT runtime authority.
  * source-layer-contract-viewer (in-repo scripts/source_layer_contract_viewer.py,
    terminal, read-only, writes nothing): supplies the layer contract — every
    raw layer in all reviewed XP files including engine-metadata L0/L1, the
    original cells sliced per frame/angle, hand/proposal evidence separate from
    frozen reviewed cell roles, topology class, blockers, glyph exact/near
    match evidence, and a role-focus grid. CP437 evidence comes from rendering
    these raw cells. NOT compiler authority (never touches frames[].regions[],
    never promotes a semantic map).
  * runtime identity (stable V2 IDs: skin_definition_id, presentation_kind_id,
    layer_definition_id) comes ONLY from config/runtime_identity_registry.json
    via runtime_identity_for_action(), keyed by template_set_key:action_key.
    Neither viewer supplies runtime identity.
  * runtime authority continues to come from the reviewed V3 registry
    (config/template_registry.json) plus the Y9-2 identity/runtime contract,
    never from a viewer-owned model.

Fail-closed rule: every function here raises ApiError on contract breach.
Callers must not catch-and-fallback to ambient/default sprites, cached
sprites, or fallback docs — the error reaches the HTTP layer verbatim.
"""

from __future__ import annotations

from typing import Any

from .gates import THRESHOLD_BREACHED
from .models import ApiError


# A1 audit table, machine-readable. Keys are the sibling surfaces; values name
# exactly what each surface supplies. "runtime_identity" is False for both
# viewers by construction — identity comes from the registry, not viewers.
SIBLING_VIEWER_ROLES: dict[str, dict[str, Any]] = {
    "normalized_xp_sprite_inspector": {
        "repo": "AsciickerY92-normalized-xp-sprite-inspector",
        "supplies_normalized_inspection": True,
        "supplies_layer_contract": False,
        "supplies_cp437_evidence": False,
        "supplies_runtime_identity": False,
        "verified_stem": "player-1100",
        "note": "read-only upstream layer notes + body-region UV map",
    },
    "source_layer_contract_viewer": {
        "repo": "in-repo scripts/source_layer_contract_viewer.py",
        "supplies_normalized_inspection": False,
        "supplies_layer_contract": True,
        "supplies_cp437_evidence": True,
        "supplies_runtime_identity": False,
        "verified_stem": "all reviewed stems",
        "note": "read-only raw layers incl. engine-metadata L0/L1 + composed preview",
    },
}


def action_spec_for_session(
    sess: dict[str, Any],
    registry: dict[str, Any],
) -> dict[str, Any] | None:
    """Resolve a session's template identity to its registry action spec.

    Returns None when the session carries no template identity (raw_xp uploads,
    root_blank sessions, pipeline-job sessions): there is no normalized spec to
    validate against, so callers export without gate validation but still
    fail-closed on metadata/parse errors elsewhere. Never invents a spec.
    """
    template_set_key = str(sess.get("template_set_key") or "").strip()
    action_key = str(sess.get("action_key") or "").strip()
    if not template_set_key or not action_key:
        return None
    ts = registry.get("template_sets", {}).get(template_set_key)
    if not isinstance(ts, dict):
        return None
    action_spec = ts.get("actions", {}).get(action_key)
    return action_spec if isinstance(action_spec, dict) else None


def validate_runtime_export(
    gates: list[Any],
    *,
    context: str,
    req_id: str,
) -> list[dict[str, Any]]:
    """Fail-closed verdict over already-run G7-G12 gate results.

    Returns the gate report dicts when every gate met its threshold.
    Raises ApiError (structural_gate_failed, 422) naming the breached gates
    otherwise. No fallback payload, no ambient sprite, no default bytes.
    """
    gate_dicts = [
        {"gate": g.gate, "verdict": g.verdict, "details": g.details} for g in gates
    ]
    blocked = [g for g in gates if g.verdict == THRESHOLD_BREACHED]
    if blocked:
        gate_names = ", ".join(g.gate for g in blocked)
        raise ApiError(
            f"{context} failed structural gates: {gate_names}",
            "structural_gate_failed",
            "workbench",
            req_id,
            422,
        )
    return gate_dicts
