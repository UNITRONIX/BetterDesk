/**
 * BetterDesk Console — UI shell bridge (UX 3.5 default / UX 3.6 beta).
 *
 * Owns the one place that changes the shell from the browser, used by:
 *   - the topbar toggle (`#ui-shell-toggle`), present in both shells;
 *   - the "switch back" entry in the UX 3.6 sidebar footer;
 *   - the Settings → General → Console interface card.
 *
 * The server is the source of truth: `POST /api/ui-shell` persists the choice
 * in the `bd_ui_shell` cookie and we reload so SSR renders the chosen shell.
 * The cookie mirror here only keeps `UiShell.current()` and stale bookmarks
 * coherent — it never decides which shell renders.
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

    function t(key, fallback) {
        if (typeof window._ === 'function') {
            var value = window._(key);
            if (value && value !== key) return value;
        }
        return fallback;
    }

    function currentShell() {
        var fromSsr = window.BetterDesk && window.BetterDesk.uiShell;
        return normalize(fromSsr) || DEFAULT_SHELL;
    }

    function setCookie(value) {
        document.cookie = COOKIE + '=' + encodeURIComponent(value)
            + '; path=/; max-age=' + MAX_AGE_SEC + '; SameSite=Lax';
    }

    /** Client-side mirror of the server choice (not the authority). */
    function remember(shell) {
        var next = normalize(shell);
        if (!next) return null;
        setCookie(next);
        try { localStorage.setItem(COOKIE, next); } catch (e) { /* ignore */ }
        if (window.BetterDesk) window.BetterDesk.uiShell = next;
        return next;
    }

    /** Persist a shell choice on the server. Rejects on any non-2xx answer. */
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
            remember(next);
            return next;
        });
    }

    function notifyFailure() {
        var message = t('ux36.switch_failed', 'Could not change the console layout. Please try again.');
        if (window.Notifications && typeof window.Notifications.error === 'function') {
            window.Notifications.error(message);
        } else if (typeof window.alert === 'function') {
            window.alert(message);
        }
    }

    function reloadWith(shell) {
        setShell(shell).then(function () {
            window.location.reload();
        }).catch(notifyFailure);
    }

    /** Topbar toggle: one button whose target is the *other* shell. */
    function initTopbarToggle() {
        var button = document.getElementById('ui-shell-toggle');
        if (!button) return;
        button.addEventListener('click', function () {
            var target = normalize(button.getAttribute('data-target-shell'));
            if (!target || target === currentShell()) return;
            button.disabled = true;
            reloadWith(target);
        });
    }

    /** Sidebar "switch back" entry rendered only in UX 3.6. */
    function initSidebarSwitch() {
        var button = document.getElementById('ux36-switch-back');
        if (!button) return;
        button.addEventListener('click', function () {
            button.disabled = true;
            reloadWith('ux35');
        });
    }

    /** Settings → General → Console interface radio group. */
    function initSettingsChoice() {
        var group = document.querySelector('.ux36-shell-choice');
        if (!group) return;
        var current = normalize(group.getAttribute('data-current-shell')) || DEFAULT_SHELL;

        function markActive(shell) {
            Array.prototype.forEach.call(group.querySelectorAll('.ux36-shell-choice-option'), function (option) {
                option.classList.toggle('is-active', option.getAttribute('data-shell-option') === shell);
            });
            Array.prototype.forEach.call(group.querySelectorAll('input[name="ui-shell"]'), function (radio) {
                radio.checked = radio.value === shell;
            });
        }

        Array.prototype.forEach.call(group.querySelectorAll('input[name="ui-shell"]'), function (input) {
            input.addEventListener('change', function () {
                if (!input.checked || input.value === current) return;
                var target = input.value;
                markActive(target);
                setShell(target).then(function () {
                    window.location.reload();
                }).catch(function () {
                    markActive(current);
                    notifyFailure();
                });
            });
        });
    }

    function init() {
        if (window.BetterDesk && window.BetterDesk.embed) return;
        // Keep the client mirror aligned with what the server just rendered.
        remember(currentShell());
        initTopbarToggle();
        initSidebarSwitch();
        initSettingsChoice();
    }

    window.UiShell = {
        /** Persist a shell on the server; resolves with the applied value. */
        setShell: setShell,
        /** Reload into another shell (used by the toggle and the sidebar entry). */
        switchTo: function (shell) { reloadWith(normalize(shell) || DEFAULT_SHELL); },
        current: currentShell,
        supported: SUPPORTED.slice(),
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
