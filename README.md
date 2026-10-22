# SyncDeck ⚡

**Modern, mobile-first homeserver transfer dashboard for rclone and cloud storage.**  
Move, copy, and sync files between your home server and any cloud storage (Drime, Google Drive, S3, OneDrive, Dropbox, SFTP, and 50+ backends) with live progress, saved jobs, and zero terminal required.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.12+](https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![RAM Usage](https://img.shields.io/badge/RAM-%3C150MB-success)](README.md)
[![PWA Ready](https://img.shields.io/badge/PWA-Installable-purple)](README.md)

---

## What is SyncDeck?

**SyncDeck** is a lightweight, self-hosted web interface and progressive web app (PWA) built on top of [rclone](https://rclone.org)'s Remote Control (RC) daemon.

Designed specifically for home servers (Linux Mint, Ubuntu, Debian, Raspberry Pi, Unraid, TrueNAS, CasaOS) and mobile browsers, it gives you a touch-friendly cockpit to:
- Move files between local storage and cloud providers with one tap.
- Run cloud-to-cloud transfers (e.g. Google Drive directly to Drime or S3) without consuming local disk space.
- Monitor active bandwidth, transfer speeds, and per-file progress live.
- Create saved jobs and run backups with zero hassle.
- Keep idle memory consumption **under 150 MB RAM** (typically 60–80 MB).

---

## ✨ Features

### 🔄 Multi-Cloud & Local Transfers
- **Any rclone backend**: Supports Drime, Google Drive, Microsoft OneDrive, Amazon S3, Cloudflare R2, Backblaze B2, Dropbox, Proton Drive, Nextcloud, SFTP, WebDAV, SMB, and more.
- **Cloud-to-Cloud**: Transfer directly between any two remote cloud providers.
- **Dual-Pane Browser**: Clean file tree with breadcrumbs, multi-select, and new folder creation.
- **Copy & Sync Modes**: Run safe copies or directory syncs with delete protection confirmations.
- **Dry-Run Preview**: Preview exact changes before moving or deleting files.

### 📊 Live Monitoring
- **Real-time SSE stream**: Live stats pushed via Server-Sent Events (no constant polling).
- **Speed Sparkline**: 60-second visual bandwidth graph.
- **Per-file progress**: Current file names, individual speeds, percentage bars, and ETAs.
- **Bandwidth throttling**: Set speed limits on the fly (1 MB/s, 2 MB/s, 5 MB/s, custom, or unlimited).
- **Job control**: Stop or cancel active jobs mid-transfer.

### 📋 Saved Jobs & History
- Save frequent transfers as named, one-tap jobs.
- Persistent SQLite run history that survives daemon restarts.
- View status, duration, error logs, and total bytes transferred per job.

### ☁️ Remote Management Wizard
- Add, edit, test, and delete remotes directly in the web UI.
- Dynamically discovers option schemas directly from rclone's provider registry.
- Sensitive fields (tokens, passwords, client secrets) are masked and protected.

### 🛡️ Safety & Reliability
- **Path allowlist**: Strict server-side validation against `ALLOWED_ROOTS` (blocks traversal and symlink escapes).
- **Isolated daemon**: In Docker, rclone RC is confined to an internal container bridge network.
- **Non-root execution**: Runs under a dedicated unprivileged user.

---

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended)

1. Clone the repository:
   ```bash
   git clone https://github.com/mohank1432/syncdeck.git
   cd syncdeck
   ```
2. Create your environment configuration:
   ```bash
   cp .env.example .env
   # Edit ALLOWED_ROOTS or MEDIA_ROOT in .env if desired
   ```
3. Start the containers:
   ```bash
   docker compose up -d
   ```
4. Open **`http://localhost:8768`** (or your server's Tailscale / LAN IP) in your browser.

---

### Option 2: Bare Linux (Systemd)

Ideal for lightweight home servers, SBCs, and Raspberry Pis:

```bash
git clone https://github.com/YOUR_USERNAME/syncdeck.git
cd syncdeck
chmod +x install.sh
./install.sh
```

The installer will:
1. Verify rclone installation (or install it if missing).
2. Install minimal Python dependencies via `pip`.
3. Set up `syncdeck.service` and `syncdeck-rcd.service` systemd units.
4. Optionally configure daily rclone auto-updates with rollback protection.

---

## ⚙️ Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `RC_URL` | `http://127.0.0.1:5572` | URL of the rclone RC daemon. |
| `BIND` | `0.0.0.0` | Bind address. Set to your Tailscale IP (e.g. `100.x.y.z`) to restrict to your private mesh. |
| `PORT` | `8768` | Port for the web interface. |
| `DB_PATH` | `./syncdeck.db` | SQLite database location for saved jobs and history. |
| `ALLOWED_ROOTS` | `/mnt` | Comma-separated list of allowed local paths (e.g. `/mnt,/home/user/downloads`). |

---

## 💡 Example: Adding Your First Remote

SyncDeck makes connecting any cloud storage simple:

1. Open SyncDeck and click the **Remotes** tab.
2. Click **+ Add Remote**.
3. **Choose your provider:**
   - **Drime**: Select `drime` (or generic WebDAV/S3), enter your API token/endpoint, and click Test.
   - **Google Drive**: Select `drive`, enter credentials or follow the token helper.
   - **Amazon S3 / Cloudflare R2 / B2**: Select `s3`, fill in your access key, secret, and endpoint.
4. Click **Test Connection** to verify quota and connectivity.
5. Click **Save** — your remote immediately appears in the Transfer panes!

---

## 🏗️ Architecture

```
📱 Mobile / Desktop Browser (PWA)
       │
       │ HTTP REST + SSE (/api/events)
       ▼
⚡ FastAPI Backend (Python 3.12, uvicorn)
       │
       ├──── SQLite (syncdeck.db) ── Jobs, history, local roots
       │
       │ HTTP RC Client (httpx singleton)
       ▼
⚙️ rclone rcd (localhost:5572)
       │
       ▼
☁️ Cloud Remotes & Local Disks
   (Drime, Google Drive, S3, Dropbox, OneDrive, /mnt, ...)
```

---

## 📱 Progressive Web App (PWA)

SyncDeck is a full PWA:
- On iOS Safari: Tap **Share** → **Add to Home Screen**.
- On Android Chrome: Tap the three dots → **Install App**.
- Operates in standalone windowed mode with offline shell caching.
- Active background transfers show an indicator badge on the monitor icon.

---

## 🔄 Daily rclone Auto-Update

If enabled during systemd installation, a daily timer (`deploy/rclone-autoupdate.timer`) runs at ~04:30:
1. Verifies no transfers are actively running.
2. Updates rclone to the latest upstream release.
3. Performs a sanity check on startup; if the new version fails, it automatically rolls back to the previous working binary without interrupting your services.

---

## 🤝 Contributing

Contributions, bug reports, and suggestions are welcome!

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/cool-feature`).
3. Commit your changes (`git commit -m 'feat: add cool feature'`).
4. Push to your branch (`git push origin feature/cool-feature`).
5. Open a Pull Request.

---

## 📄 License

Distributed under the [MIT License](LICENSE). Copyright © 2025 SyncDeck Contributors.
