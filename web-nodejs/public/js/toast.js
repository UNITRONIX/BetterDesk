/**
 * BetterDesk Console — Toast Notification System (Phase 13)
 * Animated toast notifications with auto-dismiss and progress bar.
 *
 * Usage:
 *   Toast.success('Device connected');
 *   Toast.error('Connection failed', 'Check network settings');
 *   Toast.warning('Session expiring', 'Less than 5 minutes remaining');
 *   Toast.info('Update available', 'Version 3.0.1 is ready');
 */

(function () {
    'use strict';

    var CONTAINER_ID = 'toast-container';
    var DEFAULT_DURATION = 5000; // ms
    var MAX_TOASTS = 5;

    function _getContainer() {
        var el = document.getElementById(CONTAINER_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = CONTAINER_ID;
            el.className = 'toast-container';
            document.body.appendChild(el);
        }
        return el;
    }

    function _t(key, fallback) {
        return (typeof window._ === 'function' ? window._(key) : fallback) || fallback;
    }

    var iconMap = {
        success: 'check_circle',
        error: 'error',
        warning: 'warning',
        info: 'info'
    };

    /**
     * Show a toast notification.
     * @param {'success'|'error'|'warning'|'info'} type
     * @param {string} title
     * @param {string} [message]
     * @param {number} [duration] - Auto-dismiss in ms (0 = no auto-dismiss)
     */
    function show(type, title, message, duration) {
        var container = _getContainer();
        duration = typeof duration === 'number' ? duration : DEFAULT_DURATION;

        // Limit max toasts
        while (container.children.length >= MAX_TOASTS) {
            var oldest = container.firstChild;
            if (oldest) oldest.remove();
        }

        var toast = document.createElement('div');
        toast.className = 'toast toast-' + type;

        var html =
            '<span class="material-icons toast-icon" aria-hidden="true">' + (iconMap[type] || 'info') + '</span>' +
            '<div class="toast-body">' +
                '<div class="toast-title">' + _escapeHtml(title) + '</div>' +
                (message ? '<div class="toast-message">' + _escapeHtml(message) + '</div>' : '') +
            '</div>' +
            '<button class="toast-close" aria-label="Close">&times;</button>';

        if (duration > 0) {
            html += '<div class="toast-progress" style="--toast-duration:' + duration + 'ms"></div>';
        }

        toast.innerHTML = html;

        // Close button
        toast.querySelector('.toast-close').addEventListener('click', function () {
            _dismiss(toast);
        });

        container.appendChild(toast);

        // Auto-dismiss
        if (duration > 0) {
            toast._dismissTimer = setTimeout(function () {
                _dismiss(toast);
            }, duration);
        }

        // Pause auto-dismiss on hover
        toast.addEventListener('mouseenter', function () {
            if (toast._dismissTimer) {
                clearTimeout(toast._dismissTimer);
                var progress = toast.querySelector('.toast-progress');
                if (progress) progress.style.animationPlayState = 'paused';
            }
        });

        toast.addEventListener('mouseleave', function () {
            if (duration > 0) {
                var progress = toast.querySelector('.toast-progress');
                if (progress) progress.style.animationPlayState = 'running';
                toast._dismissTimer = setTimeout(function () {
                    _dismiss(toast);
                }, 2000); // Resume with 2s
            }
        });

        return toast;
    }

    function _dismiss(toast) {
        if (toast._dismissed) return;
        toast._dismissed = true;
        clearTimeout(toast._dismissTimer);
        toast.classList.add('toast-leaving');
        toast.addEventListener('animationend', function () {
            toast.remove();
        }, { once: true });
        // Fallback removal
        setTimeout(function () { toast.remove(); }, 300);
    }

    function _escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    // ============ Public API ============

    window.Toast = {
        show: show,
        success: function (title, message, duration) { return show('success', title, message, duration); },
        error: function (title, message, duration) { return show('error', title, message, duration || 8000); },
        warning: function (title, message, duration) { return show('warning', title, message, duration || 6000); },
        info: function (title, message, duration) { return show('info', title, message, duration); }
    };
})();
