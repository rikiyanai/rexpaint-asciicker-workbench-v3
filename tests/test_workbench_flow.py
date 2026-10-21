from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from pipeline_v2.xp_codec import read_xp, write_xp


def _upload(client, path: Path, prefix: str = ""):
    with path.open("rb") as f:
        return client.post(f"{prefix}/api/upload", data={"file": (f, path.name)}, content_type="multipart/form-data")


def _blank_cells(count: int):
    return [{"idx": idx, "glyph": 0, "fg": [0, 0, 0], "bg": [255, 0, 255]} for idx in range(count)]


def _xp_cell(glyph: int = 32, fg: tuple[int, int, int] = (255, 255, 255), bg: tuple[int, int, int] = (0, 0, 0)):
    return (glyph, fg, bg)


def _write_test_xp(path: Path, width: int, height: int, layers: list[list[tuple[int, tuple[int, int, int], tuple[int, int, int]]]]) -> Path:
    write_xp(path, width, height, layers)
    return path


def test_run_to_workbench_to_export(client):
    fixture = Path(__file__).parent / "fixtures" / "known_good" / "cat_sheet.png"
    up = _upload(client, fixture).get_json()

    run_payload = {
        "source_path": up["source_path"],
        "name": "cat",
        "angles": 1,
        "frames": "8",
        "source_projs": 1,
        "render_resolution": 24,
        "native_compat": False,
    }
    run_resp = client.post("/api/run", data=json.dumps(run_payload), content_type="application/json")
    assert run_resp.status_code == 200
    run_data = run_resp.get_json()

    wb_resp = client.post(
        "/api/workbench/load-from-job",
        data=json.dumps({"job_id": run_data["job_id"]}),
        content_type="application/json",
    )
    assert wb_resp.status_code == 201
    wb_data = wb_resp.get_json()
    assert wb_data["populated_cells"] > 0
    assert wb_data["grid_cols"] > 0
    assert wb_data["grid_rows"] > 0

    export_resp = client.post(
        "/api/workbench/export-xp",
        data=json.dumps({"session_id": wb_data["session_id"]}),
        content_type="application/json",
    )
    assert export_resp.status_code == 200
    export_data = export_resp.get_json()
    assert Path(export_data["xp_path"]).exists()
    assert export_data["checksum"]

    cmd_resp = client.post(
        "/api/workbench/xp-tool-command",
        data=json.dumps({"xp_path": export_data["xp_path"]}),
        content_type="application/json",
    )
    assert cmd_resp.status_code == 200
    cmd_data = cmd_resp.get_json()
    assert "scripts.asset_gen.xp_tool" in cmd_data["command"]

    open_resp = client.post(
        "/api/workbench/open-in-xp-tool",
        data=json.dumps({"xp_path": export_data["xp_path"], "dry_run": True}),
        content_type="application/json",
    )
    assert open_resp.status_code == 200
    open_data = open_resp.get_json()
    assert open_data["dry_run"] is True
    assert open_data["launched"] is False

    verify_dry_resp = client.post(
        "/api/workbench/run-verification",
        data=json.dumps({
            "session_id": wb_data["session_id"],
            "profile": "termpp_custom",
            "command_template": "echo verifying {xp_path}",
            "dry_run": True,
        }),
        content_type="application/json",
    )
    assert verify_dry_resp.status_code == 200
    verify_dry_data = verify_dry_resp.get_json()
    assert verify_dry_data["dry_run"] is True
    assert "verifying " in (verify_dry_data.get("command") or "")

    verify_local_resp = client.post(
        "/api/workbench/run-verification",
        data=json.dumps({
            "session_id": wb_data["session_id"],
            "profile": "local_xp_sanity",
            "timeout_sec": 10,
        }),
        content_type="application/json",
    )
    assert verify_local_resp.status_code == 200
    verify_local_data = verify_local_resp.get_json()
    assert verify_local_data["dry_run"] is False
    assert verify_local_data["profile"] == "local_xp_sanity"
    assert verify_local_data["passed"] is True
    assert Path(verify_local_data["report_path"]).exists()

    termpp_cmd_resp = client.post(
        "/api/workbench/termpp-skin-command",
        data=json.dumps({
            "session_id": wb_data["session_id"],
            "binary_name": "game_term",
        }),
        content_type="application/json",
    )
    assert termpp_cmd_resp.status_code == 200
    termpp_cmd_data = termpp_cmd_resp.get_json()
    assert termpp_cmd_data["binary_name"] == "game_term"
    assert termpp_cmd_data["planned_runtime_root"]
    assert termpp_cmd_data["xp_path"].endswith(".xp")

    termpp_dry_resp = client.post(
        "/api/workbench/open-termpp-skin",
        data=json.dumps({
            "session_id": wb_data["session_id"],
            "binary_name": "game_term",
            "dry_run": True,
        }),
        content_type="application/json",
    )
    assert termpp_dry_resp.status_code == 200
    termpp_dry_data = termpp_dry_resp.get_json()
    assert termpp_dry_data["dry_run"] is True
    assert termpp_dry_data["launched"] is False
    assert "runtime_root" in termpp_dry_data

    stream_dry_resp = client.post(
        "/api/workbench/termpp-stream/start",
        data=json.dumps({
            "session_id": wb_data["session_id"],
            "x": 0,
            "y": 0,
            "w": 320,
            "h": 240,
            "fps": 2,
            "dry_run": True,
        }),
        content_type="application/json",
    )
    assert stream_dry_resp.status_code == 200
    stream_dry_data = stream_dry_resp.get_json()
    assert stream_dry_data["dry_run"] is True
    assert stream_dry_data["region"]["w"] == 320
    assert stream_dry_data["region"]["h"] == 240

    web_skin_resp = client.post(
        "/api/workbench/web-skin-payload",
        data=json.dumps({"session_id": wb_data["session_id"]}),
        content_type="application/json",
    )
    assert web_skin_resp.status_code == 200
    web_skin_data = web_skin_resp.get_json()
    assert web_skin_data["xp_path"].endswith(".xp")
    assert web_skin_data["xp_size_bytes"] > 0
    assert len(web_skin_data["xp_b64"]) > 0
    assert "player-0000.xp" in web_skin_data["override_names"]
    assert web_skin_data["preview_normalized"] is True
    preview_xp = read_xp(Path(web_skin_data["xp_path"]))
    assert preview_xp["width"] == 126
    assert preview_xp["height"] == 80

    runtime_preflight_resp = client.get("/api/workbench/runtime-preflight")
    assert runtime_preflight_resp.status_code == 200
    runtime_preflight = runtime_preflight_resp.get_json()
    assert isinstance(runtime_preflight.get("ok"), bool)
    assert "termpp-web-flat/index.wasm" in (runtime_preflight.get("required_files") or [])
    required_any = runtime_preflight.get("required_map_any_of") or []
    assert "termpp-web-flat/flatmaps/minimal_2x2.a3d" in required_any
    assert "termpp-web-flat/flatmaps/game_map_y8_original_game_map.a3d" in required_any
    assert "missing_files" in runtime_preflight
    assert "invalid_files" in runtime_preflight
    assert "maps_found" in runtime_preflight


