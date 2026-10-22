#!/usr/bin/env bash
# Daily rclone update. Restarts the daemon only when no transfer is running,
# and rolls back to the previous binary if the new one fails to start.
set -u
RC=http://127.0.0.1:5572
BIN=$(command -v rclone) || { echo "rclone not found"; exit 1; }
log() { echo "[rclone-autoupdate] $*"; }
norm() { sed 's/^v//'; }
installed() { "$BIN" version 2>/dev/null | head -1 | awk '{print $2}' | norm; }
running() { curl -fsS -m 5 -X POST "$RC/core/version" 2>/dev/null |
            python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])' 2>/dev/null | norm; }
busy() { curl -fsS -m 5 -X POST "$RC/core/stats" 2>/dev/null |
         python3 -c 'import sys,json;s=json.load(sys.stdin);sys.exit(0 if (s.get("transferring") or s.get("checking")) else 1)'; }

before=$(installed); run=$(running)
# keep a rollback copy only while the binary on disk equals what is running
[ "$before" = "$run" ] && cp -af "$BIN" "$BIN.prev"

if ! "$BIN" selfupdate >/dev/null 2>&1; then
  log "selfupdate failed, trying the official install script"
  curl -fsS https://rclone.org/install.sh | bash >/dev/null 2>&1 || log "install script failed too"
fi
after=$(installed)
[ "$after" != "$before" ] && log "updated $before -> $after"

run=$(running)
if [ -z "$run" ]; then log "daemon not reachable, nothing to restart"; exit 0; fi
[ "$run" = "$after" ] && { log "daemon already on $after"; exit 0; }

if busy; then log "transfers running, restart deferred to the next run"; exit 0; fi

SERVICE="syncdeck-rcd"
systemctl is-active --quiet drime-rcd && SERVICE="drime-rcd"

log "restarting $SERVICE ($run -> $after)"
systemctl restart "$SERVICE"; sleep 8
if [ "$(running)" != "$after" ]; then
  log "new version failed to start, rolling back"
  [ -f "$BIN.prev" ] && cp -af "$BIN.prev" "$BIN"
  systemctl restart "$SERVICE"
  exit 1
fi
log "now running $after"
