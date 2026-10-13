(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var token = String(params.get("skin_preview_token") || "").trim().toLowerCase();
  if (!token) return;

  var state = window.__legacySkinPreview = {
    status: "armed",
    token: token,
    family: "",
    target_path: "",
    target_paths: [],
    expected_sha256: "",
    actual_sha256: "",
    actual_sha256_by_path: {},
    installed_target_count: 0,
    source_sha256: "",
    size_bytes: 0,
    legacy_transparency_normalized_cells: 0,
    runtime_state: "",
    mount_state: 0,
    mount_packets_observed: 0,
    mount_packets_rewritten: 0,
    packet_contract_error: "",
    runtime_activation_status: "not_required",
    runtime_activation_control: "",
    runtime_activation_error: "",
    error: "",
  };

  function fail(message) {
    state.status = "failed";
    state.error = String(message || "legacy preview bootstrap failed");
    try { console.error("[legacy-skin-preview] " + state.error); } catch (_e) {}
  }

  if (!/^[0-9a-f]{32}$/.test(token)) {
    fail("invalid preview token");
    return;
  }

  function basePath() {
    var path = String(window.location.pathname || "");
    var marker = "/termpp-web-flat/";
    var index = path.indexOf(marker);
    return index >= 0 ? path.slice(0, index) : "";
  }

  function decodeBase64(value) {
    var binary = atob(String(value || ""));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function sha256Hex(bytes) {
    if (!window.crypto || !window.crypto.subtle) throw new Error("Web Crypto SHA-256 is unavailable");
    var digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), function (value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  async function waitForPackagedTarget(fs, target, timeoutMs) {
    var started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        var packaged = fs.readFile(target);
        if (packaged && packaged.length) return packaged.length;
      } catch (_e) {}
      await new Promise(function (resolve) { setTimeout(resolve, 10); });
    }
    throw new Error("index.data did not materialize " + target + " before timeout");
  }

  function installMountedStateAdapter() {
    if (state.mount_state !== 1 || WebSocket.prototype.send.__legacySkinPreviewWrapped) return;
    var originalSend = WebSocket.prototype.send;
    var wrappedSend = function (data) {
      var bytes = null;
      if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
      else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (!bytes || bytes[0] !== 77) return originalSend.call(this, data);

      state.mount_packets_observed++;
      if (bytes.length !== 8) {
        state.packet_contract_error = "expected frozen M packet length 8; got " + bytes.length;
        fail(state.packet_contract_error);
        return;
      }
      var patched = new Uint8Array(bytes);
      patched[4] = (patched[4] & ~24) | 8;
      state.mount_packets_rewritten++;
      return originalSend.call(this, patched);
    };
    wrappedSend.__legacySkinPreviewWrapped = true;
    WebSocket.prototype.send = wrappedSend;
  }

  function activatePlayerRuntimeState() {
    if (state.family !== "player") return;
    state.runtime_activation_status = "waiting_for_world";
    var started = Date.now();
    var timer = setInterval(function () {
      try {
        if (Date.now() - started > 30000) {
          throw new Error("timed out waiting to activate unmounted player preview");
        }
        if (typeof window.GameWorldReady !== "function" || Number(window.GameWorldReady()) !== 1) return;
        if (typeof window.Keyb !== "function") {
          throw new Error("frozen runtime Keyb export is unavailable");
        }
        clearInterval(timer);
        window.Keyb(0, 108);
        window.Keyb(1, 108);
        state.runtime_activation_control = "Keyb(OEM_COMMA=108)";
        state.runtime_activation_status = "activated";
        console.log("[legacy-skin-preview] activated unmounted player preview");
      } catch (error) {
        clearInterval(timer);
        state.runtime_activation_status = "failed";
        state.runtime_activation_error = String(error && error.message ? error.message : error);
        fail(state.runtime_activation_error);
      }
    }, 100);
  }

  async function installPreview() {
    state.status = "fetching";
    var response = await fetch(basePath() + "/api/workbench/legacy-preview-token/" + token, {
      cache: "no-store",
      credentials: "same-origin",
    });
    var payload = await response.json();
    if (!response.ok) throw new Error(payload && payload.error ? payload.error : "preview token fetch failed: " + response.status);

    var family = String(payload.family || "");
    var allowedFamilies = { player: 0, wolfie: 1 };
    if (!Object.prototype.hasOwnProperty.call(allowedFamilies, family)) throw new Error("unapproved preview family: " + family);
    if (Number(payload.mount_state) !== allowedFamilies[family]) throw new Error("preview family/state mismatch");
    var expectedTargets = [];
    for (var armor = 0; armor < 2; armor++) {
      for (var helmet = 0; helmet < 2; helmet++) {
        for (var shield = 0; shield < 2; shield++) {
          for (var weapon = 0; weapon < 3; weapon++) {
            expectedTargets.push("/sprites/" + family + "-" + armor + helmet + shield + weapon + ".xp");
          }
        }
      }
    }
    var targets = Array.isArray(payload.target_paths) ? payload.target_paths.map(String) : [];
    if (targets.length !== expectedTargets.length || targets.some(function (target, index) { return target !== expectedTargets[index]; })) {
      throw new Error("preview family target set mismatch");
    }
    var target = String(payload.target_path || "");
    if (target !== expectedTargets[0]) throw new Error("preview canonical target mismatch");

    var bytes = decodeBase64(payload.xp_b64);
    var expectedHash = String(payload.sha256 || "").toLowerCase();
    if (!bytes.length || Number(payload.size_bytes) !== bytes.length) throw new Error("preview payload size mismatch");
    var inputHash = await sha256Hex(bytes);
    if (inputHash !== expectedHash) throw new Error("preview payload SHA-256 mismatch");

    var fs = window.FS || Module.FS;
    if (!fs || typeof fs.writeFile !== "function" || typeof fs.readFile !== "function") {
      throw new Error("Emscripten FS write/read surface is unavailable in preRun");
    }
    state.packaged_size_bytes_by_path = {};
    for (var targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      var targetPath = targets[targetIndex];
      state.packaged_size_bytes_by_path[targetPath] = await waitForPackagedTarget(fs, targetPath, 30000);
    }
    var hashes = {};
    for (var installIndex = 0; installIndex < targets.length; installIndex++) {
      var installPath = targets[installIndex];
      fs.writeFile(installPath, bytes.slice(), { canOwn: true });
      var readback = fs.readFile(installPath);
      var readbackHash = await sha256Hex(readback);
      if (readbackHash !== expectedHash) throw new Error("preview XP readback SHA-256 mismatch: " + installPath);
      hashes[installPath] = readbackHash;
    }

    state.target_path = target;
    state.family = family;
    state.target_paths = targets.slice();
    state.expected_sha256 = expectedHash;
    state.actual_sha256 = hashes[target];
    state.actual_sha256_by_path = hashes;
    state.installed_target_count = targets.length;
    state.source_sha256 = String(payload.source_sha256 || "").toLowerCase();
    state.size_bytes = bytes.length;
    state.legacy_transparency_normalized_cells = Number(payload.legacy_transparency_normalized_cells) || 0;
    state.runtime_state = String(payload.runtime_state || "");
    state.mount_state = Number(payload.mount_state) || 0;
    state.width = Number(payload.width) || 0;
    state.height = Number(payload.height) || 0;
    state.layers = Number(payload.layers) || 0;
    state.source_name = String(payload.source_name || "");
    installMountedStateAdapter();
    state.status = "installed";
    activatePlayerRuntimeState();
    console.log("[legacy-skin-preview] installed " + targets.length + " " + family + " targets sha256=" + state.actual_sha256);
  }

  var module = window.Module;
  if (!module || !Array.isArray(module.preRun)) {
    fail("Module.preRun is unavailable before index.js");
    return;
  }
  module.preRun.push(function () {
    var dependency = "legacy-skin-preview-" + token;
    module.addRunDependency(dependency);
    installPreview().then(function () {
      module.removeRunDependency(dependency);
    }).catch(function (error) {
      // Keep the dependency: a requested preview must not fall back to packaged art.
      fail(error && error.message ? error.message : error);
    });
  });
})();
