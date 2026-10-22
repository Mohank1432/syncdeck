/**
 * SyncDeck Frontend
 * Mobile-first PWA controlling rclone file transfers.
 * Plain vanilla JS, no external dependencies.
 */

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  activeTab: 'transfer',
  theme: 'auto',
  remotes: [],       // [{name, type}]
  roots: [],         // [{id, path, label}]
  transfer: {
    src: {
      remote: 'local', // 'local' or remote name
      rootPath: '',    // local root path
      fs: '',          // computed fs ('/mnt' or 'gdrive:')
      path: '',        // relative subpath
      parent: null,
      items: [],
      selected: new Set()
    },
    dst: {
      remote: '',
      rootPath: '',
      fs: '',
      path: '',
      parent: null,
      items: [],
      selectedFolder: null // selected target directory in current view
    },
    mode: 'copy',      // 'copy' | 'sync'
    transfers: 2,      // 1 | 2 | 4
    dryRun: false
  },
  speedHistory: new Array(60).fill(0),
  sseConnected: false,
  pollTimer: null,
  activeRunsCount: 0,
  savedJobs: [],
  recentRuns: [],
  settings: {}
};

// ── Utilities ────────────────────────────────────────────────────────────────

/**
 * Fetch wrapper for SyncDeck API.
 * Throws Error with .message on failure.
 */
async function api(url, body = undefined, method = undefined) {
  const options = {
    headers: {}
  };

  if (body !== undefined) {
    options.method = method || 'POST';
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  } else if (method) {
    options.method = method;
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new Error('Network error: ' + (err.message || 'Server unreachable'));
  }

  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    data = {};
  }

  if (!res.ok) {
    const msg = data.error || data.detail || data.message || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  return data;
}

/**
 * Format bytes to human readable string (e.g. "12.4 MB")
 */
