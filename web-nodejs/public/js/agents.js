/* BetterDesk Agents — info page + signed release sync for /portal */
(function () {
    'use strict';

    const t = (k, def) => {
        const tr = window.t ? window.t(k) : k;
        return (tr && tr !== k) ? tr : (def != null ? def : k);
    };

    const errorMessage = (error, fallback) => {
        const data = error && error.data;
        const raw = String((data && (data.error || data.code)) || (error && error.message) || '').trim();
        if (!raw) return fallback || t('errors.server_error', 'The request could not be completed.');
        const colon = raw.indexOf(':');
        const code = colon === -1 ? raw : raw.slice(0, colon);
        const detail = colon === -1 ? '' : raw.slice(colon + 1);
        let msg = t(
            `generator.errors.${code}`,
            fallback || t('errors.bad_request', 'The request could not be completed.')
        );
        if (detail) {
            if (msg.includes('{{detail}}')) msg = msg.split('{{detail}}').join(detail);
            else if (!msg.includes(detail)) msg = `${msg} (${detail})`;
        }
        return msg;
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
        const writeMethods = method === 'POST' || method === 'PUT' || method === 'PATCH';
        if (writeMethods) headers['Content-Type'] = 'application/json';
        if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrf();
        const opts = { method, headers, credentials: 'same-origin' };
        if (body !== undefined) {
            opts.body = JSON.stringify(body);
        } else if (writeMethods) {
            opts.body = '{}';
        }
        const res = await fetch(url, opts);
        const ct = (res.headers.get('content-type') || '');
        const data = ct.includes('application/json') ? await res.json() : null;
        if (!res.ok || (data && data.success === false)) {
            const err = new Error((data && data.error) || `HTTP ${res.status}`);
            err.data = data;
            err.status = res.status;
            throw err;
        }
        return data;
    }

    function escapeText(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    const listEl = () => document.getElementById('agents-release-list');
    const statusEl = () => document.getElementById('agents-release-status');
    const syncBtn = () => document.getElementById('agents-sync-release');

    async function loadReleases() {
        const list = listEl();
        if (!list) return;
        try {
            const data = await api('GET', '/api/agent-releases');
            const releases = (data && data.releases) || [];
            if (!Array.isArray(releases) || releases.length === 0) {
                list.innerHTML = `<span class="text-muted">${escapeText(t('agents.sync_empty', 'No release imported yet.'))}</span>`;
                return;
            }
            list.innerHTML = releases.map((release) => {
                const tag = escapeText(release.tag || 'release');
                const count = ((release.manifest && release.manifest.assets) || []).length;
                const artifacts = t('agents.sync_artifacts', '{{count}} platform artifacts')
                    .split('{{count}}').join(String(count));
                return `<div class="agents-release-item">
                    <div><strong>${tag}</strong>
                        <div class="text-muted">${escapeText(artifacts)}</div>
                    </div>
                    <span class="status-badge ready">${escapeText(t('agents.sync_verified', 'verified'))}</span>
                </div>`;
            }).join('');
        } catch (error) {
            const status = statusEl();
            if (status) status.textContent = errorMessage(error);
        }
    }

    async function syncRelease() {
        const button = syncBtn();
        const status = statusEl();
        if (button) button.disabled = true;
        if (status) {
            status.textContent = t('agents.sync_importing', 'Importing and verifying the latest signed release…');
        }
        try {
            const result = await api('POST', '/api/agent-releases/sync', {});
            if (status) {
                status.textContent = t('agents.sync_imported', 'Imported {{tag}}.')
                    .split('{{tag}}').join(result.tag || '');
            }
            await loadReleases();
        } catch (error) {
            if (status) status.textContent = errorMessage(error);
            notify.error(errorMessage(error));
        } finally {
            if (button) button.disabled = false;
        }
    }

    function init() {
        const button = syncBtn();
        if (button) button.addEventListener('click', syncRelease);
        loadReleases();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
