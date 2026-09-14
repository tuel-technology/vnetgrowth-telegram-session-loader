from __future__ import annotations

import asyncio
import sys
from typing import Any, Literal

from opentele.tl import TelegramClient
from telethon.errors import (
    AuthKeyUnregisteredError,
    SessionPasswordNeededError,
    UserDeactivatedBanError,
    UserDeactivatedError,
)
from telethon.tl.functions.help import GetConfigRequest
from telethon.tl.functions.users import GetFullUserRequest
from telethon.tl.types import InputUserSelf

from sidecar.convert import CLIENT_KWARGS, _meta_api, _meta_device_kwargs, _session_stem
from sidecar.session_sqlite import repair_telethon_session_sqlite

VERIFY_TIMEOUT_SEC = 28

ProbeStatus = Literal["live", "live_2fa", "revoked", "deactivated", "inconclusive", "unknown"]


def _log(msg: str) -> None:
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def _revoked_message() -> str:
    return (
        "Telegram rejected this session (AUTH_KEY_UNREGISTERED). "
        "The order is expired or revoked. Ask the seller for a replacement before importing."
    )


async def _probe_session_after_connect(
    client: TelegramClient,
    json_user_id: int | None,
) -> tuple[ProbeStatus, int | None, str | None]:
    """
    HStock Telethon sessions often return get_me() = None while is_user_authorized() is False,
    even when the auth key is dead. User/self RPCs surface AuthKeyUnregisteredError reliably.
    """
    try:
        me = await asyncio.wait_for(client.get_me(), timeout=VERIFY_TIMEOUT_SEC)
        if me is not None:
            return "live", me.id, me.username
    except AuthKeyUnregisteredError:
        return "revoked", json_user_id, None
    except (UserDeactivatedError, UserDeactivatedBanError):
        return "deactivated", json_user_id, None
    except SessionPasswordNeededError:
        return "live_2fa", json_user_id, None

    try:
        await asyncio.wait_for(client(GetFullUserRequest(InputUserSelf())), timeout=VERIFY_TIMEOUT_SEC)
        uid = json_user_id
        if uid is not None:
            return "live", uid, None
        return "live", None, None
    except AuthKeyUnregisteredError:
        return "revoked", json_user_id, None
    except (UserDeactivatedError, UserDeactivatedBanError):
        return "deactivated", json_user_id, None
    except SessionPasswordNeededError:
        return "live_2fa", json_user_id, None

    try:
        await asyncio.wait_for(client(GetConfigRequest()), timeout=VERIFY_TIMEOUT_SEC)
    except AuthKeyUnregisteredError:
        return "revoked", json_user_id, None

    if json_user_id is not None:
        client.UserId = json_user_id
        try:
            me = await asyncio.wait_for(client.get_me(), timeout=VERIFY_TIMEOUT_SEC)
            if me is not None:
                return "live", me.id, me.username
        except AuthKeyUnregisteredError:
            return "revoked", json_user_id, None
        except SessionPasswordNeededError:
            return "live_2fa", json_user_id, None

    return "revoked", json_user_id, None


async def verify_session_with_telegram(session_path: str, meta: dict[str, Any]) -> str | None:
    """
    Returns None if session looks live, or a user-facing error string if Telegram rejects it.
    On network timeout, returns None (caller may still install tdata and rely on Desktop logs).
    """
    api_id, api_hash = _meta_api(meta)
    if api_id is None or not api_hash:
        return None

    json_user_id = meta.get("id")
    try:
        json_user_id = int(json_user_id) if json_user_id is not None else None
    except (TypeError, ValueError):
        json_user_id = None

    stem = _session_stem(session_path)
    repair_telethon_session_sqlite(f"{stem}.session")
    device_kwargs = _meta_device_kwargs(meta)
    client = TelegramClient(
        stem,
        api_id=api_id,
        api_hash=api_hash,
        **CLIENT_KWARGS,
        **device_kwargs,
    )

    try:
        await asyncio.wait_for(client.connect(), timeout=VERIFY_TIMEOUT_SEC)
        status, _, _ = await _probe_session_after_connect(client, json_user_id)
        if status == "live" or status == "live_2fa":
            _log("Session verified with Telegram.")
            return None
        if status == "revoked":
            return (
                "Telegram rejected this session (AUTH_KEY_UNREGISTERED). "
                "The .session in your order is expired or revoked. Contact the seller for a replacement."
            )
        if status == "deactivated":
            return "This Telegram account is deactivated or banned according to Telegram."
        return None
    except asyncio.TimeoutError:
        _log(
            "Could not reach Telegram to verify the session (network timeout). "
            "Continuing with tdata install."
        )
        return None
    except AuthKeyUnregisteredError:
        return (
            "Telegram rejected this session (AUTH_KEY_UNREGISTERED). "
            "The .session in your order is expired or revoked. Contact the seller for a replacement."
        )
    except Exception as exc:  # noqa: BLE001
        _log(f"Session verify skipped: {exc.__class__.__name__}: {exc}")
        return None
    finally:
        try:
            await asyncio.wait_for(client.disconnect(), timeout=5)
        except Exception:
            pass