def test_termpp_stream_dry_run_works_off_darwin(client):
    """Regression: dry_run=True must succeed on non-macOS (CI/Linux)."""
    fixture = Path(__file__).parent / "fixtures" / "known_good" / "cat_sheet.png"
    up = _upload(client, fixture).get_json()
    run_resp = client.post(
        "/api/run",
        data=json.dumps({
            "source_path": up["source_path"],
            "name": "cat",
            "angles": 1,
            "frames": "8",
            "source_projs": 1,
            "render_resolution": 24,
            "native_compat": False,
        }),
        content_type="application/json",
    )
    wb_resp = client.post(
        "/api/workbench/load-from-job",
        data=json.dumps({"job_id": run_resp.get_json()["job_id"]}),
        content_type="application/json",
    )
    session_id = wb_resp.get_json()["session_id"]

    fake_uname = os.uname_result(("Linux", "ci", "6.5.0", "#1", "x86_64"))
    with patch("pipeline_v2.service.os.uname", return_value=fake_uname):
        dry_resp = client.post(
            "/api/workbench/termpp-stream/start",
            data=json.dumps({
                "session_id": session_id,
                "x": 0, "y": 0, "w": 320, "h": 240,
                "fps": 2, "dry_run": True,
            }),
            content_type="application/json",
        )
        assert dry_resp.status_code == 200
        assert dry_resp.get_json()["dry_run"] is True

        real_resp = client.post(
            "/api/workbench/termpp-stream/start",
            data=json.dumps({
                "session_id": session_id,
                "x": 0, "y": 0, "w": 320, "h": 240,
                "fps": 2, "dry_run": False,
            }),
            content_type="application/json",
        )
        assert real_resp.status_code == 422