function fmt(bytes) {
  if (bytes == null || isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let n = Number(bytes);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  const decimals = i === 0 || n >= 100 ? 0 : 1;
  return `${n.toFixed(decimals)} ${units[i]}`;
}

/**
 * Format duration in seconds to "2h 30m" or "5m 12s" or "45s"
 */
function fmtDuration(seconds) {
  if (seconds == null || isNaN(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/**
 * Format date/timestamp to readable string
 */
function fmtTime(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (_) {
    return String(dateStr);
  }
}

/**
 * Toast notifications
 */
let toastTimeout;
function toast(msg, type = 'info') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `show toast-${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    t.className = '';
  }, 4000);
}

/**
 * Tiny DOM builder
 */
function el(tag, attrs = {}, ...children) {
  const elem = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') {
      elem.className = v;
    } else if (k.startsWith('on') && typeof v === 'function') {
      elem.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') {
      elem[k] = Boolean(v);
    } else {
      elem.setAttribute(k, v);
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      elem.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      elem.appendChild(child);
    }
  }
  return elem;
}

/**
 * Async error wrapper for event handlers
 */
function guard(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(err);
      toast(err.message || 'An error occurred', 'bad');
    }
  };
}

// ── Theme ────────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem('syncdeck-theme') || localStorage.getItem('drime-theme') || 'auto';
  setTheme(saved);

  const toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'auto';
      const isDark = current === 'dark' || (current === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const next = isDark ? 'light' : 'dark';
      setTheme(next);
      toast(`Theme set to ${next}`, 'info');
    });
  }

  // Update button icon when system preference changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('syncdeck-theme') || localStorage.getItem('drime-theme')) === 'auto') {
      updateThemeIcon('auto');
    }
  });
}

function setTheme(theme) {
  state.theme = theme;
  localStorage.setItem('syncdeck-theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);
}

function updateThemeIcon(theme) {
  const toggleBtn = document.getElementById('theme-toggle');
  if (!toggleBtn) return;
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  toggleBtn.textContent = isDark ? '☀️' : '🌙';
  toggleBtn.setAttribute('title', `Theme: ${theme} (Click to toggle)`);
}

// ── Modal Helper ─────────────────────────────────────────────────────────────

function openModal({ title, body, footer, onClose }) {
  const overlay = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const footerEl = document.getElementById('modal-footer');
  const closeBtn = document.getElementById('modal-close');

  titleEl.textContent = title || '';
  bodyEl.replaceChildren(...(Array.isArray(body) ? body : [body]));

  if (footer) {
    footerEl.replaceChildren(...(Array.isArray(footer) ? footer : [footer]));
    footerEl.hidden = false;
  } else {
    footerEl.hidden = true;
  }

  overlay.hidden = false;

  const handleClose = () => {
    closeModal();
    if (onClose) onClose();
  };

  closeBtn.onclick = handleClose;
  overlay.onclick = (e) => {
    if (e.target === overlay) handleClose();
  };
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.hidden = true;
}

// ── Tab Router ───────────────────────────────────────────────────────────────

function initTabs() {
  const allTabs = document.querySelectorAll('[data-tab]');
  allTabs.forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const target = tabBtn.getAttribute('data-tab');
      if (target) showTab(target);
    });
  });
}

function showTab(tabName) {
  state.activeTab = tabName;

  // Sync tab buttons (desktop and mobile)
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });

  // Switch panels
  document.querySelectorAll('#app-main > .panel').forEach(panel => {
    const isTarget = panel.id === `panel-${tabName}`;
    panel.classList.toggle('active', isTarget);
  });

  // Trigger tab-specific load/refresh
  switch (tabName) {
    case 'transfer':
      if (state.remotes.length === 0) {
        loadTransferRemotes();
      }
      break;
    case 'monitor':
      loadStatus();
      loadRuns();
      requestAnimationFrame(drawSparkline);
      break;
    case 'jobs':
      loadJobs();
      break;
    case 'remotes':
      loadRemotesTab();
      break;
    case 'settings':
      loadRoots();
      loadSettings();
      loadVersion();
      break;
  }
}

// ── SSE / Polling ────────────────────────────────────────────────────────────

let sseSource = null;

function connectSSE() {
  if (sseSource) {
    sseSource.close();
  }

  try {
    sseSource = new EventSource('/api/events');

    sseSource.addEventListener('connected', () => {
      state.sseConnected = true;
      if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
      }
    });

    sseSource.addEventListener('stats', (e) => {
      try {
        const data = JSON.parse(e.data);
        onStats(data);
      } catch (err) {
        console.error('SSE stats parse error:', err);
      }
    });

    sseSource.addEventListener('run_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        onRunUpdate(data);
      } catch (err) {
        console.error('SSE run_update parse error:', err);
      }
    });

    sseSource.addEventListener('keepalive', () => {});

    sseSource.onerror = () => {
      state.sseConnected = false;
      sseSource.close();
      startFallbackPolling();
      // Attempt reconnection after 15 seconds
      setTimeout(connectSSE, 15000);
    };
  } catch (err) {
    console.warn('EventSource failed, using fallback polling:', err);
    startFallbackPolling();
  }
}

function startFallbackPolling() {
  if (!state.pollTimer) {
    state.pollTimer = setInterval(() => {
      loadStatus();
      if (state.activeTab === 'monitor') {
        loadRuns();
      }
    }, 5000);
  }
}

function onStats(stats) {
  if (!stats) return;

  // Push speed to sparkline circular buffer (last 60 readings)
  const speed = Number(stats.speed) || 0;
  state.speedHistory.push(speed);
  if (state.speedHistory.length > 60) {
    state.speedHistory.shift();
  }

  // Active runs badge update
  const transferringCount = (stats.transferring && stats.transferring.length) || 0;
  const activeCount = stats.active_runs != null ? stats.active_runs : transferringCount;
  updateActiveBadge(activeCount);

  // Update monitor tab if visible
  drawStats(stats);
  drawSparkline();
  drawTransferringFiles(stats.transferring || []);
  if (stats.bwlimit) {
    drawBwLimit(stats.bwlimit.rate);
  }
}

function onRunUpdate(runData) {
  if (state.activeTab === 'monitor') {
    loadRuns();
  }
  if (state.activeTab === 'jobs') {
    loadJobs();
  }
}

function updateActiveBadge(count) {
  state.activeRunsCount = count;
  const activeBadge = document.getElementById('active-badge');
  const mobileBadge = document.getElementById('mobile-badge');

  [activeBadge, mobileBadge].forEach(b => {
    if (!b) return;
    if (count > 0) {
      b.textContent = `${count} active`;
      b.className = 'badge badge-running';
      b.hidden = false;
    } else {
      b.hidden = true;
    }
  });
}

// ── Monitor Tab ──────────────────────────────────────────────────────────────

async function loadStatus() {
  try {
    const data = await api('/api/status');
    if (data.stats) onStats(data.stats);
    if (data.bwlimit) drawBwLimit(data.bwlimit.rate);
    if (data.runs) drawRuns(data.runs);
  } catch (_) {
    // Non-blocking in background
  }
}

function drawStats(stats) {
  const grid = document.getElementById('stat-grid');
  if (!grid) return;

  const speedVal = `${fmt(stats.speed || 0)}/s`;
  const bytesVal = `${fmt(stats.bytes || 0)}${stats.totalBytes ? ' / ' + fmt(stats.totalBytes) : ''}`;
  const etaVal = fmtDuration(stats.eta);
  const errorsVal = String(stats.errors || 0);

  grid.replaceChildren(
    el('div', { class: 'stat-cell' },
      el('span', { class: 'stat-label' }, 'Speed'),
      el('span', { class: 'stat-val' }, speedVal)
    ),
    el('div', { class: 'stat-cell' },
      el('span', { class: 'stat-label' }, 'Transferred'),
      el('span', { class: 'stat-val' }, bytesVal)
    ),
    el('div', { class: 'stat-cell' },
      el('span', { class: 'stat-label' }, 'Time Left'),
      el('span', { class: 'stat-val' }, etaVal)
    ),
    el('div', { class: 'stat-cell' },
      el('span', { class: 'stat-label' }, 'Errors'),
      el('span', { class: 'stat-val', style: stats.errors > 0 ? 'color: var(--bad)' : '' }, errorsVal)
    )
  );
}

function drawSparkline() {
  const canvas = document.getElementById('sparkline');
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  const width = rect.width || 300;
  const height = 60;

  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }

  ctx.resetTransform();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const data = state.speedHistory;
  const maxVal = Math.max(...data, 1024); // at least 1 KB/s for scale

  // Line & fill style using accent color
  const computedStyle = getComputedStyle(document.documentElement);
  const accentColor = computedStyle.getPropertyValue('--accent').trim() || '#0b7285';

  const pts = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - 4 - (val / maxVal) * (height - 8);
    return [x, y];
  });

  if (pts.length < 2) return;

  // Draw gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, accentColor + '44');
  grad.addColorStop(1, accentColor + '00');

  ctx.beginPath();
  ctx.moveTo(pts[0][0], height);
  ctx.lineTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.lineTo(pts[pts.length - 1][0], height);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Draw sparkline stroke
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawBwLimit(currentRate) {
  const bwnow = document.getElementById('bwnow');
  if (bwnow) {
    bwnow.textContent = currentRate && currentRate !== 'off' ? `(${currentRate})` : '(No limit)';
  }

  const chipsContainer = document.getElementById('bw-chips');
  if (!chipsContainer) return;

  const presets = [
    { label: 'Off', val: 'off' },
    { label: '1 MB/s', val: '1M' },
    { label: '2 MB/s', val: '2M' },
    { label: '5 MB/s', val: '5M' },
    { label: '10 MB/s', val: '10M' }
  ];

  chipsContainer.replaceChildren(
    ...presets.map(p => el('button', {
      class: `bw-chip${currentRate === p.val ? ' active' : ''}`,
      onclick: guard(async () => {
        await setBwlimit(p.val);
      })
    }, p.label))
  );
}

async function setBwlimit(rate) {
  const res = await api('/api/bwlimit', { rate });
  toast(`Bandwidth limit set to ${res.rate || rate}`, 'ok');
  drawBwLimit(res.rate || rate);
}

function initBwControls() {
  const setBtn = document.getElementById('bw-set');
  const offBtn = document.getElementById('bw-off');
  const valInput = document.getElementById('bw-val');

  if (setBtn && valInput) {
    setBtn.addEventListener('click', guard(async () => {
      const num = parseFloat(valInput.value);
      if (isNaN(num) || num <= 0) {
        toast('Please enter a valid rate in MB/s', 'bad');
        return;
      }
      await setBwlimit(`${num}M`);
      valInput.value = '';
    }));
  }

  if (offBtn) {
    offBtn.addEventListener('click', guard(async () => {
      await setBwlimit('off');
    }));
  }

  const clearRunsBtn = document.getElementById('clear-runs');
  if (clearRunsBtn) {
    clearRunsBtn.addEventListener('click', guard(async () => {
      await api('/api/clear', {});
      toast('Cleared finished jobs', 'ok');
      await loadRuns();
    }));
  }
}

function drawTransferringFiles(files) {
  const card = document.getElementById('files-card');
  const list = document.getElementById('files-list');
  if (!card || !list) return;

  if (!files || files.length === 0) {
    card.hidden = true;
    list.replaceChildren();
    return;
  }

  card.hidden = false;
  list.replaceChildren(
    ...files.map(f => {
      const pct = f.size > 0 ? Math.min(100, Math.round((f.bytes / f.size) * 100)) : (f.percentage || 0);
      return el('div', { class: 'transferring-file' },
        el('div', { class: 'transferring-header' },
          el('span', { class: 'transferring-name', title: f.name }, f.name),
          el('span', { class: 'transferring-stats' },
            `${fmt(f.speed)}/s • ${pct}%`
          )
        ),
        el('div', { class: 'progress-bar' },
          el('div', { class: 'progress-fill', style: `width: ${pct}%` })
        )
      );
    })
  );
}

async function loadRuns() {
  try {
    const res = await api('/api/runs?limit=50');
    state.recentRuns = res.runs || [];
    drawRuns(state.recentRuns);
  } catch (err) {
    console.warn('Error loading runs:', err);
  }
}

function drawRuns(runs) {
  const list = document.getElementById('runs-list');
  if (!list) return;

  if (!runs || runs.length === 0) {
    list.replaceChildren(
      el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '📋'),
        el('p', {}, 'No transfer history yet')
      )
    );
    return;
  }

  list.replaceChildren(
    ...runs.map(run => {
      let statusClass = 'badge-stopped';
      let statusText = run.status || 'unknown';

      if (run.dry_run) {
        statusClass = 'badge-dry';
        statusText = 'dry run';
      } else if (run.status === 'running') {
        statusClass = 'badge-running';
      } else if (run.status === 'done' || run.status === 'success') {
        statusClass = 'badge-done';
        statusText = 'done';
      } else if (run.status === 'failed' || run.errors > 0) {
        statusClass = 'badge-failed';
        statusText = 'failed';
      }

      const label = run.label || `${run.src_fs} → ${run.dst_fs}`;

      const runRow = el('div', { class: 'run-row' },
        el('div', { class: 'run-main' },
          el('div', { class: 'run-title' },
            el('span', { class: `badge ${statusClass}` }, statusText),
            el('span', { title: label }, label)
          ),
          el('div', { class: 'run-details' },
            el('span', {}, `${run.src_fs} ➔ ${run.dst_fs}`),
            run.bytes_transferred ? el('span', {}, fmt(run.bytes_transferred)) : null,
            el('span', {}, fmtTime(run.started_at)),
            run.error_msg ? el('span', { style: 'color: var(--bad)' }, run.error_msg) : null
          )
        ),
        el('div', { class: 'run-actions' },
          run.status === 'running' ? el('button', {
            class: 'btn btn-danger btn-sm',
            onclick: guard(async () => {
              await api('/api/stop', { run_id: run.id, id: run.id });
              toast('Job stop requested', 'ok');
              await loadRuns();
            })
          }, 'Stop') : null
        )
      );

      return runRow;
    })
  );
}

// ── Transfer Tab ─────────────────────────────────────────────────────────────

async function loadTransferRemotes() {
  try {
    const [remotesRes, rootsRes] = await Promise.all([
      api('/api/remotes'),
      api('/api/roots').catch(() => ({ roots: [] }))
    ]);

    state.remotes = remotesRes.remotes || [];
    state.roots = rootsRes.roots || [];

    setupPicker('src');
    setupPicker('dst');

    await loadPane('src');
    await loadPane('dst');
  } catch (err) {
    console.error('Failed to load remotes:', err);
    toast(err.message, 'bad');
  }
}

function setupPicker(role) {
  const remotePicker = document.getElementById(`${role}-remote-picker`);
  const rootPicker = document.getElementById(`${role}-root-picker`);
  if (!remotePicker || !rootPicker) return;

  // Build remote options
  remotePicker.replaceChildren(
    el('option', { value: 'local' }, '📁 Local (Server)'),
    ...state.remotes.map(r => el('option', { value: r.name }, `☁ ${r.name} (${r.type})`))
  );

  // Build local root options
  rootPicker.replaceChildren(
    ...state.roots.map(root => el('option', { value: root.path }, `${root.label || root.path}`))
  );

  // Default selection
  if (role === 'src') {
    state.transfer.src.remote = 'local';
    state.transfer.src.rootPath = state.roots[0] ? state.roots[0].path : '/';
    state.transfer.src.fs = state.transfer.src.rootPath;
  } else {
    // If remotes available, select the first remote for destination by default; else local
    if (state.remotes.length > 0) {
      state.transfer.dst.remote = state.remotes[0].name;
      state.transfer.dst.fs = `${state.remotes[0].name}:`;
    } else {
      state.transfer.dst.remote = 'local';
      state.transfer.dst.rootPath = state.roots[0] ? state.roots[0].path : '/';
      state.transfer.dst.fs = state.transfer.dst.rootPath;
    }
  }

  remotePicker.value = state.transfer[role].remote;
  rootPicker.hidden = state.transfer[role].remote !== 'local';
  if (state.transfer[role].rootPath) {
    rootPicker.value = state.transfer[role].rootPath;
  }

  // Event handlers
  remotePicker.onchange = guard(async () => {
    const val = remotePicker.value;
    state.transfer[role].remote = val;
    state.transfer[role].path = '';
    state.transfer[role].selectedFolder = null;
    if (role === 'src') state.transfer.src.selected.clear();

    if (val === 'local') {
      rootPicker.hidden = false;
      const selectedRoot = rootPicker.value || (state.roots[0] ? state.roots[0].path : '/');
      state.transfer[role].rootPath = selectedRoot;
      state.transfer[role].fs = selectedRoot;
    } else {
      rootPicker.hidden = true;
      state.transfer[role].fs = `${val}:`;
    }

    await loadPane(role);
    updateTransferSummary();
  });

  rootPicker.onchange = guard(async () => {
    state.transfer[role].rootPath = rootPicker.value;
    state.transfer[role].fs = rootPicker.value;
    state.transfer[role].path = '';
    state.transfer[role].selectedFolder = null;
    if (role === 'src') state.transfer.src.selected.clear();
    await loadPane(role);
    updateTransferSummary();
  });
}

async function loadPane(role) {
  const pState = state.transfer[role];
  const listEl = document.getElementById(`${role}-list`);
  const breadcrumbEl = document.getElementById(`${role}-breadcrumb`);

  if (!pState.fs) return;

  if (listEl) {
    listEl.replaceChildren(
      el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '⏳'),
        el('p', {}, 'Loading items...')
      )
    );
  }

  try {
    const url = `/api/browse?fs=${encodeURIComponent(pState.fs)}&path=${encodeURIComponent(pState.path)}`;
    const data = await api(url);

    pState.parent = data.parent !== undefined ? data.parent : null;
    pState.items = (data.items || []).map(i => ({
      name: i.name,
      is_dir: Boolean(i.is_dir || i.dir),
      size: Number(i.size) || 0
    }));

    // In destination pane, show only directories
    if (role === 'dst') {
      pState.items = pState.items.filter(i => i.is_dir);
    }

    drawBreadcrumb(role, breadcrumbEl);
    drawFileList(role, listEl);
    updatePaneToolbar(role);
  } catch (err) {
    if (listEl) {
      listEl.replaceChildren(
        el('div', { class: 'empty-state' },
          el('div', { class: 'empty-icon' }, '⚠️'),
          el('p', { style: 'color: var(--bad)' }, err.message),
          el('button', {
            class: 'btn btn-sm',
            onclick: () => loadPane(role)
          }, 'Retry')
        )
      );
    }
  }
}

function drawBreadcrumb(role, container) {
  if (!container) return;
  const pState = state.transfer[role];

  const segments = [];
  const rootLabel = pState.remote === 'local' ? (pState.rootPath || 'Local') : `${pState.remote}:`;

  segments.push(
    el('span', {
      class: 'breadcrumb-seg',
      onclick: guard(async () => {
        pState.path = '';
        pState.selectedFolder = null;
        if (role === 'src') pState.selected.clear();
        await loadPane(role);
        updateTransferSummary();
      })
    }, rootLabel)
  );

  if (pState.path) {
    const parts = pState.path.split('/').filter(Boolean);
    let accum = '';
    parts.forEach((part, idx) => {
      accum = accum ? `${accum}/${part}` : part;
      const targetPath = accum;
      segments.push(el('span', { class: 'breadcrumb-sep' }, '/'));
      segments.push(
        el('span', {
          class: 'breadcrumb-seg',
          onclick: guard(async () => {
            pState.path = targetPath;
            pState.selectedFolder = null;
            if (role === 'src') pState.selected.clear();
            await loadPane(role);
            updateTransferSummary();
          })
        }, part)
      );
    });
  }

  container.replaceChildren(...segments);
}

function drawFileList(role, container) {
  if (!container) return;
  const pState = state.transfer[role];

  if (!pState.items || pState.items.length === 0) {
    container.replaceChildren(
      el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '📂'),
        el('p', {}, role === 'dst' ? 'No subfolders found' : 'Folder is empty')
      )
    );
    return;
  }

  const rows = pState.items.map(item => {
    if (role === 'src') {
      const isChecked = pState.selected.has(item.name);
      const row = el('div', {
        class: `file-row${isChecked ? ' is-selected' : ''}`,
        onclick: (e) => {
          // If clicked directly on the directory name, navigate into it
          if (e.target.classList.contains('is-dir')) return;
          // Otherwise toggle selection
          if (pState.selected.has(item.name)) {
            pState.selected.delete(item.name);
          } else {
            pState.selected.add(item.name);
          }
          row.classList.toggle('is-selected', pState.selected.has(item.name));
          const checkbox = row.querySelector('.file-checkbox');
          if (checkbox) checkbox.checked = pState.selected.has(item.name);
          updateTransferSummary();
        }
      },
        el('input', {
          type: 'checkbox',
          class: 'file-checkbox',
          checked: isChecked,
          'aria-label': `Select ${item.name}`,
          onclick: (e) => e.stopPropagation()
        }),
        el('span', { class: 'file-icon' }, item.is_dir ? '📁' : '📄'),
        el('span', {
          class: `file-name${item.is_dir ? ' is-dir' : ''}`,
          title: item.name,
          onclick: item.is_dir ? guard(async (e) => {
            e.stopPropagation();
            pState.path = pState.path ? `${pState.path}/${item.name}` : item.name;
            pState.selected.clear();
            await loadPane('src');
            updateTransferSummary();
          }) : null
        }, item.name),
        el('span', { class: 'file-size' }, item.is_dir ? '—' : fmt(item.size))
      );
      return row;
    } else {
      // Destination pane: only folders
      const isSelectedFolder = pState.selectedFolder === item.name;
      const row = el('div', {
        class: `file-row${isSelectedFolder ? ' is-selected' : ''}`,
        onclick: () => {
          // Select this folder as target destination
          if (pState.selectedFolder === item.name) {
            pState.selectedFolder = null;
          } else {
            pState.selectedFolder = item.name;
          }
          container.querySelectorAll('.file-row').forEach(r => r.classList.remove('is-selected'));
          if (pState.selectedFolder) row.classList.add('is-selected');
          updateTransferSummary();
        }
      },
        el('span', { class: 'file-icon' }, '📁'),
        el('span', { class: 'file-name is-dir', title: item.name }, item.name),
        el('button', {
          class: 'btn btn-ghost btn-sm',
          title: `Open folder ${item.name}`,
          onclick: guard(async (e) => {
            e.stopPropagation();
            pState.path = pState.path ? `${pState.path}/${item.name}` : item.name;
            pState.selectedFolder = null;
            await loadPane('dst');
            updateTransferSummary();
          })
        }, 'Open →')
      );
      return row;
    }
  });

  container.replaceChildren(...rows);
}

function updatePaneToolbar(role) {
  const pState = state.transfer[role];
  const upBtn = document.getElementById(`${role}-up`);
  if (upBtn) {
    upBtn.disabled = !pState.path;
  }
}

function initTransferControls() {
  // Up buttons
  ['src', 'dst'].forEach(role => {
    const upBtn = document.getElementById(`${role}-up`);
    if (upBtn) {
      upBtn.addEventListener('click', guard(async () => {
        const pState = state.transfer[role];
        if (!pState.path) return;
        const lastSlash = pState.path.lastIndexOf('/');
        pState.path = lastSlash >= 0 ? pState.path.slice(0, lastSlash) : '';
        pState.selectedFolder = null;
        if (role === 'src') pState.selected.clear();
        await loadPane(role);
        updateTransferSummary();
      }));
    }

    const refreshBtn = document.getElementById(`${role}-refresh`);
    if (refreshBtn) {
      refreshBtn.addEventListener('click', guard(async () => {
        await loadPane(role);
        toast(`Refreshed ${role === 'src' ? 'source' : 'destination'} pane`, 'info');
      }));
    }
  });

  // Select all / none on source
  const selectAllBtn = document.getElementById('src-all');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      const src = state.transfer.src;
      if (src.selected.size === src.items.length && src.items.length > 0) {
        src.selected.clear();
        selectAllBtn.textContent = 'Select All';
      } else {
        src.items.forEach(i => src.selected.add(i.name));
        selectAllBtn.textContent = 'Deselect All';
      }
      drawFileList('src', document.getElementById('src-list'));
      updateTransferSummary();
    });
  }

  // New folder on destination
  const mkdirBtn = document.getElementById('dst-mkdir');
  if (mkdirBtn) {
    mkdirBtn.addEventListener('click', () => {
      promptMkdir('dst');
    });
  }

  // Segmented controls: Mode
  const modeControl = document.getElementById('mode-control');
  if (modeControl) {
    modeControl.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        modeControl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.transfer.mode = btn.getAttribute('data-val') || 'copy';
        updateTransferSummary();
      });
    });
  }

  // Segmented controls: Parallel
  const parControl = document.getElementById('par-control');
  if (parControl) {
    parControl.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        parControl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.transfer.transfers = parseInt(btn.getAttribute('data-val') || '2', 10);
      });
    });
  }

  // Dry run checkbox
  const dryRunBox = document.getElementById('dry-run');
  if (dryRunBox) {
    dryRunBox.addEventListener('change', () => {
      state.transfer.dryRun = dryRunBox.checked;
      updateTransferSummary();
    });
  }

  // Start Transfer button
  const startBtn = document.getElementById('start-transfer');
  if (startBtn) {
    startBtn.addEventListener('click', guard(startTransfer));
  }
}

function promptMkdir(role) {
  const pState = state.transfer[role];
  const nameInput = el('input', {
    type: 'text',
    placeholder: 'Folder name',
    class: 'form-input',
    autofocus: true
  });

  openModal({
    title: 'Create New Folder',
    body: [
      el('div', { class: 'form-group' },
        el('label', { class: 'form-label' }, 'Folder Name'),
        nameInput
      )
    ],
    footer: [
      el('button', {
        class: 'btn btn-ghost',
        onclick: closeModal
      }, 'Cancel'),
      el('button', {
        class: 'btn btn-primary',
        onclick: guard(async () => {
          const val = nameInput.value.trim();
          if (!val) {
            toast('Folder name cannot be empty', 'bad');
            return;
          }
          await api('/api/browse/mkdir', {
            fs: pState.fs,
            path: pState.path,
            name: val
          });
          closeModal();
          toast(`Created folder "${val}"`, 'ok');
          await loadPane(role);
        })
      }, 'Create')
    ]
  });

  setTimeout(() => nameInput.focus(), 100);
}

function updateTransferSummary() {
  const summaryEl = document.getElementById('transfer-summary');
  const startBtn = document.getElementById('start-transfer');
  const selectAllBtn = document.getElementById('src-all');
  if (!summaryEl || !startBtn) return;

  const src = state.transfer.src;
  const dst = state.transfer.dst;
  const count = src.selected.size;

  if (selectAllBtn) {
    selectAllBtn.textContent = (count === src.items.length && src.items.length > 0) ? 'Deselect All' : 'Select All';
  }

  if (count === 0) {
    summaryEl.textContent = 'Nothing selected';
    startBtn.disabled = true;
    return;
  }

  // Calculate total selected size
  let totalBytes = 0;
  src.items.forEach(it => {
    if (src.selected.has(it.name)) {
      totalBytes += it.size;
    }
  });

  // Calculate destination path
  const targetDstPath = dst.selectedFolder
    ? (dst.path ? `${dst.path}/${dst.selectedFolder}` : dst.selectedFolder)
    : (dst.path || '(root)');

  const dstTargetLabel = `${dst.fs}${targetDstPath !== '(root)' ? targetDstPath : ''}`;

  summaryEl.textContent = `${count} item${count > 1 ? 's' : ''} (${fmt(totalBytes)}) ➔ ${dstTargetLabel}${state.transfer.dryRun ? ' [Dry Run]' : ''}`;
  startBtn.disabled = false;
}

async function startTransfer() {
  const src = state.transfer.src;
  const dst = state.transfer.dst;

  if (src.selected.size === 0) {
    toast('Please select at least one file or folder', 'bad');
    return;
  }

  const targetDstPath = dst.selectedFolder
    ? (dst.path ? `${dst.path}/${dst.selectedFolder}` : dst.selectedFolder)
    : dst.path;

  // Confirmation modal for Sync mode
  if (state.transfer.mode === 'sync' && !state.transfer.dryRun) {
    const confirmed = await new Promise(resolve => {
      openModal({
        title: 'Confirm Folder Sync',
        body: [
          el('p', {}, 'Sync mode makes the destination folder match the source exactly.'),
          el('p', { style: 'color: var(--bad); font-weight: 600; margin-top: 8px;' },
            '⚠️ Files in the destination that do not exist in the source may be permanently deleted.'
          ),
          el('p', { class: 'ink-2', style: 'font-size: 0.9rem; margin-top: 8px;' },
            `Source: ${src.fs}${src.path ? '/' + src.path : ''}\nDestination: ${dst.fs}${targetDstPath ? '/' + targetDstPath : ''}`
          )
        ],
        footer: [
          el('button', {
            class: 'btn btn-ghost',
            onclick: () => {
              closeModal();
              resolve(false);
            }
          }, 'Cancel'),
          el('button', {
            class: 'btn btn-danger',
            onclick: () => {
              closeModal();
              resolve(true);
            }
          }, 'Confirm Sync')
        ],
        onClose: () => resolve(false)
      });
    });

    if (!confirmed) return;
  }

  const items = Array.from(src.selected).map(name => {
    const it = src.items.find(i => i.name === name);
    return {
      name,
      is_dir: it ? it.is_dir : false
    };
  });

  const payload = {
    src_fs: src.fs,
    src_path: src.path,
    dst_fs: dst.fs,
    dst_path: targetDstPath,
    mode: state.transfer.mode,
    dry_run: state.transfer.dryRun,
    transfers: state.transfer.transfers,
    items
  };

  const res = await api('/api/transfer', payload);
  toast(`Transfer started (${(res.run_ids || res.started || []).length} job(s))`, 'ok');

  // Clear selections
  src.selected.clear();
  drawFileList('src', document.getElementById('src-list'));
  updateTransferSummary();

  // Switch to Monitor tab to watch progress
  showTab('monitor');
}

// ── Jobs Tab (Saved Jobs) ────────────────────────────────────────────────────

async function loadJobs() {
  const listEl = document.getElementById('jobs-list');
  if (!listEl) return;

  try {
    const res = await api('/api/jobs');
    state.savedJobs = res.jobs || [];
    drawJobs(state.savedJobs);
  } catch (err) {
    listEl.replaceChildren(
      el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '⚠️'),
        el('p', { style: 'color: var(--bad)' }, err.message)
      )
    );
  }
}

function drawJobs(jobs) {
  const listEl = document.getElementById('jobs-list');
  if (!listEl) return;

  if (!jobs || jobs.length === 0) {
    listEl.replaceChildren(
      el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '📋'),
        el('p', {}, 'No saved jobs configured yet'),
        el('button', {
          class: 'btn btn-primary',
          onclick: () => openJobModal()
        }, '+ Create Saved Job')
      )
    );
    return;
  }

  listEl.replaceChildren(
    ...jobs.map(job => {
      // Find matching recent runs for this job
      const matchingRuns = state.recentRuns.filter(r => r.saved_job_id === job.id).slice(0, 5);

      const card = el('div', { class: 'card job-card' },
        el('div', { class: 'job-header' },
          el('div', { class: 'job-title' },
            job.name,
            el('span', { class: `badge ${job.mode === 'sync' ? 'badge-dry' : 'badge-done'}` }, job.mode || 'copy')
          ),
          el('label', { class: 'checkbox-label' },
            el('input', {
              type: 'checkbox',
              checked: job.enabled !== false,
              onchange: guard(async (e) => {
                await api(`/api/jobs/${job.id}`, { ...job, enabled: e.target.checked }, 'PUT');
                toast(`Job "${job.name}" ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
              })
            }),
            'Enabled'
          )
        ),
        el('div', { class: 'job-path' },
          `${job.src_fs}${job.src_path ? '/' + job.src_path : ''} ➔ ${job.dst_fs}${job.dst_path ? '/' + job.dst_path : ''}`
        ),
        el('div', { class: 'job-badges' },
          el('span', { class: 'remote-pill' }, `${job.transfers || 2} parallel`),
          job.bandwidth ? el('span', { class: 'remote-pill' }, `Limit: ${job.bandwidth}`) : null
        ),
        // Recent runs section
        matchingRuns.length > 0 ? el('div', { class: 'job-recent-runs' },
          el('div', { class: 'job-recent-title' }, 'Recent Runs'),
          ...matchingRuns.map(r => el('div', { style: 'display: flex; justify-content: space-between; gap: 8px;' },
            el('span', {}, `${r.status} (${fmt(r.bytes_transferred)})`),
            el('span', { class: 'ink-2' }, fmtTime(r.started_at))
          ))
        ) : null,
        el('div', { class: 'job-footer' },
          el('div', { class: 'job-actions' },
            el('button', {
              class: 'btn btn-primary btn-sm',
              onclick: guard(async () => {
                const res = await api(`/api/jobs/${job.id}/run`, {});
                toast(`Job "${job.name}" started`, 'ok');
                showTab('monitor');
              })
            }, '▶ Run Now'),
            el('button', {
              class: 'btn btn-ghost btn-sm',
              onclick: () => openJobModal(job)
            }, 'Edit')
          ),
          el('button', {
            class: 'btn btn-danger btn-sm',
            onclick: guard(async () => {
              if (confirm(`Delete saved job "${job.name}"?`)) {
                await api(`/api/jobs/${job.id}`, undefined, 'DELETE');
                toast(`Job "${job.name}" deleted`, 'ok');
                await loadJobs();
              }
            })
          }, 'Delete')
        )
      );

      return card;
    })
  );
}

