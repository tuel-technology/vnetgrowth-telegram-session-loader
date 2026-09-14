from __future__ import annotations

import argparse
import json
import os
import sys

from sidecar.convert import build_tdata
from sidecar.detect import inspect_bundle
from sidecar.validate import evaluate_session_sync


def _log(msg: str) -> None:
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def cmd_import_bundle(input_dir: str, out_dir: str) -> int:
    try:
        _log("Scanning bundle...")
        parts = inspect_bundle(input_dir)
        _log(
            f"Bundle root: {parts.root} | tdata: {bool(parts.tdata_dir)} | "
            f"session: {bool(parts.session_path)} | json meta: {bool(parts.meta)}"
        )

        tdata_out = os.path.join(os.path.abspath(out_dir), "tdata")
        if parts.tdata_dir:
            _log("Copying tdata (no network)...")
        elif parts.session_path:
            _log("Converting .session to tdata (may contact Telegram, ~30s max)...")
        else:
            _log("No tdata or session found.")

        method = build_tdata(
            parts.tdata_dir,
            parts.session_path,
            parts.meta,
            tdata_out,
            parts.cloud_password,
        )
        phone = parts.meta.get("phone")
        _emit(
            {
                "ok": True,
                "method": method,
                "tdataPath": tdata_out,
                "phone": str(phone) if phone is not None else None,
            }
        )
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        try:
            parts = inspect_bundle(input_dir)
            _emit(
                {
                    "ok": False,
                    "error": str(exc),
                    "detail": exc.__class__.__name__,
                    "diagnostic": {
                        "root": parts.root,
                        "hasTdata": bool(parts.tdata_dir),
                        "tdataPath": parts.tdata_dir,
                        "sessionPath": parts.session_path,
                        "hasMetaJson": bool(parts.meta),
                        "hasCloudPassword": bool(parts.cloud_password),
                    },
                }
            )
        except Exception:
            _emit({"ok": False, "error": str(exc), "detail": exc.__class__.__name__})
        return 1


def cmd_test_bundle(input_dir: str) -> int:
    try:
        _log("Scanning bundle for session test...")
        parts = inspect_bundle(input_dir)
        _log(
            f"Bundle root: {parts.root} | tdata: {bool(parts.tdata_dir)} | "
            f"session: {bool(parts.session_path)} | json meta: {bool(parts.meta)}"
        )

        if parts.tdata_dir and not parts.session_path:
            phone = parts.meta.get("phone")
            _emit(
                {
                    "ok": True,
                    "status": "tdata_only",
                    "message": (
                        "Bundle contains a tdata folder only (no .session). "
                        "Skipping Telethon check. Use Import to install into portable Telegram."
                    ),
                    "phone": str(phone) if phone is not None else None,
                    "diagnostic": {
                        "root": parts.root,
                        "hasTdata": True,
                        "sessionPath": None,
                        "hasMetaJson": bool(parts.meta),
                    },
                }
            )
            return 0

        if not parts.session_path:
            _emit(
                {
                    "ok": False,
                    "status": "no_session",
                    "message": (
                        "No Telethon .session file found. Extract the full archive (zip or rar), "
                        "not only JSON from the website."
                    ),
                    "diagnostic": {
                        "root": parts.root,
                        "hasTdata": bool(parts.tdata_dir),
                        "sessionPath": None,
                        "hasMetaJson": bool(parts.meta),
                    },
                }
            )
            return 1

        if not parts.meta:
            _emit(
                {
                    "ok": False,
                    "status": "missing_json",
                    "message": "No matching .json meta file found next to the .session file.",
                    "diagnostic": {
                        "root": parts.root,
                        "hasTdata": bool(parts.tdata_dir),
                        "sessionPath": parts.session_path,
                        "hasMetaJson": False,
                    },
                }
            )
            return 1

        result = evaluate_session_sync(parts.session_path, parts.meta)
        result["diagnostic"] = {
            "root": parts.root,
            "hasTdata": bool(parts.tdata_dir),
            "sessionPath": parts.session_path,
            "hasMetaJson": True,
        }
        _emit(result)
        return 0 if result.get("ok") else 1
    except Exception as exc:  # noqa: BLE001
        _emit({"ok": False, "status": "error", "message": str(exc), "detail": exc.__class__.__name__})
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(prog="vnetgrowth-telegram-sidecar")
    sub = parser.add_subparsers(dest="command", required=True)

    imp = sub.add_parser("import-bundle", help="Build tdata from order bundle")
    imp.add_argument("--input", required=True, help="Extracted order folder")
    imp.add_argument("--out", required=True, help="Output directory (tdata created inside)")

    tst = sub.add_parser("test-bundle", help="Verify session with Telegram (no tdata, no Desktop)")
    tst.add_argument("--input", required=True, help="Extracted order folder")

    args = parser.parse_args()
    if args.command == "import-bundle":
        return cmd_import_bundle(args.input, args.out)
    if args.command == "test-bundle":
        return cmd_test_bundle(args.input)
    return 2
