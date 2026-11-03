/**
 * BetterDesk Console — Desktop Login Screen (Phase 46)
 * Windows 11-style full-screen login with lock screen, TOTP 2FA, and multi-user selector.
 */

(function () {
    'use strict';

    var WALLPAPER_STORAGE = 'bd_widget_wallpaper';
    var _clockTimer = null;

    function init() {
        preloadWallpaper();
        startClock();
        bindLockScreen();
        bindLoginForm();
        bindTotpForm();
        renderUserChips();
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

        // Skip lock screen, go straight to login form
        var lockScreen = document.getElementById('dl-lock-screen');
        var loginLayer = document.getElementById('dl-login-layer');
        if (lockScreen) lockScreen.classList.remove('active');
        if (loginLayer) loginLayer.classList.add('active');

        var message = _t('desktop_login.session_expired') ||
            _t('auth.session_expired') ||
            'Session expired. Please sign in again.';

        // Toast on the right — keeps the login card height stable
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

    // ============ Wallpaper Preload ============

    var DEFAULT_LOGIN_GRADIENT = 'linear-gradient(135deg, #0d1117 0%, #161b22 40%, #1a1a2e 70%, #0f3460 100%)';

    function preloadWallpaper() {
        var saved = localStorage.getItem(WALLPAPER_STORAGE);
        var el = document.getElementById('dl-wallpaper');
        if (!el) return;

        // No saved wallpaper — use gradient immediately (no 404 probe)
        if (!saved) {
            el.style.background = DEFAULT_LOGIN_GRADIENT;
            el.classList.add('loaded');
            return;
        }

        var isSolid = saved.indexOf('solid:') === 0;
        if (isSolid) {
            el.style.background = saved.substring(6);
            el.classList.add('loaded');
            return;
        }

        var img = new Image();
        img.onload = function () {
            el.style.backgroundImage = 'url("' + saved + '")';
            el.style.backgroundSize = 'cover';
            el.style.backgroundPosition = 'center';
            el.classList.add('loaded');
        };
        img.onerror = function () {
            // Wallpaper file missing — clear stale pref, use gradient
            localStorage.removeItem(WALLPAPER_STORAGE);
            el.style.background = DEFAULT_LOGIN_GRADIENT;
            el.classList.add('loaded');
        };
        img.src = saved;
    }

    // ============ Clock ============

    function startClock() {
        updateClock();
        _clockTimer = setInterval(updateClock, 1000);
    }

    function updateClock() {
        var now = new Date();
        var timeEl = document.getElementById('dl-lock-time');
        var dateEl = document.getElementById('dl-lock-date');
        if (timeEl) {
            var h = String(now.getHours()).padStart(2, '0');
            var m = String(now.getMinutes()).padStart(2, '0');
            timeEl.textContent = h + ':' + m;
        }
        if (dateEl) {
            dateEl.textContent = now.toLocaleDateString(undefined, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        }
    }

    // ============ Lock Screen ============

    function bindLockScreen() {
        var lockScreen = document.getElementById('dl-lock-screen');
        var loginLayer = document.getElementById('dl-login-layer');
        if (!lockScreen || !loginLayer) return;

        function dismissLock() {
            lockScreen.classList.remove('active');
            loginLayer.classList.add('active');
            // Focus username input after transition
            setTimeout(function () {
                var input = document.getElementById('dl-username');
                if (input && !input.value) input.focus();
            }, 400);
        }

        lockScreen.addEventListener('click', dismissLock);
        document.addEventListener('keydown', function handler(e) {
            if (lockScreen.classList.contains('active')) {
                dismissLock();
            }
        }, { once: false });
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

        // Password toggle
        if (passwordToggle && passwordInput) {
            passwordToggle.addEventListener('click', function () {
                var isPassword = passwordInput.type === 'password';
                passwordInput.type = isPassword ? 'text' : 'password';
                passwordToggle.querySelector('.material-icons').textContent =
                    isPassword ? 'visibility_off' : 'visibility';
            });
        }

        form.addEventListener('submit', function (e) {
            e.preventDefault();

            var username = (document.getElementById('dl-username').value || '').trim();
            var password = (document.getElementById('dl-password').value || '');

            if (!username || !password) {
                showError(errorEl, errorText, _t('desktop_login.fill_all_fields') || 'Please fill in all fields');
                return;
            }

            submitBtn.classList.add('loading');
            submitBtn.disabled = true;
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
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;

                if (result.data.success && result.data.totpRequired) {
                    // Show TOTP form
                    showTotpForm();
                    return;
                }

                if (result.data.success) {
                    // Login success — redirect to dashboard
                    window.location.href = '/';
                    return;
                }

                // Error
                showError(errorEl, errorText, result.data.error || _t('desktop_login.invalid_credentials') || 'Invalid credentials');
            })
            .catch(function (err) {
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;
                showError(errorEl, errorText, _t('desktop_login.network_error') || 'Network error');
            });
        });
    }

    // ============ TOTP Form ============

    function showTotpForm() {
        var loginForm = document.getElementById('dl-login-form');
        var totpForm = document.getElementById('dl-totp-form');
        if (loginForm) loginForm.classList.add('hidden');
        if (totpForm) {
            totpForm.classList.remove('hidden');
            // Focus first digit
            var first = totpForm.querySelector('.dl-totp-digit[data-idx="0"]');
            if (first) setTimeout(function () { first.focus(); }, 100);
        }
    }

    function hideTotpForm() {
        var loginForm = document.getElementById('dl-login-form');
        var totpForm = document.getElementById('dl-totp-form');
        if (loginForm) loginForm.classList.remove('hidden');
        if (totpForm) totpForm.classList.add('hidden');
        clearTotpDigits();
    }

    function clearTotpDigits() {
        document.querySelectorAll('.dl-totp-digit').forEach(function (d) { d.value = ''; });
    }

    function getTotpCode() {
        var code = '';
        document.querySelectorAll('.dl-totp-digit').forEach(function (d) { code += d.value; });
        return code;
    }

    function bindTotpForm() {
        var form = document.getElementById('dl-totp-form');
        var submitBtn = document.getElementById('dl-totp-submit');
        var errorEl = document.getElementById('dl-totp-error');
        var errorText = document.getElementById('dl-totp-error-text');
        var backLink = document.getElementById('dl-totp-back-link');

        if (!form) return;

        var csrfToken = (window.BetterDesk && window.BetterDesk.csrfToken) || '';

        // Digit input navigation + auto-submit on 6th digit
        var digits = form.querySelectorAll('.dl-totp-digit');
        digits.forEach(function (digit, idx) {
            digit.addEventListener('input', function () {
                var val = digit.value.replace(/\D/g, '');
                digit.value = val.substring(0, 1);
                if (val && idx < 5) {
                    digits[idx + 1].focus();
                }
                // Auto-submit when all 6 digits are filled
                if (getTotpCode().length === 6) {
                    submitTotp();
                }
            });

            digit.addEventListener('keydown', function (e) {
                if (e.key === 'Backspace' && !digit.value && idx > 0) {
                    digits[idx - 1].focus();
                    digits[idx - 1].value = '';
                }
            });

            // Paste support
            digit.addEventListener('paste', function (e) {
                e.preventDefault();
                var text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
                if (text.length >= 6) {
                    for (var i = 0; i < 6; i++) {
                        digits[i].value = text[i] || '';
                    }
                    digits[5].focus();
                    if (getTotpCode().length === 6) {
                        setTimeout(submitTotp, 50);
                    }
                }
            });
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            submitTotp();
        });

        function submitTotp() {
            var code = getTotpCode();
            if (code.length !== 6) {
                showError(errorEl, errorText, _t('desktop_login.enter_6_digits') || 'Enter all 6 digits');
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
            .then(function (r) { return r.json().then(function (data) { return { status: r.status, data: data }; }); })
            .then(function (result) {
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;

                if (result.data.success) {
                    window.location.href = '/';
                    return;
                }

                // Shake animation
                showError(errorEl, errorText, result.data.error || _t('desktop_login.invalid_code') || 'Invalid code');
                errorEl.classList.add('shake');
                setTimeout(function () { errorEl.classList.remove('shake'); }, 500);
                clearTotpDigits();
                var first = document.querySelector('.dl-totp-digit[data-idx="0"]');
                if (first) first.focus();
            })
            .catch(function () {
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;
                showError(errorEl, errorText, _t('desktop_login.network_error') || 'Network error');
            });
        }

        // Back link
        if (backLink) {
            backLink.addEventListener('click', function (e) {
                e.preventDefault();
                hideTotpForm();
                hideError(errorEl);
            });
        }
    }

    // ============ Multi-user Selector ============

    function renderUserChips() {
        var container = document.getElementById('dl-users');
        if (!container) return;
        var users = (window.BetterDesk && window.BetterDesk.users) || [];
        if (!users.length) return;

        var html = '';
        users.forEach(function (user) {
            var initials = (user.username || '?').substring(0, 2).toUpperCase();
            html += '<div class="dl-user-chip" data-username="' + _esc(user.username) + '">' +
                '<div class="dl-user-chip-avatar">' + _esc(initials) + '</div>' +
                '<div class="dl-user-chip-info">' +
                '<div class="dl-user-chip-name">' + _esc(user.username) + '</div>' +
                '<div class="dl-user-chip-role">' + _esc(user.role || 'operator') + '</div>' +
                '</div></div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.dl-user-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                var username = chip.dataset.username;
                // Pre-fill username
                var input = document.getElementById('dl-username');
                if (input) {
                    input.value = username;
                    // Focus password
                    var pwd = document.getElementById('dl-password');
                    if (pwd) pwd.focus();
                }
                // Highlight selected chip
                container.querySelectorAll('.dl-user-chip').forEach(function (c) { c.classList.remove('selected'); });
                chip.classList.add('selected');

                // Update avatar with initials
                var avatarEl = document.getElementById('dl-avatar');
                if (avatarEl) {
                    var initials = (username || '?').substring(0, 2).toUpperCase();
                    avatarEl.innerHTML = '<span class="dl-avatar-initials">' + _esc(initials) + '</span>';
                }

                // Dismiss lock screen if still active
                var lock = document.getElementById('dl-lock-screen');
                var loginLayer = document.getElementById('dl-login-layer');
                if (lock && lock.classList.contains('active')) {
                    lock.classList.remove('active');
                    if (loginLayer) loginLayer.classList.add('active');
                }
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

    function showError(el, textEl, msg) {
        if (el) el.classList.remove('hidden');
        if (textEl) textEl.textContent = msg;
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