function initJobsControls() {
  const newJobBtn = document.getElementById('new-job-btn');
  if (newJobBtn) {
    newJobBtn.addEventListener('click', () => {
      openJobModal();
    });
  }
}

function openJobModal(existingJob = null) {
  const isEdit = Boolean(existingJob);

  const nameInput = el('input', {
    type: 'text',
    class: 'form-input',
    value: existingJob ? existingJob.name : '',
    placeholder: 'e.g. Daily Photo Backup'
  });

  const srcFsInput = el('input', {
    type: 'text',
    class: 'form-input mono',
    value: existingJob ? existingJob.src_fs : (state.transfer.src.fs || '/mnt'),
    placeholder: '/mnt/media or gdrive:'
  });

  const srcPathInput = el('input', {
    type: 'text',
    class: 'form-input mono',
    value: existingJob ? existingJob.src_path : '',
    placeholder: 'Photos/2024 (optional)'
  });

  const dstFsInput = el('input', {
    type: 'text',
    class: 'form-input mono',
    value: existingJob ? existingJob.dst_fs : (state.transfer.dst.fs || 'gdrive:'),
    placeholder: 'gdrive: or /mnt/backup'
  });

  const dstPathInput = el('input', {
    type: 'text',
    class: 'form-input mono',
    value: existingJob ? existingJob.dst_path : '',
    placeholder: 'Backup/Photos (optional)'
  });

  const modeSelect = el('select', { class: 'form-input' },
    el('option', { value: 'copy', selected: !existingJob || existingJob.mode === 'copy' }, 'Copy'),
    el('option', { value: 'sync', selected: existingJob && existingJob.mode === 'sync' }, 'Sync')
  );

  const parSelect = el('select', { class: 'form-input' },
    el('option', { value: '1', selected: existingJob && existingJob.transfers === 1 }, '1'),
    el('option', { value: '2', selected: !existingJob || existingJob.transfers === 2 }, '2'),
    el('option', { value: '4', selected: existingJob && existingJob.transfers === 4 }, '4')
  );

  const bwInput = el('input', {
    type: 'text',
    class: 'form-input',
    value: existingJob ? (existingJob.bandwidth || '') : '',
    placeholder: 'e.g. 2M or off (optional)'
  });

  const enabledCheck = el('input', {
    type: 'checkbox',
    checked: !existingJob || existingJob.enabled !== false
  });

  openModal({
    title: isEdit ? 'Edit Saved Job' : 'Create Saved Job',
    body: [
      el('div', { class: 'form-group' },
        el('label', { class: 'form-label' }, 'Job Name'),
        nameInput
      ),
      el('div', { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 10px;' },
        el('div', { class: 'form-group' },
          el('label', { class: 'form-label' }, 'Source FS'),
          srcFsInput
        ),
        el('div', { class: 'form-group' },
          el('label', { class: 'form-label' }, 'Source Subpath'),
          srcPathInput
        )
      ),
      el('div', { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 10px;' },
        el('div', { class: 'form-group' },
          el('label', { class: 'form-label' }, 'Destination FS'),
          dstFsInput
        ),
        el('div', { class: 'form-group' },
          el('label', { class: 'form-label' }, 'Destination Subpath'),
          dstPathInput
        )
      ),
      el('div', { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 10px;' },
        el('div', { class: 'form-group' },
          el('label', { class: 'form-label' }, 'Mode'),
          modeSelect
        ),
        el('div', { class: 'form-group' },
          el('label', { class: 'form-label' }, 'Parallel Transfers'),
          parSelect
        )
      ),
      el('div', { class: 'form-group' },
        el('label', { class: 'form-label' }, 'Bandwidth Limit (optional)'),
        bwInput
      ),
      el('label', { class: 'checkbox-label', style: 'margin-top: 6px;' },
        enabledCheck,
        'Job Enabled'
      )
    ],
    footer: [
      el('button', {
        class: 'btn btn-ghost',
        onclick: closeModal
      }, 'Cancel'),
      el('button', {
        class: 'btn btn-primary',
        onclick: guard(async () => {
          const name = nameInput.value.trim();
          if (!name) {
            toast('Job name is required', 'bad');
            return;
          }

          const jobPayload = {
            name,
            src_fs: srcFsInput.value.trim(),
            src_path: srcPathInput.value.trim(),
            dst_fs: dstFsInput.value.trim(),
            dst_path: dstPathInput.value.trim(),
            mode: modeSelect.value,
            transfers: parseInt(parSelect.value, 10),
            bandwidth: bwInput.value.trim() || undefined,
            enabled: enabledCheck.checked
          };

          if (isEdit) {
            await api(`/api/jobs/${existingJob.id}`, jobPayload, 'PUT');
            toast(`Job "${name}" updated`, 'ok');
          } else {
            await api('/api/jobs', jobPayload, 'POST');
            toast(`Job "${name}" created`, 'ok');
          }

          closeModal();
          await loadJobs();
        })
      }, isEdit ? 'Save Changes' : 'Create Job')
    ]
  });
}

// ── Remotes Tab ──────────────────────────────────────────────────────────────

async function loadRemotesTab() {
  const listEl = document.getElementById('remotes-list');
  if (!listEl) return;

  try {
    const res = await api('/api/remotes');
    state.remotes = res.remotes || [];
    drawRemotes(state.remotes);
  } catch (err) {
    listEl.replaceChildren(
      el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '⚠️'),
        el('p', { style: 'color: var(--bad)' }, err.message)
      )
    );
  }
}

function drawRemotes(remotes) {
  const listEl = document.getElementById('remotes-list');
  if (!listEl) return;

  if (!remotes || remotes.length === 0) {
    listEl.replaceChildren(
      el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '☁'),
        el('p', {}, 'No rclone remotes configured yet'),
        el('button', {
          class: 'btn btn-primary',
          onclick: () => openAddRemoteWizard()
        }, '+ Connect First Remote')
      )
    );
    return;
  }

  listEl.replaceChildren(
    ...remotes.map(rem => {
      const usageEl = el('span', { class: 'remote-usage' }, 'Checking storage...');
      const testResultEl = el('span', { class: 'mono', style: 'font-size: 0.85rem;' });

      // Fetch storage info asynchronously
      api(`/api/browse/about?fs=${encodeURIComponent(rem.name + ':')}`)
        .then(about => {
          if (about && about.total != null) {
            const usedStr = fmt(about.used);
            const totalStr = fmt(about.total);
            const freeStr = fmt(about.free);
            usageEl.textContent = `Used ${usedStr} of ${totalStr} (${freeStr} free)`;
          } else {
            usageEl.textContent = 'Storage info not reported';
          }
        })
        .catch(() => {
          usageEl.textContent = 'Storage info unavailable';
        });

      return el('div', { class: 'card remote-card' },
        el('div', { class: 'remote-header' },
          el('div', { class: 'remote-info' },
            el('span', { class: 'remote-name' }, rem.name),
            el('span', { class: 'remote-pill' }, rem.type)
          ),
          el('div', { class: 'remote-actions' },
            el('button', {
              class: 'btn btn-ghost btn-sm',
              onclick: guard(async () => {
                testResultEl.textContent = 'Testing...';
                testResultEl.style.color = 'var(--ink-2)';
                try {
                  const testRes = await api(`/api/remotes/${encodeURIComponent(rem.name)}/test`, {});
                  testResultEl.textContent = '✓ Connected';
                  testResultEl.style.color = 'var(--ok)';
                  if (testRes.about && testRes.about.total) {
                    usageEl.textContent = `Used ${fmt(testRes.about.used)} of ${fmt(testRes.about.total)} (${fmt(testRes.about.free)} free)`;
                  }
                } catch (err) {
                  testResultEl.textContent = `✗ ${err.message}`;
                  testResultEl.style.color = 'var(--bad)';
                }
              })
            }, 'Test'),
            el('button', {
              class: 'btn btn-ghost btn-sm',
              onclick: () => openEditRemoteModal(rem.name)
            }, 'Edit'),
            el('button', {
              class: 'btn btn-danger btn-sm',
              onclick: guard(async () => {
                if (confirm(`Delete remote "${rem.name}"?`)) {
                  await api(`/api/remotes/${encodeURIComponent(rem.name)}`, undefined, 'DELETE');
                  toast(`Remote "${rem.name}" deleted`, 'ok');
                  await loadRemotesTab();
                  await loadTransferRemotes();
                }
              })
            }, 'Delete')
          )
        ),
        usageEl,
        testResultEl
      );
    })
  );
}

