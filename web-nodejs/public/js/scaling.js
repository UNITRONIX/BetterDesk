/* scaling.js — Scaling & Relay Node Management */
'use strict';
(function () {
    const _ = window._ || (k => k);
    let _relays = [];
    let _rules = [];
    let _capacity = null;

    function csrfHeaders(extra) {
        const h = Object.assign({}, extra || {});
        const token = (window.BetterDesk && window.BetterDesk.csrfToken) || '';
        if (token) h['x-csrf-token'] = token;
        return h;
    }

    function notify(level, message) {
        if (!message) return;
        if (window.Notifications && typeof window.Notifications[level] === 'function') {
            window.Notifications[level](message);
            return;
        }
        if (window.Toast && typeof window.Toast[level] === 'function') {
            window.Toast[level]('', message);
            return;
        }
        if (level === 'error' || level === 'warning') {
            try { alert(message); } catch (_e) { /* ignore */ }
        }
    }

    // -----------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------
    async function init() {
        const activeTab = document.querySelector('.scaling-tab.active')?.dataset.tab || 'overview';
        if (activeTab === 'overview') loadOverview();
        if (activeTab === 'relays') loadRelays();
        if (activeTab === 'rules') loadRules();
        if (activeTab === 'capacity') loadCapacity();
    }

    function switchTab(tab) {
        document.querySelectorAll('.scaling-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        document.querySelectorAll('.scaling-panel').forEach(p => p.style.display = 'none');
        const panel = document.getElementById('panel-' + tab);
        if (panel) panel.style.display = 'block';
        if (tab === 'overview') loadOverview();
        if (tab === 'relays') loadRelays();
        if (tab === 'rules') loadRules();
        if (tab === 'capacity') loadCapacity();
        const url = new URL(window.location); url.searchParams.set('tab', tab);
        window.history.replaceState({}, '', url);
    }

    // -----------------------------------------------------------------------
    // Overview
    // -----------------------------------------------------------------------
    async function loadOverview() {
        await loadRelays();
        renderArchDiagram();
        renderSummaryCards();
        renderRelayHealthGrid();
    }

    function renderSummaryCards() {
        const totalRelays = _relays.length;
        const totalDevices = _relays.reduce((s, r) => s + (r.connected_devices || 0), 0);
        const activeSessions = _relays.reduce((s, r) => s + (r.active_sessions || 0), 0);
        const bandwidth = _relays.reduce((s, r) => s + (r.bandwidth_mbps || 0), 0);

        setText('stat-total-relays', totalRelays);
        setText('stat-total-devices', totalRelays > 0 ? totalDevices : '—');
        setText('stat-active-sessions', totalRelays > 0 ? activeSessions : '—');
        setText('stat-bandwidth', totalRelays > 0 ? bandwidth.toFixed(1) + ' Mbps' : '—');
    }

    function renderArchDiagram() {
        const container = document.getElementById('arch-diagram');
        if (!container) return;
        if (_relays.length === 0) {
            container.innerHTML = `<div class="arch-empty">${_('scaling.no_relays')}</div>`;
            return;
        }
        // SVG topology: master in center, relay nodes around it
        const w = 700, h = 260, cx = w / 2, cy = 50;
        const relayY = 160;
        const relaySpacing = Math.min(160, (w - 120) / Math.max(_relays.length, 1));
        const startX = cx - ((_relays.length - 1) * relaySpacing) / 2;

        let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="max-width:${w}px">`;
        // Master node
        svg += `<rect x="${cx - 70}" y="${cy - 20}" width="140" height="40" rx="8" fill="rgba(88,166,255,.15)" stroke="#58a6ff" stroke-width="1.5"/>`;
        svg += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" fill="#58a6ff" font-size="12" font-weight="600">Master Server</text>`;

        _relays.forEach((relay, i) => {
            const rx = startX + i * relaySpacing;
            const color = relay.status === 'online' ? '#3fb950' : relay.status === 'degraded' ? '#d29922' : '#f85149';
            // Connection line
            svg += `<line x1="${cx}" y1="${cy + 20}" x2="${rx}" y2="${relayY - 20}" stroke="${color}" stroke-width="1" stroke-dasharray="4,3" opacity=".5"/>`;
            // Relay box
            svg += `<rect x="${rx - 60}" y="${relayY - 20}" width="120" height="36" rx="6" fill="rgba(${relay.status === 'online' ? '63,185,80' : relay.status === 'degraded' ? '210,153,34' : '248,81,73'},.1)" stroke="${color}" stroke-width="1"/>`;
            svg += `<circle cx="${rx - 44}" cy="${relayY}" r="4" fill="${color}"/>`;
            svg += `<text x="${rx - 34}" y="${relayY + 4}" fill="#e6edf3" font-size="10" font-weight="500">${escHtml(relay.name || 'Relay ' + (i + 1))}</text>`;
            // Device count below
            const devCount = relay.connected_devices || 0;
            svg += `<text x="${rx}" y="${relayY + 30}" text-anchor="middle" fill="#8b949e" font-size="9">${devCount} ${_('scaling.stat_total_devices').toLowerCase()}</text>`;
        });

        svg += '</svg>';
        container.innerHTML = svg;
    }

    function renderRelayHealthGrid() {
        const grid = document.getElementById('relay-health-grid');
        if (!grid) return;
        if (_relays.length === 0) {
            grid.innerHTML = `<div class="scaling-empty">${_('scaling.no_relays')}</div>`;
            return;
        }
        grid.innerHTML = _relays.map(r => {
            const status = r.status || 'offline';
            const cpuPct = r.cpu || 0;
            const memPct = r.memory || 0;
            const bwPct = r.max_bandwidth_mbps ? Math.round((r.bandwidth_mbps || 0) / r.max_bandwidth_mbps * 100) : 0;
            const sessPct = r.max_sessions ? Math.round((r.active_sessions || 0) / r.max_sessions * 100) : 0;
            return `
                <div class="relay-health-card">
                    <div class="relay-health-header">
                        <div class="relay-health-name">
                            <span class="relay-health-dot ${status}"></span>
                            ${escHtml(r.name || r.id)}
                        </div>
                        <div class="relay-health-location">${escHtml(r.location || '')}</div>
                    </div>
                    <div class="relay-health-metrics">
                        ${metricBar('CPU', cpuPct)}
                        ${metricBar(_('scaling.col_bandwidth'), bwPct)}
                        ${metricBar('RAM', memPct)}
                        ${metricBar(_('scaling.col_sessions'), sessPct)}
                    </div>
                </div>`;
        }).join('');
    }

    function metricBar(label, pct) {
        const cls = pct > 85 ? 'high' : pct > 60 ? 'med' : 'low';
        return `<div class="relay-metric">
            <div class="relay-metric-label">${escHtml(label)}</div>
            <div class="relay-metric-bar"><div class="relay-metric-fill ${cls}" style="width:${pct}%"></div></div>
            <div class="relay-metric-value">${pct}%</div>
        </div>`;
    }

    // -----------------------------------------------------------------------
    // Relays CRUD
    // -----------------------------------------------------------------------
    async function loadRelays() {
        try {
            const resp = await fetch('/api/panel/scaling/relays');
            const data = await resp.json();
            _relays = Array.isArray(data) ? data : (data.data || data.relays || []);
        } catch { _relays = []; }
        renderRelaysTable();
    }

    function renderRelaysTable() {
        const tbody = document.getElementById('relays-tbody');
        if (!tbody) return;
        if (_relays.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="scaling-empty">${_('scaling.no_relays')}</td></tr>`;
            return;
        }
        tbody.innerHTML = _relays.map(r => `
            <tr data-id="${escAttr(r.id)}">
                <td><strong>${escHtml(r.name || r.id)}</strong></td>
                <td><code>${escHtml(r.address || '—')}</code></td>
                <td>${escHtml(r.location || '—')}</td>
                <td>${r.connected_devices || 0}</td>
                <td>${r.active_sessions || 0}${r.max_sessions ? ' / ' + r.max_sessions : ''}</td>
                <td>${(r.bandwidth_mbps || 0).toFixed(1)} Mbps</td>
                <td><span class="scaling-status ${r.status || 'offline'}">${_('scaling.status_' + (r.status || 'offline'))}</span></td>
                <td>
                    <button class="btn-icon" data-bd-call="Scaling.editRelay" data-bd-args='["${escAttr(r.id)}"]' title="${_('scaling.edit')}"><span class="material-icons">edit</span></button>
                    <button class="btn-icon" data-bd-call="Scaling.deleteRelay" data-bd-args='["${escAttr(r.id)}"]' title="${_('scaling.delete')}"><span class="material-icons">delete</span></button>
                </td>
            </tr>
        `).join('');
    }

    function filterRelays() {
        const q = (document.getElementById('relay-search')?.value || '').toLowerCase();
        const rows = document.querySelectorAll('#relays-tbody tr[data-id]');
        rows.forEach(row => {
            row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
    }

    function showAddRelay() {
        document.getElementById('relay-edit-id').value = '';
        document.getElementById('relay-name').value = '';
        document.getElementById('relay-address').value = '';
        document.getElementById('relay-location').value = '';
        document.getElementById('relay-max-sessions').value = '50';
        document.getElementById('relay-max-bw').value = '100';
        document.getElementById('relay-modal-title').textContent = _('scaling.relay_add');
        document.getElementById('relay-modal').style.display = '';
    }

    function editRelay(id) {
        const r = _relays.find(x => x.id === id);
        if (!r) return;
        document.getElementById('relay-edit-id').value = r.id;
        document.getElementById('relay-name').value = r.name || '';
        document.getElementById('relay-address').value = r.address || '';
        document.getElementById('relay-location').value = r.location || '';
        document.getElementById('relay-max-sessions').value = r.max_sessions || 50;
        document.getElementById('relay-max-bw').value = r.max_bandwidth_mbps || 100;
        document.getElementById('relay-modal-title').textContent = _('scaling.edit');
        document.getElementById('relay-modal').style.display = '';
    }

    async function saveRelay() {
        const id = document.getElementById('relay-edit-id').value;
        const body = {
            name: document.getElementById('relay-name').value.trim(),
            address: document.getElementById('relay-address').value.trim(),
            location: document.getElementById('relay-location').value.trim(),
            max_sessions: parseInt(document.getElementById('relay-max-sessions').value) || 50,
            max_bandwidth_mbps: parseInt(document.getElementById('relay-max-bw').value) || 100,
        };
        if (!body.name || !body.address) {
            notify('warning', _('scaling.relay_name_address_required') || 'Name and address are required.');
            return;
        }
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/panel/scaling/relays/${encodeURIComponent(id)}` : '/api/panel/scaling/relays';
        try {
            const resp = await fetch(url, {
                method,
                headers: csrfHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                notify('error', err.error || (_('scaling.relay_save_failed') || 'Failed to save relay node.'));
                return;
            }
            notify('success', _('scaling.relay_saved') || 'Relay node saved.');
        } catch (err) {
            notify('error', (err && err.message) || (_('scaling.relay_save_failed') || 'Failed to save relay node.'));
            return;
        }
        closeRelayModal();
        loadRelays();
    }

    async function deleteRelay(id) {
        if (!confirm(_('scaling.confirm_delete_relay'))) return;
        try {
            const resp = await fetch(`/api/panel/scaling/relays/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: csrfHeaders(),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                notify('error', err.error || (_('scaling.relay_delete_failed') || 'Failed to delete relay node.'));
                return;
            }
            notify('success', _('scaling.relay_deleted') || 'Relay node deleted.');
        } catch (err) {
            notify('error', (err && err.message) || (_('scaling.relay_delete_failed') || 'Failed to delete relay node.'));
        }
        loadRelays();
    }

    function closeRelayModal() {
        document.getElementById('relay-modal').style.display = 'none';
    }

    // -----------------------------------------------------------------------
    // Assignment Rules
    // -----------------------------------------------------------------------
    async function loadRules() {
        try {
            const resp = await fetch('/api/panel/scaling/rules');
            const data = await resp.json();
            _rules = Array.isArray(data) ? data : (data.data || data.rules || []);
        } catch { _rules = []; }
        renderRulesTable();
    }

    function renderRulesTable() {
        const tbody = document.getElementById('rules-tbody');
        if (!tbody) return;
        if (_rules.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="scaling-empty">${_('scaling.no_rules')}</td></tr>`;
            return;
        }
        tbody.innerHTML = _rules.sort((a, b) => (a.priority || 0) - (b.priority || 0)).map(r => `
            <tr data-id="${escAttr(r.id)}">
                <td>${r.priority || 0}</td>
                <td><strong>${escHtml(r.name || r.id)}</strong></td>
                <td><code>${escHtml(r.match_type || '')}:${escHtml(r.match_value || '')}</code></td>
                <td>${escHtml(r.target_relay_name || r.target_relay || '—')}</td>
                <td>${escHtml(r.fallback || 'master')}</td>
                <td><span class="scaling-status ${r.enabled !== false ? 'enabled' : 'disabled'}">${r.enabled !== false ? _('scaling.status_enabled') : _('scaling.status_disabled')}</span></td>
                <td>
                    <button class="btn-icon" data-bd-call="Scaling.editRule" data-bd-args='["${escAttr(r.id)}"]' title="${_('scaling.edit')}"><span class="material-icons">edit</span></button>
                    <button class="btn-icon" data-bd-call="Scaling.deleteRule" data-bd-args='["${escAttr(r.id)}"]' title="${_('scaling.delete')}"><span class="material-icons">delete</span></button>
                </td>
            </tr>
        `).join('');
    }

    function showAddRule() {
        document.getElementById('rule-edit-id').value = '';
        document.getElementById('rule-name').value = '';
        document.getElementById('rule-match-type').value = 'subnet';
        document.getElementById('rule-match-value').value = '';
        document.getElementById('rule-fallback').value = 'master';
        document.getElementById('rule-priority').value = '10';
        document.getElementById('rule-modal-title').textContent = _('scaling.rule_add');
        populateRelaySelect('rule-target-relay');
        document.getElementById('rule-modal').style.display = '';
    }

    function editRule(id) {
        const r = _rules.find(x => x.id === id);
        if (!r) return;
        document.getElementById('rule-edit-id').value = r.id;
        document.getElementById('rule-name').value = r.name || '';
        document.getElementById('rule-match-type').value = r.match_type || 'subnet';
        document.getElementById('rule-match-value').value = r.match_value || '';
        document.getElementById('rule-fallback').value = r.fallback || 'master';
        document.getElementById('rule-priority').value = r.priority || 10;
        document.getElementById('rule-modal-title').textContent = _('scaling.edit');
        populateRelaySelect('rule-target-relay', r.target_relay);
        document.getElementById('rule-modal').style.display = '';
    }

    function populateRelaySelect(selectId, selectedValue) {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        sel.innerHTML = _relays.map(r =>
            `<option value="${escAttr(r.id)}" ${r.id === selectedValue ? 'selected' : ''}>${escHtml(r.name || r.id)}</option>`
        ).join('');
    }

    async function saveRule() {
        const id = document.getElementById('rule-edit-id').value;
        const body = {
            name: document.getElementById('rule-name').value.trim(),
            match_type: document.getElementById('rule-match-type').value,
            match_value: document.getElementById('rule-match-value').value.trim(),
            target_relay: document.getElementById('rule-target-relay').value,
            fallback: document.getElementById('rule-fallback').value,
            priority: parseInt(document.getElementById('rule-priority').value) || 10,
        };
        if (!body.name || !body.match_value) {
            notify('warning', _('scaling.rule_name_value_required') || 'Rule name and match value are required.');
            return;
        }
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/panel/scaling/rules/${encodeURIComponent(id)}` : '/api/panel/scaling/rules';
        try {
            const resp = await fetch(url, {
                method,
                headers: csrfHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                notify('error', err.error || (_('scaling.rule_save_failed') || 'Failed to save rule.'));
                return;
            }
            notify('success', _('scaling.rule_saved') || 'Rule saved.');
        } catch (err) {
            notify('error', (err && err.message) || (_('scaling.rule_save_failed') || 'Failed to save rule.'));
            return;
        }
        closeRuleModal();
        loadRules();
    }

    async function deleteRule(id) {
        if (!confirm(_('scaling.confirm_delete_rule'))) return;
        try {
            const resp = await fetch(`/api/panel/scaling/rules/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: csrfHeaders(),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                notify('error', err.error || (_('scaling.rule_delete_failed') || 'Failed to delete rule.'));
                return;
            }
            notify('success', _('scaling.rule_deleted') || 'Rule deleted.');
        } catch (err) {
            notify('error', (err && err.message) || (_('scaling.rule_delete_failed') || 'Failed to delete rule.'));
        }
        loadRules();
    }

    function closeRuleModal() {
        document.getElementById('rule-modal').style.display = 'none';
    }

    // -----------------------------------------------------------------------
    // Capacity
    // -----------------------------------------------------------------------
    async function loadCapacity() {
        try {
            const resp = await fetch('/api/panel/scaling/capacity');
            const data = await resp.json();
            _capacity = data.data || data;
        } catch { _capacity = null; }
        if (!_relays.length) await loadRelays();
        renderCapacityTiers();
        renderCapacityRecommendations();
        renderCapacityTable();
    }

    function renderCapacityTiers() {
        const container = document.getElementById('capacity-tiers');
        if (!container) return;

        const tiers = [
            { name: _('scaling.cap_tier_devices'), current: _relays.reduce((s, r) => s + (r.connected_devices || 0), 0), max: _capacity?.max_devices || 500 },
            { name: _('scaling.cap_tier_sessions'), current: _relays.reduce((s, r) => s + (r.active_sessions || 0), 0), max: _capacity?.max_sessions || 50 },
            { name: _('scaling.cap_tier_bandwidth'), current: _relays.reduce((s, r) => s + (r.bandwidth_mbps || 0), 0), max: _capacity?.max_bandwidth_mbps || 100 },
        ];

        container.innerHTML = tiers.map(t => {
            const pct = t.max > 0 ? Math.round(t.current / t.max * 100) : 0;
            const cls = pct > 85 ? 'crit' : pct > 60 ? 'warn' : 'ok';
            return `<div class="capacity-tier">
                <div class="capacity-tier-header">
                    <span class="capacity-tier-name">${escHtml(t.name)}</span>
                    <span class="capacity-tier-pct">${t.current} / ${t.max} (${pct}%)</span>
                </div>
                <div class="capacity-tier-bar"><div class="capacity-tier-fill ${cls}" style="width:${Math.min(pct, 100)}%"></div></div>
            </div>`;
        }).join('');
    }

    function renderCapacityRecommendations() {
        const container = document.getElementById('capacity-recommendations');
        if (!container) return;

        const recs = [];
        const totalDevices = _relays.reduce((s, r) => s + (r.connected_devices || 0), 0);
        const totalSessions = _relays.reduce((s, r) => s + (r.active_sessions || 0), 0);
        const maxDevices = _capacity?.max_devices || 500;
        const maxSessions = _capacity?.max_sessions || 50;

        if (_relays.length === 0) {
            recs.push({ type: 'info', icon: 'info', text: _('scaling.rec_no_relays') });
        }
        if (totalDevices / maxDevices > 0.8) {
            recs.push({ type: 'warn', icon: 'warning', text: _('scaling.rec_devices_high') });
        }
        if (totalSessions / maxSessions > 0.8) {
            recs.push({ type: 'crit', icon: 'error', text: _('scaling.rec_sessions_high') });
        }
        _relays.forEach(r => {
            if ((r.cpu || 0) > 80) {
                recs.push({ type: 'warn', icon: 'warning', text: `${escHtml(r.name)}: ${_('scaling.rec_cpu_high')}` });
            }
        });
        if (recs.length === 0) {
            recs.push({ type: 'info', icon: 'check_circle', text: _('scaling.rec_all_good') });
        }

        container.innerHTML = recs.map(r =>
            `<div class="capacity-rec ${r.type}"><span class="material-icons">${r.icon}</span> ${r.text}</div>`
        ).join('');
    }

    function renderCapacityTable() {
        const tbody = document.getElementById('capacity-tbody');
        if (!tbody) return;

        const totalDevices = _relays.reduce((s, r) => s + (r.connected_devices || 0), 0);
        const totalSessions = _relays.reduce((s, r) => s + (r.active_sessions || 0), 0);
        const tiers = [
            { config: _('scaling.cap_single_sqlite'), maxDev: 200, maxSess: 30 },
            { config: _('scaling.cap_single_pg'), maxDev: 1000, maxSess: 50 },
            { config: _('scaling.cap_master_3'), maxDev: 5000, maxSess: 150 },
            { config: _('scaling.cap_master_10'), maxDev: 20000, maxSess: 500 },
        ];

        tbody.innerHTML = tiers.map(t => {
            const devPct = t.maxDev > 0 ? Math.round(totalDevices / t.maxDev * 100) : 0;
            const cls = devPct > 85 ? 'crit' : devPct > 60 ? 'warn' : 'ok';
            return `<tr>
                <td><strong>${escHtml(t.config)}</strong></td>
                <td>${t.maxDev.toLocaleString()}</td>
                <td>~${t.maxSess}</td>
                <td>${totalDevices} / ${totalSessions}</td>
                <td>
                    <div class="capacity-tier-bar" style="width:120px;display:inline-block;vertical-align:middle;">
                        <div class="capacity-tier-fill ${cls}" style="width:${Math.min(devPct, 100)}%"></div>
                    </div>
                    <span style="font-size:11px;margin-left:6px">${devPct}%</span>
                </td>
            </tr>`;
        }).join('');
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function escAttr(s) { return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    window.Scaling = {
        init, switchTab, loadOverview, loadRelays, loadRules, loadCapacity,
        filterRelays, showAddRelay, editRelay, saveRelay, deleteRelay, closeRelayModal,
        showAddRule, editRule, saveRule, deleteRule, closeRuleModal,
    };

    document.addEventListener('DOMContentLoaded', init);
})();
