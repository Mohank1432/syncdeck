"""Custom exceptions and rclone error → plain-language mapping."""
from fastapi import HTTPException


class RcloneError(HTTPException):
    """Raised when an rclone RC operation fails or is unreachable."""

    def __init__(self, message: str):
        super().__init__(status_code=502, detail=message)


class ValidationError(HTTPException):
    """Raised when client input or path security validation fails."""

    def __init__(self, message: str):
        super().__init__(status_code=400, detail=message)


# Map common rclone error substrings to readable messages
_RCLONE_ERROR_MAP = [
    ("quota", "Storage quota exceeded. Free up space or upgrade your plan."),
    ("rate limit", "Rate limited by the remote. Try again in a few minutes."),
    ("401", "Authentication failed. Check your credentials in Remotes settings."),
    ("403", "Permission denied. You may not have access to this path."),
    ("404", "Path not found on the remote."),
    ("no space", "No space left on the destination."),
    ("token", "OAuth token expired or revoked. Re-authenticate the remote."),
    ("connection refused", "rclone daemon is not running. Check that syncdeck-rcd is running."),
    ("not reachable", "rclone daemon is not reachable. Check that syncdeck-rcd is running."),
    ("timeout", "Request to the remote timed out. Check your network connection."),
    ("directory not found", "Directory not found. It may have been moved or deleted."),
]


def friendly(raw: str) -> str:
    """Return a plain-language version of a raw rclone error, if possible."""
    low = raw.lower()
    for fragment, message in _RCLONE_ERROR_MAP:
        if fragment in low:
            return message
    return raw