function initRemotesControls() {
  const addRemoteBtn = document.getElementById('add-remote-btn');
  if (addRemoteBtn) {
    addRemoteBtn.addEventListener('click', () => {
      openAddRemoteWizard();
    });
  }
}

async function openAddRemoteWizard() {
  let providers = [];
  try {
    const res = await api('/api/remotes/providers');
    providers = res.providers || [];
  } catch (err) {
    toast(`Failed to load providers: ${err.message}`, 'bad');
    return;
  }

  // Step 1: Choose provider
  const searchInput = el('input', {
    type: 'text',
    class: 'form-input',
    placeholder: 'Search cloud providers (e.g. drive, s3, dropbox, webdav)...',
    autofocus: true
  });

  const providersContainer = el('div', {
    style: 'display: flex; flex-direction: column; gap: 8px; max-height: 420px; overflow-y: auto; margin-top: 10px;'
  });

  const renderProviders = (filterText = '') => {
    const q = filterText.toLowerCase();
    const filtered = providers.filter(p =>
      p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q))
    );

    if (filtered.length === 0) {
      providersContainer.replaceChildren(
        el('div', { class: 'empty-state' },
          el('p', {}, 'No matching providers found')
        )
      );
      return;
    }

    providersContainer.replaceChildren(
      ...filtered.map(p => el('div', {
        class: 'file-row',
        style: 'border-radius: var(--radius-sm); border: 1px solid var(--border);',
        onclick: () => openAddRemoteStep2(p)
      },
        el('div', { style: 'display: flex; flex-direction: column; gap: 2px; flex: 1;' },
          el('span', { style: 'font-weight: 700;' }, p.name),
          el('span', { class: 'ink-2', style: 'font-size: 0.8rem;' }, p.description || '')
        ),
        el('span', { class: 'ink-2' }, '➔')
      ))
    );
  };

  searchInput.oninput = () => renderProviders(searchInput.value);
  renderProviders();

  openModal({
    title: 'Add Remote — Step 1: Select Type',
    body: [
      searchInput,
      providersContainer
    ],
    footer: [
      el('button', {
        class: 'btn btn-ghost',
        onclick: closeModal
      }, 'Cancel')
    ]
  });
}

