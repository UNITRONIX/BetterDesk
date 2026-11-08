/**
 * BetterDesk Console: Server status, Terminal, Files and Services.
 * One view per page load; the route renders only the panel for ?tab=.
 */

(function () {
    'use strict';

    // ── Helpers ──────────────────────────────────────────────────────────

    function t(key, vars) {
        if (typeof window._ === 'function') return window._(key, vars || {});
        return key;
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

    // Sizes, lengths and shares come from the shared helpers (utils.js, "Data display")
    const U = () => window.Utils || {};
    function formatBytes(n) {
        return (U().formatBytes && U().formatBytes(n)) || '–';
    }

    function formatUptime(s) {
        return (U().formatDuration && U().formatDuration(s)) || '–';
    }

    function pct(v) {
        return (U().formatPercent && U().formatPercent(Math.round(v))) || `${Math.round(v)} %`;
    }

    function emptyHtml(word) {
        return U().emptyHtml ? U().emptyHtml(word) : escapeHtml(word || '–');
    }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function notify(type, msg) {
        if (window.Notifications && typeof window.Notifications[type] === 'function') {
            window.Notifications[type](msg);
        }
    }

    // Icon for a meaning from Utils.ICONS (decorative; the label carries the meaning)
    function icon(meaning) {
        return (window.Utils && typeof window.Utils.icon === 'function') ? window.Utils.icon(meaning) : '';
    }

    // Service menu items; "reload" has no meaning in Utils.ICONS yet, so it stays without an icon
    const SVC_ICONS = { enable: 'enable', disable: 'disable' };

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function setMeter(prefix, value) {
        const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
        const fill = document.getElementById(`sm-${prefix}-fill`);
        const gauge = document.getElementById(`sm-${prefix}-gauge`);
        if (fill) fill.style.width = `${v}%`;
        if (gauge) {
            gauge.classList.toggle('is-high', v >= 80 && v < 95);
            gauge.classList.toggle('is-full', v >= 95);
        }
        setText(`sm-${prefix}-value`, pct(v));
        return v;
    }

    function meterHtml(value) {
        const v = Math.max(0, Math.min(100, Math.round(value)));
        const cls = v >= 95 ? ' is-full' : (v >= 80 ? ' is-high' : '');
        return `<div class="meter sm-meter${cls}"><span class="meter-bar"><span class="meter-fill" style="width:${v}%"></span></span><span class="meter-value">${pct(v)}</span></div>`;
    }

    // ── Server status ────────────────────────────────────────────────────

    const overview = (() => {
        const TICK_MS = 2000;
        const STATUS_EVERY = 5; // ticks between server status checks (10 s)
        let timer = null;
        let ticks = 0;
        let info = null;
        let chartDrawn = false;
        let failures = 0;

        function setServer(id, state, meaningKey) {
            const el = document.getElementById(`sm-${id}-status`);
            if (!el) return;
            // good: running; danger: stopped (clients can't connect); warning: no answer
            el.classList.remove('ok', 'error', 'warning', 'is-good', 'is-danger', 'is-warning', 'is-waiting');
            if (state === 'running') {
                el.classList.add('is-good');
                el.textContent = t('status.running');
            } else if (state === 'stopped') {
                el.classList.add('is-danger');
                el.textContent = t('status.stopped');
            } else {
                el.classList.add('is-warning');
                el.textContent = t('status.unknown');
            }
            setText(`sm-${id}-meaning`, meaningKey ? t(meaningKey) : '');
        }

        function serverState(s) {
            if (s && (s.status === 'running' || s.online === true)) return 'running';
            if (s && (s.status === 'stopped' || s.online === false)) return 'stopped';
            return 'unknown';
        }

        async function checkServers() {
            try {
                const res = await api('/api/server/status');
                const status = res.data || res;
                const hbbs = serverState(status.hbbs);
                const hbbr = serverState(status.hbbr);
                setServer('hbbs', hbbs, hbbs === 'running' ? 'server_mgmt.id_running'
                    : (hbbs === 'stopped' ? 'dashboard.status_signal_down' : 'server_mgmt.status_unknown_meaning'));
                setServer('hbbr', hbbr, hbbr === 'running' ? 'server_mgmt.relay_running'
                    : (hbbr === 'stopped' ? 'dashboard.status_relay_down' : 'server_mgmt.status_unknown_meaning'));
            } catch (_) {
                setServer('hbbs', 'unknown', 'server_mgmt.status_unknown_meaning');
                setServer('hbbr', 'unknown', 'server_mgmt.status_unknown_meaning');
            }
            // The Go server's own uptime (needs the info endpoint from this release)
            try {
                const fresh = await api('/api/server-management/info');
                info = fresh;
                const secs = fresh.server && fresh.server.uptimeSeconds;
                const show = Number.isFinite(secs) && fresh.server.running;
                const label = document.getElementById('sm-server-uptime-label');
                const value = document.getElementById('sm-server-uptime');
                if (label) label.hidden = !show;
                if (value) {
                    value.hidden = !show;
                    if (show) value.textContent = formatUptime(secs);
                }
                const ver = fresh.server && fresh.server.version;
                const verLabel = document.getElementById('sm-server-version-label');
                const verValue = document.getElementById('sm-server-version');
                if (verLabel) verLabel.hidden = !ver;
                if (verValue) {
                    verValue.hidden = !ver;
                    if (ver) verValue.innerHTML = U().versionHtml ? U().versionHtml(ver) : escapeHtml(ver);
                }
            } catch (_) { /* keep last */ }
        }

        async function tick() {
            if (ticks % STATUS_EVERY === 0) checkServers();
            ticks++;
            try {
                const snap = (await api('/api/server-management/resources')).snapshot;
                failures = 0;
                render(snap);
            } catch (err) {
                failures++;
                if (failures >= 2) showMachineError(err);
            }
        }

        function showMachineError(err) {
            const state = document.getElementById('sm-machine-state');
            if (!state) return;
            state.hidden = false;
            state.classList.add('is-error');
            state.innerHTML = `${escapeHtml(t('server_mgmt.machine_error'))} <button type="button" class="btn btn-sm" id="sm-machine-retry">${escapeHtml(t('actions.retry'))}</button>`;
            document.getElementById('sm-machine-retry').addEventListener('click', () => {
                state.classList.remove('is-error');
                state.textContent = t('server_mgmt.machine_loading');
                start();
            });
            stop();
            if (err) console.warn('[server-mgmt]', err.message);
        }

        function start() {
            stop();
            tick();
            timer = setInterval(tick, TICK_MS);
        }

        function stop() {
            if (timer) { clearInterval(timer); timer = null; }
        }

        function render(snap) {
            if (!snap || typeof snap !== 'object') return;
            document.getElementById('sm-machine-state').hidden = true;
            document.getElementById('sm-machine').hidden = false;

            setMeter('cpu', snap.cpu);
            setText('sm-cpu-meta', t('server_mgmt.cpu_meta', { cores: snap.cpuCount || 0, model: snap.cpuModel || '–' }));

            const mem = snap.mem || {};
            setMeter('mem', mem.percent);
            setText('sm-mem-meta', t('server_mgmt.mem_meta', { used: formatBytes(mem.used), total: formatBytes(mem.total) }));

            const load = Array.isArray(snap.load) ? snap.load : [0, 0, 0];
            const n2 = (v) => (U().formatNumber ? U().formatNumber(Number(v) || 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (Number(v) || 0).toFixed(2));
            setText('sm-load', load.slice(0, 3).map(n2).join(', '));
            setText('sm-load-meta', t('server_mgmt.load_meta', { cores: snap.cpuCount || 0 }));

            setText('sm-uptime-meta', formatUptime(snap.uptime));
            setText('sm-console-uptime', formatUptime(snap.nodeUptime));

            // Disks
            const disks = document.getElementById('sm-disks');
            const list = snap.disks || [];
            disks.hidden = false;
            disks.innerHTML = list.map((d) => {
                const total = Number(d.size || d.total) || 0;
                const used = Number(d.used) || 0;
                const p = total > 0 ? (used / total) * 100 : 0;
                return `<dt>${escapeHtml(t('server_mgmt.disk_label', { mount: d.mount || d.fs || '?' }))}</dt>
                    <dd>${meterHtml(p)}<span class="sm-dd-sub">${escapeHtml(t('server_mgmt.disk_meta', { used: formatBytes(used), total: formatBytes(total) }))}</span></dd>`;
            }).join('') || `<dt>${escapeHtml(t('server_mgmt.disks'))}</dt><dd>${escapeHtml(t('server_mgmt.no_disks'))}</dd>`;

            // Technical details
            const hi = document.getElementById('sm-host-info');
            // Copyable values, the version, on/off and the empty dash as on every page
            const u = U();
            const value = (v, opts) => (u.valueHtml ? u.valueHtml(v, opts) : escapeHtml(v != null ? String(v) : '–'));
            const text = (v) => (v ? escapeHtml(v) : emptyHtml());
            const nodeVer = (info && info.nodeVersion) || snap.nodeVersion;
            const rows = [
                ['hostname', value(snap.hostname, { copy: true })],
                ['platform', text(snap.platform ? `${snap.platform} (${snap.arch})` : '')],
                ['kernel', text(snap.release || snap.osVersion)],
                ['node', u.versionHtml ? u.versionHtml(nodeVer) : text(nodeVer)],
                ['process_id', info ? value(info.pid) : emptyHtml()],
                ['pty_available', !info ? emptyHtml()
                    : (u.booleanHtml ? u.booleanHtml(info.ptyAvailable, { on: t('server_mgmt.pty_yes'), off: t('server_mgmt.pty_no') })
                        : escapeHtml(t(info.ptyAvailable ? 'server_mgmt.pty_yes' : 'server_mgmt.pty_no')))]
            ];
            hi.innerHTML = rows.map(([k, html]) =>
                `<dt>${escapeHtml(t('server_mgmt.info_' + k))}</dt><dd>${html}</dd>`
            ).join('');

            drawHistory(snap.history || []);
        }

        // Only the samples taken without a break up to now: older ones belong
        // to an earlier visit and would make the time axis lie.
        function recentRun(history) {
            const out = [];
            for (let i = history.length - 1; i >= 0; i--) {
                const s = history[i];
                if (out.length && out[0].ts - s.ts > 10000) break;
                out.unshift(s);
            }
            return out.slice(-60);
        }

        function drawHistory(history) {
            const host = document.getElementById('sm-history-chart');
            if (!host || !window.UiChart) return;
            // Don't rebuild while someone reads the chart or its table
            if (chartDrawn && (host.contains(document.activeElement) || host.querySelector('details[open]'))) return;
            const run = recentRun(history);
            if (run.length < 2) return;
            const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const cpu = run.map((s) => Math.round(Number(s.cpu) || 0));
            const mem = run.map((s) => Math.round(Number(s.mem) || 0));
            const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
            const spanSec = Math.max(1, Math.round((run[run.length - 1].ts - run[0].ts) / 1000));
            const span = spanSec >= 120 ? t('server_mgmt.span_minutes', { n: Math.round(spanSec / 60) }) : t('server_mgmt.span_seconds', { n: spanSec });
            window.UiChart.render(host, {
                kind: 'line',
                label: t('server_mgmt.history_label'),
                summary: t('server_mgmt.history_summary', {
                    span,
                    cpuAvg: pct(avg(cpu)), cpuMax: pct(Math.max(...cpu)),
                    memAvg: pct(avg(mem)), memMax: pct(Math.max(...mem))
                }),
                labels: run.map((s) => fmtTime(s.ts)),
                series: [
                    { name: t('server_mgmt.cpu'), values: cpu },
                    { name: t('server_mgmt.memory'), values: mem }
                ],
                yLabel: '%',
                yMax: 100,
                format: (v) => pct(v),
                xHeading: t('server_mgmt.history_time')
            });
            chartDrawn = true;
        }

        function init() {
            start();
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) stop();
                else start();
            });
        }

        return { init };
    })();

    // ── Files ────────────────────────────────────────────────────────────

    const filesView = (() => {
        let cwd = '';
        let editing = null; // { path, readOnly }
        let menuSeq = 0;

        function entryType(e) {
            if (e.type) return e.type;
            if (e.isSymlink) return 'symlink';
            if (e.isDirectory) return 'dir';
            return 'file';
        }

        function setBodyState(text, isError) {
            const body = document.getElementById('sm-files-body');
            if (isError) {
                body.innerHTML = `<tr><td colspan="5" class="state-cell is-error"><span class="text-danger">${escapeHtml(text)}</span> <button type="button" class="btn btn-sm" id="sm-files-retry">${escapeHtml(t('actions.retry'))}</button></td></tr>`;
                document.getElementById('sm-files-retry').addEventListener('click', () => refresh());
            } else {
                body.innerHTML = `<tr><td colspan="5" class="state-cell">${escapeHtml(text)}</td></tr>`;
            }
        }

        async function refresh(path) {
            const target = path || document.getElementById('sm-files-path').value || cwd || '/';
            setBodyState(t('server_mgmt.files_loading'));
            setText('sm-files-count', '');
            try {
                const data = await api(`/api/server-management/files?path=${encodeURIComponent(target)}`);
                cwd = data.cwd || target;
                document.getElementById('sm-files-path').value = cwd;
                renderEntries(data.entries || []);
            } catch (err) {
                document.getElementById('sm-files-path').value = target;
                setBodyState(t('server_mgmt.files_open_error', { error: err.message }), true);
            }
        }

        function renderEntries(entries) {
            const body = document.getElementById('sm-files-body');
            const folders = entries.filter((e) => entryType(e) === 'dir').length;
            setText('sm-files-count', t('server_mgmt.files_count', { folders, files: entries.length - folders }));
            if (!entries.length) {
                setBodyState(t('server_mgmt.files_empty'));
                return;
            }
            body.innerHTML = entries.map((e) => {
                const type = entryType(e);
                const p = escapeHtml(e.path);
                const n = escapeHtml(e.name);
                const sizeHtml = type === 'dir' ? '' : escapeHtml(formatBytes(e.size || 0));
                const perms = e.mode != null ? (e.mode & 0o7777).toString(8).padStart(4, '0') : '';
                const permsHtml = !perms ? emptyHtml() : (U().valueHtml ? U().valueHtml(perms) : `<span class="mono">${perms}</span>`);
                const mtimeHtml = U().timeHtml ? U().timeHtml(e.mtime) : escapeHtml(e.mtime ? new Date(e.mtime).toLocaleString() : '');
                const nameCell = type === 'dir'
                    ? `<button type="button" class="btn-link sm-file-open-dir" data-act="cd" data-path="${p}">${n}/</button>`
                    : `<span class="sm-file-name">${n}</span>${type === 'symlink' ? ` ${U().tagHtml ? U().tagHtml(t('server_mgmt.files_link')) : escapeHtml(t('server_mgmt.files_link'))}` : ''}`;
                const menuId = `sm-file-menu-${++menuSeq}`;
                const items = [];
                if (type === 'file') items.push(`<button type="button" class="menu-item" role="menuitem" data-act="open" data-path="${p}">${icon('open')}${escapeHtml(t('server_mgmt.files_open'))}</button>`);
                items.push(`<button type="button" class="menu-item" role="menuitem" data-act="rename" data-path="${p}" data-name="${n}">${icon('rename')}${escapeHtml(t('server_mgmt.files_rename'))}…</button>`);
                items.push('<span class="menu-divider"></span>');
                items.push(`<button type="button" class="menu-item danger" role="menuitem" data-act="delete" data-path="${p}" data-name="${n}">${icon('delete')}${escapeHtml(t('actions.delete'))}…</button>`);
                return `
                    <tr data-type="${type}" data-path="${p}" data-name="${n}">
                        <td>${nameCell}</td>
                        <td class="num-col is-num">${sizeHtml}</td>
                        <td>${mtimeHtml}</td>
                        <td>${permsHtml}</td>
                        <td class="actions">
                            <span class="menu-anchor">
                                <button type="button" class="kebab-btn" data-menu-button aria-haspopup="menu" aria-expanded="false" aria-controls="${menuId}"
                                        aria-label="${escapeHtml(t('server_mgmt.files_actions_for', { name: e.name }))}"><span class="material-icons" aria-hidden="true">more_vert</span></button>
                                <span class="menu menu-end" id="${menuId}" role="menu">${items.join('')}</span>
                            </span>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        function onBodyClick(ev) {
            const btn = ev.target.closest('[data-act]');
            if (!btn) return;
            const act = btn.getAttribute('data-act');
            const p = btn.getAttribute('data-path');
            if (act === 'cd') refresh(p);
            else if (act === 'open') openFile(p);
            else if (act === 'rename') renameFile(p, btn.getAttribute('data-name'));
            else if (act === 'delete') deleteFile(p, btn.getAttribute('data-name'));
        }

        function setFileStatus(text, kind) {
            const el = document.getElementById('sm-file-status');
            el.textContent = text || '';
            el.classList.toggle('is-ok', kind === 'ok');
            el.classList.toggle('is-error', kind === 'error');
        }

        async function openFile(path) {
            try {
                const data = await api(`/api/server-management/files/read?path=${encodeURIComponent(path)}`);
                const binary = !!(data.isBinary || data.binary);
                const readOnly = binary || !!data.truncated;
                editing = { path, readOnly };
                const ed = document.getElementById('sm-file-editor');
                const area = document.getElementById('sm-file-textarea');
                setText('sm-file-editor-path', data.path || path);
                area.value = data.content || '';
                area.readOnly = readOnly;
                let meta = t(binary ? 'server_mgmt.file_meta_binary' : 'server_mgmt.file_meta_text', { size: formatBytes(data.size || 0) });
                if (!binary && data.truncated) meta += ' ' + t('server_mgmt.file_meta_truncated');
                setText('sm-file-meta', meta);
                document.getElementById('sm-file-save').hidden = readOnly;
                setFileStatus('');
                ed.hidden = false;
                ed.scrollIntoView({ block: 'start' });
                area.focus({ preventScroll: true });
            } catch (err) {
                notify('error', t('server_mgmt.read_failed_reason', { error: err.message }));
            }
        }

        async function saveFile() {
            if (!editing || editing.readOnly) return;
            const content = document.getElementById('sm-file-textarea').value;
            setFileStatus(t('server_mgmt.file_saving'));
            try {
                await api('/api/server-management/files/write', {
                    method: 'POST',
                    body: { path: editing.path, content }
                });
                setFileStatus(t('server_mgmt.file_saved'), 'ok');
                refresh(cwd);
            } catch (err) {
                setFileStatus(t('server_mgmt.save_failed_reason', { error: err.message }), 'error');
            }
        }

        function closeEditor() {
            document.getElementById('sm-file-editor').hidden = true;
            editing = null;
            document.getElementById('sm-files-path').focus();
        }

        function joinPath(dir, name) {
            const sep = dir.includes('\\') ? '\\' : '/';
            return dir.endsWith(sep) ? dir + name : dir + sep + name;
        }

        async function renameFile(path, name) {
            const next = await Modal.prompt({
                title: t('server_mgmt.files_rename_title', { name }),
                label: t('server_mgmt.files_rename_prompt'),
                value: name || '',
                confirmLabel: t('server_mgmt.files_rename')
            });
            if (!next || next === name) return;
            const parent = path.replace(/[/\\][^/\\]*$/, '') || '/';
            try {
                await api('/api/server-management/files/rename', { method: 'POST', body: { from: path, to: joinPath(parent, next) } });
                notify('success', t('server_mgmt.files_renamed', { name: next }));
                refresh(cwd);
            } catch (err) {
                notify('error', t('server_mgmt.rename_failed_reason', { error: err.message }));
            }
        }

        async function deleteFile(path, name) {
            const ok = await Modal.confirm({
                title: t('server_mgmt.delete_title', { name }),
                message: t('server_mgmt.delete_body', { path }),
                confirmLabel: t('actions.delete'),
                danger: true
            });
            if (!ok) return;
            try {
                await api('/api/server-management/files/delete', { method: 'POST', body: { path } });
                notify('success', t('server_mgmt.files_deleted', { name }));
                refresh(cwd);
            } catch (err) {
                notify('error', t('server_mgmt.delete_failed_reason', { error: err.message }));
            }
        }

        async function mkdir() {
            const name = await Modal.prompt({
                title: t('server_mgmt.files_mkdir'),
                label: t('server_mgmt.mkdir_prompt'),
                confirmLabel: t('server_mgmt.mkdir_confirm')
            });
            if (!name) return;
            try {
                await api('/api/server-management/files/mkdir', { method: 'POST', body: { path: joinPath(cwd, name) } });
                notify('success', t('server_mgmt.files_folder_created', { name }));
                refresh(cwd);
            } catch (err) {
                notify('error', t('server_mgmt.mkdir_failed_reason', { error: err.message }));
            }
        }

        function up() {
            const sep = cwd.includes('\\') ? '\\' : '/';
            const trimmed = cwd.replace(/[\\/]+$/, '');
            const parent = trimmed.replace(/[/\\][^/\\]*$/, '') || sep;
            refresh(parent);
        }

        async function init() {
            document.getElementById('sm-files-up').addEventListener('click', up);
            document.getElementById('sm-files-refresh').addEventListener('click', () => refresh(cwd));
            document.getElementById('sm-files-form').addEventListener('submit', (e) => { e.preventDefault(); refresh(); });
            document.getElementById('sm-files-mkdir').addEventListener('click', mkdir);
            document.getElementById('sm-files-body').addEventListener('click', onBodyClick);
            document.getElementById('sm-file-save').addEventListener('click', saveFile);
            document.getElementById('sm-file-close').addEventListener('click', closeEditor);

            // Start in the first folder the console may open; list them all beside the table
            let start = '/';
            const rootsList = document.getElementById('sm-files-roots');
            const rootsState = document.getElementById('sm-files-roots-state');
            try {
                const info = await api('/api/server-management/info');
                const roots = Array.isArray(info.fileRoots) ? info.fileRoots : [];
                const mutable = Array.isArray(info.mutableFileRoots) ? info.mutableFileRoots : null;
                if (roots.length) {
                    start = roots[0];
                    rootsList.innerHTML = roots.map((r) => {
                        const canChange = mutable ? mutable.some((m) => r === m || r.startsWith(m.replace(/\/+$/, '') + '/')) : null;
                        const sub = canChange === null ? '' : `<span class="row-sub">${escapeHtml(t(canChange ? 'server_mgmt.root_writable' : 'server_mgmt.root_readonly'))}</span>`;
                        return `<li class="list-row"><span class="row-main"><span class="row-title mono">${escapeHtml(r)}</span>${sub}</span>`
                            + `<span class="row-end"><button type="button" class="btn btn-sm" data-act="cd" data-path="${escapeHtml(r)}" aria-label="${escapeHtml(t('server_mgmt.files_open_root', { path: r }))}">${icon('files')}${escapeHtml(t('server_mgmt.files_open'))}</button></span></li>`;
                    }).join('');
                    rootsList.hidden = false;
                    rootsState.hidden = true;
                    rootsList.addEventListener('click', onBodyClick);
                } else {
                    rootsState.textContent = t('server_mgmt.files_roots_none');
                }
            } catch (_) {
                /* fall back to / */
                rootsState.textContent = t('server_mgmt.files_roots_error');
            }
            refresh(start);
        }

        return { init };
    })();

    // ── Services ─────────────────────────────────────────────────────────

    const servicesView = (() => {
        let services = [];
        let platform = '';
        let menuSeq = 0;

        function setBodyState(text, isError) {
            const body = document.getElementById('sm-services-body');
            if (isError) {
                body.innerHTML = `<tr><td colspan="3" class="state-cell"><span class="text-danger">${escapeHtml(text)}</span> <button type="button" class="btn btn-sm" id="sm-services-retry">${escapeHtml(t('actions.retry'))}</button></td></tr>`;
                document.getElementById('sm-services-retry').addEventListener('click', refresh);
            } else {
                body.innerHTML = `<tr><td colspan="3" class="state-cell">${escapeHtml(text)}</td></tr>`;
            }
        }

        function showEmpty(empty) {
            const note = document.getElementById('sm-services-empty');
            if (note) note.hidden = !empty;
            ['sm-services-toolbar', 'sm-services-list', 'sm-services-count'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.hidden = empty;
            });
        }

        async function refresh() {
            setBodyState(t('server_mgmt.svc_loading'));
            try {
                const data = await api('/api/server-management/services');
                services = data.services || [];
                platform = data.platform || '';
                render();
            } catch (err) {
                showEmpty(false);
                setText('sm-services-count', '');
                setBodyState(t('server_mgmt.svc_load_failed_reason', { error: err.message }), true);
            }
        }

        function isRunning(s) {
            return s.state === 'active' || s.state === 'running' || s.sub === 'running';
        }

        function stateHtml(s) {
            const state = String(s.state || s.status || '').toLowerCase();
            let tone;
            let text;
            if (isRunning(s)) { tone = 'good'; text = t('status.running'); }
            else if (state === 'failed') { tone = 'danger'; text = t('server_mgmt.svc_failed'); }
            else if (state === 'inactive' || state === 'stopped') { tone = 'neutral'; text = t('status.stopped'); }
            else { tone = U().statusTone ? U().statusTone(state) : 'neutral'; text = state || t('status.unknown'); }
            const sub = s.sub && s.sub !== state ? `<span class="cell-sub">${escapeHtml(s.sub)}</span>` : '';
            const mark = U().statusHtml ? U().statusHtml(tone, text) : `<span class="status is-${tone}">${escapeHtml(text)}</span>`;
            return mark + sub;
        }

        function render() {
            const filter = (document.getElementById('sm-services-search').value || '').toLowerCase();
            const filtered = filter
                ? services.filter((s) =>
                    (s.name || '').toLowerCase().includes(filter) ||
                    (s.description || '').toLowerCase().includes(filter))
                : services;
            const running = services.filter(isRunning).length;
            setText('sm-services-count', services.length
                ? (filter ? t('server_mgmt.svc_count_filtered', { shown: filtered.length, total: services.length })
                    : t('server_mgmt.svc_count', { total: services.length, running }))
                : '');
            // Nothing to search or control (the Docker image): one sentence instead of an empty table
            showEmpty(!services.length);
            if (!services.length) return;
            if (!filtered.length) { setBodyState(t('server_mgmt.svc_no_match')); return; }

            const isWin = platform === 'win32';
            const body = document.getElementById('sm-services-body');
            body.innerHTML = filtered.map((s) => {
                const name = escapeHtml(s.name);
                const main = isRunning(s) ? 'stop' : 'start';
                const menu = (isWin ? [] : ['reload', 'enable', 'disable']);
                const menuId = `sm-svc-menu-${++menuSeq}`;
                const menuHtml = menu.length ? `
                    <span class="menu-anchor">
                        <button type="button" class="kebab-btn" data-menu-button aria-haspopup="menu" aria-expanded="false" aria-controls="${menuId}"
                                aria-label="${escapeHtml(t('server_mgmt.svc_actions_for', { name: s.name }))}"><span class="material-icons" aria-hidden="true">more_vert</span></button>
                        <span class="menu menu-end" id="${menuId}" role="menu">
                            ${menu.map((a) => `<button type="button" class="menu-item" role="menuitem" data-svc="${name}" data-act="${a}">${SVC_ICONS[a] ? icon(SVC_ICONS[a]) : ''}${escapeHtml(t('server_mgmt.svc_' + a))}</button>`).join('')}
                        </span>
                    </span>` : '';
                return `
                    <tr>
                        <td>${U().valueHtml ? U().valueHtml(s.name) : `<span class="mono">${name}</span>`}${s.description ? `<span class="cell-sub">${escapeHtml(s.description)}</span>` : ''}</td>
                        <td>${stateHtml(s)}</td>
                        <td class="actions">
                            <button type="button" class="btn btn-sm" data-svc="${name}" data-act="restart">${escapeHtml(t('server_mgmt.svc_restart'))}</button>
                            <button type="button" class="btn btn-sm${main === 'stop' ? ' btn-danger-quiet' : ''}" data-svc="${name}" data-act="${main}">${escapeHtml(t('server_mgmt.svc_' + main))}</button>
                            ${menuHtml}
                        </td>
                    </tr>
                `;
            }).join('');
        }

        async function act(name, action) {
            if (['stop', 'disable', 'restart'].includes(action)) {
                const ok = await Modal.confirm({
                    title: t('server_mgmt.svc_confirm_title', { action: t('server_mgmt.svc_' + action), name }),
                    message: t('server_mgmt.svc_confirm_' + action, { name }),
                    confirmLabel: t('server_mgmt.svc_' + action),
                    danger: action !== 'restart'
                });
                if (!ok) return;
            }
            try {
                const r = await api(`/api/server-management/services/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
                if (r.exitCode === 0 || r.exitCode === undefined) {
                    notify('success', t('server_mgmt.svc_done', { action: t('server_mgmt.svc_' + action), name }));
                } else {
                    notify('error', t('server_mgmt.svc_done_exit', { action: t('server_mgmt.svc_' + action), name, code: r.exitCode }));
                }
                refresh();
            } catch (err) {
                notify('error', t('server_mgmt.svc_action_failed_reason', { error: err.message }));
            }
        }

        function init() {
            document.getElementById('sm-services-refresh').addEventListener('click', refresh);
            document.getElementById('sm-services-search').addEventListener('input', () => render());
            document.getElementById('sm-services-body').addEventListener('click', (ev) => {
                const btn = ev.target.closest('[data-svc]');
                if (btn) act(btn.getAttribute('data-svc'), btn.getAttribute('data-act'));
            });
            refresh();
        }

        return { init };
    })();

    // ── Terminal ─────────────────────────────────────────────────────────

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
                    s2.onerror = () => reject(new Error('addon-fit'));
                    document.head.appendChild(s2);
                };
                s1.onerror = () => reject(new Error('xterm'));
                document.head.appendChild(s1);
            });
            return xtermLoading;
        }

        function setStatus(text, cls) {
            const el = document.getElementById('sm-term-status');
            el.textContent = text;
            el.className = 'sm-term-status' + (cls ? ' ' + cls : '');
        }

        function setNotice(text) {
            const el = document.getElementById('sm-term-notice');
            if (!el) return;
            el.textContent = text || '';
            el.hidden = !text;
        }

        function setButtons(connected) {
            document.getElementById('sm-term-connect').disabled = connected;
            document.getElementById('sm-term-disconnect').disabled = !connected;
            document.getElementById('sm-term-clear').disabled = !term;
        }

        async function connect(focusAfter) {
            setStatus(t('server_mgmt.term_connecting'));
            try { await loadXterm(); } catch (_) {
                setStatus(t('server_mgmt.term_lib_failed'), 'is-error');
                return;
            }
            const Terminal = window.Terminal;
            const FitAddon = window.FitAddon && window.FitAddon.FitAddon;
            if (!Terminal || !FitAddon) {
                setStatus(t('server_mgmt.term_lib_failed'), 'is-error');
                return;
            }
            if (term) teardown();
            const host = document.getElementById('sm-terminal-host');
            host.innerHTML = '';
            term = new Terminal({
                cursorBlink: true,
                fontFamily: '"IBM Plex Mono", Menlo, Consolas, monospace',
                fontSize: 13,
                theme: { background: '#111414', foreground: '#e3e6e6', cursor: '#e3e6e6' }
            });
            fitAddon = new FitAddon();
            term.loadAddon(fitAddon);
            // Tab belongs to the shell; Esc then Tab leaves the terminal
            let escPressed = false;
            term.attachCustomKeyEventHandler((e) => {
                if (e.type !== 'keydown') return true;
                if (e.key === 'Tab' && escPressed) { escPressed = false; return false; }
                escPressed = e.key === 'Escape';
                return true;
            });
            term.open(host);
            try { fitAddon.fit(); } catch (_) { /* ignore */ }

            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(`${proto}//${window.location.host}/ws/server-management/terminal`);
            const socket = ws;
            // A shell that ends within a few seconds never started; say why above the terminal
            let readyAt = 0;
            let shellPath = '';
            let early = '';
            setNotice('');

            let opened = false;
            socket.onopen = () => {
                opened = true;
                socket.send(JSON.stringify({ type: 'init', cols: term.cols, rows: term.rows }));
            };
            socket.onmessage = (ev) => {
                let msg;
                try { msg = JSON.parse(ev.data); } catch (_) { return; }
                if (msg.type === 'ready') {
                    readyAt = Date.now();
                    shellPath = msg.shell || '';
                    let text = t('server_mgmt.term_connected_as', { user: msg.user || '?', platform: msg.platform || '' });
                    if (!msg.pty_available || msg.kind === 'pipe') text += ' ' + t('server_mgmt.term_limited');
                    setStatus(text, 'is-ok');
                    setButtons(true);
                    // Only when asked: a focused terminal keeps Tab for the shell
                    if (focusAfter === true) term.focus();
                } else if (msg.type === 'output') {
                    if (readyAt && Date.now() - readyAt < 3000 && early.length < 2000) early += msg.data;
                    term.write(msg.data);
                } else if (msg.type === 'end') {
                    term.writeln(`\r\n[${t('server_mgmt.term_exited', { code: msg.code })}]`);
                    if (readyAt && Date.now() - readyAt < 3000 && msg.code !== 0) {
                        const missing = /no such file|not found|execvp|ENOENT/i.test(early);
                        setNotice(missing
                            ? t('server_mgmt.term_shell_missing', { shell: shellPath || '/bin/bash' })
                            : t('server_mgmt.term_shell_ended', { code: msg.code }));
                    }
                } else if (msg.type === 'error') {
                    term.writeln(`\r\n[${msg.error}]`);
                    setStatus(t('server_mgmt.term_error_reason', { error: msg.error }), 'is-error');
                }
            };
            socket.onclose = () => {
                if (ws !== socket) return;
                ws = null;
                // A socket that never opened keeps its error instead of a plain "Disconnected"
                if (opened) setStatus(t('server_mgmt.term_disconnected'));
                else setStatus(t('server_mgmt.term_error'), 'is-error');
                setButtons(false);
            };
            socket.onerror = () => setStatus(t('server_mgmt.term_error'), 'is-error');

            term.onData((d) => {
                if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d }));
            });

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

        function teardown() {
            if (ws) {
                const socket = ws;
                ws = null;
                try { socket.send(JSON.stringify({ type: 'close' })); } catch (_) { /* ignore */ }
                try { socket.close(); } catch (_) { /* ignore */ }
            }
            if (term) {
                try { term._cleanupResize && term._cleanupResize(); } catch (_) { /* ignore */ }
                try { term.dispose(); } catch (_) { /* ignore */ }
                term = null;
                fitAddon = null;
            }
        }

        function disconnect() {
            teardown();
            document.getElementById('sm-terminal-host').innerHTML = '';
            setButtons(false);
            setStatus(t('server_mgmt.term_disconnected'));
            document.getElementById('sm-term-connect').focus();
        }

        function clear() {
            if (term) { term.clear(); term.focus(); }
        }

        function init() {
            document.getElementById('sm-term-connect').addEventListener('click', () => connect(true));
            document.getElementById('sm-term-disconnect').addEventListener('click', disconnect);
            document.getElementById('sm-term-clear').addEventListener('click', clear);
            window.addEventListener('pagehide', teardown);
            connect(false);
        }

        return { init };
    })();

    // ── Bootstrap ────────────────────────────────────────────────────────

    function bootstrap() {
        const page = document.getElementById('server-mgmt-page');
        if (!page) return;
        const tab = page.dataset.initialTab || 'overview';
        if (tab === 'terminal') terminalView.init();
        else if (tab === 'files') filesView.init();
        else if (tab === 'services') servicesView.init();
        else overview.init();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }
})();
