/**
 * BetterDesk Console — UX 3.6 (beta) shell controller.
 *
 * Layered on top of ux35-shell.js, which already owns the drawer, the sidebar
 * resize handle, the theme toggle, the section collapse toggle and its
 * persistence (same element ids and classes are reused on purpose, so there is
 * exactly one implementation of each behaviour).
 *
 * This file only adds what the grouped layout needs:
 *  - first-visit default: expand the group that contains the active page and
 *    collapse the others (the redesign's "one open group" model);
 *  - keep groups open while the menu filter has a query, so matches cannot hide
 *    behind a collapsed heading;
 *  - the per-browser shell switch used by Settings.
 *
 * No new dependencies, no framework.
 */
(function () {
    'use strict';

    /* Shared with ux35-shell.js — do not introduce a second key. */
    var COLLAPSE_KEY = 'bd_ux35_sidebar_collapsed';

    function t(key, fallback) {
        return (typeof window._ === 'function' ? window._(key) : fallback) || fallback;
    }

    function readCollapsed() {
        try {
            var raw = sessionStorage.getItem(COLLAPSE_KEY);
            return raw ? (JSON.parse(raw) || {}) : null;
        } catch (e) {
            return null;
        }
    }

    function writeCollapsed(state) {
        try { sessionStorage.setItem(COLLAPSE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
    }

    function setSectionOpen(section, open) {
        section.classList.toggle('is-collapsed', !open);
        var toggle = section.querySelector('.ux35-sidebar-heading-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        var chevron = section.querySelector('.ux35-section-chevron');
        if (chevron) chevron.textContent = open ? 'expand_less' : 'expand_more';
    }

    /**
     * First visit only: the active group stays open, everything else starts
     * collapsed. Once the operator collapses or expands anything, ux35-shell.js
     * persists that choice and we leave it alone.
     */
    function initSections() {
        var nav = document.getElementById('ux35-sidebar-nav');
        if (!nav) return;

        var sections = Array.prototype.slice.call(nav.querySelectorAll('.ux36-nav-section'));
        if (!sections.length) return;

        var stored = readCollapsed();
        if (stored && Object.keys(stored).length) return;

        var state = {};
        sections.forEach(function (section) {
            var id = section.getAttribute('data-panel') || '';
            var isActive = !!section.querySelector('.ux35-sidebar-item.active');
            setSectionOpen(section, isActive);
            state[id] = !isActive;
        });
        writeCollapsed(state);
    }

    function initFilterSync() {
        var input = document.getElementById('ux35-sidebar-filter-input');
        var nav = document.getElementById('ux35-sidebar-nav');
        if (!input || !nav) return;
        input.addEventListener('input', function () {
            if (!(input.value || '').trim()) return;
            Array.prototype.forEach.call(nav.querySelectorAll('.ux36-nav-section'), function (section) {
                if (section.classList.contains('is-filter-empty')) return;
                setSectionOpen(section, true);
            });
        });
    }

    /* ── Shell switch (Settings → Console interface) ─────────────────────── */

    function setShell(shell) {
        if (shell !== 'ux35' && shell !== 'ux36') {
            return Promise.reject(new Error('unsupported shell'));
        }
        var token = window.BetterDesk && window.BetterDesk.csrfToken;
        return fetch('/api/ui-shell', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'X-CSRF-Token': token } : {}),
            },
            credentials: 'same-origin',
            body: JSON.stringify({ shell: shell }),
        }).then(function (res) {
            if (!res.ok) throw new Error('request failed');
            return res.json();
        }).then(function (body) {
            if (!body || body.success !== true) throw new Error('rejected');
            return body;
        });
    }

    function initShellChoice() {
        var group = document.querySelector('.ux36-shell-choice');
        if (!group) return;
        var current = group.getAttribute('data-current-shell') || 'ux35';

        function markActive(shell) {
            group.querySelectorAll('.ux36-shell-choice-option').forEach(function (option) {
                option.classList.toggle('is-active', option.getAttribute('data-shell-option') === shell);
            });
            group.querySelectorAll('input[name="ui-shell"]').forEach(function (radio) {
                radio.checked = radio.value === shell;
            });
        }

        group.querySelectorAll('input[name="ui-shell"]').forEach(function (input) {
            input.addEventListener('change', function () {
                if (!input.checked || input.value === current) return;
                var target = input.value;
                // Optimistic, then reload: the server is the single source of
                // truth and SSR must re-render with the chosen shell.
                markActive(target);
                setShell(target).then(function () {
                    window.location.reload();
                }).catch(function () {
                    markActive(current);
                    var message = t('ux36.switch_failed', 'Could not change the console layout. Please try again.');
                    if (window.Notifications && typeof window.Notifications.error === 'function') {
                        window.Notifications.error(message);
                    } else {
                        window.alert(message);
                    }
                });
            });
        });
    }

    function init() {
        if (window.BetterDesk && window.BetterDesk.embed) return;
        initSections();
        initFilterSync();
        initShellChoice();
    }

    window.Ux36Shell = {
        setShell: setShell,
        openSection: function (id) {
            var section = document.querySelector('.ux36-nav-section[data-panel="' + id + '"]');
            if (section) setSectionOpen(section, true);
        },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
