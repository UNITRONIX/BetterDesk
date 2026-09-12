/**
 * BetterDesk Console — Server Management page (BETA)
 * Tabs: overview, terminal, files, services
 */

(function () {
    'use strict';

    // ── i18n helpers ─────────────────────────────────────────────────────

    function t(key, fallback) {
        if (window.i18n && typeof window.i18n.t === 'function') return window.i18n.t(key, fallback);
        return fallback || key;
    }

    function getCsrfToken() {
        return (window.BetterDesk && window.BetterDesk.csrfToken) || '';
    }

    async function api(path, options = {}) {
        const opts = Object.assign({ method: 'GET', headers: {} }, options);
        opts.headers = Object.assign({}, opts.headers || {});
        if (opts.body && typeof opts.body !== 'string') {
            opts.body = JSON.stringify(opts.body);
            opts.headers['Content-Type'] = 'application/json';
        }
        if (opts.method && opts.method !== 'GET') {
            opts.headers['x-csrf-token'] = getCsrfToken();
        }
        opts.credentials = 'same-origin';
        const res = await fetch(path, opts);
        const text = await res.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
        if (!res.ok || data.success === false) {
            const err = new Error(data.error || `HTTP ${res.status}`);
            err.data = data;
            err.status = res.status;
            throw err;
        }
        return data;
    }

    function formatBytes(n) {
        if (!Number.isFinite(n) || n < 0) return '–';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
    }

    function formatUptime(s) {
        if (!Number.isFinite(s) || s < 0) return '–';
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (d) return `${d}d ${h}h ${m}m`;
        if (h) return `${h}h ${m}m`;
        return `${m}m`;
    }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function showToast(msg, type) {
        if (window.Toast && typeof window.Toast[type || 'info'] === 'function') {
            window.Toast[type || 'info']('', msg);
        } else {
            console.log('[server-mgmt]', type || 'info', msg);
        }
    }

    // ── Tab switching ────────────────────────────────────────────────────

    function activateTab(target) {
        const buttons = document.querySelectorAll('.sm-tab-btn');
        const panels = document.querySelectorAll('.sm-tab-panel');
        let resolved = target;
        if (!document.getElementById(`sm-panel-${resolved}`)) resolved = 'overview';
        buttons.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === resolved));
        panels.forEach((p) => {
            const match = p.id === `sm-panel-${resolved}`;
            p.classList.toggle('active', match);
            p.hidden = !match;
        });
        if (resolved === 'overview') overview.start();
        else overview.stop();
        if (resolved === 'files' && !filesView.loaded) filesView.refresh();
        if (resolved === 'services' && !servicesView.loaded) servicesView.refresh();
        if (resolved === 'terminal') {
            terminalView.fit();
            // Auto-connect on first visit (BETA convenience)
            if (!terminalView.hasConnected()) terminalView.connect();
        }
        // Reflect in URL without reload
        try {
            const url = new URL(window.location.href);
            url.searchParams.set('tab', resolved);
            window.history.replaceState({}, '', url.toString());
        } catch (_) { /* ignore */ }
    }

    function initTabs() {
        const buttons = document.querySelectorAll('.sm-tab-btn');
        buttons.forEach((btn) => {
            btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
        });
    }

    // ── Overview tab ─────────────────────────────────────────────────────

    const overview = (() => {
        let timer = null;
        let lastInfo = null;
        const history = []; // { cpu, mem }

        async function tick() {
            try {
                const [info, snap] = await Promise.all([
                    lastInfo ? Promise.resolve(lastInfo) : api('/api/server-management/info'),
                    api('/api/server-management/resources')
                ]);
                if (!lastInfo) lastInfo = info;
                render(info, snap.snapshot);
            } catch (err) {
                console.warn('[server-mgmt] overview tick failed:', err.message);
            }
        }

        function start() {
            stop();
            tick();
            timer = setInterval(tick, 2000);
        }

        function stop() {
            if (timer) { clearInterval(timer); timer = null; }
        }

        function render(info, snap) {
            if (!snap || typeof snap !== 'object') return;
            // CPU — backend returns sample.cpu as number (percent)
            const cpuPct = Math.max(0, Math.min(100, Math.round(Number(snap.cpu) || 0)));
            document.getElementById('sm-cpu-fill').style.width = `${cpuPct}%`;
            document.getElementById('sm-cpu-value').textContent = `${cpuPct}%`;
            document.getElementById('sm-cpu-meta').textContent =
                `${snap.cpuModel || '–'} · ${snap.cpuCount || 0} ${t('server_mgmt.cores', 'cores')}`;

            // Memory — backend returns sample.mem.{total,free,used,percent}
            const mem = snap.mem || {};
            const memPct = Math.max(0, Math.min(100, Math.round(Number(mem.percent) || 0)));
            document.getElementById('sm-mem-fill').style.width = `${memPct}%`;
            document.getElementById('sm-mem-value').textContent = `${memPct}%`;
            document.getElementById('sm-mem-meta').textContent =
                `${formatBytes(mem.used)} / ${formatBytes(mem.total)}`;

            // Load avg / uptime — backend returns sample.load array
            const load = Array.isArray(snap.load) ? snap.load : [0, 0, 0];
            document.getElementById('sm-load-1').textContent = (Number(load[0]) || 0).toFixed(2);
            document.getElementById('sm-load-5').textContent = (Number(load[1]) || 0).toFixed(2);
            document.getElementById('sm-load-15').textContent = (Number(load[2]) || 0).toFixed(2);
            document.getElementById('sm-uptime-meta').textContent =
                `${t('server_mgmt.uptime', 'Uptime')}: ${formatUptime(snap.uptime)}`;

            // Disks — backend returns sample.disks[] with {mount, fstype, size, used, avail}
            const disksHost = document.getElementById('sm-disks');
            disksHost.innerHTML = (snap.disks || []).map((d) => {
                const total = Number(d.size || d.total) || 0;
                const used = Number(d.used) || 0;
                const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((used / total) * 100))) : 0;
                return `
                    <div class="sm-disk-row">
                        <div class="sm-disk-mount">${escapeHtml(d.mount || d.fs || '?')}</div>
                        <div class="sm-disk-bar"><div class="sm-disk-bar-fill" style="width:${pct}%"></div></div>
                        <div class="sm-disk-stat">${formatBytes(used)} / ${formatBytes(total)} (${pct}%)</div>
                    </div>
                `;
            }).join('') || `<div class="sm-meta">${t('server_mgmt.no_disks', 'No disk data available')}</div>`;

            // Host info
            const hi = document.getElementById('sm-host-info');
            const rows = [
                ['hostname', snap.hostname],
                ['platform', `${snap.platform} (${snap.arch})`],
                ['kernel', snap.release || snap.osVersion],
                ['node', info.nodeVersion || snap.nodeVersion],
                ['process_id', info.pid],
                ['pty_available', info.ptyAvailable ? '✓' : '✗']
            ];
            hi.innerHTML = rows.map(([k, v]) =>
                `<div><span class="sm-info-key">${escapeHtml(t('server_mgmt.info_' + k, k))}:</span><span class="sm-info-val">${escapeHtml(v != null ? String(v) : '–')}</span></div>`
            ).join('');

            // History
            history.push({ cpu: cpuPct, mem: memPct });
            if (history.length > 60) history.shift();
            drawHistory();
        }

        function drawHistory() {
            const canvas = document.getElementById('sm-history-chart');
            if (!canvas) return;
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.clientWidth || 600;
            const h = canvas.clientHeight || 120;
            if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
                canvas.width = w * dpr;
                canvas.height = h * dpr;
            }
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);
            // Grid
            ctx.strokeStyle = 'rgba(139, 148, 158, 0.2)';
            ctx.lineWidth = 1;
            for (let p = 0; p <= 100; p += 25) {
                const y = h - (p / 100) * h;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
                ctx.stroke();
            }
            if (history.length < 2) return;
            const step = w / Math.max(1, history.length - 1);
            const drawSeries = (key, color) => {
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                history.forEach((pt, i) => {
                    const x = i * step;
                    const y = h - (pt[key] / 100) * h;
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.stroke();
            };
            drawSeries('cpu', '#58a6ff');
            drawSeries('mem', '#d29922');
        }

        return { start, stop };
    })();

    // ── Files tab ────────────────────────────────────────────────────────

    const filesView = (() => {
        let cwd = '/';
        let editing = null; // { path, size, mtime, etag }
        let loaded = false;

        async function refresh(path) {
            const target = path || document.getElementById('sm-files-path').value || cwd;
            try {
                const data = await api(`/api/server-management/files?path=${encodeURIComponent(target)}`);
                cwd = data.cwd || target;
                loaded = true;
                document.getElementById('sm-files-path').value = cwd;
                renderEntries(data.entries || [], data.parent);
            } catch (err) {
                showToast(err.message || t('server_mgmt.files_error', 'Failed to list directory'), 'error');
                renderEntries([], null);
            }
        }

        function renderEntries(entries, parent) {
            const body = document.getElementById('sm-files-body');
            const rows = entries.map((e) => {
                const icon = e.type === 'dir'
                    ? '<span class="material-icons sm-file-icon-dir">folder</span>'
                    : (e.type === 'symlink'
                        ? '<span class="material-icons sm-file-icon-link">link</span>'
                        : '<span class="material-icons">description</span>');
                const sizeText = e.type === 'dir' ? '–' : formatBytes(e.size || 0);
                const perms = e.mode != null ? (e.mode & 0o7777).toString(8).padStart(4, '0') : '–';
                const mtime = e.mtime ? new Date(e.mtime).toLocaleString() : '';
                const acts = [];
                if (e.type === 'file') {
                    acts.push(`<button class="btn btn-tertiary" data-act="open" data-path="${escapeHtml(e.path)}" title="${t('common.edit', 'Edit')}"><span class="material-icons">edit</span></button>`);
                }
                acts.push(`<button class="btn btn-tertiary" data-act="rename" data-path="${escapeHtml(e.path)}" data-name="${escapeHtml(e.name)}" title="${t('server_mgmt.files_rename', 'Rename')}"><span class="material-icons">drive_file_rename_outline</span></button>`);
                acts.push(`<button class="btn btn-tertiary" data-act="delete" data-path="${escapeHtml(e.path)}" title="${t('common.delete', 'Delete')}"><span class="material-icons">delete</span></button>`);

                return `
                    <tr data-type="${e.type}" data-path="${escapeHtml(e.path)}" data-name="${escapeHtml(e.name)}">
                        <td>${icon}</td>
                        <td>${escapeHtml(e.name)}</td>
                        <td>${sizeText}</td>
                        <td><code>${perms}</code></td>
                        <td>${escapeHtml(mtime)}</td>
                        <td><div class="sm-file-actions">${acts.join('')}</div></td>
                    </tr>
                `;
            });
            body.innerHTML = rows.join('') ||
                `<tr><td colspan="6"><div class="empty-state"><span class="material-icons">folder_off</span><p>${t('server_mgmt.files_empty', 'Empty directory')}</p></div></td></tr>`;

            body.querySelectorAll('tr[data-type]').forEach((tr) => {
                tr.addEventListener('click', (ev) => {
                    if (ev.target.closest('button')) return;
                    if (tr.getAttribute('data-type') === 'dir') refresh(tr.getAttribute('data-path'));
                });
            });
            body.querySelectorAll('button[data-act]').forEach((btn) => {
                btn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const act = btn.getAttribute('data-act');
                    const p = btn.getAttribute('data-path');
                    if (act === 'open') openFile(p);
                    else if (act === 'rename') renameFile(p, btn.getAttribute('data-name'));
                    else if (act === 'delete') deleteFile(p);
                });
            });
        }

        async function openFile(path) {
            try {
                const data = await api(`/api/server-management/files/read?path=${encodeURIComponent(path)}`);
                editing = { path, size: data.size, mtime: data.mtime };
                const ed = document.getElementById('sm-file-editor');
                document.getElementById('sm-file-editor-path').textContent = path;
                document.getElementById('sm-file-textarea').value = data.content || '';
                document.getElementById('sm-file-meta').textContent =
                    `${formatBytes(data.size || 0)} · ${data.binary ? t('server_mgmt.binary_warn', 'Binary file — preview only') : t('server_mgmt.encoding_utf8', 'UTF-8 text')} · ${data.truncated ? t('server_mgmt.truncated', 'truncated') : t('server_mgmt.full', 'full')}`;
                ed.hidden = false;
                document.getElementById('sm-file-textarea').focus();
            } catch (err) {
                showToast(err.message || t('server_mgmt.read_failed', 'Failed to read file'), 'error');
            }
        }

        async function saveFile() {
            if (!editing) return;
            const content = document.getElementById('sm-file-textarea').value;
            try {
                await api('/api/server-management/files/write', {
                    method: 'POST',
                    body: { path: editing.path, content }
                });
                showToast(t('server_mgmt.file_saved', 'File saved'), 'success');
                refresh();
            } catch (err) {
                showToast(err.message || t('server_mgmt.save_failed', 'Failed to save file'), 'error');
            }
        }

        async function renameFile(path, name) {
            const next = window.prompt(t('server_mgmt.files_rename_prompt', 'New name:'), name || '');
            if (!next || next === name) return;
            const parent = path.replace(/[/\\][^/\\]*$/, '') || '/';
            const sep = path.includes('\\') ? '\\' : '/';
            const target = parent.endsWith(sep) ? parent + next : parent + sep + next;
            try {
                await api('/api/server-management/files/rename', { method: 'POST', body: { from: path, to: target } });
                refresh();
            } catch (err) {
                showToast(err.message || t('server_mgmt.rename_failed', 'Rename failed'), 'error');
            }
        }

        async function deleteFile(path) {
            if (!window.confirm(t('server_mgmt.delete_confirm', 'Delete this entry?') + '\n' + path)) return;
            try {
                await api('/api/server-management/files/delete', { method: 'POST', body: { path } });
                refresh();
            } catch (err) {
                showToast(err.message || t('server_mgmt.delete_failed', 'Delete failed'), 'error');
            }
        }

        async function mkdir() {
            const name = window.prompt(t('server_mgmt.mkdir_prompt', 'New folder name:'), 'new-folder');
            if (!name) return;
            const sep = cwd.includes('\\') ? '\\' : '/';
            const target = cwd.endsWith(sep) ? cwd + name : cwd + sep + name;
            try {
                await api('/api/server-management/files/mkdir', { method: 'POST', body: { path: target } });
                refresh();
            } catch (err) {
                showToast(err.message || t('server_mgmt.mkdir_failed', 'mkdir failed'), 'error');
            }
        }

        function up() {
            const sep = cwd.includes('\\') ? '\\' : '/';
            const trimmed = cwd.replace(/[\\/]+$/, '');
            const parent = trimmed.replace(/[/\\][^/\\]*$/, '') || sep;
            refresh(parent);
        }

        function init() {
            document.getElementById('sm-files-up').addEventListener('click', up);
            document.getElementById('sm-files-refresh').addEventListener('click', () => refresh());
            document.getElementById('sm-files-go').addEventListener('click', () => refresh());
            document.getElementById('sm-files-mkdir').addEventListener('click', mkdir);
            document.getElementById('sm-files-path').addEventListener('keydown', (e) => {
                if (e.key === 'Enter') refresh();
            });
            document.getElementById('sm-file-save').addEventListener('click', saveFile);
            document.getElementById('sm-file-close').addEventListener('click', () => {
                document.getElementById('sm-file-editor').hidden = true;
                editing = null;
            });
        }

        return { init, refresh, get loaded() { return loaded; } };
    })();

    // ── Services tab ─────────────────────────────────────────────────────

    const servicesView = (() => {
        let services = [];
        let loaded = false;

        async function refresh() {
            try {
                const data = await api('/api/server-management/services');
                services = data.services || [];
                loaded = true;
                render();
            } catch (err) {
                showToast(err.message || t('server_mgmt.svc_load_failed', 'Failed to load services'), 'error');
            }
        }

        function render() {
            const filter = (document.getElementById('sm-services-search').value || '').toLowerCase();
            const filtered = filter
                ? services.filter((s) =>
                    (s.name || '').toLowerCase().includes(filter) ||
                    (s.description || '').toLowerCase().includes(filter))
                : services;
            const body = document.getElementById('sm-services-body');
            const isWin = /^win/i.test(navigator.platform);
            const rows = filtered.map((s) => {
                const stateClass = s.state === 'active' || s.state === 'running' ? 'active'
                    : (s.state === 'failed' ? 'failed' : '');
                const actions = (isWin
                    ? ['start', 'stop', 'restart']
                    : ['start', 'stop', 'restart', 'reload', 'enable', 'disable']
                ).map((act) => `<button class="btn btn-tertiary" data-svc="${escapeHtml(s.name)}" data-act="${act}">
                    <span class="material-icons">${actionIcon(act)}</span>${t('server_mgmt.svc_' + act, act)}
                </button>`).join('');
                return `
                    <tr>
                        <td><span class="sm-svc-name">${escapeHtml(s.name)}</span></td>
                        <td><span class="sm-svc-state ${stateClass}">${escapeHtml(s.state || s.status || '–')}</span></td>
                        <td>${escapeHtml(s.description || '')}</td>
                        <td><div class="sm-svc-actions">${actions}</div></td>
                    </tr>
                `;
            });
            body.innerHTML = rows.join('') ||
                `<tr><td colspan="4"><div class="empty-state"><span class="material-icons">home_repair_service</span><p>${t('server_mgmt.svc_empty', 'No services found')}</p></div></td></tr>`;
            document.getElementById('sm-services-count').textContent =
                `${filtered.length} / ${services.length}`;

            body.querySelectorAll('button[data-svc]').forEach((btn) => {
                btn.addEventListener('click', () => act(btn.getAttribute('data-svc'), btn.getAttribute('data-act')));
            });
        }

        function actionIcon(a) {
            return ({
                start: 'play_arrow', stop: 'stop', restart: 'restart_alt',
                reload: 'cached', enable: 'check_circle', disable: 'block', status: 'info'
            }[a]) || 'play_arrow';
        }

        async function act(name, action) {
            const dangerous = ['stop', 'disable'];
            if (dangerous.includes(action)) {
                if (!window.confirm(`${t('server_mgmt.svc_confirm', 'Run')} ${action} on ${name}?`)) return;
            }
            try {
                const r = await api(`/api/server-management/services/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
                showToast(`${name} → ${action} (exit ${r.exitCode})`, r.exitCode === 0 ? 'success' : 'warning');
                refresh();
            } catch (err) {
                showToast(err.message || t('server_mgmt.svc_action_failed', 'Action failed'), 'error');
            }
        }

        function init() {
            document.getElementById('sm-services-refresh').addEventListener('click', refresh);
            document.getElementById('sm-services-search').addEventListener('input', () => render());
        }

        return { init, refresh, get loaded() { return loaded; } };
    })();

    // ── Terminal tab ─────────────────────────────────────────────────────

    const terminalView = (() => {
        // xterm core: 5.5.0; addon-fit has its own version (0.10.0)
        const XTERM_VERSION = '5.5.0';
        const XTERM_FIT_VERSION = '0.10.0';
        const XTERM_CSS_URL = `https://cdn.jsdelivr.net/npm/@xterm/xterm@${XTERM_VERSION}/css/xterm.min.css`;
        const XTERM_JS_URL = `https://cdn.jsdelivr.net/npm/@xterm/xterm@${XTERM_VERSION}/lib/xterm.min.js`;
        const XTERM_FIT_URL = `https://cdn.jsdelivr.net/npm/@xterm/addon-fit@${XTERM_FIT_VERSION}/lib/addon-fit.min.js`;

        let xtermLoaded = false;
        let xtermLoading = null;
        let term = null;
        let fitAddon = null;
        let ws = null;
        let connected = false;
        let everConnected = false;

        function loadXterm() {
            if (xtermLoaded) return Promise.resolve();
            if (xtermLoading) return xtermLoading;
            xtermLoading = new Promise((resolve, reject) => {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = XTERM_CSS_URL;
                document.head.appendChild(link);
                const s1 = document.createElement('script');
                s1.src = XTERM_JS_URL;
                s1.onload = () => {
                    const s2 = document.createElement('script');
                    s2.src = XTERM_FIT_URL;
                    s2.onload = () => { xtermLoaded = true; resolve(); };
                    s2.onerror = () => reject(new Error('Failed to load xterm-addon-fit'));
                    document.head.appendChild(s2);
                };
                s1.onerror = () => reject(new Error('Failed to load xterm.js'));
                document.head.appendChild(s1);
            });
            return xtermLoading;
        }

        function setStatus(text, cls) {
            const el = document.getElementById('sm-term-status');
            el.textContent = text;
            el.className = 'sm-term-status' + (cls ? ' ' + cls : '');
        }

        async function connect() {
            try { await loadXterm(); }
            catch (err) {
                showToast(err.message, 'error');
                return;
            }
            const Terminal = window.Terminal;
            const FitAddon = window.FitAddon && window.FitAddon.FitAddon;
            if (!Terminal || !FitAddon) {
                showToast(t('server_mgmt.term_lib_failed', 'Terminal library failed to load'), 'error');
                return;
            }
            const host = document.getElementById('sm-terminal-host');
            host.innerHTML = '';
            term = new Terminal({
                cursorBlink: true,
                fontFamily: 'Cascadia Code, Fira Code, Menlo, monospace',
                fontSize: 13,
                theme: {
                    background: '#0d1117',
                    foreground: '#e6edf3',
                    cursor: '#58a6ff'
                }
            });
            fitAddon = new FitAddon();
            term.loadAddon(fitAddon);
            term.open(host);
            try { fitAddon.fit(); } catch (_) { /* ignore */ }

            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${proto}//${window.location.host}/ws/server-management/terminal`;
            ws = new WebSocket(wsUrl);
            setStatus(t('server_mgmt.term_connecting', 'Connecting…'));

            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'init', cols: term.cols, rows: term.rows }));
            };
            ws.onmessage = (ev) => {
                let msg;
                try { msg = JSON.parse(ev.data); } catch (_) { return; }
                if (msg.type === 'ready') {
                    connected = true;
                    everConnected = true;
                    setStatus(`${t('server_mgmt.term_connected', 'Connected')} · ${msg.user || ''}@${msg.platform || ''} (${msg.kind})`, 'connected');
                    document.getElementById('sm-term-connect').disabled = true;
                    document.getElementById('sm-term-disconnect').disabled = false;
                    document.getElementById('sm-term-clear').disabled = false;
                    if (!msg.pty_available) {
                        term.writeln('\x1b[33m[!] node-pty not available — running in pipe-fallback mode (limited interactivity)\x1b[0m');
                    }
                } else if (msg.type === 'output') {
                    term.write(msg.data);
                } else if (msg.type === 'end') {
                    term.writeln(`\r\n\x1b[90m[shell exited code=${msg.code} signal=${msg.signal || ''}]\x1b[0m`);
                } else if (msg.type === 'error') {
                    term.writeln(`\r\n\x1b[31m[error] ${msg.error}\x1b[0m`);
                    setStatus(msg.error, 'error');
                }
            };
            ws.onclose = () => {
                connected = false;
                setStatus(t('server_mgmt.term_disconnected', 'Disconnected'));
                document.getElementById('sm-term-connect').disabled = false;
                document.getElementById('sm-term-disconnect').disabled = true;
            };
            ws.onerror = () => setStatus(t('server_mgmt.term_error', 'Connection error'), 'error');

            term.onData((d) => {
                if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d }));
            });

            // Resize handler
            const handleResize = () => {
                if (!fitAddon || !term) return;
                try { fitAddon.fit(); } catch (_) { return; }
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
                }
            };
            window.addEventListener('resize', handleResize);
            term._cleanupResize = () => window.removeEventListener('resize', handleResize);
        }

        function disconnect() {
            if (ws) {
                try { ws.send(JSON.stringify({ type: 'close' })); } catch (_) { /* ignore */ }
                try { ws.close(); } catch (_) { /* ignore */ }
                ws = null;
            }
            if (term) {
                try { term._cleanupResize && term._cleanupResize(); } catch (_) { /* ignore */ }
                try { term.dispose(); } catch (_) { /* ignore */ }
                term = null;
                fitAddon = null;
            }
            document.getElementById('sm-terminal-host').innerHTML = '';
            document.getElementById('sm-term-connect').disabled = false;
            document.getElementById('sm-term-disconnect').disabled = true;
            document.getElementById('sm-term-clear').disabled = true;
            setStatus(t('server_mgmt.term_disconnected', 'Disconnected'));
        }

        function clear() {
            if (term) term.clear();
        }

        function fit() {
            if (term && fitAddon) {
                try { fitAddon.fit(); } catch (_) { /* ignore */ }
            }
        }

        function init() {
            document.getElementById('sm-term-connect').addEventListener('click', connect);
            document.getElementById('sm-term-disconnect').addEventListener('click', disconnect);
            document.getElementById('sm-term-clear').addEventListener('click', clear);
        }

        return { init, fit, connect, hasConnected: () => everConnected };
    })();

    // ── Bootstrap ────────────────────────────────────────────────────────

    function bootstrap() {
        const page = document.getElementById('server-mgmt-page');
        if (!page) return;
        initTabs();
        filesView.init();
        servicesView.init();
        terminalView.init();

        // Determine initial tab: ?tab= query param > data-initial-tab > 'overview'
        let initialTab = 'overview';
        try {
            const params = new URLSearchParams(window.location.search);
            const queryTab = params.get('tab');
            if (queryTab) initialTab = queryTab;
            else if (page.dataset.initialTab) initialTab = page.dataset.initialTab;
        } catch (_) { /* ignore */ }
        activateTab(initialTab);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }
})();
