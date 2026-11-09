/**
 * BetterDesk Console — UX 3.5 shell compatibility bridge.
 *
 * UX 3.5 is the default console shell; UX 3.6 is an opt-in beta. This bridge
 * keeps stale bookmarks, cookies and integrations from reintroducing removed
 * shell state, and mirrors the server's resolver (lib/uiShell.js) so the client
 * and SSR always agree on the active shell.
 */
(function () {
    'use strict';

    var COOKIE = 'bd_ui_shell';
    var MAX_AGE_SEC = 365 * 24 * 60 * 60;
    var SUPPORTED = ['ux35', 'ux36'];
    var DEFAULT_SHELL = 'ux35';

    function normalize(shell) {
        var value = typeof shell === 'string' ? shell.trim().toLowerCase() : '';
        return SUPPORTED.indexOf(value) === -1 ? null : value;
    }

    function currentShell() {
        var fromSsr = window.BetterDesk && window.BetterDesk.uiShell;
        return normalize(fromSsr) || DEFAULT_SHELL;
    }

    function setCookie(value) {
        document.cookie = COOKIE + '=' + encodeURIComponent(value)
            + '; path=/; max-age=' + MAX_AGE_SEC + '; SameSite=Lax';
    }

    /**
     * Persist a shell choice locally. The server copy is authoritative — use
     * POST /api/ui-shell — this only keeps the client state coherent.
     */
    function switchTo(shell) {
        var next = normalize(shell);
        if (!next) return null;
        setCookie(next);
        try { localStorage.setItem(COOKIE, next); } catch (e) { /* ignore */ }
        if (window.BetterDesk) window.BetterDesk.uiShell = next;
        return next;
    }

    function init() {
        if (window.BetterDesk && window.BetterDesk.embed) return;
        // Keep the cookie aligned with what the server just rendered.
        switchTo(currentShell());
    }

    window.UiShell = {
        switchTo: switchTo,
        current: currentShell,
        supported: SUPPORTED.slice(),
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
