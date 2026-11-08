/**
 * BetterDesk Console - Settings Page
 */

(function() {
    'use strict';

    let _ldapWasEnabled = false;
    let _oidcWasEnabled = false;
    let _smtpWasConfigured = false;
    let _restartPending = null;
    let _restartPollTimer = null;
    let _restartPollAttempts = 0;
    let _connectionModeSnapshot = null;
    let _connectionModeWritable = false;

    // Each settings tab is its own page (?tab=). Old links used #tab; send
    // them to the right page before anything loads.
    const TAB_NAMES = ['general', 'branding', 'auth', 'backup', 'updates', 'email', 'time', 'advanced'];
    window.addEventListener('hashchange', () => {
        redirectHashTab();
        revealHashTarget();
    });
    redirectHashTab();
    function redirectHashTab() {
        const hash = window.location.hash.replace('#', '');
        const name = hash === 'server' ? 'general' : hash;
        if (!TAB_NAMES.includes(name)) return;
        const params = new URLSearchParams(window.location.search);
        if (params.get('tab') === name) return;
        params.set('tab', name);
        window.location.replace(window.location.pathname + '?' + params.toString());
    }

    const pageEl = () => document.querySelector('.settings-page');
    const CURRENT_TAB = () => pageEl()?.dataset.currentTab || 'general';
    const CAN_SERVER_CONFIG = () => pageEl()?.dataset.canServerConfig === '1';

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        if (!pageEl()) return;
        const tab = CURRENT_TAB();
        if (CAN_SERVER_CONFIG()) initRestartCoordinator();
        initSettingsSearch();
        initSettingsSide();
        revealHashTarget();

        // Only the visible tab loads its data; the other tabs are in the page
        // so the search can find their fields.
        switch (tab) {
            case 'general':
                loadServerInfo();
                initPublicEndpointsSection();
                initConnectionModeSection();
                initDeviceScopeSection();
                initAvailabilityHistorySection();
                initMeshSettingsSection();
                initConnectionDiagram();
                break;
            case 'branding':
                initBrandingSection();
                break;
            case 'auth':
                initPasswordForm();
                initTotpSection();
                if (document.getElementById('enrollment-settings-section')) {
                    initEnrollmentSection();
                    initClientSessionsSection();
                    initLdapSection();
                    initOidcSection();
                }
                break;
            case 'backup':
                if (document.getElementById('tab-backup')) initBackupSection();
                break;
            case 'updates':
                if (document.getElementById('update-check-btn')) initUpdateSection();
                break;
            case 'email':
                if (document.getElementById('tab-email')) initEmailSection();
                break;
            case 'time':
                if (document.getElementById('tab-time')) {
                    initTimeSettingsTab();
                    loadTimeSettingsTab();
                }
                break;
            case 'advanced':
                if (document.getElementById('tab-advanced')) initAdvancedSection();
                break;
            default:
                break;
        }

        document.querySelectorAll('[data-copy-from]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const text = document.getElementById(btn.dataset.copyFrom)?.textContent || '';
                if (!text) return;
                navigator.clipboard?.writeText(text).then(() => flashCopied(btn)).catch(() => {});
            });
        });
    }

    /** Text for a form's save bar or status line. */
    function formOk(form, message) {
        if (form && window.UiForm) UiForm.saved(form, message);
    }

    function formFail(form, message) {
        if (form && window.UiForm) UiForm.failed(form, message);
        else if (message) Notifications.error(message);
    }

    /** One-line status next to a button: kind is '', 'ok' or 'error'. */
    function setStatus(el, text, kind = '') {
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('is-ok', kind === 'ok');
        el.classList.toggle('is-error', kind === 'error');
    }

    function setBusy(btn, busy, busyText) {
        if (!btn) return;
        // Buttons with an icon keep it; only the label (.btn-label) changes
        if (busy) {
            if (btn.dataset.idleHtml === undefined) btn.dataset.idleHtml = btn.innerHTML;
            btn.disabled = true;
            if (busyText) setButtonLabel(btn, busyText);
        } else {
            btn.disabled = false;
            if (btn.dataset.idleHtml !== undefined) {
                btn.innerHTML = btn.dataset.idleHtml;
                delete btn.dataset.idleHtml;
            }
        }
    }

    function setButtonLabel(btn, text) {
        const label = btn.querySelector('.btn-label');
        if (label) label.textContent = text;
        else btn.textContent = text;
    }

    /** "Copied" on a copy button for a moment, keeping its icon */
    function flashCopied(btn) {
        setButtonLabel(btn, _('common.copied'));
        btn.classList.add('copied');
        clearTimeout(btn._copiedTimer);
        btn._copiedTimer = setTimeout(() => {
            setButtonLabel(btn, _('actions.copy'));
            btn.classList.remove('copied');
        }, 1500);
    }

    const iconHtml = (meaning) => (window.Utils && typeof Utils.icon === 'function' ? Utils.icon(meaning) : '');

    // ==================== Settings UI helpers ====================

    const _settingsSaveTimers = {};

    function restartLabelList(pending) {
        return (pending?.changes || [])
            .map((change) => `<li>${Utils.escapeHtml(change.label || change.key || '')}</li>`)
            .join('');
    }

    function restartModalContent(message, pending, progress = '') {
        return `
            <div class="settings-restart-modal">
                <p>${Utils.escapeHtml(message)}</p>
                ${pending?.changes?.length ? `<ul class="update-wizard-error-list">${restartLabelList(pending)}</ul>` : ''}
                <p id="settings-restart-modal-status" class="text-muted">${Utils.escapeHtml(progress)}</p>
            </div>
        `;
    }

    function showRestartPrompt(pending) {
        if (!pending || !pending.id || pending.phase !== 'pending') return;
        _restartPending = pending;
        if (!window.Modal) return;
        Modal.show({
            title: tSettings('restart_required_title', 'Restart required'),
            content: restartModalContent(
                tSettings('restart_required_message', 'The saved settings require a BetterDesk service restart. Cancel to restore the previous values, or restart now.'),
                pending,
                tSettings('restart_required_waiting', 'Waiting for your confirmation.')
            ),
            closable: false,
            size: 'medium',
            buttons: [
                {
                    label: tSettings('restart_cancel', 'Cancel and restore'),
                    class: 'btn-secondary',
                    icon: 'undo',
                    onClick: cancelPendingRestart
                },
                {
                    label: tSettings('restart_confirm', 'Restart services'),
                    class: 'btn-danger',
                    icon: 'restart_alt',
                    onClick: confirmPendingRestart
                }
            ]
        });
    }

    function setRestartModalStatus(text) {
        const el = document.getElementById('settings-restart-modal-status');
        if (el) el.textContent = text;
    }

    function showRestartProgress(pending, text) {
        _restartPending = pending;
        if (window.Modal) Modal.close();
        Modal.show({
            title: tSettings('restart_progress_title', 'Restarting BetterDesk'),
            content: restartModalContent(
                tSettings('restart_progress_message', 'The BetterDesk services are restarting. Keep this page open.'),
                pending,
                text
            ),
            closable: false,
            size: 'medium'
        });
    }

    function showRestartReady(pending) {
        if (window.Modal) Modal.close();
        Modal.show({
            title: tSettings('restart_ready_title', 'BetterDesk is ready'),
            content: restartModalContent(
                tSettings('restart_ready_message', 'The BetterDesk services have restarted successfully. Continue to the login page to start a fresh session.'),
                pending,
                tSettings('restart_ready_status', 'Restart completed.')
            ),
            closable: false,
            size: 'medium',
            buttons: [{
                label: tSettings('restart_ready_button', 'Ready — go to login'),
                class: 'btn-primary',
                icon: 'login',
                onClick: completeRestartAndLogin
            }]
        });
    }

    function showRestartFailure(pending, message) {
        _restartPending = { ...pending, phase: 'failed' };
        if (window.Modal) Modal.close();
        Modal.show({
            title: tSettings('restart_failed_title', 'Restart needs attention'),
            content: restartModalContent(
                tSettings('restart_failed_message', 'BetterDesk could not complete the service restart. The saved values were kept so you can retry after checking the service permissions.'),
                pending,
                message || tSettings('restart_failed_status', 'Restart failed.')
            ),
            closable: true,
            size: 'medium',
            buttons: [{
                label: tSettings('restart_retry', 'Retry restart'),
                class: 'btn-danger',
                icon: 'replay',
                onClick: confirmPendingRestart
            }, {
                label: tSettings('restart_ready_button', 'Continue'),
                class: 'btn-secondary',
                icon: 'check',
                onClick: dismissFailedRestart
            }]
        });
    }

    async function dismissFailedRestart() {
        const pending = _restartPending;
        if (!pending?.id) return;
        try {
            await Utils.api('/api/settings/restart/complete', {
                method: 'POST',
                body: { id: pending.id }
            });
            _restartPending = null;
            Modal.close();
            Notifications.warning(tSettings(
                'restart_failed_message',
                'The saved values were kept. Service restart is still required outside the panel.'
            ));
        } catch (err) {
            Notifications.error(err.message || tSettings(
                'restart_failed_status',
                'Restart failed.'
            ));
        }
    }

    async function cancelPendingRestart() {
        const pending = _restartPending;
        if (!pending?.id) return;
        try {
            await Utils.api('/api/settings/restart/cancel', {
                method: 'POST',
                body: { id: pending.id }
            });
            _restartPending = null;
            Modal.close();
            Notifications.success(tSettings('restart_canceled', 'Changes were canceled and the previous values were restored.'));
            await loadConnectionMode();
            if (typeof loadAdvancedFile === 'function' && advancedState?.activeId) {
                await loadAdvancedFile(advancedState.activeId, true);
            }
        } catch (err) {
            Notifications.error(err.message || tSettings('restart_rollback_failed', 'Could not restore the previous values.'));
        }
    }

    async function confirmPendingRestart() {
        const pending = _restartPending;
        if (!pending?.id) return;
        try {
            const result = await Utils.api('/api/settings/restart/confirm', {
                method: 'POST',
                body: { id: pending.id }
            });
            if (result?.phase === 'failed' || result?.failed) {
                showRestartFailure(pending, result.error);
                return;
            }
            window.BetterDesk = window.BetterDesk || {};
            window.BetterDesk.consoleRestarting = true;
            showRestartProgress(pending, tSettings('restart_phase_stopping', 'Stopping and starting the BetterDesk services…'));
            startRestartPolling(pending.id, result.token);
        } catch (err) {
            showRestartFailure(pending, err.message);
        }
    }

    async function completeRestartAndLogin() {
        const pending = _restartPending;
        try {
            if (pending?.id) {
                await Utils.api('/api/settings/restart/complete', {
                    method: 'POST',
                    body: { id: pending.id }
                });
            }
        } catch (_) {
            // A changed session secret can invalidate the old session; the
            // login redirect below is still the correct recovery path.
        }
        window.location.href = '/login';
    }

    function startRestartPolling(id, token) {
        clearInterval(_restartPollTimer);
        _restartPollAttempts = 0;
        _restartPollTimer = setInterval(async () => {
            _restartPollAttempts++;
            setRestartModalStatus(
                `${tSettings('restart_phase_checking', 'Checking service health…')} (${_restartPollAttempts}/90)`
            );
            try {
                const response = await fetch(
                    `/api/settings/restart-status?job=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}&_=${Date.now()}`,
                    { credentials: 'same-origin', cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } }
                );
                const body = await response.json().catch(() => null);
                const status = body?.data || body || {};
                if (status.ready === true || status.phase === 'ready') {
                    clearInterval(_restartPollTimer);
                    _restartPollTimer = null;
                    window.BetterDesk.consoleRestarting = false;
                    showRestartReady(_restartPending);
                    return;
                }
                if (status.phase === 'failed') {
                    clearInterval(_restartPollTimer);
                    _restartPollTimer = null;
                    window.BetterDesk.consoleRestarting = false;
                    showRestartFailure(_restartPending, status.error);
                    return;
                }
            } catch (_) {
                // The console is expected to be unreachable while it restarts.
            }
            if (_restartPollAttempts >= 90) {
                clearInterval(_restartPollTimer);
                _restartPollTimer = null;
                window.BetterDesk.consoleRestarting = false;
                showRestartFailure(_restartPending, tSettings('restart_timeout', 'The restart did not become ready within the expected time.'));
            }
        }, 2000);
    }

    async function initRestartCoordinator() {
        window.addEventListener('beforeunload', (event) => {
            if (_restartPending || isRestartSensitiveDirty()) {
                event.preventDefault();
                event.returnValue = '';
            }
        });
        try {
            const pending = await Utils.api('/api/settings/restart/pending');
            if (pending) {
                _restartPending = pending;
                if (pending.phase === 'pending') showRestartPrompt(pending);
            }
        } catch (_) {
            // Optional helper; normal settings loading should continue.
        }
    }

    function tSettings(key, fallback) {
        const val = _('settings.' + key);
        if (!val || val === 'settings.' + key) return fallback || key;
        return val;
    }

    async function settingsConfirmCritical(options) {
        if (window.Modal && typeof Modal.confirm === 'function') {
            return Modal.confirm({
                title: options.title || _('common.confirm'),
                message: options.message || '',
                confirmLabel: options.confirmLabel || _('actions.confirm'),
                cancelLabel: options.cancelLabel,
                danger: options.danger
            });
        }
        return confirm(options.message || options.title || '');
    }

    function scheduleSettingsSave(key, saveFn, debounceMs = 400) {
        clearTimeout(_settingsSaveTimers[key]);
        _settingsSaveTimers[key] = setTimeout(() => {
            saveFn().catch((err) => {
                console.error('Settings save failed:', err);
            });
        }, debounceMs);
    }

    async function applyWithConfirm({ previousValue, newValue, setUiValue, confirmOptions, save }) {
        if (!(await settingsConfirmCritical(confirmOptions))) {
            if (setUiValue) setUiValue(previousValue);
            return false;
        }
        try {
            await save(newValue);
            return true;
        } catch (err) {
            if (setUiValue) setUiValue(previousValue);
            throw err;
        }
    }

    // ==================== Sub-page links ====================

    /**
     * A link like /settings#public-endpoints may point into another tab's
     * section: go to that tab. A target on this tab is scrolled to and marked.
     */
    function revealHashTarget() {
        const id = decodeURIComponent(window.location.hash.replace('#', ''));
        if (!id || TAB_NAMES.includes(id)) return;
        const target = document.getElementById(id);
        if (!target) return;
        const panel = target.closest('.settings-tab-content');
        if (panel && panel.hidden && panel.dataset.tab) {
            window.location.replace(`/settings?tab=${encodeURIComponent(panel.dataset.tab)}#${encodeURIComponent(id)}`);
            return;
        }
        // Wait a frame so the sticky header is laid out before scrolling.
        requestAnimationFrame(() => highlightTarget(target));
    }

    function highlightTarget(target) {
        const block = target.closest('.form-group, .check-field, .choice, .facts, .settings-subgroup, .section, .danger-zone') || target;
        const details = target.closest('details');
        if (details) details.open = true;
        block.scrollIntoView({ block: 'center' });
        block.classList.add('is-found');
        setTimeout(() => block.classList.remove('is-found'), 2400);
        const field = target.matches('input, select, textarea') ? target
            : block.querySelector('input:not([type=hidden]), select, textarea');
        if (field && !field.disabled && field.offsetParent !== null) field.focus({ preventScroll: true });
    }

    function isRestartSensitiveDirty() {
        if (_connectionModeSnapshot) {
            const current = getConnectionModePayload();
            if (JSON.stringify(current) !== JSON.stringify(_connectionModeSnapshot)) return true;
        }
        return typeof advancedState !== 'undefined' && !!advancedState?.dirty;
    }

    // ==================== Time / NTP / billing timezone ====================

    let _timeClockDockerMode = false;
    let _timeCommonZones = [];

    function fillTimezoneSelect(selected, common) {
        const select = document.getElementById('time-billing-timezone');
        if (!select) return;
        const zones = Array.from(new Set([...(common || []), selected, 'UTC', 'Europe/Warsaw'].filter(Boolean))).sort();
        select.innerHTML = zones.map((z) =>
            `<option value="${Utils.escapeHtml(z)}"${z === selected ? ' selected' : ''}>${Utils.escapeHtml(z)}</option>`
        ).join('');
        const custom = document.getElementById('time-billing-timezone-custom');
        if (custom && selected && !zones.includes(selected)) {
            custom.value = selected;
        }
    }

    async function loadTimeSettingsTab() {
        if (!document.getElementById('tab-time')) return;
        try {
            const detect = await Utils.api('/api/panel/billing/clock/detect-timezone');
            _timeCommonZones = detect.common || [];
        } catch (_) {
            _timeCommonZones = ['UTC', 'Europe/Warsaw'];
        }
        try {
            const data = await Utils.api('/api/panel/billing/clock/settings');
            _timeClockDockerMode = data.dockerMode === true;
            const settings = data.settings || {};
            fillTimezoneSelect(settings.billing_timezone || 'UTC', _timeCommonZones);
            const serversEl = document.getElementById('time-clock-ntp-servers');
            const skewEl = document.getElementById('time-clock-max-skew');
            const requireEl = document.getElementById('time-clock-require-sync');
            const trustEl = document.getElementById('time-clock-trust-os');
            if (serversEl) serversEl.value = settings.ntp_servers || '';
            if (skewEl) skewEl.value = settings.max_skew_ms || 2000;
            if (requireEl) requireEl.checked = settings.require_synced_clock !== false;
            if (trustEl) trustEl.checked = settings.trust_os_ntp !== false;
        } catch (e) {
            console.warn('[settings] clock settings', e);
        }
        await refreshTimeSyncStatus();
    }

    async function refreshTimeSyncStatus() {
        try {
            const st = await Utils.api('/api/panel/billing/timesync/status');
            const detail = document.getElementById('time-clock-detail');
            const offsetEl = document.getElementById('time-clock-offset');
            const ntpServerEl = document.getElementById('time-clock-ntp-server');
            const osSyncEl = document.getElementById('time-clock-os-sync');
            const lastErrorEl = document.getElementById('time-clock-last-error');
            const synced = !!st.synced;
            if (detail) {
                detail.textContent = synced
                    ? (typeof __ === 'function' ? __('commercialization.clock.synced_detail') : 'Clock synchronized for billing')
                    : (typeof __ === 'function' ? __('commercialization.clock.unsynced') : 'Server clock is not synchronized');
            }
            if (offsetEl) offsetEl.textContent = st.offset_ms != null ? `${st.offset_ms} ms` : '-';
            if (ntpServerEl) ntpServerEl.textContent = st.ntp_server || '-';
            if (osSyncEl) {
                if (st.os_clock_synced === true) osSyncEl.textContent = typeof __ === 'function' ? __('commercialization.clock.os_yes') : 'Yes';
                else if (st.os_clock_synced === false) osSyncEl.textContent = typeof __ === 'function' ? __('commercialization.clock.os_no') : 'No';
                else osSyncEl.textContent = '-';
            }
            if (lastErrorEl) lastErrorEl.textContent = st.last_error || '-';
            if (detail) {
                detail.innerHTML = `<span class="status ${synced ? 'ok' : 'warning'}">${Utils.escapeHtml(detail.textContent)}</span>`;
            }
        } catch (e) {
            console.warn('[settings] timesync status', e);
        }
    }

    function resolveSelectedTimezone() {
        const custom = (document.getElementById('time-billing-timezone-custom')?.value || '').trim();
        if (custom) return custom;
        return document.getElementById('time-billing-timezone')?.value || 'UTC';
    }

    function initTimeSettingsTab() {
        if (!document.getElementById('tab-time')) return;
        const form = document.getElementById('time-clock-settings-form');
        const checkStatus = document.getElementById('time-check-status');

        document.getElementById('time-detect-timezone-btn')?.addEventListener('click', async () => {
            try {
                const data = await Utils.api('/api/panel/billing/clock/detect-timezone');
                const tz = data.timezone || 'UTC';
                fillTimezoneSelect(tz, data.common || _timeCommonZones);
                const custom = document.getElementById('time-billing-timezone-custom');
                if (custom) custom.value = '';
                if (form && window.UiForm) UiForm.markDirty(form);
                setStatus(checkStatus, '');
                if (form && window.UiForm) {
                    const status = form.querySelector('[data-save-status]');
                    if (status) status.textContent = tSettings('time.detected', 'Detected timezone: {tz}').replace('{tz}', tz);
                }
            } catch (e) {
                formFail(form, e.message || _('errors.server_error'));
            }
        });

        document.getElementById('time-timesync-check-btn')?.addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            setBusy(btn, true);
            setStatus(checkStatus, '');
            try {
                await Utils.api('/api/panel/billing/timesync/check', { method: 'POST' });
                setStatus(checkStatus, typeof __ === 'function' ? __('commercialization.clock.checked') : 'Clock check completed', 'ok');
                await refreshTimeSyncStatus();
            } catch (e) {
                setStatus(checkStatus, e.message || _('errors.server_error'), 'error');
            } finally {
                setBusy(btn, false);
            }
        });

        form?.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            if (!_timeClockDockerMode) {
                const ok = await settingsConfirmCritical({
                    title: tSettings('time.save_title', 'Save time settings'),
                    message: typeof __ === 'function'
                        ? __('commercialization.clock.save_restart')
                        : 'Save NTP settings and restart the BetterDesk Go server? Active sessions may disconnect briefly.',
                    confirmLabel: tSettings('time.save', 'Save'),
                    icon: 'schedule'
                });
                if (!ok) return;
            }
            try {
                const result = await Utils.api('/api/panel/billing/clock/settings', {
                    method: 'PUT',
                    body: {
                        ntp_servers: document.getElementById('time-clock-ntp-servers')?.value || '',
                        max_skew_ms: Number(document.getElementById('time-clock-max-skew')?.value || 2000),
                        require_synced_clock: document.getElementById('time-clock-require-sync')?.checked !== false,
                        trust_os_ntp: document.getElementById('time-clock-trust-os')?.checked !== false,
                        billing_timezone: resolveSelectedTimezone()
                    }
                });
                if (result.dockerMode) _timeClockDockerMode = true;
                if (result.settings) {
                    fillTimezoneSelect(result.settings.billing_timezone || resolveSelectedTimezone(), _timeCommonZones);
                }
                if (result.restartRequired && typeof showRestartPrompt === 'function') {
                    formOk(form);
                    showRestartPrompt(result.restartRequired);
                } else {
                    formOk(form,
                        result.dockerMode
                            ? (typeof __ === 'function' ? __('commercialization.clock.saved_hot_reload') : 'Clock settings saved.')
                            : tSettings('time.saved', 'Time settings saved.')
                    );
                }
                await refreshTimeSyncStatus();
            } catch (e) {
                formFail(form, e.message || _('errors.server_error'));
            }
        });
    }

    // ==================== Settings search ====================
    // Finds a setting on any tab the user may open. Results link to the tab
    // and the field; a field on this tab is scrolled to and marked.

    let _searchIndex = null;

    function buildSearchIndex() {
        const items = [];
        const seen = new Set();
        document.querySelectorAll('.settings-tab-content[data-tab]').forEach((panel) => {
            const tab = panel.dataset.tab;
            const tabTitle = panel.dataset.tabTitle || tab;
            const nodes = panel.querySelectorAll('.form-group, .check-field, .choice, section[id], .settings-subgroup, .facts > dt');
            nodes.forEach((node) => {
                if (node.closest('[data-search-skip]')) return;
                let label = '';
                let targetId = '';
                if (node.matches('section[id], .settings-subgroup')) {
                    const heading = node.querySelector('h2, h3');
                    label = heading?.textContent.trim() || '';
                    targetId = node.id || heading?.id || '';
                } else if (node.matches('.facts > dt')) {
                    label = node.textContent.trim();
                    const dd = node.nextElementSibling;
                    targetId = dd?.id || node.closest('section[id]')?.id || '';
                } else {
                    const labelEl = node.querySelector('.form-label, .check-label, .choice-title, legend');
                    label = (labelEl?.textContent || '').trim();
                    const control = node.querySelector('input[id]:not([type=hidden]), select[id], textarea[id]');
                    targetId = control?.id || node.closest('[id]')?.id || '';
                }
                label = label.replace(/\s+/g, ' ').replace(/:$/, '');
                if (!label || !targetId) return;
                const key = tab + '#' + targetId + '#' + label;
                if (seen.has(key)) return;
                seen.add(key);
                const section = node.closest('section[id], .danger-zone, .settings-subgroup');
                const sectionTitle = section?.querySelector('h2, h3')?.textContent.trim() || '';
                const hint = Array.from(node.querySelectorAll('.form-hint, .choice-desc, .section-note'))
                    .slice(0, 2).map((el) => el.textContent).join(' ');
                items.push({
                    tab, tabTitle, targetId, label,
                    where: sectionTitle && sectionTitle !== label ? `${tabTitle} › ${sectionTitle}` : tabTitle,
                    label_lc: label.toLowerCase(),
                    text_lc: (label + ' ' + sectionTitle + ' ' + hint).toLowerCase()
                });
            });
        });
        return items;
    }

    function initSettingsSearch() {
        const input = document.getElementById('settings-search-input');
        if (!input) return;
        input.addEventListener('input', applySettingsSearchFilter);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const first = document.querySelector('#settings-search-results a');
                if (first) {
                    e.preventDefault();
                    first.click();
                }
            } else if (e.key === 'Escape' && input.value) {
                input.value = '';
                applySettingsSearchFilter();
            }
        });
        document.getElementById('settings-search-results')?.addEventListener('click', (e) => {
            const link = e.target.closest('a[data-tab]');
            if (!link || link.dataset.tab !== CURRENT_TAB()) return;
            const target = document.getElementById(link.dataset.target);
            if (!target) return;
            e.preventDefault();
            history.replaceState(null, '', '#' + link.dataset.target);
            input.value = '';
            applySettingsSearchFilter();
            highlightTarget(target);
        });
    }

    function applySettingsSearchFilter() {
        const input = document.getElementById('settings-search-input');
        const box = document.getElementById('settings-search-status');
        const list = document.getElementById('settings-search-results');
        const count = document.getElementById('settings-search-count');
        const query = (input?.value || '').trim().toLowerCase();
        if (!box || !list) return;
        if (query.length < 2) {
            box.hidden = true;
            list.innerHTML = '';
            return;
        }
        if (!_searchIndex) _searchIndex = buildSearchIndex();
        const words = query.split(/\s+/).filter(Boolean);
        const matches = _searchIndex
            .filter((item) => words.every((w) => item.text_lc.includes(w)))
            .map((item) => ({ item, score: (item.label_lc.includes(query) ? 0 : 1) + (item.tab === CURRENT_TAB() ? 0 : 0.5) }))
            .sort((a, b) => a.score - b.score)
            .slice(0, 8)
            .map((m) => m.item);
        box.hidden = false;
        if (!matches.length) {
            count.textContent = tSettings('page.search_none', 'No setting matches “{query}”.').replace('{query}', input.value.trim());
            list.innerHTML = '';
            return;
        }
        count.textContent = tSettings('page.search_count', '{count} settings found').replace('{count}', String(matches.length));
        list.innerHTML = matches.map((m) => `
            <li><a class="list-row" data-tab="${Utils.escapeHtml(m.tab)}" data-target="${Utils.escapeHtml(m.targetId)}"
                   href="/settings?tab=${encodeURIComponent(m.tab)}#${encodeURIComponent(m.targetId)}">
                <span class="row-main"><span class="row-title">${Utils.escapeHtml(m.label)}</span>
                <span class="row-sub">${Utils.escapeHtml(m.where)}</span></span>
                <span class="material-icons row-chevron" aria-hidden="true">chevron_right</span>
            </a></li>`).join('');
    }
    
    /**
     * Change your own password (Sign-in › Your account)
     */
    function initPasswordForm() {
        const form = document.getElementById('password-form');
        const newPassword = document.getElementById('new-password');
        if (!form) return;

        newPassword?.addEventListener('input', () => {
            validatePassword(newPassword.value);
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentPassword = document.getElementById('current-password').value;
            const newPass = document.getElementById('new-password').value;
            const confirmPass = document.getElementById('confirm-password').value;

            if (!currentPassword || !newPass || !confirmPass) {
                formFail(form, _('settings.fill_all_fields'));
                return;
            }
            if (newPass !== confirmPass) {
                formFail(form, _('settings.passwords_not_match'));
                return;
            }
            if (!validatePassword(newPass)) {
                formFail(form, _('settings.password_requirements_not_met'));
                return;
            }

            const btn = form.querySelector('[data-save-button]');
            setBusy(btn, true);
            try {
                await Utils.api('/api/auth/password', {
                    method: 'POST',
                    body: {
                        currentPassword: currentPassword,
                        newPassword: newPass,
                        confirmPassword: confirmPass
                    }
                });
                form.reset();
                document.querySelectorAll('.password-requirements li').forEach(li => li.classList.remove('valid'));
                formOk(form, _('settings.password_changed'));
            } catch (error) {
                formFail(form, error.message || _('errors.password_change_failed'));
            } finally {
                setBusy(btn, false);
            }
        });
    }

    /**
     * Validate password and update UI indicators
     */
    function validatePassword(password) {
        const requirements = {
            'req-length': password.length >= 8,
            'req-uppercase': /[A-Z]/.test(password),
            'req-lowercase': /[a-z]/.test(password),
            'req-number': /[0-9]/.test(password)
        };
        let allMet = true;
        for (const [id, met] of Object.entries(requirements)) {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('valid', met);
            if (!met) allMet = false;
        }
        return allMet;
    }

    /**
     * Console audit log. The log now lives under Activity › Security and
     * audit; this stays for a page that still has the table.
     */
    async function loadAuditLog() {
        const tbody = document.getElementById('audit-log-body');
        if (!tbody) return;
        try {
            const logs = await Utils.api('/api/settings/audit');
            if (!logs || logs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="state-cell">${_('settings.no_audit_logs')}</td></tr>`;
                return;
            }
            tbody.innerHTML = logs.map(log => `
                <tr>
                    <td>${Utils.formatDate(log.created_at)}</td>
                    <td>${Utils.escapeHtml(log.username || '-')}</td>
                    <td>${Utils.escapeHtml(Utils.formatAuditAction(log.action))}</td>
                    <td>${Utils.escapeHtml(log.details || '-')}</td>
                </tr>`).join('');
        } catch (error) {
            tbody.innerHTML = `<tr><td colspan="4" class="state-cell text-danger">${_('errors.load_audit_failed')}</td></tr>`;
        }
    }

    /**
     * Load server info
     */
    async function loadServerInfo() {
        const dbEl = document.getElementById('db-path');
        const uptimeEl = document.getElementById('uptime');
        try {
            const data = await Utils.api('/api/settings/info');
            if (dbEl) dbEl.textContent = data.paths?.database || '-';
            if (uptimeEl) uptimeEl.textContent = formatUptime(data.server?.uptime);
            const goVerEl = document.getElementById('go-server-version');
            if (goVerEl) {
                const goVer = data.goServer?.version;
                goVerEl.textContent = goVer ? `v${goVer}` : '-';
                if (goVer && goVer === 'dev' && data.app?.version && data.app.version !== 'dev') {
                    goVerEl.textContent += ' ' + _('settings.go_server_version_dev_hint');
                }
            }
        } catch (error) {
            if (uptimeEl) uptimeEl.textContent = error.message || _('errors.server_error');
        }
    }

    /**
     * Format uptime in human-readable format
     */
    function formatUptime(seconds) {
        if (!seconds || seconds < 0) return '-';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
        return parts.join(' ');
    }

    // ==================== Device scope default ====================

    function initDeviceScopeSection() {
        const form = document.getElementById('device-scope-form');
        if (!form) return;
        const warningEl = document.getElementById('device-scope-warning');

        function updateWarning() {
            const restricted = document.getElementById('device-scope-restricted')?.checked;
            if (warningEl) warningEl.hidden = !restricted;
        }

        async function loadDeviceScopeSetting() {
            try {
                const data = await Utils.api('/api/settings/device-scope');
                const mode = data.mode === 'restricted' ? 'restricted' : 'open';
                const openEl = document.getElementById('device-scope-open');
                const restrictedEl = document.getElementById('device-scope-restricted');
                if (openEl) openEl.checked = mode === 'open';
                if (restrictedEl) restrictedEl.checked = mode === 'restricted';
                updateWarning();
            } catch (err) {
                formFail(form, err.message || _('errors.server_error'));
            }
        }

        form.querySelectorAll('input[name="device_scope_mode"]').forEach(input => {
            input.addEventListener('change', updateWarning);
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const selected = form.querySelector('input[name="device_scope_mode"]:checked');
            const mode = selected ? selected.value : 'open';
            try {
                await Utils.api('/api/settings/device-scope', { method: 'POST', body: { mode } });
                formOk(form, _('settings.device_scope_saved'));
                updateWarning();
            } catch (err) {
                formFail(form, err.message || _('errors.server_error'));
            }
        });

        loadDeviceScopeSetting();
    }

    // ==================== Availability history (#455) ====================

    function initAvailabilityHistorySection() {
        const form = document.getElementById('availability-history-form');
        if (!form) return;
        const enabledEl = document.getElementById('availability-history-enabled');
        const retentionEl = document.getElementById('availability-history-retention');

        async function loadAvailabilityHistorySetting() {
            try {
                const data = await Utils.api('/api/settings/availability-history');
                if (enabledEl) enabledEl.checked = !!data.enabled;
                if (retentionEl) retentionEl.value = data.retention_days || 30;
            } catch (err) {
                formFail(form, err.message || _('errors.server_error'));
            }
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const enabled = !!(enabledEl && enabledEl.checked);
            let retention = parseInt(retentionEl && retentionEl.value, 10);
            if (!Number.isFinite(retention) || retention < 1) retention = 30;
            try {
                await Utils.api('/api/settings/availability-history', {
                    method: 'POST',
                    body: { enabled, retention_days: retention }
                });
                formOk(form, _('settings.availability_history_saved'));
            } catch (err) {
                formFail(form, err.message || _('errors.server_error'));
            }
        });

        loadAvailabilityHistorySetting();
    }

    // ==================== MeshCentral compatibility ====================

    function initMeshSettingsSection() {
        const panel = document.getElementById('mesh-settings-panel');
        if (!panel) return;

        const enabledEl = document.getElementById('mesh-status-enabled');
        const agentsEl = document.getElementById('mesh-agents-online');
        const serverIdEl = document.getElementById('mesh-server-id');
        const downloadBtn = document.getElementById('mesh-download-msh');
        const copyBtn = document.getElementById('mesh-copy-server-id');
        const nameInput = document.getElementById('mesh-msh-name');
        const certBanner = document.getElementById('mesh-cert-banner');
        const groupsList = document.getElementById('mesh-groups-list');
        const groupsForm = document.getElementById('mesh-groups-form');
        const recordingsTable = document.getElementById('mesh-recordings-table');
        let meshGroups = [];

        function renderMeshGroups() {
            if (!groupsList) return;
            if (!meshGroups.length) {
                groupsList.innerHTML = `<p class="state">${_('mesh.groups_empty')}</p>`;
                return;
            }
            groupsList.innerHTML = '<ul class="list">' + meshGroups.map((g) => {
                const meshId = g.mesh_id
                    ? `<span class="row-sub">MeshID <code>${Utils.escapeHtml(g.mesh_id)}</code></span>`
                    : '';
                return `<li class="list-row mesh-group-row"><span class="row-main">
                    <span class="row-title">${Utils.escapeHtml(g.name || '')} <code>${Utils.escapeHtml(g.id || '')}</code></span>${meshId}
                </span></li>`;
            }).join('') + '</ul>';
        }

        async function loadMeshStatus() {
            try {
                const resp = await Utils.api('/api/mesh/status');
                const data = resp.data || resp;
                if (enabledEl) {
                    enabledEl.innerHTML = data.enabled
                        ? `<span class="status ok">${Utils.escapeHtml(_('mesh.enabled_label'))}</span>`
                        : `<span class="status offline">${Utils.escapeHtml(_('mesh.disabled_label'))}</span>`;
                }
                if (agentsEl) agentsEl.textContent = String(data.agents_online != null ? data.agents_online : 0);
                if (serverIdEl && data.server_id) serverIdEl.textContent = data.server_id;
                if (certBanner) {
                    if (data.enabled && !data.cert_present) {
                        certBanner.textContent = _('mesh.cert_missing');
                        certBanner.classList.remove('hidden');
                        certBanner.classList.add('warning');
                    } else if (data.cert_present) {
                        certBanner.textContent = _('mesh.cert_ok') + (data.cert_modified ? ', ' + data.cert_modified : '');
                        certBanner.classList.remove('hidden', 'warning');
                    } else {
                        certBanner.classList.add('hidden');
                    }
                }
            } catch {
                if (enabledEl) enabledEl.innerHTML = `<span class="status offline">${Utils.escapeHtml(_('mesh.disabled_label'))}</span>`;
            }
        }

        async function loadMeshGroups() {
            if (!groupsList) return;
            try {
                const resp = await Utils.api('/api/mesh/groups');
                const data = resp.data || resp;
                meshGroups = Array.isArray(data.groups) ? data.groups : [];
                renderMeshGroups();
            } catch {
                groupsList.innerHTML = `<p class="state is-error">${_('mesh.groups_load_error')}</p>`;
            }
        }

        async function loadMeshRecordings() {
            if (!recordingsTable) return;
            try {
                const resp = await Utils.api('/api/session/recordings');
                const data = resp.data || resp;
                const rows = Array.isArray(data.recordings) ? data.recordings : [];
                if (!rows.length) {
                    recordingsTable.innerHTML = `<p class="state">${_('mesh.recordings_empty')}</p>`;
                    return;
                }
                recordingsTable.innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr>
                    <th>${_('settings.general.rec_transport')}</th><th>${_('settings.general.rec_device')}</th>
                    <th>${_('settings.general.rec_type')}</th><th>${_('settings.general.rec_size')}</th>
                    <th class="actions"><span class="sr-only">${_('common.actions')}</span></th></tr></thead><tbody>` +
                    rows.map((r) => {
                        const dl = r.transport === 'mesh' && r.id
                            ? `<a class="btn btn-sm" href="/api/mesh/recordings/${encodeURIComponent(r.id)}">${iconHtml('download')}${_('mesh.recording_download')}</a>`
                            : '';
                        return `<tr><td>${Utils.escapeHtml(r.transport || '')}</td><td class="mono">${Utils.escapeHtml(r.peer_id || '')}</td><td>${Utils.escapeHtml(r.session_type || '')}</td><td>${Utils.escapeHtml(formatBytes(Number(r.size) || 0))}</td><td class="actions">${dl}</td></tr>`;
                    }).join('') + '</tbody></table></div>';
            } catch {
                recordingsTable.innerHTML = `<p class="state is-error">${_('mesh.recordings_load_error')}</p>`;
            }
        }

        document.getElementById('mesh-group-add')?.addEventListener('click', () => {
            const idInput = document.getElementById('mesh-group-id');
            const nameInputG = document.getElementById('mesh-group-name');
            const id = idInput?.value.trim();
            const name = nameInputG?.value.trim();
            if (!id || !name) {
                formFail(groupsForm, _('settings.general.mesh_group_needs_both'));
                (id ? nameInputG : idInput)?.focus();
                return;
            }
            meshGroups.push({ id, name });
            if (idInput) idInput.value = '';
            if (nameInputG) nameInputG.value = '';
            renderMeshGroups();
            if (groupsForm && window.UiForm) UiForm.markDirty(groupsForm);
        });

        groupsForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await Utils.api('/api/mesh/groups', { method: 'POST', body: { groups: meshGroups } });
                formOk(groupsForm, _('mesh.groups_saved'));
                loadMeshGroups();
            } catch (err) {
                formFail(groupsForm, err.message || _('mesh.groups_save_error'));
            }
        });

        if (downloadBtn && nameInput) {
            downloadBtn.addEventListener('click', () => {
                const name = encodeURIComponent(nameInput.value.trim() || 'BetterDesk Mesh');
                const group = meshGroups.find((g) => g.id === 'default') || meshGroups[0];
                const meshId = (group && group.mesh_id) ? String(group.mesh_id).trim() : '';
                let href = `/api/mesh/download.msh?name=${name}`;
                if (meshId) href += `&mesh_id=${encodeURIComponent(meshId)}`;
                downloadBtn.href = href;
            });
        }

        copyBtn?.addEventListener('click', () => {
            const text = serverIdEl?.textContent || '';
            if (!text || text === '-') return;
            navigator.clipboard?.writeText(text).then(() => flashCopied(copyBtn)).catch(() => {});
        });

        loadMeshStatus();
        loadMeshGroups();
        loadMeshRecordings();
    }

    // ==================== Connection Mode (P2P / Relay) ====================

    function initConnectionModeSection() {
        const form = document.getElementById('connection-mode-form');
        if (!form) return;
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            saveConnectionMode();
        });
        loadConnectionMode();
    }

    async function loadConnectionMode() {
        const sourceEl = document.getElementById('connection-mode-source');
        const runtimeEl = document.getElementById('connection-mode-runtime');
        const form = document.getElementById('connection-mode-form');
        if (!form) return;
        try {
            const resp = await Utils.api('/api/settings/connection-mode');
            const data = resp.data || resp;
            const mode = data.mode || 'p2p_first';
            const p2pRadio = document.getElementById('conn-mode-p2p');
            const relayRadio = document.getElementById('conn-mode-relay');
            if (p2pRadio) p2pRadio.checked = mode === 'p2p_first';
            if (relayRadio) relayRadio.checked = mode === 'relay_only';

            const fallbackInput = document.getElementById('conn-p2p-fallback-ms');
            if (fallbackInput && data.p2p_fallback_ms != null) fallbackInput.value = data.p2p_fallback_ms;
            const sameNat = document.getElementById('conn-same-nat-relay');
            if (sameNat) sameNat.checked = data.same_nat_relay !== false;
            const sharedNatInit = document.getElementById('conn-allow-shared-nat-initiator');
            if (sharedNatInit) sharedNatInit.checked = data.allow_shared_nat_initiator === true;
            const loggedInOnlyInit = document.getElementById('conn-logged-in-only-initiator');
            if (loggedInOnlyInit) loggedInOnlyInit.checked = data.logged_in_only_initiator === true;
            const operatorOnlyOutbound = document.getElementById('conn-operator-only-outbound');
            if (operatorOnlyOutbound) operatorOnlyOutbound.checked = data.operator_only_outbound === true;

            const src = data.source || data.deployment || 'defaults';
            const writable = data.writable !== false && src !== 'defaults';
            _connectionModeWritable = writable;
            if (sourceEl) {
                sourceEl.textContent = writable
                    ? _('settings.general.conn_saved_in').replace('{place}', src)
                    : _('settings.connection_mode_source_defaults');
            }

            if (runtimeEl && data.runtime) {
                const r = data.runtime;
                runtimeEl.hidden = false;
                runtimeEl.textContent = _('settings.general.conn_running')
                    .replace('{mode}', r.always_use_relay ? _('settings.general.conn_relay') : _('settings.general.conn_p2p'))
                    .replace('{ms}', String(r.p2p_fallback_ms ?? '-'));
            } else if (runtimeEl) {
                runtimeEl.hidden = true;
            }

            const saveBtn = document.getElementById('connection-mode-save');
            if (saveBtn) saveBtn.disabled = !writable;
            _connectionModeSnapshot = getConnectionModePayload();
            renderConnectionDiagram();
        } catch (err) {
            _connectionModeWritable = false;
            if (sourceEl) sourceEl.textContent = err.message || _('errors.server_error');
            formFail(form, err.message || _('errors.server_error'));
        }
    }

    function getConnectionModePayload() {
        const mode = document.querySelector('input[name="connection-mode"]:checked')?.value || 'p2p_first';
        const fallbackMs = parseInt(document.getElementById('conn-p2p-fallback-ms')?.value, 10);
        return {
            mode,
            p2p_fallback_ms: Number.isFinite(fallbackMs) ? fallbackMs : 2000,
            same_nat_relay: document.getElementById('conn-same-nat-relay')?.checked !== false,
            allow_shared_nat_initiator: document.getElementById('conn-allow-shared-nat-initiator')?.checked === true,
            logged_in_only_initiator: document.getElementById('conn-logged-in-only-initiator')?.checked === true,
            operator_only_outbound: document.getElementById('conn-operator-only-outbound')?.checked === true
        };
    }

    async function saveConnectionMode() {
        const form = document.getElementById('connection-mode-form');
        const saveBtn = document.getElementById('connection-mode-save');
        if (saveBtn) saveBtn.disabled = true;
        try {
            const payload = getConnectionModePayload();
            const resp = await Utils.api('/api/settings/connection-mode', {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            await loadConnectionMode();
            formOk(form, resp.message || _('settings.connection_mode_saved'));
            const result = resp.data || resp;
            if (result.restartRequired) showRestartPrompt(result.restartRequired);
        } catch (err) {
            formFail(form, err.message || _('errors.server_error'));
        } finally {
            if (saveBtn) saveBtn.disabled = !_connectionModeWritable;
        }
    }

    // ==================== Public RustDesk client endpoints ====================

    function initPublicEndpointsSection() {
        const form = document.getElementById('public-endpoints-form');
        if (!form) return;
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            savePublicEndpoints();
        });
        loadPublicEndpoints();
    }

    async function loadPublicEndpoints() {
        const form = document.getElementById('public-endpoints-form');
        try {
            const resp = await Utils.api('/api/settings/public-endpoints');
            const data = resp.data || resp;
            const serverIdEl = document.getElementById('public-server-id');
            const relayEl = document.getElementById('public-relay-server');
            const apiEl = document.getElementById('public-api-url');
            if (serverIdEl) serverIdEl.value = data.public_server_id || '';
            if (relayEl) relayEl.value = data.public_relay_server || '';
            if (apiEl) apiEl.value = data.public_api_url || '';
            renderConnectionDiagram();
        } catch (err) {
            formFail(form, err.message || _('errors.server_error'));
        }
    }

    function getPublicEndpointsPayload() {
        return {
            public_server_id: document.getElementById('public-server-id')?.value?.trim() || '',
            public_relay_server: document.getElementById('public-relay-server')?.value?.trim() || '',
            public_api_url: document.getElementById('public-api-url')?.value?.trim() || '',
        };
    }

    async function savePublicEndpoints() {
        const form = document.getElementById('public-endpoints-form');
        const confirmed = await settingsConfirmCritical({
            title: tSettings('public_endpoints_save_title', 'Save public client endpoints?'),
            message: tSettings('public_endpoints_save_confirm', 'Update RustDesk client configuration values used on the Dashboard (ID server, relay, API URL)?'),
            confirmLabel: _('settings.public_endpoints_save'),
            danger: false
        });
        if (!confirmed) return;

        const saveBtn = document.getElementById('public-endpoints-save');
        if (saveBtn) saveBtn.disabled = true;
        try {
            const resp = await Utils.api('/api/settings/public-endpoints', {
                method: 'PUT',
                body: JSON.stringify(getPublicEndpointsPayload())
            });
            await loadPublicEndpoints();
            loadClientConfigSummary();
            formOk(form, resp.message || _('settings.public_endpoints_saved'));
        } catch (err) {
            formFail(form, err.message || _('errors.server_error'));
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    // ==================== TOTP (2FA) Section ====================
    
    async function initTotpSection() {
        const container = document.getElementById('totp-status-container');
        if (!container) return;
        try {
            const data = await Utils.api('/api/auth/totp/status');
            if (data.enabled) renderTotpEnabled(container);
            else renderTotpDisabled(container);
        } catch (error) {
            container.innerHTML = `<p class="state is-error">${Utils.escapeHtml(error.message || _('errors.server_error'))}
                <button type="button" class="btn btn-sm" id="totp-retry-btn">${_('actions.retry')}</button></p>`;
            document.getElementById('totp-retry-btn')?.addEventListener('click', initTotpSection);
        }
    }

    function renderTotpEnabled(container) {
        container.innerHTML = `
            <p><span class="status ok">${_('settings.signin.totp_on')}</span></p>
            <p class="form-hint">${_('settings.totp_enabled_desc')}</p>
            <p><button type="button" class="btn btn-danger-quiet" id="totp-disable-btn">${_('settings.signin.totp_turn_off')}</button></p>`;
        document.getElementById('totp-disable-btn')?.addEventListener('click', handleDisableTotp);
        setSideOnOff('side-totp', true);
    }

    function renderTotpDisabled(container) {
        container.innerHTML = `
            <p><span class="status offline">${_('settings.signin.totp_off')}</span></p>
            <p class="form-hint">${_('settings.totp_disabled_desc')}</p>
            <p><button type="button" class="btn" id="totp-setup-btn">${_('settings.signin.totp_set_up')}</button></p>
            <p class="field-effect">${_('settings.signin.totp_effect')}</p>`;
        document.getElementById('totp-setup-btn')?.addEventListener('click', handleSetupTotp);
        setSideOnOff('side-totp', false);
    }

    async function handleSetupTotp() {
        const container = document.getElementById('totp-status-container');
        try {
            const data = await Utils.api('/api/auth/totp/setup', { method: 'POST' });
            container.innerHTML = `
                <ol class="steps totp-steps">
                    <li>${_('settings.totp_step1')}</li>
                    <li>${_('settings.totp_step2')}</li>
                    <li>${_('settings.totp_step3')}</li>
                </ol>
                <img src="${Utils.escapeHtml(data.qrCode)}" alt="${_('settings.signin.totp_qr_alt')}" class="totp-qr-image" width="200" height="200">
                <div class="form-group">
                    <span class="form-label">${_('settings.totp_manual_key')}</span>
                    <span class="value-field"><code id="totp-secret-code">${Utils.escapeHtml(data.secret)}</code><button type="button" id="totp-copy-secret-btn">${iconHtml('copy')}<span class="btn-label">${_('actions.copy')}</span></button></span>
                </div>
                <form class="totp-verify-form" id="totp-verify-form" novalidate>
                    <div class="form-group">
                        <label class="form-label" for="totp-setup-code">${_('settings.totp_enter_code')}</label>
                        <input type="text" id="totp-setup-code" class="form-input is-short totp-input"
                               inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code">
                    </div>
                    <div class="settings-inline-controls">
                        <button type="submit" class="btn btn-primary" id="totp-verify-btn">${_('settings.signin.totp_verify')}</button>
                        <button type="button" class="btn" id="totp-cancel-btn">${_('actions.cancel')}</button>
                        <span class="form-status" id="totp-verify-status" aria-live="polite"></span>
                    </div>
                </form>`;
            const codeInput = document.getElementById('totp-setup-code');
            const status = document.getElementById('totp-verify-status');
            codeInput?.focus();
            codeInput?.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/[^0-9]/g, '');
            });
            document.getElementById('totp-verify-form')?.addEventListener('submit', async (e) => {
                e.preventDefault();
                const code = codeInput.value.trim();
                if (!code || code.length !== 6) {
                    setStatus(status, _('auth.totp_enter_code'), 'error');
                    codeInput.focus();
                    return;
                }
                try {
                    const result = await Utils.api('/api/auth/totp/enable', { method: 'POST', body: { code } });
                    showRecoveryCodes(container, result.recoveryCodes);
                } catch (err) {
                    setStatus(status, err.message || _('auth.totp_invalid_code'), 'error');
                }
            });
            document.getElementById('totp-cancel-btn')?.addEventListener('click', initTotpSection);
            const copyBtn = document.getElementById('totp-copy-secret-btn');
            copyBtn?.addEventListener('click', () => {
                navigator.clipboard?.writeText(data.secret).then(() => flashCopied(copyBtn)).catch(() => {});
            });
        } catch (error) {
            container.insertAdjacentHTML('beforeend', `<p class="form-status is-error">${Utils.escapeHtml(error.message || _('errors.server_error'))}</p>`);
        }
    }

    function showRecoveryCodes(container, codes) {
        const list = Array.isArray(codes) ? codes : [];
        container.innerHTML = `
            <p><span class="status ok">${_('settings.totp_enabled_success')}</span></p>
            <p class="notice warning">${_('settings.totp_recovery_warning')}</p>
            <div class="code-block-head"><span class="code-block-title">${_('settings.signin.recovery_codes')}</span>
                <button type="button" class="btn btn-sm" id="copy-recovery-btn">${iconHtml('copy')}<span class="btn-label">${_('actions.copy')}</span></button></div>
            <pre class="code-block totp-recovery-codes">${list.map((c) => Utils.escapeHtml(c)).join('\n')}</pre>
            <p><button type="button" class="btn btn-primary" id="totp-done-btn">${_('settings.signin.recovery_saved')}</button></p>`;
        const copyBtn = document.getElementById('copy-recovery-btn');
        copyBtn?.addEventListener('click', () => {
            navigator.clipboard?.writeText(list.join('\n')).then(() => flashCopied(copyBtn)).catch(() => {});
        });
        document.getElementById('totp-done-btn')?.addEventListener('click', initTotpSection);
    }

    async function handleDisableTotp() {
        const container = document.getElementById('totp-status-container');
        container.innerHTML = `
            <form id="totp-disable-form" class="totp-disable-confirm" novalidate>
                <p class="notice warning">${_('settings.totp_disable_warning')}</p>
                <div class="form-group">
                    <label class="form-label" for="totp-disable-password">${_('settings.current_password')}</label>
                    <input type="password" id="totp-disable-password" class="form-input" autocomplete="current-password" required>
                </div>
                <div class="settings-inline-controls">
                    <button type="submit" class="btn btn-danger-quiet" id="confirm-disable-btn">${_('settings.signin.totp_turn_off')}</button>
                    <button type="button" class="btn" id="cancel-disable-btn">${_('actions.cancel')}</button>
                    <span class="form-status" id="totp-disable-status" aria-live="polite"></span>
                </div>
            </form>`;
        const pw = document.getElementById('totp-disable-password');
        const status = document.getElementById('totp-disable-status');
        pw?.focus();
        document.getElementById('totp-disable-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = pw.value;
            if (!password) {
                setStatus(status, _('auth.fill_all_fields'), 'error');
                return;
            }
            try {
                await Utils.api('/api/auth/totp/disable', { method: 'POST', body: { password } });
                await initTotpSection();
                container.insertAdjacentHTML('afterbegin', `<p class="form-status is-ok">${_('settings.totp_disabled_success')}</p>`);
            } catch (err) {
                setStatus(status, err.message || _('errors.server_error'), 'error');
            }
        });
        document.getElementById('cancel-disable-btn')?.addEventListener('click', initTotpSection);
    }

    // ==================== Appearance (branding) ====================

    let brandingData = null;
    let _brandingSnapshot = null;
    let _brandingDirty = false;
    let _canBrandingEdit = true;
    let _fontSource = 'google';
    let _brandingProfiles = [];
    let _pendingLogoFile = null;
    let _savedThemeMode = 'system';
    const _backgroundUploads = new Map();
    const MAX_LOGIN_SLIDES = 10;
    const DEFAULT_LOGIN_SLIDES = [
        { id: 'free', slideKey: 'free', order: 0, imageUrl: '/img/login-slides/free.jpg', title: '', body: '', overlay: '45' },
        { id: 'remote', slideKey: 'remote', order: 1, imageUrl: '/img/login-slides/remote.jpg', title: '', body: '', overlay: '45' },
        { id: 'secure', slideKey: 'secure', order: 2, imageUrl: '/img/login-slides/secure.jpg', title: '', body: '', overlay: '45' },
        { id: 'platforms', slideKey: 'platforms', order: 3, imageUrl: '/img/login-slides/platforms.jpg', title: '', body: '', overlay: '45' }
    ];
    let _loginSlides = DEFAULT_LOGIN_SLIDES.map((s) => ({ ...s }));

    const brandingForm = () => document.getElementById('branding-form');

    /**
     * Initialize the appearance page
     */
    async function initBrandingSection() {
        const tab = document.getElementById('tab-branding');
        if (!tab) return;
        _canBrandingEdit = tab.dataset.canBrandingEdit !== '0';

        try {
            const response = await Utils.api('/api/settings/branding');
            brandingData = response.data || response;
            _savedThemeMode = brandingData.themeMode || 'system';
            populateBrandingForm(brandingData);
            updateBrandingReadability(response.readability);
            _brandingSnapshot = JSON.stringify(collectBrandingData());
            initLogoTypeSelector();
            initColorPickers();
            initFontPickers();
            initFontSourceTabs();
            initBackgroundSelectors();
            initLoginSlidesEditor();
            if (_canBrandingEdit) {
                initBrandingProfiles();
                initBrandingActions();
            }
            initBuiltinThemes();
            initBrandingFieldTracking();
            setBrandingStatus('saved', '');
        } catch (error) {
            const form = brandingForm();
            form?.insertAdjacentHTML('beforebegin', `<p class="state is-error">${Utils.escapeHtml(error.message || _('errors.server_error'))}</p>`);
        }
        initThemePreview();
    }

    /** Appearance save bar: saved / dirty / saving / error. */
    function setBrandingStatus(state, message) {
        const form = brandingForm();
        if (!form || !window.UiForm) return;
        const status = form.querySelector('[data-save-status]');
        if (state === 'dirty') {
            UiForm.markDirty(form);
        } else if (state === 'saving') {
            if (status) status.textContent = _('branding.status_saving');
        } else if (state === 'error') {
            UiForm.failed(form, message || _('branding.status_error'));
        } else if (message === '') {
            UiForm.reset(form);
        } else {
            UiForm.saved(form, message || _('branding.status_saved'));
        }
    }

    function onBrandingFieldChange() {
        if (!_canBrandingEdit) return;
        const current = JSON.stringify(collectBrandingData());
        _brandingDirty = current !== _brandingSnapshot || !!_pendingLogoFile;
        const form = brandingForm();
        if (_brandingDirty) setBrandingStatus('dirty');
        else if (form && window.UiForm && UiForm.isDirty(form)) UiForm.reset(form);
    }

    function initBrandingFieldTracking() {
        const form = brandingForm();
        if (!form) return;
        const onEvent = (event) => {
            if (event.target?.closest('[data-save-ignore]')) return;
            onBrandingFieldChange();
        };
        form.addEventListener('input', onEvent);
        form.addEventListener('change', onEvent);
    }

    async function uploadPendingLogo() {
        if (!_pendingLogoFile) return;
        const formData = new FormData();
        formData.append('logo', _pendingLogoFile);
        const resp = await fetch('/api/settings/branding/upload-logo', {
            method: 'POST',
            headers: { 'x-csrf-token': window.BetterDesk?.csrfToken || '' },
            body: formData
        });
        const result = await resp.json().catch(() => ({}));
        if (!resp.ok || !result.success) throw new Error(result.error || _('errors.server_error'));
        const urlInput = document.getElementById('logo-image-url');
        if (urlInput) urlInput.value = result.url;
        _pendingLogoFile = null;
        const fileInput = document.getElementById('logo-image-file');
        if (fileInput) fileInput.value = '';
        const note = document.getElementById('logo-file-name');
        if (note) note.textContent = _('settings.appearance.logo_upload_effect');
    }

    async function saveBrandingNow() {
        if (!_canBrandingEdit) return false;
        const btn = document.getElementById('branding-save-btn');
        setBusy(btn, true);
        setBrandingStatus('saving');
        try {
            await waitForBackgroundUploads();
            await uploadPendingLogo();
            const data = collectBrandingData();
            const resp = await Utils.api('/api/settings/branding', { method: 'POST', body: data });
            brandingData = resp.data || data;
            _savedThemeMode = data.themeMode;
            updateBrandingReadability(resp.readability);
            _brandingSnapshot = JSON.stringify(collectBrandingData());
            _brandingDirty = false;
            setBrandingStatus('saved', _('branding.saved'));
            refreshBrandingStylesheet(resp.revision || Date.now());
            applyBrandingToChrome(data);
            return true;
        } catch (error) {
            setBrandingStatus('error', error.message || _('errors.server_error'));
            return false;
        } finally {
            setBusy(btn, false);
        }
    }

    function updateBrandingReadability(readability) {
        const box = document.getElementById('branding-readability-alert');
        const text = document.getElementById('branding-readability-text');
        if (!box || !text) return;
        const issues = Array.isArray(readability?.issues) ? readability.issues : [];
        if (!issues.length) {
            box.hidden = true;
            text.textContent = '';
            return;
        }
        const errors = issues.filter(issue => issue.severity === 'error');
        box.hidden = false;
        box.classList.toggle('error', errors.length > 0);
        text.textContent = issues.slice(0, 3).map(issue => {
            if (issue.messageKey) {
                const translated = _(issue.messageKey, issue.messageParams || {});
                if (translated !== issue.messageKey) return translated;
            }
            return issue.message || '';
        }).filter(Boolean).join(' ');
    }

    async function waitForBackgroundUploads() {
        const pending = Array.from(_backgroundUploads.values());
        if (!pending.length) return;
        await Promise.all(pending);
    }

    function revertBrandingChanges() {
        if (!_brandingSnapshot) return;
        try {
            const data = JSON.parse(_brandingSnapshot);
            _pendingLogoFile = null;
            const fileInput = document.getElementById('logo-image-file');
            if (fileInput) fileInput.value = '';
            const note = document.getElementById('logo-file-name');
            if (note) note.textContent = _('settings.appearance.logo_upload_effect');
            populateBrandingForm(data);
            _brandingDirty = false;
            setBrandingStatus('saved', '');
        } catch (e) {
            setBrandingStatus('error', e.message);
        }
    }

    /** Re-read the saved appearance after an action that saved it on the server. */
    async function reloadBrandingFromServer(revision) {
        const fresh = await Utils.api('/api/settings/branding');
        brandingData = fresh.data || fresh;
        _savedThemeMode = brandingData.themeMode || 'system';
        populateBrandingForm(brandingData);
        _brandingSnapshot = JSON.stringify(collectBrandingData());
        _brandingDirty = false;
        setBrandingStatus('saved', '');
        refreshBrandingStylesheet(revision || Date.now());
    }

    function applyBrandingToChrome(data) {
        const name = data.appName || 'BetterDesk';
        document.querySelectorAll('.sidebar-logo-text, .brand-text-logo').forEach(el => {
            if (data.logoType === 'text' && data.logoText) el.textContent = data.logoText;
        });
        document.title = document.title.replace(/[^-]+$/, ' ' + name);
        const favicon = document.querySelector('link[rel="icon"]');
        if (favicon) favicon.href = `/branding/favicon.svg?v=${Date.now()}`;
    }

    function refreshBrandingStylesheet(revision) {
        const rev = revision || Date.now();
        document.querySelectorAll('link[href*="/css/branding.css"]').forEach(link => {
            const base = link.getAttribute('href').split('?')[0];
            link.setAttribute('href', `${base}?v=${encodeURIComponent(rev)}`);
        });
    }

    async function brandingPrompt(message, options = {}) {
        if (window.Modal && typeof Modal.prompt === 'function') {
            return Modal.prompt({
                title: options.title || _('settings.tab_branding'),
                label: message,
                placeholder: options.placeholder || '',
                confirmLabel: options.confirmLabel || _('actions.save')
            });
        }
        return prompt(message);
    }

    async function brandingConfirm(message, options = {}) {
        if (window.Modal && typeof Modal.confirm === 'function') {
            return Modal.confirm({
                title: options.title || _('settings.tab_branding'),
                message,
                danger: !!options.danger,
                confirmLabel: options.confirmLabel || _('actions.confirm')
            });
        }
        return confirm(message);
    }

    async function initBrandingProfiles() {
        const select = document.getElementById('branding-profile-select');
        const status = document.getElementById('branding-profile-status');
        if (!select) return;
        await refreshBrandingProfiles(select);

        const run = async (fn, okMessage) => {
            setStatus(status, '');
            try {
                await fn();
                if (okMessage) setStatus(status, okMessage, 'ok');
            } catch (e) {
                setStatus(status, e.message || _('errors.server_error'), 'error');
            }
        };

        document.getElementById('branding-profile-apply-btn')?.addEventListener('click', () => {
            const id = parseInt(select.value, 10);
            if (!id) {
                setStatus(status, _('branding.profile_select_first'), 'error');
                return;
            }
            run(async () => {
                const resp = await Utils.api(`/api/settings/branding/profiles/${id}/apply`, { method: 'POST' });
                if (resp.data) {
                    brandingData = resp.data;
                    _savedThemeMode = brandingData.themeMode || 'system';
                    populateBrandingForm(brandingData);
                    _brandingSnapshot = JSON.stringify(collectBrandingData());
                    _brandingDirty = false;
                    setBrandingStatus('saved', '');
                    refreshBrandingStylesheet(resp.revision || Date.now());
                } else {
                    await reloadBrandingFromServer(resp.revision);
                }
            }, _('branding.profile_applied'));
        });

        document.getElementById('branding-profile-new-btn')?.addEventListener('click', async () => {
            const name = await brandingPrompt(_('branding.profile_name_prompt'));
            if (!name || !name.trim()) return;
            run(async () => {
                await Utils.api('/api/settings/branding/profiles', {
                    method: 'POST',
                    body: { name: name.trim(), description: '', branding: collectBrandingData() }
                });
                await refreshBrandingProfiles(select);
            }, _('branding.profile_created'));
        });

        document.getElementById('branding-profile-save-btn')?.addEventListener('click', () => {
            const id = parseInt(select.value, 10);
            if (!id) {
                setStatus(status, _('branding.profile_select_first'), 'error');
                return;
            }
            run(() => Utils.api(`/api/settings/branding/profiles/${id}`, {
                method: 'PUT',
                body: { branding: collectBrandingData() }
            }), _('branding.profile_updated'));
        });

        document.getElementById('branding-profile-duplicate-btn')?.addEventListener('click', () => {
            const id = parseInt(select.value, 10);
            if (!id) {
                setStatus(status, _('branding.profile_select_first'), 'error');
                return;
            }
            run(async () => {
                const profile = _brandingProfiles.find(item => String(item.id) === String(id));
                const copyName = profile ? `${profile.name} (${_('branding.profile_duplicate')})` : '';
                const resp = await Utils.api(`/api/settings/branding/profiles/${id}/duplicate`, {
                    method: 'POST',
                    body: copyName ? { name: copyName } : {}
                });
                await refreshBrandingProfiles(select, resp?.data?.id);
            }, _('branding.profile_duplicated'));
        });

        document.getElementById('branding-profile-delete-btn')?.addEventListener('click', async () => {
            const id = parseInt(select.value, 10);
            if (!id) {
                setStatus(status, _('branding.profile_select_first'), 'error');
                return;
            }
            if (!(await brandingConfirm(_('branding.profile_delete_confirm'), { danger: true, confirmLabel: _('branding.profile_delete') }))) return;
            run(async () => {
                await Utils.api(`/api/settings/branding/profiles/${id}`, { method: 'DELETE' });
                await refreshBrandingProfiles(select);
            }, _('branding.profile_deleted'));
        });
    }

    async function refreshBrandingProfiles(select, selectedId = '') {
        try {
            const resp = await Utils.api('/api/settings/branding/profiles');
            _brandingProfiles = resp.data || resp || [];
            select.innerHTML = `<option value="">${_('branding.profile_none')}</option>`;
            const preferredId = selectedId ? String(selectedId) : '';
            _brandingProfiles.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.is_active ? `${p.name} (${_('branding.profile_active')})` : p.name;
                if (preferredId ? String(p.id) === preferredId : p.is_active) opt.selected = true;
                select.appendChild(opt);
            });
        } catch (e) {
            setStatus(document.getElementById('branding-profile-status'), e.message || _('errors.server_error'), 'error');
        }
    }

    /** Built-in themes: a select and an Apply button. Applying saves right away. */
    async function initBuiltinThemes() {
        const select = document.getElementById('branding-theme-select');
        const applyBtn = document.getElementById('branding-theme-apply');
        if (!select) return;
        let themes = [];
        try {
            const resp = await Utils.api('/api/settings/themes');
            themes = resp.data || resp || [];
            themes.forEach((theme) => {
                const opt = document.createElement('option');
                opt.value = theme.id;
                opt.textContent = theme.name || theme.id;
                if (theme.description) opt.title = theme.description;
                select.appendChild(opt);
            });
        } catch (e) {
            select.disabled = true;
        }

        applyBtn?.addEventListener('click', async () => {
            if (!_canBrandingEdit) return;
            const theme = themes.find((t) => t.id === select.value);
            if (!theme) {
                setBrandingStatus('error', _('settings.appearance.pick_theme_first'));
                select.focus();
                return;
            }
            if (!(await brandingConfirm(_('branding.theme_apply_confirm'), { confirmLabel: _('settings.appearance.apply_theme') }))) return;
            setBusy(applyBtn, true);
            try {
                await Utils.api(`/api/settings/themes/${encodeURIComponent(theme.id)}/apply`, { method: 'POST' });
                await reloadBrandingFromServer();
                setBrandingStatus('saved', _('branding.theme_applied'));
            } catch (e) {
                setBrandingStatus('error', e.message || _('errors.server_error'));
            } finally {
                setBusy(applyBtn, false);
            }
        });
    }

    function initFontSourceTabs() {
        document.querySelectorAll('.font-source-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                _fontSource = tab.dataset.fontSource || 'google';
                document.querySelectorAll('.font-source-tab').forEach(t => {
                    t.classList.toggle('active', t === tab);
                    t.setAttribute('aria-pressed', t === tab ? 'true' : 'false');
                });
                document.querySelectorAll('.font-source-panel').forEach(p => p.classList.remove('active'));
                const panel = document.getElementById(`font-source-${_fontSource}`);
                if (panel) panel.classList.add('active');
                if (_fontSource === 'local') renderLocalFontList();
            });
        });
        document.getElementById('font-upload-file')?.addEventListener('change', handleFontUpload);
        renderLocalFontList();
    }

    async function renderLocalFontList() {
        const list = document.getElementById('font-local-list');
        if (!list) return;
        try {
            const fonts = await Utils.api('/api/settings/fonts/local');
            if (!fonts || !fonts.length) {
                list.innerHTML = `<li class="list-row is-empty"><span class="row-main">${_('branding.font_local_empty')}</span></li>`;
                return;
            }
            list.innerHTML = fonts.map((font) => `
                <li class="list-row font-local-item">
                    <span class="row-main"><span class="row-title" style="font-family:'${Utils.escapeHtml(font.family)}',sans-serif">${Utils.escapeHtml(font.family)}</span></span>
                    <span class="row-end">${_canBrandingEdit ? `<button type="button" class="btn btn-sm btn-danger-quiet font-local-delete" data-family="${Utils.escapeHtml(font.family)}">${_('branding.font_delete')}</button>` : ''}</span>
                </li>`).join('');
            list.querySelectorAll('.font-local-delete').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    try {
                        await Utils.api(`/api/settings/fonts/${encodeURIComponent(btn.dataset.family)}`, { method: 'DELETE' });
                        renderLocalFontList();
                        loadLocalFontCount();
                    } catch (e) {
                        Notifications.error(e.message || _('errors.server_error'));
                    }
                });
            });
        } catch (e) {
            list.innerHTML = `<li class="list-row is-empty"><span class="row-main text-danger">${Utils.escapeHtml(e.message || _('errors.server_error'))}</span></li>`;
        }
    }

    async function handleFontUpload(e) {
        const file = e.target.files[0];
        if (!file || !_canBrandingEdit) return;
        const family = document.getElementById('font-upload-name')?.value.trim() || file.name.replace(/\.[^.]+$/, '');
        const formData = new FormData();
        formData.append('font', file);
        formData.append('family', family);
        try {
            const resp = await fetch('/api/settings/fonts/upload', {
                method: 'POST',
                headers: { 'x-csrf-token': window.BetterDesk?.csrfToken || '' },
                body: formData
            });
            const result = await resp.json();
            if (!resp.ok || !result.success) throw new Error(result.error || _('errors.server_error'));
            setBrandingStatus('saved', _('branding.font_upload_success'));
            renderLocalFontList();
            loadLocalFontCount();
        } catch (err) {
            setBrandingStatus('error', err.message || _('errors.server_error'));
        } finally {
            e.target.value = '';
        }
    }

    /** Show the custom colours only for the Custom theme. */
    function syncCustomColorsVisibility() {
        const mode = document.querySelector('input[name="theme-mode"]:checked')?.value || 'system';
        const section = document.getElementById('branding-custom-colors');
        if (section) section.hidden = mode !== 'custom';
        document.querySelectorAll('[data-toc-custom]').forEach((el) => { el.hidden = mode !== 'custom'; });
    }

    /**
     * Populate branding form with current config
     */
    function populateBrandingForm(data) {
        const nameInput = document.getElementById('brand-name');
        const descInput = document.getElementById('brand-description');
        if (nameInput) nameInput.value = data.appName || '';
        if (descInput) descInput.value = data.appDescription || '';

        const logoTypeRadio = document.querySelector(`input[name="logo-type"][value="${data.logoType || 'icon'}"]`);
        if (logoTypeRadio) {
            logoTypeRadio.checked = true;
            showLogoPanel(data.logoType || 'icon');
        }

        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
        const checkRadio = (name, val) => {
            const r = document.querySelector(`input[name="${name}"][value="${val}"]`);
            if (r) r.checked = true;
        };
        const syncPicker = (pickerId, value) => {
            const picker = document.getElementById(pickerId);
            if (picker && /^#[0-9a-fA-F]{6}$/.test(value || '')) picker.value = value;
        };

        setVal('logo-icon-name', data.logoIcon || 'dns');
        setVal('logo-svg-input', data.logoSvg || '');
        setVal('logo-image-url', data.logoUrl || '');
        setVal('logo-text-input', data.logoText || '');
        setVal('logo-text-accent', data.logoTextAccent || '');

        setFontPickerValue('heading', data.fontHeading || '', true);
        setFontPickerValue('body', data.fontBody || '', true);

        // Colours: the stored palette is what the Custom theme uses
        if (data.colors) {
            for (const [key, value] of Object.entries(data.colors)) {
                if (!value) continue;
                const picker = document.querySelector(`.color-picker[data-color="${key}"]`);
                const hex = document.querySelector(`.color-hex[data-color="${key}"]`);
                if (picker && /^#[0-9a-fA-F]{6}$/.test(value)) picker.value = value;
                if (hex) hex.value = value;
            }
        }

        const themeMode = data.themeMode === 'auto' ? 'dark' : (data.themeMode || 'system');
        const themeRadio = document.querySelector(`input[name="theme-mode"][value="${themeMode}"]`)
            || document.querySelector('input[name="theme-mode"][value="system"]');
        if (themeRadio) themeRadio.checked = true;
        syncCustomColorsVisibility();

        // Console background
        checkRadio('bg-type', data.bgType || 'none');
        setVal('bg-color', data.bgColor || '');
        setVal('bg-gradient', data.bgGradient || '');
        setVal('bg-image-url', data.bgImageUrl || '');
        setVal('bg-blur', data.bgBlur || '0');
        setVal('bg-overlay', data.bgOverlay || '0');
        setVal('bg-size', data.bgSize || 'cover');
        syncPicker('bg-color-picker', data.bgColor);
        const bgBlurVal = document.getElementById('bg-blur-value');
        if (bgBlurVal) bgBlurVal.textContent = data.bgBlur || '0';
        const bgOverlayVal = document.getElementById('bg-overlay-value');
        if (bgOverlayVal) bgOverlayVal.textContent = data.bgOverlay || '0';
        showBackgroundPanel('bg', data.bgType || 'none');

        // Glass surfaces
        setChecked('glass-enabled', data.glassEnabled !== 'false');
        setVal('glass-color', data.glassColor || '#161b22');
        setVal('glass-blur', data.glassBlur || '16');
        setVal('glass-opacity', data.glassOpacity || '55');
        syncPicker('glass-color-picker', data.glassColor);
        const glassBlurVal = document.getElementById('glass-blur-value');
        if (glassBlurVal) glassBlurVal.textContent = data.glassBlur || '16';
        const glassOpacityVal = document.getElementById('glass-opacity-value');
        if (glassOpacityVal) glassOpacityVal.textContent = data.glassOpacity || '55';

        // Sign-in page
        setVal('login-title', data.loginTitle || '');
        setVal('login-subtitle', data.loginSubtitle || '');
        checkRadio('login-promo-mode', data.loginPromoMode || 'slides');
        checkRadio('login-bg-type', data.loginBgType || 'inherit');
        setVal('login-bg-color', data.loginBgColor || '');
        setVal('login-bg-gradient', data.loginBgGradient || '');
        setVal('login-bg-image-url', data.loginBgImageUrl || '');
        setVal('login-bg-overlay', data.loginBgOverlay || '0');
        syncPicker('login-bg-color-picker', data.loginBgColor);
        const loginOverlayVal = document.getElementById('login-bg-overlay-value');
        if (loginOverlayVal) loginOverlayVal.textContent = data.loginBgOverlay || '0';
        showBackgroundPanel('login-bg', data.loginBgType || 'inherit');
        _loginSlides = Array.isArray(data.loginSlides) && data.loginSlides.length
            ? data.loginSlides.map((s, i) => ({
                id: s.id || `slide-${i + 1}`,
                slideKey: s.slideKey || '',
                order: i,
                imageUrl: s.imageUrl || '',
                title: s.title || '',
                body: s.body || '',
                overlay: String(s.overlay != null ? s.overlay : '45')
            }))
            : DEFAULT_LOGIN_SLIDES.map((s) => ({ ...s }));
        renderLoginSlidesEditor();
        syncLoginPromoPanels();

        // Download page
        checkRadio('agent-bg-type', data.agentBgType || 'none');
        setVal('agent-bg-color', data.agentBgColor || '');
        setVal('agent-bg-gradient', data.agentBgGradient || '');
        setVal('agent-bg-image-url', data.agentBgImageUrl || '');
        setChecked('agent-show-powered', data.agentShowPoweredBy !== 'false');
        syncPicker('agent-bg-color-picker', data.agentBgColor);
        showBackgroundPanel('agent-bg', data.agentBgType || 'none');

        // Remote client (RdClient)
        checkRadio('rdclient-bg-type', data.rdclientBgType || 'inherit');
        setVal('rdclient-bg-color', data.rdclientBgColor || '');
        setVal('rdclient-bg-gradient', data.rdclientBgGradient || '');
        setVal('rdclient-bg-image-url', data.rdclientBgImageUrl || '');
        setVal('rdclient-bg-overlay', data.rdclientBgOverlay || '0');
        setVal('rdclient-bg-size', data.rdclientBgSize || 'cover');
        syncPicker('rdclient-bg-color-picker', data.rdclientBgColor);
        const rdclientOverlayVal = document.getElementById('rdclient-bg-overlay-value');
        if (rdclientOverlayVal) rdclientOverlayVal.textContent = data.rdclientBgOverlay || '0';
        showBackgroundPanel('rdclient-bg', data.rdclientBgType || 'inherit');
        syncExistingBackgroundUploadStatuses(data);
        markSelectedBackgroundImage(data.bgImageUrl || '');

        // Footer & custom CSS
        setVal('footer-text', data.footerText || '');
        setChecked('show-powered', data.showPoweredBy !== 'false');
        setVal('custom-css', data.customCss || '');
    }

    /**
     * Show the active panel for a background group (bg / login-bg / agent-bg /
     * rdclient-bg) and hide the rest. "none"/"inherit" hide all detail panels.
     */
    function showBackgroundPanel(prefix, type) {
        ['none', 'inherit', 'color', 'gradient', 'image'].forEach(t => {
            const panel = document.getElementById(`${prefix}-${t}-panel`);
            if (panel) panel.classList.add('hidden');
        });
        const active = document.getElementById(`${prefix}-${type}-panel`);
        if (active) active.classList.remove('hidden');
    }

    function syncLoginPromoPanels() {
        const mode = document.querySelector('input[name="login-promo-mode"]:checked')?.value || 'slides';
        const slidesPanel = document.getElementById('login-slides-panel');
        const bgConfig = document.getElementById('login-bg-config');
        if (slidesPanel) slidesPanel.hidden = mode !== 'slides';
        if (bgConfig) bgConfig.hidden = mode === 'slides';
    }

    function collectLoginSlidesFromDom() {
        const list = document.getElementById('login-slides-list');
        if (!list) return _loginSlides.slice(0, MAX_LOGIN_SLIDES);
        const cards = Array.from(list.querySelectorAll('.login-slide-card'));
        return cards.slice(0, MAX_LOGIN_SLIDES).map((card, i) => ({
            id: card.dataset.slideId || `slide-${i + 1}`,
            slideKey: card.dataset.slideKey || '',
            order: i,
            imageUrl: card.querySelector('.login-slide-image-url')?.value.trim() || '',
            title: card.querySelector('.login-slide-title')?.value.trim() || '',
            body: card.querySelector('.login-slide-body')?.value.trim() || '',
            overlay: card.querySelector('.login-slide-overlay')?.value || '45'
        }));
    }

    function renderLoginSlidesEditor() {
        const list = document.getElementById('login-slides-list');
        if (!list) return;
        const esc = Utils.escapeHtml;
        const n = _loginSlides.length;
        list.innerHTML = _loginSlides.map((slide, idx) => {
            const p = `login-slide-${idx}`;
            const label = _('settings.appearance.slide_n').replace('{n}', String(idx + 1));
            return `
            <li class="login-slide-card" data-slide-id="${esc(slide.id)}" data-slide-key="${esc(slide.slideKey || '')}" data-index="${idx}">
                <div class="login-slide-card-header">
                    <h4>${esc(label)}</h4>
                    <div class="settings-inline-controls">
                        <button type="button" class="btn btn-sm login-slide-up" ${idx === 0 ? 'disabled' : ''}>${esc(_('branding.login_slide_move_up'))}</button>
                        <button type="button" class="btn btn-sm login-slide-down" ${idx >= n - 1 ? 'disabled' : ''}>${esc(_('branding.login_slide_move_down'))}</button>
                        <button type="button" class="btn btn-sm btn-danger-quiet login-slide-remove" ${n <= 1 ? 'disabled' : ''}>${esc(_('branding.login_slides_remove'))}</button>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label" for="${p}-file">${esc(_('branding.login_slide_image'))}</label>
                    <input type="file" id="${p}-file" class="login-slide-file" accept="image/png,image/jpeg,image/webp,image/gif" data-index="${idx}" data-save-ignore>
                    <label class="sr-only" for="${p}-url">${esc(_('branding.bg_image_url'))}</label>
                    <input type="text" id="${p}-url" class="form-input login-slide-image-url" value="${esc(slide.imageUrl || '')}" placeholder="/img/login-slides/free.jpg">
                </div>
                <div class="form-group">
                    <label class="form-label" for="${p}-title">${esc(_('branding.login_slide_title'))}</label>
                    <input type="text" id="${p}-title" class="form-input login-slide-title" maxlength="120" value="${esc(slide.title || '')}" placeholder="${esc(slide.slideKey ? _('login_promo.slides.' + slide.slideKey + '.title') : '')}">
                </div>
                <div class="form-group">
                    <label class="form-label" for="${p}-body">${esc(_('branding.login_slide_body'))}</label>
                    <textarea id="${p}-body" class="form-input form-textarea login-slide-body" rows="2" maxlength="400" placeholder="${esc(slide.slideKey ? _('login_promo.slides.' + slide.slideKey + '.body') : '')}">${esc(slide.body || '')}</textarea>
                </div>
                <div class="form-group">
                    <label class="form-label" for="${p}-overlay">${esc(_('branding.bg_overlay'))}: <span class="login-slide-overlay-value">${esc(slide.overlay || '45')}</span> %</label>
                    <input type="range" id="${p}-overlay" class="form-range login-slide-overlay" min="0" max="90" step="5" value="${esc(slide.overlay || '45')}">
                </div>
            </li>`;
        }).join('');

        const addBtn = document.getElementById('login-slides-add');
        const maxHint = document.getElementById('login-slides-max-hint');
        if (addBtn) addBtn.disabled = n >= MAX_LOGIN_SLIDES;
        if (maxHint) maxHint.hidden = n < MAX_LOGIN_SLIDES;
    }

    function initLoginSlidesEditor() {
        const list = document.getElementById('login-slides-list');
        document.querySelectorAll('input[name="login-promo-mode"]').forEach((radio) => {
            radio.addEventListener('change', () => {
                syncLoginPromoPanels();
                onBrandingFieldChange();
            });
        });

        document.getElementById('login-slides-add')?.addEventListener('click', () => {
            if (_loginSlides.length >= MAX_LOGIN_SLIDES) return;
            _loginSlides = collectLoginSlidesFromDom();
            _loginSlides.push({
                id: `slide-${Date.now().toString(36)}`,
                slideKey: '',
                order: _loginSlides.length,
                imageUrl: '',
                title: '',
                body: '',
                overlay: '45'
            });
            renderLoginSlidesEditor();
            onBrandingFieldChange();
        });

        document.getElementById('login-slides-restore')?.addEventListener('click', () => {
            _loginSlides = DEFAULT_LOGIN_SLIDES.map((s) => ({ ...s }));
            renderLoginSlidesEditor();
            onBrandingFieldChange();
        });

        list?.addEventListener('click', (e) => {
            const card = e.target.closest('.login-slide-card');
            if (!card) return;
            const idx = Number(card.dataset.index);
            const move = (to) => {
                _loginSlides = collectLoginSlidesFromDom();
                const tmp = _loginSlides[to];
                _loginSlides[to] = _loginSlides[idx];
                _loginSlides[idx] = tmp;
                renderLoginSlidesEditor();
                onBrandingFieldChange();
                list.querySelector(`.login-slide-card[data-index="${to}"] h4`)?.scrollIntoView({ block: 'nearest' });
            };
            if (e.target.closest('.login-slide-remove')) {
                _loginSlides = collectLoginSlidesFromDom();
                if (_loginSlides.length <= 1) return;
                _loginSlides.splice(idx, 1);
                renderLoginSlidesEditor();
                onBrandingFieldChange();
                return;
            }
            if (e.target.closest('.login-slide-up') && idx > 0) move(idx - 1);
            else if (e.target.closest('.login-slide-down') && idx < _loginSlides.length - 1) move(idx + 1);
        });

        list?.addEventListener('input', (e) => {
            if (e.target.classList.contains('login-slide-overlay')) {
                const val = e.target.closest('.login-slide-card')?.querySelector('.login-slide-overlay-value');
                if (val) val.textContent = e.target.value;
            }
        });

        list?.addEventListener('change', async (e) => {
            const fileInput = e.target.closest('.login-slide-file');
            if (!fileInput || !fileInput.files?.length) return;
            const file = fileInput.files[0];
            const card = fileInput.closest('.login-slide-card');
            const idx = Number(card?.dataset.index);
            try {
                const formData = new FormData();
                formData.append('background', file);
                const csrf = window.BetterDesk?.csrfToken || '';
                const res = await fetch('/api/settings/branding/upload-background', {
                    method: 'POST',
                    headers: csrf ? { 'X-CSRF-Token': csrf } : {},
                    credentials: 'same-origin',
                    body: formData
                });
                const payload = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(payload.error || payload.message || _('errors.server_error'));
                const url = payload.url || payload.data?.url;
                if (!url) throw new Error(_('errors.server_error'));
                _loginSlides = collectLoginSlidesFromDom();
                if (_loginSlides[idx]) _loginSlides[idx].imageUrl = url;
                renderLoginSlidesEditor();
                onBrandingFieldChange();
            } catch (err) {
                setBrandingStatus('error', err.message || _('errors.server_error'));
            } finally {
                fileInput.value = '';
            }
        });

        syncLoginPromoPanels();
    }

    /**
     * Wire background selectors: radio toggles, range value labels,
     * colour picker sync and image uploads for console/login/agent groups.
     */
    function initBackgroundSelectors() {
        [['bg-type', 'bg'], ['login-bg-type', 'login-bg'], ['agent-bg-type', 'agent-bg'], ['rdclient-bg-type', 'rdclient-bg']].forEach(([name, prefix]) => {
            document.querySelectorAll(`input[name="${name}"]`).forEach(radio => {
                radio.addEventListener('change', () => showBackgroundPanel(prefix, radio.value));
            });
        });

        [['bg-color-picker', 'bg-color'], ['login-bg-color-picker', 'login-bg-color'], ['agent-bg-color-picker', 'agent-bg-color'], ['rdclient-bg-color-picker', 'rdclient-bg-color'], ['glass-color-picker', 'glass-color']].forEach(([pickerId, textId]) => {
            const picker = document.getElementById(pickerId);
            const text = document.getElementById(textId);
            if (picker && text) {
                picker.addEventListener('input', () => { text.value = picker.value; });
                text.addEventListener('input', () => {
                    if (/^#[0-9a-fA-F]{6}$/.test(text.value)) picker.value = text.value;
                });
            }
        });

        [['bg-blur', 'bg-blur-value'], ['bg-overlay', 'bg-overlay-value'], ['login-bg-overlay', 'login-bg-overlay-value'], ['rdclient-bg-overlay', 'rdclient-bg-overlay-value'], ['glass-blur', 'glass-blur-value'], ['glass-opacity', 'glass-opacity-value']].forEach(([rangeId, labelId]) => {
            const range = document.getElementById(rangeId);
            const label = document.getElementById(labelId);
            if (range && label) range.addEventListener('input', () => { label.textContent = range.value; });
        });

        document.querySelectorAll('.branding-bg-file').forEach(input => {
            input.addEventListener('change', handleBackgroundFileUpload);
        });
        initBackgroundLibrary();
    }

    async function initBackgroundLibrary() {
        const library = document.getElementById('bg-image-library');
        if (!library) return;
        library.addEventListener('click', (event) => {
            const item = event.target.closest('.background-library-item');
            if (!item || item.disabled) return;
            selectBackgroundLibraryImage(item.dataset.url || '');
        });
        await loadBackgroundLibrary(document.getElementById('bg-image-url')?.value || '');
    }

    async function loadBackgroundLibrary(selectedUrl = '') {
        const library = document.getElementById('bg-image-library');
        if (!library) return;
        library.innerHTML = `<p class="state">${_('common.loading')}</p>`;
        try {
            const resp = await Utils.api('/api/settings/branding/backgrounds');
            const items = Array.isArray(resp.data) ? resp.data : [];
            renderBackgroundLibrary(items, selectedUrl || document.getElementById('bg-image-url')?.value || '');
        } catch (err) {
            library.innerHTML = `<p class="state is-error">${Utils.escapeHtml(err.message || _('errors.server_error'))}</p>`;
        }
    }

    function renderBackgroundLibrary(items, selectedUrl = '') {
        const library = document.getElementById('bg-image-library');
        if (!library) return;
        if (!items.length) {
            library.innerHTML = `<p class="state">${_('desktop.wp_unavailable')}</p>`;
            return;
        }
        library.innerHTML = items.map(item => {
            const url = String(item.url || '');
            const name = String(item.name || url.split('/').pop() || '');
            const isActive = url === selectedUrl;
            return `
                <button type="button" class="background-library-item${isActive ? ' active' : ''}" aria-pressed="${isActive ? 'true' : 'false'}" data-url="${Utils.escapeHtml(url)}">
                    <span class="background-library-thumb" style="background-image:url('${Utils.escapeHtml(url).replace(/'/g, '%27')}')"></span>
                    <span class="background-library-name">${Utils.escapeHtml(name)}</span>
                </button>`;
        }).join('');
    }

    function selectBackgroundLibraryImage(url) {
        if (!url) return;
        const input = document.getElementById('bg-image-url');
        if (input) input.value = url;
        selectBackgroundImageType('bg-image-url');
        setBackgroundUploadStatus(document.getElementById('bg-file-name'), url.split('/').pop() || url, '');
        markSelectedBackgroundImage(url);
        onBrandingFieldChange();
    }

    function markSelectedBackgroundImage(url) {
        const library = document.getElementById('bg-image-library');
        if (!library) return;
        library.querySelectorAll('.background-library-item').forEach(item => {
            const on = item.dataset.url === url;
            item.classList.toggle('active', on);
            item.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    /**
     * Background image upload: the shared route stores the file and saves it
     * as the background right away (the field effect says so).
     */
    async function handleBackgroundFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const statusEl = getBackgroundUploadStatusElement(e.target);

        const maxSize = 8 * 1024 * 1024;
        const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
        if (file.size > maxSize || !validTypes.includes(file.type)) {
            updateBackgroundUploadPanel(statusEl, {
                state: 'error',
                message: file.size > maxSize ? _('branding.bg_image_too_large') : _('branding.bg_image_invalid_type'),
                percent: 0
            });
            e.target.value = '';
            return;
        }

        const targetId = e.target.dataset.target;
        const nameEl = getBackgroundFileNameElement(e.target);
        setBackgroundUploadStatus(nameEl, file.name, '');
        updateBackgroundUploadPanel(statusEl, { state: 'uploading', message: `${file.name}: ${_('branding.status_saving')}`, percent: 1 });

        const formData = new FormData();
        formData.append('background', file);
        formData.append('target', backgroundTargetToBrandingKey(targetId));

        const uploadKey = targetId || e.target.id;
        const uploadPromise = (async () => {
            const result = await uploadBackgroundImage(formData, (percent) => {
                updateBackgroundUploadPanel(statusEl, { state: 'uploading', message: `${file.name}: ${percent} %`, percent });
            });
            const urlInput = document.getElementById(targetId);
            if (urlInput) urlInput.value = result.url;
            selectBackgroundImageType(targetId);
            if (result.data && typeof result.data === 'object') {
                brandingData = result.data;
                populateBrandingForm(brandingData);
                _brandingSnapshot = JSON.stringify(collectBrandingData());
                _brandingDirty = false;
                setBrandingStatus('saved', '');
                refreshBrandingStylesheet(result.revision || Date.now());
            } else {
                onBrandingFieldChange();
            }
            return result.url;
        })();

        _backgroundUploads.set(uploadKey, uploadPromise);
        let uploadedUrl = '';
        try {
            uploadedUrl = await uploadPromise;
        } catch (err) {
            updateBackgroundUploadPanel(statusEl, { state: 'error', message: err.message || _('errors.server_error'), percent: 0 });
        } finally {
            if (_backgroundUploads.get(uploadKey) === uploadPromise) _backgroundUploads.delete(uploadKey);
            e.target.value = '';
        }

        if (uploadedUrl) {
            await loadBackgroundLibrary(uploadedUrl);
            markSelectedBackgroundImage(uploadedUrl);
            updateBackgroundUploadPanel(statusEl, {
                state: 'success',
                message: `${_('branding.bg_upload_success')} ${_('branding.autosaved')}`,
                percent: 100
            });
        }
    }

    function getBackgroundFileNameElement(input) {
        const map = {
            'bg-image-file': 'bg-file-name',
            'login-bg-image-file': 'login-bg-file-name',
            'agent-bg-image-file': 'agent-bg-file-name',
            'rdclient-bg-image-file': 'rdclient-bg-file-name'
        };
        return document.getElementById(map[input.id]);
    }

    function setBackgroundUploadStatus(el, fileName, status) {
        if (!el) return;
        el.textContent = status ? `${fileName} (${status})` : fileName;
    }

    function syncExistingBackgroundUploadStatuses(data) {
        [
            { targetId: 'bg-image-url', type: data.bgType, url: data.bgImageUrl, labelId: 'bg-file-name' },
            { targetId: 'login-bg-image-url', type: data.loginBgType, url: data.loginBgImageUrl, labelId: 'login-bg-file-name' },
            { targetId: 'agent-bg-image-url', type: data.agentBgType, url: data.agentBgImageUrl, labelId: 'agent-bg-file-name' },
            { targetId: 'rdclient-bg-image-url', type: data.rdclientBgType, url: data.rdclientBgImageUrl, labelId: 'rdclient-bg-file-name' }
        ].forEach(item => {
            const statusEl = getBackgroundUploadStatusElementByTarget(item.targetId);
            const labelEl = document.getElementById(item.labelId);
            if (statusEl) statusEl.hidden = true;
            if (!labelEl) return;
            labelEl.textContent = (item.url && item.type === 'image')
                ? _('settings.appearance.current_image').replace('{name}', item.url.split('/').pop() || item.url)
                : '';
        });
    }

    function getBackgroundUploadStatusElement(input) {
        return getBackgroundUploadStatusElementByTarget(input.dataset.target);
    }

    function getBackgroundUploadStatusElementByTarget(targetId) {
        const map = {
            'bg-image-url': 'bg-upload-status',
            'login-bg-image-url': 'login-bg-upload-status',
            'agent-bg-image-url': 'agent-bg-upload-status',
            'rdclient-bg-image-url': 'rdclient-bg-upload-status'
        };
        return document.getElementById(map[targetId]);
    }

    function updateBackgroundUploadPanel(el, { state, message, percent }) {
        if (!el) return;
        el.hidden = false;
        const messageEl = el.querySelector('.branding-upload-message');
        const fillEl = el.querySelector('.branding-upload-progress-fill');
        const meter = el.querySelector('.meter');
        if (messageEl) {
            messageEl.textContent = message || '';
            messageEl.classList.toggle('is-ok', state === 'success');
            messageEl.classList.toggle('is-error', state === 'error');
        }
        if (meter) meter.hidden = state !== 'uploading';
        if (fillEl && Number.isFinite(percent)) {
            fillEl.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        }
    }

    function uploadBackgroundImage(formData, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/settings/branding/upload-background');
            xhr.withCredentials = true;
            const token = window.BetterDesk?.csrfToken || '';
            if (token) xhr.setRequestHeader('x-csrf-token', token);
            xhr.responseType = 'json';
            xhr.upload.onprogress = (event) => {
                if (!event.lengthComputable || typeof onProgress !== 'function') return;
                onProgress(Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100))));
            };
            xhr.onload = () => {
                const result = xhr.response || parseUploadJsonResponse(xhr.responseText);
                if (xhr.status < 200 || xhr.status >= 300 || !result?.success) {
                    reject(new Error(result?.error || `Upload failed (${xhr.status})`));
                    return;
                }
                if (typeof onProgress === 'function') onProgress(100);
                resolve(result);
            };
            xhr.onerror = () => reject(new Error(_('errors.server_error')));
            xhr.onabort = () => reject(new Error(_('errors.server_error')));
            xhr.send(formData);
        });
    }

    function parseUploadJsonResponse(text) {
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch (_e) {
            return null;
        }
    }

    function selectBackgroundImageType(targetId) {
        const map = {
            'bg-image-url': ['bg-type', 'bg'],
            'login-bg-image-url': ['login-bg-type', 'login-bg'],
            'agent-bg-image-url': ['agent-bg-type', 'agent-bg'],
            'rdclient-bg-image-url': ['rdclient-bg-type', 'rdclient-bg']
        };
        const cfg = map[targetId];
        if (!cfg) return;
        const [radioName, prefix] = cfg;
        const imageRadio = document.querySelector(`input[name="${radioName}"][value="image"]`);
        if (imageRadio && !imageRadio.checked) {
            imageRadio.checked = true;
            showBackgroundPanel(prefix, 'image');
        }
    }

    function backgroundTargetToBrandingKey(targetId) {
        const map = {
            'bg-image-url': 'bgImageUrl',
            'login-bg-image-url': 'loginBgImageUrl',
            'agent-bg-image-url': 'agentBgImageUrl',
            'rdclient-bg-image-url': 'rdclientBgImageUrl'
        };
        return map[targetId] || '';
    }

    function initLogoTypeSelector() {
        document.querySelectorAll('input[name="logo-type"]').forEach(radio => {
            radio.addEventListener('change', () => showLogoPanel(radio.value));
        });
        document.getElementById('logo-image-file')?.addEventListener('change', handleLogoFileUpload);
    }

    function showLogoPanel(type) {
        document.querySelectorAll('#branding-identity .logo-config-panel').forEach(p => p.classList.add('hidden'));
        const panel = document.getElementById(`logo-${type}-panel`);
        if (panel) panel.classList.remove('hidden');
    }

    /**
     * Picking a logo file only remembers it. It is uploaded when the
     * appearance is saved, so the current logo stays until then.
     */
    function handleLogoFileUpload(e) {
        const file = e.target.files[0];
        const note = document.getElementById('logo-file-name');
        if (!file) {
            _pendingLogoFile = null;
            if (note) note.textContent = _('settings.appearance.logo_upload_effect');
            onBrandingFieldChange();
            return;
        }
        const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
        let problem = '';
        if (file.size > 2 * 1024 * 1024) problem = _('branding.logo_image_too_large');
        else if (!validTypes.includes(file.type)) problem = _('branding.logo_image_invalid_type');
        if (problem) {
            e.target.value = '';
            _pendingLogoFile = null;
            if (note) {
                note.textContent = problem;
                note.classList.add('text-danger');
            }
            return;
        }
        _pendingLogoFile = file;
        if (note) {
            note.classList.remove('text-danger');
            note.textContent = _('settings.appearance.logo_pending').replace('{name}', file.name);
        }
        onBrandingFieldChange();
    }

    /** The palette the console shows right now (System follows the device). */
    function currentLookPalette(mode) {
        const palettes = window.BetterDesk?.themePalettes || {};
        if (mode === 'dark') return palettes.dark || {};
        if (mode === 'light') return palettes.light || {};
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        return (prefersDark ? palettes.dark : palettes.light) || {};
    }

    function initColorPickers() {
        document.querySelectorAll('.color-picker[data-color]').forEach(picker => {
            picker.addEventListener('input', () => {
                const hex = document.querySelector(`.color-hex[data-color="${picker.dataset.color}"]`);
                if (hex) hex.value = picker.value;
                onBrandingFieldChange();
            });
        });
        document.querySelectorAll('.color-hex[data-color]').forEach(hex => {
            hex.addEventListener('input', () => {
                const picker = document.querySelector(`.color-picker[data-color="${hex.dataset.color}"]`);
                if (picker && /^#[0-9a-fA-F]{6}$/.test(hex.value)) picker.value = hex.value;
            });
        });

        let previousMode = document.querySelector('input[name="theme-mode"]:checked')?.value || 'system';
        document.querySelectorAll('input[name="theme-mode"]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (!radio.checked) return;
                const glassColor = document.getElementById('glass-color');
                const glassPicker = document.getElementById('glass-color-picker');
                if (radio.value === 'light' || radio.value === 'dark') {
                    const tint = radio.value === 'light' ? '#ffffff' : '#161b22';
                    if (glassColor) glassColor.value = tint;
                    if (glassPicker) glassPicker.value = tint;
                } else if (radio.value === 'custom' && previousMode !== 'custom' && _savedThemeMode !== 'custom') {
                    // Start the custom colours from what the console looks like now
                    applyBuiltInPalette(currentLookPalette(previousMode));
                }
                previousMode = radio.value;
                syncCustomColorsVisibility();
                onBrandingFieldChange();
            });
        });

        document.querySelectorAll('[data-palette-start]').forEach((btn) => {
            btn.addEventListener('click', () => {
                applyBuiltInPalette(currentLookPalette(btn.dataset.paletteStart));
                onBrandingFieldChange();
            });
        });
    }

    function applyBuiltInPalette(colors) {
        Object.entries(colors || {}).forEach(([key, value]) => {
            const picker = document.querySelector(`.color-picker[data-color="${key}"]`);
            const hex = document.querySelector(`.color-hex[data-color="${key}"]`);
            if (picker && /^#[0-9a-fA-F]{6}$/.test(value)) picker.value = value;
            if (hex) hex.value = value;
        });
    }

    /**
     * Collect branding form data
     */
    function collectBrandingData() {
        const data = {
            appName: document.getElementById('brand-name')?.value || 'BetterDesk',
            appDescription: document.getElementById('brand-description')?.value || '',
            logoType: document.querySelector('input[name="logo-type"]:checked')?.value || 'icon',
            logoIcon: document.getElementById('logo-icon-name')?.value || 'dns',
            logoSvg: document.getElementById('logo-svg-input')?.value || '',
            logoUrl: document.getElementById('logo-image-url')?.value || '',
            logoText: document.getElementById('logo-text-input')?.value || '',
            logoTextAccent: document.getElementById('logo-text-accent')?.value || '',
            fontHeading: document.getElementById('font-heading-value')?.value || '',
            fontBody: document.getElementById('font-body-value')?.value || '',
            colors: {}
        };

        document.querySelectorAll('.color-hex[data-color]').forEach(hex => {
            const value = hex.value.trim();
            if (value && /^#[0-9a-fA-F]{6}$/.test(value)) data.colors[hex.dataset.color] = value;
        });

        data.themeMode = document.querySelector('input[name="theme-mode"]:checked')?.value || 'system';

        data.bgType = document.querySelector('input[name="bg-type"]:checked')?.value || 'none';
        data.bgColor = document.getElementById('bg-color')?.value.trim() || '';
        data.bgGradient = document.getElementById('bg-gradient')?.value.trim() || '';
        data.bgImageUrl = document.getElementById('bg-image-url')?.value.trim() || '';
        data.bgBlur = document.getElementById('bg-blur')?.value || '';
        data.bgOverlay = document.getElementById('bg-overlay')?.value || '';
        data.bgSize = document.getElementById('bg-size')?.value || 'cover';

        data.glassEnabled = document.getElementById('glass-enabled')?.checked ? 'true' : 'false';
        data.glassColor = document.getElementById('glass-color')?.value.trim() || '';
        data.glassBlur = document.getElementById('glass-blur')?.value || '';
        data.glassOpacity = document.getElementById('glass-opacity')?.value || '';

        data.loginBgType = document.querySelector('input[name="login-bg-type"]:checked')?.value || 'inherit';
        data.loginBgColor = document.getElementById('login-bg-color')?.value.trim() || '';
        data.loginBgGradient = document.getElementById('login-bg-gradient')?.value.trim() || '';
        data.loginBgImageUrl = document.getElementById('login-bg-image-url')?.value.trim() || '';
        data.loginBgOverlay = document.getElementById('login-bg-overlay')?.value || '';
        data.loginTitle = document.getElementById('login-title')?.value.trim() || '';
        data.loginSubtitle = document.getElementById('login-subtitle')?.value.trim() || '';
        data.loginPromoMode = document.querySelector('input[name="login-promo-mode"]:checked')?.value || 'slides';
        data.loginSlides = collectLoginSlidesFromDom();

        data.agentBgType = document.querySelector('input[name="agent-bg-type"]:checked')?.value || 'none';
        data.agentBgColor = document.getElementById('agent-bg-color')?.value.trim() || '';
        data.agentBgGradient = document.getElementById('agent-bg-gradient')?.value.trim() || '';
        data.agentBgImageUrl = document.getElementById('agent-bg-image-url')?.value.trim() || '';
        data.agentShowPoweredBy = document.getElementById('agent-show-powered')?.checked ? 'true' : 'false';

        data.rdclientBgType = document.querySelector('input[name="rdclient-bg-type"]:checked')?.value || 'inherit';
        data.rdclientBgColor = document.getElementById('rdclient-bg-color')?.value.trim() || '';
        data.rdclientBgGradient = document.getElementById('rdclient-bg-gradient')?.value.trim() || '';
        data.rdclientBgImageUrl = document.getElementById('rdclient-bg-image-url')?.value.trim() || '';
        data.rdclientBgOverlay = document.getElementById('rdclient-bg-overlay')?.value || '';
        data.rdclientBgSize = document.getElementById('rdclient-bg-size')?.value || 'cover';

        data.footerText = document.getElementById('footer-text')?.value.trim() || '';
        data.showPoweredBy = document.getElementById('show-powered')?.checked ? 'true' : 'false';
        data.customCss = document.getElementById('custom-css')?.value || '';
        return data;
    }

    // ---------- Font pickers ----------

    let _fontSearchTimeout = null;
    let _fontCategory = '';

    function setFontPickerValue(slot, family, silent = false) {
        const valueInput = document.getElementById(`font-${slot}-value`);
        const currentLabel = document.getElementById(`font-${slot}-current`);
        const clearBtn = document.getElementById(`font-${slot}-clear`);
        if (valueInput) valueInput.value = family || '';
        if (currentLabel) currentLabel.textContent = family || _('branding.font_system_default');
        if (clearBtn) clearBtn.classList.toggle('hidden', !family);
        if (!silent) onBrandingFieldChange();
    }

    function showFontDropdown(dropdown, show) {
        dropdown.classList.toggle('hidden', !show);
    }

    function initFontPickers() {
        ['heading', 'body'].forEach(slot => {
            const searchInput = document.getElementById(`font-${slot}-search`);
            const dropdown = document.getElementById(`font-${slot}-dropdown`);
            const clearBtn = document.getElementById(`font-${slot}-clear`);
            if (!searchInput || !dropdown) return;

            searchInput.addEventListener('input', () => {
                clearTimeout(_fontSearchTimeout);
                _fontSearchTimeout = setTimeout(() => searchFonts(slot, searchInput.value.trim()), 300);
            });
            searchInput.addEventListener('focus', () => {
                if (!dropdown.children.length) searchFonts(slot, '');
                else showFontDropdown(dropdown, true);
            });
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') showFontDropdown(dropdown, false);
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    dropdown.querySelector('button')?.focus();
                }
            });
            dropdown.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    showFontDropdown(dropdown, false);
                    searchInput.focus();
                }
            });
            document.addEventListener('click', (e) => {
                if (!e.target.closest(`#font-${slot}-slot`)) showFontDropdown(dropdown, false);
            });
            clearBtn?.addEventListener('click', () => setFontPickerValue(slot, ''));
        });

        document.querySelectorAll('.font-cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.font-cat-btn').forEach(b => {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                });
                _fontCategory = btn.dataset.category === 'all' ? '' : (btn.dataset.category || '');
                ['heading', 'body'].forEach(slot => {
                    const searchInput = document.getElementById(`font-${slot}-search`);
                    const dropdown = document.getElementById(`font-${slot}-dropdown`);
                    if (searchInput && dropdown && !dropdown.classList.contains('hidden')) {
                        searchFonts(slot, searchInput.value.trim());
                    }
                });
            });
        });

        loadLocalFontCount();
    }

    async function searchFonts(slot, query) {
        const dropdown = document.getElementById(`font-${slot}-dropdown`);
        if (!dropdown) return;
        try {
            const params = new URLSearchParams();
            if (query) params.set('q', query);
            if (_fontCategory) params.set('category', _fontCategory);
            if (_fontSource === 'google') params.set('source', 'google');
            const fonts = await Utils.api(`/api/settings/fonts?${params}`);
            if (!fonts || !fonts.length) {
                dropdown.innerHTML = `<p class="state">${_('settings.appearance.font_none')}</p>`;
                showFontDropdown(dropdown, true);
                return;
            }
            dropdown.innerHTML = '';
            fonts.forEach(font => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'font-dropdown-item';
                item.innerHTML = `<span class="font-item-name">${Utils.escapeHtml(font.family)}</span>
                    <span class="font-item-meta">${Utils.escapeHtml(font.category || '')}${font.downloaded ? ', ' + Utils.escapeHtml(_('branding.font_local')) : ''}</span>`;
                item.addEventListener('click', async () => {
                    if (!font.downloaded && _canBrandingEdit) {
                        item.disabled = true;
                        try {
                            await Utils.api('/api/settings/fonts/download', { method: 'POST', body: { family: font.family } });
                            loadLocalFontCount();
                        } catch (e) {
                            // The font still works from the CDN if the download fails
                        }
                        item.disabled = false;
                    }
                    setFontPickerValue(slot, font.family);
                    showFontDropdown(dropdown, false);
                    document.getElementById(`font-${slot}-search`)?.focus();
                });
                dropdown.appendChild(item);
            });
            showFontDropdown(dropdown, true);
        } catch (error) {
            dropdown.innerHTML = `<p class="state is-error">${Utils.escapeHtml(error.message || _('errors.server_error'))}</p>`;
            showFontDropdown(dropdown, true);
        }
    }

    async function loadLocalFontCount() {
        try {
            const fonts = await Utils.api('/api/settings/fonts/local');
            const counter = document.getElementById('font-local-count');
            if (counter && Array.isArray(fonts)) counter.textContent = fonts.length;
        } catch (e) {
            // count is informational
        }
    }

    function initBrandingActions() {
        const form = brandingForm();
        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            saveBrandingNow();
        });
        document.getElementById('branding-revert-btn')?.addEventListener('click', revertBrandingChanges);
        const ieStatus = document.getElementById('branding-ie-status');

        document.getElementById('branding-export-btn')?.addEventListener('click', async () => {
            try {
                const response = await Utils.api('/api/settings/branding/export');
                const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'betterdesk-theme.json';
                a.click();
                URL.revokeObjectURL(url);
                setStatus(ieStatus, _('branding.exported'), 'ok');
            } catch (error) {
                setStatus(ieStatus, error.message || _('errors.server_error'), 'error');
            }
        });

        document.getElementById('branding-import-input')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const preset = JSON.parse(await file.text());
                await Utils.api('/api/settings/branding/import', { method: 'POST', body: preset });
                await reloadBrandingFromServer();
                setStatus(ieStatus, _('branding.imported'), 'ok');
            } catch (error) {
                setStatus(ieStatus, error.message || _('branding.import_error'), 'error');
            }
            e.target.value = '';
        });

        document.getElementById('branding-reset-btn')?.addEventListener('click', async () => {
            if (!(await brandingConfirm(_('branding.reset_confirm'), { danger: true, title: _('settings.appearance.reset_title'), confirmLabel: _('settings.appearance.reset_button') }))) return;
            try {
                await Utils.api('/api/settings/branding/reset', { method: 'POST' });
                await reloadBrandingFromServer();
                setBrandingStatus('saved', _('branding.reset_success'));
            } catch (error) {
                setBrandingStatus('error', error.message || _('errors.server_error'));
            }
        });
    }

    // ==================== Backup & Restore ======================================

    const RESTORE_OPTIONS = [
        { id: 'restore-database', field: 'restoreDatabase', label: 'settings.backup_tab.opt_database' },
        { id: 'restore-uploads', field: 'restoreUploads', label: 'settings.backup_tab.opt_uploads' },
        { id: 'restore-secrets', field: 'restoreSecrets', label: 'settings.backup_tab.opt_secrets' },
        { id: 'restore-env', field: 'restoreEnv', label: 'settings.backup_tab.opt_env' },
        { id: 'restore-godb', field: 'restoreGoDb', label: 'settings.backup_tab.opt_godb' }
    ];

    function initBackupSection() {
        loadBackupStats();
        initScheduledBackupSection();
        initRestoreSection();

        const downloadStatus = document.getElementById('backup-download-status');
        document.getElementById('backup-download-btn')?.addEventListener('click', async () => {
            const btn = document.getElementById('backup-download-btn');
            if (!btn) return;
            setBusy(btn, true, _('backup.creating'));
            setStatus(downloadStatus, '');
            try {
                const fetchHeaders = {};
                if (window.BetterDesk && window.BetterDesk.csrfToken) {
                    fetchHeaders['X-CSRF-Token'] = window.BetterDesk.csrfToken;
                }
                const response = await fetch('/api/settings/backup', { credentials: 'same-origin', headers: fetchHeaders });
                if (!response.ok) {
                    const body = await response.json().catch(() => null);
                    throw new Error(body?.error || _('errors.server_error'));
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                let filename = '';
                const disp = response.headers.get('Content-Disposition') || '';
                const match = disp.match(/filename="?([^";]+)"?/i);
                if (match) filename = match[1];
                if (!filename) filename = `betterdesk-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
                setStatus(downloadStatus, _('settings.backup_tab.downloaded').replace('{name}', filename), 'ok');
            } catch (error) {
                setStatus(downloadStatus, error.message || _('errors.server_error'), 'error');
            } finally {
                setBusy(btn, false);
            }
        });
    }

    /**
     * Restore: pick the file, tick what to restore (nothing is ticked), then
     * "Restore…" asks for confirmation and lists exactly what is replaced.
     */
    function initRestoreSection() {
        const fileInput = document.getElementById('restore-file-input');
        const options = document.getElementById('restore-options');
        const optionsHint = document.getElementById('restore-options-hint');
        const jsonNote = document.getElementById('restore-json-note');
        const startBtn = document.getElementById('restore-start-btn');
        const status = document.getElementById('restore-status');
        const resultEl = document.getElementById('restore-result');
        if (!fileInput || !startBtn) return;

        const fileKind = () => {
            const file = fileInput.files?.[0];
            if (!file) return '';
            const name = file.name.toLowerCase();
            if (name.endsWith('.json')) return 'json';
            if (name.endsWith('.gz')) return 'archive';
            return 'invalid';
        };
        const selected = () => RESTORE_OPTIONS.filter((o) => document.getElementById(o.id)?.checked);

        const sync = () => {
            const kind = fileKind();
            if (options) options.disabled = kind !== 'archive';
            if (optionsHint) optionsHint.hidden = kind === 'archive';
            if (jsonNote) jsonNote.hidden = kind !== 'json';
            startBtn.disabled = !(kind === 'json' || (kind === 'archive' && selected().length > 0));
            if (kind === 'invalid') setStatus(status, _('backup.invalid_format'), 'error');
            else setStatus(status, '');
        };

        fileInput.addEventListener('change', () => {
            if (resultEl) {
                resultEl.style.display = 'none';
                resultEl.innerHTML = '';
            }
            sync();
        });
        RESTORE_OPTIONS.forEach((o) => document.getElementById(o.id)?.addEventListener('change', sync));
        sync();

        startBtn.addEventListener('click', async () => {
            const file = fileInput.files?.[0];
            const kind = fileKind();
            if (!file || (kind !== 'archive' && kind !== 'json')) return;
            const chosen = kind === 'json'
                ? [_('backup.opt_settings'), _('settings.tab_branding'), _('backup.opt_folders'), _('backup.opt_groups'), _('backup.opt_addressbooks')]
                : selected().map((o) => _(o.label));
            const needsRestart = kind === 'archive' && selected().some((o) => ['restoreSecrets', 'restoreEnv', 'restoreGoDb'].includes(o.field));

            const ok = await confirmRestore(file.name, chosen, needsRestart);
            if (!ok) return;

            const formData = new FormData();
            formData.append('backup', file);
            RESTORE_OPTIONS.forEach((o) => {
                formData.append(o.field, String(!!document.getElementById(o.id)?.checked));
            });

            setBusy(startBtn, true, _('settings.backup_tab.restoring'));
            setStatus(status, '');
            try {
                const headers = {};
                if (window.BetterDesk && window.BetterDesk.csrfToken) headers['X-CSRF-Token'] = window.BetterDesk.csrfToken;
                const response = await fetch('/api/settings/restore', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers,
                    body: formData
                });
                const result = await response.json().catch(() => ({}));
                if (result.success) {
                    setStatus(status, _('backup.restore_success'), 'ok');
                    showRestoreResult(result.data || {}, resultEl);
                } else {
                    setStatus(status, result.error || _('errors.server_error'), 'error');
                }
            } catch (error) {
                setStatus(status, error.message || _('errors.server_error'), 'error');
            } finally {
                setBusy(startBtn, false);
                sync();
            }
        });
    }

    function confirmRestore(fileName, items, needsRestart) {
        return new Promise((resolve) => {
            let answered = false;
            const done = (value) => {
                if (answered) return;
                answered = true;
                if (value) Modal.close();
                resolve(value);
            };
            Modal.show({
                title: _('settings.backup_tab.confirm_title'),
                content: `
                    <p>${Utils.escapeHtml(_('settings.backup_tab.confirm_intro').replace('{file}', fileName))}</p>
                    <ul>${items.map((i) => `<li>${Utils.escapeHtml(i)}</li>`).join('')}</ul>
                    <p>${Utils.escapeHtml(_('settings.backup_tab.confirm_undo'))}</p>
                    ${needsRestart ? `<p class="notice warning">${Utils.escapeHtml(_('backup.restart_required'))}</p>` : ''}`,
                buttons: [
                    { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => { Modal.close(); done(false); } },
                    { label: _('settings.backup_tab.confirm_button'), class: 'btn-danger', onClick: () => done(true) }
                ],
                closable: true,
                onClose: () => done(false)
            });
        });
    }

    async function initScheduledBackupSection() {
        const form = document.getElementById('scheduled-backup-form');
        if (!form) return;
        const enabled = document.getElementById('scheduled-backup-enabled');
        const interval = document.getElementById('scheduled-backup-interval');
        const retention = document.getElementById('scheduled-backup-retention');
        const destinationType = document.getElementById('scheduled-backup-destination-type');
        const destinationPath = document.getElementById('scheduled-backup-path');
        const pathGroup = document.getElementById('scheduled-backup-path-group');
        const statusEl = document.getElementById('scheduled-backup-status');
        const showStatus = (message, ok = true) => setStatus(statusEl, message, ok ? 'ok' : 'error');
        const syncPathVisibility = () => {
            if (pathGroup) pathGroup.hidden = destinationType?.value !== 'path';
        };
        destinationType?.addEventListener('change', syncPathVisibility);
        syncPathVisibility();

        // Last run, next run and destination go to the side column
        let lastStatus = null;
        let savedSchedule = null;
        const renderStatus = (st) => {
            lastStatus = st || lastStatus;
            renderBackupSide(savedSchedule, lastStatus);
        };
        const refreshStatus = async () => {
            try {
                const fresh = await Utils.api('/api/settings/backup/schedule');
                savedSchedule = fresh?.schedule || savedSchedule;
                renderStatus(fresh?.status);
            } catch (_e) { /* the side keeps the last known state */ }
        };

        try {
            const data = await Utils.api('/api/settings/backup/schedule');
            const schedule = data?.schedule || {};
            savedSchedule = schedule;
            if (enabled) enabled.checked = !!schedule.enabled;
            if (interval) interval.value = String(schedule.intervalHours || 24);
            if (retention) retention.value = String(schedule.retentionCount || 7);
            if (destinationType) destinationType.value = schedule.destinationType || 'local';
            if (destinationPath) destinationPath.value = schedule.destinationPath || '';
            syncPathVisibility();
            renderStatus(data?.status);
        } catch (err) {
            showStatus(err.message || _('errors.server_error'), false);
        }

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                const saved = await Utils.api('/api/settings/backup/schedule', {
                    method: 'PUT',
                    body: {
                        enabled: !!enabled?.checked,
                        intervalHours: Number(interval?.value || 24),
                        retentionCount: Number(retention?.value || 7),
                        destinationType: destinationType?.value || 'local',
                        destinationPath: destinationPath?.value || ''
                    }
                });
                if (destinationType) destinationType.value = saved?.destinationType || destinationType.value;
                formOk(form, _('backup.schedule_saved'));
                refreshStatus();
            } catch (err) {
                formFail(form, err.message || _('errors.server_error'));
            }
        });

        document.getElementById('scheduled-backup-test-btn')?.addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            setBusy(btn, true);
            try {
                const result = await Utils.api('/api/settings/backup/destination/test', {
                    method: 'POST',
                    body: {
                        destinationType: destinationType?.value || 'local',
                        destinationPath: destinationPath?.value || ''
                    }
                });
                showStatus(`${_('backup.schedule_destination_ok')}: ${result?.destination || ''}`);
            } catch (err) {
                showStatus(err.message || _('errors.server_error'), false);
            } finally {
                setBusy(btn, false);
            }
        });

        document.getElementById('scheduled-backup-run-btn')?.addEventListener('click', async (ev) => {
            const button = ev.currentTarget;
            setBusy(button, true, _('backup.creating'));
            try {
                const result = await Utils.api('/api/settings/backup/schedule/run', { method: 'POST' });
                showStatus(`${_('backup.schedule_run_success')}: ${result?.filename || ''}`);
            } catch (err) {
                showStatus(err.message || _('errors.server_error'), false);
            } finally {
                setBusy(button, false);
                refreshStatus();
            }
        });

        const smbForm = document.getElementById('scheduled-backup-smb-form');
        const smbStatus = document.getElementById('backup-smb-status');
        const smbField = (name) => document.getElementById('backup-smb-' + name);
        const smbIds = { host: 'host', share: 'share', domain: 'domain', username: 'username', password: 'password', mountPath: 'mount-path' };
        const smbPayload = () => ({
            host: smbField('host')?.value || '',
            share: smbField('share')?.value || '',
            domain: smbField('domain')?.value || '',
            username: smbField('username')?.value || '',
            password: smbField('password')?.value || '',
            mountPath: smbField('mount-path')?.value || ''
        });
        try {
            const smb = await Utils.api('/api/settings/backup/smb');
            for (const [key, id] of Object.entries(smbIds)) {
                const field = smbField(id);
                if (field) field.value = smb?.[key] || '';
            }
        } catch (err) {
            setStatus(smbStatus, err.message || _('errors.server_error'), 'error');
        }
        smbForm?.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                await Utils.api('/api/settings/backup/smb', { method: 'PUT', body: smbPayload() });
                formOk(smbForm, _('backup.smb_saved'));
            } catch (err) {
                formFail(smbForm, err.message || _('errors.server_error'));
            }
        });
        document.getElementById('backup-smb-test-btn')?.addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            setBusy(btn, true);
            try {
                const result = await Utils.api('/api/settings/backup/smb/test', { method: 'POST', body: smbPayload() });
                setStatus(smbStatus, `${_('backup.smb_test_success')}: ${result?.target || ''}`, 'ok');
            } catch (err) {
                setStatus(smbStatus, err.message || _('errors.server_error'), 'error');
            } finally {
                setBusy(btn, false);
            }
        });
    }

    async function loadBackupStats() {
        try {
            const data = await Utils.api('/api/settings/backup/stats');
            if (!data) return;
            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val;
            };
            const yn = (b) => b ? _('common.yes') : _('common.no');
            setVal('backup-stat-users', data.users || 0);
            setVal('backup-stat-settings', data.settings || 0);
            setVal('backup-stat-folders', data.folders || 0);
            setVal('backup-stat-groups', (data.userGroups || 0) + (data.deviceGroups || 0));
            setVal('backup-stat-strategies', data.strategies || 0);
            setVal('backup-stat-backend', data.backend === 'betterdesk' ? 'BetterDesk Go' : 'RustDesk');
            const comp = data.components || {};
            setVal('backup-stat-database', (data.dbType === 'postgres' ? 'PostgreSQL' : 'SQLite'));
            setVal('backup-stat-keys', yn(comp.goPrivKey || comp.goApiKey));
            setVal('backup-stat-env', yn(comp.env));
            setVal('backup-stat-uploads', comp.uploads || 0);
        } catch (err) {
            const dd = document.getElementById('backup-stat-users');
            if (dd) dd.textContent = err.message || _('errors.server_error');
        }
    }

    function showRestoreResult(data, el) {
        if (!el) return;
        el.style.display = 'block';
        const rows = [];
        if (data.restored?.length) rows.push(`<dt>${_('backup.restored')}</dt><dd>${Utils.escapeHtml(data.restored.join(', '))}</dd>`);
        if (data.skipped?.length) rows.push(`<dt>${_('backup.skipped')}</dt><dd>${Utils.escapeHtml(data.skipped.join(', '))}</dd>`);
        if (data.backupDate) rows.push(`<dt>${_('backup.backup_date')}</dt><dd>${Utils.escapeHtml(data.backupDate)}</dd>`);
        let html = rows.length ? `<dl class="facts">${rows.join('')}</dl>` : '';
        if (data.warnings?.length) {
            html += `<p class="notice warning">${data.warnings.map(w => Utils.escapeHtml(w)).join('<br>')}</p>`;
        }
        if (data.requiresRestart) {
            html += `<p class="notice warning">${Utils.escapeHtml(_('backup.restart_required'))}</p>`;
        }
        el.innerHTML = html;
    }

    // ==================== Self-Update ====================
    
    let _updateState = { remoteSHA: null, changedData: null };
    let _updateChannelSaved = null;
    let _updateChannelBusy = false;
    let _updatePreflight = { ready: null, issues: [], warnings: [] };

    function renderUpdateHeroStatus(state, opts = {}) {
        const headline = document.getElementById('update-status-headline');
        const desc = document.getElementById('update-status-desc');
        if (!headline) return;
        const messages = {
            idle:      { h: _('updates.title'), d: _('updates.desc') },
            checking:  { h: _('updates.checking'), d: _('updates.desc') },
            uptodate:  { h: _('updates.up_to_date'), d: opts.detail || _('updates.desc') },
            available: { h: _('updates.update_available'), d: opts.detail || _('updates.desc') },
            baseline:  { h: _('updates.baseline_set'), d: _('updates.desc') },
            error:     { h: _('updates.install_failed'), d: opts.detail || _('updates.desc') }
        };
        const msg = messages[state] || messages.idle;
        headline.textContent = msg.h;
        if (desc) desc.textContent = msg.d;
    }

    function initUpdateSection() {
        const checkBtn = document.getElementById('update-check-btn');
        const installBtn = document.getElementById('update-install-btn');
        
        if (!checkBtn) return;
        
        checkBtn.addEventListener('click', checkForUpdates);
        installBtn?.addEventListener('click', installUpdate);

        const rebuildBtn = document.getElementById('update-rebuild-server-btn');
        rebuildBtn?.addEventListener('click', rebuildServerBinary);
        loadServerBinaryStatus();

        loadUpdateChannel();
        const channelSelect = document.getElementById('update-channel-select');
        channelSelect?.addEventListener('change', onUpdateChannelSelectChange);

        loadUpdateBackups();
        loadBackupRetention();
        loadLastUpdateResult();
        renderUpdateHeroStatus('idle');
    }

    function renderUpdateChannelBadge(data) {
        const badge = document.getElementById('update-channel-active-badge');
        if (!badge || !data?.channel) return;
        const isDev = data.channel === 'development';
        badge.textContent = isDev ? _('updates.channel_development') : _('updates.channel_stable');
    }

    async function loadUpdateChannel() {
        const select = document.getElementById('update-channel-select');
        const branchEl = document.getElementById('update-channel-branch');
        if (!select) return;
        try {
            const payload = await Utils.api('/api/settings/updates/channel');
            const data = payload?.data ?? payload;
            _updateChannelSaved = data?.channel || 'stable';
            if (data?.channel) select.value = data.channel;
            renderUpdateChannelBadge(data);
            if (branchEl) {
                branchEl.textContent = data?.branch
                    ? `${data.branch} · ${data.owner || 'UNITRONIX'}/${data.repo || 'BetterDesk'}`
                    : '-';
            }
        } catch (_e) {
            if (branchEl) branchEl.textContent = '-';
        }
    }

    function channelToBranch(channel) {
        return channel === 'development' ? 'dev' : 'main';
    }

    async function onUpdateChannelSelectChange() {
        if (_updateChannelBusy) return;
        const select = document.getElementById('update-channel-select');
        if (!select) return;

        const channel = select.value;
        if (channel === _updateChannelSaved) return;

        const previous = _updateChannelSaved || 'stable';
        const confirmed = await Modal.confirm({
            title: _('updates.channel_save'),
            message: _('updates.channel_confirm_switch', {
                from: channelToBranch(previous),
                to: channelToBranch(channel)
            }),
            confirmLabel: _('updates.channel_save'),
            confirmIcon: 'alt_route'
        });

        if (!confirmed) {
            select.value = _updateChannelSaved || 'stable';
            return;
        }

        await persistUpdateChannel(channel, select);
    }

    async function persistUpdateChannel(channel, selectEl) {
        _updateChannelBusy = true;
        if (selectEl) selectEl.disabled = true;
        try {
            const payload = await Utils.api('/api/settings/updates/channel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel })
            });
            const data = payload?.data ?? payload;
            _updateChannelSaved = channel;
            await loadUpdateChannel();
            Notifications.success(_('updates.channel_saved'));
            if (data?.previousBranch && data.previousBranch !== data.branch) {
                _updateState.remoteSHA = null;
                _updateState.changedData = null;
                const detailsSection = document.getElementById('update-details-section');
                if (detailsSection) detailsSection.style.display = 'none';
                const remoteEl = document.getElementById('update-remote-version');
                if (remoteEl) remoteEl.textContent = '-';
                const statusRow = document.getElementById('update-status-row');
                if (statusRow) statusRow.style.display = 'none';
            }
        } catch (error) {
            if (selectEl) selectEl.value = _updateChannelSaved || 'stable';
            Notifications.error(error.message || _('updates.channel_save_failed'));
        } finally {
            _updateChannelBusy = false;
            if (selectEl) selectEl.disabled = false;
        }
    }

    async function loadLastUpdateResult() {
        const host = document.getElementById('update-alerts');
        if (!host) return;
        let banner = document.getElementById('update-last-result-banner');
        try {
            const payload = await Utils.api('/api/settings/updates/last-result');
            const record = payload?.data ?? payload;
            if (!record || (!record.failed?.length && !record.servicesFailed?.length && !record.consoleRestartBlocked)) {
                if (banner) banner.remove();
                return;
            }
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'update-last-result-banner';
                banner.className = 'notice error update-last-result';
                host.appendChild(banner);
            }
            const lines = [];
            lines.push(`<p><strong>${Utils.escapeHtml(_('updates.complete_with_errors'))}</strong> <span class="mono">${Utils.escapeHtml(String(record.sha || '').slice(0, 7))}</span>, ${Utils.escapeHtml(record.savedAt || '')}</p>`);
            const items = [];
            for (const fl of (record.failed || [])) items.push(`${Utils.escapeHtml(fl.file)}: ${Utils.escapeHtml(fl.error || '')}`);
            for (const sv of (record.servicesFailed || [])) items.push(`${Utils.escapeHtml(sv.service)}: ${Utils.escapeHtml(sv.error || '')}`);
            if (record.consoleRestartBlocked) items.push(Utils.escapeHtml(record.consoleRestartBlocked));
            if (items.length) lines.push(`<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
            banner.innerHTML = lines.join('');
        } catch (_) {
            /* optional panel */
        }
    }

    async function loadServerBinaryStatus() {
        const warning = document.getElementById('update-stale-warning');
        if (!warning) return;
        try {
            const status = await Utils.api('/api/settings/updates/server-binary/status');
            if (status && status.dockerMode) {
                warning.style.display = 'none';
                return;
            }
            if (status && status.stale) {
                const detailEl = document.getElementById('update-stale-detail');
                if (detailEl) {
                    detailEl.textContent = status.detail
                        ? `${_('updates.server_stale_desc')} (${status.detail})`
                        : _('updates.server_stale_desc');
                }
                warning.style.display = '';
            } else {
                warning.style.display = 'none';
            }
        } catch (_e) {
            warning.style.display = 'none';
        }
    }

    async function rebuildServerBinary() {
        const btn = document.getElementById('update-rebuild-server-btn');
        if (!btn) return;
        setBusy(btn, true, _('updates.rebuilding_server'));
        try {
            const result = await Utils.api('/api/settings/updates/server-binary/rebuild', { method: 'POST' });
            if (result && result.success) {
                Notifications.success(_('updates.rebuild_server_success'));
                await loadServerBinaryStatus();
            } else {
                Notifications.error((result && result.error) || _('updates.rebuild_server_failed'));
            }
        } catch (error) {
            Notifications.error(error.message || _('updates.rebuild_server_failed'));
        } finally {
            setBusy(btn, false);
        }
    }
    
    function syncDockerInstallUi(dockerMode) {
        const installBtn = document.getElementById('update-install-btn');
        const installNote = document.getElementById('update-docker-install-note');
        if (!installBtn) return;
        if (dockerMode) {
            installBtn.style.display = 'none';
            installBtn.disabled = true;
            if (installNote) installNote.style.display = '';
        } else {
            installBtn.style.display = '';
            if (installNote) installNote.style.display = 'none';
        }
    }

    function applyInstallButtonState(dockerMode) {
        const installBtn = document.getElementById('update-install-btn');
        const hint = document.getElementById('update-install-blocked-hint');
        if (!installBtn || dockerMode) return;
        const blocked = _updatePreflight.ready === false;
        installBtn.disabled = blocked;
        if (hint) hint.hidden = !blocked;
        if (hint && blocked) {
            hint.textContent = updateI18n(
                'updates.install_blocked_hint',
                'Install is disabled until the issues above are resolved.'
            );
        }
    }

    function updateI18n(key, fallback) {
        const value = _(key);
        return (typeof value === 'string' && value !== key) ? value : fallback;
    }

    function formatPreflightWarning(message) {
        const text = String(message || '');
        if (/toolchain will be (installed|downloaded)/i.test(text)
            || /below\s+[\d.]+\s*;/i.test(text)) {
            return updateI18n('updates.toolchain_will_install', 'Go toolchain will be installed or updated automatically during the update');
        }
        return text;
    }

    function renderUpdatePreflightBanner() {
        const host = document.getElementById('update-alerts');
        if (!host) return;
        let banner = document.getElementById('update-preflight-banner');
        const pf = _updatePreflight;
        if (!pf || pf.ready === null) {
            if (banner) banner.remove();
            return;
        }

        const issues = Array.isArray(pf.issues) ? pf.issues : [];
        const warnings = Array.isArray(pf.warnings) ? pf.warnings : [];
        const capabilityWarnings = Object.entries(pf.capabilities?.groups || {})
            .filter(([name, group]) => name !== 'health' && group && group.ready === false)
            .map(([name, group]) => {
                const failed = (group.checks || [])
                    .filter((check) => check.ready === false)
                    .map((check) => `${check.id}: ${check.error || 'blocked'}`)
                    .join(', ');
                return `${name}: ${failed || 'blocked'}`;
            });
        const allWarnings = warnings.concat(capabilityWarnings);
        if (pf.ready && allWarnings.length === 0) {
            if (banner) banner.remove();
            return;
        }

        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'update-preflight-banner';
            host.insertBefore(banner, host.firstChild);
        }

        const blocked = !pf.ready && issues.length > 0;
        banner.className = blocked ? 'notice error update-preflight' : 'notice update-preflight';

        const parts = [];
        if (blocked) {
            parts.push(`<strong>${Utils.escapeHtml(updateI18n('updates.preflight_blocked_title', 'Update install blocked'))}</strong>`);
            parts.push(`<ul>${
                issues.map((item) => `<li>${Utils.escapeHtml(item)}</li>`).join('')
            }</ul>`);
        }
        if (allWarnings.length) {
            const title = blocked
                ? updateI18n('updates.preflight_warnings_title', 'Before installing')
                : updateI18n('updates.preflight_info_title', 'Before installing');
            parts.push('<div>');
            parts.push(`<strong>${Utils.escapeHtml(title)}</strong>`);
            if (!blocked) {
                parts.push(`<p class="form-hint">${Utils.escapeHtml(
                    updateI18n('updates.preflight_info_note', 'You can install the update — these notices are informational.')
                )}</p>`);
            }
            parts.push(`<ul>${
                allWarnings.map((item) => `<li>${Utils.escapeHtml(formatPreflightWarning(item))}</li>`).join('')
            }</ul></div>`);
        }
        banner.innerHTML = parts.join('');
    }

    async function refreshUpdatePreflight(dockerMode = false) {
        if (dockerMode || !_updateState.remoteSHA) {
            _updatePreflight = { ready: null, issues: [], warnings: [] };
            renderUpdatePreflightBanner();
            applyInstallButtonState(dockerMode);
            return;
        }

        const hasServerUpdate = (_updateState.changedData?.grouped?.server || []).length > 0;
        const url = hasServerUpdate
            ? `/api/settings/updates/preflight?serverUpdate=1&sha=${encodeURIComponent(_updateState.remoteSHA)}`
            : '/api/settings/updates/preflight';
        try {
            const pf = await Utils.api(url);
            _updatePreflight = pf && typeof pf === 'object'
                ? pf
                : { ready: true, issues: [], warnings: [] };
        } catch (_e) {
            _updatePreflight = { ready: true, issues: [], warnings: [] };
        }
        renderUpdatePreflightBanner();
        applyInstallButtonState(dockerMode);
    }

    function renderDockerUpdatePanel(data) {
        const panel = document.getElementById('update-docker-info');
        const commandsEl = document.getElementById('update-docker-commands');
        const imagesEl = document.getElementById('update-docker-images');
        const staleWarning = document.getElementById('update-stale-warning');
        const channelSelect = document.getElementById('update-channel-select');
        const channelHint = document.getElementById('update-channel-docker-hint');
        const dockerMode = data.deploymentMode === 'docker-image' || data.dockerImageMode;

        syncDockerInstallUi(dockerMode);
        if (!panel) return dockerMode;

        if (dockerMode) {
            panel.style.display = '';
            if (staleWarning) staleWarning.style.display = 'none';
            if (channelSelect) {
                channelSelect.disabled = true;
                channelSelect.title = _('updates.channel_docker_blocked');
            }
            if (channelHint) {
                channelHint.style.display = '';
                channelHint.textContent = _('updates.channel_docker_note');
            }

            const dockerUpdate = data.dockerUpdate || {};
            const commands = dockerUpdate.commands || ['docker compose pull', 'docker compose up -d'];
            if (commandsEl) {
                const tagNote = dockerUpdate.channelNote
                    ? `${dockerUpdate.channelNote}\n\n${commands.join('\n')}`
                    : commands.join('\n');
                commandsEl.textContent = tagNote;
            }
            if (imagesEl && Array.isArray(dockerUpdate.images) && dockerUpdate.images.length) {
                imagesEl.textContent = `${_('updates.docker_images')}: ${dockerUpdate.images.join(', ')}`;
            }
        } else {
            panel.style.display = 'none';
            if (channelSelect) {
                channelSelect.disabled = false;
                channelSelect.removeAttribute('title');
            }
            if (channelHint) {
                channelHint.style.display = 'none';
                channelHint.textContent = '';
            }
        }

        return dockerMode;
    }

    async function checkForUpdates() {
        const btn = document.getElementById('update-check-btn');
        const statusRow = document.getElementById('update-status-row');
        const statusBadge = document.getElementById('update-status-badge');
        const remoteEl = document.getElementById('update-remote-version');
        const detailsSection = document.getElementById('update-details-section');
        const installBtn = document.getElementById('update-install-btn');
        
        if (!btn) return;
        setBusy(btn, true, _('updates.checking'));
        renderUpdateHeroStatus('checking');
        
        try {
            const data = await Utils.api('/api/settings/updates/check');
            const dockerMode = renderDockerUpdatePanel(data);
            
            // Show commit SHA + message
            if (remoteEl) {
                const sha = data.remoteSHA ? data.remoteSHA.slice(0, 7) : '-';
                remoteEl.textContent = sha;
                if (data.latestMessage) remoteEl.title = data.latestMessage;
            }
            if (statusRow) statusRow.style.display = '';
            
            if (data.baselineEstablished) {
                if (statusBadge) statusBadge.innerHTML = `<span class="status ok">${_('updates.baseline_set')}</span>`;
                renderUpdateHeroStatus('baseline');
                if (detailsSection) detailsSection.style.display = 'none';
                if (installBtn) installBtn.disabled = true;
            } else if (data.updateAvailable) {
                const behind = data.commitsBehind > 0 ? ` (${data.commitsBehind} ${_('updates.commits_behind')})` : '';
                const badgeLabel = dockerMode ? _('updates.docker_update_available') : _('updates.update_available');
                if (statusBadge) statusBadge.innerHTML = `<span class="status warning">${badgeLabel}${behind}</span>`;
                const detail = data.latestMessage
                    ? `${data.latestMessage}${behind}`
                    : `${badgeLabel}${behind}`.trim();
                renderUpdateHeroStatus('available', { detail });
                
                _updateState.remoteSHA = data.remoteSHA;
                
                // Fetch changed files
                try {
                    const changes = await Utils.api(`/api/settings/updates/changes?sha=${data.remoteSHA}`);
                    _updateState.changedData = changes;
                    renderUpdateDetails(data, changes, dockerMode);
                } catch (_e) {
                    const cl = document.getElementById('update-changelog');
                    if (cl) cl.innerHTML = `<p class="state">${_('updates.changes_unavailable')}</p>`;
                }

                if (detailsSection) detailsSection.style.display = '';
                await refreshUpdatePreflight(dockerMode);
            } else {
                if (statusBadge) {
                    const label = data.dockerShaUnknown ? _('updates.docker_sha_unknown') : _('updates.up_to_date');
                    statusBadge.innerHTML = `<span class="status ok">${label}</span>`;
                }
                const detail = data.latestMessage || (data.remoteSHA ? `SHA ${data.remoteSHA.slice(0, 7)}` : '');
                renderUpdateHeroStatus('uptodate', { detail: detail || _('updates.desc') });
                if (detailsSection) detailsSection.style.display = 'none';
                if (installBtn) installBtn.disabled = true;
            }
        } catch (error) {
            renderUpdateHeroStatus('error', { detail: error.message || _('errors.server_error') });
            Notifications.error(error.message || _('errors.server_error'));
        } finally {
            setBusy(btn, false);
        }
    }
    
    function renderUpdateDetails(checkData, changesData, dockerMode = false) {
        const changelogEl = document.getElementById('update-changelog');
        const summaryEl = document.getElementById('update-files-summary');

        if (changelogEl) {
            const commits = changesData.commits || [];
            if (commits.length > 0) {
                changelogEl.innerHTML = '<ul class="list update-commits">' + commits.slice(0, 20).map((c) => {
                    const d = c.date ? new Date(c.date).toLocaleDateString() : '';
                    return `<li class="list-row update-commit-item"><span class="row-main">
                        <span class="row-title update-commit-msg">${Utils.escapeHtml(c.message || '')}</span>
                        <span class="row-sub"><span class="mono">${Utils.escapeHtml(c.sha || '')}</span>, ${Utils.escapeHtml(c.author || '')}, ${d}</span>
                    </span></li>`;
                }).join('') + '</ul>';
            } else {
                changelogEl.innerHTML = `<p class="state">${_('updates.no_changelog')}</p>`;
            }
        }

        if (summaryEl) {
            const grouped = changesData.grouped || {};
            const meta = {
                console: { label: _('updates.component_console'), auto: true },
                server:  { label: _('updates.component_server'), auto: true },
                agent:   { label: _('updates.component_agent'), auto: false },
                scripts: { label: _('updates.component_scripts'), auto: true },
                other:   { label: _('updates.component_other'), auto: false }
            };
            const rows = Object.entries(grouped)
                .filter(([, files]) => files && files.length)
                .map(([comp, files]) => {
                    const m = meta[comp] || meta.other;
                    return `<tr><td>${m.label}</td><td class="num">${files.length}</td><td>${m.auto ? _('updates.auto') : _('updates.manual')}</td></tr>`;
                }).join('');
            let html = `<div class="table-scroll"><table class="data-table update-components"><thead><tr>
                <th>${_('settings.updates_tab.component')}</th><th>${_('settings.updates_tab.files')}</th><th>${_('settings.updates_tab.how')}</th>
                </tr></thead><tbody>${rows}</tbody></table></div>`;
            html += `<p class="count-line">${_('updates.total_files')}: <strong>${changesData.totalFiles || 0}</strong></p>`;
            if (grouped.server?.length > 0) {
                html += `<div class="update-server-section">
                    <p><strong>${_('updates.include_server')}</strong> <span id="update-server-status" class="status pending">${_('updates.checking_go')}</span></p>
                    <p class="form-hint">${_('updates.auto_strategy_hint')}</p>
                    <p class="form-hint" id="update-server-info"></p>
                </div>`;
            }
            summaryEl.innerHTML = html;
            if (grouped.server?.length > 0 && !dockerMode) checkServerBuildInfo();
        }
    }

    async function checkServerBuildInfo() {
        const statusEl = document.getElementById('update-server-status');
        const infoEl = document.getElementById('update-server-info');
        if (!statusEl) return;

        try {
            const info = await Utils.api('/api/settings/updates/server-info');
            const hasGo = !!info.goAvailable && info.goMeetsMinimum !== false;
            const goNeedsUpgrade = !!info.goAvailable && info.goMeetsMinimum === false;
            const canInstallGo = !!info.canInstallGo;
            const vendoredReady = !!info.vendoredGoInstalled;

            // Status badge
            if (hasGo) {
                statusEl.className = 'status ok';
                statusEl.textContent = info.goVersion ? info.goVersion.replace('go version ', '') : 'Go';
            } else if (goNeedsUpgrade || canInstallGo) {
                statusEl.className = 'status pending';
                statusEl.textContent = vendoredReady ? _('updates.toolchain_ready') : _('updates.auto_available');
            } else {
                statusEl.className = 'status warning';
                statusEl.textContent = _('updates.no_method');
            }

            // Info line
            if (infoEl) {
                const parts = [];
                if (info.binaryPath) parts.push(`Binary: ${info.binaryPath}`);
                if (info.sourcePresent) parts.push('Source: present');
                if (info.goSource && info.goSource !== 'path') parts.push(`Go: ${info.goSource}`);
                if (goNeedsUpgrade) parts.push(_('updates.toolchain_will_install'));
                if (!hasGo && canInstallGo) parts.push(_('updates.toolchain_will_install'));
                infoEl.textContent = parts.join(' · ');
            }
        } catch (_e) {
            statusEl.className = 'status warning';
            statusEl.textContent = _('updates.go_check_failed');
        }
    }

    function getUpdateScopeLabels() {
        const grouped = _updateState.changedData?.grouped || {};
        const labels = {
            console: _('updates.component_console'),
            server: _('updates.component_server'),
            scripts: _('updates.component_scripts'),
            agent: _('updates.component_agent'),
            other: _('updates.component_other')
        };
        return Object.entries(grouped)
            .filter(([, files]) => files?.length > 0)
            .map(([component, files]) => `${labels[component] || labels.other}: ${files.length} ${_('updates.files')}`);
    }
    
    // ---------- Update progress modal ----------

    const UPDATE_PHASES = [
        { id: 'confirm',  icon: 'task_alt',          key: 'updates.phase_confirm' },
        { id: 'backup',   icon: 'inventory',         key: 'updates.phase_backup' },
        { id: 'console',  icon: 'cloud_download',    key: 'updates.phase_console' },
        { id: 'server',   icon: 'memory',            key: 'updates.phase_server' },
        { id: 'restart',  icon: 'restart_alt',       key: 'updates.phase_restart' },
        { id: 'done',     icon: 'check_circle',      key: 'updates.phase_done' }
    ];

    let _updateReloadTimers = { countdown: null, auto: null };

    function getActiveUpdateModalEl() {
        return document.querySelector('#modal-container .modal-overlay.open .modal');
    }

    function updateModalTitle(title) {
        const titleEl = document.querySelector('#modal-container .modal-overlay.open .modal-title');
        if (titleEl) titleEl.textContent = title;
    }

    function setModalClosable(closable) {
        const overlay = document.querySelector('#modal-container .modal-overlay.open');
        if (!overlay) return;
        const header = overlay.querySelector('.modal-header');
        if (!header) return;
        let closeBtn = header.querySelector('.modal-close');
        if (closable && !closeBtn) {
            closeBtn = document.createElement('button');
            closeBtn.className = 'modal-close';
            closeBtn.setAttribute('aria-label', _('actions.close'));
            closeBtn.innerHTML = '<span class="material-icons">close</span>';
            closeBtn.addEventListener('click', () => window.Modal.close());
            header.appendChild(closeBtn);
        } else if (!closable && closeBtn) {
            closeBtn.remove();
        }
    }

    function updateModalFooter(buttons) {
        const modal = getActiveUpdateModalEl();
        if (!modal) return;
        let footer = modal.querySelector('.modal-footer');
        if (!footer && buttons.length) {
            footer = document.createElement('div');
            footer.className = 'modal-footer update-wizard-footer-enter';
            modal.appendChild(footer);
        } else if (footer && !buttons.length) {
            footer.remove();
            return;
        }
        if (!footer) return;
        footer.classList.add('update-wizard-footer-enter');
        footer.innerHTML = buttons.map((btn, idx) => `
            <button type="button" class="btn ${btn.class || 'btn-secondary'}" data-btn-index="${idx}">
                ${Utils.escapeHtml(btn.label)}
            </button>
        `).join('');
        buttons.forEach((btn, idx) => {
            footer.querySelector(`[data-btn-index="${idx}"]`)?.addEventListener('click', () => btn.onClick?.());
        });
    }

    function clearUpdateReloadTimers() {
        if (_updateReloadTimers.countdown) clearInterval(_updateReloadTimers.countdown);
        if (_updateReloadTimers.auto) clearTimeout(_updateReloadTimers.auto);
        _updateReloadTimers = { countdown: null, auto: null };
    }

    function buildUpdateModalContent() {
        const stepLabel = _('updates.progress_step')
            .replace('{current}', '1')
            .replace('{total}', String(UPDATE_PHASES.length));
        const items = UPDATE_PHASES.map(p => `
            <div class="update-phase is-pending" data-phase="${p.id}">
                <span class="update-phase-label">${_(p.key)}</span>
                <span class="update-phase-state" data-phase-state="${p.id}">
                    <span class="material-icons">radio_button_unchecked</span>
                </span>
            </div>
        `).join('');
        return `
            <div class="update-wizard" data-state="running">
                <div class="update-wizard-header">
                    <div class="update-wizard-bar">
                        <div class="update-wizard-bar-fill" id="update-modal-bar" style="width:0%"></div>
                    </div>
                    <div class="update-wizard-meta">
                        <span class="update-wizard-step" id="update-modal-step">${Utils.escapeHtml(stepLabel)}</span>
                        <span class="update-wizard-detail" id="update-modal-detail">${Utils.escapeHtml(_('updates.preparing'))}</span>
                    <span class="update-wizard-percent" id="update-modal-percent">0%</span>
                    </div>
                </div>
                <div class="update-wizard-phases update-phases">${items}</div>
                <div class="update-wizard-log-panel" id="update-wizard-log-panel">
                    <div class="update-wizard-log-toolbar">
                        <span class="update-wizard-log-title">${Utils.escapeHtml(_('updates.log_title'))}</span>
                        <div class="update-wizard-log-actions">
                            <button type="button" class="btn btn-sm" id="update-log-expand">${Utils.escapeHtml(_('updates.log_expand'))}</button>
                            <button type="button" class="btn btn-sm" id="update-log-copy">${Utils.escapeHtml(_('updates.log_copy'))}</button>
                        </div>
                    </div>
                    <pre class="update-progress-log" id="update-modal-log" aria-live="polite"></pre>
                </div>
                <div class="update-wizard-banner" id="update-wizard-banner" hidden>
                    <div class="update-wizard-banner-body">
                        <div id="update-wizard-banner-text"></div>
                        <div id="update-wizard-banner-details" class="update-wizard-banner-details"></div>
                        <div class="update-wizard-countdown" id="update-reload-countdown-wrap" hidden>
                            <span id="update-reload-countdown"></span>
                            <div class="update-wizard-countdown-bar">
                                <div class="update-wizard-countdown-bar-fill"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function bindUpdateLogControls() {
        document.getElementById('update-log-expand')?.addEventListener('click', () => toggleUpdateLogExpanded());
        document.getElementById('update-log-copy')?.addEventListener('click', () => copyUpdateLog());
    }

    function getUpdateLogText() {
        return document.getElementById('update-modal-log')?.textContent || '';
    }

    function copyUpdateLog() {
        const text = getUpdateLogText();
        if (!text) return;
        navigator.clipboard?.writeText(text).then(() => {
            Notifications.success(_('common.copied'));
        }).catch(() => {});
    }

    function toggleUpdateLogExpanded(forceExpand) {
        const panel = document.getElementById('update-wizard-log-panel');
        const btn = document.getElementById('update-log-expand');
        if (!panel) return;
        const expanded = forceExpand === true ? true
            : forceExpand === false ? false
            : !panel.classList.contains('expanded');
        panel.classList.toggle('expanded', expanded);
        if (btn) btn.textContent = _(expanded ? 'updates.log_collapse' : 'updates.log_expand');
    }

    function updateUpdateStepCounter(phaseId, state) {
        const stepEl = document.getElementById('update-modal-step');
        if (!stepEl) return;
        const idx = UPDATE_PHASES.findIndex(p => p.id === phaseId);
        if (idx < 0) return;
        let current = idx + 1;
        if (state === 'pending') current = Math.max(1, idx);
        stepEl.textContent = _('updates.progress_step')
            .replace('{current}', String(current))
            .replace('{total}', String(UPDATE_PHASES.length));
    }

    function updateUpdateProgress() {
        const terminalStates = new Set(['done', 'skipped', 'warning', 'error']);
        const completed = UPDATE_PHASES.reduce((count, phase) => {
            const state = document.querySelector(`[data-phase-state="${phase.id}"]`)?.dataset?.state;
            return count + (terminalStates.has(state) ? 1 : 0);
        }, 0);
        const percent = Math.round((completed / UPDATE_PHASES.length) * 100);
        const bar = document.getElementById('update-modal-bar');
        const label = document.getElementById('update-modal-percent');
        if (bar) bar.style.width = `${percent}%`;
        if (label) label.textContent = `${percent}%`;
    }

    function setUpdatePhase(phaseId, state, detail) {
        // state: 'pending' | 'active' | 'done' | 'warning' | 'error' | 'skipped'
        const row = document.querySelector(`.update-phase[data-phase="${phaseId}"]`);
        if (row) {
            row.classList.remove('is-pending', 'is-active', 'is-done', 'is-warning', 'is-error', 'is-skipped');
            const rowState = state === 'pending' ? 'pending'
                : state === 'active' ? 'active'
                : state === 'done' ? 'done'
                : state === 'warning' ? 'warning'
                : state === 'error' ? 'error'
                : state === 'skipped' ? 'skipped' : 'pending';
            row.classList.add(`is-${rowState}`);
        }
        const stateEl = document.querySelector(`[data-phase-state="${phaseId}"]`);
        if (stateEl) {
            const icons = {
                pending: 'radio_button_unchecked',
                active:  'sync',
                done:    'check_circle',
                warning: 'warning',
                error:   'error',
                skipped: 'remove_circle_outline'
            };
            const cls = {
                pending: '',
                active:  'spinning',
                done:    state === 'done' ? 'just-done' : '',
                warning: '',
                error:   '',
                skipped: ''
            };
            stateEl.innerHTML = `<span class="material-icons ${cls[state] || ''}">${icons[state] || 'help'}</span>`;
            stateEl.dataset.state = state;
            if (state === 'done') {
                setTimeout(() => {
                    stateEl.querySelector('.just-done')?.classList.remove('just-done');
                }, 400);
            }
        }
        if (detail) {
            const det = document.getElementById('update-modal-detail');
            if (det) det.textContent = detail;
        }
        updateUpdateStepCounter(phaseId, state);
        updateUpdateProgress();
    }

    function logUpdate(line) {
        const log = document.getElementById('update-modal-log');
        if (!log) return;
        const ts = new Date().toLocaleTimeString();
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
        log.textContent += `[${ts}] ${line}\n`;
        if (atBottom) log.scrollTop = log.scrollHeight;
    }

    function reloadConsole() {
        clearUpdateReloadTimers();
        const url = new URL(window.location.href);
        url.searchParams.set('_bd_reload', Date.now().toString());
        window.location.replace(url.toString());
    }

    function hasUpdateFailures(result) {
        if (!result) return false;
        const deployFailed = !!(result.serverDeploy && result.serverDeploy.success === false);
        return (result.failed?.length || 0) > 0
            || (result.servicesFailed?.length || 0) > 0
            || !!result.consoleRestartBlocked
            || !!result.restartTimeout
            || deployFailed;
    }

    function buildUpdateSummaryHtml(result, options = {}) {
        const { includeSummary = true } = options;
        const lines = [];
        const deployFailed = !!(result?.serverDeploy && result.serverDeploy.success === false);
        const hasFailures = hasUpdateFailures(result);
        if (includeSummary) {
            const summaryKey = hasFailures ? 'updates.complete_with_errors' : 'updates.complete_summary';
            lines.push(`<p>${Utils.escapeHtml(_(summaryKey))}</p>`);
        }
        const stats = [
            { label: _('updates.applied'), value: result?.applied?.length || 0 },
            { label: _('updates.failed'),  value: result?.failed?.length  || 0 },
            { label: _('updates.removed'), value: result?.removed?.length || 0 }
        ];
        lines.push(`<ul>${stats.map(s => `<li>${Utils.escapeHtml(s.label)}: <strong>${s.value}</strong></li>`).join('')}</ul>`);
        if (result?.failed?.length) {
            lines.push(`<ul class="update-wizard-error-list">${result.failed.map(f =>
                `<li><strong>${Utils.escapeHtml(f.file || 'unknown')}</strong>${f.error ? `: ${Utils.escapeHtml(f.error)}` : ''}</li>`
            ).join('')}</ul>`);
        }
        if (result?.servicesFailed?.length) {
            lines.push(`<ul class="update-wizard-error-list">${result.servicesFailed.map(s =>
                `<li><strong>${Utils.escapeHtml(s.service || 'service')}</strong>${s.error ? `: ${Utils.escapeHtml(s.error)}` : ''}</li>`
            ).join('')}</ul>`);
        }
        if (result?.consoleRestartBlocked) {
            lines.push(`<p class="update-wizard-error-list">${Utils.escapeHtml(result.consoleRestartBlocked)}</p>`);
        }
        if (result?.restartTimeout) {
            lines.push(`<p>${Utils.escapeHtml(_('updates.restart_timeout'))}</p>`);
            lines.push(`<p>${Utils.escapeHtml(_('updates.refresh_recommended'))}</p>`);
        }
        if (result?.errorMessage) {
            lines.push(`<p class="update-wizard-error-list">${Utils.escapeHtml(result.errorMessage)}</p>`);
        }
        if (deployFailed) {
            const errMsg = result.serverDeploy.error || '';
            lines.push(`<p class="update-wizard-error-list"><strong>${Utils.escapeHtml(_('updates.server_deploy_failed'))}</strong></p>`);
            if (errMsg) lines.push(`<pre class="code-block">${Utils.escapeHtml(errMsg)}</pre>`);
        } else if (result?.serverBuild?.success) {
            lines.push(`<p>${Utils.escapeHtml(_('updates.server_built'))}</p>`);
        }
        const needsReload = (result?.applied || []).some(p => /\.(js|css|html|ejs)$/i.test(p));
        if (needsReload && !result?.restartTimeout) {
            lines.push(`<p>${Utils.escapeHtml(_('updates.refresh_recommended'))}</p>`);
        }
        return lines.join('');
    }

    function startReloadCountdown(seconds = 8) {
        clearUpdateReloadTimers();
        const wrap = document.getElementById('update-reload-countdown-wrap');
        const countdownEl = document.getElementById('update-reload-countdown');
        const barFill = document.querySelector('.update-wizard-countdown-bar-fill');
        if (wrap) wrap.hidden = false;
        if (barFill) {
            barFill.style.animation = 'none';
            void barFill.offsetWidth;
            barFill.style.animation = `updateCountdownShrink ${seconds}s linear forwards`;
        }
        let remaining = seconds;
        const tick = () => {
            if (countdownEl) {
                countdownEl.textContent = _('updates.reload_countdown').replace('{seconds}', String(remaining));
            }
        };
        tick();
        _updateReloadTimers.countdown = setInterval(() => {
            remaining -= 1;
            if (remaining >= 0) tick();
        }, 1000);
        _updateReloadTimers.auto = setTimeout(reloadConsole, seconds * 1000);
    }

    function transitionUpdateModal(state, result) {
        const wizard = document.querySelector('.update-wizard');
        if (!wizard) return;
        wizard.dataset.state = state;

        const banner = document.getElementById('update-wizard-banner');
        const bannerText = document.getElementById('update-wizard-banner-text');
        const bannerDetails = document.getElementById('update-wizard-banner-details');
        const countdownWrap = document.getElementById('update-reload-countdown-wrap');

        clearUpdateReloadTimers();
        if (countdownWrap) countdownWrap.hidden = true;

        banner.hidden = false;
        banner.classList.remove('is-success', 'is-error', 'is-warning');

        const hasFailures = hasUpdateFailures(result);
        const closeFooterBtn = {
            label: _('updates.modal_close'),
            class: 'btn-secondary',
            onClick: () => {
                window.Modal.close();
                enableUpdateInstallBtn();
            }
        };

        if (state === 'success_reload') {
            setModalClosable(true);
            updateModalTitle(_('updates.modal_done_title'));
            banner.classList.add('is-success');
            if (bannerText) bannerText.innerHTML = `<p>${Utils.escapeHtml(_('updates.restart_complete_msg'))}</p>`;
            if (bannerDetails) bannerDetails.innerHTML = '';
            updateModalFooter([
                closeFooterBtn,
                { label: _('updates.modal_reload_now'), class: 'btn-primary', icon: 'refresh', onClick: reloadConsole }
            ]);
            startReloadCountdown(8);
        } else if (state === 'success_no_reload') {
            setModalClosable(true);
            updateModalTitle(_('updates.modal_done_title'));
            banner.classList.add('is-success');
            if (bannerText) bannerText.innerHTML = `<p>${Utils.escapeHtml(_('updates.complete_summary'))}</p>`;
            if (bannerDetails) bannerDetails.innerHTML = buildUpdateSummaryHtml(result, { includeSummary: false });
            const footer = [closeFooterBtn];
            const needsReload = (result?.applied || []).some(p => /\.(js|css|html|ejs)$/i.test(p));
            if (needsReload) {
                footer.push({ label: _('updates.modal_reload_now'), class: 'btn-primary', icon: 'refresh', onClick: reloadConsole });
            }
            updateModalFooter(footer);
        } else if (state === 'partial_error' || state === 'error') {
            toggleUpdateLogExpanded(true);
            setModalClosable(true);
            updateModalTitle(_('updates.modal_done_with_errors_title'));
            banner.classList.add(result?.restartTimeout ? 'is-warning' : 'is-error');
            if (bannerText) bannerText.innerHTML = '';
            if (bannerDetails) bannerDetails.innerHTML = buildUpdateSummaryHtml(result);
            const errorFooter = [
                closeFooterBtn,
                { label: _('updates.log_copy'), class: 'btn-secondary', icon: 'content_copy', onClick: copyUpdateLog },
                { label: _('updates.retry_update'), class: 'btn-primary', icon: 'replay', onClick: retryUpdateInstall }
            ];
            if (result?.restartTimeout) {
                errorFooter.splice(1, 0, {
                    label: _('updates.modal_reload_now'),
                    class: 'btn-secondary',
                    icon: 'refresh',
                    onClick: reloadConsole
                });
            }
            updateModalFooter(errorFooter);
            enableUpdateInstallBtn();
        }

        loadLastUpdateResult();
    }

    function enableUpdateInstallBtn() {
        const installBtn = document.getElementById('update-install-btn');
        if (!installBtn || !_updateState.remoteSHA) return;
        applyInstallButtonState(false);
    }

    async function retryUpdateInstall() {
        const proceed = await window.Modal.confirm({
            title: _('updates.retry_update'),
            message: _('updates.retry_confirm'),
            confirmLabel: _('updates.retry_update'),
            confirmIcon: 'replay'
        });
        if (!proceed) return;
        window.Modal.close();
        installUpdate({ skipConfirm: true });
    }

    function showUpdateCompletionModal(result) {
        if (hasUpdateFailures(result)) {
            transitionUpdateModal('partial_error', result);
        } else {
            transitionUpdateModal('success_no_reload', result);
        }
    }

    async function installUpdate(options = {}) {
        const { skipConfirm = false } = options;
        const installBtn = document.getElementById('update-install-btn');

        if (!_updateState.remoteSHA) {
            Notifications.error(_('updates.no_version'));
            return;
        }

        const hasServerUpdate = (_updateState.changedData?.grouped?.server || []).length > 0;
        const createBackup = document.getElementById('update-backup-toggle')?.checked ?? true;

        if (!skipConfirm) {
            // Preflight checks (issue #158)
            let preflightWarnings = [];
            try {
                const pfUrl = hasServerUpdate
                    ? `/api/settings/updates/preflight?serverUpdate=1&sha=${encodeURIComponent(_updateState.remoteSHA)}`
                    : '/api/settings/updates/preflight';
                const pf = await Utils.api(pfUrl);
                if (pf && pf.ready === false && Array.isArray(pf.issues) && pf.issues.length) {
                    Notifications.error(pf.issues.join('; '));
                    return;
                }
                if (pf && Array.isArray(pf.warnings)) preflightWarnings = pf.warnings;
            } catch (_e) { /* non-blocking if preflight endpoint unavailable */ }

            const scopeItems = getUpdateScopeLabels();
            const strategyNote = hasServerUpdate ? _('updates.auto_strategy_hint') : '';
            const warnHtml = preflightWarnings.length
                ? `<p class="text-muted" style="font-size:12px;margin-top:8px;">${preflightWarnings.map(w => Utils.escapeHtml(w)).join('<br>')}</p>`
                : '';
            const confirmHtml = `
                <p>${Utils.escapeHtml(_('updates.install_confirm'))}</p>
                <ul style="margin:8px 0 0 0;padding-left:20px;font-size:13px;color:var(--text-secondary);">
                    <li>${Utils.escapeHtml(createBackup ? _('updates.confirm_with_backup') : _('updates.confirm_no_backup'))}</li>
                    ${scopeItems.map(item => `<li>${Utils.escapeHtml(item)}</li>`).join('')}
                    ${hasServerUpdate ? `<li>${Utils.escapeHtml(strategyNote || '')}</li>` : ''}
                </ul>
                ${warnHtml}
            `;
            const proceed = await new Promise((resolve) => {
                window.Modal.show({
                    title: _('updates.confirm_title'),
                    content: confirmHtml,
                    buttons: [
                        { label: _('actions.cancel'),  class: 'btn-secondary', onClick: () => { window.Modal.close(); resolve(false); } },
                        { label: _('updates.install'), class: 'btn-primary', icon: 'system_update', onClick: () => { window.Modal.close(); resolve(true); } }
                    ],
                    closable: true,
                    onClose: () => resolve(false)
                });
            });
            if (!proceed) return;
        }

        if (installBtn) installBtn.disabled = true;
        clearUpdateReloadTimers();

        window.Modal.show({
            title: _('updates.modal_title'),
            content: buildUpdateModalContent(),
            buttons: [],
            closable: false,
            size: 'large',
            onOpen: () => bindUpdateLogControls()
        });

        UPDATE_PHASES.forEach(p => setUpdatePhase(p.id, 'pending'));
        setUpdatePhase('confirm', 'done');
        if (createBackup) setUpdatePhase('backup', 'active', _('updates.creating_backup'));
        else setUpdatePhase('backup', 'skipped', _('updates.backup_skipped'));
        if (!hasServerUpdate) setUpdatePhase('console', 'active', _('updates.downloading'));
        logUpdate(`Starting update to ${_updateState.remoteSHA.slice(0, 7)}…`);

        try {
            let result;
            try {
                result = await Utils.api('/api/settings/updates/install', {
                    method: 'POST',
                    body: { remoteSHA: _updateState.remoteSHA, createBackup }
                });
            } catch (installErr) {
                if (!isRecoverableInstallDisconnect(installErr)) throw installErr;
                logUpdate(_('updates.proxy_timeout_recovering'));
                setUpdatePhase('console', 'active', _('updates.proxy_timeout_recovering'));
                Notifications.info(_('updates.proxy_timeout_recovering'));
                result = await recoverInstallAfterDisconnect(_updateState.remoteSHA, hasServerUpdate);
            }

            finishInstallUi(result, hasServerUpdate);
        } catch (error) {
            const activePhase = UPDATE_PHASES.find(p => {
                const st = document.querySelector(`[data-phase-state="${p.id}"]`)?.dataset?.state;
                return st === 'active';
            });
            if (activePhase) setUpdatePhase(activePhase.id, 'error', error.message || _('updates.install_failed'));
            logUpdate(`ERROR: ${error.message || error}`);
            transitionUpdateModal('error', { errorMessage: error.message || _('errors.server_error') });
            Notifications.error(error.message || _('updates.install_failed'));
            enableUpdateInstallBtn();
        }
    }

    function isRecoverableInstallDisconnect(error) {
        if (!error) return false;
        if (error.gatewayTimeout) return true;
        if (error.status === 502 || error.status === 504) return true;
        const msg = String(error.message || '');
        if (/gateway\/proxy timeout/i.test(msg)) return true;
        if (!error.status && /failed to fetch|networkerror|network error|load failed|aborted/i.test(msg)) {
            return true;
        }
        return false;
    }

    function updateShaMatches(a, b) {
        if (!a || !b) return false;
        const left = String(a).trim().toLowerCase();
        const right = String(b).trim().toLowerCase();
        if (!left || !right) return false;
        return left === right
            || left.startsWith(right.slice(0, 7))
            || right.startsWith(left.slice(0, 7));
    }

    async function recoverInstallAfterDisconnect(targetSha, hasServerUpdate) {
        const maxMs = 600000;
        const intervalMs = 3000;
        const started = Date.now();
        let sawInProgress = false;
        let lastStatus = null;

        while (Date.now() - started < maxMs) {
            try {
                lastStatus = await Utils.api('/api/settings/updates/install-status');
                if (lastStatus?.inProgress) {
                    if (!sawInProgress) {
                        logUpdate(_('updates.install_still_running'));
                    }
                    sawInProgress = true;
                    setUpdatePhase('console', 'active', _('updates.install_still_running'));
                } else if (sawInProgress || updateShaMatches(lastStatus?.localSHA, targetSha)) {
                    logUpdate(_('updates.install_recovered'));
                    const lr = lastStatus?.lastResult || null;
                    const failed = Array.isArray(lr?.failed) ? lr.failed : [];
                    const servicesFailed = Array.isArray(lr?.servicesFailed) ? lr.servicesFailed : [];
                    const appliedCount = typeof lr?.applied === 'number' ? lr.applied : (updateShaMatches(lastStatus?.localSHA, targetSha) ? 1 : 0);
                    return {
                        applied: Array.from({ length: appliedCount }, () => ({ file: 'recovered' })),
                        failed,
                        servicesFailed,
                        servicesRestarted: lr?.servicesRestarted || [],
                        removed: [],
                        needsConsoleRestart: !lr?.consoleRestartBlocked,
                        consoleRestartBlocked: lr?.consoleRestartBlocked || null,
                        consoleRestartNote: lr?.consoleRestartNote || null,
                        shaSaved: updateShaMatches(lastStatus?.localSHA, targetSha),
                        serverBuild: lr?.serverBuild || (hasServerUpdate ? null : undefined),
                        serverDeploy: lr?.serverDeploy || null,
                        recoveredAfterDisconnect: true,
                    };
                }
            } catch (_e) {
                // Console may be restarting mid-poll — keep waiting.
                setUpdatePhase('restart', 'active', _('updates.restarting'));
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }

        throw new Error(_('updates.install_recovery_timeout'));
    }

    function finishInstallUi(result, hasServerUpdate) {
        ['backup', 'console'].forEach(p => {
            const st = document.querySelector(`[data-phase-state="${p}"]`)?.dataset?.state;
            if (st !== 'done' && st !== 'skipped') setUpdatePhase(p, 'done');
        });

        if (hasServerUpdate) {
            if (result.toolchainInstall) {
                if (result.toolchainInstall.success) {
                    logUpdate(`Go toolchain ready: ${result.toolchainInstall.version || ''}`.trim());
                } else {
                    logUpdate(`Go toolchain install failed: ${result.toolchainInstall.error || 'unknown'}`);
                }
            }
            const deployFailed = !!(result.serverDeploy && result.serverDeploy.success === false);
            if (result.serverBuild) {
                if (result.serverBuild.success && !deployFailed) {
                    const ms = result.serverBuild.duration || 0;
                    const secs = ms ? Math.round(ms / 1000) : 0;
                    const detail = `${_('updates.server_built')}${secs ? ` · ${secs}s` : ''}`;
                    setUpdatePhase('server', 'done', detail);
                    logUpdate(detail);
                } else if (result.serverBuild.success && deployFailed) {
                    const detail = _('updates.server_deploy_failed');
                    setUpdatePhase('server', 'error', detail);
                    logUpdate(`${detail}: ${result.serverDeploy.error || ''}`);
                } else {
                    const detail = _('updates.server_build_failed');
                    setUpdatePhase('server', 'error', detail);
                    logUpdate(`${detail}: ${result.serverBuild.error || ''}`);
                }
            } else if (result.recoveredAfterDisconnect) {
                setUpdatePhase('server', 'done', _('updates.install_recovered'));
            } else {
                setUpdatePhase('server', 'skipped', _('updates.server_skipped'));
            }
            if (result.autoRebuild) {
                if (result.autoRebuild.success) {
                    logUpdate(_('updates.server_built') + ' (auto-rebuild)');
                    setUpdatePhase('server', 'done', _('updates.server_built'));
                } else if (result.autoRebuild.error) {
                    logUpdate(`Auto-rebuild: ${result.autoRebuild.error}`);
                }
            }
            if (deployFailed && result.serverBuild?.success) {
                logUpdate(`Deploy failed: ${result.serverDeploy.error || ''}`);
            }
        } else {
            setUpdatePhase('server', 'skipped', _('updates.server_skipped'));
        }

        const applied = result.applied?.length || 0;
        const failed  = result.failed?.length || 0;
        const removed = result.removed?.length || 0;
        logUpdate(`${_('updates.applied')}: ${applied} · ${_('updates.failed')}: ${failed} · ${_('updates.removed')}: ${removed}`);
        if (result.agentRebuildDeferred) {
            logUpdate(`Support Agent rebuild deferred until the console restarts (${result.agentRebuildRemoteSHA?.slice(0, 7) || 'pending'}).`);
        } else if (result.agentRebuildQueued) {
            logUpdate(
                _('updates.agent_rebuild_queued')
                    .replace('{{count}}', String(result.agentRebuildBundles ?? '?'))
                    .replace('{{staged}}', String(result.agentSourcesStaged ?? 0))
                    .replace('{{paths}}', String(result.agentSourcePaths ?? 0))
            );
        }
        for (const item of (result.failed || [])) {
            if (item.file === 'support-agent-source-sync') {
                logUpdate(`${_('updates.agent_source_sync_failed')} ${item.error || ''}`);
            } else {
                logUpdate(`${item.file}: ${item.error || ''}`);
            }
        }
        for (const item of (result.servicesFailed || [])) {
            logUpdate(`${item.service}: ${item.error || ''}`);
        }

        if (result.needsConsoleRestart && !result.consoleRestartBlocked) {
            window.BetterDesk = window.BetterDesk || {};
            window.BetterDesk.consoleRestarting = true;
            setUpdatePhase('restart', 'active', _('updates.restarting'));
            logUpdate(_('updates.console_will_restart'));
            // systemd/NSSM normally needs a few seconds to replace the
            // process. Waiting through that grace window avoids logging
            // expected connection-refused probes in the browser console.
            setTimeout(() => pollConsoleRestart(result), result.recoveredAfterDisconnect ? 2000 : 8000);
        } else if (result.consoleRestartBlocked) {
            setUpdatePhase('restart', 'error', result.consoleRestartBlocked);
            logUpdate(result.consoleRestartBlocked);
            setUpdatePhase('done', 'done', _('updates.complete_with_errors'));
            showUpdateCompletionModal(result);
            loadServerBinaryStatus();
        } else {
            setUpdatePhase('restart', 'skipped', _('updates.no_restart_needed'));
            setUpdatePhase('done', 'done', _('updates.complete'));
            showUpdateCompletionModal(result);
            enableUpdateInstallBtn();
            loadServerBinaryStatus();
        }
    }

    function pollConsoleRestart(installResult) {
        window.BetterDesk = window.BetterDesk || {};
        window.BetterDesk.consoleRestarting = true;
        let attempts = 0;
        const maxAttempts = 90;
        const previousCacheVersion = window.BetterDesk?.cacheVersion || '';
        const interval = setInterval(async () => {
            attempts++;
            setUpdatePhase('restart', 'active', `${_('updates.restarting')} (${attempts}/${maxAttempts})`);
            try {
                const resp = await fetch('/api/settings/restart-status?_=' + Date.now(), {
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: { 'Cache-Control': 'no-cache' }
                });
                if (resp.ok) {
                    const body = await resp.json().catch(() => null);
                    const status = body?.data || body || {};
                    if (previousCacheVersion && status.cacheVersion && status.cacheVersion === previousCacheVersion) {
                        return;
                    }

                    clearInterval(interval);
                    window.BetterDesk.consoleRestarting = false;
                    setUpdatePhase('restart', 'done', _('updates.restart_complete'));
                    setUpdatePhase('done', 'done', _('updates.complete'));
                    logUpdate(_('updates.restart_complete'));

                    const merged = { ...(installResult || {}), restartTimeout: false };
                    if (hasUpdateFailures(merged)) {
                        transitionUpdateModal('partial_error', merged);
                    } else {
                        transitionUpdateModal('success_reload', merged);
                    }
                    return;
                }
            } catch (_e) {
                // Server still down, keep polling
            }
            if (attempts >= maxAttempts) {
                clearInterval(interval);
                window.BetterDesk.consoleRestarting = false;
                setUpdatePhase('restart', 'warning', _('updates.restart_timeout'));
                setUpdatePhase('done', 'done', _('updates.complete'));
                logUpdate(_('updates.restart_timeout'));

                const merged = {
                    ...(installResult || {}),
                    restartTimeout: true,
                    failed: installResult?.failed || [],
                    applied: installResult?.applied || [],
                    removed: installResult?.removed || []
                };
                transitionUpdateModal('partial_error', merged);
            }
        }, 2000);
    }
    
    function formatBytes(n) {
        if (!Number.isFinite(n) || n <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        let v = n;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
    }

    async function loadBackupRetention() {
        const input = document.getElementById('backup-retention-input');
        if (!input) return;
        try {
            const data = await Utils.api('/api/settings/backup/retention');
            const count = (data && typeof data.count === 'number') ? data.count : 0;
            input.value = String(count);
        } catch {
            input.value = '0';
        }
    }

    async function saveBackupRetention() {
        const input = document.getElementById('backup-retention-input');
        if (!input) return;
        const count = parseInt(input.value, 10);
        if (!Number.isFinite(count) || count < 0 || count > 1000) {
            Notifications.error(_('updates.retention_invalid'));
            return;
        }
        try {
            await Utils.api('/api/settings/backup/retention', {
                method: 'PUT',
                body: { count }
            });
            Notifications.success(_('updates.retention_saved'));
        } catch (err) {
            Notifications.error(err.message || _('errors.server_error'));
        }
    }

    async function pruneBackupsNow() {
        const input = document.getElementById('backup-retention-input');
        const count = parseInt(input?.value, 10);
        if (!Number.isFinite(count) || count <= 0) {
            Notifications.error(_('updates.retention_required_for_prune'));
            return;
        }
        if (!(await settingsConfirmCritical({
            title: _('settings.updates_tab.prune_now'),
            message: _('updates.prune_confirm').replace('{n}', String(count)),
            confirmLabel: _('settings.updates_tab.prune_now'),
            danger: true
        }))) return;
        try {
            const data = await Utils.api('/api/settings/updates/backups/prune', {
                method: 'POST',
                body: { keep: count }
            });
            const deleted = (data && Array.isArray(data.deleted)) ? data.deleted.length : 0;
            Notifications.success(_('updates.prune_done').replace('{n}', String(deleted)));
            await loadUpdateBackups();
        } catch (err) {
            Notifications.error(err.message || _('errors.server_error'));
        }
    }

    async function deleteBackup(name, btn) {
        if (!(await settingsConfirmCritical({
            title: _('updates.delete'),
            message: _('updates.delete_confirm').replace('{name}', name),
            confirmLabel: _('updates.delete'),
            danger: true
        }))) return;
        if (btn) btn.disabled = true;
        try {
            await Utils.api(`/api/settings/updates/backups/${encodeURIComponent(name)}`, {
                method: 'DELETE'
            });
            Notifications.success(_('updates.delete_success'));
            await loadUpdateBackups();
        } catch (err) {
            Notifications.error(err.message || _('errors.server_error'));
            if (btn) btn.disabled = false;
        }
    }

    async function loadUpdateBackups() {
        const listEl = document.getElementById('update-backups-list');
        if (!listEl) return;
        const summaryEl = document.getElementById('backup-summary');
        try {
            const data = await Utils.api('/api/settings/updates/backups');
            const backups = Array.isArray(data) ? data : (data.backups || []);
            if (!backups.length) {
                listEl.innerHTML = `<p class="state">${_('updates.no_backups')}</p>`;
                if (summaryEl) summaryEl.textContent = '';
                return;
            }
            const totalBytes = backups.reduce((acc, b) => acc + (b.sizeBytes || 0), 0);
            if (summaryEl) {
                summaryEl.innerHTML = _('settings.updates_tab.backups_summary')
                    .replace('{count}', `<strong>${backups.length}</strong>`)
                    .replace('{size}', Utils.escapeHtml(formatBytes(totalBytes)));
            }
            listEl.innerHTML = '<ul class="list update-backups">' + backups.map((b) => {
                const date = b.timestamp ? new Date(b.timestamp).toLocaleString() : '';
                const sha = b.sha ? `, <span class="mono">${Utils.escapeHtml(b.sha)}</span>` : '';
                const size = formatBytes(b.sizeBytes || 0);
                return `<li class="list-row update-backup-item">
                    <span class="row-main">
                        <span class="row-title">${Utils.escapeHtml(b.name)}</span>
                        <span class="row-sub">${date}${sha}, ${b.fileCount || b.filesBackedUp || 0} ${_('updates.files')}, ${size}</span>
                    </span>
                    <span class="row-end">
                        <button type="button" class="btn btn-sm" data-backup-restore="${Utils.escapeHtml(b.name)}">${_('settings.updates_tab.restore_files')}</button>
                        <button type="button" class="btn btn-sm btn-danger-quiet" data-backup-delete="${Utils.escapeHtml(b.name)}">${_('updates.delete')}</button>
                    </span>
                </li>`;
            }).join('') + '</ul>';

            listEl.querySelectorAll('[data-backup-restore]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const name = btn.dataset.backupRestore;
                    if (!(await settingsConfirmCritical({
                        title: _('settings.updates_tab.restore_files'),
                        message: _('updates.restore_confirm'),
                        confirmLabel: _('settings.updates_tab.restore_files'),
                        danger: true
                    }))) return;
                    btn.disabled = true;
                    try {
                        await Utils.api('/api/settings/updates/restore', { method: 'POST', body: { backupName: name } });
                        Notifications.success(_('updates.restore_success'));
                        setTimeout(() => window.location.reload(), 2000);
                    } catch (error) {
                        Notifications.error(error.message || _('errors.server_error'));
                        btn.disabled = false;
                    }
                });
            });
            listEl.querySelectorAll('[data-backup-delete]').forEach(btn => {
                btn.addEventListener('click', () => deleteBackup(btn.dataset.backupDelete, btn));
            });
        } catch (err) {
            listEl.innerHTML = `<p class="state is-error">${Utils.escapeHtml(err.message || _('errors.server_error'))}
                <button type="button" class="btn btn-sm" id="update-backups-retry">${_('actions.retry')}</button></p>`;
            document.getElementById('update-backups-retry')?.addEventListener('click', loadUpdateBackups);
            if (summaryEl) summaryEl.textContent = '';
        }
    }

    // Wire retention controls (idempotent — handles tab re-mount)
    document.addEventListener('click', (ev) => {
        const target = ev.target.closest('#backup-retention-save, #backup-prune-now');
        if (!target) return;
        if (target.id === 'backup-retention-save') saveBackupRetention();
        else if (target.id === 'backup-prune-now') pruneBackupsNow();
    });

    // Expose retention loader so tab activation can call it
    window.loadBackupRetention = loadBackupRetention;

    // ==================== LDAP / Authentication Section ====================

    /**
     * Initialize LDAP settings section
     */
    async function initEnrollmentSection() {
        const form = document.getElementById('enrollment-settings-section');
        if (!form) return;
        const modeRadios = form.querySelectorAll('input[name="settings_enrollment_mode"]');
        const richCb = document.getElementById('enrollment-rich-approve');
        const tagPickerCb = document.getElementById('enrollment-tag-picker');
        const pendingHint = document.getElementById('enrollment-pending-hint');
        let enrollmentMode = 'open';

        async function loadEnrollmentSettings() {
            try {
                const res = await Utils.api('/api/settings/enrollment');
                const data = res.data || res;
                enrollmentMode = data.mode || 'open';
                modeRadios.forEach(r => { r.checked = r.value === enrollmentMode; });
                if (richCb) richCb.checked = data.rich_approve !== false;
                if (tagPickerCb) tagPickerCb.checked = data.tag_picker !== false;
                if (pendingHint) {
                    pendingHint.textContent = data.pending_count > 0
                        ? _('settings.enrollment_pending_count').replace('{count}', String(data.pending_count))
                        : '';
                }
            } catch (err) {
                formFail(form, err.message || _('errors.server_error'));
            }
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const mode = form.querySelector('input[name="settings_enrollment_mode"]:checked')?.value || enrollmentMode;
            if (mode !== enrollmentMode) {
                const modeLabel = _('tokens.mode_' + mode);
                const ok = await settingsConfirmCritical({
                    title: tSettings('confirm.enrollment_mode_title', 'Change enrollment mode?'),
                    message: tSettings('confirm.enrollment_mode', 'Switch enrollment to “{mode}”? This affects how new RustDesk clients can register.')
                        .replace('{mode}', modeLabel),
                    confirmLabel: _('settings.signin.enrollment_save')
                });
                if (!ok) return;
            }
            try {
                await Utils.api('/api/settings/enrollment', {
                    method: 'PUT',
                    body: { mode, rich_approve: !!richCb?.checked, tag_picker: !!tagPickerCb?.checked }
                });
                await loadEnrollmentSettings();
                formOk(form);
            } catch (err) {
                formFail(form, err.message || _('errors.server_error'));
            }
        });

        await loadEnrollmentSettings();
    }

    async function initClientSessionsSection() {
        const form = document.getElementById('client-sessions-form');
        if (!form) return;

        const expiryInput = document.getElementById('client-sessions-expiry-days');
        const slidingCb = document.getElementById('client-sessions-sliding');
        const maxDaysInput = document.getElementById('client-sessions-max-days');

        async function loadClientSessionsSettings() {
            try {
                const res = await Utils.api('/api/settings/client-sessions');
                const data = res.data || res;
                if (expiryInput) expiryInput.value = String(data.expiry_days ?? 7);
                if (slidingCb) slidingCb.checked = data.sliding !== false;
                if (maxDaysInput) maxDaysInput.value = String(data.max_days ?? 30);
            } catch (err) {
                formFail(form, err.message || _('errors.server_error'));
            }
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const expiryDays = parseInt(expiryInput?.value, 10) || 7;
            const maxDays = parseInt(maxDaysInput?.value, 10) || 30;
            try {
                await Utils.api('/api/settings/client-sessions', {
                    method: 'PUT',
                    body: {
                        expiry_days: expiryDays,
                        sliding: !!slidingCb?.checked,
                        max_days: maxDays,
                    },
                });
                await loadClientSessionsSettings();
                formOk(form);
            } catch (err) {
                formFail(form, err.message || _('errors.server_error'));
            }
        });

        await loadClientSessionsSettings();
    }

    async function initLdapSection() {
        const form = document.getElementById('ldap-form');
        if (!form) return;

        const enabledCb = document.getElementById('ldap-enabled');
        const configFields = document.getElementById('ldap-config-fields');

        if (enabledCb && configFields) {
            enabledCb.addEventListener('change', async () => {
                if (enabledCb.checked && !_ldapWasEnabled) {
                    const ok = await settingsConfirmCritical({
                        title: tSettings('confirm.ldap_enable_title', 'Enable LDAP?'),
                        message: tSettings('confirm.ldap_enable', 'Enable LDAP / Active Directory sign-in? Console users may authenticate against your directory.'),
                        confirmLabel: _('settings.ldap_enabled'),
                        icon: 'domain'
                    });
                    if (!ok) {
                        enabledCb.checked = false;
                        configFields.style.display = 'none';
                        return;
                    }
                }
                configFields.style.display = enabledCb.checked ? '' : 'none';
            });
        }

        // Toggle direct bind vs bind+search fields
        const directBindCb = document.getElementById('ldap-direct-bind');
        const bindSearchFields = document.getElementById('ldap-bind-search-fields');
        const directBindFields = document.getElementById('ldap-direct-bind-fields');
        if (directBindCb) {
            directBindCb.addEventListener('change', () => {
                if (bindSearchFields) bindSearchFields.style.display = directBindCb.checked ? 'none' : '';
                if (directBindFields) directBindFields.style.display = directBindCb.checked ? '' : 'none';
            });
        }

        // Auto-update port when TLS checkbox changes
        const useTlsCb = document.getElementById('ldap-use-tls');
        const portInput = document.getElementById('ldap-port');
        if (useTlsCb && portInput) {
            useTlsCb.addEventListener('change', () => {
                const current = parseInt(portInput.value, 10);
                if (useTlsCb.checked && (current === 389 || !current)) {
                    portInput.value = 636;
                } else if (!useTlsCb.checked && current === 636) {
                    portInput.value = 389;
                }
            });
        }

        // Load existing config
        await loadLdapConfig();

        // Test connection button
        document.getElementById('ldap-test-btn')?.addEventListener('click', testLdapConnection);

        // Form submission
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = collectLdapData();
            if (data.enabled) {
                const confirmed = await settingsConfirmCritical({
                    title: tSettings('confirm.ldap_save_title', 'Save LDAP settings?'),
                    message: tSettings('confirm.ldap_save', 'Save LDAP configuration? Incorrect settings can block directory sign-in.'),
                    confirmLabel: _('settings.ldap_save'),
                    icon: 'save'
                });
                if (!confirmed) return;
            }
            await saveLdapConfig();
        });
    }

    /**
     * Load LDAP configuration from Go server (via Node.js proxy)
     */
    async function loadLdapConfig() {
        try {
            const data = await Utils.api('/api/settings/ldap');
            populateLdapForm(data);
            setSideOnOff('side-ldap', !!document.getElementById('ldap-enabled')?.checked);
        } catch (error) {
            console.error('Failed to load LDAP config:', error);
        }
    }

    /**
     * Populate LDAP form fields with config data
     */
    function populateLdapForm(data) {
        if (!data) return;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val ?? '';
        };
        const setChecked = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = !!val;
        };

        setChecked('ldap-enabled', data.enabled);
        _ldapWasEnabled = !!data.enabled;
        setVal('ldap-host', data.host);
        setVal('ldap-port', data.port || 389);
        setChecked('ldap-use-tls', data.use_tls);
        setChecked('ldap-start-tls', data.start_tls);
        setChecked('ldap-skip-tls-verify', data.skip_tls_verify);
        setVal('ldap-bind-dn', data.bind_dn);
        setVal('ldap-bind-password', data.bind_password);
        setVal('ldap-base-dn', data.base_dn);
        setVal('ldap-user-filter', data.user_filter);
        setVal('ldap-user-attr-id', data.user_attr_id);
        setVal('ldap-user-attr-email', data.user_attr_email);
        setVal('ldap-user-attr-name', data.user_attr_name);
        setVal('ldap-group-base-dn', data.group_base_dn);
        setVal('ldap-group-filter', data.group_filter);
        setVal('ldap-group-attr-name', data.group_attr_name);
        setVal('ldap-default-role', data.default_role || 'viewer');
        setVal('ldap-group-role-map', data.group_role_map);
        setChecked('ldap-direct-bind', data.direct_bind);
        setVal('ldap-direct-bind-dn', data.direct_bind_dn);
        setVal('ldap-conn-timeout', data.conn_timeout_sec || 10);

        // Update visibility
        const configFields = document.getElementById('ldap-config-fields');
        if (configFields) configFields.style.display = data.enabled ? '' : 'none';

        const bindSearchFields = document.getElementById('ldap-bind-search-fields');
        const directBindFields = document.getElementById('ldap-direct-bind-fields');
        if (bindSearchFields) bindSearchFields.style.display = data.direct_bind ? 'none' : '';
        if (directBindFields) directBindFields.style.display = data.direct_bind ? '' : 'none';
    }

    /**
     * Collect LDAP form data
     */
    function collectLdapData() {
        const getVal = (id) => {
            const el = document.getElementById(id);
            return el ? el.value.trim() : '';
        };
        const getChecked = (id) => {
            const el = document.getElementById(id);
            return el ? el.checked : false;
        };

        return {
            enabled: getChecked('ldap-enabled'),
            host: getVal('ldap-host'),
            port: parseInt(getVal('ldap-port'), 10) || 389,
            use_tls: getChecked('ldap-use-tls'),
            start_tls: getChecked('ldap-start-tls'),
            skip_tls_verify: getChecked('ldap-skip-tls-verify'),
            bind_dn: getVal('ldap-bind-dn'),
            bind_password: getVal('ldap-bind-password'),
            base_dn: getVal('ldap-base-dn'),
            user_filter: getVal('ldap-user-filter'),
            user_attr_id: getVal('ldap-user-attr-id'),
            user_attr_email: getVal('ldap-user-attr-email'),
            user_attr_name: getVal('ldap-user-attr-name'),
            group_base_dn: getVal('ldap-group-base-dn'),
            group_filter: getVal('ldap-group-filter'),
            group_attr_name: getVal('ldap-group-attr-name'),
            default_role: getVal('ldap-default-role'),
            group_role_map: getVal('ldap-group-role-map'),
            direct_bind: getChecked('ldap-direct-bind'),
            direct_bind_dn: getVal('ldap-direct-bind-dn'),
            conn_timeout_sec: parseInt(getVal('ldap-conn-timeout'), 10) || 10
        };
    }

    /**
     * Save LDAP configuration
     */
    async function saveLdapConfig() {
        const form = document.getElementById('ldap-form');
        try {
            const data = collectLdapData();
            await Utils.api('/api/settings/ldap', { method: 'PUT', body: data });
            _ldapWasEnabled = data.enabled;
            setSideOnOff('side-ldap', !!data.enabled);
            formOk(form, _('settings.ldap_saved'));
        } catch (error) {
            formFail(form, error.message || _('errors.server_error'));
        }
    }

    /**
     * Test LDAP connection with current form values
     */
    async function testLdapConnection() {
        const btn = document.getElementById('ldap-test-btn');
        const resultEl = document.getElementById('ldap-test-result');
        if (!btn) return;
        setBusy(btn, true, _('settings.ldap_testing'));
        setStatus(resultEl, '');
        try {
            const result = await Utils.api('/api/settings/ldap/test', { method: 'POST', body: collectLdapData() });
            if (result.success) setStatus(resultEl, _('settings.ldap_test_success'), 'ok');
            else setStatus(resultEl, result.error || _('settings.ldap_test_failed'), 'error');
        } catch (error) {
            setStatus(resultEl, error.message || _('settings.ldap_test_failed'), 'error');
        } finally {
            setBusy(btn, false);
        }
    }

    // ==================== OIDC / OAuth2 Section ====================

    const OIDC_CALLBACK_PATHS = ['/api/auth/oidc/callback', '/api/oidc/callback'];

    function suggestedOidcRedirectUrl() {
        return window.location.origin.replace(/\/+$/, '') + '/api/auth/oidc/callback';
    }

    function isValidOidcRedirectUrlClient(raw) {
        if (!raw || typeof raw !== 'string') return false;
        try {
            const u = new URL(raw.trim());
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
            const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
            return OIDC_CALLBACK_PATHS.includes(path);
        } catch {
            return false;
        }
    }

    function updateOidcRedirectWarning() {
        const warn = document.getElementById('oidc-redirect-url-warning');
        const input = document.getElementById('oidc-redirect-url');
        const enabled = document.getElementById('oidc-enabled')?.checked;
        if (!warn || !input) return;

        const value = (input.value || '').trim();
        if (!enabled || !value) {
            warn.style.display = 'none';
            warn.textContent = '';
            return;
        }
        if (isValidOidcRedirectUrlClient(value)) {
            warn.style.display = 'none';
            warn.textContent = '';
            return;
        }
        const suggest = suggestedOidcRedirectUrl();
        warn.style.display = '';
        warn.textContent = _('settings.oidc_redirect_url_invalid') + ' ' +
            _('settings.oidc_redirect_url_example').replace('{url}', suggest);
    }

    async function initOidcSection() {
        const form = document.getElementById('oidc-form');
        if (!form) return;

        // Toggle config fields visibility based on enabled checkbox
        const enabledCb = document.getElementById('oidc-enabled');
        const configFields = document.getElementById('oidc-config-fields');
        if (enabledCb && configFields) {
            enabledCb.addEventListener('change', async () => {
                if (enabledCb.checked && !_oidcWasEnabled) {
                    const ok = await settingsConfirmCritical({
                        title: tSettings('confirm.oidc_enable_title', 'Enable SSO?'),
                        message: tSettings('confirm.oidc_enable', 'Enable OIDC / SSO sign-in? Users may authenticate through your identity provider.'),
                        confirmLabel: _('settings.oidc_enabled'),
                        icon: 'login'
                    });
                    if (!ok) {
                        enabledCb.checked = false;
                        configFields.style.display = 'none';
                        updateOidcRedirectWarning();
                        return;
                    }
                }
                configFields.style.display = enabledCb.checked ? '' : 'none';
                // Prefill Redirect URL with panel callback when enabling and field is empty
                if (enabledCb.checked) {
                    const redirectInput = document.getElementById('oidc-redirect-url');
                    if (redirectInput && !redirectInput.value.trim()) {
                        redirectInput.value = suggestedOidcRedirectUrl();
                    }
                    const panelInput = document.getElementById('oidc-panel-url');
                    if (panelInput && !panelInput.value.trim()) {
                        panelInput.value = window.location.origin;
                    }
                }
                updateOidcRedirectWarning();
            });
        }

        // Toggle manual endpoints based on auto-discovery checkbox
        const autoDiscoveryCb = document.getElementById('oidc-auto-discovery');
        const manualEndpoints = document.getElementById('oidc-manual-endpoints');
        if (autoDiscoveryCb && manualEndpoints) {
            autoDiscoveryCb.addEventListener('change', () => {
                manualEndpoints.style.display = autoDiscoveryCb.checked ? 'none' : '';
            });
        }

        document.getElementById('oidc-redirect-url')?.addEventListener('input', updateOidcRedirectWarning);
        document.getElementById('oidc-redirect-url')?.addEventListener('change', updateOidcRedirectWarning);

        // Load existing config
        await loadOidcConfig();

        // Test discovery button
        document.getElementById('oidc-test-btn')?.addEventListener('click', testOidcDiscovery);

        // Form submission
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = collectOidcData();
            if (data.enabled) {
                if (!isValidOidcRedirectUrlClient(data.redirect_url)) {
                    updateOidcRedirectWarning();
                    formFail(form, _('settings.oidc_redirect_url_invalid'));
                    document.getElementById('oidc-redirect-url')?.focus();
                    return;
                }
                const confirmed = await settingsConfirmCritical({
                    title: tSettings('confirm.oidc_save_title', 'Save SSO settings?'),
                    message: tSettings('confirm.oidc_save', 'Save OIDC / SSO configuration? Incorrect settings can block SSO sign-in.'),
                    confirmLabel: _('settings.oidc_save'),
                    icon: 'save'
                });
                if (!confirmed) return;
            }
            await saveOidcConfig();
        });
    }

    async function loadOidcConfig() {
        try {
            const data = await Utils.api('/api/settings/oidc');
            populateOidcForm(data);
            setSideOnOff('side-oidc', !!document.getElementById('oidc-enabled')?.checked);
        } catch (error) {
            console.error('Failed to load OIDC config:', error);
        }
    }

    function populateOidcForm(data) {
        if (!data) return;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val ?? '';
        };
        const setChecked = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = !!val;
        };

        setChecked('oidc-enabled', data.enabled);
        _oidcWasEnabled = !!data.enabled;
        setVal('oidc-display-name', data.display_name);
        setVal('oidc-issuer-url', data.issuer_url);
        setVal('oidc-allowed-private-cidrs', data.allowed_private_cidrs);
        setVal('oidc-client-id', data.client_id);
        setVal('oidc-client-secret', data.client_secret);
        setVal('oidc-redirect-url', data.redirect_url || '');
        setVal('oidc-panel-url', data.panel_url || window.location.origin);
        setVal('oidc-scopes', data.scopes || 'openid profile email');
        setChecked('oidc-use-pkce', data.use_pkce);
        setChecked('oidc-auto-discovery', data.auto_discovery !== false);
        setChecked('oidc-allow-signup', data.allow_signup !== false);
        setChecked('oidc-prefer-sso', data.prefer_sso === true);
        setVal('oidc-authorization-url', data.authorization_url);
        setVal('oidc-token-url', data.token_url);
        setVal('oidc-userinfo-url', data.userinfo_url);
        setVal('oidc-claim-username', data.claim_username || 'preferred_username');
        setVal('oidc-claim-email', data.claim_email || 'email');
        setVal('oidc-claim-name', data.claim_name || 'name');
        setVal('oidc-claim-groups', data.claim_groups || 'groups');
        setVal('oidc-default-role', data.default_role || 'viewer');
        setVal('oidc-group-role-map', data.group_role_map);

        // Update visibility
        const configFields = document.getElementById('oidc-config-fields');
        if (configFields) configFields.style.display = data.enabled ? '' : 'none';
        const manualEndpoints = document.getElementById('oidc-manual-endpoints');
        if (manualEndpoints) manualEndpoints.style.display = (data.auto_discovery !== false) ? 'none' : '';
        updateOidcRedirectWarning();
    }

    function collectOidcData() {
        const getVal = (id) => {
            const el = document.getElementById(id);
            return el ? el.value.trim() : '';
        };
        const getChecked = (id) => {
            const el = document.getElementById(id);
            return el ? el.checked : false;
        };

        return {
            enabled: getChecked('oidc-enabled'),
            display_name: getVal('oidc-display-name'),
            issuer_url: getVal('oidc-issuer-url'),
            allowed_private_cidrs: getVal('oidc-allowed-private-cidrs'),
            client_id: getVal('oidc-client-id'),
            client_secret: getVal('oidc-client-secret'),
            redirect_url: getVal('oidc-redirect-url'),
            panel_url: getVal('oidc-panel-url') || window.location.origin,
            scopes: getVal('oidc-scopes'),
            use_pkce: getChecked('oidc-use-pkce'),
            auto_discovery: getChecked('oidc-auto-discovery'),
            allow_signup: getChecked('oidc-allow-signup'),
            prefer_sso: getChecked('oidc-prefer-sso'),
            authorization_url: getVal('oidc-authorization-url'),
            token_url: getVal('oidc-token-url'),
            userinfo_url: getVal('oidc-userinfo-url'),
            claim_username: getVal('oidc-claim-username'),
            claim_email: getVal('oidc-claim-email'),
            claim_name: getVal('oidc-claim-name'),
            claim_groups: getVal('oidc-claim-groups'),
            default_role: getVal('oidc-default-role'),
            group_role_map: getVal('oidc-group-role-map')
        };
    }

    async function saveOidcConfig() {
        const form = document.getElementById('oidc-form');
        try {
            const data = collectOidcData();
            await Utils.api('/api/settings/oidc', { method: 'PUT', body: data });
            _oidcWasEnabled = data.enabled;
            setSideOnOff('side-oidc', !!data.enabled);
            formOk(form, _('settings.oidc_saved'));
        } catch (error) {
            formFail(form, error.message || _('errors.server_error'));
        }
    }

    async function testOidcDiscovery() {
        const btn = document.getElementById('oidc-test-btn');
        const resultEl = document.getElementById('oidc-test-result');
        if (!btn) return;
        setStatus(resultEl, '');
        const issuerUrl = document.getElementById('oidc-issuer-url')?.value?.trim();
        if (!issuerUrl) {
            setStatus(resultEl, _('settings.oidc_issuer_required'), 'error');
            document.getElementById('oidc-issuer-url')?.focus();
            return;
        }
        setBusy(btn, true, _('settings.oidc_testing'));
        try {
            const result = await Utils.api('/api/settings/oidc/test', {
                method: 'POST',
                body: {
                    issuer_url: issuerUrl,
                    allowed_private_cidrs: document.getElementById('oidc-allowed-private-cidrs')?.value?.trim() || ''
                }
            });
            if (result.success) {
                const found = [result.authorization_endpoint, result.token_endpoint, result.userinfo_endpoint].filter(Boolean);
                setStatus(resultEl, _('settings.oidc_test_success') + (found.length ? ' ' + found.join(', ') : ''), 'ok');
            } else {
                setStatus(resultEl, result.error || _('settings.oidc_test_failed'), 'error');
            }
        } catch (error) {
            setStatus(resultEl, error.message || _('settings.oidc_test_failed'), 'error');
        } finally {
            setBusy(btn, false);
        }
    }

    // ==================== Advanced config files =================================

    const advancedState = { files: [], activeId: null, dirty: false, original: '' };

    /** Utils.api unwraps { success, data } — accept both shapes. */
    function unwrapAdvancedPayload(resp) {
        if (resp == null) return resp;
        if (Array.isArray(resp)) return resp;
        if (typeof resp === 'object' && resp.content !== undefined && resp.path !== undefined) {
            return resp;
        }
        if (typeof resp === 'object' && resp.data !== undefined) return resp.data;
        return resp;
    }

    function initAdvancedSection() {
        const listEl = document.getElementById('advanced-config-file-list');
        const textarea = document.getElementById('advanced-config-textarea');
        const saveBtn = document.getElementById('advanced-config-save');
        const reloadBtn = document.getElementById('advanced-config-reload');
        const restartBtn = document.getElementById('advanced-config-restart');
        if (!listEl) return;

        loadAdvancedFileList();

        saveBtn?.addEventListener('click', saveAdvancedFile);
        restartBtn?.addEventListener('click', restartAdvancedServices);
        reloadBtn?.addEventListener('click', () => {
            if (advancedState.activeId) loadAdvancedFile(advancedState.activeId, true);
        });

        textarea?.addEventListener('input', () => {
            advancedState.dirty = textarea.value !== advancedState.original;
            if (saveBtn) saveBtn.disabled = !advancedState.dirty;
        });

        window.addEventListener('beforeunload', (e) => {
            if (advancedState.dirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    async function loadAdvancedFileList() {
        const listEl = document.getElementById('advanced-config-file-list');
        if (!listEl) return;
        try {
            const resp = await Utils.api('/api/settings/advanced/files');
            advancedState.files = unwrapAdvancedPayload(resp) || [];
            if (!Array.isArray(advancedState.files)) advancedState.files = [];
            if (!advancedState.files.length) {
                listEl.innerHTML = '<li class="list-row is-empty"><span class="row-main">' + _('settings.advanced_no_files') + '</span></li>';
                return;
            }
            listEl.innerHTML = advancedState.files.map((f) => {
                const label = _('settings.advanced_file_' + f.id) !== 'settings.advanced_file_' + f.id
                    ? _('settings.advanced_file_' + f.id)
                    : f.id;
                const status = f.exists
                    ? (f.writable ? '' : _('settings.advanced_readonly'))
                    : _('settings.advanced_missing');
                const disabled = !f.exists && !f.canCreate;
                const active = advancedState.activeId === f.id;
                return '<li><button type="button" class="list-row advanced-config-file-btn' + (active ? ' active' : '') +
                    '" data-id="' + Utils.escapeHtml(f.id) + '"' + (active ? ' aria-current="true"' : '') +
                    (disabled ? ' disabled' : '') + '><span class="row-main"><span class="row-title">' +
                    Utils.escapeHtml(label) + '</span>' + (status ? '<span class="row-sub">' + Utils.escapeHtml(status) + '</span>' : '') +
                    '</span></button></li>';
            }).join('');

            listEl.querySelectorAll('.advanced-config-file-btn').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const id = btn.getAttribute('data-id');
                    if (!id) return;
                    if (advancedState.dirty && !await settingsConfirmCritical({
                        title: tSettings('confirm.advanced_discard_title', 'Discard changes?'),
                        message: _('settings.advanced_unsaved_confirm'),
                        confirmLabel: _('actions.confirm'),
                        icon: 'undo',
                        danger: true
                    })) return;
                    loadAdvancedFile(id);
                });
            });

        } catch (err) {
            listEl.innerHTML = '<li class="list-row is-empty"><span class="row-main text-danger">' + Utils.escapeHtml(err.message || _('errors.server_error')) + '</span></li>';
        }
    }

    function advancedRestartHint(restart) {
        if (restart === 'none') return _('settings.advanced_restart_none');
        const map = {
            console: _('settings.advanced_restart_console'),
            goserver: _('settings.advanced_restart_goserver'),
            systemd: _('settings.advanced_restart_systemd')
        };
        return map[restart] || _('settings.advanced_restart_generic');
    }

    function updateAdvancedRestartButton(catalogOrData) {
        const restartBtn = document.getElementById('advanced-config-restart');
        if (!restartBtn) return;
        const canRestart = catalogOrData && catalogOrData.requiresRestart !== 'none';
        const show = canRestart && (catalogOrData.exists || catalogOrData.canCreate);
        restartBtn.hidden = !show;
    }

    async function loadAdvancedFile(id, force) {
        if (!force && advancedState.dirty && !await settingsConfirmCritical({
            title: tSettings('confirm.advanced_discard_title', 'Discard changes?'),
            message: _('settings.advanced_unsaved_confirm'),
            confirmLabel: _('actions.confirm'),
            icon: 'undo',
            danger: true
        })) return;

        const placeholder = document.getElementById('advanced-config-placeholder');
        const toolbar = document.getElementById('advanced-config-toolbar');
        const textarea = document.getElementById('advanced-config-textarea');
        const hint = document.getElementById('advanced-config-restart-hint');
        const saveBtn = document.getElementById('advanced-config-save');
        const meta = document.getElementById('advanced-config-meta');
        const pathEl = document.getElementById('advanced-config-path');

        const catalog = advancedState.files.find((f) => f.id === id);
        if (catalog && !catalog.exists && catalog.canCreate) {
            advancedState.activeId = id;
            advancedState.original = '';
            advancedState.dirty = false;
            if (placeholder) placeholder.hidden = true;
            if (toolbar) toolbar.hidden = false;
            if (textarea) {
                textarea.hidden = false;
                textarea.value = '# ' + _('settings.advanced_new_file_hint') + '\n';
                textarea.disabled = !catalog.writable;
            }
            if (pathEl) pathEl.textContent = catalog.path;
            if (meta) meta.textContent = _('settings.advanced_new_file');
            if (hint) {
                hint.hidden = false;
                hint.textContent = advancedRestartHint(catalog.requiresRestart);
            }
            if (saveBtn) saveBtn.disabled = !catalog.writable;
            updateAdvancedRestartButton(catalog);
            markActiveAdvancedFile(id);
            return;
        }

        try {
            const resp = await Utils.api('/api/settings/advanced/files/' + encodeURIComponent(id));
            const data = unwrapAdvancedPayload(resp);
            const cat = advancedState.files.find((f) => f.id === id);
            advancedState.activeId = id;
            advancedState.original = data.content || '';
            advancedState.dirty = false;

            if (placeholder) placeholder.hidden = true;
            if (toolbar) toolbar.hidden = false;
            if (textarea) {
                textarea.hidden = false;
                textarea.value = advancedState.original;
                textarea.disabled = cat ? !cat.writable : false;
            }
            if (pathEl) pathEl.textContent = data.path;
            if (meta) {
                const kb = ((data.size || 0) / 1024).toFixed(1);
                meta.textContent = kb + ' KB · ' + (data.mtime || '');
            }
            if (hint) {
                hint.hidden = false;
                hint.textContent = advancedRestartHint(data.requiresRestart);
            }
            if (saveBtn) saveBtn.disabled = !cat || !cat.writable;
            updateAdvancedRestartButton(cat || { exists: true });

            markActiveAdvancedFile(id);
        } catch (err) {
            Notifications.error(err.message || _('errors.server_error'));
        }
    }

    function markActiveAdvancedFile(id) {
        document.querySelectorAll('.advanced-config-file-btn').forEach((b) => {
            const on = b.getAttribute('data-id') === id;
            b.classList.toggle('active', on);
            if (on) b.setAttribute('aria-current', 'true');
            else b.removeAttribute('aria-current');
        });
        document.querySelector('.advanced-config-layout')?.classList.add('is-detail-open');
    }

    async function saveAdvancedFile() {
        const id = advancedState.activeId;
        const textarea = document.getElementById('advanced-config-textarea');
        if (!id || !textarea) return;

        const catalog = advancedState.files.find((f) => f.id === id);
        if (catalog && !catalog.writable) {
            Notifications.error(_('settings.advanced_error_not_writable'));
            return;
        }

        if (!await settingsConfirmCritical({
            title: tSettings('confirm.advanced_save_title', 'Save configuration file?'),
            message: _('settings.advanced_save_confirm'),
            confirmLabel: _('settings.advanced_save'),
            icon: 'save'
        })) return;

        const saveBtn = document.getElementById('advanced-config-save');
        if (saveBtn) saveBtn.disabled = true;

        try {
            const resp = await Utils.api('/api/settings/advanced/files/' + encodeURIComponent(id), {
                method: 'PUT',
                body: { content: textarea.value }
            });
            advancedState.original = textarea.value;
            advancedState.dirty = false;
            let msg = _('settings.advanced_saved');
            if (resp && resp.backupPath) {
                msg += ' (' + _('settings.advanced_backup_created') + ')';
            }
            Notifications.success(msg);
            await loadAdvancedFileList();
            loadAdvancedFile(id, true);
            if (resp?.restartRequired) showRestartPrompt(resp.restartRequired);
        } catch (err) {
            Notifications.error(err.message || _('errors.server_error'));
            if (saveBtn) saveBtn.disabled = advancedState.dirty;
        }
    }

    async function restartAdvancedServices(skipConfirm) {
        const id = advancedState.activeId;
        if (!id) return;

        if (advancedState.dirty && !await settingsConfirmCritical({
            title: tSettings('confirm.advanced_discard_title', 'Discard changes?'),
            message: _('settings.advanced_unsaved_confirm'),
            confirmLabel: _('actions.confirm'),
            icon: 'undo',
            danger: true
        })) return;

        if (_restartPending?.phase === 'pending') {
            if (!skipConfirm) showRestartPrompt(_restartPending);
            else await confirmPendingRestart();
            return;
        }
        Notifications.info(tSettings('restart_save_first', 'Save the configuration before restarting the services.'));
    }

    function pollAdvancedConsoleRestart() {
        window.BetterDesk = window.BetterDesk || {};
        window.BetterDesk.consoleRestarting = true;
        let attempts = 0;
        const maxAttempts = 90;
        const previousCacheVersion = window.BetterDesk?.cacheVersion || '';
        Notifications.info(_('settings.advanced_restart_polling'));

        const interval = setInterval(async () => {
            attempts++;
            try {
                const resp = await fetch('/api/settings/restart-status?_=' + Date.now(), {
                    credentials: 'same-origin',
                    cache: 'no-store'
                });
                if (resp.ok) {
                    const body = await resp.json().catch(() => null);
                    const status = body?.data || body || {};
                    if (previousCacheVersion && status.cacheVersion && status.cacheVersion === previousCacheVersion) {
                        return;
                    }
                    clearInterval(interval);
                    window.BetterDesk.consoleRestarting = false;
                    Notifications.success(_('settings.advanced_restart_done'));
                    setTimeout(() => window.location.reload(), 2000);
                    return;
                }
            } catch (_) { /* console still restarting */ }
            if (attempts >= maxAttempts) {
                clearInterval(interval);
                window.BetterDesk.consoleRestarting = false;
                Notifications.warning(_('settings.advanced_restart_timeout'));
            }
        }, 2000);
    }

    // ==================== Email / SMTP ====================

    function initEmailSection() {
        const form = document.getElementById('email-smtp-form');
        const testBtn = document.getElementById('email-smtp-test-btn');
        const testStatus = document.getElementById('email-smtp-test-status');
        if (!form || !testBtn) return;

        loadEmailSmtpConfig();

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const body = {
                host: document.getElementById('email-smtp-host')?.value.trim() || '',
                port: parseInt(document.getElementById('email-smtp-port')?.value, 10) || 587,
                secure: !!document.getElementById('email-smtp-secure')?.checked,
                user: document.getElementById('email-smtp-user')?.value.trim() || '',
                pass: document.getElementById('email-smtp-pass')?.value || '',
                from: document.getElementById('email-smtp-from')?.value.trim() || '',
                alert_email: document.getElementById('email-smtp-alert')?.value.trim() || '',
            };
            if (!_smtpWasConfigured || body.host) {
                const confirmed = await settingsConfirmCritical({
                    title: tSettings('confirm.smtp_save_title', 'Save SMTP settings?'),
                    message: tSettings('confirm.smtp_save', 'Save SMTP configuration? Alert emails and notifications will use this mail server.'),
                    confirmLabel: _('settings.email.smtp_save') || _('actions.save')
                });
                if (!confirmed) return;
            }
            try {
                await Utils.api('/api/settings/email/smtp', { method: 'PUT', body });
                document.getElementById('email-smtp-pass').value = '';
                await loadEmailSmtpConfig();
                formOk(form, _('settings.email.smtp_saved'));
            } catch (err) {
                formFail(form, err.message || _('errors.server_error'));
            }
        });

        testBtn.addEventListener('click', async () => {
            setBusy(testBtn, true);
            setStatus(testStatus, '');
            try {
                const data = await Utils.api('/api/settings/email/smtp/test', { method: 'POST', body: {} });
                if (data.success) setStatus(testStatus, _('settings.email.smtp_test_success'), 'ok');
                else setStatus(testStatus, data.error || _('settings.email.smtp_test_failed'), 'error');
            } catch (err) {
                setStatus(testStatus, err.message || _('settings.email.smtp_test_failed'), 'error');
            } finally {
                setBusy(testBtn, false);
            }
        });
    }

    async function loadEmailSmtpConfig() {
        try {
            const config = await Utils.api('/api/settings/email/smtp');
            renderEmailSide(config);
            if (!config.configured) {
                _smtpWasConfigured = false;
                return;
            }
            _smtpWasConfigured = true;
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
            set('email-smtp-host', config.host || '');
            set('email-smtp-port', config.port || 587);
            const secure = document.getElementById('email-smtp-secure');
            if (secure) secure.checked = !!config.secure;
            set('email-smtp-user', config.user || '');
            set('email-smtp-from', config.from || '');
            set('email-smtp-alert', config.alert_email || '');
        } catch (err) {
            renderEmailSide(null, err.message || _('errors.server_error'));
            formFail(document.getElementById('email-smtp-form'), err.message || _('errors.server_error'));
        }
    }

    // ==================== Side column ====================
    // Each tab has a side column with its contents and what is in use now.
    // On screens of 1200 px and wider the contents move into it; below that
    // they stay above the forms, because the side column follows the main one.

    const SIDE_MIN_WIDTH = '(min-width: 1200px)';

    function initSettingsSide() {
        const panel = document.querySelector('.settings-tab-content:not([hidden])');
        const nav = panel?.querySelector('.settings-toc');
        const side = panel?.querySelector('.settings-side');
        if (!nav || !side) return;

        const anchor = document.createComment('settings-toc');
        nav.before(anchor);
        const mq = window.matchMedia(SIDE_MIN_WIDTH);
        const place = () => {
            if (mq.matches) {
                if (nav.parentElement !== side) side.prepend(nav);
            } else if (anchor.nextSibling !== nav) {
                anchor.after(nav);
            }
            nav.classList.toggle('is-side', mq.matches);
        };
        place();
        if (mq.addEventListener) mq.addEventListener('change', place);
        else if (mq.addListener) mq.addListener(place);

        // Mark the part of the page that is in view
        if (!('IntersectionObserver' in window)) return;
        const links = Array.from(nav.querySelectorAll('a[href^="#"]'));
        const blocks = links.map((a) => {
            const target = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
            if (!target) return null;
            const block = target.matches('section, form, .danger-zone, .settings-subgroup')
                ? target
                : (target.closest('.settings-subgroup, form, section') || target);
            return { link: a, block };
        }).filter(Boolean);
        const inView = new Map();
        const io = new IntersectionObserver((entries) => {
            entries.forEach((e) => inView.set(e.target, e.isIntersecting));
            const current = blocks.find((b) => inView.get(b.block));
            blocks.forEach((b) => {
                if (current && b.link === current.link) b.link.setAttribute('aria-current', 'true');
                else b.link.removeAttribute('aria-current');
            });
        }, { rootMargin: '-64px 0px -55% 0px' });
        blocks.forEach((b) => io.observe(b.block));
    }

    function setSideOnOff(id, on) {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = `<span class="status ${on ? 'ok' : 'offline'}">${on ? _('settings.side.on') : _('settings.side.off')}</span>`;
    }

    // General: the addresses clients get now, and how a connection travels

    let _clientConfig = null;

    function endpointSourceLabel(source) {
        if (source === 'env') return _('settings.side.src_page');
        if (source === 'panel_host') return _('settings.side.src_overview');
        return _('settings.side.src_auto');
    }

    async function loadClientConfigSummary() {
        const state = document.getElementById('general-side-state');
        const facts = document.getElementById('general-side-facts');
        if (!state || !facts) return;
        state.className = 'state';
        state.textContent = _('common.loading');
        state.hidden = false;
        try {
            const resp = await Utils.api('/api/dashboard/client-config');
            const d = resp.data || resp;
            _clientConfig = d;
            const src = d.endpoint_sources || {};
            const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text || '-'; };
            set('side-id-server', d.server_id);
            set('side-id-source', endpointSourceLabel(src.host));
            set('side-relay-server', d.relay_server);
            set('side-relay-source', endpointSourceLabel(src.relay));
            set('side-api-url', d.api_url);
            set('side-api-source', endpointSourceLabel(src.api));
            const local = document.getElementById('general-side-local');
            if (local) local.hidden = !d.phone_unreachable_host;
            facts.hidden = false;
            state.hidden = true;
        } catch (err) {
            facts.hidden = true;
            state.className = 'state is-error';
            state.innerHTML = `${Utils.escapeHtml(err.message || _('errors.server_error'))}
                <button type="button" class="btn btn-sm" id="general-side-retry">${_('actions.retry')}</button>`;
            document.getElementById('general-side-retry')?.addEventListener('click', loadClientConfigSummary);
        }
        renderConnectionDiagram();
    }

    /** "host:port", "[v6]:port" or a URL to { host, port } */
    function splitHostPort(value, fallbackPort) {
        const v = String(value || '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '');
        if (!v) return { host: '', port: fallbackPort };
        const v6 = v.match(/^\[([^\]]+)\](?::(\d+))?$/);
        if (v6) return { host: v6[1], port: v6[2] ? Number(v6[2]) : fallbackPort };
        const parts = v.split(':');
        if (parts.length === 2 && /^\d+$/.test(parts[1])) return { host: parts[0], port: Number(parts[1]) };
        return { host: v, port: fallbackPort };
    }

    /** The diagram under Connection strategy: the addresses typed above (or the ones clients get now) and the chosen strategy. */
    function renderConnectionDiagram() {
        const el = document.getElementById('connection-diagram');
        if (!el || !window.UiDiagram) return;
        const typedId = document.getElementById('public-server-id')?.value.trim() || '';
        const typedRelay = document.getElementById('public-relay-server')?.value.trim() || '';
        const id = splitHostPort(typedId || _clientConfig?.server_id, 21116);
        const relay = splitHostPort(typedRelay || typedId || _clientConfig?.relay_server, 21117);
        const relayOnly = document.querySelector('input[name="connection-mode"]:checked')?.value === 'relay_only';
        const opts = {
            idServer: id.host || '?',
            relay: relay.host || id.host || '?',
            idPort: id.port,
            relayPort: relay.port,
            mode: relayOnly ? 'relay-only' : 'direct-first',
        };
        const key = JSON.stringify(opts);
        if (el.dataset.drawn === key) return;
        el.dataset.drawn = key;
        UiDiagram.connection(el, opts);
    }

    function initConnectionDiagram() {
        if (!document.getElementById('connection-diagram')) return;
        const redraw = Utils.debounce ? Utils.debounce(renderConnectionDiagram, 250) : renderConnectionDiagram;
        document.querySelectorAll('input[name="connection-mode"]').forEach((r) => r.addEventListener('change', renderConnectionDiagram));
        ['public-server-id', 'public-relay-server'].forEach((id) => {
            document.getElementById(id)?.addEventListener('input', redraw);
        });
        renderConnectionDiagram();
        loadClientConfigSummary();
    }

    // Appearance: a small sample of the console in the chosen theme

    function hexToRgb(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) return null;
        const n = parseInt(m[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function luminance(hex) {
        const rgb = hexToRgb(hex);
        if (!rgb) return null;
        const [r, g, b] = rgb.map((c) => {
            const v = c / 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    /** Black or white, whichever reads better on the colour */
    function textOn(hex) {
        const l = luminance(hex);
        if (l === null) return '';
        return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
    }

    function previewPalette(mode) {
        if (mode !== 'custom') return currentLookPalette(mode);
        const base = currentLookPalette('light');
        const out = { ...base };
        document.querySelectorAll('.color-hex[data-color]').forEach((input) => {
            if (hexToRgb(input.value)) out[input.dataset.color] = input.value.trim();
        });
        return out;
    }

    let _previewLogoUrl = '';

    function renderThemePreview() {
        const box = document.getElementById('theme-preview');
        if (!box) return;
        const mode = document.querySelector('input[name="theme-mode"]:checked')?.value || 'system';
        const p = previewPalette(mode);
        const vars = {
            '--pv-bg': p.bgPrimary,
            '--pv-bar': p.bgSecondary,
            '--pv-text': p.textPrimary,
            '--pv-muted': p.textSecondary,
            '--pv-accent': p.accentBlue,
            '--pv-on-accent': textOn(p.accentBlue),
            '--pv-ok': p.accentGreen,
            '--pv-rule': p.borderSecondary,
        };
        Object.entries(vars).forEach(([k, v]) => {
            if (v) box.style.setProperty(k, v);
            else box.style.removeProperty(k);
        });

        // Logo: an image when one is chosen (a picked file shows before it is uploaded)
        const logo = document.getElementById('theme-preview-logo');
        if (logo) {
            const type = document.querySelector('input[name="logo-type"]:checked')?.value;
            const file = document.getElementById('logo-image-file')?.files?.[0];
            if (_previewLogoUrl) { URL.revokeObjectURL(_previewLogoUrl); _previewLogoUrl = ''; }
            let src = '';
            if (type === 'image') {
                if (file && file.type.startsWith('image/')) src = _previewLogoUrl = URL.createObjectURL(file);
                else src = document.getElementById('logo-image-url')?.value.trim() || '';
            }
            if (src && /^(\/|https?:|blob:)/i.test(src)) {
                if (logo.getAttribute('src') !== src) logo.src = src;
                logo.hidden = false;
            } else {
                logo.hidden = true;
                logo.removeAttribute('src');
            }
        }

        const name = document.getElementById('brand-name')?.value.trim() || 'BetterDesk';
        const nameEl = document.getElementById('theme-preview-name');
        if (nameEl) nameEl.textContent = name;
        const descEl = document.getElementById('theme-preview-desc');
        if (descEl) {
            descEl.textContent = document.getElementById('brand-description')?.value.trim() || '';
            descEl.hidden = !descEl.textContent;
        }
        const heading = document.getElementById('font-heading-value')?.value;
        const body = document.getElementById('font-body-value')?.value;
        box.style.fontFamily = body ? `"${body.replace(/"/g, '')}", var(--font)` : '';
        if (nameEl) nameEl.style.fontFamily = heading ? `"${heading.replace(/"/g, '')}", var(--font)` : '';

        const themeNames = { system: _('theme.auto'), light: _('theme.light'), dark: _('theme.dark'), custom: _('theme.custom') };
        const caption = document.getElementById('theme-preview-caption');
        if (caption) {
            caption.textContent = _('settings.side.preview_caption')
                .replace('{theme}', themeNames[mode] || mode)
                .replace('{accent}', p.accentBlue || '-');
        }
    }

    function initThemePreview() {
        const box = document.getElementById('theme-preview');
        if (!box) return;
        const form = brandingForm();
        form?.addEventListener('input', renderThemePreview);
        form?.addEventListener('change', renderThemePreview);
        // "Start from light/dark" fill the colour fields without an input event
        document.querySelectorAll('[data-palette-start]').forEach((btn) => {
            btn.addEventListener('click', () => setTimeout(renderThemePreview));
        });
        window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', renderThemePreview);
        renderThemePreview();
    }

    // Backup: last run, next run, where backups go

    function renderBackupSide(schedule, st) {
        const last = document.getElementById('side-backup-last');
        const next = document.getElementById('side-backup-next');
        const dest = document.getElementById('side-backup-dest');
        const error = document.getElementById('side-backup-error');
        if (!last || !next || !dest) return;
        last.textContent = st?.lastSuccessAt ? Utils.formatDate(st.lastSuccessAt) : _('settings.side.backup_none');
        if (!schedule) {
            next.textContent = '-';
        } else if (!schedule.enabled) {
            next.textContent = _('settings.side.backup_off');
        } else {
            const lastAttempt = Date.parse(st?.lastAttemptAt || '');
            const due = Number.isFinite(lastAttempt)
                ? lastAttempt + (Number(schedule.intervalHours) || 24) * 3600 * 1000
                : Date.now();
            // The server checks once a minute whether a backup is due
            next.textContent = due <= Date.now() + 60 * 1000
                ? _('settings.side.backup_soon')
                : Utils.formatDate(new Date(due));
        }
        const isPath = schedule?.destinationType === 'path' && schedule.destinationPath;
        dest.textContent = isPath ? schedule.destinationPath : _('backup.schedule_destination_local');
        dest.classList.toggle('mono', !!isPath);
        if (error) {
            error.hidden = !st?.lastError;
            error.textContent = st?.lastError ? _('settings.side.backup_failed').replace('{error}', st.lastError) : '';
        }
    }

    // Email: whether the console can send mail

    function renderEmailSide(config, errorMessage) {
        const state = document.getElementById('side-email-state');
        const facts = document.getElementById('side-email-facts');
        if (!state || !facts) return;
        if (errorMessage) {
            state.className = 'state is-error';
            state.textContent = errorMessage;
            facts.hidden = true;
            return;
        }
        state.className = '';
        if (!config?.configured) {
            state.innerHTML = `<span class="status offline">${_('settings.side.email_off')}</span>`;
            facts.hidden = true;
            return;
        }
        state.innerHTML = `<span class="status ok">${_('settings.side.email_on')}</span>`;
        const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text || '-'; };
        set('side-email-server', config.host ? `${config.host}:${config.port || 587}` : '');
        set('side-email-from', config.from);
        set('side-email-alert', config.alert_email);
        facts.hidden = false;
    }

})();
