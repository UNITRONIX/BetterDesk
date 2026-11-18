/**
 * BetterDesk Console — global search (Ctrl+K / "/").
 *
 * One field for pages, devices and people. Modelled on the redesign by
 * @rathlinus (issue #493 / PR #495), rebuilt on this console:
 *
 *  - pages come from the navigation the server rendered for this user
 *    (`window.BetterDesk.searchPages`, built in lib/consoleNav.js and filtered
 *    by panel access + RBAC, so the index never lists a page the role cannot
 *    open);
 *  - devices and people load on first use from the APIs the session may call,
 *    and are cached for a minute.
 *
 * Every word typed must match somewhere. Arrow keys move, Enter opens, Escape
 * closes and returns focus to whatever opened the dialog.
 */
(function () {
    'use strict';

    var t = function (key, fallback) {
        if (typeof window._ === 'function') {
            var v = window._(key);
            if (v && v !== key) return v;
        }
        return fallback;
    };
    var caps = (window.BetterDesk && window.BetterDesk.searchCaps) || {};
    var can = function (scope) {
        // The server renders which searches this session may run, so the dialog
        // never calls an API the role cannot use (and never probes for one).
        return caps[scope] === true;
    };
    var norm = function (s) {
        return String(s == null ? '' : s).toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    };

    var overlay = null;
    var input = null;
    var list = null;
    var status = null;
    var opener = null;
    var results = [];
    var active = -1;
    var cache = { devices: null, users: null, at: 0 };

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    }

    function fill(template, values) {
        return String(template).replace(/\{(\w+)\}/g, function (m, k) {
            return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : m;
        });
    }

    function api(path) {
        if (window.Utils && typeof Utils.api === 'function') return Utils.api(path);
        return fetch(path, { credentials: 'same-origin' }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        });
    }

    /* Reads one list out of the several shapes these endpoints use. */
    function listOf(payload, key) {
        if (!payload) return [];
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload[key])) return payload[key];
        if (payload.data) {
            if (Array.isArray(payload.data)) return payload.data;
            if (Array.isArray(payload.data[key])) return payload.data[key];
        }
        return [];
    }

    function loadData() {
        if (cache.at && Date.now() - cache.at < 60000) return Promise.resolve();
        cache.at = Date.now();
        var jobs = [];
        if (can('devices')) {
            jobs.push(api('/api/devices').then(function (d) {
                cache.devices = listOf(d, 'devices');
            }).catch(function () { cache.devices = null; }));
        }
        if (can('users')) {
            jobs.push(api('/api/users').then(function (d) {
                cache.users = listOf(d, 'users');
            }).catch(function () { cache.users = null; }));
        }
        return Promise.all(jobs);
    }

    function matches(hay, words) {
        var h = norm(hay);
        return words.every(function (w) { return h.indexOf(w) !== -1; });
    }

    function search(q) {
        var words = norm(q).split(/\s+/).filter(Boolean);
        if (!words.length) return [];
        var out = [];

        var pages = (window.BetterDesk && window.BetterDesk.searchPages) || [];
        pages.filter(function (p) {
            return matches([p.text, p.section, p.group, p.keywords].join(' '), words);
        }).sort(function (a, b) {
            var aStarts = norm(a.text).indexOf(words[0]) === 0 ? 1 : 0;
            var bStarts = norm(b.text).indexOf(words[0]) === 0 ? 1 : 0;
            return bStarts - aStarts;
        }).slice(0, 6).forEach(function (p) {
            out.push({
                kind: 'page',
                title: p.text,
                sub: [p.section, p.group].filter(Boolean).join(' › '),
                href: p.href,
                external: p.external,
            });
        });

        (cache.devices || []).filter(function (d) {
            var tags = Array.isArray(d.tags) ? d.tags.join(' ') : (d.tags || '');
            return matches([d.id, d.hostname, d.display_name, d.alias, d.username, d.user,
                d.platform, d.os, tags, d.note].join(' '), words);
        }).slice(0, 8).forEach(function (d) {
            var state = d.banned
                ? t('status.banned', 'Banned')
                : (d.online ? t('status.online', 'Online') : t('status.offline', 'Offline'));
            out.push({
                kind: 'device',
                title: d.display_name || d.hostname || d.id,
                sub: [d.id, d.platform || d.os, state].filter(Boolean).join(' · '),
                href: '/devices?search=' + encodeURIComponent(d.id) + '&open=' + encodeURIComponent(d.id),
            });
        });

        (cache.users || []).filter(function (u) {
            return matches([u.username, u.email, u.role].join(' '), words);
        }).slice(0, 5).forEach(function (u) {
            out.push({
                kind: 'user',
                title: u.username,
                sub: [u.email, u.role].filter(Boolean).join(' · '),
                href: '/users?search=' + encodeURIComponent(u.username),
            });
        });

        return out;
    }

    var GROUP = {
        page: function () { return t('search.group_pages', 'Pages'); },
        device: function () { return t('search.group_devices', 'Devices'); },
        user: function () { return t('search.group_people', 'People'); },
    };
    var ICON = { page: 'arrow_forward', device: 'desktop_windows', user: 'person' };

    function render() {
        list.textContent = '';
        var q = input.value.trim();
        results = search(q);
        active = results.length ? 0 : -1;
        var group = '';
        results.forEach(function (r, i) {
            if (r.kind !== group) {
                group = r.kind;
                var heading = el('li', 'search-group', GROUP[r.kind]());
                heading.setAttribute('role', 'presentation');
                list.appendChild(heading);
            }
            var li = el('li', 'search-result');
            li.id = 'gs-opt-' + i;
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', i === active ? 'true' : 'false');
            var ic = el('span', 'material-icons', ICON[r.kind]);
            ic.setAttribute('aria-hidden', 'true');
            li.appendChild(ic);
            var main = el('span', 'search-result-main');
            main.appendChild(el('span', 'search-result-title', r.title));
            if (r.sub) main.appendChild(el('span', 'search-result-sub', r.sub));
            li.appendChild(main);
            li.addEventListener('mousemove', function () { setActive(i); });
            li.addEventListener('click', function () { go(i); });
            list.appendChild(li);
        });
        input.setAttribute('aria-activedescendant', active >= 0 ? 'gs-opt-' + active : '');
        if (!q) status.textContent = t('search.hint', 'Type a page, a device ID or name, or a person.');
        else if (!results.length) status.textContent = t('search.no_results', 'Nothing found. Try fewer or other words.');
        else status.textContent = fill(t('search.count', '{count} results'), { count: results.length });
    }

    function setActive(i) {
        if (i === active || i < 0 || i >= results.length) return;
        var prev = list.querySelector('[aria-selected="true"]');
        if (prev) prev.setAttribute('aria-selected', 'false');
        active = i;
        var cur = document.getElementById('gs-opt-' + i);
        if (cur) {
            cur.setAttribute('aria-selected', 'true');
            if (typeof cur.scrollIntoView === 'function') cur.scrollIntoView({ block: 'nearest' });
        }
        input.setAttribute('aria-activedescendant', 'gs-opt-' + i);
    }

    function go(i) {
        var r = results[i];
        if (!r) return;
        close(false);
        if (r.external) window.open(r.href, '_blank', 'noopener');
        else window.location.href = r.href;
    }

    function build() {
        overlay = el('div', 'search-overlay');
        overlay.hidden = true;
        var dialog = el('div', 'search-dialog');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', t('search.title', 'Search'));

        var row = el('div', 'search-field');
        var ic = el('span', 'material-icons', 'search');
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

        dialog.appendChild(el('p', 'search-keys',
            t('search.keys', 'Arrow keys to move, Enter to open, Esc to close.')));
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        overlay.addEventListener('mousedown', function (e) {
            if (e.target === overlay) close(true);
        });
        input.addEventListener('input', render);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive(Math.min(results.length - 1, active + 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive(Math.max(0, active - 1));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                go(active);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                close(true);
            } else if (e.key === 'Tab') {
                e.preventDefault();
            }
        });
    }

    function open(from) {
        if (!overlay) build();
        if (!overlay.hidden) return;
        opener = from || document.activeElement;
        overlay.hidden = false;
        document.documentElement.classList.add('search-open');
        input.value = '';
        render();
        input.focus();
        loadData().then(function () {
            if (!overlay.hidden) render();
        });
    }

    function close(returnFocus) {
        if (!overlay || overlay.hidden) return;
        overlay.hidden = true;
        document.documentElement.classList.remove('search-open');
        if (returnFocus && opener && document.contains(opener)) opener.focus();
    }

    document.addEventListener('keydown', function (e) {
        var target = e.target;
        var typing = target && target.closest
            && target.closest('input, textarea, select, [contenteditable="true"]');
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            open(document.activeElement);
        } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            open(document.activeElement);
        }
    });

    document.addEventListener('click', function (e) {
        var trigger = e.target.closest && e.target.closest('[data-global-search]');
        if (trigger) {
            e.preventDefault();
            open(trigger);
        }
    });

    window.UiSearch = { open: open, close: close };
})();
