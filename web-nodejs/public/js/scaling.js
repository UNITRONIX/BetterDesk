/* scaling.js: Relay servers page (relay list, assignment rules, capacity) */
'use strict';
(function () {
    const _ = (key, vars) => (typeof window._ === 'function' ? window._(key, vars || {}) : key);
    let _relays = [];
    let _rules = [];
    let _capacity = null;
    let _relaysLoaded = false;
    let _rulesLoaded = false;

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
        }
    }

    async function getJson(url) {
        const resp = await fetch(url, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
    }

    // -----------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------
    async function init() {
        document.getElementById('relay-search')?.addEventListener('input', filterRelays);
        await Promise.all([loadRelays(), loadRules()]);
        loadCapacity();
        // Old links used ?tab=relays|rules|capacity; jump to that section
        const section = document.getElementById('scaling-page')?.dataset.initialSection;
        if (section && section !== 'overview') {
            document.getElementById('panel-' + section)?.scrollIntoView({ block: 'start' });
        }
    }

    function switchTab(tab) {
        document.getElementById('panel-' + tab)?.scrollIntoView({ block: 'start' });
    }

    function loadOverview() {
        return loadRelays();
    }

    function renderCount() {
        const el = document.getElementById('relays-count');
        if (!el) return;
        if (!_relaysLoaded || !_relays.length) { el.textContent = ''; return; }
        const reporting = _relays.filter(r => r.status && r.status !== 'unknown').length;
        el.innerHTML = _('scaling.count_line', {
            relays: `<strong>${_relays.length}</strong>`,
            rules: `<strong>${_rules.length}</strong>`,
            reporting: `<strong>${reporting}</strong>`
        });
    }

    // -----------------------------------------------------------------------
    // Relays
    // -----------------------------------------------------------------------
    async function loadRelays() {
        const tbody = document.getElementById('relays-tbody');
        try {
            const data = await getJson('/api/panel/scaling/relays');
            _relays = Array.isArray(data) ? data : (data.data || data.relays || []);
            _relaysLoaded = true;
            renderRelaysTable();
        } catch {
            _relays = [];
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="5" class="state-cell"><span class="text-danger">${escHtml(_('scaling.relays_error'))}</span> <button type="button" class="btn btn-sm" data-bd-call="Scaling.loadRelays">${escHtml(_('actions.retry'))}</button></td></tr>`;
            }
        }
        renderCount();
    }

    function relayStatusCell(r) {
        const status = r.status || 'unknown';
        if (status === 'unknown') {
            return `<span class="status offline">${escHtml(_('scaling.status_unknown'))}</span>`;
        }
        const cls = status === 'online' ? 'online' : status === 'degraded' ? 'degraded' : 'offline';
        const usage = _('scaling.relay_usage', {
            devices: r.connected_devices || 0,
            sessions: r.active_sessions || 0,
            bandwidth: (r.bandwidth_mbps || 0).toFixed(1),
            cpu: r.cpu || 0,
            memory: r.memory || 0
        });
        return `<span class="status ${cls}">${escHtml(_('scaling.status_' + status))}</span><span class="cell-sub">${escHtml(usage)}</span>`;
    }

    function renderRelaysTable() {
        const tbody = document.getElementById('relays-tbody');
        if (!tbody) return;
        if (_relays.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="state-cell">${escHtml(_('scaling.no_relays'))} <button type="button" class="btn btn-sm" data-bd-call="Scaling.showAddRelay">${escHtml(_('scaling.relay_add'))}</button></td></tr>`;
            return;
        }
        tbody.innerHTML = _relays.map(r => `
            <tr data-id="${escAttr(r.id)}">
                <td><strong>${escHtml(r.name || r.id)}</strong>${r.location ? `<span class="cell-sub">${escHtml(r.location)}</span>` : ''}</td>
                <td class="mono">${escHtml(r.address || '–')}</td>
                <td>${escHtml(_('scaling.relay_limits', { sessions: r.max_sessions || 0, bandwidth: r.max_bandwidth_mbps || 0 }))}</td>
                <td>${relayStatusCell(r)}</td>
                <td class="actions">
                    <button type="button" class="btn btn-sm" data-bd-call="Scaling.editRelay" data-bd-args='["${escAttr(r.id)}"]' aria-label="${escAttr(_('scaling.edit_named', { name: r.name || r.id }))}">${escHtml(_('scaling.edit'))}</button>
                    <button type="button" class="btn btn-sm btn-danger-quiet" data-bd-call="Scaling.deleteRelay" data-bd-args='["${escAttr(r.id)}"]' aria-label="${escAttr(_('scaling.delete_named', { name: r.name || r.id }))}">${escHtml(_('scaling.delete'))}…</button>
                </td>
            </tr>
        `).join('');
        filterRelays();
    }

    function filterRelays() {
        const q = (document.getElementById('relay-search')?.value || '').toLowerCase();
        const rows = document.querySelectorAll('#relays-tbody tr[data-id]');
        let shown = 0;
        rows.forEach(row => {
            const match = row.textContent.toLowerCase().includes(q);
            row.hidden = !match;
            if (match) shown++;
        });
        let none = document.getElementById('relays-no-match');
        if (rows.length && !shown) {
            if (!none) {
                none = document.createElement('tr');
                none.id = 'relays-no-match';
                none.innerHTML = `<td colspan="5" class="state-cell">${escHtml(_('scaling.relays_no_match'))}</td>`;
                document.getElementById('relays-tbody').appendChild(none);
            }
        } else if (none) {
            none.remove();
        }
    }

    function field(id, labelKey, input, hintKey) {
        return `<div class="form-group">
            <label class="form-label" for="${id}">${escHtml(_(labelKey))}</label>
            ${input}
            ${hintKey ? `<p class="form-hint">${escHtml(_(hintKey))}</p>` : ''}
        </div>`;
    }

    function relayForm(r) {
        return `<form id="relay-form" class="scaling-dialog-form" novalidate>
            <input type="hidden" id="relay-edit-id" value="${escAttr(r ? r.id : '')}">
            ${field('relay-name', 'scaling.col_name', `<input type="text" id="relay-name" class="form-input" maxlength="80" value="${escAttr(r ? r.name || '' : '')}" autocomplete="off">`, 'scaling.relay_name_hint')}
            ${field('relay-address', 'scaling.col_address', `<input type="text" id="relay-address" class="form-input mono" value="${escAttr(r ? r.address || '' : '')}" autocomplete="off" spellcheck="false" placeholder="relay.example.com:21117">`, 'scaling.relay_address_hint')}
            ${field('relay-location', 'scaling.col_location', `<input type="text" id="relay-location" class="form-input" maxlength="80" value="${escAttr(r ? r.location || '' : '')}" autocomplete="off">`, 'scaling.relay_location_hint')}
            ${field('relay-max-sessions', 'scaling.relay_max_sessions', `<input type="number" id="relay-max-sessions" class="form-input is-short" min="1" value="${escAttr(r ? r.max_sessions || 50 : 50)}">`)}
            ${field('relay-max-bw', 'scaling.relay_max_bandwidth', `<input type="number" id="relay-max-bw" class="form-input is-short" min="1" value="${escAttr(r ? r.max_bandwidth_mbps || 100 : 100)}">`, 'scaling.relay_limits_hint')}
            <p class="form-status" id="relay-form-status" aria-live="polite"></p>
            <button type="submit" hidden></button>
        </form>`;
    }

    function openRelayDialog(r) {
        Modal.show({
            title: r ? _('scaling.relay_edit') : _('scaling.relay_add'),
            content: relayForm(r),
            buttons: [
                { label: _('scaling.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: r ? _('scaling.save') : _('scaling.relay_add'), class: 'btn-primary', onClick: saveRelay }
            ]
        });
        document.getElementById('relay-form')?.addEventListener('submit', (e) => { e.preventDefault(); saveRelay(); });
    }

    function showAddRelay() { openRelayDialog(null); }

    function editRelay(id) {
        const r = _relays.find(x => x.id === id);
        if (r) openRelayDialog(r);
    }

    function formError(id, message) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = message;
            el.classList.add('is-error');
        } else {
            notify('error', message);
        }
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
            formError('relay-form-status', _('scaling.relay_name_address_required'));
            return;
        }
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/panel/scaling/relays/${encodeURIComponent(id)}` : '/api/panel/scaling/relays';
        try {
            const resp = await fetch(url, {
                method,
                credentials: 'same-origin',
                headers: csrfHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                formError('relay-form-status', _('scaling.relay_save_failed_reason', { error: err.error || ('HTTP ' + resp.status) }));
                return;
            }
        } catch (err) {
            formError('relay-form-status', _('scaling.relay_save_failed_reason', { error: (err && err.message) || '' }));
            return;
        }
        Modal.close();
        notify('success', _('scaling.relay_saved_named', { name: body.name }));
        await loadRelays();
        loadCapacity();
    }

    async function deleteRelay(id) {
        const r = _relays.find(x => x.id === id);
        const name = r ? (r.name || r.id) : id;
        const ok = await Modal.confirm({
            title: _('scaling.delete_relay_title', { name }),
            message: _('scaling.confirm_delete_relay'),
            confirmLabel: _('scaling.delete'),
            danger: true
        });
        if (!ok) return;
        try {
            const resp = await fetch(`/api/panel/scaling/relays/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                credentials: 'same-origin',
                headers: csrfHeaders(),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                notify('error', _('scaling.relay_delete_failed_reason', { error: err.error || ('HTTP ' + resp.status) }));
                return;
            }
            notify('success', _('scaling.relay_deleted_named', { name }));
        } catch (err) {
            notify('error', _('scaling.relay_delete_failed_reason', { error: (err && err.message) || '' }));
        }
        await loadRelays();
        loadCapacity();
    }

    function closeRelayModal() { Modal.close(); }

    // -----------------------------------------------------------------------
    // Assignment rules
    // -----------------------------------------------------------------------
    async function loadRules() {
        const tbody = document.getElementById('rules-tbody');
        try {
            const data = await getJson('/api/panel/scaling/rules');
            _rules = Array.isArray(data) ? data : (data.data || data.rules || []);
            _rulesLoaded = true;
            renderRulesTable();
        } catch {
            _rules = [];
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="7" class="state-cell"><span class="text-danger">${escHtml(_('scaling.rules_error'))}</span> <button type="button" class="btn btn-sm" data-bd-call="Scaling.loadRules">${escHtml(_('actions.retry'))}</button></td></tr>`;
            }
        }
        renderCount();
    }

    function matchTypeLabel(type) {
        const key = 'scaling.match_' + type;
        const v = _(key);
        return v === key ? type : v;
    }

    function relayName(id) {
        const r = _relays.find(x => x.id === id);
        return r ? (r.name || r.id) : (id || '–');
    }

    function renderRulesTable() {
        const tbody = document.getElementById('rules-tbody');
        if (!tbody) return;
        if (_rules.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="state-cell">${escHtml(_('scaling.no_rules'))}</td></tr>`;
            return;
        }
        tbody.innerHTML = _rules.sort((a, b) => (a.priority || 0) - (b.priority || 0)).map(r => `
            <tr data-id="${escAttr(r.id)}">
                <td class="num-col">${r.priority || 0}</td>
                <td><strong>${escHtml(r.name || r.id)}</strong></td>
                <td>${escHtml(matchTypeLabel(r.match_type || ''))}: <span class="mono">${escHtml(r.match_value || '')}</span></td>
                <td>${escHtml(r.target_relay_name || relayName(r.target_relay))}</td>
                <td>${escHtml(_('scaling.fallback_' + (r.fallback || 'master')))}</td>
                <td><span class="status ${r.enabled !== false ? 'ok' : 'offline'}">${r.enabled !== false ? escHtml(_('scaling.status_enabled')) : escHtml(_('scaling.status_disabled'))}</span></td>
                <td class="actions">
                    <button type="button" class="btn btn-sm" data-bd-call="Scaling.editRule" data-bd-args='["${escAttr(r.id)}"]' aria-label="${escAttr(_('scaling.edit_named', { name: r.name || r.id }))}">${escHtml(_('scaling.edit'))}</button>
                    <button type="button" class="btn btn-sm btn-danger-quiet" data-bd-call="Scaling.deleteRule" data-bd-args='["${escAttr(r.id)}"]' aria-label="${escAttr(_('scaling.delete_named', { name: r.name || r.id }))}">${escHtml(_('scaling.delete'))}…</button>
                </td>
            </tr>
        `).join('');
    }

    function ruleForm(r) {
        const types = ['subnet', 'group', 'tag', 'country', 'device_id'];
        const cur = r ? r.match_type || 'subnet' : 'subnet';
        const fallback = r ? r.fallback || 'master' : 'master';
        const relayOptions = _relays.map(x =>
            `<option value="${escAttr(x.id)}" ${r && x.id === r.target_relay ? 'selected' : ''}>${escHtml(x.name || x.id)}</option>`
        ).join('');
        return `<form id="rule-form" class="scaling-dialog-form" novalidate>
            <input type="hidden" id="rule-edit-id" value="${escAttr(r ? r.id : '')}">
            ${field('rule-name', 'scaling.col_rule_name', `<input type="text" id="rule-name" class="form-input" maxlength="80" value="${escAttr(r ? r.name || '' : '')}" autocomplete="off">`)}
            ${field('rule-match-type', 'scaling.rule_match_type', `<select id="rule-match-type" class="form-select">${types.map(tp => `<option value="${tp}" ${tp === cur ? 'selected' : ''}>${escHtml(matchTypeLabel(tp))}</option>`).join('')}</select>`)}
            ${field('rule-match-value', 'scaling.rule_match_value', `<input type="text" id="rule-match-value" class="form-input mono" maxlength="200" value="${escAttr(r ? r.match_value || '' : '')}" autocomplete="off" spellcheck="false">`, 'scaling.rule_match_value_hint')}
            ${field('rule-target-relay', 'scaling.col_target_relay', `<select id="rule-target-relay" class="form-select">${relayOptions}</select>`)}
            ${field('rule-fallback', 'scaling.col_fallback', `<select id="rule-fallback" class="form-select">
                <option value="master" ${fallback === 'master' ? 'selected' : ''}>${escHtml(_('scaling.fallback_master'))}</option>
                <option value="nearest" ${fallback === 'nearest' ? 'selected' : ''}>${escHtml(_('scaling.fallback_nearest'))}</option>
            </select>`, 'scaling.rule_fallback_hint')}
            ${field('rule-priority', 'scaling.col_priority', `<input type="number" id="rule-priority" class="form-input is-short" min="0" max="1000" value="${escAttr(r ? r.priority ?? 10 : 10)}">`, 'scaling.rule_priority_hint')}
            <p class="form-status" id="rule-form-status" aria-live="polite"></p>
            <button type="submit" hidden></button>
        </form>`;
    }

    function openRuleDialog(r) {
        if (!_relays.length) {
            notify('warning', _('scaling.rule_needs_relay'));
            return;
        }
        Modal.show({
            title: r ? _('scaling.rule_edit') : _('scaling.rule_add'),
            content: ruleForm(r),
            buttons: [
                { label: _('scaling.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: r ? _('scaling.save') : _('scaling.rule_add'), class: 'btn-primary', onClick: saveRule }
            ]
        });
        document.getElementById('rule-form')?.addEventListener('submit', (e) => { e.preventDefault(); saveRule(); });
    }

    function showAddRule() { openRuleDialog(null); }

    function editRule(id) {
        const r = _rules.find(x => x.id === id);
        if (r) openRuleDialog(r);
    }

    async function saveRule() {
        const id = document.getElementById('rule-edit-id').value;
        const prio = parseInt(document.getElementById('rule-priority').value, 10);
        const body = {
            name: document.getElementById('rule-name').value.trim(),
            match_type: document.getElementById('rule-match-type').value,
            match_value: document.getElementById('rule-match-value').value.trim(),
            target_relay: document.getElementById('rule-target-relay').value,
            fallback: document.getElementById('rule-fallback').value,
            priority: Number.isFinite(prio) ? prio : 10,
        };
        if (!body.name || !body.match_value) {
            formError('rule-form-status', _('scaling.rule_name_value_required'));
            return;
        }
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/panel/scaling/rules/${encodeURIComponent(id)}` : '/api/panel/scaling/rules';
        try {
            const resp = await fetch(url, {
                method,
                credentials: 'same-origin',
                headers: csrfHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                formError('rule-form-status', _('scaling.rule_save_failed_reason', { error: err.error || ('HTTP ' + resp.status) }));
                return;
            }
        } catch (err) {
            formError('rule-form-status', _('scaling.rule_save_failed_reason', { error: (err && err.message) || '' }));
            return;
        }
        Modal.close();
        notify('success', _('scaling.rule_saved_named', { name: body.name }));
        loadRules();
    }

    async function deleteRule(id) {
        const r = _rules.find(x => x.id === id);
        const name = r ? (r.name || r.id) : id;
        const ok = await Modal.confirm({
            title: _('scaling.delete_rule_title', { name }),
            message: _('scaling.confirm_delete_rule'),
            confirmLabel: _('scaling.delete'),
            danger: true
        });
        if (!ok) return;
        try {
            const resp = await fetch(`/api/panel/scaling/rules/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                credentials: 'same-origin',
                headers: csrfHeaders(),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                notify('error', _('scaling.rule_delete_failed_reason', { error: err.error || ('HTTP ' + resp.status) }));
                return;
            }
            notify('success', _('scaling.rule_deleted_named', { name }));
        } catch (err) {
            notify('error', _('scaling.rule_delete_failed_reason', { error: (err && err.message) || '' }));
        }
        loadRules();
    }

    function closeRuleModal() { Modal.close(); }

    // -----------------------------------------------------------------------
    // Capacity
    // -----------------------------------------------------------------------
    async function loadCapacity() {
        try {
            const data = await getJson('/api/panel/scaling/capacity');
            _capacity = data.data || data;
        } catch { _capacity = null; }
        renderCapacityTiers();
        renderCapacityRecommendations();
        renderCapacityTable();
    }

    function meter(p) {
        const v = Math.max(0, Math.min(100, Math.round(p)));
        const cls = v >= 95 ? ' is-full' : (v >= 80 ? ' is-high' : '');
        return `<div class="meter scaling-meter${cls}"><span class="meter-bar"><span class="meter-fill" style="width:${v}%"></span></span><span class="meter-value">${v} %</span></div>`;
    }

    function totals() {
        return {
            devices: _relays.reduce((s, r) => s + (r.connected_devices || 0), 0),
            sessions: _relays.reduce((s, r) => s + (r.active_sessions || 0), 0),
            bandwidth: _relays.reduce((s, r) => s + (r.bandwidth_mbps || 0), 0),
        };
    }

    function renderCapacityTiers() {
        const container = document.getElementById('capacity-tiers');
        if (!container) return;
        const tot = totals();
        const tiers = [
            { key: 'scaling.cap_tier_devices', current: tot.devices, max: _capacity?.max_devices || 500, unit: '' },
            { key: 'scaling.cap_tier_sessions', current: tot.sessions, max: _capacity?.max_sessions || 50, unit: '' },
            { key: 'scaling.cap_tier_bandwidth', current: Math.round(tot.bandwidth * 10) / 10, max: _capacity?.max_bandwidth_mbps || 100, unit: ' Mbps' },
        ];
        container.innerHTML = tiers.map(t => {
            const p = t.max > 0 ? (t.current / t.max) * 100 : 0;
            return `<dt>${escHtml(_(t.key))}</dt>
                <dd>${meter(p)}<span class="cell-sub">${escHtml(_('scaling.cap_of', { current: t.current + t.unit, max: t.max + t.unit }))}</span></dd>`;
        }).join('');
    }

    function renderCapacityRecommendations() {
        const container = document.getElementById('capacity-recommendations');
        if (!container) return;
        const tot = totals();
        const maxDevices = _capacity?.max_devices || 500;
        const maxSessions = _capacity?.max_sessions || 50;
        const recs = [];
        if (_relays.length === 0) recs.push(_('scaling.rec_no_relays'));
        if (tot.devices / maxDevices > 0.8) recs.push(_('scaling.rec_devices_high'));
        if (tot.sessions / maxSessions > 0.8) recs.push(_('scaling.rec_sessions_high'));
        const hot = _relays.filter(r => (r.cpu || 0) > 80).map(r => r.name || r.id);
        if (hot.length) recs.push(_('scaling.rec_cpu_high_named', { names: hot.join(', ') }));
        container.textContent = recs.join(' ');
        container.hidden = recs.length === 0;
    }

    function renderCapacityTable() {
        const tbody = document.getElementById('capacity-tbody');
        if (!tbody) return;
        const tot = totals();
        const tiers = [
            { config: _('scaling.cap_single_sqlite'), maxDev: 200, maxSess: 30 },
            { config: _('scaling.cap_single_pg'), maxDev: 1000, maxSess: 50 },
            { config: _('scaling.cap_master_3'), maxDev: 5000, maxSess: 150 },
            { config: _('scaling.cap_master_10'), maxDev: 20000, maxSess: 500 },
        ];
        tbody.innerHTML = tiers.map(t => `<tr>
                <td>${escHtml(t.config)}</td>
                <td class="num-col">${t.maxDev.toLocaleString()}</td>
                <td class="num-col">${t.maxSess.toLocaleString()}</td>
                <td>${meter(t.maxDev > 0 ? (tot.devices / t.maxDev) * 100 : 0)}</td>
            </tr>`).join('');
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;'); }

    window.Scaling = {
        init, switchTab, loadOverview, loadRelays, loadRules, loadCapacity,
        filterRelays, showAddRelay, editRelay, saveRelay, deleteRelay, closeRelayModal,
        showAddRule, editRule, saveRule, deleteRule, closeRuleModal,
    };

    document.addEventListener('DOMContentLoaded', init);
})();
