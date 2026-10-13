#!/usr/bin/env python3
"""Context-bloat guard hook (Claude Code + Codex CLI).

Two banned behaviors, both measured to burn hundreds of millions of tokens in
real sessions (Codex rollout 2026-08-05: 326M tokens, 420MB of inline base64
PNG tool output, 2202 turns):

1. INLINE IMAGES IN TOOL OUTPUT. Scripts/proof tools must never return image
   bytes into the conversation (base64, data URIs, cat of a PNG). Once an
   image lands in history it is re-sent on every later turn. Images must be
   written to a file path; the agent views them through a downsampling image
   reader instead.

2. POLLING/BABYSIT LOOPS. `wait`-tool loops and shell `while/until/for` +
   `sleep` polling turn one task into thousands of context-resending turns.
   Long-running work must be launched detached with a receipt (pid, log path,
   artifact path) and checked once.

Modes:
  default      PreToolUse payload on stdin -> block banned tool calls.
  --post       PostToolUse payload on stdin -> block (feedback) when the tool
               OUTPUT already contains inline image data. Raw stdin is scanned
               without JSON parsing so oversized/truncated payloads are safe.

Hook protocol (both hosts): exit 0 = allow; exit 2 = block, stderr is shown
to the model. A JSON decision is also printed on stdout for hosts that parse
it ({"permissionDecision":"deny",...} pre-tool, {"decision":"block",...}
post-tool).
"""
from __future__ import annotations

import json
import re
import sys

MAX_STDIN_BYTES = 64 * 1024 * 1024  # cap reads; huge tool outputs stay cheap

TAG = "[maintainer:context-bloat]"

# --- tool classification ---------------------------------------------------

# Tools whose input is a shell command worth scanning.
_COMMAND_TOOL_RE = re.compile(r"(?i)(bash|shell|exec|terminal|console|command)")

# Codex-style wait/poll tools by name.
_WAIT_TOOL_RE = re.compile(r"(?i)^(?:wait|sleep|poll|task_output_wait)$|_wait\b")

# --- banned command patterns ----------------------------------------------

_IMG_EXT = r"(?:png|jpe?g|gif|webp|bmp|tiff?|heic|icns)"

_INLINE_IMAGE_CMD_RES = [
    # base64-encoding an image file (either argument order)
    re.compile(rf"(?i)\bbase64\b[^\n]*\.{_IMG_EXT}\b"),
    re.compile(rf"(?i)\.{_IMG_EXT}\b[^\n]*\bbase64\b"),
    re.compile(rf"(?i)\bopenssl\s+(?:enc\s+-)?base64\b[^\n]*\.{_IMG_EXT}\b"),
    # dumping an image file to stdout
    re.compile(rf"(?i)\b(?:cat|xxd|hexdump|od|dd)\b[^\n]*\.{_IMG_EXT}\b"),
    # python one-liners embedding image bytes
    re.compile(r"(?i)\bb64encode\b"),
    re.compile(r"(?i)\bdata:image/"),
    re.compile(rf"(?i)\bPIL\b[^\n]*\b(?:tobytes|save)\s*\([^\n)*]*stdout"),
]

_POLLING_CMD_RES = [
    # a shell loop combined with sleep (either order, multi-line commands too)
    re.compile(r"(?is)\b(?:while|until)\b.*\bsleep\b"),
    re.compile(r"(?is)\bsleep\b.*\b(?:while|until)\b"),
    re.compile(r"(?is)\bfor\b[^\n;]*\b(?:in|\()\b.*\bsleep\b"),
    re.compile(r"(?i)\bwatch\s+(-[a-zA-Z]+\s+)*\S"),
]

# --- post-tool output patterns ---------------------------------------------

_DATA_URI_RE = re.compile(rb"data:image/[a-zA-Z]+;base64,")
# ~15KB of contiguous base64: hashes/tokens never get close, screenshots always do.
_B64_BLOB_RE = re.compile(rb"[A-Za-z0-9+/=\r\n]{20000,}")


