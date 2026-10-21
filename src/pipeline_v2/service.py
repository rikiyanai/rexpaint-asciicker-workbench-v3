from __future__ import annotations

import base64
import hashlib
import json
import logging
import math
import os
import shlex
import shutil
import statistics
import subprocess
import threading
import time
import uuid

_log = logging.getLogger(__name__)
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from PIL import Image

from .config import (
    ensure_dirs,
    ROOT,
    UPLOAD_DIR,
    JOBS_DIR,
    PREVIEWS_DIR,
    GATES_DIR,
    TRACES_DIR,
    SESSIONS_DIR,
    EXPORT_DIR,
    BUNDLES_DIR,
    CONFIG_DIR,
    SPRITES_DIR,
)
from .gates import (
    gate_g7_geometry, gate_g8_nonempty, gate_g9_handoff,
    gate_g10_action_dims, gate_g11_layer_count, gate_g12_l0_metadata,
    THRESHOLD_BREACHED,
)
from .models import ApiError, RunConfig, JobRecord, WorkbenchSession, BundleSession, BundleActionState
from .renderer import render_preview_png
from .source_manifest import (
    MANIFEST_VERSION,
    create_migration_manifest,
    load_manifest,
    manifest_path_for_source,
    materialize_manifest,
    save_manifest,
    validate_manifest,
)
from .storage import save_json, load_json
from .runtime_contract import action_spec_for_session, validate_runtime_export
from .xp_codec import write_xp, read_xp
from .xp_codec import encode_xp, write_xp, read_xp

# Ensure the scripts directory is on sys.path so that mounted_rider_offset
# (and other standalone scripts) can be imported by service functions.
import sys as _sys
_SCRIPTS_DIR = str(ROOT / "scripts")
if _SCRIPTS_DIR not in _sys.path:
    _sys.path.insert(0, _SCRIPTS_DIR)

# Rich glyph assignment (FL-4095+ CP437 font-mask matcher)
from glyph_assignment import GlyphAssignmentConfig, assign_image_cells
from glyph_assignment.matcher import default_font_path

MAGENTA_BG = (255, 0, 255)

# Native player skin contract: the WASM engine expects exactly these dimensions.
NATIVE_COLS = 126
NATIVE_ROWS = 80
NATIVE_ANGLES = 8
NATIVE_CELL_H = 10  # rows per angle block (80 / 8)
DEFAULT_ROOT_BLANK_SESSION = {
    "angles": 8,
    "anims": [9],
    "source_projs": 1,
    "projs": 2,
    "cell_w": 7,
    "cell_h": 10,
    "family": "player",
}
WORKBENCH_VERIFY_DIR = ROOT / "output" / "workbench_verify"
WORKBENCH_TERMPP_DIR = ROOT / "output" / "termpp_skin_runs"
WORKBENCH_STREAM_DIR = ROOT / "output" / "termpp_stream"
_TERM_STREAM_LOCK = threading.Lock()
_TERM_STREAMS: dict[str, dict[str, Any]] = {}

_LEGACY_PREVIEW_TOKEN_TTL_SECONDS = 90
_LEGACY_PREVIEW_MAX_XP_BYTES = 5 * 1024 * 1024
_LEGACY_PREVIEW_LOCK = threading.Lock()
_LEGACY_PREVIEW_TOKENS: dict[str, dict[str, Any]] = {}

_LEGACY_PREVIEW_CONTRACTS: dict[tuple[int, int], dict[str, Any]] = {
    (126, 72): {
        "family": "player",
        "runtime_state": "on_foot_no_equipment",
        "mount_state": 0,
    },
    (180, 96): {
        "family": "wolfie",
        "runtime_state": "mounted_wolf_no_equipment",
        "mount_state": 1,
    },
}


def _legacy_preview_family_targets(family: str) -> list[str]:
    if family not in {"player", "wolfie"}:
        raise ValueError(f"unsupported legacy preview family: {family}")
    return [
        f"/sprites/{family}-{armor}{helmet}{shield}{weapon}.xp"
        for armor in range(2)
        for helmet in range(2)
        for shield in range(2)
        for weapon in range(3)
    ]


def _termpp_skin_override_names(registry: dict[str, Any]) -> list[str]:
    """Override names derived from registry prefix_catalog ahsw_range.

    Iterates prefix_catalog entries that declare ahsw_range and generates
    AHSW override filenames via _action_override_names().  player-nude.xp
    is included by _action_override_names when family=="player" and
    ahsw_range=="all_16".
    """
    out: list[str] = []
    prefix_catalog = registry.get("prefix_catalog", {})
    for prefix_key, prefix_spec in prefix_catalog.items():
        ahsw_range = (prefix_spec.get("ahsw_range") or "").strip()
        if not ahsw_range:
            continue
        out.extend(_action_override_names(prefix_key, ahsw_range))
    return out


def request_id() -> str:
    return str(uuid.uuid4())


def _resolve_xp_tool_repo_root() -> Path:
    env_root = os.environ.get("XP_TOOL_REPO_ROOT", "").strip()
    if env_root:
        return Path(env_root).expanduser().resolve()
    return ROOT.resolve()


def _xp_tool_command_parts(xp_path: Path) -> tuple[list[str], Path]:
    repo_root = _resolve_xp_tool_repo_root()
    tool_module = repo_root / "scripts" / "asset_gen" / "xp_tool.py"
    if not tool_module.exists():
        raise FileNotFoundError(
            "xp_tool module not found at "
            f"{tool_module}. "
            "Install/add scripts/asset_gen/xp_tool.py in this repo, or set XP_TOOL_REPO_ROOT "
            "to an external repo that provides it."
        )
    argv = ["python3", "-m", "scripts.asset_gen.xp_tool", str(xp_path.resolve())]
    return argv, repo_root


def _resolve_legacy_repo_root() -> Path:
    env_root = os.environ.get("TERMPP_REPO_ROOT", "").strip()
    if env_root:
        return Path(env_root).expanduser().resolve()
    return ROOT.resolve()


def _resolve_termpp_binary(legacy_root: Path, binary_name: str = "game_term") -> Path:
    b = str(binary_name or "game_term").strip() or "game_term"
    if "/" in b or "\\" in b:
        raise ValueError("binary_name must be a bare filename")
    p = legacy_root / ".run" / b
    if not p.exists():
        raise FileNotFoundError(
            "TERM++ binary not found: "
            f"{p}. "
            "Build/install TERM++ under this repo (.run/<binary>) or set TERMPP_REPO_ROOT "
            "to an external TERM++ repo."
        )
    return p.resolve()


def _normalize_binary_name(binary_name: str = "game_term") -> str:
    b = str(binary_name or "game_term").strip() or "game_term"
    if "/" in b or "\\" in b:
        raise ValueError("binary_name must be a bare filename")
    return b


def _stream_capture_command(region: dict[str, int], out_path: Path) -> list[str]:
    x = int(region["x"])
    y = int(region["y"])
    w = int(region["w"])
    h = int(region["h"])
    return ["/usr/sbin/screencapture", "-x", f"-R{x},{y},{w},{h}", str(out_path)]


def _termpp_stream_worker(stream_id: str) -> None:
    while True:
        with _TERM_STREAM_LOCK:
            rec = _TERM_STREAMS.get(stream_id)
            if not rec:
                return
            stop_evt = rec["stop_event"]
            region = dict(rec["region"])
            fps = max(1, int(rec.get("fps", 4)))
            frame_path = Path(rec["frame_path"])
            tmp_path = frame_path.with_suffix(".tmp.png")
        if stop_evt.is_set():
            break
        t0 = time.time()
        try:
            cmd = _stream_capture_command(region, tmp_path)
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if proc.returncode == 0 and tmp_path.exists():
                tmp_path.replace(frame_path)
                with _TERM_STREAM_LOCK:
                    rec2 = _TERM_STREAMS.get(stream_id)
                    if rec2:
                        rec2["frame_count"] = int(rec2.get("frame_count", 0)) + 1
                        rec2["last_frame_ts"] = time.time()
                        rec2["last_error"] = None
            else:
                err = (proc.stderr or proc.stdout or f"screencapture failed rc={proc.returncode}").strip()
                with _TERM_STREAM_LOCK:
                    rec2 = _TERM_STREAMS.get(stream_id)
                    if rec2:
                        rec2["last_error"] = err
        except Exception as e:
            with _TERM_STREAM_LOCK:
                rec2 = _TERM_STREAMS.get(stream_id)
                if rec2:
                    rec2["last_error"] = str(e)
        finally:
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
            except Exception:
                pass
        elapsed = time.time() - t0
        sleep_s = max(0.01, (1.0 / max(1, fps)) - elapsed)
        stop_evt.wait(sleep_s)
    with _TERM_STREAM_LOCK:
        rec = _TERM_STREAMS.get(stream_id)
        if rec:
            rec["running"] = False
            rec["stopped_at"] = time.time()


def _termpp_stream_record_view(rec: dict[str, Any]) -> dict[str, Any]:
    frame_path = Path(rec["frame_path"])
    return {
        "stream_id": str(rec["stream_id"]),
        "session_id": str(rec.get("session_id") or ""),
        "running": bool(rec.get("running", False)),
        "fps": int(rec.get("fps", 4)),
        "region": {
            "x": int(rec["region"]["x"]),
            "y": int(rec["region"]["y"]),
            "w": int(rec["region"]["w"]),
            "h": int(rec["region"]["h"]),
        },
        "frame_count": int(rec.get("frame_count", 0)),
        "last_frame_ts": rec.get("last_frame_ts"),
        "last_error": rec.get("last_error"),
        "frame_path": str(frame_path.resolve()),
        "has_frame": frame_path.exists(),
        "created_at": rec.get("created_at"),
        "stopped_at": rec.get("stopped_at"),
    }


def _list_top_level_entries(root: Path) -> list[Path]:
    out: list[Path] = []
    for p in root.iterdir():
        if p.name in {".git", ".run", "sprites"}:
            continue
        out.append(p)
    return out


def _stage_termpp_skin_sandbox(legacy_root: Path, xp_path: Path, run_id: str, binary_name: str) -> dict[str, Any]:
    termpp_bin = _resolve_termpp_binary(legacy_root, binary_name=binary_name)
    runtime_root = WORKBENCH_TERMPP_DIR / run_id
    if runtime_root.exists():
        shutil.rmtree(runtime_root)
    runtime_root.mkdir(parents=True, exist_ok=True)

    # Symlink most of the legacy repo to avoid copying large assets while keeping original files untouched.
    linked_entries: list[str] = []
    for src in _list_top_level_entries(legacy_root):
        dst = runtime_root / src.name
        try:
            os.symlink(src, dst)
            linked_entries.append(src.name)
        except FileExistsError:
            pass

    # Copy runtime binary so base_path resolves to the sandbox (not the original .run path).
    run_dir = runtime_root / ".run"
    run_dir.mkdir(parents=True, exist_ok=True)
    staged_bin = run_dir / termpp_bin.name
    shutil.copy2(termpp_bin, staged_bin)
    try:
        staged_bin.chmod(termpp_bin.stat().st_mode)
    except Exception:
        pass

    # Create sprites overlay dir with symlinked contents, then overwrite target skin files as real files.
    legacy_sprites = legacy_root / "sprites"
    if not legacy_sprites.exists():
        raise FileNotFoundError(f"Legacy sprites dir missing: {legacy_sprites}")
    sprites_dst = runtime_root / "sprites"
    sprites_dst.mkdir(parents=True, exist_ok=True)
    sprite_entries_linked = 0
    for src in legacy_sprites.iterdir():
        dst = sprites_dst / src.name
        try:
            os.symlink(src, dst)
            sprite_entries_linked += 1
        except FileExistsError:
            pass

    # Disk-level approximation of editor quick-skin: override the most common player-facing filenames.
    override_names = _termpp_skin_override_names(load_template_registry())
    written: list[str] = []
    for name in override_names:
        dst = sprites_dst / name
        if dst.exists() or dst.is_symlink():
            try:
                dst.unlink()
            except IsADirectoryError:
                continue
        shutil.copy2(xp_path, dst)
        written.append(name)

    return {
        "legacy_root": str(legacy_root.resolve()),
        "runtime_root": str(runtime_root.resolve()),
        "runtime_binary": str(staged_bin.resolve()),
        "linked_top_level_entries": linked_entries,
        "linked_sprite_entries_count": int(sprite_entries_linked),
        "skin_override_files": written,
    }


def _workbench_verify_local_xp_sanity(xp_path: Path, session: dict[str, Any]) -> dict[str, Any]:
    parsed = read_xp(xp_path)
    width = int(parsed["width"])
    height = int(parsed["height"])
    layers = int(parsed["layers"])
    cells = parsed["cells"]
    visual_idx = 2 if layers >= 3 else 0
    visual = cells[visual_idx]
    populated = sum(1 for glyph, _fg, _bg in visual if int(glyph) not in (0, 32))
    expected_cols = int(session["grid_cols"])
    expected_rows = int(session["grid_rows"])
    expected_angles = int(session["angles"])
    expected_anims = [int(x) for x in session["anims"]]
    checks = [
        {"name": "xp_exists", "ok": xp_path.exists(), "detail": str(xp_path.resolve())},
        {"name": "layer_count>=3", "ok": layers >= 3, "detail": f"layers={layers}"},
        {"name": "geometry_matches_session", "ok": width == expected_cols and height == expected_rows, "detail": f"xp={width}x{height} session={expected_cols}x{expected_rows}"},
        {"name": "visual_nonempty", "ok": populated > 0, "detail": f"populated={populated}"},
    ]
    # Metadata check from top row of metadata layer is intentionally light-weight here:
    # session is the authoritative workbench state at export time.
    checks.append({"name": "session_angles_valid", "ok": expected_angles >= 1, "detail": f"angles={expected_angles}"})
    checks.append({"name": "session_anims_valid", "ok": len(expected_anims) >= 1 and all(x >= 1 for x in expected_anims), "detail": f"anims={expected_anims}"})
    passed = all(bool(c["ok"]) for c in checks)
    lines = ["[VERIFY] Local XP sanity verifier", f"[VERIFY] xp={xp_path}", f"[VERIFY] layers={layers} width={width} height={height} populated={populated}"]
    for c in checks:
        tag = "PASS" if c["ok"] else "FAIL"
        lines.append(f"[{tag}] {c['name']}: {c['detail']}")
    lines.append(f"[VERIFY] Overall: {'PASS' if passed else 'FAIL'}")
    return {
        "profile": "local_xp_sanity",
        "passed": passed,
        "exit_code": 0 if passed else 1,
        "command": None,
        "cwd": str(ROOT.resolve()),
        "stdout": "\n".join(lines),
        "stderr": "",
        "checks": checks,
        "stats": {
            "layers": layers,
            "width": width,
            "height": height,
            "visual_populated_cells": populated,
            "angles": expected_angles,
            "anims": expected_anims,
        },
    }


def _workbench_verify_custom_shell(xp_path: Path, profile: str, command_template: str, timeout_sec: int, req_id: str) -> dict[str, Any]:
    template = str(command_template or "").strip()
    if not template:
        raise ApiError("command_template is required for custom verification", "missing_command_template", "workbench", req_id, 422)
    legacy_root = _resolve_legacy_repo_root()
    try:
        command = template.format(
            xp_path=str(xp_path.resolve()),
            legacy_repo_root=str(legacy_root),
            pipeline_repo_root=str(ROOT.resolve()),
        )
    except KeyError as e:
        raise ApiError(f"invalid command_template placeholder: {e}", "invalid_command_template", "workbench", req_id, 422)
    env = os.environ.copy()
    env.setdefault("PIPELINE_V2_ROOT", str(ROOT.resolve()))
    env.setdefault("ASCIICKER_LEGACY_ROOT", str(legacy_root))
    started = time.time()
    try:
        proc = subprocess.run(
            command,
            cwd=str(ROOT.resolve()),
            shell=True,
            capture_output=True,
            text=True,
            timeout=max(1, int(timeout_sec)),
            env=env,
        )
        timed_out = False
        code = int(proc.returncode)
        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
    except subprocess.TimeoutExpired as e:
        timed_out = True
        code = 124
        stdout = e.stdout or ""
        stderr = (e.stderr or "") + f"\n[workbench] verification timed out after {int(timeout_sec)}s"
    duration_ms = int((time.time() - started) * 1000)
    return {
        "profile": profile,
        "passed": (not timed_out and code == 0),
        "exit_code": code,
        "timed_out": timed_out,
        "command": command,
        "cwd": str(ROOT.resolve()),
        "stdout": stdout,
        "stderr": stderr,
        "duration_ms": duration_ms,
        "checks": [],
        "stats": {},
    }


