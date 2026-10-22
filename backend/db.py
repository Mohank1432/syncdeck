"""Async SQLite helpers using aiosqlite."""
from __future__ import annotations

import aiosqlite
from .config import settings

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS saved_jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    src_fs      TEXT    NOT NULL,
    src_path    TEXT    NOT NULL DEFAULT '',
    dst_fs      TEXT    NOT NULL,
    dst_path    TEXT    NOT NULL DEFAULT '',
    mode        TEXT    NOT NULL DEFAULT 'copy',
    transfers   INTEGER NOT NULL DEFAULT 2,
    bandwidth   TEXT    NOT NULL DEFAULT '',
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    saved_job_id    INTEGER REFERENCES saved_jobs(id) ON DELETE SET NULL,
    rclone_job_id   INTEGER,
    label           TEXT    NOT NULL,
    src_fs          TEXT    NOT NULL,
    dst_fs          TEXT    NOT NULL,
    mode            TEXT    NOT NULL,
    dry_run         INTEGER NOT NULL DEFAULT 0,
    status          TEXT    NOT NULL DEFAULT 'running',
    started_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    finished_at     TEXT,
    bytes_transferred INTEGER NOT NULL DEFAULT 0,
    errors          INTEGER NOT NULL DEFAULT 0,
    error_msg       TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS local_roots (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    path  TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL DEFAULT ''
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('read_only', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notifications_telegram_enabled', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notifications_telegram_token', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notifications_telegram_chat_id', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notifications_ntfy_enabled', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notifications_ntfy_url', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notifications_ntfy_topic', 'syncdeck');
"""


async def init_db(db_path: str = settings.db_path) -> None:
    """Create tables and seed defaults."""
    async with aiosqlite.connect(db_path) as db:
        await db.executescript(SCHEMA)
        # Seed local_roots from env if the table is empty
        async with db.execute("SELECT COUNT(*) FROM local_roots") as cur:
            (count,) = await cur.fetchone()
        if count == 0:
            from .config import settings as cfg
            for root in cfg.allowed_root_list:
                await db.execute(
                    "INSERT OR IGNORE INTO local_roots (path, label) VALUES (?, ?)",
                    (root, root.split("/")[-1] or root),
                )
        await db.commit()


async def get_db() -> aiosqlite.Connection:
    """FastAPI dependency: yields an aiosqlite connection per request."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys=ON")
        yield db


async def get_settings_dict(db: aiosqlite.Connection) -> dict:
    """Return all settings as a plain dict."""
    async with db.execute("SELECT key, value FROM settings") as cur:
        rows = await cur.fetchall()
    return {r["key"]: r["value"] for r in rows}
