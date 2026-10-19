/**
 * Panel session watchdog — UX only. Server enforces idle/absolute expiry.
 */
(function () {
    'use strict';

    var CHANNEL = 'betterdesk-panel-session';
    var STORAGE_KEY = 'betterdesk.session.expired';
    var warnTimer = null;
    var expireTimer = null;
    var syncTimer = null;
    var lastActivity = Date.now();
    var policy = null;
    var warningShown = false;
    var channel = null;

    function t(key, fallback) {
        if (typeof _ === 'function') {
            var v = _(key);
            if (v && v !== key) return v;
        }
        return fallback || key;
    }

    function broadcastExpired(code) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                at: Date.now(),
                code: code || 'session_expired'
            }));
        } catch (_) { /* private mode */ }
        if (channel) {
            try { channel.postMessage({ type: 'expired', code: code || 'session_expired' }); } catch (_) {}
        }
    }

    function goLogin() {
        var path = window.location.pathname || '';
        if (path.startsWith('/login') || path.startsWith('/remote/login')) return;
        broadcastExpired('session_expired');
        window.location.href = '/login?expired=1';
    }

    function markActivity() {
        lastActivity = Date.now();
        warningShown = false;
        hideWarning();
        scheduleLocalTimers();
    }

    function hideWarning() {
        var el = document.getElementById('session-idle-warning');
        if (el) el.classList.add('hidden');
    }

    function showWarning(secondsLeft) {
        var el = document.getElementById('session-idle-warning');
        if (!el) {
            el = document.createElement('div');
            el.id = 'session-idle-warning';
            el.className = 'session-idle-warning';
            el.setAttribute('role', 'alertdialog');
            el.innerHTML =
                '<div class="session-idle-warning-card">' +
                '<span class="material-icons" aria-hidden="true">timer</span>' +
                '<div class="session-idle-warning-text">' +
                '<strong id="session-idle-warning-title"></strong>' +
                '<p id="session-idle-warning-body"></p>' +
                '</div>' +
                '<button type="button" class="btn btn-primary" id="session-idle-stay">' +
                '</button>' +
                '</div>';
            document.body.appendChild(el);
            el.querySelector('#session-idle-stay').addEventListener('click', function () {
                markActivity();
                // Nudge server activity so idle window slides.
                if (typeof Utils !== 'undefined' && Utils.api) {
                    Utils.api('/api/auth/verify').catch(function () {});
                }
            });
        }
        el.classList.remove('hidden');
        el.querySelector('#session-idle-warning-title').textContent =
            t('auth.session_idle_warning_title', 'Session expiring soon');
        el.querySelector('#session-idle-warning-body').textContent =
            t('auth.session_idle_warning_body', 'You will be signed out due to inactivity in {{seconds}} seconds.')
                .replace('{{seconds}}', String(Math.max(1, secondsLeft)));
        el.querySelector('#session-idle-stay').textContent =
            t('auth.session_stay_signed_in', 'Stay signed in');
        warningShown = true;
    }

    function clearTimers() {
        if (warnTimer) clearTimeout(warnTimer);
        if (expireTimer) clearTimeout(expireTimer);
        warnTimer = expireTimer = null;
    }

    function scheduleLocalTimers() {
        clearTimers();
        if (!policy || !window.BetterDesk || !window.BetterDesk.user) return;
        var idleMs = policy.idleTimeoutMs || (30 * 60 * 1000);
        var warnMs = policy.warnBeforeMs || 60 * 1000;
        var untilWarn = Math.max(0, idleMs - warnMs);
        warnTimer = setTimeout(function () {
            var left = Math.ceil((lastActivity + idleMs - Date.now()) / 1000);
            showWarning(left);
        }, untilWarn);
        expireTimer = setTimeout(function () {
            // Server is authoritative; verify once, then redirect.
            if (typeof Utils !== 'undefined' && Utils.api) {
                Utils.api('/api/auth/verify').catch(function () { goLogin(); });
            } else {
                goLogin();
            }
        }, idleMs + 500);
    }

    async function syncFromServer() {
        if (!window.BetterDesk || !window.BetterDesk.user) return;
        if (typeof Utils === 'undefined' || !Utils.api) return;
        try {
            var data = await Utils.api('/api/auth/verify');
            if (data && data.session) {
                policy = {
                    idleTimeoutMs: data.session.idleTimeoutMs,
                    maxAgeMs: data.session.maxAgeMs,
                    warnBeforeMs: data.session.warnBeforeMs
                };
                window.BetterDesk.sessionPolicy = policy;
                if (data.session.lastActivityAt) {
                    lastActivity = Math.max(lastActivity, data.session.lastActivityAt);
                }
                scheduleLocalTimers();
            }
        } catch (_) {
            // Utils.api already redirects on 401
        }
    }

    function onCrossTab(msg) {
        if (!msg) return;
        if (msg.type === 'expired') goLogin();
    }

    function init() {
        if (!window.BetterDesk || !window.BetterDesk.user) return;
        policy = window.BetterDesk.sessionPolicy || null;

        try {
            channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
            if (channel) channel.onmessage = function (ev) { onCrossTab(ev.data); };
        } catch (_) { channel = null; }

        window.addEventListener('storage', function (ev) {
            if (ev.key === STORAGE_KEY && ev.newValue) goLogin();
        });

        ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (evt) {
            document.addEventListener(evt, markActivity, { passive: true });
        });

        syncFromServer();
        syncTimer = setInterval(syncFromServer, 5 * 60 * 1000);
        scheduleLocalTimers();
    }

    window.BetterDeskSession = {
        broadcastExpired: broadcastExpired,
        markActivity: markActivity,
        syncFromServer: syncFromServer
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