def test_workbench_browse_crud_endpoints(client):
    create_a = client.post(
        "/api/workbench/create-blank-session",
        data=json.dumps({"template_set_key": "player_native_idle_only", "action_key": "idle"}),
        content_type="application/json",
    )
    assert create_a.status_code == 201
    session_a = create_a.get_json()["session_id"]

    create_b = client.post(
        "/api/workbench/create-blank-session",
        data=json.dumps({"template_set_key": "player_native_idle_only", "action_key": "idle"}),
        content_type="application/json",
    )
    assert create_b.status_code == 201
    session_b = create_b.get_json()["session_id"]

    list_resp = client.get("/api/workbench/browse/list")
    assert list_resp.status_code == 200
    sessions = list_resp.get_json()["sessions"]
    found_ids = {item["session_id"] for item in sessions}
    assert session_a in found_ids
    assert session_b in found_ids

    rename_resp = client.post(
        "/api/workbench/browse/rename",
        data=json.dumps({"session_id": session_a, "name": "Browse Rename Proof"}),
        content_type="application/json",
    )
    assert rename_resp.status_code == 200
    renamed = rename_resp.get_json()
    assert renamed["session_id"] == session_a
    assert renamed["name"] == "Browse Rename Proof"
    assert renamed["label"] == "Browse Rename Proof"

    dup_resp = client.post(
        "/api/workbench/browse/duplicate",
        data=json.dumps({"session_id": session_a}),
        content_type="application/json",
    )
    assert dup_resp.status_code == 201
    duplicated = dup_resp.get_json()
    assert duplicated["session_id"] != session_a
    assert duplicated["name"] == "Browse Rename Proof copy"

    delete_resp = client.post(
        "/api/workbench/browse/delete",
        data=json.dumps({"session_id": duplicated["session_id"]}),
        content_type="application/json",
    )
    assert delete_resp.status_code == 200
    assert delete_resp.get_json()["deleted"] is True

    list_after = client.get("/api/workbench/browse/list")
    assert list_after.status_code == 200
    after_ids = {item["session_id"] for item in list_after.get_json()["sessions"]}
    assert duplicated["session_id"] not in after_ids
    assert session_a in after_ids


def test_root_blank_session_defaults(client):
    create_resp = client.post(
        "/api/workbench/create-blank-session",
        data=json.dumps({}),
        content_type="application/json",
    )
    assert create_resp.status_code == 201
    payload = create_resp.get_json()
    assert payload["grid_cols"] == 126
    assert payload["grid_rows"] == 80
    assert payload["angles"] == 8
    assert payload["anims"] == [9]
    assert payload["source_projs"] == 1
    assert payload["projs"] == 2
    assert payload["layer_count"] == 4
    assert payload["session_kind"] == "root_blank"
    assert payload["metadata_status"] == "generated"
    assert payload["template_set_key"] == ""
    assert payload["action_key"] == ""
    assert payload["active_layer"] == 2
    assert payload["visible_layers"] == [2]
    assert payload["locked_layers"] == []


