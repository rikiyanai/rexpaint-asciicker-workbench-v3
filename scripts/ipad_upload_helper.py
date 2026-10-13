#!/usr/bin/env python3
"""iPad-friendly XP upload helper.

Serves a single page on port 5073 with three input methods:
  1. Drag-and-drop a .xp file
  2. Tap to pick a file (no accept= filter so iPad shows everything)
  3. Paste a URL (Google Drive direct-download link, etc.) and we fetch+forward

The page POSTs to the workbench's /api/workbench/upload-xp endpoint
running on 127.0.0.1:5071 (or whatever WORKBENCH_BASE points at).

Returns the new session_id and a tappable workbench link.

Security notes (proxy-fetch):
  - HTTPS only (no http://, file://, etc.) unless ALLOW_HTTP_FETCH=1
  - RFC-1918 / loopback / link-local targets are blocked
  - Max response size: FETCH_MAX_BYTES (default 20 MB)
  - No redirect following (prevents redirect-based SSRF)
  - Timeout: FETCH_TIMEOUT_S (default 30 s)
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = int(os.environ.get("HELPER_PORT", "5073"))
WORKBENCH_BASE = os.environ.get("WORKBENCH_BASE", "http://127.0.0.1:5071")
PUBLIC_BASE = os.environ.get("PUBLIC_BASE", "")
FETCH_MAX_BYTES = int(os.environ.get("FETCH_MAX_BYTES", str(20 * 1024 * 1024)))  # 20 MB
FETCH_TIMEOUT_S = int(os.environ.get("FETCH_TIMEOUT_S", "30"))
ALLOW_HTTP_FETCH = os.environ.get("ALLOW_HTTP_FETCH", "").lower() in ("1", "true", "yes")

_PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def _check_fetch_url(url: str) -> str | None:
    """Return an error string if the URL is not safe to fetch, else None."""
    try:
        p = urllib.parse.urlparse(url)
    except Exception:
        return "invalid URL"
    scheme = p.scheme.lower()
    if ALLOW_HTTP_FETCH:
        if scheme not in ("http", "https"):
            return f"scheme {scheme!r} not allowed (http/https only)"
    else:
        if scheme != "https":
            return f"scheme {scheme!r} not allowed (https only); set ALLOW_HTTP_FETCH=1 for local testing"
    hostname = p.hostname
    if not hostname:
        return "missing hostname"
    # Resolve and check each address
    try:
        addrs = socket.getaddrinfo(hostname, None)
    except socket.gaierror as e:
        return f"DNS resolution failed: {e}"
    for _family, _type, _proto, _canon, sockaddr in addrs:
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        for net in _PRIVATE_NETWORKS:
            if ip in net:
                return f"target {ip_str} is in a private/reserved range"
    return None


def _convert_drive_url(u: str) -> str:
    """Convert Google Drive share URLs to direct-download form."""
    m = re.search(r"drive\.google\.com/file/d/([A-Za-z0-9_-]+)", u)
    if m:
        return f"https://drive.google.com/uc?export=download&id={m.group(1)}"
    return u


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>XP Upload (iPad)</title>
<style>
  :root { color-scheme: dark light; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { font: 17px/1.4 -apple-system, system-ui, sans-serif; margin: 0; padding: 16px; background:#111; color:#eee; min-height:100vh; }
  h1 { margin: 0 0 12px; font-size: 22px; }
  .card { background:#1c1c1e; border-radius: 14px; padding: 18px; margin-bottom: 14px; }
  .drop { border: 2px dashed #4a4a4f; border-radius: 14px; padding: 32px 14px; text-align:center; transition: all .15s; }
  .drop.hot { border-color: #0a84ff; background:#0a84ff14; }
  .drop p { margin: 0 0 12px; color:#bbb; }
  button, .pick {
    display:inline-block; appearance: none; -webkit-appearance: none;
    background:#0a84ff; color:#fff; border:0; border-radius: 10px;
    padding: 14px 22px; font-size: 17px; font-weight: 600; cursor: pointer;
    text-decoration:none; touch-action: manipulation;
  }
  button:active, .pick:active { background:#0670d4; }
  button[disabled] { opacity:.5; }
  input[type=file] { display:none; }
  input[type=text], input[type=url] {
    width:100%; padding: 12px 14px; font-size: 17px;
    background:#2c2c2e; color:#fff; border:1px solid #3a3a3c; border-radius: 10px;
    margin: 8px 0 10px;
  }
  label { color:#bbb; font-size: 14px; display:block; margin-top: 8px; }
  .row { display:flex; gap: 10px; align-items:center; }
  .row > * { flex: 1; }
  .row > button { flex: 0 0 auto; }
  pre { background:#0b0b0b; color:#9adf9a; padding: 12px; border-radius:10px; overflow:auto; font-size:13px; }
  a.session-link { display:block; margin-top: 10px; color:#0a84ff; word-break: break-all; font-weight:600; }
  .err { color:#ff6b6b; }
  .ok { color:#8fef8f; }
  .muted { color:#888; font-size:13px; }
</style>
</head>
<body>
<h1>Upload XP &rarr; Workbench</h1>

<div class="card">
  <div class="drop" id="drop">
    <p><strong>Drag a .xp file here</strong><br>or</p>
    <label class="pick" for="picker">Choose File</label>
    <input id="picker" type="file">
    <p class="muted" style="margin-top:12px">No file-type filter &mdash; everything is selectable on iPad.</p>
  </div>
</div>

<div class="card">
  <label for="url">Or paste a URL (Google Drive direct-download, etc.):</label>
  <input id="url" type="url" placeholder="https://drive.google.com/uc?export=download&id=...">
  <div class="row">
    <button id="urlbtn">Fetch &amp; Upload</button>
    <span class="muted">Drive share links auto-converted.</span>
  </div>
</div>

<div class="card">
  <div id="status" class="muted">Ready.</div>
  <pre id="out" style="display:none"></pre>
</div>

<script>
const drop = document.getElementById('drop');
const picker = document.getElementById('picker');
const urlInput = document.getElementById('url');
const urlBtn = document.getElementById('urlbtn');
const status = document.getElementById('status');
const out = document.getElementById('out');

['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => {
  e.preventDefault(); e.stopPropagation(); drop.classList.add('hot');
}));
['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => {
  e.preventDefault(); e.stopPropagation(); drop.classList.remove('hot');
}));
drop.addEventListener('drop', e => {
  const f = e.dataTransfer.files[0];
  if (f) uploadFile(f);
});
picker.addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) uploadFile(f);
});
urlBtn.addEventListener('click', () => {
  const u = urlInput.value.trim();
  if (!u) return;
  uploadUrl(u);
});

function setStatus(msg, cls){
  status.className = cls || 'muted';
  status.textContent = msg;
}

async function uploadFile(file){
  setStatus('Uploading ' + file.name + ' (' + file.size + ' bytes)...');
  const fd = new FormData();
  fd.append('file', file, file.name || 'upload.xp');
  fd.append('angles', '8');
  fd.append('anims', '1');
  fd.append('anims', '8');
  fd.append('projs', '2');
  fd.append('cell_w', '8');
  fd.append('cell_h', '16');
  try {
    const r = await fetch('/proxy-upload', { method:'POST', body: fd });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = null; }
    if (!r.ok || !j) {
      out.style.display='block'; out.textContent = txt;
      setStatus('Upload failed ('+r.status+')', 'err');
      return;
    }
    showSession(j);
  } catch (err) {
    setStatus('Network error: ' + err.message, 'err');
  }
}

async function uploadUrl(url){
  setStatus('Fetching from URL...');
  try {
    const r = await fetch('/proxy-fetch', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({url})
    });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = null; }
    if (!r.ok || !j) {
      out.style.display='block'; out.textContent = txt;
      setStatus('URL upload failed ('+r.status+')', 'err');
      return;
    }
    showSession(j);
  } catch (err) {
    setStatus('Network error: ' + err.message, 'err');
  }
}

function showSession(j){
  out.style.display='block';
  out.textContent = JSON.stringify(j, null, 2);
  setStatus('Uploaded!', 'ok');
  const sid = j.session_id || j.session || (j.data && j.data.session_id);
  if (sid) {
    const base = PUBLIC_WB || (location.protocol + '//' + location.hostname + ':5072');
    const url = base + '/workbench?session=' + encodeURIComponent(sid) + '&focusFrame=0,0';
    const a = document.createElement('a');
    a.href = url; a.textContent = 'Open in Workbench: ' + sid;
    a.className = 'session-link';
    a.target = '_blank';
    out.parentNode.appendChild(a);
  }
}
const PUBLIC_WB = __PUBLIC_BASE__;
</script>
</body>
</html>
"""


