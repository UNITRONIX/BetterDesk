/**
 * Global search: one field for pages, devices and people.
 *
 * Opened from the top bar field, with Ctrl+K / Cmd+K, or with "/" when no
 * input has focus. Pages come from the navigation the server rendered for
 * this user (window.BetterDesk.searchPages, so only pages they may open),
 * including earlier names ("Keys", "DataGuard"). Devices and people are
 * loaded on first use from the APIs the user may call, and kept for a
 * minute. Every word typed must match somewhere. Arrow keys move, Enter
 * opens, Escape closes and returns focus.
 */
(function () {
    'use strict';

    const t = (key, fallback) => {
        if (typeof window._ === 'function') {
            const v = window._(key);
            if (v && v !== key) return v;
        }
        return fallback;
    };
    const can = (p) => !(window.Utils && Utils.can) || Utils.can(p);
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

    let overlay = null;
    let input = null;
    let list = null;
    let status = null;
    let opener = null;
    let results = [];
    let active = -1;
    const cache = { devices: null, users: null, at: 0 };

    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    async function loadData() {
        if (cache.at && Date.now() - cache.at < 60000) return;
        cache.at = Date.now();
        const jobs = [];
        if (can('device.view')) {
            jobs.push(Utils.api('/api/devices').then((d) => {
                cache.devices = (d && (d.devices || d)) || [];
            }).catch(() => { cache.devices = null; }));
        }
        if (can('user.view')) {
            jobs.push(Utils.api('/api/users').then((d) => {
                cache.users = (d && (d.users || d)) || [];
            }).catch(() => { cache.users = null; }));
        }
        await Promise.all(jobs);
    }

    function matches(hay, words) {
        const h = norm(hay);
        return words.every((w) => h.includes(w));
    }

    function search(q) {
        const words = norm(q).split(/\s+/).filter(Boolean);
        if (!words.length) return [];
        const out = [];
        const pages = (window.BetterDesk && window.BetterDesk.searchPages) || [];
        pages.filter((p) => matches([p.text, p.section, p.group, p.keywords].join(' '), words))
            .sort((a, b) => (norm(b.text).startsWith(words[0]) ? 1 : 0) - (norm(a.text).startsWith(words[0]) ? 1 : 0))
            .slice(0, 6)
            .forEach((p) => out.push({ kind: 'page', title: p.text, sub: [p.section, p.group].filter(Boolean).join(' › '), href: p.href, external: p.external }));
        (cache.devices || []).filter((d) => {
            const tags = Array.isArray(d.tags) ? d.tags.join(' ') : (d.tags || '');
            return matches([d.id, d.hostname, d.display_name, d.alias, d.username, d.user, d.platform, d.os, tags, d.note].join(' '), words);
        }).slice(0, 8).forEach((d) => {
            const state = d.banned ? t('status.banned', 'Banned') : (d.online ? t('status.online', 'Online') : t('status.offline', 'Offline'));
            out.push({
                kind: 'device', title: d.display_name || d.hostname || d.id, id: d.id,
                sub: [d.id, d.platform || d.os, state].filter(Boolean).join(' · '),
                href: '/devices?search=' + encodeURIComponent(d.id) + '&open=' + encodeURIComponent(d.id),
            });
        });
        (cache.users || []).filter((u) => matches([u.username, u.email, u.role].join(' '), words))
            .slice(0, 5)
            .forEach((u) => out.push({ kind: 'user', title: u.username, sub: [u.email, u.role].filter(Boolean).join(' · '), href: '/users?search=' + encodeURIComponent(u.username) }));
        return out;
    }

    const GROUP = {
        page: () => t('search.group_pages', 'Pages'),
        device: () => t('search.group_devices', 'Devices'),
        user: () => t('search.group_people', 'People'),
    };
    const ICON = { page: 'arrow_forward', device: 'desktop_windows', user: 'person' };

    function render() {
        list.textContent = '';
        const q = input.value.trim();
        results = search(q);
        active = results.length ? 0 : -1;
        let group = '';
        results.forEach((r, i) => {
            if (r.kind !== group) {
                group = r.kind;
                const h = el('li', 'search-group', GROUP[r.kind]());
                h.setAttribute('role', 'presentation');
                list.appendChild(h);
            }
            const li = el('li', 'search-result');
            li.id = 'gs-opt-' + i;
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', i === active ? 'true' : 'false');
            const ic = el('span', 'material-icons', ICON[r.kind]);
            ic.setAttribute('aria-hidden', 'true');
            li.appendChild(ic);
            const main = el('span', 'search-result-main');
            main.appendChild(el('span', 'search-result-title', r.title));
            if (r.sub) main.appendChild(el('span', 'search-result-sub' + (r.kind === 'device' ? ' is-mono-lead' : ''), r.sub));
            li.appendChild(main);
            li.addEventListener('mousemove', () => setActive(i));
            li.addEventListener('click', () => go(i));
            list.appendChild(li);
        });
        input.setAttribute('aria-activedescendant', active >= 0 ? 'gs-opt-' + active : '');
        if (!q) status.textContent = t('search.hint', 'Type a page, a device ID or name, or a person.');
        else if (!results.length) status.textContent = t('search.no_results', 'Nothing found. Try fewer or other words.');
        else status.textContent = fill(t('search.count', '{count} results'), { count: results.length });
    }

    function fill(s, v) { return String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)); }

    function setActive(i) {
        if (i === active || i < 0 || i >= results.length) return;
        const prev = list.querySelector('[aria-selected="true"]');
        if (prev) prev.setAttribute('aria-selected', 'false');
        active = i;
        const cur = document.getElementById('gs-opt-' + i);
        if (cur) {
            cur.setAttribute('aria-selected', 'true');
            cur.scrollIntoView({ block: 'nearest' });
        }
        input.setAttribute('aria-activedescendant', 'gs-opt-' + i);
    }

    function go(i) {
        const r = results[i];
        if (!r) return;
        close(false);
        if (r.external) window.open(r.href, '_blank', 'noopener');
        else window.location.href = r.href;
    }

    function build() {
        overlay = el('div', 'search-overlay');
        overlay.hidden = true;
        const dialog = el('div', 'search-dialog');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', t('search.title', 'Search'));
        const row = el('div', 'search-field search-wrapper');
        const ic = el('span', 'material-icons', 'search');
        ic.setAttribute('aria-hidden', 'true');
        input = el('input', 'form-input');
        input.type = 'text';
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-expanded', 'true');
        input.setAttribute('aria-controls', 'gs-results');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-label', t('search.title', 'Search'));
        input.placeholder = t('search.placeholder', 'Search pages, devices and people');
        input.autocomplete = 'off';
        input.spellcheck = false;
        row.appendChild(ic);
        row.appendChild(input);
        dialog.appendChild(row);
        list = el('ul', 'search-results');
        list.id = 'gs-results';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', t('search.results', 'Results'));
        dialog.appendChild(list);
        status = el('p', 'search-status');
        status.setAttribute('aria-live', 'polite');
        dialog.appendChild(status);
        const keys = el('p', 'search-keys', t('search.keys', 'Arrow keys to move, Enter to open, Esc to close.'));
        dialog.appendChild(keys);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(true); });
        input.addEventListener('input', render);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(results.length - 1, active + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); go(active); }
            else if (e.key === 'Escape') { e.preventDefault(); close(true); }
            else if (e.key === 'Tab') { e.preventDefault(); }
        });
    }

    async function open(from) {
        if (!overlay) build();
        if (!overlay.hidden) return;
        opener = from || document.activeElement;
        overlay.hidden = false;
        document.documentElement.classList.add('search-open');
        input.value = '';
        render();
        input.focus();
        await loadData();
        if (!overlay.hidden) render();
    }

    function close(returnFocus) {
        if (!overlay || overlay.hidden) return;
        overlay.hidden = true;
        document.documentElement.classList.remove('search-open');
        if (returnFocus && opener && document.contains(opener)) opener.focus();
    }

    document.addEventListener('keydown', (e) => {
        const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            open(document.activeElement);
        } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            open(document.activeElement);
        }
    });
    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('[data-global-search]');
        if (trigger) { e.preventDefault(); open(trigger); }
    });

    window.UiSearch = { open, close };
})();