def test_root_blank_session_accepts_explicit_geometry(client):
    create_resp = client.post(
        "/api/workbench/create-blank-session",
        data=json.dumps({
            "blank_session": {
                "angles": 4,
                "anims": [3],
                "source_projs": 2,
                "cell_w": 6,
                "cell_h": 8,
            },
        }),
        content_type="application/json",
    )
    assert create_resp.status_code == 201
    payload = create_resp.get_json()
    assert payload["grid_cols"] == 36
    assert payload["grid_rows"] == 32
    assert payload["angles"] == 4
    assert payload["anims"] == [3]
    assert payload["source_projs"] == 2
    assert payload["projs"] == 2
    assert payload["session_kind"] == "root_blank"
    assert payload["metadata_status"] == "generated"
    assert payload["template_set_key"] == ""
    assert payload["action_key"] == ""


def test_template_owned_session_layer0_defaults(client):
    create_resp = client.post(
        "/api/workbench/create-blank-session",
        data=json.dumps({
            "template_set_key": "player_native_idle_only",
            "action_key": "idle",
        }),
        content_type="application/json",
    )
    assert create_resp.status_code == 201
    payload = create_resp.get_json()
    assert payload["session_kind"] == "template_owned"
    assert payload["metadata_status"] == "generated"
    assert payload["template_set_key"] == "player_native_idle_only"
    assert payload["action_key"] == "idle"
    assert payload["layer_count"] == 4
    assert payload["active_layer"] == 2
    assert payload["visible_layers"] == [2]
    assert payload["locked_layers"] == [0]
    load_resp = client.post(
        "/api/workbench/load-session",
        data=json.dumps({"session_id": payload["session_id"]}),
        content_type="application/json",
    )
    assert load_resp.status_code == 200
    loaded = load_resp.get_json()
    assert loaded["template_set_key"] == "player_native_idle_only"
    assert loaded["action_key"] == "idle"
    assert loaded["session_kind"] == "template_owned"


def test_upload_raw_xp_opens_without_template_metadata_and_roundtrips(client, tmp_path: Path):
    width, height = 4, 3
    layer0 = [_xp_cell() for _ in range(width * height)]
    layer0[width + 1] = _xp_cell(ord("A"), (255, 200, 200), (0, 0, 0))
    xp_path = _write_test_xp(tmp_path / "raw-missing-meta.xp", width, height, [layer0])

    with xp_path.open("rb") as fh:
        upload_resp = client.post(
            "/api/workbench/upload-xp",
            data={"file": (fh, xp_path.name)},
            content_type="multipart/form-data",
        )
    assert upload_resp.status_code == 201
    uploaded = upload_resp.get_json()
    assert uploaded["name"] == xp_path.name
    assert uploaded["session_kind"] == "raw_xp"
    assert uploaded["metadata_status"] == "missing"
    assert uploaded["template_set_key"] == ""
    assert uploaded["action_key"] == ""
    assert uploaded["grid_cols"] == width
    assert uploaded["grid_rows"] == height
    assert uploaded["angles"] == 1
    assert uploaded["anims"] == [1]
    assert uploaded["projs"] == 1
    assert uploaded["layer_count"] == 1
    assert uploaded["layer_names"] == ["Layer 0"]
    assert uploaded["active_layer"] == 0
    assert uploaded["visible_layers"] == [0]
    assert uploaded["locked_layers"] == []

    session_id = uploaded["session_id"]
    load_resp = client.post(
        "/api/workbench/load-session",
        data=json.dumps({"session_id": session_id}),
        content_type="application/json",
    )
    assert load_resp.status_code == 200
    loaded = load_resp.get_json()
    assert loaded["session_kind"] == "raw_xp"
    assert loaded["metadata_status"] == "missing"
    assert loaded["template_set_key"] == ""
    assert loaded["action_key"] == ""

    browse_resp = client.get("/api/workbench/browse/list")
    assert browse_resp.status_code == 200
    browse_sessions = {item["session_id"]: item for item in browse_resp.get_json()["sessions"]}
    assert browse_sessions[session_id]["name"] == xp_path.name
    assert browse_sessions[session_id]["label"] == xp_path.name
    assert browse_sessions[session_id]["session_kind"] == "raw_xp"
    assert browse_sessions[session_id]["metadata_status"] == "missing"

    export_resp = client.post(
        "/api/workbench/export-xp",
        data=json.dumps({"session_id": session_id}),
        content_type="application/json",
    )
    assert export_resp.status_code == 200
    export_data = export_resp.get_json()
    assert export_data["source"] == "persisted_layers"
    parsed = read_xp(Path(export_data["xp_path"]))
    assert parsed["layers"] == 1
    assert parsed["width"] == width
    assert parsed["height"] == height
    assert parsed["cells"][0][width + 1][0] == ord("A")


