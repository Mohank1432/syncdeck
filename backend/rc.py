"""Async rclone RC client. Uses a single shared httpx.AsyncClient (set on app.state)."""
from __future__ import annotations

import httpx
from .config import settings
from .errors import RcloneError, friendly

_client: httpx.AsyncClient | None = None


def set_client(client: httpx.AsyncClient) -> None:
    """Set the shared httpx.AsyncClient instance."""
    global _client
    _client = client


async def rc(cmd: str, **params) -> dict:
    """POST to rclone RC and return parsed JSON. Raises RcloneError on failure."""
    if _client is None:
        raise RcloneError("HTTP client not initialised (app startup not complete).")
    try:
        r = await _client.post(f"{settings.rc_url}/{cmd}", json=params, timeout=60.0)
    except httpx.RequestError as exc:
        raise RcloneError(f"[{cmd}] rclone daemon is not reachable at {settings.rc_url}: {exc}") from exc

    try:
        data = r.json()
    except Exception:
        data = {}

    if r.status_code != 200:
        raw = data.get("error") or f"rclone HTTP {r.status_code}"
        raise RcloneError(friendly(raw, cmd=cmd))

    return data
