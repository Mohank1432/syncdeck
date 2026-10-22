"""
/api/transfer — start, stop, and monitor file transfers.
/api/bwlimit  — get/set bandwidth limit.
"""
from __future__ import annotations

import os
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..db import get_db
from ..errors import ValidationError
from ..rc import rc
from ..security import safe_local, safe_remote_path

router = APIRouter(tags=["transfers"])


def _is_local(fs: str) -> bool:
    """True if fs looks like a local path (starts with / or drive letter like C:\\ on Windows)."""
    return fs.startswith("/") or (len(fs) > 2 and fs[1] == ":" and fs[2] in "/\\")


def _rclone_fs(fs: str, sub: str) -> str:
    """Build the full rclone fs argument for a path."""
    if _is_local(fs):
        return os.path.join(fs, sub) if sub else fs
    if ":" not in fs:
        return f"{fs}:{sub}"
    remote, base = fs.split(":", 1)
    joined = "/".join(x for x in (base.strip("/"), sub.strip("/")) if x)
    return f"{remote}:{joined}"


class TransferItem(BaseModel):
    """An individual file or folder to transfer."""
    name: str
    is_dir: bool = False


class TransferBody(BaseModel):
    """Payload to initiate transfers."""
    src_fs: str
    src_path: str = ""
    dst_fs: str
    dst_path: str = ""
    mode: str = "copy"          # "copy" | "sync"
    dry_run: bool = False
    transfers: int = 2
    items: list[TransferItem]
    saved_job_id: Optional[int] = None
    label: Optional[str] = None


