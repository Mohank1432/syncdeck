"""Path validation and secret masking."""
from __future__ import annotations

import os
from .config import settings
from .errors import ValidationError


def safe_local(path: str | None, roots: list[str] | None = None) -> str:
    """
    Resolve and validate that `path` is inside one of the allowed roots.
    `roots` overrides the default allowed_root_list (used when roots are
    stored in the DB rather than env).
    Raises ValidationError if path escapes the allowed zone.
    """
    allowed = roots if roots is not None else settings.allowed_root_list
    if not allowed:
        raise ValidationError("No local roots are configured. Add one in Settings → Local Roots.")

    # Default to first root when no path given
    p = os.path.realpath(path or allowed[0])

    for root in allowed:
        real_root = os.path.realpath(root)
        if p == real_root or p.startswith(real_root + os.sep):
            return p

    raise ValidationError(
        f"Path must be inside one of the allowed roots: {', '.join(allowed)}"
    )


def safe_remote_path(path: str) -> str:
    """
    Validate a remote sub-path (the part after 'remote:').
    Rejects traversal attempts.
    """
    parts = (path or "").strip("/").split("/")
    if ".." in parts:
        raise ValidationError("Path traversal is not allowed.")
    return "/".join(parts)


def mask_secret(options: list[dict], cfg: dict) -> list[dict]:
    """Return options list with secret values blanked out."""
    sw = settings.secret_words
    result = []
    for o in options:
        is_secret = o.get("IsPassword") or any(w in o["Name"].lower() for w in sw)
        is_set = bool(cfg.get(o["Name"]))
        result.append({
            "name": o["Name"],
            "help": (o.get("Help") or "").split("\n")[0],
            "required": o.get("Required", False),
            "secret": is_secret,
            "value": "" if is_secret else cfg.get(o["Name"], ""),
            "is_set": is_set,
            "examples": [e.get("Value", "") for e in (o.get("Examples") or [])],
        })
    return result