class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        sys.stderr.write("[helper] " + (fmt % a) + "\n")

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_head_only(self, code, ctype="application/json"):
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.end_headers()

    def do_HEAD(self):
        if self.path in ("/", "/index.html"):
            return self._send_head_only(200, "text/html; charset=utf-8")
        return self._send_head_only(404)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            pb = json.dumps(PUBLIC_BASE) if PUBLIC_BASE else "null"
            html = PAGE.replace("__PUBLIC_BASE__", pb)
            return self._send(200, html, "text/html; charset=utf-8")
        return self._send(404, "{}")

    def do_POST(self):
        if self.path == "/proxy-upload":
            return self._proxy_upload()
        if self.path == "/proxy-fetch":
            return self._proxy_fetch()
        return self._send(404, "{}")

    def _proxy_upload(self):
        length = int(self.headers.get("content-length", "0"))
        ctype = self.headers.get("content-type", "")
        body = self.rfile.read(length) if length else b""
        req = urllib.request.Request(
            f"{WORKBENCH_BASE}/api/workbench/upload-xp",
            data=body,
            headers={"content-type": ctype},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                payload = r.read()
                return self._send(r.status, payload, r.headers.get("content-type", "application/json"))
        except urllib.error.HTTPError as e:
            return self._send(e.code, e.read() or b'{"error":"upstream"}')
        except Exception as e:
            return self._send(502, json.dumps({"error": str(e)}))

    def _proxy_fetch(self):
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(body or b"{}")
        except Exception:
            return self._send(400, '{"error":"bad json"}')
        url = (data.get("url") or "").strip()
        if not url:
            return self._send(400, '{"error":"missing url"}')
        url = _convert_drive_url(url)

        err = _check_fetch_url(url)
        if err:
            return self._send(400, json.dumps({"error": f"blocked: {err}"}))

        # No redirect following — prevents redirect-based SSRF
        no_redirect = urllib.request.build_opener(urllib.request.HTTPRedirectHandler())
        no_redirect.handlers = [h for h in no_redirect.handlers
                                  if not isinstance(h, urllib.request.HTTPRedirectHandler)]

        try:
            req = urllib.request.Request(
                url,
                headers={"user-agent": "xp-upload-helper/1"},
            )
            with no_redirect.open(req, timeout=FETCH_TIMEOUT_S) as r:
                # Respect Content-Length if present to avoid large-payload surprise
                cl = r.headers.get("content-length")
                if cl and int(cl) > FETCH_MAX_BYTES:
                    return self._send(413, json.dumps({"error": f"remote file too large ({cl} bytes, max {FETCH_MAX_BYTES})"}))
                content = r.read(FETCH_MAX_BYTES + 1)
                if len(content) > FETCH_MAX_BYTES:
                    return self._send(413, json.dumps({"error": f"remote file exceeds {FETCH_MAX_BYTES} byte limit"}))
                name = url.rsplit("/", 1)[-1].split("?", 1)[0] or "fetched.xp"
        except urllib.error.HTTPError as e:
            return self._send(502, json.dumps({"error": f"fetch failed: HTTP {e.code}"}))
        except Exception as e:
            return self._send(502, json.dumps({"error": f"fetch failed: {e}"}))

        boundary = "----ipadhelper" + os.urandom(8).hex()
        parts = []

        def field(fname, value):
            parts.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{fname}\"\r\n\r\n{value}\r\n".encode()
            )

        def file_field(fname, filename, content_bytes):
            parts.append(
                (
                    f"--{boundary}\r\n"
                    f"Content-Disposition: form-data; name=\"{fname}\"; filename=\"{filename}\"\r\n"
                    f"Content-Type: application/octet-stream\r\n\r\n"
                ).encode()
                + content_bytes
                + b"\r\n"
            )

        file_field("file", name, content)
        field("angles", "8")
        field("anims", "1")
        field("anims", "8")
        field("projs", "2")
        field("cell_w", "8")
        field("cell_h", "16")
        parts.append(f"--{boundary}--\r\n".encode())
        mp_body = b"".join(parts)
        ctype = f"multipart/form-data; boundary={boundary}"

        try:
            req = urllib.request.Request(
                f"{WORKBENCH_BASE}/api/workbench/upload-xp",
                data=mp_body,
                headers={"content-type": ctype},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=60) as r:
                payload = r.read()
                return self._send(r.status, payload, r.headers.get("content-type", "application/json"))
        except urllib.error.HTTPError as e:
            return self._send(e.code, e.read() or b'{"error":"upstream"}')
        except Exception as e:
            return self._send(502, json.dumps({"error": str(e)}))


def main():
    srv = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), H)
    print(f"iPad upload helper on http://{LISTEN_HOST}:{LISTEN_PORT}  -> upstream {WORKBENCH_BASE}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
