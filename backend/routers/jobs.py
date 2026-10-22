"""
/api/jobs  — saved job CRUD + one-tap run
/api/runs  — run history
"""
from __future__ import annotations

import os
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..db import get_db
from ..errors import ValidationError
from ..rc import rc

router = APIRouter(tags=["jobs"])


def _is_local(fs: str) -> bool:
    """True if fs looks like a local path (starts with / or drive letter like C:\\ on Windows)."""
    return fs.startswith("/") or (len(fs) > 2 and fs[1] == ":" and fs[2] in "/\\")


def _combine_fs(fs: str, path: str) -> str:
    """
    Combine an rclone fs string and a sub-path correctly:
      - Local: os.path.join(fs, path)
      - Remote: remote:subpath (e.g. gdrive:Photos)
    """
    sub = (path or "").strip()
    if _is_local(fs):
        return os.path.join(fs, sub) if sub else fs
    if ":" in fs:
        remote, base = fs.split(":", 1)
        parts = [x for x in (base.strip("/"), sub.strip("/")) if x]
        joined = "/".join(parts)
        return f"{remote}:{joined}"
    return f"{fs}:{sub.strip('/')}" if sub else f"{fs}:"


# ── Schemas ───────────────────────────────────────────────────────────────────

class SavedJobBody(BaseModel):
    """Payload to create or update a saved job."""
    name: str
    src_fs: str
    src_path: str = ""
    dst_fs: str
    dst_path: str = ""
    mode: str = "copy"
    transfers: int = 2
    bandwidth: str = ""
    enabled: bool = True


# ── Saved jobs ────────────────────────────────────────────────────────────────

@router.get("/api/jobs")
async def list_jobs(db: aiosqlite.Connection = Depends(get_db)):
    """List all saved transfer jobs ordered by name."""
    async with db.execute("SELECT * FROM saved_jobs ORDER BY name") as cur:
        rows = await cur.fetchall()
    return {"jobs": [dict(r) for r in rows]}


@router.post("/api/jobs")
async def create_job(body: SavedJobBody, db: aiosqlite.Connection = Depends(get_db)):
    """Create a new saved transfer job."""
    if not body.name.strip():
        raise ValidationError("Job name is required.")
    async with db.execute(
        """INSERT INTO saved_jobs (name, src_fs, src_path, dst_fs, dst_path, mode, transfers, bandwidth, enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (body.name.strip(), body.src_fs, body.src_path, body.dst_fs, body.dst_path,
         body.mode, body.transfers, body.bandwidth, int(body.enabled)),
    ) as cur:
        job_id = cur.lastrowid
    await db.commit()
    return {"ok": True, "id": job_id}


@router.get("/api/jobs/{job_id}")
async def get_job(job_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Get details of a single saved job."""
    async with db.execute("SELECT * FROM saved_jobs WHERE id=?", (job_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise ValidationError(f"Job {job_id} not found.")
    return dict(row)


@router.put("/api/jobs/{job_id}")
async def update_job(job_id: int, body: SavedJobBody, db: aiosqlite.Connection = Depends(get_db)):
    """Update an existing saved job."""
    async with db.execute("SELECT id FROM saved_jobs WHERE id=?", (job_id,)) as cur:
        if not await cur.fetchone():
            raise ValidationError(f"Job {job_id} not found.")
    await db.execute(
        """UPDATE saved_jobs SET name=?, src_fs=?, src_path=?, dst_fs=?, dst_path=?,
           mode=?, transfers=?, bandwidth=?, enabled=?, updated_at=datetime('now')
           WHERE id=?""",
        (body.name.strip(), body.src_fs, body.src_path, body.dst_fs, body.dst_path,
         body.mode, body.transfers, body.bandwidth, int(body.enabled), job_id),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/api/jobs/{job_id}")
async def delete_job(job_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Delete a saved job."""
    await db.execute("DELETE FROM saved_jobs WHERE id=?", (job_id,))
    await db.commit()
    return {"ok": True}


@router.post("/api/jobs/{job_id}/run")
async def run_job_now(job_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Immediately trigger a saved job (calls rclone async)."""
    async with db.execute("SELECT * FROM saved_jobs WHERE id=?", (job_id,)) as cur:
        job = await cur.fetchone()
    if not job:
        raise ValidationError(f"Job {job_id} not found.")
    if not job["enabled"]:
        raise ValidationError("Job is disabled.")

    cfg = {"Transfers": job["transfers"]}
    cmd = "sync/sync" if job["mode"] == "sync" else "sync/copy"

    src_fs = _combine_fs(job["src_fs"], job["src_path"])
    dst_fs = _combine_fs(job["dst_fs"], job["dst_path"])

    result = await rc(cmd, srcFs=src_fs, dstFs=dst_fs, _async=True, _config=cfg)
    rclone_job_id = result["jobid"]
    label = f"{job['name']} (manual run)"
    async with db.execute(
        """INSERT INTO runs (saved_job_id, rclone_job_id, label, src_fs, dst_fs, mode)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (job_id, rclone_job_id, label, job["src_fs"], job["dst_fs"], job["mode"]),
    ) as cur:
        run_id = cur.lastrowid
    await db.commit()
    return {"ok": True, "run_id": run_id}


# ── Run history ───────────────────────────────────────────────────────────────

@router.get("/api/runs")
async def list_runs(
    job_id: Optional[int] = Query(None),
    limit: int = Query(50, le=200),
    db: aiosqlite.Connection = Depends(get_db),
):
    """List recent transfer runs, optionally filtered by saved job ID."""
    if job_id is not None:
        async with db.execute(
            "SELECT * FROM runs WHERE saved_job_id=? ORDER BY id DESC LIMIT ?", (job_id, limit)
        ) as cur:
            rows = await cur.fetchall()
    else:
        async with db.execute(
            "SELECT * FROM runs WHERE status != 'archived' ORDER BY id DESC LIMIT ?", (limit,)
        ) as cur:
            rows = await cur.fetchall()
    return {"runs": [dict(r) for r in rows]}


@router.get("/api/runs/{run_id}")
async def get_run(run_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Get details of a specific transfer run."""
    async with db.execute("SELECT * FROM runs WHERE id=?", (run_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise ValidationError(f"Run {run_id} not found.")
    return dict(row)