function openAddRemoteStep2(provider) {
  // Filter non-advanced options
  const options = (provider.options || []).filter(o => !o.advanced);

  const nameInput = el('input', {
    type: 'text',
    class: 'form-input',
    value: provider.name,
    placeholder: 'Remote name (e.g. mydrive)'
  });

  const optionInputs = {};

  const formFields = options.map(opt => {
    const input = el('input', {
      type: opt.is_password ? 'password' : 'text',
      class: 'form-input',
      placeholder: (opt.examples && opt.examples[0] && opt.examples[0].value) || opt.help || ''
    });
    optionInputs[opt.name] = input;

    return el('div', { class: 'form-group' },
      el('label', { class: 'form-label' },
        opt.name,
        opt.required ? el('span', { style: 'color: var(--bad);' }, ' *') : null
      ),
      opt.help ? el('span', { class: 'form-help' }, opt.help) : null,
      input
    );
  });

  openModal({
    title: `Add Remote — Step 2: Configure ${provider.name}`,
    body: [
      el('div', { class: 'form-group' },
        el('label', { class: 'form-label' }, 'Remote Name *'),
        nameInput
      ),
      ...formFields
    ],
    footer: [
      el('button', {
        class: 'btn btn-ghost',
        onclick: () => openAddRemoteWizard()
      }, '← Back'),
      el('button', {
        class: 'btn btn-primary',
        onclick: guard(async () => {
          const name = nameInput.value.trim();
          if (!name) {
            toast('Please enter a remote name', 'bad');
            return;
          }

          const params = {};
          for (const [k, input] of Object.entries(optionInputs)) {
            const val = input.value.trim();
            if (val !== '') {
              params[k] = val;
            }
          }

          // Step 3: Save & Test
          await openAddRemoteStep3(name, provider.name, params);
        })
      }, 'Continue to Test →')
    ]
  });
}

