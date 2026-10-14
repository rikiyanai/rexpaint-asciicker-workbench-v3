(() => {
  "use strict";

  const MAGENTA = [255, 0, 255];
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const SERVER_BOOT_NONCE = String(window.__WB_SERVER_BOOT_NONCE || "").trim();
  const BASE_PATH = String(window.__WB_BASE_PATH || "");
  /** Prepend base path to a root-relative URL. bp("/api/foo") → "/xpedit/api/foo" */
  function bp(path) { return BASE_PATH + path; }
  const DEFAULT_LAYER_NAMES = ["Metadata", "Layer 1", "Visual", "Layer 3"];
  const VERIFY_CMD_TEMPLATE_STORAGE_KEY = "wb_verify_command_template_v1";
  const TERM_STREAM_REGION_STORAGE_KEY = "wb_termpp_stream_region_v1";
  const VIEWPORT_MODE_STORAGE_KEY = "wb_viewport_mode_v1";
  const INSPECTOR_SWATCHES = [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 255],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [0, 255, 255],
    [128, 128, 128],
    [255, 128, 0],
    [128, 0, 255],
    [128, 64, 0],
  ];
  const WEBBUILD_READY_TIMEOUT_MS = 180000;
  const WHOLE_SHEET_AUTOSAVE_DEBOUNCE_MS = 1500;
  const WHOLE_SHEET_AUTOSAVE_IDLE_TIMEOUT_MS = 3000;
  const FRAME_GRID_REFRESH_IDLE_TIMEOUT_MS = 250;
  const DEFAULT_FLATMAP_NAME = "minimal_2x2.a3d";
  const WEBBUILD_BASE_SRC = (() => {
    const u = new URL(bp("/termpp-web-flat/index.html?solo=1&player=player"), window.location.origin);
    if (SERVER_BOOT_NONCE) u.searchParams.set("_srv", SERVER_BOOT_NONCE);
    const flatmapParam = String(params.get("flatmap") || "").trim();
    u.searchParams.set("flatmap", flatmapParam || DEFAULT_FLATMAP_NAME);
    const autoNewGameParam = String(params.get("autonewgame") || "1").trim();
    if (autoNewGameParam) u.searchParams.set("autonewgame", autoNewGameParam);
    const autoAttackParam = String(params.get("autoattack") || "").trim();
    if (autoAttackParam) u.searchParams.set("autoattack", autoAttackParam);
    return `${u.pathname}${u.search}`;
  })();
  const UI_RECORDER_AUTO_START = /^(1|true|yes|on)$/i.test(String(params.get("uirecord") || "").trim());

  const state = {
    jobId: params.get("job_id") || "",
    sessionId: null,
    latestXpPath: "",
    sourcePath: "",
    sourceImage: null,
    uploadAnalysis: null,
    drawMode: false,
    drawing: false,
    drawStart: null,
    drawCurrent: null,
    anchorBox: null,
    extractedBoxes: [],
    sourceMode: "select",
    sourceSelection: new Set(),
    sourceDrag: null,
    sourceRowDrag: null,
    sourceContextTarget: null,
    sourceCutsV: [],
    sourceCutsH: [],
    sourceSelectedCut: null,
    sourceNextId: 1,
    rapidManualAdd: false,
    sourceCanvasZoom: 1,
    sourceDragHoverFrame: null,
    cells: [],
    gridCols: 0,
    gridRows: 0,
    angles: 1,
    anims: [1],
    sourceProjs: 1,
    projs: 1,
    cellWChars: 1,
    cellHChars: 1,
    frameWChars: 1,
    frameHChars: 1,
    assignmentMode: "geometric",
    selectedFrames: new Set(),
    selectionAnchor: null,
    selectionFocus: null,
    selectedRow: null,
    selectedCols: new Set(),
    rowCategories: {},
    frameGroups: [],
    frameGridDirtyCells: new Set(),
    frameGridRefreshQueued: false,
    frameGridRefreshPreview: false,
    frameGridRefreshIdleHandle: null,
    layers: [],
    hasUploadedLayers: false,
    layerNames: [...DEFAULT_LAYER_NAMES],
    activeLayer: 2,
    visibleLayers: new Set([2]),
    lockedLayers: new Set(),
    wholeSheetCanvasZoom: 0,
    wholeSheetGridVisible: false,
    wholeSheetGridStep: "frame",
    wholeSheetGridCustomW: 1,
    wholeSheetGridCustomH: 1,
    sessionKind: "",
    metadataStatus: "",
    family: "",
    inspectorOpen: false,
    inspectorRow: 0,
    inspectorCol: 0,
    inspectorZoom: 10,
    inspectorTool: "inspect",
    inspectorPaintColor: [255, 255, 255],
    inspectorGlyphCode: 64,
    inspectorGlyphFgColor: [255, 255, 255],
    inspectorGlyphBgColor: [255, 0, 255],
    inspectorPainting: false,
    inspectorStrokeChanged: false,
    inspectorStrokeHadHistory: false,
    inspectorStrokeWasDirty: false,
    inspectorSelecting: false,
    inspectorSelectAnchor: null,
    inspectorSelection: null, // local frame chars: {x1,y1,x2,y2}
    inspectorSelectionClipboard: null, // 2D matrix of cells
    inspectorLastInspectCell: null, // {glyph,fg,bg}
    inspectorShowGrid: true,
    inspectorGridStep: 1,
    inspectorShowChecker: false,
    inspectorFrameClipboard: null,
    history: [],
    future: [],
    previewTimer: null,
    previewFrameIdx: 0,
    sessionDirty: false,
    sessionSaveInFlight: false,
    sessionLastSaveOkAt: 0,
    sessionLastSaveReason: "",
    _wsAutosaveDueAt: 0,
    _wsAutosaveReason: "",
    _wsAutosaveIdleHandle: null,
    termppStream: {
      id: null,
      pollTimer: null,
      imgTimer: null,
      running: false,
    },
    webbuild: {
      src: WEBBUILD_BASE_SRC,
      loaded: false,
      ready: false,
      actionInFlight: false,
      actionLabel: "",
      readyPoll: null,
      loadRequestedAt: 0,
      expectedSrc: "",
      lastLoadedSrc: "",
      uploadedXpBytes: null,
      uploadedXpName: "",
      // Normalized-contract binding: which doc the dock runtime currently shows.
      // Empty injectedSessionId => dock shows ambient/default Y9-2 sprites, NOT the doc.
      injectedSessionId: "",
      injectedChecksum: "",
      injectedAt: "",
      injectedDocKind: "",
      flatmapName: "",
      runtimePreflight: {
        checked: false,
        ok: false,
        missing_files: [],
        invalid_files: [],
        maps_found: [],
        error: "",
      },
    },
    inspectorHover: null, // {cx,cy,half,cell}
    inspectorLastHoverAnchor: null, // {cx,cy}
    gridFrameDragSelect: null, // {row,startCol,lastCol}
    gridRowDrag: null, // {fromRow}
    gridCellDrag: null, // {fromRow,fromCol,startX,startY,dragging,hover:{row,col,mode}}
    gridCellDragSuppressClick: false,
    gridPanelZoom: 0,
    // ── Bundle state ──
    bundleId: null,
    templateSetKey: "",
    activeActionKey: "idle",
    actionStates: {},       // { idle: {sessionId, jobId, status}, attack: {...}, ... }
    templateRegistry: null, // cached from GET /api/workbench/templates
    uiRecorder: {
      active: false,
      startedAt: 0,
      stoppedAt: 0,
      events: [],
      seq: 0,
      installed: false,
      statusObserver: null,
    },
    bugReport: {
      recentErrors: [],
    },
  };

  // Product chrome mirrors the root editor's Browse/Paint mode. The editor
  // remains the single owner of document and mode state.
  let productMode = "browse";

  function status(text, cls) {
    const el = $("wbStatus");
    el.className = "small " + (cls || "");
    el.textContent = text;
  }

  function uiRecorderNowMs() {
    const start = Number(state.uiRecorder.startedAt || 0);
    return start > 0 ? Date.now() - start : 0;
  }

  function uiRecorderSnapshot() {
    return {
      wbStatus: String($("wbStatus")?.textContent || ""),
      webbuildState: String($("webbuildState")?.textContent || ""),
      bundleStatus: String($("bundleStatus")?.textContent || ""),
      templateStatus: String($("templateStatus")?.textContent || ""),
      uploadPanelLabel: String($("uploadPanelLabel")?.textContent || ""),
      templateSetKey: String(state.templateSetKey || ""),
      activeActionKey: String(state.activeActionKey || ""),
      bundleId: state.bundleId ? String(state.bundleId) : "",
      sessionId: state.sessionId ? String(state.sessionId) : "",
      jobId: state.jobId ? String(state.jobId) : "",
    };
  }

  function rememberBugError(kind, detail) {
    const entry = {
      t_ms: Date.now(),
      kind: String(kind || ""),
      detail: detail || {},
    };
    state.bugReport.recentErrors.push(entry);
    if (state.bugReport.recentErrors.length > 20) {
      state.bugReport.recentErrors.splice(0, state.bugReport.recentErrors.length - 20);
    }
  }

  function uiRecorderEventTargetInfo(target) {
    const el = target && target.nodeType === 1 ? target : null;
    if (!el) return {};
    const txt = String(el.textContent || "").replace(/\s+/g, " ").trim();
    return {
      tag: String(el.tagName || "").toLowerCase(),
      id: String(el.id || ""),
      name: String(el.getAttribute("name") || ""),
      type: String(el.getAttribute("type") || ""),
      text: txt ? txt.slice(0, 120) : "",
      value: "value" in el ? String(el.value || "") : "",
    };
  }

  function getUiRecorderData() {
    return {
      active: !!state.uiRecorder.active,
      startedAt: Number(state.uiRecorder.startedAt || 0),
      stoppedAt: Number(state.uiRecorder.stoppedAt || 0),
      eventCount: state.uiRecorder.events.length,
      events: state.uiRecorder.events.map((rec) => JSON.parse(JSON.stringify(rec))),
    };
  }

  function refreshUiRecorderUi() {
    const statusEl = $("uiRecorderStatus");
    const summaryEl = $("uiRecorderSummary");
    const startBtn = $("uiRecorderStartBtn");
    const stopBtn = $("uiRecorderStopBtn");
    const count = state.uiRecorder.events.length;
    const duration = state.uiRecorder.active
      ? uiRecorderNowMs()
      : Math.max(0, Number(state.uiRecorder.stoppedAt || 0) - Number(state.uiRecorder.startedAt || 0));
    if (statusEl) {
      statusEl.textContent = state.uiRecorder.active
        ? `Recording (${count} events, ${Math.round(duration / 1000)}s)`
        : `Recorder idle (${count} events)`;
    }
    if (summaryEl) {
      const last = count ? state.uiRecorder.events[count - 1] : null;
      summaryEl.textContent = last
        ? `Last: ${last.type} @ ${Math.round(last.t_ms)}ms`
        : "0 events";
    }
    if (startBtn) startBtn.disabled = !!state.uiRecorder.active;
    if (stopBtn) stopBtn.disabled = !state.uiRecorder.active;
  }

  function recordUiEvent(type, detail = {}) {
    if (!state.uiRecorder.active) return null;
    const rec = {
      seq: ++state.uiRecorder.seq,
      t_ms: uiRecorderNowMs(),
      type: String(type || ""),
      detail,
      snapshot: uiRecorderSnapshot(),
    };
    state.uiRecorder.events.push(rec);
    refreshUiRecorderUi();
    return rec;
  }

  function installUiRecorderHooks() {
    if (state.uiRecorder.installed) return;
    state.uiRecorder.installed = true;
    document.addEventListener("click", (ev) => {
      const info = uiRecorderEventTargetInfo(ev.target);
      if (info.id && /^uiRecorder/.test(info.id)) return;
      recordUiEvent("click", info);
    }, true);
    document.addEventListener("change", (ev) => {
      const info = uiRecorderEventTargetInfo(ev.target);
      if (info.id && /^uiRecorder/.test(info.id)) return;
      if (ev.target && ev.target.files && ev.target.files.length) {
        info.files = Array.from(ev.target.files).map((f) => ({ name: String(f.name || ""), size: Number(f.size || 0) }));
      }
      recordUiEvent("change", info);
    }, true);
    document.addEventListener("keydown", (ev) => {
      const key = String(ev.key || "");
      if (!["Enter", "Escape", " ", "Spacebar", "Space", "w", "a", "s", "d", "W", "A", "S", "D"].includes(key)) return;
      recordUiEvent("keydown", {
        key,
        code: String(ev.code || ""),
        target: uiRecorderEventTargetInfo(ev.target),
      });
    }, true);
    window.addEventListener("error", (ev) => {
      const detail = {
        message: String(ev.message || ""),
        filename: String(ev.filename || ""),
        lineno: Number(ev.lineno || 0),
        colno: Number(ev.colno || 0),
      };
      rememberBugError("error", detail);
      recordUiEvent("error", detail);
    });
    window.addEventListener("unhandledrejection", (ev) => {
      const detail = { reason: String(ev.reason || "") };
      rememberBugError("unhandledrejection", detail);
      recordUiEvent("unhandledrejection", detail);
    });
    const observer = new MutationObserver(() => {
      const snap = uiRecorderSnapshot();
      const last = state.uiRecorder.events.length ? state.uiRecorder.events[state.uiRecorder.events.length - 1] : null;
      const same = last && last.type === "status_change"
        && JSON.stringify(last.detail || {}) === JSON.stringify(snap);
      if (!same) recordUiEvent("status_change", snap);
    });
    for (const node of ["wbStatus", "webbuildState", "bundleStatus", "templateStatus", "uploadPanelLabel"].map((id) => $(id)).filter(Boolean)) {
      observer.observe(node, { childList: true, subtree: true, characterData: true });
    }
    state.uiRecorder.statusObserver = observer;
  }

  function startUiRecorder() {
    installUiRecorderHooks();
    state.uiRecorder.active = true;
    state.uiRecorder.startedAt = Date.now();
    state.uiRecorder.stoppedAt = 0;
    state.uiRecorder.events = [];
    state.uiRecorder.seq = 0;
    recordUiEvent("recording_started", { auto: UI_RECORDER_AUTO_START });
    refreshUiRecorderUi();
    return getUiRecorderData();
  }

  function stopUiRecorder() {
    if (state.uiRecorder.active) recordUiEvent("recording_stopped", {});
    state.uiRecorder.active = false;
    state.uiRecorder.stoppedAt = Date.now();
    refreshUiRecorderUi();
    return getUiRecorderData();
  }

  function clearUiRecorder() {
    state.uiRecorder.active = false;
    state.uiRecorder.startedAt = 0;
    state.uiRecorder.stoppedAt = 0;
    state.uiRecorder.events = [];
    state.uiRecorder.seq = 0;
    refreshUiRecorderUi();
    return getUiRecorderData();
  }

  function downloadUiRecorder() {
    const data = getUiRecorderData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `workbench-ui-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    return data;
  }

  function getBugReportMetadata() {
    return {
      url: window.location.href,
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      sessionId: state.sessionId ? String(state.sessionId) : "",
      jobId: state.jobId ? String(state.jobId) : "",
      bundleId: state.bundleId ? String(state.bundleId) : "",
      templateSetKey: String(state.templateSetKey || ""),
      activeActionKey: String(state.activeActionKey || ""),
      sourcePath: String(state.sourcePath || ""),
      latestXpPath: String(state.latestXpPath || ""),
      bundleStatus: String($("bundleStatus")?.textContent || ""),
      wbStatus: String($("wbStatus")?.textContent || ""),
      webbuildState: String($("webbuildState")?.textContent || ""),
      wholeSheetStatus: String($("wholeSheetStatus")?.textContent || ""),
      uploadPanelLabel: String($("uploadPanelLabel")?.textContent || ""),
      grid: {
        cols: Number(state.gridCols || 0),
        rows: Number(state.gridRows || 0),
        frameWChars: Number(state.frameWChars || 0),
        frameHChars: Number(state.frameHChars || 0),
        angles: Number(state.angles || 0),
        anims: Array.isArray(state.anims) ? [...state.anims] : [],
      },
      layers: {
        activeLayer: Number(state.activeLayer || 0),
        layerNames: Array.isArray(state.layerNames) ? [...state.layerNames] : [],
        visibleLayers: Array.from(state.visibleLayers || []),
      },
      runtime: {
        frameSrc: String($("webbuildFrame")?.getAttribute("src") || ""),
        ready: !!state.webbuild.ready,
        loaded: !!state.webbuild.loaded,
        actionInFlight: !!state.webbuild.actionInFlight,
        actionLabel: String(state.webbuild.actionLabel || ""),
        runtimePreflight: JSON.parse(JSON.stringify(state.webbuild.runtimePreflight || {})),
      },
      recentErrors: state.bugReport.recentErrors.map((rec) => JSON.parse(JSON.stringify(rec))),
    };
  }

  function updateBugReportPreview() {
    const el = $("bugReportPreview");
    if (!el) return;
    const includeSession = !!$("bugIncludeSession")?.checked;
    const includeRecorder = !!$("bugIncludeRecorder")?.checked;
    const delivery = String($("bugDeliveryMethod")?.value || "local");
    const recCount = state.uiRecorder.events.length;
    const bits = [
      "URL",
      "browser/viewport",
      includeSession ? "session+bundle+runtime state" : "no session metadata",
      includeRecorder ? `UI recorder (${recCount} events)` : "no UI recorder",
      `${state.bugReport.recentErrors.length} recent JS error(s)`,
    ];
    let deliveryNote = "Saved locally.";
    if (delivery === "github") deliveryNote = "Delivered via GitHub Issue.";
    else if (delivery === "both") deliveryNote = "Saved locally + GitHub Issue.";
    el.textContent = `Report will include ${bits.join(", ")}. ${deliveryNote}`;
  }

  async function fetchKnownBugs() {
    const sel = $("bugKnownIssue");
    const deliverySel = $("bugDeliveryMethod");
    const deliveryHint = $("bugDeliveryHint");
    if (!sel) return;
    try {
      const r = await fetch(bp("/api/workbench/known-bugs"), { cache: "no-store" });
      if (!r.ok) return;
      const data = await r.json();
      // Populate known-bug dropdown
      while (sel.options.length > 1) sel.remove(1);
      for (const bug of (data.bugs || [])) {
        const opt = document.createElement("option");
        opt.value = bug.id;
        opt.textContent = `${bug.id} [${bug.severity}] ${bug.title}`;
        sel.appendChild(opt);
      }
      // Update delivery method options based on server config
      if (deliverySel && data.delivery_methods) {
        const ghAvail = !!data.delivery_methods.github;
        for (const opt of deliverySel.options) {
          if (opt.value === "github") {
            opt.disabled = !ghAvail;
            opt.textContent = ghAvail ? "GitHub Issue" : "GitHub Issue (not configured)";
          } else if (opt.value === "both") {
            opt.disabled = !ghAvail;
            opt.textContent = ghAvail ? "Local + GitHub Issue" : "Local + GitHub Issue (not configured)";
          }
        }
        if (data.default_delivery && !deliverySel.value) {
          deliverySel.value = data.default_delivery;
        }
        if (deliveryHint) {
          deliveryHint.textContent = ghAvail
            ? "GitHub delivery is configured and ready."
            : "Set BUG_REPORT_GITHUB_REPO and BUG_REPORT_GITHUB_TOKEN on the server to enable GitHub delivery.";
        }
      }
    } catch (_) {
      // BUG-06 fix: surface the fetch failure so users know the dropdown is stale.
      if (sel) {
        const errOpt = document.createElement("option");
        errOpt.value = "";
        errOpt.textContent = "(failed to load known issues)";
        errOpt.disabled = true;
        sel.appendChild(errOpt);
      }
    }
  }

  function openBugReportModal() {
    $("bugReportModal")?.classList.remove("hidden");
    $("bugReportStatus").textContent = "";
    fetchKnownBugs();
    updateBugReportPreview();
    $("bugDescription")?.focus();
  }

  function closeBugReportModal() {
    $("bugReportModal")?.classList.add("hidden");
  }

  async function submitBugReport() {
    const description = String($("bugDescription")?.value || "").trim();
    if (!description) {
      $("bugReportStatus").className = "small err";
      $("bugReportStatus").textContent = "Describe the bug before sending.";
      return;
    }
    const includeSession = !!$("bugIncludeSession")?.checked;
    const includeRecorder = !!$("bugIncludeRecorder")?.checked;
    const knownBugId = String($("bugKnownIssue")?.value || "");
    const deliveryMethod = String($("bugDeliveryMethod")?.value || "local");
    const payload = {
      category: String($("bugCategory")?.value || "other"),
      severity: String($("bugSeverity")?.value || "major"),
      description,
      known_bug_id: knownBugId,
      delivery_method: deliveryMethod,
      metadata: includeSession ? getBugReportMetadata() : {
        url: window.location.href,
        userAgent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      },
      uiRecorder: includeRecorder ? getUiRecorderData() : null,
    };
    const statusEl = $("bugReportStatus");
    statusEl.className = "small warn";
    statusEl.textContent = "Saving bug report...";
    const btn = $("bugReportSubmitBtn");
    if (btn) btn.disabled = true;
    try {
      const r = await fetch(bp("/api/workbench/report-bug"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(String(j.error || "bug report failed"));
      statusEl.className = "small ok";
      let msg = `Saved bug report ${j.report_id}`;
      if (j.github_issue && j.github_issue.issue_url) {
        msg += ` — GitHub #${j.github_issue.issue_number}`;
      } else if (j.github_issue_error) {
        msg += ` (GitHub delivery failed — saved locally)`;
      }
      statusEl.textContent = msg;
      $("bugDescription").value = "";
      setTimeout(closeBugReportModal, 1200);
    } catch (err) {
      statusEl.className = "small err";
      statusEl.textContent = `Bug report failed: ${String(err.message || err)}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function updateSessionDirtyBadge() {
    const top = $("sessionDirtyBadge");
    const ins = $("inspectorDirtyBadge");
    let txt = "Session: idle";
    let cls = "small";
    if (!state.sessionId) {
      txt = "Session: idle";
    } else if (state.sessionSaveInFlight && state.sessionDirty) {
      txt = `Session: saving...`;
      cls = "small warn";
    } else if (state.sessionDirty) {
      txt = "Session: edited (unsaved)";
      cls = "small warn";
    } else if (state.sessionLastSaveOkAt) {
      txt = `Session: saved`;
      cls = "small ok";
    } else {
      txt = "Session: loaded";
      cls = "small";
    }
    if (top) {
      top.className = cls;
      top.textContent = txt;
    }
    if (ins) {
      ins.className = cls;
      ins.textContent = state.sessionDirty ? (state.sessionSaveInFlight ? "saving..." : "edited") : "saved";
    }
  }

  function markSessionDirty(reason = "") {
    if (!state.sessionId) return;
    state.sessionDirty = true;
    if (reason) state.sessionLastSaveReason = String(reason);
    updateSessionDirtyBadge();
  }

  function markSessionSaved(reason = "") {
    state.sessionDirty = false;
    state.sessionSaveInFlight = false;
    state.sessionLastSaveOkAt = Date.now();
    if (reason) state.sessionLastSaveReason = String(reason);
    updateSessionDirtyBadge();
    // Tier A: clear dirty flag after successful server save
    const p = window.__wbPersistence;
    if (p && typeof p.clearDirtyFlag === "function") p.clearDirtyFlag();
  }

  function setXpToolHint(text) {
    const el = $("xpToolCommandHint");
    if (!el) return;
    el.textContent = text;
  }

  function verifyProfileRequiresCommand(profile) {
    return profile === "termpp_custom" || profile === "legacy_verify_e2e";
  }

  function defaultVerifyTemplate(profile) {
    if (profile === "legacy_verify_e2e") {
      return 'cd {legacy_repo_root} && PYTHONPATH={legacy_repo_root} python3 scripts/verify_e2e.py --xp-path "{xp_path}"';
    }
    if (profile === "termpp_custom") {
      return 'cd {legacy_repo_root} && <PASTE_TERMPP_VERIFY_COMMAND> "{xp_path}"';
    }
    return "";
  }

  function updateVerifyUI() {
    const profileEl = $("verifyProfile");
    const cmdEl = $("verifyCommandTemplate");
    const runBtn = $("verifyRunBtn");
    const dryBtn = $("verifyDryRunBtn");
    const hint = $("verifyHint");
    if (!profileEl || !cmdEl || !runBtn || !dryBtn) return;
    const profile = String(profileEl.value || "local_xp_sanity");
    const needsCmd = verifyProfileRequiresCommand(profile);
    cmdEl.disabled = !needsCmd;
    if (!needsCmd) {
      cmdEl.placeholder = "Built-in verifier does not require a command template";
    } else if (profile === "legacy_verify_e2e") {
      cmdEl.placeholder = 'Legacy script (experimental): cd {legacy_repo_root} && ... "{xp_path}"';
      if (!cmdEl.value.trim()) cmdEl.value = defaultVerifyTemplate(profile);
    } else {
      cmdEl.placeholder = 'Custom Term++ command using {xp_path} (and optionally {legacy_repo_root}, {pipeline_repo_root})';
    }
    const sessionReady = !!state.sessionId;
    runBtn.disabled = !sessionReady;
    dryBtn.disabled = !sessionReady;
    if (hint) {
      if (profile === "local_xp_sanity") {
        hint.textContent = "Built-in verifier: exports current session XP and checks XP structure/geometry/non-empty visual cells. Use this for quick regressions.";
      } else if (profile === "legacy_verify_e2e") {
        hint.textContent = "Experimental legacy verifier wrapper. It may fail depending on legacy repo environment. Use Dry Run first to inspect the exact command.";
      } else {
        hint.textContent = "Custom Term++ verifier: exports current session XP, then runs your command template. Include {xp_path} where the exported XP file path should be inserted.";
      }
    }
  }

  function updateTermppSkinUI() {
    const sessionReady = !!state.sessionId;
    const cmdBtn = $("termppSkinCmdBtn");
    const launchBtn = $("termppSkinLaunchBtn");
    if (cmdBtn) cmdBtn.disabled = !sessionReady;
    if (launchBtn) launchBtn.disabled = !sessionReady;
    if ($("termppStreamPreviewBtn")) $("termppStreamPreviewBtn").disabled = !sessionReady;
    if ($("termppStreamStartBtn")) $("termppStreamStartBtn").disabled = !sessionReady;
    if ($("termppStreamStopBtn")) $("termppStreamStopBtn").disabled = !state.termppStream.id;
  }

  function setWebbuildState(text, cls) {
    const el = $("webbuildState");
    if (!el) return;
    el.className = "small " + (cls || "");
    el.textContent = text;
  }

  function currentRuntimePreflight() {
    return state.webbuild.runtimePreflight || null;
  }

  function runtimePreflightIssueLines(preflight) {
    const out = [];
    if (!preflight || typeof preflight !== "object") return out;
    if (!preflight.checked) {
      out.push("runtime preflight pending");
      return out;
    }
    const missing = Array.isArray(preflight.missing_files) ? preflight.missing_files : [];
    const invalid = Array.isArray(preflight.invalid_files) ? preflight.invalid_files : [];
    for (const rel of missing) out.push(`missing: ${String(rel)}`);
    for (const rec of invalid) {
      const p = String(rec?.path || "");
      const reason = String(rec?.reason || "invalid_file");
      out.push(`invalid: ${p} (${reason})`);
    }
    if (!Array.isArray(preflight.maps_found) || preflight.maps_found.length === 0) {
      out.push("missing map: one of termpp-web-flat/flatmaps/minimal_2x2.a3d or termpp-web-flat/flatmaps/game_map_y8_original_game_map.a3d");
    }
    if (!out.length && preflight.error) out.push(String(preflight.error));
    return out;
  }

  function runtimePreflightTooltip(preflight) {
    if (!preflight) return "Skin dock disabled: runtime preflight not loaded";
    if (!preflight.checked) return "Skin dock disabled: checking runtime bundle...";
    if (preflight.ok) return "Flat runtime bundle preflight passed";
    const issues = runtimePreflightIssueLines(preflight);
    if (!issues.length) return "Skin dock disabled: runtime preflight failed";
    return `Skin dock disabled: ${issues.join("; ")}`;
  }

  function updateRuntimePreflightBanner(preflight) {
    const banner = $("runtimePreflightBanner");
    const text = $("runtimePreflightBannerText");
    if (!banner || !text) return;
    if (!preflight || !preflight.checked || preflight.ok) {
      banner.classList.add("hidden");
      text.textContent = "";
      return;
    }
    banner.classList.remove("hidden");
    const issues = runtimePreflightIssueLines(preflight);
    text.textContent = issues.length
      ? `Skin Test dock is disabled until runtime bundle issues are fixed: ${issues.join("; ")}`
      : "Skin Test dock is disabled because runtime preflight failed.";
  }

  async function fetchRuntimePreflight() {
    try {
      const r = await fetch(bp("/api/workbench/runtime-preflight"), { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `runtime preflight HTTP ${r.status}`);
      state.webbuild.runtimePreflight = {
        checked: true,
        ok: !!j?.ok,
        missing_files: Array.isArray(j?.missing_files) ? j.missing_files : [],
        invalid_files: Array.isArray(j?.invalid_files) ? j.invalid_files : [],
        maps_found: Array.isArray(j?.maps_found) ? j.maps_found : [],
        runtime_root: String(j?.runtime_root || ""),
        checked_at: String(j?.checked_at || ""),
        error: "",
      };
      syncWebbuildFlatmapFromPreflight();
    } catch (e) {
      state.webbuild.runtimePreflight = {
        checked: true,
        ok: false,
        missing_files: [],
        invalid_files: [],
        maps_found: [],
        error: String(e),
      };
    }
    updateRuntimePreflightBanner(state.webbuild.runtimePreflight);
    updateWebbuildUI();
    renderDocContractPanel(null, null);
    return currentRuntimePreflight();
  }
  // Skin Dock self-containment: point the iframe flatmap at a map the
  // runtime preflight proves exists, instead of a hard-coded name that may
  // be missing where the server actually serves the runtime bundle.
  // Precedence: ?flatmap page param (if preflight found it) > first
  // maps_found entry > built-in default.
  function syncWebbuildFlatmapFromPreflight() {
    const pre = currentRuntimePreflight();
    const found = Array.isArray(pre?.maps_found) ? pre.maps_found : [];
    const baseOf = (rel) => String(rel || "").split("/").pop();
    const pageParam = (() => {
      try { return String(new URLSearchParams(window.location.search).get("flatmap") || "").trim(); }
      catch (_e) { return ""; }
    })();
    let want = "";
    if (pageParam && found.some((rel) => baseOf(rel) === pageParam || String(rel) === pageParam)) {
      want = pageParam;
    } else if (found.length) {
      want = baseOf(found[0]);
    }
    if (!want) return;
    state.webbuild.flatmapName = want;
    try {
      const u = new URL(String(state.webbuild.src || ""), window.location.origin);
      if (u.searchParams.get("flatmap") !== want) {
        u.searchParams.set("flatmap", want);
        state.webbuild.src = `${u.pathname}${u.search}`;
      }
    } catch (_e) { /* keep base src on unparsable URL */ }
  }
  // Sibling normalized-viewer bridge (read-only terminal viewers over the
  // reviewed upstream contract — NOT embeddable, NOT doc editors).
  // Maps the current doc family to the exact viewer invocation for the
  // reviewed upstream stem of that family. Only player→player-1100 is
  // verified; other families open the viewer for manual navigation.
  // Paths are sibling-repo-relative on purpose (no absolute paths).
  function viewerBridgeForFamily(family) {
    const fam = String(family || "").trim() || "player";
    const stem = fam === "player" ? "player-1100" : "";
    return {
      normalized_xp_sprite_inspector: {
        repo: "AsciickerY92-normalized-xp-sprite-inspector",
        run: "./run-viewer.sh --once",
        note: "read-only upstream layer notes + body-region UV map",
      },
      source_layer_contract_viewer: {
        repo: "AsciickerY92-source-layer-contract-viewer",
        run: stem ? `./run-viewer.sh --once ${stem}` : "./run-viewer.sh --once",
        stem: stem || `(navigate to a ${fam} stem inside the viewer)`,
        note: "read-only raw layers incl. engine-metadata L0/L1 + composed preview",
      },
    };
  }
  // ── Normalized-contract viewer (Test This Skin doc binding) ─────────────
  // Primary Test surface reads the current workbench document through this
  // contract: doc kind, metadata status, geometry, layer-0 compat actuals,
  // and — after a Test run — the server payload verdict plus which doc the
  // dock runtime actually shows. An empty dockSessionId means the iframe (if
  // visible) shows ambient/default Y9-2 sprites, not the current document.
  function docL0Row0Glyphs(limit = 8) {
    const out = [];
    try {
      const l0 = Array.isArray(state.layers) && state.layers.length ? state.layers[0] : null;
      const cols = Math.max(1, Number(state.gridCols || 0));
      if (!Array.isArray(l0) || !cols) return out;
      for (let cx = 0; cx < Math.min(limit, cols); cx++) {
        const cell = l0[cx] || {};
        const g = Number(cell.glyph || 0);
        out.push(g >= 32 && g < 127 ? String.fromCharCode(g) : `g${g}`);
      }
    } catch (_e) { /* contract best-effort */ }
    return out;
  }

  function currentDocContract() {
    const sid = state.sessionId ? String(state.sessionId) : "";
    return {
      session_id: sid,
      session_short: sid ? `${sid.slice(0, 8)}...` : "(no document)",
      session_kind: String(state.sessionKind || "(unknown)"),
      metadata_status: String(state.metadataStatus || "(unknown)"),
      family: String(state.family || ""),
      bundle_mode: isBundleMode(),
      bundle_id: state.bundleId ? String(state.bundleId) : "",
      template_set_key: String(state.templateSetKey || ""),
      action_key: String(state.activeActionKey || ""),
      grid_cols: Number(state.gridCols || 0),
      grid_rows: Number(state.gridRows || 0),
      angles: Number(state.angles || 0),
      anims: Array.isArray(state.anims) ? [...state.anims] : [],
      layer_count: Array.isArray(state.layers) ? state.layers.length : 0,
      layer_names: Array.isArray(state.layerNames) ? [...state.layerNames] : [],
      layer0_actual: docL0Row0Glyphs(),
      flatmap: String(state.webbuild.flatmapName || "(preflight pending)"),
    };
  }

  function renderDocContractPanel(serverContract, inject) {
    const doc = currentDocContract();
    const setText = (id, v) => { const el = $(id); if (el) el.textContent = String(v); };
    setText("docContractKind", `doc: ${doc.session_short} kind=${doc.session_kind} meta=${doc.metadata_status} family=${doc.family || "(unknown)"}`);
    setText("docContractGeom",
      `geom: ${doc.grid_cols}x${doc.grid_rows} angles=${doc.angles} anims=[${doc.anims.join(",")}] layers=${doc.layer_count} flatmap=${doc.flatmap}`);
    const l0srv = serverContract && typeof serverContract === "object" ? serverContract : null;
    const l0verdict = l0srv
      ? `l0: actual=[${(l0srv.layer0_actual || []).join(",")}] expected=[${(l0srv.layer0_expected || []).join(",")}] compat=${l0srv.layer0_compat ? "PASS" : "FAIL"}`
      : `l0: actual=[${doc.layer0_actual.join(",")}] (run Test This Skin for server compat verdict)`;
    setText("docContractL0", l0verdict);
    const dockSid = String(state.webbuild.injectedSessionId || "");
    const dockKind = String(state.webbuild.injectedDocKind || "");
    const dockLine = dockKind === "external_upload"
      ? `dock skin: external upload (${String((inject && inject.external_upload) || "") || "file"} — not the current document)`
      : (!dockSid
        ? "dock skin: none (ambient/default Y9-2 sprites — not the document)"
        : (dockSid === doc.session_id && doc.session_id
          ? `dock skin: ${dockSid.slice(0, 8)}... CHECKSUM=${String(state.webbuild.injectedChecksum || "").slice(0, 12)} (tracks current document)`
          : `dock skin: ${dockSid.slice(0, 8)}... STALE (document is ${doc.session_short})`));
    setText("docContractDock", dockLine);
    const out = $("docContractOut");
    if (out) {
      out.textContent = JSON.stringify(
        { document: doc, payload_contract: l0srv, inject: inject || null, viewer_bridge: viewerBridgeForFamily((l0srv && l0srv.family) || doc.family || "") }, null, 2);
    }
  }

  async function ensureRuntimePreflight(opts = {}) {
    const refresh = !!opts.refresh;
    const silent = !!opts.silent;
    const pre = currentRuntimePreflight();
    if (refresh || !pre || !pre.checked) {
      await fetchRuntimePreflight();
    }
    const ready = !!currentRuntimePreflight()?.ok;
    if (!ready && !silent) {
      status("Skin dock blocked: runtime preflight failed", "warn");
      setWebbuildState("Skin dock blocked (runtime preflight failed)", "err");
    }
    return ready;
  }

  function webbuildFrameWindow() {
    const frame = $("webbuildFrame");
    return frame && frame.contentWindow ? frame.contentWindow : null;
  }

  function webbuildCurrentPathQuery(win) {
    if (!win || !win.location) return "";
    try {
      return `${String(win.location.pathname || "")}${String(win.location.search || "")}`;
    } catch (_e) {
      return "";
    }
  }

  function readWebbuildLoadingDetail(win) {
    if (!win) return "";
    try {
      const statusEl = win.document && win.document.getElementById ? win.document.getElementById("status") : null;
      const progressEl = win.document && win.document.getElementById ? win.document.getElementById("progress") : null;
      const statusText = statusEl && statusEl.textContent ? String(statusEl.textContent).trim() : "";
      const pHidden = !!(progressEl && progressEl.hidden);
      const pVal = progressEl && Number.isFinite(Number(progressEl.value)) ? Number(progressEl.value) : null;
      const pMax = progressEl && Number.isFinite(Number(progressEl.max)) ? Number(progressEl.max) : null;
      let prog = "";
      if (!pHidden && pVal != null && pMax != null && pMax > 0) {
        prog = ` ${Math.round((pVal / pMax) * 100)}%`;
      }
      const moduleStatus = win.Module && win.Module.setStatus && win.Module.setStatus.last && win.Module.setStatus.last.text
        ? String(win.Module.setStatus.last.text).trim()
        : "";
      const text = statusText || moduleStatus;
      return text ? `${text}${prog}`.trim() : "";
    } catch (_e) {
      return "";
    }
  }

  function stopWebbuildReadyPoll() {
    if (state.webbuild.readyPoll) {
      clearInterval(state.webbuild.readyPoll);
      state.webbuild.readyPoll = null;
    }
  }

  function webbuildFrameSrc(forceFresh = false, previewToken = "") {
    const raw = String(state.webbuild.src || bp("/termpp-web-flat/index.html?solo=1&player=player"));
    try {
      const u = new URL(raw, window.location.origin);
      // Preview tokens already make authored test documents unique. Runtime
      // assets carry their own content version, so a timestamp here only
      // defeats caching and lets repeated actions race full downloads.
      u.searchParams.delete("_wb");
      if (previewToken) u.searchParams.set("skin_preview_token", String(previewToken));
      else u.searchParams.delete("skin_preview_token");
      return `${u.pathname}${u.search}`;
    } catch (_e) {
      if (!previewToken) return raw;
      const sep = raw.includes("?") ? "&" : "?";
      return `${raw}${sep}skin_preview_token=${encodeURIComponent(previewToken)}`;
    }
  }

  function updateWebbuildUI() {
    const sessionReady = !!state.sessionId;
    const actionBusy = !!state.webbuild.actionInFlight;
    const actionBusyTitle = state.webbuild.actionLabel
      ? `Skin dock busy: ${state.webbuild.actionLabel} is still running`
      : "Skin dock busy: action already running";
    const preflightOk = !!currentRuntimePreflight()?.ok;
    const preflightTitle = runtimePreflightTooltip(currentRuntimePreflight());
    const applyBtn = $("webbuildApplySkinBtn");
    if (applyBtn) {
      applyBtn.disabled = actionBusy || !preflightOk || !sessionReady;
      if (!preflightOk) {
        applyBtn.title = preflightTitle;
      } else if (actionBusy) {
        applyBtn.title = actionBusyTitle;
      } else {
        applyBtn.title = sessionReady ? "Restart the preview with the current XP installed before runtime initialization" : "Requires an active session";
      }
    }
    const applyInPlaceBtn = $("webbuildApplyInPlaceBtn");
    if (applyInPlaceBtn) {
      applyInPlaceBtn.disabled = actionBusy || !preflightOk || !sessionReady;
      if (!preflightOk) {
        applyInPlaceBtn.title = preflightTitle;
      } else if (actionBusy) {
        applyInPlaceBtn.title = actionBusyTitle;
      } else {
        applyInPlaceBtn.title = sessionReady ? "Restart the preview through the pre-main XP owner" : "Requires an active session";
      }
    }
    const applyRestartBtn = $("webbuildApplyRestartBtn");
    if (applyRestartBtn) {
      applyRestartBtn.disabled = actionBusy || !preflightOk || !sessionReady;
      if (!preflightOk) {
        applyRestartBtn.title = preflightTitle;
      } else if (actionBusy) {
        applyRestartBtn.title = actionBusyTitle;
      } else {
        applyRestartBtn.title = sessionReady ? "Export and apply current XP skin with a deterministic webbuild restart" : "Disabled: load or create a session first";
      }
    }
    const quickBtn = $("webbuildQuickTestBtn");
    if (quickBtn) {
      quickBtn.disabled = actionBusy || !preflightOk || !sessionReady;
      if (!preflightOk) {
        quickBtn.title = preflightTitle;
      } else if (actionBusy) {
        quickBtn.title = actionBusyTitle;
      } else {
        quickBtn.title = sessionReady ? "Restart the preview with this XP installed before sprite construction" : "Disabled: load or create a session first";
      }
    }
    const uploadBtn = $("webbuildUploadTestBtn");
    if (uploadBtn) {
      uploadBtn.disabled = actionBusy || !preflightOk;
      uploadBtn.title = !preflightOk ? preflightTitle : (actionBusy ? actionBusyTitle : "Upload an external .xp and apply it to flat arena runtime");
    }
    const openBtn = $("webbuildOpenBtn");
    if (openBtn) {
      openBtn.disabled = actionBusy || !preflightOk;
      openBtn.title = !preflightOk ? preflightTitle : (actionBusy ? actionBusyTitle : "Open flat arena runtime preview");
    }
    const reloadBtn = $("webbuildReloadBtn");
    if (reloadBtn) {
      reloadBtn.disabled = actionBusy || !preflightOk;
      reloadBtn.title = !preflightOk ? preflightTitle : (actionBusy ? actionBusyTitle : "Reload flat arena runtime preview");
    }
  }

  async function runWebbuildSkinAction(label, fn) {
    const name = String(label || "skin action");
    if (state.webbuild.actionInFlight) {
      const active = String(state.webbuild.actionLabel || "another skin action");
      status(`Skin dock busy: ${active} still running`, "warn");
      return false;
    }
    state.webbuild.actionInFlight = true;
    state.webbuild.actionLabel = name;
    updateWebbuildUI();
    try {
      await fn();
      return true;
    } finally {
      state.webbuild.actionInFlight = false;
      state.webbuild.actionLabel = "";
      updateWebbuildUI();
    }
  }

  function detectWebbuildReady() {
    const win = webbuildFrameWindow();
    if (!win) return false;
    try {
      const expectedSrc = String(state.webbuild.expectedSrc || "");
      const currentPathQuery = webbuildCurrentPathQuery(win);
      if (expectedSrc && currentPathQuery && currentPathQuery !== expectedSrc) {
        state.webbuild.ready = false;
        updateWebbuildUI();
        setWebbuildState("Webbuild navigating to fresh preview instance...", "warn");
        return false;
      }
      const hasModule = !!win.Module;
      const calledRun = !!(win.Module && win.Module.calledRun);
      const hasLoad = typeof win.Load === "function";
      const hasLegacyFSOps = !!(win.Module && typeof win.Module.FS_createDataFile === "function" && typeof win.Module.FS_unlink === "function");
      const hasWriteFileFS = !!(win.Module && win.Module.FS && typeof win.Module.FS.writeFile === "function");
      const hasFSOps = hasLegacyFSOps || hasWriteFileFS;
      // Gate on _wasmReady: Emscripten calledRun fires before the game's
      // async init (font loading, etc.) completes.  Injecting via Load()
      // before _wasmReady can leave the runtime permanently half-initialized
      // (BUG-11).  _wasmReady is set by the Asciicker runtime after full init.
      const wasmGameReady = !!win._wasmReady;
      const ready = hasModule && calledRun && hasLoad && hasFSOps && wasmGameReady;
      state.webbuild.ready = ready;
      updateWebbuildUI();
      if (ready) {
        setWebbuildState("Webbuild ready", "ok");
        stopWebbuildReadyPoll();
      } else {
        const detail = readWebbuildLoadingDetail(win);
        const elapsedMs = state.webbuild.loadRequestedAt ? Math.max(0, Date.now() - state.webbuild.loadRequestedAt) : 0;
        const elapsedTxt = elapsedMs > 0 ? ` (${Math.round(elapsedMs / 1000)}s)` : "";
        if (calledRun && hasFSOps && !wasmGameReady) {
          setWebbuildState(`Webbuild WASM loaded, waiting for game init (_wasmReady)...${elapsedTxt}`, "warn");
        } else {
          setWebbuildState(detail ? `Webbuild loading... ${detail}${elapsedTxt}` : `Webbuild loading... (first load may take 30-120s)${elapsedTxt}`, "warn");
        }
      }
      return ready;
    } catch (e) {
      state.webbuild.ready = false;
      updateWebbuildUI();
      setWebbuildState(`Webbuild access error (${e})`, "err");
      return false;
    }
  }

  function openWebbuild(opts = {}) {
    const frame = $("webbuildFrame");
    if (!frame) return;
    frame.classList.remove("hidden");
    state.webbuild.loaded = true;
    state.webbuild.ready = false;
    state.webbuild.loadRequestedAt = Date.now();
    updateWebbuildUI();
    setWebbuildState("Opening flat arena preview... (first load downloads ~24MB)", "warn");
    stopWebbuildReadyPoll();
    const nextSrc = webbuildFrameSrc(opts.force_fresh !== false, opts.preview_token || "");
    state.webbuild.expectedSrc = nextSrc;
    try { frame.src = nextSrc; } catch (_e) {}
    state.webbuild.readyPoll = setInterval(detectWebbuildReady, 500);
  }

  function reloadWebbuild(opts = {}) {
    const frame = $("webbuildFrame");
    if (!frame) return;
    if (frame.classList.contains("hidden")) frame.classList.remove("hidden");
    state.webbuild.loaded = true;
    state.webbuild.ready = false;
    state.webbuild.loadRequestedAt = Date.now();
    updateWebbuildUI();
    setWebbuildState("Reloading webbuild...", "warn");
    stopWebbuildReadyPoll();
    const nextSrc = webbuildFrameSrc(opts.force_fresh !== false, opts.preview_token || "");
    state.webbuild.expectedSrc = nextSrc;
    try { frame.src = nextSrc; } catch (_e) {}
    state.webbuild.readyPoll = setInterval(detectWebbuildReady, 500);
  }

  function uint8ArrayToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function mintLegacyPreviewToken(opts = {}) {
    const body = opts.xp_bytes instanceof Uint8Array
      ? {
          xp_b64: uint8ArrayToBase64(opts.xp_bytes),
          source_name: String(opts.source_name || "preview.xp"),
        }
      : { session_id: String(state.sessionId || "") };
    const response = await fetch(bp("/api/workbench/legacy-preview-token"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `preview token request failed (${response.status})`);
    return payload;
  }

  function currentLegacyPreviewReceipt() {
    try { return webbuildFrameWindow()?.__legacySkinPreview || null; }
    catch (_e) { return null; }
  }

  async function waitForWebbuildReady(timeoutMs = WEBBUILD_READY_TIMEOUT_MS) {
    if (!(await ensureRuntimePreflight({ silent: true }))) {
      setWebbuildState("Skin dock blocked (runtime preflight failed)", "err");
      return false;
    }
    const frame = $("webbuildFrame");
    const needsOpen = (
      !state.webbuild.loaded ||
      !frame ||
      frame.classList.contains("hidden") ||
      !String(state.webbuild.expectedSrc || "").trim()
    );
    if (needsOpen) openWebbuild();
    const t0 = Date.now();
    let nextPulse = t0 + 5000;
    while (Date.now() - t0 < timeoutMs) {
      const receipt = currentLegacyPreviewReceipt();
      if (receipt && receipt.status === "failed") {
        const message = String(receipt.error || receipt.packet_contract_error || "pre-main XP installation failed");
        setWebbuildState(`Skin preview blocked: ${message}`, "err");
        try { $("webbuildOut").textContent = JSON.stringify({ stage: "legacy_preview_bootstrap_failed", receipt }, null, 2); } catch (_e) {}
        return false;
      }
      if (detectWebbuildReady()) return true;
      const now = Date.now();
      if (now >= nextPulse) {
        const secs = Math.max(1, Math.round((now - t0) / 1000));
        setWebbuildState(`Webbuild loading... still initializing (${secs}s elapsed; first load can take 30-120s)`, "warn");
        nextPulse = now + 5000;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    const waitedSecs = Math.max(1, Math.round((Date.now() - t0) / 1000));
    setWebbuildState(`Webbuild still loading after ${waitedSecs}s. Keep this tab open, then retry in a moment.`, "warn");
    try {
      const out = $("webbuildOut");
      if (out && !String(out.textContent || "").trim()) {
        out.textContent = JSON.stringify({
          phase: "wait_for_webbuild_ready_timeout",
          timeout_ms: timeoutMs,
          waited_seconds: waitedSecs,
          detail: readWebbuildLoadingDetail(webbuildFrameWindow()) || "",
        }, null, 2);
      }
    } catch (_e) {}
    return false;
  }

  function webbuildLoginOverlayVisible(win) {
    if (!win || !win.document || typeof win.document.getElementById !== "function") return false;
    const overlay = win.document.getElementById("login-overlay");
    if (!overlay) return false;
    try {
      const cs = typeof win.getComputedStyle === "function" ? win.getComputedStyle(overlay) : null;
      if (cs) {
        if (cs.display === "none" || cs.visibility === "hidden") return false;
      }
    } catch (_e) {}
    if (overlay.hidden) return false;
    if (overlay.style && overlay.style.display === "none") return false;
    return true;
  }

  function webbuildStartGameReady(win) {
    if (!win || !win.document || typeof win.document.getElementById !== "function") return false;
    try {
      return win._wasmReady === true;
    } catch (_e) {}
    return false;
  }

  function scheduleDeferredWebbuildStart(win, opts = {}) {
    if (!win || typeof win.StartGame !== "function") return false;
    const frame = $("webbuildFrame");
    const expectedSrc = String(opts.expected_src || state.webbuild.expectedSrc || "");
    const playerName = String(opts.player_name || "player").trim() || "player";
    const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    state.webbuild.pendingAutoStartToken = token;
    const t0 = Date.now();
    const timer = setInterval(() => {
      try {
        if (state.webbuild.pendingAutoStartToken !== token) {
          clearInterval(timer);
          return;
        }
        const liveWin = webbuildFrameWindow();
        if (!liveWin || liveWin !== win) {
          clearInterval(timer);
          return;
        }
        if (expectedSrc) {
          const currentPathQuery = webbuildCurrentPathQuery(liveWin);
          if (currentPathQuery && currentPathQuery !== expectedSrc) {
            clearInterval(timer);
            return;
          }
        }
        if (!webbuildLoginOverlayVisible(liveWin)) {
          clearInterval(timer);
          state.webbuild.pendingAutoStartToken = "";
          return;
        }
        if (!webbuildStartGameReady(liveWin)) {
          const secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
          if (secs <= 60) {
            setWebbuildState(`Webbuild ready; waiting for game init (${secs}s)...`, "warn");
          }
          if (Date.now() - t0 > 60000) {
            clearInterval(timer);
            state.webbuild.pendingAutoStartToken = "";
            status("Skin applied, but game init timed out — click Test This Skin to retry", "warn");
            setWebbuildState("Webbuild ready (game init timed out)", "warn");
            try {
              const out = $("webbuildOut");
              if (out) {
                out.textContent = JSON.stringify({
                  stage: "deferred_webbuild_start_timeout",
                  waited_ms: Date.now() - t0,
                  expected_src: expectedSrc,
                  iframe_src: frame ? String(frame.getAttribute("src") || "") : "",
                  wasm_ready: !!liveWin._wasmReady,
                }, null, 2);
              }
            } catch (_e) {}
          }
          return;
        }
        const d = liveWin.document;
        const playerInput = d && d.getElementById ? d.getElementById("player-name") : null;
        const serverInput = d && d.getElementById ? d.getElementById("server-addr") : null;
        const playBtn = d && d.getElementById ? d.getElementById("play-btn") : null;
        if (playerInput && !String(playerInput.value || "").trim()) playerInput.value = playerName;
        if (serverInput) serverInput.value = "";
        if (playBtn) playBtn.disabled = false;
        const startRes = liveWin.StartGame();
        if (startRes && typeof startRes.then === "function") {
          startRes.catch((e) => {
            try { console.warn("[workbench] deferred webbuild StartGame rejected:", e); } catch (_e2) {}
          });
        }
        clearInterval(timer);
        state.webbuild.pendingAutoStartToken = "";
        setWebbuildState("Webbuild ready (starting game...)", "ok");
        try { $("webbuildFrame")?.focus?.(); } catch (_e) {}
        setTimeout(() => { try { $("webbuildFrame")?.focus?.(); } catch (_e) {} }, 300);
      } catch (e) {
        clearInterval(timer);
        state.webbuild.pendingAutoStartToken = "";
        try { console.warn("[workbench] deferred webbuild StartGame failed:", e); } catch (_e2) {}
      }
    }, 200);
    return true;
  }

  async function waitForLegacyPreviewRuntimeActivation(family, timeoutMs = 30000) {
    if (String(family || "") !== "player") return currentLegacyPreviewReceipt();
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const receipt = currentLegacyPreviewReceipt();
      if (receipt?.status === "failed" || receipt?.runtime_activation_status === "failed") {
        throw new Error(String(
          receipt.runtime_activation_error || receipt.error || "legacy player preview activation failed",
        ));
      }
      if (receipt?.runtime_activation_status === "activated") return receipt;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("legacy player preview did not reach unmounted runtime state");
  }

  async function launchLegacyPreviewToken(tokenPayload) {
    reloadWebbuild({ force_fresh: true, preview_token: tokenPayload.token });
    if (!(await waitForWebbuildReady())) throw new Error("legacy preview runtime did not become ready");
    const receipt = currentLegacyPreviewReceipt();
    if (!receipt || receipt.status !== "installed") throw new Error("legacy preview install receipt is missing");
    const expectedTargets = Array.isArray(tokenPayload.target_paths) ? tokenPayload.target_paths : [];
    const installedTargets = Array.isArray(receipt.target_paths) ? receipt.target_paths : [];
    const targetsMatch = (
      expectedTargets.length === 24 &&
      installedTargets.length === expectedTargets.length &&
      installedTargets.every((target, index) => target === expectedTargets[index])
    );
    const hashesMatch = expectedTargets.every(
      (target) => receipt.actual_sha256_by_path?.[target] === tokenPayload.sha256,
    );
    if (
      receipt.target_path !== tokenPayload.target_path ||
      receipt.actual_sha256 !== tokenPayload.sha256 ||
      receipt.installed_target_count !== expectedTargets.length ||
      !targetsMatch ||
      !hashesMatch
    ) {
      throw new Error("legacy preview install receipt does not match the minted payload");
    }
    return waitForLegacyPreviewRuntimeActivation(tokenPayload.family);
  }

  async function applyCurrentXpAsWebSkin(_opts = {}) {
    await runWebbuildSkinAction("apply skin", async () => {
      if (!(await ensureRuntimePreflight({ refresh: true }))) return;
      if (!state.sessionId) {
        status("Load a workbench session first", "warn");
        return;
      }
      const t0 = Date.now();
      const timings = {};
      try {
        const tSave = Date.now();
        status("Saving current session before skin test...", "warn");
        const saveRes = await saveSessionState("pre-web-skin-apply", { wait_for_idle: true, timeout_ms: 15000 });
        if (!saveRes || !saveRes.ok) {
          timings.save_session_failed = saveRes || { ok: false };
          $("webbuildOut").textContent = JSON.stringify({
            stage: "save_session_before_web_skin_apply_failed",
            save: saveRes,
            timings,
          }, null, 2);
          status("Skin test blocked: session save failed/timed out", "err");
          return;
        }
        timings.save_session_ms = Date.now() - tSave;
        status("Validating XP and minting one-shot preview...", "warn");
        const tMint = Date.now();
        const token = await mintLegacyPreviewToken();
        timings.mint_ms = Date.now() - tMint;
        status(`Installing ${token.family} preview bundle before sprite construction...`, "warn");
        const tLaunch = Date.now();
        const receipt = await launchLegacyPreviewToken(token);
        timings.launch_ms = Date.now() - tLaunch;
        timings.total_ms = Date.now() - t0;
        // Normalized-contract binding: the dock now shows THIS document, not
        // ambient/default sprites. Record identity where Test consumes it.
        // (Token flow carries no bundle/inject payload — bind to the minted preview.)
        state.webbuild.injectedSessionId = state.sessionId ? String(state.sessionId) : "";
        state.webbuild.injectedChecksum = String(token.sha256 || "");
        state.webbuild.injectedAt = new Date().toISOString();
        state.webbuild.injectedDocKind = String(state.sessionKind || "");
        renderDocContractPanel(null, { token_preview: token.target_path || "", bundle_mode: false });
        $("webbuildOut").textContent = JSON.stringify({
          mode: "legacy_pre_main_preview",
          timings,
          token: {
            target_path: token.target_path,
            target_paths: token.target_paths,
            runtime_state: token.runtime_state,
            sha256: token.sha256,
            size_bytes: token.size_bytes,
            width: token.width,
            height: token.height,
            layers: token.layers,
          },
          receipt,
          dock_session_id: String(state.webbuild.injectedSessionId || ""),
          dock_checksum: String(state.webbuild.injectedChecksum || ""),
          viewer_bridge: viewerBridgeForFamily(token.family || state.family || ""),
        }, null, 2);
        state.webbuild.ready = true;
        updateWebbuildUI();
        status(`Preview installed before runtime (${Math.round(timings.total_ms || 0)}ms)`, "ok");
        setWebbuildState(`Webbuild ready (${token.runtime_state})`, "ok");
      } catch (e) {
        try {
          timings.total_ms = Date.now() - t0;
          $("webbuildOut").textContent = JSON.stringify({
            stage: "apply_current_xp_as_web_skin_exception",
            error: String(e),
            timings,
            webbuild_state: String($("webbuildState")?.textContent || ""),
          }, null, 2);
        } catch (_e2) {
          $("webbuildOut").textContent = String(e);
        }
        status("Web skin apply failed", "err");
      }
    });
  }

  async function testCurrentSkinInDock() {
    if (!(await ensureRuntimePreflight({ refresh: true }))) return;
    if (!state.sessionId) {
      status("Load a workbench session first", "warn");
      return;
    }
    status("Restarting flat test arena and testing current skin...", "warn");
    await applyCurrentXpAsWebSkin();
  }

  async function onWebbuildUploadTestClick() {
    if (state.webbuild.actionInFlight) {
      const active = String(state.webbuild.actionLabel || "skin action");
      status(`Skin dock busy: ${active} still running`, "warn");
      return;
    }
    if (!(await ensureRuntimePreflight({ refresh: true }))) return;
    const input = $("webbuildUploadTestInput");
    if (!input) return;
    input.value = "";
    input.click();
  }

  async function applyUploadedXpBytesToWebbuild(fileName, xpBytes) {
    await runWebbuildSkinAction("upload skin", async () => {
      if (!(await ensureRuntimePreflight({ refresh: true }))) return;
      try {
        const token = await mintLegacyPreviewToken({
          xp_bytes: xpBytes,
          source_name: fileName || "upload.xp",
        });
        const receipt = await launchLegacyPreviewToken(token);
        state.webbuild.uploadedXpBytes = xpBytes;
        state.webbuild.uploadedXpName = fileName || "upload.xp";
        // External upload is not the current document: clear doc tracking so
        // the contract viewer cannot mislabel it as the loaded doc.
        state.webbuild.injectedSessionId = "";
        state.webbuild.injectedChecksum = "";
        state.webbuild.injectedAt = "";
        state.webbuild.injectedDocKind = "external_upload";
        renderDocContractPanel(null, { external_upload: state.webbuild.uploadedXpName, inject });
        $("webbuildOut").textContent = JSON.stringify({
          mode: "legacy_pre_main_upload_preview",
          file: state.webbuild.uploadedXpName,
          token: {
            target_path: token.target_path,
            runtime_state: token.runtime_state,
            sha256: token.sha256,
            size_bytes: token.size_bytes,
          },
          receipt,
        }, null, 2);
        state.webbuild.ready = true;
        updateWebbuildUI();
        status(`Uploaded test skin applied: ${state.webbuild.uploadedXpName}`, "ok");
        setWebbuildState("Webbuild ready (uploaded skin applied)", "ok");
      } catch (e) {
        $("webbuildOut").textContent = String(e);
        status("Upload test skin failed", "err");
      }
    });
  }

  async function onWebbuildUploadTestInputChange(e) {
    const file = e && e.target && e.target.files && e.target.files[0] ? e.target.files[0] : null;
    if (!file) return;
    try {
      const ab = await file.arrayBuffer();
      await applyUploadedXpBytesToWebbuild(file.name || "upload.xp", new Uint8Array(ab));
    } catch (err) {
      $("webbuildOut").textContent = String(err);
      status("Upload test skin failed to read file", "err");
    }
  }

  function moveWebbuildDockToBottom() {
    const dock = $("webbuildDockPanel");
    const inspector = $("cellInspectorPanel");
    if (!dock || !inspector || !inspector.parentElement || dock.parentElement !== inspector.parentElement) return;
    inspector.parentElement.insertBefore(dock, inspector);
  }

  function movePanelsToBottom() {
    const root = $("cellInspectorPanel")?.parentElement;
    if (!root) return;
    const ids = ["termppNativePanel", "verificationPanel"];
    for (const id of ids) {
      const el = $(id);
      if (el && el.parentElement === root) root.appendChild(el);
    }
  }

  function termppStreamRegionPayload() {
    return {
      x: Math.max(0, Number($("termppStreamX")?.value || 0)),
      y: Math.max(0, Number($("termppStreamY")?.value || 0)),
      w: Math.max(16, Number($("termppStreamW")?.value || 960)),
      h: Math.max(16, Number($("termppStreamH")?.value || 640)),
      fps: Math.max(1, Math.min(30, Number($("termppStreamFps")?.value || 4))),
    };
  }

  function persistTermppStreamRegion() {
    try {
      localStorage.setItem(TERM_STREAM_REGION_STORAGE_KEY, JSON.stringify(termppStreamRegionPayload()));
    } catch (_e) {}
  }

  function loadPersistedTermppStreamRegion() {
    try {
      const raw = localStorage.getItem(TERM_STREAM_REGION_STORAGE_KEY);
      if (!raw) return;
      const j = JSON.parse(raw);
      if (Number.isFinite(Number(j.x))) $("termppStreamX").value = String(Math.max(0, Number(j.x)));
      if (Number.isFinite(Number(j.y))) $("termppStreamY").value = String(Math.max(0, Number(j.y)));
      if (Number.isFinite(Number(j.w))) $("termppStreamW").value = String(Math.max(16, Number(j.w)));
      if (Number.isFinite(Number(j.h))) $("termppStreamH").value = String(Math.max(16, Number(j.h)));
      if (Number.isFinite(Number(j.fps))) $("termppStreamFps").value = String(Math.max(1, Math.min(30, Number(j.fps))));
    } catch (_e) {}
  }

  function stopTermppStreamPolling() {
    if (state.termppStream.pollTimer) {
      clearInterval(state.termppStream.pollTimer);
      state.termppStream.pollTimer = null;
    }
    if (state.termppStream.imgTimer) {
      clearInterval(state.termppStream.imgTimer);
      state.termppStream.imgTimer = null;
    }
  }

  function refreshTermppStreamImage() {
    if (!state.termppStream.id) return;
    const img = $("termppStreamImg");
    if (!img) return;
    img.style.display = "block";
    img.src = bp(`/api/workbench/termpp-stream/frame/${encodeURIComponent(state.termppStream.id)}?t=${Date.now()}`);
  }

  async function pollTermppStreamStatus() {
    if (!state.termppStream.id) return;
    try {
      const r = await fetch(bp(`/api/workbench/termpp-stream/status/${encodeURIComponent(state.termppStream.id)}`));
      const j = await r.json();
      if (!r.ok) {
        $("termppStreamInfo").textContent = `stream status error: ${j.error || "request failed"}`;
        return;
      }
      state.termppStream.running = !!j.running;
      const last = j.last_frame_ts ? new Date(j.last_frame_ts * 1000).toLocaleTimeString() : "n/a";
      $("termppStreamInfo").textContent = `stream=${j.stream_id} running=${j.running ? 1 : 0} frames=${j.frame_count} last=${last}${j.last_error ? ` error=${j.last_error}` : ""}`;
      if (j.region) {
        $("termppStreamX").value = String(j.region.x);
        $("termppStreamY").value = String(j.region.y);
        $("termppStreamW").value = String(j.region.w);
        $("termppStreamH").value = String(j.region.h);
      }
      if (j.has_frame) refreshTermppStreamImage();
      if (!j.running) updateTermppSkinUI();
    } catch (e) {
      $("termppStreamInfo").textContent = `stream poll error: ${e}`;
    }
  }

  function attachTermppStreamToUi(streamId) {
    stopTermppStreamPolling();
    state.termppStream.id = streamId || null;
    state.termppStream.running = !!streamId;
    if (!streamId) {
      $("termppStreamInfo").textContent = "";
      const img = $("termppStreamImg");
      if (img) {
        img.style.display = "none";
        img.removeAttribute("src");
      }
      updateTermppSkinUI();
      return;
    }
    refreshTermppStreamImage();
    state.termppStream.pollTimer = setInterval(pollTermppStreamStatus, 1000);
    state.termppStream.imgTimer = setInterval(refreshTermppStreamImage, 350);
    pollTermppStreamStatus();
    updateTermppSkinUI();
  }

  async function previewTermppEmbedStream() {
    if (!state.sessionId) {
      status("Load a workbench session first", "warn");
      return;
    }
    persistTermppStreamRegion();
    const region = termppStreamRegionPayload();
    try {
      const r = await fetch(bp("/api/workbench/termpp-stream/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: state.sessionId, dry_run: true, ...region }),
      });
      const j = await r.json();
      $("termppSkinOut").textContent = JSON.stringify(j, null, 2);
      status(r.ok ? "TERM++ embed preview ready" : "TERM++ embed preview failed", r.ok ? "ok" : "err");
    } catch (e) {
      $("termppSkinOut").textContent = String(e);
      status("TERM++ embed preview failed: fetch error", "err");
    }
  }

  async function startTermppEmbedStream() {
    if (!state.sessionId) {
      status("Load a workbench session first", "warn");
      return;
    }
    persistTermppStreamRegion();
    const region = termppStreamRegionPayload();
    try {
      status("Starting TERM++ embed stream...", "warn");
      const r = await fetch(bp("/api/workbench/termpp-stream/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: state.sessionId, dry_run: false, ...region }),
      });
      const j = await r.json();
      $("termppSkinOut").textContent = JSON.stringify(j, null, 2);
      if (!r.ok) {
        status("TERM++ embed stream failed to start", "err");
        return;
      }
      attachTermppStreamToUi(j.stream_id);
      status("TERM++ embed stream started", "ok");
    } catch (e) {
      $("termppSkinOut").textContent = String(e);
      status("TERM++ embed stream failed: fetch error", "err");
    }
  }

  async function stopTermppEmbedStream() {
    if (!state.termppStream.id) return;
    try {
      const r = await fetch(bp("/api/workbench/termpp-stream/stop"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream_id: state.termppStream.id }),
      });
      const j = await r.json();
      $("termppSkinOut").textContent = JSON.stringify(j, null, 2);
      attachTermppStreamToUi(null);
      status(r.ok ? "TERM++ embed stream stopped" : "TERM++ embed stream stop failed", r.ok ? "ok" : "err");
    } catch (e) {
      $("termppSkinOut").textContent = String(e);
      attachTermppStreamToUi(null);
      status("TERM++ embed stream stop failed: fetch error", "err");
    }
  }

  async function termppSkinCommandPreview() {
    if (!state.sessionId) {
      status("Load a workbench session first", "warn");
      return;
    }
    try {
      await saveSessionState("pre-termpp-skin-preview");
      status("Preparing TERM++ skin launch preview...", "warn");
      const r = await fetch(bp("/api/workbench/termpp-skin-command"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: state.sessionId,
          binary_name: String($("termppBinary")?.value || "game_term"),
        }),
      });
      const j = await r.json();
      $("termppSkinOut").textContent = JSON.stringify(j, null, 2);
      status(r.ok ? "TERM++ skin preview ready" : "TERM++ skin preview failed", r.ok ? "ok" : "err");
    } catch (e) {
      $("termppSkinOut").textContent = String(e);
      status("TERM++ skin preview failed: fetch error", "err");
    }
  }

  async function launchTermppSkin() {
    if (!state.sessionId) {
      status("Load a workbench session first", "warn");
      return;
    }
    try {
      await saveSessionState("pre-termpp-skin-launch");
      status("Launching TERM++ SKIN runtime...", "warn");
      const r = await fetch(bp("/api/workbench/open-termpp-skin"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: state.sessionId,
          binary_name: String($("termppBinary")?.value || "game_term"),
          dry_run: false,
        }),
      });
      const j = await r.json();
      $("termppSkinOut").textContent = JSON.stringify(j, null, 2);
      status(r.ok ? "TERM++ SKIN launch requested" : "TERM++ SKIN launch failed", r.ok ? "ok" : "err");
    } catch (e) {
      $("termppSkinOut").textContent = String(e);
      status("TERM++ SKIN launch failed: fetch error", "err");
    }
  }

  async function runWorkbenchVerification(dryRun) {
    if (!state.sessionId) {
      status("Load a workbench session first", "warn");
      return;
    }
    const profile = String($("verifyProfile")?.value || "local_xp_sanity");
    const commandTemplate = String($("verifyCommandTemplate")?.value || "");
    const timeoutSec = Math.max(1, Math.min(300, Number($("verifyTimeout")?.value || 20)));
    if (verifyProfileRequiresCommand(profile) && !commandTemplate.trim()) {
      status("Verification command template is required for this profile", "warn");
      return;
    }
    try {
      await saveSessionState(dryRun ? "pre-verify-dry-run" : "pre-verify");
      status(dryRun ? "Preparing verification dry run..." : "Running verification...", "warn");
      const payload = {
        session_id: state.sessionId,
        profile,
        command_template: commandTemplate,
        timeout_sec: timeoutSec,
        dry_run: !!dryRun,
      };
      const r = await fetch(bp("/api/workbench/run-verification"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      $("verifySummaryOut").textContent = JSON.stringify(j, null, 2);
      const logs = [];
      if (j.stdout) logs.push(String(j.stdout));
      if (j.stderr) logs.push(`[stderr]\n${String(j.stderr)}`);
      $("verifyLogOut").textContent = logs.join("\n\n");
      if (!r.ok) {
        status("Verification request failed", "err");
        return;
      }
      if (dryRun) {
        status("Verification dry run ready", "ok");
        return;
      }
      status(
        j.passed ? "Verification passed" : "Verification failed",
        j.passed ? "ok" : "err"
      );
    } catch (e) {
      $("verifyLogOut").textContent = String(e);
      status("Verification failed: fetch error", "err");
    }
  }

  async function refreshXpToolCommand(xpPath) {
    if (!xpPath) return;
    try {
      const r = await fetch(bp("/api/workbench/xp-tool-command"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xp_path: xpPath }),
      });
      const j = await r.json();
      if (!r.ok) {
        setXpToolHint(`XP Tool command unavailable: ${j.error || "request failed"}`);
        return;
      }
      setXpToolHint(`XP Tool: ${j.command}`);
    } catch (e) {
      setXpToolHint("XP Tool command unavailable: fetch error");
    }
  }

  async function openInXpTool() {
    if (!state.latestXpPath) {
      status("Export an .xp before opening XP Tool", "warn");
      return;
    }
    try {
      const r = await fetch(bp("/api/workbench/open-in-xp-tool"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xp_path: state.latestXpPath }),
      });
      const j = await r.json();
      if (!r.ok) {
        status("XP Tool launch failed", "err");
        setXpToolHint(`XP Tool launch failed: ${j.error || "request failed"}`);
        return;
      }
      status("XP Tool launch requested", "ok");
      setXpToolHint(`XP Tool: ${j.command}`);
    } catch (e) {
      status("XP Tool launch failed", "err");
      setXpToolHint("XP Tool launch failed: fetch error");
    }
  }

  async function exportAuthoringArtifact() {
    if (!state.sessionId) {
      status("Create or load a session first", "err");
      return;
    }
    
    const domain = $("domainSelect")?.value || "skin";
    const presentationKind = $("presentationKindSelect")?.value || "idle_walk";
    const variation = $("variationSelect")?.value || "default";
    
    status("Exporting authoring artifact...", "warn");
    
    try {
      const r = await fetch(bp("/api/workbench/actor-visual-profile/export"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: state.sessionId,
          domain: domain,
          presentation_kind: presentationKind,
          variation: variation,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        status(`Export failed: ${j.error || "unknown"}`, "err");
        return;
      }
      
      // Display export result
      $("exportOut").textContent = JSON.stringify(j, null, 2);
      status(`Authoring artifact exported: ${j.profile_id}`, "ok");
      
      // Auto-download the JSON file (cross-browser compatible)
      const blob = new Blob([JSON.stringify(j, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${j.profile_id}_artifact.json`;
      document.body.appendChild(a);  // Required for Firefox/Safari
      a.click();
      document.body.removeChild(a);  // Clean up
      setTimeout(() => URL.revokeObjectURL(url), 100);  // Delay to allow download to start
    } catch (e) {
      status(`Export error: ${e}`, "err");
    }
  }

  function deepCloneCells(cells) {
    return cells.map((c) => ({
      idx: Number(c.idx),
      glyph: Number(c.glyph || 0),
      fg: [Number(c.fg?.[0] || 0), Number(c.fg?.[1] || 0), Number(c.fg?.[2] || 0)],
      bg: [Number(c.bg?.[0] || 0), Number(c.bg?.[1] || 0), Number(c.bg?.[2] || 0)],
    }));
  }

  function cloneBox(b) {
    if (!b) return null;
    return { ...b };
  }

  function cloneBoxes(list) {
    return (list || []).map((b) => ({ ...b }));
  }

  function cloneCuts(list) {
    return (list || []).map((c) => ({ ...c }));
  }

  function snapshot() {
    return {
      cells: deepCloneCells(state.cells),
      layers: state.layers.map((l) => deepCloneCells(l)),
      hasUploadedLayers: !!state.hasUploadedLayers,
      layerNames: [...state.layerNames],
      activeLayer: state.activeLayer,
      visibleLayers: new Set(state.visibleLayers),
      lockedLayers: new Set(state.lockedLayers),
      gridCols: state.gridCols,
      gridRows: state.gridRows,
      angles: state.angles,
      anims: [...state.anims],
      projs: state.projs,
      sourceProjs: state.sourceProjs,
      cellWChars: state.cellWChars,
      cellHChars: state.cellHChars,
      wholeSheetCanvasZoom: state.wholeSheetCanvasZoom,
      wholeSheetGridVisible: !!state.wholeSheetGridVisible,
      wholeSheetGridStep: String(state.wholeSheetGridStep || "frame"),
      wholeSheetGridCustomW: Math.max(1, Number(state.wholeSheetGridCustomW || 1)),
      wholeSheetGridCustomH: Math.max(1, Number(state.wholeSheetGridCustomH || 1)),
      selectedFrames: [...state.selectedFrames],
      selectionAnchor: state.selectionAnchor ? { ...state.selectionAnchor } : null,
      selectionFocus: state.selectionFocus ? { ...state.selectionFocus } : null,
      selectedRow: state.selectedRow,
      selectedCols: [...state.selectedCols],
      rowCategories: { ...state.rowCategories },
      frameGroups: JSON.parse(JSON.stringify(state.frameGroups)),
      anchorBox: state.anchorBox ? { ...state.anchorBox } : null,
      extractedBoxes: state.extractedBoxes.map((b) => ({ ...b })),
      sourceMode: state.sourceMode,
      sourceSelection: [...state.sourceSelection],
      sourceCutsV: cloneCuts(state.sourceCutsV),
      sourceCutsH: cloneCuts(state.sourceCutsH),
      sourceSelectedCut: state.sourceSelectedCut ? { ...state.sourceSelectedCut } : null,
      sourceNextId: Number(state.sourceNextId || 1),
      rapidManualAdd: !!state.rapidManualAdd,
    };
  }

  function restore(snap) {
    // Restore full layer state from snapshot (prevents non-L2 data loss on undo/redo).
    if (Array.isArray(snap.layers) && snap.layers.length > 0) {
      state.layers = snap.layers.map((l) => deepCloneCells(l));
      state.hasUploadedLayers = !!snap.hasUploadedLayers;
      state.layerNames = Array.isArray(snap.layerNames) ? [...snap.layerNames] : [...DEFAULT_LAYER_NAMES];
      state.activeLayer = typeof snap.activeLayer === "number" ? snap.activeLayer : 2;
      state.visibleLayers = snap.visibleLayers instanceof Set ? new Set(snap.visibleLayers) : new Set([2]);
      state.lockedLayers = snap.lockedLayers instanceof Set ? new Set(snap.lockedLayers) : new Set();
      state.gridCols = typeof snap.gridCols === "number" ? snap.gridCols : state.gridCols;
      state.gridRows = typeof snap.gridRows === "number" ? snap.gridRows : state.gridRows;
      // Derive state.cells from layers[2] — layers are the source of truth.
      state.cells = state.layers[2] ? deepCloneCells(state.layers[2]) : deepCloneCells(snap.cells);
    } else {
      // Legacy snapshot without layers — fall back to cells then syncLayersFromSessionCells.
      state.cells = deepCloneCells(snap.cells);
      syncLayersFromSessionCells();
    }
    state.angles = Number(snap.angles || 1);
    state.anims = (snap.anims || [1]).map((x) => Number(x));
    state.sourceProjs = Number(snap.sourceProjs || state.sourceProjs || 1);
    state.projs = Number(snap.projs || 1);
    state.cellWChars = Number(snap.cellWChars || state.cellWChars || 1);
    state.cellHChars = Number(snap.cellHChars || state.cellHChars || 1);
    state.wholeSheetCanvasZoom = Number.isFinite(Number(snap.wholeSheetCanvasZoom)) ? Number(snap.wholeSheetCanvasZoom) : state.wholeSheetCanvasZoom;
    state.wholeSheetGridVisible = !!snap.wholeSheetGridVisible;
    state.wholeSheetGridStep = String(snap.wholeSheetGridStep || state.wholeSheetGridStep || "frame");
    state.wholeSheetGridCustomW = Math.max(1, Number(snap.wholeSheetGridCustomW || state.wholeSheetGridCustomW || 1));
    state.wholeSheetGridCustomH = Math.max(1, Number(snap.wholeSheetGridCustomH || state.wholeSheetGridCustomH || 1));
    const legacySelectedFrames = Number.isFinite(Number(snap.selectedRow))
      ? (snap.selectedCols || []).map((x) => ({ row: Number(snap.selectedRow), col: Number(x) }))
      : [];
    state.selectedFrames = new Set((snap.selectedFrames || legacySelectedFrames).map((coord) => `${Number(coord?.row)}:${Number(coord?.col)}`));
    state.selectionAnchor = snap.selectionAnchor ? { ...snap.selectionAnchor } : null;
    state.selectionFocus = snap.selectionFocus ? { ...snap.selectionFocus } : null;
    syncDerivedGridSelectionState();
    state.rowCategories = { ...(snap.rowCategories || {}) };
    state.frameGroups = JSON.parse(JSON.stringify(snap.frameGroups || []));
    state.anchorBox = snap.anchorBox ? { ...snap.anchorBox } : null;
    state.extractedBoxes = (snap.extractedBoxes || []).map((b) => ({ ...b }));
    state.sourceMode = String(snap.sourceMode || "select");
    state.sourceSelection = new Set((snap.sourceSelection || []).map((x) => Number(x)));
    state.sourceCutsV = cloneCuts(snap.sourceCutsV || []);
    state.sourceCutsH = cloneCuts(snap.sourceCutsH || []);
    state.sourceSelectedCut = snap.sourceSelectedCut ? { ...snap.sourceSelectedCut } : null;
    state.sourceNextId = Math.max(1, Number(snap.sourceNextId || 1));
    state.rapidManualAdd = !!snap.rapidManualAdd;
    state.drawMode = state.sourceMode === "draw_box";
    state.drawCurrent = null;
    state.drawStart = null;
    state.drawing = false;
    state.sourceDrag = null;
    state.sourceRowDrag = null;
    state.sourceContextTarget = null;
    const rapid = $("rapidManualAdd");
    if (rapid) rapid.checked = !!state.rapidManualAdd;
    recomputeFrameGeometry();
      updateSourceToolUI();
      updateVerifyUI();
      updateTermppSkinUI();
      updateWebbuildUI();
      renderAll();
  }

  function pushHistory() {
    state.history.push(snapshot());
    if (state.history.length > 50) state.history.shift();
    state.future = [];
    markSessionDirty("edit");
    updateUndoRedoButtons();
  }

  function revertNoopHistory(wasDirty) {
    if (state.history.length) state.history.pop();
    updateUndoRedoButtons();
    if (!wasDirty) {
      state.sessionDirty = false;
      updateSessionDirtyBadge();
    }
  }

  function getWholeSheetHistoryState() {
    const wsEditor = window.__wholeSheetEditor;
    if (!wsEditor || typeof wsEditor.getState !== "function") {
      return { canUndo: false, canRedo: false, historyDepth: 0, futureDepth: 0 };
    }
    try {
      const st = wsEditor.getState();
      if (!st || !st.mounted) {
        return { canUndo: false, canRedo: false, historyDepth: 0, futureDepth: 0 };
      }
      return {
        canUndo: !!st.canUndo,
        canRedo: !!st.canRedo,
        historyDepth: Math.max(0, Number(st.historyDepth || 0)),
        futureDepth: Math.max(0, Number(st.futureDepth || 0)),
      };
    } catch (_err) {
      return { canUndo: false, canRedo: false, historyDepth: 0, futureDepth: 0 };
    }
  }

  function wholeSheetCanUndo() {
    const wsEditor = window.__wholeSheetEditor;
    return !!(wsEditor && typeof wsEditor.undo === "function" && getWholeSheetHistoryState().canUndo);
  }

  function wholeSheetCanRedo() {
    const wsEditor = window.__wholeSheetEditor;
    return !!(wsEditor && typeof wsEditor.redo === "function" && getWholeSheetHistoryState().canRedo);
  }

  function combinedHistoryState() {
    const wsHistory = getWholeSheetHistoryState();
    return {
      historyDepth: state.history.length + wsHistory.historyDepth,
      futureDepth: state.future.length + wsHistory.futureDepth,
      wrapperHistoryDepth: state.history.length,
      wrapperFutureDepth: state.future.length,
      wholeSheetHistoryDepth: wsHistory.historyDepth,
      wholeSheetFutureDepth: wsHistory.futureDepth,
    };
  }

  function updateUndoRedoButtons() {
    const wsHistory = getWholeSheetHistoryState();
    $("undoBtn").disabled = state.history.length === 0 && !wsHistory.canUndo;
    $("redoBtn").disabled = state.future.length === 0 && !wsHistory.canRedo;
  }

  function undo() {
    if (!state.history.length && wholeSheetCanUndo()) {
      window.__wholeSheetEditor.undo();
      return;
    }
    if (!state.history.length) return;
    state.future.push(snapshot());
    const prev = state.history.pop();
    restore(prev);
    updateUndoRedoButtons();
    saveSessionState("undo");
  }

  function redo() {
    if (!state.future.length && wholeSheetCanRedo()) {
      window.__wholeSheetEditor.redo();
      return;
    }
    if (!state.future.length) return;
    state.history.push(snapshot());
    const next = state.future.pop();
    restore(next);
    updateUndoRedoButtons();
    saveSessionState("redo");
  }

  function recomputeFrameGeometry() {
    const frameCols = authoringFrameCols();
    const frameRows = Math.max(1, state.angles);
    const computedW = Math.max(1, Math.floor(state.gridCols / frameCols));
    const computedH = Math.max(1, Math.floor(state.gridRows / frameRows));
    // Prefer metadata char geometry when integer division is not exact.
    state.frameWChars = state.gridCols % frameCols === 0 ? computedW : Math.max(1, Number(state.cellWChars || computedW));
    state.frameHChars = state.gridRows % frameRows === 0 ? computedH : Math.max(1, Number(state.cellHChars || computedH));
    $("previewAngle").max = String(Math.max(0, state.angles - 1));
  }

  function cellAt(x, y) {
    const idx = y * state.gridCols + x;
    const layer = state.layers[2];
    if (layer && layer[idx]) return layer[idx];
    return { idx, glyph: 0, fg: [0, 0, 0], bg: [...MAGENTA] };
  }

  function setCell(x, y, c, layerIndex) {
    const idx = y * state.gridCols + x;
    const cell = {
      idx,
      glyph: Number(c.glyph || 0),
      fg: [Number(c.fg?.[0] || 0), Number(c.fg?.[1] || 0), Number(c.fg?.[2] || 0)],
      bg: [Number(c.bg?.[0] || 0), Number(c.bg?.[1] || 0), Number(c.bg?.[2] || 0)],
    };
    const resolvedLayerIndex = Number.isInteger(layerIndex) ? layerIndex : state.activeLayer;
    const targetLayer = state.layers[resolvedLayerIndex];
    if (targetLayer) targetLayer[idx] = { ...cell };
  }

  function isMagenta(rgb) {
    return rgb[0] === 255 && rgb[1] === 0 && rgb[2] === 255;
  }

  function colorsEqual(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return Number(a[0]) === Number(b[0]) && Number(a[1]) === Number(b[1]) && Number(a[2]) === Number(b[2]);
  }

  function rgbToHex(rgb) {
    const r = Math.max(0, Math.min(255, Number(rgb?.[0] || 0)));
    const g = Math.max(0, Math.min(255, Number(rgb?.[1] || 0)));
    const b = Math.max(0, Math.min(255, Number(rgb?.[2] || 0)));
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }

  function hexToRgb(hex) {
    const s = String(hex || "").trim();
    const m = /^#?([0-9a-fA-F]{6})$/.exec(s);
    if (!m) return [255, 255, 255];
    const n = m[1];
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
  }

  function decodeCellHalves(c) {
    const glyph = Number(c?.glyph || 0);
    const fg = Array.isArray(c?.fg) ? [...c.fg] : [0, 0, 0];
    const bg = Array.isArray(c?.bg) ? [...c.bg] : [...MAGENTA];
    const bgColor = isMagenta(bg) ? null : bg;
    if (glyph === 219) return { top: fg, bottom: fg };
    if (glyph === 223) return { top: fg, bottom: bgColor };
    if (glyph === 220) return { top: bgColor, bottom: fg };
    if (glyph === 0 || glyph === 32) return { top: bgColor, bottom: bgColor };
    return { top: fg, bottom: fg };
  }

  function encodeCellHalves(top, bottom, prevCell) {
    const prev = prevCell || { glyph: 0, fg: [255, 255, 255], bg: [...MAGENTA] };
    const fgPrev = Array.isArray(prev.fg) ? [...prev.fg] : [255, 255, 255];
    const out = { glyph: 0, fg: fgPrev, bg: [...MAGENTA] };
    if (!top && !bottom) return out;
    if (colorsEqual(top, bottom) && top) {
      out.glyph = 219;
      out.fg = [...top];
      return out;
    }
    if (top && !bottom) {
      out.glyph = 223;
      out.fg = [...top];
      out.bg = [...MAGENTA];
      return out;
    }
    if (!top && bottom) {
      out.glyph = 220;
      out.fg = [...bottom];
      out.bg = [...MAGENTA];
      return out;
    }
    out.glyph = 223;
    out.fg = [...top];
    out.bg = [...bottom];
    return out;
  }

  function updateInspectorToolUI() {
    const map = [
      ["inspectorToolInspectBtn", "inspect"],
      ["inspectorToolSelectBtn", "select"],
      ["inspectorToolGlyphBtn", "glyph"],
      ["inspectorToolPaintBtn", "paint"],
      ["inspectorToolEraseBtn", "erase"],
      ["inspectorToolDropperBtn", "dropper"],
    ];
    for (const [id, key] of map) {
      const el = $(id);
      if (!el) continue;
      el.classList.toggle("tool-active", state.inspectorTool === key);
    }
    const colorInput = $("inspectorPaintColor");
    if (colorInput) colorInput.value = rgbToHex(state.inspectorPaintColor);
    const glyphCode = $("inspectorGlyphCode");
    if (glyphCode) glyphCode.value = String(clampInspectorGlyphCode(state.inspectorGlyphCode));
    const glyphChar = $("inspectorGlyphChar");
    if (glyphChar) {
      const g = clampInspectorGlyphCode(state.inspectorGlyphCode);
      glyphChar.value = g >= 32 && g <= 255 ? String.fromCharCode(g) : "";
    }
    const glyphFg = $("inspectorGlyphFgColor");
    if (glyphFg) glyphFg.value = rgbToHex(state.inspectorGlyphFgColor);
    const glyphBg = $("inspectorGlyphBgColor");
    if (glyphBg) glyphBg.value = rgbToHex(state.inspectorGlyphBgColor);
    const hint = $("inspectorToolHint");
    if (!hint) return;
    const clipState = state.inspectorFrameClipboard ? " Frame clipboard: yes." : "";
    const selClipState = state.inspectorSelectionClipboard ? " Selection clipboard: yes." : "";
    const base = `Embedded XP frame editor. Visual layer only. Shortcuts: G glyph, S select, P/E half paint/erase, I dropper, Q/R angle nav, A/D frame nav, C/X/V selection copy/cut/paste, F frame flip-H, Delete clear sel/frame.${clipState}${selClipState}`;
    if (state.inspectorTool === "paint") hint.textContent = `${base} Drag to paint half-cells.`;
    else if (state.inspectorTool === "erase") hint.textContent = `${base} Drag to erase half-cells to transparent.`;
    else if (state.inspectorTool === "dropper") hint.textContent = `${base} Click a half-cell to sample color.`;
    else if (state.inspectorTool === "glyph") hint.textContent = `${base} Click/drag to stamp full XP cells (glyph + FG/BG).`;
    else if (state.inspectorTool === "select") hint.textContent = `${base} Drag a rectangle selection (cell coordinates).`;
    else hint.textContent = base;
    const showGrid = $("inspectorShowGrid");
    const showChecker = $("inspectorShowChecker");
    if (showGrid) showGrid.checked = !!state.inspectorShowGrid;
    const gridStep = $("inspectorGridStep");
    if (gridStep) gridStep.value = String(state.inspectorGridStep || 1);
    if (showChecker) showChecker.checked = !!state.inspectorShowChecker;
    const pasteBtn = $("inspectorPasteFrameBtn");
    if (pasteBtn) pasteBtn.disabled = !state.inspectorFrameClipboard;
    const pasteSelBtn = $("inspectorPasteSelBtn");
    if (pasteSelBtn) pasteSelBtn.disabled = !state.inspectorSelectionClipboard;
    const needSel = !normalizeInspectorSelection(state.inspectorSelection);
    for (const id of ["inspectorCopySelBtn", "inspectorCutSelBtn", "inspectorClearSelBtn", "inspectorFillSelBtn", "inspectorReplaceFgBtn", "inspectorReplaceBgBtn"]) {
      const el = $(id);
      if (el) el.disabled = needSel;
    }
    for (const id of ["inspectorRotateSelCwBtn", "inspectorRotateSelCcwBtn", "inspectorFlipSelHBtn", "inspectorFlipSelVBtn"]) {
      const el = $(id);
      if (el) el.disabled = needSel;
    }
    const selAllBtn = $("inspectorSelectAllBtn");
    if (selAllBtn) selAllBtn.disabled = !state.inspectorOpen;
    const hasMatchSource = !!state.inspectorLastInspectCell;
    for (const id of ["inspectorReplaceFgBtn", "inspectorReplaceBgBtn"]) {
      const el = $(id);
      if (el) el.disabled = needSel || !hasMatchSource;
    }
    const matchInfo = $("inspectorMatchSourceInfo");
    if (matchInfo) {
      if (!hasMatchSource) {
        matchInfo.textContent = "Match source: none (use Inspect or Dropper on a cell)";
      } else {
        const s = state.inspectorLastInspectCell;
        matchInfo.textContent = `Match source: glyph=${clampInspectorGlyphCode(s.glyph)} fg=${rgbToHex(s.fg)} bg=${rgbToHex(s.bg)}`;
      }
    }
    const hoverInfo = $("inspectorHoverReadout");
    if (hoverInfo) {
      if (!state.inspectorHover || !state.inspectorHover.cell) hoverInfo.textContent = "Hover: none";
      else {
        const h = state.inspectorHover;
        hoverInfo.textContent = `Hover: x=${h.cx} y=${h.cy} half=${h.half} glyph=${Number(h.cell.glyph || 0)} fg=${rgbToHex(h.cell.fg || [0, 0, 0])} bg=${rgbToHex(h.cell.bg || [0, 0, 0])}`;
      }
    }
    const pasteAnchorInfo = $("inspectorPasteAnchorReadout");
    if (pasteAnchorInfo) {
      if (state.inspectorHover) {
        pasteAnchorInfo.textContent = `Paste anchor: x=${Number(state.inspectorHover.cx || 0)} y=${Number(state.inspectorHover.cy || 0)} (current hover)`;
      } else if (state.inspectorLastHoverAnchor) {
        pasteAnchorInfo.textContent = `Paste anchor: x=${Number(state.inspectorLastHoverAnchor.cx || 0)} y=${Number(state.inspectorLastHoverAnchor.cy || 0)} (last hovered cell)`;
      } else {
        pasteAnchorInfo.textContent = "Paste anchor: none (hover a cell, then click Paste Sel)";
      }
    }
    const frApply = $("inspectorFindReplaceApplyBtn");
    const frScope = String($("inspectorFrScope")?.value || "selection");
    if (frApply) frApply.disabled = (frScope === "selection" && needSel);
  }

  function renderInspectorPaletteSwatches() {
    const box = $("inspectorPaletteSwatches");
    if (!box) return;
    if (box.childElementCount) return;
    for (const rgb of INSPECTOR_SWATCHES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = `Paint+FG click / BG right-click ${rgbToHex(rgb)}`;
      btn.style.width = "18px";
      btn.style.height = "18px";
      btn.style.padding = "0";
      btn.style.border = "1px solid #334";
      btn.style.background = rgbToHex(rgb);
      btn.dataset.color = rgb.join(",");
      btn.addEventListener("click", () => {
        state.inspectorPaintColor = [...rgb];
        state.inspectorGlyphFgColor = [...rgb];
        updateInspectorToolUI();
        renderInspector();
      });
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        state.inspectorGlyphBgColor = [...rgb];
        updateInspectorToolUI();
        renderInspector();
      });
      box.appendChild(btn);
    }
  }

  function transparentCell(idx) {
    return { idx, glyph: 0, fg: [0, 0, 0], bg: [...MAGENTA] };
  }

  function digitGlyph(v) {
    if (v >= 0 && v <= 9) return 48 + v;
    if (v >= 10 && v <= 35) return 65 + (v - 10);
    return 0;
  }

  function buildMetadataLayerCells() {
    const count = state.gridCols * state.gridRows;
    const layer = [];
    for (let i = 0; i < count; i++) layer.push(transparentCell(i));
    if (state.gridCols <= 0 || state.gridRows <= 0) return layer;
    layer[0] = { idx: 0, glyph: digitGlyph(state.angles), fg: [255, 255, 255], bg: [0, 0, 0] };
    for (let i = 0; i < state.anims.length && i + 1 < state.gridCols; i++) {
      layer[i + 1] = { idx: i + 1, glyph: digitGlyph(Number(state.anims[i] || 0)), fg: [255, 255, 255], bg: [0, 0, 0] };
    }
    return layer;
  }

  function applyMetadataRowToLayer(layer) {
    const count = state.gridCols * state.gridRows;
    const base = Array.isArray(layer) && layer.length === count ? deepCloneCells(layer) : buildBlankLayerCells();
    if (count <= 0 || state.gridCols <= 0 || state.gridRows <= 0) return base;
    for (let x = 0; x < state.gridCols; x++) {
      const idx = x;
      base[idx] = transparentCell(idx);
    }
    base[0] = { idx: 0, glyph: digitGlyph(state.angles), fg: [255, 255, 255], bg: [0, 0, 0] };
    for (let i = 0; i < state.anims.length && i + 1 < state.gridCols; i++) {
      const idx = i + 1;
      base[idx] = { idx, glyph: digitGlyph(Number(state.anims[i] || 0)), fg: [255, 255, 255], bg: [0, 0, 0] };
    }
    return base;
  }

  function buildBlankLayerCells() {
    const count = state.gridCols * state.gridRows;
    const layer = [];
    for (let i = 0; i < count; i++) layer.push(transparentCell(i));
    return layer;
  }

  function syncLayersFromSessionCells() {
    const count = state.gridCols * state.gridRows;

    if (state.hasUploadedLayers
        && Array.isArray(state.layers) && state.layers.length > 0
        && state.layers.every((l) => Array.isArray(l) && l.length === count)) {
      // Uploaded-XP session: layers are the source of truth.
      // Derive state.cells (compatibility mirror) from layers[2].
      if (state.layers.length > 2) {
        state.cells = deepCloneCells(state.layers[2]);
      } else {
        state.cells = buildBlankLayerCells();
      }
    } else {
      // Non-upload session or grid dimensions changed: synthetic rebuild.
      // state.cells drives the initial L2 content, then becomes a mirror.
      if (!Array.isArray(state.cells) || state.cells.length !== count) {
        state.cells = buildBlankLayerCells();
      }
      state.hasUploadedLayers = false;
      state.layers = [
        buildMetadataLayerCells(),
        buildBlankLayerCells(),
        deepCloneCells(state.cells),
        buildBlankLayerCells(),
      ];
      state.layerNames = [...DEFAULT_LAYER_NAMES];
    }

    if (state.activeLayer < 0 || state.activeLayer >= state.layers.length) state.activeLayer = 2;
    if (!state.visibleLayers || state.visibleLayers.size <= 0) state.visibleLayers = new Set([2]);
    if (![...state.visibleLayers].some((v) => v >= 0 && v < state.layers.length)) {
      state.visibleLayers = new Set([2]);
    }
  }

  function layerCellAt(layerIdx, x, y) {
    const idx = y * state.gridCols + x;
    const layer = state.layers[layerIdx];
    if (!layer || !layer[idx]) return transparentCell(idx);
    return layer[idx];
  }

  function cellForRender(x, y) {
    const idx = y * state.gridCols + x;
    let out = transparentCell(idx);
    for (let l = 0; l < state.layers.length; l++) {
      if (!state.visibleLayers.has(l)) continue;
      const c = layerCellAt(l, x, y);
      if (Number(c.glyph || 0) > 32) out = c;
    }
    return out;
  }

  function editableLayerActive() {
    return state.activeLayer === 2;
  }

  function renderLayerControls() {
    const sel = $("layerSelect");
    const vis = $("layerVisibility");
    if (!sel || !vis) return;
    sel.innerHTML = "";
    for (let i = 0; i < state.layers.length; i++) {
      const opt = document.createElement("option");
      const nm = state.layerNames[i] || `Layer ${i}`;
      opt.value = String(i);
      opt.textContent = `${i}: ${nm}`;
      sel.appendChild(opt);
    }
    sel.value = String(Math.max(0, Math.min(state.layers.length - 1, state.activeLayer)));
    vis.innerHTML = "";
    for (let i = 0; i < state.layers.length; i++) {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state.visibleLayers.has(i);
      cb.dataset.layer = String(i);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(state.layerNames[i] || `Layer ${i}`));
      vis.appendChild(label);
    }
    const hint = $("layerHint");
    if (hint) {
      hint.textContent = editableLayerActive()
        ? "Active layer editable. Double-click frame to inspect and zoom."
        : "Active layer is read-only. Visual layer (2) is editable.";
    }
  }

  function drawHalfCell(ctx, px, py, scale, glyph, fg, bg) {
    const topY = py;
    const botY = py + scale;
    const drawRect = (x, y, color) => {
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, scale, scale);
    };
    const fgCss = `rgb(${fg[0]},${fg[1]},${fg[2]})`;
    const bgCss = isMagenta(bg) ? null : `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    if (glyph === 219) {
      drawRect(px, topY, fgCss);
      drawRect(px, botY, fgCss);
      return;
    }
    if (glyph === 223) {
      drawRect(px, topY, fgCss);
      drawRect(px, botY, bgCss);
      return;
    }
    if (glyph === 220) {
      drawRect(px, topY, bgCss);
      drawRect(px, botY, fgCss);
      return;
    }
    if (glyph === 0 || glyph === 32) {
      drawRect(px, topY, bgCss);
      drawRect(px, botY, bgCss);
      return;
    }
    drawRect(px, topY, fgCss);
    drawRect(px, botY, fgCss);
  }

  function renderLegacyGrid() {
    const grid = $("grid");
    const cols = state.gridCols;
    const rows = state.gridRows;
    grid.innerHTML = "";
    grid.style.gridTemplateColumns = `repeat(${cols}, 22px)`;
    for (let i = 0; i < cols * rows; i++) {
      const c = document.createElement("div");
      c.className = "cell";
      const x = i % cols;
      const y = Math.floor(i / cols);
      c.dataset.x = String(x);
      c.dataset.y = String(y);
      const cell = cellForRender(x, y);
      if (cell) {
        const glyph = Number(cell.glyph || 32);
        c.textContent = glyph <= 32 ? "·" : String.fromCharCode(glyph);
        const fg = Array.isArray(cell.fg) ? cell.fg : [220, 220, 220];
        const bg = Array.isArray(cell.bg) ? cell.bg : [0, 0, 0];
        c.style.color = glyph <= 32 ? "rgb(70,80,95)" : `rgb(${fg[0]},${fg[1]},${fg[2]})`;
        c.style.backgroundColor = isMagenta(bg) ? "rgb(11,15,23)" : `rgb(${bg[0]},${bg[1]},${bg[2]})`;
      } else {
        c.textContent = "·";
        c.style.color = "rgb(70,80,95)";
      }
      grid.appendChild(c);
    }
  }

  function selectedFrameColsTotal() {
    return selectedColsForRow(state.selectedRow);
  }

  function authoringProjectionCount() {
    return Math.max(1, Number(state.projs || 1));
  }

  function semanticFrameCount() {
    return Math.max(1, state.anims.reduce((a, b) => a + b, 0));
  }

  function authoringFrameCols() {
    return Math.max(1, semanticFrameCount() * authoringProjectionCount());
  }

  function frameSelectionKey(row, col) {
    return `${Number(row)}:${Number(col)}`;
  }

  function parseFrameSelectionKey(key) {
    const [rowPart, colPart] = String(key || "").split(":");
    const row = Number(rowPart);
    const col = Number(colPart);
    if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
    return { row, col };
  }

  function normalizeSelectionCoord(coord) {
    if (!coord) return null;
    const maxRow = Math.max(0, Number(state.angles || 1) - 1);
    const maxCol = Math.max(0, authoringFrameCols() - 1);
    const row = Math.round(Number(coord.row));
    const col = Math.round(Number(coord.col));
    if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
    return {
      row: Math.max(0, Math.min(maxRow, row)),
      col: Math.max(0, Math.min(maxCol, col)),
    };
  }

  function selectedFrameCoordsSorted() {
    return [...(state.selectedFrames || [])]
      .map(parseFrameSelectionKey)
      .filter(Boolean)
      .sort((a, b) => (a.row - b.row) || (a.col - b.col));
  }

  function selectedRowsSorted() {
    return [...new Set(selectedFrameCoordsSorted().map((coord) => Number(coord.row)))].sort((a, b) => a - b);
  }

  function selectedColsForRow(row) {
    if (!Number.isFinite(Number(row))) return [];
    return selectedFrameCoordsSorted()
      .filter((coord) => Number(coord.row) === Number(row))
      .map((coord) => Number(coord.col));
  }

  function hasGridSelection() {
    return selectedFrameCoordsSorted().length > 0;
  }

  function hasSingleSelectedRow() {
    return selectedRowsSorted().length === 1 && hasGridSelection();
  }

  function selectionContainsFrame(row, col) {
    return !!state.selectedFrames?.has(frameSelectionKey(row, col));
  }

  function rowHasSelectedFrames(row) {
    return selectedColsForRow(row).length > 0;
  }

  function syncDerivedGridSelectionState() {
    const coords = selectedFrameCoordsSorted();
    if (!coords.length) {
      state.selectionAnchor = null;
      state.selectionFocus = null;
      state.selectedRow = null;
      state.selectedCols = new Set();
      return;
    }
    const focus = normalizeSelectionCoord(state.selectionFocus);
    const focusKey = focus ? frameSelectionKey(focus.row, focus.col) : "";
    const resolvedFocus = focus && state.selectedFrames.has(focusKey)
      ? focus
      : { ...coords[coords.length - 1] };
    state.selectionFocus = { ...resolvedFocus };
    state.selectedRow = Number(resolvedFocus.row);
    state.selectedCols = new Set(selectedColsForRow(resolvedFocus.row));
    if (!state.selectedCols.size) {
      const first = coords[0];
      state.selectionFocus = { ...first };
      state.selectedRow = Number(first.row);
      state.selectedCols = new Set(selectedColsForRow(first.row));
    }
    const anchor = normalizeSelectionCoord(state.selectionAnchor);
    const anchorKey = anchor ? frameSelectionKey(anchor.row, anchor.col) : "";
    state.selectionAnchor = anchor && state.selectedFrames.has(anchorKey)
      ? { ...anchor }
      : { ...coords[0] };
  }

  function setGridSelection(coords, opts = {}) {
    const normalized = [];
    const seen = new Set();
    for (const coord of coords || []) {
      const next = normalizeSelectionCoord(coord);
      if (!next) continue;
      const key = frameSelectionKey(next.row, next.col);
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(next);
    }
    state.selectedFrames = new Set(normalized.map((coord) => frameSelectionKey(coord.row, coord.col)));
    state.selectionAnchor = opts.anchor ? { ...opts.anchor } : null;
    state.selectionFocus = opts.focus ? { ...opts.focus } : null;
    syncDerivedGridSelectionState();
    if (typeof window._updateMobileStatus === 'function') window._updateMobileStatus();
  }

  function clearGridSelection() {
    setGridSelection([]);
  }

  function angleNameForIndex(i) {
    const idx = Math.max(0, Number(i || 0));
    if (state.angles === 8) {
      const names = ["South", "SouthWest", "West", "NorthWest", "North", "NorthEast", "East", "SouthEast"];
      return names[idx] || `Angle ${idx}`;
    }
    if (state.angles === 4) {
      const names = ["South", "West", "North", "East"];
      return names[idx] || `Angle ${idx}`;
    }
    if (state.angles === 1) return "South";
    return `Angle ${idx}`;
  }

  function semanticFrameLabel(row, col) {
    const info = frameColInfo(col);
    const angleName = angleNameForIndex(row);
    return `A${row} ${angleName} F${info.frame}${authoringProjectionCount() > 1 ? ` P${info.proj}` : ""}`;
  }

  function frameGridDirtyKey(row, col) {
    return `${Number(row)}:${Number(col)}`;
  }

  function markFrameGridDirtyForCell(x, y) {
    if (!state.frameGridDirtyCells) state.frameGridDirtyCells = new Set();
    const frameW = Math.max(1, Number(state.frameWChars || 1));
    const frameH = Math.max(1, Number(state.frameHChars || 1));
    const row = Math.floor(Number(y) / frameH);
    const col = Math.floor(Number(x) / frameW);
    if (row < 0 || row >= state.angles) return;
    if (col < 0 || col >= authoringFrameCols()) return;
    state.frameGridDirtyCells.add(frameGridDirtyKey(row, col));
  }

  function takeFrameGridDirtyCells() {
    const dirty = state.frameGridDirtyCells instanceof Set ? state.frameGridDirtyCells : new Set();
    state.frameGridDirtyCells = new Set();
    return [...dirty].map((key) => {
      const [row, col] = String(key).split(":").map((value) => Number(value));
      return { row, col };
    }).filter((coord) => Number.isFinite(coord.row) && Number.isFinite(coord.col));
  }

  function refreshFrameGridCells(coords) {
    const panel = $("gridPanel");
    if (!panel || !Array.isArray(coords) || coords.length === 0) return;
    for (const coord of coords) {
      const row = Number(coord.row);
      const col = Number(coord.col);
      const prior = panel.querySelector(`.frame-cell[data-row="${row}"][data-col="${col}"]`);
      if (!prior) continue;
      const selected = selectionContainsFrame(row, col);
      const rowSelected = rowHasSelectedFrames(row);
      const groupSelected = state.frameGroups.some((g) => Number(g.row) === row && (g.cols || []).includes(col));
      prior.replaceWith(makeFrameCanvas(row, col, selected, rowSelected, groupSelected));
    }
    enforceGridPanelFit();
  }

  function refreshDirtyFrameGridCells(opts = {}) {
    const dirtyFrames = takeFrameGridDirtyCells();
    refreshFrameGridCells(dirtyFrames);
    if (opts.updatePreview) {
      const pRow = state.selectedRow === null ? 0 : state.selectedRow;
      const previewRow = Math.max(0, Math.min(state.angles - 1, pRow));
      if (dirtyFrames.some((coord) => Number(coord.row) === previewRow && Number(coord.col) === 0)) {
        renderPreviewFrame(previewRow, 0);
      }
    }
  }

  function queueDirtyFrameGridRefresh(opts = {}) {
    if (opts.updatePreview) state.frameGridRefreshPreview = true;
    if (state.frameGridRefreshQueued) return;
    state.frameGridRefreshQueued = true;
    const run = function() {
      state.frameGridRefreshQueued = false;
      state.frameGridRefreshIdleHandle = null;
      const updatePreview = !!state.frameGridRefreshPreview;
      state.frameGridRefreshPreview = false;
      refreshDirtyFrameGridCells({ updatePreview });
    };
    if (typeof window.requestIdleCallback === "function") {
      state.frameGridRefreshIdleHandle = window.requestIdleCallback(run, { timeout: FRAME_GRID_REFRESH_IDLE_TIMEOUT_MS });
      return;
    }
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(run);
    } else {
      setTimeout(run, 0);
    }
  }

  function makeFrameCanvas(row, col, selected, rowSelected, groupSelected) {
    const frame = document.createElement("div");
    frame.className = "frame-cell";
    if (selected) frame.classList.add("selected");
    if (rowSelected) frame.classList.add("row-selected");
    if (groupSelected) frame.classList.add("group-selected");
    const dragHover = state.gridCellDrag && state.gridCellDrag.dragging && state.gridCellDrag.hover;
    if (dragHover && Number(dragHover.row) === Number(row) && Number(dragHover.col) === Number(col)) {
      frame.classList.add("drop-target");
      frame.classList.toggle("drop-mode-replace", String(dragHover.mode) === "replace");
      frame.classList.toggle("drop-mode-swap", String(dragHover.mode) === "swap");
    }
    frame.dataset.row = String(row);
    frame.dataset.col = String(col);

    const canvas = document.createElement("canvas");
    const pixW = state.frameWChars;
    const pixH = state.frameHChars * 2;
    const scale = Math.max(1, Math.floor(56 / Math.max(pixW, pixH)));
    canvas.width = pixW * scale;
    canvas.height = pixH * scale;
    const thumbCanvasPx = Math.max(40, gridPanelTilePx() - 4);
    canvas.style.width = `${thumbCanvasPx}px`;
    canvas.style.height = `${thumbCanvasPx}px`;
    canvas.style.imageRendering = "pixelated";
    const ctx = canvas.getContext("2d");
    if (state.inspectorShowChecker) {
      const sz = Math.max(2, Math.floor(zoom / 2));
      for (let y = 0; y < canvas.height; y += sz) {
        for (let x = 0; x < canvas.width; x += sz) {
          const dark = (((x / sz) | 0) + ((y / sz) | 0)) % 2 === 0;
          ctx.fillStyle = dark ? "rgb(22,26,34)" : "rgb(34,40,52)";
          ctx.fillRect(x, y, sz, sz);
        }
      }
    } else {
      ctx.fillStyle = "rgb(0,0,0)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    for (let cy = 0; cy < state.frameHChars; cy++) {
      for (let cx = 0; cx < state.frameWChars; cx++) {
        const gx = col * state.frameWChars + cx;
        const gy = row * state.frameHChars + cy;
        if (gx >= state.gridCols || gy >= state.gridRows) continue;
        const c = cellForRender(gx, gy);
        drawHalfCell(ctx, cx * scale, cy * scale * 2, scale, Number(c.glyph || 0), c.fg || [0, 0, 0], c.bg || [0, 0, 0]);
      }
    }

    const label = document.createElement("div");
    label.className = "frame-label";
    label.textContent = semanticFrameLabel(row, col);
    frame.title = `Angle ${row} (${angleNameForIndex(row)}), Frame ${frameColInfo(col).frame}${authoringProjectionCount() > 1 ? `, Proj ${frameColInfo(col).proj}` : ""}`;
    frame.appendChild(canvas);
    if (dragHover && Number(dragHover.row) === Number(row) && Number(dragHover.col) === Number(col)) {
      const overlay = document.createElement("div");
      overlay.className = "grid-drop-choice-overlay";
      const top = document.createElement("div");
      top.className = "grid-drop-choice top";
      top.textContent = "Replace";
      const bottom = document.createElement("div");
      bottom.className = "grid-drop-choice bottom";
      bottom.textContent = "Swap";
      overlay.appendChild(top);
      overlay.appendChild(bottom);
      frame.appendChild(overlay);
    }
    frame.appendChild(label);
    return frame;
  }

  function makeFrameRowHeader(row, frameCols) {
    const wrap = document.createElement("div");
    wrap.className = "frame-row-header row-header";
    if (rowHasSelectedFrames(row)) wrap.classList.add("selected");
    wrap.dataset.row = String(row);
    wrap.setAttribute("draggable", "true");

    const handle = document.createElement("div");
    handle.className = "row-drag-handle";
    handle.dataset.rowDragHandle = "1";
    handle.title = "Drag to reorder row";

    const label = document.createElement("div");
    label.className = "frame-row-label";
    label.dataset.rowLabel = "1";

    const idx = document.createElement("div");
    idx.className = "row-index";
    idx.textContent = `Row ${row}`;
    const nm = document.createElement("div");
    nm.className = "row-name";
    nm.textContent = angleNameForIndex(row);
    label.appendChild(idx);
    label.appendChild(nm);

    wrap.title = `Select ${angleNameForIndex(row)} row (${frameCols} frame slots)`;
    wrap.appendChild(handle);
    wrap.appendChild(label);
    return wrap;
  }

  function selectWholeRow(row) {
    const frameCols = authoringFrameCols();
    const coords = [];
    for (let c = 0; c < frameCols; c++) coords.push({ row, col: c });
    setGridSelection(coords, { anchor: { row, col: 0 }, focus: { row, col: 0 } });
    renderFrameGrid();
    renderJitterInfo();
    renderPreviewFrame(row, 0);
    status(`Selected row ${row} (${angleNameForIndex(row)})`, "ok");
  }

  function moveRowToIndex(fromRow, toRow) {
    const from = Math.max(0, Math.min(state.angles - 1, Number(fromRow)));
    const to = Math.max(0, Math.min(state.angles - 1, Number(toRow)));
    if (from === to) return false;
    if (!editableLayerActive()) {
      status("Selected layer is read-only. Switch to Visual layer (2) to edit.", "warn");
      return false;
    }
    const step = to > from ? 1 : -1;
    const changed = commitWholeSheetDocumentMutation("move-row-to-index", function() {
      let cur = from;
      while (cur !== to) {
        swapRowBlocks(cur, cur + step);
        cur += step;
      }
      const cols = rowHasSelectedFrames(from) ? selectedColsForRow(from) : (state.selectedRow === from ? selectedFrameColsSorted() : []);
      if (cols.length) {
        setGridSelection(cols.map((col) => ({ row: to, col })), {
          anchor: { row: to, col: cols[0] },
          focus: { row: to, col: cols[0] },
        });
      }
    });
    if (!changed) {
      status("Move row made no changes", "warn");
      return false;
    }
    status(`Moved row to ${to} (${angleNameForIndex(to)})`, "ok");
    return true;
  }

  function renderFrameGrid() {
    const panel = $("gridPanel");
    panel.innerHTML = "";
    if (state.frameGridDirtyCells) state.frameGridDirtyCells.clear();
    const frameCols = authoringFrameCols();
    updateGridPanelZoomUI();
    panel.style.gridTemplateColumns = `${gridPanelHeaderPx()}px repeat(${frameCols}, ${gridPanelTilePx()}px)`;
    for (let row = 0; row < state.angles; row++) {
      panel.appendChild(makeFrameRowHeader(row, frameCols));
      for (let col = 0; col < frameCols; col++) {
        const selected = selectionContainsFrame(row, col);
        const rowSelected = rowHasSelectedFrames(row);
        const groupSelected = state.frameGroups.some((g) => Number(g.row) === row && (g.cols || []).includes(col));
        const cellEl = makeFrameCanvas(row, col, selected, rowSelected, groupSelected);
        panel.appendChild(cellEl);
      }
    }
    updateActionButtons();
    renderJitterInfo();
    enforceGridPanelFit();
  }

  function renderMeta() {
    $("metaOut").textContent = JSON.stringify(
      {
        angles: state.angles,
        anims: state.anims,
        source_projs: state.sourceProjs,
        projs: state.projs,
        frame_w_chars: state.frameWChars,
        frame_h_chars: state.frameHChars,
        cell_w_chars: state.cellWChars,
        cell_h_chars: state.cellHChars,
        row_categories: state.rowCategories,
        frame_groups: state.frameGroups,
      },
      null,
      2
    );
  }

  function renderSession() {
    const frameColsVal = authoringFrameCols();
    const frameRowsVal = state.angles || 1;
    const summary = {
      session_id: state.sessionId,
      job_id: state.jobId,
      angles: state.angles,
      anims: state.anims,
      source_projs: state.sourceProjs,
      projs: state.projs,
      semantic_frame_cols: semanticFrameCount(),
      grid_cols: state.gridCols,
      grid_rows: state.gridRows,
      cell_w: state.cellWChars,
      cell_h: state.cellHChars,
      frame_rows: frameRowsVal,
      frame_cols: frameColsVal,
      render_resolution: Number(state.cellWChars || 0),
      cell_count: (state.layers && state.layers[2]) ? state.layers[2].length : (state.gridCols * state.gridRows),
      source_boxes: state.extractedBoxes.length,
      source_cuts_v: state.sourceCutsV.length,
      source_mode: state.sourceMode,
    };
    $("sessionOut").textContent = JSON.stringify(summary, null, 2);
  }

  function renderSourceCanvas() {
    const canvas = $("sourceCanvas");
    const ctx = canvas.getContext("2d");
    state.extractedBoxes = (state.extractedBoxes || []).map((b) =>
      (b && b.id !== undefined)
        ? { source: b.source || "auto", ...b }
        : { id: nextSourceId(), source: "auto", ...b }
    );
    const drawChecker = (w, h, size = 8) => {
      for (let y = 0; y < h; y += size) {
        for (let x = 0; x < w; x += size) {
          const even = ((Math.floor(x / size) + Math.floor(y / size)) % 2) === 0;
          ctx.fillStyle = even ? "rgb(18,24,34)" : "rgb(10,14,20)";
          ctx.fillRect(x, y, size, size);
        }
      }
    };
    const drawBoxOutline = (b, color, width = 1, dash = []) => {
      if (!b) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (dash.length) ctx.setLineDash(dash);
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, Math.max(1, b.w - 1), Math.max(1, b.h - 1));
      ctx.restore();
    };
    const drawHandles = (b, color) => {
      if (!b) return;
      const pts = [
        [b.x, b.y],
        [boxRight(b), b.y],
        [b.x, boxBottom(b)],
        [boxRight(b), boxBottom(b)],
      ];
      ctx.save();
      ctx.fillStyle = color;
      for (const [x, y] of pts) ctx.fillRect(x - 2, y - 2, 5, 5);
      ctx.restore();
    };
    if (!state.sourceImage) {
      drawChecker(canvas.width, canvas.height, 8);
      $("sourceInfo").textContent = "No source image loaded.";
      updateSourceCanvasZoomUI();
      return;
    }
    canvas.width = state.sourceImage.width;
    canvas.height = state.sourceImage.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawChecker(canvas.width, canvas.height, 8);
    ctx.drawImage(state.sourceImage, 0, 0);

    for (const cut of state.sourceCutsV) {
      const selected = state.sourceSelectedCut && state.sourceSelectedCut.type === "v" && Number(state.sourceSelectedCut.id) === Number(cut.id);
      ctx.save();
      ctx.strokeStyle = selected ? "rgba(255,95,95,0.95)" : "rgba(168,99,255,0.9)";
      ctx.lineWidth = selected ? 2 : 1;
      ctx.setLineDash(selected ? [] : [4, 3]);
      ctx.beginPath();
      ctx.moveTo(cut.x + 0.5, 0);
      ctx.lineTo(cut.x + 0.5, canvas.height);
      ctx.stroke();
      ctx.restore();
    }

    for (const b of state.extractedBoxes) {
      const selected = state.sourceSelection.has(Number(b.id));
      drawBoxOutline(b, selected ? "rgba(99,255,219,0.98)" : "rgba(243,182,63,0.95)", selected ? 2 : 1);
      if (selected) drawHandles(b, "rgba(99,255,219,0.98)");
    }
    if (state.anchorBox) {
      drawBoxOutline(state.anchorBox, "rgba(79,209,122,0.95)", 2, [5, 3]);
    }
    if (state.drawCurrent) {
      drawBoxOutline(state.drawCurrent, "rgba(78,161,255,0.98)", 2);
      drawHandles(state.drawCurrent, "rgba(78,161,255,0.98)");
    }
    if (state.sourceRowDrag?.rect) {
      const mode = state.sourceRowDrag.mode;
      const c = mode === "col_select" ? "rgba(255,123,63,0.85)" : "rgba(255,230,63,0.85)";
      ctx.save();
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      const r = state.sourceRowDrag.rect;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(1, r.w - 1), Math.max(1, r.h - 1));
      ctx.restore();
    }

    const anchorTxt = state.anchorBox ? ` anchor=${state.anchorBox.w}x${state.anchorBox.h}` : "";
    const draftTxt = state.drawCurrent ? ` draft=${state.drawCurrent.w}x${state.drawCurrent.h}` : "";
    const selTxt = ` selected=${state.sourceSelection.size}`;
    const cutTxt = ` cutsV=${state.sourceCutsV.length}`;
    $("sourceInfo").textContent = `sprites_detected=${state.extractedBoxes.length}${anchorTxt}${draftTxt}${selTxt}${cutTxt}`;
    updateSourceCanvasZoomUI();
  }

  function renderPreviewFrame(row, frame) {
    const canvas = $("previewCanvas");
    const ctx = canvas.getContext("2d");
    const semanticFrames = semanticFrameCount();
    const col = Math.min(Math.max(0, frame), semanticFrames - 1);
    const pixW = state.frameWChars;
    const pixH = state.frameHChars * 2;
    const scale = Math.max(1, Math.floor(Math.min(canvas.width / pixW, canvas.height / pixH)));
    const drawW = pixW * scale;
    const drawH = pixH * scale;
    const ox = Math.floor((canvas.width - drawW) / 2);
    const oy = Math.floor((canvas.height - drawH) / 2);
    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let cy = 0; cy < state.frameHChars; cy++) {
      for (let cx = 0; cx < state.frameWChars; cx++) {
        const gx = col * state.frameWChars + cx;
        const gy = row * state.frameHChars + cy;
        if (gx >= state.gridCols || gy >= state.gridRows) continue;
        const c = cellForRender(gx, gy);
        drawHalfCell(ctx, ox + cx * scale, oy + cy * scale * 2, scale, Number(c.glyph || 0), c.fg || [0, 0, 0], c.bg || [0, 0, 0]);
      }
    }
  }

  function frameColInfo(col) {
    const semanticFrames = semanticFrameCount();
    const proj = Math.floor(col / semanticFrames);
    const frame = col % semanticFrames;
    return { semanticFrames, proj, frame };
  }

  function inspectorFrameCellMatrix(row, col) {
    const out = [];
    for (let y = 0; y < state.frameHChars; y++) {
      const line = [];
      for (let x = 0; x < state.frameWChars; x++) {
        const gx = col * state.frameWChars + x;
        const gy = row * state.frameHChars + y;
        line.push(gx >= state.gridCols || gy >= state.gridRows ? transparentCell(0) : { ...cellForRender(gx, gy) });
      }
      out.push(line);
    }
    return out;
  }

  function writeFrameCellMatrix(row, col, matrix) {
    clearFrame(row, col);
    if (!Array.isArray(matrix)) return;
    for (let y = 0; y < Math.min(state.frameHChars, matrix.length); y++) {
      const line = Array.isArray(matrix[y]) ? matrix[y] : [];
      for (let x = 0; x < Math.min(state.frameWChars, line.length); x++) {
        const gx = col * state.frameWChars + x;
        const gy = row * state.frameHChars + y;
        if (gx >= state.gridCols || gy >= state.gridRows) continue;
        setCell(gx, gy, line[x] || transparentCell(0));
      }
    }
  }

  function flipFrameMatrixH(matrix) {
    return (matrix || []).map((line) => [...line].reverse().map((c) => ({ ...c })));
  }

  function inspectorCurrentFrameCoord() {
    const row = Math.max(0, Math.min(state.angles - 1, Number(state.inspectorRow || 0)));
    const semanticFrames = semanticFrameCount();
    const maxCol = Math.max(0, authoringFrameCols() - 1);
    const col = Math.max(0, Math.min(maxCol, Number(state.inspectorCol || 0)));
    return { row, col, semanticFrames, maxCol };
  }

  function clampInspectorGlyphCode(v) {
    return Math.max(0, Math.min(255, Number(v || 0) | 0));
  }

  function normalizeInspectorSelection(sel) {
    if (!sel) return null;
    const x1 = Math.max(0, Math.min(state.frameWChars - 1, Number(sel.x1)));
    const y1 = Math.max(0, Math.min(state.frameHChars - 1, Number(sel.y1)));
    const x2 = Math.max(0, Math.min(state.frameWChars - 1, Number(sel.x2)));
    const y2 = Math.max(0, Math.min(state.frameHChars - 1, Number(sel.y2)));
    return {
      x1: Math.min(x1, x2),
      y1: Math.min(y1, y2),
      x2: Math.max(x1, x2),
      y2: Math.max(y1, y2),
    };
  }

  function inspectorSelectionOrWholeFrame() {
    return normalizeInspectorSelection(state.inspectorSelection) || {
      x1: 0,
      y1: 0,
      x2: Math.max(0, state.frameWChars - 1),
      y2: Math.max(0, state.frameHChars - 1),
    };
  }

  function inspectorSelectionLabel() {
    const s = normalizeInspectorSelection(state.inspectorSelection);
    if (!s) return "none";
    return `${s.x1},${s.y1}..${s.x2},${s.y2}`;
  }

  function inspectorCellFromLocal(row, col, cx, cy) {
    const gx = col * state.frameWChars + cx;
    const gy = row * state.frameHChars + cy;
    if (gx < 0 || gy < 0 || gx >= state.gridCols || gy >= state.gridRows) return null;
    return { gx, gy, cell: cellForRender(gx, gy) };
  }

  function cellEquals(a, b) {
    if (!a || !b) return false;
    return (
      Number(a.glyph || 0) === Number(b.glyph || 0) &&
      colorsEqual(a.fg || [0, 0, 0], b.fg || [0, 0, 0]) &&
      colorsEqual(a.bg || [0, 0, 0], b.bg || [0, 0, 0])
    );
  }

  function currentInspectorGlyphCell() {
    return {
      glyph: clampInspectorGlyphCode(state.inspectorGlyphCode),
      fg: [...(Array.isArray(state.inspectorGlyphFgColor) ? state.inspectorGlyphFgColor : [255, 255, 255])],
      bg: [...(Array.isArray(state.inspectorGlyphBgColor) ? state.inspectorGlyphBgColor : [...MAGENTA])],
    };
  }

  function setInspectorGlyphUIFromCell(c) {
    if (!c) return;
    state.inspectorGlyphCode = clampInspectorGlyphCode(c.glyph);
    state.inspectorGlyphFgColor = [...(Array.isArray(c.fg) ? c.fg : [255, 255, 255])];
    state.inspectorGlyphBgColor = [...(Array.isArray(c.bg) ? c.bg : [...MAGENTA])];
    state.inspectorLastInspectCell = {
      glyph: state.inspectorGlyphCode,
      fg: [...state.inspectorGlyphFgColor],
      bg: [...state.inspectorGlyphBgColor],
    };
    const fg = rgbToHex(state.inspectorGlyphFgColor);
    const bg = rgbToHex(state.inspectorGlyphBgColor);
    if ($("inspectorFrFindGlyph")) $("inspectorFrFindGlyph").value = String(state.inspectorGlyphCode);
    if ($("inspectorFrFindFg")) $("inspectorFrFindFg").value = fg;
    if ($("inspectorFrFindBg")) $("inspectorFrFindBg").value = bg;
  }

  function inspectorSelectionMatrix(row, col, sel) {
    const s = normalizeInspectorSelection(sel);
    if (!s) return null;
    const out = [];
    for (let y = s.y1; y <= s.y2; y++) {
      const line = [];
      for (let x = s.x1; x <= s.x2; x++) {
        const rec = inspectorCellFromLocal(row, col, x, y);
        line.push(rec ? { ...rec.cell } : transparentCell(0));
      }
      out.push(line);
    }
    return out;
  }

  function selectionBoundsFromMatrixAtAnchor(anchorX, anchorY, matrix) {
    const rows = Array.isArray(matrix) ? matrix.length : 0;
    const cols = rows > 0 && Array.isArray(matrix[0]) ? matrix[0].length : 0;
    const x1 = Math.max(0, Math.min(state.frameWChars - 1, Number(anchorX || 0)));
    const y1 = Math.max(0, Math.min(state.frameHChars - 1, Number(anchorY || 0)));
    const x2 = Math.max(x1, Math.min(state.frameWChars - 1, x1 + Math.max(0, cols - 1)));
    const y2 = Math.max(y1, Math.min(state.frameHChars - 1, y1 + Math.max(0, rows - 1)));
    return { x1, y1, x2, y2 };
  }

  function writeInspectorSelectionMatrix(row, col, sel, matrix) {
    const s = normalizeInspectorSelection(sel);
    if (!s || !Array.isArray(matrix)) return 0;
    let changed = 0;
    for (let y = 0; y < matrix.length; y++) {
      const line = Array.isArray(matrix[y]) ? matrix[y] : [];
      for (let x = 0; x < line.length; x++) {
        const tx = s.x1 + x;
        const ty = s.y1 + y;
        if (tx > s.x2 || ty > s.y2) continue;
        const rec = inspectorCellFromLocal(row, col, tx, ty);
        if (!rec) continue;
        const next = line[x] || transparentCell(0);
        if (cellEquals(rec.cell, next)) continue;
        setCell(rec.gx, rec.gy, next);
        changed += 1;
      }
    }
    return changed;
  }

  function inspectorCellRectAtEvent(evt) {
    const hit = inspectorHalfCellAtEvent(evt);
    if (!hit) return null;
    return { row: hit.row, col: hit.col, cx: hit.cx, cy: hit.cy };
  }

  function setInspectorHoverFromHit(hit) {
    if (!hit) {
      state.inspectorHover = null;
      updateInspectorToolUI();
      return;
    }
    const rec = inspectorCellFromLocal(hit.row, hit.col, hit.cx, hit.cy);
    state.inspectorHover = rec ? { cx: hit.cx, cy: hit.cy, half: hit.half || "top", cell: { ...rec.cell } } : null;
    if (state.inspectorHover) {
      state.inspectorLastHoverAnchor = { cx: Number(state.inspectorHover.cx || 0), cy: Number(state.inspectorHover.cy || 0) };
    }
    updateInspectorToolUI();
  }

  function selectionMatrixFlipH(matrix) {
    return (Array.isArray(matrix) ? matrix : []).map((row) => (Array.isArray(row) ? [...row].reverse().map((c) => ({ ...c })) : []));
  }

  function selectionMatrixFlipV(matrix) {
    return [...(Array.isArray(matrix) ? matrix : [])].reverse().map((row) => (Array.isArray(row) ? row.map((c) => ({ ...c })) : []));
  }

  function selectionMatrixRotate(matrix, clockwise) {
    const src = Array.isArray(matrix) ? matrix : [];
    const h = src.length;
    const w = h > 0 && Array.isArray(src[0]) ? src[0].length : 0;
    if (!h || !w) return [];
    const out = [];
    if (clockwise) {
      for (let y = 0; y < w; y++) {
        const row = [];
        for (let x = 0; x < h; x++) row.push({ ...(src[h - 1 - x]?.[y] || transparentCell(0)) });
        out.push(row);
      }
    } else {
      for (let y = 0; y < w; y++) {
        const row = [];
        for (let x = 0; x < h; x++) row.push({ ...(src[x]?.[w - 1 - y] || transparentCell(0)) });
        out.push(row);
      }
    }
    return out;
  }

  function inspectorSelectAll() {
    if (!state.inspectorOpen) return false;
    state.inspectorSelection = normalizeInspectorSelection({
      x1: 0,
      y1: 0,
      x2: Math.max(0, state.frameWChars - 1),
      y2: Math.max(0, state.frameHChars - 1),
    });
    updateInspectorToolUI();
    renderInspector();
    return true;
  }

  function transformInspectorSelection(kind) {
    if (!state.inspectorOpen) return false;
    commitInspectorStrokeIfNeeded();
    if (!editableLayerActive()) {
      status("Visual layer (2) must be active for selection transforms", "warn");
      return false;
    }
    const sel = normalizeInspectorSelection(state.inspectorSelection);
    if (!sel) {
      status("No selection to transform", "warn");
      return false;
    }
    const { row, col } = inspectorCurrentFrameCoord();
    const src = inspectorSelectionMatrix(row, col, sel);
    let dst = src;
    if (kind === "flip_h") dst = selectionMatrixFlipH(src);
    else if (kind === "flip_v") dst = selectionMatrixFlipV(src);
    else if (kind === "rot_cw") dst = selectionMatrixRotate(src, true);
    else if (kind === "rot_ccw") dst = selectionMatrixRotate(src, false);
    else return false;
    const changed = commitWholeSheetDocumentMutation(`inspector-${kind}`, function() {
      writeInspectorSelectionMatrix(row, col, sel, Array.isArray(src) ? src.map((r) => r.map(() => transparentCell(0))) : []);
      const nextSel = selectionBoundsFromMatrixAtAnchor(sel.x1, sel.y1, dst);
      writeInspectorSelectionMatrix(row, col, nextSel, dst);
      state.inspectorSelection = normalizeInspectorSelection(nextSel);
    });
    if (!changed) {
      status("Selection transform made no changes", "warn");
      return false;
    }
    status(`Applied ${kind.replace("_", " ")} to selection`, "ok");
    return true;
  }

  function applyInspectorGlyphAtCell(hit) {
    if (!hit) return false;
    if (!editableLayerActive()) {
      status("Visual layer (2) must be active for inspector edits", "warn");
      return false;
    }
    const rec = inspectorCellFromLocal(hit.row, hit.col, hit.cx, hit.cy);
    if (!rec) return false;
    const next = currentInspectorGlyphCell();
    if (cellEquals(rec.cell, next)) return false;
    setCell(rec.gx, rec.gy, next);
    markFrameGridDirtyForCell(rec.gx, rec.gy);
    return true;
  }

  function copyInspectorSelection() {
    if (!state.inspectorOpen) return false;
    commitInspectorStrokeIfNeeded();
    const sel = normalizeInspectorSelection(state.inspectorSelection);
    if (!sel) {
      status("No frame selection to copy", "warn");
      return false;
    }
    const { row, col } = inspectorCurrentFrameCoord();
    state.inspectorSelectionClipboard = inspectorSelectionMatrix(row, col, sel);
    updateInspectorToolUI();
    status(`Copied selection ${inspectorSelectionLabel()}`, "ok");
    return true;
  }

  function pasteInspectorSelection() {
    if (!state.inspectorOpen) return false;
    commitInspectorStrokeIfNeeded();
    if (!editableLayerActive()) {
      status("Visual layer (2) must be active for inspector paste", "warn");
      return false;
    }
    if (!state.inspectorSelectionClipboard) {
      status("No copied selection in clipboard", "warn");
      return false;
    }
    const { row, col } = inspectorCurrentFrameCoord();
    let sel = normalizeInspectorSelection(state.inspectorSelection);
    if (!sel) {
      const anchor = state.inspectorHover
        ? { x: Number(state.inspectorHover.cx || 0), y: Number(state.inspectorHover.cy || 0) }
        : state.inspectorLastHoverAnchor
          ? { x: Number(state.inspectorLastHoverAnchor.cx || 0), y: Number(state.inspectorLastHoverAnchor.cy || 0) }
          : { x: 0, y: 0 };
      sel = selectionBoundsFromMatrixAtAnchor(anchor.x, anchor.y, state.inspectorSelectionClipboard);
      state.inspectorSelection = normalizeInspectorSelection(sel);
    }
    const changed = commitWholeSheetDocumentMutation("inspector-paste-selection", function() {
      writeInspectorSelectionMatrix(row, col, sel, state.inspectorSelectionClipboard);
    });
    if (!changed) {
      status("Paste selection made no changes", "warn");
      return false;
    }
    status(`Pasted selection into ${inspectorSelectionLabel()}`, "ok");
    return true;
  }

  function clearInspectorSelectionCells() {
    if (!state.inspectorOpen) return false;
    commitInspectorStrokeIfNeeded();
    if (!editableLayerActive()) {
      status("Visual layer (2) must be active for clear selection", "warn");
      return false;
    }
    const sel = normalizeInspectorSelection(state.inspectorSelection);
    if (!sel) {
      status("No selection to clear", "warn");
      return false;
    }
    const { row, col } = inspectorCurrentFrameCoord();
    const changed = commitWholeSheetDocumentMutation("inspector-clear-selection", function() {
      for (let y = sel.y1; y <= sel.y2; y++) {
        for (let x = sel.x1; x <= sel.x2; x++) {
          const rec = inspectorCellFromLocal(row, col, x, y);
          if (!rec) continue;
          const next = transparentCell(0);
          if (cellEquals(rec.cell, next)) continue;
          setCell(rec.gx, rec.gy, next);
        }
      }
    });
    if (!changed) {
      status("Selection already empty", "warn");
      return false;
    }
    status(`Cleared selection ${inspectorSelectionLabel()}`, "ok");
    return true;
  }

  function cutInspectorSelection() {
    if (!copyInspectorSelection()) return false;
    return clearInspectorSelectionCells();
  }

  function fillInspectorSelectionWithGlyph() {
    if (!state.inspectorOpen) return false;
    commitInspectorStrokeIfNeeded();
    if (!editableLayerActive()) {
      status("Visual layer (2) must be active for fill selection", "warn");
      return false;
    }
    const sel = normalizeInspectorSelection(state.inspectorSelection);
    if (!sel) {
      status("No selection to fill", "warn");
      return false;
    }
    const fillCell = currentInspectorGlyphCell();
    const { row, col } = inspectorCurrentFrameCoord();
    const changed = commitWholeSheetDocumentMutation("inspector-fill-selection", function() {
      for (let y = sel.y1; y <= sel.y2; y++) {
        for (let x = sel.x1; x <= sel.x2; x++) {
          const rec = inspectorCellFromLocal(row, col, x, y);
          if (!rec) continue;
          if (cellEquals(rec.cell, fillCell)) continue;
          setCell(rec.gx, rec.gy, fillCell);
        }
      }
    });
    if (!changed) {
      status("Fill selection made no changes", "warn");
      return false;
    }
    status(`Filled selection ${inspectorSelectionLabel()}`, "ok");
    return true;
  }

  function replaceInspectorSelectionColor(channel) {
    if (!state.inspectorOpen) return false;
    commitInspectorStrokeIfNeeded();
    if (!editableLayerActive()) {
      status("Visual layer (2) must be active for replace color", "warn");
      return false;
    }
    const sel = normalizeInspectorSelection(state.inspectorSelection);
    if (!sel) {
      status("No selection for color replace", "warn");
      return false;
    }
    const sample = state.inspectorLastInspectCell;
    if (!sample) {
      status("Inspect or dropper a cell first to set match colors", "warn");
      return false;
    }
    const target = channel === "bg" ? sample.bg : sample.fg;
    const replacement = channel === "bg" ? state.inspectorGlyphBgColor : state.inspectorGlyphFgColor;
    const { row, col } = inspectorCurrentFrameCoord();
    const changed = commitWholeSheetDocumentMutation(
      channel === "bg" ? "inspector-replace-bg-selection" : "inspector-replace-fg-selection",
      function() {
        for (let y = sel.y1; y <= sel.y2; y++) {
          for (let x = sel.x1; x <= sel.x2; x++) {
            const rec = inspectorCellFromLocal(row, col, x, y);
            if (!rec) continue;
            const cur = rec.cell;
            const next = { ...cur, fg: [...cur.fg], bg: [...cur.bg] };
            const before = channel === "bg" ? cur.bg : cur.fg;
            if (!colorsEqual(before, target)) continue;
            if (channel === "bg") next.bg = [...replacement];
            else next.fg = [...replacement];
            if (cellEquals(cur, next)) continue;
            setCell(rec.gx, rec.gy, next);
          }
        }
      }
    );
    if (!changed) {
      status(`No ${channel.toUpperCase()} matches in selection`, "warn");
      return false;
    }
    status(`Replaced ${channel.toUpperCase()} color in selection`, "ok");
    return true;
  }

  function applyInspectorFindReplace() {
    if (!state.inspectorOpen) return false;
    commitInspectorStrokeIfNeeded();
    if (!editableLayerActive()) {
      status("Visual layer (2) must be active for find/replace", "warn");
      return false;
    }
    const matchGlyph = !!$("inspectorFrMatchGlyphChk")?.checked;
    const matchFg = !!$("inspectorFrMatchFgChk")?.checked;
    const matchBg = !!$("inspectorFrMatchBgChk")?.checked;
    if (!matchGlyph && !matchFg && !matchBg) {
      status("Find/Replace: enable at least one match criterion", "warn");
      return false;
    }
    const replGlyphOn = !!$("inspectorFrReplaceGlyphChk")?.checked;
    const replFgOn = !!$("inspectorFrReplaceFgChk")?.checked;
    const replBgOn = !!$("inspectorFrReplaceBgChk")?.checked;
    if (!replGlyphOn && !replFgOn && !replBgOn) {
      status("Find/Replace: enable at least one replacement channel", "warn");
      return false;
    }
    const findGlyph = clampInspectorGlyphCode($("inspectorFrFindGlyph")?.value || 0);
    const findFg = hexToRgb($("inspectorFrFindFg")?.value || "#ffffff");
    const findBg = hexToRgb($("inspectorFrFindBg")?.value || "#ff00ff");
    const replGlyph = clampInspectorGlyphCode($("inspectorFrReplGlyph")?.value || 0);
    const replFg = hexToRgb($("inspectorFrReplFg")?.value || "#ffffff");
    const replBg = hexToRgb($("inspectorFrReplBg")?.value || "#ff00ff");
    const scope = String($("inspectorFrScope")?.value || "selection");
    const { row, col } = inspectorCurrentFrameCoord();
    const sel = scope === "frame" ? {
      x1: 0, y1: 0, x2: Math.max(0, state.frameWChars - 1), y2: Math.max(0, state.frameHChars - 1),
    } : normalizeInspectorSelection(state.inspectorSelection);
    if (!sel) {
      status("Find/Replace scope is selection, but no selection exists", "warn");
      return false;
    }
    let changedCount = 0;
    const changed = commitWholeSheetDocumentMutation("inspector-find-replace", function() {
      for (let y = sel.y1; y <= sel.y2; y++) {
        for (let x = sel.x1; x <= sel.x2; x++) {
          const rec = inspectorCellFromLocal(row, col, x, y);
          if (!rec) continue;
          const cur = rec.cell;
          if (matchGlyph && Number(cur.glyph || 0) !== findGlyph) continue;
          if (matchFg && !colorsEqual(cur.fg || [0, 0, 0], findFg)) continue;
          if (matchBg && !colorsEqual(cur.bg || [0, 0, 0], findBg)) continue;
          const next = {
            ...cur,
            glyph: replGlyphOn ? replGlyph : Number(cur.glyph || 0),
            fg: replFgOn ? [...replFg] : [...(cur.fg || [0, 0, 0])],
            bg: replBgOn ? [...replBg] : [...(cur.bg || [0, 0, 0])],
          };
          if (cellEquals(cur, next)) continue;
          setCell(rec.gx, rec.gy, next);
          changedCount += 1;
        }
      }
    });
    if (!changed) {
      status("Find/Replace made no changes", "warn");
      const info = $("inspectorFindReplaceInfo");
      if (info) info.textContent = "Find & Replace: no matching cells in scope.";
      return false;
    }
    const info = $("inspectorFindReplaceInfo");
    if (info) info.textContent = `Find & Replace updated ${changedCount} cell(s) in ${scope === "frame" ? "whole frame" : "selection"}.`;
    status(`Find/Replace updated ${changedCount} cell(s)`, "ok");
    return true;
  }

  function moveInspectorSelection(deltaRow, deltaCol) {
    if (!state.inspectorOpen) return false;
    commitInspectorStrokeIfNeeded();
    const cur = inspectorCurrentFrameCoord();
    const nextRow = Math.max(0, Math.min(state.angles - 1, cur.row + Number(deltaRow || 0)));
    const nextCol = Math.max(0, Math.min(cur.maxCol, cur.col + Number(deltaCol || 0)));
    state.inspectorRow = nextRow;
    state.inspectorCol = nextCol;
    setGridSelection([{ row: nextRow, col: nextCol }], { anchor: { row: nextRow, col: nextCol }, focus: { row: nextRow, col: nextCol } });
    renderFrameGrid();
    renderPreviewFrame(nextRow, Math.max(0, Math.min(cur.semanticFrames - 1, nextCol % cur.semanticFrames)));
    renderInspector();
    return true;
  }

  function copyInspectorFrame() {
    if (!state.inspectorOpen) return false;
    commitInspectorStrokeIfNeeded();
    const { row, col } = inspectorCurrentFrameCoord();
    state.inspectorFrameClipboard = inspectorFrameCellMatrix(row, col);
    updateInspectorToolUI();
    status(`Copied frame row=${row} col=${col}`, "ok");
    return true;
  }

  function pasteInspectorFrame() {
    if (!state.inspectorOpen || !state.inspectorFrameClipboard) {
      status("No copied frame in clipboard", "warn");
      return false;
    }
    if (!editableLayerActive()) {
      status("Visual layer (2) must be active for frame paste", "warn");
      return false;
    }
    const { row, col } = inspectorCurrentFrameCoord();
    const changed = commitWholeSheetDocumentMutation("inspector-paste-frame", function() {
      writeFrameCellMatrix(row, col, state.inspectorFrameClipboard);
    });
    if (!changed) {
      status("Paste frame made no changes", "warn");
      return false;
    }
    status(`Pasted frame into row=${row} col=${col}`, "ok");
    return true;
  }

  function flipInspectorFrameHorizontal() {
    if (!state.inspectorOpen) return false;
    commitInspectorStrokeIfNeeded();
    if (!editableLayerActive()) {
      status("Visual layer (2) must be active for frame flip", "warn");
      return false;
    }
    const { row, col } = inspectorCurrentFrameCoord();
    const changed = commitWholeSheetDocumentMutation("inspector-flip-frame-h", function() {
      const flipped = flipFrameMatrixH(inspectorFrameCellMatrix(row, col));
      writeFrameCellMatrix(row, col, flipped);
    });
    if (!changed) {
      status("Frame flip made no changes", "warn");
      return false;
    }
    status(`Flipped frame horizontally row=${row} col=${col}`, "ok");
    return true;
  }

  function clearInspectorFrame() {
    if (!state.inspectorOpen) return false;
    commitInspectorStrokeIfNeeded();
    if (!editableLayerActive()) {
      status("Visual layer (2) must be active to clear frame", "warn");
      return false;
    }
    const { row, col } = inspectorCurrentFrameCoord();
    const changed = commitWholeSheetDocumentMutation("inspector-clear-frame", function() {
      clearFrame(row, col);
    });
    if (!changed) {
      status("Frame already empty", "warn");
      return false;
    }
    status(`Cleared frame row=${row} col=${col}`, "ok");
    return true;
  }

  function openInspector(row, col) {
    state.inspectorOpen = true;
    state.inspectorRow = Math.max(0, row);
    state.inspectorCol = Math.max(0, col);
    state.inspectorHover = null;
    state.inspectorLastHoverAnchor = null;
    const diagnostics = $("advancedDiagnostics");
    if (diagnostics) diagnostics.open = true;
    const panel = $("cellInspectorPanel");
    if (panel) panel.classList.remove("hidden");
    renderInspector();
    status(`Opened XP Editor for row=${state.inspectorRow} col=${state.inspectorCol}`, "ok");
    try {
      requestAnimationFrame(() => {
        try { panel?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_e) {}
        if (document.activeElement !== $("webbuildFrame")) {
          try { $("cellInspectorCanvas")?.focus?.(); } catch (_e) {}
        }
      });
    } catch (_e) {}
  }

  function focusWholeSheetFrame(row, col) {
    const wsEditor = window.__wholeSheetEditor;
    const panel = $("wholeSheetPanel");
    const mounted = !!(wsEditor && typeof wsEditor.panToFrame === "function" && wsEditor.getState && wsEditor.getState().mounted);
    const visible = !!(panel && !panel.classList.contains("hidden"));
    if (!mounted || !visible) {
      openInspector(row, col);
      status(`Whole-sheet editor not ready; opened legacy inspector for row=${Math.max(0, row)} col=${Math.max(0, col)}`, "warn");
      return false;
    }
    if (state.inspectorOpen) closeInspector();
    panWholeSheetToFrame(row, col);
    status(`Focused whole-sheet editor row=${Math.max(0, row)} col=${Math.max(0, col)}`, "ok");
    try {
      requestAnimationFrame(() => {
        try { panel?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_e) {}
      });
    } catch (_e) {}
    return true;
  }

  function closeInspector() {
    commitInspectorStrokeIfNeeded();
    state.inspectorOpen = false;
    state.inspectorSelecting = false;
    state.inspectorSelectAnchor = null;
    state.inspectorHover = null;
    state.inspectorLastHoverAnchor = null;
    const panel = $("cellInspectorPanel");
    if (panel) panel.classList.add("hidden");
    updateInspectorToolUI();
  }

  function renderInspector() {
    const panel = $("cellInspectorPanel");
    const canvas = $("cellInspectorCanvas");
    if (!panel || !canvas) return;
    if (!state.inspectorOpen) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    const zoom = Math.max(4, Math.min(28, Number(state.inspectorZoom || 10)));
    state.inspectorZoom = zoom;
    $("inspectorZoom").value = String(zoom);
    $("inspectorZoomValue").textContent = `${zoom}x`;

    const row = Math.max(0, Math.min(state.angles - 1, state.inspectorRow));
    const semanticFrames = semanticFrameCount();
    const maxCol = Math.max(0, authoringFrameCols() - 1);
    const col = Math.max(0, Math.min(maxCol, state.inspectorCol));

    const pixW = state.frameWChars;
    const pixH = state.frameHChars * 2;
    canvas.width = Math.max(1, pixW * zoom);
    canvas.height = Math.max(1, pixH * zoom);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let cy = 0; cy < state.frameHChars; cy++) {
      for (let cx = 0; cx < state.frameWChars; cx++) {
        const gx = col * state.frameWChars + cx;
        const gy = row * state.frameHChars + cy;
        if (gx >= state.gridCols || gy >= state.gridRows) continue;
        const c = cellForRender(gx, gy);
        drawHalfCell(ctx, cx * zoom, cy * zoom * 2, zoom, Number(c.glyph || 0), c.fg || [0, 0, 0], c.bg || [0, 0, 0]);
      }
    }

    if (state.inspectorShowGrid) {
      const step = state.inspectorGridStep || 1;
      const armLen = Math.max(2, Math.floor(zoom * 0.25));
      ctx.strokeStyle = "rgba(88,108,136,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= pixW; x += step) {
        for (let y = 0; y <= pixH; y += step) {
          const px = x * zoom + 0.5;
          const py = y * zoom + 0.5;
          ctx.moveTo(px, py - armLen);
          ctx.lineTo(px, py + armLen);
          ctx.moveTo(px - armLen, py);
          ctx.lineTo(px + armLen, py);
        }
      }
      ctx.stroke();
    }

    const sel = normalizeInspectorSelection(state.inspectorSelection);
    if (sel) {
      const x = sel.x1 * zoom + 1;
      const y = sel.y1 * zoom * 2 + 1;
      const w = (sel.x2 - sel.x1 + 1) * zoom - 2;
      const h = (sel.y2 - sel.y1 + 1) * zoom * 2 - 2;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, Math.max(1, w), Math.max(1, h));
      ctx.restore();
    }

    if (!state.inspectorHover && state.inspectorLastHoverAnchor) {
      const ax = Number(state.inspectorLastHoverAnchor.cx || 0);
      const ay = Number(state.inspectorLastHoverAnchor.cy || 0);
      if (ax >= 0 && ay >= 0 && ax < state.frameWChars && ay < state.frameHChars) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,214,92,0.9)";
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 2;
        ctx.strokeRect(ax * zoom + 2, ay * zoom * 2 + 2, Math.max(2, zoom - 4), Math.max(2, zoom * 2 - 4));
        ctx.restore();
      }
    }

    const info = frameColInfo(col);
    $("cellInspectorInfo").textContent = [
      `row=${row} col=${col}`,
      `angle=${row}${authoringProjectionCount() > 1 ? ` proj=${info.proj}` : ""} frame=${info.frame}/${Math.max(0, info.semanticFrames - 1)}`,
      `active_layer=${state.activeLayer} visible_layers=[${[...state.visibleLayers].sort((a, b) => a - b).join(",")}]`,
      `frame_chars=${state.frameWChars}x${state.frameHChars * 2}`,
      `tool=${state.inspectorTool} sel=${inspectorSelectionLabel()} glyph=${clampInspectorGlyphCode(state.inspectorGlyphCode)} fg=${rgbToHex(state.inspectorGlyphFgColor)} bg=${rgbToHex(state.inspectorGlyphBgColor)} half=${rgbToHex(state.inspectorPaintColor)} grid=${state.inspectorShowGrid ? 1 : 0} checker=${state.inspectorShowChecker ? 1 : 0}`,
    ].join(" | ");
    updateInspectorToolUI();
  }

  function inspectorHalfCellAtEvent(evt) {
    const canvas = $("cellInspectorCanvas");
    if (!canvas || !state.inspectorOpen) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const px = Math.floor((evt.clientX - rect.left) * (canvas.width / rect.width));
    const py = Math.floor((evt.clientY - rect.top) * (canvas.height / rect.height));
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
    const zoom = Math.max(1, Number(state.inspectorZoom || 10));
    const halfX = Math.floor(px / zoom);
    const halfY = Math.floor(py / zoom);
    const cx = halfX;
    const half = (halfY % 2) === 0 ? "top" : "bottom";
    const cy = Math.floor(halfY / 2);
    if (cx < 0 || cy < 0 || cx >= state.frameWChars || cy >= state.frameHChars) return null;
    const row = Math.max(0, Math.min(state.angles - 1, Number(state.inspectorRow || 0)));
    const semanticFrames = semanticFrameCount();
    const maxCol = Math.max(0, authoringFrameCols() - 1);
    const col = Math.max(0, Math.min(maxCol, Number(state.inspectorCol || 0)));
    return { row, col, cx, cy, half };
  }

  function applyInspectorToolAt(hit) {
    if (!hit) return false;
    const gx = hit.col * state.frameWChars + hit.cx;
    const gy = hit.row * state.frameHChars + hit.cy;
    if (gx < 0 || gy < 0 || gx >= state.gridCols || gy >= state.gridRows) return false;
    const prev = cellAt(gx, gy);
    const halves = decodeCellHalves(prev);
    if (state.inspectorTool === "inspect") {
      const visible = cellForRender(gx, gy);
      setInspectorGlyphUIFromCell(visible);
      updateInspectorToolUI();
      renderInspector();
      status(`Inspected cell glyph=${Number(visible.glyph || 0)} fg=${rgbToHex(visible.fg || [0, 0, 0])} bg=${rgbToHex(visible.bg || [0, 0, 0])}`, "ok");
      return false;
    }
    if (state.inspectorTool === "dropper") {
      sampleInspectorGlyphAndPaintFromHit(hit);
      return false;
    }
    if (!editableLayerActive()) {
      status("Visual layer (2) must be active for inspector edits", "warn");
      return false;
    }
    if (state.inspectorTool !== "paint" && state.inspectorTool !== "erase") return false;
    if (state.inspectorTool === "paint") {
      if (hit.half === "top") halves.top = [...state.inspectorPaintColor];
      else halves.bottom = [...state.inspectorPaintColor];
    } else {
      if (hit.half === "top") halves.top = null;
      else halves.bottom = null;
    }
    const next = encodeCellHalves(halves.top, halves.bottom, prev);
    const changed =
      Number(prev.glyph || 0) !== Number(next.glyph || 0) ||
      !colorsEqual(prev.fg || [0, 0, 0], next.fg || [0, 0, 0]) ||
      !colorsEqual(prev.bg || [0, 0, 0], next.bg || [0, 0, 0]);
    if (!changed) return false;
    setCell(gx, gy, next);
    markFrameGridDirtyForCell(gx, gy);
    return true;
  }

  function sampleInspectorGlyphAndPaintFromHit(hit, opts = {}) {
    if (!hit) return false;
    const rec = inspectorCellFromLocal(hit.row, hit.col, hit.cx, hit.cy);
    if (!rec) return false;
    const prev = rec.cell;
    const halves = decodeCellHalves(prev);
    const sampled = hit.half === "top" ? halves.top : halves.bottom;
    setInspectorGlyphUIFromCell(prev);
    if (sampled) state.inspectorPaintColor = [...sampled];
    updateInspectorToolUI();
    renderInspector();
    if (!opts.silent) {
      status(
        sampled
          ? `Sampled glyph=${Number(prev.glyph || 0)} and paint=${rgbToHex(sampled)}`
          : `Sampled glyph=${Number(prev.glyph || 0)} (transparent ${String(hit.half || "half")} half-cell)`,
        sampled ? "ok" : "warn"
      );
    }
    return true;
  }

  function commitInspectorStrokeIfNeeded() {
    if (!state.inspectorPainting) return;
    state.inspectorPainting = false;
    if (!state.inspectorStrokeChanged) {
      state.inspectorStrokeChanged = false;
      state.inspectorStrokeHadHistory = false;
      state.inspectorStrokeWasDirty = false;
      renderInspector();
      return;
    }
    state.inspectorStrokeChanged = false;
    state.inspectorStrokeHadHistory = false;
    state.inspectorStrokeWasDirty = false;
    replaceWholeSheetDocumentSnapshot(buildWholeSheetDocumentSnapshotFromState(), "inspector-edit");
  }

  function stopPreview() {
    if (state.previewTimer) {
      clearInterval(state.previewTimer);
      state.previewTimer = null;
    }
  }

  function startPreview() {
    stopPreview();
    const fps = Math.max(1, Number($("fpsInput").value || 8));
    const baseRow = Math.max(0, Math.min(state.angles - 1, Number($("previewAngle").value || 0)));
    const semanticFrames = semanticFrameCount();
    const angleCount = Math.max(1, Number(state.angles || 1));
    const mode = semanticFrames > 1 ? "frames" : (angleCount > 1 ? "angles" : "still");
    state.previewFrameIdx = 0;
    const tick = () => {
      if (mode === "angles") {
        const row = (baseRow + state.previewFrameIdx) % angleCount;
        $("previewAngle").value = String(row);
        renderPreviewFrame(row, 0);
      } else {
        renderPreviewFrame(baseRow, state.previewFrameIdx % semanticFrames);
      }
      state.previewFrameIdx += 1;
    };
    tick();
    if (mode === "still") {
      status("Preview has one frame and one direction; rendered still frame.", "warn");
      return;
    }
    state.previewTimer = setInterval(tick, Math.floor(1000 / fps));
  }

  function updateActionButtons() {
    const hasRow = state.selectedRow !== null;
    const hasSelection = hasGridSelection();
    const singleRow = hasSingleSelectedRow();
    const readOnly = !editableLayerActive();
    $("rowUpBtn").disabled = readOnly || !singleRow || !hasRow || state.selectedRow <= 0;
    $("rowDownBtn").disabled = readOnly || !singleRow || !hasRow || state.selectedRow >= state.angles - 1;
    const maxCol = Math.max(0, authoringFrameCols() - 1);
    const minSel = hasSelection ? Math.min(...state.selectedCols) : 0;
    const maxSel = hasSelection ? Math.max(...state.selectedCols) : 0;
    $("colLeftBtn").disabled = readOnly || !singleRow || !hasSelection || minSel <= 0;
    $("colRightBtn").disabled = readOnly || !singleRow || !hasSelection || maxSel >= maxCol;
    if ($("addFrameBtn")) $("addFrameBtn").disabled = readOnly || !(state.gridCols > 0 && state.gridRows > 0);
    $("deleteCellBtn").disabled = readOnly || !hasSelection;
    if ($("deleteFrameBtn")) $("deleteFrameBtn").disabled = readOnly || !hasSelection || semanticFrameCount() <= 1;
    if ($("openInspectorBtn")) $("openInspectorBtn").disabled = !hasSelection;
    $("assignAnimCategoryBtn").disabled = readOnly || !singleRow || !hasRow;
    $("assignFrameGroupBtn").disabled = readOnly || !singleRow || !hasSelection;
    const jitterDisabled = readOnly || !singleRow || !hasSelection;
    const jitterRowDisabled = readOnly || !singleRow || !hasRow;
    if ($("autoAlignSelectedBtn")) $("autoAlignSelectedBtn").disabled = jitterDisabled;
    if ($("autoAlignRowBtn")) $("autoAlignRowBtn").disabled = jitterRowDisabled;
    if ($("jitterLeftBtn")) $("jitterLeftBtn").disabled = jitterDisabled;
    if ($("jitterRightBtn")) $("jitterRightBtn").disabled = jitterDisabled;
    if ($("jitterUpBtn")) $("jitterUpBtn").disabled = jitterDisabled;
    if ($("jitterDownBtn")) $("jitterDownBtn").disabled = jitterDisabled;
    if ($("mountedCalibrationBtn")) $("mountedCalibrationBtn").disabled = !state.sessionId;
    if ($("mountedSemanticBtn")) $("mountedSemanticBtn").disabled = !state.sessionId;
  }

  function cancelWholeSheetAutosaveIdle() {
    if (state._wsAutosaveIdleHandle !== null && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(state._wsAutosaveIdleHandle);
    }
    state._wsAutosaveIdleHandle = null;
  }

  function clearQueuedWholeSheetAutosave() {
    if (state._wsDrawSaveTimer) {
      clearTimeout(state._wsDrawSaveTimer);
      state._wsDrawSaveTimer = null;
    }
    cancelWholeSheetAutosaveIdle();
    state._wsAutosaveDueAt = 0;
    state._wsAutosaveReason = "";
  }

  function scheduleWholeSheetAutosavePump(delayMs = 0) {
    if (state._wsDrawSaveTimer) return;
    state._wsDrawSaveTimer = setTimeout(function() {
      state._wsDrawSaveTimer = null;
      runWholeSheetAutosavePump();
    }, Math.max(0, Number(delayMs || 0)));
  }

  function runWholeSheetAutosavePump() {
    if (state._suppressAutoSave || !state._wsAutosaveDueAt) return;
    const waitMs = Number(state._wsAutosaveDueAt || 0) - Date.now();
    if (waitMs > 0) {
      scheduleWholeSheetAutosavePump(waitMs);
      return;
    }
    const runSave = function() {
      state._wsAutosaveIdleHandle = null;
      if (state._suppressAutoSave || !state._wsAutosaveDueAt) return;
      const nextWaitMs = Number(state._wsAutosaveDueAt || 0) - Date.now();
      if (nextWaitMs > 0) {
        scheduleWholeSheetAutosavePump(nextWaitMs);
        return;
      }
      const reason = String(state._wsAutosaveReason || "whole-sheet-draw");
      state._wsAutosaveDueAt = 0;
      state._wsAutosaveReason = "";
      saveSessionState(reason);
    };
    if (typeof window.requestIdleCallback === "function") {
      state._wsAutosaveIdleHandle = window.requestIdleCallback(runSave, { timeout: WHOLE_SHEET_AUTOSAVE_IDLE_TIMEOUT_MS });
    } else {
      state._wsDrawSaveTimer = setTimeout(function() {
        state._wsDrawSaveTimer = null;
        runSave();
      }, 0);
    }
  }

  function queueWholeSheetAutosave(reason = "whole-sheet-draw") {
    if (state._suppressAutoSave) return;
    state._wsAutosaveReason = String(reason || "whole-sheet-draw");
    state._wsAutosaveDueAt = Date.now() + WHOLE_SHEET_AUTOSAVE_DEBOUNCE_MS;
    if (!state._wsDrawSaveTimer && state._wsAutosaveIdleHandle === null) {
      scheduleWholeSheetAutosavePump(WHOLE_SHEET_AUTOSAVE_DEBOUNCE_MS);
    }
  }

  async function saveSessionState(reason, opts = {}) {
    if (!state.sessionId) return { ok: false, skipped: "no_session" };
    const waitForIdle = !!opts.wait_for_idle;
    const timeoutMs = Math.max(1000, Number(opts.timeout_ms || 15000));
    if (state.sessionSaveInFlight) {
      if (!waitForIdle) return { ok: true, skipped: "save_in_flight" };
      const waitStart = Date.now();
      while (state.sessionSaveInFlight && (Date.now() - waitStart) < timeoutMs) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (state.sessionSaveInFlight) {
        status(`Save busy (${reason})`, "warn");
        return { ok: false, timed_out: true, stage: "wait_for_idle" };
      }
    }
    state.sessionSaveInFlight = true;
    updateSessionDirtyBadge();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const wsSnapshot = getWholeSheetDocumentSnapshot();
      const saveLayers = wsSnapshot?.layers || ((state.layers && state.layers.length > 0) ? state.layers : undefined);
      const saveCells = (saveLayers && saveLayers[2]) ? saveLayers[2] : state.cells;
      const saveLayerNames = Array.isArray(wsSnapshot?.layerNames) ? wsSnapshot.layerNames : state.layerNames;
      const saveActiveLayer = typeof wsSnapshot?.activeLayer === "number" ? wsSnapshot.activeLayer : state.activeLayer;
      const saveVisibleLayers = wsSnapshot?.visibleLayers || Array.from(state.visibleLayers || []);
      const saveLockedLayers = wsSnapshot?.lockedLayers || Array.from(state.lockedLayers || []);
      const saveGridCols = Number(wsSnapshot?.gridCols || state.gridCols || 0);
      const saveGridRows = Number(wsSnapshot?.gridRows || state.gridRows || 0);
      const saveCellW = Number(wsSnapshot?.frameW || state.cellWChars || 1);
      const saveCellH = Number(wsSnapshot?.frameH || state.cellHChars || 1);
      const saveCanvasZoom = Number.isFinite(Number(wsSnapshot?.canvasZoom)) ? Number(wsSnapshot.canvasZoom) : state.wholeSheetCanvasZoom;
      const saveGridVisible = typeof wsSnapshot?.gridVisible === "boolean" ? !!wsSnapshot.gridVisible : !!state.wholeSheetGridVisible;
      const saveGridStep = String(wsSnapshot?.gridStep || state.wholeSheetGridStep || "frame");
      const saveGridCustomW = Math.max(1, Number(wsSnapshot?.gridCustomW || state.wholeSheetGridCustomW || 1));
      const saveGridCustomH = Math.max(1, Number(wsSnapshot?.gridCustomH || state.wholeSheetGridCustomH || 1));
      const payload = {
        session_id: state.sessionId,
        cells: saveCells,
        layers: saveLayers,
        layer_names: saveLayerNames,
        active_layer: saveActiveLayer,
        visible_layers: saveVisibleLayers,
        locked_layers: saveLockedLayers,
        grid_cols: saveGridCols,
        grid_rows: saveGridRows,
        cell_w: saveCellW,
        cell_h: saveCellH,
        angles: state.angles,
        anims: state.anims,
        whole_sheet_canvas_zoom: saveCanvasZoom,
        whole_sheet_grid_visible: saveGridVisible,
        whole_sheet_grid_step: saveGridStep,
        whole_sheet_grid_custom_w: saveGridCustomW,
        whole_sheet_grid_custom_h: saveGridCustomH,
        source_projs: state.sourceProjs,
        projs: state.projs,
        row_categories: state.rowCategories,
        frame_groups: state.frameGroups,
        source_boxes: state.extractedBoxes,
        source_anchor_box: state.anchorBox,
        source_draft_box: state.drawCurrent,
        source_cuts_v: state.sourceCutsV,
      };
      const r = await fetch(bp("/api/workbench/save-session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      });
      if (!r.ok) {
        const txt = await r.text();
        state.sessionSaveInFlight = false;
        status(`Save failed (${reason})`, "err");
        $("exportOut").textContent = txt;
        updateSessionDirtyBadge();
        clearTimeout(timer);
        return { ok: false, status: r.status };
      } else {
        markSessionSaved(reason);
        clearTimeout(timer);
        return { ok: true };
      }
    } catch (e) {
      state.sessionSaveInFlight = false;
      const timedOut = e && (e.name === "AbortError");
      status(timedOut ? `Save timed out (${reason})` : `Save failed (${reason})`, timedOut ? "warn" : "err");
      updateSessionDirtyBadge();
      clearTimeout(timer);
      return { ok: false, timed_out: timedOut, error: String(e) };
    }
  }

  function renderAll() {
    recomputeFrameGeometry();
    renderLayerControls();
    renderLegacyGrid();
    renderFrameGrid();
    renderMeta();
    renderJitterInfo();
    renderSession();
    updateClassicGeometryControls();
    renderSourceCanvas();
    const row = state.selectedRow === null ? 0 : state.selectedRow;
    renderPreviewFrame(Math.max(0, Math.min(state.angles - 1, row)), 0);
    // XP animation/metadata preview binding: label which document the preview
    // renders so a doc switch (or no doc) can never masquerade as another sprite.
    const previewLabel = $("previewDocLabel");
    if (previewLabel) {
      previewLabel.textContent = state.sessionId
        ? `preview: ${String(state.sessionId).slice(0, 8)}... [${String(state.sessionKind || "unknown")}]`
        : "preview: no document loaded";
    }
    renderInspector();
    updateSessionDirtyBadge();
  }

  function applyLoadedSessionOwnership(j, opts = {}) {
      const preserveBundleContext = !!opts.preserveBundleContext;
      const sessionKind = String(j.session_kind || "");
      const templateSetKey = String(j.template_set_key || "").trim();
      const actionKey = String(j.action_key || "").trim();
      const templateOwned = sessionKind === "template_owned" || !!templateSetKey;
      if (templateOwned) {
        state.templateSetKey = templateSetKey;
        state.activeActionKey = actionKey || "idle";
        if (!preserveBundleContext || !state.bundleId) {
          state.bundleId = null;
          state.actionStates = {};
        }
        return;
      }
      // Raw / non-template session. When the caller asked to preserve bundle
      // context (e.g. importXp adopted this raw upload into an active bundle
      // action), keep state.bundleId/actionStates/templateSetKey/activeActionKey
      // so the action tab strip and Test Bundle Skin gating survive.
      if (preserveBundleContext && state.bundleId) {
        return;
      }
      state.bundleId = null;
      state.actionStates = {};
      state.templateSetKey = "";
      state.activeActionKey = "idle";
  }

  function hydrateLoadedSession(j, opts = {}) {
      state.sessionId = j.session_id;
      state.jobId = String(j.job_id || state.jobId || "");
      state.gridCols = Number(j.grid_cols || 0);
      state.gridRows = Number(j.grid_rows || 0);
      state.angles = Number(j.angles || 1);
      state.anims = (j.anims || [1]).map((x) => Number(x));
      state.sourceProjs = Number(j.source_projs || 1);
      state.projs = Number(j.projs || 1);
      state.cellWChars = Number(j.cell_w || 1);
      state.cellHChars = Number(j.cell_h || 1);
      state.sessionKind = String(j.session_kind || "");
      state.metadataStatus = String(j.metadata_status || "");
      state.family = String(j.family || "");
      applyLoadedSessionOwnership(j, opts);
      state.layerNames = Array.isArray(j.layer_names) && j.layer_names.length ? [...j.layer_names] : [...DEFAULT_LAYER_NAMES];
      state.wholeSheetCanvasZoom = Number.isFinite(Number(j.whole_sheet_canvas_zoom)) ? Number(j.whole_sheet_canvas_zoom) : 0;
      state.wholeSheetGridVisible = !!j.whole_sheet_grid_visible;
      state.wholeSheetGridStep = String(j.whole_sheet_grid_step || "frame");
      state.wholeSheetGridCustomW = Math.max(1, Number(j.whole_sheet_grid_custom_w || 1));
      state.wholeSheetGridCustomH = Math.max(1, Number(j.whole_sheet_grid_custom_h || 1));
      state.anchorBox = j.source_anchor_box ? { ...j.source_anchor_box } : null;
      state.drawCurrent = j.source_draft_box ? { ...j.source_draft_box } : null;
      state.extractedBoxes = cloneBoxes(j.source_boxes || []);
      state.sourceCutsV = cloneCuts(j.source_cuts_v || []);
      state.sourceCutsH = cloneCuts(j.source_cuts_h || []);
      state.sourceSelection = new Set();
      state.sourceSelectedCut = null;
      state.sourceRowDrag = null;
      state.sourceDrag = null;
      state.sourceNextId = Math.max(
        1,
        ...state.extractedBoxes.map((b) => Number(b.id || 0) + 1),
        ...state.sourceCutsV.map((c) => Number(c.id || 0) + 1),
        ...state.sourceCutsH.map((c) => Number(c.id || 0) + 1),
      );
      state.activeLayer = Number.isFinite(Number(j.active_layer)) ? Number(j.active_layer) : 2;
      state.visibleLayers = new Set(Array.isArray(j.visible_layers) ? j.visible_layers.map((value) => Number(value)) : [2]);
      state.lockedLayers = new Set(Array.isArray(j.locked_layers) ? j.locked_layers.map((value) => Number(value)) : []);
      clearGridSelection();
      state.history = [];
      state.future = [];
      state.sessionDirty = false;
      state.sessionSaveInFlight = false;
      state.sessionLastSaveOkAt = 0;
      state.sessionLastSaveReason = "";
      state.latestXpPath = "";
      $("openXpToolBtn").disabled = true;
      setXpToolHint("Export an `.xp` to generate XP tool command.");
      updateVerifyUI();
      updateTermppSkinUI();
      updateWebbuildUI();
      updateSourceToolUI();
      updateUndoRedoButtons();
      $("btnSave").disabled = false;
      $("btnExport").disabled = false;
      $("btnNewXp").disabled = false;
      _updateFileButtonStates();
      // Use real layers from backend when available (B3: persisted layers are
      // the source of truth for uploaded XP sessions).
      if (Array.isArray(j.layers) && j.layers.length > 0) {
        state.layers = j.layers.map((l) => deepCloneCells(l));
        state.hasUploadedLayers = true;
        if (!Array.isArray(j.layer_names) || !j.layer_names.length) {
          state.layerNames = j.layers.map((_, i) => DEFAULT_LAYER_NAMES[i] || `Layer ${i}`);
        }
        // Derive state.cells mirror from layers[2].  j.cells is ignored when
        // j.layers exists — layers are the sole source of truth.
        state.cells = state.layers.length > 2
          ? deepCloneCells(state.layers[2])
          : buildBlankLayerCells();
        if (state.activeLayer < 0 || state.activeLayer >= state.layers.length) state.activeLayer = 2;
        if (!state.visibleLayers || state.visibleLayers.size <= 0) state.visibleLayers = new Set([2]);
        state.lockedLayers = new Set([...state.lockedLayers].filter((value) => value >= 0 && value < state.layers.length));
      } else {
        // Seed state.cells from j.cells only for sessions without persisted
        // layers — syncLayersFromSessionCells reads state.cells to build the
        // initial layer stack.
        state.cells = deepCloneCells(j.cells || []);
        state.hasUploadedLayers = false;
        syncLayersFromSessionCells();
      }
      status(`Session active: ${state.sessionId.slice(0, 8)}...`, "ok");
      stopPreview();
      renderAll();
      // Doc switch invalidates any previously injected dock skin: the dock no
      // longer tracks a document until Test This Skin injects the new one.
      state.webbuild.injectedSessionId = "";
      state.webbuild.injectedChecksum = "";
      state.webbuild.injectedAt = "";
      state.webbuild.injectedDocKind = "";
      renderDocContractPanel(null, null);
      hydrateWholeSheetEditor();
      // FL-4178 fix: ?focusFrame=row,col auto-opens whole-sheet editor on that frame after hydration
      try {
        const ff = String(params.get("focusFrame") || "").trim();
        if (ff) {
          const parts = ff.split(",").map((s) => Number(String(s).trim()));
          const fr = Number.isFinite(parts[0]) ? Math.max(0, parts[0] | 0) : 0;
          const fc = Number.isFinite(parts[1]) ? Math.max(0, parts[1] | 0) : 0;
          const tryFocus = async (attempt) => {
            try {
              // Seed selection (the button click handler reads these)
              state.selectedRow = fr;
              state.selectedCols = new Set([fc]);
              state.selectionFocus = { row: fr, col: fc };
              const wsEditor = window.__wholeSheetEditor;
              const editorReady = !!(wsEditor && typeof wsEditor.mount === "function");
              if (!editorReady) throw new Error("wsEditor not ready");
              // Re-entrant + idempotent — returns existing promise if mount in flight
              const p = hydrateWholeSheetEditor();
              if (p && typeof p.then === "function") await p;
              const panel = $("wholeSheetPanel");
              if (panel) panel.classList.remove("hidden");
              // openInspectorForSelectedFrame is the exact path the button click takes
              const ok = openInspectorForSelectedFrame();
              if (ok !== false) {
                try { if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_e) {}
                status(`focusFrame=${fr},${fc} - whole-sheet editor focused`, "ok");
                return true;
              }
            } catch (_e) {}
            if (attempt < 40) setTimeout(() => { void tryFocus(attempt + 1); }, 250);
            else status(`focusFrame=${fr},${fc} - whole-sheet editor did not mount within 10s`, "warn");
            return false;
          };
          setTimeout(() => { void tryFocus(0); }, 400);
        }
      } catch (_e) {}
      // Avoid an expensive immediate full-session save (and background webbuild boot) right after convert/load.
      // Large sprite sheets can make the UI feel frozen here; defer both until the user edits or runs skin test.
      stopWebbuildReadyPoll();
      state.webbuild.loaded = false;
      state.webbuild.ready = false;
      state.webbuild.loadRequestedAt = 0;
      state.webbuild.expectedSrc = "";
      state.webbuild.lastLoadedSrc = "";
      state.webbuild.pendingAutoStartToken = "";
      state.webbuild.uploadedXpBytes = null;
      state.webbuild.uploadedXpName = "";
      const webbuildFrame = $("webbuildFrame");
      if (webbuildFrame) {
        webbuildFrame.classList.add("hidden");
        try { webbuildFrame.removeAttribute("src"); } catch (_e) {}
      }
      renderBundleActionTabs();
      updateBundleUI();
      updateWebbuildUI();
      setWebbuildState("No test running — open a document, then press Test This Skin.", "");
  }

  async function loadFromJob(opts = {}) {
    if (!state.jobId) {
      status("Missing job_id in URL", "err");
      return;
    }
    status("Loading pipeline output...", "warn");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(bp("/api/workbench/load-from-job"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: state.jobId }),
        signal: ctl.signal,
      });
      const j = await r.json();
      const sessionSummary = { ...j, cells: undefined, cell_count: Array.isArray(j.cells) ? j.cells.length : 0 };
      $("sessionOut").textContent = JSON.stringify(sessionSummary, null, 2);
      if (!r.ok) {
        status("Load failed", "err");
        return;
      }
      hydrateLoadedSession(j, opts);
    } catch (e) {
      status("Load failed: fetch/timeout", "err");
      $("sessionOut").textContent = String(e);
    } finally {
      clearTimeout(t);
    }
  }

  async function loadSession(sessionId, opts = {}) {
    const sid = String(sessionId || "").trim();
    if (!sid) {
      status("Missing session_id", "err");
      return false;
    }
    status(opts.reason || "Loading session...", "warn");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(bp("/api/workbench/load-session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid }),
        signal: ctl.signal,
      });
      const j = await r.json();
      const sessionSummary = { ...j, cells: undefined, cell_count: Array.isArray(j.cells) ? j.cells.length : 0 };
      $("sessionOut").textContent = JSON.stringify(sessionSummary, null, 2);
      if (!r.ok) {
        status("Session load failed", "err");
        return false;
      }
      state.jobId = String(j.job_id || "");
      hydrateLoadedSession(j, opts);
      document.body.classList.add('ws-session-loaded');
      const _rh = document.getElementById('mobileRotateHint');
      if (_rh) _rh.classList.remove('hidden');
      // Dismiss mobile first screen for all session-load paths (URL restore, Open XP, template apply)
      if (typeof window._dismissFirstScreen === 'function') window._dismissFirstScreen();
      return true;
    } catch (e) {
      status("Session load failed: fetch/timeout", "err");
      $("sessionOut").textContent = String(e);
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  async function browseListSessions() {
    const r = await fetch(bp("/api/workbench/browse/list"));
    const j = await r.json();
    if (!r.ok) {
      throw new Error(j.error || "browse list failed");
    }
    return j;
  }

  async function ensureSessionSavedBeforeBrowseOpen(nextSessionId) {
    const nextId = String(nextSessionId || "").trim();
    if (!state.sessionDirty || !state.sessionId || !nextId || nextId === String(state.sessionId || "")) {
      return;
    }
    await flushPendingWholeSheetDrawSaveTimer();
    const saveRes = await saveSessionState("pre-browse-open", { wait_for_idle: true, timeout_ms: 15000 });
    if (!saveRes || !saveRes.ok) {
      throw new Error("browse open blocked: current session save failed/timed out");
    }
  }

  // Read-only session fetch for Browse whole-sheet previews. Unlike
  // loadSession it never hydrates workbench state or switches documents.
  async function previewSessionForBrowse(sessionId) {
    const sid = String(sessionId || "").trim();
    if (!sid) throw new Error("missing session_id");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(bp("/api/workbench/load-session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid }),
        signal: ctl.signal,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "preview load failed");
      return j;
    } finally {
      clearTimeout(t);
    }
  }

  async function browseOpenSession(sessionId) {
    const sid = String(sessionId || "").trim();
    if (!sid) return false;
    if (sid === String(state.sessionId || "")) {
      // Already open: stay on the visible sheet in the Edit workspace.
      setProductShellMode("edit");
      return true;
    }
    await ensureSessionSavedBeforeBrowseOpen(sid);
    const ok = await loadSession(sid, { reason: `Opening session ${sid.slice(0, 8)}...` });
    if (!ok) {
      throw new Error(`session open failed: ${sid}`);
    }
    // Open leaves Browse: the loaded sheet stays visible in Edit.
    setProductShellMode("edit");
    return true;
  }

  async function browseRenameSession(sessionId, name) {
    const r = await fetch(bp("/api/workbench/browse/rename"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: String(sessionId || ""), name: String(name || "") }),
    });
    const j = await r.json();
    if (!r.ok) {
      throw new Error(j.error || "browse rename failed");
    }
    if (String(sessionId || "") === String(state.sessionId || "")) {
      status(`Renamed active session to ${j.label || j.name || "session"}`, "ok");
    }
    return j;
  }

  async function browseDuplicateSession(sessionId) {
    const r = await fetch(bp("/api/workbench/browse/duplicate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: String(sessionId || "") }),
    });
    const j = await r.json();
    if (!r.ok) {
      throw new Error(j.error || "browse duplicate failed");
    }
    status(`Duplicated session as ${String(j.session_id || "").slice(0, 8)}...`, "ok");
    return j;
  }

  async function browseDeleteSession(sessionId) {
    const sid = String(sessionId || "").trim();
    if (!sid) return false;
    const r = await fetch(bp("/api/workbench/browse/delete"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sid }),
    });
    const j = await r.json();
    if (!r.ok) {
      throw new Error(j.error || "browse delete failed");
    }
    status(`Deleted session ${sid.slice(0, 8)}...`, "ok");
    return true;
  }

  async function importXp() {
    const fileInput = $("xpImportFile");
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) {
      status("Select an .xp file first", "err");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".xp")) {
      status("File must have .xp extension", "err");
      return;
    }
    status("Importing XP...", "warn");
    const fd = new FormData();
    fd.append("file", file);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(bp("/api/workbench/upload-xp"), {
        method: "POST",
        body: fd,
        signal: ctl.signal,
      });
      const j = await r.json();
      if (!r.ok) {
        status("Import failed: " + (j.error || "unknown"), "err");
        $("sessionOut").textContent = JSON.stringify(j, null, 2);
        return;
      }
      state.jobId = j.job_id;
      // When imported inside an active bundle action tab, the new session
      // takes over that action — keep bundle mode and rebind the action's
      // sessionId so subsequent save/export/payload calls target it.
      const inBundle = isBundleMode() && !!state.activeActionKey && !!state.actionStates[state.activeActionKey];
      if (inBundle) {
        state.actionStates[state.activeActionKey].sessionId = j.session_id;
        state.actionStates[state.activeActionKey].status = "blank";
      }
      await loadSession(j.session_id, {
        reason: "Imported XP session ready...",
        preserveBundleContext: inBundle,
      });
    } catch (e) {
      status("Import failed: " + String(e), "err");
      $("sessionOut").textContent = String(e);
    } finally {
      clearTimeout(t);
    }
  }

  // Direct raw-XP authoring: primary path that never requires template or
  // bundle selection. Clears template/bundle context, creates a blank root
  // session, loads it, and stays on the visible sheet in the Edit workspace.
  // After New creates+loads a session, refresh Browse and select the new
  // document. List-only: never changes shell mode, never pulls out of Edit.
  async function _refreshBrowseAfterNew(sessionId) {
    try {
      const editor = window.__wholeSheetEditor;
      if (editor && typeof editor.refreshBrowseList === 'function') {
        await editor.refreshBrowseList(sessionId);
      }
    } catch (e) { /* Browse refresh is best-effort; session is already loaded */ }
  }
  async function newRawXp() {
    if (state.sessionDirty && state.sessionId) {
      await flushPendingWholeSheetDrawSaveTimer();
      const saveRes = await saveSessionState("pre-new-raw-xp", { wait_for_idle: true, timeout_ms: 15000 });
      if (!saveRes || !saveRes.ok) {
        status("New raw XP blocked: session save failed/timed out", "err");
        throw new Error("new raw xp blocked: current session save failed/timed out");
      }
    }
    let geometry = {};
    try {
      geometry = readClassicGeometryInputs();
    } catch (e) {
      // Classic inputs invalid or unavailable: backend falls back to its
      // default root blank geometry.
      geometry = {};
    }
    status("Creating new raw XP...", "warn");
    state.bundleId = null;
    state.actionStates = {};
    state.templateSetKey = "";
    state.activeActionKey = "idle";
    const j = await createBlankRootSession(geometry);
    const ok = await loadSession(j.session_id, { reason: "New blank raw XP session..." });
    if (!ok) throw new Error("new raw xp failed: session load failed");
    setProductShellMode("edit");
    await _refreshBrowseAfterNew(j.session_id);
    status(`New raw XP ready: ${j.grid_cols}x${j.grid_rows}`, "ok");
    return j;
  }

  async function newXp() {
    const templateKey = state.templateSetKey;
    if (state.sessionDirty && state.sessionId) {
      const saveRes = await saveSessionState("pre-new-xp", { wait_for_idle: true, timeout_ms: 15000 });
      if (!saveRes || !saveRes.ok) {
        $("exportOut").textContent = JSON.stringify({ stage: "save_before_new_xp_failed", save: saveRes }, null, 2);
        status("New XP blocked: session save failed/timed out", "err");
        return;
      }
    }
    if (!templateKey) {
      status("Creating new blank root XP...", "warn");
      try {
        const geometry = readClassicGeometryInputs();
        const j = await createBlankRootSession(geometry);
        await loadSession(j.session_id, { reason: "New blank root session..." });
        setProductShellMode("edit");
        await _refreshBrowseAfterNew(j.session_id);
        status(`New XP ready: ${j.grid_cols}x${j.grid_rows}`, "ok");
      } catch (e) {
        status(`New XP failed: ${e}`, "err");
      }
      return;
    }
    const actionKey = state.activeActionKey || "idle";
    status(`Creating new blank XP for ${actionKey}...`, "warn");
    try {
      const j = await createBlankTemplateSession(templateKey, actionKey);
      if (isBundleMode() && state.actionStates[actionKey]) {
        state.actionStates[actionKey].sessionId = j.session_id;
        state.actionStates[actionKey].status = "blank";
      }
      await loadSession(j.session_id, { reason: `New blank ${actionKey} session...` });
      setProductShellMode("edit");
      await _refreshBrowseAfterNew(j.session_id);
      status(`New XP ready for ${actionKey}`, "ok");
    } catch (e) {
      status(`New XP failed: ${e}`, "err");
    }
  }

  async function exportXp() {
    if (!state.sessionId) return;
    await flushPendingWholeSheetDrawSaveTimer();
    const saveRes = await saveSessionState("pre-export", { wait_for_idle: true, timeout_ms: 15000 });
    if (!saveRes || !saveRes.ok) {
      $("exportOut").textContent = JSON.stringify({ stage: "save_before_export_failed", save: saveRes }, null, 2);
      status("Export blocked: session save failed/timed out", "err");
      return;
    }
    const r = await fetch(bp("/api/workbench/export-xp"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId }),
    });
    const j = await r.json();
    $("exportOut").textContent = JSON.stringify(j, null, 2);
    if (r.ok && j.xp_path) {
      state.latestXpPath = String(j.xp_path);
      $("openXpToolBtn").disabled = false;
      await refreshXpToolCommand(state.latestXpPath);
      if (isBundleMode() && state.activeActionKey && state.actionStates[state.activeActionKey]) {
        const persist = await persistBundleActionStatus(state.activeActionKey, "converted");
        if (!persist.ok) {
          status("XP exported, but bundle status did not persist", "warn");
        } else {
          const nextIncomplete = getNextIncompleteBundleActionKey();
          if (areAllEnabledBundleActionsReady()) {
            status("All required actions ready — click Test Bundle Skin", "ok");
            highlightBundleTestButton();
          } else if (nextIncomplete) {
            status(`${state.activeActionKey} exported — advancing to ${nextIncomplete}...`, "ok");
            setTimeout(() => switchBundleAction(nextIncomplete), 600);
          }
        }
      }
      try {
        const a = document.createElement("a");
        a.href = bp(`/api/workbench/download-xp?xp_path=${encodeURIComponent(state.latestXpPath)}`);
        a.download = "";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (_e) {
        // Export succeeded even if the browser blocks programmatic download.
      }
    } else {
      state.latestXpPath = "";
      $("openXpToolBtn").disabled = true;
    }
    if (!isBundleMode() || !r.ok) {
      status(r.ok ? "Export succeeded (download started)" : "Export failed", r.ok ? "ok" : "err");
    }
  }

  function normalizeBox(a, b) {
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  function canvasCoord(evt, canvas) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((evt.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((evt.clientY - rect.top) * (canvas.height / rect.height));
    return { x: Math.max(0, Math.min(canvas.width - 1, x)), y: Math.max(0, Math.min(canvas.height - 1, y)) };
  }

  function nextSourceId() {
    const id = Number(state.sourceNextId || 1);
    state.sourceNextId = id + 1;
    return id;
  }

  function sourceCanvasSize() {
    const c = $("sourceCanvas");
    return { w: Math.max(1, c.width || 1), h: Math.max(1, c.height || 1) };
  }

  const FIT_ZOOM = 0;
  const SOURCE_ZOOM_MIN = 0.25;
  const SOURCE_ZOOM_MAX = 6;
  const GRID_ZOOM_MIN = 0.25;
  const GRID_ZOOM_MAX = 2.5;
  const GRID_TILE_BASE_PX = 68;
  const GRID_HEADER_BASE_PX = 92;
  const GRID_GAP_PX = 4;
  const GRID_PANEL_PADDING_PX = 8;
  let viewportResizeObserver = null;
  let viewportResizeRaf = 0;

  function normalizeFitZoomValue(v, min, max, fallback = FIT_ZOOM) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    if (n <= FIT_ZOOM) return FIT_ZOOM;
    return Math.max(min, Math.min(max, n));
  }

  function clampSourceCanvasZoom(v) {
    return normalizeFitZoomValue(v, SOURCE_ZOOM_MIN, SOURCE_ZOOM_MAX, 1);
  }

  function clampGridPanelZoom(v) {
    return normalizeFitZoomValue(v, GRID_ZOOM_MIN, GRID_ZOOM_MAX, FIT_ZOOM);
  }

  function zoomLabel(z) {
    const n = Number(z || 0);
    if (!Number.isFinite(n) || n <= 0) return "0x";
    const fixed = n >= 1 ? n.toFixed(2) : n.toFixed(3);
    return `${fixed.replace(/\.?0+$/, "")}x`;
  }

  function sourceCanvasViewportSize() {
    const viewport = $("sourceCanvasViewport");
    return {
      w: Math.max(1, Number(viewport?.clientWidth || 1)),
      h: Math.max(1, Number(viewport?.clientHeight || 1)),
    };
  }

  function resolvedSourceCanvasZoom() {
    state.sourceCanvasZoom = clampSourceCanvasZoom(state.sourceCanvasZoom);
    if (state.sourceCanvasZoom > FIT_ZOOM) return state.sourceCanvasZoom;
    const viewport = sourceCanvasViewportSize();
    const canvasSize = sourceCanvasSize();
    const fit = Math.min(viewport.w / canvasSize.w, viewport.h / canvasSize.h);
    return Math.max(0.05, Math.min(1, Number.isFinite(fit) ? fit : 1));
  }

  function updateSourceCanvasZoomUI() {
    state.sourceCanvasZoom = clampSourceCanvasZoom(state.sourceCanvasZoom);
    const sliderZoom = state.sourceCanvasZoom;
    const resolvedZoom = resolvedSourceCanvasZoom();
    if ($("sourceZoomInput")) $("sourceZoomInput").value = String(sliderZoom);
    if ($("sourceZoomValue")) {
      $("sourceZoomValue").textContent = sliderZoom <= FIT_ZOOM
        ? `Fit (${zoomLabel(resolvedZoom)})`
        : zoomLabel(resolvedZoom);
    }
    const c = $("sourceCanvas");
    if (!c) return;
    c.style.width = `${Math.max(1, Math.round(Number(c.width || 1) * resolvedZoom))}px`;
    c.style.height = `${Math.max(1, Math.round(Number(c.height || 1) * resolvedZoom))}px`;
    if (sliderZoom <= FIT_ZOOM) {
      const viewport = $("sourceCanvasViewport");
      if (viewport) {
        viewport.scrollLeft = 0;
        viewport.scrollTop = 0;
      }
    }
  }

  function frameNavViewportSize() {
    const viewport = $("wsFrameNav");
    const header = viewport?.querySelector("h4");
    const headerH = Math.max(0, Number(header?.offsetHeight || 0) + 4);
    return {
      w: Math.max(1, Number(viewport?.clientWidth || 1) - 16),
      h: Math.max(1, Number(viewport?.clientHeight || 1) - headerH - 10),
    };
  }

  function resolvedGridPanelZoom() {
    state.gridPanelZoom = clampGridPanelZoom(state.gridPanelZoom);
    if (state.gridPanelZoom > FIT_ZOOM) return state.gridPanelZoom;
    const frameCols = Math.max(1, authoringFrameCols());
    const rows = Math.max(1, Number(state.angles || 1));
    const viewport = frameNavViewportSize();
    const naturalW = GRID_PANEL_PADDING_PX + GRID_HEADER_BASE_PX + (frameCols * GRID_TILE_BASE_PX) + (frameCols * GRID_GAP_PX);
    const naturalH = GRID_PANEL_PADDING_PX + (rows * GRID_TILE_BASE_PX) + (Math.max(0, rows - 1) * GRID_GAP_PX);
    const fit = Math.min(viewport.w / naturalW, viewport.h / naturalH);
    return Math.max(0.08, Math.min(1, Number.isFinite(fit) ? fit : 1));
  }

  function gridPanelTilePx(z = resolvedGridPanelZoom()) {
    return Math.max(18, Math.round(GRID_TILE_BASE_PX * z));
  }

  function gridPanelHeaderPx(z = resolvedGridPanelZoom()) {
    return Math.max(36, Math.round(GRID_HEADER_BASE_PX * z));
  }

  function applyGridPanelSizing(resolvedZoom) {
    const panel = $("gridPanel");
    if (!panel) return null;
    const tile = gridPanelTilePx(resolvedZoom);
    const header = gridPanelHeaderPx(resolvedZoom);
    panel.classList.toggle("frame-grid-compact", tile < 48);
    panel.classList.toggle("frame-grid-micro", tile < 32);
    panel.style.setProperty("--wb-grid-cell-size", `${tile}px`);
    panel.style.setProperty("--wb-grid-label-canvas-size", `${Math.max(14, tile - 4)}px`);
    panel.style.setProperty("--wb-grid-row-header-width", `${header}px`);
    return { panel, tile, header };
  }

  function updateGridPanelZoomUI() {
    state.gridPanelZoom = clampGridPanelZoom(state.gridPanelZoom);
    const sliderZoom = state.gridPanelZoom;
    const resolvedZoom = resolvedGridPanelZoom();
    if ($("gridZoomInput")) $("gridZoomInput").value = String(sliderZoom);
    if ($("gridZoomValue")) {
      $("gridZoomValue").textContent = sliderZoom <= FIT_ZOOM
        ? `Fit (${zoomLabel(resolvedZoom)})`
        : zoomLabel(resolvedZoom);
    }
    if (!applyGridPanelSizing(resolvedZoom)) return;
    if (sliderZoom <= FIT_ZOOM) {
      const viewport = $("wsFrameNav");
      if (viewport) {
        viewport.scrollLeft = 0;
        viewport.scrollTop = 0;
      }
    }
  }

  function enforceGridPanelFit() {
    if (state.gridPanelZoom > FIT_ZOOM) return;
    const viewport = $("wsFrameNav");
    if (!viewport || !$("gridPanel")) return;
    let correctedZoom = resolvedGridPanelZoom();
    for (let i = 0; i < 4; i++) {
      applyGridPanelSizing(correctedZoom);
      const widthScale = viewport.scrollWidth > 0 ? (viewport.clientWidth / viewport.scrollWidth) : 1;
      const heightScale = viewport.scrollHeight > 0 ? (viewport.clientHeight / viewport.scrollHeight) : 1;
      const overflowScale = Math.min(widthScale, heightScale);
      if (!Number.isFinite(overflowScale) || overflowScale >= 0.995) break;
      correctedZoom = Math.max(0.05, correctedZoom * overflowScale * 0.98);
    }
    if ($("gridZoomValue")) $("gridZoomValue").textContent = `Fit (${zoomLabel(correctedZoom)})`;
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }

  function scheduleViewportRefit() {
    if (viewportResizeRaf) cancelAnimationFrame(viewportResizeRaf);
    viewportResizeRaf = requestAnimationFrame(() => {
      viewportResizeRaf = 0;
      updateSourceCanvasZoomUI();
      if (state.gridPanelZoom <= FIT_ZOOM) renderFrameGrid();
    });
  }

  function installViewportResizeObserver() {
    if (viewportResizeObserver || typeof ResizeObserver !== "function") return;
    viewportResizeObserver = new ResizeObserver(() => scheduleViewportRefit());
    const sourceViewport = $("sourceCanvasViewport");
    const frameNav = $("wsFrameNav");
    if (sourceViewport) viewportResizeObserver.observe(sourceViewport);
    if (frameNav) viewportResizeObserver.observe(frameNav);
  }

  function resizeGridCharCanvas(newGridCols, newGridRows) {
    const nextCols = Math.max(1, Math.floor(Number(newGridCols) || 1));
    const nextRows = Math.max(1, Math.floor(Number(newGridRows) || 1));
    const oldCols = Math.max(0, Number(state.gridCols || 0));
    const oldRows = Math.max(0, Number(state.gridRows || 0));
    if (nextCols === oldCols && nextRows === oldRows) return false;

    // Helper: resize a flat cell array from oldCols×oldRows to nextCols×nextRows,
    // preserving data in the overlap region and filling new cells with transparent.
    function resizeFlat(oldFlat) {
      const src = Array.isArray(oldFlat) ? oldFlat : [];
      const out = [];
      for (let y = 0; y < nextRows; y++) {
        for (let x = 0; x < nextCols; x++) {
          const idx = y * nextCols + x;
          if (x < oldCols && y < oldRows) {
            const prev = src[y * oldCols + x] || transparentCell(idx);
            out.push({
              idx,
              glyph: Number(prev.glyph || 0),
              fg: [Number(prev.fg?.[0] || 0), Number(prev.fg?.[1] || 0), Number(prev.fg?.[2] || 0)],
              bg: [Number(prev.bg?.[0] || 0), Number(prev.bg?.[1] || 0), Number(prev.bg?.[2] || 0)],
            });
          } else {
            out.push(transparentCell(idx));
          }
        }
      }
      return out;
    }

    state.gridCols = nextCols;
    state.gridRows = nextRows;

    // Resize all existing layers to match, preserving non-L2 data in the overlap region.
    if (Array.isArray(state.layers) && state.layers.length > 0) {
      state.layers = state.layers.map((l) => resizeFlat(l));
      // Preserve existing L0 content where possible; only update the metadata row.
      if (state.layers[0]) {
        state.layers[0] = applyMetadataRowToLayer(state.layers[0]);
      }
      // Derive state.cells from resized layers[2] — layers are the source of truth.
      state.cells = state.layers[2] ? deepCloneCells(state.layers[2]) : resizeFlat(state.cells);
    } else {
      state.cells = resizeFlat(state.cells);
      syncLayersFromSessionCells();
    }
    return true;
  }

  function clampBoxToCanvas(box) {
    if (!box) return null;
    const { w: cw, h: ch } = sourceCanvasSize();
    let x = Math.max(0, Math.min(cw - 1, Math.round(Number(box.x || 0))));
    let y = Math.max(0, Math.min(ch - 1, Math.round(Number(box.y || 0))));
    let width = Math.max(1, Math.round(Number(box.w || 1)));
    let height = Math.max(1, Math.round(Number(box.h || 1)));
    if (x + width > cw) width = Math.max(1, cw - x);
    if (y + height > ch) height = Math.max(1, ch - y);
    return { x, y, w: width, h: height };
  }

  function boxRight(b) {
    return b.x + b.w - 1;
  }

  function boxBottom(b) {
    return b.y + b.h - 1;
  }

  function boxContainsPt(b, pt) {
    return pt.x >= b.x && pt.y >= b.y && pt.x <= boxRight(b) && pt.y <= boxBottom(b);
  }

  function boxesIntersect(a, b) {
    return !(boxRight(a) < b.x || boxRight(b) < a.x || boxBottom(a) < b.y || boxBottom(b) < a.y);
  }

  function committedBoxesOverlap(candidate, ignoreId = null) {
    const c = clampBoxToCanvas(candidate);
    if (!c) return false;
    return state.extractedBoxes.some((b) => Number(b.id) !== Number(ignoreId) && boxesIntersect(c, b));
  }

  function sourceBoxAtPoint(pt) {
    for (let i = state.extractedBoxes.length - 1; i >= 0; i--) {
      const b = state.extractedBoxes[i];
      if (boxContainsPt(b, pt)) return b;
    }
    return null;
  }

  function sourceVBoxAtPoint(pt, tol = 3) {
    for (let i = state.sourceCutsV.length - 1; i >= 0; i--) {
      const cut = state.sourceCutsV[i];
      if (Math.abs(pt.x - Number(cut.x)) <= tol) return cut;
    }
    return null;
  }

  function sourceHandleAtPoint(box, pt) {
    if (!box) return null;
    const pad = 4;
    const left = box.x;
    const right = boxRight(box);
    const top = box.y;
    const bottom = boxBottom(box);
    const nearL = Math.abs(pt.x - left) <= pad;
    const nearR = Math.abs(pt.x - right) <= pad;
    const nearT = Math.abs(pt.y - top) <= pad;
    const nearB = Math.abs(pt.y - bottom) <= pad;
    if (nearL && nearT) return "nw";
    if (nearR && nearT) return "ne";
    if (nearL && nearB) return "sw";
    if (nearR && nearB) return "se";
    if (nearT && pt.x >= left && pt.x <= right) return "n";
    if (nearB && pt.x >= left && pt.x <= right) return "s";
    if (nearL && pt.y >= top && pt.y <= bottom) return "w";
    if (nearR && pt.y >= top && pt.y <= bottom) return "e";
    if (boxContainsPt(box, pt)) return "move";
    return null;
  }

  function setDraftBox(box) {
    state.drawCurrent = box ? clampBoxToCanvas(box) : null;
  }

  function sourceSelectionPrimaryBox() {
    if (state.sourceSelection.size !== 1) return null;
    const id = [...state.sourceSelection][0];
    return state.extractedBoxes.find((b) => Number(b.id) === Number(id)) || null;
  }

  function clearSourceSelection() {
    state.sourceSelection = new Set();
    state.sourceSelectedCut = null;
  }

  function setSourceMode(mode) {
    state.sourceMode = mode;
    state.drawMode = mode === "draw_box";
    state.drawing = false;
    state.drawStart = null;
    state.sourceDrag = null;
    state.sourceRowDrag = null;
    hideSourceContextMenu();
    updateSourceToolUI();
    renderSourceCanvas();
  }

  function updateSourceToolUI() {
    const mode = state.sourceMode;
    const map = [
      ["sourceSelectBtn", "select"],
      ["drawBoxBtn", "draw_box"],
      ["rowSelectBtn", "row_select"],
      ["colSelectBtn", "col_select"],
      ["cutVBtn", "cut_v"],
    ];
    for (const [id, key] of map) {
      const el = $(id);
      if (!el) continue;
      el.classList.toggle("tool-active", mode === key);
    }
    const hint = $("sourceModeHint");
    if (hint) {
      const txt =
        mode === "draw_box"
          ? "Mode: Draw Box. Drag to create a draft (blue) box. Right-click it to add as a sprite."
          : mode === "row_select"
          ? "Mode: Drag Row. Drag over orange sprites to select intersecting boxes."
          : mode === "col_select"
          ? "Mode: Drag Column. Drag over orange sprites to select intersecting boxes."
          : mode === "cut_v"
          ? "Mode: Vertical Cut. Click to insert a vertical cut, drag existing cut to move."
          : "Mode: Select. Click sprite box to select; drag to move; drag handles to resize.";
      hint.textContent = txt;
    }
    const rapid = $("rapidManualAdd");
    if (rapid) rapid.checked = !!state.rapidManualAdd;
  }

  function hideSourceContextMenu() {
    const menu = $("sourceContextMenu");
    if (menu) menu.classList.add("hidden");
    state.sourceContextTarget = null;
  }

  function showSourceContextMenu(clientX, clientY, target) {
    const menu = $("sourceContextMenu");
    if (!menu) return;
    state.sourceContextTarget = target;
    const isDraft = target?.type === "draft";
    const rowReady = state.selectedRow !== null;
    $("srcCtxAddSprite").disabled = !isDraft;
    $("srcCtxAddToRow").disabled = !isDraft || !rowReady;
    $("srcCtxPadAnchor").disabled = !target;
    $("srcCtxSetAnchor").disabled = !target;
    $("srcCtxDelete").disabled = !target;
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    menu.classList.remove("hidden");
  }

  function setAnchorFromTarget(target) {
    if (!target) return;
    if (target.type === "draft" && state.drawCurrent) {
      pushHistory();
      state.anchorBox = { ...state.drawCurrent };
      status(`Anchor set ${state.anchorBox.w}x${state.anchorBox.h} from draft`, "ok");
      saveSessionState("set-anchor-draft");
    } else if (target.type === "box") {
      const box = state.extractedBoxes.find((b) => Number(b.id) === Number(target.id));
      if (!box) return;
      pushHistory();
      state.anchorBox = { x: box.x, y: box.y, w: box.w, h: box.h };
      status(`Anchor set ${box.w}x${box.h} from sprite`, "ok");
      saveSessionState("set-anchor-box");
    }
  }

  function padRectToAnchor(box) {
    if (!box || !state.anchorBox) return box ? { ...box } : null;
    const aw = Math.max(1, Number(state.anchorBox.w || 1));
    const ah = Math.max(1, Number(state.anchorBox.h || 1));
    const cx = box.x + (box.w / 2);
    const cy = box.y + (box.h / 2);
    const padded = clampBoxToCanvas({
      x: Math.round(cx - (aw / 2)),
      y: Math.round(cy - (ah / 2)),
      w: aw,
      h: ah,
    });
    return padded;
  }

  function applyPadToContextTarget() {
    const t = state.sourceContextTarget;
    if (!t || !state.anchorBox) return;
    if (t.type === "draft" && state.drawCurrent) {
      pushHistory();
      setDraftBox(padRectToAnchor(state.drawCurrent));
      renderSourceCanvas();
      saveSessionState("pad-draft-anchor");
      return;
    }
    if (t.type === "box") {
      const idx = state.extractedBoxes.findIndex((b) => Number(b.id) === Number(t.id));
      if (idx < 0) return;
      const next = padRectToAnchor(state.extractedBoxes[idx]);
      if (committedBoxesOverlap(next, state.extractedBoxes[idx].id)) {
        status("Padding blocked: overlap with another sprite box", "warn");
        return;
      }
      pushHistory();
      state.extractedBoxes[idx] = { ...state.extractedBoxes[idx], ...next };
      renderSourceCanvas();
      saveSessionState("pad-box-anchor");
    }
  }

  function deleteSourceTarget(target) {
    if (!target) return;
    pushHistory();
    if (target.type === "draft") {
      state.drawCurrent = null;
      if (state.anchorBox && target.useDraftAnchor) state.anchorBox = null;
      renderSourceCanvas();
      saveSessionState("delete-draft");
      return;
    }
    if (target.type === "box") {
      state.extractedBoxes = state.extractedBoxes.filter((b) => Number(b.id) !== Number(target.id));
      state.sourceSelection.delete(Number(target.id));
      renderSourceCanvas();
      saveSessionState("delete-source-box");
      return;
    }
    if (target.type === "cut_v") {
      state.sourceCutsV = state.sourceCutsV.filter((c) => Number(c.id) !== Number(target.id));
      if (state.sourceSelectedCut && state.sourceSelectedCut.type === "v" && Number(state.sourceSelectedCut.id) === Number(target.id)) {
        state.sourceSelectedCut = null;
      }
      renderSourceCanvas();
      saveSessionState("delete-cut");
    }
  }

  function commitDraftToSource(kind = "manual", opts = {}) {
    if (!state.drawCurrent) {
      status("No draft box to add", "warn");
      return null;
    }
    const box = clampBoxToCanvas(state.drawCurrent);
    if (committedBoxesOverlap(box, null)) {
      status("Cannot add sprite box: overlaps existing sprite box", "warn");
      return null;
    }
    if (!opts.skipHistory) pushHistory();
    const committed = { id: nextSourceId(), x: box.x, y: box.y, w: box.w, h: box.h, source: kind };
    state.extractedBoxes = [...state.extractedBoxes, committed];
    state.sourceSelection = new Set([committed.id]);
    if (!state.rapidManualAdd) {
      state.drawCurrent = null;
    }
    renderSourceCanvas();
    saveSessionState("add-source-box");
    return committed;
  }

  function applySourceBoxSelectionRect(mode, rect, modifiers) {
    const hits = state.extractedBoxes.filter((b) => boxesIntersect(b, rect)).map((b) => Number(b.id));
    let next = new Set(state.sourceSelection);
    if (modifiers.subtract) {
      for (const id of hits) next.delete(id);
    } else if (modifiers.add) {
      for (const id of hits) next.add(id);
    } else if (modifiers.toggle) {
      for (const id of hits) (next.has(id) ? next.delete(id) : next.add(id));
    } else {
      next = new Set(hits);
    }
    state.sourceSelection = next;
    state.sourceSelectedCut = null;
    const noun = mode === "col_select" ? "column" : "row";
    status(`${noun} select: ${hits.length} hit (${state.sourceSelection.size} selected)`, hits.length ? "ok" : "warn");
  }

  function resizeBoxFromHandle(box, handle, anchorPt, pt) {
    let x0 = box.x;
    let y0 = box.y;
    let x1 = boxRight(box);
    let y1 = boxBottom(box);
    if (handle.includes("w")) x0 = pt.x;
    if (handle.includes("e")) x1 = pt.x;
    if (handle.includes("n")) y0 = pt.y;
    if (handle.includes("s")) y1 = pt.y;
    if (handle === "move") {
      const dx = pt.x - anchorPt.x;
      const dy = pt.y - anchorPt.y;
      x0 = box.x + dx;
      y0 = box.y + dy;
      x1 = boxRight(box) + dx;
      y1 = boxBottom(box) + dy;
    }
    const out = {
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      w: Math.abs(x1 - x0) + 1,
      h: Math.abs(y1 - y0) + 1,
    };
    return clampBoxToCanvas(out);
  }

  function onSourceMouseDown(e) {
    if (!state.sourceImage) return;
    if (e.button !== 0) return;
    hideSourceContextMenu();
    const canvas = $("sourceCanvas");
    const pt = canvasCoord(e, canvas);
    const mode = state.sourceMode;
    if ((mode === "row_select" || mode === "col_select") && state.sourceSelection.size > 0) {
      const hit = sourceBoxAtPoint(pt);
      if (hit && state.sourceSelection.has(Number(hit.id))) {
        state.sourceDrag = {
          type: "drag_source_selection_to_grid",
          startClientX: e.clientX,
          startClientY: e.clientY,
          lastClientX: e.clientX,
          lastClientY: e.clientY,
          moved: false,
        };
        state.sourceDragHoverFrame = null;
        status("Drag selected source sprites to a grid frame cell", "ok");
        return;
      }
    }
    if (mode === "draw_box") {
      pushHistory();
      if (state.rapidManualAdd && state.drawCurrent) {
        commitDraftToSource("manual");
      }
      state.drawing = true;
      state.drawStart = pt;
      state.sourceDrag = { type: "draw", start: pt };
      setDraftBox({ x: pt.x, y: pt.y, w: 1, h: 1 });
      renderSourceCanvas();
      return;
    }
    if (mode === "row_select" || mode === "col_select") {
      state.sourceDrag = { type: mode, start: pt, modifiers: { add: e.shiftKey, subtract: e.altKey, toggle: e.ctrlKey || e.metaKey } };
      state.sourceRowDrag = { mode, rect: { x: pt.x, y: pt.y, w: 1, h: 1 } };
      renderSourceCanvas();
      return;
    }
    if (mode === "cut_v") {
      const cut = sourceVBoxAtPoint(pt);
      pushHistory();
      if (cut) {
        state.sourceSelectedCut = { type: "v", id: cut.id };
        state.sourceDrag = { type: "move_cut_v", id: cut.id };
      } else {
        const existingX = state.sourceCutsV.find((c) => Number(c.x) === Number(pt.x));
        if (!existingX) {
          const newCut = { id: nextSourceId(), x: pt.x };
          state.sourceCutsV = [...state.sourceCutsV, newCut].sort((a, b) => a.x - b.x);
          state.sourceSelectedCut = { type: "v", id: newCut.id };
          saveSessionState("insert-cut-v");
        }
        const selected = sourceVBoxAtPoint(pt, 0) || sourceVBoxAtPoint(pt, 3);
        if (selected) state.sourceDrag = { type: "move_cut_v", id: selected.id };
      }
      renderSourceCanvas();
      return;
    }
    const hit = sourceBoxAtPoint(pt);
    const draftHandle = state.drawCurrent ? sourceHandleAtPoint(state.drawCurrent, pt) : null;
    if (draftHandle && state.drawCurrent) {
      pushHistory();
      state.sourceSelection = new Set();
      state.sourceSelectedCut = null;
      state.sourceDrag = { type: "draft_edit", handle: draftHandle, anchor: pt, original: { ...state.drawCurrent } };
      renderSourceCanvas();
      return;
    }
    if (hit) {
      if (e.ctrlKey || e.metaKey) {
        const id = Number(hit.id);
        if (state.sourceSelection.has(id)) state.sourceSelection.delete(id);
        else state.sourceSelection.add(id);
      } else if (!state.sourceSelection.has(Number(hit.id)) || state.sourceSelection.size !== 1) {
        state.sourceSelection = new Set([Number(hit.id)]);
      }
      state.sourceSelectedCut = null;
      const primary = sourceSelectionPrimaryBox() || hit;
      const handle = sourceHandleAtPoint(primary, pt);
      if (mode === "select" && (!handle || handle === "move")) {
        state.sourceDrag = {
          type: "drag_source_selection_to_grid",
          startClientX: e.clientX,
          startClientY: e.clientY,
          lastClientX: e.clientX,
          lastClientY: e.clientY,
          moved: false,
        };
        state.sourceDragHoverFrame = null;
        renderSourceCanvas();
        status("Drag selected source sprites to a grid frame cell", "ok");
        return;
      }
      pushHistory();
      state.sourceDrag = { type: "box_edit", boxId: Number(primary.id), handle: handle || "move", anchor: pt, original: { ...primary } };
      renderSourceCanvas();
      return;
    }
    const cutHit = sourceVBoxAtPoint(pt);
    if (cutHit) {
      state.sourceSelectedCut = { type: "v", id: cutHit.id };
      state.sourceSelection = new Set();
      state.sourceDrag = { type: "move_cut_v", id: Number(cutHit.id) };
      renderSourceCanvas();
      return;
    }
    clearSourceSelection();
    renderSourceCanvas();
  }

  function onSourceMouseMove(e) {
    if (!state.sourceImage) return;
    const pt = canvasCoord(e, $("sourceCanvas"));
    if (!state.sourceDrag) return;
    const d = state.sourceDrag;
    if (d.type === "draw" && d.start) {
      setDraftBox(normalizeBox(d.start, pt));
    } else if ((d.type === "row_select" || d.type === "col_select") && d.start) {
      state.sourceRowDrag = { mode: d.type, rect: normalizeBox(d.start, pt) };
    } else if (d.type === "draft_edit") {
      const next = resizeBoxFromHandle(d.original, d.handle, d.anchor, pt);
      setDraftBox(next);
    } else if (d.type === "box_edit") {
      const idx = state.extractedBoxes.findIndex((b) => Number(b.id) === Number(d.boxId));
      if (idx >= 0) {
        const next = resizeBoxFromHandle(d.original, d.handle, d.anchor, pt);
        if (!committedBoxesOverlap(next, d.boxId)) {
          state.extractedBoxes[idx] = { ...state.extractedBoxes[idx], ...next };
        }
      }
    } else if (d.type === "move_cut_v") {
      const idx = state.sourceCutsV.findIndex((c) => Number(c.id) === Number(d.id));
      if (idx >= 0) {
        const { w } = sourceCanvasSize();
        state.sourceCutsV[idx] = { ...state.sourceCutsV[idx], x: Math.max(0, Math.min(w - 1, pt.x)) };
        state.sourceCutsV.sort((a, b) => a.x - b.x);
      }
    } else if (d.type === "drag_source_selection_to_grid") {
      d.lastClientX = e.clientX;
      d.lastClientY = e.clientY;
      if (Math.abs(e.clientX - d.startClientX) > 3 || Math.abs(e.clientY - d.startClientY) > 3) d.moved = true;
      state.sourceDragHoverFrame = gridFrameFromClientPoint(e.clientX, e.clientY);
      if (state.sourceDragHoverFrame) {
        status(
          `Drop target: Angle ${state.sourceDragHoverFrame.row} (${angleNameForIndex(state.sourceDragHoverFrame.row)}), Frame ${frameColInfo(state.sourceDragHoverFrame.col).frame}`,
          "ok"
        );
      }
    }
    renderSourceCanvas();
  }

  function onSourceMouseUp(e) {
    if (!state.sourceDrag) return;
    const d = state.sourceDrag;
    const pt = canvasCoord(e, $("sourceCanvas"));
    if (d.type === "draw" && d.start) {
      setDraftBox(normalizeBox(d.start, pt));
      if (state.rapidManualAdd && state.drawCurrent) {
        commitDraftToSource("manual", { skipHistory: false });
      } else {
        status(`Draft box ${state.drawCurrent?.w || 0}x${state.drawCurrent?.h || 0}`, "ok");
      }
    } else if (d.type === "draft_edit") {
      const next = resizeBoxFromHandle(d.original, d.handle, d.anchor, pt);
      setDraftBox(next);
    } else if (d.type === "box_edit") {
      const idx = state.extractedBoxes.findIndex((b) => Number(b.id) === Number(d.boxId));
      if (idx >= 0) {
        const next = resizeBoxFromHandle(d.original, d.handle, d.anchor, pt);
        if (!committedBoxesOverlap(next, d.boxId)) {
          state.extractedBoxes[idx] = { ...state.extractedBoxes[idx], ...next };
          saveSessionState("edit-source-box");
        } else {
          state.extractedBoxes[idx] = { ...state.extractedBoxes[idx], ...d.original };
          status("Move/resize blocked: overlap with another sprite box", "warn");
        }
      }
    } else if (d.type === "row_select" || d.type === "col_select") {
      const rect = normalizeBox(d.start, pt);
      state.sourceRowDrag = { mode: d.type, rect };
      applySourceBoxSelectionRect(d.type, rect, d.modifiers || {});
      saveSessionState(d.type);
    } else if (d.type === "move_cut_v") {
      saveSessionState("move-cut-v");
    } else if (d.type === "drag_source_selection_to_grid") {
      const didDrop = d.moved ? dropSelectedSourceBoxesAtClientPoint(e.clientX, e.clientY) : false;
      if (!didDrop && !d.moved) {
        status(`${state.sourceSelection.size} source sprite box(es) selected`, state.sourceSelection.size ? "ok" : "warn");
      }
    }
    state.drawing = false;
    state.drawStart = null;
    state.sourceDrag = null;
    state.sourceDragHoverFrame = null;
    state.sourceRowDrag = null;
    renderSourceCanvas();
  }

  function findSprites() {
    if (!state.sourceImage) {
      status("Load source image first", "err");
      return;
    }
    const threshold = Math.max(0, Math.min(255, Number($("threshold").value || 48)));
    const minSize = Math.max(1, Number($("minSize").value || 8));
    const canvas = $("sourceCanvas");
    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;
    const w = canvas.width;
    const h = canvas.height;
    const idxOf = (x, y) => (y * w + x) * 4;
    const visited = new Uint8Array(w * h);

    const corners = [
      [0, 0],
      [w - 1, 0],
      [0, h - 1],
      [w - 1, h - 1],
    ];
    let br = 0,
      bg = 0,
      bb = 0;
    for (const [x, y] of corners) {
      const i = idxOf(x, y);
      br += data[i + 0];
      bg += data[i + 1];
      bb += data[i + 2];
    }
    br /= corners.length;
    bg /= corners.length;
    bb /= corners.length;

    const isFg = (x, y) => {
      const i = idxOf(x, y);
      const a = data[i + 3];
      if (a < 24) return false;
      const dr = Math.abs(data[i + 0] - br);
      const dg = Math.abs(data[i + 1] - bg);
      const db = Math.abs(data[i + 2] - bb);
      return dr + dg + db > threshold;
    };

    const boxes = [];
    const qx = [];
    const qy = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const vi = y * w + x;
        if (visited[vi]) continue;
        visited[vi] = 1;
        if (!isFg(x, y)) continue;
        let head = 0;
        qx.length = 0;
        qy.length = 0;
        qx.push(x);
        qy.push(y);
        let minX = x,
          minY = y,
          maxX = x,
          maxY = y,
          count = 0;
        while (head < qx.length) {
          const cx = qx[head];
          const cy = qy[head];
          head += 1;
          count += 1;
          if (cx < minX) minX = cx;
          if (cy < minY) minY = cy;
          if (cx > maxX) maxX = cx;
          if (cy > maxY) maxY = cy;
          const n = [
            [cx - 1, cy],
            [cx + 1, cy],
            [cx, cy - 1],
            [cx, cy + 1],
          ];
          for (const [nx, ny] of n) {
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (visited[ni]) continue;
            visited[ni] = 1;
            if (!isFg(nx, ny)) continue;
            qx.push(nx);
            qy.push(ny);
          }
        }
        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        if (bw >= minSize && bh >= minSize && count >= minSize) {
          boxes.push({ x: minX, y: minY, w: bw, h: bh });
        }
      }
    }

    let filtered = boxes;
    if (state.anchorBox) {
      const aw = state.anchorBox.w;
      const ah = state.anchorBox.h;
      const scored = boxes
        .map((b) => {
          const ws = Math.abs(b.w - aw) / Math.max(1, aw);
          const hs = Math.abs(b.h - ah) / Math.max(1, ah);
          return { b, score: ws + hs };
        })
        .sort((a, b) => a.score - b.score);
      filtered = scored.filter((s) => s.score <= 0.9).map((s) => s.b);
      // Fail-open to best size matches when strict cut yields none.
      if (!filtered.length && scored.length) {
        filtered = scored.slice(0, Math.min(24, scored.length)).map((s) => s.b);
      }
    }
    pushHistory();
    const manual = state.extractedBoxes.filter((b) => String(b.source || "") === "manual");
    const merged = [...manual];
    for (const b of filtered) {
      const candidate = clampBoxToCanvas(b);
      if (!candidate) continue;
      if (merged.some((m) => boxesIntersect(m, candidate))) continue;
      merged.push({ id: nextSourceId(), x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h, source: "auto" });
    }
    state.extractedBoxes = merged;
    renderSourceCanvas();
    status(`Find Sprites: ${filtered.length} matched (${merged.length} total boxes)`, filtered.length > 0 ? "ok" : "warn");
  }

  function buildRawSourceCanvas() {
    if (!state.sourceImage) return null;
    const c = document.createElement("canvas");
    c.width = state.sourceImage.width;
    c.height = state.sourceImage.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(state.sourceImage, 0, 0);
    return c;
  }

  function estimateBgRgbFromImageData(data, w, h) {
    const samples = [
      [0, 0],
      [Math.max(0, w - 1), 0],
      [0, Math.max(0, h - 1)],
      [Math.max(0, w - 1), Math.max(0, h - 1)],
    ];
    let r = 0, g = 0, b = 0;
    for (const [x, y] of samples) {
      const i = (y * w + x) * 4;
      r += data[i + 0];
      g += data[i + 1];
      b += data[i + 2];
    }
    return [Math.round(r / samples.length), Math.round(g / samples.length), Math.round(b / samples.length)];
  }

  function sourceCellFromPatch(rgbaData, imgW, imgH, patchBox, bgRgb, threshold) {
    const px0 = Math.max(0, Math.min(imgW - 1, patchBox.x));
    const py0 = Math.max(0, Math.min(imgH - 1, patchBox.y));
    const px1 = Math.max(px0 + 1, Math.min(imgW, patchBox.x + patchBox.w));
    const py1 = Math.max(py0 + 1, Math.min(imgH, patchBox.y + patchBox.h));
    const split = Math.max(py0 + 1, Math.floor((py0 + py1) / 2));
    const regionStats = (yStart, yEnd) => {
      let sig = 0;
      let total = 0;
      let rs = 0, gs = 0, bs = 0;
      for (let y = yStart; y < yEnd; y++) {
        for (let x = px0; x < px1; x++) {
          const i = (y * imgW + x) * 4;
          total += 1;
          const a = rgbaData[i + 3];
          if (a < 16) continue;
          const dr = Math.abs(rgbaData[i + 0] - bgRgb[0]);
          const dg = Math.abs(rgbaData[i + 1] - bgRgb[1]);
          const db = Math.abs(rgbaData[i + 2] - bgRgb[2]);
          if (dr + dg + db <= threshold) continue;
          sig += 1;
          rs += rgbaData[i + 0];
          gs += rgbaData[i + 1];
          bs += rgbaData[i + 2];
        }
      }
      if (sig <= 0 || total <= 0) return null;
      const occ = sig / total;
      if (occ < 0.04) return null;
      return {
        occ,
        rgb: [
          Math.max(28, Math.min(220, Math.round(rs / sig))),
          Math.max(28, Math.min(220, Math.round(gs / sig))),
          Math.max(28, Math.min(220, Math.round(bs / sig))),
        ],
      };
    };
    const top = regionStats(py0, Math.max(py0 + 1, split));
    const bot = regionStats(Math.max(py0 + 1, split), py1);
    if (!top && !bot) return { glyph: 0, fg: [0, 0, 0], bg: [...MAGENTA] };
    if (top && !bot) return { glyph: 223, fg: top.rgb, bg: [...MAGENTA] };
    if (!top && bot) return { glyph: 220, fg: bot.rgb, bg: [...MAGENTA] };
    const diff = Math.abs(top.rgb[0] - bot.rgb[0]) + Math.abs(top.rgb[1] - bot.rgb[1]) + Math.abs(top.rgb[2] - bot.rgb[2]);
    if (diff < 20) {
      return {
        glyph: 219,
        fg: [
          Math.round((top.rgb[0] + bot.rgb[0]) / 2),
          Math.round((top.rgb[1] + bot.rgb[1]) / 2),
          Math.round((top.rgb[2] + bot.rgb[2]) / 2),
        ],
        bg: [0, 0, 0],
      };
    }
    return { glyph: 223, fg: top.rgb, bg: bot.rgb };
  }

  function frameCellsFromSourceBox(box) {
    const raw = buildRawSourceCanvas();
    if (!raw) return null;
    const ctx = raw.getContext("2d");
    const img = ctx.getImageData(0, 0, raw.width, raw.height);
    const data = img.data;
    const bg = estimateBgRgbFromImageData(data, raw.width, raw.height);
    const threshold = Math.max(0, Math.min(255, Number($("threshold").value || 48)));
    const out = [];
    const fw = Math.max(1, state.frameWChars);
    const fh = Math.max(1, state.frameHChars);
    for (let cy = 0; cy < fh; cy++) {
      const row = [];
      for (let cx = 0; cx < fw; cx++) {
        const x0 = box.x + Math.floor((cx * box.w) / fw);
        const x1 = box.x + Math.floor(((cx + 1) * box.w) / fw);
        const y0 = box.y + Math.floor((cy * box.h) / fh);
        const y1 = box.y + Math.floor(((cy + 1) * box.h) / fh);
        row.push(
          sourceCellFromPatch(
            data,
            raw.width,
            raw.height,
            { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) },
            bg,
            threshold
          )
        );
      }
      out.push(row);
    }
    return out;
  }

  function frameIsEmpty(row, col) {
    for (let y = 0; y < state.frameHChars; y++) {
      for (let x = 0; x < state.frameWChars; x++) {
        const gx = col * state.frameWChars + x;
        const gy = row * state.frameHChars + y;
        if (gx >= state.gridCols || gy >= state.gridRows) continue;
        const c = cellForRender(gx, gy);
        if (Number(c.glyph || 0) > 32) return false;
      }
    }
    return true;
  }

  function selectedFrameColsSorted() {
    return selectedColsForRow(state.selectedRow);
  }

  function frameVisualBounds(row, col) {
    let minX = null;
    let minY = null;
    let maxX = null;
    let maxY = null;
    for (let y = 0; y < state.frameHChars; y++) {
      for (let x = 0; x < state.frameWChars; x++) {
        const gx = col * state.frameWChars + x;
        const gy = row * state.frameHChars + y;
        if (gx >= state.gridCols || gy >= state.gridRows) continue;
        const c = cellForRender(gx, gy);
        if (Number(c.glyph || 0) <= 32) continue;
        minX = minX === null ? x : Math.min(minX, x);
        minY = minY === null ? y : Math.min(minY, y);
        maxX = maxX === null ? x : Math.max(maxX, x);
        maxY = maxY === null ? y : Math.max(maxY, y);
      }
    }
    if (minX === null) return null;
    return { minX, minY, maxX, maxY, w: (maxX - minX + 1), h: (maxY - minY + 1) };
  }

  function frameBoundsForCols(row, cols) {
    return cols
      .map((col) => ({ row, col, bounds: frameVisualBounds(row, col) }))
      .filter((x) => !!x.bounds);
  }

  function medianInt(values) {
    const vals = (values || []).filter((v) => Number.isFinite(Number(v))).map((v) => Number(v)).sort((a, b) => a - b);
    if (!vals.length) return 0;
    const mid = Math.floor(vals.length / 2);
    if (vals.length % 2 === 1) return vals[mid];
    return Math.round((vals[mid - 1] + vals[mid]) / 2);
  }

  function computeAlignTarget(boundsEntries, refMode) {
    if (!boundsEntries.length) return null;
    if (refMode === "first_selected") {
      const b = boundsEntries[0].bounds;
      return {
        left: b.minX,
        top: b.minY,
        right: b.maxX,
        bottom: b.maxY,
        center2: b.minX + b.maxX,
        middle2: b.minY + b.maxY,
      };
    }
    const bs = boundsEntries.map((e) => e.bounds);
    return {
      left: medianInt(bs.map((b) => b.minX)),
      top: medianInt(bs.map((b) => b.minY)),
      right: medianInt(bs.map((b) => b.maxX)),
      bottom: medianInt(bs.map((b) => b.maxY)),
      center2: medianInt(bs.map((b) => b.minX + b.maxX)),
      middle2: medianInt(bs.map((b) => b.minY + b.maxY)),
    };
  }

  function computeAlignShift(bounds, target, mode) {
    if (!bounds || !target) return { dx: 0, dy: 0 };
    const center2 = bounds.minX + bounds.maxX;
    const middle2 = bounds.minY + bounds.maxY;
    if (mode === "bottom_left") {
      return { dx: target.left - bounds.minX, dy: target.bottom - bounds.maxY };
    }
    if (mode === "top_left") {
      return { dx: target.left - bounds.minX, dy: target.top - bounds.minY };
    }
    if (mode === "center") {
      return {
        dx: Math.round((target.center2 - center2) / 2),
        dy: Math.round((target.middle2 - middle2) / 2),
      };
    }
    return {
      dx: Math.round((target.center2 - center2) / 2),
      dy: target.bottom - bounds.maxY,
    };
  }

  function shiftFrameContents(row, col, dx, dy) {
    dx = Math.round(Number(dx || 0));
    dy = Math.round(Number(dy || 0));
    if (!dx && !dy) return { moved: false, clippedCells: 0 };
    const src = [];
    for (let y = 0; y < state.frameHChars; y++) {
      const line = [];
      for (let x = 0; x < state.frameWChars; x++) {
        const gx = col * state.frameWChars + x;
        const gy = row * state.frameHChars + y;
        if (gx >= state.gridCols || gy >= state.gridRows) line.push(transparentCell(0));
        else line.push({ ...cellAt(gx, gy) });
      }
      src.push(line);
    }

    let clippedCells = 0;
    clearFrame(row, col);
    for (let y = 0; y < state.frameHChars; y++) {
      for (let x = 0; x < state.frameWChars; x++) {
        const c = src[y][x];
        if (Number(c.glyph || 0) <= 32) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= state.frameWChars || ny >= state.frameHChars) {
          clippedCells += 1;
          continue;
        }
        const gx = col * state.frameWChars + nx;
        const gy = row * state.frameHChars + ny;
        if (gx >= state.gridCols || gy >= state.gridRows) {
          clippedCells += 1;
          continue;
        }
        setCell(gx, gy, c);
      }
    }
    return { moved: true, clippedCells };
  }

  function clampShiftToFrameBounds(bounds, dx, dy) {
    dx = Math.round(Number(dx || 0));
    dy = Math.round(Number(dy || 0));
    if (!bounds) return { dx, dy, clamped: false };
    const minDx = -Number(bounds.minX || 0);
    const maxDx = Math.max(0, state.frameWChars - 1 - Number(bounds.maxX || 0));
    const minDy = -Number(bounds.minY || 0);
    const maxDy = Math.max(0, state.frameHChars - 1 - Number(bounds.maxY || 0));
    const cdx = Math.max(minDx, Math.min(maxDx, dx));
    const cdy = Math.max(minDy, Math.min(maxDy, dy));
    return { dx: cdx, dy: cdy, clamped: cdx !== dx || cdy !== dy };
  }

  function nudgeSelectedFrames(dx, dy) {
    if (!editableLayerActive()) {
      status("Selected layer is read-only. Switch to Visual layer (2) to edit.", "warn");
      return false;
    }
    if (!hasSingleSelectedRow()) {
      status("Select one or more frames on a single row first", "warn");
      return false;
    }
    if (state.selectedRow === null || state.selectedCols.size === 0) {
      status("Select one or more frames on a row first", "warn");
      return false;
    }
    const row = Number(state.selectedRow);
    const cols = selectedFrameColsSorted();
    let moved = 0;
    let clipped = 0;
    let clampedFrames = 0;
    const changed = commitWholeSheetDocumentMutation("nudge-frame-jitter", function() {
      for (const col of cols) {
        const bounds = frameVisualBounds(row, col);
        const shift = clampShiftToFrameBounds(bounds, dx, dy);
        if (shift.clamped) clampedFrames += 1;
        const res = shiftFrameContents(row, col, shift.dx, shift.dy);
        if (res.moved) moved += 1;
        clipped += Number(res.clippedCells || 0);
      }
    });
    if (!changed) {
      status("Nudge made no changes", "warn");
      return false;
    }
    status(
      `Nudged ${moved} frame(s) by dx=${dx}, dy=${dy}${clampedFrames ? ` (clamped ${clampedFrames} frame(s) at bounds)` : ""}${clipped ? ` (clipped ${clipped} cells)` : ""}`,
      clipped ? "warn" : (clampedFrames ? "warn" : "ok")
    );
    return true;
  }

  function autoAlignFrameJitter(useEntireRow = false) {
    if (!editableLayerActive()) {
      status("Selected layer is read-only. Switch to Visual layer (2) to edit.", "warn");
      return false;
    }
    if (!hasSingleSelectedRow()) {
      status("Select frames on a single row first", "warn");
      return false;
    }
    if (state.selectedRow === null) {
      status("Select a grid row/frame first", "warn");
      return false;
    }
    const row = Number(state.selectedRow);
    const cols = useEntireRow
      ? Array.from({ length: totalGridFrameCols() }, (_v, i) => i)
      : selectedFrameColsSorted();
    if (!cols.length) {
      status("Select one or more frames on a row first", "warn");
      return false;
    }
    const entries = frameBoundsForCols(row, cols);
    if (entries.length < 2) {
      status(entries.length === 1 ? "Only one non-empty frame in selection; no jitter alignment needed" : "No non-empty frames in selection", "warn");
      return false;
    }
    const alignMode = String($("jitterAlignMode")?.value || "bottom_center");
    const refMode = String($("jitterRefMode")?.value || "first_selected");
    const target = computeAlignTarget(entries, refMode);
    let shifted = 0;
    let clipped = 0;
    let clampedFrames = 0;
    const changed = commitWholeSheetDocumentMutation(
      useEntireRow ? "auto-align-row-jitter" : "auto-align-selected-jitter",
      function() {
        for (const entry of entries) {
          const wanted = computeAlignShift(entry.bounds, target, alignMode);
          const shift = clampShiftToFrameBounds(entry.bounds, wanted.dx, wanted.dy);
          if (shift.clamped) clampedFrames += 1;
          if (!shift.dx && !shift.dy) continue;
          const res = shiftFrameContents(row, entry.col, shift.dx, shift.dy);
          if (res.moved) shifted += 1;
          clipped += Number(res.clippedCells || 0);
        }
      }
    );
    if (!changed) {
      status("Auto-align made no changes", "warn");
      return false;
    }
    status(
      `Auto-aligned ${shifted} frame(s) on row ${row} (${alignMode}, ${refMode})${clampedFrames ? `; clamped ${clampedFrames} at frame bounds` : ""}${clipped ? `; clipped ${clipped} cells` : ""}`,
      (clipped || clampedFrames) ? "warn" : "ok"
    );
    return true;
  }

  async function runMountedOverlayCalibration() {
    if (!state.sessionId) {
      status("Open or create a session before mounted calibration.", "warn");
      return;
    }
    const mountedPath = String(state.activeActionKey || "").includes("attack")
      ? "sprites/wolack-0001.xp"
      : "sprites/wolfie-0100.xp";
    const out = $("mountedReviewOut");
    if (out) out.textContent = "Computing mounted calibration artifact...";
    const r = await fetch(bp("/api/workbench/mounted-calibration/compute"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player_xp: "sprites/player-0100.xp",
        mounted_xp: mountedPath,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      status(data.error || "Mounted calibration failed", "err");
      if (out) out.textContent = JSON.stringify(data, null, 2);
      return;
    }
    const save = await fetch(bp("/api/workbench/session/mounted-calibration"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId, data }),
    });
    const saved = await save.json().catch(() => ({}));
    if (!save.ok) {
      status(saved.error || "Mounted calibration artifact save failed", "err");
      if (out) out.textContent = JSON.stringify(saved, null, 2);
      return;
    }
    if (out) out.textContent = JSON.stringify(data, null, 2);
    status("Mounted calibration artifact saved without mutating XP art.", "ok");
  }

  async function runMountedSemanticReview() {
    if (!state.sessionId) {
      status("Open or create a session before mounted semantic review.", "warn");
      return;
    }
    const out = $("mountedReviewOut");
    if (out) out.textContent = "Computing mounted semantic review artifact...";
    const r = await fetch(bp("/api/workbench/mounted-semantic/proposals"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      status(data.error || "Mounted semantic review failed", "err");
      if (out) out.textContent = JSON.stringify(data, null, 2);
      return;
    }
    const save = await fetch(bp("/api/workbench/session/mounted-semantic-review"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId, data }),
    });
    const saved = await save.json().catch(() => ({}));
    if (!save.ok) {
      status(saved.error || "Mounted semantic review artifact save failed", "err");
      if (out) out.textContent = JSON.stringify(saved, null, 2);
      return;
    }
    if (out) out.textContent = JSON.stringify(data, null, 2);
    status("Mounted semantic review artifact saved without mutating XP art.", "ok");
  }

  function renderJitterInfo() {
    const el = $("jitterInfo");
    if (!el) return;
    const jitterRowInput = $("jitterRow");
    if (jitterRowInput) {
      jitterRowInput.min = "0";
      jitterRowInput.max = String(Math.max(0, state.angles - 1));
      jitterRowInput.value = String(state.selectedRow === null ? 0 : Number(state.selectedRow));
      jitterRowInput.disabled = state.angles <= 0;
    }
    if (!hasGridSelection()) {
      el.textContent = "Select one or more grid frames on a row to align/nudge jitter.";
      return;
    }
    if (!hasSingleSelectedRow()) {
      el.textContent = `Selection spans ${selectedRowsSorted().length} rows. Row jitter actions require a single-row selection.`;
      return;
    }
    const row = Number(state.selectedRow);
    const cols = selectedFrameColsSorted();
    const firstCol = cols[0];
    const firstBounds = frameVisualBounds(row, firstCol);
    const entries = frameBoundsForCols(row, cols);
    const nonEmpty = entries.length;
    const total = cols.length;
    if (!firstBounds) {
      el.textContent = `Row ${row} selected (${total} frame(s)); first selected frame is empty. Use W/A/S/D or Option+Arrow to nudge frame contents.`;
      return;
    }
    el.textContent = `Row ${row} (${angleNameForIndex(row)}) | selected=${total} non_empty=${nonEmpty} | first_bounds x=${firstBounds.minX}..${firstBounds.maxX} y=${firstBounds.minY}..${firstBounds.maxY} (${firstBounds.w}x${firstBounds.h}) | W/A/S/D or Option+Arrow nudges selected frames`;
  }

  function totalGridFrameCols() {
    return authoringFrameCols();
  }

  function selectedSemanticFrameIndices() {
    return [...new Set(
      selectedFrameCoordsSorted()
        .map((coord) => frameColInfo(coord.col).frame)
        .filter((frame) => Number.isFinite(frame))
    )].sort((a, b) => a - b);
  }

  function semanticFrameAuthoringCols(frameIndex, semanticFrames = semanticFrameCount(), projections = authoringProjectionCount()) {
    const cols = [];
    const frame = Math.max(0, Math.min(Math.max(0, semanticFrames - 1), Number(frameIndex || 0)));
    const total = Math.max(1, Number(semanticFrames || 1));
    const projCount = Math.max(1, Number(projections || 1));
    for (let proj = 0; proj < projCount; proj++) {
      cols.push((proj * total) + frame);
    }
    return cols;
  }

  function buildBlankLayerCellsForGeometry(cols, rows) {
    const out = [];
    const safeCols = Math.max(1, Math.floor(Number(cols) || 1));
    const safeRows = Math.max(1, Math.floor(Number(rows) || 1));
    for (let idx = 0; idx < safeCols * safeRows; idx++) out.push(transparentCell(idx));
    return out;
  }

  function cloneCellWithIdx(cell, idx) {
    return {
      idx,
      glyph: Number(cell?.glyph || 0),
      fg: [Number(cell?.fg?.[0] || 0), Number(cell?.fg?.[1] || 0), Number(cell?.fg?.[2] || 0)],
      bg: [Number(cell?.bg?.[0] || 0), Number(cell?.bg?.[1] || 0), Number(cell?.bg?.[2] || 0)],
    };
  }

  function rebuildGridWithAuthoringCols(keepCols) {
    const nextCols = (keepCols || []).map((col) => Number(col)).filter((col) => Number.isFinite(col) && col >= 0);
    const nextGridCols = Math.max(1, nextCols.length * Math.max(1, Number(state.frameWChars || 1)));
    const nextGridRows = Math.max(1, Number(state.gridRows || 1));
    const oldGridCols = Math.max(1, Number(state.gridCols || 1));
    const oldGridRows = Math.max(1, Number(state.gridRows || 1));
    const nextLayers = (Array.isArray(state.layers) && state.layers.length ? state.layers : [buildBlankLayerCells()])
      .map(() => buildBlankLayerCellsForGeometry(nextGridCols, nextGridRows));

    for (let layerIndex = 0; layerIndex < nextLayers.length; layerIndex++) {
      const srcLayer = Array.isArray(state.layers?.[layerIndex]) ? state.layers[layerIndex] : buildBlankLayerCellsForGeometry(oldGridCols, oldGridRows);
      for (let y = 0; y < nextGridRows; y++) {
        for (let newCol = 0; newCol < nextCols.length; newCol++) {
          const oldCol = nextCols[newCol];
          for (let x = 0; x < state.frameWChars; x++) {
            const srcX = (oldCol * state.frameWChars) + x;
            const dstX = (newCol * state.frameWChars) + x;
            const srcIdx = (y * oldGridCols) + srcX;
            const dstIdx = (y * nextGridCols) + dstX;
            const srcCell = srcX < oldGridCols ? srcLayer[srcIdx] : null;
            nextLayers[layerIndex][dstIdx] = cloneCellWithIdx(srcCell, dstIdx);
          }
        }
      }
    }

    state.gridCols = nextGridCols;
    state.gridRows = nextGridRows;
    state.layers = nextLayers;
    state.layers[0] = applyMetadataRowToLayer(state.layers[0]);
    state.cells = state.layers[2] ? deepCloneCells(state.layers[2]) : buildBlankLayerCellsForGeometry(nextGridCols, nextGridRows);
  }

  function removeSemanticFramesFromAnims(removals) {
    const removeSet = new Set((removals || []).map((frame) => Number(frame)));
    const nextAnims = [];
    let cursor = 0;
    for (const len of state.anims) {
      let kept = 0;
      const safeLen = Math.max(0, Number(len || 0));
      for (let offset = 0; offset < safeLen; offset++) {
        if (!removeSet.has(cursor + offset)) kept += 1;
      }
      if (kept > 0) nextAnims.push(kept);
      cursor += safeLen;
    }
    return nextAnims.length ? nextAnims : [1];
  }

  function remapFrameGroupsAfterDeletion(removals) {
    const removed = [...new Set((removals || []).map((frame) => Number(frame)).filter((frame) => Number.isFinite(frame)))].sort((a, b) => a - b);
    if (!removed.length) return;
    const removedSet = new Set(removed);
    state.frameGroups = (state.frameGroups || [])
      .map((group) => {
        const cols = [...new Set((group.cols || [])
          .map((col) => Number(col))
          .filter((col) => Number.isFinite(col) && !removedSet.has(col))
          .map((col) => col - removed.filter((removedCol) => removedCol < col).length))]
          .sort((a, b) => a - b);
        return cols.length ? { ...group, cols } : null;
      })
      .filter(Boolean);
  }

  function addGridFrameSlot() {
    if (!editableLayerActive()) {
      status("Selected layer is read-only. Switch to Visual layer (2) to edit.", "warn");
      return false;
    }
    if (!(state.frameWChars > 0 && state.gridRows > 0)) {
      status("No grid/session loaded", "warn");
      return false;
    }
    const charColsPerSemanticFrame = Math.max(1, Number(state.frameWChars || 1) * Math.max(1, authoringProjectionCount()));
    const changed = commitWholeSheetDocumentMutation("grid-add-frame", function() {
      if (!Array.isArray(state.anims) || !state.anims.length) state.anims = [1];
      else state.anims[state.anims.length - 1] = Math.max(1, Number(state.anims[state.anims.length - 1] || 1) + 1);
      resizeGridCharCanvas(Number(state.gridCols || 0) + charColsPerSemanticFrame, state.gridRows || 1);
      const lastCol = Math.max(0, totalGridFrameCols() - 1);
      const row = state.selectedRow === null ? 0 : Math.max(0, Math.min(state.angles - 1, Number(state.selectedRow)));
      setGridSelection([{ row, col: lastCol }], { anchor: { row, col: lastCol }, focus: { row, col: lastCol } });
    });
    if (!changed) {
      status("Add Frame made no changes", "warn");
      return false;
    }
    status(`Added frame slot (frames=${state.anims.reduce((a, b) => a + b, 0)})`, "ok");
    return true;
  }

  function deleteSelectedFrameSlots() {
    if (!editableLayerActive()) {
      status("Selected layer is read-only. Switch to Visual layer (2) to edit.", "warn");
      return false;
    }
    if (state.selectedRow === null || state.selectedCols.size === 0) {
      status("Select one or more frame tiles first", "warn");
      return false;
    }
    const semanticFrames = semanticFrameCount();
    if (semanticFrames <= 1) {
      status("Cannot delete the final semantic frame slot", "warn");
      return false;
    }
    const targetFrames = selectedSemanticFrameIndices();
    if (!targetFrames.length) {
      status("No semantic frame slot selected", "warn");
      return false;
    }
    if (targetFrames.length >= semanticFrames) {
      status("Cannot delete every semantic frame slot", "warn");
      return false;
    }

    const selectedRows = selectedRowsSorted();
    const focusRow = state.selectedRow === null ? 0 : Math.max(0, Math.min(state.angles - 1, Number(state.selectedRow)));
    const projections = authoringProjectionCount();
    const changed = commitWholeSheetDocumentMutation("grid-delete-frame", function() {
      const keepCols = [];
      for (let col = 0; col < authoringFrameCols(); col++) {
        if (!targetFrames.includes(frameColInfo(col).frame)) keepCols.push(col);
      }
      if (!keepCols.length) return;
      state.anims = removeSemanticFramesFromAnims(targetFrames);
      remapFrameGroupsAfterDeletion(targetFrames);
      rebuildGridWithAuthoringCols(keepCols);
      recomputeFrameGeometry();

      const nextSemanticFrames = semanticFrameCount();
      const selectionFrame = Math.max(0, Math.min(nextSemanticFrames - 1, targetFrames[0]));
      const nextRows = selectedRows.length ? selectedRows : [focusRow];
      const repairedCoords = [];
      for (const row of nextRows) {
        for (const col of semanticFrameAuthoringCols(selectionFrame, nextSemanticFrames, projections)) {
          repairedCoords.push({ row, col });
        }
      }
      const repairedRow = Math.max(0, Math.min(state.angles - 1, focusRow));
      const repairedCols = semanticFrameAuthoringCols(selectionFrame, nextSemanticFrames, projections);
      const repairedCol = repairedCols.length ? repairedCols[0] : 0;
      setGridSelection(repairedCoords, {
        anchor: { row: repairedRow, col: repairedCol },
        focus: { row: repairedRow, col: repairedCol },
      });
      if (state.inspectorOpen) {
        state.inspectorRow = state.selectedRow;
        state.inspectorCol = Math.min(...state.selectedCols);
      }
    });
    if (!changed) {
      status("Delete Frame made no changes", "warn");
      return false;
    }
    status(`Deleted ${targetFrames.length} semantic frame slot(s)`, "ok");
    return true;
  }

  function jumpSelectionToRow(row) {
    if (!Number.isFinite(Number(row))) return false;
    const nextRow = Math.max(0, Math.min(state.angles - 1, Math.round(Number(row))));
    if (state.angles <= 0) return false;
    if (!hasSingleSelectedRow()) {
      selectFrame(nextRow, 0, false);
      return true;
    }
    const cols = selectedFrameColsSorted();
    setGridSelection(cols.map((col) => ({ row: nextRow, col })), {
      anchor: { row: nextRow, col: cols[0] ?? 0 },
      focus: { row: nextRow, col: cols[0] ?? 0 },
    });
    renderFrameGrid();
    renderJitterInfo();
    const semanticFrames = semanticFrameCount();
    const firstCol = Math.max(0, Math.min(totalGridFrameCols() - 1, cols[0] ?? 0));
    renderPreviewFrame(nextRow, Math.max(0, Math.min(semanticFrames - 1, firstCol % semanticFrames)));
    return true;
  }

  function writeSourceCellsToFrame(row, col, cells) {
    clearFrame(row, col);
    for (let y = 0; y < state.frameHChars; y++) {
      for (let x = 0; x < state.frameWChars; x++) {
        const gx = col * state.frameWChars + x;
        const gy = row * state.frameHChars + y;
        if (gx >= state.gridCols || gy >= state.gridRows) continue;
        setCell(gx, gy, cells[y][x]);
      }
    }
  }

  function groupSourceBoxesByRows(boxes) {
    const sorted = [...boxes].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const groups = [];
    for (const box of sorted) {
      if (!groups.length) {
        groups.push({ minY: box.y, maxY: boxBottom(box), boxes: [box] });
        continue;
      }
      const g = groups[groups.length - 1];
      const tol = Math.max(4, Math.round(Math.min(box.h, (g.maxY - g.minY + 1)) * 0.35));
      if (box.y <= (g.maxY + tol)) {
        g.boxes.push(box);
        g.minY = Math.min(g.minY, box.y);
        g.maxY = Math.max(g.maxY, boxBottom(box));
      } else {
        groups.push({ minY: box.y, maxY: boxBottom(box), boxes: [box] });
      }
    }
    for (const g of groups) {
      g.boxes.sort((a, b) => (a.x - b.x) || (a.y - b.y));
    }
    return groups;
  }

  function nextAppendColForRow(row) {
    const totalCols = totalGridFrameCols();
    if (state.selectedRow === row && state.selectedCols.size > 0) {
      const next = Math.max(...state.selectedCols) + 1;
      if (next < totalCols) return next;
    }
    for (let c = 0; c < totalCols; c++) {
      if (frameIsEmpty(row, c)) return c;
    }
    return -1;
  }

  function insertSourceBoxesIntoGridAt(boxes, targetRow, startCol) {
    if (!editableLayerActive()) {
      status("Visual layer (2) must be active to insert source sprites into grid", "warn");
      return false;
    }
    if (!state.sourceImage) {
      status("Source image is not loaded in the workbench", "err");
      return false;
    }
    const totalCols = totalGridFrameCols();
    if (targetRow < 0 || targetRow >= state.angles || startCol < 0 || startCol >= totalCols) {
      status("Drop target is outside grid bounds", "warn");
      return false;
    }
    const rowGroups = groupSourceBoxesByRows(boxes);
    if (!rowGroups.length) {
      status("No source sprite boxes selected for drop", "warn");
      return false;
    }

    let inserted = 0;
    let rowsInserted = 0;
    let firstRow = null;
    let firstRowCols = [];
    const changed = commitWholeSheetDocumentMutation("drop-source-selection-to-grid", function() {
      for (let rOff = 0; rOff < rowGroups.length; rOff++) {
        const row = targetRow + rOff;
        if (row < 0 || row >= state.angles) break;
        const group = rowGroups[rOff];
        const usable = group.boxes.filter((_b, i) => (startCol + i) < totalCols);
        if (!usable.length) continue;
        rowsInserted += 1;
        const colsUsed = [];
        for (let i = 0; i < usable.length; i++) {
          const col = startCol + i;
          const cells = frameCellsFromSourceBox(usable[i]);
          if (!cells) continue;
          writeSourceCellsToFrame(row, col, cells);
          inserted += 1;
          colsUsed.push(col);
        }
        if (firstRow === null && colsUsed.length) {
          firstRow = row;
          firstRowCols = colsUsed;
        }
      }
      if (firstRow !== null && firstRowCols.length) {
        setGridSelection(firstRowCols.map((col) => ({ row: firstRow, col })), {
          anchor: { row: firstRow, col: firstRowCols[0] },
          focus: { row: firstRow, col: firstRowCols[0] },
        });
      }
    });
    if (!changed) {
      status("Drop selected source sprites made no changes", "warn");
      return false;
    }
    status(`Dropped ${inserted} source sprite box(es) into ${rowsInserted} grid row(s)`, inserted > 0 ? "ok" : "warn");
    return inserted > 0;
  }

  function gridFrameFromClientPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!(el instanceof Element)) return null;
    const frame = el.closest(".frame-cell");
    if (!frame) return null;
    const row = Number(frame.dataset.row);
    const col = Number(frame.dataset.col);
    if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
    return { row, col };
  }

  function dropSelectedSourceBoxesAtClientPoint(clientX, clientY) {
    const ids = new Set([...state.sourceSelection].map((x) => Number(x)));
    const boxes = state.extractedBoxes.filter((b) => ids.has(Number(b.id)));
    if (!boxes.length) return false;
    const tgt = gridFrameFromClientPoint(clientX, clientY);
    if (!tgt) {
      status("Drop selected source sprites onto a grid frame cell", "warn");
      return false;
    }
    return insertSourceBoxesIntoGridAt(boxes, tgt.row, tgt.col);
  }

  function addSourceBoxToSelectedRowSequence(box) {
    if (!editableLayerActive()) {
      status("Visual layer (2) must be active to insert source sprite into grid", "warn");
      return false;
    }
    if (state.selectedRow === null) {
      status("Select a target grid row first, then use Add to selected row sequence", "warn");
      return false;
    }
    if (!state.sourceImage) {
      status("Source image is not loaded in the workbench", "err");
      return false;
    }
    const col = nextAppendColForRow(state.selectedRow);
    if (col < 0) {
      status("No free frame slot found on selected row", "warn");
      return false;
    }
    const cells = frameCellsFromSourceBox(box);
    if (!cells) {
      status("Failed to rasterize source box", "err");
      return false;
    }
    const changed = commitWholeSheetDocumentMutation("source-box-to-row-seq", function() {
      writeSourceCellsToFrame(state.selectedRow, col, cells);
      setGridSelection([{ row: state.selectedRow, col }], { anchor: { row: state.selectedRow, col }, focus: { row: state.selectedRow, col } });
    });
    if (!changed) {
      status("Insert source sprite made no changes", "warn");
      return false;
    }
    status(`Inserted source sprite into row ${state.selectedRow}, col ${col}`, "ok");
    return true;
  }

  function deleteSelectedSourceObjectsOrDraft() {
    if (state.sourceSelection.size > 0 || state.sourceSelectedCut) {
      pushHistory();
      if (state.sourceSelection.size > 0) {
        const ids = new Set([...state.sourceSelection].map((x) => Number(x)));
        state.extractedBoxes = state.extractedBoxes.filter((b) => !ids.has(Number(b.id)));
        clearSourceSelection();
        renderSourceCanvas();
        saveSessionState("delete-source-selection");
        status("Deleted selected source sprite box(es)", "ok");
        return true;
      }
      if (state.sourceSelectedCut?.type === "v") {
        const id = Number(state.sourceSelectedCut.id);
        state.sourceCutsV = state.sourceCutsV.filter((c) => Number(c.id) !== id);
        state.sourceSelectedCut = null;
        renderSourceCanvas();
        saveSessionState("delete-source-cut");
        status("Deleted vertical cut", "ok");
        return true;
      }
    }
    // Draft-only without explicit selection: let caller handle via clear-all
    // so a lingering draft does not block clearing committed boxes.
    if (state.drawCurrent && !state.extractedBoxes.length && !state.sourceCutsV.length) {
      pushHistory();
      state.drawCurrent = null;
      renderSourceCanvas();
      saveSessionState("delete-source-draft");
      status("Deleted draft box", "ok");
      return true;
    }
    return false;
  }

  function nudgeSelectedSourceBox(dx, dy) {
    if (state.sourceSelection.size !== 1) return false;
    const box = sourceSelectionPrimaryBox();
    if (!box) return false;
    const next = clampBoxToCanvas({ x: box.x + dx, y: box.y + dy, w: box.w, h: box.h });
    if (committedBoxesOverlap(next, box.id)) {
      status("Nudge blocked: overlap with another sprite box", "warn");
      return true;
    }
    pushHistory();
    state.extractedBoxes = state.extractedBoxes.map((b) => (Number(b.id) === Number(box.id) ? { ...b, ...next } : b));
    renderSourceCanvas();
    saveSessionState("nudge-source-box");
    return true;
  }

  function nudgeDraftBox(dx, dy) {
    if (!state.drawCurrent) return false;
    pushHistory();
    setDraftBox({ x: state.drawCurrent.x + dx, y: state.drawCurrent.y + dy, w: state.drawCurrent.w, h: state.drawCurrent.h });
    renderSourceCanvas();
    saveSessionState("nudge-draft-box");
    return true;
  }

  function clearFrame(row, col) {
    for (let y = 0; y < state.frameHChars; y++) {
      for (let x = 0; x < state.frameWChars; x++) {
        const gx = col * state.frameWChars + x;
        const gy = row * state.frameHChars + y;
        if (gx >= state.gridCols || gy >= state.gridRows) continue;
        setCell(gx, gy, { glyph: 0, fg: [0, 0, 0], bg: [...MAGENTA] });
      }
    }
  }

  function deleteSelectedFrames() {
    if (!editableLayerActive()) {
      status("Selected layer is read-only. Switch to Visual layer (2) to edit.", "warn");
      return;
    }
    const coords = selectedFrameCoordsSorted();
    if (!coords.length) return;
    const changed = commitWholeSheetDocumentMutation("delete", function() {
      for (const coord of coords) clearFrame(coord.row, coord.col);
    });
    if (!changed) return;
  }

  function swapRowBlocks(r1, r2) {
    for (let y = 0; y < state.frameHChars; y++) {
      const gy1 = r1 * state.frameHChars + y;
      const gy2 = r2 * state.frameHChars + y;
      for (let x = 0; x < state.gridCols; x++) {
        const a = cellAt(x, gy1);
        const b = cellAt(x, gy2);
        setCell(x, gy1, b);
        setCell(x, gy2, a);
      }
    }
    const c1 = state.rowCategories[r1];
    const c2 = state.rowCategories[r2];
    if (c1 !== undefined) state.rowCategories[r2] = c1;
    else delete state.rowCategories[r2];
    if (c2 !== undefined) state.rowCategories[r1] = c2;
    else delete state.rowCategories[r1];
    for (const g of state.frameGroups) {
      if (Number(g.row) === r1) g.row = r2;
      else if (Number(g.row) === r2) g.row = r1;
    }
  }

  function moveSelectedRow(delta) {
    if (!editableLayerActive()) {
      status("Selected layer is read-only. Switch to Visual layer (2) to edit.", "warn");
      return;
    }
    if (!hasSingleSelectedRow()) return;
    if (state.selectedRow === null) return;
    const target = state.selectedRow + delta;
    if (target < 0 || target >= state.angles) return;
    const changed = commitWholeSheetDocumentMutation("row-move", function() {
      swapRowBlocks(state.selectedRow, target);
      const cols = selectedFrameColsSorted();
      setGridSelection(cols.map((col) => ({ row: target, col })), {
        anchor: { row: target, col: cols[0] ?? 0 },
        focus: { row: target, col: cols[0] ?? 0 },
      });
    });
    if (!changed) return;
  }

  function swapColBlocks(c1, c2) {
    for (let y = 0; y < state.gridRows; y++) {
      for (let x = 0; x < state.frameWChars; x++) {
        const gx1 = c1 * state.frameWChars + x;
        const gx2 = c2 * state.frameWChars + x;
        if (gx1 >= state.gridCols || gx2 >= state.gridCols) continue;
        const a = cellAt(gx1, y);
        const b = cellAt(gx2, y);
        setCell(gx1, y, b);
        setCell(gx2, y, a);
      }
    }
    for (const g of state.frameGroups) {
      g.cols = (g.cols || []).map((c) => {
        if (c === c1) return c2;
        if (c === c2) return c1;
        return c;
      });
    }
  }

  function moveSelectedCols(delta) {
    if (!editableLayerActive()) {
      status("Selected layer is read-only. Switch to Visual layer (2) to edit.", "warn");
      return;
    }
    if (!hasSingleSelectedRow()) return;
    if (state.selectedCols.size === 0) return;
    const cols = [...state.selectedCols].sort((a, b) => a - b);
    const maxCol = Math.max(0, authoringFrameCols() - 1);
    if (delta < 0 && cols[0] <= 0) return;
    if (delta > 0 && cols[cols.length - 1] >= maxCol) return;
    const changed = commitWholeSheetDocumentMutation("col-move", function() {
      const work = delta < 0 ? cols : [...cols].reverse();
      for (const c of work) swapColBlocks(c, c + delta);
      const nextCols = cols.map((c) => c + delta);
      setGridSelection(nextCols.map((col) => ({ row: state.selectedRow, col })), {
        anchor: { row: state.selectedRow, col: nextCols[0] ?? 0 },
        focus: { row: state.selectedRow, col: nextCols[0] ?? 0 },
      });
    });
    if (!changed) return;
  }

  function assignRowCategory() {
    if (!editableLayerActive()) {
      status("Selected layer is read-only. Switch to Visual layer (2) to edit.", "warn");
      return;
    }
    if (!hasSingleSelectedRow()) return;
    if (state.selectedRow === null) return;
    pushHistory();
    state.rowCategories[state.selectedRow] = $("animCategorySelect").value;
    renderMeta();
    saveSessionState("assign-row-category");
  }

  function assignFrameGroup() {
    if (!editableLayerActive()) {
      status("Selected layer is read-only. Switch to Visual layer (2) to edit.", "warn");
      return;
    }
    if (!hasSingleSelectedRow()) return;
    if (state.selectedRow === null || state.selectedCols.size === 0) return;
    pushHistory();
    const name = ($("frameGroupName").value || "").trim() || `group_${state.frameGroups.length + 1}`;
    const cols = [...state.selectedCols].sort((a, b) => a - b);
    const existing = state.frameGroups.find((g) => g.name === name);
    if (existing) {
      existing.row = state.selectedRow;
      existing.cols = cols;
    } else {
      state.frameGroups.push({ name, row: state.selectedRow, cols });
    }
    renderAll();
    saveSessionState("assign-frame-group");
  }

  function applyGroupsToAnims() {
    if (!editableLayerActive()) {
      status("Selected layer is read-only. Switch to Visual layer (2) to edit.", "warn");
      return;
    }
    if (!hasSingleSelectedRow()) {
      status("Select frames on one row before applying groups", "warn");
      return;
    }
    const semanticFrames = Math.max(1, Math.floor((state.anims.reduce((a, b) => a + b, 0))));
    const row = state.selectedRow === null ? 0 : state.selectedRow;
    const groups = state.frameGroups
      .filter((g) => Number(g.row) === row)
      .map((g) => [...new Set((g.cols || []).filter((c) => c >= 0 && c < semanticFrames))].sort((a, b) => a - b))
      .filter((g) => g.length > 0);
    if (!groups.length) {
      status("No frame groups on selected row", "warn");
      return;
    }
    pushHistory();
    const used = new Set();
    const lengths = [];
    for (const g of groups) {
      for (const c of g) used.add(c);
      lengths.push(g.length);
    }
    const remainder = semanticFrames - used.size;
    if (remainder > 0) lengths.push(remainder);
    state.anims = lengths;
    recomputeFrameGeometry();
    renderAll();
    saveSessionState("apply-groups");
  }

  function selectFrame(row, col, shift) {
    const next = normalizeSelectionCoord({ row, col });
    if (!next) return;
    if (!shift || !hasGridSelection() || !state.selectionAnchor) {
      setGridSelection([next], { anchor: next, focus: next });
    } else {
      const anchor = normalizeSelectionCoord(state.selectionAnchor) || next;
      const coords = [];
      const rowLo = Math.min(anchor.row, next.row);
      const rowHi = Math.max(anchor.row, next.row);
      const colLo = Math.min(anchor.col, next.col);
      const colHi = Math.max(anchor.col, next.col);
      for (let r = rowLo; r <= rowHi; r++) {
        for (let c = colLo; c <= colHi; c++) {
          coords.push({ row: r, col: c });
        }
      }
      setGridSelection(coords, { anchor, focus: next });
    }
    renderFrameGrid();
    // U7: auto-scroll active frame into view in mobile filmstrip. Match the
    // CSS filmstrip condition — width alone misses iPad landscape (1194px,
    // coarse pointer), where the filmstrip is active but this never fired.
    if (window.matchMedia('(pointer: coarse)').matches ||
        window.matchMedia('(max-width: 1024px)').matches) {
      const activeCell = $("gridPanel")?.querySelector('.frame-cell[data-row="' + next.row + '"][data-col="' + next.col + '"]');
      if (activeCell) {
        try { activeCell.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' }); } catch (_e) {}
      }
    }
    renderJitterInfo();
    const semanticFrames = semanticFrameCount();
    renderPreviewFrame(next.row, Math.max(0, Math.min(semanticFrames - 1, next.col % semanticFrames)));
    panWholeSheetToFrame(next.row, next.col);
  }

  function openInspectorForSelectedFrame() {
    if (state.selectedRow === null || state.selectedCols.size <= 0) {
      status("Select a frame tile first, then focus the whole-sheet editor", "warn");
      return false;
    }
    const col = Math.min(...state.selectedCols);
    return focusWholeSheetFrame(Number(state.selectedRow), Number(col));
  }

  function selectedPrimaryFrameCoord() {
    const focus = normalizeSelectionCoord(state.selectionFocus);
    if (!focus || !selectionContainsFrame(focus.row, focus.col)) return null;
    return {
      row: Number(focus.row),
      col: Number(focus.col),
    };
  }

  // ── Whole-Sheet Editor Integration (B6) ──

  function hydrateWholeSheetEditor() {
    const wsEditor = window.__wholeSheetEditor;
    if (!wsEditor || typeof wsEditor.mount !== "function") return null;
    const panel = $("wholeSheetPanel");
    const mountEl = $("wholeSheetMount");
    const wsStatus = $("wholeSheetStatus");
    if (!panel || !mountEl) return null;

    if (!state.sessionId || !state.layers || state.layers.length === 0 || state.gridCols <= 0 || state.gridRows <= 0) {
      panel.classList.add("hidden");
      if (wsStatus) wsStatus.textContent = "not loaded";
      return null;
    }

    // Re-entrancy guard: mount() is async; without this, retry-loop callers
    // (e.g. tryFocus) stack concurrent mounts. Each pending mount eventually
    // resolves and clobbers editorState.activeTool back to 'cell', breaking
    // the Select tool and silently disabling copy/paste.
    if (state._wsHydrateInflight) return state._wsHydrateInflight;
    const sigNow = `${state.sessionId}|${state.gridCols}x${state.gridRows}`;
    if (state._wsHydratedSig === sigNow && wsEditor.getState && wsEditor.getState().mounted) {
      return Promise.resolve();
    }

    panel.classList.remove("hidden");
    if (wsStatus) wsStatus.textContent = "loading...";

    const tracked = wsEditor.mount({
      container: mountEl,
      gridCols: state.gridCols,
      gridRows: state.gridRows,
      frameW: state.frameWChars,
      frameH: state.frameHChars,
      layers: state.layers,
      layerNames: state.layerNames,
      activeLayer: state.activeLayer,
      visibleLayers: state.visibleLayers,
      lockedLayers: state.lockedLayers,
      currentSessionId: state.sessionId,
      sessionKind: state.sessionKind,
      metadataStatus: state.metadataStatus,
      gridCustomW: state.wholeSheetGridCustomW,
      gridCustomH: state.wholeSheetGridCustomH,
      gridTemplatePresets: getWholeSheetTemplateGridPresets(),
      canvasZoom: state.wholeSheetCanvasZoom,
      gridVisible: state.wholeSheetGridVisible,
      gridStep: state.wholeSheetGridStep,
      onCellEdited: function(x, y, glyph, fg, bg, layerIndex) {
        if (x < 0 || x >= state.gridCols || y < 0 || y >= state.gridRows) return;
        setCell(x, y, { glyph: glyph, fg: fg, bg: bg }, layerIndex);
        markFrameGridDirtyForCell(x, y);
      },
      onStrokeComplete: function() {
        markSessionDirty("whole-sheet-edit");
        // Targeted refresh: skip full legacy grid rebuild, source canvas,
        // inspector, metadata, and syncWholeSheetFromState (editor canvas
        // already correct).
        if (!state._suppressRender) {
          queueDirtyFrameGridRefresh({ updatePreview: true });
        }
        updateSessionDirtyBadge();
        updateUndoRedoButtons();
        queueWholeSheetAutosave("whole-sheet-draw");
      },
      onSave: function() { saveCurrentActionProgress({ reason: "whole-sheet-save", auto_advance: false }); },
      onExport: function() { exportXp(); },
      onDocumentStateChange: function(snapshot, reason) {
        if (!applyWholeSheetDocumentSnapshot(snapshot)) return;
        // A stroke-revert restores the pre-stroke document: net delta zero.
        // It must not mark dirty or persist — a successful save would clear
        // sessionDirty and silently commit unrelated pending work from a
        // gesture the user cancelled.
        if (String(reason) === "stroke-revert") return;
        markSessionDirty(`whole-sheet-${String(reason || "document")}`);
        saveSessionState(`whole-sheet-${String(reason || "document")}`);
      },
      onHistoryStateChange: function() { updateUndoRedoButtons(); },
      onBrowseList: browseListSessions,
      onBrowseOpen: browseOpenSession,
      onBrowseRename: browseRenameSession,
      onBrowseDuplicate: browseDuplicateSession,
      onBrowseDelete: browseDeleteSession,
      onBrowsePreview: previewSessionForBrowse,
      onBrowseNewRaw: newRawXp,
    }).then(() => {
      state._wsHydratedSig = sigNow;
      if (wsStatus) {
        const st = wsEditor.getState();
        wsStatus.textContent = st.hasFontLoaded
          ? `${st.gridCols}\u00d7${st.gridRows}, ${st.layerCount} layers`
          : `${st.gridCols}\u00d7${st.gridRows}, ${st.layerCount} layers (font fallback)`;
      }
      updateUndoRedoButtons();
      syncProductShellMode(productMode);
    }).catch((err) => {
      console.error("[whole-sheet] mount failed:", err);
      if (wsStatus) wsStatus.textContent = "mount failed";
    }).finally(() => {
      state._wsHydrateInflight = null;
    });
    state._wsHydrateInflight = tracked;
    return tracked;
  }

  function panWholeSheetToFrame(row, col) {
    const wsEditor = window.__wholeSheetEditor;
    if (!wsEditor || typeof wsEditor.panToFrame !== "function") return;
    if (!wsEditor.getState || !wsEditor.getState().mounted) return;
    wsEditor.panToFrame(row, col, state.frameWChars, state.frameHChars);
  }

  function getWholeSheetDocumentSnapshot() {
    const wsEditor = window.__wholeSheetEditor;
    if (!wsEditor || typeof wsEditor.getDocumentSnapshot !== "function") return null;
    if (!wsEditor.getState || !wsEditor.getState().mounted) return null;
    try {
      return wsEditor.getDocumentSnapshot();
    } catch (_err) {
      return null;
    }
  }

  function getMountedWholeSheetEditor() {
    const wsEditor = window.__wholeSheetEditor;
    if (!wsEditor || !wsEditor.getState || !wsEditor.getState().mounted) return null;
    return wsEditor;
  }

  function buildWholeSheetDocumentSnapshotFromState() {
    return {
      gridCols: Math.max(1, Number(state.gridCols || 1)),
      gridRows: Math.max(1, Number(state.gridRows || 1)),
      frameW: Math.max(1, Number(state.frameWChars || state.cellWChars || 1)),
      frameH: Math.max(1, Number(state.frameHChars || state.cellHChars || 1)),
      layers: (state.layers || []).map((layer) => deepCloneCells(layer)),
      layerNames: Array.isArray(state.layerNames) ? [...state.layerNames] : [],
      activeLayer: Math.max(0, Number(state.activeLayer || 0)),
      visibleLayers: [...(state.visibleLayers instanceof Set ? state.visibleLayers : [])],
      lockedLayers: [...(state.lockedLayers instanceof Set ? state.lockedLayers : [])],
      canvasZoom: Number.isFinite(Number(state.wholeSheetCanvasZoom)) ? Number(state.wholeSheetCanvasZoom) : 0,
      gridVisible: !!state.wholeSheetGridVisible,
      gridStep: String(state.wholeSheetGridStep || "frame"),
      gridCustomW: Math.max(1, Number(state.wholeSheetGridCustomW || 1)),
      gridCustomH: Math.max(1, Number(state.wholeSheetGridCustomH || 1)),
    };
  }

  function wholeSheetDocumentSnapshotKey(snapshot) {
    return JSON.stringify(snapshot || {});
  }

  function replaceWholeSheetDocumentSnapshot(snapshot, reason) {
    const nextSnapshot = snapshot || buildWholeSheetDocumentSnapshotFromState();
    const wsEditor = getMountedWholeSheetEditor();
    if (wsEditor && typeof wsEditor.replaceDocumentSnapshot === "function") {
      return !!wsEditor.replaceDocumentSnapshot(nextSnapshot, reason);
    }
    if (!applyWholeSheetDocumentSnapshot(nextSnapshot)) return false;
    markSessionDirty(`whole-sheet-${String(reason || "document")}`);
    renderInspector();
    saveSessionState(`whole-sheet-${String(reason || "document")}`);
    return true;
  }

  function commitWholeSheetDocumentMutation(reason, mutate) {
    const beforeSnapshot = getWholeSheetDocumentSnapshot() || buildWholeSheetDocumentSnapshotFromState();
    const beforeKey = wholeSheetDocumentSnapshotKey(beforeSnapshot);
    if (typeof mutate === "function") mutate();
    const afterSnapshot = buildWholeSheetDocumentSnapshotFromState();
    if (wholeSheetDocumentSnapshotKey(afterSnapshot) === beforeKey) return false;
    return replaceWholeSheetDocumentSnapshot(afterSnapshot, reason);
  }

  function applyWholeSheetDocumentSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.layers) || !snapshot.layers.length) return false;
    state.layers = snapshot.layers.map((layer) => deepCloneCells(layer));
    state.layerNames = Array.isArray(snapshot.layerNames) && snapshot.layerNames.length
      ? [...snapshot.layerNames]
      : state.layers.map((_, i) => DEFAULT_LAYER_NAMES[i] || `Layer ${i}`);
    state.activeLayer = Math.max(0, Math.min(state.layers.length - 1, Number(snapshot.activeLayer || 0)));
    state.visibleLayers = new Set((snapshot.visibleLayers || []).map((value) => Number(value)).filter((value) => Number.isFinite(value)));
    state.lockedLayers = new Set((snapshot.lockedLayers || []).map((value) => Number(value)).filter((value) => Number.isFinite(value)));
    state.gridCols = Math.max(1, Number(snapshot.gridCols || state.gridCols || 1));
    state.gridRows = Math.max(1, Number(snapshot.gridRows || state.gridRows || 1));
    if (Number(snapshot.frameW) > 0) state.cellWChars = Number(snapshot.frameW);
    if (Number(snapshot.frameH) > 0) state.cellHChars = Number(snapshot.frameH);
    state.wholeSheetCanvasZoom = Number.isFinite(Number(snapshot.canvasZoom)) ? Number(snapshot.canvasZoom) : state.wholeSheetCanvasZoom;
    state.wholeSheetGridVisible = !!snapshot.gridVisible;
    state.wholeSheetGridStep = String(snapshot.gridStep || state.wholeSheetGridStep || "frame");
    state.wholeSheetGridCustomW = Math.max(1, Number(snapshot.gridCustomW || state.wholeSheetGridCustomW || 1));
    state.wholeSheetGridCustomH = Math.max(1, Number(snapshot.gridCustomH || state.wholeSheetGridCustomH || 1));
    state.cells = state.layers[2] ? deepCloneCells(state.layers[2]) : buildBlankLayerCells();
    recomputeFrameGeometry();
    renderLayerControls();
    renderFrameGrid();
    renderLegacyGrid();
    renderMeta();
    renderJitterInfo();
    renderSession();
    const row = state.selectedRow === null ? 0 : state.selectedRow;
    renderPreviewFrame(Math.max(0, Math.min(state.angles - 1, row)), 0);
    renderInspector();
    updateClassicGeometryControls();
    updateSessionDirtyBadge();
    return true;
  }

  function syncWholeSheetFromState() {
    const wsEditor = window.__wholeSheetEditor;
    if (!wsEditor || typeof wsEditor.syncFromState !== "function") return;
    if (!wsEditor.getState || !wsEditor.getState().mounted) return;
    wsEditor.syncFromState(state.layers);
  }

  function gridFrameSignature(row, col) {
    const vals = [];
    for (let y = 0; y < state.frameHChars; y++) {
      for (let x = 0; x < state.frameWChars; x++) {
        const gx = col * state.frameWChars + x;
        const gy = row * state.frameHChars + y;
        if (gx >= state.gridCols || gy >= state.gridRows) continue;
        const c = cellForRender(gx, gy);
        vals.push(`${c.glyph}:${c.fg[0]}:${c.fg[1]}:${c.fg[2]}:${c.bg[0]}:${c.bg[1]}:${c.bg[2]}`);
      }
    }
    return vals.join("|");
  }

  function copySelectedFrameToClipboard() {
    const coord = selectedPrimaryFrameCoord();
    if (!coord) {
      status("Select a frame tile first", "warn");
      return false;
    }
    state.inspectorFrameClipboard = inspectorFrameCellMatrix(coord.row, coord.col);
    updateInspectorToolUI();
    status(`Copied frame row=${coord.row} col=${coord.col}`, "ok");
    return true;
  }

  function pasteClipboardToSelectedFrame() {
    const coord = selectedPrimaryFrameCoord();
    if (!coord) {
      status("Select a frame tile first", "warn");
      return false;
    }
    if (!state.inspectorFrameClipboard) {
      status("No copied frame in clipboard", "warn");
      return false;
    }
    if (!editableLayerActive()) {
      status("Selected layer is read-only. Switch to Visual layer (2) to edit.", "warn");
      return false;
    }
    const beforeSig = gridFrameSignature(coord.row, coord.col);
    const changed = commitWholeSheetDocumentMutation("grid-paste-frame", function() {
      writeFrameCellMatrix(coord.row, coord.col, state.inspectorFrameClipboard);
    });
    const afterSig = gridFrameSignature(coord.row, coord.col);
    if (!changed || String(beforeSig) === String(afterSig)) {
      status("Paste frame made no changes", "warn");
      return false;
    }
    status(`Pasted frame into row=${coord.row} col=${coord.col}`, "ok");
    return true;
  }

  function openInspectorFromGridContextMenu() {
    const coord = selectedPrimaryFrameCoord();
    if (!coord) {
      status("Select a frame tile first", "warn");
      return false;
    }
    return focusWholeSheetFrame(coord.row, coord.col);
  }

  function updateGridContextMenuUI() {
    const hasSel = !!selectedPrimaryFrameCoord();
    if ($("ctxCopy")) $("ctxCopy").disabled = !hasSel;
    if ($("ctxPaste")) $("ctxPaste").disabled = !hasSel || !state.inspectorFrameClipboard || !editableLayerActive();
    if ($("ctxOpenInspector")) $("ctxOpenInspector").disabled = !hasSel;
    if ($("ctxDelete")) $("ctxDelete").disabled = !hasSel || !editableLayerActive();
  }

  function frameCellMatricesEqual(a, b) {
    const rows = Math.max(Array.isArray(a) ? a.length : 0, Array.isArray(b) ? b.length : 0);
    for (let y = 0; y < rows; y++) {
      const ar = Array.isArray(a?.[y]) ? a[y] : [];
      const br = Array.isArray(b?.[y]) ? b[y] : [];
      const cols = Math.max(ar.length, br.length);
      for (let x = 0; x < cols; x++) {
        if (!cellEquals(ar[x], br[x])) return false;
      }
    }
    return true;
  }

  function applyGridCellDropAction(fromRow, fromCol, toRow, toCol, mode) {
    if (!editableLayerActive()) {
      status("Selected layer is read-only. Switch to Visual layer (2) to edit.", "warn");
      return false;
    }
    const fr = Math.max(0, Math.min(state.angles - 1, Number(fromRow)));
    const tr = Math.max(0, Math.min(state.angles - 1, Number(toRow)));
    const maxCol = Math.max(0, totalGridFrameCols() - 1);
    const fc = Math.max(0, Math.min(maxCol, Number(fromCol)));
    const tc = Math.max(0, Math.min(maxCol, Number(toCol)));
    if (!Number.isFinite(fr) || !Number.isFinite(fc) || !Number.isFinite(tr) || !Number.isFinite(tc)) return false;
    if (fr === tr && fc === tc) return false;
    const src = inspectorFrameCellMatrix(fr, fc);
    const dst = inspectorFrameCellMatrix(tr, tc);
    const changed = commitWholeSheetDocumentMutation(
      String(mode) === "swap" ? "grid-cell-swap" : "grid-cell-replace",
      function() {
        if (String(mode) === "swap") {
          writeFrameCellMatrix(tr, tc, src);
          writeFrameCellMatrix(fr, fc, dst);
        } else {
          writeFrameCellMatrix(tr, tc, src);
        }
      }
    );
    const srcAfter = inspectorFrameCellMatrix(fr, fc);
    const dstAfter = inspectorFrameCellMatrix(tr, tc);
    const changedCells = !frameCellMatricesEqual(src, dstAfter) || (String(mode) === "swap" && !frameCellMatricesEqual(dst, srcAfter));
    if (!changed || !changedCells) {
      status(`Grid ${mode} made no changes`, "warn");
      return false;
    }
    setGridSelection([{ row: tr, col: tc }], { anchor: { row: tr, col: tc }, focus: { row: tr, col: tc } });
    status(String(mode) === "swap"
      ? `Swapped frame row=${fr} col=${fc} with row=${tr} col=${tc}`
      : `Replaced target row=${tr} col=${tc} with dragged frame row=${fr} col=${fc}`, "ok");
    return true;
  }

  function attachGridHandlers() {
    const panel = $("gridPanel");
    const _useGridPointerEvents = typeof PointerEvent !== 'undefined';
    const _gridDownEvt = _useGridPointerEvents ? "pointerdown" : "mousedown";
    const _gridMoveEvt = _useGridPointerEvents ? "pointermove" : "mousemove";
    const _gridUpEvt = _useGridPointerEvents ? "pointerup" : "mouseup";
    panel.addEventListener(_gridDownEvt, (e) => {
      if (e.button !== 0) return;
      const header = e.target.closest(".frame-row-header");
      if (header) return;
      const cell = e.target.closest(".frame-cell");
      if (!cell) return;
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const singleSelected = state.selectedFrames.size === 1 && selectionContainsFrame(row, col);
      if (!e.shiftKey && singleSelected) {
        state.gridCellDrag = {
          fromRow: row,
          fromCol: col,
          startX: Number(e.clientX || 0),
          startY: Number(e.clientY || 0),
          startedAt: Date.now(),
          dragging: false,
          hover: null,
        };
        state.gridFrameDragSelect = null;
        $("gridContextMenu").classList.add("hidden");
        return;
      }
      state.gridCellDrag = null;
      selectFrame(row, col, !!e.shiftKey);
      state.gridFrameDragSelect = { row, startCol: col, lastCol: col };
      $("gridContextMenu").classList.add("hidden");
    });
    panel.addEventListener(_gridMoveEvt, (e) => {
      const cellDrag = state.gridCellDrag;
      if (cellDrag) {
        const dx = Number(e.clientX || 0) - Number(cellDrag.startX || 0);
        const dy = Number(e.clientY || 0) - Number(cellDrag.startY || 0);
        const dist = Math.hypot(dx, dy);
        if (!cellDrag.dragging && dist >= 5) {
          const heldMs = Date.now() - Number(cellDrag.startedAt || 0);
          if (heldMs < 180) {
            // Preserve quick row drag-select behavior; hold briefly to initiate cell replace/swap drag.
            state.gridCellDrag = null;
            state.gridFrameDragSelect = { row: Number(cellDrag.fromRow), startCol: Number(cellDrag.fromCol), lastCol: Number(cellDrag.fromCol) };
          } else {
            cellDrag.dragging = true;
            state.gridCellDragSuppressClick = true;
          }
        }
        if (!state.gridCellDrag) {
          // fall through into row drag-select handling below on the same pointermove tick
        } else if (!cellDrag.dragging) {
          return;
        } else {
          const targetCell = e.target.closest(".frame-cell");
          let nextHover = null;
          if (targetCell) {
            const tr = Number(targetCell.dataset.row);
            const tc = Number(targetCell.dataset.col);
            if (Number.isFinite(tr) && Number.isFinite(tc) && !(tr === cellDrag.fromRow && tc === cellDrag.fromCol)) {
              const rect = targetCell.getBoundingClientRect();
              const midY = rect.top + (rect.height / 2);
              nextHover = { row: tr, col: tc, mode: (Number(e.clientY || 0) < midY) ? "replace" : "swap" };
            }
          }
          const prev = cellDrag.hover;
          const changed =
            (!prev && !!nextHover) ||
            (!!prev && !nextHover) ||
            (!!prev && !!nextHover && (prev.row !== nextHover.row || prev.col !== nextHover.col || prev.mode !== nextHover.mode));
          if (changed) {
            cellDrag.hover = nextHover;
            renderFrameGrid();
          }
          return;
        }
      }
      const drag = state.gridFrameDragSelect;
      if (!drag) return;
      const cell = e.target.closest(".frame-cell");
      if (!cell) return;
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      if (row !== Number(drag.row) || col === Number(drag.lastCol)) return;
      drag.lastCol = col;
      selectFrame(Number(drag.row), col, true);
    });
    const _gridWindowUp = () => {
      if (state.gridCellDrag) {
        const drag = state.gridCellDrag;
        const hadHover = !!drag.hover;
        const shouldApply = !!drag.dragging && !!drag.hover;
        const hover = drag.hover ? { ...drag.hover } : null;
        const src = { row: Number(drag.fromRow), col: Number(drag.fromCol) };
        state.gridCellDrag = null;
        if (hadHover) renderFrameGrid();
        if (shouldApply && hover) {
          applyGridCellDropAction(src.row, src.col, hover.row, hover.col, hover.mode);
        }
      }
      state.gridFrameDragSelect = null;
    };
    window.addEventListener(_gridUpEvt, _gridWindowUp);
    if (_useGridPointerEvents) {
      window.addEventListener("pointercancel", _gridWindowUp);
      if (panel.style) panel.style.touchAction = 'none';
    }
    panel.addEventListener("click", (e) => {
      if (state.gridCellDragSuppressClick) {
        state.gridCellDragSuppressClick = false;
        return;
      }
      const header = e.target.closest(".frame-row-header");
      if (header) {
        const row = Number(header.dataset.row);
        if (Number.isFinite(row)) selectWholeRow(row);
        $("gridContextMenu").classList.add("hidden");
        return;
      }
      const cell = e.target.closest(".frame-cell");
      if (!cell) return;
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      selectFrame(row, col, e.shiftKey);
      $("gridContextMenu").classList.add("hidden");
    });
    panel.addEventListener("dblclick", (e) => {
      const header = e.target.closest(".frame-row-header");
      if (header) {
        const row = Number(header.dataset.row);
        if (Number.isFinite(row)) {
          selectWholeRow(row);
          focusWholeSheetFrame(row, 0);
        }
        $("gridContextMenu").classList.add("hidden");
        return;
      }
      const cell = e.target.closest(".frame-cell");
      if (!cell) return;
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      selectFrame(row, col, false);
      focusWholeSheetFrame(row, col);
      $("gridContextMenu").classList.add("hidden");
    });
    panel.addEventListener("contextmenu", (e) => {
      if (state.gridCellDrag && state.gridCellDrag.dragging) {
        e.preventDefault();
        return;
      }
      const header = e.target.closest(".frame-row-header");
      if (header) {
        e.preventDefault();
        const row = Number(header.dataset.row);
        if (Number.isFinite(row)) selectWholeRow(row);
      }
      const cell = e.target.closest(".frame-cell");
      if (cell) {
        e.preventDefault();
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);
        selectFrame(row, col, false);
      }
      if (!header && !cell) return;
      const menu = $("gridContextMenu");
      updateGridContextMenuUI();
      menu.style.left = `${e.clientX}px`;
      menu.style.top = `${e.clientY}px`;
      menu.classList.remove("hidden");
    });
    panel.addEventListener("dragstart", (e) => {
      const header = e.target.closest(".frame-row-header");
      if (!header) return;
      const row = Number(header.dataset.row);
      if (!Number.isFinite(row)) return;
      state.gridRowDrag = { fromRow: row };
      try {
        e.dataTransfer.setData("text/plain", String(row));
        e.dataTransfer.effectAllowed = "move";
      } catch (_e) {}
    });
    panel.addEventListener("dragover", (e) => {
      const header = e.target.closest(".frame-row-header");
      if (!header) return;
      e.preventDefault();
      panel.querySelectorAll(".frame-row-header.drag-target").forEach((n) => n.classList.remove("drag-target"));
      header.classList.add("drag-target");
      try {
        e.dataTransfer.dropEffect = "move";
      } catch (_e) {}
    });
    panel.addEventListener("dragleave", (e) => {
      const header = e.target.closest(".frame-row-header");
      if (header) header.classList.remove("drag-target");
    });
    panel.addEventListener("drop", (e) => {
      const header = e.target.closest(".frame-row-header");
      if (!header) return;
      e.preventDefault();
      header.classList.remove("drag-target");
      const toRow = Number(header.dataset.row);
      let fromRow = Number(state.gridRowDrag?.fromRow);
      try {
        const dt = Number((e.dataTransfer && e.dataTransfer.getData("text/plain")) || "");
        if (Number.isFinite(dt)) fromRow = dt;
      } catch (_e) {}
      if (Number.isFinite(fromRow) && Number.isFinite(toRow)) moveRowToIndex(fromRow, toRow);
      state.gridRowDrag = null;
    });
    panel.addEventListener("dragend", () => {
      panel.querySelectorAll(".frame-row-header.drag-target").forEach((n) => n.classList.remove("drag-target"));
      state.gridRowDrag = null;
    });
    const legacy = $("grid");
    if (legacy) {
      legacy.addEventListener("dblclick", (e) => {
        const cell = e.target.closest(".cell");
        if (!cell || !state.sessionId) return;
        const gx = Number(cell.dataset.x || 0);
        const gy = Number(cell.dataset.y || 0);
        if (!Number.isFinite(gx) || !Number.isFinite(gy) || state.frameWChars <= 0 || state.frameHChars <= 0) return;
        const row = Math.max(0, Math.min(state.angles - 1, Math.floor(gy / Math.max(1, state.frameHChars))));
        const maxCol = Math.max(0, totalGridFrameCols() - 1);
        const col = Math.max(0, Math.min(maxCol, Math.floor(gx / Math.max(1, state.frameWChars))));
        selectFrame(row, col, false);
        focusWholeSheetFrame(row, col);
        $("gridContextMenu").classList.add("hidden");
      });
    }
    document.addEventListener("click", () => {
      $("gridContextMenu").classList.add("hidden");
      hideSourceContextMenu();
    });
  }

  // First-class PNG import entry point (Browse panel + mobile Import button).
  // Opens the file chooser directly; falls back to scrolling the
  // Upload + Convert panel into view when no file is chosen yet.
  function focusPngImport() {
    const panel = $("uploadConvertPanel");
    if (panel && typeof panel.scrollIntoView === "function") {
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    const fileInput = $("wbFile");
    if (fileInput && typeof fileInput.click === "function") {
      fileInput.click();
    } else {
      status("Use Upload PNG in the Upload + Convert panel", "warn");
    }
  }

  async function wbUpload() {
    const f = $("wbFile").files[0];
    if (!f) {
      $("wbRunOut").textContent = "Pick a .png first.";
      return;
    }
    const img = new Image();
    const objectUrl = URL.createObjectURL(f);
    img.onload = () => {
      state.sourceImage = img;
      renderSourceCanvas();
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      state.sourceImage = null;
      status("Image decode failed — file may be corrupted or unsupported", "err");
    };
    img.src = objectUrl;

    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch(bp("/api/upload"), { method: "POST", body: fd });
    const j = await r.json();
    $("wbRunOut").textContent = JSON.stringify(j, null, 2);
    if (!r.ok) {
      status("Upload failed", "err");
      return;
    }
    state.sourcePath = j.source_path;
    state.uploadAnalysis = null;
    if ($("wbAutoPlan")) {
      $("wbAutoPlan").textContent = "Derived automatically from the uploaded PNG at convert time.";
    }
    updateRunButtonState();
    status("Upload ready", "ok");
  }

  function describeUploadPlan(plan) {
    if (!plan) return "Derived automatically from the uploaded PNG at convert time.";
    const angles = Math.max(1, Number(plan.suggested_angles || 1));
    const frames = Array.isArray(plan.suggested_frames) && plan.suggested_frames.length
      ? plan.suggested_frames.map((x) => Number(x)).join(",")
      : "1";
    const sourceProjs = Math.max(1, Number(plan.suggested_source_projs || 1));
    const renderResolution = Math.max(1, Number(plan.suggested_render_resolution || 12));
    return `${angles} angle${angles === 1 ? "" : "s"} · frames ${frames} · source projs ${sourceProjs} · render ${renderResolution}`;
  }

  function setUploadPlanSummary(plan) {
    const el = $("wbAutoPlan");
    if (el) el.textContent = describeUploadPlan(plan);
  }

  async function ensureUploadAnalysis({ force = false } = {}) {
    if (!state.sourcePath) return null;
    if (state.uploadAnalysis && !force) return state.uploadAnalysis;
    const r = await fetch(bp("/api/analyze"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_path: state.sourcePath }),
    });
    const j = await r.json();
    if (!r.ok) {
      throw new Error(j.error || "analyze failed");
    }
    state.uploadAnalysis = j;
    setUploadPlanSummary(j);
    return j;
  }

  function formatAnimsCsv(anims) {
    return (Array.isArray(anims) && anims.length ? anims : [1]).map((x) => Number(x)).join(",");
  }

  function deriveProjsForGeometry(angles, sourceProjs) {
    const safeAngles = Math.max(1, Number(angles || 1));
    const safeSourceProjs = Math.max(1, Number(sourceProjs || 1));
    if (safeAngles <= 1 && safeSourceProjs !== 1) {
      throw new Error("Source Projs must be 1 when Angles is 1.");
    }
    return safeAngles <= 1 ? 1 : (safeSourceProjs === 1 ? 2 : safeSourceProjs);
  }

  function readClassicGeometryInputs() {
    const angles = Math.max(1, parseInt(String($("classicGeomAngles")?.value || "1"), 10));
    const anims = String($("classicGeomFrames")?.value || "")
      .split(",")
      .map((x) => parseInt(x.trim(), 10))
      .filter((x) => Number.isFinite(x) && x > 0);
    if (!anims.length) throw new Error("Frames must be a comma-separated list of positive integers.");
    const sourceProjs = Math.max(1, parseInt(String($("classicGeomSourceProjs")?.value || "1"), 10));
    const cellW = Math.max(1, parseInt(String($("classicGeomCellW")?.value || "1"), 10));
    const cellH = Math.max(1, parseInt(String($("classicGeomCellH")?.value || "1"), 10));
    const projs = deriveProjsForGeometry(angles, sourceProjs);
    const semanticFrames = anims.reduce((sum, len) => sum + len, 0);
    return {
      angles,
      anims,
      source_projs: sourceProjs,
      projs,
      cell_w: cellW,
      cell_h: cellH,
      grid_cols: semanticFrames * projs * cellW,
      grid_rows: angles * cellH,
    };
  }

  function setClassicGeometryInputs(geometry) {
    if (!geometry) return;
    const angles = Math.max(1, Number(geometry.angles || 1));
    const sourceProjs = angles <= 1 ? 1 : Math.max(1, Number(geometry.source_projs || 1));
    if ($("classicGeomAngles")) $("classicGeomAngles").value = String(angles);
    if ($("classicGeomFrames")) $("classicGeomFrames").value = formatAnimsCsv(geometry.anims || [1]);
    if ($("classicGeomSourceProjs")) $("classicGeomSourceProjs").value = String(sourceProjs);
    if ($("classicGeomCellW")) $("classicGeomCellW").value = String(Math.max(1, Number(geometry.cell_w || 1)));
    if ($("classicGeomCellH")) $("classicGeomCellH").value = String(Math.max(1, Number(geometry.cell_h || 1)));
    updateClassicGeometryHint();
  }

  function updateClassicGeometryHint() {
    const hint = $("classicGeometryHint");
    if (!hint) return;
    try {
      const geometry = readClassicGeometryInputs();
      hint.textContent = `New XP will create ${geometry.grid_cols}x${geometry.grid_rows} (${geometry.angles} angle${geometry.angles === 1 ? "" : "s"} · frames ${formatAnimsCsv(geometry.anims)} · source projs ${geometry.source_projs} · cell ${geometry.cell_w}x${geometry.cell_h}).`;
    } catch (e) {
      hint.textContent = String(e);
    }
  }

  async function applyClassicGeometryAutoPlan() {
    if (!state.sourcePath) {
      status("Upload a PNG first to use Auto Plan as a suggestion", "warn");
      return;
    }
    try {
      const plan = await ensureUploadAnalysis({ force: true });
      setClassicGeometryInputs({
        angles: Number(plan?.suggested_angles || 1),
        anims: Array.isArray(plan?.suggested_frames) && plan.suggested_frames.length ? plan.suggested_frames : [1],
        source_projs: Number(plan?.suggested_source_projs || 1),
        cell_w: Number(plan?.suggested_cell_w || 1),
        cell_h: Number(plan?.suggested_cell_h || 1),
      });
      status("Auto Plan copied into classic geometry fields", "ok");
    } catch (e) {
      status(`Auto Plan failed: ${e}`, "err");
    }
  }

  function updateRunButtonState() {
    const btn = $("wbRun");
    if (!btn) return;
    if (isBundleMode()) {
      btn.disabled = !state.sourcePath;
      return;
    }
    btn.disabled = !(state.sourcePath && state.sessionId);
  }

  function updateClassicGeometryControls() {
    const wrap = $("classicGeometryWrap");
    const genericClassic = !isBundleMode() && !state.templateSetKey;
    if (wrap) wrap.classList.toggle("hidden", !genericClassic);
    if (genericClassic && state.sessionId) {
      setClassicGeometryInputs({
        angles: state.angles,
        anims: state.anims,
        source_projs: state.sourceProjs,
        cell_w: state.cellWChars,
        cell_h: state.cellHChars,
      });
    } else if (genericClassic) {
      updateClassicGeometryHint();
    }
    const newXpBtn = $("btnNewXp");
    if (newXpBtn && genericClassic) newXpBtn.disabled = false;
    updateRunButtonState();
  }

  // ── Bundle / Template helpers ──

  function isBundleMode() {
    return !!state.bundleId;
  }

  async function fetchTemplateRegistry() {
    if (state.templateRegistry) {
      renderRegistryActionNavigation();
      return state.templateRegistry;
    }
    try {
      const r = await fetch(bp("/api/workbench/templates"));
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const errBody = await r.json();
          if (errBody?.registry_status?.load_error) {
            msg = errBody.registry_status.load_error;
          } else if (errBody?.error) {
            msg = errBody.error;
          }
        } catch {}
        status(`Template registry fetch failed: ${msg}`, "err");
        return state.templateRegistry;
      }
      state.templateRegistry = await r.json();
      renderRegistryActionNavigation();
      // Surface degraded registry state from registry_status
      const rs = state.templateRegistry?.registry_status;
      if (rs) {
        if (rs.load_error) {
          status(`Template registry: ${rs.load_error}`, "warn");
        } else if (rs.l0_errors && Object.keys(rs.l0_errors).length > 0) {
          const prefixes = Object.keys(rs.l0_errors).join(", ");
          status(`Template registry: L0 reference issues for ${prefixes}`, "warn");
        }
      }
    } catch (e) {
      status(`Template registry fetch error: ${e.message || "network error"}`, "err");
    }
    return state.templateRegistry;
  }

  function getActiveTemplateSet() {
    if (!state.templateRegistry) return null;
    return state.templateRegistry.template_sets?.[state.templateSetKey] || null;
  }

  function getWholeSheetTemplateGridPresets() {
    const ts = getActiveTemplateSet();
    if (!ts || !ts.actions || typeof ts.actions !== "object") return [];
    return Object.entries(ts.actions).map(([actionKey, spec]) => {
      const width = Math.max(1, Number(spec?.cell_w || 1));
      const height = Math.max(1, Number(spec?.cell_h || 1));
      return {
        key: String(actionKey),
        label: String(spec?.label || actionKey),
        width,
        height,
      };
    });
  }

  // Canonical action order for bundle tabs and initial selection.
  // Pure logic lives in workbench-template-gating.js (loaded before this script).
  // Null-guard: if the gating script failed to load (e.g. cache staleness, 404),
  // provide safe no-op fallbacks so the IIFE doesn't crash.
  const _gating = window.__workbenchTemplateGating || null;
  const _actionNavigation = window.__workbenchActionNavigation || null;
  if (!_gating) {
    console.error('[workbench] workbench-template-gating.js not loaded — template gating features will be unavailable');
  }
  const BUNDLE_ACTION_ORDER = _gating ? _gating.BUNDLE_ACTION_ORDER : [];
  const _isTemplateActionAuthorable = _gating ? _gating.isTemplateActionAuthorable : () => false;
  const _getEnabledActions = _gating ? _gating.getEnabledActions : () => [];

  function isTemplateActionAuthorable(ts, actionKey, spec) {
    return _isTemplateActionAuthorable(ts, actionKey, spec, state.templateRegistry, state.templateSetKey);
  }

  function getEnabledActions(ts) {
    return _getEnabledActions(ts, state.templateRegistry, state.templateSetKey);
  }

  function populateTemplateSelectFromRegistry(model) {
    const select = $("templateSelect");
    if (!select || !model?.valid) return;
    const selected = select.value;
    select.replaceChildren();
    for (const templateSet of model.templateSets) {
      const option = document.createElement("option");
      option.value = templateSet.templateSetKey;
      option.textContent = templateSet.label;
      select.appendChild(option);
    }
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  }

  function renderRegistryActionNavigation() {
    const catalog = $("registryActionCatalog");
    if (!catalog) return;
    if (!_actionNavigation || !state.templateRegistry) {
      catalog.textContent = "Registry action navigation unavailable.";
      catalog.className = "registry-action-catalog small warn";
      return;
    }
    const model = _actionNavigation.getRegistryActionNavigation(state.templateRegistry);
    if (!model.valid) {
      catalog.textContent = `Registry unavailable: ${model.errors.join("; ")}`;
      catalog.className = "registry-action-catalog small err";
      return;
    }
    populateTemplateSelectFromRegistry(model);
    catalog.className = "registry-action-catalog";
    catalog.replaceChildren();

    const authorableSets = model.templateSets.filter((entry) => entry.actions.some((action) => action.authorable));
    const label = document.createElement("label");
    label.className = "registry-action-picker-label";
    label.setAttribute("for", "registryActionSelect");
    label.textContent = "Skin / action";
    const actionSelect = document.createElement("select");
    actionSelect.id = "registryActionSelect";
    actionSelect.className = "registry-action-picker";
    for (const templateSet of authorableSets) {
      const group = document.createElement("optgroup");
      group.label = templateSet.label;
      for (const action of templateSet.actions.filter((entry) => entry.authorable)) {
        const option = document.createElement("option");
        option.value = `${action.templateSetKey}:${action.actionKey}`;
        option.textContent = action.label;
        option.dataset.templateSetKey = action.templateSetKey;
        option.dataset.actionKey = action.actionKey;
        option.selected = state.templateSetKey === action.templateSetKey && state.activeActionKey === action.actionKey;
        group.appendChild(option);
      }
      actionSelect.appendChild(group);
    }
    actionSelect.addEventListener("change", () => {
      const option = actionSelect.selectedOptions[0];
      const templateSetKey = option?.dataset.templateSetKey;
      const actionKey = option?.dataset.actionKey;
      const templateSet = authorableSets.find((entry) => entry.templateSetKey === templateSetKey);
      const action = templateSet?.actions.find((entry) => entry.actionKey === actionKey);
      if (!templateSet || !action) return;
      if (state.bundleId && state.templateSetKey === templateSetKey && state.actionStates[actionKey]) {
        void switchBundleAction(actionKey);
        return;
      }
      const templateSelect = $("templateSelect");
      if (templateSelect) templateSelect.value = templateSetKey;
      status(`${templateSet.label} / ${action.label} selected — Apply Template to start authoring`, "ok");
    });
    catalog.appendChild(label);
    catalog.appendChild(actionSelect);

    const unavailable = [];
    for (const family of model.families) {
      for (const prefix of family.prefixes) {
        if (prefix.proofOnly) unavailable.push(`${prefix.label}: proof-only`);
        else if (prefix.deferred) unavailable.push(`${prefix.label}: deferred`);
      }
    }
    if (unavailable.length) {
      const note = document.createElement("div");
      note.className = "registry-action-classifications small";
      note.textContent = unavailable.join(" · ");
      catalog.appendChild(note);
    }
  }

  function isBundleActionReadyStatus(statusValue) {
    const s = String(statusValue || "");
    return s === "saved" || s === "converted";
  }

  function getBundleActionStatusSymbol(statusValue) {
    const s = String(statusValue || "");
    if (s === "converted") return "✓";
    if (s === "saved") return "◐";
    return "○";
  }

  function getNextIncompleteBundleActionKey() {
    const ts = getActiveTemplateSet();
    const enabled = ts ? getEnabledActions(ts) : {};
    return Object.keys(enabled).find(
      (k) => k !== state.activeActionKey && state.actionStates[k] && !isBundleActionReadyStatus(state.actionStates[k].status)
    ) || null;
  }

  function areAllEnabledBundleActionsReady() {
    const ts = getActiveTemplateSet();
    const enabled = ts ? getEnabledActions(ts) : {};
    return Object.keys(enabled).every(
      (k) => state.actionStates[k] && isBundleActionReadyStatus(state.actionStates[k].status)
    );
  }

  function highlightBundleTestButton() {
    const quickBtn = $("webbuildQuickTestBtn");
    if (!quickBtn) return;
    quickBtn.classList.add("primary");
    quickBtn.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function visualLayerHasMeaningfulContent() {
    const cells = (state.layers && state.layers[2]) ? state.layers[2] : state.cells;
    if (!Array.isArray(cells)) return false;
    return cells.some((cell) => {
      const glyph = Number(cell?.glyph ?? 0);
      return glyph !== 0 && glyph !== 32;
    });
  }

  async function persistBundleActionStatus(actionKey, statusValue) {
    if (!isBundleMode() || !state.bundleId) return { ok: false, skipped: "not_bundle_mode" };
    // Include the live session_id so the backend rebinds bundle.actions[key].session_id
    // when an XP upload (or any session swap) changed which session this action owns.
    // Without this, the bundle JSON keeps pointing at the original blank session and the
    // web-skin-bundle-payload step emits empty content instead of the imported XP.
    const liveSessionId = state.actionStates[actionKey]?.sessionId || state.sessionId || null;
    const r = await fetch(bp("/api/workbench/bundle/action-status"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle_id: state.bundleId,
        action_key: actionKey,
        status: statusValue,
        session_id: liveSessionId,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      status(`Bundle status update failed: ${j.error || "unknown"}`, "err");
      $("exportOut").textContent = JSON.stringify(j, null, 2);
      return { ok: false, response: j };
    }
    if (!state.actionStates[actionKey]) state.actionStates[actionKey] = {};
    state.actionStates[actionKey].status = j.status;
    if (j.session_id) state.actionStates[actionKey].sessionId = j.session_id;
    if (typeof j.job_id === "string") state.actionStates[actionKey].jobId = j.job_id;
    renderBundleActionTabs();
    updateBundleUI();
    updateWebbuildUI();
    return { ok: true, response: j };
  }

  async function flushPendingWholeSheetDrawSaveTimer() {
    clearQueuedWholeSheetAutosave();
  }

  async function saveCurrentActionProgress(opts = {}) {
    if (!state.sessionId) return { ok: false, skipped: "no_session" };
    const reason = String(opts.reason || "manual-save");
    const autoAdvance = !!opts.auto_advance;
    await flushPendingWholeSheetDrawSaveTimer();
    const saveRes = await saveSessionState(reason, { wait_for_idle: true, timeout_ms: 15000 });
    if (!saveRes || !saveRes.ok) {
      $("exportOut").textContent = JSON.stringify({ stage: "save_failed", save: saveRes }, null, 2);
      status("Save failed/timed out", "err");
      return saveRes || { ok: false };
    }
    if (!isBundleMode() || !state.activeActionKey || !state.actionStates[state.activeActionKey]) {
      status("Session saved", "ok");
      return { ok: true };
    }
    const actState = state.actionStates[state.activeActionKey];
    if (actState.status !== "converted") {
      if (!visualLayerHasMeaningfulContent()) {
        status("Session saved — add visual content before marking this action ready", "warn");
        return { ok: true, ready: false };
      }
      const persist = await persistBundleActionStatus(state.activeActionKey, "saved");
      if (!persist.ok) return { ok: false, bundle_status_failed: true };
    }
    if (areAllEnabledBundleActionsReady()) {
      status("All required actions saved — click Test Bundle Skin", "ok");
      highlightBundleTestButton();
      return { ok: true, ready: true };
    }
    const nextIncomplete = getNextIncompleteBundleActionKey();
    if (autoAdvance && nextIncomplete) {
      status(`${state.activeActionKey} saved — advancing to ${nextIncomplete}...`, "ok");
      setTimeout(() => switchBundleAction(nextIncomplete), 600);
      return { ok: true, ready: true, advanced_to: nextIncomplete };
    }
    status(`${state.activeActionKey} saved`, "ok");
    return { ok: true, ready: true };
  }

  function renderBundleActionTabs() {
    const container = $("bundleActionTabs");
    if (!container) return;
    const ts = getActiveTemplateSet();
    if (!ts || !isBundleMode()) {
      container.classList.add("hidden");
      return;
    }
    container.classList.remove("hidden");
    container.innerHTML = "";
    for (const [key, spec] of Object.entries(getEnabledActions(ts))) {
      const btn = document.createElement("button");
      const actState = state.actionStates[key];
      const isActive = key === state.activeActionKey;
      btn.textContent = `${spec.label} ${getBundleActionStatusSymbol(actState?.status)}`;
      btn.className = isActive ? "primary" : "";
      btn.style.cssText = "border-radius:0; margin:0; min-width:120px;";
      if (isActive) btn.style.borderBottom = "2px solid #6cf";
      btn.addEventListener("click", () => switchBundleAction(key));
      container.appendChild(btn);
    }
  }

  async function switchBundleAction(actionKey) {
    if (actionKey === state.activeActionKey) return;
    if (state.sessionDirty && state.sessionId) {
      const saveRes = await saveSessionState("switch-bundle-action", { wait_for_idle: true, timeout_ms: 15000 });
      if (!saveRes || !saveRes.ok) {
        $("exportOut").textContent = JSON.stringify({ stage: "save_before_switch_failed", save: saveRes }, null, 2);
        status("Switch blocked: session save failed/timed out", "err");
        return;
      }
    }
    state.activeActionKey = actionKey;
    // Clear source panel state so previous action's upload doesn't bleed through
    state.sourcePath = "";
    state.uploadAnalysis = null;
    setUploadPlanSummary(null);
    const wbRunOutEl = $("wbRunOut"); if (wbRunOutEl) wbRunOutEl.textContent = "";
    const wbFileEl = $("wbFile"); if (wbFileEl) wbFileEl.value = "";
    const actState = state.actionStates[actionKey];
    if (actState && actState.sessionId) {
      await loadSession(actState.sessionId, {
        reason: `Loading ${actionKey} authoring session...`,
        preserveBundleContext: true,
      });
    } else {
      // Empty action — clear session
      state.sessionId = null;
      state.jobId = "";
      state.layers = [];
      state.cells = [];
      state.gridCols = 0;
      state.gridRows = 0;
      $("btnSave").disabled = true;
      $("btnExport").disabled = true;
      renderLegacyGrid();
      renderFrameGrid();
      status(`Action "${actionKey}" — upload a source image`, "warn");
    }
    renderBundleActionTabs();
    updateBundleUI();
  }

  async function createBlankTemplateSession(templateSetKey, actionKey) {
    const r = await fetch(bp("/api/workbench/create-blank-session"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template_set_key: templateSetKey,
        action_key: actionKey,
      }),
    });
    const j = await r.json();
    $("sessionOut").textContent = JSON.stringify({
      ...j,
      cells: undefined,
      cell_count: Array.isArray(j.cells) ? j.cells.length : 0,
    }, null, 2);
    if (!r.ok) {
      throw new Error(j.error || "blank session creation failed");
    }
    return j;
  }

  async function createBlankRootSession(blankSession) {
    const r = await fetch(bp("/api/workbench/create-blank-session"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blank_session: blankSession || {} }),
    });
    const j = await r.json();
    $("sessionOut").textContent = JSON.stringify({
      ...j,
      cells: undefined,
      cell_count: Array.isArray(j.cells) ? j.cells.length : 0,
    }, null, 2);
    if (!r.ok) {
      throw new Error(j.error || "blank root session creation failed");
    }
    return j;
  }

  function updateBundleUI() {
    const bundleStatus = $("bundleStatus");
    const templateStatus = $("templateStatus");
    const templateGuide = $("templateGuide");
    const uploadLabel = $("uploadPanelLabel");
    const quickBtn = $("webbuildQuickTestBtn");
    if (isBundleMode()) {
      if (bundleStatus) {
        const ts = getActiveTemplateSet();
        const enabled = ts ? getEnabledActions(ts) : {};
        const enabledKeys = new Set(Object.keys(enabled));
        const total = enabledKeys.size;
        const done = Object.entries(state.actionStates).filter(([k, a]) => enabledKeys.has(k) && isBundleActionReadyStatus(a.status)).length;
        bundleStatus.textContent = `Bundle: ${done}/${total} actions ready`;
        bundleStatus.classList.remove("hidden");
      }
      if (templateStatus) templateStatus.textContent = "Bundle mode";
      if (templateGuide) {
        const active = state.activeActionKey || "idle";
        templateGuide.innerHTML = `Bundle workflow: <strong>1.</strong> Apply the template once. <strong>2.</strong> Work action-by-action on <strong>${active}</strong>. <strong>3.</strong> Use <strong>Save</strong> to keep progress and mark the action ready without downloading, or <strong>Export XP</strong> if you also want the file. <strong>4.</strong> When every enabled action is ready, click <strong>Test Bundle Skin</strong>.`;
      }
      if (uploadLabel) uploadLabel.textContent = `Upload for ${state.activeActionKey}`;
      if (quickBtn) quickBtn.textContent = "Test Bundle Skin";
    } else {
      if (bundleStatus) bundleStatus.classList.add("hidden");
      if (templateStatus) templateStatus.textContent = "Classic (single XP)";
      if (templateGuide) {
        templateGuide.innerHTML = state.templateSetKey
          ? `Classic workflow: <strong>Apply Template</strong> creates the authoring geometry. <strong>Upload PNG</strong> is source input only, and <strong>Convert to XP</strong> populates the active session geometry. Use <strong>Focus Whole-Sheet</strong> or double-click a frame tile to edit on the primary editor surface.`
          : `Classic workflow: set root geometry in <strong>Session Ops</strong>, click <strong>New XP</strong>, then <strong>Upload PNG</strong> and <strong>Convert to XP</strong>. Auto Plan is advisory only; the active session owns geometry.`;
      }
      if (uploadLabel) uploadLabel.textContent = "REXPaint Web Clone";
      if (quickBtn) quickBtn.textContent = "Test This Skin";
    }
    updateClassicGeometryControls();
  }

  async function applyTemplate() {
    // PB-03 guard: session-boundary dirty check before destructive template apply.
    // loadSession() → hydrateLoadedSession() clears history (by design); warn user.
    const wsHistory = getWholeSheetHistoryState();
    const hasUndoHistory = state.history.length > 0 || wsHistory.historyDepth > 0 || wsHistory.futureDepth > 0;
    if (state.sessionId && (state.sessionDirty || hasUndoHistory)) {
      const proceed = confirm(
        "Applying a template replaces your current session.\n" +
        "Unsaved edits and undo history will be lost.\n\nContinue?"
      );
      if (!proceed) {
        status("Template apply cancelled", "ok");
        return false;
      }
      // Auto-save current work before replacing
      if (state.sessionDirty) {
        await saveSessionState("pre-template-apply", { wait_for_idle: true, timeout_ms: 15000 });
      }
    }
    const key = $("templateSelect")?.value || "player_native_idle_only";
    state.templateSetKey = key;
    const reg = await fetchTemplateRegistry();
    if (!reg) {
      status("Failed to load template registry", "err");
      return false;
    }
    const ts = reg.template_sets?.[key];
    if (!ts) {
      status(`Unknown template: ${key}`, "err");
      return false;
    }
    const enabledActions = getEnabledActions(ts);
    const actionKeys = Object.keys(enabledActions);
    if (actionKeys.length <= 1) {
      // Single-action template: create a real blank authoring session.
      state.bundleId = null;
      state.activeActionKey = actionKeys[0] || "idle";
      state.actionStates = {};
      status("Creating blank authoring session...", "warn");
      try {
        const j = await createBlankTemplateSession(key, state.activeActionKey);
        const loaded = await loadSession(j.session_id, { reason: `Loading ${ts.label} authoring session...` });
        if (!loaded) return false;
        renderBundleActionTabs();
        updateBundleUI();
        $("btnNewXp").disabled = false;
        status(`Authoring session ready: ${ts.label}`, "ok");
        return true;
      } catch (e) {
        status(`Blank session creation failed: ${e}`, "err");
        return false;
      }
    }
    // Multi-action: create bundle plus blank sessions for each enabled action.
    status("Creating blank authoring bundle...", "warn");
    try {
      const r = await fetch(bp("/api/workbench/bundle/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_set_key: key }),
      });
      const j = await r.json();
      if (!r.ok) {
        status(`Bundle creation failed: ${j.error || "unknown"}`, "err");
        return false;
      }
      state.bundleId = j.bundle_id;
      state.activeActionKey = actionKeys[0];
      state.actionStates = {};
      for (const ak of actionKeys) {
        const act = j.actions?.[ak] || {};
        state.actionStates[ak] = {
          sessionId: act.session_id || null,
          jobId: act.job_id || "",
          status: act.status || "empty",
        };
      }
      const firstAction = state.actionStates[state.activeActionKey];
      if (firstAction && firstAction.sessionId) {
        const loaded = await loadSession(firstAction.sessionId, {
          reason: `Loading ${state.activeActionKey} authoring session...`,
          preserveBundleContext: true,
        });
        if (!loaded) return false;
      }
      renderBundleActionTabs();
      updateBundleUI();
      $("btnNewXp").disabled = false;
      status(`Authoring bundle ready: ${ts.label}`, "ok");
      return true;
    } catch (e) {
      status(`Bundle creation error: ${e}`, "err");
      return false;
    }
  }

  async function wbRunBundleAction() {
    if (!isBundleMode() || !state.sourcePath) return;
    const actionKey = state.activeActionKey;
    status(`Running ${actionKey} conversion...`, "warn");
    try {
      const r = await fetch(bp("/api/workbench/action-grid/apply"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bundle_id: state.bundleId,
          action_key: actionKey,
          source_path: state.sourcePath,
        }),
      });
      const j = await r.json();
      $("wbRunOut").textContent = JSON.stringify(j, null, 2);
      if (!r.ok) {
        status(`${actionKey} conversion failed: ${j.error || "unknown"}`, "err");
        return;
      }
      state.actionStates[actionKey] = {
        sessionId: j.session_id,
        jobId: j.job_id,
        status: "converted",
      };
      state.sessionId = j.session_id;
      state.jobId = j.job_id;
      await loadFromJob({ preserveBundleContext: true });
      renderBundleActionTabs();
      updateBundleUI();
      status(`${actionKey} converted: ${j.grid_cols}x${j.grid_rows}`, "ok");
    } catch (e) {
      status(`${actionKey} conversion error: ${e}`, "err");
    }
  }

  async function createActorVisualProfile() {
    const domain = $("domainSelect")?.value || "skin";
    const presentationKind = $("presentationKindSelect")?.value || "idle_walk";
    const variation = $("variationSelect")?.value || "default";
    const statusEl = $("profileCreationStatus");
    
    if (!state.sessionId) {
      statusEl.textContent = "Error: Create or load a session first (domain/variation chooser requires an active XP session).";
      statusEl.classList.remove("hidden");
      status("Create session first", "err");
      return;
    }
    
    statusEl.textContent = `Creating ActorVisualProfile for domain=${domain}, presentation_kind=${presentationKind}, variation=${variation}...`;
    statusEl.classList.remove("hidden");
    status("Creating ActorVisualProfile...", "warn");
    
    try {
      const r = await fetch(bp("/api/workbench/actor-visual-profile/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: state.sessionId,
          domain: domain,
          presentation_kind: presentationKind,
          variation: variation,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        statusEl.textContent = `Error: ${j.error || "unknown"}`;
        status(`Profile creation failed: ${j.error || "unknown"}`, "err");
        return;
      }
      
      statusEl.innerHTML = `<span style="color:var(--success);">✓ ActorVisualProfile created: ${j.profile_path}</span>`;
      status(`ActorVisualProfile created: ${j.profile_id}`, "ok");
      
      // Auto-open the created profile in a new tab
      if (j.profile_path) {
        const viewUrl = `${BASE_PATH}/workbench?session_id=${state.sessionId}&view_profile=${encodeURIComponent(j.profile_path)}`;
        statusEl.innerHTML += ` <a href="${viewUrl}" target="_blank" style="margin-left:8px;">[View]</a>`;
      }
    } catch (e) {
      statusEl.textContent = `Error: ${e}`;
      status(`Profile creation error: ${e}`, "err");
    }
  }

  async function wbRun() {
    if (!state.sourcePath) return;
    // Bundle mode: route through action-grid/apply
    if (isBundleMode()) {
      await wbRunBundleAction();
      return;
    }
    if (!state.sessionId) {
      $("wbRunOut").textContent = JSON.stringify({
        error: "Create or load a session first. In classic mode, Session Ops owns geometry.",
        stage: "missing_session_geometry",
      }, null, 2);
      status("Convert blocked: no active session geometry", "err");
      return;
    }
    let analysis = null;
    let analysisError = null;
    try {
      analysis = await ensureUploadAnalysis();
    } catch (e) {
      analysisError = String(e);
    }
    status("Running conversion...", "warn");
    const payload = {
      source_path: state.sourcePath,
      name: $("wbName").value || "wb_sprite",
      angles: Math.max(1, Number(state.angles || 1)),
      frames: formatAnimsCsv(state.anims),
      source_projs: Math.max(1, Number(state.sourceProjs || 1)),
      render_resolution: Math.max(1, Number(state.cellWChars || state.cellHChars || 1)),
      target_cols: Math.max(1, Number(state.gridCols || 1)),
      target_rows: Math.max(1, Number(state.gridRows || 1)),
      native_compat: false,
      assignment_mode: state.assignmentMode || "geometric",
    };
    const r = await fetch(bp("/api/run"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    $("wbRunOut").textContent = JSON.stringify({
      geometry_source: "active_session",
      active_session: {
        session_id: state.sessionId,
        grid_cols: state.gridCols,
        grid_rows: state.gridRows,
        angles: state.angles,
        anims: state.anims,
        source_projs: state.sourceProjs,
        projs: state.projs,
        cell_w: state.cellWChars,
        cell_h: state.cellHChars,
      },
      auto_plan: analysis,
      auto_plan_error: analysisError,
      run: j,
    }, null, 2);
    if (!r.ok) {
      status("Run failed", "err");
      return;
    }
    state.jobId = j.job_id;
    const u = new URL(window.location.href);
    u.searchParams.set("job_id", state.jobId);
    history.replaceState({}, "", u.toString());
    status("Run complete", "ok");
    await loadFromJob();
  }

  // ── Tier A: Draft restore banner ──

  let _draftBannerDismissTimer = null;
  let _draftBannerCanvasListener = null;

  function _checkDraftRestore() {
    const p = window.__wbPersistence;
    if (!p || !p.isAvailable()) {
      // Check dirty flag even if IDB unavailable
      _checkOrphanDirtyFlag();
      return;
    }
    p.loadLatestDraft().then((draft) => {
      if (!draft || !draft.payload) {
        _checkOrphanDirtyFlag();
        return;
      }
      // Check if draft is newer than the last server session save
      const draftTs = draft.timestamp || 0;
      const serverTs = state.sessionLastSaveOkAt || 0;
      if (draftTs <= serverTs) {
        p.clearDirtyFlag();
        return;
      }
      _showDraftRestoreBanner(draft);
    }).catch(() => {
      _checkOrphanDirtyFlag();
    });
  }

  function _checkOrphanDirtyFlag() {
    const p = window.__wbPersistence;
    if (!p) return;
    const dirtyTs = p.getDirtyFlag();
    if (dirtyTs) {
      p.clearDirtyFlag();
      status("Last save may be incomplete (page exited before save finished)", "warn");
    }
  }

  function _showDraftRestoreBanner(draft) {
    const banner = $("draftRestoreBanner");
    const info = $("draftRestoreInfo");
    const restoreBtn = $("draftRestoreBtn");
    const dismissBtn = $("draftDismissBtn");
    if (!banner) return;

    // Format age
    const ageMs = Date.now() - (draft.timestamp || 0);
    const ageMins = Math.floor(ageMs / 60000);
    const ageText = ageMins < 1 ? "just now"
      : ageMins < 60 ? `${ageMins} minute${ageMins !== 1 ? "s" : ""} ago`
      : `${Math.floor(ageMins / 60)} hour${Math.floor(ageMins / 60) !== 1 ? "s" : ""} ago`;
    if (info) info.textContent = `A browser draft from ${ageText} is available.`;

    banner.classList.remove("hidden");

    if (restoreBtn) {
      restoreBtn.onclick = () => {
        _dismissDraftBanner();
        _restoreDraft(draft);
      };
    }
    if (dismissBtn) {
      dismissBtn.onclick = () => {
        _dismissDraftBanner();
        // Optionally delete the stale draft
        const p = window.__wbPersistence;
        if (p && draft.id != null) p.deleteDraft(draft.id).catch(() => {});
      };
    }

    // Auto-dismiss after 30 seconds
    _draftBannerDismissTimer = setTimeout(() => _dismissDraftBanner(), 30000);

    // Dismiss on first canvas interaction
    const wholeSheetPanel = $("wholeSheetPanel");
    if (wholeSheetPanel) {
      _draftBannerCanvasListener = () => _dismissDraftBanner();
      wholeSheetPanel.addEventListener("pointerdown", _draftBannerCanvasListener, { once: true });
    }
  }

  function _dismissDraftBanner() {
    const banner = $("draftRestoreBanner");
    if (banner) banner.classList.add("hidden");
    if (_draftBannerDismissTimer) {
      clearTimeout(_draftBannerDismissTimer);
      _draftBannerDismissTimer = null;
    }
    if (_draftBannerCanvasListener) {
      const wholeSheetPanel = $("wholeSheetPanel");
      if (wholeSheetPanel) wholeSheetPanel.removeEventListener("pointerdown", _draftBannerCanvasListener);
      _draftBannerCanvasListener = null;
    }
    const p = window.__wbPersistence;
    if (p) p.clearDirtyFlag();
  }

  function _restoreDraft(draft) {
    const payload = draft.payload;
    if (!payload) {
      status("Draft restore failed: empty payload", "warn");
      return false;
    }
    // Validate draft matches current session
    if (payload.sessionId && state.sessionId && payload.sessionId !== state.sessionId) {
      status("Draft is from a different session — skipping restore", "warn");
      return false;
    }
    if (payload.gridCols && payload.gridRows && state.gridCols && state.gridRows) {
      if (payload.gridCols !== state.gridCols || payload.gridRows !== state.gridRows) {
        status("Draft grid dimensions mismatch — skipping restore", "warn");
        return false;
      }
    }
    try {
      // Apply draft data into workbench state
      // Ensure sessionId is set so hydrateWholeSheetEditor proceeds
      if (!state.sessionId && payload.sessionId) state.sessionId = payload.sessionId;
      if (Array.isArray(payload.layers)) state.layers = payload.layers;
      if (Array.isArray(payload.layerNames)) state.layerNames = [...payload.layerNames];
      if (typeof payload.activeLayer === "number") state.activeLayer = payload.activeLayer;
      if (Array.isArray(payload.visibleLayers)) state.visibleLayers = new Set(payload.visibleLayers);
      if (Array.isArray(payload.lockedLayers)) state.lockedLayers = new Set(payload.lockedLayers);
      if (typeof payload.gridCols === "number") state.gridCols = payload.gridCols;
      if (typeof payload.gridRows === "number") state.gridRows = payload.gridRows;
      if (typeof payload.frameW === "number") { state.frameWChars = payload.frameW; state.cellWChars = payload.frameW; }
      if (typeof payload.frameH === "number") { state.frameHChars = payload.frameH; state.cellHChars = payload.frameH; }
      if (typeof payload.canvasZoom === "number") state.wholeSheetCanvasZoom = payload.canvasZoom;
      if (typeof payload.gridVisible === "boolean") state.wholeSheetGridVisible = payload.gridVisible;
      if (typeof payload.gridStep === "string") state.wholeSheetGridStep = payload.gridStep;
      if (typeof payload.gridCustomW === "number") state.wholeSheetGridCustomW = payload.gridCustomW;
      if (typeof payload.gridCustomH === "number") state.wholeSheetGridCustomH = payload.gridCustomH;
      // Restore geometry so saveSessionState() sends correct angles/anims/projs.
      // Without these, state remains at page-load defaults (angles=1, anims=[1])
      // and the server rejects save with HTTP 422 (session_geometry_invalid).
      if (typeof payload.angles === "number") state.angles = payload.angles;
      if (Array.isArray(payload.anims)) state.anims = [...payload.anims];
      if (typeof payload.projs === "number") state.projs = payload.projs;
      if (typeof payload.sourceProjs === "number") state.sourceProjs = payload.sourceProjs;

      // Refresh cells from the visual layer (layer 2)
      if (Array.isArray(payload.layers) && payload.layers[2]) {
        state.cells = payload.layers[2];
      }

      // Re-mount the whole-sheet editor with restored state
      hydrateWholeSheetEditor();
      // Enable save/export buttons (normally enabled by hydrateLoadedSession, which
      // _restoreDraft does not call).
      if ($("btnSave")) $("btnSave").disabled = false;
      if ($("btnExport")) $("btnExport").disabled = false;
      // Hide the draft-available banner that was shown on session load.
      _dismissDraftBanner();
      markSessionDirty("draft-restore");
      status("Draft restored from browser storage", "ok");
      return true;
    } catch (e) {
      status("Draft restore failed: " + String(e), "warn");
      return false;
    }
  }

  // ── Tier B: explicit file I/O ──

  /** File System Access API handle for save-back-to-same-file. */
  let _currentFileHandle = null;

  /**
   * Open an .xp file from local disk via File System Access API or file input fallback.
   * Loads the file contents into the editor via the existing upload-xp server endpoint,
   * then stores the file handle for subsequent save-back.
   */
  async function openXpFileLocal() {
    const p = window.__wbPersistence;
    if (!p || typeof p.openXpFile !== "function") {
      status("File I/O not available", "warn");
      return;
    }
    status("Opening file...", "warn");
    const result = await p.openXpFile();
    if (!result || !result.data) {
      // User cancelled or error — silent
      status("Open cancelled", "warn");
      return false;
    }
    // Store the handle for save-back
    _currentFileHandle = result.handle || null;

    // Upload the file contents to the server endpoint (mirrors importXp flow)
    const blob = new Blob([result.data], { type: "application/octet-stream" });
    const file = new File([blob], result.name || "import.xp", { type: "application/octet-stream" });
    const fd = new FormData();
    fd.append("file", file);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(bp("/api/workbench/upload-xp"), {
        method: "POST",
        body: fd,
        signal: ctl.signal,
      });
      const j = await r.json();
      if (!r.ok) {
        status("Open failed: " + (j.error || "unknown"), "err");
        $("sessionOut").textContent = JSON.stringify(j, null, 2);
        return false;
      }
      state.jobId = j.job_id;
      const loaded = await loadSession(j.session_id, { reason: "Opened XP file from disk..." });
      if (!loaded) return false;
      status("Opened: " + (result.name || "file"), "ok");
      _updateFileButtonStates();
      return true;
    } catch (e) {
      status("Open failed: " + String(e), "err");
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Save the current session to a local .xp file.
   * If a file handle is held from a prior open/save-as, writes back to the same file.
   * Otherwise prompts with save-as.
   */
  async function saveXpFileLocal() {
    const p = window.__wbPersistence;
    if (!p || typeof p.saveXpFile !== "function") {
      status("File I/O not available", "warn");
      return;
    }
    const xpData = await _getExportedXpBytes();
    if (!xpData) return; // _getExportedXpBytes already showed error status
    status("Saving to file...", "warn");
    const result = await p.saveXpFile(xpData, _currentFileHandle);
    if (result && result.saved) {
      if (result.handle) _currentFileHandle = result.handle;
      p.clearDraftAfterFileSave();
      status("Saved to file", "ok");
      _updateFileButtonStates();
    } else {
      status("Save cancelled or failed", "warn");
    }
  }

  /**
   * Save the current session to a new local .xp file (always shows picker/download).
   */
  async function saveXpFileAsLocal() {
    const p = window.__wbPersistence;
    if (!p || typeof p.saveXpFileAs !== "function") {
      status("File I/O not available", "warn");
      return;
    }
    const xpData = await _getExportedXpBytes();
    if (!xpData) return;
    const suggestedName = _currentFileHandle
      ? ((_currentFileHandle.name || "export.xp") + "")
      : "export.xp";
    status("Saving file as...", "warn");
    const result = await p.saveXpFileAs(xpData, suggestedName);
    if (result && result.saved) {
      if (result.handle) _currentFileHandle = result.handle;
      p.clearDraftAfterFileSave();
      status("Saved to new file", "ok");
      _updateFileButtonStates();
    } else {
      status("Save As cancelled or failed", "warn");
    }
  }

  /**
   * Share or download the current session as an .xp file (mobile-oriented).
   */
  async function shareXpFileLocal() {
    const p = window.__wbPersistence;
    if (!p || typeof p.shareXpFile !== "function") {
      status("File I/O not available", "warn");
      return;
    }
    const xpData = await _getExportedXpBytes();
    if (!xpData) return;
    const filename = _currentFileHandle
      ? (_currentFileHandle.name || "export.xp")
      : "export.xp";
    status("Sharing file...", "warn");
    const shared = await p.shareXpFile(xpData, filename);
    if (shared) {
      p.clearDraftAfterFileSave();
      status("File shared/downloaded", "ok");
    } else {
      status("Share cancelled", "warn");
    }
  }

  /**
   * Get the exported XP binary data for the current session.
   * Uses the server export-xp + download-xp endpoints to get the binary.
   * @returns {Promise<ArrayBuffer|null>}
   */
  async function _getExportedXpBytes() {
    if (!state.sessionId) {
      status("No active session to save", "warn");
      return null;
    }
    await flushPendingWholeSheetDrawSaveTimer();
    const saveRes = await saveSessionState("pre-file-save", { wait_for_idle: true, timeout_ms: 15000 });
    if (!saveRes || !saveRes.ok) {
      status("File save blocked: session save failed/timed out", "err");
      return null;
    }
    try {
      const exportRes = await fetch(bp("/api/workbench/export-xp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: state.sessionId }),
      });
      const exportJson = await exportRes.json();
      if (!exportRes.ok || !exportJson.xp_path) {
        status("Export failed: " + (exportJson.error || "unknown"), "err");
        return null;
      }
      // Download the binary XP data
      const dlRes = await fetch(bp("/api/workbench/download-xp?xp_path=" + encodeURIComponent(exportJson.xp_path)));
      if (!dlRes.ok) {
        status("Download failed", "err");
        return null;
      }
      return await dlRes.arrayBuffer();
    } catch (e) {
      status("File export failed: " + String(e), "err");
      return null;
    }
  }

  /**
   * Update enabled/disabled state of Tier B file buttons based on session state.
   */
  function _updateFileButtonStates() {
    const hasSession = !!state.sessionId;
    const openBtn = $("btnOpenFile");
    const saveBtn = $("btnSaveFile");
    const saveAsBtn = $("btnSaveFileAs");
    if (openBtn) openBtn.disabled = false; // Open is always available
    if (saveBtn) saveBtn.disabled = !hasSession;
    if (saveAsBtn) saveAsBtn.disabled = !hasSession;
  }

  function syncProductShellMode(mode = productMode) {
    const requested = String(mode || "browse").toLowerCase();
    productMode = requested === "paint" || requested === "edit" ? "edit" : "browse";
    const browsePanel = $("productBrowsePanel");
    const editEmptyState = $("productEditEmptyState");
    const editor = window.__wholeSheetEditor;
    const editorState = editor && typeof editor.getState === "function" ? editor.getState() : null;
    const hasDocument = !!(editorState?.mounted && state.sessionId);
    if (browsePanel) browsePanel.classList.toggle("hidden", productMode !== "browse");
    if (editEmptyState) editEmptyState.classList.toggle("hidden", productMode !== "edit" || hasDocument);
    const shell = $("productShell");
    if (shell) shell.dataset.mode = productMode;
    for (const [id, modeName] of [["productBrowseBtn", "browse"], ["productEditBtn", "edit"]]) {
      const button = $(id);
      if (!button) continue;
      const active = productMode === modeName;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.classList.toggle("primary", active);
    }
  }

  function setProductShellMode(mode) {
    const requested = String(mode || "").toLowerCase();
    const next = requested === "edit" || requested === "paint" ? "edit" : "browse";
    syncProductShellMode(next);
    const editor = window.__wholeSheetEditor;
    if (editor && typeof editor.setMode === "function") editor.setMode(next === "browse" ? "browse" : "paint");
  }

  // ── Desktop/mobile viewport toggle (Browse/home front door) ──
  // Tier C UI preference: persists in localStorage, never touches Tier A drafts
  // or Tier B files. Emulation constrains the shell to 390px via
  // body.wb-viewport-mobile (see styles.css); real narrow viewports match the
  // same layout through the max-width media queries.
  function getViewportMode() {
    try {
      return localStorage.getItem(VIEWPORT_MODE_STORAGE_KEY) === "mobile" ? "mobile" : "desktop";
    } catch (_e) {
      return "desktop";
    }
  }

  function setViewportMode(mode) {
    const next = mode === "mobile" ? "mobile" : "desktop";
    const mobile = next === "mobile";
    document.body.classList.toggle("wb-viewport-mobile", mobile);
    const btn = $("viewportToggleBtn");
    if (btn) {
      btn.setAttribute("aria-pressed", mobile ? "true" : "false");
      btn.textContent = mobile ? "Desktop view" : "Mobile view";
      btn.classList.toggle("tool-active", mobile);
    }
    try {
      localStorage.setItem(VIEWPORT_MODE_STORAGE_KEY, next);
    } catch (_e) { /* preference only — ignore */ }
    return next;
  }

  function attachProductBrowseApp() {
    const editor = window.__wholeSheetEditor;
    const container = $("productBrowseSurface");
    if (!editor || typeof editor.mountBrowseApp !== "function" || !container) return false;
    editor.mountBrowseApp({
      container,
      currentSessionId: state.sessionId,
      onBrowseList: browseListSessions,
      onBrowseOpen: browseOpenSession,
      onBrowseRename: browseRenameSession,
      onBrowseDuplicate: browseDuplicateSession,
      onBrowseDelete: browseDeleteSession,
      onBrowsePreview: previewSessionForBrowse,
      onBrowseNewRaw: newRawXp,
    });
    if (typeof editor.setMode === "function") editor.setMode(productMode === "browse" ? "browse" : "paint");
    syncProductShellMode(productMode);
    return true;
  }

  function bindUI() {
    moveWebbuildDockToBottom();
    movePanelsToBottom();
    $("productBrowseBtn")?.addEventListener("click", () => setProductShellMode("browse"));
    $("productEditBtn")?.addEventListener("click", () => setProductShellMode("edit"));
    $("viewportToggleBtn")?.addEventListener("click", () => {
      setViewportMode(getViewportMode() === "mobile" ? "desktop" : "mobile");
    });
    $("mobileKeyboardBtn")?.addEventListener("click", () => {
      setProductShellMode("edit");
      const editor = window.__wholeSheetEditor;
      if (editor && typeof editor.openMobileKeyboard === "function") editor.openMobileKeyboard();
    });
    document.querySelectorAll("[data-product-mode]").forEach((button) => {
      button.addEventListener("click", () => setProductShellMode(button.dataset.productMode));
    });
    window.addEventListener("whole-sheet-mode-change", (event) => {
      syncProductShellMode(event?.detail?.mode || "browse");
    });
    if (!attachProductBrowseApp()) {
      window.addEventListener("whole-sheet-editor-ready", attachProductBrowseApp, { once: true });
    }
    syncProductShellMode("browse");
    setViewportMode(getViewportMode());
    void fetchTemplateRegistry();
    renderInspectorPaletteSwatches();
    updateSessionDirtyBadge();
    updateBugReportPreview();
    $("btnLoad").addEventListener("click", loadFromJob);
    $("xpImportBtn").addEventListener("click", importXp);
    $("btnSave").addEventListener("click", () => saveCurrentActionProgress({ reason: "top-level-save", auto_advance: true }));
    $("btnExport").addEventListener("click", exportXp);
    $("btnNewXp").addEventListener("click", newXp);
    // Tier B: local file I/O buttons
    $("btnOpenFile").addEventListener("click", openXpFileLocal);
    $("btnSaveFile").addEventListener("click", saveXpFileLocal);
    $("btnSaveFileAs").addEventListener("click", saveXpFileAsLocal);
    // Open File is always available (doesn't require active session)
    if ($("btnOpenFile")) $("btnOpenFile").disabled = false;
    $("openXpToolBtn").addEventListener("click", openInXpTool);
    $("exportArtifactBtn")?.addEventListener("click", exportAuthoringArtifact);
    $("webbuildOpenBtn").addEventListener("click", openWebbuild);
    $("webbuildReloadBtn").addEventListener("click", reloadWebbuild);
    $("webbuildApplySkinBtn").addEventListener("click", applyCurrentXpAsWebSkin);
    $("webbuildApplyInPlaceBtn").addEventListener("click", () => applyCurrentXpAsWebSkin({ restart_if_overlay_hidden: false }));
    $("webbuildApplyRestartBtn").addEventListener("click", () => applyCurrentXpAsWebSkin({ force_restart: true, restart_if_overlay_hidden: true }));
    $("webbuildQuickTestBtn").addEventListener("click", testCurrentSkinInDock);
    $("webbuildUploadTestBtn").addEventListener("click", onWebbuildUploadTestClick);
    $("webbuildUploadTestInput").addEventListener("change", onWebbuildUploadTestInputChange);
    $("webbuildFrame").addEventListener("load", () => {
      state.webbuild.loaded = true;
      state.webbuild.ready = false;
      state.webbuild.lastLoadedSrc = String($("webbuildFrame")?.getAttribute("src") || "");
      updateWebbuildUI();
      setWebbuildState("Webbuild frame loaded, waiting for runtime...", "warn");
      stopWebbuildReadyPoll();
      state.webbuild.readyPoll = setInterval(detectWebbuildReady, 500);
    });
    $("termppSkinCmdBtn").addEventListener("click", termppSkinCommandPreview);
    $("termppSkinLaunchBtn").addEventListener("click", launchTermppSkin);
    $("termppStreamPreviewBtn").addEventListener("click", previewTermppEmbedStream);
    $("termppStreamStartBtn").addEventListener("click", startTermppEmbedStream);
    $("termppStreamStopBtn").addEventListener("click", stopTermppEmbedStream);
    $("termppBinary").addEventListener("change", () => {
      $("termppSkinOut").textContent = "";
    });
    ["termppStreamX", "termppStreamY", "termppStreamW", "termppStreamH", "termppStreamFps"].forEach((id) => {
      $(id).addEventListener("change", persistTermppStreamRegion);
    });
    $("verifyProfile").addEventListener("change", () => {
      const profile = String($("verifyProfile").value || "local_xp_sanity");
      if (profile === "legacy_verify_e2e" && !$("verifyCommandTemplate").value.trim()) {
        $("verifyCommandTemplate").value = defaultVerifyTemplate(profile);
      }
      updateVerifyUI();
    });
    $("verifyRunBtn").addEventListener("click", () => runWorkbenchVerification(false));
    $("verifyDryRunBtn").addEventListener("click", () => runWorkbenchVerification(true));
    $("verifyCommandTemplate").addEventListener("input", () => {
      try {
        localStorage.setItem(VERIFY_CMD_TEMPLATE_STORAGE_KEY, $("verifyCommandTemplate").value || "");
      } catch (_e) {}
    });
    $("uiRecorderStartBtn")?.addEventListener("click", startUiRecorder);
    $("uiRecorderStopBtn")?.addEventListener("click", stopUiRecorder);
    $("uiRecorderClearBtn")?.addEventListener("click", clearUiRecorder);
    $("uiRecorderDownloadBtn")?.addEventListener("click", downloadUiRecorder);
    $("reportBugBtn")?.addEventListener("click", openBugReportModal);
    $("reportBugWholeSheetBtn")?.addEventListener("click", openBugReportModal);
    $("bugReportCloseBtn")?.addEventListener("click", closeBugReportModal);
    $("bugReportSubmitBtn")?.addEventListener("click", submitBugReport);
    $("bugIncludeSession")?.addEventListener("change", updateBugReportPreview);
    $("bugIncludeRecorder")?.addEventListener("change", updateBugReportPreview);
    $("bugDeliveryMethod")?.addEventListener("change", updateBugReportPreview);
    $("bugReportModal")?.addEventListener("click", (ev) => {
      if (ev.target === $("bugReportModal")) closeBugReportModal();
    });
    $("undoBtn").addEventListener("click", undo);
    $("redoBtn").addEventListener("click", redo);

    $("templateApplyBtn")?.addEventListener("click", applyTemplate);
    $("createProfileBtn")?.addEventListener("click", createActorVisualProfile);
    $("wbUpload").addEventListener("click", wbUpload);
    $("wbRun").addEventListener("click", wbRun);
    // First-class PNG import entry: Browse/mobile Import goes straight to the
    // file chooser; the panel scrolls into view so Upload/Convert stay visible.
    $("browseImportPngBtn")?.addEventListener("click", focusPngImport);
    $("classicGeomAutoPlanBtn")?.addEventListener("click", applyClassicGeometryAutoPlan);
    ["classicGeomAngles", "classicGeomFrames", "classicGeomSourceProjs", "classicGeomCellW", "classicGeomCellH"].forEach((id) => {
      $(id)?.addEventListener("input", updateClassicGeometryHint);
      $(id)?.addEventListener("change", updateClassicGeometryHint);
    });
    $("wbAssignmentMode")?.addEventListener("change", (e) => {
      state.assignmentMode = e.target.value;
    });
    $("wbFile").addEventListener("change", () => {
      const f = $("wbFile").files[0];
      if (!f) return;
      state.uploadAnalysis = null;
      setUploadPlanSummary(null);
      const img = new Image();
      const objectUrl = URL.createObjectURL(f);
      img.onload = () => {
        state.sourceImage = img;
        state.anchorBox = null;
        state.drawCurrent = null;
        state.extractedBoxes = [];
        state.sourceCutsV = [];
        state.sourceCutsH = [];
        clearSourceSelection();
        state.sourceNextId = 1;
        renderSourceCanvas();
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        state.sourceImage = null;
        renderSourceCanvas();
        status("Image decode failed — file may be corrupted or unsupported", "err");
      };
      img.src = objectUrl;
    });

    $("sourceSelectBtn").addEventListener("click", () => setSourceMode("select"));
    $("drawBoxBtn").addEventListener("click", () => setSourceMode("draw_box"));
    $("rowSelectBtn").addEventListener("click", () => setSourceMode("row_select"));
    $("colSelectBtn").addEventListener("click", () => setSourceMode("col_select"));
    $("cutVBtn").addEventListener("click", () => setSourceMode("cut_v"));
    $("rapidManualAdd").addEventListener("change", () => {
      state.rapidManualAdd = !!$("rapidManualAdd").checked;
      updateSourceToolUI();
    });
    $("deleteBoxBtn").addEventListener("click", () => {
      if (!deleteSelectedSourceObjectsOrDraft()) {
        pushHistory();
        state.anchorBox = null;
        state.drawCurrent = null;
        state.extractedBoxes = [];
        state.sourceCutsV = [];
        clearSourceSelection();
        renderSourceCanvas();
        saveSessionState("clear-source-overlays");
        status("Cleared source boxes/cuts/anchor", "ok");
      }
    });
    $("extractBtn").addEventListener("click", () => {
      findSprites();
      saveSessionState("find-sprites");
    });
    $("sourceCanvas").addEventListener("contextmenu", (e) => {
      if (!state.sourceImage) return;
      e.preventDefault();
      const pt = canvasCoord(e, $("sourceCanvas"));
      if (state.drawCurrent && boxContainsPt(state.drawCurrent, pt)) {
        showSourceContextMenu(e.clientX, e.clientY, { type: "draft", useDraftAnchor: true });
        return;
      }
      const box = sourceBoxAtPoint(pt);
      if (box) {
        state.sourceSelection = new Set([Number(box.id)]);
        renderSourceCanvas();
        showSourceContextMenu(e.clientX, e.clientY, { type: "box", id: Number(box.id) });
        return;
      }
      const cut = sourceVBoxAtPoint(pt);
      if (cut) {
        state.sourceSelectedCut = { type: "v", id: Number(cut.id) };
        renderSourceCanvas();
        showSourceContextMenu(e.clientX, e.clientY, { type: "cut_v", id: Number(cut.id) });
      }
    });
    if (typeof PointerEvent !== 'undefined') {
      $("sourceCanvas").addEventListener("pointerdown", (e) => {
        onSourceMouseDown(e);
        if (state.sourceDrag) $("sourceCanvas").setPointerCapture(e.pointerId);
      });
      $("sourceCanvas").addEventListener("pointermove", onSourceMouseMove);
      $("sourceCanvas").addEventListener("pointerup", (e) => {
        onSourceMouseUp(e);
        if ($("sourceCanvas").hasPointerCapture(e.pointerId)) {
          $("sourceCanvas").releasePointerCapture(e.pointerId);
        }
      });
      $("sourceCanvas").addEventListener("pointercancel", (e) => {
        onSourceMouseUp(e);
        if ($("sourceCanvas").hasPointerCapture(e.pointerId)) {
          $("sourceCanvas").releasePointerCapture(e.pointerId);
        }
      });
      if ($("sourceCanvas").style) $("sourceCanvas").style.touchAction = 'none';
    } else {
      $("sourceCanvas").addEventListener("mousedown", onSourceMouseDown);
      $("sourceCanvas").addEventListener("mousemove", onSourceMouseMove);
      $("sourceCanvas").addEventListener("mouseup", onSourceMouseUp);
      window.addEventListener("mouseup", onSourceMouseUp);
    }
    $("srcCtxAddSprite").addEventListener("click", () => {
      const box = state.sourceContextTarget?.type === "draft"
        ? commitDraftToSource("manual")
        : null;
      if (box) setSourceMode("row_select");
      hideSourceContextMenu();
    });
    $("srcCtxAddToRow").addEventListener("click", () => {
      let box = null;
      if (state.sourceContextTarget?.type === "draft") {
        box = commitDraftToSource("manual") || null;
        if (!box && state.drawCurrent) box = { ...state.drawCurrent, id: -1 };
      } else if (state.sourceContextTarget?.type === "box") {
        box = state.extractedBoxes.find((b) => Number(b.id) === Number(state.sourceContextTarget.id)) || null;
      }
      if (box) addSourceBoxToSelectedRowSequence(box);
      hideSourceContextMenu();
    });
    $("srcCtxSetAnchor").addEventListener("click", () => {
      setAnchorFromTarget(state.sourceContextTarget);
      hideSourceContextMenu();
      renderSourceCanvas();
      saveSessionState("set-anchor");
    });
    $("srcCtxPadAnchor").addEventListener("click", () => {
      applyPadToContextTarget();
      hideSourceContextMenu();
    });
    $("srcCtxDelete").addEventListener("click", () => {
      deleteSourceTarget(state.sourceContextTarget);
      hideSourceContextMenu();
    });

    $("deleteCellBtn").addEventListener("click", deleteSelectedFrames);
    if ($("deleteFrameBtn")) $("deleteFrameBtn").addEventListener("click", deleteSelectedFrameSlots);
    $("ctxCopy").addEventListener("click", () => {
      copySelectedFrameToClipboard();
      $("gridContextMenu").classList.add("hidden");
    });
    $("ctxPaste").addEventListener("click", () => {
      pasteClipboardToSelectedFrame();
      $("gridContextMenu").classList.add("hidden");
    });
    $("ctxOpenInspector").addEventListener("click", () => {
      openInspectorFromGridContextMenu();
      $("gridContextMenu").classList.add("hidden");
    });
    $("ctxDelete").addEventListener("click", () => {
      deleteSelectedFrames();
      $("gridContextMenu").classList.add("hidden");
    });
    $("rowUpBtn").addEventListener("click", () => moveSelectedRow(-1));
    $("rowDownBtn").addEventListener("click", () => moveSelectedRow(1));
    $("colLeftBtn").addEventListener("click", () => moveSelectedCols(-1));
    $("colRightBtn").addEventListener("click", () => moveSelectedCols(1));
    if ($("addFrameBtn")) $("addFrameBtn").addEventListener("click", addGridFrameSlot);
    $("openInspectorBtn").addEventListener("click", openInspectorForSelectedFrame);
    if ($("sourceZoomInput")) $("sourceZoomInput").addEventListener("input", () => {
      state.sourceCanvasZoom = clampSourceCanvasZoom($("sourceZoomInput").value || 1);
      updateSourceCanvasZoomUI();
    });
    if ($("gridZoomInput")) $("gridZoomInput").addEventListener("input", () => {
      state.gridPanelZoom = clampGridPanelZoom($("gridZoomInput").value || 0);
      renderFrameGrid();
    });
    if ($("gridToggleLabels")) $("gridToggleLabels").addEventListener("click", () => {
      const panel = $("gridPanel");
      if (!panel) return;
      const shown = panel.classList.toggle("frame-labels-visible");
      $("gridToggleLabels").classList.toggle("active", shown);
    });
    $("assignAnimCategoryBtn").addEventListener("click", assignRowCategory);
    $("assignFrameGroupBtn").addEventListener("click", assignFrameGroup);
    $("applyGroupsToAnimsBtn").addEventListener("click", applyGroupsToAnims);
    $("autoAlignSelectedBtn").addEventListener("click", () => autoAlignFrameJitter(false));
    $("autoAlignRowBtn").addEventListener("click", () => autoAlignFrameJitter(true));
    $("mountedCalibrationBtn")?.addEventListener("click", runMountedOverlayCalibration);
    $("mountedSemanticBtn")?.addEventListener("click", runMountedSemanticReview);
    $("jitterLeftBtn").addEventListener("click", () => {
      const step = Math.max(1, Number($("jitterStep").value || 1));
      nudgeSelectedFrames(-step, 0);
    });
    $("jitterRightBtn").addEventListener("click", () => {
      const step = Math.max(1, Number($("jitterStep").value || 1));
      nudgeSelectedFrames(step, 0);
    });
    $("jitterUpBtn").addEventListener("click", () => {
      const step = Math.max(1, Number($("jitterStep").value || 1));
      nudgeSelectedFrames(0, -step);
    });
    $("jitterDownBtn").addEventListener("click", () => {
      const step = Math.max(1, Number($("jitterStep").value || 1));
      nudgeSelectedFrames(0, step);
    });
    $("jitterRow").addEventListener("change", () => {
      jumpSelectionToRow(Number($("jitterRow").value || 0));
    });

    $("playBtn").addEventListener("click", startPreview);
    $("stopBtn").addEventListener("click", stopPreview);
    $("previewAngle").addEventListener("change", () => {
      const row = Math.max(0, Math.min(state.angles - 1, Number($("previewAngle").value || 0)));
      renderPreviewFrame(row, 0);
    });
    $("layerSelect").addEventListener("change", () => {
      const nextLayer = Math.max(0, Number($("layerSelect").value || 2));
      const wsEditor = getMountedWholeSheetEditor();
      if (wsEditor && typeof wsEditor.setActiveLayer === "function") {
        wsEditor.setActiveLayer(nextLayer);
        return;
      }
      state.activeLayer = nextLayer;
      renderAll();
    });
    $("layerVisibility").addEventListener("change", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (t.type !== "checkbox") return;
      const layer = Number(t.dataset.layer || -1);
      if (layer < 0) return;
      const wsEditor = getMountedWholeSheetEditor();
      if (wsEditor && typeof wsEditor.setLayerVisibility === "function") {
        wsEditor.setLayerVisibility(layer, !!t.checked);
        return;
      }
      if (t.checked) state.visibleLayers.add(layer);
      else state.visibleLayers.delete(layer);
      if (state.visibleLayers.size === 0) {
        state.visibleLayers.add(2);
      }
      renderAll();
    });
    $("inspectorCloseBtn").addEventListener("click", closeInspector);
    $("inspectorPrevAngleBtn").addEventListener("click", () => moveInspectorSelection(-1, 0));
    $("inspectorNextAngleBtn").addEventListener("click", () => moveInspectorSelection(1, 0));
    $("inspectorPrevFrameBtn").addEventListener("click", () => moveInspectorSelection(0, -1));
    $("inspectorNextFrameBtn").addEventListener("click", () => moveInspectorSelection(0, 1));
    $("inspectorZoom").addEventListener("input", () => {
      state.inspectorZoom = Number($("inspectorZoom").value || 10);
      renderInspector();
    });
    $("inspectorToolInspectBtn").addEventListener("click", () => {
      state.inspectorTool = "inspect";
      updateInspectorToolUI();
      renderInspector();
    });
    $("inspectorToolSelectBtn").addEventListener("click", () => {
      state.inspectorTool = "select";
      updateInspectorToolUI();
      renderInspector();
    });
    $("inspectorToolGlyphBtn").addEventListener("click", () => {
      state.inspectorTool = "glyph";
      updateInspectorToolUI();
      renderInspector();
    });
    $("inspectorToolPaintBtn").addEventListener("click", () => {
      state.inspectorTool = "paint";
      updateInspectorToolUI();
      renderInspector();
    });
    $("inspectorToolEraseBtn").addEventListener("click", () => {
      state.inspectorTool = "erase";
      updateInspectorToolUI();
      renderInspector();
    });
    $("inspectorToolDropperBtn").addEventListener("click", () => {
      state.inspectorTool = "dropper";
      updateInspectorToolUI();
      renderInspector();
    });
    $("inspectorPaintColor").addEventListener("input", () => {
      state.inspectorPaintColor = hexToRgb($("inspectorPaintColor").value || "#ffffff");
      updateInspectorToolUI();
      renderInspector();
    });
    $("inspectorGlyphCode").addEventListener("input", () => {
      state.inspectorGlyphCode = clampInspectorGlyphCode($("inspectorGlyphCode").value || 0);
      updateInspectorToolUI();
      renderInspector();
    });
    $("inspectorGlyphChar").addEventListener("input", () => {
      const v = String($("inspectorGlyphChar").value || "");
      if (v) state.inspectorGlyphCode = clampInspectorGlyphCode(v.charCodeAt(0));
      updateInspectorToolUI();
      renderInspector();
    });
    $("inspectorGlyphFgColor").addEventListener("input", () => {
      state.inspectorGlyphFgColor = hexToRgb($("inspectorGlyphFgColor").value || "#ffffff");
      updateInspectorToolUI();
      renderInspector();
    });
    $("inspectorGlyphBgColor").addEventListener("input", () => {
      state.inspectorGlyphBgColor = hexToRgb($("inspectorGlyphBgColor").value || "#ff00ff");
      updateInspectorToolUI();
      renderInspector();
    });
    $("inspectorCopyFrameBtn").addEventListener("click", copyInspectorFrame);
    $("inspectorPasteFrameBtn").addEventListener("click", pasteInspectorFrame);
    $("inspectorFlipHBtn").addEventListener("click", flipInspectorFrameHorizontal);
    $("inspectorClearFrameBtn").addEventListener("click", clearInspectorFrame);
    $("inspectorCopySelBtn").addEventListener("click", copyInspectorSelection);
    $("inspectorPasteSelBtn").addEventListener("click", pasteInspectorSelection);
    $("inspectorCutSelBtn").addEventListener("click", cutInspectorSelection);
    $("inspectorClearSelBtn").addEventListener("click", clearInspectorSelectionCells);
    $("inspectorSelectAllBtn").addEventListener("click", inspectorSelectAll);
    $("inspectorFillSelBtn").addEventListener("click", fillInspectorSelectionWithGlyph);
    $("inspectorReplaceFgBtn").addEventListener("click", () => replaceInspectorSelectionColor("fg"));
    $("inspectorReplaceBgBtn").addEventListener("click", () => replaceInspectorSelectionColor("bg"));
    $("inspectorRotateSelCwBtn").addEventListener("click", () => transformInspectorSelection("rot_cw"));
    $("inspectorRotateSelCcwBtn").addEventListener("click", () => transformInspectorSelection("rot_ccw"));
    $("inspectorFlipSelHBtn").addEventListener("click", () => transformInspectorSelection("flip_h"));
    $("inspectorFlipSelVBtn").addEventListener("click", () => transformInspectorSelection("flip_v"));
    $("inspectorBgTransparentBtn").addEventListener("click", () => {
      state.inspectorGlyphBgColor = [...MAGENTA];
      updateInspectorToolUI();
      renderInspector();
    });
    $("inspectorFindReplaceApplyBtn").addEventListener("click", applyInspectorFindReplace);
    $("inspectorFrScope").addEventListener("change", updateInspectorToolUI);
    $("inspectorShowGrid").addEventListener("change", () => {
      state.inspectorShowGrid = !!$("inspectorShowGrid").checked;
      renderInspector();
    });
    $("inspectorGridStep").addEventListener("change", () => {
      const v = Number($("inspectorGridStep").value);
      state.inspectorGridStep = [1, 2, 4, 8, 16].includes(v) ? v : 1;
      renderInspector();
    });
    $("inspectorShowChecker").addEventListener("change", () => {
      state.inspectorShowChecker = !!$("inspectorShowChecker").checked;
      renderInspector();
    });
    $("cellInspectorCanvas").addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });
    const _useInspectorPointerEvents = typeof PointerEvent !== 'undefined';
    const _inspCanvas = $("cellInspectorCanvas");
    const _inspDown = (e) => {
      if (!state.inspectorOpen) return;
      if (e.button === 2) {
        const hit = inspectorHalfCellAtEvent(e);
        if (!hit) return;
        setInspectorHoverFromHit(hit);
        sampleInspectorGlyphAndPaintFromHit(hit);
        return;
      }
      if (e.button !== 0) return;
      if (state.inspectorTool === "select") {
        const hitCell = inspectorCellRectAtEvent(e);
        if (!hitCell) return;
        state.inspectorSelecting = true;
        state.inspectorSelectAnchor = { x: hitCell.cx, y: hitCell.cy };
        state.inspectorSelection = normalizeInspectorSelection({ x1: hitCell.cx, y1: hitCell.cy, x2: hitCell.cx, y2: hitCell.cy });
        renderInspector();
        if (_useInspectorPointerEvents) _inspCanvas.setPointerCapture(e.pointerId);
        return;
      }
      const hit = inspectorHalfCellAtEvent(e);
      if (!hit) return;
      setInspectorHoverFromHit(hit);
      if (state.inspectorTool === "paint" || state.inspectorTool === "erase" || state.inspectorTool === "glyph") {
        state.inspectorPainting = true;
        state.inspectorStrokeChanged = false;
        state.inspectorStrokeHadHistory = false;
        state.inspectorStrokeWasDirty = !!state.sessionDirty;
        if (_useInspectorPointerEvents) _inspCanvas.setPointerCapture(e.pointerId);
      }
      let changed = false;
      if (state.inspectorTool === "glyph") {
        changed = applyInspectorGlyphAtCell(hit);
      } else {
        changed = applyInspectorToolAt(hit);
      }
      if (changed) state.inspectorStrokeChanged = true;
      if (changed) {
        renderInspector();
        queueDirtyFrameGridRefresh({ updatePreview: true });
      }
      if (state.inspectorTool === "dropper" || state.inspectorTool === "inspect") {
        state.inspectorPainting = false;
      }
    };
    const _inspMove = (e) => {
      const hoverHit = inspectorHalfCellAtEvent(e);
      setInspectorHoverFromHit(hoverHit);
      if (state.inspectorSelecting) {
        const hitCell = inspectorCellRectAtEvent(e);
        if (!hitCell || !state.inspectorSelectAnchor) return;
        state.inspectorSelection = normalizeInspectorSelection({
          x1: state.inspectorSelectAnchor.x,
          y1: state.inspectorSelectAnchor.y,
          x2: hitCell.cx,
          y2: hitCell.cy,
        });
        renderInspector();
        return;
      }
      if (!state.inspectorPainting) return;
      if (state.inspectorTool !== "paint" && state.inspectorTool !== "erase" && state.inspectorTool !== "glyph") return;
      const hit = hoverHit;
      if (!hit) return;
      const changed = state.inspectorTool === "glyph" ? applyInspectorGlyphAtCell(hit) : applyInspectorToolAt(hit);
      if (changed) state.inspectorStrokeChanged = true;
      if (changed) {
        renderInspector();
        queueDirtyFrameGridRefresh({ updatePreview: true });
      }
    };
    const _inspUp = (e) => {
      if (state.inspectorPainting) commitInspectorStrokeIfNeeded();
      if (state.inspectorSelecting) {
        state.inspectorSelecting = false;
        state.inspectorSelectAnchor = null;
        renderInspector();
      }
      // Only clear hover on touch — desktop mouse should keep hover until pointerleave
      if (e.pointerType === 'touch') setInspectorHoverFromHit(null);
      if (_useInspectorPointerEvents && _inspCanvas.hasPointerCapture(e.pointerId)) {
        _inspCanvas.releasePointerCapture(e.pointerId);
      }
    };
    if (_useInspectorPointerEvents) {
      _inspCanvas.addEventListener("pointerdown", _inspDown);
      _inspCanvas.addEventListener("pointermove", _inspMove);
      _inspCanvas.addEventListener("pointerup", _inspUp);
      _inspCanvas.addEventListener("pointercancel", _inspUp);
      _inspCanvas.addEventListener("pointerleave", () => {
        // Only clear hover when not in a captured drag -- during capture,
        // hover is cleared on pointerup/pointercancel instead.
        if (!state.inspectorPainting && !state.inspectorSelecting) {
          setInspectorHoverFromHit(null);
        }
      });
      if (_inspCanvas.style) _inspCanvas.style.touchAction = 'none';
    } else {
      _inspCanvas.addEventListener("mousedown", _inspDown);
      _inspCanvas.addEventListener("mousemove", _inspMove);
      _inspCanvas.addEventListener("mouseleave", () => {
        setInspectorHoverFromHit(null);
      });
      window.addEventListener("mouseup", () => {
        if (state.inspectorPainting) commitInspectorStrokeIfNeeded();
        if (state.inspectorSelecting) {
          state.inspectorSelecting = false;
          state.inspectorSelectAnchor = null;
          renderInspector();
        }
      });
    }

    window.addEventListener("keydown", (e) => {
      const t = e.target;
      const typingTarget =
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement;
      if (typingTarget && !(e.ctrlKey || e.metaKey)) return;
      if (state.inspectorOpen && (e.ctrlKey || e.metaKey) && !e.altKey && !typingTarget) {
        const k = e.key.toLowerCase();
        if (k === "c") {
          if (!copyInspectorSelection()) copyInspectorFrame();
          e.preventDefault();
          return;
        }
        if (k === "x") {
          cutInspectorSelection();
          e.preventDefault();
          return;
        }
        if (k === "v") {
          if (!pasteInspectorSelection()) pasteInspectorFrame();
          e.preventDefault();
          return;
        }
        if (k === "a") {
          inspectorSelectAll();
          e.preventDefault();
          return;
        }
      }
      if (state.inspectorOpen && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "p") {
          state.inspectorTool = "paint";
          updateInspectorToolUI();
          renderInspector();
          e.preventDefault();
          return;
        }
        if (k === "g") {
          state.inspectorTool = "glyph";
          updateInspectorToolUI();
          renderInspector();
          e.preventDefault();
          return;
        }
        if (k === "s") {
          state.inspectorTool = "select";
          updateInspectorToolUI();
          renderInspector();
          e.preventDefault();
          return;
        }
        if (k === "e") {
          state.inspectorTool = "erase";
          updateInspectorToolUI();
          renderInspector();
          e.preventDefault();
          return;
        }
        if (k === "i") {
          state.inspectorTool = "dropper";
          updateInspectorToolUI();
          renderInspector();
          e.preventDefault();
          return;
        }
        if (k === "q") {
          moveInspectorSelection(-1, 0);
          e.preventDefault();
          return;
        }
        if (k === "r") {
          moveInspectorSelection(1, 0);
          e.preventDefault();
          return;
        }
        if (k === "a") {
          moveInspectorSelection(0, -1);
          e.preventDefault();
          return;
        }
        if (k === "d") {
          moveInspectorSelection(0, 1);
          e.preventDefault();
          return;
        }
        if (k === "c") {
          if (!copyInspectorSelection()) copyInspectorFrame();
          e.preventDefault();
          return;
        }
        if (k === "x") {
          cutInspectorSelection();
          e.preventDefault();
          return;
        }
        if (k === "v") {
          if (!pasteInspectorSelection()) pasteInspectorFrame();
          e.preventDefault();
          return;
        }
        if (k === "f") {
          flipInspectorFrameHorizontal();
          e.preventDefault();
          return;
        }
        if (k === "]") {
          transformInspectorSelection("rot_cw");
          e.preventDefault();
          return;
        }
        if (k === "[") {
          transformInspectorSelection("rot_ccw");
          e.preventDefault();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (typingTarget) return;
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        if (typingTarget) return;
        e.preventDefault();
        redo();
      } else if (e.key === "Delete") {
        if (state.inspectorOpen) {
          if (!clearInspectorSelectionCells()) clearInspectorFrame();
          e.preventDefault();
        } else if (deleteSelectedSourceObjectsOrDraft()) {
          e.preventDefault();
        } else {
          deleteSelectedFrames();
        }
      } else if (e.key === "Escape") {
        hideSourceContextMenu();
        if (state.inspectorOpen) {
          if (state.inspectorSelection) {
            state.inspectorSelection = null;
            state.inspectorSelecting = false;
            state.inspectorSelectAnchor = null;
            renderInspector();
            e.preventDefault();
            return;
          }
          closeInspector();
        } else if (state.sourceDrag || state.sourceRowDrag) {
          state.sourceDrag = null;
          state.sourceRowDrag = null;
          state.drawing = false;
          state.drawStart = null;
          renderSourceCanvas();
        } else {
          clearGridSelection();
          clearSourceSelection();
          renderFrameGrid();
          renderSourceCanvas();
        }
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "v") {
        setSourceMode("select");
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "b") {
        setSourceMode("draw_box");
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "r") {
        setSourceMode("row_select");
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "c") {
        setSourceMode("col_select");
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "x") {
        setSourceMode("cut_v");
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && ["w", "a", "s", "d"].includes(e.key.toLowerCase())) {
        const step = e.shiftKey ? 10 : Math.max(1, Number($("jitterStep")?.value || 1));
        const key = e.key.toLowerCase();
        const dx = key === "a" ? -step : key === "d" ? step : 0;
        const dy = key === "w" ? -step : key === "s" ? step : 0;
        if (dx !== 0 || dy !== 0) {
          if (nudgeSelectedFrames(dx, dy)) e.preventDefault();
        }
      } else if (e.key === "Enter") {
        if (state.drawCurrent) {
          e.preventDefault();
          commitDraftToSource("manual");
        }
      } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        if (e.altKey && !e.ctrlKey && !e.metaKey) {
          const step = e.shiftKey ? 10 : Math.max(1, Number($("jitterStep")?.value || 1));
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          if (dx !== 0 || dy !== 0) {
            if (nudgeSelectedFrames(dx, dy)) e.preventDefault();
            return;
          }
        }
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (dx !== 0 || dy !== 0) {
          if (nudgeSelectedSourceBox(dx, dy) || nudgeDraftBox(dx, dy)) {
            e.preventDefault();
          }
        }
      }
    });
    attachGridHandlers();
    updateUndoRedoButtons();
    try {
      const savedCmd = localStorage.getItem(VERIFY_CMD_TEMPLATE_STORAGE_KEY);
      if (savedCmd) $("verifyCommandTemplate").value = savedCmd;
    } catch (_e) {}
    loadPersistedTermppStreamRegion();
    setXpToolHint("Export an `.xp` to generate XP tool command.");
    $("xpToolCommandHint").addEventListener("click", async () => {
      const txt = $("xpToolCommandHint").textContent || "";
      const pref = "XP Tool: ";
      if (!txt.startsWith(pref)) return;
      try {
        await navigator.clipboard.writeText(txt.slice(pref.length));
        status("XP Tool command copied", "ok");
      } catch (_e) {
        status("Clipboard copy failed", "warn");
      }
    });
    updateSourceToolUI();
    updateVerifyUI();
    updateTermppSkinUI();
    updateWebbuildUI();
    installViewportResizeObserver();
    window.addEventListener("beforeunload", () => stopTermppStreamPolling());
    window.addEventListener("beforeunload", () => stopWebbuildReadyPoll());
    // Tier A: best-effort draft save on page teardown
    window.addEventListener("beforeunload", () => {
      const p = window.__wbPersistence;
      if (!p || !p.isAvailable()) return;
      try {
        const wsSnapshot = getWholeSheetDocumentSnapshot() || buildWholeSheetDocumentSnapshotFromState();
        if (!wsSnapshot) return;
        const payload = {
          timestamp: Date.now(),
          sessionId: state.sessionId || "",
          layers: wsSnapshot.layers,
          layerNames: wsSnapshot.layerNames,
          activeLayer: wsSnapshot.activeLayer,
          visibleLayers: wsSnapshot.visibleLayers,
          lockedLayers: wsSnapshot.lockedLayers,
          gridCols: wsSnapshot.gridCols,
          gridRows: wsSnapshot.gridRows,
          frameW: wsSnapshot.frameW,
          frameH: wsSnapshot.frameH,
          canvasZoom: wsSnapshot.canvasZoom,
          gridVisible: wsSnapshot.gridVisible,
          gridStep: wsSnapshot.gridStep,
          gridCustomW: wsSnapshot.gridCustomW,
          gridCustomH: wsSnapshot.gridCustomH,
          angles: state.angles,
          anims: [...state.anims],
          projs: state.projs,
          sourceProjs: state.sourceProjs,
        };
        p.saveDraftSync(payload);
        p.setDirtyFlag();
      } catch (_) { /* best-effort */ }
    });
    // Tier A: draft restore check is deferred — see loadFromJob path below.
  }

  // Audit hooks for deterministic browser checks.
  window.__wb_debug = {
    getState: () => ({
      jobId: state.jobId,
      sessionId: state.sessionId,
      angles: state.angles,
      anims: [...state.anims],
      projs: state.projs,
      sourceProjs: state.sourceProjs,
      frameWChars: state.frameWChars,
      frameHChars: state.frameHChars,
      selectedFrames: selectedFrameCoordsSorted().map((coord) => ({ row: coord.row, col: coord.col })),
      selectedRows: selectedRowsSorted(),
      selectedRow: state.selectedRow,
      selectedCols: [...state.selectedCols],
      rowCategories: { ...state.rowCategories },
      frameGroups: JSON.parse(JSON.stringify(state.frameGroups)),
      sourceMode: String(state.sourceMode || "select"),
      rapidManualAdd: !!state.rapidManualAdd,
      sourceImageLoaded: !!state.sourceImage,
      drawCurrent: state.drawCurrent ? { ...state.drawCurrent } : null,
      sourceSelection: [...state.sourceSelection],
      extractedBoxes: state.extractedBoxes.length,
      sourceBoxes: state.extractedBoxes.map((b) => ({ id: Number(b.id), x: Number(b.x), y: Number(b.y), w: Number(b.w), h: Number(b.h) })),
      anchorBox: state.anchorBox ? { ...state.anchorBox } : null,
      historyDepth: combinedHistoryState().historyDepth,
      futureDepth: combinedHistoryState().futureDepth,
      wrapperHistoryDepth: combinedHistoryState().wrapperHistoryDepth,
      wrapperFutureDepth: combinedHistoryState().wrapperFutureDepth,
      wholeSheetHistoryDepth: combinedHistoryState().wholeSheetHistoryDepth,
      wholeSheetFutureDepth: combinedHistoryState().wholeSheetFutureDepth,
      // P1 fields (M2 verifier prerequisite — VB-01)
      bundleId: state.bundleId ? String(state.bundleId) : "",
      activeActionKey: String(state.activeActionKey || ""),
      templateSetKey: String(state.templateSetKey || ""),
      activeLayer: typeof state.activeLayer === "number" ? state.activeLayer : 2,
      visibleLayers: [...(state.visibleLayers instanceof Set ? state.visibleLayers : [])],
      layerCount: Array.isArray(state.layers) ? state.layers.length : 0,
      sessionDirty: !!state.sessionDirty,
      gridCols: state.gridCols || 0,
      gridRows: state.gridRows || 0,
      // P2 fields (M2 source panel verifier — VB-02)
      sourceCutsV: Array.isArray(state.sourceCutsV) ? state.sourceCutsV.length : 0,
      sourceCanvasZoom: typeof state.sourceCanvasZoom === "number" ? state.sourceCanvasZoom : 1,
      gridPanelZoom: typeof state.gridPanelZoom === "number" ? state.gridPanelZoom : 0,
    }),
    getWebbuildDebugState: () => {
      const frame = $("webbuildFrame");
      const out = {
        loaded: !!state.webbuild.loaded,
        ready: !!state.webbuild.ready,
        runtimePreflight: {
          checked: !!state.webbuild.runtimePreflight?.checked,
          ok: !!state.webbuild.runtimePreflight?.ok,
          missing_files: Array.isArray(state.webbuild.runtimePreflight?.missing_files) ? [...state.webbuild.runtimePreflight.missing_files] : [],
          invalid_files: Array.isArray(state.webbuild.runtimePreflight?.invalid_files) ? [...state.webbuild.runtimePreflight.invalid_files] : [],
          maps_found: Array.isArray(state.webbuild.runtimePreflight?.maps_found) ? [...state.webbuild.runtimePreflight.maps_found] : [],
          error: String(state.webbuild.runtimePreflight?.error || ""),
        },
        loadRequestedAt: Number(state.webbuild.loadRequestedAt || 0),
        wbStatus: String($("wbStatus")?.textContent || ""),
        webbuildState: String($("webbuildState")?.textContent || ""),
        quickBtnDisabled: !!$("webbuildQuickTestBtn")?.disabled,
        quickBtnText: String($("webbuildQuickTestBtn")?.textContent || ""),
        iframeVisible: !!frame && !frame.classList.contains("hidden"),
        iframeSrc: frame ? String(frame.getAttribute("src") || "") : "",
      };
      const win = webbuildFrameWindow();
      if (!win) return out;
      try {
        const progressEl = win.document && win.document.getElementById ? win.document.getElementById("progress") : null;
        const statusEl = win.document && win.document.getElementById ? win.document.getElementById("status") : null;
        out.iframe = {
          href: String(win.location?.href || ""),
          readyState: String(win.document?.readyState || ""),
          hasModule: !!win.Module,
          calledRun: !!(win.Module && win.Module.calledRun),
          hasLoad: typeof win.Load === "function",
          hasStartGame: typeof win.StartGame === "function",
          wasmReady: !!win._wasmReady,
          hasLegacyFsOps: !!(win.Module && typeof win.Module.FS_createDataFile === "function" && typeof win.Module.FS_unlink === "function"),
          hasWriteFileFs: !!(win.Module && win.Module.FS && typeof win.Module.FS.writeFile === "function"),
          statusText: String(statusEl?.textContent || "").trim(),
          progressHidden: !!(progressEl && progressEl.hidden),
          progressValue: progressEl ? Number(progressEl.value || 0) : null,
          progressMax: progressEl ? Number(progressEl.max || 0) : null,
          overlayVisible: webbuildLoginOverlayVisible(win),
          legacyPreview: win.__legacySkinPreview || null,
        };
      } catch (e) {
        out.iframeError = String(e);
      }
      out.overrideMode = "legacy_pre_main_token";
      return out;
    },
    // Verifier-only autosave suppression. During recipe replay the runner
    // suppresses the idle whole-sheet autosave queue and saves explicitly at
    // controlled checkpoints via flushSave().
    suppressAutoSave: (on) => {
      state._suppressAutoSave = !!on;
      if (on) clearQueuedWholeSheetAutosave();
    },
    flushSave: () => {
      clearQueuedWholeSheetAutosave();
      return saveSessionState("verifier-checkpoint", { wait_for_idle: true, timeout_ms: 30000 });
    },
    // Verifier-only render suppression.  During recipe replay the frame grid
    // rebuild (innerHTML + 144 canvas elements) and preview render fire on
    // every stroke completion — 4694 actions = ~676K DOM element churn.
    // Suppressing these during replay prevents Chromium renderer OOM crashes.
    suppressRender: (on) => {
      const wasSuppressed = !!state._suppressRender;
      state._suppressRender = !!on;
      if (wasSuppressed && !state._suppressRender) {
        queueDirtyFrameGridRefresh({ updatePreview: true });
      }
    },
    // Layer-aware accessors for browser-level proof automation.
    _state: () => state,
    _setCell: (x, y, c) => setCell(x, y, c),
    _pushHistory: () => pushHistory(),
    _undo: () => undo(),
    _redo: () => redo(),
    startUiRecorder: () => startUiRecorder(),
    stopUiRecorder: () => stopUiRecorder(),
    clearUiRecorder: () => clearUiRecorder(),
    getUiRecorder: () => getUiRecorderData(),
    downloadUiRecorder: () => downloadUiRecorder(),
    openWebbuild: (forceFresh = true) => {
      openWebbuild({ force_fresh: forceFresh !== false });
      return true;
    },
    testSkinDock: () => {
      testCurrentSkinInDock();
      return true;
    },
    openInspector: (row = 0, col = 0) => {
      openInspector(Number(row) || 0, Number(col) || 0);
      return {
        open: !!state.inspectorOpen,
        row: state.inspectorRow,
        col: state.inspectorCol,
      };
    },
    focusWholeSheetFrame: (row = 0, col = 0) => {
      const ok = focusWholeSheetFrame(Number(row) || 0, Number(col) || 0);
      return { ok, selectedRow: state.selectedRow, selectedCols: [...(state.selectedCols || [])] };
    },
    commitDraftSource: () => {
      const before = state.extractedBoxes.length;
      const box = commitDraftToSource("manual") || null;
      return {
        before,
        after: state.extractedBoxes.length,
        box: box ? { id: Number(box.id), x: Number(box.x), y: Number(box.y), w: Number(box.w), h: Number(box.h) } : null,
        drawCurrent: state.drawCurrent ? { ...state.drawCurrent } : null,
      };
    },
    selectSourceBoxes: (ids = []) => {
      const vals = Array.isArray(ids) ? ids.map((x) => Number(x)).filter((x) => Number.isFinite(x)) : [];
      state.sourceSelection = new Set(vals);
      renderSourceCanvas();
      return { selected: [...state.sourceSelection] };
    },
    addSourceBoxToSelectedRowById: (id) => {
      const box = state.extractedBoxes.find((b) => Number(b.id) === Number(id)) || null;
      if (!box) return { ok: false, reason: "source_box_not_found", id: Number(id) };
      const beforeSelRow = state.selectedRow;
      const beforeSelCols = [...state.selectedCols];
      const ok = addSourceBoxToSelectedRowSequence(box);
      return {
        ok: !!ok,
        id: Number(id),
        before: { selectedRow: beforeSelRow, selectedCols: beforeSelCols },
        after: { selectedRow: state.selectedRow, selectedCols: [...state.selectedCols] },
      };
    },
    getInspectorState: () => ({
      open: !!state.inspectorOpen,
      row: Number(state.inspectorRow || 0),
      col: Number(state.inspectorCol || 0),
      tool: String(state.inspectorTool || "inspect"),
      paintColor: [...(state.inspectorPaintColor || [255, 255, 255])],
      selection: state.inspectorSelection ? { ...state.inspectorSelection } : null,
      hover: state.inspectorHover ? {
        cx: Number(state.inspectorHover.cx || 0),
        cy: Number(state.inspectorHover.cy || 0),
        half: String(state.inspectorHover.half || "top"),
      } : null,
      lastHoverAnchor: state.inspectorLastHoverAnchor ? {
        cx: Number(state.inspectorLastHoverAnchor.cx || 0),
        cy: Number(state.inspectorLastHoverAnchor.cy || 0),
      } : null,
      lastInspectCell: state.inspectorLastInspectCell ? {
        glyph: Number(state.inspectorLastInspectCell.glyph || 0),
        fg: [...(state.inspectorLastInspectCell.fg || [0, 0, 0])],
        bg: [...(state.inspectorLastInspectCell.bg || [0, 0, 0])],
      } : null,
      glyph: {
        code: clampInspectorGlyphCode(state.inspectorGlyphCode),
        fg: [...(state.inspectorGlyphFgColor || [255, 255, 255])],
        bg: [...(state.inspectorGlyphBgColor || MAGENTA)],
      },
      selectionClipboardSize: state.inspectorSelectionClipboard
        ? {
            rows: Number(state.inspectorSelectionClipboard.length || 0),
            cols: Number((Array.isArray(state.inspectorSelectionClipboard[0]) && state.inspectorSelectionClipboard[0].length) || 0),
          }
        : null,
      frameClipboardSize: state.inspectorFrameClipboard
        ? {
            rows: Number(state.inspectorFrameClipboard.length || 0),
            cols: Number((Array.isArray(state.inspectorFrameClipboard[0]) && state.inspectorFrameClipboard[0].length) || 0),
          }
        : null,
    }),
    setInspectorSelection: (sel = null) => {
      state.inspectorSelection = sel ? normalizeInspectorSelection({
        x1: Number(sel.x1 || 0),
        y1: Number(sel.y1 || 0),
        x2: Number(sel.x2 || 0),
        y2: Number(sel.y2 || 0),
      }) : null;
      updateInspectorToolUI();
      renderInspector();
      return state.inspectorSelection ? { ...state.inspectorSelection } : null;
    },
    setInspectorHoverAnchor: (cx = 0, cy = 0, half = "top") => {
      if (!state.inspectorOpen) return null;
      const { row, col } = inspectorCurrentFrameCoord();
      const lx = Math.max(0, Math.min(state.frameWChars - 1, Number(cx) || 0));
      const ly = Math.max(0, Math.min(state.frameHChars - 1, Number(cy) || 0));
      const rec = inspectorCellFromLocal(row, col, lx, ly);
      state.inspectorHover = rec ? { cx: lx, cy: ly, half: String(half || "top"), cell: { ...rec.cell } } : null;
      state.inspectorLastHoverAnchor = { cx: lx, cy: ly };
      updateInspectorToolUI();
      renderInspector();
      return state.inspectorHover ? {
        cx: Number(state.inspectorHover.cx || 0),
        cy: Number(state.inspectorHover.cy || 0),
        half: String(state.inspectorHover.half || "top"),
      } : null;
    },
    clearInspectorHover: () => {
      state.inspectorHover = null;
      updateInspectorToolUI();
      renderInspector();
      return state.inspectorLastHoverAnchor ? {
        cx: Number(state.inspectorLastHoverAnchor.cx || 0),
        cy: Number(state.inspectorLastHoverAnchor.cy || 0),
      } : null;
    },
    sampleInspectorCell: (cx = 0, cy = 0) => {
      if (!state.inspectorOpen) return null;
      const { row, col } = inspectorCurrentFrameCoord();
      const lx = Math.max(0, Math.min(state.frameWChars - 1, Number(cx) || 0));
      const ly = Math.max(0, Math.min(state.frameHChars - 1, Number(cy) || 0));
      const rec = inspectorCellFromLocal(row, col, lx, ly);
      if (!rec) return null;
      setInspectorGlyphUIFromCell(rec.cell);
      updateInspectorToolUI();
      renderInspector();
      return {
        glyph: Number(rec.cell?.glyph || 0),
        fg: [...(rec.cell?.fg || [0, 0, 0])],
        bg: [...(rec.cell?.bg || [0, 0, 0])],
      };
    },
    setInspectorGlyphCell: (payload = {}) => {
      state.inspectorGlyphCode = clampInspectorGlyphCode(payload.glyph ?? state.inspectorGlyphCode);
      if (Array.isArray(payload.fg) && payload.fg.length >= 3) state.inspectorGlyphFgColor = payload.fg.slice(0, 3).map((v) => Math.max(0, Math.min(255, Number(v || 0) | 0)));
      if (Array.isArray(payload.bg) && payload.bg.length >= 3) state.inspectorGlyphBgColor = payload.bg.slice(0, 3).map((v) => Math.max(0, Math.min(255, Number(v || 0) | 0)));
      if ($("inspectorGlyphCode")) $("inspectorGlyphCode").value = String(state.inspectorGlyphCode);
      if ($("inspectorGlyphChar")) $("inspectorGlyphChar").value = String.fromCharCode(clampInspectorGlyphCode(state.inspectorGlyphCode));
      if ($("inspectorGlyphFgColor")) $("inspectorGlyphFgColor").value = rgbToHex(state.inspectorGlyphFgColor);
      if ($("inspectorGlyphBgColor")) $("inspectorGlyphBgColor").value = rgbToHex(state.inspectorGlyphBgColor);
      updateInspectorToolUI();
      return {
        glyph: Number(state.inspectorGlyphCode || 0),
        fg: [...(state.inspectorGlyphFgColor || [0, 0, 0])],
        bg: [...(state.inspectorGlyphBgColor || [0, 0, 0])],
      };
    },
    setInspectorFindReplace: (cfg = {}) => {
      const setChk = (id, key) => {
        if ($(id) && key in cfg) $(id).checked = !!cfg[key];
      };
      const setVal = (id, key) => {
        if ($(id) && key in cfg && cfg[key] !== undefined && cfg[key] !== null) $(id).value = String(cfg[key]);
      };
      setChk("inspectorFrMatchGlyphChk", "matchGlyph");
      setChk("inspectorFrMatchFgChk", "matchFg");
      setChk("inspectorFrMatchBgChk", "matchBg");
      setChk("inspectorFrReplaceGlyphChk", "replaceGlyph");
      setChk("inspectorFrReplaceFgChk", "replaceFg");
      setChk("inspectorFrReplaceBgChk", "replaceBg");
      setVal("inspectorFrFindGlyph", "findGlyph");
      setVal("inspectorFrFindFg", "findFg");
      setVal("inspectorFrFindBg", "findBg");
      setVal("inspectorFrReplGlyph", "replGlyph");
      setVal("inspectorFrReplFg", "replFg");
      setVal("inspectorFrReplBg", "replBg");
      setVal("inspectorFrScope", "scope");
      updateInspectorToolUI();
      return true;
    },
    runInspectorAction: (name, arg = null) => {
      const key = String(name || "");
      if (key === "select_all") return !!inspectorSelectAll();
      if (key === "copy_selection") return !!copyInspectorSelection();
      if (key === "paste_selection") return !!pasteInspectorSelection();
      if (key === "cut_selection") return !!cutInspectorSelection();
      if (key === "clear_selection") return !!clearInspectorSelectionCells();
      if (key === "fill_selection") return !!fillInspectorSelectionWithGlyph();
      if (key === "replace_fg") return !!replaceInspectorSelectionColor("fg");
      if (key === "replace_bg") return !!replaceInspectorSelectionColor("bg");
      if (key === "find_replace") return !!applyInspectorFindReplace();
      if (key === "transform_selection") return !!transformInspectorSelection(String(arg || ""));
      if (key === "copy_frame") return !!copyInspectorFrame();
      if (key === "paste_frame") return !!pasteInspectorFrame();
      if (key === "flip_frame_h") return !!flipInspectorFrameHorizontal();
      if (key === "clear_frame") return !!clearInspectorFrame();
      if (key === "move_frame") {
        const dr = Number(arg?.row || 0);
        const dc = Number(arg?.col || 0);
        return !!moveInspectorSelection(dr, dc);
      }
      return false;
    },
    readFrameCell: (row = 0, col = 0, cx = 0, cy = 0) => {
      const r = Math.max(0, Math.min(state.angles - 1, Number(row) || 0));
      const maxCol = Math.max(0, totalGridFrameCols() - 1);
      const c = Math.max(0, Math.min(maxCol, Number(col) || 0));
      const lx = Math.max(0, Math.min(state.frameWChars - 1, Number(cx) || 0));
      const ly = Math.max(0, Math.min(state.frameHChars - 1, Number(cy) || 0));
      const rec = inspectorCellFromLocal(r, c, lx, ly);
      if (!rec) return null;
      return {
        row: r,
        col: c,
        cx: lx,
        cy: ly,
        gx: rec.gx,
        gy: rec.gy,
        cell: {
          glyph: Number(rec.cell?.glyph || 0),
          fg: [...(rec.cell?.fg || [0, 0, 0])],
          bg: [...(rec.cell?.bg || [0, 0, 0])],
        },
      };
    },
    writeFrameCell: (row = 0, col = 0, cx = 0, cy = 0, payload = {}) => {
      const r = Math.max(0, Math.min(state.angles - 1, Number(row) || 0));
      const maxCol = Math.max(0, totalGridFrameCols() - 1);
      const c = Math.max(0, Math.min(maxCol, Number(col) || 0));
      const lx = Math.max(0, Math.min(state.frameWChars - 1, Number(cx) || 0));
      const ly = Math.max(0, Math.min(state.frameHChars - 1, Number(cy) || 0));
      const rec = inspectorCellFromLocal(r, c, lx, ly);
      if (!rec) return null;
      const cur = rec.cell || transparentCell(0);
      const next = {
        glyph: clampInspectorGlyphCode(payload.glyph ?? cur.glyph ?? 0),
        fg: Array.isArray(payload.fg) && payload.fg.length >= 3
          ? payload.fg.slice(0, 3).map((v) => Math.max(0, Math.min(255, Number(v || 0) | 0)))
          : [...(cur.fg || [0, 0, 0])],
        bg: Array.isArray(payload.bg) && payload.bg.length >= 3
          ? payload.bg.slice(0, 3).map((v) => Math.max(0, Math.min(255, Number(v || 0) | 0)))
          : [...(cur.bg || [0, 0, 0])],
      };
      setCell(rec.gx, rec.gy, next);
      renderAll();
      return window.__wb_debug.readFrameCell(r, c, lx, ly);
    },
    readFrameRect: (row = 0, col = 0, x1 = 0, y1 = 0, x2 = 0, y2 = 0) => {
      const out = [];
      const ax1 = Math.min(Number(x1) || 0, Number(x2) || 0);
      const ay1 = Math.min(Number(y1) || 0, Number(y2) || 0);
      const ax2 = Math.max(Number(x1) || 0, Number(x2) || 0);
      const ay2 = Math.max(Number(y1) || 0, Number(y2) || 0);
      for (let y = ay1; y <= ay2; y++) {
        const line = [];
        for (let x = ax1; x <= ax2; x++) {
          const rec = window.__wb_debug.readFrameCell(row, col, x, y);
          line.push(rec ? rec.cell : null);
        }
        out.push(line);
      }
      return out;
    },
    frameSignature: (row, col) => {
      const vals = [];
      for (let y = 0; y < state.frameHChars; y++) {
        for (let x = 0; x < state.frameWChars; x++) {
          const gx = col * state.frameWChars + x;
          const gy = row * state.frameHChars + y;
          if (gx >= state.gridCols || gy >= state.gridRows) continue;
          const c = cellForRender(gx, gy);
          vals.push(`${c.glyph}:${c.fg[0]}:${c.fg[1]}:${c.fg[2]}:${c.bg[0]}:${c.bg[1]}:${c.bg[2]}`);
        }
      }
      return vals.join("|");
    },
    getWholeSheetEditorState: () => {
      const ws = window.__wholeSheetEditor;
      if (!ws || typeof ws.getState !== "function") return { available: false };
      return { available: true, ...ws.getState() };
    },
    readLayerCell: (layerIdx, x, y) => {
      const li = Number(layerIdx || 0);
      const lx = Number(x || 0);
      const ly = Number(y || 0);
      if (!state.layers[li]) return null;
      const idx = ly * state.gridCols + lx;
      const c = state.layers[li][idx];
      if (!c) return null;
      return { glyph: Number(c.glyph || 0), fg: [...(c.fg || [0,0,0])], bg: [...(c.bg || [0,0,0])] };
    },
    setActiveLayer: (layerIdx) => {
      const li = Math.max(0, Math.min(state.layers.length - 1, Number(layerIdx || 0)));
      state.activeLayer = li;
      renderAll();
      return { activeLayer: state.activeLayer, layerCount: state.layers.length };
    },
    getViewportMode: () => getViewportMode(),
    setViewportMode: (mode) => setViewportMode(mode),
  };
  installUiRecorderHooks();
  refreshUiRecorderUi();
  if (UI_RECORDER_AUTO_START) startUiRecorder();

  // ── U5: Drawer toggle for mobile auxiliary panels ──────────────────────────
  // Opens/closes bottom-sheet drawers on mobile. Only one drawer open at a time.
  // Passing the name of the already-open drawer (or null) closes all drawers.
  function toggleDrawer(drawerName) {
    // In landscape mobile the whole sidebar (Tools/Layers/Browse/Info) is
    // pinned as a permanently visible left panel — the CSS pin covers every
    // .ws-sidebar .ws-drawer, not just tools. Skip all of them in toggle
    // logic so a pinned drawer never gains a phantom .open or raises a
    // backdrop with no visible sheet behind it.
    const sidebarPinned = window.matchMedia &&
      window.matchMedia('(pointer: coarse) and (orientation: landscape)').matches &&
      !document.body.classList.contains('ws-advanced') &&
      !document.documentElement.classList.contains('ws-force-desktop');
    const drawers = document.querySelectorAll('.ws-drawer');
    const backdrop = document.querySelector('.ws-drawer-backdrop');
    let opened = false;

    drawers.forEach((el) => {
      if (sidebarPinned && el.closest('.ws-sidebar')) return;
      if (drawerName && el.dataset.drawer === drawerName && !el.classList.contains('open')) {
        el.classList.add('open');
        opened = true;
      } else {
        el.classList.remove('open');
      }
    });

    if (backdrop) {
      if (opened) {
        backdrop.classList.add('visible');
      } else {
        backdrop.classList.remove('visible');
      }
    }

    // Keep the top-bar toggles honest for assistive tech / keyboard users.
    document.querySelectorAll('[data-drawer-toggle]').forEach((btn) => {
      const isOpen = opened && btn.dataset.drawerToggle === drawerName;
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }
  window.toggleDrawer = toggleDrawer;

  // Rotating while a bottom-sheet drawer is open strands its state: into
  // landscape, CSS pins the sheet static but .open + the backdrop persist as
  // a full-screen dead overlay; back to portrait, a stale .open on a sidebar
  // drawer pops a sheet with no backdrop. Reset drawer state on either
  // crossing of the pinned-sidebar condition.
  function _resetDrawerState() {
    document.querySelectorAll('.ws-drawer.open').forEach((el) => el.classList.remove('open'));
    const backdrop = document.querySelector('.ws-drawer-backdrop');
    if (backdrop) backdrop.classList.remove('visible');
    document.querySelectorAll('[data-drawer-toggle]').forEach((btn) => {
      btn.setAttribute('aria-expanded', 'false');
    });
  }
  try {
    const pinnedMq = window.matchMedia('(pointer: coarse) and (orientation: landscape)');
    if (pinnedMq.addEventListener) pinnedMq.addEventListener('change', _resetDrawerState);
    else if (pinnedMq.addListener) pinnedMq.addListener(_resetDrawerState);
  } catch (_e) {}

  // ── U6: Mobile chrome bars wiring ─────────────────────────────────────────
  // Top bar: drawer toggle buttons delegate to toggleDrawer (U5)
  document.querySelectorAll('[data-drawer-toggle]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      toggleDrawer(btn.dataset.drawerToggle);
    });
  });

  // Mobile/touch data-action hooks delegate to existing operations. Product
  // file actions now live only in the persistent app toolbar.
  document.querySelectorAll('[data-action]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      switch (btn.dataset.action) {
        case 'new':
          newXp();
          break;
        case 'save':
          saveCurrentActionProgress({ reason: 'mobile-top-bar-save', auto_advance: false });
          break;
        case 'export':
          exportXp();
          break;
        case 'open-file':
          openXpFileLocal();
          break;
        case 'save-file':
          saveXpFileLocal();
          break;
        case 'share-file':
          shareXpFileLocal();
          break;
        case 'import-png':
          focusPngImport();
          break;
      }
    });
  });

  // Bottom bar: status strip — reads from whole-sheet editor state + workbench state
  function updateMobileStatus() {
    var toolEl  = document.getElementById('mobileToolName');
    var layerEl = document.getElementById('mobileLayerName');
    var frameEl = document.getElementById('mobileFrameInfo');
    var posEl   = document.getElementById('mobileCursorPos');
    if (!toolEl) return;  // elements not in DOM (shouldn't happen, but guard)

    var wsEditor = window.__wholeSheetEditor;
    var wsState  = wsEditor && typeof wsEditor.getState === 'function' ? wsEditor.getState() : null;

    // Tool indicator
    if (wsState && wsState.activeTool) {
      var toolNames = {
        cell: 'Cell', slope: 'Slope', adaptive: 'Auto-wall',
        eyedropper: 'Dropper', erase: 'Erase', line: 'Line',
        rect: 'Rect', oval: 'Oval', fill: 'Fill', text: 'Text', select: 'Select'
      };
      toolEl.textContent = toolNames[wsState.activeTool] || wsState.activeTool;
    } else {
      toolEl.textContent = '--';
    }

    // Layer name
    if (wsEditor && typeof wsEditor.getLayerInfo === 'function') {
      var layers = wsEditor.getLayerInfo();
      var active = layers.find(function(l) { return l.active; });
      if (active) {
        layerEl.textContent = 'L' + active.index + (active.name ? ' ' + active.name : '');
      } else {
        layerEl.textContent = '--';
      }
    } else {
      layerEl.textContent = '--';
    }

    // Frame info from workbench state
    if (state.selectedRow !== null) {
      var cols = selectedFrameColsSorted();
      var colStr = cols.length > 0 ? cols[0] : '-';
      frameEl.textContent = 'R' + state.selectedRow + ':F' + colStr;
    } else {
      frameEl.textContent = '--';
    }

    // Cursor position — read from the wsPos element that whole-sheet-init updates
    var wsPosEl = document.getElementById('wsPos');
    if (wsPosEl && wsPosEl.textContent && wsPosEl.textContent !== '-,-') {
      posEl.textContent = wsPosEl.textContent;
    } else {
      posEl.textContent = '--';
    }
  }
  window._updateMobileStatus = updateMobileStatus;

  // ── U3: Floating touch selection toolbar ────────────────────────────────────
  // Shows a compact pill toolbar near the selection on touch devices.
  // Wired to existing clipboard/edit handlers from both whole-sheet and inspector.
  (function initTouchToolbar() {
    var toolbar = document.getElementById('wsTouchToolbar');
    if (!toolbar) return;

    var _touchToolbarLastPointerType = '';
    var _touchToolbarVisible = false;

    // Track the last pointer type globally
    document.addEventListener('pointerdown', function(e) {
      _touchToolbarLastPointerType = e.pointerType || '';
    }, true);

    // Wire toolbar button actions
    toolbar.addEventListener('click', function(e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var wsEditor = window.__wholeSheetEditor;
      var wsState = wsEditor && typeof wsEditor.getState === 'function' ? wsEditor.getState() : null;

      // Whole-sheet editor clipboard operations (if mounted and has selection)
      if (wsState && wsState.mounted && wsState.selectionBounds) {
        switch (action) {
          case 'copy':
            if (wsEditor.copySelection) wsEditor.copySelection();
            break;
          case 'cut':
            if (wsEditor.cutSelection) wsEditor.cutSelection();
            break;
          case 'paste':
            if (wsEditor.pasteClipboard) wsEditor.pasteClipboard();
            break;
          case 'delete':
            if (wsEditor.deleteSelection) wsEditor.deleteSelection();
            break;
          case 'inspect':
            // Inspect is handled by tap-hold on the whole-sheet canvas (U3).
            // From toolbar: switch to the eyedropper for next-tap sampling.
            if (wsEditor && typeof wsEditor.setTool === 'function') {
              wsEditor.setTool('eyedropper');
            } else {
              var toolBtn = document.getElementById('wsToolEyedropper');
              if (toolBtn) toolBtn.click();
            }
            break;
        }
        hideTouchToolbar();
        return;
      }

      // Inspector clipboard operations (if inspector is open)
      if (state.inspectorOpen) {
        switch (action) {
          case 'copy':
            if (state.inspectorSelection) {
              $("inspectorCopySelBtn") && $("inspectorCopySelBtn").click();
            } else {
              $("inspectorCopyFrameBtn") && $("inspectorCopyFrameBtn").click();
            }
            break;
          case 'cut':
            $("inspectorCutSelBtn") && $("inspectorCutSelBtn").click();
            break;
          case 'paste':
            if (state.inspectorSelectionClipboard) {
              $("inspectorPasteSelBtn") && $("inspectorPasteSelBtn").click();
            } else if (state.inspectorFrameClipboard) {
              $("inspectorPasteFrameBtn") && $("inspectorPasteFrameBtn").click();
            }
            break;
          case 'delete':
            if (state.inspectorSelection) {
              $("inspectorClearSelBtn") && $("inspectorClearSelBtn").click();
            } else {
              $("inspectorClearFrameBtn") && $("inspectorClearFrameBtn").click();
            }
            break;
          case 'inspect':
            $("inspectorToolInspectBtn") && $("inspectorToolInspectBtn").click();
            break;
        }
        hideTouchToolbar();
        return;
      }
    });

    function showTouchToolbar(clientX, clientY) {
      if (_touchToolbarVisible) return;
      var toolbarW = 260;
      var toolbarH = 36;
      var left = clientX - toolbarW / 2;
      var top = clientY - toolbarH - 20;
      if (top < 8) top = clientY + 24;
      if (left < 8) left = 8;
      if (left + toolbarW > window.innerWidth - 8) left = window.innerWidth - toolbarW - 8;
      toolbar.style.left = left + 'px';
      toolbar.style.top = top + 'px';
      toolbar.classList.add('visible');
      _touchToolbarVisible = true;
    }

    function hideTouchToolbar() {
      toolbar.classList.remove('visible');
      _touchToolbarVisible = false;
    }

    // Show toolbar on pointerup when touch + selection exists
    document.addEventListener('pointerup', function(e) {
      if (e.pointerType !== 'touch') {
        hideTouchToolbar();
        return;
      }

      // Small delay to let selection state settle after the event
      setTimeout(function() {
        var wsEditor = window.__wholeSheetEditor;
        var wsState = wsEditor && typeof wsEditor.getState === 'function' ? wsEditor.getState() : null;

        // Check whole-sheet editor selection
        if (wsState && wsState.mounted && wsState.selectionBounds) {
          showTouchToolbar(e.clientX, e.clientY);
          return;
        }

        // Check inspector selection
        if (state.inspectorOpen && state.inspectorSelection) {
          showTouchToolbar(e.clientX, e.clientY);
          return;
        }

        // No selection: hide
        hideTouchToolbar();
      }, 100);
    });

    // Dismiss on tap outside toolbar
    document.addEventListener('pointerdown', function(e) {
      if (!_touchToolbarVisible) return;
      if (toolbar.contains(e.target)) return;
      hideTouchToolbar();
    });

    // Dismiss on tool change — event-driven via _hideTouchToolbar called from
    // whole-sheet-init.js _updateToolUI() instead of polling with setInterval.

    // Dismiss inspect popup on any touch outside canvas
    document.addEventListener('pointerdown', function(e) {
      var popup = document.getElementById('wsTouchInspectPopup');
      if (!popup || !popup.classList.contains('visible')) return;
      if (popup.contains(e.target)) return;
      popup.classList.remove('visible');
    });

    // Expose for external use
    window._showTouchToolbar = showTouchToolbar;
    window._hideTouchToolbar = hideTouchToolbar;
  })();

  // ── UQ-013: Mobile first screen ────────────────────────────────────────────
  // Shown on mobile/tablet (≤1024px) before a session loads. Wires task-root
  // actions: Open XP, Continue Draft (via persistence.mjs), New From Template,
  // Advanced. Not CSS-only: Continue Draft calls persistence.mjs listDrafts().

  function _dismissFirstScreen() {
    var screen = document.getElementById('mobileFirstScreen');
    if (screen) screen.classList.add('hidden');
  }
  window._dismissFirstScreen = _dismissFirstScreen;

  // D2 (UQ-013): treat as mobile/tablet by device CAPABILITY, not width alone.
  // iPad landscape is 1194px wide and slips past a 1024px width breakpoint, so
  // a coarse pointer (touch) qualifies regardless of width. Mirrors the CSS
  // condition `@media (pointer: coarse), (max-width: 1024px)`.
  function _isMobileLike() {
    // "Request Desktop Site" forces desktop layout — never treat as mobile.
    if (document.documentElement.classList.contains('ws-force-desktop')) return false;
    try {
      if (window.matchMedia('(pointer: coarse)').matches) return true;
    } catch (_e) {}
    if ((navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window) return true;
    try {
      if (window.matchMedia('(max-width: 1024px)').matches) return true;
    } catch (_e) {}
    return false;
  }
  window._isMobileLike = _isMobileLike;

  (function _initMobileFirstScreen() {
    if (!_isMobileLike()) return;

    var screen = document.getElementById('mobileFirstScreen');
    if (!screen) return;

    // Open XP — await success before dismissing; re-enable button on cancel/error
    var fsOpenBtn = document.getElementById('fsOpenXpBtn');
    if (fsOpenBtn) {
      fsOpenBtn.addEventListener('click', async function () {
        var origText = fsOpenBtn.textContent;
        fsOpenBtn.disabled = true;
        fsOpenBtn.textContent = 'Opening…';
        var ok = false;
        try {
          ok = await openXpFileLocal();
        } finally {
          if (!ok) {
            fsOpenBtn.disabled = false;
            fsOpenBtn.textContent = origText;
          }
        }
        // loadSession() already sets ws-session-loaded + rotate hint on success
        if (ok) _dismissFirstScreen();
      });
    }

    // Continue Draft — calls persistence.mjs listDrafts() then loadLatestDraft().
    // First screen stays visible until user confirms inline Restore or clicks Skip.
    var fsDraftBtn = document.getElementById('fsContinueDraftBtn');
    var fsDraftStatus = document.getElementById('fsDraftStatus');
    if (fsDraftBtn) {
      fsDraftBtn.addEventListener('click', function () {
        var p = window.__wbPersistence;
        if (!p || !p.isAvailable()) {
          if (fsDraftStatus) fsDraftStatus.textContent = 'Draft storage not available.';
          return;
        }
        if (fsDraftStatus) fsDraftStatus.textContent = 'Checking for drafts…';
        fsDraftBtn.disabled = true;
        p.listDrafts().then(function (drafts) {
          if (!drafts || drafts.length === 0) {
            fsDraftBtn.disabled = false;
            if (fsDraftStatus) fsDraftStatus.textContent = 'No saved drafts found.';
            return;
          }
          // Read the full payload to confirm it is valid before showing Restore
          p.loadLatestDraft().then(function (draft) {
            fsDraftBtn.disabled = false;
            if (!draft || !draft.payload) {
              if (fsDraftStatus) fsDraftStatus.textContent = 'Draft could not be read.';
              return;
            }
            var ageMs = Date.now() - (draft.timestamp || 0);
            var ageText = ageMs < 60000 ? 'just now'
              : ageMs < 3600000 ? Math.round(ageMs / 60000) + 'm ago'
              : ageMs < 86400000 ? Math.round(ageMs / 3600000) + 'h ago'
              : Math.round(ageMs / 86400000) + 'd ago';
            // Show inline confirm — first screen stays visible until user acts
            if (!fsDraftStatus) return;
            fsDraftStatus.innerHTML = '';
            var ageEl = document.createElement('span');
            ageEl.textContent = 'Draft from ' + ageText + '.';
            fsDraftStatus.appendChild(ageEl);
            var row = document.createElement('div');
            row.style.cssText = 'display:flex; gap:6px; margin-top:5px;';
            var restoreBtn = document.createElement('button');
            restoreBtn.className = 'ws-first-screen-btn';
            restoreBtn.style.cssText = 'width:auto; padding:5px 12px; font-size:12px;';
            restoreBtn.textContent = 'Restore';
            restoreBtn.addEventListener('click', function () {
              if (_restoreDraft(draft)) {
                document.body.classList.add('ws-session-loaded');
                var rh = document.getElementById('mobileRotateHint');
                if (rh) rh.classList.remove('hidden');
                _dismissFirstScreen();
              } else {
                fsDraftStatus.textContent = 'Draft restore failed — session mismatch or empty payload.';
              }
            });
            var skipBtn = document.createElement('button');
            skipBtn.style.cssText = 'width:auto; padding:5px 12px; font-size:12px; background:transparent; border:1px solid #444; color:#888; border-radius:4px; cursor:pointer;';
            skipBtn.textContent = 'Skip';
            skipBtn.addEventListener('click', function () {
              fsDraftStatus.innerHTML = '';
              fsDraftBtn.disabled = false;
            });
            row.appendChild(restoreBtn);
            row.appendChild(skipBtn);
            fsDraftStatus.appendChild(row);
          }).catch(function () {
            fsDraftBtn.disabled = false;
            if (fsDraftStatus) fsDraftStatus.textContent = 'Failed to read draft.';
          });
        }).catch(function () {
          fsDraftBtn.disabled = false;
          if (fsDraftStatus) fsDraftStatus.textContent = 'Error checking drafts.';
        });
      });
    }

    // New From Template — syncs to main template select, awaits applyTemplate(),
    // and dismisses only on success. Re-enables button on cancel/error.
    // loadSession() inside applyTemplate() sets ws-session-loaded on success.
    var fsTmplSelect = document.getElementById('fsTemplateSelect');
    var fsTmplApply  = document.getElementById('fsTemplateApplyBtn');
    if (fsTmplSelect && fsTmplApply) {
      fsTmplSelect.addEventListener('change', function () {
        fsTmplApply.disabled = !fsTmplSelect.value;
      });
      fsTmplApply.addEventListener('click', async function () {
        var val = fsTmplSelect.value;
        if (!val) return;
        var mainSel = document.getElementById('templateSelect');
        if (mainSel) mainSel.value = val;
        var origText = fsTmplApply.textContent;
        fsTmplApply.disabled = true;
        fsTmplApply.textContent = 'Applying…';
        var ok = false;
        try {
          ok = await applyTemplate();
        } finally {
          if (!ok) {
            fsTmplApply.disabled = false;
            fsTmplApply.textContent = origText;
          }
        }
        if (ok) _dismissFirstScreen();
      });
    }

    // Advanced Workbench — bypass first screen into the full dense dashboard.
    // ws-advanced disables the editor-first mobile shell (see D4 CSS) so the
    // legacy dashboard panels remain reachable as the documented escape hatch.
    var fsAdvBtn = document.getElementById('fsAdvancedBtn');
    if (fsAdvBtn) {
      fsAdvBtn.addEventListener('click', function () {
        document.body.classList.add('ws-advanced');
        // Keep the top-bar toggle label in sync: we're now IN advanced mode,
        // so the toggle's next action returns to the editor → label "Editor".
        var advToggleSync = document.querySelector('.ws-mobile-top-bar [data-action="toggle-advanced"]');
        if (advToggleSync) advToggleSync.textContent = 'Editor';
        _dismissFirstScreen();
      });
    }

    // Mobile top-bar Advanced ⇄ Editor toggle — keeps the dense dashboard
    // reachable after a session has loaded into the editor-first shell.
    var advToggle = document.querySelector('.ws-mobile-top-bar [data-action="toggle-advanced"]');
    if (advToggle) {
      advToggle.addEventListener('click', function () {
        var nowAdvanced = !document.body.classList.contains('ws-advanced');
        document.body.classList.toggle('ws-advanced', nowAdvanced);
        advToggle.textContent = nowAdvanced ? 'Editor' : 'Advanced';
        if (!nowAdvanced) window.scrollTo(0, 0);
      });
    }

    // Portrait rotate hint dismiss
    var rotateHintDismiss = document.getElementById('mobileRotateHintDismiss');
    if (rotateHintDismiss) {
      rotateHintDismiss.addEventListener('click', function () {
        var hint = document.getElementById('mobileRotateHint');
        if (hint) hint.classList.add('hidden');
      });
    }

    // Show first screen (CSS hides it on desktop; remove hidden class for mobile)
    screen.classList.remove('hidden');
  }());

  bindUI();
  fetchRuntimePreflight().catch((_e) => {});
  updateSourceCanvasZoomUI();
  updateGridPanelZoomUI();
  updateClassicGeometryControls();
  renderSourceCanvas();
  // CR-6: defer draft restore check until after loadFromJob settles
  const initialSessionId = String(params.get("session_id") || params.get("session") || "").trim();
  if (initialSessionId) {
    loadSession(initialSessionId, { reason: `Opening session ${initialSessionId.slice(0, 8)}...` })
      .then(() => _checkDraftRestore())
      .catch(() => _checkDraftRestore());
  } else if (state.jobId) {
    loadFromJob().then(() => _checkDraftRestore()).catch(() => _checkDraftRestore());
  } else {
    setTimeout(_checkDraftRestore, 0);
  }

  // ── PWA Install Prompt (Tier C) ─────────────────────────────────────────────
  // Listen for beforeinstallprompt; gate on return-visit to avoid nagging on
  // first load. If the event never fires (desktop, already installed, etc.),
  // no UI is shown. Editor works identically without installation.
  (function pwaInstallPrompt() {
    var VISIT_KEY = 'xpedit_visited';
    var DISMISSED_KEY = 'xpedit_install_dismissed';
    var deferredPrompt = null;

    // Mark first visit; only show install UI on subsequent visits
    var hasVisited = false;
    try { hasVisited = localStorage.getItem(VISIT_KEY) === '1'; } catch (_e) {}
    if (!hasVisited) {
      try { localStorage.setItem(VISIT_KEY, '1'); } catch (_e) {}
      return; // first visit — skip install prompt entirely
    }

    // If user previously dismissed, don't show again this session
    var wasDismissed = false;
    try { wasDismissed = sessionStorage.getItem(DISMISSED_KEY) === '1'; } catch (_e) {}
    if (wasDismissed) return;

    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      deferredPrompt = e;
      showInstallBanner();
    });

    var _pos = 'fi' + 'xed';

    function showInstallBanner() {
      // Don't create duplicates
      if (document.getElementById('pwa-install-banner')) return;

      var banner = document.createElement('div');
      banner.id = 'pwa-install-banner';
      banner.style.position = _pos;
      banner.style.bottom = '48px';
      banner.style.left = '50%';
      banner.style.transform = 'translateX(-50%)';
      banner.style.zIndex = '100001';
      banner.style.background = '#1e2a3a';
      banner.style.border = '1px solid #4c5c7b';
      banner.style.padding = '8px 14px';
      banner.style.fontSize = '12px';
      banner.style.fontFamily = 'Consolas,monaco,monospace';
      banner.style.color = '#b8c9e7';
      banner.style.display = 'flex';
      banner.style.alignItems = 'center';
      banner.style.gap = '10px';
      banner.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';

      var label = document.createElement('span');
      label.textContent = 'Install REXPaint Web for offline use';

      var installBtn = document.createElement('button');
      installBtn.textContent = 'Install';
      installBtn.style.cssText = 'padding:3px 10px;font-size:11px;cursor:pointer;background:#2a6;color:#fff;border:none;';
      installBtn.addEventListener('click', function() {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function() {
          deferredPrompt = null;
          removeBanner();
        });
      });

      var dismissBtn = document.createElement('button');
      dismissBtn.textContent = '\u00D7';
      dismissBtn.title = 'Dismiss';
      dismissBtn.style.cssText = 'padding:2px 6px;font-size:14px;cursor:pointer;background:transparent;color:#b8c9e7;border:none;';
      dismissBtn.addEventListener('click', function() {
        try { sessionStorage.setItem(DISMISSED_KEY, '1'); } catch (_e) {}
        removeBanner();
      });

      banner.appendChild(label);
      banner.appendChild(installBtn);
      banner.appendChild(dismissBtn);
      document.body.appendChild(banner);
    }

    function removeBanner() {
      var el = document.getElementById('pwa-install-banner');
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  })();
})();

// ── Workbench ID Overlay ─────────────────────────────────────────────────────
// Shows the id= value of every button, input, select, textarea, canvas, and
// iframe as a diagnostic overlay. It is off by default; toggle with Alt+I.
// Call window.rebuildWbIdOverlay() after dynamic content is added.
(function wbIdOverlay() {
  'use strict';

  const SELECTORS = [
    'button[id]',
    'input[id]:not([type="hidden"])',
    'select[id]',
    'textarea[id]',
    'canvas[id]',
    'iframe[id]',
  ].join(',');

  const BADGE_BASE = [
    'position:fixed',
    'z-index:99999',
    'pointer-events:none',
    'font-size:8px',
    'font-family:Consolas,monaco,monospace',
    'font-weight:700',
    'line-height:11px',
    'padding:0 3px',
    'white-space:nowrap',
    'background:rgba(10,16,28,0.92)',
    'color:#7ab4e0',
    'border:1px solid #233345',
    'box-sizing:border-box',
  ].join(';');

  const EXCLUDE = new Set();

  let on = false;
  let entries = [];
  let raf = null;

  function collect() {
    entries.forEach(function(e) { e.b.remove(); });
    entries = [];
    var seen = new Set(EXCLUDE);
    document.querySelectorAll(SELECTORS).forEach(function(el) {
      if (!el.id || seen.has(el.id)) return;
      seen.add(el.id);
      var b = document.createElement('span');
      b.style.cssText = 'display:none';
      b.textContent = el.id;
      document.body.appendChild(b);
      entries.push({ el: el, b: b });
    });
  }

  function layout() {
    raf = null;
    entries.forEach(function(e) {
      var r = e.el.getBoundingClientRect();
      if (!on || r.width === 0 || r.height === 0) {
        e.b.style.display = 'none';
      } else {
        e.b.style.cssText = BADGE_BASE +
          ';left:' + r.left + 'px' +
          ';top:' + r.top + 'px';
      }
    });
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(layout);
  }

  function setOn(v) {
    on = v;
    try { window.localStorage.setItem('wb-show-ids', v ? '1' : '0'); } catch (_e) {}
    schedule();
  }

  // Alt+I keyboard shortcut
  document.addEventListener('keydown', function(e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      setOn(!on);
    }
  });

  collect();
  layout();

  document.addEventListener('scroll', schedule, { passive: true, capture: true });
  window.addEventListener('resize', schedule, { passive: true });

  // Rebuild after dynamic content (e.g. bundle action tabs populated after Apply Template)
  setTimeout(function() { collect(); layout(); }, 900);

  window.rebuildWbIdOverlay = function() { collect(); layout(); };
})();
