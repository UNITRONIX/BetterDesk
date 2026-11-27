/**
 * BetterDesk Console — UI shell bridge (UX 3.5 only).
 *
 * UX 3.6 beta is retired from the console. This module keeps the cookie mirror
 * aligned with SSR (`window.BetterDesk.uiShell = ux35`) and clears any stale
 * `bd_ui_shell=ux36` value left in the browser.
 */
(function () {
    'use strict';

    var COOKIE = 'bd_ui_shell';
    var MAX_AGE_SEC = 365 * 24 * 60 * 60;
    var SUPPORTED = ['ux35'];
    var DEFAULT_SHELL = 'ux35';

    function normalize(shell) {
        var value = typeof shell === 'string' ? shell.trim().toLowerCase() : '';
        return SUPPORTED.indexOf(value) === -1 ? null : value;
    }

    function setCookie(value) {
        document.cookie = COOKIE + '=' + encodeURIComponent(value)
            + '; path=/; max-age=' + MAX_AGE_SEC + '; SameSite=Lax';
    }

    function currentShell() {
        return DEFAULT_SHELL;
    }

    function remember(shell) {
        var next = normalize(shell) || DEFAULT_SHELL;
        setCookie(next);
        try { localStorage.setItem(COOKIE, next); } catch (e) { /* ignore */ }
        if (window.BetterDesk) window.BetterDesk.uiShell = next;
        return next;
    }

    function setShell(shell) {
        var next = normalize(shell);
        if (!next) return Promise.reject(new Error('unsupported shell'));
        var token = window.BetterDesk && window.BetterDesk.csrfToken;
        return fetch('/api/ui-shell', {
            method: 'POST',
            headers: Object.assign(
                { 'Content-Type': 'application/json' },
                token ? { 'X-CSRF-Token': token } : {}
            ),
            credentials: 'same-origin',
            body: JSON.stringify({ shell: next })
        }).then(function (res) {
            if (!res.ok) throw new Error('shell switch failed: ' + res.status);
            return res.json();
        }).then(function (body) {
            if (!body || body.success !== true) throw new Error('shell switch rejected');
            remember(DEFAULT_SHELL);
            return DEFAULT_SHELL;
        });
    }

    function init() {
        if (window.BetterDesk && window.BetterDesk.embed) return;
        remember(DEFAULT_SHELL);
    }

    window.UiShell = {
        setShell: setShell,
        switchTo: function () { return Promise.resolve(DEFAULT_SHELL); },
        current: currentShell,
        supported: SUPPORTED.slice(),
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
