/**
 * Reports page: trends over the last 14 days.
 * Fills #reports-trends with two column charts (UiChart):
 *   - remote sessions per day, with the average length in the summary
 *   - help requests opened and resolved per day
 * Data: GET /api/reports/trends (raw timestamps, bucketed here by local day).
 */
(function () {
    'use strict';

    const DAYS = 14;

    function lang() {
        return (window.BetterDesk && window.BetterDesk.lang) || document.documentElement.lang || 'en';
    }

    function fill(template, values) {
        return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
    }

    function dayKey(ms) {
        const d = new Date(ms);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function lastDays(n) {
        const out = [];
        const today = new Date();
        today.setHours(12, 0, 0, 0);
        for (let i = n - 1; i >= 0; i--) out.push(new Date(today.getTime() - i * 86400000));
        return out;
    }

    function block(parent, headingText, id) {
        const sec = document.createElement('section');
        sec.className = 'section trends-block';
        sec.setAttribute('aria-labelledby', id);
        const h = document.createElement('h3');
        h.id = id;
        h.textContent = headingText;
        sec.appendChild(h);
        const body = document.createElement('div');
        sec.appendChild(body);
        parent.appendChild(sec);
        return body;
    }

    function state(parent, text, isError, retry) {
        const p = document.createElement('p');
        p.className = 'state' + (isError ? ' is-error' : '');
        p.textContent = text;
        if (retry) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn btn-sm';
            b.textContent = _('actions.retry');
            b.addEventListener('click', retry);
            p.appendChild(b);
        }
        parent.appendChild(p);
    }

    async function load() {
        const root = document.getElementById('reports-trends');
        if (!root || !window.UiChart) return;
        root.hidden = false;
        root.textContent = '';
        const head = document.createElement('div');
        head.className = 'section-head';
        const h2 = document.createElement('h2');
        h2.id = 'reports-trends-title';
        h2.textContent = _('reports.trends_title');
        head.appendChild(h2);
        root.appendChild(head);
        root.setAttribute('aria-labelledby', 'reports-trends-title');
        const note = document.createElement('p');
        note.className = 'section-note';
        note.textContent = fill(_('reports.trends_note'), { days: DAYS });
        root.appendChild(note);
        const body = document.createElement('div');
        body.className = 'trends-body';
        root.appendChild(body);
        state(body, _('reports.trends_loading'), false);

        let data;
        try {
            const res = await fetch('/api/reports/trends?days=' + DAYS, { credentials: 'same-origin' });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || res.statusText);
            data = json.data;
        } catch (err) {
            body.textContent = '';
            state(body, _('reports.trends_failed'), true, load);
            return;
        }
        body.textContent = '';

        const days = lastDays(DAYS);
        const keys = days.map((d) => dayKey(d.getTime()));
        const fmtDay = new Intl.DateTimeFormat(lang(), { month: 'short', day: 'numeric' });
        const fmtLong = new Intl.DateTimeFormat(lang(), { weekday: 'long', month: 'long', day: 'numeric' });
        const labels = days.map((d) => fmtDay.format(d));
        const num = new Intl.NumberFormat(lang());

        // Sessions per day
        const sessBody = block(body, _('reports.trends_sessions_title'), 'trends-sessions-title');
        const perDay = keys.map(() => 0);
        let durTotal = 0;
        let durCount = 0;
        for (const s of data.sessions || []) {
            const i = keys.indexOf(dayKey(s.start));
            if (i < 0) continue;
            perDay[i]++;
            if (s.end && s.end > s.start) { durTotal += s.end - s.start; durCount++; }
        }
        const totalSessions = perDay.reduce((a, b) => a + b, 0);
        if (!totalSessions) {
            state(sessBody, fill(_('reports.trends_sessions_empty'), { days: DAYS }), false);
        } else {
            const peak = perDay.indexOf(Math.max(...perDay));
            const avgMin = durCount ? Math.round(durTotal / durCount / 60000) : null;
            let summary = fill(_('reports.trends_sessions_summary'), {
                total: num.format(totalSessions), days: DAYS,
                peakDay: fmtLong.format(days[peak]), peak: num.format(perDay[peak]),
            });
            if (avgMin !== null) summary += ' ' + fill(_('reports.trends_sessions_length'), { minutes: num.format(avgMin) });
            if (data.devicesChecked < data.devicesTotal) {
                summary += ' ' + fill(_('reports.trends_sessions_capped'), { checked: num.format(data.devicesChecked), total: num.format(data.devicesTotal) });
            }
            window.UiChart.render(sessBody, {
                kind: 'columns', label: _('reports.trends_sessions_title'), summary,
                labels, xHeading: _('reports.trends_day'),
                series: [{ name: _('reports.trends_sessions_series'), values: perDay }],
                format: (v) => num.format(v),
            });
        }

        // Help requests opened and resolved per day
        const helpBody = block(body, _('reports.trends_help_title'), 'trends-help-title');
        const opened = keys.map(() => 0);
        const resolved = keys.map(() => 0);
        let stillOpen = 0;
        for (const r of data.help || []) {
            const oi = keys.indexOf(dayKey(r.created));
            if (oi >= 0) opened[oi]++;
            const done = /resolved|closed/i.test(r.status);
            if (done && r.updated) {
                const ri = keys.indexOf(dayKey(r.updated));
                if (ri >= 0) resolved[ri]++;
            }
            if (!done) stillOpen++;
        }
        const tOpen = opened.reduce((a, b) => a + b, 0);
        const tRes = resolved.reduce((a, b) => a + b, 0);
        if (!tOpen && !tRes) {
            state(helpBody, fill(_('reports.trends_help_empty'), { days: DAYS }), false);
        } else {
            window.UiChart.render(helpBody, {
                kind: 'columns', label: _('reports.trends_help_title'),
                summary: fill(_('reports.trends_help_summary'), { opened: num.format(tOpen), resolved: num.format(tRes), days: DAYS, open: num.format(stillOpen) }),
                labels, xHeading: _('reports.trends_day'),
                series: [
                    { name: _('reports.trends_help_opened'), values: opened },
                    { name: _('reports.trends_help_resolved'), values: resolved },
                ],
                format: (v) => num.format(v),
            });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
    else load();
})();
