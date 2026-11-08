/**
 * BetterDesk Console - Data loss prevention (/dataguard)
 *
 * Two views: the policy table (create, edit, enable/disable, delete) and
 * the event table (what devices reported). Counts sit in a line above
 * each table. The policy editor is a Modal.show() dialog built from the
 * #policy-form-template in the view.
 */

(function () {
    'use strict';

    const tr = (key, params) => {
        if (typeof window._ !== 'function') return key;
        return window._(key, params);
    };
    const t = (key, params) => tr('dataguard.' + key, params);

    const csrfToken = window.BetterDesk?.csrfToken || '';

    async function apiFetch(url, options = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (csrfToken) headers['x-csrf-token'] = csrfToken;
        const resp = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...headers, ...options.headers } });
        const data = await resp.json().catch(() => null);
        if (!resp.ok) {
            throw new Error((data && data.error) || resp.statusText || 'Request failed');
        }
        return data;
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function toast(message, type) {
        if (typeof Notifications !== 'undefined' && Notifications[type]) Notifications[type](message);
    }

    function formatTimeAgo(dateStr) {
        if (!dateStr) return '—';
        if (window.Utils && Utils.formatRelativeTime) return Utils.formatRelativeTime(dateStr, { empty: '—' });
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return '—';
        const diff = Math.max(0, Math.floor((Date.now() - d) / 1000));
        if (diff < 60) return tr('time.seconds_ago', { count: diff });
        if (diff < 3600) return tr('time.minutes_ago', { count: Math.floor(diff / 60) });
        if (diff < 86400) return tr('time.hours_ago', { count: Math.floor(diff / 3600) });
        if (diff < 2592000) return tr('time.days_ago', { count: Math.floor(diff / 86400) });
        return d.toLocaleDateString();
    }

    function formatFull(dateStr) {
        if (window.Utils && Utils.formatDate) return Utils.formatDate(dateStr, { empty: '' });
        const d = new Date(dateStr);
        return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
    }

    const ACTIONS = ['block', 'log', 'allow'];
    const TYPES = ['usb', 'file_type', 'clipboard', 'screen_share', 'file_transfer'];

    function actionLabel(a) {
        return ACTIONS.includes(a) ? t('action_' + a) : (a || '—');
    }

    function typeLabel(type) {
        return TYPES.includes(type) ? t('type_' + type) : (type || '—');
    }

    function isEnabled(p) {
        return p.enabled === true || p.enabled === 1 || p.enabled === '1';
    }

    // Put a bold number into a translated sentence: "{count} policies, ..."
    function countSentence(key, params, boldKey) {
        const marker = '\u0000';
        const text = t(key, { ...params, [boldKey]: marker });
        return escapeHtml(text).replace(marker, `<strong>${escapeHtml(params[boldKey])}</strong>`);
    }

    // ---- Tabs ----
    const tabs = Array.from(document.querySelectorAll('.dg-views [role="tab"]'));

    function selectTab(btn, focus) {
        tabs.forEach(b => {
            const on = b === btn;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
            b.tabIndex = on ? 0 : -1;
            const panel = document.getElementById('tab-' + b.dataset.tab);
            if (panel) {
                panel.classList.toggle('active', on);
                panel.hidden = !on;
            }
        });
        if (focus) btn.focus();
        if (btn.dataset.tab === 'policies') loadPolicies();
        else if (btn.dataset.tab === 'events') loadEvents();
    }

    tabs.forEach((btn, i) => {
        btn.addEventListener('click', () => selectTab(btn, false));
        btn.addEventListener('keydown', (e) => {
            const rtl = document.documentElement.dir === 'rtl';
            let next = null;
            if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = tabs[(i + 1) % tabs.length];
            else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = tabs[(i - 1 + tabs.length) % tabs.length];
            else if (e.key === 'Home') next = tabs[0];
            else if (e.key === 'End') next = tabs[tabs.length - 1];
            if (next) { e.preventDefault(); selectTab(next, true); }
        });
    });

    // ==== Policies ====

    const policiesBody = document.getElementById('policies-body');
    const policyCount = document.getElementById('dg-policy-count');
    const createBtn = document.getElementById('create-policy-btn');
    const policySearch = document.getElementById('policy-search');
    const formTemplate = document.getElementById('policy-form-template');
    let allPolicies = [];
    let eventCounts = null;          // policy id -> number of events, null = unknown

    function policyState(html) {
        policiesBody.closest('table').classList.add('is-empty');
        policiesBody.innerHTML = `<tr><td colspan="7" class="state-cell">${html}</td></tr>`;
    }

    async function loadPolicies() {
        if (!allPolicies.length) policyState(escapeHtml(t('loading_policies')));
        try {
            const data = await apiFetch('/api/dataguard/policies');
            allPolicies = Array.isArray(data) ? data : [];
            filterPolicies();
            loadEventCounts();
        } catch (err) {
            policyCount.textContent = '';
            policyState(`<span class="text-danger">${escapeHtml(t('load_policies_failed'))}</span>
                <button type="button" class="btn btn-sm dg-retry-policies">${escapeHtml(tr('actions.retry'))}</button>`);
            policiesBody.querySelector('.dg-retry-policies')?.addEventListener('click', loadPolicies);
        }
    }

    // Events per policy, for the "Events" column. Needs the audit permission;
    // without it the column shows a dash.
    async function loadEventCounts() {
        try {
            const events = await apiFetch('/api/dataguard/events');
            eventCounts = {};
            (Array.isArray(events) ? events : []).forEach(e => {
                if (e.policy_id == null) return;
                eventCounts[e.policy_id] = (eventCounts[e.policy_id] || 0) + 1;
            });
        } catch (_e) {
            eventCounts = null;
        }
        filterPolicies();
    }

    function renderPolicyCount() {
        const n = allPolicies.length;
        if (!n) { policyCount.textContent = ''; return; }
        const enabled = allPolicies.filter(isEnabled).length;
        policyCount.innerHTML = countSentence(n === 1 ? 'policy_count_one' : 'policy_count_many', { count: n, enabled }, 'count');
    }

    function filterPolicies() {
        renderPolicyCount();
        const q = policySearch.value.trim().toLowerCase();
        const filtered = q
            ? allPolicies.filter(p => [p.name, p.description, p.scope, typeLabel(p.policy_type || p.type)]
                .join(' ').toLowerCase().includes(q))
            : allPolicies;
        renderPolicies(filtered, !!q);
    }

    function renderPolicies(policies, filtered) {
        if (!policies.length) {
            policyState(escapeHtml(filtered ? t('empty_policies_filtered') : t('empty_policies')));
            return;
        }
        policiesBody.closest('table').classList.remove('is-empty');
        policiesBody.innerHTML = policies.map((p) => {
            const id = escapeHtml(p.id);
            const on = isEnabled(p);
            const count = eventCounts ? (eventCounts[p.id] || 0) : null;
            return `
            <tr data-id="${id}">
                <td>
                    <span class="dg-name">${escapeHtml(p.name)}</span>
                    ${p.description ? `<span class="cell-sub">${escapeHtml(p.description)}</span>` : ''}
                </td>
                <td>${escapeHtml(typeLabel(p.policy_type || p.type))}</td>
                <td>${escapeHtml(actionLabel(p.action))}</td>
                <td class="dg-scope">${p.scope ? `<span class="mono">${escapeHtml(p.scope)}</span>` : escapeHtml(t('scope_all'))}</td>
                <td><span class="status ${on ? 'active' : 'offline'}">${escapeHtml(on ? t('enabled') : t('disabled'))}</span></td>
                <td class="num-col">${count === null ? '<span class="text-muted">—</span>' : escapeHtml(count)}</td>
                <td class="actions">
                    <button type="button" class="btn btn-sm edit-btn" data-id="${id}"
                        aria-label="${escapeHtml(t('edit_named', { name: p.name }))}">${escapeHtml(tr('common.edit'))}</button>
                </td>
            </tr>`;
        }).join('');
    }

    policiesBody.addEventListener('click', (e) => {
        const edit = e.target.closest('.edit-btn');
        if (edit) editPolicy(edit.dataset.id);
    });

    function rulesText(p) {
        if (!p || p.rules === undefined || p.rules === null) return '';
        if (typeof p.rules === 'string') return p.rules;
        if (Array.isArray(p.rules) && p.rules.length === 0) return '';
        return JSON.stringify(p.rules, null, 2);
    }

    function openPolicyModal(p) {
        Modal.show({
            title: p ? t('edit_policy') : t('create_policy'),
            content: formTemplate.innerHTML,
            buttons: [
                // Delete sits apart on the start side of the footer
                ...(p ? [{ label: t('delete_policy'), class: 'btn-danger-quiet del-btn', onClick: () => deletePolicy(p) }] : []),
                { label: tr('common.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: p ? t('save_policy') : t('create_policy'), class: 'btn-primary', onClick: () => savePolicy() },
            ],
        });
        document.getElementById('policy-id').value = p ? p.id : '';
        document.getElementById('policy-name').value = p ? p.name || '' : '';
        document.getElementById('policy-desc').value = p ? p.description || '' : '';
        const type = p ? (p.policy_type || p.type) : 'usb';
        document.getElementById('policy-type').value = TYPES.includes(type) ? type : 'usb';
        const action = p && ACTIONS.includes(p.action) ? p.action : 'log';
        const radio = document.querySelector(`#policy-action input[value="${action}"]`);
        if (radio) radio.checked = true;
        document.getElementById('policy-scope').value = p ? p.scope || '' : '';
        document.getElementById('policy-rules').value = rulesText(p);
        document.getElementById('policy-advanced').open = !!rulesText(p);
        document.getElementById('policy-enabled').checked = p ? isEnabled(p) : true;
        document.getElementById('policy-form').addEventListener('submit', (e) => { e.preventDefault(); savePolicy(); });
        document.getElementById('policy-name').focus();
    }

    async function editPolicy(id) {
        try {
            const p = await apiFetch(`/api/dataguard/policies/${encodeURIComponent(id)}`);
            openPolicyModal(p);
        } catch (err) {
            toast(`${t('load_policy_failed')} ${err.message}`, 'error');
        }
    }

    function formError(message, field) {
        const status = document.getElementById('policy-form-status');
        if (status) status.textContent = message;
        if (field) {
            field.setAttribute('aria-invalid', 'true');
            field.focus();
        }
    }

    let saving = false;
    async function savePolicy() {
        if (saving) return;
        const nameEl = document.getElementById('policy-name');
        const rulesEl = document.getElementById('policy-rules');
        if (!nameEl) return;
        nameEl.removeAttribute('aria-invalid');
        rulesEl.removeAttribute('aria-invalid');
        formError('');

        const id = document.getElementById('policy-id').value;
        let rules;
        try {
            const raw = rulesEl.value.trim();
            rules = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(rules)) throw new Error('not an array');
        } catch (_e) {
            document.getElementById('policy-advanced').open = true;
            formError(t('invalid_rules'), rulesEl);
            return;
        }

        const checked = document.querySelector('#policy-action input:checked');
        const body = {
            name: nameEl.value.trim(),
            description: document.getElementById('policy-desc').value.trim(),
            policy_type: document.getElementById('policy-type').value,
            action: checked ? checked.value : 'log',
            scope: document.getElementById('policy-scope').value.trim() || null,
            rules,
            enabled: document.getElementById('policy-enabled').checked,
        };

        if (!body.name) { formError(t('name_required'), nameEl); return; }

        saving = true;
        try {
            const url = id ? `/api/dataguard/policies/${encodeURIComponent(id)}` : '/api/dataguard/policies';
            await apiFetch(url, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
            Modal.close();
            toast(id ? t('policy_saved', { name: body.name }) : t('policy_created', { name: body.name }), 'success');
            loadPolicies();
        } catch (err) {
            formError(`${t('save_failed')} ${err.message}`);
        } finally {
            saving = false;
        }
    }

    // Called from the edit dialog. Cancelling the confirmation goes back to the dialog.
    async function deletePolicy(p) {
        const ok = await Modal.confirm({
            title: t('delete_policy'),
            message: t('delete_confirm_message', { name: p.name }),
            confirmLabel: t('delete_policy'),
            danger: true,
        });
        if (!ok) {
            openPolicyModal(p);
            return;
        }
        try {
            await apiFetch(`/api/dataguard/policies/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
            toast(t('policy_deleted', { name: p.name }), 'success');
            // The row and its dialog are gone; keep focus on the page
            createBtn.focus();
            loadPolicies();
        } catch (err) {
            toast(`${t('delete_failed')} ${err.message}`, 'error');
        }
    }

    createBtn.addEventListener('click', () => openPolicyModal(null));
    policySearch.addEventListener('input', filterPolicies);

    // ==== Events ====

    const eventsBody = document.getElementById('events-body');
    const eventCount = document.getElementById('dg-event-count');
    const eventSearch = document.getElementById('event-search');
    let allEvents = [];
    let eventsLoaded = false;
    let eventActionFilter = '';

    function eventState(html) {
        eventsBody.closest('table').classList.add('is-empty');
        eventsBody.innerHTML = `<tr><td colspan="5" class="state-cell">${html}</td></tr>`;
    }

    async function loadEvents() {
        if (!eventsLoaded) eventState(escapeHtml(t('loading_events')));
        try {
            const data = await apiFetch('/api/dataguard/events');
            allEvents = Array.isArray(data) ? data : [];
            eventsLoaded = true;
            filterEvents();
        } catch (err) {
            eventCount.textContent = '';
            eventState(`<span class="text-danger">${escapeHtml(t('load_events_failed'))}</span>
                <button type="button" class="btn btn-sm dg-retry-events">${escapeHtml(tr('actions.retry'))}</button>`);
            eventsBody.querySelector('.dg-retry-events')?.addEventListener('click', loadEvents);
        }
    }

    function detailText(e) {
        if (e.details === null || e.details === undefined || e.details === '') return '';
        if (typeof e.details === 'object') {
            return Object.keys(e.details).length ? JSON.stringify(e.details) : '';
        }
        return String(e.details);
    }

    // The total in the count line; blocked, logged and allowed as a share bar
    // with their numbers in the legend
    const eventBar = document.getElementById('dg-event-bar');
    const eventLegend = document.getElementById('dg-event-legend');

    function renderEventCount() {
        const n = allEvents.length;
        eventBar.textContent = '';
        eventLegend.textContent = '';
        eventBar.hidden = !n;
        eventLegend.hidden = !n;
        if (!n) { eventCount.textContent = ''; return; }
        eventCount.innerHTML = countSentence(n === 1 ? 'event_total_one' : 'event_total_many', { count: n }, 'count');
        const fmt = new Intl.NumberFormat((window.BetterDesk && window.BetterDesk.lang) || undefined);
        [
            { action: 'block', cls: 'is-danger', label: t('legend_blocked') },
            { action: 'log', cls: 'is-warning', label: t('legend_logged') },
            { action: 'allow', cls: 'is-muted', label: t('legend_allowed') },
        ].forEach(part => {
            const count = allEvents.filter(e => e.action === part.action).length;
            if (count > 0) {
                const seg = document.createElement('span');
                seg.className = part.cls;
                seg.style.flexGrow = String(count);
                eventBar.appendChild(seg);
            }
            const li = document.createElement('li');
            li.innerHTML = `<span class="key ${part.cls}" aria-hidden="true"></span><span><strong>${escapeHtml(fmt.format(count))}</strong> ${escapeHtml(part.label)}</span>`;
            eventLegend.appendChild(li);
        });
    }

    function filterEvents() {
        renderEventCount();
        const q = eventSearch.value.trim().toLowerCase();
        let filtered = allEvents;
        if (eventActionFilter) filtered = filtered.filter(e => e.action === eventActionFilter);
        if (q) {
            filtered = filtered.filter(e => [e.device_id, e.policy_name, detailText(e)].join(' ').toLowerCase().includes(q));
        }
        renderEvents(filtered, !!(q || eventActionFilter));
    }

    function renderEvents(events, filtered) {
        if (!events.length) {
            eventState(escapeHtml(filtered ? t('empty_events_filtered') : t('empty_events')));
            return;
        }
        eventsBody.closest('table').classList.remove('is-empty');
        eventsBody.innerHTML = events.map(e => {
            const detail = detailText(e);
            return `
            <tr>
                <td class="dg-time"><time datetime="${escapeHtml(e.created_at || '')}" title="${escapeHtml(formatFull(e.created_at))}">${escapeHtml(formatTimeAgo(e.created_at))}</time></td>
                <td>${e.device_id ? `<span class="mono">${escapeHtml(e.device_id)}</span>` : '—'}</td>
                <td>${escapeHtml(e.policy_name || '—')}</td>
                <td>${escapeHtml(actionLabel(e.action))}</td>
                <td class="dg-detail">${detail ? escapeHtml(detail) : '—'}</td>
            </tr>`;
        }).join('');
    }

    document.querySelectorAll('#event-action-filter .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#event-action-filter .filter-btn').forEach(b => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
            });
            eventActionFilter = btn.dataset.action;
            filterEvents();
        });
    });

    eventSearch.addEventListener('input', filterEvents);

    // ---- Init ----
    loadPolicies();
})();