def test_upload_valid_native_xp_defaults_to_visual_layer(client, tmp_path: Path):
    width, height = 126, 80
    layer0 = [_xp_cell(0, (0, 0, 0), (255, 0, 255)) for _ in range(width * height)]
    layer0[0] = _xp_cell(ord("8"), (255, 255, 255), (255, 0, 255))
    layer0[1] = _xp_cell(ord("1"), (255, 255, 255), (255, 0, 255))
    layer0[2] = _xp_cell(ord("8"), (255, 255, 255), (255, 0, 255))
    layer1 = [_xp_cell(ord("0"), (0, 0, 0), (255, 0, 255)) for _ in range(width * height)]
    visual = [_xp_cell(0, (0, 0, 0), (255, 0, 255)) for _ in range(width * height)]
    visual[width + 1] = _xp_cell(ord("@"), (255, 255, 0), (255, 0, 255))
    blank = [_xp_cell(0, (0, 0, 0), (255, 0, 255)) for _ in range(width * height)]
    xp_path = _write_test_xp(tmp_path / "native-valid-raw.xp", width, height, [layer0, layer1, visual, blank])

    with xp_path.open("rb") as fh:
        upload_resp = client.post(
            "/api/workbench/upload-xp",
            data={"file": (fh, xp_path.name)},
            content_type="multipart/form-data",
        )
    assert upload_resp.status_code == 201
    uploaded = upload_resp.get_json()
    assert uploaded["session_kind"] == "raw_xp"
    assert uploaded["metadata_status"] == "valid"
    assert uploaded["active_layer"] == 2
    assert uploaded["visible_layers"] == [2]
    assert uploaded["locked_layers"] == [0]
    session_path = Path(__file__).resolve().parents[1] / "data" / "sessions" / f"{uploaded['session_id']}.json"
    assert "\n" not in session_path.read_text()


def test_upload_missing_metadata_visual_strip_infers_frame_width(client, tmp_path: Path):
    width, height = 72, 11
    blank = [_xp_cell(0, (0, 0, 0), (0, 0, 0)) for _ in range(width * height)]
    visual = [_xp_cell(32, (255, 255, 255), (255, 0, 255)) for _ in range(width * height)]
    for frame in range(8):
        x0 = frame * 9
        for y in range(1, height):
            visual[y * width + x0] = _xp_cell(179, (255, 255, 255), (255, 0, 255))
            visual[y * width + x0 + 8] = _xp_cell(179, (255, 255, 255), (255, 0, 255))
        for x in range(x0, x0 + 9):
            visual[(height - 1) * width + x] = _xp_cell(196, (255, 255, 255), (0, 64, 64))
    xp_path = _write_test_xp(tmp_path / "raw-strip-missing-meta.xp", width, height, [blank, blank, visual])

    with xp_path.open("rb") as fh:
        upload_resp = client.post(
            "/api/workbench/upload-xp",
            data={"file": (fh, xp_path.name)},
            content_type="multipart/form-data",
        )
    assert upload_resp.status_code == 201
    uploaded = upload_resp.get_json()
    assert uploaded["metadata_status"] == "missing"
    assert uploaded["grid_cols"] == width
    assert uploaded["grid_rows"] == height
    assert uploaded["angles"] == 1
    assert uploaded["anims"] == [8]
    assert uploaded["projs"] == 1
    assert uploaded["cell_w"] == 9
    assert uploaded["cell_h"] == 11

    load_resp = client.post(
        "/api/workbench/load-from-job",
        data=json.dumps({"job_id": uploaded["job_id"]}),
        content_type="application/json",
    )
    assert load_resp.status_code == 201
    loaded = load_resp.get_json()
    assert loaded["metadata_status"] == "missing"
    assert loaded["anims"] == [8]
    assert loaded["cell_w"] == 9
    assert loaded["cell_h"] == 11


