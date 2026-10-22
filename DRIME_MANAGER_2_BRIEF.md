# Drime Manager 2: Project Brief

A mobile-first web app that manages cloud storage and file transfers on a home server, built on top of rclone. This brief describes what already exists, what to build, and the constraints.

## 1. Goal

Make moving files between a home Linux server and any cloud storage a one-tap job from a phone or browser. Transfers must keep running in the background. The app should feel polished, fast and safe, and use very little RAM.

## 2. Starting point (v1, already working)

- Python Flask app, single static HTML page, no build step.
- Talks to a local `rclone rcd` daemon (`http://127.0.0.1:5572`, `--rc-no-auth`, localhost only) over its RC API.
- Runs as two systemd services (`drime-rcd`, `drime-manager`) on port 8768, bound to a Tailscale IP.
- Features: dual-pane browser (server `/mnt` and the cloud remote), copy or sync folders, dry run, live monitor (speed, ETA, per-file progress), jobs list with stop, mid-transfer speed limit, settings form generated from rclone's provider options, daily rclone auto-update with rollback.
- RC calls in use: `operations/list`, `operations/copyfile`, `operations/mkdir`, `operations/about`, `sync/copy`, `sync/sync`, `core/stats`, `core/bwlimit`, `core/version`, `job/status`, `job/stop`, `config/providers`, `config/create`, `config/update`, `config/get`, `config/listremotes`. Transfers are started with `_async: true` and `_config` overrides (`Transfers`, `DryRun`).

## 3. Target environment and constraints

- Server: Linux Mint (Ubuntu 24.04 base), **4 GB RAM** plus 8 GB swap, several Docker containers already running (Emby, Stash, qBittorrent, Prowlarr, Homepage). Target **under 150 MB RAM** for the app.
- Access is through Tailscale. The server is not exposed to the internet by default.
- Backend: Python 3.12, FastAPI (or keep Flask), SQLite. Frontend: static files built ahead of time, with no Node process at runtime.
- Delivery: a single `docker-compose.yml` (app plus rclone) **and** a plain systemd option. Include a README, a `.env.example`, no hard-coded secrets.
- rclone must update itself automatically (daily timer, restart only when idle, roll back if the new version fails to start). The v1 script `rclone-autoupdate.sh` is the reference.
- Must work well on a phone browser (about 380 px wide) and a desktop.

## 4. Features

Priority: **P1** build first, **P2** next, **P3** later.

### 4.1 Generalization
| Pri | Feature | Notes |
|---|---|---|
| P1 | Multiple remotes of any rclone backend | "New remote" wizard driven by `config/providers`; list, edit, test and delete remotes |
| P1 | Cloud to cloud transfers | Source and destination can be any two remotes, including the local server |
| P2 | Encryption toggle | Create an rclone `crypt` remote layered on top of a chosen remote |
| P2 | Guided OAuth (Google Drive, OneDrive) | Headless helper: show the `rclone authorize` command, accept the pasted token |
| P2 | Allowed local roots configurable in the UI | Show free space per drive |

### 4.2 Less effort
| Pri | Feature | Notes |
|---|---|---|
| P1 | Saved jobs | Name, source, destination, mode, options; run with one tap |
| P1 | Scheduler | Cron-like schedules per saved job; time-of-day bandwidth limits (e.g. full speed 00:00-07:00, 2 MB/s otherwise) |
| P1 | Dry-run preview | Summary of new, changed and to-be-deleted items, then Confirm |
| P1 | Notifications | Telegram and ntfy: job finished, failed, daily summary |
| P2 | Retries and queue | Automatic retry with backoff, reorder, pause, resume |
| P2 | Stack hooks | Optional "copy to cloud after move" for the Media Mover webhook, backup of Docker `config/` folders and Nextcloud data, JSON status endpoint for a Homepage tile |
| P2 | Phone uploads | Upload from the browser to the server, then optionally on to a remote; PWA share target |
| P3 | Share links | `operations/publiclink` for any file |
| P3 | Storage tools | Folder size breakdown, duplicate finder, integrity check (`rclone check`), mount a remote and expose it via Samba |

### 4.3 Safety and reliability
| Pri | Feature | Notes |
|---|---|---|
| P1 | Path allowlist and delete confirmation | Reject paths outside allowed roots (resolve symlinks, block `..`); confirm sync and delete |
| P1 | Undo for sync deletes | `--backup-dir` with retention of N days |
| P1 | Persistent history | SQLite: jobs, runs, logs, settings; export and import settings |
| P2 | Plain-language errors | Map common rclone errors (quota, auth, rate limit, network) to readable messages with a suggested fix |
| P2 | Read-only mode | Global toggle |
| P3 | Optional authentication | Passkey or OIDC for when the app is exposed beyond Tailscale; HTTPS guidance |

### 4.4 Interface and polish
| Pri | Feature | Notes |
|---|---|---|
| P1 | Installable PWA | Manifest, icons, offline shell, running-jobs badge |
| P1 | Live updates | Server-Sent Events instead of polling; speed sparkline; progress in the tab title |
| P1 | Design system | Light and dark themes, accent colour, compact density option, consistent icon set, mono type for paths, respects reduced motion, visible focus states, accessible contrast |
| P2 | File browser polish | Thumbnails for images and video, tappable breadcrumbs, long-press multi-select, bottom sheet actions on mobile, drag and drop on desktop |
| P2 | Onboarding wizard | Connect the first remote in three steps with a test |
| P2 | Dashboard | Last backup time per saved job, bytes moved per day chart, storage used per remote |
| P3 | Command palette | Ctrl+K, global search across remotes, keyboard shortcuts |

## 5. Suggested architecture

- **Backend**: thin API layer over `rclone rcd`. Rclone owns the transfers, so they survive app restarts. The app owns saved jobs, schedules, history and notifications in SQLite. A background scheduler (APScheduler or a small asyncio loop) triggers jobs.
- **Job tracking**: store the rclone `jobid` together with the daemon start time, so ids are not confused after a daemon restart. Use `_group` per job to read per-job stats from `core/stats`.
- **Realtime**: one SSE stream (`/api/events`) pushing stats and job changes; the client falls back to polling.
- **Frontend**: lightweight framework (Svelte, Preact or plain Web Components), built ahead of time into static files served by the backend.
- **Security**: bind to the configured address only; keep the rclone RC port on localhost; validate every path server-side; never log credentials; mask secrets in API responses.

## 6. Delivery phases

1. **Foundation**: SQLite, SSE, multi-remote management, PWA shell, design system, path allowlist.
2. **Convenience**: saved jobs, scheduler with bandwidth windows, dry-run preview, notifications, backup-dir undo.
3. **Extras**: thumbnails, search, phone uploads, share links, stack hooks, storage tools.

## 7. Acceptance criteria

- A fresh install on the target server works with one command, and the first remote can be connected from a phone in under two minutes.
- A transfer started from a phone keeps running after the browser is closed, and its progress and result are visible on return.
- A scheduled job runs unattended, and a Telegram or ntfy message arrives on completion or failure.
- Sync never deletes anything without an explicit confirmation, and deleted files can be recovered within the retention period.
- Idle app memory stays under 150 MB, and the UI stays responsive during a transfer.
- Lighthouse scores of at least 90 for performance, accessibility and PWA on mobile.
- rclone updates itself, does not interrupt a running transfer, and rolls back automatically on a failed update.

## 8. Out of scope for now

Multi-user accounts, a public SaaS deployment, and a native mobile app.
