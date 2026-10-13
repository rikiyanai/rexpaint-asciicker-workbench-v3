from __future__ import annotations

import time
import uuid
import json
from datetime import UTC, datetime
from pathlib import Path

from flask import Blueprint, Flask, Response, jsonify, redirect, request, send_from_directory, send_file

from .config import (
    ensure_dirs, ROOT, EXPORT_DIR, BASE_PATH, BUG_REPORTS_DIR,
    BUG_REPORT_DELIVERY, BUG_REPORT_GITHUB_REPO, BUG_REPORT_GITHUB_TOKEN,
)
from .models import ApiError, RunConfig, parse_frames_csv


def _as_bool(v: object, default: bool = True) -> bool:
    """Parse a JSON/query-string value as boolean. 'false'/0/None → False."""
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.lower() not in ("false", "0", "no", "")
    return bool(v)
from .service import (
    upload_image,
    analyze_image,
    run_pipeline,
    status,
    workbench_load_from_job,
    workbench_load_session,
    workbench_create_blank_session,
    workbench_save_session,
    workbench_export_xp,
    workbench_upload_xp,
    workbench_xp_tool_command,
    workbench_open_in_xp_tool,
    workbench_run_verification,
    workbench_termpp_skin_command,
    workbench_open_termpp_skin,
    workbench_termpp_stream_start,
    workbench_termpp_stream_stop,
    workbench_termpp_stream_status,
    workbench_termpp_stream_frame_path,
    workbench_web_skin_payload,
    load_template_registry,
    get_registry_status,
    workbench_list_sessions,
    workbench_rename_session,
    workbench_duplicate_session,
    workbench_delete_session,
    create_bundle,
    load_bundle,
    _is_bundle_session,
    bundle_action_run,
    workbench_update_bundle_action_status,
    workbench_export_bundle,
    workbench_web_skin_bundle_payload,
    validate_xp_single,
    compute_mounted_rider_calibration,
    compute_mounted_semantic_proposals,
    workbench_source_manifest_get,
    workbench_source_manifest_put,
    workbench_create_actor_visual_profile,
    workbench_export_actor_visual_profile,
)


WEB_DIR = ROOT / "web"
STATIC_WEB_ROOT = (ROOT / "runtime" / "termpp-skin-lab-static").resolve()
STATIC_WEB_DIR = (STATIC_WEB_ROOT / "termpp-web").resolve()
STATIC_FLAT_WEB_DIR = (STATIC_WEB_ROOT / "termpp-web-flat").resolve()
SERVER_BOOT_NONCE = str(int(time.time() * 1000))


def _err(e: ApiError):
    return jsonify(e.to_dict()), e.status