def test_upload_invalid_metadata_xp_still_exports_but_runtime_payload_refuses(client, tmp_path: Path):
    width, height = 4, 3
    layer0 = [_xp_cell() for _ in range(width * height)]
    layer0[1] = _xp_cell(ord("5"))
    layer0[width + 2] = _xp_cell(ord("B"), (200, 255, 200), (0, 0, 0))
    xp_path = _write_test_xp(tmp_path / "raw-invalid-meta.xp", width, height, [layer0])

    with xp_path.open("rb") as fh:
        upload_resp = client.post(
            "/api/workbench/upload-xp",
            data={"file": (fh, xp_path.name)},
            content_type="multipart/form-data",
        )
    assert upload_resp.status_code == 201
    uploaded = upload_resp.get_json()
    assert uploaded["session_kind"] == "raw_xp"
    assert uploaded["metadata_status"] == "invalid"

    export_resp = client.post(
        "/api/workbench/export-xp",
        data=json.dumps({"session_id": uploaded["session_id"]}),
        content_type="application/json",
    )
    assert export_resp.status_code == 200
    parsed = read_xp(Path(export_resp.get_json()["xp_path"]))
    assert parsed["layers"] == 1
    assert parsed["cells"][0][width + 2][0] == ord("B")

    runtime_resp = client.post(
        "/api/workbench/web-skin-payload",
        data=json.dumps({"session_id": uploaded["session_id"]}),
        content_type="application/json",
    )
    assert runtime_resp.status_code == 422
    runtime_err = runtime_resp.get_json()
    assert runtime_err["code"] == "template_metadata_repair_required"


def test_save_session_persists_explicit_geometry(client):
    create_resp = client.post(
        "/api/workbench/create-blank-session",
        data=json.dumps({}),
        content_type="application/json",
    )
    session_id = create_resp.get_json()["session_id"]
    count = 36 * 32
    save_resp = client.post(
        "/api/workbench/save-session",
        data=json.dumps({
            "session_id": session_id,
            "grid_cols": 36,
            "grid_rows": 32,
            "cell_w": 6,
            "cell_h": 8,
            "angles": 4,
            "anims": [3],
            "layer_names": ["Metadata", "Ink", "Visual", "FX"],
            "active_layer": 1,
            "visible_layers": [0, 1, 3],
            "locked_layers": [0, 3],
            "whole_sheet_canvas_zoom": 1.5,
            "whole_sheet_grid_visible": True,
            "whole_sheet_grid_step": "custom",
            "whole_sheet_grid_custom_w": 5,
            "whole_sheet_grid_custom_h": 7,
            "source_projs": 2,
            "projs": 2,
            "cells": _blank_cells(count),
            "layers": [_blank_cells(count) for _ in range(4)],
        }),
        content_type="application/json",
    )
    assert save_resp.status_code == 200
    saved = save_resp.get_json()
    assert saved["grid_cols"] == 36
    assert saved["grid_rows"] == 32
    assert saved["angles"] == 4
    assert saved["anims"] == [3]
    assert saved["source_projs"] == 2
    assert saved["projs"] == 2
    assert saved["layer_names"] == ["Metadata", "Ink", "Visual", "FX"]
    assert saved["active_layer"] == 1
    assert saved["visible_layers"] == [0, 1, 3]
    assert saved["locked_layers"] == [0, 3]
    assert saved["whole_sheet_canvas_zoom"] == 1.5
    assert saved["whole_sheet_grid_visible"] is True
    assert saved["whole_sheet_grid_step"] == "custom"
    assert saved["whole_sheet_grid_custom_w"] == 5
    assert saved["whole_sheet_grid_custom_h"] == 7

    load_resp = client.post(
        "/api/workbench/load-session",
        data=json.dumps({"session_id": session_id}),
        content_type="application/json",
    )
    assert load_resp.status_code == 200
    loaded = load_resp.get_json()
    assert loaded["grid_cols"] == 36
    assert loaded["grid_rows"] == 32
    assert loaded["cell_w"] == 6
    assert loaded["cell_h"] == 8
    assert loaded["angles"] == 4
    assert loaded["anims"] == [3]
    assert loaded["layer_names"] == ["Metadata", "Ink", "Visual", "FX"]
    assert loaded["active_layer"] == 1
    assert loaded["visible_layers"] == [0, 1, 3]
    assert loaded["locked_layers"] == [0, 3]
    assert loaded["whole_sheet_canvas_zoom"] == 1.5
    assert loaded["whole_sheet_grid_visible"] is True
    assert loaded["whole_sheet_grid_step"] == "custom"
    assert loaded["whole_sheet_grid_custom_w"] == 5
    assert loaded["whole_sheet_grid_custom_h"] == 7


