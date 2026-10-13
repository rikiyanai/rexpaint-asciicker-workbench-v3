#!/usr/bin/env python3
"""Workbench MCP Server — MCPServer wrapper for the asciicker pipeline REST API.

Exposes 16 tools for pipeline operations, classic sessions, bundle lifecycle,
and validation. Requires the workbench server running at WORKBENCH_URL
(default http://127.0.0.1:5071).
"""

from __future__ import annotations

import base64
import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from mcp.server import MCPServer

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

WORKBENCH_URL = os.environ.get("WORKBENCH_URL", "http://127.0.0.1:5071")
TIMEOUT = float(os.environ.get("MCP_HTTP_TIMEOUT", "60"))

mcp = MCPServer(
    "workbench-api",
    instructions="Asciicker pipeline workbench API — skin conversion, bundles, validation",
)


def _url(path: str) -> str:
    return f"{WORKBENCH_URL}{path}"


def _client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT)


def _api_error(exc: Exception) -> dict:
    """Convert an httpx exception to a structured error dict."""
    if isinstance(exc, httpx.ConnectError):
        return {
            "error": "connection_refused",
            "message": (
                f"Cannot reach workbench server at {WORKBENCH_URL}. "
                "Start it with: PYTHONPATH=src python3 -m pipeline_v2.app"
            ),
        }
    if isinstance(exc, httpx.HTTPStatusError):
        try:
            body = exc.response.json()
        except Exception:
            body = exc.response.text
        return {
            "error": f"http_{exc.response.status_code}",
            "status_code": exc.response.status_code,
            "message": str(body),
        }
    return {"error": "unexpected", "message": str(exc)}


def _get(path: str) -> dict:
    try:
        with _client() as c:
            r = c.get(_url(path))
            r.raise_for_status()
            return r.json()
    except (httpx.ConnectError, httpx.HTTPStatusError, httpx.TimeoutException) as e:
        return _api_error(e)


def _post_json(path: str, payload: dict | None = None) -> dict:
    try:
        with _client() as c:
            r = c.post(_url(path), json=payload or {})
            r.raise_for_status()
            return r.json()
    except (httpx.ConnectError, httpx.HTTPStatusError, httpx.TimeoutException) as e:
        return _api_error(e)


def _put_json(path: str, payload: dict | None = None) -> dict:
    try:
        with _client() as c:
            r = c.put(_url(path), json=payload or {})
            r.raise_for_status()
            return r.json()
    except (httpx.ConnectError, httpx.HTTPStatusError, httpx.TimeoutException) as e:
        return _api_error(e)


def _get_qs(path: str, params: dict[str, str] | None = None) -> dict:
    """GET with query-string params."""
    try:
        with _client() as c:
            r = c.get(_url(path), params=params or {})
            r.raise_for_status()
            return r.json()
    except (httpx.ConnectError, httpx.HTTPStatusError, httpx.TimeoutException) as e:
        return _api_error(e)


def _post_file(path: str, file_path: str, field: str = "file") -> dict:
    p = Path(file_path).expanduser().resolve()
    if not p.exists():
        return {"error": "file_not_found", "message": f"File not found: {p}"}
    try:
        with _client() as c:
            with open(p, "rb") as f:
                r = c.post(_url(path), files={field: (p.name, f, "image/png")})
                r.raise_for_status()
                return r.json()
    except (httpx.ConnectError, httpx.HTTPStatusError, httpx.TimeoutException) as e:
        return _api_error(e)


def _b64_decoded_size(b64_str: str) -> int:
    """Calculate decoded size of a base64 string, accounting for padding."""
    if not b64_str:
        return 0
    return len(base64.b64decode(b64_str))


# ===================================================================
# Health Check
# ===================================================================


@mcp.tool()
def server_status() -> dict:
    """Check if the workbench server is reachable.

    Returns:
        ok (bool), url, and start command if unreachable.
    """
    try:
        with _client() as c:
            r = c.get(_url("/api/workbench/runtime-preflight"))
            r.raise_for_status()
            return {"ok": True, "url": WORKBENCH_URL}
    except httpx.ConnectError:
        return {
            "ok": False,
            "url": WORKBENCH_URL,
            "message": "Server not running. Start with: PYTHONPATH=src python3 -m pipeline_v2.app",
        }
    except Exception as e:
        return {"ok": False, "url": WORKBENCH_URL, "message": str(e)}


