/**
 * BetterDesk Console — UX 3.6 (beta) shell controller.
 *
 * Layered on top of ux35-shell.js, which already owns the drawer, the sidebar
 * resize handle, the theme toggle, the section collapse toggle, the menu
 * filter and its persistence (same element ids and classes are reused on
 * purpose, so there is exactly one implementation of each behaviour).
 *
 * This file only adds what the grouped layout needs:
 *  - first-visit default: expand the group that contains the active page and
 *    collapse the others (the redesign's "one open group" model);
 *  - the per-section "More" row, remembered per browser;
 *  - keep groups open while the menu filter has a query, so matches cannot
 *    hide behind a collapsed heading.
 *
 * The shell switch itself lives in ui-shell.js, because the toggle is rendered
 * in both shells.
 */
(function () {
    'use strict';

    /* Shared with ux35-shell.js — do not introduce a second key. */
    var COLLAPSE_KEY = 'bd_ux35_sidebar_collapsed';
    /* "More" rows are a beta affordance; UX 3.5 has no such row. */
    var MORE_KEY = 'bd_ux36_nav_more_open';

    function readJson(storage, key) {
        try {
            var raw = storage.getItem(key);
            return raw ? (JSON.parse(raw) || {}) : null;
        } catch (e) {
            return null;
        }
    }

    function writeJson(storage, key, value) {
        try { storage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked */ }
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

        var stored = readJson(sessionStorage, COLLAPSE_KEY);
        if (stored && Object.keys(stored).length) return;

        var state = {};
        sections.forEach(function (section) {
            var id = section.getAttribute('data-panel') || '';
            var isActive = !!section.querySelector('.ux35-sidebar-item.active');
            setSectionOpen(section, isActive);
            state[id] = !isActive;
        });
        writeJson(sessionStorage, COLLAPSE_KEY, state);
    }

    /** "More" rows: one row per section, state kept in this browser. */
    function initMoreRows() {
        var nav = document.getElementById('ux35-sidebar-nav');
        if (!nav) return;

        var rows = Array.prototype.slice.call(nav.querySelectorAll('.nav-more'));
        if (!rows.length) return;

        var state = readJson(localStorage, MORE_KEY) || {};
        var moreLabel = nav.getAttribute('data-more-label') || '';
        var fewerLabel = nav.getAttribute('data-fewer-label') || '';

        function setOpen(row, open) {
            var list = row.querySelector('.nav-more-list');
            var button = row.querySelector('.nav-more-toggle');
            if (!list || !button) return;
            list.hidden = !open;
            button.setAttribute('aria-expanded', open ? 'true' : 'false');
            var label = button.querySelector('.nav-label');
            var next = open ? fewerLabel : moreLabel;
            if (label && next) label.textContent = next;
            var chevron = button.querySelector('.nav-more-chevron');
            if (chevron) chevron.textContent = open ? 'expand_less' : 'expand_more';
        }

        rows.forEach(function (row) {
            var id = row.getAttribute('data-more') || '';
            var button = row.querySelector('.nav-more-toggle');
            if (!button) return;

            // The partial already opened the row that holds the active page.
            var open = button.getAttribute('aria-expanded') === 'true';
            if (id && Object.prototype.hasOwnProperty.call(state, id)) open = !!state[id];
            setOpen(row, open);

            button.addEventListener('click', function () {
                var next = button.getAttribute('aria-expanded') !== 'true';
                setOpen(row, next);
                if (!id) return;
                if (next) state[id] = true;
                else delete state[id];
                writeJson(localStorage, MORE_KEY, state);
            });
        });
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
            // Every match must be reachable: open the "More" rows as well.
            Array.prototype.forEach.call(nav.querySelectorAll('.nav-more'), function (row) {
                var list = row.querySelector('.nav-more-list');
                var button = row.querySelector('.nav-more-toggle');
                if (!list || !button) return;
                if (row.classList.contains('is-filter-empty')) return;
                if (list.hidden) {
                    list.hidden = false;
                    button.setAttribute('aria-expanded', 'true');
                }
            });
        });
    }

    function init() {
        if (window.BetterDesk && window.BetterDesk.embed) return;
        initSections();
        initMoreRows();
        initFilterSync();
    }

    window.Ux36Shell = {
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