def test_run_pipeline_honors_explicit_target_geometry(client):
    fixture = Path(__file__).parent / "fixtures" / "known_good" / "cat_sheet.png"
    up = _upload(client, fixture).get_json()

    run_resp = client.post(
        "/api/run",
        data=json.dumps({
            "source_path": up["source_path"],
            "name": "explicit_target_geometry",
            "angles": 4,
            "frames": "3",
            "source_projs": 2,
            "render_resolution": 12,
            "target_cols": 72,
            "target_rows": 32,
            "native_compat": False,
        }),
        content_type="application/json",
    )
    assert run_resp.status_code == 200
    job_id = run_resp.get_json()["job_id"]

    load_resp = client.post(
        "/api/workbench/load-from-job",
        data=json.dumps({"job_id": job_id}),
        content_type="application/json",
    )
    assert load_resp.status_code == 201
    payload = load_resp.get_json()
    assert payload["grid_cols"] == 72
    assert payload["grid_rows"] == 32
    assert payload["angles"] == 4
    assert payload["anims"] == [3]
    assert payload["source_projs"] == 2
    assert payload["projs"] == 2
    assert payload["cell_w"] == 12
    assert payload["cell_h"] == 8
    assert payload["active_layer"] == 2
    assert payload["visible_layers"] == [2]
    assert payload["locked_layers"] == [0]


