/**
 * BetterDesk RdClient — operator login (/remote/login)
 */

(function () {
    'use strict';

    function t(key, fallback) {
        if (typeof _ === 'function') {
            var v = _(key);
            if (v && v !== key) return v;
        }
        return fallback || key;
    }

    function returnUrl() {
        var u = (window.BetterDesk && window.BetterDesk.returnUrl) || '/remote';
        if (typeof u !== 'string' || !u.startsWith('/remote')) return '/remote';
        return u;
    }

    function redirectAfterLogin() {
        window.location.href = returnUrl();
    }

    function showError(el, textEl, msg) {
        if (textEl) textEl.textContent = msg;
        if (el) el.classList.remove('hidden');
    }

    function hideError(el) {
        if (el) el.classList.add('hidden');
    }

    async function prefillCredentials() {
        var store = window.RdClientSecureStore;
        if (!store) return;
        var usernameInput = document.getElementById('rdclient-username');
        var passwordInput = document.getElementById('rdclient-password');
        var rememberInput = document.getElementById('rdclient-remember');
        if (!usernameInput || !passwordInput) return;

        try {
            var creds = await store.loadCredentials();
            if (creds.username) usernameInput.value = creds.username;
            if (creds.password) {
                passwordInput.value = creds.password;
                if (rememberInput) rememberInput.checked = true;
            } else if (rememberInput) {
                rememberInput.checked = await store.hasStoredPassword();
            }
        } catch (_) { /* ignore */ }
    }

    function checkSessionExpired() {
        if (!(window.BetterDesk && window.BetterDesk.sessionExpired)) return;
        showError(
            document.getElementById('rdclient-error'),
            document.getElementById('rdclient-error-text'),
            t('rdclient_login.session_expired', 'Session expired. Please sign in again.')
        );
    }

    function bindLoginForm() {
        var form = document.getElementById('rdclient-login-form');
        var submitBtn = document.getElementById('rdclient-submit-btn');
        var errorEl = document.getElementById('rdclient-error');
        var errorText = document.getElementById('rdclient-error-text');
        var passwordToggle = document.getElementById('rdclient-password-toggle');
        var passwordInput = document.getElementById('rdclient-password');
        var csrfToken = (window.BetterDesk && window.BetterDesk.csrfToken) || '';

        if (passwordToggle && passwordInput) {
            passwordToggle.addEventListener('click', function () {
                var isPassword = passwordInput.type === 'password';
                passwordInput.type = isPassword ? 'text' : 'password';
                passwordToggle.querySelector('.material-icons').textContent =
                    isPassword ? 'visibility_off' : 'visibility';
                passwordToggle.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
            });
        }

        if (!form) return;

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var username = (document.getElementById('rdclient-username').value || '').trim();
            var password = (document.getElementById('rdclient-password').value || '');
            var remember = document.getElementById('rdclient-remember');
            var rememberChecked = remember ? remember.checked : false;

            if (!username || !password) {
                showError(errorEl, errorText, t('rdclient_login.fill_all_fields', 'Please fill in all fields'));
                return;
            }

            submitBtn.classList.add('loading');
            submitBtn.disabled = true;
            hideError(errorEl);

            fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                credentials: 'same-origin',
                body: JSON.stringify({ username: username, password: password })
            })
            .then(function (r) { return r.json().then(function (data) { return { data: data }; }); })
            .then(function (result) {
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;

                if (result.data.success && result.data.totpRequired) {
                    showTotpForm();
                    return;
                }

                if (result.data.success) {
                    var store = window.RdClientSecureStore;
                    if (store) {
                        store.saveCredentials(username, password, rememberChecked)
                            .finally(redirectAfterLogin);
                    } else {
                        redirectAfterLogin();
                    }
                    return;
                }

                showError(errorEl, errorText, result.data.error || t('rdclient_login.invalid_credentials', 'Invalid credentials'));
            })
            .catch(function () {
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;
                showError(errorEl, errorText, t('rdclient_login.network_error', 'Network error'));
            });
        });
    }

    function showTotpForm() {
        document.getElementById('rdclient-login-form').classList.add('hidden');
        var totpForm = document.getElementById('rdclient-totp-form');
        if (totpForm) {
            totpForm.classList.remove('hidden');
            var first = totpCodeInputs(totpForm)[0];
            if (first) setTimeout(function () { first.focus(); }, 100);
        }
    }

    function hideTotpForm() {
        document.getElementById('rdclient-login-form').classList.remove('hidden');
        document.getElementById('rdclient-totp-form').classList.add('hidden');
        totpCodeInputs().forEach(function (d) { d.value = ''; });
        var userInput = document.getElementById('rdclient-username');
        if (userInput) userInput.focus();
    }

    // The code field (#rdclient-totp-code); older markup used six .dl-totp-digit boxes
    function totpCodeInputs(form) {
        form = form || document.getElementById('rdclient-totp-form');
        if (!form) return [];
        var single = form.querySelector('#rdclient-totp-code');
        return single ? [single] : Array.prototype.slice.call(form.querySelectorAll('.dl-totp-digit'));
    }

    function getTotpCode() {
        return totpCodeInputs().map(function (d) { return d.value; }).join('').replace(/\D/g, '');
    }

    function bindTotpForm() {
        var form = document.getElementById('rdclient-totp-form');
        var submitBtn = document.getElementById('rdclient-totp-submit');
        var errorEl = document.getElementById('rdclient-totp-error');
        var errorText = document.getElementById('rdclient-totp-error-text');
        var backLink = document.getElementById('rdclient-totp-back-link');
        var csrfToken = (window.BetterDesk && window.BetterDesk.csrfToken) || '';

        if (!form) return;

        var codeInput = form.querySelector('#rdclient-totp-code');
        if (codeInput) {
            // Submits on its own once six digits are in, as the digit boxes did
            codeInput.addEventListener('input', function () {
                var val = codeInput.value.replace(/\D/g, '').substring(0, 6);
                if (codeInput.value !== val) codeInput.value = val;
                if (val.length === 6) submitTotp();
            });
        }

        var digits = form.querySelectorAll('.dl-totp-digit');
        digits.forEach(function (digit, idx) {
            digit.addEventListener('input', function () {
                var val = digit.value.replace(/\D/g, '');
                digit.value = val.substring(0, 1);
                if (val && idx < 5) digits[idx + 1].focus();
                if (getTotpCode().length === 6) submitTotp();
            });
            digit.addEventListener('keydown', function (e) {
                if (e.key === 'Backspace' && !digit.value && idx > 0) {
                    digits[idx - 1].focus();
                    digits[idx - 1].value = '';
                }
            });
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            submitTotp();
        });

        function submitTotp() {
            if (submitBtn.disabled) return;
            var code = getTotpCode();
            if (code.length !== 6) {
                showError(errorEl, errorText, t('rdclient_login.enter_6_digits', 'Enter all 6 digits'));
                return;
            }
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;
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
            .then(function (r) { return r.json(); })
            .then(function (data) {
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;
                if (data.success) {
                    redirectAfterLogin();
                    return;
                }
                showError(errorEl, errorText, data.error || t('rdclient_login.invalid_code', 'Invalid code'));
                var inputs = totpCodeInputs(form);
                inputs.forEach(function (d) { d.value = ''; });
                if (inputs[0]) inputs[0].focus();
            })
            .catch(function () {
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;
                showError(errorEl, errorText, t('rdclient_login.network_error', 'Network error'));
            });
        }

        if (backLink) {
            backLink.addEventListener('click', function (e) {
                e.preventDefault();
                hideTotpForm();
                hideError(errorEl);
            });
        }
    }

    function init() {
        prefillCredentials();
        checkSessionExpired();
        bindLoginForm();
        bindTotpForm();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
