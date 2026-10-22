"""
/api/browse — generic file browser for any rclone fs or local path.

For local paths:  fs = "/mnt/media"  (no colon, starts with /)
For rclone remotes: fs = "gdrive:"  or  "dropbox:subfolder"

The `path` query param is the sub-path within the fs root.
"""
from __future__ import annotations

import os
import shutil
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..db import get_db
from ..errors import ValidationError
from ..rc import rc
from ..security import safe_local, safe_remote_path

router = APIRouter(prefix="/api/browse", tags=["browse"])


def _is_local(fs: str) -> bool:
    """True if fs looks like a local path (starts with / or drive letter like C:\\ on Windows)."""
    return fs.startswith("/") or (len(fs) > 2 and fs[1] == ":" and fs[2] in "/\\")


async def _get_roots(db: aiosqlite.Connection) -> list[str]:
    """Fetch allowed local roots from database."""
    async with db.execute("SELECT path FROM local_roots ORDER BY id") as cur:
        rows = await cur.fetchall()
    return [r["path"] for r in rows]


# ── routes ────────────────────────────────────────────────────────────────────

@router.get("")
async def browse(
    fs: str = Query(..., description="rclone fs string, e.g. 'gdrive:' or '/mnt/media'"),
    path: str = Query("", description="Sub-path within the fs"),
    db: aiosqlite.Connection = Depends(get_db),
):
    """List files/dirs in a remote or local directory."""
    if _is_local(fs):
        roots = await _get_roots(db)
        # For local, fs IS the path when path is empty
        full_path = os.path.join(fs, path) if path else fs
        real = safe_local(full_path, roots)
        items = []
        try:
            for entry in os.scandir(real):
                try:
                    is_dir = entry.is_dir(follow_symlinks=False)
                    size = 0 if is_dir else entry.stat().st_size
                    items.append({"name": entry.name, "is_dir": is_dir, "size": size})
                except OSError:
                    pass
        except PermissionError as e:
            raise ValidationError(str(e))
        items.sort(key=lambda i: (not i["is_dir"], i["name"].lower()))

        # Determine parent
        parent_path = os.path.dirname(real)
        # Only show parent if it's within an allowed root and not equal to real
        try:
            safe_local(parent_path, roots)
            parent = parent_path if parent_path != real else None
        except Exception:
            parent = None
        return {"fs": fs, "path": real, "parent": parent, "items": items, "is_local": True}
    else:
        # Remote
        # fs might be "gdrive:" or "gdrive:subfolder" — normalise
        if ":" not in fs:
            raise ValidationError("Remote fs must contain a colon, e.g. 'gdrive:'")
        remote_name, fs_subpath = fs.split(":", 1)
        sub = safe_remote_path(path)
        full_remote_path = "/".join(x for x in (fs_subpath.strip("/"), sub) if x)
        data = await rc("operations/list", fs=f"{remote_name}:", remote=full_remote_path)
        items = []
        for i in data.get("list", []):
            items.append({
                "name": i["Name"],
                "is_dir": i.get("IsDir", False),
                "size": max(i.get("Size", 0), 0),
            })
        items.sort(key=lambda i: (not i["is_dir"], i["name"].lower()))
        parent = None if not full_remote_path else (
            full_remote_path.rsplit("/", 1)[0] if "/" in full_remote_path else ""
        )
        return {
            "fs": f"{remote_name}:",
            "path": full_remote_path,
            "parent": parent,
            "items": items,
            "is_local": False,
        }


class MkdirBody(BaseModel):
    """Payload to create a directory."""
    fs: str
    path: str
    name: str


@router.post("/mkdir")
async def mkdir(body: MkdirBody, db: aiosqlite.Connection = Depends(get_db)):
    """Create a directory on a remote or local path."""
    if not body.name or "/" in body.name or "\\" in body.name or body.name in (".", ".."):
        raise ValidationError(f"Invalid folder name: {body.name!r}")
    if _is_local(body.fs):
        roots = await _get_roots(db)
        full = os.path.join(body.path or body.fs, body.name)
        safe = safe_local(full, roots)
        os.makedirs(safe, exist_ok=True)
    else:
        if ":" not in body.fs:
            raise ValidationError("Remote fs must contain a colon.")
        remote_name, _ = body.fs.split(":", 1)
        sub = safe_remote_path(body.path)
        new_path = "/".join(x for x in (sub, body.name) if x)
        await rc("operations/mkdir", fs=f"{remote_name}:", remote=new_path)
    return {"ok": True}


@router.get("/about")
async def about(
    fs: str = Query(...),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Return storage usage info for a remote or local path."""
    if _is_local(fs):
        roots = await _get_roots(db)
        real = safe_local(fs, roots)
        stat = os.statvfs(real) if hasattr(os, "statvfs") else None
        if stat:
            total = stat.f_blocks * stat.f_frsize
            free = stat.f_bavail * stat.f_frsize
            used = total - free
            return {"total": total, "used": used, "free": free}
        try:
            total, used, free = shutil.disk_usage(real)
            return {"total": total, "used": used, "free": free}
        except Exception:
            return {}
    else:
        if ":" not in fs:
            raise ValidationError("Remote fs must contain a colon.")
        remote_name, _ = fs.split(":", 1)
        try:
            return await rc("operations/about", fs=f"{remote_name}:")
        except Exception:
            return {}
