/**
 * Guest Access Link — the devices one link allows (allowlist only).
 * No quick connect, no folders, no console links.
 */
(function () {
    'use strict';

    function t(key, fallback) {
        try {
            if (typeof window._ === 'function') {
                var v = window._(key);
                if (v && v !== key) return v;
            }
            if (window.i18n && typeof window.i18n.t === 'function') {
                var w = window.i18n.t(key);
                if (w && w !== key) return w;
            }
        } catch (_) { /* ignore */ }
        return fallback || key;
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function connectUrl(deviceId) {
        var token = window.__guestToken || '';
        var q = new URLSearchParams();
        if (token) q.set('guest', token);
        return '/remote/' + encodeURIComponent(deviceId) + '?' + q.toString();
    }

    function show(id, on) {
        var el = document.getElementById(id);
        if (el) el.hidden = !on;
        return el;
    }

    function render(meta) {
        show('rd-guest-loading', false);

        if (!meta || !Array.isArray(meta.devices)) {
            var err = show('rd-guest-error', true);
            if (err) err.textContent = t('guest_access.expired', 'This guest link is invalid or expired.');
            return;
        }

        show('rd-guest-banner', true);
        if (meta.label) {
            show('rd-guest-label-term', true);
            var labelEl = show('rd-guest-label', true);
            if (labelEl) labelEl.textContent = meta.label;
        }

        var expiry = document.getElementById('rd-guest-expiry');
        if (expiry && meta.expires_at) {
            var d = new Date(meta.expires_at);
            expiry.textContent = isNaN(d.getTime())
                ? String(meta.expires_at)
                : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
        }

        var access = document.getElementById('rd-guest-access');
        if (access) {
            access.textContent = meta.view_only
                ? t('guest_access.access_view_only', 'View only: you can see the screen but not control it.')
                : t('guest_access.access_full', 'You can see and control the screen.');
        }

        if (!meta.devices.length) {
            show('rd-guest-empty', true);
            return;
        }

        var tbody = document.getElementById('rd-guest-tbody');
        if (!tbody) return;
        show('rd-guest-grid', true);
        var connectLabel = t('remote_dashboard.connect', 'Connect');
        tbody.innerHTML = meta.devices.map(function (dev) {
            var name = dev.display_name || dev.hostname || dev.id;
            var online = !!dev.online;
            return '<tr data-id="' + esc(dev.id) + '">' +
                '<td>' + esc(name) + '</td>' +
                '<td><span class="mono">' + esc(dev.id) + '</span></td>' +
                '<td><span class="status ' + (online ? 'online' : 'offline') + '">' +
                esc(online ? t('status.online', 'Online') : t('status.offline', 'Offline')) + '</span></td>' +
                '<td class="actions"><a class="btn btn-sm rd-guest-connect" data-id="' + esc(dev.id) + '" href="' + esc(connectUrl(dev.id)) + '"' +
                ' aria-label="' + esc(t('remote_dashboard.connect_to', 'Connect to {name}').replace('{name}', name)) + '">' +
                esc(connectLabel) + '</a></td>' +
                '</tr>';
        }).join('');
    }

    document.addEventListener('DOMContentLoaded', function () {
        render(window.__guestAccess || {});
    });
})();
