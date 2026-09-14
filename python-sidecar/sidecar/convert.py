from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile
from typing import Any, Callable, TypeVar

from opentele.api import API, UseCurrentSession
from opentele.tl import TelegramClient

T = TypeVar("T")

NETWORK_TIMEOUT_SEC = 35
CLIENT_KWARGS = {
    "timeout": 12,
    "connection_retries": 2,
    "request_retries": 2,
    "retry_delay": 1,
}


def _log(msg: str) -> None:
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def _tdata_system() -> str:
    raw = os.environ.get("VNETGROWTH_TDATA_SYSTEM", "windows").lower()
    if raw in ("darwin", "mac", "macos"):
        return "macos"
    if raw == "linux":
        return "linux"
    return "windows"


def _meta_api(meta: dict[str, Any]) -> tuple[int | None, str | None]:
    app_id = meta.get("app_id") if meta.get("app_id") is not None else meta.get("appId")
    app_hash = meta.get("app_hash") if meta.get("app_hash") is not None else meta.get("appHash")
    try:
        api_id = int(app_id) if app_id is not None else None
    except (TypeError, ValueError):
        api_id = None
    api_hash = str(app_hash).strip() if app_hash is not None else None
    return api_id, api_hash or None


def _meta_user_id(meta: dict[str, Any]) -> int | None:
    raw = meta.get("id") or meta.get("user_id") or meta.get("userId")
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def _meta_device_kwargs(meta: dict[str, Any]) -> dict[str, str]:
    kwargs: dict[str, str] = {}
    if meta.get("device"):
        kwargs["device_model"] = str(meta["device"])
    if meta.get("sdk"):
        kwargs["system_version"] = str(meta["sdk"])
    if meta.get("app_version"):
        kwargs["app_version"] = str(meta["app_version"])
    if meta.get("lang_pack"):
        kwargs["lang_code"] = str(meta["lang_pack"])
    if meta.get("system_lang_pack"):
        kwargs["system_lang_code"] = str(meta["system_lang_pack"])
    return kwargs


def _session_stem(session_path: str) -> str:
    if session_path.endswith(".session"):
        return session_path[: -len(".session")]
    return session_path


def _session_unique_id(session_path: str) -> str:
    base = os.path.basename(_session_stem(session_path))
    return base or "session"


def _session_work_copy(session_path: str) -> tuple[str, str]:
    """Copy session to a temp dir so retries are not blocked by file locks."""
    tmp = tempfile.mkdtemp(prefix="vng-session-")
    base = os.path.basename(_session_stem(session_path))
    dest_stem = os.path.join(tmp, base)
    shutil.copy2(session_path, f"{dest_stem}.session")
    journal = f"{session_path}-journal"
    if os.path.isfile(journal):
        shutil.copy2(journal, f"{dest_stem}.session-journal")
    return dest_stem, tmp


def copy_tdata(source_tdata: str, out_dir: str) -> None:
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    shutil.copytree(source_tdata, out_dir)


async def _wait(coro: asyncio.Future[T], label: str) -> T:
    try:
        return await asyncio.wait_for(coro, timeout=NETWORK_TIMEOUT_SEC)
    except asyncio.TimeoutError as exc:
        raise TimeoutError(f"{label} timed out after {NETWORK_TIMEOUT_SEC}s") from exc


def _session_has_auth_key(client: TelegramClient) -> bool:
    return client.session is not None and client.session.auth_key is not None


async def _try_offline_tdata(
    client: TelegramClient,
    user_id: int,
    unique_id: str,
    out_dir: str,
    label: str,
) -> bool:
    """UseCurrentSession + UserId from JSON avoids Telegram network when auth key is in the file."""
    if not _session_has_auth_key(client):
        return False
    client.UserId = user_id
    _log(f"{label}: offline tdata build (no Telegram connect)...")
    tdesk = await client.ToTDesktop(
        flag=UseCurrentSession,
        api=API.TelegramDesktop.Generate(system=_tdata_system(), unique_id=unique_id),
    )
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    ok = tdesk.SaveTData(out_dir)
    if ok:
        _log(f"{label}: offline success")
    return bool(ok)