def test_web_skin_payload_maps_four_angle_sessions_to_cardinal_native_rows(client, tmp_path: Path):
    fixture = tmp_path / "four_angle_strip.png"
    tile = 24
    im = Image.new("RGBA", (tile * 3, tile * 4), (255, 0, 255, 0))
    draw = ImageDraw.Draw(im)
    colors = [
        (255, 80, 80, 255),
        (80, 255, 80, 255),
        (80, 160, 255, 255),
        (255, 220, 80, 255),
    ]
    for row, color in enumerate(colors):
        y0 = row * tile
        draw.rectangle([4, y0 + 2, 19, y0 + 21], fill=color)
    im.save(fixture)

    up = _upload(client, fixture).get_json()
    run_resp = client.post(
        "/api/run",
        data=json.dumps({
            "source_path": up["source_path"],
            "name": "four_angle_cardinal",
            "angles": 4,
            "frames": "3",
            "source_projs": 2,
            "render_resolution": 12,
            "native_compat": False,
        }),
        content_type="application/json",
    )
    assert run_resp.status_code == 200
    job_id = run_resp.get_json()["job_id"]

    wb_resp = client.post(
        "/api/workbench/load-from-job",
        data=json.dumps({"job_id": job_id}),
        content_type="application/json",
    )
    assert wb_resp.status_code == 201
    session_id = wb_resp.get_json()["session_id"]

    payload_resp = client.post(
        "/api/workbench/web-skin-payload",
        data=json.dumps({"session_id": session_id}),
        content_type="application/json",
    )
    assert payload_resp.status_code == 200
    payload = payload_resp.get_json()
    assert payload["preview_normalized"] is True

    preview_xp = read_xp(Path(payload["xp_path"]))
    assert preview_xp["width"] == 126
    assert preview_xp["height"] == 80
    visual = preview_xp["cells"][2]
    cols = preview_xp["width"]
    frame_w = 7
    frame_h = 10
    row_counts = []
    for row in range(8):
        n = 0
        for y in range(frame_h):
            for x in range(frame_w):
                idx = (row * frame_h + y) * cols + x
                if visual[idx][0] not in (0, 32):
                    n += 1
        row_counts.append(n)
    assert row_counts[0] > 0
    assert row_counts[2] > 0
    assert row_counts[4] > 0
    assert row_counts[6] > 0
    assert row_counts[1] == 0
    assert row_counts[3] == 0
    assert row_counts[5] == 0
    assert row_counts[7] == 0


def test_workbench_browse_delete_rejects_bundle_owned_session(client):
    bundle_resp = client.post(
        "/api/workbench/bundle/create",
        data=json.dumps({"template_set_key": "player_native_full"}),
        content_type="application/json",
    )
    assert bundle_resp.status_code == 201
    bundle = bundle_resp.get_json()
    first_owned = next(
        act["session_id"]
        for act in bundle["actions"].values()
        if isinstance(act, dict) and act.get("session_id")
    )

    delete_resp = client.post(
        "/api/workbench/browse/delete",
        data=json.dumps({"session_id": first_owned}),
        content_type="application/json",
    )
    assert delete_resp.status_code == 422
    payload = delete_resp.get_json()
    assert payload["code"] == "bundle_session_delete_forbidden"


# --- Base-path-parameterized test (root + /xpedit) ---


def test_run_to_workbench_to_export_hosted(hosted_client):
    """Same flow as test_run_to_workbench_to_export but parameterized over hosting mode."""
    client, prefix = hosted_client
    fixture = Path(__file__).parent / "fixtures" / "known_good" / "cat_sheet.png"
    up = _upload(client, fixture, prefix).get_json()

    run_payload = {
        "source_path": up["source_path"],
        "name": "cat",
        "angles": 1,
        "frames": "8",
        "source_projs": 1,
        "render_resolution": 24,
        "native_compat": False,
    }
    run_resp = client.post(f"{prefix}/api/run", data=json.dumps(run_payload), content_type="application/json")
    assert run_resp.status_code == 200
    run_data = run_resp.get_json()

    wb_resp = client.post(
        f"{prefix}/api/workbench/load-from-job",
        data=json.dumps({"job_id": run_data["job_id"]}),
        content_type="application/json",
    )
    assert wb_resp.status_code == 201
    wb_data = wb_resp.get_json()
    assert wb_data["populated_cells"] > 0
    assert wb_data["grid_cols"] > 0
    assert wb_data["grid_rows"] > 0

    export_resp = client.post(
        f"{prefix}/api/workbench/export-xp",
        data=json.dumps({"session_id": wb_data["session_id"]}),
        content_type="application/json",
    )
    assert export_resp.status_code == 200
    export_data = export_resp.get_json()
    assert Path(export_data["xp_path"]).exists()
    assert export_data["checksum"]

    runtime_preflight_resp = client.get(f"{prefix}/api/workbench/runtime-preflight")
    assert runtime_preflight_resp.status_code == 200
    runtime_preflight = runtime_preflight_resp.get_json()
    assert isinstance(runtime_preflight.get("ok"), bool)
