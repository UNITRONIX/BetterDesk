/* BetterDesk Console — short-code pairing page */

(function () {
    'use strict';

    const t = (k, def) => {
        const tr = window.t ? window.t(k) : k;
        return (tr && tr !== k) ? tr : (def != null ? def : k);
    };
    const notify = window.Notifications || {
        success: console.log,
        error: console.error,
        warning: console.warn,
        info: console.info,
    };
    const csrf = () => (window.BetterDesk && window.BetterDesk.csrfToken) || '';

    async function api(method, url, body) {
        const headers = { Accept: 'application/json' };
        if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrf();
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch(url, {
            method,
            headers,
            credentials: 'same-origin',
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || payload.success === false) {
            throw new Error(payload.error || `HTTP ${res.status}`);
        }
        return payload;
    }

    const $ = (id) => document.getElementById(id);

    function formatRemaining(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    let countdown = null;
    let currentCode = '';

    /** Show one code, grouped for reading aloud: ABC-DEF. */
    function renderCode(code) {
        const el = $('pairing-code');
        if (!el) return;
        currentCode = code || '';
        el.classList.toggle('is-expired', false);
        if (!currentCode) {
            el.innerHTML = `<span class="pairing-code-loading">${t('pairing.unavailable', 'No code available')}</span>`;
            return;
        }
        const groups = currentCode.match(/.{1,3}/g) || [currentCode];
        el.textContent = '';
        groups.forEach((group, index) => {
            if (index) {
                const sep = document.createElement('span');
                sep.className = 'pairing-code-sep';
                sep.textContent = '–';
                sep.setAttribute('aria-hidden', 'true');
                el.appendChild(sep);
            }
            const span = document.createElement('span');
            span.className = 'pairing-code-group';
            span.textContent = group;
            el.appendChild(span);
        });
    }

    function startCountdown(expiresIn) {
        let remaining = Number(expiresIn) || 600;
        const ttl = $('pairing-code-ttl');
        if (ttl) ttl.textContent = formatRemaining(remaining);
        if (countdown) clearInterval(countdown);
        countdown = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(countdown);
                countdown = null;
                if (ttl) ttl.textContent = t('pairing.expired', 'Expired');
                const el = $('pairing-code');
                if (el) el.classList.add('is-expired');
                currentCode = '';
                return;
            }
            if (ttl) ttl.textContent = formatRemaining(remaining);
        }, 1000);
    }

    /** Store the host the client must type; the panel knows it, the operator does not. */
    function renderHost(host) {
        const el = $('pairing-code-host');
        if (!el) return;
        const value = String(host || '').trim();
        el.textContent = value || t('pairing.host_unknown', 'Ask your administrator');
    }

    /**
     * Mint a code. The operator only chooses a label — the server address is the
     * panel's own, because this page belongs to the operator, not to the device
     * being paired.
     */
    async function generate() {
        const button = $('pairing-generate');
        if (button) button.disabled = true;
        try {
            const payload = await api('POST', '/api/panel/pairing/codes', { label: '' });
            renderCode(payload.code);
            renderHost(payload.host);
            startCountdown(payload.expires_in);
            const labelOut = $('pairing-code-label-out');
            if (labelOut) labelOut.textContent = '';
            notify.success(t('pairing.created', 'Pairing code created'));
            await loadCodes();
        } catch (err) {
            notify.error(`${t('pairing.create_failed', 'Could not create a pairing code')}: ${err.message}`);
        } finally {
            if (button) button.disabled = false;
        }
    }

    async function loadCodes() {
        const tbody = $('pairing-tbody');
        if (!tbody) return;
        try {
            const payload = await api('GET', '/api/panel/pairing/codes');
            const codes = payload.codes || [];
            if (!codes.length) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-muted">${t('pairing.empty', 'No active codes')}</td></tr>`;
                return;
            }
            tbody.innerHTML = '';
            for (const item of codes) {
                const row = document.createElement('tr');
                const cells = [
                    item.label || '—',
                    item.created_at || '—',
                    item.expires_at || '—',
                    item.created_by || '—',
                ];
                for (const value of cells) {
                    const td = document.createElement('td');
                    td.textContent = value;
                    row.appendChild(td);
                }
                const actions = document.createElement('td');
                const revoke = document.createElement('button');
                revoke.type = 'button';
                revoke.className = 'btn btn-secondary btn-sm';
                revoke.textContent = t('pairing.revoke', 'Revoke');
                revoke.addEventListener('click', () => revokeCode(item.id));
                actions.appendChild(revoke);
                row.appendChild(actions);
                tbody.appendChild(row);
            }
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-muted">${err.message}</td></tr>`;
        }
    }

    async function revokeCode(id) {
        if (!id) return;
        try {
            await api('DELETE', `/api/panel/pairing/codes/${encodeURIComponent(id)}`);
            notify.success(t('pairing.revoked', 'Pairing code revoked'));
            await loadCodes();
        } catch (err) {
            notify.error(`${t('pairing.revoke_failed', 'Could not revoke the code')}: ${err.message}`);
        }
    }

    async function copyCode() {
        const text = currentCode || ($('pairing-code') && $('pairing-code').textContent) || '';
        const clean = text.trim();
        if (!clean) {
            notify.warning(t('pairing.copy_failed', 'Select the code and copy it manually'));
            return;
        }
        try {
            await navigator.clipboard.writeText(clean);
            notify.success(t('pairing.copied', 'Code copied'));
        } catch (_) {
            notify.warning(t('pairing.copy_failed', 'Select the code and copy it manually'));
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const generateBtn = $('pairing-generate');
        if (generateBtn) generateBtn.addEventListener('click', generate);
        const refreshBtn = $('pairing-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', loadCodes);
        const copyBtn = $('pairing-copy');
        if (copyBtn) copyBtn.addEventListener('click', copyCode);
        if ($('pairing-tbody')) loadCodes();
        // The page exists to hand out a code: one is ready on arrival instead of
        // asking the operator to press a button first.
        if ($('pairing-code')) generate();
    });
})();
