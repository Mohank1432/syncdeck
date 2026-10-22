#!/usr/bin/env python3
"""
SyncDeck — smoke test (no rclone daemon needed).
Checks that all modules import cleanly and the app initialises.

Run from the project root:
    python scripts/smoke_test.py
"""
import sys
import os
import importlib

# Ensure project root is on sys.path
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

MODULES = [
    "backend",
    "backend.config",
    "backend.errors",
    "backend.rc",
    "backend.db",
    "backend.security",
    "backend.sse",
    "backend.routers",
    "backend.routers.remotes",
    "backend.routers.browse",
    "backend.routers.transfers",
    "backend.routers.jobs",
    "backend.routers.status",
    "backend.routers.settings",
    "backend.app",
]

ok = True
for mod in MODULES:
    try:
        importlib.import_module(mod)
        print(f"  ✓  {mod}")
    except Exception as e:
        print(f"  ✗  {mod}  →  {e}")
        ok = False

print()
if ok:
    print("All modules imported successfully ✅")
    sys.exit(0)
else:
    print("Some imports failed ❌")
    sys.exit(1)
