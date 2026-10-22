"""
/api/settings — app-level settings (stored in SQLite)
/api/roots    — allowed local roots
"""
from __future__ import annotations

import os
import aiosqlite
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..db import get_db, get_settings_dict
from ..errors import ValidationError

router = APIRouter(tags=["settings"])


# ── App settings ──────────────────────────────────────────────────────────────

@router.get("/api/settings")
async def get_settings(db: aiosqlite.Connection = Depends(get_db)):
    """Retrieve app settings with secret fields masked."""
    s = await get_settings_dict(db)
    # Never expose token values via API — just flag whether they are set
    for key in (
        "notifications_telegram_token",
        "notifications_telegram_chat_id",
        "notifications_ntfy_url",
    ):
        if key in s and s[key]:
            s[key + "__is_set"] = "1"
            s[key] = ""  # blank the actual secret
    return {"settings": s}


class SettingsBody(BaseModel):
    """Payload to update application settings."""
    settings: dict[str, str]


@router.put("/api/settings")
async def update_settings(body: SettingsBody, db: aiosqlite.Connection = Depends(get_db)):
    """Update application settings."""
    for k, v in body.settings.items():
        # Don't overwrite a saved secret with an empty string (keep existing)
        if v == "" and k in (
            "notifications_telegram_token",
            "notifications_telegram_chat_id",
            "notifications_ntfy_url",
        ):
            continue
        await db.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (k, v),
        )
    await db.commit()
    return {"ok": True}


# ── Local roots ───────────────────────────────────────────────────────────────

@router.get("/api/roots")
async def list_roots(db: aiosqlite.Connection = Depends(get_db)):
    """List allowed local server directory roots."""
    async with db.execute("SELECT * FROM local_roots ORDER BY id") as cur:
        rows = await cur.fetchall()
    return {"roots": [dict(r) for r in rows]}


class RootBody(BaseModel):
    """Payload to add a local root directory."""
    path: str
    label: str = ""


@router.post("/api/roots")
async def add_root(body: RootBody, db: aiosqlite.Connection = Depends(get_db)):
    """Add a new allowed local root directory."""
    path = os.path.realpath(body.path.strip())
    if not os.path.isdir(path):
        raise ValidationError(f"Directory does not exist: {path}")
    label = body.label.strip() or path.split("/")[-1] or path
    async with db.execute(
        "INSERT OR IGNORE INTO local_roots (path, label) VALUES (?, ?)", (path, label)
    ) as cur:
        root_id = cur.lastrowid
    await db.commit()
    return {"ok": True, "id": root_id}


@router.delete("/api/roots/{root_id}")
async def delete_root(root_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Remove an allowed local root directory (at least one must remain)."""
    async with db.execute("SELECT COUNT(*) FROM local_roots") as cur:
        (count,) = await cur.fetchone()
    if count <= 1:
        raise ValidationError("You must keep at least one local root.")
    await db.execute("DELETE FROM local_roots WHERE id=?", (root_id,))
    await db.commit()
    return {"ok": True}
