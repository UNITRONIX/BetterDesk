/**
 * BetterDesk Console — UX 3.5 shell compatibility bridge.
 *
 * UX 3.5 is now the only supported shell. Keep this small bridge so stale
 * bookmarks, cookies, and integrations from the former shell switch do not
 * reintroduce classic UI state.
 */
(function () {
    'use strict';

    var COOKIE = 'bd_ui_shell';
    var MAX_AGE_SEC = 365 * 24 * 60 * 60;

    function setCookie(value) {
        document.cookie = COOKIE + '=' + encodeURIComponent(value)
            + '; path=/; max-age=' + MAX_AGE_SEC + '; SameSite=Lax';
    }

    function switchTo(shell) {
        if (shell !== 'ux35') return;
        setCookie('ux35');
        try { localStorage.setItem(COOKIE, 'ux35'); } catch (e) { /* ignore */ }
    }

    function init() {
        if (window.BetterDesk && window.BetterDesk.embed) return;
        switchTo('ux35');
    }

    window.UiShell = {
        switchTo: switchTo,
        current: function () {
            return 'ux35';
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
