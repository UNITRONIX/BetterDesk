/**
 * Translations page (/languages): how complete each language file is, and
 * every text of one language next to English (opened with #<code>).
 */
(function () {
    'use strict';

    const _ = window._ || (k => k);
    const SHOW_LIMIT = 200;

    let languages = [];
    let refKeyCount = 0;

    // Open language
    let detail = null;      // { code, rows: [{ key, en, value, missing }], missingKnown }
    let detailFilter = 'all';
    let detailQuery = '';
    let detailRequest = 0;

    function fmt(n) {
        return Number(n || 0).toLocaleString(document.documentElement.lang || undefined);
    }

    function tpl(key, vars) {
        let s = _(key);
        Object.keys(vars || {}).forEach((k) => { s = s.split('{' + k + '}').join(vars[k]); });
        return s;
    }

    // Language name in the language of the console, e.g. "Deutsch" -> "German" for an English UI
    let displayNames = null;
    try { displayNames = new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'language' }); } catch (_e) { displayNames = null; }
    function langName(lang) {
        try {
            const n = displayNames && displayNames.of(lang.code);
            if (n && n !== lang.code) return n.charAt(0).toLocaleUpperCase() + n.slice(1);
        } catch (_e) { /* fall through */ }
        return lang.name || lang.code;
    }

    function escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    async function getJson(url) {
        const resp = await fetch(url, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
    }

    // ── All languages ──

    async function init() {
        document.getElementById('lang-detail-back')?.addEventListener('click', (e) => {
            e.preventDefault();
            closeDetail();
        });
        const search = document.getElementById('lang-detail-search');
        search?.addEventListener('input', () => {
            detailQuery = search.value.trim().toLowerCase();
            renderDetailRows();
        });
        document.querySelectorAll('[data-lang-filter]').forEach((btn) => {
            btn.addEventListener('click', () => {
                detailFilter = btn.getAttribute('data-lang-filter');
                document.querySelectorAll('[data-lang-filter]').forEach((b) => {
                    const on = b === btn;
                    b.classList.toggle('active', on);
                    b.setAttribute('aria-pressed', on ? 'true' : 'false');
                });
                renderDetailRows();
            });
        });
        document.getElementById('lang-tbody')?.addEventListener('click', (e) => {
            const retry = e.target.closest('[data-lang-retry]');
            if (retry) loadLanguages();
        });
        document.getElementById('lang-areas')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-lang-area]');
            if (btn) showArea(btn.getAttribute('data-lang-area'));
        });
        window.addEventListener('hashchange', applyHash);

        await loadLanguages();
        applyHash();
    }

    async function loadLanguages() {
        const tbody = document.getElementById('lang-tbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="state-cell">${escHtml(_('languages.loading'))}</td></tr>`;
        try {
            const data = await getJson('/api/panel/languages');
            languages = data.languages || [];
            refKeyCount = data.refKeyCount || 0;
            render();
        } catch (err) {
            console.error('Failed to load languages:', err);
            const stats = document.getElementById('lang-stats');
            if (stats) stats.textContent = '';
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="6" class="state-cell is-error">${escHtml(_('languages.load_error'))}
                    <button type="button" class="btn btn-sm" data-lang-retry>${escHtml(_('languages.try_again'))}</button></td></tr>`;
            }
        }
    }

    function render() {
        renderStats();
        renderGrid();
    }

    function renderStats() {
        const el = document.getElementById('lang-stats');
        if (!el) return;
        if (!languages.length) { el.textContent = ''; return; }
        const review = languages.filter(l => l.needs_review).length;
        el.innerHTML = tpl('languages.count_line', {
            total: `<strong>${fmt(languages.length)}</strong>`,
            review: `<strong>${fmt(review)}</strong>`,
            keys: `<strong>${fmt(refKeyCount)}</strong>`
        });
    }

    function statusOf(lang) {
        if (lang.error) return { cls: 'error', label: _('languages.status_error') };
        if (lang.is_reference) return { cls: 'active', label: _('languages.status_reference') };
        if (lang.missing_keys > 0) return { cls: 'warning', label: _('languages.status_incomplete') };
        if (lang.needs_review) return { cls: 'pending', label: _('languages.status_review') };
        return { cls: 'active', label: _('languages.status_complete') };
    }

    function renderGrid() {
        const tbody = document.getElementById('lang-tbody');
        if (!tbody) return;

        if (languages.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="state-cell">${escHtml(_('languages.no_languages'))}</td></tr>`;
            return;
        }

        tbody.innerHTML = languages.map((lang) => {
            const st = statusOf(lang);
            const cov = Math.max(0, Math.min(100, Number(lang.coverage) || 0));
            const subStatus = lang.needs_review && st.cls !== 'pending' && !lang.is_reference
                ? `<span class="cell-sub">${escHtml(_('languages.status_review'))}</span>` : '';
            const extra = lang.extra_keys > 0
                ? `<span class="cell-sub">${escHtml(tpl('languages.extra_count', { n: fmt(lang.extra_keys) }))}</span>` : '';
            const missing = lang.is_reference ? '–' : fmt(lang.missing_keys);
            return `
                <tr data-code="${escHtml(lang.code)}">
                    <td><a class="lang-name" href="#${encodeURIComponent(lang.code)}">${escHtml(langName(lang))}</a><span class="cell-sub">${escHtml(lang.code)}</span></td>
                    <td class="col-native"><span lang="${escHtml(lang.code)}" dir="${lang.rtl ? 'rtl' : 'ltr'}">${escHtml(lang.native)}</span>${lang.rtl ? `<span class="cell-sub">${escHtml(_('languages.rtl'))}</span>` : ''}</td>
                    <td class="col-coverage">
                        <div class="meter${cov < 100 ? ' is-high' : ''}">
                            <span class="meter-bar" aria-hidden="true"><span class="meter-fill" style="width:${cov}%"></span></span>
                            <span class="meter-value">${cov} %</span>
                        </div>
                    </td>
                    <td><span class="status ${st.cls}">${escHtml(st.label)}</span>${subStatus}</td>
                    <td class="col-num col-missing">${missing}${extra}</td>
                    <td class="actions">
                        <a class="btn btn-sm" href="#${encodeURIComponent(lang.code)}"
                           aria-label="${escHtml(tpl('languages.show_texts_for', { language: langName(lang) }))}">${escHtml(_('languages.show_texts'))}</a>
                    </td>
                </tr>`;
        }).join('');
    }

    // ── One language ──

    function applyHash() {
        const code = decodeURIComponent((location.hash || '').replace(/^#/, ''));
        if (code && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(code)) {
            openDetail(code);
        } else {
            showList();
        }
    }

    function showList() {
        const list = document.getElementById('lang-grid');
        const det = document.getElementById('lang-detail-overlay');
        const wasOpen = det && !det.hidden;
        if (det) det.hidden = true;
        if (list) list.hidden = false;
        if (wasOpen && detail) {
            // The button, or on phones (where it is hidden) the language name
            const row = document.querySelector(`#lang-tbody tr[data-code="${CSS.escape(detail.code)}"]`);
            const target = [row?.querySelector('.btn'), row?.querySelector('.lang-name')].find(el => el && el.offsetParent !== null);
            target?.focus();
        }
    }

    function flatten(obj, prefix, out) {
        Object.keys(obj || {}).forEach((k) => {
            const v = obj[k];
            const key = prefix ? prefix + '.' + k : k;
            if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
            else out.set(key, v == null ? '' : String(v));
        });
        return out;
    }

    async function openDetail(code) {
        const list = document.getElementById('lang-grid');
        const det = document.getElementById('lang-detail-overlay');
        const content = document.getElementById('lang-detail-content');
        const title = document.getElementById('lang-detail-title');
        const note = document.getElementById('lang-detail-note');
        const count = document.getElementById('lang-detail-count');
        if (!det || !content) return;

        const lang = languages.find(l => l.code === code) || { code, name: code, rtl: false, is_reference: false };
        // A different language starts with an empty search and all texts
        if (!detail || detail.code !== code) {
            detailQuery = '';
            detailFilter = 'all';
            const search = document.getElementById('lang-detail-search');
            if (search) search.value = '';
            document.querySelectorAll('[data-lang-filter]').forEach((b) => {
                const on = b.getAttribute('data-lang-filter') === 'all';
                b.classList.toggle('active', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
        }
        if (list) list.hidden = true;
        det.hidden = false;
        const name = langName(lang);
        if (title) title.textContent = `${name} (${code})`;
        if (note) note.textContent = tpl('languages.detail_note', { language: name, file: `lang/${code}.json` });
        if (count) count.textContent = '';
        content.innerHTML = `<p class="state">${escHtml(_('languages.detail_loading'))}</p>`;
        renderSummary(lang);
        renderAreas(null);
        title?.focus();

        const req = ++detailRequest;
        try {
            const [en, own, missing] = await Promise.all([
                getJson('/api/i18n/translations/en'),
                code === 'en' ? Promise.resolve(null) : getJson('/api/i18n/translations/' + encodeURIComponent(code)),
                code === 'en' ? Promise.resolve({ missing: [] }) : getJson('/api/panel/languages/' + encodeURIComponent(code) + '/missing').catch(() => null)
            ]);
            if (req !== detailRequest) return;

            const enMap = flatten(en.data || {}, '', new Map());
            const ownMap = own ? flatten(own.data || {}, '', new Map()) : enMap;
            const missingSet = new Set(((missing && missing.missing) || []).map(m => m.key));
            const rows = [];
            enMap.forEach((enValue, key) => {
                if (key === 'meta' || key.startsWith('meta.') || key.startsWith('_meta')) return;
                const isMissing = missingSet.has(key);
                rows.push({ key, en: enValue, value: isMissing ? '' : (ownMap.get(key) ?? ''), missing: isMissing });
            });
            (missing && missing.missing || []).forEach((m) => {
                if (!enMap.has(m.key)) rows.push({ key: m.key, en: m.en_value || '', value: '', missing: true });
            });
            detail = { code, lang, rows, missingKnown: !!missing };
            renderDetailRows();
            renderAreas(detail);
        } catch (err) {
            if (req !== detailRequest) return;
            console.error('Failed to load texts:', err);
            detail = null;
            content.innerHTML = `<p class="state is-error">${escHtml(_('languages.detail_error'))}
                <button type="button" class="btn btn-sm" id="lang-detail-retry">${escHtml(_('languages.try_again'))}</button></p>`;
            document.getElementById('lang-detail-retry')?.addEventListener('click', () => openDetail(code));
        }
    }

    function renderDetailRows() {
        const content = document.getElementById('lang-detail-content');
        const count = document.getElementById('lang-detail-count');
        if (!content || !detail) return;

        const q = detailQuery;
        const rows = detail.rows.filter((r) => {
            if (detailFilter === 'missing' && !r.missing) return false;
            if (!q) return true;
            return r.key.toLowerCase().includes(q) || r.en.toLowerCase().includes(q) || r.value.toLowerCase().includes(q);
        });
        const shown = rows.slice(0, SHOW_LIMIT);

        let line;
        if (!q && detailFilter === 'all') line = tpl('languages.detail_total', { n: `<strong>${fmt(rows.length)}</strong>` });
        else line = tpl('languages.detail_matches', { n: `<strong>${fmt(rows.length)}</strong>` });
        if (rows.length > SHOW_LIMIT) line += ' ' + escHtml(tpl('languages.detail_limit', { n: fmt(SHOW_LIMIT) }));
        if (!detail.missingKnown) line += ' ' + escHtml(_('languages.missing_unknown'));
        if (count) count.innerHTML = line;

        if (!rows.length) {
            const msg = detailFilter === 'missing' && !q ? _('languages.none_missing') : _('languages.no_match');
            content.innerHTML = `<p class="state">${escHtml(msg)}</p>`;
            return;
        }

        const isEn = detail.code === 'en';
        const dir = detail.lang.rtl ? 'rtl' : 'ltr';
        content.innerHTML = `
            <div class="table-scroll">
                <table class="data-table lang-texts-table${isEn ? ' is-single' : ''}">
                    <thead><tr>
                        <th scope="col" class="col-key">${escHtml(_('languages.col_key'))}</th>
                        <th scope="col">${escHtml(_('languages.col_english'))}</th>
                        ${isEn ? '' : `<th scope="col">${escHtml(langName(detail.lang))}</th>`}
                    </tr></thead>
                    <tbody>
                        ${shown.map(r => `
                            <tr>
                                <td class="col-key"><code>${escHtml(r.key)}</code></td>
                                <td lang="en" dir="ltr">${escHtml(r.en)}</td>
                                ${isEn ? '' : (r.missing
                                    ? `<td><span class="status warning">${escHtml(_('languages.missing_text'))}</span></td>`
                                    : `<td lang="${escHtml(detail.code)}" dir="${dir}">${escHtml(r.value)}</td>`)}
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    // ── Side column: how complete this language is, and where texts are missing ──

    function renderSummary(lang) {
        const el = document.getElementById('lang-summary');
        if (!el) return;
        const st = statusOf(lang);
        const total = refKeyCount || lang.total_keys || 0;
        const missingN = Number(lang.missing_keys) || 0;
        const cov = Math.max(0, Math.min(100, Number(lang.coverage) || 0));
        const rows = [];
        rows.push([_('languages.col_status'), `<span class="status ${st.cls}">${escHtml(st.label)}</span>`]);
        if (!lang.is_reference && lang.coverage != null) {
            rows.push([_('languages.col_coverage'), `
                <div class="meter${cov < 100 ? ' is-high' : ''}">
                    <span class="meter-bar" aria-hidden="true"><span class="meter-fill" style="width:${cov}%"></span></span>
                    <span class="meter-value">${cov} %</span>
                </div>
                <span class="cell-sub">${escHtml(tpl('languages.summary_translated', { done: fmt(Math.max(0, total - missingN)), total: fmt(total) }))}</span>`]);
            rows.push([_('languages.col_missing'), escHtml(fmt(missingN))
                + (lang.extra_keys > 0 ? `<span class="cell-sub">${escHtml(tpl('languages.extra_count', { n: fmt(lang.extra_keys) }))}</span>` : '')]);
            if (lang.empty_keys > 0) rows.push([_('languages.summary_empty'), escHtml(fmt(lang.empty_keys))]);
        }
        rows.push([_('languages.summary_direction'), escHtml(lang.rtl ? _('languages.rtl') : _('languages.ltr'))]);
        rows.push([_('languages.summary_file'), `<code>lang/${escHtml(lang.code)}.json</code>`]);
        el.innerHTML = rows.map(([k, v]) => `<dt>${escHtml(k)}</dt><dd>${v}</dd>`).join('');
    }

    // Missing texts grouped by the first part of their key ("settings", "devices", …)
    function renderAreas(d) {
        const section = document.getElementById('lang-areas-section');
        const el = document.getElementById('lang-areas');
        if (!section || !el) return;
        const lang = d ? d.lang : null;
        if (d && (lang.is_reference || d.code === 'en')) { section.hidden = true; return; }
        section.hidden = false;
        if (!d) { el.innerHTML = `<p class="state">${escHtml(_('languages.detail_loading'))}</p>`; return; }
        if (!d.missingKnown) { el.innerHTML = `<p class="state">${escHtml(_('languages.missing_unknown'))}</p>`; return; }
        const counts = new Map();
        d.rows.forEach((r) => {
            if (!r.missing) return;
            const area = r.key.split('.')[0];
            counts.set(area, (counts.get(area) || 0) + 1);
        });
        if (!counts.size) { el.innerHTML = `<p class="state">${escHtml(_('languages.none_missing'))}</p>`; return; }
        const areas = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        el.innerHTML = `<ul class="list lang-areas">${areas.map(([area, n]) => `
            <li class="list-row">
                <span class="row-main"><span class="row-title">${escHtml(area)}</span>
                    <span class="row-sub">${escHtml(tpl('languages.area_count', { n: fmt(n) }))}</span></span>
                <span class="row-end"><button type="button" class="btn btn-sm" data-lang-area="${escHtml(area)}"
                    aria-label="${escHtml(tpl('languages.area_show', { area }))}">${escHtml(_('languages.show_texts'))}</button></span>
            </li>`).join('')}</ul>`;
    }

    function showArea(area) {
        const search = document.getElementById('lang-detail-search');
        if (search) search.value = area + '.';
        detailQuery = (area + '.').toLowerCase();
        detailFilter = 'missing';
        document.querySelectorAll('[data-lang-filter]').forEach((b) => {
            const on = b.getAttribute('data-lang-filter') === 'missing';
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        renderDetailRows();
    }

    // Kept for old callers: open the language view
    function viewMissing(code) {
        location.hash = '#' + encodeURIComponent(code);
    }

    function closeDetail() {
        if (location.hash) {
            history.pushState('', document.title, location.pathname + location.search);
        }
        showList();
    }

    window.Languages = { init, viewMissing, closeDetail };

    document.addEventListener('DOMContentLoaded', init);
})();
