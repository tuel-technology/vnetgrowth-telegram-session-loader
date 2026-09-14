from __future__ import annotations

import os
import sqlite3

TELETHON_SESSION_VERSION = 8


def _session_table_columns(cur: sqlite3.Cursor) -> set[str]:
    cur.execute("PRAGMA table_info(sessions)")
    return {row[1] for row in cur.fetchall()}


def _read_db_version(cur: sqlite3.Cursor) -> int | None:
    cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='version'"
    )
    if not cur.fetchone():
        return None
    cur.execute("SELECT version FROM version LIMIT 1")
    row = cur.fetchone()
    if not row:
        return None
    try:
        return int(row[0])
    except (TypeError, ValueError):
        return None


def _set_db_version(cur: sqlite3.Cursor, version: int) -> None:
    cur.execute("DELETE FROM version")
    cur.execute("INSERT INTO version (version) VALUES (?)", (version,))


def repair_telethon_session_sqlite(session_path: str) -> bool:
    """
    Fix HStock exports that set version=8 but omit tmp_auth_key on the sessions table.

    Do not add tmp_auth_key when version < 8: Telethon upgrades that on open. Adding
    the column ourselves without bumping version causes duplicate column errors.
    """
    if not session_path.endswith(".session") or not os.path.isfile(session_path):
        return False

    conn = sqlite3.connect(session_path)
    changed = False
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
        )
        if not cur.fetchone():
            return False

        db_version = _read_db_version(cur)
        columns = _session_table_columns(cur)
        has_tmp_key = "tmp_auth_key" in columns

        if db_version is not None and db_version >= TELETHON_SESSION_VERSION and not has_tmp_key:
            try:
                cur.execute("ALTER TABLE sessions ADD COLUMN tmp_auth_key BLOB")
                changed = True
            except sqlite3.OperationalError as exc:
                if "duplicate column" not in str(exc).lower():
                    raise
                has_tmp_key = True

        columns = _session_table_columns(cur)
        has_tmp_key = "tmp_auth_key" in columns

        if has_tmp_key and db_version is not None and db_version < TELETHON_SESSION_VERSION:
            _set_db_version(cur, TELETHON_SESSION_VERSION)
            changed = True

        if changed:
            conn.commit()
        return changed
    finally:
        conn.close()
