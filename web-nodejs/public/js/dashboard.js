/**
 * BetterDesk Console - Dashboard Page
 */

(function() {
    'use strict';
    
    const _ = window._ || (k => k);
    
    let rootEl = document;
    let initialized = false;
    let refreshInterval = null;
    let activityInterval = null;
    let refreshHandler = null;
    let statusButton = null;
    let statusButtonHandler = null;
    let tipDismissButton = null;
    let tipDismissHandler = null;
    let copyAllConfigButton = null;
    let copyAllConfigHandler = null;
    let copyDeployStringButton = null;
    let copyDeployStringHandler = null;
    let showIntuneScriptButton = null;
    let showIntuneScriptHandler = null;
    let showClientQrButton = null;
    let showClientQrHandler = null;
    let pairCodeButton = null;
    let pairCodeButtonHandler = null;
    let pairCodeModal = null;
    let pairCodeCountdown = null;
    const pairCodeListeners = [];
    let activationModal = null;
    let activationCloseButton = null;
    let activationStopButton = null;
    let activationFileButton = null;
    let activationFileInput = null;
    let activationSubmitButton = null;
    let activationVideo = null;
    let activationStatus = null;
    let activationForm = null;
    let activationNameInput = null;
    let activationFolderSelect = null;
    let activationStream = null;
    let activationTimer = null;
    let activationDeviceId = '';
    let clientConfigHostInput = null;
    let applyClientHostButton = null;
    let applyClientHostHandler = null;
    let clientConfigCopyButtons = [];
    const clientConfigCopyHandlers = new Map();
    let clientConfigKeyRevealButton = null;
    let clientConfigKeyRevealHandler = null;
    let publicKeyVisible = false;
    let clientConfig = null;
    const pendingRequests = new Map();
    const PUBLIC_KEY_MASK = '••••••••••••••••••••••••';
    
    // Tips pool — rotated daily
    const TIPS = [
        'dashboard.tip_desktop_mode',
        'dashboard.tip_keyboard_shortcuts',
        'dashboard.tip_address_book',
        'dashboard.tip_2fa',
        'dashboard.tip_bulk_actions',
        'dashboard.tip_theme',
        'dashboard.tip_cdap'
    ];
    
    function init(root) {
        destroy();
        rootEl = root || document;

        if (!findById('welcome-section')) return;
        initialized = true;

        renderGreeting();
        renderTip();
        loadActivityFeed();
        loadOverview();
        loadClientConfig();
        
        // Auto-refresh every 30 seconds
        refreshInterval = setInterval(() => {
            loadOverview();
        }, 30000);
        
        // Activity feed refresh every 60 seconds
        activityInterval = setInterval(loadActivityFeed, 60000);
        
        // Manual refresh
        refreshHandler = () => {
            loadActivityFeed();
            loadOverview();
            loadClientConfig();
        };
        window.addEventListener('app:refresh', refreshHandler);
        
        // Refresh status button
        statusButton = findById('refresh-status-btn');
        statusButtonHandler = () => loadServerStatus();
        statusButton?.addEventListener('click', statusButtonHandler);
        
        // Tip dismiss
        tipDismissButton = findById('tip-dismiss');
        tipDismissHandler = () => {
            const tip = findById('welcome-tip');
            if (tip) {
                tip.style.display = 'none';
                try { localStorage.setItem('bd_tip_dismissed', new Date().toDateString()); } catch {}
            }
        };
        tipDismissButton?.addEventListener('click', tipDismissHandler);

        copyAllConfigButton = findById('copy-client-config-btn');
        copyAllConfigHandler = copyFullClientConfig;
        copyAllConfigButton?.addEventListener('click', copyAllConfigHandler);

        copyDeployStringButton = findById('copy-deploy-string-btn');
        copyDeployStringHandler = copyDeployConfigString;
        copyDeployStringButton?.addEventListener('click', copyDeployStringHandler);

        showIntuneScriptButton = findById('show-intune-script-btn');
        showIntuneScriptHandler = showIntuneScriptModal;
        showIntuneScriptButton?.addEventListener('click', showIntuneScriptHandler);

        showClientQrButton = findById('show-client-qr-btn');
        showClientQrHandler = showClientConfigQr;
        showClientQrButton?.addEventListener('click', showClientQrHandler);

        initAgentPairingCode();
        initAgentActivation();

        clientConfigHostInput = findById('client-config-host-input');
        applyClientHostButton = findById('apply-client-host-btn');
        applyClientHostHandler = () => loadClientConfig({ persistHost: true });
        applyClientHostButton?.addEventListener('click', applyClientHostHandler);
        clientConfigHostInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                loadClientConfig({ persistHost: true });
            }
        });

        clientConfigCopyButtons = Array.from(rootEl.querySelectorAll?.('.client-config-copy') || []);
        clientConfigCopyButtons.forEach(button => {
            const handler = () => copyClientConfigField(button.dataset.copyTarget, button);
            clientConfigCopyHandlers.set(button, handler);
            button.addEventListener('click', handler);
        });

        clientConfigKeyRevealButton = findById('client-config-key-reveal');
        clientConfigKeyRevealHandler = togglePublicKeyVisibility;
        clientConfigKeyRevealButton?.addEventListener('click', clientConfigKeyRevealHandler);
        
        // Cleanup on page leave
        window.addEventListener('beforeunload', destroy, { once: true });
    }

    function destroy() {
        if (refreshInterval) clearInterval(refreshInterval);
        if (activityInterval) clearInterval(activityInterval);
        if (refreshHandler) window.removeEventListener('app:refresh', refreshHandler);
        if (statusButton && statusButtonHandler) statusButton.removeEventListener('click', statusButtonHandler);
        if (tipDismissButton && tipDismissHandler) tipDismissButton.removeEventListener('click', tipDismissHandler);
        if (copyAllConfigButton && copyAllConfigHandler) copyAllConfigButton.removeEventListener('click', copyAllConfigHandler);
        if (copyDeployStringButton && copyDeployStringHandler) copyDeployStringButton.removeEventListener('click', copyDeployStringHandler);
        if (showIntuneScriptButton && showIntuneScriptHandler) showIntuneScriptButton.removeEventListener('click', showIntuneScriptHandler);
        if (showClientQrButton && showClientQrHandler) showClientQrButton.removeEventListener('click', showClientQrHandler);
        if (pairCodeButton && pairCodeButtonHandler) {
            pairCodeButton.removeEventListener('click', pairCodeButtonHandler);
        }
        pairCodeListeners.forEach(([element, type, handler]) => {
            element.removeEventListener(type, handler);
        });
        pairCodeListeners.length = 0;
        closePairCodeModal();
        stopAgentActivation();
        if (applyClientHostButton && applyClientHostHandler) applyClientHostButton.removeEventListener('click', applyClientHostHandler);
        clientConfigCopyButtons.forEach(button => {
            const handler = clientConfigCopyHandlers.get(button);
            if (handler) button.removeEventListener('click', handler);
        });
        clientConfigCopyHandlers.clear();
        if (clientConfigKeyRevealButton && clientConfigKeyRevealHandler) {
            clientConfigKeyRevealButton.removeEventListener('click', clientConfigKeyRevealHandler);
        }

        refreshInterval = null;
        activityInterval = null;
        refreshHandler = null;
        statusButton = null;
        statusButtonHandler = null;
        tipDismissButton = null;
        tipDismissHandler = null;
        copyAllConfigButton = null;
        copyAllConfigHandler = null;
        copyDeployStringButton = null;
        copyDeployStringHandler = null;
        showIntuneScriptButton = null;
        showIntuneScriptHandler = null;
        showClientQrButton = null;
        showClientQrHandler = null;
        pairCodeButton = null;
        pairCodeButtonHandler = null;
        pairCodeModal = null;
        clientConfigHostInput = null;
        applyClientHostButton = null;
        applyClientHostHandler = null;
        clientConfigCopyButtons = [];
        clientConfigKeyRevealButton = null;
        clientConfigKeyRevealHandler = null;
        publicKeyVisible = false;
        clientConfig = null;
        initialized = false;
    }

    async function loadOverview() {
        const [stats, status] = await Promise.all([
            loadStats(),
            loadServerStatus()
        ]);
        loadHealthOverview(status);
    }
    
    /**
     * Render time-based personalized greeting
     */
    function renderGreeting() {
        const el = findById('welcome-greeting-text');
        if (!el) return;
        
        const hour = new Date().getHours();
        let greetingKey;
        if (hour < 6) greetingKey = 'dashboard.greeting_night';
        else if (hour < 12) greetingKey = 'dashboard.greeting_morning';
        else if (hour < 18) greetingKey = 'dashboard.greeting_afternoon';
        else greetingKey = 'dashboard.greeting_evening';
        
        // Get username from global config
        const username = window.BetterDesk?.user?.username || 'Admin';
        
        const greeting = _(greetingKey);
        el.textContent = greeting.replace('{name}', username);
    }
    
    /**
     * Show tip of the day
     */
    function renderTip() {
        const tipEl = findById('welcome-tip');
        const textEl = findById('tip-text');
        if (!tipEl || !textEl) return;
        
        // Hide if already dismissed today
        try {
            if (localStorage.getItem('bd_tip_dismissed') === new Date().toDateString()) {
                tipEl.style.display = 'none';
                return;
            }
        } catch {}
        
        // Pick tip based on day of year
        const now = new Date();
        const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
        const tip = TIPS[dayOfYear % TIPS.length];
        textEl.textContent = _(tip);
    }
    
    /**
     * Load device statistics
     */
    async function loadStats() {
        try {
            const data = await fetchApi('/api/stats');
            const stats = data.devices || data;
            
            // Update stats with values
            setStatValue('stat-total', stats.total ?? 0);
            setStatValue('stat-online', stats.online ?? 0);
            setStatValue('stat-banned', stats.banned ?? 0);
            setStatValue('stat-connections', stats.offline ?? 0);
            return stats;
            
        } catch (error) {
            console.error('Failed to load stats:', error);
            // Show zeros on error
            setStatValue('stat-total', 0);
            setStatValue('stat-online', 0);
            setStatValue('stat-banned', 0);
            setStatValue('stat-connections', 0);
            return null;
        }
    }
    
    /**
     * Set stat value directly (replacing skeleton)
     */
    function setStatValue(elementId, value) {
        const element = findById(elementId);
        if (!element) return;
        // Use textContent for security (no HTML parsing)
        element.textContent = value;
    }
    
    /**
     * Update a stat element with animation
     */
    function updateStat(elementId, value) {
        const element = findById(elementId);
        if (!element) return;
        
        const currentValue = parseInt(element.textContent) || 0;
        
        if (currentValue === value) return;
        
        // Simple counter animation
        const duration = 500;
        const steps = 20;
        const stepValue = (value - currentValue) / steps;
        let step = 0;
        
        const interval = setInterval(() => {
            step++;
            if (step >= steps) {
                element.textContent = value;
                clearInterval(interval);
            } else {
                element.textContent = Math.round(currentValue + stepValue * step);
            }
        }, duration / steps);
    }
    
    /**
     * Load server status
     */
    async function loadServerStatus() {
        try {
            const status = await fetchApi('/api/server/status');
            
            updateServerStatus('hbbs-status', status.hbbs);
            updateServerStatus('hbbr-status', status.hbbr);
            updateSystemStatus(status);
            
            // Populate all port values from server response
            const portMap = {
                'api-port': status.api_port,
                'hbbs-port': status.signal_port || status.hbbs_port,
                'hbbr-port': status.relay_port || status.hbbr_port,
                'nat-port': status.nat_port,
                'ws-signal-port': status.ws_signal_port,
                'ws-relay-port': status.ws_relay_port,
                'client-api-port': status.client_api_port,
                'console-port': status.console_port
            };
            
            for (const [id, value] of Object.entries(portMap)) {
                const el = findById(id);
                if (el && value) el.textContent = value;
            }
            return status;
            
        } catch (error) {
            console.error('Failed to load server status:', error);
            updateServerStatus('hbbs-status', { status: 'unknown' });
            updateServerStatus('hbbr-status', { status: 'unknown' });
            updateSystemStatus(null);
            return null;
        }
    }
    
    /**
     * Update server status indicator
     */
    function updateServerStatus(elementId, status) {
        const element = findById(elementId);
        if (!element) return;
        
        const statusDot = element.querySelector('.status-dot');
        const statusText = element.querySelector('.status-text');
        
        // Remove existing classes
        element.classList.remove('running', 'stopped', 'unknown');
        
        if (status?.status === 'running' || status?.online) {
            element.classList.add('running');
            statusText.textContent = _('status.running');
        } else if (status?.status === 'stopped' || status?.online === false) {
            element.classList.add('stopped');
            statusText.textContent = _('status.stopped');
        } else {
            element.classList.add('unknown');
            statusText.textContent = _('status.unknown');
        }
    }

    function updateSystemStatus(status) {
        const pill = findById('dashboard-system-pill');
        const text = findById('dashboard-system-status');
        if (!pill || !text) return;

        pill.classList.remove('running', 'stopped', 'unknown');

        const signalRunning = status?.hbbs?.status === 'running' || status?.hbbs?.online === true;
        const relayRunning = status?.hbbr?.status === 'running' || status?.hbbr?.online === true;

        if (signalRunning && relayRunning) {
            pill.classList.add('running');
            text.textContent = _('dashboard.system_ready');
        } else if (status) {
            pill.classList.add('stopped');
            text.textContent = _('dashboard.system_attention');
        } else {
            pill.classList.add('unknown');
            text.textContent = _('status.unknown');
        }
    }

    const CLIENT_HOST_STORAGE_KEY = 'bd_client_config_host';

    function getStoredClientHost() {
        try {
            return sessionStorage.getItem(CLIENT_HOST_STORAGE_KEY) || '';
        } catch {
            return '';
        }
    }

    function setStoredClientHost(host) {
        try {
            if (host) {
                sessionStorage.setItem(CLIENT_HOST_STORAGE_KEY, host);
            } else {
                sessionStorage.removeItem(CLIENT_HOST_STORAGE_KEY);
            }
        } catch {
            /* ignore */
        }
    }

    function resolveClientHostOverride() {
        const fromInput = clientConfigHostInput?.value?.trim();
        if (fromInput) {
            return fromInput;
        }
        return getStoredClientHost();
    }

    async function loadClientConfig(options = {}) {
        const hostOverride = resolveClientHostOverride();
        const query = hostOverride ? `?host=${encodeURIComponent(hostOverride)}` : '';

        try {
            const data = await fetchApi(`/api/dashboard/client-config${query}`);
            clientConfig = data || {};

            if (clientConfigHostInput && !hostOverride && clientConfig.client_server_host) {
                clientConfigHostInput.value = clientConfig.client_server_host;
            } else if (clientConfigHostInput && hostOverride) {
                clientConfigHostInput.value = hostOverride;
            }

            if (options.persistHost && hostOverride) {
                setStoredClientHost(hostOverride);
            }

            setText('client-config-server-id', clientConfig.server_id || '-');
            setText('client-config-relay-server', clientConfig.relay_server || '-');
            setText('client-config-api-url', clientConfig.api_url || '-');
            renderPublicKeyField(clientConfig.public_key || '', false);
            updateClientHostControls(clientConfig);
            // The pairing modal may have opened before the client config arrived.
            if (pairCodeModal && !pairCodeModal.hidden) fillPairCodeHost();
        } catch (err) {
            console.error('Client config load error:', err);
            clientConfig = null;
            setText('client-config-server-id', window.location.hostname || '-');
            setText('client-config-relay-server', window.location.hostname || '-');
            setText('client-config-api-url', '-');
            renderPublicKeyField('', false, _('errors.load_key_failed'));
        }
    }

    function getPublicKeyRaw() {
        return (clientConfig?.public_key || '').trim();
    }

    function renderPublicKeyField(rawKey, visible, errorText) {
        const el = findById('client-config-public-key');
        const revealBtn = clientConfigKeyRevealButton || findById('client-config-key-reveal');
        if (!el) return;

        const key = (rawKey || '').trim();
        publicKeyVisible = Boolean(visible && key);

        if (errorText) {
            el.textContent = errorText;
            el.classList.remove('is-masked');
            el.removeAttribute('data-raw');
            if (revealBtn) revealBtn.disabled = true;
            syncPublicKeyRevealButton();
            return;
        }

        if (!key) {
            el.textContent = _('keys.no_key');
            el.classList.remove('is-masked');
            el.removeAttribute('data-raw');
            if (revealBtn) revealBtn.disabled = true;
            syncPublicKeyRevealButton();
            return;
        }

        el.dataset.raw = key;
        if (publicKeyVisible) {
            el.textContent = key;
            el.classList.remove('is-masked');
        } else {
            el.textContent = PUBLIC_KEY_MASK;
            el.classList.add('is-masked');
        }
        if (revealBtn) revealBtn.disabled = false;
        syncPublicKeyRevealButton();
    }

    function syncPublicKeyRevealButton() {
        const revealBtn = clientConfigKeyRevealButton || findById('client-config-key-reveal');
        if (!revealBtn) return;
        const icon = revealBtn.querySelector('.material-icons');
        const label = publicKeyVisible ? _('actions.hide_value') : _('actions.show_value');
        revealBtn.title = label;
        revealBtn.setAttribute('aria-label', `${label} ${_('dashboard.config_key')}`);
        revealBtn.setAttribute('aria-pressed', publicKeyVisible ? 'true' : 'false');
        if (icon) icon.textContent = publicKeyVisible ? 'visibility_off' : 'visibility';
    }

    function togglePublicKeyVisibility() {
        const raw = getPublicKeyRaw();
        if (!raw) return;
        renderPublicKeyField(raw, !publicKeyVisible);
    }

    function updateClientHostControls(config) {
        const hintEl = findById('client-config-host-hint');
        const badgeEl = findById('client-config-env-badge');
        const linkEl = findById('client-config-host-env-link');
        const envOverride = Boolean(config?.env_override_active);

        if (clientConfigHostInput) {
            clientConfigHostInput.disabled = envOverride;
            if (envOverride) {
                clientConfigHostInput.title = _('dashboard.client_server_host_env_hint');
            } else {
                clientConfigHostInput.removeAttribute('title');
            }
        }
        if (applyClientHostButton) {
            applyClientHostButton.disabled = envOverride;
            if (envOverride) {
                applyClientHostButton.title = _('dashboard.client_server_host_env_hint');
            } else {
                applyClientHostButton.removeAttribute('title');
            }
        }
        if (hintEl) {
            hintEl.textContent = envOverride
                ? _('dashboard.client_server_host_env_hint')
                : _('dashboard.client_server_host_hint');
        }
        if (badgeEl) badgeEl.hidden = !envOverride;
        if (linkEl) linkEl.hidden = !envOverride;
    }

    async function copyClientConfigField(elementId, button) {
        const el = elementId ? findById(elementId) : null;
        let value = el?.textContent?.trim();

        if (elementId === 'client-config-public-key') {
            value = getPublicKeyRaw() || el?.dataset?.raw?.trim() || '';
            if (!value || value === _('keys.no_key') || value === _('errors.load_key_failed')) {
                Notifications.warning(_('dashboard.config_not_ready'));
                return;
            }
        } else if (!value || value === '-' || value === _('keys.no_key') || value === _('errors.load_key_failed')) {
            Notifications.warning(_('dashboard.config_not_ready'));
            return;
        }

        await Utils.copyToClipboard(value);
        markCopied(button);
        Notifications.success(_('common.copied'));
    }

    async function copyFullClientConfig() {
        if (!clientConfig) {
            Notifications.warning(_('dashboard.config_not_ready'));
            return;
        }

        const lines = [
            `${_('dashboard.config_server_id')}: ${clientConfig.server_id || '-'}`,
            `${_('dashboard.config_relay_server')}: ${clientConfig.relay_server || '-'}`,
            `${_('dashboard.config_api_server')}: ${clientConfig.api_url || '-'}`,
            `${_('dashboard.config_key')}: ${clientConfig.public_key || '-'}`
        ];

        await Utils.copyToClipboard(lines.join('\n'));
        markCopied(copyAllConfigButton);
        Notifications.success(_('common.copied'));
    }

    async function copyDeployConfigString() {
        const value = clientConfig?.deploy_config_string?.trim();
        if (!value) {
            Notifications.warning(_('dashboard.deploy_string_not_ready'));
            return;
        }

        await Utils.copyToClipboard(value);
        markCopied(copyDeployStringButton);
        Notifications.success(_('common.copied'));
    }

    function buildIntuneScriptSnippet() {
        const host = clientConfig?.server_id || clientConfig?.client_server_host || 'YOUR_SERVER_HOST';
        const apiUrl = clientConfig?.api_url || `http://${host}:21114`;
        const publicKey = clientConfig?.public_key || 'YOUR_PUBLIC_KEY';

        return `# Run elevated after RustDesk MSI (PSADT post-install / Intune Win32)
$RustDesk = Join-Path $env:ProgramFiles 'RustDesk\\rustdesk.exe'
$ServerHost = '${host.replace(/'/g, "''")}'
$PublicKey = '${publicKey.replace(/'/g, "''")}'
$ApiUrl = '${apiUrl.replace(/'/g, "''")}'

$json = @{
    host = $ServerHost
    relay = $ServerHost
    api = $ApiUrl
    key = $PublicKey
} | ConvertTo-Json -Compress
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)).TrimEnd('=')
$CfgString = -join ($b64[-1..-($b64.Length)] -join '')

Start-Process -FilePath $RustDesk -ArgumentList @('--config', $CfgString) -Wait -NoNewWindow
# Optional unattended password:
# Start-Process -FilePath $RustDesk -ArgumentList @('--password', 'YourPermanentPassword') -Wait -NoNewWindow`;
    }

    function showIntuneScriptModal() {
        if (!clientConfig?.deploy_config_string) {
            Notifications.warning(_('dashboard.deploy_string_not_ready'));
            return;
        }

        const script = buildIntuneScriptSnippet();
        Modal.show({
            title: _('dashboard.intune_script_title'),
            content: `
                <div class="client-config-script-modal">
                    <p>${escapeHtml(_('dashboard.intune_script_hint'))}</p>
                    <pre class="client-config-script-block"><code>${escapeHtml(script)}</code></pre>
                </div>
            `,
            buttons: [
                {
                    label: _('actions.copy'),
                    class: 'btn-primary',
                    onClick: async () => {
                        await Utils.copyToClipboard(script);
                        Notifications.success(_('common.copied'));
                    }
                },
                { label: _('actions.close'), class: 'btn-secondary', onClick: () => Modal.close() }
            ],
            size: 'large'
        });
    }

    function showClientConfigQr() {
        if (!clientConfig?.qr) {
            Notifications.warning(_('keys.no_qr'));
            return;
        }

        const warn = clientConfig.phone_unreachable_host
            ? `<p class="client-config-qr-warn">${escapeHtml(_('dashboard.client_config_qr_unreachable_host'))}</p>`
            : '';

        Modal.show({
            title: _('dashboard.client_config_qr_title'),
            content: `
                <div class="client-config-qr-modal">
                    <div class="client-config-qr-frame">
                        <img src="${escapeHtml(clientConfig.qr)}" alt="${escapeHtml(_('dashboard.client_config_qr_title'))}" width="300" height="300">
                    </div>
                    <p>${escapeHtml(_('dashboard.client_config_qr_hint'))}</p>
                    ${warn}
                </div>
            `,
            buttons: [
                { label: _('actions.close'), class: 'btn-secondary', onClick: () => Modal.close() }
            ],
            size: 'medium'
        });
    }

    function markCopied(button) {
        if (!button) return;
        button.classList.add('copied');
        setTimeout(() => button.classList.remove('copied'), 1600);
    }
    
    /**
     * Load activity feed from audit log
     */
    async function loadActivityFeed() {
        const container = findById('activity-feed');
        if (!container) return;
        
        try {
            const data = await fetchApi('/api/dashboard/activity');
            const events = data.events || data.data?.events || [];
            
            if (events.length === 0) {
                container.innerHTML = `<div class="activity-empty">
                    <p>${_('dashboard.no_recent_activity')}</p>
                    <a class="btn btn-secondary btn-sm" href="/settings#audit">${_('dashboard.view_audit_log') || _('nav.settings')}</a>
                </div>`;
                return;
            }
            
            container.innerHTML = events.slice(0, 10).map(ev => {
                const iconMap = {
                    'conn_start': { icon: 'link', cls: 'connect' },
                    'conn_end': { icon: 'link_off', cls: 'disconnect' },
                    'login': { icon: 'login', cls: 'login' },
                    'login_failed': { icon: 'error', cls: 'ban' },
                    'ban': { icon: 'block', cls: 'ban' },
                    'unban': { icon: 'check_circle', cls: 'unban' },
                    'file_transfer': { icon: 'upload_file', cls: 'file' },
                    'alarm': { icon: 'warning', cls: 'alert' },
                    'branding_update': { icon: 'palette', cls: 'connect' },
                    'theme_toggle': { icon: 'dark_mode', cls: 'connect' }
                };
                const info = iconMap[ev.action] || { icon: 'info', cls: 'connect' };
                const timeAgo = formatTimeAgo(ev.timestamp || ev.created_at);
                const detail = ev.device_id || ev.peer_id || ev.details || '';
                const actionLabel = (window.Utils && Utils.formatAuditAction)
                    ? Utils.formatAuditAction(ev.action, ev.action_label || ev.action)
                    : (ev.action_label || ev.action || '');
                
                return `<div class="activity-item stagger-item">
                    <div class="activity-icon ${info.cls}">
                        <span class="material-icons" aria-hidden="true">${info.icon}</span>
                    </div>
                    <div class="activity-content">
                        <div class="activity-text">${escapeHtml(actionLabel)}${detail ? ' — <strong>' + escapeHtml(String(detail)) + '</strong>' : ''}</div>
                        <div class="activity-time">${timeAgo}</div>
                    </div>
                </div>`;
            }).join('');
        } catch (err) {
            console.error('Activity feed error:', err);
            container.innerHTML = `<div class="activity-empty">
                <p>${_('dashboard.activity_load_error') || _('errors.server_error')}</p>
                <a class="btn btn-secondary btn-sm" href="/settings#audit">${_('dashboard.view_audit_log') || _('nav.settings')}</a>
            </div>`;
        }
    }
    
    /**
     * Load health overview data
     */
    async function loadHealthOverview(status) {
        try {
            // Server uptime from status
            try {
                status = status || await fetchApi('/api/server/status');
                const uptime = status.uptime || status.data?.uptime;
                setText('stat-uptime', uptime ? formatUptime(uptime) : '-');
            } catch {
                setText('stat-uptime', '-');
            }
        } catch (err) {
            console.error('Health overview error:', err);
        }
    }

    function initAgentPairingCode() {
        pairCodeButton = findById('activate-agent-code-btn');
        pairCodeModal = findById('dashboard-pair-code-modal');
        if (!pairCodeModal) return;

        pairCodeButtonHandler = openPairCodeModal;
        pairCodeButton?.addEventListener('click', pairCodeButtonHandler);

        const bind = (id, event, handler) => {
            const el = findById(id);
            if (!el) return;
            el.addEventListener(event, handler);
            pairCodeListeners.push([el, event, handler]);
        };

        bind('dashboard-pair-code-close', 'click', closePairCodeModal);
        bind('dashboard-pair-code-generate', 'click', generatePairCode);
        bind('dashboard-pair-code-copy', 'click', copyPairCode);
        bind('dashboard-pair-code-scan', 'click', () => {
            if (!activationModal) {
                setPairCodeStatus(_('dashboard.activate_agent_camera_unavailable'), true);
                return;
            }
            closePairCodeModal();
            openAgentActivation();
        });
        bind('dashboard-pair-code-host', 'keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                generatePairCode();
            }
        });
    }

    function openPairCodeModal() {
        if (!pairCodeModal) return;
        // The class is the only switch: an inline display would fight the sheet
        // and leave the overlay transparent but still covering the panel.
        pairCodeModal.hidden = false;
        pairCodeModal.classList.add('open');
        resetPairCodeResult();
        fillPairCodeHost();
        const labelInput = findById('dashboard-pair-code-label');
        if (labelInput) labelInput.value = '';
    }

    /**
     * Prefill the host the client will type: the resolved client-facing address, not the
     * panel's own URL (they differ when the panel runs behind a different port/domain).
     */
    function fillPairCodeHost() {
        const hostInput = findById('dashboard-pair-code-host');
        if (!hostInput || hostInput.value.trim()) return;
        // The client-config host field is the operator-visible source; the cached config may
        // still be in flight when the modal opens from a deep link.
        const hostField = findById('client-config-host-input');
        const host = (clientConfig && clientConfig.client_server_host)
            || (hostField && hostField.value.trim())
            || '';
        if (host) hostInput.value = host;
    }

    function closePairCodeModal() {
        if (pairCodeCountdown) clearInterval(pairCodeCountdown);
        pairCodeCountdown = null;
        if (pairCodeModal) {
            pairCodeModal.classList.remove('open');
            pairCodeModal.hidden = true;
        }
    }

    function resetPairCodeResult() {
        if (pairCodeCountdown) clearInterval(pairCodeCountdown);
        pairCodeCountdown = null;
        const result = findById('dashboard-pair-code-result');
        if (result) result.hidden = true;
        const value = findById('dashboard-pair-code-value');
        if (value) {
            value.classList.remove('is-expired');
            value.textContent = '';
        }
        setText('dashboard-pair-code-host-out', '');
        setText('dashboard-pair-code-ttl', '');
        setPairCodeStatus('');
    }

    function setPairCodeStatus(message, isError) {
        const status = findById('dashboard-pair-code-status');
        if (!status) return;
        status.textContent = message || '';
        status.classList.toggle('is-error', Boolean(isError));
    }

    function formatPairCodeTtl(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        const minutes = Math.floor(total / 60);
        const rest = total % 60;
        return `${minutes}:${String(rest).padStart(2, '0')}`;
    }

    async function generatePairCode() {
        const button = findById('dashboard-pair-code-generate');
        if (button) button.disabled = true;
        setPairCodeStatus(_('pairing.generating'));
        try {
            const labelInput = findById('dashboard-pair-code-label');
            const hostInput = findById('dashboard-pair-code-host');
            const label = (labelInput && labelInput.value.trim()) || '';
            const payload = await Utils.api('/api/panel/pairing/codes', {
                method: 'POST',
                body: JSON.stringify({ label }),
            });
            const code = (payload && payload.code) || '';
            if (!code) throw new Error(_('pairing.create_failed'));

            const result = findById('dashboard-pair-code-result');
            if (result) result.hidden = false;
            const value = findById('dashboard-pair-code-value');
            if (value) {
                value.classList.remove('is-expired');
                value.textContent = code;
            }
            setText('dashboard-pair-code-host-out',
                (hostInput && hostInput.value.trim()) || (payload && payload.host) || '');
            setPairCodeStatus('');

            let remaining = Number(payload.expires_in) || 600;
            setText('dashboard-pair-code-ttl', formatPairCodeTtl(remaining));
            if (pairCodeCountdown) clearInterval(pairCodeCountdown);
            pairCodeCountdown = setInterval(() => {
                remaining -= 1;
                if (remaining <= 0) {
                    clearInterval(pairCodeCountdown);
                    pairCodeCountdown = null;
                    setText('dashboard-pair-code-ttl', _('pairing.expired'));
                    const value = findById('dashboard-pair-code-value');
                    if (value) value.classList.add('is-expired');
                    return;
                }
                setText('dashboard-pair-code-ttl', formatPairCodeTtl(remaining));
            }, 1000);

            Notifications.success(_('pairing.created'));
        } catch (error) {
            setPairCodeStatus(
                `${_('pairing.create_failed')}: ${error.message || _('errors.server_error')}`, true);
        } finally {
            if (button) button.disabled = false;
        }
    }

    async function copyPairCode() {
        const value = findById('dashboard-pair-code-value');
        const code = value ? value.textContent.trim() : '';
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            Notifications.success(_('pairing.copied'));
        } catch (_) {
            Notifications.warning(_('pairing.copy_failed'));
        }
    }

    function initAgentActivation() {
        activationModal = findById('dashboard-agent-activation-modal');
        if (!activationModal) return;
        activationCloseButton = findById('dashboard-agent-activation-close');
        activationStopButton = findById('dashboard-agent-activation-stop');
        activationFileButton = findById('dashboard-agent-activation-file-btn');
        activationFileInput = findById('dashboard-agent-activation-file');
        activationSubmitButton = findById('dashboard-agent-activation-submit');
        activationVideo = findById('dashboard-agent-activation-video');
        activationStatus = findById('dashboard-agent-activation-status');
        activationForm = findById('dashboard-agent-activation-form');
        activationNameInput = findById('dashboard-agent-activation-name');
        activationFolderSelect = findById('dashboard-agent-activation-folder');
        activationCloseButton?.addEventListener('click', closeAgentActivation);
        activationStopButton?.addEventListener('click', closeAgentActivation);
        activationFileButton?.addEventListener('click', () => activationFileInput?.click());
        activationFileInput?.addEventListener('change', scanAgentQrImage);
        activationSubmitButton?.addEventListener('click', submitAgentActivation);
    }

    async function openAgentActivation() {
        if (!activationModal) return;
        activationModal.hidden = false;
        activationModal.classList.add('open');
        activationForm.hidden = true;
        activationDeviceId = '';
        setActivationStatus(_('dashboard.activate_agent_scanning'));
        await startAgentActivationCamera();
    }

    function closeAgentActivation() {
        stopAgentActivation();
        if (activationModal) {
            activationModal.classList.remove('open');
            activationModal.hidden = true;
        }
    }

    function stopAgentActivation() {
        if (activationTimer) clearInterval(activationTimer);
        activationTimer = null;
        if (activationStream) {
            activationStream.getTracks().forEach(track => track.stop());
            activationStream = null;
        }
        if (activationVideo) activationVideo.srcObject = null;
    }

    function setActivationStatus(message, error = false) {
        if (!activationStatus) return;
        activationStatus.textContent = message || '';
        activationStatus.classList.toggle('is-error', !!error);
    }

    async function startAgentActivationCamera() {
        if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
            setActivationStatus(_('dashboard.activate_agent_camera_unavailable'));
            return;
        }
        try {
            activationStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' } },
                audio: false,
            });
            activationVideo.srcObject = activationStream;
            await activationVideo.play();
            const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            activationTimer = setInterval(async () => {
                if (!activationVideo || activationVideo.readyState < 2) return;
                try {
                    const codes = await detector.detect(activationVideo);
                    if (codes.length && codes[0].rawValue) {
                        await handleAgentQrPayload(codes[0].rawValue);
                    }
                } catch (_) { /* camera frame may be unavailable */ }
            }, 250);
        } catch (error) {
            setActivationStatus(error.name === 'NotAllowedError'
                ? _('dashboard.activate_agent_camera_denied')
                : _('dashboard.activate_agent_camera_unavailable'), true);
        }
    }

    async function scanAgentQrImage(event) {
        const file = event.target.files?.[0];
        if (!file || !('BarcodeDetector' in window)) {
            setActivationStatus(_('dashboard.activate_agent_camera_unavailable'), true);
            return;
        }
        try {
            const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            const bitmap = await createImageBitmap(file);
            const codes = await detector.detect(bitmap);
            bitmap.close?.();
            if (!codes.length || !codes[0].rawValue) throw new Error('QR not found');
            await handleAgentQrPayload(codes[0].rawValue);
        } catch (_) {
            setActivationStatus(_('dashboard.activate_agent_qr_invalid'), true);
        } finally {
            event.target.value = '';
        }
    }

    async function handleAgentQrPayload(rawValue) {
        let payload;
        try {
            payload = JSON.parse(rawValue);
        } catch (_) {
            setActivationStatus(_('dashboard.activate_agent_qr_invalid'), true);
            return;
        }
        if (payload?.type !== 'betterdesk-agent-pairing'
            || payload.version !== 1
            || typeof payload.device_id !== 'string'
            || !payload.device_id.trim()) {
            setActivationStatus(_('dashboard.activate_agent_qr_invalid'), true);
            return;
        }
        if (payload.server) {
            try {
                if (new URL(payload.server).host !== window.location.host) {
                    setActivationStatus(_('dashboard.activate_agent_qr_invalid'), true);
                    return;
                }
            } catch (_) {
                setActivationStatus(_('dashboard.activate_agent_qr_invalid'), true);
                return;
            }
        }
        stopAgentActivation();
        activationDeviceId = payload.device_id.trim();
        setActivationStatus(_('dashboard.activate_agent_loading'));
        try {
            const result = await fetchApi('/api/enrollment/pending');
            const pending = result?.data || [];
            const match = pending.find(item => String(item.device_id || '') === activationDeviceId);
            activationNameInput.value = match?.hostname || activationDeviceId;
            await loadActivationFolders();
            activationForm.hidden = false;
            setActivationStatus(_('dashboard.activate_agent_ready'));
        } catch (error) {
            setActivationStatus(error.message || _('errors.server_error'), true);
        }
    }

    async function loadActivationFolders() {
        if (!activationFolderSelect) return;
        try {
            const result = await fetchApi('/api/folders');
            const folders = result?.data?.folders || result?.folders || [];
            activationFolderSelect.querySelectorAll('option:not([value="0"])')
                .forEach(option => option.remove());
            folders.forEach(folder => {
                const option = document.createElement('option');
                option.value = String(folder.id);
                option.textContent = folder.name || folder.label || `#${folder.id}`;
                activationFolderSelect.appendChild(option);
            });
        } catch (_) { /* folder assignment is optional */ }
    }

    async function submitAgentActivation() {
        if (!activationDeviceId) return;
        activationSubmitButton.disabled = true;
        setActivationStatus(_('dashboard.activate_agent_submitting'));
        try {
            const result = await Utils.api(
                '/api/agent-pairing/activate',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        device_id: activationDeviceId,
                        display_name: activationNameInput.value.trim(),
                        folder_id: Number(activationFolderSelect.value || 0),
                    }),
                }
            );
            if (!result?.success) throw new Error(result?.error || _('errors.server_error'));
            setActivationStatus(_('dashboard.activate_agent_success'));
            activationForm.hidden = true;
            setTimeout(closeAgentActivation, 1200);
        } catch (error) {
            setActivationStatus(error.message || _('errors.server_error'), true);
        } finally {
            activationSubmitButton.disabled = false;
        }
    }
    
    function setText(id, value) {
        const el = findById(id);
        if (el) el.textContent = value;
    }

    function findById(id) {
        if (rootEl && rootEl !== document && typeof rootEl.querySelector === 'function') {
            const scoped = rootEl.querySelector('#' + id);
            if (scoped) return scoped;
        }
        return document.getElementById(id);
    }

    function fetchApi(endpoint) {
        if (pendingRequests.has(endpoint)) return pendingRequests.get(endpoint);
        const request = Utils.api(endpoint).finally(() => pendingRequests.delete(endpoint));
        pendingRequests.set(endpoint, request);
        return request;
    }
    
    function formatUptime(seconds) {
        if (typeof seconds !== 'number') return String(seconds);
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    }
    
    function formatTimeAgo(timestamp) {
        if (!timestamp) return '';
        const diff = Date.now() - new Date(timestamp).getTime();
        const secs = Math.floor(diff / 1000);
        if (secs < 60) return _('dashboard.just_now');
        const mins = Math.floor(secs / 60);
        if (mins < 60) return `${mins}m ${_('dashboard.ago')}`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ${_('dashboard.ago')}`;
        const days = Math.floor(hours / 24);
        return `${days}d ${_('dashboard.ago')}`;
    }
    
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    window.BetterDeskPanelMounts = window.BetterDeskPanelMounts || {};
    window.BetterDeskPanelMounts.dashboard = {
        mount: init,
        destroy: destroy,
        refresh: loadOverview
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init(document));
    } else {
        init(document);
    }
    
})();
