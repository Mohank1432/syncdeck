"""
SyncDeck — FastAPI application entry point.

Start with:  uvicorn backend.app:app --host 0.0.0.0 --port 8768
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import settings
from .db import init_db
from .rc import set_client
from .sse import stats_loop
from .routers import remotes, browse, transfers, jobs, status, settings as settings_router

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
log = logging.getLogger("syncdeck")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    # Shared HTTP client for rclone RC calls
    client = httpx.AsyncClient(timeout=httpx.Timeout(60.0))
    set_client(client)

    # Ensure DB schema exists
    await init_db(settings.db_path)

    # Start background SSE/stats loop
    loop_task = asyncio.create_task(stats_loop())

    log.info("SyncDeck started on %s:%d", settings.bind, settings.port)
    yield  # ← app runs here

    loop_task.cancel()
    try:
        await loop_task
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        log.debug("Error stopping stats loop: %s", exc)

    await client.aclose()
    log.info("SyncDeck stopped.")


app = FastAPI(
    title="SyncDeck",
    description="Modern homeserver transfer dashboard for rclone and cloud storage.",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
)


# ── Global error handlers ─────────────────────────────────────────────────────

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Format HTTP exceptions into standard JSON error responses."""
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    """Catch-all unhandled exception handler."""
    log.exception("Unhandled error: %s", exc)
    return JSONResponse({"error": "Internal server error. Check server logs."}, status_code=500)


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(remotes.router)
app.include_router(browse.router)
app.include_router(transfers.router)
app.include_router(jobs.router)
app.include_router(status.router)
app.include_router(settings_router.router)


# ── Static files (frontend) — MUST be last ────────────────────────────────────

os.makedirs("frontend", exist_ok=True)
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")


# ── Dev runner ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app:app", host=settings.bind, port=settings.port, reload=False)
