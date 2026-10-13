#!/usr/bin/env python3
"""PreToolUse hook that blocks Computer Use during ASCIIID work.

ASCIIID already owns native, same-frame observation through the artifact
snapshot endpoint. Visible authoring actions belong to the registered HTML
controls and their product harness. macOS application focus, screenshots,
mouse input, and keyboard input through Computer Use are neither owner.

Hook interface:
  stdin: Claude PreToolUse JSON
  stdout: {"blocked": true, "message": "..."} when blocked
  exit 0: allow; exit 2: block
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


_COMPUTER_USE_RE = re.compile(
    r"(?:^|__)computer(?:-|_)use(?:__|$)",
    re.IGNORECASE,
)
_ASCIIID_CONTEXT_RE = re.compile(
    r"""
    \basciiid\b
    |\basciid\b
    |\bterm\+\+
    |\btermpp\b
    |\bfinal[ _-]ascii\b
    |\bfl[- ](?:4260|4512|4548|4588|4652)\b
    |glyph[-_/ ]rendering
    |mesh[_ -]feature[_ -]progression
    |native[_ -]progression[_ -]product[_ -]proof
    |/api/v1/artifacts/capture
    |\brendered_buffer\b
    |\bbridge_facts\b
    |\bcell_trace\b
    |\bpiet[aà]\b
    """,
    re.IGNORECASE | re.VERBOSE,
)
_TRANSCRIPT_TAIL_BYTES = 262_144
_RECENT_TEXT_RECORDS = 12

_BLOCK_MESSAGE = (
    "[maintainer:asciiid-computer-use-guard] BLOCKED: Computer Use cannot "
    "control ASCIIID. Native observation owner: POST /api/v1/artifacts/capture, "
    "then read rendered_buffer, bridge_facts, cell_trace, and the joined "
    "final-frame RGBA. User action owner: the registered visible HTML control "
    "driven by the existing product harness. Fix launcher liveness inside the "
    "launcher; window-focus choreography is not evidence."
)


def _extract_message_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for block in value:
            if isinstance(block, str):
                parts.append(block)
                continue
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                parts.append(str(block.get("text", "")))
        return "\n".join(parts)
    if isinstance(value, dict):
        if "content" in value:
            return _extract_message_text(value["content"])
        if "text" in value:
            return str(value["text"])
    return ""


def _tail_jsonl_records(path: Path) -> list[dict[str, Any]]:
    try:
        size = path.stat().st_size
        offset = max(0, size - _TRANSCRIPT_TAIL_BYTES)
        records: list[dict[str, Any]] = []
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            if offset:
                handle.seek(offset)
                handle.readline()
            for line in handle:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(record, dict):
                    records.append(record)
        return records
    except OSError:
        return []


def recent_transcript_text(path_value: Any) -> str:
    if not isinstance(path_value, str) or not path_value:
        return ""
    records = _tail_jsonl_records(Path(path_value))
    texts: list[str] = []
    for record in records:
        if record.get("type") not in {"user", "assistant"}:
            continue
        text = _extract_message_text(record.get("message", ""))
        if text.strip():
            texts.append(text)
    return "\n".join(texts[-_RECENT_TEXT_RECORDS:])


def is_computer_use_tool(tool_name: Any) -> bool:
    return isinstance(tool_name, str) and bool(_COMPUTER_USE_RE.search(tool_name))


def asciiid_context(payload: dict[str, Any]) -> bool:
    tool_input = payload.get("tool_input", {})
    try:
        input_text = json.dumps(tool_input, ensure_ascii=False, sort_keys=True)
    except (TypeError, ValueError):
        input_text = str(tool_input)
    transcript_text = recent_transcript_text(payload.get("transcript_path"))
    return bool(_ASCIIID_CONTEXT_RE.search(f"{input_text}\n{transcript_text}"))


def hook_findings(payload: dict[str, Any]) -> list[str]:
    if not is_computer_use_tool(payload.get("tool_name")):
        return []
    if not asciiid_context(payload):
        return []
    return ["ASCIIID_COMPUTER_USE_FORBIDDEN"]


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        sys.exit(0)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        sys.exit(0)
    if not isinstance(payload, dict):
        sys.exit(0)
    if not hook_findings(payload):
        sys.exit(0)

    sys.stderr.write(_BLOCK_MESSAGE + "\n")
    print(json.dumps({"blocked": True, "message": _BLOCK_MESSAGE}))
    sys.exit(2)


if __name__ == "__main__":
    main()