async function openAddRemoteStep3(name, type, params) {
  const statusEl = el('div', { class: 'empty-state' },
    el('div', { class: 'empty-icon' }, '⏳'),
    el('p', {}, 'Connecting and testing remote...')
  );

  openModal({
    title: `Add Remote — Step 3: Test "${name}"`,
    body: [statusEl],
    footer: []
  });

  try {
    // 1. Create remote
    await api('/api/remotes', {
      name,
      type,
      params
    });

    // 2. Test remote
    const testRes = await api(`/api/remotes/${encodeURIComponent(name)}/test`, {});

    let storageInfo = 'Connected successfully!';
    if (testRes.about && testRes.about.total) {
      storageInfo = `Connected! Used: ${fmt(testRes.about.used)} / Total: ${fmt(testRes.about.total)} (${fmt(testRes.about.free)} free)`;
    }

    statusEl.replaceChildren(
      el('div', { class: 'empty-icon', style: 'color: var(--ok);' }, '✓'),
      el('p', { style: 'font-weight: 700; font-size: 1.1rem;' }, 'Connection Successful'),
      el('p', { class: 'ink-2' }, storageInfo)
    );

    const footerEl = document.getElementById('modal-footer');
    if (footerEl) {
      footerEl.replaceChildren(
        el('button', {
          class: 'btn btn-primary',
          onclick: async () => {
            closeModal();
            toast(`Remote "${name}" added`, 'ok');
            await loadRemotesTab();
            await loadTransferRemotes();
          }
        }, 'Done')
      );
      footerEl.hidden = false;
    }
  } catch (err) {
    statusEl.replaceChildren(
      el('div', { class: 'empty-icon', style: 'color: var(--bad);' }, '✗'),
      el('p', { style: 'font-weight: 700; color: var(--bad);' }, 'Connection Failed'),
      el('p', { class: 'ink-2 mono', style: 'font-size: 0.85rem;' }, err.message)
    );

    const footerEl = document.getElementById('modal-footer');
    if (footerEl) {
      footerEl.replaceChildren(
        el('button', {
          class: 'btn btn-ghost',
          onclick: () => openAddRemoteStep2({ name: type, options: [] })
        }, '← Back to Edit'),
        el('button', {
          class: 'btn btn-danger',
          onclick: async () => {
            // Delete failed attempt if created
            await api(`/api/remotes/${encodeURIComponent(name)}`, undefined, 'DELETE').catch(() => {});
            closeModal();
          }
        }, 'Cancel')
      );
      footerEl.hidden = false;
    }
  }
}