def verify_session_with_telegram_sync(session_path: str, meta: dict[str, Any]) -> str | None:
    return asyncio.run(verify_session_with_telegram(session_path, meta))


def _result_from_probe(
    status: ProbeStatus,
    phone: Any,
    json_user_id: Any,
    user_id: int | None,
    username: str | None,
) -> dict[str, Any]:
    phone_s = str(phone) if phone is not None else None
    if status == "live":
        uid = user_id if user_id is not None else json_user_id
        return {
            "ok": True,
            "status": "live",
            "message": f"Session is live on Telegram (user id {uid}). Safe to import and open Desktop.",
            "phone": phone_s,
            "userId": uid,
            "username": username,
        }
    if status == "live_2fa":
        return {
            "ok": True,
            "status": "live_2fa",
            "message": "Session is live (2FA enabled). Import should still work in Telegram Desktop.",
            "phone": phone_s,
            "userId": json_user_id,
        }
    if status == "revoked":
        return {
            "ok": False,
            "status": "revoked",
            "message": _revoked_message(),
            "phone": phone_s,
            "userId": json_user_id,
        }
    if status == "deactivated":
        return {
            "ok": False,
            "status": "deactivated",
            "message": "Telegram reports this account is deactivated or banned.",
            "phone": phone_s,
            "userId": json_user_id,
        }
    return {
        "ok": False,
        "status": "unknown",
        "message": "Could not confirm session status with Telegram. Try import or test again.",
        "phone": phone_s,
        "userId": json_user_id,
    }


async def evaluate_session(session_path: str, meta: dict[str, Any]) -> dict[str, Any]:
    """Full test report for UI (does not build tdata or launch Telegram)."""
    api_id, api_hash = _meta_api(meta)
    phone = meta.get("phone")
    json_user_id = meta.get("id")

    if api_id is None or not api_hash:
        return {
            "ok": False,
            "status": "missing_api_meta",
            "message": "JSON meta is missing app_id / app_hash next to the .session file.",
            "phone": str(phone) if phone is not None else None,
            "userId": json_user_id,
        }

    try:
        json_uid = int(json_user_id) if json_user_id is not None else None
    except (TypeError, ValueError):
        json_uid = None

    stem = _session_stem(session_path)
    repair_telethon_session_sqlite(f"{stem}.session")
    device_kwargs = _meta_device_kwargs(meta)
    client = TelegramClient(
        stem,
        api_id=api_id,
        api_hash=api_hash,
        **CLIENT_KWARGS,
        **device_kwargs,
    )

    if client.session is None or client.session.auth_key is None:
        return {
            "ok": False,
            "status": "no_auth_key",
            "message": "The .session file has no auth key (empty or corrupt session).",
            "phone": str(phone) if phone is not None else None,
            "userId": json_user_id,
        }

    _log("Local check: auth key present in .session file.")
    _log("Contacting Telegram to verify the session (up to ~30s)...")

    try:
        await asyncio.wait_for(client.connect(), timeout=VERIFY_TIMEOUT_SEC)
        status, user_id, username = await _probe_session_after_connect(client, json_uid)
        if status == "live":
            _log(f"Telegram accepted the session (user id {user_id}).")
        elif status == "revoked":
            _log("Telegram rejected the session (AUTH_KEY_UNREGISTERED).")
        return _result_from_probe(status, phone, json_user_id, user_id, username)
    except asyncio.TimeoutError:
        return {
            "ok": False,
            "status": "inconclusive",
            "message": (
                "Could not reach Telegram in time (network or firewall). "
                "The .session file looks structurally valid, but live/revoked status is unknown. Try again on a stable network."
            ),
            "phone": str(phone) if phone is not None else None,
            "userId": json_user_id,
        }
    except AuthKeyUnregisteredError:
        return _result_from_probe("revoked", phone, json_user_id, None, None)
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "status": "error",
            "message": f"Session test failed: {exc.__class__.__name__}: {exc}",
            "phone": str(phone) if phone is not None else None,
            "userId": json_user_id,
        }
    finally:
        try:
            await asyncio.wait_for(client.disconnect(), timeout=5)
        except Exception:
            pass


def evaluate_session_sync(session_path: str, meta: dict[str, Any]) -> dict[str, Any]:
    return asyncio.run(evaluate_session(session_path, meta))