def _client_factories(work_stem: str, meta: dict[str, Any]) -> list[tuple[str, Callable[[], TelegramClient]]]:
    unique_id = _session_unique_id(f"{work_stem}.session")
    api_id, api_hash = _meta_api(meta)
    device_kwargs = _meta_device_kwargs(meta)
    tdata_system = _tdata_system()
    factories: list[tuple[str, Callable[[], TelegramClient]]] = []

    if api_id is not None and api_hash:
        factories.append(
            (
                "json_api_id_hash",
                lambda: TelegramClient(
                    work_stem,
                    api_id=api_id,
                    api_hash=api_hash,
                    **CLIENT_KWARGS,
                    **device_kwargs,
                ),
            )
        )

    factories.append(
        (
            f"desktop_api_{tdata_system}",
            lambda: TelegramClient(
                work_stem,
                api=API.TelegramDesktop.Generate(system=tdata_system, unique_id=unique_id),
                **CLIENT_KWARGS,
                **device_kwargs,
            ),
        )
    )

    return factories


async def _convert_session_to_tdata(
    session_path: str,
    meta: dict[str, Any],
    out_dir: str,
) -> None:
    errors: list[str] = []
    user_id = _meta_user_id(meta)
    work_stem, tmp_dir = _session_work_copy(session_path)
    _log(f"Using temp session copy ({_tdata_system()} tdata target)")

    try:
        unique_id = _session_unique_id(session_path)
        for label, factory in _client_factories(work_stem, meta):
            _log(f"Trying {label}...")
            client = factory()
            try:
                if user_id is not None and await _try_offline_tdata(
                    client, user_id, unique_id, out_dir, label
                ):
                    return

                if not _session_has_auth_key(client):
                    errors.append(f"{label}: session has no auth key")
                    continue

                await _wait(client.connect(), f"{label} connect")

                if user_id is not None:
                    client.UserId = user_id
                    _log(f"{label}: using user id {user_id} from JSON")

                _log(f"{label}: building tdata for {_tdata_system()} Telegram Desktop...")
                tdesk = await _wait(client.ToTDesktop(flag=UseCurrentSession), f"{label} ToTDesktop")
                if os.path.exists(out_dir):
                    shutil.rmtree(out_dir)
                ok = tdesk.SaveTData(out_dir)
                await _wait(client.disconnect(), f"{label} disconnect")
                if not ok:
                    errors.append(f"{label}: SaveTData failed")
                    continue
                _log(f"{label}: success")
                return
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{label}: {exc}")
                _log(f"{label} failed: {exc}")
                try:
                    await asyncio.wait_for(client.disconnect(), timeout=5)
                except Exception:
                    pass
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    hint = (
        "Ensure the folder includes the matching .json next to the .session file. "
        "If import worked once, retry will reuse cached tdata automatically."
    )
    raise RuntimeError(
        "Could not convert .session to tdata. "
        f"Attempts: {'; '.join(errors)}. {hint}"
    )


def build_tdata(
    parts_tdata: str | None,
    session_path: str | None,
    meta: dict[str, Any],
    out_dir: str,
    cloud_password: str | None,
) -> str:
    del cloud_password
    os.makedirs(os.path.dirname(out_dir) or out_dir, exist_ok=True)

    if parts_tdata and os.path.isdir(parts_tdata):
        _log("Copying tdata folder (no network)...")
        copy_tdata(parts_tdata, out_dir)
        return "tdata_copy"

    if not session_path:
        raise RuntimeError(
            "No tdata folder and no Telethon .session file found. "
            "Extract the full HStock archive (zip or rar), not only the JSON from the website."
        )

    asyncio.run(_convert_session_to_tdata(session_path, meta, out_dir))

    from sidecar.validate import verify_session_with_telegram_sync

    verify_error = verify_session_with_telegram_sync(session_path, meta)
    if verify_error:
        raise RuntimeError(verify_error)

    return "session_converted"
