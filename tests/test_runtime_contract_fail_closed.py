"""Lane A: normalized runtime-contract handoff — fail-closed + registry truth.

Covers handoff A2-A6 at the backend layer (Test This Skin consumes only the
current Workbench XP/bundle; flatmap preflight honesty; CP437 runtime path
validate step; registry-truth action coverage; fail-closed on invalid
contracts). No browser, no headed proof — pure backend/runtime contract.

Fail-closed rule asserted throughout: every error response must carry NO
payload bytes (no xp_b64, no per-action xp_b64) — an invalid normalized
contract can never fall back to ambient/default sprites.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

from pipeline_v2 import service
from pipeline_v2.runtime_contract import (
    SIBLING_VIEWER_ROLES,
    action_spec_for_session,
)
from pipeline_v2.xp_codec import read_xp, write_xp


def _post(client, url, payload):
    return client.post(url, data=json.dumps(payload), content_type="application/json")


def _assert_no_payload_bytes(body) -> None:
    assert "xp_b64" not in body, "fail-closed breach: xp_b64 present on error"
    for _key, action in (body.get("actions") or {}).items():
        assert "xp_b64" not in action, "fail-closed breach: per-action xp_b64 on error"


# ── A2: Test This Skin consumes the current doc/bundle only ────────────────


def test_single_payload_identity_gating_never_serves_ambient_bytes(client):
    missing = _post(client, "/api/workbench/web-skin-payload", {})
    assert missing.status_code == 400
    _assert_no_payload_bytes(missing.get_json())

    unknown = _post(client, "/api/workbench/web-skin-payload", {"session_id": "nope"})
    assert unknown.status_code == 404
    _assert_no_payload_bytes(unknown.get_json())

    # A bundle action session must go through the bundle payload, never the
    # single-session path (which would misidentify its actions).
    created = _post(
        client, "/api/workbench/bundle/create", {"template_set_key": "player_native_full"}
    )
    assert created.status_code == 201
    bundle = created.get_json()
    idle_session = bundle["actions"]["idle"]["session_id"]
    assert idle_session

    rejected = _post(client, "/api/workbench/web-skin-payload", {"session_id": idle_session})
    assert rejected.status_code == 409
    assert rejected.get_json()["code"] == "bundle_session_classic_rejected"
    _assert_no_payload_bytes(rejected.get_json())


def test_bundle_payload_identity_gating(client):
    missing = _post(client, "/api/workbench/web-skin-bundle-payload", {})
    assert missing.status_code == 400
    _assert_no_payload_bytes(missing.get_json())

    unknown = _post(
        client, "/api/workbench/web-skin-bundle-payload", {"bundle_id": "b-nope"}
    )
    assert unknown.status_code in (404, 422, 500)
    _assert_no_payload_bytes(unknown.get_json() or {})


# ── A4/A6: validate step + fail-closed on the single-session path ──────────


def _draw_cells(count, drawn, glyph=219):
    cells = [
        {"glyph": 0, "fg": [0, 0, 0], "bg": [255, 0, 255]} for _ in range(count)
    ]
    for idx in range(min(drawn, count)):
        cells[idx] = {"glyph": glyph, "fg": [255, 255, 255], "bg": [0, 0, 0]}
    return cells


def test_template_session_blank_fails_closed_then_drawn_passes(client):
    created = _post(
        client,
        "/api/workbench/create-blank-session",
        {"template_set_key": "player_native_full", "action_key": "idle"},
    )
    assert created.status_code == 201
    session_id = created.get_json()["session_id"]

    # Blank art breaches G8: 422 naming the gate, zero payload bytes.
    refused = _post(client, "/api/workbench/web-skin-payload", {"session_id": session_id})
    assert refused.status_code == 422
    err = refused.get_json()
    assert err["code"] == "structural_gate_failed"
    assert "G8" in err["error"]
    _assert_no_payload_bytes(err)

    # Draw 1200 CP437 full-block cells (>5% G8 floor on 126x80) and retest.
    loaded = _post(client, "/api/workbench/load-session", {"session_id": session_id})
    assert loaded.status_code == 200
    doc = loaded.get_json()
    count = int(doc["grid_cols"]) * int(doc["grid_rows"])
    assert (int(doc["grid_cols"]), int(doc["grid_rows"])) == (126, 80)

    saved = _post(
        client,
        "/api/workbench/save-session",
        {
            "session_id": session_id,
            "grid_cols": doc["grid_cols"],
            "grid_rows": doc["grid_rows"],
            "cell_w": doc["cell_w"],
            "cell_h": doc["cell_h"],
            "angles": doc["angles"],
            "anims": doc["anims"],
            "source_projs": doc["source_projs"],
            "projs": doc["projs"],
            "cells": _draw_cells(count, 1200),
        },
    )
    assert saved.status_code == 200

    ok = _post(client, "/api/workbench/web-skin-payload", {"session_id": session_id})
    assert ok.status_code == 200
    payload = ok.get_json()

    # Browse/Open doc and Test-This-Skin payload identify the same document.
    contract = payload["doc_contract"]
    assert contract["session_id"] == session_id
    assert contract["template_set_key"] == "player_native_full"
    assert contract["action_key"] == "idle"
    assert contract["checksum"] == payload["checksum"]
    assert contract["layer0_compat"] is True
    assert payload["preview_normalized"] is False

    # Validate step ran and passed on the normalized spec.
    assert isinstance(payload["validation"], list) and payload["validation"]
    assert all(g["verdict"] == "THRESHOLD_MET" for g in payload["validation"])
    assert {g["gate"] for g in payload["validation"]} >= {"G7", "G8", "G10", "G11", "G12"}
    assert contract["validation"] == payload["validation"]

    # CP437 runtime bytes: full-block glyph 219 survives export untouched.
    assert "player-0000.xp" in payload["override_names"]
    assert payload["xp_size_bytes"] == len(base64.b64decode(payload["xp_b64"]))
    exported = read_xp(Path(payload["xp_path"]))
    assert (exported["width"], exported["height"]) == (126, 80)
    art_glyphs = [c[0] for c in exported["cells"][2]]
    assert 219 in art_glyphs


def test_bundle_payload_blank_bundle_fails_closed_without_action_bytes(client):
    created = _post(
        client, "/api/workbench/bundle/create", {"template_set_key": "player_native_full"}
    )
    assert created.status_code == 201
    bundle_id = created.get_json()["bundle_id"]

    refused = _post(
        client, "/api/workbench/web-skin-bundle-payload", {"bundle_id": bundle_id}
    )
    assert refused.status_code == 422
    err = refused.get_json()
    assert err["code"] == "structural_gate_failed"
    _assert_no_payload_bytes(err)


# ── A5: action/presentation coverage comes from registry truth ─────────────


def test_runtime_identity_covers_all_product_actions_without_collapse():
    reg = service.load_template_registry()
    pairs = [
        ("player_native_full", "idle"),
        ("player_native_full", "attack"),
        ("player_native_full", "death"),
        ("mounted_native_full", "mounted_idle"),
        ("mounted_native_full", "mounted_attack"),
    ]
    identities = {}
    for template_set_key, action_key in pairs:
        spec = reg["template_sets"][template_set_key]["actions"][action_key]
        identities[action_key] = service.runtime_identity_for_action(
            template_set_key, action_key, spec
        )
    # idle/attack/death are distinct presentations — never collapsed.
    kinds = {k: v["presentation_kind_id"] for k, v in identities.items()}
    assert kinds["idle"] == 600
    assert kinds["attack"] == 601
    assert kinds["death"] == 602
    assert len(set(kinds.values())) == 3
    layer_ids = [v["layer_definition_id"] for v in identities.values()]
    assert len(set(layer_ids)) == 5


def test_proof_only_and_deferred_prefixes_are_labeled_not_authorable():
    reg = service.load_template_registry()
    assert reg["skin_family_scope"]["green"]["proof_only"] is True
    ok, reason = service._is_prefix_authorized_core("player", "green", reg)
    assert ok is False
    assert "proof_only" in reason

    bigbee = reg["prefix_catalog"]["bigbee"]
    assert bigbee["authorable"] is False
    assert bigbee["status"] == "deferred"
    ok, reason = service._is_prefix_authorized_core("bigbee", "human", reg)
    assert ok is False
    assert "not authorable" in reason


def test_action_spec_resolution_only_from_session_template_identity():
    reg = service.load_template_registry()
    spec = action_spec_for_session(
        {"template_set_key": "player_native_full", "action_key": "attack"}, reg
    )
    assert spec is not None
    assert spec["filename_prefix"] == "attack"
    # Raw uploads / blanks / pipeline sessions carry no template identity:
    # no spec is ever invented for them.
    assert action_spec_for_session({"session_kind": "raw_xp"}, reg) is None
    assert action_spec_for_session({"session_kind": "root_blank"}, reg) is None
    assert action_spec_for_session({}, reg) is None
    assert action_spec_for_session(
        {"template_set_key": "nope", "action_key": "idle"}, reg
    ) is None


# ── A3: flatmap readiness — exact map, no fake green ───────────────────────


def test_preflight_names_exact_maps_and_rejects_arbitrary_maps(client, tmp_path, monkeypatch):
    import pipeline_v2.app as app_module

    live = client.get("/api/workbench/runtime-preflight")
    assert live.status_code == 200
    body = live.get_json()
    assert body["required_map_any_of"] == [
        "termpp-web-flat/flatmaps/minimal_2x2.a3d",
        "termpp-web-flat/flatmaps/game_map_y8_original_game_map.a3d",
    ]

    required_files = [
        "termpp-web-flat/index.html",
        "termpp-web-flat/index.js",
        "termpp-web-flat/index.wasm",
        "termpp-web-flat/index.data",
        "termpp-web-flat/flat_map_bootstrap.js",
    ]

    def _stage(root: Path, maps: list[str]) -> None:
        for rel in required_files:
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"x" * 64)
        for rel in maps:
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"m" * 64)

    # Empty runtime root: both exact maps missing, no green, actionable names.
    empty_root = tmp_path / "empty-rt"
    empty_root.mkdir()
    monkeypatch.setattr(app_module, "STATIC_WEB_ROOT", empty_root)
    missing = client.get("/api/workbench/runtime-preflight").get_json()
    assert missing["ok"] is False
    assert missing["maps_found"] == []
    assert "termpp-web-flat/flatmaps/minimal_2x2.a3d" in missing["missing_files"]
    assert (
        "termpp-web-flat/flatmaps/game_map_y8_original_game_map.a3d"
        in missing["missing_files"]
    )

    # An arbitrary map plus all required files still cannot fake green.
    arbitrary_root = tmp_path / "arbitrary-rt"
    _stage(arbitrary_root, ["termpp-web-flat/flatmaps/some_other_map.a3d"])
    monkeypatch.setattr(app_module, "STATIC_WEB_ROOT", arbitrary_root)
    faked = client.get("/api/workbench/runtime-preflight").get_json()
    assert faked["ok"] is False
    assert faked["maps_found"] == []
    assert "termpp-web-flat/flatmaps/some_other_map.a3d" not in (
        faked["maps_found"] + faked["missing_files"]
    )

    # Either vendored map alone satisfies the any-of requirement.
    good_root = tmp_path / "good-rt"
    _stage(good_root, ["termpp-web-flat/flatmaps/minimal_2x2.a3d"])
    monkeypatch.setattr(app_module, "STATIC_WEB_ROOT", good_root)
    passed = client.get("/api/workbench/runtime-preflight").get_json()
    assert passed["ok"] is True
    assert passed["maps_found"] == ["termpp-web-flat/flatmaps/minimal_2x2.a3d"]


# ── A4: CP437 glyph bytes survive the codec untouched ──────────────────────


def test_xp_codec_preserves_full_cp437_glyph_range(tmp_path):
    glyphs = list(range(256))
    layers = [
        [(g, (g, g, g), (0, 0, 0)) for g in glyphs],
        [(0, (0, 0, 0), (255, 0, 255)) for _ in glyphs],
    ]
    xp_path = tmp_path / "cp437-roundtrip.xp"
    write_xp(xp_path, 256, 1, layers)
    parsed = read_xp(xp_path)
    assert (parsed["width"], parsed["height"]) == (256, 1)
    assert [c[0] for c in parsed["cells"][0]] == glyphs
    # CP437 spot-check: box-drawing + block shades round-trip exactly.
    for cp in (176, 177, 178, 219, 201, 205, 187, 200, 188):
        assert parsed["cells"][0][cp][0] == cp


# ── A1: sibling-viewer audit is pinned, not folklore ───────────────────────


def test_sibling_viewer_roles_audit():
    assert set(SIBLING_VIEWER_ROLES) == {
        "normalized_xp_sprite_inspector",
        "source_layer_contract_viewer",
    }
    # Neither viewer supplies runtime identity — the registry does.
    assert all(
        v["supplies_runtime_identity"] is False for v in SIBLING_VIEWER_ROLES.values()
    )
    normalized = SIBLING_VIEWER_ROLES["normalized_xp_sprite_inspector"]
    contract = SIBLING_VIEWER_ROLES["source_layer_contract_viewer"]
    assert normalized["supplies_normalized_inspection"] is True
    assert contract["supplies_layer_contract"] is True
    assert contract["supplies_cp437_evidence"] is True
    # The in-repo viewer exists and is read-only; the normalized inspector is
    # a sibling repo, not an in-repo module.
    repo_root = Path(__file__).resolve().parents[1]
    assert (repo_root / "scripts" / "source_layer_contract_viewer.py").is_file()
    assert list((repo_root / "scripts").glob("normalized*")) == []
    assert list((repo_root / "src").rglob("*normalized*inspector*")) == []