def _suggest_run_geometry(
    image_w: int,
    image_h: int,
    source_image: Image.Image | None = None,
) -> tuple[int, list[int], int, int, int, int, dict[str, Any]]:
    """Pick analyze defaults that are likely to pass run-time geometry guards."""
    min_aspect = 0.35
    max_aspect = 1.2
    target_aspect = 0.75
    min_frame_px = 16
    max_frame_px = 256
    min_tiles = 4
    max_tiles = 128
    max_angles = min(max(1, image_h), 16)
    max_frames = min(max(1, image_w), 64)
    checked = 0
    best: dict[str, Any] | None = None
    ranked: list[dict[str, Any]] = []
    best_by_source_projs: dict[int, dict[str, Any]] = {}
    sample_rgba = source_image.convert("RGBA") if source_image is not None else None
    sample_bg_rgb = _estimate_bg_rgb(sample_rgba) if sample_rgba is not None else (0, 0, 0)
    sample_signal_mode = _infer_signal_mode(sample_rgba) if sample_rgba is not None else "delta"
    semantic_cache: dict[tuple[int, int, int], tuple[float, float]] = {}
    resample_nearest = getattr(Image, "Resampling", Image).NEAREST

    def _suggest_render_resolution(frame_px_w: int, angle_px_h: int) -> int:
        # Prefer denser defaults for larger frames to reduce visible degeneration.
        # Small sheets remain conservative to avoid excessive noise.
        min_rr = 12
        if frame_px_w >= 140 and angle_px_h >= 180:
            target_w_chars = 22.0
            target_h_chars = 30.0
            min_rr = 8
        elif frame_px_w >= 96 and angle_px_h >= 128:
            target_w_chars = 20.0
            target_h_chars = 26.0
            min_rr = 10
        else:
            target_w_chars = 16.0
            target_h_chars = 20.0
        raw = max(frame_px_w / target_w_chars, angle_px_h / target_h_chars)
        return max(min_rr, min(24, int(round(raw))))

    def _foreground_mask(tile: Image.Image) -> list[list[bool]]:
        rgba = tile.convert("RGBA")
        w, h = rgba.size
        out = [[False for _ in range(w)] for _ in range(h)]
        bg_r, bg_g, bg_b = sample_bg_rgb
        for y in range(h):
            for x in range(w):
                r, g, b, a = rgba.getpixel((x, y))
                if a < 16:
                    continue
                if sample_signal_mode == "delta":
                    delta = abs(int(r) - bg_r) + abs(int(g) - bg_g) + abs(int(b) - bg_b)
                    if delta <= 38:
                        continue
                out[y][x] = True
        return out

    def _run_segments(vals: list[int], thr: int, min_len: int) -> list[tuple[int, int]]:
        out: list[tuple[int, int]] = []
        i = 0
        n = len(vals)
        while i < n:
            if vals[i] <= thr:
                i += 1
                continue
            j = i
            while j + 1 < n and vals[j + 1] > thr:
                j += 1
            if (j - i + 1) >= min_len:
                out.append((i, j))
            i = j + 1
        return out

    def _semantic_penalty(angles: int, semantic_frames: int, source_projs: int) -> tuple[float, float]:
        key = (angles, semantic_frames, source_projs)
        if key in semantic_cache:
            return semantic_cache[key]
        if sample_rgba is None:
            semantic_cache[key] = (0.0, 0.0)
            return semantic_cache[key]

        source_frame_cols = semantic_frames * source_projs
        if source_frame_cols <= 0 or source_frame_cols > image_w:
            semantic_cache[key] = (8.0, 1.0)
            return semantic_cache[key]

        frame_px_w = max(1, image_w // source_frame_cols)
        angle_px_h = max(1, image_h // angles)
        base_points = [
            (0, 0),
            (0, semantic_frames - 1),
            (angles - 1, 0),
            (angles - 1, semantic_frames - 1),
            (angles // 2, semantic_frames // 2),
        ]
        sample_points: list[tuple[int, int, int]] = []
        for row_i, col_i in base_points:
            sample_points.append((row_i, col_i, 0))
            if source_projs > 1:
                sample_points.append((row_i, col_i, min(1, source_projs - 1)))
        split_sum = 0.0
        empty_count = 0
        used = 0

        for row_i, col_i, proj_i in sample_points:
            row_i = max(0, min(angles - 1, row_i))
            col_i = max(0, min(semantic_frames - 1, col_i))
            source_col = col_i + (proj_i * semantic_frames)
            x0 = source_col * frame_px_w
            y0 = row_i * angle_px_h
            x1 = min(image_w, x0 + frame_px_w)
            y1 = min(image_h, y0 + angle_px_h)
            if x1 <= x0 or y1 <= y0:
                continue
            tile = sample_rgba.crop((x0, y0, x1, y1))
            if tile.width > 96 or tile.height > 96:
                scale = max(tile.width / 96.0, tile.height / 96.0)
                tile = tile.resize(
                    (
                        max(8, int(tile.width / scale)),
                        max(8, int(tile.height / scale)),
                    ),
                    resample_nearest,
                )
            mask = _foreground_mask(tile)
            h = len(mask)
            w = len(mask[0]) if h else 0
            if w <= 0 or h <= 0:
                continue

            col_counts = [0 for _ in range(w)]
            row_counts = [0 for _ in range(h)]
            fg_count = 0
            for y in range(h):
                for x in range(w):
                    if mask[y][x]:
                        col_counts[x] += 1
                        row_counts[y] += 1
                        fg_count += 1
            occ = fg_count / max(1, w * h)
            if occ < 0.015:
                empty_count += 1

            col_thr = max(1, int(h * 0.08))
            row_thr = max(1, int(w * 0.08))
            col_segments = _run_segments(col_counts, col_thr, max(2, int(w * 0.14)))
            row_segments = _run_segments(row_counts, row_thr, max(2, int(h * 0.14)))

            split_pen = 0.0
            if len(col_segments) >= 2:
                split_pen += 1.10 * (len(col_segments) - 1)
            if len(row_segments) >= 2:
                split_pen += 0.50 * (len(row_segments) - 1)
            split_sum += split_pen
            used += 1

        if used <= 0:
            semantic_cache[key] = (0.0, 0.0)
        else:
            semantic_cache[key] = (split_sum / used, empty_count / used)
        return semantic_cache[key]

    def _grid_hint() -> dict[str, Any]:
        if sample_rgba is None:
            return {}

        hint_im = sample_rgba
        hw, hh = hint_im.size
        max_dim = 512
        if hw > max_dim or hh > max_dim:
            scale = max(hw / max_dim, hh / max_dim)
            hint_im = hint_im.resize((max(64, int(hw / scale)), max(64, int(hh / scale))), resample_nearest)

        mask = _foreground_mask(hint_im)
        h = len(mask)
        w = len(mask[0]) if h else 0
        if w <= 0 or h <= 0:
            return {}

        row_counts = [0 for _ in range(h)]
        for y in range(h):
            row_counts[y] = sum(1 for x in range(w) if mask[y][x])

        row_thr = max(1, int(w * 0.015))
        row_segments = _run_segments(row_counts, row_thr, max(2, int(h * 0.01)))
        if len(row_segments) < 2 or len(row_segments) > 24:
            return {
                "rows_hint": None,
                "source_cols_hint": None,
                "rows_detected": len(row_segments),
                "cols_samples": 0,
            }

        col_counts_per_row: list[int] = []
        projection_gap_hits = 0
        for y0, y1 in row_segments:
            cols = [0 for _ in range(w)]
            for y in range(y0, y1 + 1):
                row = mask[y]
                for x in range(w):
                    if row[x]:
                        cols[x] += 1
            row_h = max(1, y1 - y0 + 1)
            col_thr = max(1, int(row_h * 0.06))
            col_segments = _run_segments(cols, col_thr, max(2, int(w * 0.005)))
            if col_segments:
                col_counts_per_row.append(len(col_segments))
                # Detect a pronounced center gap between two projection groups.
                # Typical signal: many small frame gaps plus one much wider mid-sheet gap.
                gap_widths: list[int] = []
                max_gap = 0
                max_gap_center = 0.0
                for i in range(len(col_segments) - 1):
                    left = col_segments[i]
                    right = col_segments[i + 1]
                    gap = right[0] - left[1] - 1
                    if gap <= 0:
                        continue
                    gap_widths.append(gap)
                    if gap > max_gap:
                        max_gap = gap
                        max_gap_center = ((left[1] + right[0]) * 0.5) / max(1, w)
                if gap_widths:
                    med_gap = statistics.median(gap_widths)
                    if (
                        max_gap >= max(2, int(med_gap * 2.2))
                        and 0.35 <= max_gap_center <= 0.65
                    ):
                        projection_gap_hits += 1

        rows_hint = len(row_segments)
        cols_hint: int | None = None
        cols_std = 0.0
        if col_counts_per_row:
            cols_med = int(statistics.median(col_counts_per_row))
            cols_std = statistics.pstdev(col_counts_per_row) if len(col_counts_per_row) > 1 else 0.0
            if cols_std <= max(2.0, cols_med * 0.25):
                cols_hint = cols_med

        return {
            "rows_hint": rows_hint,
            "source_cols_hint": cols_hint,
            "rows_detected": len(row_segments),
            "cols_samples": len(col_counts_per_row),
            "cols_std": round(cols_std, 4),
            "projection_split_hint": (
                projection_gap_hits >= max(2, int(math.ceil(len(col_counts_per_row) * 0.25)))
                if col_counts_per_row
                else False
            ),
            "projection_split_rows": int(projection_gap_hits),
        }

    grid_hint = _grid_hint()
    rows_hint = grid_hint.get("rows_hint")
    source_cols_hint = grid_hint.get("source_cols_hint")
    cols_samples = int(grid_hint.get("cols_samples", 0) or 0)
    use_grid_prior = (
        isinstance(rows_hint, int)
        and isinstance(source_cols_hint, int)
        and rows_hint >= 2
        and rows_hint <= 12
        and source_cols_hint >= 2
        and source_cols_hint <= 12
        and cols_samples >= 4
    )
    use_large_col_hint = (
        isinstance(source_cols_hint, int)
        and source_cols_hint >= 14
        and source_cols_hint <= 64
        and cols_samples >= 6
    )
    projection_split_hint = bool(grid_hint.get("projection_split_hint", False))

    for angles in range(1, max_angles + 1):
        for semantic_frames in range(1, max_frames + 1):
            for source_projs in (1, 2):
                source_frame_cols = semantic_frames * source_projs
                if source_frame_cols > image_w:
                    continue

                frame_px_w = max(1, image_w // source_frame_cols)
                angle_px_h = max(1, image_h // angles)
                aspect = frame_px_w / max(1, angle_px_h)
                checked += 1
                if aspect < min_aspect or aspect > max_aspect:
                    continue

                # Penalize implausible frame dimensions: they pass geometry but tend to
                # collapse semantic slicing (e.g., giant 1x2 splits on real sheets).
                size_penalty = 0.0
                if frame_px_w < min_frame_px:
                    size_penalty += ((min_frame_px - frame_px_w) / max(1, min_frame_px)) * 6.0
                elif frame_px_w > max_frame_px:
                    size_penalty += ((frame_px_w - max_frame_px) / max(1, max_frame_px)) * 8.0
                if angle_px_h < min_frame_px:
                    size_penalty += ((min_frame_px - angle_px_h) / max(1, min_frame_px)) * 6.0
                elif angle_px_h > max_frame_px:
                    size_penalty += ((angle_px_h - max_frame_px) / max(1, max_frame_px)) * 8.0

                divisibility_penalty = (0 if image_w % source_frame_cols == 0 else 1) + (0 if image_h % angles == 0 else 1)
                tile_count = angles * semantic_frames
                tile_penalty = 0.0
                if tile_count < min_tiles:
                    tile_penalty += (min_tiles - tile_count) * 0.6
                if tile_count > max_tiles:
                    tile_penalty += (tile_count - max_tiles) / 64.0
                grid_penalty = 0.0
                if use_grid_prior:
                    assert isinstance(rows_hint, int)
                    assert isinstance(source_cols_hint, int)
                    grid_penalty = (abs(angles - rows_hint) * 0.45) + (abs(source_frame_cols - source_cols_hint) * 0.3)
                col_hint_penalty = 0.0
                if use_large_col_hint:
                    assert isinstance(source_cols_hint, int)
                    col_hint_penalty = abs(source_frame_cols - source_cols_hint) * 0.12
                angle_pref = min(abs(angles - 1), abs(angles - 4), abs(angles - 8)) * 0.04
                if projection_split_hint:
                    source_projs_pref = 0.0 if source_projs == 2 else 0.10
                else:
                    source_projs_pref = 0.0 if source_projs == 1 else 0.04
                semantic_split_penalty = 0.0
                semantic_empty_ratio = 0.0
                if sample_rgba is not None and divisibility_penalty <= 1:
                    semantic_split_penalty, semantic_empty_ratio = _semantic_penalty(angles, semantic_frames, source_projs)
                score = (
                    abs(aspect - target_aspect)
                    + (angles - 1) * 0.01
                    + (semantic_frames - 1) * 0.005
                    + divisibility_penalty * 0.2
                    + size_penalty
                    + tile_penalty
                    + grid_penalty
                    + col_hint_penalty
                    + angle_pref
                    + source_projs_pref
                    + semantic_split_penalty * 2.0
                    + semantic_empty_ratio * 0.75
                )
                ranked.append(
                    {
                        "score": round(score, 6),
                        "angles": angles,
                        "frames": semantic_frames,
                        "source_projs": source_projs,
                        "frame_aspect": round(aspect, 4),
                        "frame_px_w": frame_px_w,
                        "frame_px_h": angle_px_h,
                        "grid_penalty": round(grid_penalty, 6),
                        "col_hint_penalty": round(col_hint_penalty, 6),
                        "semantic_split_penalty": round(semantic_split_penalty, 6),
                        "semantic_empty_ratio": round(semantic_empty_ratio, 6),
                    }
                )
                if best is None or score < best["score"]:
                    best = {
                        "score": score,
                        "angles": angles,
                        "frames": semantic_frames,
                        "source_projs": source_projs,
                        "source_frame_cols": source_frame_cols,
                        "frame_aspect": aspect,
                        "frame_px_w": frame_px_w,
                        "frame_px_h": angle_px_h,
                        "tile_count": tile_count,
                        "grid_penalty": grid_penalty,
                        "col_hint_penalty": col_hint_penalty,
                        "semantic_split_penalty": semantic_split_penalty,
                        "semantic_empty_ratio": semantic_empty_ratio,
                    }
                prev = best_by_source_projs.get(source_projs)
                if prev is None or score < prev["score"]:
                    best_by_source_projs[source_projs] = {
                        "score": score,
                        "angles": angles,
                        "frames": semantic_frames,
                        "source_projs": source_projs,
                        "source_frame_cols": source_frame_cols,
                        "frame_aspect": aspect,
                        "frame_px_w": frame_px_w,
                        "frame_px_h": angle_px_h,
                        "tile_count": tile_count,
                        "grid_penalty": grid_penalty,
                        "col_hint_penalty": col_hint_penalty,
                        "semantic_split_penalty": semantic_split_penalty,
                        "semantic_empty_ratio": semantic_empty_ratio,
                    }

    if best is None:
        # Defensive fallback for extreme dimensions outside search budget.
        src_aspect = image_w / max(1, image_h)
        if src_aspect > max_aspect:
            angles = 1
            semantic_frames = max(1, int(math.ceil(src_aspect / max_aspect)))
        elif src_aspect < min_aspect:
            angles = max(1, int(math.ceil(min_aspect / max(src_aspect, 1e-6))))
            semantic_frames = 1
        else:
            angles = 1
            semantic_frames = 1
        semantic_frames = min(max(1, semantic_frames), max(1, image_w))
        angles = min(max(1, angles), max(1, image_h))
        frame_px_w = max(1, image_w // semantic_frames)
        angle_px_h = max(1, image_h // angles)
        return (
            angles,
            [semantic_frames],
            frame_px_w,
            angle_px_h,
            1,
            _suggest_render_resolution(frame_px_w, angle_px_h),
            {
                "method": "geometry_fallback",
                "checked": checked,
                "target_frame_aspect": target_aspect,
                "suggested_frame_aspect": frame_px_w / max(1, angle_px_h),
                "suggested_source_projs": 1,
            },
        )

    selected = best
    projection_override_reason: str | None = None
    # If grid evidence strongly suggests split projection groups, allow the best
    # source_projs=2 candidate (with its own semantic frame count) to win even
    # when source_projs=1 is marginally better by score.
    alt_by_projs2 = best_by_source_projs.get(2)
    if (
        int(best["source_projs"]) == 1
        and alt_by_projs2 is not None
        and isinstance(source_cols_hint, int)
    ):
        alt_cols = int(alt_by_projs2["source_frame_cols"])
        hint_match = abs(alt_cols - int(source_cols_hint)) <= 1
        score_gap = float(alt_by_projs2["score"]) - float(best["score"])
        split_gain = float(best["semantic_split_penalty"]) - float(alt_by_projs2["semantic_split_penalty"])
        if (
            projection_split_hint
            and hint_match
            and score_gap <= 0.60
        ) or (
            hint_match
            and split_gain >= 0.15
            and score_gap <= 0.35
        ):
            selected = alt_by_projs2
            projection_override_reason = (
                "projection split hint matched source_projs=2 candidate "
                f"(source_cols_hint={source_cols_hint}, cols={alt_cols}, "
                f"score_gap={score_gap:.3f}, split_gain={split_gain:.3f})."
            )

    frame_px_w = max(1, image_w // int(selected["source_frame_cols"]))
    angle_px_h = max(1, image_h // int(selected["angles"]))
    suggested_source_projs = int(selected["source_projs"])
    if (
        suggested_source_projs == 1
        and sample_rgba is not None
        and float(selected["semantic_split_penalty"]) >= 0.15
    ):
        alt_source_frame_cols = int(selected["frames"]) * 2
        if alt_source_frame_cols <= image_w:
            alt_frame_px_w = max(1, image_w // alt_source_frame_cols)
            alt_angle_px_h = max(1, image_h // int(selected["angles"]))
            alt_aspect = alt_frame_px_w / max(1, alt_angle_px_h)
            if min_aspect <= alt_aspect <= max_aspect:
                alt_split, alt_empty = _semantic_penalty(int(selected["angles"]), int(selected["frames"]), 2)
                base_split = float(selected["semantic_split_penalty"])
                base_empty = float(selected["semantic_empty_ratio"])
                if alt_split <= (base_split * 0.6) and alt_empty <= (base_empty + 0.05):
                    suggested_source_projs = 2
                    frame_px_w = alt_frame_px_w
                    angle_px_h = alt_angle_px_h
                    projection_override_reason = (
                        "source_projs=1 candidate had split foreground; source_projs=2 lowered split penalty "
                        f"({base_split:.3f} -> {alt_split:.3f}) at same angles/frames."
                    )
    suggested_render_resolution = _suggest_render_resolution(frame_px_w, angle_px_h)
    return (
        int(selected["angles"]),
        [int(selected["frames"])],
        frame_px_w,
        angle_px_h,
        suggested_source_projs,
        suggested_render_resolution,
        {
            "method": "geometry_search",
            "checked": checked,
            "target_frame_aspect": target_aspect,
            "suggested_frame_aspect": selected["frame_aspect"],
            "suggested_source_projs": suggested_source_projs,
            "suggested_render_resolution": suggested_render_resolution,
            "suggested_frame_px_w": selected["frame_px_w"],
            "suggested_frame_px_h": selected["frame_px_h"],
            "suggested_tile_count": selected["tile_count"],
            "grid_hint": grid_hint,
            "grid_prior_used": use_grid_prior,
            "large_col_hint_used": use_large_col_hint,
            "grid_penalty": selected["grid_penalty"],
            "col_hint_penalty": selected["col_hint_penalty"],
            "semantic_split_penalty": selected["semantic_split_penalty"],
            "semantic_empty_ratio": selected["semantic_empty_ratio"],
            "search_limits": {"max_angles": max_angles, "max_frames": max_frames},
            "frame_px_bounds": {"min": min_frame_px, "max": max_frame_px},
            "top_candidates": sorted(ranked, key=lambda c: c["score"])[:20],
            "selected_candidate": {
                "angles": int(selected["angles"]),
                "frames": int(selected["frames"]),
                "source_projs": int(selected["source_projs"]),
                "source_frame_cols": int(selected["source_frame_cols"]),
                "score": round(float(selected["score"]), 6),
            },
            "projection_override": projection_override_reason,
            "best_by_source_projs": {
                str(k): {
                    "score": round(v["score"], 6),
                    "angles": int(v["angles"]),
                    "frames": int(v["frames"]),
                    "source_projs": int(v["source_projs"]),
                    "frame_aspect": round(v["frame_aspect"], 4),
                    "frame_px_w": int(v["frame_px_w"]),
                    "frame_px_h": int(v["frame_px_h"]),
                    "grid_penalty": round(v["grid_penalty"], 6),
                    "col_hint_penalty": round(v["col_hint_penalty"], 6),
                    "semantic_split_penalty": round(v["semantic_split_penalty"], 6),
                    "semantic_empty_ratio": round(v["semantic_empty_ratio"], 6),
                }
                for k, v in sorted(best_by_source_projs.items(), key=lambda kv: kv[0])
            },
        },
    )


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(8192)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


_template_registry: dict[str, Any] | None = None
_l0_reference_cache: dict[str, list[Cell]] = {}
_l0_reference_status: dict[str, str] = {}
_l1_reference_cache: dict[str, list[Cell]] = {}
_runtime_identity_registry: dict[str, Any] | None = None
_registry_load_error: str | None = None  # Set if registry file was missing or malformed


def _reset_template_registry_cache() -> None:
    """Reset all template registry and reference caches. For use in tests only."""
    global _template_registry, _l0_reference_cache, _l0_reference_status, _l1_reference_cache, _registry_load_error, _runtime_identity_registry
    _template_registry = None
    _l0_reference_cache = {}
    _l0_reference_status = {}
    _l1_reference_cache = {}
    _runtime_identity_registry = None
    _registry_load_error = None


def _resolve_preview_xp_fields(spec: dict[str, Any]) -> tuple[str, str]:
    """Resolve preview XP and hash as a coupled pair from the spec.

    Fail-closed: returns empty strings when preview_xp is absent.
    The caller (_normalize_template_action_spec) raises ValueError
    for missing required fields instead of silently falling back to l0_ref.
    """
    preview_xp = str(spec.get("preview_xp") or "").strip()
    preview_xp_sha256 = str(spec.get("preview_xp_sha256") or "").strip()
    return preview_xp, preview_xp_sha256


def _normalize_template_action_spec(
    template_set_key: str,
    action_key: str,
    raw_spec: dict[str, Any] | None,
) -> dict[str, Any]:
    spec = dict(raw_spec or {})
    filename_prefix = str(spec.get("filename_prefix") or spec.get("family") or "").strip()
    skin_family = str(spec.get("skin_family") or "").strip()
    preview_xp, preview_xp_sha256 = _resolve_preview_xp_fields(spec)
    l0_ref = str(spec.get("l0_ref") or "").strip()
    l0_ref_sha256 = str(spec.get("l0_ref_sha256") or "").strip()

    missing: list[str] = []
    if not filename_prefix:
        missing.append("filename_prefix")
    if not skin_family:
        missing.append("skin_family")
    if not preview_xp:
        missing.append("preview_xp")
    if not preview_xp_sha256:
        missing.append("preview_xp_sha256")
    if not l0_ref:
        missing.append("l0_ref")
    if not l0_ref_sha256:
        missing.append("l0_ref_sha256")
    if missing:
        raise ValueError(
            "template_registry.json action "
            f"{template_set_key}:{action_key} missing required normalized fields: {', '.join(missing)}"
        )

    spec["filename_prefix"] = filename_prefix
    spec["skin_family"] = skin_family
    spec["preview_xp"] = preview_xp
    spec["preview_xp_sha256"] = preview_xp_sha256
    spec["l0_ref"] = l0_ref
    spec["l0_ref_sha256"] = l0_ref_sha256
    # DEFERRED: compat alias for pre-normalization callers. Step 11 (PLANNED) will
    # delete remaining `family` readers once the stale authority path is removed.
    spec["family"] = filename_prefix
    return spec


def _normalize_template_registry(raw_registry: dict[str, Any] | None) -> dict[str, Any]:
    registry = dict(raw_registry or {})
    skin_family_scope = registry.get("skin_family_scope", {})
    if not isinstance(skin_family_scope, dict):
        raise ValueError("template_registry.json skin_family_scope must be an object")
    prefix_catalog = registry.get("prefix_catalog", {})
    if not isinstance(prefix_catalog, dict):
        raise ValueError("template_registry.json prefix_catalog must be an object")
    template_sets = registry.get("template_sets", {})
    if not isinstance(template_sets, dict):
        raise ValueError("template_registry.json template_sets must be an object")

    normalized_sets: dict[str, Any] = {}
    for template_set_key, template_set in template_sets.items():
        ts = dict(template_set or {})
        actions = ts.get("actions", {})
        if not isinstance(actions, dict):
            raise ValueError(f"template_registry.json template set '{template_set_key}' actions must be an object")
        normalized_actions = {
            action_key: _normalize_template_action_spec(template_set_key, action_key, action_spec)
            for action_key, action_spec in actions.items()
        }
        ts["actions"] = normalized_actions
        normalized_sets[str(template_set_key)] = ts
    registry["template_sets"] = normalized_sets
    for prefix_key, prefix_spec in prefix_catalog.items():
        ps = dict(prefix_spec or {})
        template_actions = ps.get("template_actions", [])
        if not isinstance(template_actions, list):
            raise ValueError(f"template_registry.json prefix_catalog '{prefix_key}' template_actions must be an array")
        for template_action in template_actions:
            if not isinstance(template_action, dict):
                raise ValueError(f"template_registry.json prefix_catalog '{prefix_key}' template_actions entries must be objects")
            template_set_key = str(template_action.get("template_set_key") or "").strip()
            action_key = str(template_action.get("action_key") or "").strip()
            if not template_set_key or not action_key:
                raise ValueError(
                    f"template_registry.json prefix_catalog '{prefix_key}' template_actions entries must include template_set_key and action_key"
                )
            template_set = normalized_sets.get(template_set_key)
            if not isinstance(template_set, dict):
                raise ValueError(
                    f"template_registry.json prefix_catalog '{prefix_key}' references unknown template set '{template_set_key}'"
                )
            actions = template_set.get("actions", {})
            action_spec = actions.get(action_key) if isinstance(actions, dict) else None
            if not isinstance(action_spec, dict):
                raise ValueError(
                    f"template_registry.json prefix_catalog '{prefix_key}' references unknown action '{template_set_key}:{action_key}'"
                )
            for field in ("filename_prefix", "skin_family", "preview_xp", "preview_xp_sha256", "l0_ref", "l0_ref_sha256"):
                prefix_value = str(ps.get(field) or "").strip()
                action_value = str(action_spec.get(field) or "").strip()
                if prefix_value != action_value:
                    raise ValueError(
                        "template_registry.json prefix_catalog "
                        f"'{prefix_key}' field '{field}' drifted from {template_set_key}:{action_key}"
                    )
            # ahsw_range drift-check: prefix_catalog is the authority.
            # Only check when both prefix and action declare the field.
            prefix_ahsw = str(ps.get("ahsw_range") or "").strip()
            action_ahsw = str(action_spec.get("ahsw_range") or "").strip()
            if prefix_ahsw and action_ahsw and prefix_ahsw != action_ahsw:
                raise ValueError(
                    "template_registry.json prefix_catalog "
                    f"'{prefix_key}' field 'ahsw_range' drifted from {template_set_key}:{action_key}"
                    f" (prefix={prefix_ahsw!r}, action={action_ahsw!r})"
                )

    schema_version = registry.get("schema_version")
    if schema_version is None:
        registry["schema_version"] = 2
    elif schema_version != 2:
        raise ValueError(
            f"template_registry.json schema_version {schema_version!r} is not supported; expected 2"
        )
    return registry


# Mounted vocabulary constants — inherited from Y9-2 pipeline toolchain.
# Wrapper roles identify which plane a mounted wrapper surface belongs to.
MOUNTED_WRAPPER_ROLES: frozenset[str] = frozenset({"mount_front", "mount_rear"})
# Semantic owners classify which entity owns a cell in mounted composite art.
MOUNTED_SEMANTIC_OWNERS: frozenset[str] = frozenset({"rider", "mount", "empty", "mixed", "unclear"})


def is_action_authorized(
    action_spec: dict[str, Any] | None,
    registry: dict[str, Any],
    *,
    template_set: dict[str, Any] | None = None,
    template_set_key: str | None = None,
    action_key: str | None = None,
) -> tuple[bool, str]:
    """Check whether an action spec is authorized for authoring via the normalized registry.

    Mirrors the authority chain of isTemplateActionAuthorable() in
    workbench-template-gating.js, including template-set scope and
    template_actions linkage when template context is supplied.

    Returns (authorized, reason) — reason is empty on success, descriptive on denial.
    """
    if action_spec is None:
        return False, "action spec is None"
    prefix = str(action_spec.get("filename_prefix") or action_spec.get("family") or "").strip()
    skin_family = str(action_spec.get("skin_family") or "").strip()
    if not prefix:
        return False, "missing filename_prefix"
    if not skin_family:
        return False, f"prefix '{prefix}' missing skin_family"
    template_scope = template_set.get("skin_family_scope") if isinstance(template_set, dict) else None
    if isinstance(template_scope, list):
        allowed = {
            str(value or "").strip()
            for value in template_scope
            if str(value or "").strip()
        }
        if not allowed or skin_family not in allowed:
            return False, f"skin_family '{skin_family}' not allowed by template set scope"
    authorized, reason = _is_prefix_authorized_core(
        prefix,
        skin_family,
        registry,
    )
    if not authorized:
        return authorized, reason
    prefix_spec = registry.get("prefix_catalog", {}).get(prefix, {})
    template_actions = prefix_spec.get("template_actions")
    if isinstance(template_actions, list) and template_actions:
        resolved_set_key = str(template_set_key or "").strip()
        resolved_action_key = str(action_key or "").strip()
        if not resolved_set_key or not resolved_action_key:
            return False, f"prefix '{prefix}' missing template action context"
        linked = any(
            str(entry.get("template_set_key") or "").strip() == resolved_set_key
            and str(entry.get("action_key") or "").strip() == resolved_action_key
            for entry in template_actions
            if isinstance(entry, dict)
        )
        if not linked:
            return False, (
                f"prefix '{prefix}' not linked to template action "
                f"'{resolved_set_key}:{resolved_action_key}'"
            )
    return True, ""


def is_prefix_authorized(
    prefix: str,
    registry: dict[str, Any],
) -> tuple[bool, str]:
    """Check whether a bare filename_prefix is authorized for authoring.

    Used by call sites (e.g. _blank_session_spec) that have a user-supplied
    family string but no action spec. Looks up skin_family from prefix_catalog.
    """
    prefix = str(prefix or "").strip()
    if not prefix:
        return False, "empty prefix"
    prefix_spec = registry.get("prefix_catalog", {}).get(prefix)
    if not prefix_spec:
        return False, f"prefix '{prefix}' not in prefix_catalog"
    skin_family = str(prefix_spec.get("skin_family") or "").strip()
    if not skin_family:
        return False, f"prefix '{prefix}' has no skin_family in prefix_catalog"
    return _is_prefix_authorized_core(prefix, skin_family, registry)


def _is_prefix_authorized_core(
    prefix: str,
    skin_family: str,
    registry: dict[str, Any],
) -> tuple[bool, str]:
    """Shared authorization logic for both action-spec and bare-prefix entry points."""
    scope = registry.get("skin_family_scope", {}).get(skin_family)
    if not scope:
        return False, f"skin_family '{skin_family}' not in skin_family_scope"
    if scope.get("proof_only") is True:
        return False, f"skin_family '{skin_family}' is proof_only"
    if scope.get("authorable") is False:
        return False, f"skin_family '{skin_family}' is not authorable"
    prefix_spec = registry.get("prefix_catalog", {}).get(prefix)
    if not prefix_spec:
        return False, f"prefix '{prefix}' not in prefix_catalog"
    if str(prefix_spec.get("filename_prefix") or "").strip() != prefix:
        return False, f"prefix_catalog '{prefix}' filename_prefix mismatch"
    if str(prefix_spec.get("skin_family") or "").strip() != skin_family:
        return False, f"prefix_catalog '{prefix}' skin_family mismatch (expected '{skin_family}')"
    if prefix_spec.get("authorable") is False:
        return False, f"prefix '{prefix}' is not authorable"
    return True, ""


def load_template_registry() -> dict[str, Any]:
    global _template_registry, _registry_load_error
    if _template_registry is not None:
        return _template_registry
    reg_path = CONFIG_DIR / "template_registry.json"
    if not reg_path.exists():
        _log.error("template_registry.json not found at %s", reg_path)
        _registry_load_error = f"template_registry.json not found at {reg_path}"
        # fail-closed: return empty dict without caching so the error
        # re-surfaces on each call and stays operator-visible via get_registry_status().
        return {"template_sets": {}, "schema_version": 2}
    try:
        _template_registry = _normalize_template_registry(json.loads(reg_path.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, ValueError) as exc:
        _log.error("template_registry.json is malformed: %s", exc)
        _registry_load_error = f"template_registry.json is malformed: {exc}"
        # Same fail-closed approach — don't cache empty truth.
        return {"template_sets": {}, "schema_version": 2}
    _registry_load_error = None
    # Validate L0 reference checksums at load time
    for ts_key, ts in _template_registry.get("template_sets", {}).items():
        for act_key, act in ts.get("actions", {}).items():
            family = act.get("filename_prefix", "")
            if family not in _l0_reference_status:
                _load_reference_l0(family)
    return _template_registry


def get_registry_status() -> dict[str, Any]:
    """Return a summary of registry load-time validation results.

    Includes: load_error (if file was missing/malformed), and per-prefix
    L0 reference validation status for any prefix with a non-ok status.
    """
    errors: dict[str, str] = {}
    for prefix, status in _l0_reference_status.items():
        if status != "ok":
            errors[prefix] = status
    result: dict[str, Any] = {}
    if _registry_load_error:
        result["load_error"] = _registry_load_error
    if errors:
        result["l0_errors"] = errors
    return result


def load_runtime_identity_registry() -> dict[str, Any]:
    """Load the single pipeline-v3 owner for Y9-2 runtime V2 identity IDs."""
    global _runtime_identity_registry
    if _runtime_identity_registry is not None:
        return _runtime_identity_registry
    p = CONFIG_DIR / "runtime_identity_registry.json"
    if not p.exists():
        raise ValueError("runtime_identity_registry.json not found")
    registry = json.loads(p.read_text(encoding="utf-8"))
    if registry.get("schema_version") != 1:
        raise ValueError("runtime_identity_registry.json schema_version must be 1")
    for top_key in ("skin_definitions", "presentation_kinds", "layer_definitions"):
        if not isinstance(registry.get(top_key), dict):
            raise ValueError(f"runtime_identity_registry.json missing object: {top_key}")
    _runtime_identity_registry = registry
    return registry


def runtime_identity_for_action(
    template_set_key: str,
    action_key: str,
    action_spec: dict[str, Any],
) -> dict[str, int | str]:
    """Resolve stable V2 IDs for a template action.

    This is the UQ-007 owner used by backend bundle creation/export/payload
    surfaces. Callers must not derive these IDs from family strings.
    """
    registry = load_runtime_identity_registry()
    skin_family = str(action_spec.get("skin_family") or "").strip()
    skin_spec = registry["skin_definitions"].get(skin_family)
    if not isinstance(skin_spec, dict):
        raise ValueError(f"runtime identity missing skin_definition for skin_family={skin_family!r}")
    presentation_spec = registry["presentation_kinds"].get(action_key)
    if not isinstance(presentation_spec, dict):
        raise ValueError(f"runtime identity missing presentation kind for action={action_key!r}")
    layer_key = f"{template_set_key}:{action_key}"
    layer_spec = registry["layer_definitions"].get(layer_key)
    if not isinstance(layer_spec, dict):
        raise ValueError(f"runtime identity missing layer definition for {layer_key!r}")

    skin_definition_id = int(skin_spec["skin_definition_id"])
    presentation_kind_id = int(presentation_spec["presentation_kind_id"])
    layer_definition_id = int(layer_spec["layer_definition_id"])
    rig_definition_id: str | None = layer_spec.get("rig_definition_id") or None
    return {
        "schema_version": 1,
        "template_set_key": template_set_key,
        "action_key": action_key,
        "skin_family": skin_family,
        "filename_prefix": str(action_spec.get("filename_prefix") or action_spec.get("family") or "").strip(),
        "skin_definition_id": skin_definition_id,
        "presentation_kind_id": presentation_kind_id,
        "layer_definition_id": layer_definition_id,
        "rig_definition_id": rig_definition_id,
    }


# ── UQ-006 blueprint bridge: bundle_blueprint_key → target descriptors ──

# Action-key → presentation-kind normalization (plan §2.3.2)
_ACTION_KEY_TO_PRESENTATION_KIND: dict[str, str] = {
    "idle": "idle_walk",
    "mounted_idle": "idle_walk",
    "attack": "attack",
    "mounted_attack": "attack",
    "death": "plydie",
}


def _normalize_frames_count(frames_raw: Any) -> int:
    """Convert frames from template_registry format to a single count.

    Registry format: [min, max] or [count] or int.
    Returns the frame count (max when range, single value when scalar).
    """
    if isinstance(frames_raw, list):
        if len(frames_raw) == 0:
            return 0
        if len(frames_raw) == 1:
            return int(frames_raw[0])
        return int(frames_raw[1])  # [min, max]
    if isinstance(frames_raw, (int, float)):
        return int(frames_raw)
    return 0


def _action_key_to_layer_owner_kind(action_key: str) -> str:
    """Derive layer_owner_kind from action key."""
    if action_key.startswith("mounted_"):
        return "mount"
    return "skin"


def _action_key_to_slot(action_key: str) -> str:
    """Derive slot from action key.

    Mount actions are composite (rear+front) in the current model;
    later Section-2 rows will split into mount_rear / mount_front.
    """
    if action_key.startswith("mounted_"):
        return "mount_composite"
    return "body"


def _blueprint_entity_key(bundle_blueprint_key: str) -> str:
    """Derive entity key from blueprint key."""
    if "mounted" in bundle_blueprint_key:
        return "mounted_actor"
    return "player_actor"


def _blueprint_character_key(skin_family: str) -> str:
    """Derive character key from skin family."""
    return f"{skin_family}_player"


def resolve_blueprint_targets(bundle_blueprint_key: str) -> list[dict[str, Any]]:
    """Resolve a bundle_blueprint_key into presentation target descriptors.

    The bundle_blueprint_key is a template_set_key in the current registry.
    Each action in the template set becomes a target descriptor with the full
    appearance hierarchy fields needed for source manifest region assignment.

    Returns a list of target descriptors, each with:
      entity_key, character_key, presentation_kind, layer_owner_kind,
      slot, presentation_target_key, angles, frames, source_projs,
      projs, cell_w, cell_h, xp_dims, plus runtime identity IDs
      (skin_definition_id, presentation_kind_id, layer_definition_id).

    Raises ValueError if the blueprint key is unknown or geometry is missing.
    """
    reg = load_template_registry()
    ts = reg.get("template_sets", {}).get(bundle_blueprint_key)
    if not isinstance(ts, dict):
        raise ValueError(
            f"Unknown bundle_blueprint_key: {bundle_blueprint_key!r}. "
            f"Known keys: {sorted(reg.get('template_sets', {}).keys())}"
        )

    skin_family_scope = ts.get("skin_family_scope", [])
    primary_family = skin_family_scope[0] if skin_family_scope else "human"

    entity_key = _blueprint_entity_key(bundle_blueprint_key)
    character_key = _blueprint_character_key(primary_family)

    targets: list[dict[str, Any]] = []
    for action_key, action_spec in ts.get("actions", {}).items():
        if not isinstance(action_spec, dict):
            continue

        presentation_kind = _ACTION_KEY_TO_PRESENTATION_KIND.get(action_key)
        if presentation_kind is None:
            raise ValueError(
                f"Unknown action_key {action_key!r} in blueprint "
                f"{bundle_blueprint_key!r} — no presentation_kind mapping"
            )

        layer_owner_kind = _action_key_to_layer_owner_kind(action_key)
        slot = _action_key_to_slot(action_key)
        filename_prefix = str(action_spec.get("filename_prefix", ""))
        presentation_target_key = f"{filename_prefix}_{action_key}_{slot}"

        # Resolve runtime identity for the stable V2 IDs
        try:
            identity = runtime_identity_for_action(bundle_blueprint_key, action_key, action_spec)
        except ValueError:
            identity = None

        angles_val = action_spec.get("angles", 8)
        frames_val = _normalize_frames_count(action_spec.get("frames", 1))
        source_projs_val = action_spec.get("source_projs", 1)
        projs_val = action_spec.get("projs", 2)
        cell_w_val = action_spec.get("cell_w", 0)
        cell_h_val = action_spec.get("cell_h", 0)
        xp_dims_val = action_spec.get("xp_dims", [0, 0])

        # Geometry gate: materialize_manifest() needs these
        if not cell_w_val or not cell_h_val:
            raise ValueError(
                f"Blueprint {bundle_blueprint_key!r} action {action_key!r} "
                f"is missing cell_w/cell_h geometry — cannot materialize"
            )

        desc: dict[str, Any] = {
            "entity_key": entity_key,
            "character_key": character_key,
            "presentation_kind": presentation_kind,
            "layer_owner_kind": layer_owner_kind,
            "slot": slot,
            "presentation_target_key": presentation_target_key,
            "template_set_key": bundle_blueprint_key,
            "action_key": action_key,
            "angles": int(angles_val),
            "frames": int(frames_val),
            "source_projs": int(source_projs_val),
            "projs": int(projs_val),
            "cell_w": int(cell_w_val),
            "cell_h": int(cell_h_val),
            "xp_dims": [int(xp_dims_val[0]), int(xp_dims_val[1])] if isinstance(xp_dims_val, list) and len(xp_dims_val) >= 2 else [0, 0],
        }

        if identity:
            desc["skin_definition_id"] = int(identity["skin_definition_id"])
            desc["presentation_kind_id"] = int(identity["presentation_kind_id"])
            desc["layer_definition_id"] = int(identity["layer_definition_id"])
            desc["rig_definition_id"] = identity.get("rig_definition_id")

        # Blocker text for future rows (plan §2.3.2 appearance ownership model)
        if layer_owner_kind == "mount" and slot == "mount_composite":
            desc["_blocker"] = (
                "Mount composite slot (mount_rear + mount_front combined) must be "
                "split into explicit mount_rear/mount_front slots by a later "
                "Section-2 row (UQ-010). UQ-006 only validates that mount targets "
                "do not flatten into character body owners."
            )

        targets.append(desc)

    if not targets:
        raise ValueError(
            f"Blueprint {bundle_blueprint_key!r} has no actions — "
            f"cannot produce target descriptors"
        )

    return targets


def resolve_blueprint_angles_frames_projs(bundle_blueprint_key: str, action_key: str) -> dict[str, Any]:
    """Resolve geometry (angles, frames, source_projs, projs, cell_w, cell_h)
    for a specific blueprint action.

    This is the fast path used by materialize_manifest() when it already knows
    the action_key from a region target.
    """
    reg = load_template_registry()
    ts = reg.get("template_sets", {}).get(bundle_blueprint_key)
    if not isinstance(ts, dict):
        raise ValueError(f"Unknown bundle_blueprint_key: {bundle_blueprint_key!r}")
    action_spec = ts.get("actions", {}).get(action_key)
    if not isinstance(action_spec, dict):
        raise ValueError(
            f"Unknown action_key {action_key!r} in blueprint {bundle_blueprint_key!r}"
        )
    frames_val = _normalize_frames_count(action_spec.get("frames", 1))
    return {
        "angles": int(action_spec.get("angles", 8)),
        "frames": int(frames_val),
        "source_projs": int(action_spec.get("source_projs", 1)),
        "projs": int(action_spec.get("projs", 2)),
        "cell_w": int(action_spec.get("cell_w", 0)),
        "cell_h": int(action_spec.get("cell_h", 0)),
        "xp_dims": [int(action_spec["xp_dims"][0]), int(action_spec["xp_dims"][1])]
        if isinstance(action_spec.get("xp_dims"), list) and len(action_spec["xp_dims"]) >= 2
        else [0, 0],
    }


def _load_reference_l0(family: str) -> list[Cell] | None:
    if family in _l0_reference_cache:
        return _l0_reference_cache[family]
    # Find the L0 ref path from registry (load_template_registry is safe to call —
    # it assigns _template_registry before iterating actions, preventing recursion)
    reg = load_template_registry()
    l0_ref_path: str | None = None
    l0_ref_sha256: str | None = None
    if reg:
        for ts in reg.get("template_sets", {}).values():
            for act in ts.get("actions", {}).values():
                if act.get("filename_prefix") == family:
                    l0_ref_path = act.get("l0_ref")
                    l0_ref_sha256 = act.get("l0_ref_sha256")
                    break
            if l0_ref_path:
                break
    if not l0_ref_path:
        _l0_reference_status[family] = "no_ref_path"
        return None
    full_path = ROOT / l0_ref_path
    if not full_path.exists():
        _l0_reference_status[family] = "file_missing"
        return None
    actual_sha = _sha256(full_path)
    if l0_ref_sha256 and actual_sha != l0_ref_sha256:
        import logging
        logging.warning(
            "L0 reference checksum mismatch for family '%s': expected %s, got %s",
            family, l0_ref_sha256, actual_sha,
        )
        _l0_reference_status[family] = "checksum_mismatch"
        return None
    parsed = read_xp(full_path)
    l0_cells = parsed["cells"][0]
    _l0_reference_cache[family] = l0_cells
    _l0_reference_status[family] = "ok"
    return l0_cells


def _assert_l0_reference_available(family: str, req_id: str) -> list[Cell]:
    cells = _load_reference_l0(family)
    if cells is None:
        status = _l0_reference_status.get(family, "unknown")
        if status == "checksum_mismatch":
            raise ApiError(
                f"L0 reference checksum mismatch for family '{family}'. "
                "Update l0_ref_sha256 in template_registry.json.",
                "invalid_template_reference",
                "workbench",
                req_id,
                422,
            )
        raise ApiError(
            f"L0 reference not available for family '{family}': {status}",
            "template_reference_unavailable",
            "workbench",
            req_id,
            422,
        )
    return cells


def _load_reference_l1(family: str) -> list[Cell] | None:
    """Load L1 cells from the same reference XP used for L0.

    Families with non-standard cell_h (e.g. plydie with 11-row frames) have
    a family-specific L1 height encoding that differs from the generic
    _build_native_l1_layer() 10-row countdown.  Loading L1 from the reference
    ensures the blank session matches the true native contract.
    """
    if family in _l1_reference_cache:
        return _l1_reference_cache[family]
    # Re-use the same reference XP that L0 comes from.
    # The file was already validated (checksum, existence) during L0 load.
    reg = load_template_registry()
    l0_ref_path: str | None = None
    if reg:
        for ts in reg.get("template_sets", {}).values():
            for act in ts.get("actions", {}).values():
                if act.get("filename_prefix") == family:
                    l0_ref_path = act.get("l0_ref")
                    break
            if l0_ref_path:
                break
    if not l0_ref_path:
        return None
    full_path = ROOT / l0_ref_path
    if not full_path.exists():
        return None
    parsed = read_xp(full_path)
    if parsed["layers"] < 2:
        return None
    l1_cells = parsed["cells"][1]
    _l1_reference_cache[family] = l1_cells
    return l1_cells


def _bundle_path(bundle_id: str) -> Path:
    return BUNDLES_DIR / f"{bundle_id}.json"


def _session_updated_at(path: Path) -> tuple[str, float]:
    try:
        ts = float(path.stat().st_mtime)
    except OSError:
        ts = 0.0
    iso = datetime.fromtimestamp(ts, UTC).isoformat().replace("+00:00", "Z")
    return iso, ts


def _session_label(sess_dict: dict[str, Any]) -> str:
    explicit = str(sess_dict.get("name") or "").strip()
    if explicit:
        return explicit
    action_key = str(sess_dict.get("action_key") or "").strip()
    template_set_key = str(sess_dict.get("template_set_key") or "").strip()
    family = str(sess_dict.get("family") or "").strip()
    if action_key and template_set_key:
        return f"{template_set_key}:{action_key}"
    if action_key:
        return action_key
    if family == "uploaded":
        return "Imported XP"
    if family:
        return family
    session_id = str(sess_dict.get("session_id") or "").strip()
    return f"session-{session_id[:8] or 'unknown'}"


def _bundle_session_owners() -> dict[str, dict[str, str]]:
    owners: dict[str, dict[str, str]] = {}
    if not BUNDLES_DIR.exists():
        return owners
    for bp in BUNDLES_DIR.glob("*.json"):
        try:
            data = load_json(bp)
        except Exception:
            continue
        bundle_id = str(data.get("bundle_id") or bp.stem).strip()
        actions = data.get("actions", {})
        if not isinstance(actions, dict):
            continue
        for action_key, act in actions.items():
            if not isinstance(act, dict):
                continue
            session_id = str(act.get("session_id") or "").strip()
            if not session_id:
                continue
            owners[session_id] = {
                "bundle_id": bundle_id,
                "action_key": str(action_key or ""),
                "status": str(act.get("status") or ""),
            }
    return owners


def _browse_session_summary(
    sess_dict: dict[str, Any],
    path: Path,
    bundle_owner: dict[str, str] | None = None,
) -> dict[str, Any]:
    updated_at, updated_at_epoch = _session_updated_at(path)
    session_id = str(sess_dict.get("session_id") or "").strip()
    summary = {
        "session_id": session_id,
        "label": _session_label(sess_dict),
        "name": str(sess_dict.get("name") or "").strip(),
        "family": str(sess_dict.get("family") or "").strip(),
        "template_set_key": str(sess_dict.get("template_set_key") or "").strip(),
        "action_key": str(sess_dict.get("action_key") or "").strip(),
        "session_kind": _session_kind(sess_dict),
        "metadata_status": _metadata_status(sess_dict),
        "job_id": str(sess_dict.get("job_id") or "").strip(),
        "grid_cols": int(sess_dict.get("grid_cols") or 0),
        "grid_rows": int(sess_dict.get("grid_rows") or 0),
        "angles": int(sess_dict.get("angles") or 1),
        "anims": [int(x) for x in (sess_dict.get("anims") or [1])],
        "projs": int(sess_dict.get("projs") or 1),
        "source_projs": int(sess_dict.get("source_projs") or sess_dict.get("projs") or 1),
        "updated_at": updated_at,
        "updated_at_epoch": updated_at_epoch,
        "bundle_owner": bundle_owner or None,
    }
    return summary


_SESSION_KINDS = {"root_blank", "raw_xp", "pipeline_job", "template_owned"}
_METADATA_STATUSES = {"valid", "missing", "invalid", "generated"}


def _session_kind(sess_dict: dict[str, Any]) -> str:
    explicit = str(sess_dict.get("session_kind") or "").strip()
    if explicit in _SESSION_KINDS:
        return explicit
    template_set_key = str(sess_dict.get("template_set_key") or "").strip()
    family = str(sess_dict.get("family") or "").strip()
    job_id = str(sess_dict.get("job_id") or "").strip()
    if template_set_key:
        return "template_owned"
    if family == "uploaded":
        return "raw_xp"
    if job_id:
        return "pipeline_job"
    return "root_blank"


def _metadata_status(sess_dict: dict[str, Any]) -> str:
    explicit = str(sess_dict.get("metadata_status") or "").strip()
    if explicit in _METADATA_STATUSES:
        return explicit
    if _session_kind(sess_dict) == "raw_xp":
        return "valid"
    return "generated"


def _template_metadata_compatible(sess_dict: dict[str, Any]) -> bool:
    return _metadata_status(sess_dict) in {"valid", "generated"}


def _raw_xp_prefers_visual_layer(sess_dict: dict[str, Any], layer_count: int) -> bool:
    return (
        _session_kind(sess_dict) == "raw_xp"
        and _metadata_status(sess_dict) == "valid"
        and layer_count > 2
    )


def _default_layer_names(sess_dict: dict[str, Any], layer_count: int) -> list[str]:
    if layer_count <= 0:
        return []
    if _session_kind(sess_dict) == "raw_xp":
        return [f"Layer {idx}" for idx in range(layer_count)]
    return ["Metadata", "Layer 1", "Visual", "Layer 3"][:layer_count]


def _default_active_layer(sess_dict: dict[str, Any], layer_count: int) -> int:
    if layer_count <= 0:
        return 0
    if (
        _session_kind(sess_dict) in {"root_blank", "pipeline_job", "template_owned"}
        or _raw_xp_prefers_visual_layer(sess_dict, layer_count)
    ) and layer_count > 2:
        return 2
    return 0


def _default_visible_layers(sess_dict: dict[str, Any], layer_count: int) -> list[int]:
    if layer_count <= 0:
        return []
    if (
        _session_kind(sess_dict) in {"root_blank", "pipeline_job", "template_owned"}
        or _raw_xp_prefers_visual_layer(sess_dict, layer_count)
    ) and layer_count > 2:
        return [2]
    return list(range(layer_count))


def _default_locked_layers(sess_dict: dict[str, Any]) -> list[int]:
    layer_count = len(sess_dict.get("layers") or [])
    if _session_kind(sess_dict) in {"pipeline_job", "template_owned"} or _raw_xp_prefers_visual_layer(
        sess_dict, layer_count
    ):
        return [0]
    return []


def create_bundle(template_set_key: str, req_id: str) -> dict[str, Any]:
    ensure_dirs()
    reg = load_template_registry()
    ts = reg.get("template_sets", {}).get(template_set_key)
    if ts is None:
        raise ApiError(
            f"unknown template_set_key: {template_set_key}",
            "invalid_template_set", "workbench", req_id, 422,
        )
    from datetime import UTC, datetime
    bundle_id = f"b-{uuid.uuid4()}"
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    actions: dict[str, BundleActionState] = {}
    for act_key, act_spec in ts["actions"].items():
        authorized, auth_reason = is_action_authorized(
            act_spec,
            reg,
            template_set=ts,
            template_set_key=template_set_key,
            action_key=act_key,
        )
        if authorized:
            blank = workbench_create_blank_session(template_set_key, act_key, None, req_id)
            actions[act_key] = BundleActionState(
                action_key=act_key,
                session_id=str(blank["session_id"]),
                job_id=str(blank.get("job_id") or ""),
                source_path=None,
                status="blank",
                runtime_identity=runtime_identity_for_action(template_set_key, act_key, act_spec),
            )
        else:
            _log.info("create_bundle: skipping action '%s' — %s", act_key, auth_reason)
            actions[act_key] = BundleActionState(action_key=act_key)
    bundle = BundleSession(
        bundle_id=bundle_id,
        template_set_key=template_set_key,
        actions=actions,
        created_at=now,
        updated_at=now,
    )
    save_json(_bundle_path(bundle_id), bundle.to_dict())
    return bundle.to_dict()


def load_bundle(bundle_id: str, req_id: str) -> BundleSession:
    p = _bundle_path(bundle_id)
    if not p.exists():
        raise ApiError("bundle not found", "bundle_not_found", "workbench", req_id, 404)
    return BundleSession.from_dict(load_json(p))


def save_bundle(bundle: BundleSession) -> None:
    from datetime import UTC, datetime
    bundle.updated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    save_json(_bundle_path(bundle.bundle_id), bundle.to_dict())


def workbench_update_bundle_action_status(
    bundle_id: str,
    action_key: str,
    status_value: str,
    req_id: str,
    session_id: str | None = None,
) -> dict[str, Any]:
    bundle = load_bundle(bundle_id, req_id)
    allowed_statuses = {"empty", "blank", "saved", "converted"}
    next_status = str(status_value or "").strip()
    if next_status not in allowed_statuses:
        raise ApiError(
            f"invalid bundle action status: {next_status}",
            "invalid_bundle_action_status",
            "workbench",
            req_id,
            422,
        )
    action_state = bundle.actions.get(action_key)
    if action_state is None:
        raise ApiError("bundle action not found", "bundle_action_not_found", "workbench", req_id, 404)
    # Rebind the bundle action to a new session if one was supplied. This is the
    # path used after a raw-XP import inside an active bundle action tab — the
    # frontend swapped to a new session and the bundle JSON must catch up before
    # web-skin-bundle-payload reads it.
    if session_id:
        sess_path = _session_path(session_id)
        if not sess_path.exists():
            raise ApiError(
                f"session_id {session_id} not found on disk",
                "session_not_found",
                "workbench",
                req_id,
                404,
            )
        action_state.session_id = session_id
        action_state.job_id = ""
    if next_status in {"saved", "converted"} and not action_state.session_id:
        raise ApiError(
            "bundle action has no session to mark ready",
            "bundle_action_missing_session",
            "workbench",
            req_id,
            422,
        )
    action_state.status = next_status
    save_bundle(bundle)
    return {
        "bundle_id": bundle.bundle_id,
        "action_key": action_key,
        "status": action_state.status,
        "session_id": action_state.session_id,
        "job_id": action_state.job_id,
    }


def _is_bundle_session(session_id: str) -> bool:
    """Check if a session_id belongs to any bundle."""
    if not BUNDLES_DIR.exists():
        return False
    for bp in BUNDLES_DIR.glob("*.json"):
        try:
            data = load_json(bp)
            for act in data.get("actions", {}).values():
                if isinstance(act, dict) and act.get("session_id") == session_id:
                    return True
        except Exception:
            continue
    return False


def workbench_list_sessions(req_id: str) -> dict[str, Any]:
    ensure_dirs()
    owners = _bundle_session_owners()
    sessions: list[dict[str, Any]] = []
    for sp in SESSIONS_DIR.glob("*.json"):
        try:
            sess_dict = load_json(sp)
        except Exception:
            continue
        session_id = str(sess_dict.get("session_id") or "").strip()
        if not session_id:
            continue
        sessions.append(_browse_session_summary(sess_dict, sp, owners.get(session_id)))
    sessions.sort(key=lambda item: (-float(item.get("updated_at_epoch") or 0.0), str(item.get("label") or ""), str(item.get("session_id") or "")))
    catalog = load_json(CONFIG_DIR / "upstream_sprite_catalog.json")
    upstream = [{
        "session_id": "upstream:" + asset["asset_id"],
        "asset_id": asset["asset_id"],
        "label": asset["asset_id"], "name": asset["asset_id"],
        "session_kind": "upstream_xp", "document_source": "upstream",
        "grid_cols": asset["grid_cols"], "grid_rows": asset["grid_rows"],
        "layer_count": asset["layer_count"],
        "source_commit": catalog["commit"], "sha256": asset["sha256"],
    } for asset in catalog["assets"]]
    return {
        "sessions": sessions + upstream,
        "count": len(sessions) + len(upstream),
        "saved_count": len(sessions), "upstream_count": len(upstream),
        "upstream_commit": catalog["commit"],
    }


def _upstream_sprite_bytes(asset_id: str, req_id: str) -> bytes:
    catalog = load_json(CONFIG_DIR / "upstream_sprite_catalog.json")
    asset = next((item for item in catalog["assets"] if item["asset_id"] == asset_id), None)
    if asset is None:
        raise ApiError("unknown upstream sprite", "sprite_not_found", "workbench", req_id, 404)
    root = (SPRITES_DIR / "upstream-y9-2").resolve()
    path = (root / asset_id).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ApiError("upstream sprite is unavailable", "sprite_not_found", "workbench", req_id, 404)
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != asset["sha256"]:
        raise ApiError("upstream sprite checksum mismatch", "sprite_checksum_mismatch", "workbench", req_id, 409)
    return data


def workbench_preview_upstream_sprite(asset_id: str, req_id: str) -> dict[str, Any]:
    """Read-only whole-sheet preview. Does not manufacture an editing session."""
    parsed = read_xp(_upstream_sprite_bytes(asset_id, req_id))
    # Metadata stays out of art previews. Return a single visual layer rather
    # than serializing every layer of all the library's files for thumbnails.
    layer_index = min(2, parsed["layers"] - 1)
    return {
        "grid_cols": parsed["width"], "grid_rows": parsed["height"],
        "layers": [[{"glyph": g, "fg": list(fg), "bg": list(bg)}
                    for g, fg, bg in parsed["cells"][layer_index]]],
    }


def workbench_open_upstream_sprite(asset_id: str, req_id: str) -> dict[str, Any]:
    """Open an editable raw-XP copy. Never write back to the vendored asset."""
    data = _upstream_sprite_bytes(asset_id, req_id)
    ensure_dirs()
    return workbench_upload_xp(data, req_id, source_name=asset_id)


def workbench_rename_session(session_id: str, name: str, req_id: str) -> dict[str, Any]:
    p = _session_path(session_id)
    if not p.exists():
        raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)
    clean_name = str(name or "").strip()
    if not clean_name:
        raise ApiError("name is required", "missing_name", "workbench", req_id, 400)
    if len(clean_name) > 120:
        raise ApiError("name must be <= 120 characters", "invalid_name", "workbench", req_id, 422)
    sess_dict = load_json(p)
    sess_dict["name"] = clean_name
    _save_session_json(p, sess_dict)
    owners = _bundle_session_owners()
    return _browse_session_summary(sess_dict, p, owners.get(session_id))


def workbench_duplicate_session(session_id: str, req_id: str) -> dict[str, Any]:
    p = _session_path(session_id)
    if not p.exists():
        raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)
    sess_dict = load_json(p)
    source_label = _session_label(sess_dict)
    duplicated = dict(sess_dict)
    duplicated["session_id"] = str(uuid.uuid4())
    duplicated["name"] = f"{source_label} copy"
    out_path = _session_path(duplicated["session_id"])
    _save_session_json(out_path, duplicated)
    owners = _bundle_session_owners()
    return _browse_session_summary(duplicated, out_path, owners.get(str(duplicated["session_id"])))


def workbench_delete_session(session_id: str, req_id: str) -> dict[str, Any]:
    p = _session_path(session_id)
    if not p.exists():
        raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)
    owners = _bundle_session_owners()
    if session_id in owners:
        owner = owners[session_id]
        raise ApiError(
            (
                "bundle-owned session cannot be deleted from browse; "
                f"bundle_id={owner['bundle_id']} action_key={owner['action_key']}"
            ),
            "bundle_session_delete_forbidden",
            "workbench",
            req_id,
            422,
        )
    p.unlink()
    return {
        "session_id": session_id,
        "deleted": True,
    }


def _job_path(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.json"


def _session_path(session_id: str) -> Path:
    return SESSIONS_DIR / f"{session_id}.json"


def _save_session_json(path: str | Path, payload: dict[str, Any]) -> None:
    save_json(path, payload, compact=True)


def upload_image(file_storage, req_id: str) -> dict[str, Any]:
    ensure_dirs()
    if file_storage is None or not file_storage.filename:
        raise ApiError("file is required", "missing_file", "upload", req_id, 400)
    ext = Path(file_storage.filename).suffix.lower()
    if ext != ".png":
        raise ApiError("only .png supported in v2 mvp", "invalid_extension", "upload", req_id, 422)

    upload_id = str(uuid.uuid4())
    dest = UPLOAD_DIR / f"{upload_id}.png"
    file_storage.save(dest)

    try:
        with Image.open(dest) as im:
            width, height = im.size
    except Exception as e:
        raise ApiError(f"invalid image: {e}", "invalid_image", "upload", req_id, 422)

    return {
        "upload_id": upload_id,
        "source_path": str(dest.resolve()),
        "width": width,
        "height": height,
        "sha256": _sha256(dest),
    }


def analyze_image(source_path: str, req_id: str) -> dict[str, Any]:
    p = Path(source_path)
    if not p.exists():
        raise ApiError("source_path not found", "source_not_found", "analyze", req_id, 404)

    with Image.open(p) as im:
        w, h = im.size
        rgba = im.convert("RGBA")

    (
        suggested_angles,
        suggested_frames,
        suggested_cell_w,
        suggested_cell_h,
        suggested_source_projs,
        suggested_render_resolution,
        diagnostics,
    ) = _suggest_run_geometry(
        w,
        h,
        source_image=rgba,
    )

    return {
        "image_w": w,
        "image_h": h,
        "suggested_angles": suggested_angles,
        "suggested_frames": suggested_frames,
        "suggested_cell_w": suggested_cell_w,
        "suggested_cell_h": suggested_cell_h,
        "suggested_source_projs": suggested_source_projs,
        "suggested_render_resolution": suggested_render_resolution,
        "confidence": "medium",
        "diagnostics": diagnostics,
    }


def _transparent_cell() -> tuple[int, tuple[int, int, int], tuple[int, int, int]]:
    return (0, (0, 0, 0), MAGENTA_BG)


def _digit_to_glyph(v: int) -> int:
    if 0 <= v <= 9:
        return 48 + v
    if 10 <= v <= 35:
        return 65 + (v - 10)
    return 0


def _glyph_to_digit(glyph: int) -> int:
    """Inverse of _digit_to_glyph: CP437 glyph → integer value, or -1."""
    if 48 <= glyph <= 57:
        return glyph - 48
    if 65 <= glyph <= 90:
        return glyph + 10 - 65
    if 97 <= glyph <= 122:
        return glyph + 10 - 97
    return -1


def _derive_geometry_from_l0(
    xp_data: dict, cols: int, rows: int, req_id: str
) -> dict:
    """Parse geometry from L0 row 0 metadata cells.

    Matches the proven parser at scripts/rex_mcp/xp_core.py:242-292.
    Returns dict with angles, anims, projs, cell_w, cell_h.
    Hard-fails with ApiError if geometry is invalid or inconsistent.
    """
    l0_cells = xp_data["cells"][0]

    # Cell (col=0, row=0) → angles
    glyph_0, _, _ = l0_cells[0]  # row-major: cells[y*w+x] → cells[0*w+0]
    raw_angles = _glyph_to_digit(glyph_0)

    if raw_angles > 0:
        angles = raw_angles
        projs = 2
    else:
        angles = 1
        projs = 1

    # Cells (col=1..N, row=0) → anims list, scan until non-digit or zero
    anims: list[int] = []
    for c in range(1, cols):
        cell = l0_cells[c]  # row-major: cells[0*w + c]
        g, _, _ = cell
        val = _glyph_to_digit(g)
        if val > 0:
            anims.append(val)
        else:
            break

    if not anims:
        raise ApiError(
            "L0 row 0 contains no valid anim counts (cells [1..N] at row 0 are all non-digit or zero)",
            "invalid_l0_metadata", "workbench", req_id, 422,
        )

    # Validate: all anims must be positive (guaranteed by loop, but be explicit)
    if any(a <= 0 for a in anims):
        raise ApiError(
            f"L0 row 0 anim counts must all be positive, got {anims}",
            "invalid_l0_metadata", "workbench", req_id, 422,
        )

    # Derive frame grid
    frame_cols = sum(anims) * projs
    frame_rows = angles

    if frame_cols <= 0 or frame_rows <= 0:
        raise ApiError(
            f"Derived frame grid is invalid: frame_cols={frame_cols}, frame_rows={frame_rows}",
            "invalid_geometry", "workbench", req_id, 422,
        )

    if cols % frame_cols != 0:
        raise ApiError(
            f"Grid width {cols} not divisible by frame_cols {frame_cols} "
            f"(sum(anims)={sum(anims)} * projs={projs})",
            "geometry_dimension_mismatch", "workbench", req_id, 422,
        )

    if rows % frame_rows != 0:
        raise ApiError(
            f"Grid height {rows} not divisible by frame_rows {frame_rows} (angles={angles})",
            "geometry_dimension_mismatch", "workbench", req_id, 422,
        )

    cell_w = cols // frame_cols
    cell_h = rows // frame_rows

    return {
        "angles": angles,
        "anims": anims,
        "projs": projs,
        "cell_w": cell_w,
        "cell_h": cell_h,
        "frame_rows": frame_rows,
        "frame_cols": frame_cols,
    }


def _row0_has_metadata_signal(xp_data: dict, cols: int) -> bool:
    if not xp_data.get("cells"):
        return False
    l0_cells = xp_data["cells"][0]
    limit = min(cols, len(l0_cells))
    for c in range(limit):
        glyph, _fg, _bg = l0_cells[c]
        if _glyph_to_digit(glyph) > 0:
            return True
    return False


def _derive_missing_raw_xp_geometry_from_visual(
    xp_data: dict,
    cols: int,
    rows: int,
) -> dict[str, int | list[int]] | None:
    """Infer a single-row frame grid for raw XP strips without L0 metadata."""
    if cols <= 0 or rows <= 0 or cols < rows * 2:
        return None
    layer_count = int(xp_data.get("layers") or 0)
    if layer_count < 3:
        return None
    cells = xp_data.get("cells") or []
    visual_idx = 2 if layer_count >= 3 else 0
    if visual_idx >= len(cells):
        return None
    visual = cells[visual_idx]
    if len(visual) < cols * rows:
        return None
    populated = sum(1 for glyph, _fg, _bg in visual if int(glyph) not in (0, 32))
    if populated <= 0:
        return None

    candidate_widths = [
        width for width in range(4, max(4, rows * 2) + 1)
        if cols % width == 0 and (cols // width) >= 2
    ]
    if not candidate_widths:
        return None
    cell_w = min(candidate_widths, key=lambda width: (width > rows, abs(width - rows), width))
    frame_cols = cols // cell_w
    return {
        "angles": 1,
        "anims": [frame_cols],
        "projs": 1,
        "cell_w": cell_w,
        "cell_h": rows,
        "frame_rows": 1,
        "frame_cols": frame_cols,
    }


def _derive_raw_xp_geometry(
    xp_data: dict,
    cols: int,
    rows: int,
    req_id: str,
) -> tuple[dict[str, int | list[int]], str]:
    try:
        return _derive_geometry_from_l0(xp_data, cols, rows, req_id), "valid"
    except ApiError:
        status = "invalid" if _row0_has_metadata_signal(xp_data, cols) else "missing"
        if status == "missing":
            inferred = _derive_missing_raw_xp_geometry_from_visual(xp_data, cols, rows)
            if inferred is not None:
                return inferred, status
        return {
            "angles": 1,
            "anims": [1],
            "projs": 1,
            "cell_w": cols,
            "cell_h": rows,
            "frame_rows": 1,
            "frame_cols": 1,
        }, status


Cell = tuple[int, tuple[int, int, int], tuple[int, int, int]]


def _assert_native_contract_dims(cols: int, rows: int, stage: str, req_id: str) -> None:
    """Fail fast if dimensions don't match native 126x80 contract."""
    if cols != NATIVE_COLS or rows != NATIVE_ROWS:
        raise ApiError(
            f"native contract violated: got {cols}x{rows}, expected {NATIVE_COLS}x{NATIVE_ROWS}",
            "native_compat_dims_gate",
            stage,
            req_id,
            422,
        )


# Family dimension contracts from registry (ground truth)
_FAMILY_DIMS: dict[str, tuple[int, int]] = {
    "player": (126, 80),
    "attack": (144, 80),
    "plydie": (110, 88),
    "wolfie": (180, 104),
    "wolack": (160, 104),
}


def _assert_native_dims(cols: int, rows: int, family: str, stage: str, req_id: str) -> None:
    """Fail fast if dimensions don't match family's native contract."""
    expected = _FAMILY_DIMS.get(family)
    if expected is None:
        raise ApiError(f"unknown family for dims check: {family}", "unknown_family", stage, req_id, 422)
    exp_cols, exp_rows = expected
    if cols != exp_cols or rows != exp_rows:
        raise ApiError(
            f"native contract violated for {family}: got {cols}x{rows}, expected {exp_cols}x{exp_rows}",
            "native_compat_dims_gate",
            stage,
            req_id,
            422,
        )


def _build_native_l0_layer(cols: int, rows: int) -> list[Cell]:
    """Build layer 0: exact native player-0100.xp metadata template.

    Full space fill with bg=(255,255,85) yellow, then stamp 7 metadata cells:
      row 0: '8','1','8'
      row 1: '2','4'
      row 2: '1','F'
    """
    META_BG = (255, 255, 85)
    META_FG = (0, 0, 0)
    space_cell: Cell = (32, META_FG, META_BG)
    layer: list[Cell] = [space_cell] * (cols * rows)

    def _set(r: int, c: int, ch: str) -> None:
        layer[r * cols + c] = (ord(ch), META_FG, META_BG)

    _set(0, 0, '8'); _set(0, 1, '1'); _set(0, 2, '8')
    _set(1, 0, '2'); _set(1, 1, '4')
    _set(2, 0, '1'); _set(2, 1, 'F')
    return layer


def _build_native_l1_layer(cols: int, rows: int) -> list[Cell]:
    """Build layer 1: 9→0 countdown repeating every 10 rows.

    Native XP contract: every cell on row r has glyph = digit(9 - (r % 10)),
    bg=(255,255,255), fg=(0,0,0). Fully populated.
    """
    ANIM_BG = (255, 255, 255)
    ANIM_FG = (0, 0, 0)
    layer: list[Cell] = []
    for y in range(rows):
        index_val = NATIVE_CELL_H - 1 - (y % NATIVE_CELL_H)
        glyph = _digit_to_glyph(index_val)
        cell: Cell = (glyph, ANIM_FG, ANIM_BG)
        for _x in range(cols):
            layer.append(cell)
    return layer


def _build_native_player_layers(
    *,
    cells_layer2: list[Cell],
    cols: int,
    rows: int,
    stage: str,
    req_id: str,
) -> list[list[Cell]]:
    """Assemble all 4 layers for a native-contract player skin XP."""
    _assert_native_contract_dims(cols, rows, stage, req_id)
    l0 = _build_native_l0_layer(cols, rows)
    l1 = _build_native_l1_layer(cols, rows)
    l3: list[Cell] = [_transparent_cell() for _ in range(cols * rows)]
    return [l0, l1, cells_layer2, l3]


def _build_native_attack_layers(
    *,
    cells_layer2: list[Cell],
    cols: int,
    rows: int,
    stage: str,
    req_id: str,
) -> list[list[Cell]]:
    """Assemble all 4 layers for a native-contract attack skin XP.

    Uses dynamic L0 from reference attack-0001.xp (dense border art).
    Reuses row-based L1 countdown (ship-gated pattern).
    """
    _assert_native_dims(cols, rows, "attack", stage, req_id)
    l0_ref = _assert_l0_reference_available("attack", req_id)
    l0: list[Cell] = list(l0_ref)  # copy from reference
    l1 = _build_native_l1_layer(cols, rows)
    l3: list[Cell] = [_transparent_cell() for _ in range(cols * rows)]
    return [l0, l1, cells_layer2, l3]


def _build_native_death_layers(
    *,
    cells_layer2: list[Cell],
    cols: int,
    rows: int,
    stage: str,
    req_id: str,
) -> list[list[Cell]]:
    """Assemble all 3 layers for a native-contract plydie/death skin XP.

    Uses dynamic L0 and L1 from reference plydie-0000.xp.  The death family
    has 11-row frames with a non-standard height encoding (A,9,8,...,3,3,3,3)
    that the generic 10-row countdown cannot reproduce.
    """
    _assert_native_dims(cols, rows, "plydie", stage, req_id)
    l0_ref = _assert_l0_reference_available("plydie", req_id)
    l0: list[Cell] = list(l0_ref)
    l1_ref = _load_reference_l1("plydie")
    if l1_ref is not None and len(l1_ref) == cols * rows:
        l1: list[Cell] = list(l1_ref)
    else:
        l1 = _build_native_l1_layer(cols, rows)
    return [l0, l1, cells_layer2]


def _build_native_mounted_layers(
    *,
    family: str,
    cells_layer2: list[Cell],
    cols: int,
    rows: int,
    stage: str,
    req_id: str,
) -> list[list[Cell]]:
    """Assemble mounted native XP layers using the checked-in mounted reference.

    Mounted families have family-specific dimensions and metadata layers. The
    content layer remains the authored layer 2; surrounding layers come from the
    registry-owned native reference or transparent placeholders.
    """
    _assert_native_dims(cols, rows, family, stage, req_id)
    l0_ref = _assert_l0_reference_available(family, req_id)
    l0: list[Cell] = list(l0_ref)
    l1_ref = _load_reference_l1(family)
    l1: list[Cell]
    if l1_ref is not None and len(l1_ref) == cols * rows:
        l1 = list(l1_ref)
    else:
        l1 = _build_native_l1_layer(cols, rows)
    target_layers = 4 if family == "wolfie" else 5
    layers: list[list[Cell]] = [l0, l1, cells_layer2]
    while len(layers) < target_layers:
        layers.append([_transparent_cell() for _ in range(cols * rows)])
    return layers


def _build_native_layers(
    *,
    family: str,
    cells_layer2: list[Cell],
    cols: int,
    rows: int,
    stage: str,
    req_id: str,
) -> list[list[Cell]]:
    """Dispatch to family-specific native layer builder."""
    if family == "player":
        return _build_native_player_layers(
            cells_layer2=cells_layer2, cols=cols, rows=rows,
            stage=stage, req_id=req_id,
        )
    if family == "attack":
        return _build_native_attack_layers(
            cells_layer2=cells_layer2, cols=cols, rows=rows,
            stage=stage, req_id=req_id,
        )
    if family == "plydie":
        return _build_native_death_layers(
            cells_layer2=cells_layer2, cols=cols, rows=rows,
            stage=stage, req_id=req_id,
        )
    if family in {"wolfie", "wolack"}:
        return _build_native_mounted_layers(
            family=family, cells_layer2=cells_layer2, cols=cols, rows=rows,
            stage=stage, req_id=req_id,
        )
    raise ApiError(
        f"no native builder for family '{family}'",
        "unknown_family_builder", stage, req_id, 422,
    )


def _estimate_bg_rgb(im: Image.Image) -> tuple[int, int, int]:
    rgba = im.convert("RGBA")
    w, h = rgba.size
    coords = []
    for x in range(0, w, max(1, w // 16)):
        coords.append((x, 0))
        coords.append((x, h - 1))
    for y in range(0, h, max(1, h // 16)):
        coords.append((0, y))
        coords.append((w - 1, y))
    coords.extend([(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])
    rs, gs, bs = [], [], []
    for x, y in coords:
        r, g, b, a = rgba.getpixel((x, y))
        if a < 16:
            continue
        rs.append(r)
        gs.append(g)
        bs.append(b)
    if not rs:
        return (0, 0, 0)
    return (
        int(statistics.median(rs)),
        int(statistics.median(gs)),
        int(statistics.median(bs)),
    )


def _infer_signal_mode(im: Image.Image) -> str:
    """Choose foreground detection mode.

    - alpha: use alpha channel only (best for transparent sprite sheets)
    - delta: use RGB distance from estimated background (opaque sheets)
    """
    rgba = im.convert("RGBA")
    w, h = rgba.size
    total = max(1, w * h)
    alpha = [a for _r, _g, _b, a in rgba.getdata()]
    transparent_ratio = sum(1 for a in alpha if a < 16) / total
    if transparent_ratio > 0.05:
        return "alpha"
    return "delta"


def _crop_to_foreground(im: Image.Image, bg_rgb: tuple[int, int, int], delta_thr: int = 38, signal_mode: str = "delta") -> Image.Image:
    rgba = im.convert("RGBA")
    w, h = rgba.size
    bg_r, bg_g, bg_b = bg_rgb
    min_x, min_y = w, h
    max_x, max_y = -1, -1
    px = list(rgba.getdata())
    for idx, (r, g, b, a) in enumerate(px):
        if a < 16:
            continue
        if signal_mode == "delta":
            delta = abs(int(r) - bg_r) + abs(int(g) - bg_g) + abs(int(b) - bg_b)
            if delta <= delta_thr:
                continue
        y, x = divmod(idx, w)
        if x < min_x:
            min_x = x
        if y < min_y:
            min_y = y
        if x > max_x:
            max_x = x
        if y > max_y:
            max_y = y
    if max_x < min_x or max_y < min_y:
        return rgba
    return rgba.crop((min_x, min_y, max_x + 1, max_y + 1))


def _foreground_bbox(
    im: Image.Image,
    bg_rgb: tuple[int, int, int],
    delta_thr: int = 38,
    signal_mode: str = "delta",
) -> tuple[int, int, int, int] | None:
    rgba = im.convert("RGBA")
    w, h = rgba.size
    bg_r, bg_g, bg_b = bg_rgb
    min_x, min_y = w, h
    max_x, max_y = -1, -1
    px = list(rgba.getdata())
    for idx, (r, g, b, a) in enumerate(px):
        if a < 16:
            continue
        if signal_mode == "delta":
            delta = abs(int(r) - bg_r) + abs(int(g) - bg_g) + abs(int(b) - bg_b)
            if delta <= delta_thr:
                continue
        y, x = divmod(idx, w)
        if x < min_x:
            min_x = x
        if y < min_y:
            min_y = y
        if x > max_x:
            max_x = x
        if y > max_y:
            max_y = y
    if max_x < min_x or max_y < min_y:
        return None
    return (min_x, min_y, max_x, max_y)


def _region_stats(
    px: list[tuple[int, int, int, int]],
    bg_rgb: tuple[int, int, int],
    signal_mode: str = "delta",
    delta_thr: int = 38,
) -> tuple[float, tuple[int, int, int]] | None:
    bg_r, bg_g, bg_b = bg_rgb
    signal: list[tuple[int, int, int]] = []
    for r, g, b, a in px:
        if a < 16:
            continue
        if signal_mode == "delta":
            delta = abs(int(r) - bg_r) + abs(int(g) - bg_g) + abs(int(b) - bg_b)
            if delta <= delta_thr:
                continue
        signal.append((int(r), int(g), int(b)))

    occupancy = len(signal) / max(1, len(px))
    patch_area = len(px)
    if patch_area >= 100:
        min_occupancy = 0.05
    elif patch_area >= 36:
        min_occupancy = 0.06
    else:
        min_occupancy = 0.08
    if signal_mode == "alpha":
        min_occupancy = max(0.03, min_occupancy - 0.02)

    if patch_area <= 8:
        min_samples = 1
    elif patch_area <= 64:
        min_samples = 2
    else:
        min_samples = 3
    if occupancy < min_occupancy or len(signal) < min_samples:
        return None
    avg = (
        int(sum(v[0] for v in signal) / len(signal)),
        int(sum(v[1] for v in signal) / len(signal)),
        int(sum(v[2] for v in signal) / len(signal)),
    )
    return occupancy, (
        max(28, min(220, avg[0])),
        max(28, min(220, avg[1])),
        max(28, min(220, avg[2])),
    )


def _cell_from_patch(
    patch: Image.Image,
    bg_rgb: tuple[int, int, int],
    signal_mode: str = "delta",
) -> tuple[int, tuple[int, int, int], tuple[int, int, int]]:
    rgba = patch.convert("RGBA")
    w, h = rgba.size
    if w <= 0 or h <= 0:
        return _transparent_cell()

    split = max(1, h // 2)
    top_px = list(rgba.crop((0, 0, w, split)).getdata())
    bot_px = list(rgba.crop((0, split, w, h)).getdata())
    top = _region_stats(top_px, bg_rgb, signal_mode=signal_mode)
    bot = _region_stats(bot_px, bg_rgb, signal_mode=signal_mode)

    if top is None and bot is None:
        return _transparent_cell()
    if top is not None and bot is None:
        # Upper half block: top in fg, bottom transparent via magenta bg.
        return (223, top[1], MAGENTA_BG)
    if top is None and bot is not None:
        # Lower half block: bottom in fg, top transparent via magenta bg.
        return (220, bot[1], MAGENTA_BG)

    # Both halves visible.
    assert top is not None and bot is not None
    t_rgb = top[1]
    b_rgb = bot[1]
    diff = abs(t_rgb[0] - b_rgb[0]) + abs(t_rgb[1] - b_rgb[1]) + abs(t_rgb[2] - b_rgb[2])
    if diff < 20:
        avg = (
            (t_rgb[0] + b_rgb[0]) // 2,
            (t_rgb[1] + b_rgb[1]) // 2,
            (t_rgb[2] + b_rgb[2]) // 2,
        )
        # Similar halves: pick a CP437 shade by combined ink occupancy instead
        # of always stamping full block (219), so sparse fills render as
        # light/medium/dark shade (176/177/178) rather than blobby solids.
        occupancy = (float(top[0]) + float(bot[0])) / 2.0
        if occupancy >= 0.80:
            return (219, avg, (0, 0, 0))
        if occupancy >= 0.55:
            return (178, avg, (0, 0, 0))
        if occupancy >= 0.30:
            return (177, avg, (0, 0, 0))
        return (176, avg, (0, 0, 0))
    # Upper/lower color split inside one char cell.
    return (223, t_rgb, b_rgb)


# ---------------------------------------------------------------------------
# Rich glyph assignment helpers (FL-4095+ CP437 font-mask matcher)
# ---------------------------------------------------------------------------


def _make_rich_config(font_path: Path) -> GlyphAssignmentConfig:
    """Create a FL-4095 baseline GlyphAssignmentConfig for generic sprite conversion."""
    return GlyphAssignmentConfig(
        font_path=font_path,
        font_cell_size=(6, 6),
        target_cell_size=(6, 6),
        candidate_limit=5,
        score_delta_threshold=0.15,
        edge_aware=True,
        edge_magnitude_threshold=80.0,
        edge_use_dog=True,
        edge_grid_shift_search_px=2,
        ssim_for_strokes=True,
        ssim_candidate_filter_by_orientation=True,
        multi_scale_edges=True,
        use_skeleton_polyline=True,
        anti_fill_in_body=True,
        polyline_primary=True,
    )


_RICH_CELL_PX = 6


def _rich_cells_from_tile(
    im: Image.Image,
    font_path: Path,
    out_w: int,
    out_h: int,
) -> list[list[Cell]]:
    """Convert a source tile to a grid of Cells using the rich CP437 matcher.

    Resizes *im* to (out_w * _RICH_CELL_PX) x (out_h * _RICH_CELL_PX) pixels,
    then runs ``assign_image_cells`` which matches each 6x6 block against all
    256 BDF font masks using IoU + edge detection + SSIM.
    """
    sheet = im.convert("RGBA").resize(
        (out_w * _RICH_CELL_PX, out_h * _RICH_CELL_PX),
        Image.Resampling.NEAREST,
    )
    config = _make_rich_config(font_path)
    assigned = assign_image_cells(sheet, config)
    cells: list[list[Cell]] = []
    for y in range(out_h):
        row: list[Cell] = []
        for x in range(out_w):
            ac = assigned[y * out_w + x]
            row.append((ac.chosen.glyph, ac.chosen.fg, ac.chosen.bg))
        cells.append(row)
    return cells


def _tile_to_cells(
    im: Image.Image,
    bg_rgb: tuple[int, int, int],
    out_w: int,
    out_h: int,
    signal_mode: str = "delta",
) -> list[list[tuple[int, tuple[int, int, int], tuple[int, int, int]]]]:
    src = im.convert("RGBA")
    src_w, src_h = src.size
    rows: list[list[tuple[int, tuple[int, int, int], tuple[int, int, int]]]] = []
    for y in range(out_h):
        row = []
        for x in range(out_w):
            x0 = int(x * src_w / out_w)
            x1 = int((x + 1) * src_w / out_w)
            y0 = int(y * src_h / out_h)
            y1 = int((y + 1) * src_h / out_h)
            if x1 <= x0:
                x1 = min(src_w, x0 + 1)
            if y1 <= y0:
                y1 = min(src_h, y0 + 1)
            patch = src.crop((x0, y0, x1, y1))
            row.append(_cell_from_patch(patch, bg_rgb, signal_mode=signal_mode))
        rows.append(row)
    return rows


def run_pipeline(cfg: RunConfig, req_id: str) -> dict[str, Any]:
    ensure_dirs()
    cfg.validate(req_id)
    src = Path(cfg.source_path)
    if not src.exists():
        raise ApiError("source_path not found", "source_not_found", "run", req_id, 404)

    job_id = str(uuid.uuid4())
    semantic_frames = sum(cfg.frames)
    source_frame_cols = semantic_frames * cfg.source_projs

    try:
        with Image.open(src) as im:
            src_w, src_h = im.size
            bg_rgb = _estimate_bg_rgb(im)
            signal_mode = _infer_signal_mode(im)

            explicit_non_native_target = (
                (not cfg.native_compat)
                and cfg.target_cols is not None
                and cfg.target_rows is not None
            )
            # Determine target dims early — needed for both normal path and fallback.
            if cfg.native_compat:
                eff_cols: int = cfg.target_cols if cfg.target_cols is not None else NATIVE_COLS
                eff_rows: int = cfg.target_rows if cfg.target_rows is not None else NATIVE_ROWS
            elif explicit_non_native_target:
                eff_cols = int(cfg.target_cols or 0)
                eff_rows = int(cfg.target_rows or 0)
            else:
                eff_cols = 0
                eff_rows = 0

            # Geometry validation: set use_fallback instead of raising so any
            # valid image always produces output (dumb convert + upper-left placement).
            use_fallback = src_w < source_frame_cols or src_h < cfg.angles
            if explicit_non_native_target and use_fallback:
                raise ApiError(
                    f"explicit target geometry requires at least {source_frame_cols} source columns and {cfg.angles} source rows; got {src_w}x{src_h}",
                    "invalid_target_geometry",
                    "run",
                    req_id,
                    422,
                )

            if not use_fallback:
                frame_px_w = max(1, src_w // source_frame_cols)
                angle_px_h = max(1, src_h // cfg.angles)
                aspect = frame_px_w / max(1, angle_px_h)
                if not cfg.native_compat and not explicit_non_native_target and (aspect < 0.35 or aspect > 1.2):
                    use_fallback = True
                if not use_fallback and cfg.native_compat:
                    cell_h_chars = eff_rows // max(1, cfg.angles)
                    total_tile_cols = semantic_frames * cfg.projs
                    cell_w_chars = eff_cols // max(1, total_tile_cols)
                    if cell_w_chars < 1 or cell_w_chars * total_tile_cols != eff_cols:
                        use_fallback = True
                    elif cfg.angles != NATIVE_ANGLES:
                        use_fallback = True
                elif not use_fallback and explicit_non_native_target:
                    total_tile_cols = semantic_frames * cfg.projs
                    if eff_rows % max(1, cfg.angles) != 0:
                        raise ApiError(
                            f"target_rows {eff_rows} must be divisible by angles {cfg.angles}",
                            "invalid_target_geometry",
                            "run",
                            req_id,
                            422,
                        )
                    if eff_cols % max(1, total_tile_cols) != 0:
                        raise ApiError(
                            f"target_cols {eff_cols} must be divisible by frame columns {total_tile_cols}",
                            "invalid_target_geometry",
                            "run",
                            req_id,
                            422,
                        )
                    cell_h_chars = eff_rows // max(1, cfg.angles)
                    cell_w_chars = eff_cols // max(1, total_tile_cols)
                    if cell_w_chars < 1 or cell_h_chars < 1:
                        raise ApiError(
                            "target geometry resolves to zero-sized cells",
                            "invalid_target_geometry",
                            "run",
                            req_id,
                            422,
                        )
                elif not use_fallback:
                    cell_w_chars = max(1, int(math.ceil(frame_px_w / max(1, cfg.render_resolution))))
                    cell_h_chars = max(1, int(math.ceil(angle_px_h / max(1, cfg.render_resolution))))
                    # Enforce a minimum visual resolution per frame so silhouettes/animation survive.
                    cell_w_chars = max(cell_w_chars, 12)
                    cell_h_chars = max(cell_h_chars, 8)

            if use_fallback:
                # Pure pixel-to-cell fallback: resize source to fit target dims,
                # 1 pixel = 1 cell on layer 2, remainder transparent. No slicing.
                if cfg.native_compat:
                    fb_cols = eff_cols
                    fb_rows = eff_rows
                else:
                    cell_px = max(1, cfg.render_resolution)
                    fb_cols = max(12, int(math.ceil(src_w / cell_px)))
                    fb_rows = max(8, int(math.ceil(src_h / cell_px)))
                # Scale to fit within fb_cols x fb_rows, preserving aspect ratio
                scale = min(fb_cols / max(1, src_w), fb_rows / max(1, src_h))
                scaled_w = max(1, int(src_w * scale))
                scaled_h = max(1, int(src_h * scale))
                scaled_im = im.resize((scaled_w, scaled_h), Image.LANCZOS)
                if cfg.assignment_mode == "rich":
                    font_path = default_font_path(ROOT)
                    raw_cells = _rich_cells_from_tile(scaled_im, font_path, scaled_w, scaled_h)
                else:
                    raw_cells = _tile_to_cells(scaled_im, bg_rgb, scaled_w, scaled_h, signal_mode=signal_mode)
                transparent = _transparent_cell()
                flat: list[Cell] = [transparent] * (fb_cols * fb_rows)
                for ty in range(scaled_h):
                    for tx in range(scaled_w):
                        flat[ty * fb_cols + tx] = raw_cells[ty][tx]
                cells_layer2 = flat
                cols = fb_cols
                rows = fb_rows
                cell_w_chars = 1
                cell_h_chars = 1
            else:
                cols = semantic_frames * cfg.projs * cell_w_chars
                rows = cfg.angles * cell_h_chars
                transparent = _transparent_cell()
                layer_grid = [[transparent for _ in range(cols)] for _ in range(rows)]

                # Use a stable foreground crop box per angle row so every frame in the same
                # animation track is sampled from identical vertical bounds.
                angle_crop_boxes: list[tuple[int, int, int, int]] = []
                min_crop_width_ratio = 0.60
                min_crop_height_ratio = 0.55
                for angle in range(cfg.angles):
                    y0 = angle * angle_px_h
                    y1 = min(src_h, y0 + angle_px_h)
                    found = False
                    min_x = frame_px_w
                    min_y = angle_px_h
                    max_x = -1
                    max_y = -1
                    for source_col in range(source_frame_cols):
                        sx0 = source_col * frame_px_w
                        sx1 = min(src_w, sx0 + frame_px_w)
                        tile = im.crop((sx0, y0, sx1, y1))
                        bbox = _foreground_bbox(tile, bg_rgb, signal_mode=signal_mode)
                        if bbox is None:
                            continue
                        bx0, by0, bx1, by1 = bbox
                        found = True
                        min_x = min(min_x, bx0)
                        min_y = min(min_y, by0)
                        max_x = max(max_x, bx1)
                        max_y = max(max_y, by1)
                    if not found:
                        angle_crop_boxes.append((0, 0, frame_px_w - 1, angle_px_h - 1))
                        continue
                    raw_w = max(1, (max_x - min_x + 1))
                    raw_h = max(1, (max_y - min_y + 1))
                    # Guard against over-tight row crops that collapse source detail.
                    # This keeps a narrow pose in one frame from shrinking every frame in the row.
                    if (
                        raw_w < int(frame_px_w * min_crop_width_ratio)
                        or raw_h < int(angle_px_h * min_crop_height_ratio)
                    ):
                        angle_crop_boxes.append((0, 0, frame_px_w - 1, angle_px_h - 1))
                        continue
                    pad = 1
                    angle_crop_boxes.append(
                        (
                            max(0, min_x - pad),
                            max(0, min_y - pad),
                            min(frame_px_w - 1, max_x + pad),
                            min(angle_px_h - 1, max_y + pad),
                        )
                    )

                for angle in range(cfg.angles):
                    y0 = angle * angle_px_h
                    y1 = min(src_h, y0 + angle_px_h)
                    crop_x0, crop_y0, crop_x1, crop_y1 = angle_crop_boxes[angle]
                    for frame in range(semantic_frames):
                        for proj in range(cfg.projs):
                            if cfg.source_projs == 1:
                                source_col = frame
                            else:
                                # Engine/xp_tool contract uses grouped projections:
                                # [all proj0 frames][all proj1 frames]
                                source_col = frame + (min(proj, cfg.source_projs - 1) * semantic_frames)

                            x0 = source_col * frame_px_w
                            x1 = min(src_w, x0 + frame_px_w)
                            tile = im.crop(
                                (
                                    x0 + crop_x0,
                                    y0 + crop_y0,
                                    x0 + crop_x1 + 1,
                                    y0 + crop_y1 + 1,
                                )
                            )

                            if cfg.source_projs == 1 and cfg.projs == 2 and proj == 1:
                                tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

                            # Render with stable row crop; bottom-align to keep feet anchored.
                            fg_tile = tile
                            inner_w = max(1, cell_w_chars)
                            inner_h = max(1, cell_h_chars)
                            if cfg.assignment_mode == "rich":
                                font_path = default_font_path(ROOT)
                                inner_cells = _rich_cells_from_tile(fg_tile, font_path, inner_w, inner_h)
                            else:
                                inner_cells = _tile_to_cells(
                                    fg_tile,
                                    bg_rgb,
                                    inner_w,
                                    inner_h,
                                    signal_mode=signal_mode,
                                )
                            tile_cells = [[_transparent_cell() for _ in range(cell_w_chars)] for _ in range(cell_h_chars)]
                            off_x = max(0, (cell_w_chars - inner_w) // 2)
                            off_y = max(0, cell_h_chars - inner_h)
                            for ty in range(inner_h):
                                for tx in range(inner_w):
                                    tile_cells[off_y + ty][off_x + tx] = inner_cells[ty][tx]
                            # Output layout must match preview contract:
                            # frame_column = frame_global + proj * total_frames
                            dst_col = frame + (proj * semantic_frames)
                            dst_x0 = dst_col * cell_w_chars
                            dst_y0 = angle * cell_h_chars
                            for ty in range(cell_h_chars):
                                for tx in range(cell_w_chars):
                                    layer_grid[dst_y0 + ty][dst_x0 + tx] = tile_cells[ty][tx]

                cells_layer2 = [layer_grid[y][x] for y in range(rows) for x in range(cols)]
    except Exception as e:
        if isinstance(e, ApiError):
            raise
        raise ApiError(f"pipeline failed reading image: {e}", "pipeline_image_error", "run", req_id, 500)

    if cfg.native_compat:
        layers = _build_native_layers(
            family=cfg.family, cells_layer2=cells_layer2, cols=cols, rows=rows,
            stage="run", req_id=req_id,
        )
    else:
        blank_layer = [_transparent_cell() for _ in range(cols * rows)]
        layer0 = _build_native_l0_layer(cols, rows)
        layer1 = _build_native_l1_layer(cols, rows)
        layers = [layer0, layer1, cells_layer2, blank_layer]

    xp_path = EXPORT_DIR / f"{job_id}.xp"
    write_xp(xp_path, cols, rows, layers)

    preview_path = PREVIEWS_DIR / f"{job_id}.png"
    render_preview_png(cells_layer2, cols, rows, preview_path)

    g7 = gate_g7_geometry(cols * rows, len(cells_layer2))
    g8 = gate_g8_nonempty([g for g, _fg, _bg in cells_layer2])
    g9 = gate_g9_handoff(len(cells_layer2))
    gate_report = {
        "job_id": job_id,
        "results": [asdict(g7), asdict(g8), asdict(g9)],
    }
    gate_path = GATES_DIR / f"{job_id}.json"
    save_json(gate_path, gate_report)

    trace = {
        "job_id": job_id,
        "state": [
            "CREATED",
            "ANALYZED",
            "RUNNING_INGEST",
            "RUNNING_SLICE",
            "RUNNING_PROCESS",
            "RUNNING_ASSEMBLE",
            "RUNNING_VERIFY",
            "SUCCEEDED",
        ],
        "cols": cols,
        "rows": rows,
        "source_sha256": _sha256(src),
        "xp_sha256": _sha256(xp_path),
    }
    trace_path = TRACES_DIR / f"{job_id}.json"
    save_json(trace_path, trace)

    metadata = {
        "angles": cfg.angles,
        "anims": cfg.frames,
        "source_projs": cfg.source_projs,
        "projs": cfg.projs,
        "render_resolution": cfg.render_resolution,
        "cell_w_chars": cell_w_chars,
        "cell_h_chars": cell_h_chars,
        "checksum": _sha256(xp_path),
        "family": cfg.family,
    }

    record = JobRecord(
        job_id=job_id,
        state="SUCCEEDED",
        stage="verify",
        source_path=str(src.resolve()),
        xp_path=str(xp_path.resolve()),
        preview_paths=[str(preview_path.resolve())],
        metadata=metadata,
        gate_report_path=str(gate_path.resolve()),
        trace_path=str(trace_path.resolve()),
    )
    save_json(_job_path(job_id), record.to_dict())

    return {
        "job_id": job_id,
        "state": record.state,
        "xp_path": record.xp_path,
        "preview_paths": record.preview_paths,
        "metadata": record.metadata,
        "gate_report_path": record.gate_report_path,
        "trace_path": record.trace_path,
    }


def status(job_id: str, req_id: str) -> dict[str, Any]:
    p = _job_path(job_id)
    if not p.exists():
        raise ApiError("job not found", "job_not_found", "status", req_id, 404)
    return load_json(p)


def _session_payload(sess_dict: dict[str, Any]) -> dict[str, Any]:
    width = int(sess_dict["grid_cols"])
    height = int(sess_dict["grid_rows"])
    layer_count = len(sess_dict.get("layers") or [])
    angles = int(sess_dict["angles"])
    anims = [int(x) for x in sess_dict["anims"]]
    projs = int(sess_dict["projs"])
    frame_cols = sum(anims) * projs
    frame_rows = angles
    session_kind = _session_kind(sess_dict)
    metadata_status = _metadata_status(sess_dict)
    family, filename_prefix, skin_family = _resolve_session_identity_fields(sess_dict)

    # UQ-006: Derive source arrays from manifest when source_path + manifest exist
    _sp = str(sess_dict.get("source_path") or "").strip()
    source_boxes = list(sess_dict.get("source_boxes") or [])
    source_anchor_box = sess_dict.get("source_anchor_box")
    source_draft_box = sess_dict.get("source_draft_box")
    source_cuts_v = list(sess_dict.get("source_cuts_v") or [])
    source_cuts_h = list(sess_dict.get("source_cuts_h") or [])
    source_manifest_path: str | None = None
    source_manifest_status: str | None = None

    if _sp:
        source_manifest_path = str(manifest_path_for_source(_sp))
        existing = load_manifest(_sp)
        if existing:
            # Manifest is authority — derive mirror state
            mirror = materialize_manifest(existing)
            source_boxes = mirror["source_boxes"]
            source_anchor_box = mirror["source_anchor_box"]
            source_draft_box = mirror["source_draft_box"]
            source_cuts_v = mirror["source_cuts_v"]
            source_cuts_h = mirror["source_cuts_h"]
            val = validate_manifest(existing, _sp)
            source_manifest_status = val["status"]
        else:
            source_manifest_status = "none"

    return {
        "session_id": str(sess_dict["session_id"]),
        "job_id": str(sess_dict.get("job_id") or ""),
        "name": str(sess_dict.get("name") or "").strip(),
        "label": _session_label(sess_dict),
        "template_set_key": str(sess_dict.get("template_set_key") or "").strip(),
        "action_key": str(sess_dict.get("action_key") or "").strip(),
        "session_kind": session_kind,
        "metadata_status": metadata_status,
        "populated_cells": sum(
            1 for c in (sess_dict.get("cells") or [])
            if int(c.get("glyph", 0)) not in (0, 32)
        ),
        "layer_count": layer_count,
        "layer_names": list(sess_dict.get("layer_names") or _default_layer_names(sess_dict, layer_count)),
        "active_layer": int(sess_dict.get("active_layer", _default_active_layer(sess_dict, layer_count))),
        "visible_layers": list(sess_dict.get("visible_layers") or _default_visible_layers(sess_dict, layer_count)),
        "locked_layers": list(sess_dict.get("locked_layers") or _default_locked_layers(sess_dict)),
        "whole_sheet_canvas_zoom": sess_dict.get("whole_sheet_canvas_zoom", 0),
        "whole_sheet_grid_visible": bool(sess_dict.get("whole_sheet_grid_visible", False)),
        "whole_sheet_grid_step": str(sess_dict.get("whole_sheet_grid_step", "frame")),
        "whole_sheet_grid_custom_w": int(sess_dict.get("whole_sheet_grid_custom_w", 1) or 1),
        "whole_sheet_grid_custom_h": int(sess_dict.get("whole_sheet_grid_custom_h", 1) or 1),
        "grid_cols": width,
        "grid_rows": height,
        "cell_w": int(sess_dict["cell_w"]),
        "cell_h": int(sess_dict["cell_h"]),
        "angles": angles,
        "anims": anims,
        "source_projs": int(sess_dict.get("source_projs", projs)),
        "projs": projs,
        "frame_rows": frame_rows,
        "frame_cols": frame_cols,
        "source_boxes": source_boxes,
        "source_anchor_box": source_anchor_box,
        "source_draft_box": source_draft_box,
        "source_cuts_v": source_cuts_v,
        "source_cuts_h": source_cuts_h,
        "source_path": _sp or None,
        "source_manifest_path": source_manifest_path,
        "source_manifest_status": source_manifest_status,
        "cells": list(sess_dict.get("cells") or []),
        "layers": list(sess_dict.get("layers") or []),
        "family": family,
        "filename_prefix": filename_prefix,
        "skin_family": skin_family,
        "runtime_identity": sess_dict.get("runtime_identity"),
        "mounted_rider_calibration": sess_dict.get("mounted_rider_calibration"),
        "mounted_semantic_review": sess_dict.get("mounted_semantic_review"),
    }


def _resolve_session_identity_fields(sess_dict: dict[str, Any]) -> tuple[str, str, str]:
    family = str(sess_dict.get("family") or "").strip()
    filename_prefix = str(sess_dict.get("filename_prefix") or family or "player").strip()
    if not family:
        family = filename_prefix or "player"
    if not filename_prefix:
        filename_prefix = family or "player"
    skin_family = str(sess_dict.get("skin_family") or "").strip()
    if not skin_family and filename_prefix:
        reg = load_template_registry()
        prefix_spec = reg.get("prefix_catalog", {}).get(filename_prefix, {})
        skin_family = str(prefix_spec.get("skin_family") or "").strip()
    return family, filename_prefix, skin_family


def _wire_layers(layers: list[list[Cell]]) -> list[list[dict[str, Any]]]:
    return [
        [
            {"idx": idx, "glyph": int(glyph), "fg": list(fg), "bg": list(bg)}
            for idx, (glyph, fg, bg) in enumerate(layer)
        ]
        for layer in layers
    ]


def _coerce_projection_geometry(
    *,
    angles: int,
    source_projs: int,
    projs: int | None,
    req_id: str,
    stage: str,
) -> tuple[int, int]:
    if source_projs not in (1, 2):
        raise ApiError("source_projs must be 1 or 2", "invalid_source_projs", stage, req_id, 422)
    if angles <= 1 and source_projs != 1:
        raise ApiError(
            "source_projs must be 1 when angles <= 1",
            "invalid_source_projs",
            stage,
            req_id,
            422,
        )
    resolved_projs = (1 if angles <= 1 else (2 if source_projs == 1 else source_projs)) if projs is None else int(projs)
    if resolved_projs not in (1, 2):
        raise ApiError("projs must be 1 or 2", "invalid_projs", stage, req_id, 422)
    if resolved_projs < source_projs:
        raise ApiError("projs must be >= source_projs", "invalid_projs", stage, req_id, 422)
    if source_projs < resolved_projs and not (source_projs == 1 and resolved_projs == 2):
        raise ApiError(
            "unsupported source/export projection expansion",
            "invalid_projs",
            stage,
            req_id,
            422,
        )
    return source_projs, resolved_projs


def _derive_session_grid_geometry(
    *,
    angles: int,
    anims: list[int],
    projs: int,
    cell_w: int,
    cell_h: int,
    req_id: str,
    stage: str,
) -> tuple[int, int]:
    semantic_frames = sum(anims)
    if angles < 1:
        raise ApiError("angles must be >= 1", "invalid_angles", stage, req_id, 422)
    if semantic_frames < 1 or any(int(x) < 1 for x in anims):
        raise ApiError("anims must be non-empty positive integers", "invalid_anims", stage, req_id, 422)
    if cell_w < 1 or cell_h < 1:
        raise ApiError("cell_w/cell_h must be >= 1", "invalid_geometry", stage, req_id, 422)
    return semantic_frames * projs * cell_w, angles * cell_h


def _build_root_metadata_layer(cols: int, rows: int, angles: int, anims: list[int]) -> list[Cell]:
    layer = [_transparent_cell() for _ in range(cols * rows)]
    if cols <= 0 or rows <= 0:
        return layer
    meta_fg = (255, 255, 255)
    meta_bg = (0, 0, 0)
    layer[0] = (_digit_to_glyph(angles), meta_fg, meta_bg)
    for idx, anim in enumerate(anims[: max(0, cols - 1)], start=1):
        layer[idx] = (_digit_to_glyph(int(anim)), meta_fg, meta_bg)
    return layer


def _build_root_blank_layers(cols: int, rows: int, angles: int, anims: list[int]) -> list[list[Cell]]:
    blank = [_transparent_cell() for _ in range(cols * rows)]
    return [
        _build_root_metadata_layer(cols, rows, angles, anims),
        list(blank),
        list(blank),
        list(blank),
    ]


def _blank_session_spec(blank_session: Any, req_id: str) -> dict[str, Any]:
    payload = blank_session if isinstance(blank_session, dict) else {}
    default = DEFAULT_ROOT_BLANK_SESSION
    raw_anims = payload.get("anims", default["anims"])
    if not isinstance(raw_anims, list) or not raw_anims:
        raise ApiError("blank_session.anims must be a non-empty list", "invalid_anims", "workbench", req_id, 422)
    anims = [int(x) for x in raw_anims]
    if any(x < 1 for x in anims):
        raise ApiError("blank_session.anims must be >= 1", "invalid_anims", "workbench", req_id, 422)

    angles = int(payload.get("angles", default["angles"]))
    cell_w = int(payload.get("cell_w", default["cell_w"]))
    cell_h = int(payload.get("cell_h", default["cell_h"]))
    source_projs, projs = _coerce_projection_geometry(
        angles=angles,
        source_projs=int(payload.get("source_projs", default["source_projs"])),
        projs=payload.get("projs", default["projs"]),
        req_id=req_id,
        stage="workbench",
    )
    grid_cols, grid_rows = _derive_session_grid_geometry(
        angles=angles,
        anims=anims,
        projs=projs,
        cell_w=cell_w,
        cell_h=cell_h,
        req_id=req_id,
        stage="workbench",
    )
    supplied_cols = payload.get("grid_cols")
    supplied_rows = payload.get("grid_rows")
    if supplied_cols is not None and int(supplied_cols) != grid_cols:
        raise ApiError(
            f"blank_session.grid_cols mismatch: got {int(supplied_cols)}, expected {grid_cols}",
            "invalid_geometry",
            "workbench",
            req_id,
            422,
        )
    if supplied_rows is not None and int(supplied_rows) != grid_rows:
        raise ApiError(
            f"blank_session.grid_rows mismatch: got {int(supplied_rows)}, expected {grid_rows}",
            "invalid_geometry",
            "workbench",
            req_id,
            422,
        )
    family = str(payload.get("family", default["family"])).strip() or str(default["family"])
    authorized, auth_reason = is_prefix_authorized(family, load_template_registry())
    if not authorized:
        raise ApiError(f"family '{family}' is not authorized: {auth_reason}", "invalid_family", "workbench", req_id, 422)
    return {
        "angles": angles,
        "anims": anims,
        "source_projs": source_projs,
        "projs": projs,
        "cell_w": cell_w,
        "cell_h": cell_h,
        "grid_cols": grid_cols,
        "grid_rows": grid_rows,
        "family": family,
    }


def _resample_frame_matrix(
    src_matrix: list[list[Cell]],
    dst_w: int,
    dst_h: int,
    *,
    flip_h: bool = False,
) -> list[list[Cell]]:
    src_h = len(src_matrix)
    src_w = len(src_matrix[0]) if src_h else 0
    if src_w <= 0 or src_h <= 0 or dst_w <= 0 or dst_h <= 0:
        return [[_transparent_cell() for _ in range(max(1, dst_w))] for _ in range(max(1, dst_h))]
    out = [[_transparent_cell() for _ in range(dst_w)] for _ in range(dst_h)]
    for dy in range(dst_h):
        sy = min(src_h - 1, int((dy * src_h) / dst_h))
        for dx in range(dst_w):
            sx = min(src_w - 1, int((dx * src_w) / dst_w))
            if flip_h:
                sx = src_w - 1 - sx
            out[dy][dx] = src_matrix[sy][sx]
    return out


def _expand_visual_cells_for_export(
    *,
    cells_layer2: list[Cell],
    cols: int,
    rows: int,
    angles: int,
    anims: list[int],
    source_projs: int,
    projs: int,
    req_id: str,
) -> list[Cell]:
    if source_projs >= projs:
        return list(cells_layer2)
    if source_projs != 1 or projs != 2:
        raise ApiError(
            f"unsupported source/export projection expansion: source_projs={source_projs}, projs={projs}",
            "unsupported_projection_expansion", "workbench", req_id, 422,
        )
    semantic_frames = sum(int(x) for x in anims)
    if semantic_frames <= 0 or angles <= 0:
        raise ApiError("invalid semantic export geometry", "invalid_export_geometry", "workbench", req_id, 422)
    src_frame_cols = semantic_frames * source_projs
    dst_frame_cols = semantic_frames * projs
    if cols % src_frame_cols != 0 or rows % angles != 0 or cols % dst_frame_cols != 0:
        raise ApiError(
            f"session geometry incompatible with semantic export expansion: cols={cols}, rows={rows}, "
            f"angles={angles}, semantic_frames={semantic_frames}, source_projs={source_projs}, projs={projs}",
            "export_geometry_incompatible", "workbench", req_id, 422,
        )
    src_frame_w = cols // src_frame_cols
    dst_frame_w = cols // dst_frame_cols
    frame_h = rows // angles
    src_grid = [list(cells_layer2[y * cols:(y + 1) * cols]) for y in range(rows)]
    dst_grid = [[_transparent_cell() for _ in range(cols)] for _ in range(rows)]
    for angle in range(angles):
        sy0 = angle * frame_h
        for frame in range(semantic_frames):
            sx0 = frame * src_frame_w
            src_matrix = [row[sx0:sx0 + src_frame_w] for row in src_grid[sy0:sy0 + frame_h]]
            for proj in range(projs):
                dst_matrix = _resample_frame_matrix(src_matrix, dst_frame_w, frame_h, flip_h=(proj == 1))
                dx0 = (frame + (proj * semantic_frames)) * dst_frame_w
                for y in range(frame_h):
                    dst_grid[sy0 + y][dx0:dx0 + dst_frame_w] = dst_matrix[y]
    return [dst_grid[y][x] for y in range(rows) for x in range(cols)]


def _session_visual_cells(sess: dict[str, Any], req_id: str) -> list[Cell]:
    cols = int(sess["grid_cols"])
    rows = int(sess["grid_rows"])
    expected_cells = cols * rows
    persisted_layers = sess.get("layers")
    if (
        isinstance(persisted_layers, list)
        and len(persisted_layers) >= 3
        and isinstance(persisted_layers[2], list)
        and len(persisted_layers[2]) == expected_cells
    ):
        return [
            (int(c["glyph"]), tuple(c["fg"]), tuple(c["bg"]))
            for c in persisted_layers[2]
        ]
    cells = sess.get("cells") or []
    if len(cells) != expected_cells:
        raise ApiError("session cell geometry mismatch", "session_geometry_invalid", "workbench", req_id, 422)
    return [
        (int(c["glyph"]), tuple(c["fg"]), tuple(c["bg"]))
        for c in cells
    ]


def _build_native_player_runtime_preview_layers(sess: dict[str, Any], req_id: str) -> list[list[Cell]]:
    cols = int(sess["grid_cols"])
    rows = int(sess["grid_rows"])
    angles = int(sess.get("angles", 1))
    anims = [int(x) for x in sess.get("anims", [1])]
    projs = max(1, int(sess.get("projs", 1)))
    semantic_frames = sum(anims)
    if semantic_frames <= 0 or angles <= 0:
        raise ApiError("invalid runtime preview geometry", "invalid_runtime_preview_geometry", "workbench", req_id, 422)

    frame_cols = semantic_frames * projs
    if cols % frame_cols != 0 or rows % angles != 0:
        raise ApiError(
            f"session geometry incompatible with player runtime preview normalization: cols={cols}, rows={rows}, "
            f"angles={angles}, semantic_frames={semantic_frames}, projs={projs}",
            "runtime_preview_geometry_incompatible",
            "workbench",
            req_id,
            422,
        )

    src_frame_w = cols // frame_cols
    src_frame_h = rows // angles
    target_semantic_frames = 9  # native player idle/walk contract: [1, 8]
    target_projs = 2
    target_frame_w = NATIVE_COLS // (target_semantic_frames * target_projs)
    target_frame_h = NATIVE_ROWS // NATIVE_ANGLES

    cells_layer2 = _session_visual_cells(sess, req_id)
    src_grid = [list(cells_layer2[y * cols:(y + 1) * cols]) for y in range(rows)]
    dst_grid = [[_transparent_cell() for _ in range(NATIVE_COLS)] for _ in range(NATIVE_ROWS)]

    angle_row_map = (
        [0, 2, 4, 6] if angles == 4 else
        [0] if angles == 1 else
        list(range(min(angles, NATIVE_ANGLES)))
    )
    max_angles = min(angles, len(angle_row_map))
    max_frames = min(semantic_frames, target_semantic_frames)
    max_projs = min(projs, target_projs)
    for angle in range(max_angles):
        sy0 = angle * src_frame_h
        dst_angle = angle_row_map[angle]
        for frame in range(max_frames):
            for proj in range(max_projs):
                sx0 = (frame + (proj * semantic_frames)) * src_frame_w
                src_matrix = [row[sx0:sx0 + src_frame_w] for row in src_grid[sy0:sy0 + src_frame_h]]
                dst_matrix = _resample_frame_matrix(src_matrix, target_frame_w, target_frame_h)
                dx0 = (frame + (proj * target_semantic_frames)) * target_frame_w
                dy0 = dst_angle * target_frame_h
                for y in range(target_frame_h):
                    dst_grid[dy0 + y][dx0:dx0 + target_frame_w] = dst_matrix[y]

    preview_cells = [dst_grid[y][x] for y in range(NATIVE_ROWS) for x in range(NATIVE_COLS)]
    return _build_native_player_layers(
        cells_layer2=preview_cells,
        cols=NATIVE_COLS,
        rows=NATIVE_ROWS,
        stage="workbench",
        req_id=req_id,
    )


def workbench_load_session(session_id: str, req_id: str) -> dict[str, Any]:
    p = _session_path(session_id)
    if not p.exists():
        raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)
    return _session_payload(load_json(p))


def workbench_load_from_job(job_id: str, req_id: str) -> dict[str, Any]:
    job = status(job_id, req_id)
    xp_path = Path(job["xp_path"])
    if not xp_path.exists():
        raise ApiError("xp_path missing", "xp_missing", "workbench", req_id, 500)

    parsed = read_xp(xp_path)
    width = parsed["width"]
    height = parsed["height"]
    layer_count = int(parsed["layers"])

    # Convert ALL layers to standard dict format (B2: stop discarding non-L2 layers)
    all_layers: list[list[dict]] = []
    for li in range(layer_count):
        layer_raw = parsed["cells"][li]
        layer_cells: list[dict] = []
        for idx, (glyph, fg, bg) in enumerate(layer_raw):
            layer_cells.append({"idx": idx, "glyph": glyph, "fg": list(fg), "bg": list(bg)})
        all_layers.append(layer_cells)

    # Visual layer (L2) for backward compatibility
    visual_layer_idx = 2 if layer_count >= 3 else 0
    cells = all_layers[visual_layer_idx]
    populated = sum(1 for c in cells if c["glyph"] not in (0, 32))

    if populated <= 0:
        raise ApiError("workbench session would be empty", "empty_workbench", "workbench", req_id, 422)

    meta = dict(job["metadata"])
    if str(meta.get("metadata_status") or "").strip() == "missing":
        inferred = _derive_missing_raw_xp_geometry_from_visual(parsed, width, height)
        if inferred is not None:
            meta.update({
                "angles": inferred["angles"],
                "anims": inferred["anims"],
                "source_projs": inferred["projs"],
                "projs": inferred["projs"],
                "render_resolution": inferred["cell_w"],
                "cell_w_chars": inferred["cell_w"],
                "cell_h_chars": inferred["cell_h"],
            })
    session_id = str(uuid.uuid4())
    sess = WorkbenchSession(
        session_id=session_id,
        job_id=job_id,
        angles=int(meta["angles"]),
        anims=[int(x) for x in meta["anims"]],
        projs=int(meta["projs"]),
        cell_w=int(meta.get("cell_w_chars", meta["render_resolution"])),
        cell_h=int(meta.get("cell_h_chars", meta["render_resolution"])),
        grid_cols=width,
        grid_rows=height,
        cells=cells,
        layers=all_layers,
        session_kind="pipeline_job",
        metadata_status=str(meta.get("metadata_status") or "generated"),
    )
    sess_dict = sess.to_dict()
    family_val = str(meta.get("family", "player"))
    sess_dict["family"] = family_val
    sess_dict["filename_prefix"] = str(meta.get("filename_prefix") or family_val)
    sess_dict["skin_family"] = str(meta.get("skin_family") or "")
    # Enrich skin_family from prefix_catalog if still empty
    if not sess_dict["skin_family"]:
        reg = load_template_registry()
        pcat = reg.get("prefix_catalog", {}).get(sess_dict["filename_prefix"], {})
        sess_dict["skin_family"] = str(pcat.get("skin_family") or "")
    _save_session_json(_session_path(session_id), sess_dict)

    return _session_payload(sess_dict)


def workbench_create_blank_session(
    template_set_key: str,
    action_key: str,
    blank_session: dict[str, Any] | None,
    req_id: str,
) -> dict[str, Any]:
    if not template_set_key:
        spec = _blank_session_spec(blank_session, req_id)
        cols = int(spec["grid_cols"])
        rows = int(spec["grid_rows"])
        angles = int(spec["angles"])
        anims = [int(x) for x in spec["anims"]]
        projs = int(spec["projs"])
        wire_layers = _wire_layers(_build_root_blank_layers(cols, rows, angles, anims))
        cells = list(wire_layers[2] if len(wire_layers) > 2 else wire_layers[0])
        session_id = str(uuid.uuid4())
        sess = WorkbenchSession(
            session_id=session_id,
            job_id="",
            angles=angles,
            anims=anims,
            projs=projs,
            cell_w=int(spec["cell_w"]),
            cell_h=int(spec["cell_h"]),
            grid_cols=cols,
            grid_rows=rows,
            cells=cells,
            layers=wire_layers,
            session_kind="root_blank",
            metadata_status="generated",
        )
        sess_dict = sess.to_dict()
        family_val = str(spec["family"])
        sess_dict["family"] = family_val
        sess_dict["filename_prefix"] = family_val
        # Resolve skin_family from prefix_catalog
        reg = load_template_registry()
        pcat = reg.get("prefix_catalog", {}).get(family_val, {})
        sess_dict["skin_family"] = str(pcat.get("skin_family") or "")
        sess_dict["source_projs"] = int(spec["source_projs"])
        _save_session_json(_session_path(session_id), sess_dict)
        return _session_payload(sess_dict)

    reg = load_template_registry()
    ts = reg.get("template_sets", {}).get(template_set_key)
    if ts is None:
        raise ApiError(
            f"unknown template_set_key: {template_set_key}",
            "invalid_template_set", "workbench", req_id, 422,
        )
    action_spec = ts.get("actions", {}).get(action_key)
    if action_spec is None:
        raise ApiError(
            f"unknown action_key '{action_key}' for template set '{template_set_key}'",
            "invalid_action_key", "workbench", req_id, 422,
        )
    family = str(action_spec.get("family", "")).strip()
    authorized, auth_reason = is_action_authorized(
        action_spec,
        reg,
        template_set=ts,
        template_set_key=template_set_key,
        action_key=action_key,
    )
    if not authorized:
        raise ApiError(
            f"Family '{family}' is not authorized: {auth_reason}",
            "phase_not_enabled", "workbench", req_id, 422,
        )
    xp_dims = action_spec.get("xp_dims") or []
    if not isinstance(xp_dims, list) or len(xp_dims) != 2:
        raise ApiError("template action missing xp_dims", "invalid_template_action", "workbench", req_id, 422)
    cols = int(xp_dims[0])
    rows = int(xp_dims[1])
    angles = int(action_spec.get("angles", 1))
    anims = [int(x) for x in action_spec.get("frames", [1])]
    projs = int(action_spec.get("projs", 1))
    cell_w = int(action_spec.get("cell_w", 1))
    cell_h = int(action_spec.get("cell_h", 1))
    visual_layer: list[Cell] = [_transparent_cell() for _ in range(cols * rows)]
    layers = _build_native_layers(
        family=family,
        cells_layer2=visual_layer,
        cols=cols,
        rows=rows,
        stage="workbench",
        req_id=req_id,
    )
    wire_layers = _wire_layers(layers)
    cells = list(wire_layers[2] if len(wire_layers) > 2 else wire_layers[0])
    session_id = str(uuid.uuid4())
    sess = WorkbenchSession(
        session_id=session_id,
        job_id="",
        angles=angles,
        anims=anims,
        projs=projs,
        cell_w=cell_w,
        cell_h=cell_h,
        grid_cols=cols,
        grid_rows=rows,
        cells=cells,
        layers=wire_layers,
        session_kind="template_owned",
        metadata_status="generated",
    )
    sess_dict = sess.to_dict()
    sess_dict["family"] = family
    sess_dict["filename_prefix"] = str(action_spec.get("filename_prefix") or family)
    sess_dict["skin_family"] = str(action_spec.get("skin_family") or "")
    sess_dict["source_projs"] = int(action_spec.get("source_projs", action_spec.get("projs", projs)))
    sess_dict["template_set_key"] = template_set_key
    sess_dict["action_key"] = action_key
    sess_dict["runtime_identity"] = runtime_identity_for_action(template_set_key, action_key, action_spec)
    _save_session_json(_session_path(session_id), sess_dict)
    return _session_payload(sess_dict)


def bundle_action_run(bundle_id: str, action_key: str, source_path: str, req_id: str) -> dict[str, Any]:
    """Run pipeline for one action within a bundle, populating RunConfig from registry."""
    bundle = load_bundle(bundle_id, req_id)
    reg = load_template_registry()
    ts = reg.get("template_sets", {}).get(bundle.template_set_key)
    if ts is None:
        raise ApiError("bundle references unknown template set", "invalid_template_set", "workbench", req_id, 422)
    action_spec = ts.get("actions", {}).get(action_key)
    if action_spec is None:
        raise ApiError(f"action '{action_key}' not in template set", "invalid_action_key", "workbench", req_id, 422)
    family = action_spec["family"]
    authorized, auth_reason = is_action_authorized(
        action_spec,
        reg,
        template_set=ts,
        template_set_key=bundle.template_set_key,
        action_key=action_key,
    )
    if not authorized:
        raise ApiError(
            f"Family '{family}' is not authorized: {auth_reason}",
            "phase_not_enabled", "workbench", req_id, 422,
        )

    xp_dims = action_spec["xp_dims"]
    target_cols, target_rows = xp_dims[0], xp_dims[1]

    cfg = RunConfig(
        source_path=source_path,
        name=f"bundle-{bundle_id}-{action_key}",
        angles=action_spec["angles"],
        frames=action_spec["frames"],
        native_compat=True,
        target_cols=target_cols,
        target_rows=target_rows,
        family=family,
    )
    result = run_pipeline(cfg, req_id)

    # Create workbench session from the job
    job_id = result["job_id"]
    session_result = workbench_load_from_job(job_id, req_id)
    session_id = session_result["session_id"]

    # Update bundle state
    action_state = bundle.actions.get(action_key)
    if action_state is None:
        action_state = BundleActionState(action_key=action_key)
        bundle.actions[action_key] = action_state
    action_state.session_id = session_id
    action_state.job_id = job_id
    action_state.source_path = source_path
    action_state.status = "converted"
    action_state.runtime_identity = runtime_identity_for_action(bundle.template_set_key, action_key, action_spec)
    save_bundle(bundle)

    # UQ-006: Store source_path on the session so manifest can be derived
    sess_p = _session_path(session_id)
    if sess_p.exists():
        sess = load_json(sess_p)
        sess["source_path"] = source_path
        # If a manifest exists for this source, derive initial mirror state
        existing_manifest = load_manifest(source_path)
        if existing_manifest:
            mirror = materialize_manifest(existing_manifest)
            sess["source_boxes"] = mirror["source_boxes"]
            sess["source_anchor_box"] = mirror["source_anchor_box"]
            sess["source_draft_box"] = mirror["source_draft_box"]
            sess["source_cuts_v"] = mirror["source_cuts_v"]
            sess["source_cuts_h"] = mirror["source_cuts_h"]
        _save_session_json(sess_p, sess)

    return {
        "bundle_id": bundle_id,
        "action_key": action_key,
        "job_id": job_id,
        "session_id": session_id,
        "grid_cols": target_cols,
        "grid_rows": target_rows,
        "family": family,
    }


def workbench_export_xp(session_id: str, req_id: str) -> dict[str, Any]:
    p = _session_path(session_id)
    if not p.exists():
        raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)

    sess = load_json(p)
    cols = int(sess["grid_cols"])
    rows = int(sess["grid_rows"])
    expected_cells = cols * rows

    family = str(sess.get("family", "player"))
    session_kind = _session_kind(sess)
    angles = int(sess.get("angles", 1))
    anims = [int(x) for x in sess.get("anims", [1])]
    projs = int(sess.get("projs", 1))
    source_projs = int(sess.get("source_projs", projs))

    # Uploaded XP sessions preserve their real layer set directly. Template
    # sessions rebuild native layers so semantic-slot authoring can expand
    # source_projs -> projs during export.
    persisted_layers = sess.get("layers")
    family_dims = _FAMILY_DIMS.get(family)
    use_persisted_layer_export = (
        persisted_layers
        and isinstance(persisted_layers, list)
        and len(persisted_layers) >= 1
        and (
            session_kind == "raw_xp"
            or family_dims is None
            or family_dims != (cols, rows)
        )
    )
    if use_persisted_layer_export:
        # Hard-fail: every layer must have exactly cols*rows cells
        layers: list[list[Cell]] = []
        for li, raw_layer in enumerate(persisted_layers):
            if not isinstance(raw_layer, list):
                raise ApiError(
                    f"persisted layer {li} is not a list",
                    "export_layer_malformed", "workbench", req_id, 422,
                )
            if len(raw_layer) != expected_cells:
                raise ApiError(
                    f"persisted layer {li} has {len(raw_layer)} cells, expected {expected_cells}",
                    "export_layer_geometry_mismatch", "workbench", req_id, 422,
                )
            layer_cells: list[Cell] = []
            for ci, c in enumerate(raw_layer):
                if not isinstance(c, dict):
                    raise ApiError(
                        f"persisted layer {li} cell {ci} is not a dict",
                        "export_layer_malformed", "workbench", req_id, 422,
                    )
                layer_cells.append(
                    (int(c["glyph"]), tuple(c["fg"]), tuple(c["bg"]))
                )
            layers.append(layer_cells)
    else:
        # Legacy/template path: fabricate L0/L1/L3 around L2 from session cells.
        cells = [
            (int(c["glyph"]), tuple(c["fg"]), tuple(c["bg"]))
            for c in sess["cells"]
        ]
        if len(cells) != expected_cells:
            raise ApiError("session cell geometry mismatch", "session_geometry_invalid", "workbench", req_id, 422)

        if source_projs < projs:
            cells = _expand_visual_cells_for_export(
                cells_layer2=cells,
                cols=cols,
                rows=rows,
                angles=angles,
                anims=anims,
                source_projs=source_projs,
                projs=projs,
                req_id=req_id,
            )

        layers = _build_native_layers(
            family=family, cells_layer2=cells, cols=cols, rows=rows,
            stage="workbench", req_id=req_id,
        )

    out = EXPORT_DIR / f"session-{session_id}.xp"
    write_xp(out, cols, rows, layers)

    return {
        "session_id": session_id,
        "xp_path": str(out.resolve()),
        "checksum": _sha256(out),
        "layer_count": len(layers),
        "source": "persisted_layers" if use_persisted_layer_export else "template",
    }


def workbench_upload_xp(xp_bytes: bytes, req_id: str, source_name: str = "") -> dict[str, Any]:
    """Upload and parse an XP file into a new workbench session."""
    if not isinstance(xp_bytes, bytes):
        raise ApiError("xp_bytes must be bytes", "invalid_type", "workbench", req_id, 400)

    # Parse XP file from bytes
    try:
        xp_data = read_xp(xp_bytes)
    except Exception as e:
        raise ApiError(f"Failed to parse XP file: {e}", "xp_parse_error", "workbench", req_id, 422)

    cols = xp_data["width"]
    rows = xp_data["height"]
    layer_count = xp_data["layers"]

    if cols <= 0 or rows <= 0:
        raise ApiError("XP dimensions must be positive", "invalid_xp_dims", "workbench", req_id, 422)

    # Convert ALL layers to standard dict format (B2: stop discarding non-L2 layers)
    all_layers: list[list[dict]] = []
    for layer_idx in range(layer_count):
        layer_raw = xp_data["cells"][layer_idx]
        layer_cells: list[dict] = []
        for i in range(cols * rows):
            if layer_raw[i] is None:
                layer_cells.append({"glyph": 0, "fg": [255, 255, 255], "bg": [0, 0, 0]})
            else:
                glyph, fg, bg = layer_raw[i]
                layer_cells.append({
                    "glyph": int(glyph),
                    "fg": list(fg) if isinstance(fg, tuple) else fg,
                    "bg": list(bg) if isinstance(bg, tuple) else bg,
                })
        all_layers.append(layer_cells)

    # Visual layer (L2) extracted for backward compatibility only.
    # `layers` is the source of truth for uploaded XP sessions.
    visual_layer_idx = 2 if layer_count >= 3 else 0
    cells = all_layers[visual_layer_idx]

    # Raw XP import accepts missing/malformed template metadata and falls back
    # to a single-frame whole-sheet geometry owned by the document itself.
    geo, metadata_status = _derive_raw_xp_geometry(xp_data, cols, rows, req_id)

    # Save uploaded XP to disk so workbench_load_from_job can read it
    job_id = str(uuid.uuid4())
    xp_disk_path = EXPORT_DIR / f"{job_id}.xp"
    xp_disk_path.write_bytes(xp_bytes)

    # Create minimal job record with L0-derived geometry.
    record = JobRecord(
        job_id=job_id,
        state="SUCCEEDED",
        stage="upload",
        source_path="",
        xp_path=str(xp_disk_path.resolve()),
        preview_paths=[],
        metadata={
            "angles": geo["angles"],
            "anims": geo["anims"],
            "source_projs": geo["projs"],
            "projs": geo["projs"],
            "render_resolution": geo["cell_w"],
            "cell_w_chars": geo["cell_w"],
            "cell_h_chars": geo["cell_h"],
            "family": "uploaded",
            "metadata_status": metadata_status,
        },
        gate_report_path=None,
        trace_path=None,
    )
    save_json(_job_path(job_id), record.to_dict())

    # Create workbench session (B3: session carries full layer set)
    session_id = str(uuid.uuid4())
    sess = WorkbenchSession(
        session_id=session_id,
        job_id=job_id,
        angles=geo["angles"],
        anims=geo["anims"],
        projs=geo["projs"],
        cell_w=geo["cell_w"],
        cell_h=geo["cell_h"],
        grid_cols=cols,
        grid_rows=rows,
        cells=cells,
        layers=all_layers,
        session_kind="raw_xp",
        metadata_status=metadata_status,
    )

    # Save session
    sess_path = _session_path(session_id)
    sess_dict = asdict(sess)
    sess_dict["family"] = "uploaded"
    clean_name = Path(str(source_name or "").strip()).name
    if clean_name:
        sess_dict["name"] = clean_name
    _save_session_json(sess_path, sess_dict)

    response = _session_payload(sess_dict)
    response["job_id"] = job_id
    response["cell_count"] = len(cells)
    return response


def workbench_xp_tool_command(xp_path: str, req_id: str) -> dict[str, Any]:
    xp = Path(xp_path).expanduser()
    if not xp.exists():
        raise ApiError("xp_path not found", "xp_not_found", "workbench", req_id, 404)
    if xp.suffix.lower() != ".xp":
        raise ApiError("xp_path must end with .xp", "invalid_xp_path", "workbench", req_id, 422)
    try:
        argv, cwd = _xp_tool_command_parts(xp.resolve())
    except Exception as e:
        raise ApiError(str(e), "xp_tool_unavailable", "workbench", req_id, 422)
    return {
        "xp_path": str(xp.resolve()),
        "command": " ".join(shlex.quote(x) for x in argv),
        "argv": argv,
        "cwd": str(cwd),
    }


def workbench_open_in_xp_tool(xp_path: str, req_id: str, dry_run: bool = False) -> dict[str, Any]:
    cmd = workbench_xp_tool_command(xp_path, req_id)
    if dry_run:
        return {
            **cmd,
            "launched": False,
            "dry_run": True,
        }
    try:
        proc = subprocess.Popen(
            cmd["argv"],
            cwd=cmd["cwd"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as e:
        raise ApiError(f"failed to launch xp_tool: {e}", "xp_tool_launch_failed", "workbench", req_id, 500)
    return {
        **cmd,
        "launched": True,
        "dry_run": False,
        "pid": int(proc.pid),
    }


def workbench_run_verification(
    session_id: str,
    req_id: str,
    profile: str = "local_xp_sanity",
    command_template: str = "",
    timeout_sec: int = 20,
    dry_run: bool = False,
) -> dict[str, Any]:
    p = _session_path(session_id)
    if not p.exists():
        raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)
    sess = load_json(p)
    export = workbench_export_xp(session_id, req_id)
    xp_path = Path(export["xp_path"]).expanduser().resolve()
    profile_key = str(profile or "local_xp_sanity").strip() or "local_xp_sanity"
    timeout_sec = max(1, min(300, int(timeout_sec or 20)))

    legacy_root = _resolve_legacy_repo_root()
    suggested_templates = {
        "termpp_custom": "cd {legacy_repo_root} && <PASTE_TERMPP_VERIFY_COMMAND_USING_{xp_path}>",
        "legacy_verify_e2e": "cd {legacy_repo_root} && PYTHONPATH={legacy_repo_root} python3 scripts/verify_e2e.py --xp-path \"{xp_path}\"",
    }

    if dry_run:
        if profile_key == "local_xp_sanity":
            command_preview = None
            cwd = str(ROOT.resolve())
        else:
            tpl = command_template or suggested_templates.get(profile_key, command_template)
            if not tpl:
                tpl = suggested_templates["termpp_custom"]
            try:
                command_preview = str(tpl).format(
                    xp_path=str(xp_path),
                    legacy_repo_root=str(legacy_root),
                    pipeline_repo_root=str(ROOT.resolve()),
                )
            except Exception:
                command_preview = str(tpl)
            cwd = str(ROOT.resolve())
        return {
            "session_id": session_id,
            "xp_path": str(xp_path),
            "checksum": export["checksum"],
            "profile": profile_key,
            "dry_run": True,
            "timeout_sec": timeout_sec,
            "command": command_preview,
            "cwd": cwd,
            "legacy_repo_root": str(legacy_root),
            "suggested_templates": suggested_templates,
        }

    if profile_key == "local_xp_sanity":
        result = _workbench_verify_local_xp_sanity(xp_path, sess)
        result["duration_ms"] = int(result.get("duration_ms") or 0)
        result["timed_out"] = False
    elif profile_key in {"termpp_custom", "legacy_verify_e2e"}:
        tpl = command_template or suggested_templates.get(profile_key, "")
        result = _workbench_verify_custom_shell(xp_path, profile_key, tpl, timeout_sec, req_id)
    else:
        raise ApiError(f"unknown verification profile: {profile_key}", "invalid_verification_profile", "workbench", req_id, 422)

    WORKBENCH_VERIFY_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    report_path = WORKBENCH_VERIFY_DIR / f"{session_id}-{profile_key}-{ts}.json"
    report = {
        "session_id": session_id,
        "request_id": req_id,
        "profile": profile_key,
        "xp_path": str(xp_path),
        "checksum": export["checksum"],
        "legacy_repo_root": str(legacy_root),
        "dry_run": False,
        **result,
    }
    save_json(report_path, report)
    report["report_path"] = str(report_path.resolve())
    report["suggested_templates"] = suggested_templates
    return report


def workbench_termpp_skin_command(session_id: str, req_id: str, binary_name: str = "game_term") -> dict[str, Any]:
    p = _session_path(session_id)
    if not p.exists():
        raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)
    export = workbench_export_xp(session_id, req_id)
    xp_path = Path(export["xp_path"]).expanduser().resolve()
    try:
        bin_name = _normalize_binary_name(binary_name)
    except Exception as e:
        raise ApiError(str(e), "invalid_binary_name", "workbench", req_id, 422)
    run_id = f"{session_id}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}"
    runtime_root = WORKBENCH_TERMPP_DIR / run_id
    cmd = [str((runtime_root / ".run" / bin_name).resolve())]
    return {
        "session_id": session_id,
        "xp_path": str(xp_path),
        "checksum": export["checksum"],
        "legacy_root": str(_resolve_legacy_repo_root()),
        "binary_name": bin_name,
        "planned_runtime_root": str(runtime_root.resolve()),
        "planned_command": " ".join(shlex.quote(x) for x in cmd),
        "notes": [
            "Sandbox runtime will be created under pipeline-v2/output/termpp_skin_runs",
            "Original legacy sprites are not modified",
            "Current exported XP will be staged into common player skin filenames inside sandbox sprites/",
        ],
    }


def workbench_open_termpp_skin(session_id: str, req_id: str, binary_name: str = "game_term", dry_run: bool = False) -> dict[str, Any]:
    p = _session_path(session_id)
    if not p.exists():
        raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)
    export = workbench_export_xp(session_id, req_id)
    xp_path = Path(export["xp_path"]).expanduser().resolve()
    try:
        bin_name = _normalize_binary_name(binary_name)
    except Exception as e:
        raise ApiError(str(e), "invalid_binary_name", "workbench", req_id, 422)

    run_id = f"{session_id}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}"
    planned_runtime_root = WORKBENCH_TERMPP_DIR / run_id
    if dry_run:
        planned_cmd = [str((planned_runtime_root / ".run" / bin_name).resolve())]
        return {
            "session_id": session_id,
            "xp_path": str(xp_path),
            "checksum": export["checksum"],
            "legacy_root": str(_resolve_legacy_repo_root()),
            "binary_name": bin_name,
            "runtime_root": str(planned_runtime_root.resolve()),
            "command": " ".join(shlex.quote(x) for x in planned_cmd),
            "dry_run": True,
            "launched": False,
            "notes": [
                "Dry run only; sandbox not created",
                "Launch creates isolated runtime and stages XP skin into sandbox sprites/",
            ],
        }

    try:
        legacy_root = _resolve_legacy_repo_root()
        termpp_bin = _resolve_termpp_binary(legacy_root, binary_name=bin_name)
        stage = _stage_termpp_skin_sandbox(legacy_root, xp_path, run_id, termpp_bin.name)
        argv = [stage["runtime_binary"]]
        proc = subprocess.Popen(
            argv,
            cwd=stage["runtime_root"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    except ApiError:
        raise
    except Exception as e:
        raise ApiError(f"failed to launch TERM++ skin runtime: {e}", "termpp_skin_launch_failed", "workbench", req_id, 500)

    return {
        "session_id": session_id,
        "xp_path": str(xp_path),
        "checksum": export["checksum"],
        "binary_name": bin_name,
        "dry_run": False,
        "launched": True,
        "pid": int(proc.pid),
        **stage,
        "command": shlex.quote(stage["runtime_binary"]),
    }


def workbench_termpp_stream_start(
    session_id: str,
    req_id: str,
    region_x: int,
    region_y: int,
    region_w: int,
    region_h: int,
    fps: int = 4,
    dry_run: bool = False,
) -> dict[str, Any]:
    p = _session_path(session_id)
    if not p.exists():
        raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)

    x = int(region_x)
    y = int(region_y)
    w = int(region_w)
    h = int(region_h)
    fps = max(1, min(30, int(fps or 4)))
    if w < 16 or h < 16:
        raise ApiError("stream region must be at least 16x16", "invalid_stream_region", "workbench", req_id, 422)
    if x < 0 or y < 0:
        raise ApiError("stream region x/y must be >= 0", "invalid_stream_region", "workbench", req_id, 422)

    WORKBENCH_STREAM_DIR.mkdir(parents=True, exist_ok=True)
    stream_id = str(uuid.uuid4())
    stream_dir = WORKBENCH_STREAM_DIR / stream_id
    stream_dir.mkdir(parents=True, exist_ok=True)
    frame_path = stream_dir / "latest.png"
    region = {"x": x, "y": y, "w": w, "h": h}

    if dry_run:
        return {
            "stream_id": stream_id,
            "session_id": session_id,
            "dry_run": True,
            "fps": fps,
            "region": region,
            "command_preview": _stream_capture_command(region, frame_path),
            "frame_path": str(frame_path.resolve()),
            "notes": [
                "Grant Screen Recording permission to the terminal/Codex app if prompted",
                "This is a view-only embed stream (no input forwarding yet)",
            ],
        }

    if os.uname().sysname != "Darwin":
        raise ApiError("TERM++ embed stream currently supports macOS screencapture only", "termpp_stream_unsupported_os", "workbench", req_id, 422)

    stop_evt = threading.Event()
    rec = {
        "stream_id": stream_id,
        "session_id": session_id,
        "fps": fps,
        "region": region,
        "frame_path": str(frame_path),
        "created_at": time.time(),
        "last_frame_ts": None,
        "last_error": None,
        "frame_count": 0,
        "running": True,
        "stop_event": stop_evt,
        "thread": None,
    }
    th = threading.Thread(target=_termpp_stream_worker, args=(stream_id,), name=f"termpp-stream-{stream_id[:8]}", daemon=True)
    rec["thread"] = th
    with _TERM_STREAM_LOCK:
        _TERM_STREAMS[stream_id] = rec
    th.start()
    out = _termpp_stream_record_view(rec)
    out["dry_run"] = False
    return out


def workbench_termpp_stream_stop(stream_id: str, req_id: str) -> dict[str, Any]:
    sid = str(stream_id or "").strip()
    if not sid:
        raise ApiError("stream_id is required", "missing_stream_id", "workbench", req_id, 400)
    with _TERM_STREAM_LOCK:
        rec = _TERM_STREAMS.get(sid)
        if not rec:
            raise ApiError("stream not found", "stream_not_found", "workbench", req_id, 404)
        rec["stop_event"].set()
        rec["running"] = False
        out = _termpp_stream_record_view(rec)
    out["stopped"] = True
    return out


def workbench_termpp_stream_status(stream_id: str, req_id: str) -> dict[str, Any]:
    sid = str(stream_id or "").strip()
    if not sid:
        raise ApiError("stream_id is required", "missing_stream_id", "workbench", req_id, 400)
    with _TERM_STREAM_LOCK:
        rec = _TERM_STREAMS.get(sid)
        if not rec:
            raise ApiError("stream not found", "stream_not_found", "workbench", req_id, 404)
        return _termpp_stream_record_view(rec)


def workbench_termpp_stream_frame_path(stream_id: str, req_id: str) -> Path:
    sid = str(stream_id or "").strip()
    if not sid:
        raise ApiError("stream_id is required", "missing_stream_id", "workbench", req_id, 400)
    with _TERM_STREAM_LOCK:
        rec = _TERM_STREAMS.get(sid)
        if not rec:
            raise ApiError("stream not found", "stream_not_found", "workbench", req_id, 404)
        p = Path(rec["frame_path"]).expanduser().resolve()
    if not p.exists():
        raise ApiError("stream frame not ready", "stream_frame_not_ready", "workbench", req_id, 404)
    return p


def workbench_web_skin_payload(session_id: str, req_id: str) -> dict[str, Any]:
    p = _session_path(session_id)
    if not p.exists():
        raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)
    sess = load_json(p)
    if not _template_metadata_compatible(sess):
        raise ApiError(
            "session requires template metadata repair/conversion before runtime payload export",
            "template_metadata_repair_required",
            "workbench",
            req_id,
            422,
        )
    family = str(sess.get("family", "player"))
    cols = int(sess["grid_cols"])
    rows = int(sess["grid_rows"])
    preview_normalized = False
    if family == "player" and (cols, rows) != (NATIVE_COLS, NATIVE_ROWS):
        layers = _build_native_player_runtime_preview_layers(sess, req_id)
        xp_path = (EXPORT_DIR / f"session-runtime-preview-{session_id}.xp").resolve()
        write_xp(xp_path, NATIVE_COLS, NATIVE_ROWS, layers)
        checksum = _sha256(xp_path)
        preview_normalized = True
    else:
        export = workbench_export_xp(session_id, req_id)
        xp_path = Path(export["xp_path"]).expanduser().resolve()
        checksum = export["checksum"]
    # A4 validate step: sessions carrying template identity (template-owned or
    # bundle action sessions) are gate-checked against their registry action
    # spec. Breach raises 422 here — no payload bytes escape (fail-closed, A6).
    # Sessions without template identity (raw uploads, root blanks, pipeline
    # jobs) have no normalized spec to validate against and skip this step.
    action_spec = action_spec_for_session(sess, load_template_registry())
    validation: list[dict[str, Any]] | None = None
    if action_spec is not None:
        gates = _run_structural_gates(str(xp_path), action_spec, req_id)
        validation = validate_runtime_export(
            gates,
            context=f"session '{session_id}'",
            req_id=req_id,
        )
    try:
        raw = xp_path.read_bytes()
    except Exception as e:
        raise ApiError(f"failed reading exported xp: {e}", "xp_read_failed", "workbench", req_id, 500)
    # Mirrors the disk-based TERM++ sandbox override set; web build skin reload can use same names.
    override_names = _termpp_skin_override_names(load_template_registry())
    doc_contract = _skin_payload_doc_contract(
        sess, family, str(xp_path), preview_normalized, checksum, validation, req_id,
    )
    return {
        "session_id": session_id,
        "xp_path": str(xp_path),
        "checksum": checksum,
        "xp_size_bytes": len(raw),
        "xp_b64": base64.b64encode(raw).decode("ascii"),
        "override_names": override_names,
        "reload_player_name": "player",
        "preview_normalized": preview_normalized,
        "validation": validation,
        "doc_contract": doc_contract,
    }


def _skin_payload_doc_contract(
    sess: dict[str, Any],
    family: str,
    xp_path: str,
    preview_normalized: bool,
    checksum: str,
    validation: list[dict[str, Any]] | None,
    req_id: str,
) -> dict[str, Any]:
    """Normalized doc-kind/metadata record consumed by Test This Skin.

    Lets the Skin Dock contract viewer bind the runtime payload to the exact
    workbench document (no ambient/default-sprite ambiguity): session kind,
    metadata status, template identity, geometry, layer-0 compat verdict, and
    whether the payload XP was normalized to native runtime dims.
    """
    expected_l0 = list(_FAMILY_L0_COL0.get(family, []))
    actual_l0: list[str] = []
    layer_count = 0
    xp_dims: list[int] = [0, 0]
    try:
        xp = read_xp(xp_path)
        xp_dims = [int(xp["width"]), int(xp["height"])]
        layer_count = len(xp["cells"])
        if xp["cells"]:
            cols = int(xp["width"])
            l0 = xp["cells"][0]
            for col_idx in range(min(len(expected_l0), cols)):
                glyph = int(l0[col_idx][0])
                actual_l0.append(chr(glyph) if glyph >= 32 else "")
    except Exception:
        actual_l0 = []
    return {
        "session_id": str(sess.get("session_id") or ""),
        "session_kind": _session_kind(sess),
        "metadata_status": _metadata_status(sess),
        "family": family,
        "template_set_key": str(sess.get("template_set_key") or ""),
        "action_key": str(sess.get("action_key") or ""),
        "grid_cols": int(sess.get("grid_cols") or 0),
        "grid_rows": int(sess.get("grid_rows") or 0),
        "xp_dims": xp_dims,
        "layer_count": layer_count,
        "layer0_expected": expected_l0,
        "layer0_actual": actual_l0,
        "layer0_compat": bool(expected_l0) and actual_l0 == expected_l0,
        "preview_normalized": preview_normalized,
        "validation": validation,
        "checksum": checksum,
    }


def _legacy_preview_contract_for_xp(
    raw: bytes,
    req_id: str,
    *,
    declared_family: str = "",
) -> dict[str, Any]:
    if not raw:
        raise ApiError("XP preview payload is empty", "empty_xp", "workbench", req_id, 400)
    if len(raw) > _LEGACY_PREVIEW_MAX_XP_BYTES:
        raise ApiError("XP preview payload is too large", "xp_too_large", "workbench", req_id, 413)
    try:
        xp = read_xp(raw)
    except Exception as exc:
        raise ApiError(f"failed to parse XP preview payload: {exc}", "invalid_xp", "workbench", req_id, 422)

    width = int(xp.get("width", 0))
    height = int(xp.get("height", 0))
    layers = int(xp.get("layers", 0))
    contract = _LEGACY_PREVIEW_CONTRACTS.get((width, height))
    if contract is None:
        raise ApiError(
            f"legacy preview accepts only player 126x72 or wolfie 180x96 XP; got {width}x{height}",
            "legacy_preview_topology_mismatch",
            "workbench",
            req_id,
            422,
        )
    if layers not in (3, 4):
        raise ApiError(
            f"legacy preview requires 3 or 4 XP layers; got {layers}",
            "legacy_preview_layer_mismatch",
            "workbench",
            req_id,
            422,
        )

    family = str(contract["family"])
    declared = str(declared_family or "").strip().lower()
    if declared and declared != family:
        raise ApiError(
            f"session family {declared!r} is incompatible with {width}x{height} {family} topology",
            "legacy_preview_family_mismatch",
            "workbench",
            req_id,
            422,
        )

    cells = xp.get("cells") or []
    if not cells or len(cells[0]) < 3:
        raise ApiError("XP is missing L0 metadata", "legacy_preview_metadata_missing", "workbench", req_id, 422)
    marker = "".join(chr(int(cells[0][idx][0])) for idx in range(3))
    if marker != "818":
        raise ApiError(
            f"legacy preview requires L0 marker 818; got {marker!r}",
            "legacy_preview_metadata_mismatch",
            "workbench",
            req_id,
            422,
        )
    key_rgb = tuple(int(v) for v in cells[0][0][2])
    if key_rgb != (255, 255, 85):
        raise ApiError(
            f"legacy preview requires #ffff55 transparency key; got #{key_rgb[0]:02x}{key_rgb[1]:02x}{key_rgb[2]:02x}",
            "legacy_preview_key_mismatch",
            "workbench",
            req_id,
            422,
        )

    target_paths = _legacy_preview_family_targets(family)
    return {
        **contract,
        "target_path": target_paths[0],
        "target_paths": target_paths,
        "width": width,
        "height": height,
        "layers": layers,
        "l0_marker": marker,
        "key_rgb": list(key_rgb),
    }


def _normalize_legacy_preview_xp(raw: bytes, req_id: str) -> tuple[bytes, int]:
    """Adapt authored transparency to the frozen sprite.cpp L2 contract."""
    try:
        xp = read_xp(raw)
        layers = [list(layer) for layer in xp["cells"]]
    except Exception as exc:
        raise ApiError(f"failed to normalize XP preview payload: {exc}", "invalid_xp", "workbench", req_id, 422)

    layer0 = layers[0]
    visual = layers[2]
    normalized = 0
    for index, (glyph, fg, bg) in enumerate(visual):
        if int(glyph) in (0, 32) or tuple(bg) != MAGENTA_BG:
            continue
        output_key = tuple(int(value) for value in layer0[index][2])
        if output_key == MAGENTA_BG:
            raise ApiError(
                f"drawn L2 cell {index} has no non-magenta layer-0 transparency key",
                "legacy_preview_transparency_contract_mismatch",
                "workbench",
                req_id,
                422,
            )
        visual[index] = (int(glyph), tuple(fg), output_key)
        normalized += 1

    if not normalized:
        return raw, 0
    return encode_xp(int(xp["width"]), int(xp["height"]), layers), normalized


def _build_legacy_player_preview_xp(session: dict[str, Any], req_id: str) -> bytes:
    """Project the 126x80 authoring contract into the frozen 126x72 web runtime."""
    cols = int(session["grid_cols"])
    rows = int(session["grid_rows"])
    angles = int(session.get("angles", 0))
    anims = [int(value) for value in session.get("anims", [])]
    projs = int(session.get("projs", 0))
    semantic_frames = sum(anims)
    if (cols, rows, angles, semantic_frames, projs) != (126, 80, 8, 9, 2):
        raise ApiError(
            "player session cannot be projected into the legacy 126x72 preview contract",
            "legacy_preview_projection_unsupported",
            "workbench",
            req_id,
            422,
        )

    reference_path = (ROOT / "sprites" / "player-0000.xp").resolve()
    try:
        reference = read_xp(reference_path)
    except Exception as exc:
        raise ApiError(
            f"failed reading legacy player preview reference: {exc}",
            "legacy_preview_reference_unavailable",
            "workbench",
            req_id,
            500,
        )
    if (int(reference["width"]), int(reference["height"]), int(reference["layers"])) != (126, 72, 3):
        raise ApiError(
            "legacy player preview reference contract drifted from 126x72x3",
            "legacy_preview_reference_mismatch",
            "workbench",
            req_id,
            500,
        )

    source = _session_visual_cells(session, req_id)
    source_grid = [source[y * cols:(y + 1) * cols] for y in range(rows)]
    target_visual = [_transparent_cell() for _ in range(126 * 72)]
    target_grid = [target_visual[y * 126:(y + 1) * 126] for y in range(72)]
    for angle in range(8):
        for frame in range(18):
            x0 = frame * 7
            source_matrix = [row[x0:x0 + 7] for row in source_grid[angle * 10:(angle + 1) * 10]]
            projected = _resample_frame_matrix(source_matrix, 7, 9)
            for y, row in enumerate(projected):
                target_grid[angle * 9 + y][x0:x0 + 7] = row

    layers = [list(layer) for layer in reference["cells"]]
    layers[2] = [target_grid[y][x] for y in range(72) for x in range(126)]
    return encode_xp(126, 72, layers)


def workbench_mint_legacy_preview_token(
    req_id: str,
    *,
    session_id: str = "",
    xp_b64: str = "",
    source_name: str = "",
) -> dict[str, Any]:
    sid = str(session_id or "").strip()
    encoded = str(xp_b64 or "").strip()
    if bool(sid) == bool(encoded):
        raise ApiError(
            "provide exactly one of session_id or xp_b64",
            "legacy_preview_source_required",
            "workbench",
            req_id,
            400,
        )

    declared_family = ""
    if sid:
        session_path = _session_path(sid)
        if not session_path.exists():
            raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)
        session = load_json(session_path)
        session_family = str(session.get("filename_prefix") or session.get("family") or "").strip()
        if not (_session_kind(session) == "raw_xp" and session_family in {"", "uploaded"}):
            declared_family = session_family
        export = workbench_export_xp(sid, req_id)
        xp_path = Path(export["xp_path"]).expanduser().resolve()
        try:
            raw = xp_path.read_bytes()
        except OSError as exc:
            raise ApiError(f"failed reading exported XP: {exc}", "xp_read_failed", "workbench", req_id, 500)
        source_raw = raw
        if declared_family == "player" and (int(session["grid_cols"]), int(session["grid_rows"])) == (126, 80):
            raw = _build_legacy_player_preview_xp(session, req_id)
        source_name = source_name or xp_path.name
    else:
        try:
            raw = base64.b64decode(encoded, validate=True)
        except Exception:
            raise ApiError("xp_b64 is not valid base64", "invalid_xp_base64", "workbench", req_id, 400)
        source_raw = raw

    contract = _legacy_preview_contract_for_xp(raw, req_id, declared_family=declared_family)
    runtime_raw, normalized_cells = _normalize_legacy_preview_xp(raw, req_id)
    token = uuid.uuid4().hex
    now = time.monotonic()
    record = {
        **contract,
        "token": token,
        "xp_bytes": runtime_raw,
        "source_sha256": hashlib.sha256(source_raw).hexdigest(),
        "source_size_bytes": len(source_raw),
        "sha256": hashlib.sha256(runtime_raw).hexdigest(),
        "size_bytes": len(runtime_raw),
        "legacy_transparency_normalized_cells": normalized_cells,
        "source_name": Path(str(source_name or "preview.xp")).name,
        "session_id": sid,
        "created_at": now,
        "expires_at": now + _LEGACY_PREVIEW_TOKEN_TTL_SECONDS,
    }
    with _LEGACY_PREVIEW_LOCK:
        expired = [key for key, value in _LEGACY_PREVIEW_TOKENS.items() if float(value["expires_at"]) <= now]
        for key in expired:
            _LEGACY_PREVIEW_TOKENS.pop(key, None)
        _LEGACY_PREVIEW_TOKENS[token] = record

    return {
        key: value
        for key, value in record.items()
        if key not in {"xp_bytes", "created_at", "expires_at"}
    } | {"expires_in_seconds": _LEGACY_PREVIEW_TOKEN_TTL_SECONDS}


def workbench_consume_legacy_preview_token(token: str, req_id: str) -> dict[str, Any]:
    key = str(token or "").strip().lower()
    if len(key) != 32 or any(ch not in "0123456789abcdef" for ch in key):
        raise ApiError("invalid legacy preview token", "invalid_preview_token", "workbench", req_id, 400)
    now = time.monotonic()
    with _LEGACY_PREVIEW_LOCK:
        record = _LEGACY_PREVIEW_TOKENS.pop(key, None)
    if record is None or float(record["expires_at"]) <= now:
        raise ApiError(
            "legacy preview token not found, expired, or already consumed",
            "preview_token_unavailable",
            "workbench",
            req_id,
            404,
        )
    raw = bytes(record["xp_bytes"])
    return {
        key: value
        for key, value in record.items()
        if key not in {"xp_bytes", "created_at", "expires_at"}
    } | {"xp_b64": base64.b64encode(raw).decode("ascii")}


def _action_override_names(family: str, ahsw_range: str) -> list[str]:
    """Generate override filenames for a family/AHSW range.

    Legacy full-parity override naming: AHSW = Armor/Helmet/Shield/Weapon.
    A,H,S ∈ {0,1} (binary), W ∈ {0,1,2} (ternary).
    Produces filenames like player-0120.xp where digits are A,H,S,W.
    """
    names: list[str] = []
    if ahsw_range == "all_16":
        if family == "player":
            names.append("player-nude.xp")
        for a in range(2):
            for h in range(2):
                for s in range(2):
                    for w in range(3):
                        names.append(f"{family}-{a}{h}{s}{w}.xp")
    elif ahsw_range == "weapon_gte_1":
        # W ∈ {1,2} — weapon must be equipped.
        for a in range(2):
            for h in range(2):
                for s in range(2):
                    for w in (1, 2):
                        names.append(f"{family}-{a}{h}{s}{w}.xp")
    return names


_FAMILY_L0_COL0: dict[str, list[str]] = {
    "player": ["8", "1", "8"],
    "attack": ["8", "8"],
    "plydie": ["8", "5"],
    "wolfie": ["8", "1", "8"],
    "wolack": ["8", "8"],
}


def _run_structural_gates(
    xp_path: str,
    action_spec: dict[str, Any],
    req_id: str,
) -> list[GateResult]:
    """Run G7-G12 structural gates on an exported XP against its template spec.

    G7/G8/G9 run on the art layer (layer index 2) to catch blank or near-blank
    sheets that were manually edited after pipeline (PB-14).
    G10/G11/G12 enforce dimension, layer count, and L0 metadata.
    """
    xp = read_xp(xp_path)
    expected_dims = action_spec.get("xp_dims", [0, 0])
    expected_layers = action_spec.get("layers", 0)
    family = action_spec.get("family", "player")
    expected_l0 = _FAMILY_L0_COL0.get(family, [])

    results = []

    # G7/G8/G9: content layer quality gates (layer index 2 = art/content layer).
    if len(xp["cells"]) >= 3:
        layer2 = xp["cells"][2]
        expected_cells = expected_dims[0] * expected_dims[1]
        glyphs = [cell[0] for cell in layer2]
        results.append(gate_g7_geometry(expected_cells, len(layer2)))
        results.append(gate_g8_nonempty(glyphs))
        results.append(gate_g9_handoff(len(layer2)))

    # G10: dimension match
    results.append(gate_g10_action_dims(
        xp["width"], xp["height"],
        expected_dims[0], expected_dims[1],
    ))

    # G11: layer count match
    results.append(gate_g11_layer_count(len(xp["cells"]), expected_layers))

    # G12: L0 row-0 metadata glyphs (first N cols of row 0)
    if xp["cells"] and expected_l0:
        l0 = xp["cells"][0]
        cols = xp["width"]
        actual_l0 = []
        for col_idx in range(min(len(expected_l0), cols)):
            cell = l0[col_idx]  # row-0, col col_idx
            actual_l0.append(chr(cell[0]) if cell[0] >= 32 else "")
        results.append(gate_g12_l0_metadata(actual_l0, expected_l0))
    elif expected_l0:
        results.append(gate_g12_l0_metadata([], expected_l0))

    return results


def validate_xp_single(
    xp_path: str,
    template_set_key: str,
    action_key: str,
    req_id: str,
) -> dict[str, Any]:
    """Run G7-G12 structural validation on a single XP against its template spec.

    This is the canonical validate-xp surface. It does not require a bundle
    or session context — callers provide the template identity directly.
    """
    reg = load_template_registry()
    ts = reg.get("template_sets", {}).get(template_set_key)
    if ts is None:
        raise ApiError(
            f"unknown template set '{template_set_key}'",
            "invalid_template_set", "workbench", req_id, 422,
        )
    action_spec = ts.get("actions", {}).get(action_key)
    if action_spec is None:
        raise ApiError(
            f"unknown action '{action_key}' in template set '{template_set_key}'",
            "invalid_action_key", "workbench", req_id, 422,
        )

    xp = read_xp(xp_path)
    gates = _run_structural_gates(xp_path, action_spec, req_id)
    gate_dicts = [{"gate": g.gate, "verdict": g.verdict, "details": g.details} for g in gates]

    blocked = [g for g in gates if g.verdict == THRESHOLD_BREACHED]
    overall = "PASS"
    if blocked:
        failed_gates = [g.gate for g in blocked]
        overall = f"FAIL: {', '.join(failed_gates)}"

    return {
        "xp_path": xp_path,
        "template_set_key": template_set_key,
        "action_key": action_key,
        "overall": overall,
        "gates": gate_dicts,
        "xp_dims": [xp["width"], xp["height"]],
        "layer_count": len(xp["cells"]),
    }


def workbench_export_bundle(bundle_id: str, req_id: str) -> dict[str, Any]:
    """Export all ready actions with saved sessions in a bundle."""
    bundle = load_bundle(bundle_id, req_id)
    reg = load_template_registry()
    ts = reg.get("template_sets", {}).get(bundle.template_set_key)
    if ts is None:
        raise ApiError("bundle references unknown template set", "invalid_template_set", "workbench", req_id, 422)

    exports: dict[str, dict[str, Any]] = {}
    gate_reports: dict[str, list[dict[str, Any]]] = {}
    for act_key, act_state in bundle.actions.items():
        if not act_state.session_id:
            continue
        sess_path = _session_path(act_state.session_id)
        if not sess_path.exists():
            raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)
        sess = load_json(sess_path)
        if not _template_metadata_compatible(sess):
            raise ApiError(
                f"action '{act_key}' requires template metadata repair/conversion before bundle export",
                "template_metadata_repair_required",
                "workbench",
                req_id,
                422,
            )
        action_spec = ts.get("actions", {}).get(act_key, {})
        family = action_spec.get("family", "player")
        authorized, auth_reason = is_action_authorized(
            action_spec,
            reg,
            template_set=ts,
            template_set_key=bundle.template_set_key,
            action_key=act_key,
        )
        if not authorized:
            _log.info("export_bundle: skipping action '%s' — %s", act_key, auth_reason)
            continue
        export = workbench_export_xp(act_state.session_id, req_id)

        # Run structural gates G7-G12 (fail-closed via runtime contract adapter)
        gates = _run_structural_gates(export["xp_path"], action_spec, req_id)
        gate_dicts = validate_runtime_export(
            gates,
            context=f"action '{act_key}'",
            req_id=req_id,
        )
        gate_reports[act_key] = gate_dicts

        exports[act_key] = {
            "session_id": act_state.session_id,
            "xp_path": export["xp_path"],
            "checksum": export["checksum"],
            "family": family,
            "runtime_identity": runtime_identity_for_action(bundle.template_set_key, act_key, action_spec),
            "gates": gate_dicts,
        }

    # Check required actions
    for act_key, action_spec in ts.get("actions", {}).items():
        if action_spec.get("required") and act_key not in exports:
            raise ApiError(
                f"required action '{act_key}' not ready",
                "bundle_incomplete", "workbench", req_id, 422,
            )

    return {
        "bundle_id": bundle_id,
        "exports": exports,
        "gate_reports": gate_reports,
    }


_BLANK_CELL: tuple[int, tuple[int, int, int], tuple[int, int, int]] = (0, (0, 0, 0), (255, 0, 255))


def _cell_to_tuple(cell: Any) -> tuple[int, tuple[int, int, int], tuple[int, int, int]]:
    """Coerce a (glyph, fg, bg) cell into the canonical tuple form."""
    if cell is None:
        return _BLANK_CELL
    glyph, fg, bg = cell
    fg_t = fg if isinstance(fg, tuple) else (int(fg[0]), int(fg[1]), int(fg[2]))
    bg_t = bg if isinstance(bg, tuple) else (int(bg[0]), int(bg[1]), int(bg[2]))
    return (int(glyph), fg_t, bg_t)


def _downsample_layer_visual(
    src_layer: list[Any],
    src_w: int,
    expected_w: int,
    expected_h: int,
    factor: int,
) -> list[tuple[int, tuple[int, int, int], tuple[int, int, int]]]:
    """Stride-N nearest-neighbour sampler for art/visual layers (L2/L3).
    Picks the top-left cell of each N×N source block.
    """
    out: list[tuple[int, tuple[int, int, int], tuple[int, int, int]]] = []
    for r in range(expected_h):
        sr = r * factor
        for c in range(expected_w):
            sc = c * factor
            out.append(_cell_to_tuple(src_layer[sr * src_w + sc]))
    return out


def _downsample_layer_metadata(
    src_layer: list[Any],
    src_w: int,
    expected_w: int,
    expected_h: int,
) -> list[tuple[int, tuple[int, int, int], tuple[int, int, int]]]:
    """Native-position slice for metadata layers (L0/L1). 2x and higher
    authored XPs encode L0 family codes ("818", "88", "85") and L1 anim-row
    countdowns at NATIVE column/row positions, not at scaled positions, with
    the remainder zero-padded. Copying cells at (col, row) for col<native_w
    and row<native_h preserves those metadata cells where G12/registry expect
    them. Stride-N sampling would skip them (col=1 → source col 2 = wrong).
    """
    out: list[tuple[int, tuple[int, int, int], tuple[int, int, int]]] = []
    for r in range(expected_h):
        for c in range(expected_w):
            out.append(_cell_to_tuple(src_layer[r * src_w + c]))
    return out


def _downsample_xp_to_native(
    xp_path_in: Path,
    expected_dims: tuple[int, int] | list[int],
    expected_layers: int,
    out_dir: Path,
    l1_marker_glyph: int = 0,
) -> Path:
    """If an authored XP is an integer-N multiple of the expected runtime dims,
    write a native-dim copy beside it and return the new path. Otherwise return
    the input path unchanged.

    Layer-aware behaviour:
      - L0, L1 (metadata): native-position slice (col, row directly). 2x XPs
        place family codes / anim-row markers at native positions with zero
        padding, so stride sampling would drop them.
      - L0 post-process: zero-glyph cells replaced with space (32) using the
        background colour from the first non-zero L0 cell (default yellow).
      - L1 post-process: if all cells are zero (2x source had no L1 metadata),
        fills with l1_marker_glyph on white background.
      - L2, L3 (art/visual): stride-N nearest-neighbour. Visual content scales
        with cell_w/cell_h.
      - Extra layers beyond `expected_layers` (e.g. 2x plydie ships 4 layers
        while the native death template wants 3) are dropped to match G11.
    """
    expected_w = int(expected_dims[0])
    expected_h = int(expected_dims[1])
    xp = read_xp(str(xp_path_in))
    src_w = int(xp["width"])
    src_h = int(xp["height"])
    src_layer_count = len(xp["cells"])
    target_layer_count = int(expected_layers) if expected_layers else src_layer_count

    if expected_w <= 0 or expected_h <= 0:
        return xp_path_in

    dim_match = src_w == expected_w and src_h == expected_h
    layer_match = src_layer_count == target_layer_count
    if dim_match and layer_match:
        return xp_path_in
    if not dim_match:
        if src_w % expected_w != 0 or src_h % expected_h != 0:
            return xp_path_in
        factor_x = src_w // expected_w
        factor_y = src_h // expected_h
        if factor_x != factor_y or factor_x < 2:
            return xp_path_in
        factor = factor_x
    else:
        factor = 1

    new_layers: list[list[tuple[int, tuple[int, int, int], tuple[int, int, int]]]] = []
    for layer_idx in range(target_layer_count):
        if layer_idx >= src_layer_count:
            new_layers.append([_BLANK_CELL] * (expected_w * expected_h))
            continue
        src_layer = xp["cells"][layer_idx]
        if factor == 1:
            new_layers.append([_cell_to_tuple(c) for c in src_layer])
            continue
        if layer_idx in (0, 1):
            new_layers.append(_downsample_layer_metadata(src_layer, src_w, expected_w, expected_h))
        else:
            new_layers.append(_downsample_layer_visual(src_layer, src_w, expected_w, expected_h, factor))

    # ── L0 post-process: fill zero-glyph cells with space (32) ──
    # The 2x source may only have the family-marker cells (e.g. "818") non-zero
    # in L0; all other cells are glyph=0. Working native XPs fill the rest with
    # space characters on a consistent background (typically yellow 255,255,85).
    if len(new_layers) > 0:
        l0 = new_layers[0]
        # Find first non-zero cell's background for the fill colour
        l0_bg = (255, 255, 85)  # default yellow
        for g, _fg, bg in l0:
            if g != 0:
                l0_bg = bg
                break
        for i, (g, fg, bg) in enumerate(l0):
            if g == 0:
                l0[i] = (32, (0, 0, 0), l0_bg)

    # ── L1 post-process: fill empty L1 with anim-row marker ──
    # 2x authored XPs often ship with L1 entirely zero. The engine requires L1
    # to be fully populated with the anim-row marker glyph. Working native XPs
    # use '9' (57) for player/attack and 'A' (65) for plydie/death.
    if len(new_layers) > 1 and l1_marker_glyph > 0:
        l1 = new_layers[1]
        if all(g == 0 for g, _fg, _bg in l1):
            for i in range(len(l1)):
                l1[i] = (l1_marker_glyph, (0, 0, 0), (255, 255, 255))

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{xp_path_in.stem}.native-{expected_w}x{expected_h}-L{target_layer_count}.xp"
    write_xp(out_path, expected_w, expected_h, new_layers)
    return out_path


def workbench_web_skin_bundle_payload(bundle_id: str, req_id: str) -> dict[str, Any]:
    """Build per-action XP bytes + target filenames for bundle WASM injection."""
    bundle = load_bundle(bundle_id, req_id)
    reg = load_template_registry()
    ts = reg.get("template_sets", {}).get(bundle.template_set_key)
    if ts is None:
        raise ApiError("bundle references unknown template set", "invalid_template_set", "workbench", req_id, 422)

    actions_payload: dict[str, dict[str, Any]] = {}
    unmapped_families: list[str] = []

    for act_key, action_spec in ts.get("actions", {}).items():
        family = action_spec.get("family", "")
        authorized, auth_reason = is_action_authorized(
            action_spec,
            reg,
            template_set=ts,
            template_set_key=bundle.template_set_key,
            action_key=act_key,
        )
        if not authorized:
            _log.info("web_skin_payload: skipping action '%s' — %s", act_key, auth_reason)
            unmapped_families.append(family)
            continue
        act_state = bundle.actions.get(act_key)
        if not act_state or not act_state.session_id:
            if not action_spec.get("required"):
                unmapped_families.append(family)
                continue
            raise ApiError(
                f"required action '{act_key}' not ready",
                "bundle_incomplete", "workbench", req_id, 422,
            )

        sess_path = _session_path(act_state.session_id)
        if not sess_path.exists():
            raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)
        sess = load_json(sess_path)
        if not _template_metadata_compatible(sess):
            raise ApiError(
                f"action '{act_key}' requires template metadata repair/conversion before runtime payload export",
                "template_metadata_repair_required",
                "workbench",
                req_id,
                422,
            )

        export = workbench_export_xp(act_state.session_id, req_id)
        xp_path = Path(export["xp_path"]).expanduser().resolve()

        # Structural gates G7-G12 (fail-closed via runtime contract adapter)
        # Derive L1 anim-row marker glyph from action family.
        # Working native XPs: player/attack use '9' (57), plydie/death use 'A' (65).
        _L1_MARKER_BY_FAMILY: dict[str, int] = {
            "player": 57,  # '9'
            "attack": 57,  # '9'
            "plydie": 65,  # 'A'
        }
        l1_marker = _L1_MARKER_BY_FAMILY.get(family, 57)

        # Authoring sessions may store geometry at an integer multiple (2x, 3x, ...)
        # of the runtime template dims and may carry extra layers. Downsample
        # to native here so the runtime receives canonical-size XP bytes and
        # structural gates accept. L0/L1 metadata stays at native positions;
        # L2/L3 art is stride-sampled; layer count is clamped to expected.
        xp_path = _downsample_xp_to_native(
            xp_path,
            action_spec.get("xp_dims", [0, 0]),
            int(action_spec.get("layers", 0)),
            EXPORT_DIR,
            l1_marker_glyph=l1_marker,
        )

        # Structural gates G7-G12
        gates = _run_structural_gates(str(xp_path), action_spec, req_id)
        validate_runtime_export(
            gates,
            context=f"action '{act_key}'",
            req_id=req_id,
        )

        raw = xp_path.read_bytes()
        ahsw_range = action_spec.get("ahsw_range", "all_16")
        override_names = _action_override_names(family, ahsw_range)

        actions_payload[act_key] = {
            "xp_b64": base64.b64encode(raw).decode("ascii"),
            "override_names": override_names,
            "xp_size_bytes": len(raw),
            "checksum": export["checksum"],
            "family": family,
            "runtime_identity": runtime_identity_for_action(bundle.template_set_key, act_key, action_spec),
        }

    return {
        "bundle_id": bundle_id,
        "actions": actions_payload,
        "unmapped_families": unmapped_families,
        "reload_player_name": "player",
    }


def _merge_box_drafts_into_manifest(manifest: dict[str, Any], raw_boxes: list[dict[str, Any]]) -> None:
    """Merge browser-sent boxes into manifest guides/regions.

    Boxes with labels matching known presentation_target_key values go
    into regions[]; unlabeled boxes go into guides.detected_boxes.
    """
    if not raw_boxes:
        return
    guides = manifest.setdefault("guides", {})
    detected = list(guides.get("detected_boxes", []))
    regions = list(manifest.get("regions", []))

    # Collect existing region IDs to avoid duplicate auto-assign
    existing_target_keys = {
        (r.get("target", {}).get("presentation_target_key", ""))
        for r in regions
        if isinstance(r, dict)
    }

    rid_counter = len(regions) + 1
    for box in raw_boxes:
        if not isinstance(box, dict):
            continue
        label = str(box.get("label", "")).strip()
        source_type = str(box.get("source", "")).strip()
        rect = [
            int(box.get("x", 0)),
            int(box.get("y", 0)),
            int(box.get("w", 0)),
            int(box.get("h", 0)),
        ]

        # Boxes from manifest regions already have source="manifest_region" — skip re-adding
        if source_type == "manifest_region":
            continue

        # Boxes with target assignments
        target = box.get("target")
        if isinstance(target, dict) and target.get("presentation_target_key"):
            ptk = target["presentation_target_key"]
            if ptk not in existing_target_keys:
                regions.append({
                    "id": f"r{rid_counter}",
                    "source_rect": rect,
                    "target": {
                        "entity_key": str(target.get("entity_key", "player_actor")),
                        "character_key": str(target.get("character_key", "human_player")),
                        "presentation_kind": str(target.get("presentation_kind", "")),
                        "layer_owner_kind": str(target.get("layer_owner_kind", "skin")),
                        "slot": str(target.get("slot", "body")),
                        "presentation_target_key": ptk,
                        "angle": int(target.get("angle", 0)),
                        "frame": int(target.get("frame", 0)),
                        "projection": int(target.get("projection", 0)),
                    },
                    "notes": "",
                    "tags": [],
                    "confidence": 1.0,
                })
                existing_target_keys.add(ptk)
                rid_counter += 1
                continue

        # Otherwise, add to detected boxes (guides only)
        if source_type != "guide_detected" and label:
            detected.append({
                "x": rect[0],
                "y": rect[1],
                "w": rect[2],
                "h": rect[3],
                "label": label,
            })

    if detected:
        guides["detected_boxes"] = detected
    manifest["regions"] = regions


def workbench_source_manifest_get(
    source_path: str | None = None,
    session_id: str | None = None,
    *,
    validate: bool = False,
    materialize: bool = False,
    req_id: str = "",
) -> dict[str, Any]:
    """Get manifest metadata and optional validation/materialization.

    Accepts either source_path or session_id (loads source_path from session).
    """
    sp: str | None = source_path
    if not sp and session_id:
        sess_p = _session_path(session_id)
        if sess_p.exists():
            sess = load_json(sess_p)
            sp = str(sess.get("source_path") or "").strip() or None

    if not sp:
        raise ApiError(
            "source_path or session_id with source_path is required",
            "missing_source_path", "workbench", req_id, 400,
        )

    mp = manifest_path_for_source(sp)
    exists = mp.exists()
    response: dict[str, Any] = {
        "source_path": sp,
        "manifest_path": str(mp),
        "exists": exists,
    }

    if not exists:
        return response

    manifest = load_manifest(sp)
    if manifest is None:
        return response

    response["version"] = manifest.get("version")
    response["bundle_blueprint_key"] = manifest.get("bundle_blueprint_key", "")
    response["layout_mode"] = manifest.get("layout_mode", "")
    response["region_count"] = len(manifest.get("regions", []))
    response["last_modified"] = datetime.fromtimestamp(
        mp.stat().st_mtime, tz=UTC
    ).isoformat() if exists else None

    if validate:
        val = validate_manifest(manifest, sp)
        response["validation"] = val

    if materialize:
        mirror = materialize_manifest(manifest)
        response["materialized"] = {
            "source_boxes": mirror["source_boxes"],
            "source_cuts_v": mirror["source_cuts_v"],
            "source_cuts_h": mirror["source_cuts_h"],
            "source_anchor_box": mirror["source_anchor_box"],
        }

    return response


def workbench_source_manifest_put(
    source_path: str,
    manifest: dict[str, Any],
    *,
    ack_stale_sha: bool = False,
    req_id: str = "",
) -> dict[str, Any]:
    """Write a full manifest to the sidecar.

    Validates before writing. Returns validation + materialized state.
    """
    if not source_path:
        raise ApiError(
            "source_path is required",
            "missing_source_path", "workbench", req_id, 400,
        )

    # Validate first
    val = validate_manifest(manifest, source_path, ack_stale_sha=ack_stale_sha)

    if val["status"] == "FAIL" and not ack_stale_sha:
        # Check if the only error is SHA mismatch (which can be acknowledged)
        sha_errors = [e for e in val["errors"] if "SHA256" in e]
        non_sha_errors = [e for e in val["errors"] if "SHA256" not in e]
        if sha_errors and not non_sha_errors and val["sha256"]["stored"] and val["sha256"]["current"]:
            raise ApiError(
                f"Source SHA256 mismatch. Use ack_stale_sha=true to overwrite, "
                f"or recreate the manifest. Stored: {val['sha256']['stored'][:16]}..., "
                f"Current: {val['sha256']['current'][:16]}...",
                "manifest_sha_mismatch", "workbench", req_id, 409,
            )
        if non_sha_errors:
            raise ApiError(
                f"Manifest validation FAILED: {'; '.join(non_sha_errors[:3])}"
                + (f" (+{len(non_sha_errors) - 3} more)" if len(non_sha_errors) > 3 else ""),
                "manifest_validation_failed", "workbench", req_id, 422,
            )

    # Write
    saved = save_manifest(source_path, manifest, ack_stale_sha=ack_stale_sha)

    # Materialize
    mirror = materialize_manifest(saved)

    return {
        "status": val["status"],
        "validation": val,
        "materialized": {
            "source_boxes": mirror["source_boxes"],
            "source_cuts_v": mirror["source_cuts_v"],
            "source_cuts_h": mirror["source_cuts_h"],
            "source_anchor_box": mirror["source_anchor_box"],
        },
    }


def workbench_save_session(session_id: str, payload: dict[str, Any], req_id: str) -> dict[str, Any]:
    p = _session_path(session_id)
    if not p.exists():
        raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)
    sess = load_json(p)
    next_anims = [int(x) for x in sess.get("anims", [1])]
    next_angles = int(sess.get("angles", 1))
    next_source_projs = int(sess.get("source_projs", sess.get("projs", 1)))
    next_projs = int(sess.get("projs", 1))
    next_cell_w = int(sess.get("cell_w", 1))
    next_cell_h = int(sess.get("cell_h", 1))

    if "anims" in payload:
        raw_anims = payload.get("anims")
        if not isinstance(raw_anims, list) or not raw_anims:
            raise ApiError("anims must be non-empty list", "invalid_anims", "workbench", req_id, 422)
        next_anims = [int(x) for x in raw_anims]
        if any(x < 1 for x in next_anims):
            raise ApiError("anims must be >=1", "invalid_anims", "workbench", req_id, 422)
    if "angles" in payload:
        next_angles = int(payload.get("angles"))
        if next_angles < 1:
            raise ApiError("angles must be >=1", "invalid_angles", "workbench", req_id, 422)
    if "source_projs" in payload:
        next_source_projs = int(payload.get("source_projs"))
    if "projs" in payload:
        next_projs = int(payload.get("projs"))
    next_source_projs, next_projs = _coerce_projection_geometry(
        angles=next_angles,
        source_projs=next_source_projs,
        projs=next_projs,
        req_id=req_id,
        stage="workbench",
    )
    if "cell_w" in payload:
        next_cell_w = int(payload.get("cell_w"))
    if "cell_h" in payload:
        next_cell_h = int(payload.get("cell_h"))
    derived_cols, derived_rows = _derive_session_grid_geometry(
        angles=next_angles,
        anims=next_anims,
        # The editable XP session is materialized at target projection count.
        # source_projs describes imported source imagery and must not shrink
        # the session geometry during save validation.
        projs=next_projs,
        cell_w=next_cell_w,
        cell_h=next_cell_h,
        req_id=req_id,
        stage="workbench",
    )
    next_cols = int(payload.get("grid_cols", sess["grid_cols"]))
    next_rows = int(payload.get("grid_rows", sess["grid_rows"]))
    if next_cols != derived_cols or next_rows != derived_rows:
        raise ApiError(
            f"session geometry mismatch: grid={next_cols}x{next_rows}, expected {derived_cols}x{derived_rows}",
            "session_geometry_invalid",
            "workbench",
            req_id,
            422,
        )
    expected_cells = next_cols * next_rows
    sess["grid_cols"] = next_cols
    sess["grid_rows"] = next_rows
    sess["cell_w"] = next_cell_w
    sess["cell_h"] = next_cell_h
    sess["angles"] = next_angles
    sess["anims"] = next_anims
    sess["source_projs"] = next_source_projs
    sess["projs"] = next_projs

    raw_cells = payload.get("cells")
    if raw_cells is not None:
        if not isinstance(raw_cells, list):
            raise ApiError("cells must be a list", "invalid_cells", "workbench", req_id, 422)
        if len(raw_cells) != expected_cells:
            raise ApiError("cells length mismatch", "session_geometry_invalid", "workbench", req_id, 422)
        coerced = []
        for idx, c in enumerate(raw_cells):
            if not isinstance(c, dict):
                raise ApiError(f"cell {idx} must be object", "invalid_cells", "workbench", req_id, 422)
            try:
                glyph = int(c.get("glyph", 0))
                fg = c.get("fg", [0, 0, 0])
                bg = c.get("bg", [0, 0, 0])
                if not (isinstance(fg, list) and len(fg) == 3 and isinstance(bg, list) and len(bg) == 3):
                    raise ValueError("fg/bg must be rgb triplets")
                fg = [max(0, min(255, int(v))) for v in fg]
                bg = [max(0, min(255, int(v))) for v in bg]
            except Exception as e:
                raise ApiError(f"invalid cell {idx}: {e}", "invalid_cells", "workbench", req_id, 422)
            coerced.append({"idx": idx, "glyph": glyph, "fg": fg, "bg": bg})
        sess["cells"] = coerced

    # Persist full layer set if provided (B3: layers are source of truth for
    # uploaded XP sessions; cells is backward-compat only).
    raw_layers = payload.get("layers")
    if raw_layers is not None:
        if not isinstance(raw_layers, list):
            raise ApiError("layers must be a list", "invalid_layers", "workbench", req_id, 422)
        coerced_layers: list[list[dict]] = []
        for li, layer in enumerate(raw_layers):
            if not isinstance(layer, list):
                raise ApiError(f"layer {li} must be a list", "invalid_layers", "workbench", req_id, 422)
            if len(layer) != expected_cells:
                raise ApiError(
                    f"layer {li} has {len(layer)} cells, expected {expected_cells}",
                    "invalid_layers", "workbench", req_id, 422,
                )
            coerced_layer: list[dict] = []
            for idx, c in enumerate(layer):
                if not isinstance(c, dict):
                    raise ApiError(f"layer {li} cell {idx} must be object", "invalid_layers", "workbench", req_id, 422)
                glyph = int(c.get("glyph", 0))
                fg = c.get("fg", [0, 0, 0])
                bg = c.get("bg", [0, 0, 0])
                if not (isinstance(fg, list) and len(fg) == 3 and isinstance(bg, list) and len(bg) == 3):
                    raise ApiError(f"layer {li} cell {idx}: fg/bg must be rgb triplets", "invalid_layers", "workbench", req_id, 422)
                fg = [max(0, min(255, int(v))) for v in fg]
                bg = [max(0, min(255, int(v))) for v in bg]
                coerced_layer.append({"idx": idx, "glyph": glyph, "fg": fg, "bg": bg})
            coerced_layers.append(coerced_layer)
        sess["layers"] = coerced_layers

    if "row_categories" in payload:
        row_categories = payload.get("row_categories")
        if not isinstance(row_categories, dict):
            raise ApiError("row_categories must be object", "invalid_row_categories", "workbench", req_id, 422)
        sess["row_categories"] = row_categories
    if "layer_names" in payload:
        layer_names = payload.get("layer_names")
        if not isinstance(layer_names, list):
            raise ApiError("layer_names must be list", "invalid_layer_names", "workbench", req_id, 422)
        sess["layer_names"] = [str(name) for name in layer_names]
    if "active_layer" in payload:
        sess["active_layer"] = int(payload.get("active_layer"))
    if "visible_layers" in payload:
        visible_layers = payload.get("visible_layers")
        if not isinstance(visible_layers, list):
            raise ApiError("visible_layers must be list", "invalid_visible_layers", "workbench", req_id, 422)
        sess["visible_layers"] = [int(value) for value in visible_layers]
    if "locked_layers" in payload:
        locked_layers = payload.get("locked_layers")
        if not isinstance(locked_layers, list):
            raise ApiError("locked_layers must be list", "invalid_locked_layers", "workbench", req_id, 422)
        sess["locked_layers"] = [int(value) for value in locked_layers]
    if "whole_sheet_canvas_zoom" in payload:
        sess["whole_sheet_canvas_zoom"] = float(payload.get("whole_sheet_canvas_zoom") or 0)
    if "whole_sheet_grid_visible" in payload:
        sess["whole_sheet_grid_visible"] = bool(payload.get("whole_sheet_grid_visible"))
    if "whole_sheet_grid_step" in payload:
        sess["whole_sheet_grid_step"] = str(payload.get("whole_sheet_grid_step") or "frame")
    if "whole_sheet_grid_custom_w" in payload:
        sess["whole_sheet_grid_custom_w"] = max(1, int(payload.get("whole_sheet_grid_custom_w") or 1))
    if "whole_sheet_grid_custom_h" in payload:
        sess["whole_sheet_grid_custom_h"] = max(1, int(payload.get("whole_sheet_grid_custom_h") or 1))
    if "frame_groups" in payload:
        frame_groups = payload.get("frame_groups")
        if not isinstance(frame_groups, list):
            raise ApiError("frame_groups must be list", "invalid_frame_groups", "workbench", req_id, 422)
        sess["frame_groups"] = frame_groups
    if "source_path" in payload:
        source_path = str(payload.get("source_path", "")).strip()
        sess["source_path"] = source_path if source_path else None

    # UQ-006: When source_path is set, source arrays are manifest-derived mirrors.
    # Browser sends them as draft mutations — flush to sidecar first, then re-derive.
    _source_path = str(sess.get("source_path") or "").strip()
    _has_source_payload = any(k in payload for k in (
        "source_boxes", "source_anchor_box", "source_draft_box",
        "source_cuts_v", "source_cuts_h",
    ))

    if _source_path and _has_source_payload:
        # Collect browser-sent source state
        raw_boxes = payload.get("source_boxes")
        raw_anchor = payload.get("source_anchor_box")
        raw_draft = payload.get("source_draft_box")
        raw_cuts_v = payload.get("source_cuts_v")
        raw_cuts_h = payload.get("source_cuts_h")

        # Try to load existing manifest
        existing = load_manifest(_source_path)
        if existing:
            # Merge draft mutations into manifest
            if isinstance(raw_boxes, list):
                _merge_box_drafts_into_manifest(existing, raw_boxes)
            if isinstance(raw_anchor, dict) or raw_anchor is None:
                existing.setdefault("guides", {})["anchor_rect"] = (
                    [raw_anchor["x"], raw_anchor["y"], raw_anchor["w"], raw_anchor["h"]]
                    if isinstance(raw_anchor, dict)
                    else None
                )
            if isinstance(raw_cuts_v, list):
                existing.setdefault("guides", {})["cuts_v"] = [
                    {"id": c.get("id", f"c{v}"), "x": int(c.get("x", 0))}
                    if isinstance(c, dict) else {"id": f"c{v}", "x": int(c)}
                    for v, c in enumerate(raw_cuts_v, 1)
                ]
            if isinstance(raw_cuts_h, list):
                existing.setdefault("guides", {})["cuts_h"] = [
                    {"id": c.get("id", f"c{v}"), "y": int(c.get("y", 0))}
                    if isinstance(c, dict) else {"id": f"c{v}", "y": int(c)}
                    for v, c in enumerate(raw_cuts_h, 1)
                ]
            save_manifest(_source_path, existing, ack_stale_sha=True)
        else:
            # Create migration manifest from browser-sent arrays
            temp_sess = dict(sess)
            if isinstance(raw_boxes, list):
                temp_sess["source_boxes"] = raw_boxes
            if isinstance(raw_cuts_v, list):
                temp_sess["source_cuts_v"] = raw_cuts_v
            if isinstance(raw_cuts_h, list):
                temp_sess["source_cuts_h"] = raw_cuts_h
            bp_key = str(sess.get("template_set_key") or "").strip()
            new_manifest = create_migration_manifest(
                temp_sess, _source_path, blueprint_key=bp_key
            )
            save_manifest(_source_path, new_manifest)

        # Re-derive mirror state from manifest
        updated = load_manifest(_source_path)
        if updated:
            mirror = materialize_manifest(updated)
            sess["source_boxes"] = mirror["source_boxes"]
            sess["source_anchor_box"] = mirror["source_anchor_box"]
            sess["source_draft_box"] = mirror["source_draft_box"]
            sess["source_cuts_v"] = mirror["source_cuts_v"]
            sess["source_cuts_h"] = mirror["source_cuts_h"]
    else:
        # No source_path: legacy save path (direct session persistence)
        if "source_boxes" in payload:
            source_boxes = payload.get("source_boxes")
            if not isinstance(source_boxes, list):
                raise ApiError("source_boxes must be list", "invalid_source_boxes", "workbench", req_id, 422)
            sess["source_boxes"] = source_boxes
        if "source_anchor_box" in payload:
            source_anchor_box = payload.get("source_anchor_box")
            if source_anchor_box is not None and not isinstance(source_anchor_box, dict):
                raise ApiError("source_anchor_box must be object|null", "invalid_source_anchor_box", "workbench", req_id, 422)
            sess["source_anchor_box"] = source_anchor_box
        if "source_draft_box" in payload:
            source_draft_box = payload.get("source_draft_box")
            if source_draft_box is not None and not isinstance(source_draft_box, dict):
                raise ApiError("source_draft_box must be object|null", "invalid_source_draft_box", "workbench", req_id, 422)
            sess["source_draft_box"] = source_draft_box
        if "source_cuts_v" in payload:
            source_cuts_v = payload.get("source_cuts_v")
            if not isinstance(source_cuts_v, list):
                raise ApiError("source_cuts_v must be list", "invalid_source_cuts_v", "workbench", req_id, 422)
            sess["source_cuts_v"] = source_cuts_v
        if "source_cuts_h" in payload:
            source_cuts_h = payload.get("source_cuts_h")
            if not isinstance(source_cuts_h, list):
                raise ApiError("source_cuts_h must be list", "invalid_source_cuts_h", "workbench", req_id, 422)
            sess["source_cuts_h"] = source_cuts_h
    if "mounted_rider_calibration" in payload:
        mrc = payload.get("mounted_rider_calibration")
        if mrc is not None and not isinstance(mrc, dict):
            raise ApiError("mounted_rider_calibration must be object|null", "invalid_mounted_rider_calibration", "workbench", req_id, 422)
        sess["mounted_rider_calibration"] = mrc
    if "mounted_semantic_review" in payload:
        msr = payload.get("mounted_semantic_review")
        if msr is not None and not isinstance(msr, dict):
            raise ApiError("mounted_semantic_review must be object|null", "invalid_mounted_semantic_review", "workbench", req_id, 422)
        sess["mounted_semantic_review"] = msr

    sess["session_kind"] = _session_kind(sess)
    sess["metadata_status"] = _metadata_status(sess)

    # Lazy normalization: enrich legacy sessions missing normalized identity fields.
    family_val, filename_prefix, skin_fam = _resolve_session_identity_fields(sess)
    sess["family"] = family_val
    sess["filename_prefix"] = filename_prefix
    sess["skin_family"] = skin_fam
    if not skin_fam:
        _log.warning(
            "session '%s': could not resolve skin_family for filename_prefix '%s' from registry",
            session_id,
            filename_prefix,
        )

    _save_session_json(p, sess)
    response = _session_payload(sess)
    response["cell_count"] = len(sess["cells"])
    response["source_boxes"] = len(sess.get("source_boxes", [])) if isinstance(sess.get("source_boxes"), list) else 0
    # Include manifest status when source_path is set
    _sp = str(sess.get("source_path") or "").strip()
    if _sp:
        response["source_manifest_path"] = str(manifest_path_for_source(_sp))
        existing = load_manifest(_sp)
        if existing:
            val = validate_manifest(existing, _sp)
            response["source_manifest_status"] = val["status"]
            response["source_manifest_warnings"] = val["warnings"]
            response["source_manifest_errors"] = val["errors"]
        else:
            response["source_manifest_status"] = "none"
    return response


def _resolve_mounted_xp_path(raw: str, field: str, req_id: str) -> Path:
    """Resolve a repo-relative XP path. Rejects .. traversal. Returns absolute Path."""
    if not raw:
        raise ApiError(f"{field} is required", f"missing_{field}", "workbench", req_id, 400)
    if ".." in Path(raw).parts:
        raise ApiError(f"{field} must not contain ..", f"invalid_{field}", "workbench", req_id, 400)
    candidate = (ROOT / raw).resolve()
    try:
        candidate.relative_to(ROOT)
    except ValueError:
        raise ApiError(f"{field} escapes repository root", f"invalid_{field}", "workbench", req_id, 400)
    if not candidate.is_file():
        raise ApiError(f"{field} not found: {raw}", f"{field}_not_found", "workbench", req_id, 404)
    return candidate


def compute_mounted_rider_calibration(
    player_xp: str,
    mounted_xp: str,
    req_id: str,
    *,
    anim_index: int = 0,
    frame_index: int = 0,
    proj: int = 0,
    layer: str | int = "auto",
    min_dx: int = -4,
    max_dx: int = 8,
    min_dy: int = -4,
    max_dy: int = 8,
) -> dict[str, Any]:
    """Expose mounted_rider_offset.build_report() via the service layer.

    Validates path safety and search bounds before dispatching to build_report.
    Returns the report dict unchanged — callers treat it as the calibration artifact.
    """
    if min_dx > max_dx:
        raise ApiError(
            f"min_dx ({min_dx}) must be <= max_dx ({max_dx})",
            "invalid_bounds",
            "workbench",
            req_id,
            422,
        )
    if min_dy > max_dy:
        raise ApiError(
            f"min_dy ({min_dy}) must be <= max_dy ({max_dy})",
            "invalid_bounds",
            "workbench",
            req_id,
            422,
        )

    player_path = _resolve_mounted_xp_path(player_xp, "player_xp", req_id)
    mounted_path = _resolve_mounted_xp_path(mounted_xp, "mounted_xp", req_id)

    try:
        from mounted_rider_offset import build_report  # type: ignore[import]
    except ImportError as e:
        raise ApiError(f"mounted_rider_offset script unavailable: {e}", "script_unavailable", "workbench", req_id, 500)

    try:
        report = build_report(
            player_path,
            mounted_path,
            anim_index=anim_index,
            frame_index=frame_index,
            proj=proj,
            layer=layer,
            min_dx=min_dx,
            max_dx=max_dx,
            min_dy=min_dy,
            max_dy=max_dy,
        )
    except (ValueError, AssertionError) as e:
        raise ApiError(str(e), "calibration_error", "workbench", req_id, 400)

    # build_report() stores absolute paths; convert to repo-relative for portability.
    for key in ("player", "mounted"):
        if key in report:
            try:
                report[key] = str(Path(report[key]).relative_to(ROOT))
            except ValueError:
                pass
    return report


def compute_mounted_semantic_proposals(session_id: str, req_id: str) -> dict[str, Any]:
    """Derive per-angle cell proposals from a session's confirmed calibration record.

    Uses each angle's own dx/dy from the calibration record (not the single display
    accepted_dx/accepted_dy). Categories: rider_only, mount_only, overlap.
    """
    p = _session_path(session_id)
    if not p.exists():
        raise ApiError("session not found", "session_not_found", "workbench", req_id, 404)
    sess = load_json(p)

    calibration = sess.get("mounted_rider_calibration")
    if not calibration or not isinstance(calibration, dict):
        raise ApiError(
            "no confirmed calibration record in session",
            "calibration_absent",
            "workbench",
            req_id,
            422,
        )

    # build_report() stores paths under "player"/"mounted"; accept both key variants
    player_xp_str = str(calibration.get("player") or calibration.get("player_xp", "")).strip()
    mounted_xp_str = str(calibration.get("mounted") or calibration.get("mounted_xp", "")).strip()
    per_angle_offsets = calibration.get("per_angle") or []
    if not isinstance(per_angle_offsets, list) or len(per_angle_offsets) == 0:
        raise ApiError(
            "calibration record has no per_angle entries",
            "calibration_invalid",
            "workbench",
            req_id,
            422,
        )

    player_path = _resolve_mounted_xp_path(player_xp_str, "player_xp", req_id)
    mounted_path = _resolve_mounted_xp_path(mounted_xp_str, "mounted_xp", req_id)

    try:
        from mounted_rider_offset import (  # type: ignore[import]
            parse_layout,
            frame_cells,
            auto_layer,
        )
    except ImportError as e:
        raise ApiError(f"mounted_rider_offset script unavailable: {e}", "script_unavailable", "workbench", req_id, 500)

    try:
        player_xp = read_xp(player_path)
        mounted_xp = read_xp(mounted_path)
    except (OSError, ValueError) as e:
        raise ApiError(f"could not read XP file: {e}", "xp_read_error", "workbench", req_id, 422)
    player_layout = parse_layout(player_xp)
    mounted_layout = parse_layout(mounted_xp)

    anim_index = int(calibration.get("anim_index", 0))
    frame_index = int(calibration.get("frame_index", 0))
    proj = int(calibration.get("proj", 0))
    layer_index = int(calibration.get("layer_used", auto_layer(player_xp, mounted_xp)))

    per_angle_results: list[dict[str, Any]] = []
    for i, angle_offset in enumerate(per_angle_offsets):
        angle = int(angle_offset.get("angle", i))
        dx = int(angle_offset.get("dx", 0))
        dy = int(angle_offset.get("dy", 0))

        try:
            player_cells = frame_cells(
                player_xp, player_layout,
                angle=angle, anim_index=anim_index, frame_index=frame_index,
                proj=proj, layer_index=min(layer_index, int(player_xp["layers"]) - 1),
            )
            mounted_cells = frame_cells(
                mounted_xp, mounted_layout,
                angle=angle, anim_index=anim_index, frame_index=frame_index,
                proj=proj, layer_index=min(layer_index, int(mounted_xp["layers"]) - 1),
            )
        except (IndexError, KeyError) as e:
            raise ApiError(
                f"angle {angle}: could not read cells: {e}",
                "cell_read_error",
                "workbench",
                req_id,
                422,
            )

        shifted_player: dict[tuple[int, int], tuple[int, Any, Any]] = {
            (x + dx, y + dy): (glyph, fg, bg)
            for x, y, glyph, fg, bg in player_cells
        }
        mounted_map: dict[tuple[int, int], tuple[int, Any, Any]] = {
            (x, y): (glyph, fg, bg)
            for x, y, glyph, fg, bg in mounted_cells
        }

        cells: list[dict[str, Any]] = []
        for pos in sorted(set(shifted_player) | set(mounted_map)):
            px, py = pos
            in_player = pos in shifted_player
            in_mounted = pos in mounted_map
            if in_player and in_mounted:
                category = "overlap"
                glyph, fg, bg = shifted_player[pos]
            elif in_player:
                category = "rider_only"
                glyph, fg, bg = shifted_player[pos]
            else:
                category = "mount_only"
                glyph, fg, bg = mounted_map[pos]
            cells.append({
                "x": px, "y": py,
                "category": category,
                "glyph": int(glyph),
                "fg": list(fg),
                "bg": list(bg),
            })

        counts = {cat: sum(1 for c in cells if c["category"] == cat)
                  for cat in ("rider_only", "mount_only", "overlap", "unresolved")}
        per_angle_results.append({
            "angle": angle,
            "dx": dx,
            "dy": dy,
            "counts": counts,
            "cells": cells,
        })

    return {
        "session_id": session_id,
        "player": player_xp_str,
        "mounted": mounted_xp_str,
        "calibration_ref_confirmed_at": calibration.get("confirmed_at"),
        "layer_used": layer_index,
        "per_angle": per_angle_results,
    }


def workbench_create_actor_visual_profile(
    session_id: str,
    domain: str,
    presentation_kind: str,
    variation: str,
    req_id: str,
    rig_definition_id: str | None = None,
) -> dict[str, Any]:
    """Create ActorVisualProfile from current session (Phase 2, Task 2).
    
    This function:
    1. Loads the session's XP data
    2. Extracts layer assignments from the session geometry
    3. Creates an ActorVisualProfile with the specified (domain, presentation_kind, variation)
    4. Saves the profile to config/actor_visual_profiles/
    5. Returns the profile path and ID
    """
    from .actor_visual_profile import (
        ActorVisualProfile,
        LayerAssignment,
        Region,
        Domain,
        PresentationKind,
    )
    from .config import ROOT
    
    # Validate domain
    valid_domains = ["skin", "wearable", "weapon", "shield", "mount"]
    if domain not in valid_domains:
        raise ApiError(f"Invalid domain: {domain}. Must be one of: {valid_domains}", "invalid_domain", "workbench", req_id, 400)
    
    # Validate presentation_kind
    valid_kinds = ["idle_walk", "attack", "plydie"]
    if presentation_kind not in valid_kinds:
        raise ApiError(f"Invalid presentation_kind: {presentation_kind}. Must be one of: {valid_kinds}", "invalid_presentation_kind", "workbench", req_id, 400)
    
    # Load session
    session_path = EXPORT_DIR / session_id / "session.json"
    if not session_path.exists():
        raise ApiError(f"Session not found: {session_id}", "session_not_found", "workbench", req_id, 404)
    
    try:
        session_data = json.loads(session_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise ApiError(f"Failed to load session: {e}", "session_load_error", "workbench", req_id, 500)
    
    # Extract session metadata
    grid_cols = int(session_data.get("grid_cols", 8))
    grid_rows = int(session_data.get("grid_rows", 8))
    angles = int(session_data.get("angles", 8))
    anims = session_data.get("anims", "9")
    source_projs = int(session_data.get("source_projs", 1))
    cell_w = int(session_data.get("cell_w", 7))
    cell_h = int(session_data.get("cell_h", 10))
    
    # Generate profile_id from session and key dimensions
    profile_id = f"{session_id}_{domain}_{presentation_kind}_{variation}"
    
    # Determine skin_definition_id (use session_id hash or default)
    skin_definition_id = abs(hash(session_id)) % 1000 + 100  # Range 100-1099
    
    # Create layer assignment from session XP
    xp_filename = f"{session_id}.xp"
    xp_path = EXPORT_DIR / session_id / xp_filename
    
    if not xp_path.exists():
        raise ApiError(f"XP file not found for session: {xp_path}", "xp_not_found", "workbench", req_id, 404)
    
    # Determine slot based on domain
    slot_map = {
        "skin": "body",
        "wearable": "chest",
        "weapon": "weapon",
        "shield": "shield",
        "mount": "mount_rear",
    }
    slot = slot_map.get(domain, "body")
    
    # Create layer assignment
    layer = LayerAssignment(
        slot=slot,  # type: ignore
        layer_definition_id=700,  # Default layer def ID
        xp_ref=f"assets/sprites/{xp_filename}",
        visual_style_id=1,  # Default visual style
        region=Region(x=0, y=0, w=grid_cols, h=grid_rows),
    )
    
    # Create ActorVisualProfile
    profile = ActorVisualProfile(
        profile_id=profile_id,
        skin_definition_id=skin_definition_id,
        presentation_kind=presentation_kind,  # type: ignore
        domain=domain,  # type: ignore
        layers=[layer],
        variation=variation if variation != "default" else None,
        rig_definition_id=rig_definition_id or None,
    )
    
    # Save profile
    profile_dir = ROOT / "config" / "actor_visual_profiles"
    profile_path = profile_dir / f"{profile_id}.json"
    
    try:
        profile.to_file(profile_path)
    except OSError as e:
        raise ApiError(f"Failed to save profile: {e}", "profile_save_error", "workbench", req_id, 500)
    
    return {
        "profile_id": profile_id,
        "profile_path": str(profile_path.relative_to(ROOT)),
        "domain": domain,
        "presentation_kind": presentation_kind,
        "variation": variation,
        "skin_definition_id": skin_definition_id,
        "rig_definition_id": rig_definition_id,
        "layers_count": len(profile.layers),
        "session_id": session_id,
    }


def workbench_export_actor_visual_profile(
    session_id: str,
    domain: str,
    presentation_kind: str,
    variation: str,
    req_id: str,
) -> dict[str, Any]:
    """Export ActorVisualProfile as authoring artifact (Phase 2, Task 3).
    
    This function:
    1. Creates or loads an ActorVisualProfile
    2. Adds source refs (XP/PNG paths)
    3. Adds quality gate results (if available)
    4. Adds calibration artifacts (for mounted)
    5. Returns structured artifact JSON for download
    """
    from .actor_visual_profile import (
        ActorVisualProfile,
        LayerAssignment,
        Region,
        SourceRefs,
        QualityGates,
    )
    from .config import ROOT
    
    # First, create the profile (or load if exists)
    base_result = workbench_create_actor_visual_profile(
        session_id=session_id,
        domain=domain,
        presentation_kind=presentation_kind,
        variation=variation,
        req_id=req_id,
    )
    
    # Load session for additional metadata
    session_path = EXPORT_DIR / session_id / "session.json"
    session_data = json.loads(session_path.read_text(encoding="utf-8"))
    
    # Build source refs
    xp_path = EXPORT_DIR / session_id / f"{session_id}.xp"
    png_path = EXPORT_DIR / session_id / f"{session_id}_source.png"  # If exists
    
    source_refs = SourceRefs(
        xp_file=str(xp_path.relative_to(ROOT)) if xp_path.exists() else None,
        png_file=str(png_path.relative_to(ROOT)) if png_path.exists() else None,
        semantic_map=None,  # Would be populated if semantic map review was done
        calibration_artifact=None,  # Would be populated for mounted domain
    )
    
    # Build quality gates (placeholder - would be populated from verification runs)
    quality_gates = QualityGates(
        G7_cell_density=None,
        G8_glyph_coverage=None,
        G9_semantic_completeness=None,
        mounted_alignment=None,
        timestamp=datetime.now(UTC).isoformat(),
    )
    
    # Load the profile and enhance it
    profile_dir = ROOT / "config" / "actor_visual_profiles"
    profile_path = profile_dir / f"{base_result['profile_id']}.json"
    profile = ActorVisualProfile.from_file(profile_path)
    profile.source_refs = source_refs
    profile.quality_gates = quality_gates
    profile.metadata = {
        "exported_at": datetime.now(UTC).isoformat(),
        "exported_by": "workbench_export_actor_visual_profile",
        "session_geometry": {
            "grid_cols": session_data.get("grid_cols"),
            "grid_rows": session_data.get("grid_rows"),
            "angles": session_data.get("angles"),
            "anims": session_data.get("anims"),
            "cell_w": session_data.get("cell_w"),
            "cell_h": session_data.get("cell_h"),
        },
    }
    
    # Save enhanced profile
    profile.to_file(profile_path)
    
    return {
        "profile_id": base_result["profile_id"],
        "profile_path": str(profile_path.relative_to(ROOT)),
        "artifact": profile.to_dict(),
        "download_ready": True,
    }
