from __future__ import annotations

import os
import sqlite3


def repair_telethon_session_sqlite(session_path: str) -> bool:
    """
    HStock and some exporters set version=8 while the sessions table still matches
    Telethon v7 (no tmp_auth_key). Telethon 1.36+ then fails with:
    "not enough values to unpack (expected 6, got 5)".
    """
    if not session_path.endswith(".session") or not os.path.isfile(session_path):
        return False

    conn = sqlite3.connect(session_path)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
        )
        if not cur.fetchone():
            return False

        cur.execute("PRAGMA table_info(sessions)")
        columns = {row[1] for row in cur.fetchall()}
        changed = False
        if "tmp_auth_key" not in columns:
            cur.execute("ALTER TABLE sessions ADD COLUMN tmp_auth_key BLOB")
            changed = True

        conn.commit()
        return changed
    finally:
        conn.close()
