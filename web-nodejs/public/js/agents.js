/* Support agents (/agents): the release this server serves on /portal, and how to set an agent up */
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

    function setStatus(text, kind) {
        const el = statusEl();
        if (!el) return;
        el.textContent = text || '';
        el.className = `form-status${kind ? ` is-${kind}` : ''}`;
    }

    /** One facts row: the release this server hands out, or why there is none */
    function renderRelease(html) {
        const list = listEl();
        if (!list) return;
        list.innerHTML = `<dt>${escapeText(t('agents.release_label', 'Release'))}</dt><dd>${html}</dd>`;
    }

    async function loadReleases() {
        if (!listEl()) return;
        try {
            const data = await api('GET', '/api/agent-releases');
            const releases = (data && data.releases) || [];
            if (!Array.isArray(releases) || releases.length === 0) {
                renderRelease(`<span class="text-muted">${escapeText(t('agents.sync_empty', 'No release imported yet.'))}</span>`);
                return;
            }
            const latest = releases[0];
            const count = ((latest.manifest && latest.manifest.assets) || []).length;
            // Escaped text pieces; the import date goes in as a <time> with the full date on hover
            const details = [
                escapeText(t('agents.sync_artifacts', '{{count}} installers').split('{{count}}').join(Utils.formatNumber(count) || '0')),
                escapeText(t('agents.sync_verified', 'signature checked')),
            ];
            if (latest.imported_at) {
                details.unshift(escapeText(t('agents.imported_on', 'imported {{date}}'))
                    .split('{{date}}').join(Utils.timeHtml(latest.imported_at)));
            }
            renderRelease(`${latest.tag ? Utils.versionHtml(latest.tag) : escapeText(t('agents.release_label', 'Release'))}
                <span class="text-muted">${details.join(', ')}</span>`);
        } catch (error) {
            renderRelease(`<span class="state is-error">${escapeText(errorMessage(error))}
                <button type="button" class="btn btn-sm" data-retry-releases>${escapeText(t('actions.retry', 'Retry'))}</button></span>`);
        }
    }

    async function syncRelease() {
        const button = syncBtn();
        if (button) button.disabled = true;
        setStatus(t('agents.sync_importing', 'Importing and checking the latest signed release…'));
        try {
            const result = await api('POST', '/api/agent-releases/sync', {});
            setStatus(t('agents.sync_imported', 'Imported {{tag}}.').split('{{tag}}').join(result.tag || ''), 'ok');
            await loadReleases();
        } catch (error) {
            setStatus(errorMessage(error), 'error');
        } finally {
            if (button) button.disabled = false;
        }
    }

    /** The download page's full address, with Copy feedback on the button itself */
    function initPortalAddress() {
        const code = document.getElementById('agents-portal-url');
        const copy = document.querySelector('[data-copy-target="agents-portal-url"]');
        if (!code) return;
        code.textContent = `${window.location.origin}/portal`;
        copy?.addEventListener('click', async () => {
            try {
                await Utils.copyToClipboard(code.textContent.trim());
                const label = copy.querySelector('.btn-label') || copy;
                const before = label.textContent;
                label.textContent = t('keys.copied', 'Copied');
                copy.classList.add('copied');
                setTimeout(() => { label.textContent = before; copy.classList.remove('copied'); }, 1600);
            } catch (_e) {
                notify.error(t('keys.copy_failed', 'Could not copy.'));
            }
        });
    }

    function init() {
        initPortalAddress();
        const button = syncBtn();
        if (button && window.Utils && Utils.can('enrollment.manage')) button.addEventListener('click', syncRelease);
        else if (button) button.hidden = true;
        listEl()?.addEventListener('click', (e) => {
            if (e.target.closest('[data-retry-releases]')) loadReleases();
        });
        loadReleases();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
