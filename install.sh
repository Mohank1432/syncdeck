#!/usr/bin/env bash
# SyncDeck installer (systemd / bare Linux)
set -e

APP_DIR="${APP_DIR:-$HOME/Apps/syncdeck}"
BIND="${BIND:-0.0.0.0}"
PORT="${PORT:-8768}"

# ── Prerequisites ─────────────────────────────────────────────────────────────
echo "==> Checking prerequisites..."
command -v rclone >/dev/null 2>&1 || {
  echo "rclone not found. Installing..."
  curl https://rclone.org/install.sh | sudo bash
}

command -v pip3 >/dev/null 2>&1 || sudo apt-get install -y python3-pip

# ── Install files ─────────────────────────────────────────────────────────────
echo "==> Installing to $APP_DIR..."
mkdir -p "$APP_DIR"
cp -r backend/ frontend/ deploy/ "$APP_DIR/"
cp requirements.txt "$APP_DIR/"
[ -f .env ] && cp .env "$APP_DIR/" || cp .env.example "$APP_DIR/.env"

# Install Python requirements
pip3 install --user -r "$APP_DIR/requirements.txt"

PYTHON=$(command -v python3)
UVICORN=$(python3 -m site --user-base)/bin/uvicorn

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
