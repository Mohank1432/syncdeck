"""
Server-Sent Events broadcaster.

One background asyncio task (started at app startup) polls rclone every 2 s,
updates run statuses in SQLite, and pushes JSON events to all connected clients.

Event types:
  connected   — sent once when a client connects
  stats       — rclone core/stats merged with bwlimit info
  run_update  — sent when a run transitions to done/failed/stopped
  keepalive   — empty comment sent every 15 s to prevent proxy timeouts
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import AsyncIterator

import aiosqlite

from .config import settings
from .rc import rc

log = logging.getLogger(__name__)

_subscribers: set[asyncio.Queue] = set()
_last_active_count: int = 0


async def _subscribe() -> AsyncIterator[dict]:
    """Yield SSE dicts; cleaned up automatically when client disconnects."""
    q: asyncio.Queue = asyncio.Queue(maxsize=30)
    _subscribers.add(q)
    # Greet new subscriber
    q.put_nowait({"event": "connected", "data": json.dumps({"ts": int(time.time())})})
    try:
        while True:
            item = await q.get()
            yield item
    finally:
        _subscribers.discard(q)


def subscribe() -> AsyncIterator[dict]:
    """Public generator for SSE subscriber streams."""
    return _subscribe()


async def _broadcast(event: str, data: dict) -> None:
    """Broadcast an event payload to all currently connected subscriber queues."""
    payload = {"event": event, "data": json.dumps(data, default=str)}
    dead: set[asyncio.Queue] = set()
    for q in list(_subscribers):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            dead.add(q)
    _subscribers.difference_update(dead)


async def stats_loop() -> None:
    """
    Background loop: every 2 s, fetch rclone stats, update DB run statuses,
    and broadcast events to SSE subscribers.
    """
    global _last_active_count
    keepalive_tick = 0

    while True:
        try:
            await asyncio.sleep(2)
        except asyncio.CancelledError:
            break

        keepalive_tick += 1

        try:
            stats = await rc("core/stats")
            bwlimit = await rc("core/bwlimit")

            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row

                # Check running jobs
                async with db.execute(
                    "SELECT id, rclone_job_id FROM runs WHERE status='running' AND rclone_job_id IS NOT NULL"
                ) as cur:
                    active = await cur.fetchall()

                for row in active:
                    try:
                        st = await rc("job/status", jobid=row["rclone_job_id"])
                    except Exception:
                        st = {}
                    if st.get("finished"):
                        success = st.get("success", False)
                        err = st.get("error", "") or ""
                        status = "done" if success else ("stopped" if "cancel" in err.lower() else "failed")
                        await db.execute(
                            """UPDATE runs SET status=?, error_msg=?, finished_at=datetime('now')
                               WHERE id=?""",
                            (status, err, row["id"]),
                        )
                        await db.commit()
                        async with db.execute("SELECT * FROM runs WHERE id=?", (row["id"],)) as c:
                            updated = await c.fetchone()
                        if updated:
                            await _broadcast("run_update", dict(updated))

                # Count still-active after updates
                async with db.execute("SELECT COUNT(*) FROM runs WHERE status='running'") as cur:
                    (active_count,) = await cur.fetchone()

            await _broadcast("stats", {
                **stats,
                "bwlimit": bwlimit,
                "active_runs": active_count,
            })

        except Exception as exc:
            log.debug("SSE loop error: %s", exc)

        # Send keepalive comment every ~15 s (7–8 ticks × 2 s)
        if keepalive_tick % 8 == 0:
            for q in list(_subscribers):
                try:
                    q.put_nowait({"event": "keepalive", "data": "{}"})
                except asyncio.QueueFull:
                    pass
