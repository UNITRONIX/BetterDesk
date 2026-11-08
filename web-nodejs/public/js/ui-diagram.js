/**
 * How a RustDesk connection travels through this server, drawn as SVG.
 *
 *   UiDiagram.connection(container, {
 *     idServer: 'remote.example.com', relay: 'remote.example.com',
 *     idPort: 21116, relayPort: 21117,
 *     mode: 'direct-first' | 'relay-only',
 *   });
 *
 * Four boxes: your computer, the ID server, the relay server, the remote
 * device. The ID server introduces the two sides; they then connect
 * directly when the network allows it, otherwise through the relay. The
 * same steps are written below the drawing as a numbered list, so the
 * picture is never the only way to read it. Wide containers get a left to
 * right layout, narrow ones a top to bottom layout. Text uses textContent.
 */
(function () {
    'use strict';

    const SVG = 'http://www.w3.org/2000/svg';
    let seq = 0;
    const t = (key, fallback) => {
        if (typeof window._ === 'function') {
            const v = window._(key);
            if (v && v !== key) return v;
        }
        return fallback;
    };
    const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

    function el(tag, attrs, parent, text) {
        const n = document.createElementNS(SVG, tag);
        for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
        if (text !== undefined) n.textContent = text;
        if (parent) parent.appendChild(n);
        return n;
    }

    function box(svg, x, y, w, h, title, sub) {
        const g = el('g', { class: 'dg-node' }, svg);
        el('rect', { x, y, width: w, height: h, rx: 3 }, g);
        el('text', { x: x + w / 2, y: y + (sub ? h / 2 - 3 : h / 2 + 4), 'text-anchor': 'middle', class: 'dg-title' }, g, title);
        if (sub) el('text', { x: x + w / 2, y: y + h / 2 + 14, 'text-anchor': 'middle', class: 'dg-sub' }, g, sub);
        return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
    }

    let ARROW = 'dg-arrow';
    function arrow(svg, x1, y1, x2, y2, cls, both) {
        el('line', { x1, y1, x2, y2, class: 'dg-edge ' + (cls || ''), 'marker-end': 'url(#' + ARROW + ')', ...(both ? { 'marker-start': 'url(#' + ARROW + '-start)' } : {}) }, svg);
    }

    function label(svg, x, y, text, anchor, cls) {
        el('text', { x, y, 'text-anchor': anchor || 'middle', class: 'dg-label ' + (cls || '') }, svg, text);
    }

    function connection(container, opts) {
        const o = Object.assign({ idPort: 21116, relayPort: 21117, mode: 'direct-first' }, opts);
        const relayOnly = o.mode === 'relay-only';
        const uid = 'dg' + (++seq);
        container.textContent = '';
        const fig = document.createElement('figure');
        fig.className = 'diagram';
        container.appendChild(fig);
        const holder = document.createElement('div');
        holder.className = 'diagram-plot';
        fig.appendChild(holder);

        const you = t('diagram.your_computer', 'Your computer');
        const remote = t('diagram.remote_device', 'Remote device');
        const app = t('diagram.with_rustdesk', 'with RustDesk');
        const idT = t('diagram.id_server', 'ID server');
        const relayT = t('diagram.relay_server', 'Relay server');
        const idSub = (o.idServer || '?') + ':' + o.idPort;
        const relaySub = (o.relay || o.idServer || '?') + ':' + o.relayPort;

        function draw() {
            holder.textContent = '';
            ARROW = uid + '-arrow';
            const wide = (holder.clientWidth || 600) >= 560;
            const W = wide ? 720 : 340;
            const H = wide ? 250 : 470;
            const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-labelledby': uid + '-cap' }, holder);
            const defs = el('defs', {}, svg);
            const m = el('marker', { id: uid + '-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, defs);
            el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'dg-head' }, m);
            const ms = el('marker', { id: uid + '-arrow-start', viewBox: '0 0 10 10', refX: 1, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, defs);
            el('path', { d: 'M10,0 L0,5 L10,10 z', class: 'dg-head' }, ms);

            if (wide) {
                const a = box(svg, 10, 95, 150, 56, you, app);
                const b = box(svg, 560, 95, 150, 56, remote, app);
                const id = box(svg, 270, 10, 180, 56, idT, idSub);
                const r = box(svg, 270, 184, 180, 56, relayT, relaySub);
                arrow(svg, a.x + a.w, a.y + 10, id.x - 4, id.cy);
                label(svg, 205, 52, '1');
                arrow(svg, b.x, b.y + 10, id.x + id.w + 4, id.cy);
                label(svg, 515, 52, '1');
                arrow(svg, a.x + a.w + 4, a.cy + 6, b.x - 4, b.cy + 6, relayOnly ? 'is-off' : 'is-direct', true);
                label(svg, 360, a.cy + 0, relayOnly ? '2 ' + t('diagram.off', '(off)') : '2', 'middle', relayOnly ? 'is-off' : '');
                arrow(svg, a.x + a.w, a.y + a.h - 8, r.x - 4, r.cy, 'is-relay', true);
                arrow(svg, b.x, b.y + b.h - 8, r.x + r.w + 4, r.cy, 'is-relay', true);
                label(svg, 205, 205, '3');
                label(svg, 515, 205, '3');
            } else {
                const a = box(svg, 20, 10, 300, 52, you, app);
                const id = box(svg, 20, 112, 300, 52, idT, idSub);
                const r = box(svg, 20, 290, 300, 52, relayT, relaySub);
                const b = box(svg, 20, 408, 300, 52, remote, app);
                arrow(svg, 90, a.y + a.h + 2, 90, id.y - 4);
                label(svg, 78, 92, '1', 'end');
                arrow(svg, 250, b.y - 4, 250, id.y + id.h + 4, relayOnly ? 'is-off' : '', false);
                label(svg, 262, 240, '1', 'start');
                arrow(svg, 170, a.y + a.h + 2, 170, b.y - 4, relayOnly ? 'is-off' : 'is-direct', true);
                label(svg, 182, 236, relayOnly ? '2 ' + t('diagram.off', '(off)') : '2', 'start', relayOnly ? 'is-off' : '');
                arrow(svg, 300, a.y + a.h + 2, 300, r.y - 4, 'is-relay', true);
                arrow(svg, 300, r.y + r.h + 2, 300, b.y - 4, 'is-relay', true);
                label(svg, 290, 230, '3', 'end');
            }
        }

        const cap = document.createElement('figcaption');
        cap.id = uid + '-cap';
        cap.className = 'diagram-caption';
        const ol = document.createElement('ol');
        ol.className = 'steps';
        [
            fill(t('diagram.step_find', 'Both computers keep in touch with the ID server ({id}). When you connect, it tells each side where the other is.'), { id: idSub }),
            relayOnly
                ? t('diagram.step_direct_off', 'A direct connection is switched off on this server.')
                : t('diagram.step_direct', 'If the networks allow it, the two computers then talk to each other directly.'),
            fill(relayOnly
                ? t('diagram.step_relay_always', 'Every session goes through the relay server ({relay}).')
                : t('diagram.step_relay', 'Otherwise the session goes through the relay server ({relay}).'), { relay: relaySub }),
        ].forEach((s) => {
            const li = document.createElement('li');
            li.textContent = s;
            ol.appendChild(li);
        });
        cap.appendChild(ol);
        fig.appendChild(cap);

        draw();
        if (typeof ResizeObserver === 'function') {
            let last = holder.clientWidth >= 560;
            new ResizeObserver(() => {
                const now = holder.clientWidth >= 560;
                if (now !== last) { last = now; draw(); }
            }).observe(holder);
        }
    }

    window.UiDiagram = { connection };
})();
