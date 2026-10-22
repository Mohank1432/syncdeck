"""
/api/remotes — manage rclone remotes (CRUD, test, providers list).
"""
from __future__ import annotations

from typing import Any
from fastapi import APIRouter
from pydantic import BaseModel

from ..errors import ValidationError
from ..rc import rc
from ..security import mask_secret

router = APIRouter(prefix="/api/remotes", tags=["remotes"])


# ── schemas ──────────────────────────────────────────────────────────────────

class CreateRemoteBody(BaseModel):
    """Payload to create a new rclone remote."""
    name: str
    type: str
    params: dict[str, Any] = {}


class UpdateRemoteBody(BaseModel):
    """Payload to update an existing rclone remote."""
    params: dict[str, Any] = {}


# ── helpers ───────────────────────────────────────────────────────────────────

def _valid_name(name: str) -> str:
    """Validate remote name does not contain illegal characters or path traversal."""
    name = name.strip()
    if not name or "/" in name or "\\" in name or name in (".", ".."):
        raise ValidationError(f"Invalid remote name: {name!r}")
    return name


async def _list_names() -> list[str]:
    """Retrieve list of remote names configured in rclone."""
    data = await rc("config/listremotes")
    return data.get("remotes") or []


# ── routes ────────────────────────────────────────────────────────────────────

@router.get("")
async def list_remotes():
    """List all configured rclone remotes with type and basic storage info."""
    names = await _list_names()
    remotes = []
    for name in names:
        try:
            cfg = await rc("config/get", name=name)
        except Exception:
            cfg = {}
        remotes.append({
            "name": name,
            "type": cfg.get("type", "unknown"),
        })
    return {"remotes": remotes}


@router.get("/providers")
async def list_providers():
    """Return all rclone provider types and their option schemas."""
    data = await rc("config/providers")
    providers = []
    for p in data.get("providers", []):
        # Include only basic options (hide advanced ones in UI by default)
        opts = [
            {
                "name": o["Name"],
                "help": (o.get("Help") or "").split("\n")[0],
                "required": o.get("Required", False),
                "is_password": o.get("IsPassword", False),
                "examples": [e.get("Value", "") for e in (o.get("Examples") or [])],
                "advanced": o.get("Advanced", False),
            }
            for o in (p.get("Options") or [])
        ]
        providers.append({
            "name": p["Name"],
            "description": p.get("Description", ""),
            "options": opts,
        })
    return {"providers": providers}


@router.get("/{name}")
async def get_remote(name: str):
    """Return config for a single remote (secrets masked)."""
    name = _valid_name(name)
    names = await _list_names()
    if name not in names:
        raise ValidationError(f"Remote '{name}' not found.")
    cfg = await rc("config/get", name=name)
    remote_type = cfg.get("type", "")

    # Get option schema for masking
    providers_data = await rc("config/providers")
    provider = next((p for p in providers_data.get("providers", []) if p["Name"] == remote_type), None)
    opts = mask_secret(provider["Options"] if provider else [], cfg)

    return {"name": name, "type": remote_type, "options": opts}


@router.post("")
async def create_remote(body: CreateRemoteBody):
    """Create a new rclone remote."""
    name = _valid_name(body.name)
    names = await _list_names()
    if name in names:
        raise ValidationError(f"Remote '{name}' already exists. Use PUT to update it.")
    params = {k: v for k, v in body.params.items() if v != ""}
    await rc(
        "config/create",
        name=name,
        type=body.type,
        parameters=params,
        opt={"nonInteractive": True, "obscure": True},
    )
    return {"ok": True, "name": name}


@router.put("/{name}")
async def update_remote(name: str, body: UpdateRemoteBody):
    """Update parameters of an existing remote."""
    name = _valid_name(name)
    names = await _list_names()
    if name not in names:
        raise ValidationError(f"Remote '{name}' not found.")
    params = {k: v for k, v in body.params.items() if v != ""}
    await rc(
        "config/update",
        name=name,
        parameters=params,
        opt={"nonInteractive": True, "obscure": True},
    )
    return {"ok": True}


@router.delete("/{name}")
async def delete_remote(name: str):
    """Delete a remote from rclone config."""
    name = _valid_name(name)
    await rc("config/delete", name=name)
    return {"ok": True}


@router.post("/{name}/test")
async def test_remote(name: str):
    """Test a remote by listing its root and fetching storage info."""
    name = _valid_name(name)
    await rc("operations/list", fs=f"{name}:", remote="")
    try:
        about = await rc("operations/about", fs=f"{name}:")
    except Exception:
        about = {}
    return {"ok": True, "about": about}