def _no_cache(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, max-age=0, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


def _v(path: str) -> str:
    s = str(path)
    sep = "&" if "?" in s else "?"
    return f"{s}{sep}v={SERVER_BOOT_NONCE}"


def _serve_web_html(file_name: str):
    p = (WEB_DIR / file_name).resolve()
    html = p.read_text(encoding="utf-8")
    # Prefix root-relative asset paths with BASE_PATH
    html = html.replace('href="/styles.css"', f'href="{_v(BASE_PATH + "/styles.css")}"')
    html = html.replace('href="/rexpaint-editor/styles.css"', f'href="{_v(BASE_PATH + "/rexpaint-editor/styles.css")}"')
    html = html.replace('src="/workbench-template-gating.js"', f'src="{_v(BASE_PATH + "/workbench-template-gating.js")}"')
    html = html.replace('src="/workbench.js"', f'src="{_v(BASE_PATH + "/workbench.js")}"')
    html = html.replace('src="/wizard.js"', f'src="{_v(BASE_PATH + "/wizard.js")}"')
    html = html.replace('src="/whole-sheet-init.js"', f'src="{_v(BASE_PATH + "/whole-sheet-init.js")}"')
    # Relative path — no base-path prefix needed
    html = html.replace('src="./termpp_skin_lab.js"', f'src="{_v("./termpp_skin_lab.js")}"')
    # Prefix in-page navigation links
    html = html.replace('href="/workbench"', f'href="{BASE_PATH}/workbench"')
    # Inject base path and boot nonce into <head>
    injected = (
        f'<script>window.__WB_BASE_PATH = "{BASE_PATH}";</script>\n'
        f'  <script>window.__WB_SERVER_BOOT_NONCE = "{SERVER_BOOT_NONCE}";</script>'
    )
    if "</head>" in html:
        html = html.replace("</head>", f"  {injected}\n</head>", 1)
    return _no_cache(Response(html, mimetype="text/html"))


def _runtime_unavailable_response(runtime_dir: Path):
    return jsonify({
        "error": f"runtime bundle not found: {runtime_dir}",
        "code": "runtime_bundle_missing",
    }), 503


def _serve_runtime_asset(runtime_dir: Path, file_name: str, *, no_cache: bool = False):
    if not runtime_dir.exists():
        return _runtime_unavailable_response(runtime_dir)
    resp = send_from_directory(runtime_dir, file_name)
    if no_cache:
        return _no_cache(resp)
    return resp


def _runtime_preflight_payload() -> dict:
    runtime_root = STATIC_WEB_ROOT.resolve()
    required_files = [
        "termpp-web-flat/index.html",
        "termpp-web-flat/index.js",
        "termpp-web-flat/index.wasm",
        "termpp-web-flat/index.data",
        "termpp-web-flat/flat_map_bootstrap.js",
    ]
    required_map_any_of = [
        "termpp-web-flat/flatmaps/minimal_2x2.a3d",
        "termpp-web-flat/flatmaps/game_map_y8_original_game_map.a3d",
    ]
    missing_files: list[str] = []
    invalid_files: list[dict[str, str]] = []
    maps_found: list[str] = []

    for rel in required_files:
        p = (runtime_root / rel).resolve()
        if not p.exists():
            missing_files.append(rel)
            continue
        if not p.is_file():
            invalid_files.append({"path": rel, "reason": "not_a_file"})
            continue
        try:
            if p.stat().st_size <= 0:
                invalid_files.append({"path": rel, "reason": "empty_file"})
        except OSError:
            invalid_files.append({"path": rel, "reason": "stat_failed"})

    for rel in required_map_any_of:
        p = (runtime_root / rel).resolve()
        if not p.exists():
            continue
        if not p.is_file():
            invalid_files.append({"path": rel, "reason": "not_a_file"})
            continue
        try:
            if p.stat().st_size <= 0:
                invalid_files.append({"path": rel, "reason": "empty_file"})
                continue
        except OSError:
            invalid_files.append({"path": rel, "reason": "stat_failed"})
            continue
        maps_found.append(rel)

    if not maps_found:
        for rel in required_map_any_of:
            p = (runtime_root / rel).resolve()
            if not p.exists():
                missing_files.append(rel)

    missing_files = sorted(set(missing_files))
    invalid_files = sorted(invalid_files, key=lambda x: (x.get("path", ""), x.get("reason", "")))
    maps_found = sorted(set(maps_found))
    ok = (not missing_files) and (not invalid_files) and bool(maps_found)

    return {
        "ok": ok,
        "runtime_root": str(runtime_root),
        "required_files": required_files,
        "required_map_any_of": required_map_any_of,
        "maps_found": maps_found,
        "missing_files": missing_files,
        "invalid_files": invalid_files,
        "checked_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }


KNOWN_BUGS: list[dict] = [
    {"id": "PB-01", "title": "Anchor set not undoable (context menu)", "severity": "high", "category": "whole_sheet_editor"},
    {"id": "PB-03", "title": "File upload clears anchor without undo", "severity": "medium", "category": "png_import_slicing"},
    {"id": "PB-07", "title": "TextTool on disk but not wired", "severity": "medium", "category": "whole_sheet_editor"},
    {"id": "PB-14", "title": "G7/G8/G9 gates exist but not called in export", "severity": "medium", "category": "bundle_workflow"},
    {"id": "VB-03", "title": "Debug _state() leaks full mutable state", "severity": "medium", "category": "other"},
]


def _deliver_github_issue(payload: dict, report_id: str) -> dict | None:
    """Create a GitHub issue from a bug report. Returns issue URL or None on failure."""
    if not BUG_REPORT_GITHUB_REPO or not BUG_REPORT_GITHUB_TOKEN:
        return None
    import urllib.request
    import urllib.error

    category = payload.get("category", "other")
    severity = payload.get("severity", "major")
    description = payload.get("description", "")
    known_bug_id = payload.get("known_bug_id", "")

    title_prefix = f"[{known_bug_id}] " if known_bug_id else ""
    title = f"{title_prefix}[{severity}] {category}: {description[:80]}"
    if len(description) > 80:
        title = title.rstrip() + "..."

    metadata = payload.get("metadata", {})
    meta_lines = []
    if metadata.get("url"):
        meta_lines.append(f"- **URL:** {metadata['url']}")
    if metadata.get("sessionId"):
        meta_lines.append(f"- **Session:** {metadata['sessionId']}")
    if metadata.get("bundleId"):
        meta_lines.append(f"- **Bundle:** {metadata['bundleId']}")
    if metadata.get("userAgent"):
        meta_lines.append(f"- **UA:** {metadata['userAgent']}")

    body_parts = [
        f"## Bug Report `{report_id}`",
        f"**Category:** {category}  ",
        f"**Severity:** {severity}  ",
    ]
    if known_bug_id:
        body_parts.append(f"**Known Issue:** {known_bug_id}  ")
    body_parts.append(f"\n### Description\n\n{description}")
    if meta_lines:
        body_parts.append("\n### Metadata\n\n" + "\n".join(meta_lines))
    body_parts.append("\n---\n*Filed automatically by Pipeline V2 Workbench*")

    labels = ["bug", f"severity:{severity}"]

    issue_data = json.dumps({"title": title, "body": "\n".join(body_parts), "labels": labels}).encode()
    url = f"https://api.github.com/repos/{BUG_REPORT_GITHUB_REPO}/issues"
    req = urllib.request.Request(
        url,
        data=issue_data,
        method="POST",
        headers={
            "Authorization": f"Bearer {BUG_REPORT_GITHUB_TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode())
            return {
                "issue_url": result.get("html_url", ""),
                "issue_number": result.get("number", 0),
            }
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, json.JSONDecodeError):
        return None


def _save_bug_report(payload: dict, req_id: str) -> dict:
    ts = datetime.now(UTC)
    report_id = f"bug-{ts.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    report_dir = BUG_REPORTS_DIR / report_id
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "report.json"
    doc = {
        "report_id": report_id,
        "request_id": req_id,
        "created_at": ts.isoformat().replace("+00:00", "Z"),
        "server_boot_nonce": SERVER_BOOT_NONCE,
        "payload": payload,
    }
    report_path.write_text(json.dumps(doc, indent=2, sort_keys=True), encoding="utf-8")
    result: dict = {
        "ok": True,
        "report_id": report_id,
        "report_path": str(report_path.resolve()),
        "delivery": "local",
        "github_issue": None,
    }

    delivery = str(payload.get("delivery_method", "")).strip().lower() or BUG_REPORT_DELIVERY
    if delivery in ("github", "both"):
        gh = _deliver_github_issue(payload, report_id)
        if gh:
            result["github_issue"] = gh
            result["delivery"] = "both" if delivery == "both" else "github"
        else:
            result["github_issue_error"] = "GitHub delivery failed or not configured"

    return result


def create_app() -> Flask:
    ensure_dirs()
    app = Flask(__name__)
    bp = Blueprint("main", __name__)

    @bp.route("/healthz")
    def healthz():
        return "ok", 200

    @bp.route("/")
    def index_page():
        return redirect(f"{BASE_PATH}/workbench", code=302)

    # Legacy/deprecated UI preserved temporarily for fallback/manual comparison.
    @bp.route("/wizard")
    def wizard_page():
        return _serve_web_html("wizard.html")

    @bp.route("/workbench")
    def workbench_page():
        return _serve_web_html("workbench.html")

    @bp.route("/termpp-skin-lab")
    def termpp_skin_lab_page():
        return _serve_web_html("termpp_skin_lab.html")

    @bp.route("/<path:filename>")
    def web_assets(filename: str):
        return _no_cache(send_from_directory(WEB_DIR, filename))

    @bp.route("/termpp-web")
    def termpp_web_index_alias():
        return _serve_runtime_asset(STATIC_WEB_DIR, "index.html", no_cache=True)

    @bp.route("/termpp-web/<path:filename>")
    def termpp_web_assets(filename: str):
        return _serve_runtime_asset(STATIC_WEB_DIR, filename, no_cache=True)

    @bp.route("/termpp-web-flat")
    def termpp_web_flat_index_alias():
        return _serve_runtime_asset(STATIC_FLAT_WEB_DIR, "index.html", no_cache=True)

    @bp.route("/termpp-web-flat/<path:filename>")
    def termpp_web_flat_assets(filename: str):
        return _serve_runtime_asset(STATIC_FLAT_WEB_DIR, filename, no_cache=True)

    @bp.get("/api/workbench/runtime-preflight")
    def api_wb_runtime_preflight():
        return jsonify(_runtime_preflight_payload()), 200

    @bp.get("/api/workbench/known-bugs")
    def api_wb_known_bugs():
        delivery_configured = BUG_REPORT_DELIVERY in ("github", "both") and bool(BUG_REPORT_GITHUB_REPO) and bool(BUG_REPORT_GITHUB_TOKEN)
        return jsonify({
            "bugs": KNOWN_BUGS,
            "delivery_methods": {
                "local": True,
                "github": delivery_configured,
            },
            "default_delivery": BUG_REPORT_DELIVERY if delivery_configured else "local",
        }), 200

    @bp.post("/api/workbench/report-bug")
    def api_wb_report_bug():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            category = str(payload.get("category", "")).strip()
            severity = str(payload.get("severity", "")).strip()
            description = str(payload.get("description", "")).strip()
            if not category:
                raise ApiError("category is required", "missing_category", "workbench", req_id, 400)
            if not severity:
                raise ApiError("severity is required", "missing_severity", "workbench", req_id, 400)
            if not description:
                raise ApiError("description is required", "missing_description", "workbench", req_id, 400)
            return jsonify(_save_bug_report(payload, req_id)), 201
        except ApiError as e:
            return _err(e)

    @bp.get("/api/workbench/templates")
    def api_wb_templates():
        registry = load_template_registry()
        registry_status = get_registry_status()
        # Return 503 when the registry file is missing or malformed.
        # The empty-registry fallback dict is still returned so browser
        # callers can safely render (nothing is authorable with empty
        # template_sets) but the HTTP status signals a degraded state.
        if registry_status.get("load_error"):
            result = dict(registry)
            result["registry_status"] = registry_status
            return jsonify(result), 503
        result = dict(registry)
        result["registry_status"] = registry_status
        return jsonify(result), 200

    @bp.post("/api/workbench/bundle/create")
    def api_wb_bundle_create():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            template_set_key = str(payload.get("template_set_key", "")).strip()
            if not template_set_key:
                raise ApiError("template_set_key is required", "missing_template_set_key", "workbench", req_id, 400)
            return jsonify(create_bundle(template_set_key, req_id)), 201
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/action-grid/apply")
    def api_wb_action_grid_apply():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            bundle_id = str(payload.get("bundle_id", "")).strip()
            action_key = str(payload.get("action_key", "")).strip()
            source_path = str(payload.get("source_path", "")).strip()
            if not bundle_id:
                raise ApiError("bundle_id is required", "missing_bundle_id", "workbench", req_id, 400)
            if not action_key:
                raise ApiError("action_key is required", "missing_action_key", "workbench", req_id, 400)
            if not source_path:
                raise ApiError("source_path is required", "missing_source_path", "workbench", req_id, 400)
            return jsonify(bundle_action_run(bundle_id, action_key, source_path, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/bundle/action-status")
    def api_wb_bundle_action_status():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            bundle_id = str(payload.get("bundle_id", "")).strip()
            action_key = str(payload.get("action_key", "")).strip()
            status_value = str(payload.get("status", "")).strip()
            if not bundle_id:
                raise ApiError("bundle_id is required", "missing_bundle_id", "workbench", req_id, 400)
            if not action_key:
                raise ApiError("action_key is required", "missing_action_key", "workbench", req_id, 400)
            if not status_value:
                raise ApiError("status is required", "missing_status", "workbench", req_id, 400)
            return jsonify(workbench_update_bundle_action_status(bundle_id, action_key, status_value, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/export-bundle")
    def api_wb_export_bundle():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            bundle_id = str(payload.get("bundle_id", "")).strip()
            if not bundle_id:
                raise ApiError("bundle_id is required", "missing_bundle_id", "workbench", req_id, 400)
            return jsonify(workbench_export_bundle(bundle_id, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/web-skin-bundle-payload")
    def api_wb_web_skin_bundle_payload():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            bundle_id = str(payload.get("bundle_id", "")).strip()
            if not bundle_id:
                raise ApiError("bundle_id is required", "missing_bundle_id", "workbench", req_id, 400)
            return jsonify(workbench_web_skin_bundle_payload(bundle_id, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/upload")
    def api_upload():
        req_id = str(uuid.uuid4())
        try:
            file = request.files.get("file")
            return jsonify(upload_image(file, req_id)), 201
        except ApiError as e:
            return _err(e)

    @bp.post("/api/analyze")
    def api_analyze():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            source_path = payload.get("source_path", "")
            return jsonify(analyze_image(source_path, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/run")
    def api_run():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            cfg = RunConfig(
                source_path=str(payload.get("source_path", "")),
                name=str(payload.get("name", "")).strip(),
                angles=int(payload.get("angles", 1)),
                frames=parse_frames_csv(payload.get("frames", "1"), req_id, "run"),
                source_projs=int(payload.get("source_projs", 1)),
                render_resolution=int(payload.get("render_resolution", 12)),
                bg_mode=str(payload.get("bg_mode", "key_color")),
                bg_tolerance=int(payload.get("bg_tolerance", 8)),
                native_compat=_as_bool(payload.get("native_compat"), default=True),
                target_cols=(int(payload.get("target_cols")) if payload.get("target_cols") is not None else None),
                target_rows=(int(payload.get("target_rows")) if payload.get("target_rows") is not None else None),
            )
            return jsonify(run_pipeline(cfg, req_id)), 200
        except ApiError as e:
            return _err(e)
        except ValueError as e:
            return jsonify({
                "error": str(e),
                "code": "invalid_payload",
                "stage": "run",
                "request_id": req_id,
            }), 422

    @bp.get("/api/status/<job_id>")
    def api_status(job_id: str):
        req_id = str(uuid.uuid4())
        try:
            return jsonify(status(job_id, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/load-from-job")
    def api_wb_load():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            job_id = str(payload.get("job_id", "")).strip()
            if not job_id:
                raise ApiError("job_id is required", "missing_job_id", "workbench", req_id, 400)
            return jsonify(workbench_load_from_job(job_id, req_id)), 201
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/load-session")
    def api_wb_load_session():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            return jsonify(workbench_load_session(session_id, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.get("/api/workbench/browse/list")
    def api_wb_browse_list():
        req_id = str(uuid.uuid4())
        try:
            return jsonify(workbench_list_sessions(req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/browse/rename")
    def api_wb_browse_rename():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            name = str(payload.get("name", ""))
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            return jsonify(workbench_rename_session(session_id, name, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/browse/duplicate")
    def api_wb_browse_duplicate():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            return jsonify(workbench_duplicate_session(session_id, req_id)), 201
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/browse/delete")
    def api_wb_browse_delete():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            return jsonify(workbench_delete_session(session_id, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/create-blank-session")
    def api_wb_create_blank_session():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            template_set_key = str(payload.get("template_set_key", "")).strip()
            action_key = str(payload.get("action_key", "")).strip()
            blank_session = payload.get("blank_session")
            if template_set_key:
                if not action_key:
                    raise ApiError("action_key is required", "missing_action_key", "workbench", req_id, 400)
                return jsonify(workbench_create_blank_session(template_set_key, action_key, None, req_id)), 201
            return jsonify(workbench_create_blank_session("", "", blank_session, req_id)), 201
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/export-xp")
    def api_wb_export():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            return jsonify(workbench_export_xp(session_id, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/upload-xp")
    def api_wb_upload_xp():
        req_id = str(uuid.uuid4())
        try:
            if "file" not in request.files:
                raise ApiError("file field is required", "missing_file", "workbench", req_id, 400)
            file = request.files["file"]
            if not file or not file.filename:
                raise ApiError("no file selected", "no_file", "workbench", req_id, 400)
            if not file.filename.lower().endswith(".xp"):
                raise ApiError("file must have .xp extension", "invalid_extension", "workbench", req_id, 400)
            xp_bytes = file.read()
            if not xp_bytes:
                raise ApiError("file is empty", "empty_file", "workbench", req_id, 400)
            return jsonify(workbench_upload_xp(xp_bytes, req_id, file.filename)), 201
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/validate-xp")
    def api_wb_validate_xp():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            xp_path = str(payload.get("xp_path", "")).strip()
            template_set_key = str(payload.get("template_set_key", "")).strip()
            action_key = str(payload.get("action_key", "")).strip()
            if not xp_path:
                raise ApiError("xp_path is required", "missing_xp_path", "workbench", req_id, 400)
            if not template_set_key:
                raise ApiError("template_set_key is required", "missing_template_set_key", "workbench", req_id, 400)
            if not action_key:
                raise ApiError("action_key is required", "missing_action_key", "workbench", req_id, 400)
            return jsonify(validate_xp_single(xp_path, template_set_key, action_key, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.get("/api/workbench/download-xp")
    def api_wb_download_xp():
        req_id = str(uuid.uuid4())
        try:
            raw_path = str(request.args.get("xp_path", "")).strip()
            if not raw_path:
                raise ApiError("xp_path is required", "missing_xp_path", "workbench", req_id, 400)
            xp_path = Path(raw_path).expanduser().resolve()
            export_root = EXPORT_DIR.resolve()
            if export_root not in xp_path.parents or xp_path.suffix.lower() != ".xp":
                raise ApiError("xp_path must be an exported .xp under data/exports", "invalid_xp_path", "workbench", req_id, 400)
            if not xp_path.is_file():
                raise ApiError("xp file not found", "xp_not_found", "workbench", req_id, 404)
            return send_file(xp_path, mimetype="application/octet-stream", as_attachment=True, download_name=xp_path.name, max_age=0)
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/xp-tool-command")
    def api_wb_xp_tool_command():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            xp_path = str(payload.get("xp_path", "")).strip()
            if not xp_path:
                raise ApiError("xp_path is required", "missing_xp_path", "workbench", req_id, 400)
            return jsonify(workbench_xp_tool_command(xp_path, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/open-in-xp-tool")
    def api_wb_open_in_xp_tool():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            xp_path = str(payload.get("xp_path", "")).strip()
            if not xp_path:
                raise ApiError("xp_path is required", "missing_xp_path", "workbench", req_id, 400)
            raw = payload.get("dry_run", False)
            dry_run = raw if isinstance(raw, bool) else str(raw).lower() in {"1", "true", "yes", "on"}
            return jsonify(workbench_open_in_xp_tool(xp_path, req_id, dry_run=dry_run)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/termpp-skin-command")
    def api_wb_termpp_skin_command():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            binary_name = str(payload.get("binary_name", "game_term")).strip() or "game_term"
            return jsonify(workbench_termpp_skin_command(session_id, req_id, binary_name=binary_name)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/open-termpp-skin")
    def api_wb_open_termpp_skin():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            binary_name = str(payload.get("binary_name", "game_term")).strip() or "game_term"
            raw = payload.get("dry_run", False)
            dry_run = raw if isinstance(raw, bool) else str(raw).lower() in {"1", "true", "yes", "on"}
            return jsonify(workbench_open_termpp_skin(session_id, req_id, binary_name=binary_name, dry_run=dry_run)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/web-skin-payload")
    def api_wb_web_skin_payload():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            if _is_bundle_session(session_id):
                raise ApiError(
                    "use /api/workbench/web-skin-bundle-payload for bundle sessions",
                    "bundle_session_classic_rejected",
                    "workbench",
                    req_id,
                    409,
                )
            return jsonify(workbench_web_skin_payload(session_id, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/termpp-stream/start")
    def api_wb_termpp_stream_start():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            x = int(payload.get("x", 0))
            y = int(payload.get("y", 0))
            w = int(payload.get("w", 640))
            h = int(payload.get("h", 480))
            fps = int(payload.get("fps", 4))
            raw = payload.get("dry_run", False)
            dry_run = raw if isinstance(raw, bool) else str(raw).lower() in {"1", "true", "yes", "on"}
            return jsonify(workbench_termpp_stream_start(session_id, req_id, x, y, w, h, fps=fps, dry_run=dry_run)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/termpp-stream/stop")
    def api_wb_termpp_stream_stop():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            stream_id = str(payload.get("stream_id", "")).strip()
            if not stream_id:
                raise ApiError("stream_id is required", "missing_stream_id", "workbench", req_id, 400)
            return jsonify(workbench_termpp_stream_stop(stream_id, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.get("/api/workbench/termpp-stream/status/<stream_id>")
    def api_wb_termpp_stream_status(stream_id: str):
        req_id = str(uuid.uuid4())
        try:
            return jsonify(workbench_termpp_stream_status(stream_id, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.get("/api/workbench/termpp-stream/frame/<stream_id>")
    def api_wb_termpp_stream_frame(stream_id: str):
        req_id = str(uuid.uuid4())
        try:
            p = workbench_termpp_stream_frame_path(stream_id, req_id)
            return send_file(p, mimetype="image/png", max_age=0)
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/save-session")
    def api_wb_save():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            return jsonify(workbench_save_session(session_id, payload, req_id)), 200
        except ApiError as e:
            return _err(e)

    # ── UQ-006 source-manifest canonical owner ──

    @bp.get("/api/workbench/source-manifest")
    def api_wb_source_manifest_get():
        req_id = str(uuid.uuid4())
        try:
            source_path = request.args.get("source_path", "").strip() or None
            session_id = request.args.get("session_id", "").strip() or None
            validate = _as_bool(request.args.get("validate"))
            materialize = _as_bool(request.args.get("materialize"))
            return jsonify(workbench_source_manifest_get(
                source_path=source_path,
                session_id=session_id,
                validate=validate,
                materialize=materialize,
                req_id=req_id,
            )), 200
        except ApiError as e:
            return _err(e)

    @bp.put("/api/workbench/source-manifest")
    def api_wb_source_manifest_put():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            source_path = str(payload.get("source_path", "")).strip()
            manifest = payload.get("manifest")
            ack_stale_sha = _as_bool(payload.get("ack_stale_sha", False))
            if not source_path:
                raise ApiError("source_path is required", "missing_source_path", "workbench", req_id, 400)
            if not isinstance(manifest, dict):
                raise ApiError("manifest must be an object", "invalid_manifest", "workbench", req_id, 422)
            return jsonify(workbench_source_manifest_put(
                source_path, manifest,
                ack_stale_sha=ack_stale_sha,
                req_id=req_id,
            )), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/mounted-calibration/compute")
    def api_wb_mounted_calibration_compute():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            player_xp = str(payload.get("player_xp", "")).strip()
            mounted_xp = str(payload.get("mounted_xp", "")).strip()
            if not player_xp:
                raise ApiError("player_xp is required", "missing_player_xp", "workbench", req_id, 400)
            if not mounted_xp:
                raise ApiError("mounted_xp is required", "missing_mounted_xp", "workbench", req_id, 400)
            layer_raw = payload.get("layer", "auto")
            layer: str | int = "auto" if layer_raw is None else (int(layer_raw) if isinstance(layer_raw, int) else str(layer_raw))
            try:
                anim_index = int(payload.get("anim_index", 0))
                frame_index = int(payload.get("frame_index", 0))
                proj = int(payload.get("proj", 0))
                min_dx = int(payload.get("min_dx", -4))
                max_dx = int(payload.get("max_dx", 8))
                min_dy = int(payload.get("min_dy", -4))
                max_dy = int(payload.get("max_dy", 8))
            except (ValueError, TypeError) as e:
                raise ApiError(f"invalid numeric parameter: {e}", "invalid_parameter", "workbench", req_id, 422)
            return jsonify(compute_mounted_rider_calibration(
                player_xp, mounted_xp, req_id,
                anim_index=anim_index, frame_index=frame_index, proj=proj, layer=layer,
                min_dx=min_dx, max_dx=max_dx, min_dy=min_dy, max_dy=max_dy,
            )), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/mounted-semantic/proposals")
    def api_wb_mounted_semantic_proposals():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            return jsonify(compute_mounted_semantic_proposals(session_id, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/session/mounted-calibration")
    def api_wb_session_mounted_calibration():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            data = payload.get("data")
            if data is None or not isinstance(data, dict):
                raise ApiError("data must be a non-null object", "invalid_data", "workbench", req_id, 422)
            return jsonify(workbench_save_session(session_id, {"mounted_rider_calibration": data}, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/session/mounted-semantic-review")
    def api_wb_session_mounted_semantic_review():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            data = payload.get("data")
            if data is None or not isinstance(data, dict):
                raise ApiError("data must be a non-null object", "invalid_data", "workbench", req_id, 422)
            return jsonify(workbench_save_session(session_id, {"mounted_semantic_review": data}, req_id)), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/run-verification")
    def api_wb_run_verification():
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            profile = str(payload.get("profile", "local_xp_sanity")).strip() or "local_xp_sanity"
            command_template = str(payload.get("command_template", ""))
            timeout_sec = int(payload.get("timeout_sec", 20))
            raw = payload.get("dry_run", False)
            dry_run = raw if isinstance(raw, bool) else str(raw).lower() in {"1", "true", "yes", "on"}
            return jsonify(
                workbench_run_verification(
                    session_id=session_id,
                    req_id=req_id,
                    profile=profile,
                    command_template=command_template,
                    timeout_sec=timeout_sec,
                    dry_run=dry_run,
                )
            ), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/actor-visual-profile/create")
    def api_wb_create_actor_visual_profile():
        """Create ActorVisualProfile from current session (Phase 2, Task 2)."""
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            domain = str(payload.get("domain", "skin")).strip()
            presentation_kind = str(payload.get("presentation_kind", "idle_walk")).strip()
            variation = str(payload.get("variation", "default")).strip()
            return jsonify(
                workbench_create_actor_visual_profile(
                    session_id=session_id,
                    domain=domain,
                    presentation_kind=presentation_kind,
                    variation=variation,
                    req_id=req_id,
                )
            ), 200
        except ApiError as e:
            return _err(e)

    @bp.post("/api/workbench/actor-visual-profile/export")
    def api_wb_export_actor_visual_profile():
        """Export ActorVisualProfile as authoring artifact (Phase 2, Task 3)."""
        req_id = str(uuid.uuid4())
        try:
            payload = request.get_json(silent=True) or {}
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                raise ApiError("session_id is required", "missing_session_id", "workbench", req_id, 400)
            domain = str(payload.get("domain", "skin")).strip()
            presentation_kind = str(payload.get("presentation_kind", "idle_walk")).strip()
            variation = str(payload.get("variation", "default")).strip()
            return jsonify(
                workbench_export_actor_visual_profile(
                    session_id=session_id,
                    domain=domain,
                    presentation_kind=presentation_kind,
                    variation=variation,
                    req_id=req_id,
                )
            ), 200
        except ApiError as e:
            return _err(e)

    app.register_blueprint(bp, url_prefix=BASE_PATH)

    @app.errorhandler(500)
    def api_500(_e):
        req_id = str(uuid.uuid4())
        return jsonify({
            "error": "internal server error",
            "code": "internal_error",
            "stage": "unknown",
            "request_id": req_id,
        }), 500

    return app


def _main():
    import os

    host = os.environ.get("PIPELINE_HOST", "127.0.0.1")
    port = int(os.environ.get("PIPELINE_PORT", "5071"))
    debug = os.environ.get("PIPELINE_DEBUG", "").lower() in ("1", "true", "yes")
    app = create_app()
    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    _main()