async function openEditRemoteModal(name) {
  try {
    const data = await api(`/api/remotes/${encodeURIComponent(name)}`);
    const options = (data.options || []).filter(o => !o.advanced);

    const optionInputs = {};

    const formFields = options.map(opt => {
      const input = el('input', {
        type: opt.secret ? 'password' : 'text',
        class: 'form-input',
        value: opt.secret ? '' : (opt.value || ''),
        placeholder: opt.secret ? (opt.is_set ? '•••••••• (leave blank to keep current)' : 'Not set') : (opt.help || '')
      });
      optionInputs[opt.name] = input;

      return el('div', { class: 'form-group' },
        el('label', { class: 'form-label' }, opt.name),
        opt.help ? el('span', { class: 'form-help' }, opt.help) : null,
        input
      );
    });

    openModal({
      title: `Edit Remote: ${name} (${data.type})`,
      body: formFields.length > 0 ? formFields : [el('p', { class: 'ink-2' }, 'No configurable options for this remote.')],
      footer: [
        el('button', {
          class: 'btn btn-ghost',
          onclick: closeModal
        }, 'Cancel'),
        el('button', {
          class: 'btn btn-primary',
          onclick: guard(async () => {
            const params = {};
            for (const [k, input] of Object.entries(optionInputs)) {
              const val = input.value.trim();
              if (val !== '') {
                params[k] = val;
              }
            }
            await api(`/api/remotes/${encodeURIComponent(name)}`, { params }, 'PUT');
            closeModal();
            toast(`Remote "${name}" updated`, 'ok');
            await loadRemotesTab();
          })
        }, 'Save')
      ]
    });
  } catch (err) {
    toast(`Failed to load remote details: ${err.message}`, 'bad');
  }
}

