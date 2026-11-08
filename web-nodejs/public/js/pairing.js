/* BetterDesk Console — short-code pairing page (/pairing) */

(function () {
    'use strict';

    const t = (k, vars) => (typeof window._ === 'function' ? window._(k, vars) : k);
    const csrf = () => (window.BetterDesk && window.BetterDesk.csrfToken) || '';
    const esc = (s) => Utils.escapeHtml(s == null ? '' : String(s));

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
        if (res.status === 403) throw new Error(Utils.permissionDeniedMessage());
        if (!res.ok || payload.success === false) {
            throw new Error(payload.error || `HTTP ${res.status}`);
        }
        return payload;
    }

    const $ = (id) => document.getElementById(id);

    /** "10 minutes, works once" — counted down in whole minutes */
    function remainingText(seconds) {
        if (seconds <= 0) return t('pairing.expired_hint');
        if (seconds < 60) return t('pairing.valid_under_minute');
        return t('pairing.valid_minutes', { count: Math.ceil(seconds / 60) });
    }

    /** Clock time only: a code lives for minutes, so the date adds nothing */
    const CLOCK = { year: undefined, month: undefined, day: undefined };

    function timeOf(value) {
        if (!value) return '–';
        return Utils.formatDate(value, { ...CLOCK, empty: '–' });
    }

    /** A code waits for the device until it is used or runs out */
    function codeStatus(item) {
        const ends = Utils.parseDate(item.expires_at);
        return ends && ends.getTime() <= Date.now()
            ? Utils.statusHtml('neutral', t('tokens.status_expired'))
            : Utils.statusHtml('waiting', t('tokens.status_pending'));
    }

    let countdown = null;

    function setStatus(text, kind) {
        const el = $('pairing-status');
        if (!el) return;
        el.textContent = text || '';
        el.className = `form-status${kind ? ` is-${kind}` : ''}`;
    }

    function showCode(payload) {
        const result = $('pairing-result');
        if (!result) return;
        result.hidden = false;
        const empty = $('pairing-result-empty');
        if (empty) empty.hidden = true;
        const code = $('pairing-code');
        code.textContent = payload.code || '';
        code.classList.remove('is-expired');
        // The host the person types, so both halves of the pairing are in one place
        $('pairing-code-host').textContent = $('pairing-host').value.trim() || payload.host || '';

        const ttl = $('pairing-code-ttl');
        const endsAt = Date.now() + (Number(payload.expires_in) || 600) * 1000;
        const tick = () => {
            const left = Math.round((endsAt - Date.now()) / 1000);
            if (ttl) ttl.textContent = remainingText(left);
            if (left <= 0) {
                clearInterval(countdown);
                countdown = null;
                code.classList.add('is-expired');
            }
        };
        if (countdown) clearInterval(countdown);
        tick();
        countdown = setInterval(tick, 5000);

        // On narrow screens the code sits under the form: bring it into view
        const box = result.getBoundingClientRect();
        if (box.top < 0 || box.bottom > window.innerHeight) {
            result.scrollIntoView({ block: 'center' });
        }
    }

    async function generate(event) {
        if (event) event.preventDefault();
        const button = $('pairing-generate');
        if (button) button.disabled = true;
        setStatus(t('pairing.creating'));
        try {
            const label = ($('pairing-label') && $('pairing-label').value.trim()) || '';
            const payload = await api('POST', '/api/panel/pairing/codes', { label });
            showCode(payload);
            setStatus(t('pairing.created'), 'ok');
            await loadCodes();
        } catch (err) {
            setStatus(`${t('pairing.create_failed')}: ${err.message}`, 'error');
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
                tbody.innerHTML = `<tr><td colspan="6" class="state-cell">${esc(t('pairing.empty'))}</td></tr>`;
                return;
            }
            tbody.innerHTML = codes.map((item) => `<tr>
                <td>${item.label ? esc(item.label) : Utils.emptyHtml(t('pairing.no_label'))}</td>
                <td>${codeStatus(item)}</td>
                <td>${Utils.timeHtml(item.created_at)}</td>
                <td>${Utils.timeHtml(item.expires_at, { relative: false, format: CLOCK })}</td>
                <td>${Utils.userHtml(item.created_by)}</td>
                <td class="actions"><button type="button" class="btn btn-sm btn-danger-quiet" data-revoke="${esc(item.id)}"
                    aria-label="${esc(t('pairing.revoke'))}: ${esc(item.label || timeOf(item.created_at))}">${Utils.icon('revoke')}${esc(t('pairing.revoke'))}</button></td>
            </tr>`).join('');
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="6" class="state-cell"><span class="state is-error">${esc(t('pairing.load_failed'))} ${esc(err.message)}
                <button type="button" class="btn btn-sm" data-retry>${esc(t('actions.retry'))}</button></span></td></tr>`;
        }
    }

    async function revokeCode(id, button) {
        if (!id) return;
        if (button) button.disabled = true;
        try {
            await api('DELETE', `/api/panel/pairing/codes/${encodeURIComponent(id)}`);
            Notifications.success(t('pairing.revoked'));
            await loadCodes();
        } catch (err) {
            if (button) button.disabled = false;
            Notifications.error(`${t('pairing.revoke_failed')}: ${err.message}`);
        }
    }

    async function copyCode() {
        const button = $('pairing-copy');
        const text = $('pairing-code') && $('pairing-code').textContent.trim();
        if (!text) return;
        try {
            await Utils.copyToClipboard(text);
            if (button) {
                const label = button.querySelector('.btn-label') || button;
                label.textContent = t('pairing.copied_short');
                button.classList.add('copied');
                setTimeout(() => { label.textContent = t('actions.copy'); button.classList.remove('copied'); }, 1600);
            }
        } catch (_) {
            Notifications.warning(t('pairing.copy_failed'));
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        $('pairing-form')?.addEventListener('submit', generate);
        $('pairing-refresh')?.addEventListener('click', loadCodes);
        $('pairing-copy')?.addEventListener('click', copyCode);
        $('pairing-tbody')?.addEventListener('click', (e) => {
            const revoke = e.target.closest('[data-revoke]');
            if (revoke) revokeCode(revoke.dataset.revoke, revoke);
            if (e.target.closest('[data-retry]')) loadCodes();
        });
        if ($('pairing-tbody')) loadCodes();
    });
})();