# ===================================================================
# Pipeline Tools
# ===================================================================


@mcp.tool()
def upload_png(file_path: str) -> dict:
    """Upload a PNG sprite sheet to the pipeline.

    Args:
        file_path: Absolute path to the PNG file on disk.

    Returns:
        upload_id, source_path, width, height, sha256.
    """
    return _post_file("/api/upload", file_path)


@mcp.tool()
def run_pipeline(
    source_path: str,
    name: str,
    angles: int = 1,
    frames: str = "1",
    source_projs: int = 1,
    render_resolution: int = 12,
    bg_mode: str = "key_color",
    bg_tolerance: int = 8,
    native_compat: bool = True,
) -> dict:
    """Run the sprite conversion pipeline on an uploaded image.

    Args:
        source_path: Path from upload_png result.
        name: Skin name (e.g. "warrior").
        angles: Number of rotation angles (1-8, power of 2).
        frames: Comma-separated animation frame indices (e.g. "1,8").
        source_projs: 1 (mono) or 2 (stereo).
        render_resolution: Pixels per glyph (default 12).
        bg_mode: Background mode — key_color, alpha, or none.
        bg_tolerance: Color key tolerance (0-255).
        native_compat: Enforce 126x80 native contract.

    Returns:
        job_id and initial job state.
    """
    return _post_json("/api/run", {
        "source_path": source_path,
        "name": name,
        "angles": angles,
        "frames": frames,
        "source_projs": source_projs,
        "render_resolution": render_resolution,
        "bg_mode": bg_mode,
        "bg_tolerance": bg_tolerance,
        "native_compat": native_compat,
    })


@mcp.tool()
def get_job_status(job_id: str) -> dict:
    """Poll pipeline job status.

    Args:
        job_id: Job ID from run_pipeline result.

    Returns:
        state (pending/running/completed/failed), stage, xp_path, previews.
    """
    return _get(f"/api/status/{job_id}")


# ===================================================================
# Classic Session Tools
# ===================================================================


@mcp.tool()
def load_session(job_id: str) -> dict:
    """Load a workbench session from a completed pipeline job.

    Args:
        job_id: Completed job ID.

    Returns:
        session_id and session metadata (angles, anims, cell dims, grid size).
    """
    return _post_json("/api/workbench/load-from-job", {"job_id": job_id})


@mcp.tool()
def save_session(session_id: str, payload: str | None = None) -> dict:
    """Save edits to a workbench session.

    Args:
        session_id: Active session ID.
        payload: Optional JSON string of session fields to update (cells, metadata).

    Returns:
        Save confirmation with status.
    """
    body: dict = {}
    if payload:
        try:
            body = json.loads(payload)
        except json.JSONDecodeError as e:
            return {"error": "invalid_json", "message": f"payload is not valid JSON: {e}"}
    body["session_id"] = session_id
    return _post_json("/api/workbench/save-session", body)


@mcp.tool()
def export_xp(session_id: str) -> dict:
    """Export a workbench session as a .xp file.

    Args:
        session_id: Session to export.

    Returns:
        xp_path to the exported file.
    """
    return _post_json("/api/workbench/export-xp", {"session_id": session_id})


@mcp.tool()
def get_skin_payload(session_id: str) -> dict:
    """Get the web skin payload for browser animation preview (classic mode only).

    Args:
        session_id: Classic (non-bundle) session ID.

    Returns:
        XP bytes (base64), override names, and injection metadata.
        Rejects bundle sessions with 409 — use get_bundle_payload instead.
    """
    return _post_json("/api/workbench/web-skin-payload", {"session_id": session_id})


# ===================================================================
# Bundle Lifecycle Tools
# ===================================================================


@mcp.tool()
def get_templates() -> dict:
    """List the normalized template registry.

    Returns:
        Template registry with template_sets, skin_family_scope, and
        prefix_catalog. Each template action defines filename_prefix,
        skin_family, dims, angles, frames, and reference XP metadata.
    """
    return _get("/api/workbench/templates")


@mcp.tool()
def create_bundle(template_set_key: str) -> dict:
    """Create a new bundle session from a template set.

    Args:
        template_set_key: Key from get_templates (e.g. "player_native_full").

    Returns:
        bundle_id, template_set_key, actions (each initially empty).
    """
    return _post_json("/api/workbench/bundle/create", {
        "template_set_key": template_set_key,
    })


