#!/usr/bin/env bash
# SyncDeck installer (systemd / bare Linux)
set -e

APP_DIR="${APP_DIR:-$HOME/Apps/syncdeck}"
BIND="${BIND:-127.0.0.1}"
PORT="${PORT:-8780}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Prerequisites ─────────────────────────────────────────────────────────────
echo "==> Checking prerequisites..."
command -v rclone >/dev/null 2>&1 || {
  echo "rclone not found. Installing..."
  curl https://rclone.org/install.sh | sudo bash
}

command -v python3 >/dev/null 2>&1 || sudo apt-get install -y python3
python3 -m venv --help >/dev/null 2>&1 || sudo apt-get install -y python3-venv python3-pip

# ── Install files ─────────────────────────────────────────────────────────────
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  echo "==> Installing to $APP_DIR..."
  mkdir -p "$APP_DIR"
  cp -r "$SRC_DIR/backend" "$SRC_DIR/frontend" "$SRC_DIR/deploy" "$APP_DIR/"
  cp "$SRC_DIR/requirements.txt" "$APP_DIR/"
  [ -f "$SRC_DIR/.env" ] && cp "$SRC_DIR/.env" "$APP_DIR/" || cp "$SRC_DIR/.env.example" "$APP_DIR/.env"
else
  echo "==> Running in-place in $APP_DIR..."
  [ -f "$APP_DIR/.env" ] || cp "$APP_DIR/.env.example" "$APP_DIR/.env"
fi

# ── Python Virtualenv ─────────────────────────────────────────────────────────
echo "==> Setting up Python virtual environment..."
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --upgrade pip
"$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt"

UVICORN="$APP_DIR/venv/bin/uvicorn"

# ── Systemd services ──────────────────────────────────────────────────────────
echo "==> Installing systemd services..."
for s in syncdeck-rcd syncdeck; do
  sed \
    -e "s|__USER__|$USER|g" \
    -e "s|__DIR__|$APP_DIR|g" \
    -e "s|__RCLONE__|$(command -v rclone)|g" \
    -e "s|__UVICORN__|$UVICORN|g" \
    -e "s|__BIND__|$BIND|g" \
    -e "s|__PORT__|$PORT|g" \
    "$APP_DIR/deploy/$s.service" \
    | sudo tee /etc/systemd/system/$s.service >/dev/null
done

sudo systemctl daemon-reload
sudo systemctl enable --now syncdeck-rcd syncdeck

echo ""
echo "✅ SyncDeck is running!"
echo "   Open: http://$(hostname -I | awk '{print $1}'):$PORT"
echo ""

# ── Autoupdate ────────────────────────────────────────────────────────────────
read -r -p "Install rclone daily auto-update timer? [Y/n] " ans
if [[ "${ans,,}" != "n" ]]; then
  bash "$APP_DIR/install-autoupdate.sh"
fi
