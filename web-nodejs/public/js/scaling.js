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
        loadDiagram();
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

    // Show only what applies: no search without relay servers, and no rules
    // table or "Add rule" until there is a relay server to point a rule to
    function applyAvailability() {
        const none = _relaysLoaded && _relays.length === 0;
        const toolbar = document.getElementById('relay-toolbar');
        if (toolbar) toolbar.hidden = !_relaysLoaded || none;
        const addRule = document.getElementById('rule-add-btn');
        if (addRule) addRule.hidden = none;
        const folded = none && _rulesLoaded && _rules.length === 0;
        const note = document.getElementById('rules-need-relay');
        if (note) note.hidden = !folded;
        const list = document.getElementById('rules-list');
        if (list) list.hidden = folded;
    }

    function renderCount() {
        applyAvailability();
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
            return U.statusHtml('neutral', _('scaling.status_unknown'));
        }
        const tone = status === 'online' ? 'good' : status === 'degraded' ? 'warning' : 'neutral';
        const usage = _('scaling.relay_usage', {
            devices: r.connected_devices || 0,
            sessions: r.active_sessions || 0,
            bandwidth: (r.bandwidth_mbps || 0).toFixed(1),
            cpu: r.cpu || 0,
            memory: r.memory || 0
        });
        return `${U.statusHtml(tone, _('scaling.status_' + status))}<span class="cell-sub">${escHtml(usage)}</span>`;
    }

    function renderRelaysTable() {
        const tbody = document.getElementById('relays-tbody');
        if (!tbody) return;
        if (_relays.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="state-cell">${escHtml(_('scaling.no_relays'))} <button type="button" class="btn btn-sm" data-bd-call="Scaling.showAddRelay">${window.Utils && Utils.icon ? Utils.icon('add') : ''}${escHtml(_('scaling.relay_add'))}</button></td></tr>`;
            return;
        }
        tbody.innerHTML = _relays.map(r => `
            <tr data-id="${escAttr(r.id)}">
                <td><strong>${escHtml(r.name || r.id)}</strong>${r.location ? `<span class="cell-sub">${escHtml(r.location)}</span>` : ''}</td>
                <td>${U.valueHtml(r.address, { copy: true, label: r.name || r.address })}</td>
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

    // A string added with the sheets: English until the language files are reloaded
    function tx(key, fallback, vars) {
        const v = _(key, vars);
        if (v && v !== key) return v;
        return String(fallback).replace(/\{(\w+)\}/g, (m, p) => (vars && vars[p] !== undefined ? vars[p] : m));
    }

    // One field: label above, hint under it (linked with aria-describedby). hint is a key or { text }
    function field(id, labelKey, input, hint) {
        const hintText = hint ? (typeof hint === 'object' ? hint.text : _(hint)) : '';
        const linked = hintText ? input.replace(/^<(input|select|textarea)\b/, `<$1 aria-describedby="${id}-hint"`) : input;
        return `<div class="form-group">
            <label class="form-label" for="${id}">${escHtml(_(labelKey))}</label>
            ${linked}
            ${hintText ? `<p class="form-hint" id="${id}-hint">${escHtml(hintText)}</p>` : ''}
        </div>`;
    }

    function section(id, title, body) {
        return `<section class="form-section" aria-labelledby="${id}">
            <h3 class="form-section-title" id="${id}">${escHtml(title)}</h3>
            ${body}
        </section>`;
    }

    // A refused or failed save: in the sheet's status line, next to the buttons
    function sheetError(message, fieldId) {
        Modal.setStatus(message, 'error');
        const el = fieldId && document.getElementById(fieldId);
        if (el) {
            el.setAttribute('aria-invalid', 'true');
            el.focus();
        }
    }

    // Enter in a field saves; a change clears the last result
    function wireSheetForm(formId, save) {
        const form = document.getElementById(formId);
        if (!form) return;
        form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
        form.addEventListener('input', (e) => {
            if (e.target && e.target.removeAttribute) e.target.removeAttribute('aria-invalid');
            Modal.setStatus('');
        });
    }

    // Saving state of the sheet's primary button: a second click or Enter does nothing meanwhile
    function sheetBusy(btnId, busy) {
        const btn = document.getElementById(btnId);
        if (btn) btn.disabled = busy;
    }

    function relayForm(r) {
        return `<form id="relay-form" class="scaling-dialog-form form-stack" novalidate>
            <input type="hidden" id="relay-edit-id" value="${escAttr(r ? r.id : '')}">
            ${field('relay-name', 'scaling.col_name', `<input type="text" id="relay-name" class="form-input is-host" maxlength="80" required value="${escAttr(r ? r.name || '' : '')}" autocomplete="off">`, 'scaling.relay_name_hint')}
            ${field('relay-address', 'scaling.col_address', `<input type="text" id="relay-address" class="form-input mono is-host" required value="${escAttr(r ? r.address || '' : '')}" autocomplete="off" spellcheck="false">`, 'scaling.relay_address_hint')}
            ${field('relay-location', 'scaling.col_location', `<input type="text" id="relay-location" class="form-input is-host" maxlength="80" value="${escAttr(r ? r.location || '' : '')}" autocomplete="off">`, 'scaling.relay_location_hint')}
            ${section('relay-section-limits', _('scaling.col_limits'),
                `<p class="form-hint" id="relay-limits-note">${escHtml(_('scaling.relay_limits_hint'))}</p>`
                + field('relay-max-sessions', 'scaling.relay_max_sessions', `<input type="number" id="relay-max-sessions" class="form-input is-short" min="1" aria-describedby="relay-limits-note" value="${escAttr(r ? r.max_sessions || 50 : 50)}">`)
                + field('relay-max-bw', 'scaling.relay_max_bandwidth', `<input type="number" id="relay-max-bw" class="form-input is-short" min="1" aria-describedby="relay-limits-note" value="${escAttr(r ? r.max_bandwidth_mbps || 100 : 100)}">`))}
            <button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
        </form>`;
    }

    function openRelayDialog(r) {
        Modal.sheet({
            title: r ? _('scaling.relay_edit') : _('scaling.relay_add'),
            subtitle: tx('scaling.relay_sheet_desc', 'A relay server carries remote sessions when two devices can\'t connect directly.'),
            content: relayForm(r),
            status: true,
            buttons: [
                { label: _('scaling.cancel'), class: 'btn-secondary', start: true, onClick: () => Modal.close() },
                { label: r ? _('scaling.save') : _('scaling.relay_add'), class: 'btn-primary', id: 'relay-save-btn', onClick: saveRelay }
            ]
        });
        wireSheetForm('relay-form', saveRelay);
    }

    function showAddRelay() { openRelayDialog(null); }

    function editRelay(id) {
        const r = _relays.find(x => x.id === id);
        if (r) openRelayDialog(r);
    }

    // In the open sheet's status line (fieldId: the field to mark), else a toast
    function formError(fieldId, message) {
        if (document.querySelector('#modal-container [data-modal-status]')) sheetError(message, fieldId);
        else notify('error', message);
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
            formError(body.name ? 'relay-address' : 'relay-name', _('scaling.relay_name_address_required'));
            return;
        }
        if (document.getElementById('relay-save-btn')?.disabled) return;
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/panel/scaling/relays/${encodeURIComponent(id)}` : '/api/panel/scaling/relays';
        Modal.setStatus(tx('scaling.saving', 'Saving…'));
        sheetBusy('relay-save-btn', true);
        try {
            const resp = await fetch(url, {
                method,
                credentials: 'same-origin',
                headers: csrfHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                formError(null, _('scaling.relay_save_failed_reason', { error: err.error || ('HTTP ' + resp.status) }));
                return;
            }
        } catch (err) {
            formError(null, _('scaling.relay_save_failed_reason', { error: (err && err.message) || '' }));
            return;
        } finally {
            sheetBusy('relay-save-btn', false);
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
                <td class="num-col is-num">${escHtml(U.formatNumber(r.priority || 0))}</td>
                <td><strong>${escHtml(r.name || r.id)}</strong></td>
                <td>${U.tagHtml(matchTypeLabel(r.match_type || ''))} ${U.valueHtml(r.match_value)}</td>
                <td>${escHtml(r.target_relay_name || relayName(r.target_relay))}</td>
                <td>${escHtml(_('scaling.fallback_' + (r.fallback || 'master')))}</td>
                <td>${U.booleanHtml(r.enabled !== false, { on: _('scaling.status_enabled'), off: _('scaling.status_disabled') })}</td>
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
        return `<form id="rule-form" class="scaling-dialog-form form-stack" novalidate>
            <input type="hidden" id="rule-edit-id" value="${escAttr(r ? r.id : '')}">
            ${field('rule-name', 'scaling.col_rule_name', `<input type="text" id="rule-name" class="form-input is-host" maxlength="80" required value="${escAttr(r ? r.name || '' : '')}" autocomplete="off">`)}
            ${field('rule-priority', 'scaling.col_priority', `<input type="number" id="rule-priority" class="form-input is-short" min="0" max="1000" value="${escAttr(r ? r.priority ?? 10 : 10)}">`, 'scaling.rule_priority_hint')}
            ${section('rule-section-match', tx('scaling.rule_section_match', 'Which devices'),
                field('rule-match-type', 'scaling.rule_match_type', `<select id="rule-match-type" class="form-select is-medium" aria-controls="rule-match-value-hint">${types.map(tp => `<option value="${tp}" ${tp === cur ? 'selected' : ''}>${escHtml(matchTypeLabel(tp))}</option>`).join('')}</select>`)
                + field('rule-match-value', 'scaling.rule_match_value', `<input type="text" id="rule-match-value" class="form-input mono is-host" maxlength="200" required value="${escAttr(r ? r.match_value || '' : '')}" autocomplete="off" spellcheck="false">`, { text: matchValueHint(cur) }))}
            ${section('rule-section-relay', tx('scaling.rule_section_relay', 'Where they connect'),
                field('rule-target-relay', 'scaling.col_target_relay', `<select id="rule-target-relay" class="form-select is-host">${relayOptions}</select>`)
                + field('rule-fallback', 'scaling.col_fallback', `<select id="rule-fallback" class="form-select is-host">
                <option value="master" ${fallback === 'master' ? 'selected' : ''}>${escHtml(_('scaling.fallback_master'))}</option>
                <option value="nearest" ${fallback === 'nearest' ? 'selected' : ''}>${escHtml(_('scaling.fallback_nearest'))}</option>
            </select>`, 'scaling.rule_fallback_hint'))}
            <button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
        </form>`;
    }

    // What to type for each kind of match
    function matchValueHint(type) {
        const hints = {
            subnet: ['scaling.rule_match_value_hint', 'For a subnet, for example 192.168.1.0/24.'],
            group: ['scaling.rule_match_hint_group', 'The name of a device group.'],
            tag: ['scaling.rule_match_hint_tag', 'One tag, as it is set on the devices.'],
            country: ['scaling.rule_match_hint_country', 'The country the devices connect from.'],
            device_id: ['scaling.rule_match_hint_device_id', 'One device ID.']
        };
        const [key, fallback] = hints[type] || hints.subnet;
        return tx(key, fallback);
    }

    function openRuleDialog(r) {
        if (!_relays.length) {
            notify('warning', _('scaling.rule_needs_relay'));
            return;
        }
        Modal.sheet({
            title: r ? _('scaling.rule_edit') : _('scaling.rule_add'),
            subtitle: tx('scaling.rule_sheet_desc', 'Sends the devices that match to one relay server. Rules are checked by priority, lowest number first.'),
            content: ruleForm(r),
            status: true,
            buttons: [
                { label: _('scaling.cancel'), class: 'btn-secondary', start: true, onClick: () => Modal.close() },
                { label: r ? _('scaling.save') : _('scaling.rule_add'), class: 'btn-primary', id: 'rule-save-btn', onClick: saveRule }
            ]
        });
        wireSheetForm('rule-form', saveRule);
        // The hint under the value follows the kind of match
        document.getElementById('rule-match-type')?.addEventListener('change', (e) => {
            const hint = document.getElementById('rule-match-value-hint');
            if (hint) hint.textContent = matchValueHint(e.target.value);
        });
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
            formError(body.name ? 'rule-match-value' : 'rule-name', _('scaling.rule_name_value_required'));
            return;
        }
        if (document.getElementById('rule-save-btn')?.disabled) return;
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/panel/scaling/rules/${encodeURIComponent(id)}` : '/api/panel/scaling/rules';
        Modal.setStatus(tx('scaling.saving', 'Saving…'));
        sheetBusy('rule-save-btn', true);
        try {
            const resp = await fetch(url, {
                method,
                credentials: 'same-origin',
                headers: csrfHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                formError(null, _('scaling.rule_save_failed_reason', { error: err.error || ('HTTP ' + resp.status) }));
                return;
            }
        } catch (err) {
            formError(null, _('scaling.rule_save_failed_reason', { error: (err && err.message) || '' }));
            return;
        } finally {
            sheetBusy('rule-save-btn', false);
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
        return `<div class="meter scaling-meter${cls}"><span class="meter-bar"><span class="meter-fill" style="width:${v}%"></span></span><span class="meter-value">${escHtml(U.formatPercent(v))}</span></div>`;
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
        // Without relay servers there is nothing to add up: the sentence below says so
        const none = _relays.length === 0;
        container.hidden = none;
        const note = document.getElementById('capacity-note');
        if (note) note.hidden = none;
        const tot = totals();
        const tiers = [
            { key: 'scaling.cap_tier_devices', current: tot.devices, max: _capacity?.max_devices || 500, unit: '' },
            { key: 'scaling.cap_tier_sessions', current: tot.sessions, max: _capacity?.max_sessions || 50, unit: '' },
            { key: 'scaling.cap_tier_bandwidth', current: Math.round(tot.bandwidth * 10) / 10, max: _capacity?.max_bandwidth_mbps || 100, unit: ' Mbps' },
        ];
        container.innerHTML = tiers.map(t => {
            const p = t.max > 0 ? (t.current / t.max) * 100 : 0;
            return `<dt>${escHtml(_(t.key))}</dt>
                <dd>${meter(p)}<span class="cell-sub">${escHtml(_('scaling.cap_of', { current: U.formatNumber(t.current) + t.unit, max: U.formatNumber(t.max) + t.unit }))}</span></dd>`;
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
                <td class="num-col is-num">${escHtml(U.formatNumber(t.maxDev))}</td>
                <td class="num-col is-num">${escHtml(U.formatNumber(t.maxSess))}</td>
                <td>${meter(t.maxDev > 0 ? (tot.devices / t.maxDev) * 100 : 0)}</td>
            </tr>`).join('');
    }

    // -----------------------------------------------------------------------
    // How a connection works: the addresses clients get right now
    // -----------------------------------------------------------------------
    // "host:port" -> { host, port }; bare IPv6 addresses keep their colons
    function splitHostPort(value, fallbackPort) {
        const v = String(value || '').trim();
        const m = v.match(/^\[?([^\]]+?)\]?:(\d{1,5})$/);
        if (m && (v.startsWith('[') || v.indexOf(':') === v.lastIndexOf(':'))) return { host: m[1], port: Number(m[2]) };
        return { host: v, port: fallbackPort };
    }

    async function loadDiagram() {
        const el = document.getElementById('scaling-diagram');
        if (!el || !window.UiDiagram) return;
        try {
            const [cfg, mode] = await Promise.all([
                getJson('/api/dashboard/client-config'),
                getJson('/api/settings/connection-mode').catch(() => null),
            ]);
            const c = cfg.data || cfg;
            const m = mode ? (mode.data || mode) : {};
            const runtime = m.runtime || {};
            // The ID server hands out RELAY_SERVERS when it is set; otherwise clients use their own relay setting
            const relayRaw = String(runtime.relay_servers || '').split(',').map(x => x.trim()).filter(Boolean)[0] || c.relay_server;
            const id = splitHostPort(c.server_id, 21116);
            const relay = splitHostPort(relayRaw || c.server_id, 21117);
            const relayOnly = m.mode === 'relay_only' || runtime.always_use_relay === true;
            window.UiDiagram.connection(el, {
                idServer: id.host, idPort: id.port,
                relay: relay.host, relayPort: relay.port,
                mode: relayOnly ? 'relay-only' : 'direct-first',
            });
        } catch (err) {
            el.innerHTML = `<p class="state is-error">${escHtml(_('scaling.diagram_error'))} <button type="button" class="btn btn-sm" id="scaling-diagram-retry">${escHtml(_('actions.retry'))}</button></p>`;
            document.getElementById('scaling-diagram-retry')?.addEventListener('click', () => {
                el.innerHTML = `<p class="state">${escHtml(_('scaling.diagram_loading'))}</p>`;
                loadDiagram();
            });
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    const U = {
        statusHtml: (tone, label) => (window.Utils && Utils.statusHtml ? Utils.statusHtml(tone, label) : `<span class="status is-${tone}">${escHtml(label)}</span>`),
        booleanHtml: (v, o) => (window.Utils && Utils.booleanHtml ? Utils.booleanHtml(v, o) : escHtml(v ? o.on : o.off)),
        tagHtml: (label) => (window.Utils && Utils.tagHtml ? Utils.tagHtml(label) : escHtml(label)),
        valueHtml: (v, o) => (window.Utils && Utils.valueHtml ? Utils.valueHtml(v, o) : `<span class="mono">${escHtml(v || '–')}</span>`),
        formatNumber: (n) => (window.Utils && Utils.formatNumber ? Utils.formatNumber(n) : String(n)),
        formatPercent: (n) => (window.Utils && Utils.formatPercent ? Utils.formatPercent(n) : n + ' %'),
    };
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;'); }

    window.Scaling = {
        init, switchTab, loadOverview, loadRelays, loadRules, loadCapacity,
        filterRelays, showAddRelay, editRelay, saveRelay, deleteRelay, closeRelayModal,
        showAddRule, editRule, saveRule, deleteRule, closeRuleModal,
    };

    document.addEventListener('DOMContentLoaded', init);
})();