@mcp.tool()
def apply_action_grid(
    bundle_id: str,
    action_key: str,
    source_path: str,
) -> dict:
    """Run the pipeline for a specific action within a bundle.

    Converts the source image using the template's per-action geometry
    (dims, angles, frames) and stores the result in the bundle.

    Args:
        bundle_id: Bundle ID from create_bundle.
        action_key: Action to convert — "idle", "attack", or "death".
        source_path: Path to uploaded source image.

    Returns:
        Updated bundle state with session_id and job_id for this action.
    """
    return _post_json("/api/workbench/action-grid/apply", {
        "bundle_id": bundle_id,
        "action_key": action_key,
        "source_path": source_path,
    })


@mcp.tool()
def get_bundle_payload(bundle_id: str) -> dict:
    """Get the web skin bundle payload for WASM injection (all actions).

    Exports all converted actions in the bundle, runs G10-G12 structural
    gates, and returns per-action XP bytes + override filenames.

    Args:
        bundle_id: Bundle to export for injection.

    Returns:
        Per-action payloads with xp_b64, override_names, gate_reports.
    """
    return _post_json("/api/workbench/web-skin-bundle-payload", {
        "bundle_id": bundle_id,
    })


@mcp.tool()
def export_bundle(bundle_id: str) -> dict:
    """Export all converted actions in a bundle as .xp files with gate validation.

    Runs G10 (dims), G11 (layers), G12 (L0 metadata) structural gates on
    each exported action. Fails if any required action is missing or gates fail.

    Args:
        bundle_id: Bundle to export.

    Returns:
        exports (per-action xp_path), gate_reports, overall pass/fail.
    """
    return _post_json("/api/workbench/export-bundle", {"bundle_id": bundle_id})


# ===================================================================
# Validation Tools
# ===================================================================


@mcp.tool()
def check_runtime_preflight() -> dict:
    """Check runtime bundle health for WASM preview.

    Verifies all required files exist in the runtime static directory:
    index.html, index.js, index.wasm, index.data, flat_map_bootstrap.js,
    and at least one map file (.a3d).

    Returns:
        ok (bool), missing_files, invalid_files, maps_found.
    """
    return _get("/api/workbench/runtime-preflight")


@mcp.tool()
def validate_structural_gates(bundle_id: str) -> dict:
    """Run structural gate validation (G10-G12) on a bundle.

    Exports the bundle and checks:
    - G10: XP dimensions match template spec
    - G11: Layer count matches expected (3 for death, 4 for player/attack)
    - G12: L0 metadata glyph sequence matches family pattern

    Args:
        bundle_id: Bundle to validate.

    Returns:
        Per-action gate reports with pass/fail and details.
    """
    result = _post_json("/api/workbench/export-bundle", {"bundle_id": bundle_id})
    if "error" in result:
        return result

    gate_reports = result.get("gate_reports", {})
    summary: dict = {
        "bundle_id": bundle_id,
        "overall": "PASS",
        "actions": {},
    }

    for action_key, gates in gate_reports.items():
        action_summary: dict = {"gates": {}, "passed": True}
        for gate in gates if isinstance(gates, list) else [gates]:
            gate_name = gate.get("gate", "unknown")
            verdict = gate.get("verdict", "THRESHOLD_BREACHED")
            passed = verdict == "THRESHOLD_MET"
            action_summary["gates"][gate_name] = {
                "passed": passed,
                "verdict": verdict,
                "details": gate.get("details", {}),
            }
            if not passed:
                action_summary["passed"] = False
                summary["overall"] = "FAIL"
        exports = result.get("exports", {})
        if action_key in exports:
            action_summary["xp_path"] = exports[action_key].get("xp_path")
        summary["actions"][action_key] = action_summary

    return summary


@mcp.tool()
def validate_xp(xp_path: str, template_set_key: str, action_key: str) -> dict:
    """Run G7-G12 structural validation on a single XP against its template spec.

    This is the canonical validate-xp surface for agent loops.
    Does not require a bundle or session context.

    Args:
        xp_path: Path to the .xp file on disk.
        template_set_key: Template set key (e.g. "player_native_full").
        action_key: Action key within the set (e.g. "idle", "attack", "death").

    Returns:
        Overall pass/fail with per-gate verdicts and details.
    """
    return _post_json("/api/workbench/validate-xp", {
        "xp_path": xp_path,
        "template_set_key": template_set_key,
        "action_key": action_key,
    })