// ── Settings Tab ─────────────────────────────────────────────────────────────

async function loadRoots() {
  const rootsList = document.getElementById('roots-list');
  if (!rootsList) return;

  try {
    const res = await api('/api/roots');
    state.roots = res.roots || [];

    if (state.roots.length === 0) {
      rootsList.replaceChildren(
        el('div', { class: 'empty-state' },
          el('p', {}, 'No local roots configured')
        )
      );
      return;
    }

    rootsList.replaceChildren(
      ...state.roots.map(root => {
        const canDelete = state.roots.length > 1;
        return el('div', { class: 'roots-item' },
          el('div', { class: 'roots-info' },
            el('span', { class: 'roots-path' }, root.path),
            root.label ? el('span', { class: 'roots-label' }, root.label) : null
          ),
          el('button', {
            class: 'btn btn-danger btn-sm',
            disabled: !canDelete,
            title: canDelete ? 'Delete this local root' : 'At least one root must remain',
            onclick: guard(async () => {
              if (confirm(`Remove allowed root "${root.path}"?`)) {
                await api(`/api/roots/${root.id}`, undefined, 'DELETE');
                toast(`Removed root "${root.path}"`, 'ok');
                await loadRoots();
                await loadTransferRemotes();
              }
            })
          }, 'Delete')
        );
      })
    );
  } catch (err) {
    rootsList.replaceChildren(
      el('div', { class: 'empty-state' },
        el('p', { style: 'color: var(--bad)' }, err.message)
      )
    );
  }
}

function initSettingsControls() {
  const addRootBtn = document.getElementById('add-root-btn');
  const pathInput = document.getElementById('new-root-path');
  const labelInput = document.getElementById('new-root-label');

  if (addRootBtn && pathInput) {
    addRootBtn.addEventListener('click', guard(async () => {
      const pathVal = pathInput.value.trim();
      const labelVal = labelInput ? labelInput.value.trim() : '';

      if (!pathVal) {
        toast('Path cannot be empty', 'bad');
        return;
      }

      await api('/api/roots', { path: pathVal, label: labelVal }, 'POST');
      toast(`Added root "${pathVal}"`, 'ok');
      pathInput.value = '';
      if (labelInput) labelInput.value = '';
      await loadRoots();
      await loadTransferRemotes();
    }));
  }
}

async function loadSettings() {
  const notifForm = document.getElementById('notifications-form');
  const appForm = document.getElementById('app-settings-form');

  try {
    const res = await api('/api/settings');
    state.settings = res.settings || {};
  } catch (_) {
    state.settings = {};
  }

  // Notifications Form
  if (notifForm) {
    const tgCheck = el('input', { type: 'checkbox', checked: Boolean(state.settings.notifications_telegram_enabled) });
    const tgToken = el('input', { type: 'password', class: 'form-input', value: state.settings.notifications_telegram_bot_token || '', placeholder: 'Telegram Bot Token' });
    const tgChat = el('input', { type: 'text', class: 'form-input', value: state.settings.notifications_telegram_chat_id || '', placeholder: 'Chat ID' });

    const ntfyCheck = el('input', { type: 'checkbox', checked: Boolean(state.settings.notifications_ntfy_enabled) });
    const ntfyUrl = el('input', { type: 'text', class: 'form-input', value: state.settings.notifications_ntfy_url || 'https://ntfy.sh', placeholder: 'https://ntfy.sh' });
    const ntfyTopic = el('input', { type: 'text', class: 'form-input', value: state.settings.notifications_ntfy_topic || '', placeholder: 'Topic' });

    notifForm.replaceChildren(
      el('div', { class: 'form-group' },
        el('label', { class: 'checkbox-label' }, tgCheck, 'Enable Telegram Notifications'),
        el('div', { style: 'display: flex; flex-direction: column; gap: 8px; margin-top: 8px;' },
          tgToken,
          tgChat
        )
      ),
      el('hr', { style: 'border: none; border-top: 1px solid var(--border); margin: 4px 0;' }),
      el('div', { class: 'form-group' },
        el('label', { class: 'checkbox-label' }, ntfyCheck, 'Enable ntfy Notifications'),
        el('div', { style: 'display: flex; flex-direction: column; gap: 8px; margin-top: 8px;' },
          ntfyUrl,
          ntfyTopic
        )
      ),
      el('button', {
        class: 'btn btn-primary',
        style: 'align-self: flex-start; margin-top: 8px;',
        onclick: guard(async () => {
          await api('/api/settings', {
            settings: {
              notifications_telegram_enabled: tgCheck.checked,
              notifications_telegram_bot_token: tgToken.value.trim(),
              notifications_telegram_chat_id: tgChat.value.trim(),
              notifications_ntfy_enabled: ntfyCheck.checked,
              notifications_ntfy_url: ntfyUrl.value.trim(),
              notifications_ntfy_topic: ntfyTopic.value.trim()
            }
          }, 'PUT');
          toast('Notification settings saved', 'ok');
        })
      }, 'Save Notifications')
    );
  }

  // App Settings Form
  if (appForm) {
    const readOnlyCheck = el('input', {
      type: 'checkbox',
      checked: Boolean(state.settings.read_only),
      onchange: guard(async (e) => {
        await api('/api/settings', { settings: { read_only: e.target.checked } }, 'PUT');
        toast(`Read-only mode ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
      })
    });

    const themeSelect = el('select', {
      class: 'form-input',
      onchange: () => {
        setTheme(themeSelect.value);
        toast(`Theme set to ${themeSelect.value}`, 'info');
      }
    },
      el('option', { value: 'auto', selected: state.theme === 'auto' }, 'Auto (Follow system)'),
      el('option', { value: 'light', selected: state.theme === 'light' }, 'Light'),
      el('option', { value: 'dark', selected: state.theme === 'dark' }, 'Dark')
    );

    appForm.replaceChildren(
      el('div', { class: 'form-group' },
        el('label', { class: 'checkbox-label' }, readOnlyCheck, 'Read-only mode (prevent file deletion and overwrite)')
      ),
      el('div', { class: 'form-group' },
        el('label', { class: 'form-label' }, 'Theme Preference'),
        themeSelect
      )
    );
  }
}

async function loadVersion() {
  const verEl = document.getElementById('rclone-version');
  if (!verEl) return;
  try {
    const res = await api('/api/version');
    verEl.textContent = `rclone version: ${res.version || 'unknown'}`;
  } catch (_) {
    verEl.textContent = 'rclone version: (unable to query daemon)';
  }
}

// ── PWA & Service Worker ─────────────────────────────────────────────────────

function initPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(() => console.log('Service Worker registered'))
        .catch(err => console.warn('SW registration failed:', err));
    });
  }

  // Capture install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.deferredPrompt = e;
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initTabs();
  initBwControls();
  initTransferControls();
  initJobsControls();
  initRemotesControls();
  initSettingsControls();
  initPWA();

  // Initial tab and real-time connections
  showTab('transfer');
  connectSSE();
});
