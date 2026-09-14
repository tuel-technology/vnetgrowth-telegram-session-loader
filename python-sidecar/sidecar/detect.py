from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any


@dataclass
class BundleParts:
    root: str
    tdata_dir: str | None
    session_path: str | None
    meta: dict[str, Any]
    cloud_password: str | None


_HEX_DIR = re.compile(r"^[0-9A-Fa-f]{16}$")


def _resolve_bundle_root(root: str) -> str:
    """Descend into single nested folders (common in HStock archives)."""
    current = os.path.abspath(root)
    for _ in range(6):
        try:
            entries = [
                e
                for e in os.listdir(current)
                if e not in (".DS_Store", "__MACOSX") and not e.startswith(".")
            ]
        except OSError:
            break
        if len(entries) != 1:
            break
        only = os.path.join(current, entries[0])
        if os.path.isdir(only):
            current = only
            continue
        break
    return current


def _folder_nonempty(path: str) -> bool:
    try:
        return len(os.listdir(path)) > 0
    except OSError:
        return False


def _looks_like_tdata_dir(path: str) -> bool:
    if not os.path.isdir(path) or not _folder_nonempty(path):
        return False

    name = os.path.basename(path.rstrip(os.sep)).lower()
    if name == "tdata":
        return True

    try:
        entries = os.listdir(path)
    except OSError:
        return False

    lowered = {e.lower() for e in entries}
    if "key_data" in lowered or "key_datas" in lowered or "key_data0" in lowered:
        return True

    for entry in entries:
        if _HEX_DIR.match(entry):
            sub = os.path.join(path, entry)
            if os.path.isdir(sub):
                return True

    return False


def _find_tdata(root: str) -> str | None:
    preferred: str | None = None
    fallback: str | None = None
    for dirpath, dirnames, _ in os.walk(root):
        for dirname in list(dirnames):
            candidate = os.path.join(dirpath, dirname)
            if not _looks_like_tdata_dir(candidate):
                continue
            if dirname.lower() == "tdata":
                preferred = candidate
            elif fallback is None:
                fallback = candidate
    return preferred or fallback


def _is_sqlite_session(path: str) -> bool:
    try:
        with open(path, "rb") as f:
            header = f.read(16)
        return header.startswith(b"SQLite format 3")
    except OSError:
        return False


def _find_session_files(root: str) -> list[str]:
    found: list[str] = []
    for dirpath, _, filenames in os.walk(root):
        for filename in filenames:
            if not filename.endswith(".session"):
                continue
            if filename.endswith(".session-journal"):
                continue
            full = os.path.join(dirpath, filename)
            if _is_sqlite_session(full):
                found.append(full)
    found.sort(key=lambda p: (-os.path.getsize(p), len(p)))
    return found


def _load_json_meta(root: str) -> dict[str, Any]:
    candidates: list[str] = []
    for dirpath, _, filenames in os.walk(root):
        for filename in filenames:
            lower = filename.lower()
            if lower.endswith(".json") or lower in ("account.json", "data.json"):
                candidates.append(os.path.join(dirpath, filename))

    candidates.sort(key=lambda p: (0 if "account" in p.lower() else 1, len(p)))

    for path in candidates:
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        if any(
            k in data
            for k in (
                "app_id",
                "appId",
                "session_file",
                "sessionFile",
                "phone",
                "twoFA",
                "two_fa",
            )
        ):
            return data

    for dirpath, _, filenames in os.walk(root):
        for filename in filenames:
            if not filename.lower().endswith(".txt"):
                continue
            path = os.path.join(dirpath, filename)
            try:
                raw = open(path, encoding="utf-8", errors="ignore").read().strip()
            except OSError:
                continue
            if raw.startswith("{") and raw.endswith("}"):
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(data, dict) and (
                    "app_id" in data or "appId" in data or "phone" in data
                ):
                    return data
    return {}


def _load_cloud_password(root: str, meta: dict[str, Any]) -> str | None:
    for key in ("twoFA", "two_fa", "password", "cloud_password", "cloudPassword"):
        val = meta.get(key)
        if val is not None and str(val).strip():
            return str(val).strip()

    names = {
        "2fa.txt",
        "twofa.txt",
        "password.txt",
        "cloud password.txt",
        "cloud_password.txt",
        "2fa",
    }
    for dirpath, _, filenames in os.walk(root):
        for filename in filenames:
            if filename.lower() not in names:
                continue
            path = os.path.join(dirpath, filename)
            try:
                text = open(path, encoding="utf-8", errors="ignore").read().strip()
            except OSError:
                continue
            if text:
                return text.splitlines()[0].strip()
    return None


def _session_from_meta(root: str, meta: dict[str, Any], sessions: list[str]) -> str | None:
    session_file = meta.get("session_file") or meta.get("sessionFile")
    if isinstance(session_file, str) and session_file.strip():
        base = session_file.strip()
        if not base.endswith(".session"):
            base = f"{base}.session"
        for dirpath, _, filenames in os.walk(root):
            if os.path.basename(base) in filenames:
                return os.path.join(dirpath, os.path.basename(base))
            joined = os.path.join(dirpath, base)
            if os.path.isfile(joined):
                return joined

    return sessions[0] if sessions else None


def _delivery_is_link_only(meta: dict[str, Any]) -> bool:
    if not meta:
        return False
    for key in ("url", "link", "download", "download_url"):
        val = meta.get(key)
        if isinstance(val, str) and val.strip().lower().startswith("http"):
            return True
    raw = meta.get("raw") or meta.get("message")
    if isinstance(raw, str) and "drive.google.com" in raw.lower():
        return True
    return False


def inspect_bundle(input_dir: str) -> BundleParts:
    root = _resolve_bundle_root(os.path.abspath(input_dir))
    if not os.path.isdir(root):
        raise ValueError("Input path is not a directory.")

    tdata_dir = _find_tdata(root)
    sessions = _find_session_files(root)
    meta = _load_json_meta(root)
    session_path = _session_from_meta(root, meta, sessions)
    cloud_password = _load_cloud_password(root, meta)

    if _delivery_is_link_only(meta) and not tdata_dir and not session_path:
        raise ValueError(
            "This archive only contains a download link or JSON pointer. "
            "Download the Google Drive file from your order, extract that archive, then import the extracted folder here."
        )

    return BundleParts(
        root=root,
        tdata_dir=tdata_dir,
        session_path=session_path,
        meta=meta,
        cloud_password=cloud_password,
    )