# AHSW ternary naming: {family}-{A}{H}{S}{W}.xp
# A,H,S ∈ {0,1}  W ∈ {0,1,2}  — plus optional "player-nude.xp"
_AHSW_RE = re.compile(r"^[a-z]+-[01][01][01][012]\.xp$")
_NUDE_RE = re.compile(r"^player-nude\.xp$")


@mcp.tool()
def validate_override_names(bundle_id: str) -> dict:
    """Validate override filename mapping for a bundle.

    Fetches the bundle payload and extracts per-action override names,
    checking they follow the AHSW ternary naming convention.

    Args:
        bundle_id: Bundle to check.

    Returns:
        Per-action override_names lists and total file count.
    """
    result = _post_json("/api/workbench/web-skin-bundle-payload", {
        "bundle_id": bundle_id,
    })
    if "error" in result:
        return result

    actions = result.get("actions", {})
    summary: dict = {
        "bundle_id": bundle_id,
        "overall": "PASS",
        "actions": {},
        "total_files": 0,
    }
    for action_key, action_data in actions.items():
        names = action_data.get("override_names", [])
        invalid = [n for n in names if not (_AHSW_RE.match(n) or _NUDE_RE.match(n))]
        action_ok = len(invalid) == 0
        summary["actions"][action_key] = {
            "count": len(names),
            "valid": len(names) - len(invalid),
            "invalid": invalid,
            "passed": action_ok,
            "names": names,
        }
        summary["total_files"] += len(names)
        if not action_ok:
            summary["overall"] = "FAIL"
    return summary


@mcp.tool()
def inspect_payload(
    session_id: str | None = None,
    bundle_id: str | None = None,
) -> dict:
    """Inspect the skin payload that would be injected into the WASM runtime.

    Provide either session_id (classic) or bundle_id (bundle mode).
    Returns a human-readable summary of the payload structure without
    the raw base64 data.

    Args:
        session_id: Classic session ID (mutually exclusive with bundle_id).
        bundle_id: Bundle ID (mutually exclusive with session_id).

    Returns:
        Payload summary: action count, override file count, XP sizes, families.
    """
    if bundle_id:
        raw = _post_json("/api/workbench/web-skin-bundle-payload", {
            "bundle_id": bundle_id,
        })
        actions = raw.get("actions", {})
        summary: dict = {
            "mode": "bundle",
            "bundle_id": bundle_id,
            "actions": {},
        }
        for key, data in actions.items():
            xp_b64 = data.get("xp_b64", "")
            names = data.get("override_names", [])
            summary["actions"][key] = {
                "family": data.get("family", "unknown"),
                "xp_size_bytes": _b64_decoded_size(xp_b64),
                "override_file_count": len(names),
                "override_names_sample": names[:5],
                "gate_report": data.get("gate_report"),
            }
        return summary
    elif session_id:
        raw = _post_json("/api/workbench/web-skin-payload", {
            "session_id": session_id,
        })
        xp_b64 = raw.get("xp_b64", "")
        names = raw.get("override_names", [])
        return {
            "mode": "classic",
            "session_id": session_id,
            "xp_size_bytes": _b64_decoded_size(xp_b64),
            "override_file_count": len(names),
            "override_names_sample": names[:5],
        }
    else:
        return {"error": "Provide either session_id or bundle_id"}


# ===================================================================
# Mounted Authoring Aids
# ===================================================================


