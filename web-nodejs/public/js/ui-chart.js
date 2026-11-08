/**
 * Small SVG charts for the console: a line chart for a value over time and
 * a column chart for counts per day. No library.
 *
 *   UiChart.render(container, {
 *     kind: 'line' | 'columns',
 *     label: 'Devices online',            // what is plotted (accessible name)
 *     summary: 'Between 9 and 14 ...',    // one sentence, written by the caller
 *     labels: ['Mon', 'Tue', ...],        // x positions (strings)
 *     series: [{ name: 'Online', values: [3, 5, ...] }],   // 1 to 3 series
 *     yLabel: 'Devices', yMax: 30,        // y axis name; optional fixed max
 *     format: (v) => v + ' %',            // value format for ticks, tooltip, table
 *     xHeading: 'Day',                    // first column of the table
 *   });
 *
 * Every chart comes with its summary sentence, a legend when there are two or
 * more series, and a "Show the numbers" table, so nothing depends on reading
 * the picture or on colour. Hover or arrow keys move a crosshair that lists
 * every series at that position. Strings are inserted with textContent.
 */
(function () {
    'use strict';

    const SVG = 'http://www.w3.org/2000/svg';
    const H = 200;
    const PAD = { top: 12, right: 12, bottom: 26, left: 44 };

    const t = (key, fallback, params) => {
        if (typeof window._ === 'function') {
            const v = window._(key, params);
            if (v && v !== key) return v;
        }
        return params ? fallback.replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m)) : fallback;
    };

    function el(tag, attrs, parent) {
        const n = document.createElementNS(SVG, tag);
        for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
        if (parent) parent.appendChild(n);
        return n;
    }

    function html(tag, cls, text, parent) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        if (parent) parent.appendChild(n);
        return n;
    }

    // Round tick steps: 1, 2, 5 x 10^n
    function niceTicks(max, count) {
        if (!(max > 0)) return { max: 1, ticks: [0, 1] };
        const raw = max / count;
        const pow = Math.pow(10, Math.floor(Math.log10(raw)));
        const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
        const top = Math.ceil(max / step) * step;
        const ticks = [];
        for (let v = 0; v <= top + step / 2; v += step) ticks.push(+v.toFixed(10));
        return { max: top, ticks };
    }

    function render(container, opts) {
        const o = Object.assign({ kind: 'line', series: [], labels: [], format: (v) => String(v) }, opts);
        const fmt = (v) => (v === null || v === undefined || Number.isNaN(v) ? '–' : o.format(v));
        container.textContent = '';
        const fig = html('figure', 'chart', null, container);
        if (o.summary) html('p', 'chart-summary', o.summary, fig);

        const plot = html('div', 'chart-plot', null, fig);
        plot.tabIndex = 0;
        plot.setAttribute('role', 'group');
        plot.setAttribute('aria-roledescription', t('chart.role', 'chart'));
        plot.setAttribute('aria-label', (o.label || '') + (o.summary ? '. ' + o.summary : ''));
        const tip = html('div', 'chart-tip', null, plot);
        tip.hidden = true;
        const live = html('p', 'sr-only', null, fig);
        live.setAttribute('aria-live', 'polite');

        if (o.series.length > 1) {
            const legend = html('ul', 'chart-legend', null, fig);
            o.series.forEach((s, i) => {
                const li = html('li', null, null, legend);
                html('span', 'chart-key chart-key-' + (i + 1) + (o.kind === 'columns' ? ' is-block' : ''), null, li).setAttribute('aria-hidden', 'true');
                li.appendChild(document.createTextNode(s.name));
            });
        }

        // Table view
        const details = html('details', 'chart-table disclosure', null, fig);
        html('summary', null, t('chart.show_table', 'Show the numbers'), details);
        const wrap = html('div', 'table-scroll', null, details);
        // A scroll box that may overflow must be reachable by keyboard
        wrap.tabIndex = 0;
        wrap.setAttribute('role', 'region');
        wrap.setAttribute('aria-label', o.label ? t('chart.table_label', '{label} as a table', { label: o.label }) : t('chart.show_table', 'Show the numbers'));
        const table = html('table', 'data-table', null, wrap);
        const hr = html('tr', null, null, html('thead', null, null, table));
        html('th', null, o.xHeading || '', hr).scope = 'col';
        o.series.forEach((s) => { html('th', null, s.name, hr).scope = 'col'; });
        const tb = html('tbody', null, null, table);
        o.labels.forEach((lab, i) => {
            const tr = html('tr', null, null, tb);
            html('th', null, lab, tr).scope = 'row';
            o.series.forEach((s) => html('td', 'num-cell', fmt(s.values[i]), tr));
        });

        let index = -1;
        let svg = null;
        let geom = null;

        function draw() {
            const W = Math.max(240, Math.round(plot.clientWidth || 600));
            if (svg) svg.remove();
            svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' });
            plot.insertBefore(svg, tip);
            const n = o.labels.length;
            const all = o.series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined));
            const { max, ticks } = niceTicks(o.yMax || Math.max(1, ...all), 4);
            const x0 = PAD.left;
            const x1 = W - PAD.right;
            const y0 = H - PAD.bottom;
            const y1 = PAD.top;
            const band = (x1 - x0) / Math.max(1, n);
            const xAt = (i) => (o.kind === 'columns' ? x0 + band * (i + 0.5) : x0 + (n <= 1 ? 0 : ((x1 - x0) * i) / (n - 1)));
            const yAt = (v) => y0 - ((y0 - y1) * v) / max;
            geom = { xAt, n, x0, x1, band };

            // Grid and y ticks
            const grid = el('g', { class: 'chart-grid' }, svg);
            ticks.forEach((v) => {
                const y = Math.round(yAt(v)) + 0.5;
                el('line', { x1: x0, x2: x1, y1: y, y2: y }, grid);
                const tx = el('text', { x: x0 - 6, y: y + 4, 'text-anchor': 'end', class: 'chart-tick' }, svg);
                tx.textContent = fmt(v);
            });

            // X labels: at most about one per 64 px
            const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((x1 - x0) / 64))));
            // The last label always shows; one that would sit too close to it is dropped
            const shown = o.labels.map((lab, i) => i === n - 1 || i % every === 0);
            for (let i = n - 2; i >= 0; i--) {
                if (shown[i]) {
                    if (xAt(n - 1) - xAt(i) < 56) shown[i] = false;
                    break;
                }
            }
            const xLabels = [];
            o.labels.forEach((lab, i) => {
                if (!shown[i]) return;
                const tx = el('text', { x: xAt(i), y: H - 8, 'text-anchor': 'middle', class: 'chart-tick' }, svg);
                tx.textContent = lab;
                xLabels.push(tx);
            });
            // Keep labels inside the chart: the first and last points sit on the plot's
            // edges, so a centred label there would be cut off. Shift them inwards, then
            // drop any label that now overlaps the one after it (the last always stays).
            let nextLeft = Infinity;
            for (let j = xLabels.length - 1; j >= 0; j--) {
                const tx = xLabels[j];
                let w = 0;
                try { w = tx.getComputedTextLength(); } catch (e) { w = 0; }
                if (!w) continue; // not laid out yet (hidden); the next resize redraws
                const x = Math.min(Math.max(+tx.getAttribute('x'), w / 2), W - w / 2);
                if (x + w / 2 + 8 > nextLeft) { tx.remove(); continue; }
                tx.setAttribute('x', x.toFixed(1));
                nextLeft = x - w / 2;
            }

            if (o.kind === 'columns') {
                const k = o.series.length;
                const barW = Math.min(24, Math.max(3, (band * 0.7 - 2 * (k - 1)) / k));
                o.series.forEach((s, si) => {
                    const g = el('g', { class: 'chart-series-' + (si + 1) }, svg);
                    s.values.forEach((v, i) => {
                        if (!(v > 0)) return;
                        const cx = xAt(i) - (k * barW + 2 * (k - 1)) / 2 + si * (barW + 2);
                        const top = yAt(v);
                        const h = y0 - top;
                        const r = Math.min(2, h);
                        // Square at the baseline, small rounded top
                        el('path', {
                            class: 'chart-bar',
                            d: `M${cx},${y0} V${top + r} Q${cx},${top} ${cx + r},${top} H${cx + barW - r} Q${cx + barW},${top} ${cx + barW},${top + r} V${y0} Z`,
                        }, g);
                    });
                });
            } else {
                o.series.forEach((s, si) => {
                    const g = el('g', { class: 'chart-series-' + (si + 1) }, svg);
                    let d = '';
                    let pen = false;
                    s.values.forEach((v, i) => {
                        if (v === null || v === undefined) { pen = false; return; }
                        d += (pen ? ' L' : ' M') + xAt(i).toFixed(1) + ',' + yAt(v).toFixed(1);
                        pen = true;
                    });
                    if (o.series.length === 1 && d) {
                        const first = s.values.findIndex((v) => v !== null && v !== undefined);
                        let last = -1;
                        s.values.forEach((v, i) => { if (v !== null && v !== undefined) last = i; });
                        if (first >= 0 && !s.values.slice(first, last + 1).some((v) => v === null || v === undefined)) {
                            el('path', { class: 'chart-area', d: d + ` L${xAt(last)},${y0} L${xAt(first)},${y0} Z` }, g);
                        }
                    }
                    el('path', { class: 'chart-line', d }, g);
                    // A value with gaps on both sides has no line to draw: mark it with a dot
                    const has = (i) => i >= 0 && i < n && s.values[i] !== null && s.values[i] !== undefined;
                    s.values.forEach((v, i) => {
                        if (has(i) && !has(i - 1) && !has(i + 1)) {
                            el('circle', { class: 'chart-point', r: 3, cx: xAt(i).toFixed(1), cy: yAt(v).toFixed(1) }, g);
                        }
                    });
                });
            }
            el('line', { class: 'chart-axis', x1: x0, x2: x1, y1: y0 + 0.5, y2: y0 + 0.5 }, svg);
            geom.cross = el('line', { class: 'chart-cross', y1: y1, y2: y0, x1: -10, x2: -10 }, svg);
            geom.dots = o.kind === 'line' ? o.series.map((s, si) => el('circle', { r: 4, cx: -10, cy: -10, class: 'chart-dot chart-dot-' + (si + 1) }, svg)) : [];
            geom.yAt = yAt;
            if (index >= 0) show(index, false);
        }

        function show(i, announce) {
            if (!geom || i < 0 || i >= geom.n) return;
            index = i;
            const x = geom.xAt(i);
            geom.cross.setAttribute('x1', x);
            geom.cross.setAttribute('x2', x);
            geom.dots.forEach((d, si) => {
                const v = o.series[si].values[i];
                if (v === null || v === undefined) { d.setAttribute('cx', -10); return; }
                d.setAttribute('cx', x);
                d.setAttribute('cy', geom.yAt(v));
            });
            tip.textContent = '';
            html('div', 'chart-tip-x', o.labels[i], tip);
            o.series.forEach((s, si) => {
                const row = html('div', 'chart-tip-row', null, tip);
                html('strong', null, fmt(s.values[i]), row);
                if (o.series.length > 1) {
                    html('span', 'chart-key chart-key-' + (si + 1), null, row).setAttribute('aria-hidden', 'true');
                    row.appendChild(document.createTextNode(s.name));
                }
            });
            tip.hidden = false;
            const pw = plot.clientWidth;
            const tw = tip.offsetWidth;
            let left = x + 12;
            if (left + tw > pw) left = x - 12 - tw;
            tip.style.insetInlineStart = '';
            tip.style.left = Math.max(0, left) + 'px';
            if (announce) {
                live.textContent = o.labels[i] + ': ' + o.series.map((s) => (o.series.length > 1 ? s.name + ' ' : '') + fmt(s.values[i])).join(', ');
            }
        }

        function hide() {
            index = -1;
            tip.hidden = true;
            if (geom) {
                geom.cross.setAttribute('x1', -10);
                geom.cross.setAttribute('x2', -10);
                geom.dots.forEach((d) => d.setAttribute('cx', -10));
            }
        }

        plot.addEventListener('pointermove', (e) => {
            if (!geom) return;
            const r = plot.getBoundingClientRect();
            const x = e.clientX - r.left;
            let best = 0;
            let bestD = Infinity;
            for (let i = 0; i < geom.n; i++) {
                const d = Math.abs(geom.xAt(i) - x);
                if (d < bestD) { bestD = d; best = i; }
            }
            show(best, false);
        });
        plot.addEventListener('pointerleave', hide);
        plot.addEventListener('blur', hide);
        plot.addEventListener('keydown', (e) => {
            if (!geom) return;
            const rtl = getComputedStyle(plot).direction === 'rtl';
            const next = rtl ? 'ArrowLeft' : 'ArrowRight';
            const prev = rtl ? 'ArrowRight' : 'ArrowLeft';
            if (e.key === next) { e.preventDefault(); show(Math.min(geom.n - 1, index + 1), true); }
            else if (e.key === prev) { e.preventDefault(); show(Math.max(0, index < 0 ? geom.n - 1 : index - 1), true); }
            else if (e.key === 'Home') { e.preventDefault(); show(0, true); }
            else if (e.key === 'End') { e.preventDefault(); show(geom.n - 1, true); }
            else if (e.key === 'Escape') { hide(); }
        });

        draw();
        if (typeof ResizeObserver === 'function') {
            let last = plot.clientWidth;
            new ResizeObserver(() => {
                if (Math.abs(plot.clientWidth - last) > 4) { last = plot.clientWidth; draw(); }
            }).observe(plot);
        }
        return { redraw: draw };
    }

    window.UiChart = { render };
})();
