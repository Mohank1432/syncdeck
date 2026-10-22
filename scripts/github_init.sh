#!/usr/bin/env bash
# Initialize git repo and push to GitHub for the first time.
# Usage:  bash scripts/github_init.sh <github-username> <repo-name>
#
# Prerequisites: gh CLI installed and authenticated, OR set GITHUB_TOKEN env var.
set -euo pipefail

USERNAME="${1:-}"
REPO="${2:-syncdeck}"

if [[ -z "$USERNAME" ]]; then
  echo "Usage: $0 <github-username> [repo-name]"
  exit 1
fi

cd "$(dirname "$0")/.."

echo "==> Initialising git repository..."
git init -b main
git add .
git commit -m "feat: SyncDeck initial release — modern homeserver transfer dashboard for rclone

- FastAPI backend with async SQLite (aiosqlite)
- Server-Sent Events for live transfer progress
- Multi-remote support: any rclone backend (Google Drive, S3, Drime, OneDrive, etc.)
- Cloud-to-cloud & server-to-cloud transfers
- Saved jobs with one-tap run
- Path allowlist security
- Mobile-first PWA (offline shell, installable)
- Docker Compose + systemd installers
- rclone daily auto-update with rollback"

echo "==> Creating GitHub repository..."
if command -v gh &>/dev/null; then
  gh repo create "$USERNAME/$REPO" \
    --public \
    --description "⚡ Modern, mobile-first homeserver transfer dashboard for rclone and cloud storage (Google Drive, S3, Drime, OneDrive, Dropbox). <150MB RAM." \
    --homepage "" \
    --source . \
    --remote origin \
    --push
else
  echo "gh CLI not found. Creating repo via API..."
  curl -s -X POST \
    -H "Authorization: token ${GITHUB_TOKEN:?Set GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    https://api.github.com/user/repos \
    -d "{\"name\":\"$REPO\",\"description\":\"Modern homeserver transfer dashboard for rclone and cloud storage\",\"private\":false}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('Created:', d.get('html_url','error: '+str(d)))"
  git remote add origin "https://github.com/$USERNAME/$REPO.git"
  git push -u origin main
fi

echo ""
echo "✅ Pushed to https://github.com/$USERNAME/$REPO"
echo "   Next steps:"
echo "   1. Add topics: rclone homeserver file-transfer pwa selfhosted"
echo "   2. Add a screenshot to README.md"
echo "   3. Enable GitHub Discussions for community Q&A"