@mcp.tool()
def compute_mounted_rider_calibration(
    player_xp: str = "sprites/player-0100.xp",
    mounted_xp: str = "sprites/wolfie-0100.xp",
    anim_index: int = 0,
    frame_index: int = 0,
    proj: int = 0,
    layer: str = "auto",
    min_dx: int = -4,
    max_dx: int = 8,
    min_dy: int = -4,
    max_dy: int = 8,
) -> dict[str, Any]:
    """Compute per-angle rider offset candidates for mounted-family calibration.

    Runs the cell-matching algorithm over the player and mounted XP sprite
    sheets and returns per-angle best-offset candidates with coverage scores.
    This is the compute step for the non-destructive overlay calibration panel.

    Args:
        player_xp: Repo-relative path to the on-foot player XP (e.g. "sprites/player-0100.xp").
        mounted_xp: Repo-relative path to the mounted wolfie/wolack XP (e.g. "sprites/wolfie-0100.xp").
        anim_index: Animation index within the native strip (default 0).
        frame_index: Frame index within the chosen animation (default 0).
        proj: Projection index, usually 0 for projected view (default 0).
        layer: Layer index to match, or "auto" to prefer rider-isolating layer 3 (default "auto").
        min_dx: Minimum X offset to search (default -4).
        max_dx: Maximum X offset to search (default 8).
        min_dy: Minimum Y offset to search (default -4).
        max_dy: Maximum Y offset to search (default 8).

    Returns:
        Per-angle offset report with player/mounted paths, layout metadata,
        offset_x_by_angle, offset_y_by_angle, and per_angle list with dx, dy,
        matches, overlaps, mismatches, and coverage fields.
    """
    return _post_json("/api/workbench/mounted-calibration/compute", {
        "player_xp": player_xp,
        "mounted_xp": mounted_xp,
        "anim_index": anim_index,
        "frame_index": frame_index,
        "proj": proj,
        "layer": layer,
        "min_dx": min_dx,
        "max_dx": max_dx,
        "min_dy": min_dy,
        "max_dy": max_dy,
    })


@mcp.tool()
def confirm_mounted_calibration(
    session_id: str,
    calibration: dict,
    reviewer_action: str,
) -> dict[str, Any]:
    """Persist a confirmed calibration record to session metadata.

    Requires explicit reviewer_action: "accept". Pass the dict returned by
    compute_mounted_rider_calibration, optionally extended with accepted_dx,
    accepted_dy, and accepted_angle fields marking the chosen offset.

    Args:
        session_id: Session to write the calibration record to.
        calibration: Calibration payload from compute_mounted_rider_calibration.
        reviewer_action: Must be "accept" to proceed. Any other value is rejected.

    Returns:
        {ok: true, ...session payload} on success, {ok: false, error, code} on rejection.
    """
    if reviewer_action != "accept":
        return {
            "ok": False,
            "error": "reviewer_action must be 'accept'",
            "code": "reviewer_action_required",
        }
    if not calibration or not isinstance(calibration, dict):
        return {
            "ok": False,
            "error": "calibration must be a non-empty object from compute_mounted_rider_calibration",
            "code": "invalid_calibration",
        }
    result = _post_json("/api/workbench/session/mounted-calibration", {
        "session_id": session_id,
        "data": calibration,
    })
    if "error" in result:
        return {"ok": False, **result}
    return {"ok": True, **result}


@mcp.tool()
def get_mounted_cell_proposals(session_id: str) -> dict[str, Any]:
    """Derive per-angle exact-cell proposals from the session's confirmed calibration record.

    Uses each angle's own dx/dy from the calibration record (not the single display
    accepted_dx/dy). Returns per-angle cell sets classified as rider_only, mount_only,
    or overlap. No write side effects.

    Args:
        session_id: Session that has a confirmed mounted_rider_calibration record.

    Returns:
        player_xp, mounted_xp, calibration_ref_confirmed_at, layer_used, and
        per_angle list with angle, dx, dy, counts (rider_only/mount_only/overlap/unresolved),
        and cells (x, y, category, glyph, fg, bg).
    """
    return _post_json("/api/workbench/mounted-semantic/proposals", {
        "session_id": session_id,
    })


