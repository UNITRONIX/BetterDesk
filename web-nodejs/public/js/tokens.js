/**
 * BetterDesk Console - Device tokens (/tokens)
 *
 * Enrollment mode (saved on change), the token list with search and status
 * filter, and the create / bulk / edit / revoke dialogs. A new token's value
 * is shown once, in a dialog with copy fields.
 */
(function () {
    'use strict';

    const _ = (key, vars) => (typeof window._ === 'function' ? window._(key, vars) : key);

    let allTokens = [];
    let currentFilter = 'all';
    let loadError = null;
    let currentMode = '';
    const csrfToken = window.BetterDesk?.csrfToken || '';

    // ── Helpers ──────────────────────────────────────────────────────────

    const esc = (str) => Utils.escapeHtml(str == null ? '' : String(str));

    function relative(dateStr) {
        return Utils.formatRelativeTime(dateStr, { empty: '–' });
    }

    /** "in 3 days" / "3 days ago": expiry can be in the future */
    function expiryText(dateStr) {
        if (!dateStr) return _('tokens.never');
        const date = new Date(dateStr);
        if (Number.isNaN(date.getTime())) return '–';
        return Utils.formatDate(date);
    }

    async function apiFetch(url, opts = {}) {
        const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
        if (csrfToken) headers['x-csrf-token'] = csrfToken;
        const res = await fetch(url, { ...opts, headers, credentials: 'same-origin' });
        let data = null;
        try { data = await res.json(); } catch (_e) { data = null; }
        if (res.status === 403) throw new Error(Utils.permissionDeniedMessage());
        if (!res.ok || (data && data.success === false)) {
            throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
        }
        return data || {};
    }

    function isExpired(t) {
        return t.status === 'pending' && t.expires_at && new Date(t.expires_at) < new Date();
    }

    /** One status word per token: not used yet, used, expired, revoked */
    function statusOf(t) {
        if (t.status === 'revoked') return { key: 'revoked', cls: 'offline', label: _('tokens.status_revoked') };
        if (t.status === 'expired' || isExpired(t)) return { key: 'expired', cls: 'warning', label: _('tokens.status_expired') };
        if (t.status === 'active') return { key: 'active', cls: 'ok', label: _('tokens.status_used') };
        return { key: 'pending', cls: 'pending', label: _('tokens.status_pending') };
    }

    // ── Data ─────────────────────────────────────────────────────────────

    async function loadTokens() {
        try {
            const res = await apiFetch('/api/panel/tokens?include_revoked=true');
            allTokens = (res.data && Array.isArray(res.data.tokens)) ? res.data.tokens : [];
            loadError = null;
        } catch (err) {
            allTokens = [];
            loadError = err.message;
        }
        renderTokens();
    }

    async function loadEnrollmentMode() {
        const status = document.getElementById('enrollment-mode-status');
        try {
            const res = await apiFetch('/api/panel/enrollment/mode');
            currentMode = (res.data && res.data.mode) || 'open';
            const radio = document.querySelector(`input[name="enrollment_mode"][value="${currentMode}"]`);
            if (radio) radio.checked = true;
            if (status) { status.textContent = ''; status.className = 'form-status'; }
        } catch (err) {
            if (status) {
                status.textContent = `${_('tokens.mode_load_failed')} ${err.message}`;
                status.className = 'form-status is-error';
            }
        }
    }

    // ── Rendering ────────────────────────────────────────────────────────

    function renderCount() {
        const el = document.getElementById('tokens-count');
        if (!el) return;
        if (loadError || !allTokens.length) { el.textContent = ''; return; }
        const counts = { pending: 0, active: 0, expired: 0, revoked: 0 };
        allTokens.forEach((t) => { counts[statusOf(t).key] += 1; });
        const parts = [
            _('tokens.count_pending', { count: counts.pending }),
            _('tokens.count_used', { count: counts.active }),
        ];
        if (counts.expired) parts.push(_('tokens.count_expired', { count: counts.expired }));
        if (counts.revoked) parts.push(_('tokens.count_revoked', { count: counts.revoked }));
        el.innerHTML = `<strong>${allTokens.length}</strong> ${esc(_('tokens.count_total'))}: ${esc(parts.join(', '))}`;
    }

    function renderTokens() {
        const tbody = document.getElementById('tokens-body');
        if (!tbody) return;
        renderCount();

        if (loadError) {
            tbody.innerHTML = `<tr><td colspan="7" class="state-cell"><span class="state is-error">${esc(_('tokens.load_failed'))} ${esc(loadError)}
                <button type="button" class="btn btn-sm" data-token-action="reload">${esc(_('actions.retry'))}</button></span></td></tr>`;
            return;
        }

        const search = (document.getElementById('token-search')?.value || '').trim().toLowerCase();
        let filtered = allTokens;
        if (currentFilter !== 'all') {
            filtered = filtered.filter((t) => {
                const key = statusOf(t).key;
                // Expired tokens were never used, so they sit with "not used yet"
                return currentFilter === 'pending' ? (key === 'pending' || key === 'expired') : key === currentFilter;
            });
        }
        if (search) {
            filtered = filtered.filter((t) =>
                (t.name || '').toLowerCase().includes(search) ||
                (t.token_prefix || '').toLowerCase().includes(search) ||
                (t.peer_id || '').toLowerCase().includes(search) ||
                (t.note || '').toLowerCase().includes(search)
            );
        }

        if (filtered.length === 0) {
            const msg = allTokens.length ? _('tokens.no_match') : _('tokens.no_tokens');
            tbody.innerHTML = `<tr><td colspan="7" class="state-cell">${esc(msg)}</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map((t) => {
            const st = statusOf(t);
            const uses = t.max_uses === 0
                ? _('tokens.uses_unlimited', { count: t.use_count })
                : _('tokens.uses_of', { count: t.use_count, max: t.max_uses });
            const sub = [t.token_prefix ? `<span class="mono">${esc(t.token_prefix)}…</span>` : '', t.note ? esc(t.note) : '']
                .filter(Boolean).join(' · ');
            const name = esc(t.name || '–');
            return `<tr data-id="${esc(t.id)}">
                <td><span class="token-name">${name}</span>${sub ? `<span class="cell-sub">${sub}</span>` : ''}</td>
                <td><span class="status ${st.cls}">${esc(st.label)}</span></td>
                <td>${esc(uses)}</td>
                <td>${t.peer_id ? `<span class="mono">${esc(t.peer_id)}</span>` : '–'}</td>
                <td>${esc(t.expires_at ? expiryText(t.expires_at) : _('tokens.never'))}</td>
                <td>${esc(relative(t.created_at))}${t.created_by ? `<span class="cell-sub">${esc(t.created_by)}</span>` : ''}</td>
                <td class="actions">${t.status !== 'revoked' ? `
                    <button type="button" class="btn btn-sm" data-token-action="edit" data-id="${esc(t.id)}" aria-label="${esc(_('tokens.edit'))}: ${name}">${esc(_('common.edit'))}</button>
                    <button type="button" class="btn btn-sm btn-danger-quiet" data-token-action="revoke" data-id="${esc(t.id)}" aria-label="${esc(_('tokens.revoke'))}: ${name}">${esc(_('tokens.revoke'))}</button>
                ` : ''}</td>
            </tr>`;
        }).join('');
    }

    // ── Dialogs ──────────────────────────────────────────────────────────

    function templateHtml(id) {
        const tpl = document.getElementById(id);
        return tpl ? tpl.innerHTML : '';
    }

    function setDialogStatus(id, text) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text || '';
        el.className = text ? 'form-status is-error' : 'form-status';
    }

    function openTokenDialog(token) {
        const editing = Boolean(token);
        Modal.show({
            title: editing ? _('tokens.edit') : _('tokens.create'),
            content: templateHtml('token-form-template'),
            buttons: [
                { label: _('common.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: editing ? _('tokens.save') : _('tokens.create'), class: 'btn-primary', onClick: saveToken },
            ],
        });
        document.getElementById('token-id').value = editing ? token.id : '';
        document.getElementById('token-name').value = editing ? (token.name || '') : '';
        document.getElementById('token-max-uses').value = editing ? (token.max_uses || 1) : '1';
        document.getElementById('token-note').value = editing ? (token.note || '') : '';
        // The server keeps the expiry and an unlimited count when editing
        const expires = document.getElementById('token-expires-group');
        if (expires) expires.hidden = editing;
        const usesHint = document.getElementById('token-max-uses-hint');
        if (usesHint && editing) usesHint.textContent = _('tokens.max_uses_edit_hint');
        if (editing) document.getElementById('token-max-uses').min = '1';
        document.getElementById('token-name').focus();
        bindEnter(saveToken);
    }

    function openBulkDialog() {
        Modal.show({
            title: _('tokens.bulk_generate'),
            content: templateHtml('bulk-form-template'),
            buttons: [
                { label: _('common.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: _('tokens.generate'), class: 'btn-primary', onClick: generateBulk },
            ],
        });
        bindEnter(generateBulk);
    }

    /** Enter in a text field submits the dialog */
    function bindEnter(fn) {
        document.querySelectorAll('.modal-body input').forEach((input) => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); fn(); }
            });
        });
    }

    function showCreatedTokens(tokens) {
        const list = (Array.isArray(tokens) ? tokens : [tokens]).filter((t) => t && t.token);
        if (!list.length) return;
        const rows = list.map((t, i) => `
            <dt>${esc(t.name)}</dt>
            <dd><span class="value-field"><code id="created-token-${i}">${esc(t.token)}</code><button type="button" data-token-action="copy" data-copy-id="created-token-${i}" aria-label="${esc(_('actions.copy'))} ${esc(t.name)}">${Utils.icon('copy')}<span class="btn-label">${esc(_('actions.copy'))}</span></button></span></dd>`).join('');
        const buttons = [];
        if (list.length > 1) {
            buttons.push({
                label: _('tokens.copy_all'),
                class: 'btn-secondary',
                onClick: () => copyText(list.map((t) => `${t.name}\t${t.token}`).join('\n')),
            });
        }
        buttons.push({ label: _('common.close'), class: 'btn-primary', onClick: () => Modal.close() });
        Modal.show({
            title: list.length > 1 ? _('tokens.tokens_generated') : _('tokens.token_created'),
            content: `<p class="notice warning">${esc(_('tokens.copy_warning'))}</p>
                <dl class="facts tokens-created" id="created-tokens-list">${rows}</dl>`,
            buttons,
            size: 'large',
        });
    }

    // ── Actions ──────────────────────────────────────────────────────────

    async function saveToken() {
        const id = document.getElementById('token-id')?.value;
        const usesRaw = parseInt(document.getElementById('token-max-uses').value, 10);
        const body = {
            name: document.getElementById('token-name').value.trim(),
            // 0 means unlimited; only an empty or invalid field falls back to 1
            max_uses: Number.isFinite(usesRaw) && usesRaw >= 0 ? usesRaw : 1,
            expires_in: parseInt(document.getElementById('token-expires')?.value, 10) || 0,
            note: document.getElementById('token-note').value.trim(),
        };

        if (!body.name) {
            setDialogStatus('token-form-status', _('common.name_required'));
            document.getElementById('token-name').focus();
            return;
        }

        try {
            if (id) {
                await apiFetch(`/api/panel/tokens/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
                Modal.close();
                Notifications.success(_('tokens.saved'));
            } else {
                const res = await apiFetch('/api/panel/tokens', { method: 'POST', body: JSON.stringify(body) });
                Modal.close();
                if (res.data && res.data.token) showCreatedTokens(res.data);
                else Notifications.success(_('tokens.saved'));
            }
            loadTokens();
        } catch (err) {
            setDialogStatus('token-form-status', `${_('tokens.save_failed')} ${err.message}`);
        }
    }

    async function generateBulk() {
        const usesRaw = parseInt(document.getElementById('bulk-max-uses').value, 10);
        const body = {
            count: parseInt(document.getElementById('bulk-count').value, 10) || 0,
            name_prefix: document.getElementById('bulk-prefix').value.trim() || 'Device',
            max_uses: Number.isFinite(usesRaw) && usesRaw > 0 ? usesRaw : 1,
            expires_in: parseInt(document.getElementById('bulk-expires').value, 10) || 0,
        };

        if (body.count < 1 || body.count > 100) {
            setDialogStatus('bulk-form-status', _('tokens.count_range'));
            document.getElementById('bulk-count').focus();
            return;
        }

        try {
            const res = await apiFetch('/api/panel/tokens/generate-bulk', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            Modal.close();
            if (res.data && Array.isArray(res.data.tokens)) showCreatedTokens(res.data.tokens);
            loadTokens();
        } catch (err) {
            setDialogStatus('bulk-form-status', `${_('tokens.save_failed')} ${err.message}`);
        }
    }

    async function revokeToken(id) {
        const token = allTokens.find((t) => String(t.id) === String(id));
        const ok = await Modal.confirm({
            title: _('tokens.revoke_title'),
            message: _('tokens.revoke_confirm'),
            confirmLabel: _('tokens.revoke'),
            danger: true,
        });
        if (!ok) return;
        try {
            await apiFetch(`/api/panel/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
            Notifications.success(_('tokens.revoked_success', { name: token ? token.name : '' }));
            loadTokens();
        } catch (err) {
            Notifications.error(`${_('tokens.revoke_failed')} ${err.message}`);
        }
    }

    async function setEnrollmentMode(radio) {
        const status = document.getElementById('enrollment-mode-status');
        const mode = radio.value;
        const radios = document.querySelectorAll('input[name="enrollment_mode"]');
        radios.forEach((r) => { r.disabled = true; });
        if (status) { status.textContent = _('tokens.mode_saving'); status.className = 'form-status'; }
        try {
            await apiFetch('/api/panel/enrollment/mode', {
                method: 'PUT',
                body: JSON.stringify({ mode }),
            });
            currentMode = mode;
            if (status) {
                status.textContent = _('tokens.mode_saved', { mode: _('tokens.mode_' + mode) });
                status.className = 'form-status is-ok';
            }
        } catch (err) {
            // Put the radio back on the mode the server still has
            const previous = document.querySelector(`input[name="enrollment_mode"][value="${currentMode}"]`);
            if (previous) previous.checked = true;
            if (status) {
                status.textContent = `${_('tokens.mode_save_failed')} ${err.message}`;
                status.className = 'form-status is-error';
            }
        } finally {
            radios.forEach((r) => { r.disabled = false; });
        }
    }

    async function copyText(text, button) {
        try {
            await Utils.copyToClipboard(text);
            if (button) {
                const label = button.querySelector('.btn-label') || button;
                const before = label.textContent;
                label.textContent = _('tokens.copied');
                button.classList.add('copied');
                setTimeout(() => { label.textContent = before; button.classList.remove('copied'); }, 1600);
            } else {
                Notifications.success(_('common.copied'));
            }
        } catch (_e) {
            Notifications.error(_('tokens.copy_failed'));
        }
    }

    // ── Init ─────────────────────────────────────────────────────────────

    function init() {
        document.addEventListener('click', (event) => {
            const button = event.target.closest('[data-token-action]');
            if (!button) return;

            switch (button.dataset.tokenAction) {
                case 'show-bulk-modal':
                    openBulkDialog();
                    break;
                case 'show-create-modal':
                    openTokenDialog(null);
                    break;
                case 'edit': {
                    const token = allTokens.find((t) => String(t.id) === button.dataset.id);
                    if (token) openTokenDialog(token);
                    break;
                }
                case 'revoke':
                    revokeToken(button.dataset.id);
                    break;
                case 'copy': {
                    const el = document.getElementById(button.dataset.copyId || '');
                    if (el) copyText(el.textContent.trim(), button);
                    break;
                }
                case 'reload':
                    loadTokens();
                    break;
            }
        });

        document.querySelectorAll('.tokens-page [data-filter]').forEach((btn) => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tokens-page [data-filter]').forEach((b) => {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                });
                currentFilter = btn.dataset.filter;
                renderTokens();
            });
        });

        const searchInput = document.getElementById('token-search');
        if (searchInput) searchInput.addEventListener('input', () => renderTokens());

        document.querySelectorAll('input[name="enrollment_mode"]').forEach((radio) => {
            radio.addEventListener('change', (e) => setEnrollmentMode(e.target));
        });

        loadEnrollmentMode();
        loadTokens();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
