/**
 * BetterDesk Console — sign-in page for the desktop mode (views/desktop-login.ejs).
 * Same form as the console sign-in, plus a list of the accounts on this
 * server: picking one fills in the username. Two-factor code as a second step.
 */

(function () {
    'use strict';

    function init() {
        bindLoginForm();
        bindTotpForm();
        renderUserList();
        checkSessionExpired();
    }

    // ============ Session Expiry Detection ============

    function checkSessionExpired() {
        var expired = false;
        try {
            var params = new URLSearchParams(window.location.search || '');
            expired = params.get('expired') === '1';
            if (expired) {
                params.delete('expired');
                var cleanQuery = params.toString();
                var cleanUrl = window.location.pathname + (cleanQuery ? '?' + cleanQuery : '') + (window.location.hash || '');
                window.history.replaceState({}, document.title, cleanUrl);
            }
        } catch (_) { /* ignore */ }

        if (!expired && window.BetterDesk && window.BetterDesk.sessionExpired) {
            expired = true;
        }
        if (!expired) return;

        var message = _t('desktop_login.session_expired') ||
            _t('auth.session_expired') ||
            'Session expired. Please sign in again.';

        // Toast, so the form keeps its height
        if (window.Notifications && typeof Notifications.error === 'function') {
            Notifications.error(message);
            return;
        }

        var errorEl = document.getElementById('dl-error');
        var errorText = document.getElementById('dl-error-text');
        if (errorEl && errorText) {
            showError(errorEl, errorText, message);
        }
    }

    // ============ Login Form ============

    function bindLoginForm() {
        var form = document.getElementById('dl-login-form');
        var submitBtn = document.getElementById('dl-submit-btn');
        var errorEl = document.getElementById('dl-error');
        var errorText = document.getElementById('dl-error-text');
        var passwordToggle = document.getElementById('dl-password-toggle');
        var passwordInput = document.getElementById('dl-password');

        if (!form) return;

        var csrfToken = (window.BetterDesk && window.BetterDesk.csrfToken) || '';

        // Show or hide the password; aria-pressed tells screen readers which
        if (passwordToggle && passwordInput) {
            passwordToggle.addEventListener('click', function () {
                var show = passwordInput.type === 'password';
                passwordInput.type = show ? 'text' : 'password';
                passwordToggle.setAttribute('aria-pressed', show ? 'true' : 'false');
                passwordToggle.querySelector('.material-icons').textContent =
                    show ? 'visibility_off' : 'visibility';
            });
        }

        form.addEventListener('submit', function (e) {
            e.preventDefault();

            var usernameInput = document.getElementById('dl-username');
            var username = (usernameInput.value || '').trim();
            var password = (passwordInput.value || '');

            if (!username || !password) {
                showError(errorEl, errorText, _t('desktop_login.fill_all_fields') || 'Enter your username and password.');
                (username ? passwordInput : usernameInput).focus();
                return;
            }

            setBusy(submitBtn, true);
            hideError(errorEl);

            var clientFingerprint = (function () {
                try {
                    var parts = [
                        navigator.userAgent || '',
                        navigator.language || '',
                        String(screen.width || '') + 'x' + String(screen.height || ''),
                        String(new Date().getTimezoneOffset()),
                        String(navigator.hardwareConcurrency || ''),
                        String(navigator.platform || '')
                    ].join('|');
                    var hash = 2166136261;
                    for (var i = 0; i < parts.length; i++) {
                        hash ^= parts.charCodeAt(i);
                        hash = Math.imul(hash, 16777619);
                    }
                    return ('00000000' + (hash >>> 0).toString(16)).slice(-8) +
                        ('00000000' + ((hash ^ parts.length) >>> 0).toString(16)).slice(-8);
                } catch (_) { return ''; }
            })();
            fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                credentials: 'same-origin',
                body: JSON.stringify({ username: username, password: password, clientFingerprint: clientFingerprint })
            })
            .then(function (r) { return r.json().then(function (data) { return { status: r.status, data: data }; }); })
            .then(function (result) {
                setBusy(submitBtn, false);

                if (result.data.success && result.data.totpRequired) {
                    showTotpForm();
                    return;
                }

                if (result.data.success) {
                    window.location.href = '/';
                    return;
                }

                showError(errorEl, errorText, result.data.error || _t('desktop_login.invalid_credentials') || 'Invalid username or password.');
                passwordInput.select();
                passwordInput.focus();
            })
            .catch(function () {
                setBusy(submitBtn, false);
                showError(errorEl, errorText, _t('desktop_login.network_error') || 'Could not reach the server. Check your connection.');
            });
        });
    }

    // ============ TOTP Form ============

    function showTotpForm() {
        var loginForm = document.getElementById('dl-login-form');
        var totpForm = document.getElementById('dl-totp-form');
        var users = document.querySelector('.dl-accounts');
        if (loginForm) loginForm.classList.add('hidden');
        if (users) users.classList.add('hidden');
        if (totpForm) {
            totpForm.classList.remove('hidden');
            var code = document.getElementById('dl-totp-code');
            if (code) code.focus();
        }
    }

    function hideTotpForm() {
        var loginForm = document.getElementById('dl-login-form');
        var totpForm = document.getElementById('dl-totp-form');
        var users = document.querySelector('.dl-accounts');
        if (loginForm) loginForm.classList.remove('hidden');
        if (users) users.classList.remove('hidden');
        if (totpForm) totpForm.classList.add('hidden');
        var code = document.getElementById('dl-totp-code');
        if (code) code.value = '';
        var pwd = document.getElementById('dl-password');
        if (pwd) pwd.focus();
    }

    function bindTotpForm() {
        var form = document.getElementById('dl-totp-form');
        var submitBtn = document.getElementById('dl-totp-submit');
        var errorEl = document.getElementById('dl-totp-error');
        var errorText = document.getElementById('dl-totp-error-text');
        var backLink = document.getElementById('dl-totp-back-link');
        var codeInput = document.getElementById('dl-totp-code');

        if (!form || !codeInput) return;

        var csrfToken = (window.BetterDesk && window.BetterDesk.csrfToken) || '';
        var submitting = false;

        // Digits only; send as soon as six are there (typed or pasted)
        codeInput.addEventListener('input', function () {
            var digits = codeInput.value.replace(/\D/g, '').substring(0, 6);
            if (digits !== codeInput.value) codeInput.value = digits;
            if (digits.length === 6) submitTotp();
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            submitTotp();
        });

        function submitTotp() {
            if (submitting) return;
            var code = codeInput.value.replace(/\D/g, '');
            if (code.length !== 6) {
                showError(errorEl, errorText, _t('desktop_login.enter_6_digits') || 'Enter all 6 digits.');
                codeInput.focus();
                return;
            }

            submitting = true;
            setBusy(submitBtn, true);
            hideError(errorEl);

            fetch('/api/auth/totp/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                credentials: 'same-origin',
                body: JSON.stringify({ code: code })
            })
            .then(function (r) { return r.json().then(function (data) { return { status: r.status, data: data }; }); })
            .then(function (result) {
                submitting = false;
                setBusy(submitBtn, false);

                if (result.data.success) {
                    window.location.href = '/';
                    return;
                }

                showError(errorEl, errorText, result.data.error || _t('desktop_login.invalid_code') || 'Invalid code.');
                codeInput.value = '';
                codeInput.focus();
            })
            .catch(function () {
                submitting = false;
                setBusy(submitBtn, false);
                showError(errorEl, errorText, _t('desktop_login.network_error') || 'Could not reach the server. Check your connection.');
            });
        }

        if (backLink) {
            backLink.addEventListener('click', function (e) {
                e.preventDefault();
                hideError(errorEl);
                hideTotpForm();
            });
        }
    }

    // ============ Accounts on this server ============

    function roleLabel(role) {
        var key = 'users.role_' + (role || 'operator');
        var label = _t(key);
        if (!label || label === key) label = String(role || 'operator').replace(/_/g, ' ');
        return label;
    }

    function renderUserList() {
        var container = document.getElementById('dl-users');
        if (!container) return;
        var users = (window.BetterDesk && window.BetterDesk.users) || [];
        if (!users.length) return;

        var html = '';
        users.forEach(function (user) {
            html += '<li><button type="button" class="list-row dl-user-chip" aria-pressed="false" data-username="' + _esc(user.username) + '">' +
                '<span class="row-main">' +
                '<span class="row-title">' + _esc(user.username) + '</span>' +
                '<span class="row-sub">' + _esc(roleLabel(user.role)) + '</span>' +
                '</span></button></li>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.dl-user-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                var input = document.getElementById('dl-username');
                if (input) input.value = chip.dataset.username;
                container.querySelectorAll('.dl-user-chip').forEach(function (c) {
                    c.classList.remove('selected');
                    c.setAttribute('aria-pressed', 'false');
                });
                chip.classList.add('selected');
                chip.setAttribute('aria-pressed', 'true');
                var pwd = document.getElementById('dl-password');
                if (pwd) pwd.focus();
            });
        });
    }

    // ============ Helpers ============

    function _t(key) {
        if (window.BetterDesk && window.BetterDesk.translations) {
            var keys = key.split('.');
            var val = window.BetterDesk.translations;
            for (var i = 0; i < keys.length; i++) {
                if (val && typeof val === 'object') val = val[keys[i]];
                else return key;
            }
            return val || key;
        }
        return key;
    }

    function _esc(s) {
        var d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function setBusy(btn, busy) {
        if (!btn) return;
        btn.classList.toggle('loading', busy);
        btn.disabled = busy;
        btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function showError(el, textEl, msg) {
        if (textEl) textEl.textContent = msg;
        if (el) el.classList.remove('hidden');
    }

    function hideError(el) {
        if (el) el.classList.add('hidden');
    }

    // ============ Init ============

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
