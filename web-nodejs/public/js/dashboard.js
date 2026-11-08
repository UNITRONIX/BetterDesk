/**
 * BetterDesk Console - Dashboard Page
 */

(function() {
    'use strict';
    
    const _ = window._ || (k => k);
    
    let rootEl = document;
    let initialized = false;
    let refreshInterval = null;
    let refreshHandler = null;
    let statusButton = null;
    let statusButtonHandler = null;
    let copyAllConfigButton = null;
    let copyAllConfigHandler = null;
    let copyDeployStringButton = null;
    let copyDeployStringHandler = null;
    let showIntuneScriptButton = null;
    let showIntuneScriptHandler = null;
    let showClientQrButton = null;
    let showClientQrHandler = null;
    let activateAgentQrButton = null;
    let activateAgentQrHandler = null;
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
    
    function init(root) {
        destroy();
        rootEl = root || document;

        if (!findById('welcome-section')) return;
        initialized = true;

        loadOverview();
        loadClientConfig();
        
        // Auto-refresh every 30 seconds
        refreshInterval = setInterval(() => {
            loadOverview();
        }, 30000);

        
        // Manual refresh
        refreshHandler = () => {
            loadOverview();
            loadClientConfig();
        };
        window.addEventListener('app:refresh', refreshHandler);
        
        // Refresh status button
        statusButton = findById('refresh-status-btn');
        statusButtonHandler = () => loadServerStatus();
        statusButton?.addEventListener('click', statusButtonHandler);
        
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
        if (refreshHandler) window.removeEventListener('app:refresh', refreshHandler);
        if (statusButton && statusButtonHandler) statusButton.removeEventListener('click', statusButtonHandler);
        if (copyAllConfigButton && copyAllConfigHandler) copyAllConfigButton.removeEventListener('click', copyAllConfigHandler);
        if (copyDeployStringButton && copyDeployStringHandler) copyDeployStringButton.removeEventListener('click', copyDeployStringHandler);
        if (showIntuneScriptButton && showIntuneScriptHandler) showIntuneScriptButton.removeEventListener('click', showIntuneScriptHandler);
        if (showClientQrButton && showClientQrHandler) showClientQrButton.removeEventListener('click', showClientQrHandler);
        if (activateAgentQrButton && activateAgentQrHandler) {
            activateAgentQrButton.removeEventListener('click', activateAgentQrHandler);
        }
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
        refreshHandler = null;
        statusButton = null;
        statusButtonHandler = null;
        copyAllConfigButton = null;
        copyAllConfigHandler = null;
        copyDeployStringButton = null;
        copyDeployStringHandler = null;
        showIntuneScriptButton = null;
        showIntuneScriptHandler = null;
        showClientQrButton = null;
        showClientQrHandler = null;
        activateAgentQrButton = null;
        activateAgentQrHandler = null;
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
        loadAttention(stats);
    }

    /**
     * "Needs attention": one row per thing waiting for someone, shown only
     * when its count is above zero. Rows the user may not see are not rendered
     * by the template, so their counts are not fetched.
     */
    async function loadAttention(stats) {
        const list = findById('attention-list');
        if (!list) return;

        const setRow = (id, count) => {
            const row = findById(id);
            if (!row) return;
            const value = Number(count) || 0;
            const countEl = row.querySelector('.attention-count');
            if (countEl) countEl.textContent = String(value);
            row.hidden = value <= 0;
        };

        setRow('attention-banned', stats ? stats.banned : 0);

        const jobs = [];
        if (findById('attention-enrollment')) {
            jobs.push(fetchApi('/api/registrations/count')
                .then(data => setRow('attention-enrollment', data.count))
                .catch(() => setRow('attention-enrollment', 0)));
        }
        if (findById('attention-help')) {
            jobs.push(fetchApi('/api/help/requests')
                .then(data => {
                    const open = (data.requests || []).filter(r => r.status === 'pending').length;
                    setRow('attention-help', open);
                })
                .catch(() => setRow('attention-help', 0)));
        }
        await Promise.all(jobs);

        const anyVisible = Array.from(list.querySelectorAll('.attention-row'))
            .some(row => !row.hidden);
        const none = findById('attention-none');
        if (none) none.hidden = anyVisible;
    }
    
    /**
     * Load device statistics
     */
    /**
     * "33 devices: 14 online, 17 offline, 2 banned" plus a share bar.
     * Banned devices are also offline, so offline here means offline and not banned.
     */
    function renderDevicesNow(stats) {
        const line = findById('devices-now-line');
        const bar = findById('devices-now-bar');
        const legend = findById('devices-now-legend');
        if (!line || !bar || !legend) return;
        const total = Number(stats.total) || 0;
        const online = Number(stats.online) || 0;
        const banned = Number(stats.banned) || 0;
        const offline = Math.max(0, (Number(stats.offline) || 0) - banned);
        const fmt = new Intl.NumberFormat((window.BetterDesk && window.BetterDesk.lang) || undefined);
        // The legend below names each part with its number; the line only gives the total
        line.textContent = _('dashboard.devices_total_line').replace('{total}', fmt.format(total));
        bar.textContent = '';
        legend.textContent = '';
        const parts = [
            { n: online, cls: 'is-ok', label: _('dashboard.devices_now_online'), href: '/devices?status=online' },
            { n: offline, cls: 'is-muted', label: _('dashboard.devices_now_offline'), href: '/devices?status=offline' },
            { n: banned, cls: 'is-danger', label: _('dashboard.devices_now_banned'), href: '/devices?status=banned' },
        ];
        parts.forEach((p) => {
            if (total > 0 && p.n > 0) {
                const seg = document.createElement('span');
                seg.className = p.cls;
                seg.style.flexGrow = String(p.n);
                bar.appendChild(seg);
            }
            const li = document.createElement('li');
            const key = document.createElement('span');
            key.className = 'key share-bar-key ' + p.cls;
            key.setAttribute('aria-hidden', 'true');
            const a = document.createElement('a');
            a.href = p.href;
            const strong = document.createElement('strong');
            strong.textContent = fmt.format(p.n);
            a.appendChild(strong);
            a.appendChild(document.createTextNode(' ' + p.label));
            li.appendChild(key);
            li.appendChild(a);
            legend.appendChild(li);
        });
        bar.hidden = total === 0;
    }

    async function loadStats() {
        try {
            const data = await fetchApi('/api/stats');
            const stats = data.devices || data;
            
            // Update stats with values
            setStatValue('stat-total', stats.total ?? 0);
            setStatValue('stat-online', stats.online ?? 0);
            setStatValue('stat-banned', stats.banned ?? 0);
            setStatValue('stat-connections', stats.offline ?? 0);
            renderDevicesNow(stats);
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
        
        // Status tones (components.css "Data display"): a stopped ID or relay server is a failure here
        element.classList.remove('running', 'stopped', 'unknown', 'is-good', 'is-danger', 'is-waiting', 'is-neutral');
        
        if (status?.status === 'running' || status?.online) {
            element.classList.add('is-good');
            statusText.textContent = _('status.running');
        } else if (status?.status === 'stopped' || status?.online === false) {
            element.classList.add('is-danger');
            statusText.textContent = _('status.stopped');
        } else {
            element.classList.add('is-neutral');
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
            // Say which part is down and what that means for clients
            pill.classList.add('stopped');
            if (!signalRunning && !relayRunning) {
                text.textContent = _('dashboard.status_both_down');
            } else if (!relayRunning) {
                text.textContent = _('dashboard.status_relay_down');
            } else {
                text.textContent = _('dashboard.status_signal_down');
            }
        } else {
            pill.classList.add('unknown');
            text.textContent = _('status.unknown');
        }
        // Only a problem needs a line in "Needs attention"
        pill.hidden = pill.classList.contains('running');
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
            // localhost or .local values only work on this machine: say so next to them
            const localWarning = findById('client-config-local-warning');
            if (localWarning) localWarning.hidden = !clientConfig.phone_unreachable_host;
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
        const text = revealBtn.querySelector('.btn-label');
        if (text) text.textContent = label;
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
                    <div class="code-block-head"><span class="code-block-title">install-rustdesk-config.ps1</span></div>
                    <pre class="code-block client-config-script-block" tabindex="0" role="region" aria-label="${escapeHtml(_('dashboard.intune_script_title'))}"><code>${escapeHtml(script)}</code></pre>
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
            ? `<p class="notice warning">${escapeHtml(_('dashboard.client_config_qr_unreachable_host'))}</p>`
            : '';

        Modal.show({
            title: _('dashboard.client_config_qr_title'),
            content: `
                <div class="client-config-qr-modal">
                    ${warn}
                    <div class="client-config-qr-frame">
                        <img src="${escapeHtml(clientConfig.qr)}" alt="${escapeHtml(_('dashboard.client_config_qr_title'))}" width="300" height="300">
                    </div>
                    <p>${escapeHtml(_('dashboard.client_config_qr_hint'))}</p>
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

    function initAgentActivation() {
        activateAgentQrButton = findById('activate-agent-qr-btn');
        activationModal = findById('dashboard-agent-activation-modal');
        if (!activationModal) return;
        activateAgentQrHandler = openAgentActivation;
        activateAgentQrButton?.addEventListener('click', activateAgentQrHandler);
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

        // Deep-link from Główne → Aktywuj agenta (/?activateAgent=1)
        try {
            const params = new URLSearchParams(window.location.search || '');
            if (params.get('activateAgent') === '1') {
                const navItem = document.getElementById('nav-activate-agent');
                if (navItem) navItem.classList.add('active');
                if (activateAgentQrButton || activationModal) {
                    openAgentActivation();
                }
            }
        } catch (_) { /* ignore */ }
    }

    let activationOpener = null;

    function onActivationKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeAgentActivation();
        }
    }

    async function openAgentActivation() {
        if (!activationModal) return;
        activationOpener = document.activeElement;
        activationModal.hidden = false;
        activationModal.style.display = 'flex';
        document.addEventListener('keydown', onActivationKeydown);
        (activationFileButton || activationCloseButton)?.focus();
        activationForm.hidden = true;
        activationDeviceId = '';
        setActivationStatus(_('dashboard.activate_agent_scanning'));
        await startAgentActivationCamera();
    }

    function closeAgentActivation() {
        stopAgentActivation();
        if (activationModal) {
            activationModal.hidden = true;
            activationModal.style.display = 'none';
        }
        document.removeEventListener('keydown', onActivationKeydown);
        if (activationOpener && document.contains(activationOpener)) activationOpener.focus();
        activationOpener = null;
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
        return Utils.formatDuration(seconds);
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