@mcp.tool()
def accept_mounted_cell_proposals(
    session_id: str,
    proposals: dict,
    reviewer_action: str,
) -> dict:
    """Write a confirmed semantic review record to a session.

    Requires explicit reviewer_action: "accept" and a non-empty proposals payload
    derived from a confirmed calibration record. No automatic write path — the
    reviewer_action declaration is the confirmation gate.

    Args:
        session_id: Session to write the semantic review record to.
        proposals: Proposal payload from get_mounted_cell_proposals (must include
                   per_angle, player, mounted, and calibration_ref_confirmed_at).
        reviewer_action: Must be "accept" to proceed. Any other value is rejected.

    Returns:
        Updated session payload confirming mounted_semantic_review was written.
    """
    if reviewer_action != "accept":
        return {
            "ok": False,
            "error": "reviewer_action must be 'accept'",
            "code": "reviewer_action_required",
        }
    if not proposals or not isinstance(proposals, dict):
        return {
            "ok": False,
            "error": "proposals must be a non-empty object from get_mounted_cell_proposals",
            "code": "invalid_proposals",
        }
    per_angle = proposals.get("per_angle")
    if not per_angle or not isinstance(per_angle, list):
        return {
            "ok": False,
            "error": "proposals.per_angle must be a non-empty list",
            "code": "invalid_proposals",
        }
    record = {
        "player_xp": proposals.get("player") or proposals.get("player_xp") or "",
        "mounted_xp": proposals.get("mounted") or proposals.get("mounted_xp") or "",
        "calibration_record_ref": {
            "confirmed_at": proposals.get("calibration_ref_confirmed_at"),
        },
        "per_angle_assignments": per_angle,
        "confirmed_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }
    result = _post_json("/api/workbench/session/mounted-semantic-review", {
        "session_id": session_id,
        "data": record,
    })
    if "error" in result:
        return {"ok": False, **result}
    return {"ok": True, **result}


# ===================================================================
# UQ-006: Source Manifest Tools (shared headless surface)
# ===================================================================


@mcp.tool()
def source_manifest_status(source_path: str) -> dict:
    """Get source manifest metadata and status.

    Args:
        source_path: Path to the source PNG image.

    Returns:
        Manifest metadata: exists, version, region_count, last_modified,
        SHA256 match status, bundle_blueprint_key, layout_mode.
    """
    return _get_qs("/api/workbench/source-manifest", {
        "source_path": source_path,
        "validate": "true",
    })


@mcp.tool()
def source_manifest_read(
    source_path: str,
    validate: bool = False,
    materialize: bool = False,
) -> dict:
    """Read a source manifest with optional validation and materialization.

    Args:
        source_path: Path to the source PNG image.
        validate: If true, run full validation and return errors/warnings.
        materialize: If true, return derived source_boxes/cuts mirror state.

    Returns:
        Manifest metadata + optional validation report + optional materialized state.
    """
    params: dict[str, str] = {"source_path": source_path}
    if validate:
        params["validate"] = "true"
    if materialize:
        params["materialize"] = "true"
    return _get_qs("/api/workbench/source-manifest", params)


@mcp.tool()
def source_manifest_write(
    source_path: str,
    manifest: dict,
    ack_stale_sha: bool = False,
) -> dict:
    """Write a full source manifest (atomic, validated).

    Returns 409 on SHA256 mismatch unless ack_stale_sha=True.
    Returns 422 on validation failures (duplicate targets, OOB regions, etc.).

    Args:
        source_path: Path to the source PNG image.
        manifest: Full manifest dict per §2.3.2 contract.
        ack_stale_sha: If true, overwrite even when source SHA256 mismatches.

    Returns:
        status, validation report, and materialized mirror state.
    """
    return _put_json("/api/workbench/source-manifest", {
        "source_path": source_path,
        "manifest": manifest,
        "ack_stale_sha": ack_stale_sha,
    })


@mcp.tool()
def source_manifest_validate(source_path: str) -> dict:
    """Validate a source manifest and return errors/warnings.

    Convenience alias for source_manifest_read with validate=True.

    Args:
        source_path: Path to the source PNG image.

    Returns:
        Manifest metadata + validation report with status (PASS/WARN/FAIL),
        errors list, warnings list, and SHA256 match info.
    """
    return _get_qs("/api/workbench/source-manifest", {
        "source_path": source_path,
        "validate": "true",
    })


@mcp.tool()
def source_manifest_materialize(source_path: str) -> dict:
    """Materialize manifest regions into source_boxes/cuts mirror state.

    Convenience alias for source_manifest_read with materialize=True.

    Args:
        source_path: Path to the source PNG image.

    Returns:
        Manifest metadata + materialized source_boxes, source_cuts_v,
        source_cuts_h, and source_anchor_box.
    """
    return _get_qs("/api/workbench/source-manifest", {
        "source_path": source_path,
        "materialize": "true",
    })


# ===================================================================
# Entry point
# ===================================================================

if __name__ == "__main__":
    mcp.run()
