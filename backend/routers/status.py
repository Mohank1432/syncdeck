"""
/api/status   — snapshot of rclone stats + active runs
/api/events   — SSE stream
"""
from __future__ import annotations

import aiosqlite
from fastapi import APIRouter, Depends, Request
from sse_starlette.sse import EventSourceResponse

from ..db import get_db
from ..rc import rc
from ..sse import subscribe

router = APIRouter(tags=["status"])


@router.get("/api/status")
async def get_status(db: aiosqlite.Connection = Depends(get_db)):
    """Return current rclone stats and recent active runs."""
    stats = await rc("core/stats")
    bwlimit = await rc("core/bwlimit")
    async with db.execute(
        "SELECT * FROM runs WHERE status != 'archived' ORDER BY id DESC LIMIT 40"
    ) as cur:
        runs = [dict(r) for r in await cur.fetchall()]
    return {"stats": stats, "bwlimit": bwlimit, "runs": runs}


@router.get("/api/events")
async def sse_stream(request: Request):
    """SSE stream — pushes stats and run updates every ~2 s."""
    async def generator():
        async for event in subscribe():
            if await request.is_disconnected():
                break
            yield event

    return EventSourceResponse(generator())
