/**
 * BetterDesk Console - Client setup page (/keys)
 *
 * Shows the values a RustDesk client needs (ID server, relay, API server,
 * public key), the same values as a QR code for the phone app, and the key
 * file download.
 */

(function() {
    'use strict';

    const _ = window._ || (k => k);
    const PUBLIC_KEY_MASK = '••••••••••••••••••••••••';
    /** Same key as the overview: the QR follows its client server address override (#368). */
    const CLIENT_HOST_STORAGE_KEY = 'bd_client_config_host';

    let rawPublicKey = '';
    let publicKeyVisible = false;
    // Both warnings say "phones can't reach this address"; show only one
    let hostIsLocal = false;
    let qrHostUnreachable = false;

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        loadAll();

        document.getElementById('copy-key-btn')?.addEventListener('click', copyPublicKey);
        document.getElementById('reveal-key-btn')?.addEventListener('click', togglePublicKeyVisibility);
        document.getElementById('download-key-btn')?.addEventListener('click', downloadKey);
        document.querySelectorAll('.keys-page [data-copy-target]').forEach((button) => {
            button.addEventListener('click', () => copyField(button));
        });
        document.getElementById('qr-wrapper')?.addEventListener('click', (e) => {
            if (e.target.closest('[data-retry-qr]')) loadQRCode();
        });

        window.addEventListener('app:refresh', loadAll);
    }

    function loadAll() {
        loadPublicKey();
        loadQRCode();
        loadServerInfo();
    }

    function getStoredClientHost() {
        try {
            return sessionStorage.getItem(CLIENT_HOST_STORAGE_KEY) || '';
        } catch {
            return '';
        }
    }

    function clientHostQuery() {
        const host = getStoredClientHost().trim();
        return host ? `?host=${encodeURIComponent(host)}` : '';
    }

    function isLocalHost(host) {
        const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
        return h === 'localhost' || h === '::1' || h.startsWith('127.') || h === '0.0.0.0';
    }

    /** Short "Copied" on the button itself, so the feedback is where the user clicked */
    function flashCopied(button) {
        if (!button) return;
        const label = button.querySelector('.btn-label') || button;
        const before = label.textContent;
        button.classList.add('copied');
        label.textContent = _('keys.copied');
        setTimeout(() => {
            button.classList.remove('copied');
            if (label.textContent === _('keys.copied')) label.textContent = before;
        }, 1600);
    }

    /**
     * Public key (masked until "Show")
     */
    async function loadPublicKey() {
        try {
            const data = await Utils.api('/api/keys/public');
            rawPublicKey = (data.key || '').trim();
            renderPublicKeyField(false, rawPublicKey ? null : _('keys.no_key'));
        } catch (error) {
            rawPublicKey = '';
            renderPublicKeyField(false, error && error.status === 404 ? _('keys.no_key') : _('errors.load_key_failed'));
        }
    }

    function renderPublicKeyField(visible, errorText) {
        const keyText = document.getElementById('public-key-text');
        const revealBtn = document.getElementById('reveal-key-btn');
        const copyBtn = document.getElementById('copy-key-btn');
        const downloadBtn = document.getElementById('download-key-btn');
        if (!keyText) return;

        publicKeyVisible = Boolean(visible && rawPublicKey);
        const hasKey = Boolean(rawPublicKey) && !errorText;

        if (!hasKey) {
            keyText.textContent = errorText || _('keys.no_key');
            keyText.classList.remove('is-masked');
            keyText.removeAttribute('data-raw');
        } else {
            keyText.dataset.raw = rawPublicKey;
            keyText.textContent = publicKeyVisible ? rawPublicKey : PUBLIC_KEY_MASK;
            keyText.classList.toggle('is-masked', !publicKeyVisible);
        }
        if (revealBtn) revealBtn.disabled = !hasKey;
        if (copyBtn) copyBtn.disabled = !hasKey;
        if (downloadBtn) downloadBtn.disabled = !hasKey;
        syncPublicKeyRevealButton();
    }

    function syncPublicKeyRevealButton() {
        const revealBtn = document.getElementById('reveal-key-btn');
        if (!revealBtn) return;
        const label = publicKeyVisible ? _('actions.hide_value') : _('actions.show_value');
        const labelEl = revealBtn.querySelector('.btn-label');
        if (labelEl) labelEl.textContent = label;
        revealBtn.setAttribute('aria-label', `${label} ${_('dashboard.config_key')}`);
        revealBtn.setAttribute('aria-pressed', publicKeyVisible ? 'true' : 'false');
    }

    function togglePublicKeyVisibility() {
        if (!rawPublicKey) return;
        renderPublicKeyField(!publicKeyVisible);
    }

    /**
     * QR code (honours the overview's client host override via sessionStorage)
     */
    async function loadQRCode() {
        const qrWrapper = document.getElementById('qr-wrapper');
        if (!qrWrapper) return;
        qrWrapper.innerHTML = `<p class="state">${Utils.escapeHtml(_('keys.qr_loading'))}</p>`;

        try {
            const data = await Utils.api(`/api/keys/public/qr${clientHostQuery()}`);
            if (!data || !data.qr) throw new Error('No QR data');
            qrHostUnreachable = Boolean(data.phone_unreachable_host);
            syncWarnings();
            const img = document.createElement('img');
            img.src = data.qr;
            img.alt = _('keys.qr_alt');
            img.width = 220;
            img.height = 220;
            qrWrapper.replaceChildren(img);
        } catch (error) {
            console.error('QR load error:', error);
            qrHostUnreachable = false;
            syncWarnings();
            qrWrapper.innerHTML = `<p class="state is-error">${Utils.escapeHtml(_('keys.qr_failed'))}
                <button type="button" class="btn btn-sm" data-retry-qr>${Utils.escapeHtml(_('actions.retry'))}</button></p>`;
        }
    }

    /**
     * ID server, relay server, API server and the masked server API key
     */
    async function loadServerInfo() {
        const set = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value || '-';
        };
        let host = '';
        try {
            const data = await Utils.api(`/api/keys/server-info${clientHostQuery()}`);
            host = data.server_id || window.location.hostname;
            set('server-ip', host);
            set('relay-ip', data.relay_server || window.location.hostname);
            set('api-url', data.api_url || '');
            set('api-key', data.api_key_masked || '');
        } catch (error) {
            console.error('Failed to load server info:', error);
            host = window.location.hostname;
            set('server-ip', host);
            set('relay-ip', host);
            set('api-url', '');
            set('api-key', '');
        }
        hostIsLocal = isLocalHost(host);
        syncWarnings();
    }

    function syncWarnings() {
        const local = document.getElementById('keys-local-warning');
        const qr = document.getElementById('keys-qr-warning');
        if (local) local.hidden = !hostIsLocal;
        if (qr) qr.hidden = !qrHostUnreachable || hostIsLocal;
    }

    async function copyField(button) {
        const id = button.dataset.copyTarget;
        const el = id && document.getElementById(id);
        const value = el ? el.textContent.trim() : '';
        if (!value || value === '-' || value === '…') {
            Notifications.warning(_('keys.nothing_to_copy'));
            return;
        }
        try {
            await Utils.copyToClipboard(value);
            flashCopied(button);
        } catch {
            Notifications.error(_('keys.copy_failed'));
        }
    }

    /**
     * Copy the public key (the raw value, also while masked)
     */
    async function copyPublicKey() {
        const key = rawPublicKey.trim();
        if (!key) {
            Notifications.warning(_('keys.no_key_to_copy'));
            return;
        }
        try {
            await Utils.copyToClipboard(key);
            flashCopied(document.getElementById('copy-key-btn'));
        } catch {
            Notifications.error(_('keys.copy_failed'));
        }
    }

    /**
     * Download the public key as id_ed25519.pub
     */
    async function downloadKey() {
        try {
            const response = await fetch('/api/keys/public/download', { credentials: 'same-origin' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'id_ed25519.pub';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            Notifications.success(_('keys.download_success'));
        } catch (error) {
            Notifications.error(_('errors.download_failed'));
        }
    }
})();
