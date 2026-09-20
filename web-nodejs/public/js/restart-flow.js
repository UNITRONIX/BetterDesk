/**
 * Shared restart-required settings flow for pages outside Settings.
 * Settings has an additional tab-navigation guard in settings.js.
 */
(function () {
    'use strict';

    let pending = null;
    let pollTimer = null;
    let attempts = 0;

    function t(key, fallback) {
        const value = typeof _ === 'function' ? _('settings.' + key) : '';
        return value && value !== 'settings.' + key ? value : fallback;
    }

    function listHtml(item) {
        return (item?.changes || [])
            .map((change) => `<li>${Utils.escapeHtml(change.label || change.key || '')}</li>`)
            .join('');
    }

    function content(message, item, status) {
        return `<p>${Utils.escapeHtml(message)}</p>${item?.changes?.length ? `<ul>${listHtml(item)}</ul>` : ''}<p id="bd-restart-status" class="text-muted">${Utils.escapeHtml(status || '')}</p>`;
    }

    function statusText(value) {
        const el = document.getElementById('bd-restart-status');
        if (el) el.textContent = value;
    }

    function showPrompt(item) {
        if (!item || item.phase !== 'pending' || !window.Modal) return;
        pending = item;
        Modal.show({
            title: t('restart_required_title', 'Restart required'),
            content: content(
                t('restart_required_message', 'The saved settings require a BetterDesk service restart. Cancel to restore the previous values, or restart now.'),
                item,
                t('restart_required_waiting', 'Waiting for your confirmation.')
            ),
            closable: false,
            buttons: [
                {
                    label: t('restart_cancel', 'Cancel and restore'),
                    class: 'btn-secondary',
                    icon: 'undo',
                    onClick: cancel
                },
                {
                    label: t('restart_confirm', 'Restart services'),
                    class: 'btn-danger',
                    icon: 'restart_alt',
                    onClick: confirm
                }
            ]
        });
    }

    function showProgress(item) {
        Modal.close();
        Modal.show({
            title: t('restart_progress_title', 'Restarting BetterDesk'),
            content: content(
                t('restart_progress_message', 'The BetterDesk services are restarting. Keep this page open.'),
                item,
                t('restart_phase_stopping', 'Stopping and starting the BetterDesk services…')
            ),
            closable: false
        });
    }

    function showReady(item) {
        Modal.close();
        Modal.show({
            title: t('restart_ready_title', 'BetterDesk is ready'),
            content: content(
                t('restart_ready_message', 'The BetterDesk services have restarted successfully. Continue to the login page to start a fresh session.'),
                item,
                t('restart_ready_status', 'Restart completed.')
            ),
            closable: false,
            buttons: [{
                label: t('restart_ready_button', 'Ready — go to login'),
                class: 'btn-primary',
                icon: 'login',
                onClick: complete
            }]
        });
    }

    function showFailure(item, error) {
        pending = { ...item, phase: 'failed' };
        Modal.close();
        Modal.show({
            title: t('restart_failed_title', 'Restart needs attention'),
            content: content(
                t('restart_failed_message', 'BetterDesk could not complete the service restart. The saved values were kept so you can retry after checking service permissions.'),
                item,
                error || t('restart_failed_status', 'Restart failed.')
            ),
            closable: true,
            buttons: [{
                label: t('restart_retry', 'Retry restart'),
                class: 'btn-danger',
                icon: 'replay',
                onClick: confirm
            }, {
                label: t('restart_ready_button', 'Continue'),
                class: 'btn-secondary',
                icon: 'check',
                onClick: dismissFailure
            }]
        });
    }

    async function dismissFailure() {
        if (!pending?.id) return;
        try {
            await Utils.api('/api/settings/restart/complete', {
                method: 'POST',
                body: { id: pending.id }
            });
            pending = null;
            Modal.close();
        } catch (err) {
            if (window.Notifications) {
                Notifications.error(err.message || t('restart_failed_status', 'Restart failed.'));
            }
        }
    }

    async function cancel() {
        if (!pending?.id) return;
        try {
            await Utils.api('/api/settings/restart/cancel', {
                method: 'POST',
                body: { id: pending.id }
            });
            const previous = pending;
            pending = null;
            Modal.close();
            if (window.Notifications) Notifications.success(t('restart_canceled', 'Changes were canceled and the previous values were restored.'));
            window.dispatchEvent(new CustomEvent('betterdesk:restart-canceled', { detail: previous }));
        } catch (err) {
            if (window.Notifications) Notifications.error(err.message || t('restart_rollback_failed', 'Could not restore the previous values.'));
        }
    }

    async function confirm() {
        if (!pending?.id) return;
        try {
            const result = await Utils.api('/api/settings/restart/confirm', {
                method: 'POST',
                body: { id: pending.id }
            });
            if (result?.phase === 'failed' || result?.failed) {
                showFailure(pending, result.error);
                return;
            }
            window.BetterDesk = window.BetterDesk || {};
            window.BetterDesk.consoleRestarting = true;
            showProgress(pending);
            startPolling(pending.id, result.token);
        } catch (err) {
            showFailure(pending, err.message);
        }
    }

    function startPolling(id, token) {
        clearInterval(pollTimer);
        attempts = 0;
        pollTimer = setInterval(async () => {
            attempts++;
            statusText(`${t('restart_phase_checking', 'Checking service health…')} (${attempts}/90)`);
            try {
                const response = await fetch(`/api/settings/restart-status?job=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}&_=${Date.now()}`, {
                    credentials: 'same-origin',
                    cache: 'no-store'
                });
                const body = await response.json().catch(() => null);
                const status = body?.data || body || {};
                if (status.ready === true || status.phase === 'ready') {
                    clearInterval(pollTimer);
                    pollTimer = null;
                    window.BetterDesk.consoleRestarting = false;
                    showReady(pending);
                    return;
                }
                if (status.phase === 'failed') {
                    clearInterval(pollTimer);
                    pollTimer = null;
                    window.BetterDesk.consoleRestarting = false;
                    showFailure(pending, status.error);
                    return;
                }
            } catch (_) {}
            if (attempts >= 90) {
                clearInterval(pollTimer);
                pollTimer = null;
                window.BetterDesk.consoleRestarting = false;
                showFailure(pending, t('restart_timeout', 'The restart did not become ready within the expected time.'));
            }
        }, 2000);
    }

    async function complete() {
        try {
            if (pending?.id) {
                await Utils.api('/api/settings/restart/complete', {
                    method: 'POST',
                    body: { id: pending.id }
                });
            }
        } catch (_) {}
        window.location.href = '/login';
    }

    async function resume() {
        if (window.location.pathname === '/settings') return;
        try {
            const item = await Utils.api('/api/settings/restart/pending');
            if (item?.phase === 'pending') showPrompt(item);
            else if (item?.phase === 'ready') {
                pending = item;
                showReady(item);
            } else if (item?.phase === 'failed') {
                pending = item;
                showFailure(item, item.error);
            }
        } catch (_) {}
    }

    window.BetterDeskRestart = {
        handle: function (item) {
            if (item?.id) showPrompt(item);
        },
        resume,
        cancel,
        confirm,
    };

    document.addEventListener('DOMContentLoaded', resume);
})();
