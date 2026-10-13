(function () {
  "use strict";

  // Static flat-map override for the browser webbuild.
  // Replaces /a3d/game_map_y8.a3d in Emscripten FS before StartGame/Load.

  var TARGET_MAP_PATH = "/a3d/game_map_y8.a3d";
  var DEFAULT_FLAT_MAP = "game_map_y8_original_game_map.a3d";
  var FALLBACK_FLAT_MAP = "minimal_2x2.a3d";
  var MAP_DIR = "flatmaps";

  var cachedMapBytes = null;
  var cachedMapName = null;
  var appliedStamp = 0;
  var wrapInstalled = false;
  var benignErrno20Suppressed = 0;
  var startGuardActive = false;
  var startGuardStamp = 0;
  var startGuardTimer = 0;
  var autoMenuTimer = 0;
  var autoMenuStartedAt = 0;
  var loadingUiCleared = false;
  var diagnosticTraceTimer = 0;

  function boolParam(name, fallback) {
    var v = String(qs(name) || "").trim().toLowerCase();
    if (!v) return !!fallback;
    if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
    if (v === "0" || v === "false" || v === "no" || v === "off") return false;
    return !!fallback;
  }

  var AUTO_NEW_GAME = boolParam("autonewgame", true);
  var AUTO_ATTACK = boolParam("autoattack", false);
  var ENABLE_KEYB_DIAG = boolParam("keybdiag", false);
  var TRACE_DURATION_MS = Math.max(5000, Math.min(60000, Number(qs("tracelen")) || 5000));
  var WORLD_READY_REQUIRED_STREAK = Math.max(1, Math.min(20, parseInt(qs("wrstreak"), 10) || 4));  // 4 polls at 500ms ≈ 1.5s stable
  var WORLD_GATE_HARD_TIMEOUT = Math.max(5000, Math.min(120000, parseInt(qs("wrtimeout"), 10) || 30000));  // 30s safety net

  function nowMs() { return Date.now ? Date.now() : +new Date(); }

  function qs(name) {
    try { return new URLSearchParams(window.location.search).get(name); }
    catch (_e) { return null; }
  }

  function selectedMapName() {
    var v = String(qs("flatmap") || DEFAULT_FLAT_MAP).trim();
    if (!/^[a-zA-Z0-9_.-]+\.a3d$/.test(v)) return DEFAULT_FLAT_MAP;
    return v;
  }

  function mapUrl() {
    return MAP_DIR + "/" + selectedMapName();
  }

  function log(msg) {
    try { console.log("[flat-map-bootstrap] " + msg); } catch (_e) {}
  }

  function installBenignErrnoSuppression() {
    try {
      if (window.__flatMapBenignErrnoSuppressionInstalled) return;
      window.__flatMapBenignErrnoSuppressionInstalled = true;
      window.addEventListener("unhandledrejection", function (ev) {
        var r = ev && ev.reason;
        if (!r || typeof r !== "object") return;
        if (String(r.name || "") !== "ErrnoError") return;
        if (Number(r.errno) !== 20) return; // ENOTDIR in browser webbuild startup; observed benign after successful StartGame.
        if (typeof ev.preventDefault === "function") ev.preventDefault();
        benignErrno20Suppressed++;
        if (benignErrno20Suppressed <= 3) {
          log("suppressed benign unhandledrejection ErrnoError errno=20");
        }
      });
    } catch (_e) {}
  }

  function setStatusText(msg) {
    try {
      if (window.Module && typeof window.Module.setStatus === "function") window.Module.setStatus(msg);
    } catch (_e) {}
  }

  function clearLoadingUi(reason) {
    if (loadingUiCleared) return;
    loadingUiCleared = true;
    try { setStatusText(""); } catch (_e) {}
    try {
      var statusEl = document.getElementById("status");
      if (statusEl) {
        statusEl.textContent = "";
        statusEl.hidden = true;
        statusEl.style.display = "none";
      }
    } catch (_e) {}
    try {
      var spinnerEl = document.getElementById("spinner");
      if (spinnerEl) {
        spinnerEl.hidden = true;
        spinnerEl.style.display = "none";
      }
    } catch (_e) {}
    try {
      var progressEl = document.getElementById("progress");
      if (progressEl) progressEl.hidden = true;
    } catch (_e) {}
    if (reason) log("cleared loading UI (" + String(reason) + ")");
  }

  async function fetchFlatMapBytes() {
    var name = selectedMapName();
    if (cachedMapBytes && cachedMapName === name) return cachedMapBytes;
    var attempts = [name];
    if (name !== FALLBACK_FLAT_MAP) attempts.push(FALLBACK_FLAT_MAP);
    for (var i = 0; i < attempts.length; i++) {
      var mapName = attempts[i];
      var url = MAP_DIR + "/" + mapName;
      log("fetching " + url);
      var r = await fetch(url, { cache: "no-store" });
      if (!r.ok) {
        if (i + 1 < attempts.length) {
          log("flat map fetch failed (" + r.status + "), falling back to " + FALLBACK_FLAT_MAP);
          continue;
        }
        throw new Error("flat map fetch failed: " + r.status + " " + url);
      }
      var ab = await r.arrayBuffer();
      cachedMapBytes = new Uint8Array(ab);
      cachedMapName = mapName;
      log("fetched " + cachedMapBytes.length + " bytes from " + url);
      return cachedMapBytes;
    }
    throw new Error("flat map fetch exhausted without success");
  }

  async function waitForFs(timeoutMs) {
    timeoutMs = Math.max(500, timeoutMs || 8000);
    var t0 = nowMs();
    while (nowMs() - t0 < timeoutMs) {
      var M = window.Module;
      if (M &&
          typeof M.FS_createDataFile === "function" &&
          typeof M.FS_unlink === "function" &&
          typeof M.FS_createPath === "function") {
        return M;
      }
      await new Promise(function (r) { setTimeout(r, 50); });
    }
    throw new Error("webbuild FS not ready");
  }

  function emfsReplaceFile(M, absPath, bytes) {
    var path = String(absPath || "");
    if (path.charAt(0) !== "/") throw new Error("invalid emfs path: " + path);
    var slash = path.lastIndexOf("/");
    var dir = slash > 0 ? path.slice(0, slash) : "/";
    var name = path.slice(slash + 1);
    if (!name) throw new Error("invalid emfs filename: " + path);
    var FS = M && M.FS;
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

  async function applyFlatMapOverride(force) {
    if (!force && appliedStamp) return { applied: false, reason: "already_applied", stamp: appliedStamp };
    loadingUiCleared = false;
    setStatusText("Loading flat test arena...");
    var M = await waitForFs(15000);
    var bytes = await fetchFlatMapBytes();
    try { M.FS_createPath("/", "a3d", true, true); } catch (_e) {}
    var writeRes = emfsReplaceFile(M, TARGET_MAP_PATH, bytes);
    appliedStamp = nowMs();
    log("patched " + TARGET_MAP_PATH + " with " + cachedMapName + " (" + bytes.length + " bytes, " + String(writeRes.mode || "unknown") + ")");
    return { applied: true, target: TARGET_MAP_PATH, source: cachedMapName, bytes: bytes.length, fs_write_mode: String(writeRes.mode || "unknown"), stamp: appliedStamp };
  }

  function disablePlayUi(disabled, label) {
    try {
      var btn = document.getElementById("play-btn");
      if (btn) {
        btn.disabled = !!disabled;
        if (label) btn.textContent = String(label);
      }
    } catch (_e) {}
  }

  function overlayVisibleNow() {
    try {
      var overlay = document.getElementById("login-overlay");
      if (!overlay) return false;
      if (overlay.hidden) return false;
      var cs = window.getComputedStyle ? window.getComputedStyle(overlay) : null;
      if (cs && (cs.display === "none" || cs.visibility === "hidden")) return false;
      if (overlay.style && overlay.style.display === "none") return false;
      return true;
    } catch (_e) {
      return false;
    }
  }

  function sendEnterPulse() {
    var sentViaKeyb = false;
    try {
      if (typeof window.Keyb === "function") {
        // Same sequence as native key handlers: DOWN(Enter=3) -> CHAR(10) -> UP(Enter=3).
        window.Keyb(0, 3);
        window.Keyb(2, 10);
        window.Keyb(1, 3);
        sentViaKeyb = true;
      }
    } catch (_e) {}
    if (sentViaKeyb) return "Keyb";

    // Fallback for builds where Keyb isn't globally reachable.
    var targets = [window, document, document.body, document.getElementById("asciicker_canvas")];
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (!t || typeof t.dispatchEvent !== "function") continue;
      try {
        t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
        t.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      } catch (_e) {}
    }
    return "DOM";
  }

  function safeCall(fn) {
    try {
      if (typeof fn === "function") return fn();
    } catch (_e) {}
    return null;
  }

  function menuProbe() {
    var out = {
      main_menu: safeCall(window.GameMainMenuActive),
      world_ready: safeCall(window.GameWorldReady),
      render_stage: safeCall(window.GetRenderStageCode),
    };
    try {
      if (window.ak && typeof window.ak.getPos === "function") {
        var p = [0, 0, 0];
        window.ak.getPos(p, 0);
        out.pos = [Number(p[0]), Number(p[1]), Number(p[2])];
      } else {
        out.pos = null;
      }
    } catch (_e) {
      out.pos = null;
    }
    try {
      if (window.ak && typeof window.ak.getWater === "function") out.water = Number(window.ak.getWater());
      else out.water = null;
    } catch (_e) {
      out.water = null;
    }
    try {
      if (window.ak && typeof window.ak.isGrounded === "function") out.grounded = !!window.ak.isGrounded();
      else out.grounded = null;
    } catch (_e) {
      out.grounded = null;
    }
    return out;
  }

  function gameplayLikelyStarted(probe) {
    if (!probe || typeof probe !== "object") return false;
    var mainMenu = (probe.main_menu === true || Number(probe.main_menu) === 1);
    var worldReady = (probe.world_ready === true || Number(probe.world_ready) === 1);
    var renderStage = Number(probe.render_stage);
    var stageReady = isFinite(renderStage) && renderStage >= 70;
    var grounded = (probe.grounded === true);
    var water = Number(probe.water);
    var inWater = isFinite(water) && water > 0;
    if (Array.isArray(probe.pos) && probe.pos.length === 3) {
      var nonZeroPos = false;
      for (var i = 0; i < 3; i++) {
        var v = Number(probe.pos[i]);
        if (isFinite(v) && Math.abs(v) > 0.001) {
          nonZeroPos = true;
          break;
        }
      }
      if (worldReady && !mainMenu) return true;
      if (stageReady && (grounded || inWater || nonZeroPos)) return true;
      if (grounded && nonZeroPos) return true;
      return false;
    }
    if (worldReady && !mainMenu) return true;
    if (stageReady && (grounded || inWater)) return true;
    return false;
  }

  function startDiagnosticTrace() {
    if (diagnosticTraceTimer) {
      clearInterval(diagnosticTraceTimer);
      diagnosticTraceTimer = 0;
    }
    var t0 = nowMs();
    var frameCount = 0;
    var initialStage = -1;
    var posChanged = false;
    var waterDetected = false;
    var waterDetectedAt = -1;
    var groundedOnce = false;
    var firstPos = null;
    var worldReadyEverTrue = false;
    var worldReadyDropCount = 0;
    var menuClearedWhileWorldNotReady = false;
    var menuClearedAt = -1;
    var viewportZero = false;
    try {
      var cvs = document.getElementById("asciicker_canvas");
      if (cvs) {
        var gl = cvs.getContext("webgl") || cvs.getContext("webgl2") || cvs.getContext("experimental-webgl");
        var cw = cvs.width || 0;
        var ch = cvs.height || 0;
        var dbw = gl ? (gl.drawingBufferWidth || 0) : 0;
        var dbh = gl ? (gl.drawingBufferHeight || 0) : 0;
        viewportZero = (cw === 0 || ch === 0 || dbw === 0 || dbh === 0);
        log("[VIEWPORT] canvas=" + cw + "x" + ch + " drawingBuffer=" + dbw + "x" + dbh + " zero=" + String(viewportZero));
      }
    } catch (_ve) {}

    diagnosticTraceTimer = setInterval(function () {
      var age = nowMs() - t0;
      frameCount++;
      var probe = menuProbe();
      var stage = Number(probe.render_stage);
      if (initialStage < 0 && isFinite(stage)) initialStage = stage;
      var inMainMenu = (probe.main_menu === true || Number(probe.main_menu) === 1);
      var worldReady = (probe.world_ready === true || Number(probe.world_ready) === 1);
      var grounded = (probe.grounded === true);
      var water = Number(probe.water);
      if (grounded) groundedOnce = true;
      if (worldReady) worldReadyEverTrue = true;
      if (worldReadyEverTrue && !worldReady) worldReadyDropCount++;
      if (!inMainMenu && menuClearedAt < 0) {
        menuClearedAt = age;
        if (!worldReady) menuClearedWhileWorldNotReady = true;
      }
      if (isFinite(water) && water > 0) {
        waterDetected = true;
        if (waterDetectedAt < 0) waterDetectedAt = age;
      }
      if (Array.isArray(probe.pos) && probe.pos.length === 3) {
        if (!firstPos) firstPos = [Number(probe.pos[0]), Number(probe.pos[1]), Number(probe.pos[2])];
        for (var i = 0; i < 3; i++) {
          if (Math.abs(Number(probe.pos[i]) - firstPos[i]) > 0.01) {
            posChanged = true;
            break;
          }
        }
      }

      log("[TRACE] frame=" + frameCount + " t=" + age + " pos=" + JSON.stringify(probe.pos) +
          " grounded=" + String(probe.grounded) + " water=" + String(probe.water) +
          " menu=" + String(probe.main_menu) + " world_ready=" + String(probe.world_ready) +
          " stage=" + String(probe.render_stage));

      if (age >= TRACE_DURATION_MS) {
        clearInterval(diagnosticTraceTimer);
        diagnosticTraceTimer = 0;
        var result = "unknown";
        // Primary classification: worldReady + grounded + (position moved OR rendering stage advanced)
        // Handles cases where window.ak.getPos() is unavailable (WASM runtime without JS wrappers)
        var stageAdvanced = isFinite(stage) && isFinite(initialStage) && stage > initialStage;
        var hasMovementIndicator = posChanged || stageAdvanced;
        if (worldReady && groundedOnce && hasMovementIndicator && !waterDetected) {
          result = "playable";
        } else if (isFinite(stage) && stage === initialStage && initialStage < 70) {
          result = "freeze_no_frames";
        } else if (waterDetected && waterDetectedAt >= 0 && waterDetectedAt <= 3000) {
          result = "underwater";
        } else if (!groundedOnce && Array.isArray(probe.pos) && probe.pos.length === 3 && firstPos) {
          var zNow = Number(probe.pos[2]);
          var zStart = firstPos[2];
          if (isFinite(zNow) && isFinite(zStart) && zNow < zStart - 1) result = "falling";
        } else if (inMainMenu) {
          result = "stuck_menu";
        } else if (!worldReady && worldReadyEverTrue) {
          result = "freeze_world_ready_dropped";
        } else if (!worldReady) {
          result = "freeze_world_never_ready";
        }
        log("[CLASSIFY] result=" + result + " frames=" + frameCount +
            " pos_changed=" + String(posChanged) + " water_detected=" + String(waterDetected) +
            " grounded_once=" + String(groundedOnce) + " final_stage=" + String(stage) +
            " world_ready=" + String(worldReady) + " menu=" + String(inMainMenu) +
            " world_ready_ever=" + String(worldReadyEverTrue) +
            " world_ready_drops=" + String(worldReadyDropCount) +
            " menu_cleared_while_not_ready=" + String(menuClearedWhileWorldNotReady) +
            " viewport_zero=" + String(viewportZero) +
            " trace_duration_ms=" + String(TRACE_DURATION_MS));
      }
    }, 100);
  }

  function scheduleAutoNewGameAdvance() {
    if (!AUTO_NEW_GAME) return;
    if (autoMenuTimer) {
      clearInterval(autoMenuTimer);
      autoMenuTimer = 0;
    }
    autoMenuStartedAt = nowMs();
    log("auto-newgame schedule armed");
    var pulsesSent = 0;
    var overlayWaitTicks = 0;
    var worldWaitTicks = 0;
    var worldReadyStreak = 0;
    var hardTimeoutTripped = false;
    var firstPulseAt = -1;
    autoMenuTimer = setInterval(function () {
      var age = nowMs() - autoMenuStartedAt;
      // Wait until login overlay is gone (i.e., runtime accepted PLAY).
      if (overlayVisibleNow()) {
        overlayWaitTicks++;
        if (overlayWaitTicks <= 2 || (overlayWaitTicks % 8) === 0) {
          log("auto-newgame waiting for overlay to hide...");
        }
        if (age > 45000) {
          log("auto-newgame timeout while waiting for overlay");
          clearInterval(autoMenuTimer);
          autoMenuTimer = 0;
        }
        return;
      }
      clearLoadingUi("overlay_hidden");
      var probe = menuProbe();
      var inMainMenu = (probe.main_menu === true || Number(probe.main_menu) === 1);
      var worldReady = (probe.world_ready === true || Number(probe.world_ready) === 1);
      if (!inMainMenu) {
        clearLoadingUi("main_menu_cleared");
        log("auto-newgame stopped (main menu cleared)");
        clearInterval(autoMenuTimer);
        autoMenuTimer = 0;
        return;
      }
      if (gameplayLikelyStarted(probe)) {
        clearLoadingUi("world_ready");
        log("auto-newgame stopped (world ready)");
        clearInterval(autoMenuTimer);
        autoMenuTimer = 0;
        return;
      }
      // Two-phase gate to avoid deadlock where engine needs Enter pulse to advance.
      // Phase A (pulsesSent < 3): allow initial pulses without requiring world_ready.
      //   The engine may need menu advance before world_ready can become true.
      // Phase B (pulsesSent >= 3): require stable world_ready streak before more pulses.
      //   Prevents spamming Enter into a not-yet-ready world.
      var PHASE_A_PULSE_BUDGET = 3;
      if (worldReady) {
        worldReadyStreak++;
      } else {
        worldReadyStreak = 0;
      }
      if (pulsesSent >= PHASE_A_PULSE_BUDGET && worldReadyStreak < WORLD_READY_REQUIRED_STREAK) {
        worldWaitTicks++;
        if (age > WORLD_GATE_HARD_TIMEOUT) {
          if (!hardTimeoutTripped) {
            hardTimeoutTripped = true;
            log("auto-newgame HARD TIMEOUT (" + WORLD_GATE_HARD_TIMEOUT + "ms) — forcing menu advance despite world_ready not stable (streak=" + worldReadyStreak + " stage=" + String(probe.render_stage) + ")");
          }
          // Fall through to pulse
        } else {
          if (worldWaitTicks <= 2 || (worldWaitTicks % 4) === 0) {
            log("auto-newgame phase-B waiting for stable world_ready... streak=" + worldReadyStreak + "/" + WORLD_READY_REQUIRED_STREAK + " age_ms=" + age + " stage=" + String(probe.render_stage));
          }
          return;
        }
      }
      if (firstPulseAt < 0) firstPulseAt = age;
      pulsesSent++;
      var mode = sendEnterPulse();
      log("auto-newgame pulse #" + pulsesSent + " (" + mode + ") age_ms=" + age + " streak=" + worldReadyStreak + " menu=" + String(probe.main_menu) + " world=" + String(probe.world_ready) + " stage=" + String(probe.render_stage) + " pos=" + String(probe.pos) + " water=" + String(probe.water) + " grounded=" + String(probe.grounded));
      var pulseDuration = (firstPulseAt >= 0) ? (age - firstPulseAt) : 0;
      if (pulsesSent >= 24 || pulseDuration > 20000) {
        log("auto-newgame pulse budget exhausted");
        clearInterval(autoMenuTimer);
        autoMenuTimer = 0;
      }
    }, 500);
  }

  // ── Auto-attack test: fires Space key (attack) 2s after player is grounded ──
  var autoAttackFired = false;
  function scheduleAutoAttackTest() {
    if (!AUTO_ATTACK || autoAttackFired) return;
    var ATTACK_KEY_CODE = 6; // Space in engine key map
    var ATTACK_DELAY_MS = 2000;
    var pollTimer = setInterval(function () {
      try {
        var grounded = false;
        if (typeof window.Grounded === "function") {
          grounded = !!window.Grounded();
        }
        if (!grounded) return;
        autoAttackFired = true;
        clearInterval(pollTimer);
        setTimeout(function () {
          log("[ATTACK-TRIGGER] firing auto-attack (Space key code=" + ATTACK_KEY_CODE + ")");
          if (typeof window.Keyb === "function") {
            window.Keyb(0, ATTACK_KEY_CODE); // key down
            setTimeout(function () {
              window.Keyb(1, ATTACK_KEY_CODE); // key up
              log("[ATTACK-TRIGGER] attack key released");
            }, 150);
          } else {
            log("[ATTACK-TRIGGER] Keyb not available, using DOM fallback");
            var targets = [window, document, document.body,
              document.getElementById("asciicker_canvas")];
            for (var i = 0; i < targets.length; i++) {
              var t = targets[i];
              if (!t || typeof t.dispatchEvent !== "function") continue;
              t.dispatchEvent(new KeyboardEvent("keydown", {
                key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true
              }));
            }
            setTimeout(function () {
              for (var i = 0; i < targets.length; i++) {
                var t = targets[i];
                if (!t || typeof t.dispatchEvent !== "function") continue;
                t.dispatchEvent(new KeyboardEvent("keyup", {
                  key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true
                }));
              }
              log("[ATTACK-TRIGGER] DOM fallback attack key released");
            }, 150);
          }
        }, ATTACK_DELAY_MS);
      } catch (e) {
        log("[ATTACK-TRIGGER] error: " + e);
      }
    }, 500);
  }

  function clearStartGuard() {
    startGuardActive = false;
    startGuardStamp = 0;
    if (startGuardTimer) {
      clearInterval(startGuardTimer);
      startGuardTimer = 0;
    }
  }

  function armStartGuard() {
    clearStartGuard();
    startGuardActive = true;
    startGuardStamp = nowMs();
    startGuardTimer = setInterval(function () {
      try {
        if (!startGuardActive) {
          clearStartGuard();
          return;
        }
        var age = nowMs() - startGuardStamp;
        // Release the guard after the overlay hides (game started) or after a long timeout.
        if (!overlayVisibleNow() || age > 45000) {
          clearStartGuard();
        }
      } catch (_e) {
        clearStartGuard();
      }
    }, 200);
  }

  function installStartGameWrapper() {
    if (wrapInstalled) return true;
    if (typeof window.StartGame !== "function") return false;
    var original = window.StartGame;
    window.StartGame = async function () {
      if (startGuardActive) {
        log("ignored duplicate StartGame while startup is already in progress");
        return;
      }
      armStartGuard();
      try {
        disablePlayUi(true, "LOADING MAP...");
        var res = await applyFlatMapOverride(false);
        log("start wrapper apply result: " + JSON.stringify(res));
      } catch (e) {
        log("flat map apply failed before StartGame: " + e);
      } finally {
        disablePlayUi(false, "PLAY");
      }
      var ret = original.apply(this, arguments);
      if (ret && typeof ret.then === "function") {
        try { await ret; } catch (_e) { log("original StartGame rejected: " + _e); }
      }
      // Do not leave the Emscripten loading label pinned forever once startup transitions.
      setTimeout(function () { clearLoadingUi("post_startgame"); }, 1200);
      setTimeout(function () { clearLoadingUi("post_startgame_fallback"); }, 5000);
      scheduleAutoNewGameAdvance();
      scheduleAutoAttackTest();
      startDiagnosticTrace();
      return ret;
    };
    wrapInstalled = true;
    log("StartGame wrapper installed");
    return true;
  }

  function installLoadWrapperWhenReady() {
    // Optional extra safety: if external callers invoke Load() directly, ensure map override
    // has a chance to apply first. Load() is assigned later by Emscripten cwrap.
    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      if (typeof window.Load === "function" && !window.Load.__flatWrapped) {
        var originalLoad = window.Load;
        var wrapped = function () {
          var args = arguments;
          // Preserve synchronous Load() ordering when StartGame wrapper already applied the flat map.
          // Async deferral here can reorder Load/Resize/frame-start and cause visible spawn/camera glitches.
          if (appliedStamp) {
            var ret = originalLoad.apply(window, args);
            // Solo primary path: Load() is the entry point (not StartGame).
            // Schedule auto-newgame advance so the menu gets Enter pulses.
            if (AUTO_NEW_GAME && !startGuardActive) {
              setTimeout(function () { scheduleAutoNewGameAdvance(); }, 500);
            }
            setTimeout(function () { scheduleAutoAttackTest(); }, 1000);
            return ret;
          }
          log("[DIAG] Load wrapper async path hit (appliedStamp=0) — map override deferred before originalLoad");
          applyFlatMapOverride(false)
            .catch(function (e) { log("pre-Load override failed: " + e); })
            .finally(function () {
              log("[DIAG] Load wrapper async path complete — calling originalLoad now");
              originalLoad.apply(window, args);
              // Solo primary path (async): schedule auto-newgame after deferred Load.
              if (AUTO_NEW_GAME && !startGuardActive) {
                setTimeout(function () { scheduleAutoNewGameAdvance(); }, 500);
              }
              setTimeout(function () { scheduleAutoAttackTest(); }, 1000);
            });
        };
        wrapped.__flatWrapped = true;
        window.Load = wrapped;
        log("Load wrapper installed");
      }
      if (typeof window.Resize === "function" && !window.Resize.__flatWrapped) {
        var originalResize = window.Resize;
        var wrappedResize = function () {
          try {
            var ww = Number(window.innerWidth || 0);
            var wh = Number(window.innerHeight || 0);
            if (!(ww > 0) || !(wh > 0)) {
              log("ignored Resize during zero-sized viewport (" + ww + "x" + wh + ")");
              return;
            }
          } catch (_e) {}
          return originalResize.apply(window, arguments);
        };
        wrappedResize.__flatWrapped = true;
        window.Resize = wrappedResize;
        log("Resize wrapper installed");
      }
      installStartGameWrapper();
      if (attempts > 400 || (wrapInstalled && window.Load && window.Load.__flatWrapped && window.Resize && window.Resize.__flatWrapped)) clearInterval(timer);
    }, 100);
  }

  function prefetchSoon() {
    // Best-effort prefetch so first Play click is fast.
    setTimeout(function () {
      fetchFlatMapBytes().catch(function (e) { log("prefetch failed: " + e); });
    }, 50);
  }

  window.__termppFlatMap = {
    apply: function (force) { return applyFlatMapOverride(!!force); },
    info: function () {
      return {
        target: TARGET_MAP_PATH,
        selected: selectedMapName(),
        url: mapUrl(),
        cached: !!cachedMapBytes,
        cached_bytes: cachedMapBytes ? cachedMapBytes.length : 0,
        applied_stamp: appliedStamp || 0,
      };
    }
  };

  installLoadWrapperWhenReady();
  installBenignErrnoSuppression();
  prefetchSoon();
  log("bootstrap active (flatmap=" + selectedMapName() + ")");

  // ── Keyboard/Focus diagnostic instrumentation ──
  // Wraps Keyb and Focus to log every call; monitors focus/blur events.
  // Remove this block once the stuck-keys bug is resolved.
  (function installKeybDiag() {
    if (!ENABLE_KEYB_DIAG) {
      log("keyb-diag disabled (set ?keybdiag=1 to enable)");
      return;
    }
    var DIAG_PREFIX = "[keyb-diag] ";
    function dlog(msg) {
      try { console.log(DIAG_PREFIX + msg); } catch (_e) {}
    }
    function activeTag() {
      try {
        var el = document.activeElement;
        if (!el) return "null";
        var tag = el.tagName || "?";
        var id = el.id ? "#" + el.id : "";
        return tag + id;
      } catch (_e) { return "err"; }
    }

    // Wrap Keyb (cwrap'd C function) once it exists
    var keybWrapTimer = setInterval(function () {
      if (typeof window.Keyb !== "function") return;
      if (window.Keyb.__diagWrapped) { clearInterval(keybWrapTimer); return; }
      var origKeyb = window.Keyb;
      window.Keyb = function (dir, code) {
        dlog("Keyb(" + dir + "," + code + ") ae=" + activeTag() +
             " t=" + (performance.now() | 0));
        return origKeyb.apply(this, arguments);
      };
      window.Keyb.__diagWrapped = true;
      clearInterval(keybWrapTimer);
      dlog("Keyb wrapper installed");
    }, 100);

    // Wrap Focus (cwrap'd C function) once it exists
    var focusWrapTimer = setInterval(function () {
      if (typeof window.Focus !== "function") return;
      if (window.Focus.__diagWrapped) { clearInterval(focusWrapTimer); return; }
      var origFocus = window.Focus;
      window.Focus = function (state) {
        dlog("Focus(" + state + ") ae=" + activeTag() +
             " t=" + (performance.now() | 0));
        return origFocus.apply(this, arguments);
      };
      window.Focus.__diagWrapped = true;
      clearInterval(focusWrapTimer);
      dlog("Focus wrapper installed");
    }, 100);

    // Log window focus/blur events
    window.addEventListener("focus", function () {
      dlog("window.focus ae=" + activeTag() + " t=" + (performance.now() | 0));
    }, true);
    window.addEventListener("blur", function () {
      dlog("window.blur ae=" + activeTag() + " t=" + (performance.now() | 0));
    }, true);

    dlog("diagnostic hooks armed");
  })();
})();
