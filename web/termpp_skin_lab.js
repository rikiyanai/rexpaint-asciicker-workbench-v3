(() => {
  "use strict";

  function _resolveWorkbenchBasePath(pathname, injectedBasePath) {
    const injected = String(injectedBasePath || "").trim();
    if (injected) return injected;
    const path = String(pathname || "");
    const markers = ["/termpp-web-flat", "/termpp-web", "/termpp-skin-lab", "/workbench", "/wizard"];
    for (const marker of markers) {
      const idx = path.indexOf(marker);
      if (idx >= 0) return path.slice(0, idx);
    }
    return "";
  }

  const BASE_PATH = _resolveWorkbenchBasePath(window.location?.pathname, window.__WB_BASE_PATH);
  function bp(path) {
    return `${BASE_PATH}${path}`;
  }

  // Override-name generation: derives per-prefix W range from registry prefix_catalog.ahsw_range.
  function _ahswNamesFromPrefixCatalog(prefixCatalog, prefixes) {
    const out = [];
    for (const prefix of prefixes) {
      const spec = prefixCatalog[prefix];
      const range = spec && spec.ahsw_range;
      const wRange = range === "weapon_gte_1" ? [1, 2] : [0, 1, 2];
      if (range === "all_16" && prefix === "player") out.push("player-nude.xp");
      for (let a = 0; a < 2; a++)
        for (let h = 0; h < 2; h++)
          for (let s = 0; s < 2; s++)
            for (const w of wRange)
              out.push(`${prefix}-${a}${h}${s}${w}.xp`);
    }
    return out;
  }

  const DEFAULT_OVERRIDE_SETS = {
    player_common: [], // populated from registry during init; empty if unavailable
    single_player_nude: ["player-nude.xp"],
    all_visible_test: [
      "player-nude.xp",
      "player-0000.xp",
      "attack-0000.xp",
      "plydie-0000.xp",
      "wolfie-0000.xp",
      "wolack-0000.xp",
    ],
  };
  let _playerCommonLoadError = "";

  async function _initPlayerCommonOverrides() {
    const allPrefixes = ["player", "attack", "plydie", "wolfie", "wolack"];
    _playerCommonLoadError = "";
    try {
      const r = await fetch(bp("/api/workbench/templates"));
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      const reg = await r.json();
      const pc = reg && reg.prefix_catalog;
      if (!pc || typeof pc !== "object") {
        throw new Error("missing prefix_catalog");
      }
      const prefixes = allPrefixes.filter((p) => pc[p] && pc[p].ahsw_range);
      DEFAULT_OVERRIDE_SETS.player_common = _ahswNamesFromPrefixCatalog(pc, prefixes);
    } catch (e) {
      DEFAULT_OVERRIDE_SETS.player_common = [];
      _playerCommonLoadError = `Template registry unavailable: ${e?.message || "network error"}`;
    }
  }

  const state = {
    webbuildLoaded: false,
    webbuildReady: false,
    readyPoll: null,
    lastXpBytes: null,
    lastXpName: "",
  };

  const $ = (id) => document.getElementById(id);

  function setStatus(text, cls) {
    const el = $("statusLine");
    if (!el) return;
    el.className = `small ${cls || ""}`.trim();
    el.textContent = text;
  }

  function setWebbuildState(text, cls) {
    const el = $("webbuildState");
    if (!el) return;
    el.className = `small ${cls || ""}`.trim();
    el.textContent = text;
  }

  function out(obj) {
    const el = $("out");
    if (!el) return;
    if (typeof obj === "string") el.textContent = obj;
    else el.textContent = JSON.stringify(obj, null, 2);
  }

  function frameWin() {
    const f = $("gameFrame");
    return f && f.contentWindow ? f.contentWindow : null;
  }

  function selectedOverrideNames() {
    const mode = String($("overrideMode")?.value || "player_common");
    const names = DEFAULT_OVERRIDE_SETS[mode];
    return Array.isArray(names) ? [...names] : [];
  }

  function renderOverrideNames() {
    const box = $("overrideNames");
    if (!box) return;
    box.innerHTML = "";
    for (const n of selectedOverrideNames()) {
      const span = document.createElement("span");
      span.className = "pill";
      span.textContent = n;
      box.appendChild(span);
    }
  }

  function stopReadyPoll() {
    if (state.readyPoll) {
      clearInterval(state.readyPoll);
      state.readyPoll = null;
    }
  }

  function updateButtons() {
    const hasXp = !!(state.lastXpBytes && state.lastXpBytes.length);
    const hasOverrides = selectedOverrideNames().length > 0;
    $("applyBtn").disabled = !(hasXp && state.webbuildReady && hasOverrides);
    $("reapplyBtn").disabled = !(hasXp && state.webbuildReady && hasOverrides);
    $("startBtn").disabled = !state.webbuildReady;
  }

  function detectWebbuildReady() {
    const win = frameWin();
    if (!win) return false;
    try {
      const ready = !!(
        win.Module &&
        win.Module.calledRun &&
        typeof win.Module.FS_createDataFile === "function" &&
        typeof win.Module.FS_unlink === "function" &&
        typeof win.Load === "function"
      );
      state.webbuildReady = ready;
      updateButtons();
      if (ready) {
        setWebbuildState("Webbuild ready", "ok");
        setStatus("Webbuild runtime is ready for XP injection", "ok");
        stopReadyPoll();
      } else {
        setWebbuildState("Webbuild loading...", "warn");
      }
      return ready;
    } catch (e) {
      state.webbuildReady = false;
      updateButtons();
      setWebbuildState(`Iframe access error: ${String(e)}`, "err");
      return false;
    }
  }

  function openWebbuild() {
    const f = $("gameFrame");
    if (!f) return;
    const src = String($("webbuildPath")?.value || "./termpp-web/index.html?solo=1&player=player").trim();
    state.webbuildLoaded = true;
    state.webbuildReady = false;
    updateButtons();
    setWebbuildState("Opening webbuild...", "warn");
    setStatus("Loading webbuild iframe...", "warn");
    stopReadyPoll();
    f.src = src;
    state.readyPoll = setInterval(detectWebbuildReady, 500);
    out({ action: "open_webbuild", src });
  }

  function reloadWebbuild() {
    const f = $("gameFrame");
    if (!f) return;
    state.webbuildReady = false;
    updateButtons();
    setWebbuildState("Reloading webbuild...", "warn");
    setStatus("Reloading webbuild iframe...", "warn");
    stopReadyPoll();
    try {
      if (f.contentWindow && f.contentWindow.location) f.contentWindow.location.reload();
      else openWebbuild();
    } catch (_e) {
      openWebbuild();
    }
    state.readyPoll = setInterval(detectWebbuildReady, 500);
  }

  function autoStartGameIfNeeded() {
    const win = frameWin();
    if (!win) throw new Error("iframe not available");
    const playerName = String($("playerName")?.value || "player").trim() || "player";
    try {
      const d = win.document;
      const overlay = d && d.getElementById ? d.getElementById("login-overlay") : null;
      const overlayVisible = !!(overlay && overlay.style && overlay.style.display !== "none");
      if (!overlayVisible) return { started: false, reason: "overlay_hidden" };
      const playerInput = d.getElementById("player-name");
      const serverInput = d.getElementById("server-addr");
      const playBtn = d.getElementById("play-btn");
      if (playerInput) playerInput.value = playerName;
      if (serverInput) serverInput.value = "";
      if (playBtn) playBtn.disabled = false;
      if (typeof win.StartGame !== "function") return { started: false, reason: "StartGame_missing" };
      const startRes = win.StartGame();
      if (startRes && typeof startRes.then === "function") {
        startRes.catch((e) => {
          try { console.warn("[termpp_skin_lab] StartGame rejected:", e); } catch (_e2) {}
        });
      }
      return { started: true };
    } catch (e) {
      return { started: false, reason: String(e) };
    }
  }

  function startGame() {
    if (!detectWebbuildReady()) {
      setStatus("Webbuild is not ready yet", "warn");
      return;
    }
    const res = autoStartGameIfNeeded();
    if (res.started) setStatus("Started webbuild game", "ok");
    else setStatus(`Start game skipped (${res.reason})`, "warn");
    out({ action: "start_game", result: res });
  }

  function ensureSpritesDir(M) {
    if (typeof M.FS_createPath === "function") {
      try { M.FS_createPath("/", "assets", true, true); } catch (_e) {}
      try { M.FS_createPath("/assets", "sprites", true, true); } catch (_e) {}
    }
  }

  function emfsReplaceFile(M, absPath, bytes) {
    const path = String(absPath || "");
    if (!path.startsWith("/")) throw new Error(`invalid emfs path: ${path}`);
    const slash = path.lastIndexOf("/");
    const dir = slash > 0 ? path.slice(0, slash) : "/";
    const name = path.slice(slash + 1);
    if (!name) throw new Error(`invalid emfs filename: ${path}`);
    const FS = M && M.FS;
    if (FS && typeof FS.writeFile === "function") {
      try {
        FS.writeFile(path, bytes, { canOwn: true });
        return { mode: "writeFile" };
      } catch (_e) {}
    }
    try { M.FS_unlink(path); } catch (_e) {}
    M.FS_createDataFile(dir, name, bytes, true, true, true);
    return { mode: "createDataFile" };
  }

  async function injectXpBytes(xpBytes) {
    if (!xpBytes || !xpBytes.length) throw new Error("No XP bytes loaded");
    const win = frameWin();
    if (!win || !win.Module) throw new Error("Webbuild iframe not ready");
    const M = win.Module;
    if (win.__termppFlatMap && typeof win.__termppFlatMap.apply === "function") {
      try { await win.__termppFlatMap.apply(true); } catch (_e) {}
    }
    ensureSpritesDir(M);
    const names = selectedOverrideNames();
    if (!names.length) {
      throw new Error(_playerCommonLoadError || "Override names unavailable");
    }
    let fsWriteMode = "";
    for (const name of names) {
      const res = emfsReplaceFile(M, `/assets/sprites/${name}`, xpBytes);
      if (!fsWriteMode && res && res.mode) fsWriteMode = String(res.mode);
    }
    const playerName = String($("playerName")?.value || "player").trim() || "player";
    let startInfo = { started: false, reason: "auto_start_disabled" };
    if ($("autoStartChk")?.checked) {
      startInfo = autoStartGameIfNeeded();
    }
    if (!startInfo.started) {
      if (typeof win.Load === "function") win.Load(playerName);
      if (typeof win.Resize === "function") {
        try { win.Resize(null); } catch (_e) {}
      }
    }
    try { win.ak_canvas?.focus?.(); } catch (_e) {}
    return { files_written: names.length, bytes: xpBytes.length, fs_write_mode: fsWriteMode || "unknown", player_name: playerName, override_names: names, started_via: startInfo.started ? "start_game" : "load", start_info: startInfo };
  }

  async function applyLoadedXp() {
    if (!state.lastXpBytes || !state.lastXpBytes.length) {
      setStatus("Choose an .xp file first", "warn");
      return;
    }
    if (!detectWebbuildReady()) {
      setStatus("Open the webbuild and wait for 'Webbuild ready'", "warn");
      return;
    }
    try {
      const info = await injectXpBytes(state.lastXpBytes);
      setStatus(`Applied ${state.lastXpName || "XP"} to webbuild`, "ok");
      out({ action: "apply_xp", file: state.lastXpName, ...info });
    } catch (e) {
      setStatus(`XP apply failed: ${String(e)}`, "err");
      out({ action: "apply_xp", error: String(e) });
    }
  }

  function setLoadedXp(fileName, bytes) {
    state.lastXpName = String(fileName || "");
    state.lastXpBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    updateButtons();
    setStatus(`Loaded XP file: ${state.lastXpName || "(unnamed)"} (${state.lastXpBytes.length} bytes)`, "ok");
    out({ action: "load_xp", file: state.lastXpName, size_bytes: state.lastXpBytes.length });
  }

  async function loadFile(file) {
    if (!file) return;
    const ab = await file.arrayBuffer();
    setLoadedXp(file.name || "upload.xp", new Uint8Array(ab));
  }

  function attachDnD() {
    const zone = $("dropZone");
    if (!zone) return;
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    ["dragenter", "dragover", "dragleave", "drop"].forEach((ev) => {
      zone.addEventListener(ev, stop);
    });
    ["dragenter", "dragover"].forEach((ev) => {
      zone.addEventListener(ev, () => zone.classList.add("dragover"));
    });
    ["dragleave", "drop"].forEach((ev) => {
      zone.addEventListener(ev, () => zone.classList.remove("dragover"));
    });
    zone.addEventListener("drop", async (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      try {
        await loadFile(file);
      } catch (err) {
        setStatus(`Failed to load dropped file: ${String(err)}`, "err");
      }
    });
  }

  function runtimeInfo() {
    const win = frameWin();
    if (!win) {
      out({ error: "iframe not loaded" });
      return;
    }
    try {
      const info = {
        hasModule: !!win.Module,
        calledRun: !!win.Module?.calledRun,
        hasLoad: typeof win.Load === "function",
        hasResize: typeof win.Resize === "function",
        hasStartGame: typeof win.StartGame === "function",
        hasFSCreateDataFile: typeof win.Module?.FS_createDataFile === "function",
        hasFSUnlink: typeof win.Module?.FS_unlink === "function",
        currentSrc: $("gameFrame")?.src || "",
        playerName: $("playerName")?.value || "",
        overrideCount: selectedOverrideNames().length,
        lastXpName: state.lastXpName,
        lastXpBytes: state.lastXpBytes ? state.lastXpBytes.length : 0,
      };
      out(info);
      setStatus("Runtime info captured", "ok");
    } catch (e) {
      out({ error: String(e) });
      setStatus("Runtime info failed", "err");
    }
  }

  async function init() {
    await _initPlayerCommonOverrides();
    renderOverrideNames();
    attachDnD();
    updateButtons();
    if (_playerCommonLoadError) {
      setStatus(_playerCommonLoadError, "warn");
    }
    out({ ready: true, note: "Open the webbuild, then upload an .xp and click Apply Uploaded XP." });

    $("overrideMode")?.addEventListener("change", () => {
      renderOverrideNames();
      updateButtons();
    });
    $("openBtn")?.addEventListener("click", openWebbuild);
    $("reloadBtn")?.addEventListener("click", reloadWebbuild);
    $("startBtn")?.addEventListener("click", startGame);
    $("applyBtn")?.addEventListener("click", applyLoadedXp);
    $("reapplyBtn")?.addEventListener("click", applyLoadedXp);
    $("downloadInfoBtn")?.addEventListener("click", runtimeInfo);
    $("xpFile")?.addEventListener("change", async (e) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      try {
        await loadFile(file);
      } catch (err) {
        setStatus(`Failed to load file: ${String(err)}`, "err");
      }
    });

    // Helpful defaults for repeat local use.
    try {
      const savedPath = localStorage.getItem("termpp_skin_lab_webbuild_path");
      if (savedPath) $("webbuildPath").value = savedPath;
      const savedPlayer = localStorage.getItem("termpp_skin_lab_player_name");
      if (savedPlayer) $("playerName").value = savedPlayer;
    } catch (_e) {}
    $("webbuildPath")?.addEventListener("change", () => {
      try { localStorage.setItem("termpp_skin_lab_webbuild_path", $("webbuildPath").value); } catch (_e) {}
    });
    $("playerName")?.addEventListener("change", () => {
      try { localStorage.setItem("termpp_skin_lab_player_name", $("playerName").value); } catch (_e) {}
    });
  }

  window.addEventListener("beforeunload", stopReadyPoll);
  window.addEventListener("DOMContentLoaded", init);
})();
