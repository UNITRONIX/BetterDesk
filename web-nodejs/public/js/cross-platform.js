/* ===================================================================
   BetterDesk — Cross-Platform Compatibility  (frontend)
   =================================================================== */
(function () {
    'use strict';

    // ── Static data ─────────────────────────────────────────────────
    const PLATFORMS = ['windows', 'linux_x86', 'linux_arm', 'macos', 'android', 'ios', 'web', 'chromeos'];

    // full = ✔ fully supported, partial = ◐ limited, none = ✖ not available, planned = ◎ planned
    const MATRIX = [
        { feature: 'cross_platform.feat_desktop_client',    vals: ['full','full','full','full','planned','planned','partial','partial'] },
        { feature: 'cross_platform.feat_background_agent',  vals: ['full','full','full','partial','partial','none','none','partial'] },
        { feature: 'cross_platform.feat_remote_target',     vals: ['full','full','partial','partial','partial','none','partial','partial'] },
        { feature: 'cross_platform.feat_screen_capture',    vals: ['full','full','full','partial','partial','none','partial','partial'] },
        { feature: 'cross_platform.feat_input_injection',   vals: ['full','full','full','partial','partial','none','partial','none'] },
        { feature: 'cross_platform.feat_file_transfer',     vals: ['full','full','full','full','partial','none','partial','partial'] },
        { feature: 'cross_platform.feat_clipboard_sync',    vals: ['full','full','full','full','partial','none','partial','partial'] },
        { feature: 'cross_platform.feat_audio_streaming',   vals: ['full','full','partial','partial','none','none','partial','none'] },
        { feature: 'cross_platform.feat_chat',              vals: ['full','full','full','full','full','full','full','full'] },
        { feature: 'cross_platform.feat_session_recording', vals: ['full','full','full','partial','none','none','partial','none'] },
        { feature: 'cross_platform.feat_multi_monitor',     vals: ['full','full','full','full','partial','none','partial','none'] },
        { feature: 'cross_platform.feat_unattended_access', vals: ['full','full','full','partial','partial','none','none','none'] },
        { feature: 'cross_platform.feat_h264',              vals: ['full','full','full','full','full','none','partial','full'] },
        { feature: 'cross_platform.feat_vp9',               vals: ['full','full','full','full','partial','none','partial','partial'] },
        { feature: 'cross_platform.feat_av1',               vals: ['partial','partial','none','partial','none','none','partial','none'] },
        { feature: 'cross_platform.feat_cdap_agent',        vals: ['full','full','full','partial','none','none','none','none'] },
    ];

    const LIMITATIONS = [
        { platform: 'windows', icon: 'desktop_windows', status: 'production', items: [
            'cross_platform.limit_win_uac',
            'cross_platform.limit_win_service',
            'cross_platform.limit_win_firewall',
            'cross_platform.limit_win_virtual_account'
        ]},
        { platform: 'linux', icon: 'computer', status: 'production', items: [
            'cross_platform.limit_linux_wayland',
            'cross_platform.limit_linux_pipewire',
            'cross_platform.limit_linux_arm',
            'cross_platform.limit_linux_unprivileged'
        ]},
        { platform: 'macos', icon: 'laptop_mac', status: 'testing', items: [
            'cross_platform.limit_mac_screen',
            'cross_platform.limit_mac_signing',
            'cross_platform.limit_mac_notarize'
        ]},
        { platform: 'android', icon: 'phone_android', status: 'planned', items: [
            'cross_platform.limit_android_projection',
            'cross_platform.limit_android_accessibility',
            'cross_platform.limit_android_battery'
        ]},
        { platform: 'ios', icon: 'phone_iphone', status: 'limited', items: [
            'cross_platform.limit_ios_capture',
            'cross_platform.limit_ios_input',
            'cross_platform.limit_ios_appstore'
        ]},
        { platform: 'web', icon: 'language', status: 'production', items: [
            'cross_platform.limit_web_https',
            'cross_platform.limit_web_codec',
            'cross_platform.limit_web_performance'
        ]},
        { platform: 'chromeos', icon: 'laptop_chromebook', status: 'experimental', items: [
            'cross_platform.limit_chrome_crostini',
            'cross_platform.limit_chrome_pwa',
            'cross_platform.limit_chrome_input'
        ]},
    ];


    // ── Helpers ──────────────────────────────────────────────────────
    function _(key, params) {
        if (typeof window._ === 'function') return window._(key, params || {});
        return key.split('.').pop();
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // Support in words; the cell class only adds colour on top of the word
    function statusCell(val) {
        const known = ['full', 'partial', 'none', 'planned'].includes(val);
        const word = known ? _('cross_platform.value_' + val) : '?';
        return `<td class="cp-cell cp-${known ? val : 'unknown'}">${escapeHtml(word)}</td>`;
    }

    // Platform key from the server ("windows", "ubuntu 22.04") to a readable name
    function platformName(key) {
        const k = String(key || '');
        if (!/^[a-z_]+$/.test(k)) return k;
        const t = _('cross_platform.platform_' + k);
        return t && t !== 'cross_platform.platform_' + k && t !== 'platform_' + k ? t : k;
    }

    // A table of counts with the share as a meter and in words
    function countTable(rows, total, colLabel, nameFn) {
        if (!rows.length) return '';
        const body = rows.map(([name, value]) => {
            const pct = total > 0 ? Math.round((value / total) * 100) : 0;
            return `<tr>
                <th scope="row">${escapeHtml(nameFn ? nameFn(name) : name)}</th>
                <td class="cp-num">${escapeHtml(String(value))}</td>
                <td><div class="meter"><span class="meter-bar"><span class="meter-fill" style="width:${pct}%"></span></span><span class="meter-value">${pct} %</span></div></td>
            </tr>`;
        }).join('');
        return `<div class="table-scroll"><table class="data-table cp-count-table">
            <thead><tr><th scope="col">${escapeHtml(colLabel)}</th><th scope="col" class="cp-num">${escapeHtml(_('cross_platform.col_devices'))}</th><th scope="col">${escapeHtml(_('cross_platform.col_share'))}</th></tr></thead>
            <tbody>${body}</tbody></table></div>`;
    }

    function errorState(text, retry) {
        return `<span class="state is-error">${escapeHtml(text)} <button type="button" class="btn btn-sm" data-bd-call="${retry}">${escapeHtml(_('cross_platform.try_again'))}</button></span>`;
    }

    // ── Tab switching ────────────────────────────────────────────────
    const TABS = ['matrix', 'distribution', 'protocols', 'limitations'];

    function switchTab(tab) {
        if (!TABS.includes(tab)) tab = 'matrix';
        document.querySelectorAll('.crossplatform-tab').forEach(t => {
            const on = t.dataset.tab === tab;
            t.classList.toggle('active', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
            t.tabIndex = on ? 0 : -1;
        });
        document.querySelectorAll('.crossplatform-panel').forEach(p => { p.hidden = p.id !== 'panel-' + tab; });

        const url = new URL(window.location);
        url.searchParams.set('tab', tab);
        history.replaceState(null, '', url);

        if (tab === 'distribution') loadDistribution();
        if (tab === 'protocols') loadProtocols();
    }

    function bindTabKeys() {
        const buttons = Array.from(document.querySelectorAll('.crossplatform-tab'));
        buttons.forEach((btn, i) => {
            btn.addEventListener('keydown', (e) => {
                const rtl = document.documentElement.dir === 'rtl';
                let next = null;
                if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = buttons[(i + 1) % buttons.length];
                else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = buttons[(i - 1 + buttons.length) % buttons.length];
                else if (e.key === 'Home') next = buttons[0];
                else if (e.key === 'End') next = buttons[buttons.length - 1];
                if (!next) return;
                e.preventDefault();
                switchTab(next.dataset.tab);
                next.focus();
            });
        });
    }

    // ── Matrix ───────────────────────────────────────────────────────
    function renderMatrix() {
        const tbody = document.getElementById('matrix-body');
        if (!tbody) return;
        tbody.innerHTML = MATRIX.map(row => {
            const cells = row.vals.map(statusCell).join('');
            return `<tr><th scope="row">${escapeHtml(_(row.feature))}</th>${cells}</tr>`;
        }).join('');
    }

    // ── Distribution ─────────────────────────────────────────────────
    async function loadDistribution() {
        const summary = document.getElementById('summary-grid');
        try {
            const resp = await fetch('/api/panel/cross-platform/distribution', { credentials: 'same-origin' });
            if (!resp.ok) throw new Error(resp.statusText || String(resp.status));
            const data = await resp.json();
            renderDistribution(data);
        } catch (e) {
            if (summary) summary.innerHTML = errorState(_('cross_platform.distribution_failed', { error: e.message }), 'CrossPlatform.loadDistribution');
            ['platform-chart', 'arch-chart', 'version-chart'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
        }
    }

    function renderDistribution(data) {
        const total = data.total || 0;
        const sorted = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
        const plats = sorted(data.platforms);
        const archs = sorted(data.archs);
        const vers = sorted(data.versions);

        const summaryEl = document.getElementById('summary-grid');
        if (summaryEl) {
            summaryEl.textContent = total
                ? _('cross_platform.distribution_summary', { count: total, platforms: plats.length, versions: vers.length })
                : _('cross_platform.no_devices');
        }

        const fill = (id, rows, label, nameFn, limit) => {
            const el = document.getElementById(id);
            if (!el) return;
            const shown = limit ? rows.slice(0, limit) : rows;
            el.innerHTML = rows.length
                ? countTable(shown, total, label, nameFn) + (limit && rows.length > limit
                    ? `<p class="count-line">${escapeHtml(_('cross_platform.more_versions', { count: rows.length - limit }))}</p>` : '')
                : `<p class="state">${escapeHtml(_('cross_platform.no_devices'))}</p>`;
        };
        fill('platform-chart', plats, _('cross_platform.col_system'), platformName);
        fill('version-chart', vers, _('cross_platform.col_version'), null, 8);
        fill('arch-chart', archs, _('cross_platform.col_arch'), (a) => a === 'unknown' ? _('cross_platform.unknown') : a);
    }

    // ── Protocols ────────────────────────────────────────────────────
    async function loadProtocols() {
        renderProtoDiagram();
        try {
            const resp = await fetch('/api/panel/cross-platform/protocols', { credentials: 'same-origin' });
            if (!resp.ok) throw new Error(resp.statusText || String(resp.status));
            const data = await resp.json();
            renderProtocols(data);
        } catch (e) {
            const codecEl = document.getElementById('codec-bars');
            if (codecEl) codecEl.innerHTML = errorState(_('cross_platform.protocols_failed', { error: e.message }), 'CrossPlatform.loadProtocols');
            const featEl = document.getElementById('feature-bars');
            if (featEl) featEl.innerHTML = '';
        }
    }

    function renderProtocols(data) {
        const online = data.totalOnline || 0;
        const block = (elId, emptyId, obj, label, nameFn) => {
            const el = document.getElementById(elId);
            const empty = document.getElementById(emptyId);
            if (!el) return;
            const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
            if (entries.length) {
                el.innerHTML = `<p class="count-line">${escapeHtml(_('cross_platform.online_count', { count: online }))}</p>` + countTable(entries, online, label, nameFn);
                if (empty) empty.hidden = true;
            } else {
                el.innerHTML = '';
                if (empty) empty.hidden = false;
            }
        };
        block('codec-bars', 'codec-empty', data.codecs, _('cross_platform.col_codec'), (c) => String(c).toUpperCase());
        block('feature-bars', 'feature-empty', data.features, _('cross_platform.col_feature'));
    }

    function renderProtoDiagram() {
        const svg = document.getElementById('proto-svg');
        if (!svg) return;
        const box = (x, w, title, sub, strong) => `
            <rect x="${x}" y="40" width="${w}" height="60" rx="3" class="cp-dg-box${strong ? ' is-strong' : ''}"/>
            <text x="${x + w / 2}" y="66" text-anchor="middle" class="cp-dg-title">${escapeHtml(title)}</text>
            <text x="${x + w / 2}" y="86" text-anchor="middle" class="cp-dg-sub">${escapeHtml(sub)}</text>`;
        const arrow = (x1, x2, label) => `
            <line x1="${x1}" y1="70" x2="${x2 - 2}" y2="70" class="cp-dg-line" marker-end="url(#cpArrow)"/>
            <text x="${(x1 + x2) / 2}" y="30" text-anchor="middle" class="cp-dg-msg">${escapeHtml(label)}</text>`;
        svg.innerHTML = `
            <defs><marker id="cpArrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <path d="M0,0 L8,3 L0,6" class="cp-dg-arrow"/>
            </marker></defs>
            ${box(10, 150, _('cross_platform.diagram_client'), _('cross_platform.diagram_client_sub'))}
            ${arrow(160, 250, 'ClientCapabilities')}
            ${box(250, 160, _('cross_platform.diagram_server'), _('cross_platform.diagram_server_sub'), true)}
            ${arrow(410, 500, 'SessionConfig')}
            ${box(500, 150, _('cross_platform.diagram_peer'), _('cross_platform.diagram_peer_sub'))}
        `;
    }

    // ── Limitations ──────────────────────────────────────────────────
    const STATUS_CLASS = { production: 'ok', testing: 'pending', planned: 'offline', limited: 'warning', experimental: 'warning' };

    function renderLimitations() {
        const grid = document.getElementById('limitations-grid');
        if (!grid) return;
        grid.innerHTML = LIMITATIONS.map(lim => {
            const items = lim.items.map(k => `<li>${escapeHtml(_(k))}</li>`).join('');
            const id = 'cp-limit-' + lim.platform;
            return `<section class="section cp-limit" aria-labelledby="${id}">
                <div class="section-head">
                    <h2 id="${id}">${escapeHtml(_('cross_platform.platform_' + lim.platform))}</h2>
                    <span class="status ${STATUS_CLASS[lim.status] || ''}">${escapeHtml(_('cross_platform.status_' + lim.status))}</span>
                </div>
                <ul class="cp-limit-list">${items}</ul>
            </section>`;
        }).join('');
    }

    // ── Init ─────────────────────────────────────────────────────────
    function init() {
        renderMatrix();
        renderLimitations();
        bindTabKeys();

        const active = document.querySelector('.crossplatform-tab.active');
        if (active) {
            const tab = active.dataset.tab;
            if (tab === 'distribution') loadDistribution();
            if (tab === 'protocols') loadProtocols();
        }
    }

    document.addEventListener('DOMContentLoaded', init);

    window.CrossPlatform = { switchTab, loadDistribution, loadProtocols };
})();
