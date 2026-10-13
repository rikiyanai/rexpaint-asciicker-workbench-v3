(() => {
  "use strict";

  function resolveBasePath(pathname, injectedBasePath) {
    const injected = String(injectedBasePath || "").trim();
    if (injected) return injected;
    const path = String(pathname || "");
    for (const marker of ["/termpp-web-flat", "/termpp-web", "/termpp-skin-lab", "/workbench", "/wizard"]) {
      const index = path.indexOf(marker);
      if (index >= 0) return path.slice(0, index);
    }
    return "";
  }

  const BASE_PATH = resolveBasePath(window.location?.pathname, window.__WB_BASE_PATH);
  const bp = (path) => `${BASE_PATH}${path}`;
  const $ = (id) => document.getElementById(id);
  const state = {
    webbuildLoaded: false,
    webbuildReady: false,
    readyPoll: null,
    lastXpBytes: null,
    lastXpName: "",
    lastToken: null,
  };

  function setStatus(text, cls) {
    const element = $("statusLine");
    if (!element) return;
    element.className = `small ${cls || ""}`.trim();
    element.textContent = text;
  }

  function setWebbuildState(text, cls) {
    const element = $("webbuildState");
    if (!element) return;
    element.className = `small ${cls || ""}`.trim();
    element.textContent = text;
  }

  function out(value) {
    const element = $("out");
    if (!element) return;
    element.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  function frameWin() {
    const frame = $("gameFrame");
    return frame && frame.contentWindow ? frame.contentWindow : null;
  }

  function stopReadyPoll() {
    if (!state.readyPoll) return;
    clearInterval(state.readyPoll);
    state.readyPoll = null;
  }

  function updateButtons() {
    const hasXp = !!(state.lastXpBytes && state.lastXpBytes.length);
    $("applyBtn").disabled = !hasXp;
    $("reapplyBtn").disabled = !hasXp;
    $("startBtn").disabled = !state.webbuildReady;
  }

  function detectWebbuildReady() {
    const win = frameWin();
    if (!win) return false;
    try {
      const receipt = win.__legacySkinPreview || null;
      if (receipt && receipt.status === "failed") {
        state.webbuildReady = false;
        setWebbuildState(`Preview blocked: ${receipt.error || "bootstrap failed"}`, "err");
        updateButtons();
        return false;
      }
      const ready = !!(win.Module && win.Module.calledRun && win._wasmReady && typeof win.Load === "function");
      state.webbuildReady = ready;
      updateButtons();
      if (ready) {
        setWebbuildState(receipt ? `Webbuild ready (${receipt.runtime_state})` : "Webbuild ready", "ok");
        stopReadyPoll();
      } else {
        setWebbuildState("Webbuild loading...", "warn");
      }
      return ready;
    } catch (error) {
      state.webbuildReady = false;
      setWebbuildState(`Iframe access error: ${String(error)}`, "err");
      updateButtons();
      return false;
    }
  }

  function selectedRuntimeUrl() {
    const fallback = bp("/termpp-web-flat/index.html?solo=1&player=player");
    const raw = String($("webbuildPath")?.value || fallback).trim() || fallback;
    return raw.replace("/termpp-web/index.html", "/termpp-web-flat/index.html");
  }

  function runtimeUrlWithToken(token) {
    const url = new URL(selectedRuntimeUrl(), window.location.origin);
    url.searchParams.set("skin_preview_token", String(token));
    url.searchParams.set("_skin_lab", String(Date.now()));
    return `${url.pathname}${url.search}`;
  }

  function navigateFrame(src, label) {
    const frame = $("gameFrame");
    if (!frame) return;
    state.webbuildLoaded = true;
    state.webbuildReady = false;
    updateButtons();
    stopReadyPoll();
    setWebbuildState(label || "Opening webbuild...", "warn");
    try { frame.src = "about:blank"; } catch (_e) {}
    setTimeout(() => { frame.src = src; }, 10);
    state.readyPoll = setInterval(detectWebbuildReady, 500);
  }

  function openWebbuild() {
    const src = selectedRuntimeUrl();
    navigateFrame(src, "Opening webbuild...");
    setStatus("Loading the packaged flat runtime", "warn");
    out({ action: "open_webbuild", src });
  }

  function reloadWebbuild() {
    navigateFrame(selectedRuntimeUrl(), "Reloading webbuild...");
    setStatus("Reloading the packaged flat runtime", "warn");
  }

  function autoStartGameIfNeeded() {
    const win = frameWin();
    if (!win) throw new Error("iframe not available");
    const playerName = String($("playerName")?.value || "player").trim() || "player";
    const doc = win.document;
    const overlay = doc?.getElementById?.("login-overlay");
    if (!overlay || overlay.style?.display === "none") return { started: false, reason: "overlay_hidden" };
    const playerInput = doc.getElementById("player-name");
    const serverInput = doc.getElementById("server-addr");
    const playButton = doc.getElementById("play-btn");
    if (playerInput) playerInput.value = playerName;
    if (serverInput) serverInput.value = "";
    if (playButton) playButton.disabled = false;
    if (typeof win.StartGame !== "function") return { started: false, reason: "StartGame_missing" };
    win.StartGame();
    return { started: true };
  }

  function startGame() {
    if (!detectWebbuildReady()) {
      setStatus("Webbuild is not ready yet", "warn");
      return;
    }
    const result = autoStartGameIfNeeded();
    setStatus(result.started ? "Started webbuild game" : `Start game skipped (${result.reason})`, result.started ? "ok" : "warn");
    out({ action: "start_game", result });
  }

  function uint8ArrayToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function mintPreviewToken() {
    const response = await fetch(bp("/api/workbench/legacy-preview-token"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        xp_b64: uint8ArrayToBase64(state.lastXpBytes),
        source_name: state.lastXpName || "upload.xp",
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `preview token request failed (${response.status})`);
    return payload;
  }

  async function waitForInstalledPreview(tokenPayload, timeoutMs = 180000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const win = frameWin();
      let receipt = null;
      try { receipt = win?.__legacySkinPreview || null; } catch (_e) {}
      if (receipt?.status === "failed") throw new Error(receipt.error || "preview bootstrap failed");
      if (receipt?.status === "installed" && detectWebbuildReady()) {
        if (receipt.target_path !== tokenPayload.target_path || receipt.actual_sha256 !== tokenPayload.sha256) {
          throw new Error("preview install receipt mismatch");
        }
        return receipt;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("preview runtime initialization timed out");
  }

  async function applyLoadedXp() {
    if (!state.lastXpBytes?.length) {
      setStatus("Choose an .xp file first", "warn");
      return;
    }
    try {
      setStatus("Validating XP and minting one-shot preview...", "warn");
      const token = await mintPreviewToken();
      state.lastToken = token;
      navigateFrame(runtimeUrlWithToken(token.token), `Installing ${token.target_path} before runtime...`);
      const receipt = await waitForInstalledPreview(token);
      const startInfo = $("autoStartChk")?.checked ? autoStartGameIfNeeded() : { started: false, reason: "auto_start_disabled" };
      setStatus(`Applied ${state.lastXpName || "XP"} before sprite construction`, "ok");
      out({ action: "apply_xp", token, receipt, start_info: startInfo });
    } catch (error) {
      setStatus(`XP preview failed: ${String(error)}`, "err");
      out({ action: "apply_xp", error: String(error) });
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
    setLoadedXp(file.name || "upload.xp", new Uint8Array(await file.arrayBuffer()));
  }

  function attachDnD() {
    const zone = $("dropZone");
    if (!zone) return;
    const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
    for (const eventName of ["dragenter", "dragover", "dragleave", "drop"]) zone.addEventListener(eventName, stop);
    for (const eventName of ["dragenter", "dragover"]) zone.addEventListener(eventName, () => zone.classList.add("dragover"));
    for (const eventName of ["dragleave", "drop"]) zone.addEventListener(eventName, () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", async (event) => {
      try { await loadFile(event.dataTransfer?.files?.[0]); }
      catch (error) { setStatus(`Failed to load dropped file: ${String(error)}`, "err"); }
    });
  }

  function renderTargetContract() {
    const box = $("overrideNames");
    if (!box) return;
    box.innerHTML = "";
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = "player-0000 or wolfie-0000 (resolved from XP topology)";
    box.appendChild(pill);
  }

  function runtimeInfo() {
    const win = frameWin();
    try {
      out({
        hasModule: !!win?.Module,
        calledRun: !!win?.Module?.calledRun,
        wasmReady: !!win?._wasmReady,
        hasLoad: typeof win?.Load === "function",
        currentSrc: $("gameFrame")?.src || "",
        previewReceipt: win?.__legacySkinPreview || null,
        lastToken: state.lastToken,
      });
      setStatus("Runtime info captured", "ok");
    } catch (error) {
      out({ error: String(error) });
      setStatus("Runtime info failed", "err");
    }
  }

  function init() {
    renderTargetContract();
    attachDnD();
    updateButtons();
    out({ ready: true, note: "Upload an XP; apply always restarts through the pre-main preview owner." });
    $("overrideMode")?.setAttribute?.("disabled", "disabled");
    $("openBtn")?.addEventListener("click", openWebbuild);
    $("reloadBtn")?.addEventListener("click", reloadWebbuild);
    $("startBtn")?.addEventListener("click", startGame);
    $("applyBtn")?.addEventListener("click", applyLoadedXp);
    $("reapplyBtn")?.addEventListener("click", applyLoadedXp);
    $("downloadInfoBtn")?.addEventListener("click", runtimeInfo);
    $("xpFile")?.addEventListener("change", async (event) => {
      try { await loadFile(event.target?.files?.[0]); }
      catch (error) { setStatus(`Failed to load file: ${String(error)}`, "err"); }
    });
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
