"""Custom exceptions and rclone error → plain-language mapping."""
from __future__ import annotations
from fastapi import HTTPException


class RcloneError(HTTPException):
    """Raised when an rclone RC operation fails or is unreachable."""

    def __init__(self, message: str):
        super().__init__(status_code=502, detail=message)


class ValidationError(HTTPException):
    """Raised when client input or path security validation fails."""

    def __init__(self, message: str):
        super().__init__(status_code=400, detail=message)


# Map common rclone error substrings to readable suggestions
_RCLONE_ERROR_MAP = [
    ("quota", "Storage quota exceeded. Free up space or upgrade your plan."),
    ("rate limit", "Rate limited by the remote. Try again in a few minutes."),
    ("401", "Authentication failed. Check your credentials in Remotes settings."),
    ("403", "Permission denied. You may not have access to this path."),
    ("404", "Path not found on the remote."),
    ("no space", "No space left on destination."),
    ("connection refused", "rclone daemon is not running or unreachable."),
    ("not reachable", "rclone daemon is not reachable."),
    ("timeout", "Request to remote timed out. Check network connection."),
    ("no such host", "DNS lookup failed. The daemon cannot reach the remote server."),
]


def friendly(raw: str, cmd: str | None = None) -> str:
    """Format an rclone error with both plain-language hint and raw detail preserved."""
    low = raw.lower()
    hint = None
    for fragment, message in _RCLONE_ERROR_MAP:
        if fragment in low:
            hint = message
            break

    prefix = f"[{cmd}] " if cmd else ""
    if hint and hint.lower() not in low:
        return f"{prefix}{hint} (Detail: {raw})"
    return f"{prefix}{raw}"