@router.post("/api/transfer")
async def start_transfer(body: TransferBody, db: aiosqlite.Connection = Depends(get_db)):
    """Start one or more transfer jobs (async, runs in rclone daemon)."""
    if not body.items:
        raise ValidationError("Nothing selected.")
    if body.mode not in ("copy", "sync"):
        raise ValidationError(f"Unknown mode: {body.mode!r}")
    body.transfers = max(1, min(body.transfers, 16))

    async with db.execute("SELECT value FROM settings WHERE key='read_only'") as cur:
        row = await cur.fetchone()
    if row and row["value"] == "1":
        raise ValidationError("App is in read-only mode.")

    # Validate local paths
    async with db.execute("SELECT path FROM local_roots ORDER BY id") as cur:
        roots = [r["path"] for r in await cur.fetchall()]

    def check_local(fs: str, sub: str):
        if _is_local(fs):
            full = os.path.join(fs, sub) if sub else fs
            safe_local(full, roots)

    check_local(body.src_fs, body.src_path)
    check_local(body.dst_fs, body.dst_path)

    cfg = {"Transfers": body.transfers}
    if body.dry_run:
        cfg["DryRun"] = True

    run_ids = []
    for item in body.items:
        if "/" in item.name or "\\" in item.name or item.name in (".", ".."):
            raise ValidationError(f"Invalid item name: {item.name!r}")

        if item.is_dir:
            # Directories: use sync/copy or sync/sync
            cmd = "sync/sync" if body.mode == "sync" else "sync/copy"
            # src must be the folder itself (combine fs root + sub-path + item name)
            if _is_local(body.src_fs):
                _src_base = os.path.join(body.src_fs, body.src_path) if body.src_path else body.src_fs
                src_dir = safe_local(os.path.join(_src_base, item.name), roots)
            else:
                sub = "/".join(x for x in (body.src_path, item.name) if x)
                remote_name = body.src_fs.rstrip(":").split(":")[0]
                src_dir = f"{remote_name}:{sub}"

            if _is_local(body.dst_fs):
                _dst_base = os.path.join(body.dst_fs, body.dst_path) if body.dst_path else body.dst_fs
                dst_dir = safe_local(os.path.join(_dst_base, item.name), roots)
            else:
                sub = "/".join(x for x in (body.dst_path, item.name) if x)
                remote_name = body.dst_fs.rstrip(":").split(":")[0]
                dst_dir = f"{remote_name}:{sub}"

            result = await rc(cmd, srcFs=src_dir, dstFs=dst_dir, _async=True, _config=cfg)
        else:
            # Files: use operations/copyfile
            if _is_local(body.src_fs):
                # srcFs = the directory, srcRemote = the filename
                src_base = safe_local(
                    os.path.join(body.src_fs, body.src_path) if body.src_path else body.src_fs,
                    roots,
                )
                dst_fs_arg = (
                    safe_local(os.path.join(body.dst_fs, body.dst_path) if body.dst_path else body.dst_fs, roots)
                    if _is_local(body.dst_fs) else _rclone_fs(body.dst_fs, body.dst_path)
                )
                result = await rc(
                    "operations/copyfile",
                    srcFs=src_base,
                    srcRemote=item.name,
                    dstFs=dst_fs_arg,
                    dstRemote=item.name,
                    _async=True,
                    _config=cfg,
                )
            else:
                # Remote source: srcFs = "remotename:subpath"
                src_remote = body.src_fs.rstrip(":").split(":")[0]
                dst_arg = (
                    safe_local(os.path.join(body.dst_fs, body.dst_path) if body.dst_path else body.dst_fs, roots)
                    if _is_local(body.dst_fs) else _rclone_fs(body.dst_fs, body.dst_path)
                )
                result = await rc(
                    "operations/copyfile",
                    srcFs=f"{src_remote}:{body.src_path}",
                    srcRemote=item.name,
                    dstFs=dst_arg,
                    dstRemote=item.name,
                    _async=True,
                    _config=cfg,
                )

        rclone_job_id = result["jobid"]
        suffix = " (sync)" if item.is_dir and body.mode == "sync" else ""
        suffix += " [dry run]" if body.dry_run else ""
        label = body.label or f"{item.name}{suffix}"

        async with db.execute(
            """INSERT INTO runs (saved_job_id, rclone_job_id, label, src_fs, dst_fs, mode, dry_run)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (body.saved_job_id, rclone_job_id, label,
             body.src_fs, body.dst_fs, body.mode, int(body.dry_run)),
        ) as cur:
            run_id = cur.lastrowid
        await db.commit()
        run_ids.append(run_id)

    return {"run_ids": run_ids}


class StopBody(BaseModel):
    """Payload to stop an active transfer run."""
    run_id: int


@router.post("/api/stop")
async def stop_transfer(body: StopBody, db: aiosqlite.Connection = Depends(get_db)):
    """Stop a running transfer by our DB run ID."""
    async with db.execute("SELECT rclone_job_id FROM runs WHERE id=?", (body.run_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise ValidationError(f"Run {body.run_id} not found.")
    if row["rclone_job_id"]:
        try:
            await rc("job/stop", jobid=row["rclone_job_id"])
        except Exception:
            pass
    await db.execute(
        "UPDATE runs SET status='stopped', finished_at=datetime('now') WHERE id=? AND status='running'",
        (body.run_id,),
    )
    await db.commit()
    return {"ok": True}


@router.get("/api/bwlimit")
async def get_bwlimit():
    """Get the current bandwidth limit."""
    return await rc("core/bwlimit")


class BwlimitBody(BaseModel):
    """Payload to set bandwidth limit rate."""
    rate: str  # e.g. "2M", "512K", "off"


@router.post("/api/bwlimit")
async def set_bwlimit(body: BwlimitBody):
    """Set or clear the bandwidth limit."""
    rate = body.rate.strip()
    if rate != "off" and not any(rate.upper().endswith(u) for u in ("M", "K", "G", "B")):
        # Allow bare numbers (treated as bytes/s by rclone)
        if not rate.replace(".", "", 1).isdigit():
            raise ValidationError(f"Invalid rate: {rate!r}")
    return await rc("core/bwlimit", rate=rate)


@router.get("/api/version")
async def get_version():
    """Return the running rclone version."""
    data = await rc("core/version")
    return {"version": data.get("version", "unknown")}


@router.post("/api/clear")
async def clear_finished(db: aiosqlite.Connection = Depends(get_db)):
    """Mark old finished runs as archived (hide from active view)."""
    await db.execute(
        "UPDATE runs SET status='archived' WHERE status IN ('done','failed','stopped')"
    )
    await db.commit()
    return {"ok": True}