def _read_stdin() -> bytes:
    return sys.stdin.buffer.read(MAX_STDIN_BYTES)


def _collect_strings(obj, out) -> None:
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            _collect_strings(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _collect_strings(v, out)


def _parse_payload(raw: bytes) -> dict:
    try:
        data = json.loads(raw.decode("utf-8", "replace"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _block(msg: str, post: bool) -> None:
    sys.stderr.write(msg + "\n")
    if post:
        print(json.dumps({"decision": "block", "reason": msg}))
    else:
        print(json.dumps({
            "permissionDecision": "deny",
            "permissionDecisionReason": msg,
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": msg,
            },
        }))
    sys.exit(2)


# --- checks ----------------------------------------------------------------


def _check_wait_tool(tool_name: str) -> None:
    if _WAIT_TOOL_RE.search(tool_name):
        _block(
            f"{TAG} BLOCKED tool `{tool_name}`: wait/poll loops are banned. "
            "A 2202-turn session with 116 wait calls burned 326M tokens. "
            "Launch the long task detached (background, with a receipt: pid + "
            "log path + artifact path), end your turn, and check the receipt "
            "once when it completes.",
            post=False,
        )


def _check_command_bloat(command_text: str) -> None:
    for rx in _INLINE_IMAGE_CMD_RES:
        m = rx.search(command_text)
        if m:
            _block(
                f"{TAG} BLOCKED inline-image command: `{m.group(0)[:80]}...`. "
                "Never pipe image bytes or base64 into tool output; the image "
                "is re-sent on every later turn (one session: 420MB of inline "
                "PNGs, 326M tokens). Write the image to a file, return only "
                "the path, and view it with a downsampling image reader "
                "(downscale to ~400px first if the model must see it).",
                post=False,
            )
    for rx in _POLLING_CMD_RES:
        m = rx.search(command_text)
        if m:
            _block(
                f"{TAG} BLOCKED polling loop: `{m.group(0)[:80]}...`. "
                "Shell sleep/watch polling loops turn one task into thousands "
                "of context-resending turns. Run the long task detached with "
                "a receipt (pid, log path, artifact path) and check it once "
                "when it completes instead of babysitting.",
                post=False,
            )


def _check_post_output(raw: bytes) -> None:
    m = _DATA_URI_RE.search(raw)
    if m:
        _block(
            f"{TAG} tool output contained an inline `data:image/...;base64` "
            "payload. This image now sits in conversation history and is "
            "re-sent (and re-billed) on every later turn. Do not do this "
            "again: make the tool/script write the image to a file path and "
            "return only the path; view images via a downsampling file "
            "reader (~400px), never inline.",
            post=True,
        )
    m = _B64_BLOB_RE.search(raw)
    if m:
        approx_kb = len(m.group(0)) * 3 // 4 // 1024
        _block(
            f"{TAG} tool output contained a ~{approx_kb}KB base64 blob "
            "(almost certainly an inline image/screenshot). Inline binary "
            "payloads are banned: they are re-sent on every later turn. "
            "Write the payload to a file, return only the path, and inspect "
            "it with a downsampling reader.",
            post=True,
        )


def main() -> None:
    post = "--post" in sys.argv[1:]
    raw = _read_stdin()
    if not raw.strip():
        sys.exit(0)

    if post:
        _check_post_output(raw)
        sys.exit(0)

    payload = _parse_payload(raw)
    tool_name = str(payload.get("tool_name") or payload.get("toolName") or "")
    _check_wait_tool(tool_name)

    tool_input = payload.get("tool_input") or payload.get("toolInput") or {}
    if tool_name and not _COMMAND_TOOL_RE.search(tool_name):
        sys.exit(0)
    texts: list[str] = []
    _collect_strings(tool_input, texts)
    if not texts and not tool_name:
        # Unknown payload shape: fall back to scanning the raw payload.
        texts = [raw.decode("utf-8", "replace")]
    _check_command_bloat("\n".join(texts))
    sys.exit(0)


if __name__ == "__main__":
    main()
