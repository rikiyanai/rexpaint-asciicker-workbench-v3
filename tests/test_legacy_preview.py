from __future__ import annotations

import base64
import hashlib
import io
from pathlib import Path

from pipeline_v2.xp_codec import read_xp


ROOT = Path(__file__).resolve().parents[1]


def _mint(client, prefix: str, relative_path: str):
    raw = (ROOT / relative_path).read_bytes()
    response = client.post(
        f"{prefix}/api/workbench/legacy-preview-token",
        json={
            "xp_b64": base64.b64encode(raw).decode("ascii"),
            "source_name": Path(relative_path).name,
        },
    )
    return raw, response


def test_player_preview_token_is_exact_and_one_shot(hosted_client):
    client, prefix = hosted_client
    raw, minted = _mint(client, prefix, "sprites/2026-06-08-wallace.xp")

    assert minted.status_code == 201
    metadata = minted.get_json()
    assert metadata["family"] == "player"
    assert metadata["target_path"] == "/sprites/player-0000.xp"
    assert len(metadata["target_paths"]) == 24
    assert metadata["target_paths"][0] == "/sprites/player-0000.xp"
    assert metadata["target_paths"][-1] == "/sprites/player-1112.xp"
    assert "/sprites/player-nude.xp" not in metadata["target_paths"]
    assert all(path.startswith("/sprites/player-") for path in metadata["target_paths"])
    assert metadata["runtime_state"] == "on_foot_no_equipment"
    assert metadata["mount_state"] == 0
    assert (metadata["width"], metadata["height"], metadata["layers"]) == (126, 72, 3)
    assert metadata["l0_marker"] == "818"
    assert metadata["key_rgb"] == [255, 255, 85]
    assert metadata["source_sha256"] == hashlib.sha256(raw).hexdigest()
    assert metadata["legacy_transparency_normalized_cells"] == 1436

    consumed = client.get(f"{prefix}/api/workbench/legacy-preview-token/{metadata['token']}")
    assert consumed.status_code == 200
    assert consumed.headers["Cache-Control"].startswith("no-store")
    payload = consumed.get_json()
    runtime_raw = base64.b64decode(payload["xp_b64"])
    assert runtime_raw != raw
    assert payload["sha256"] == metadata["sha256"]
    assert hashlib.sha256(runtime_raw).hexdigest() == payload["sha256"]
    runtime_xp = read_xp(runtime_raw)
    assert not any(
        glyph not in (0, 32) and bg == (255, 0, 255)
        for glyph, _fg, bg in runtime_xp["cells"][2]
    )

    replay = client.get(f"{prefix}/api/workbench/legacy-preview-token/{metadata['token']}")
    assert replay.status_code == 404
    assert replay.get_json()["code"] == "preview_token_unavailable"


def test_wolfie_preview_resolves_mounted_packaged_target(hosted_client):
    client, prefix = hosted_client
    _raw, minted = _mint(client, prefix, "sprites/2026-06-08-gromit.xp")

    assert minted.status_code == 201
    metadata = minted.get_json()
    assert metadata["family"] == "wolfie"
    assert metadata["target_path"] == "/sprites/wolfie-0000.xp"
    assert len(metadata["target_paths"]) == 24
    assert metadata["target_paths"][0] == "/sprites/wolfie-0000.xp"
    assert metadata["target_paths"][-1] == "/sprites/wolfie-1112.xp"
    assert all(path.startswith("/sprites/wolfie-") for path in metadata["target_paths"])
    assert metadata["runtime_state"] == "mounted_wolf_no_equipment"
    assert metadata["mount_state"] == 1
    assert (metadata["width"], metadata["height"], metadata["layers"]) == (180, 96, 3)
    # Gromit's authored solids use visible backgrounds, so preview-time
    # transparency normalization must have nothing left to repair.
    assert metadata["legacy_transparency_normalized_cells"] == 0


def test_idle_template_session_is_projected_to_legacy_preview_geometry(client):
    created = client.post(
        "/api/workbench/create-blank-session",
        json={"template_set_key": "player_native_idle_only", "action_key": "idle"},
    )
    assert created.status_code == 201
    session = created.get_json()
    assert (session["grid_cols"], session["grid_rows"]) == (126, 80)

    minted = client.post(
        "/api/workbench/legacy-preview-token",
        json={"session_id": session["session_id"]},
    )
    assert minted.status_code == 201
    metadata = minted.get_json()
    assert (metadata["width"], metadata["height"], metadata["layers"]) == (126, 72, 3)
    assert metadata["family"] == "player"

    consumed = client.get(f"/api/workbench/legacy-preview-token/{metadata['token']}")
    assert consumed.status_code == 200
    preview = read_xp(base64.b64decode(consumed.get_json()["xp_b64"]))
    assert (preview["width"], preview["height"], preview["layers"]) == (126, 72, 3)
    assert "".join(chr(preview["cells"][0][index][0]) for index in range(3)) == "818"


def test_legacy_preview_rejects_non_actor_topology(client):
    raw = (ROOT / "sprites/player-0000.xp").read_bytes()
    response = client.post(
        "/api/workbench/legacy-preview-token",
        json={"xp_b64": base64.b64encode(raw[:-20]).decode("ascii")},
    )

    assert response.status_code == 422
    assert response.get_json()["code"] == "invalid_xp"


def test_legacy_preview_requires_exactly_one_source(client):
    response = client.post("/api/workbench/legacy-preview-token", json={})

    assert response.status_code == 400
    assert response.get_json()["code"] == "legacy_preview_source_required"


def test_raw_upload_session_uses_topology_instead_of_uploaded_family(client):
    raw = (ROOT / "sprites/2026-06-08-gromit.xp").read_bytes()
    uploaded = client.post(
        "/api/workbench/upload-xp",
        data={"file": (io.BytesIO(raw), "gromit.xp")},
        content_type="multipart/form-data",
    )
    assert uploaded.status_code == 201
    session = uploaded.get_json()
    assert session["session_kind"] == "raw_xp"
    assert session["family"] == "uploaded"

    minted = client.post(
        "/api/workbench/legacy-preview-token",
        json={"session_id": session["session_id"]},
    )
    assert minted.status_code == 201
    metadata = minted.get_json()
    assert metadata["family"] == "wolfie"
    assert metadata["target_path"] == "/sprites/wolfie-0000.xp"
    assert len(metadata["source_sha256"]) == 64
    assert metadata["legacy_transparency_normalized_cells"] == 0
