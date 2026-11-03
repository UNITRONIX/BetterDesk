/**
 * CSP-safe action delegation (replaces inline onclick=/onchange= handlers).
 *
 * Usage:
 *   data-bd-call="Fleet.switchTab" data-bd-args='["resources"]'
 *   data-bd-call="Languages.closeDetail" data-bd-self-only="1"
 *   data-bd-call="FleetBuilder.updateNodeProp" data-bd-args='["id","label"]' data-bd-value="1"
 */
(function () {
    'use strict';

    function resolveCall(path) {
        if (!path || typeof path !== 'string') return null;
        const parts = path.split('.');
        let ctx = window;
        for (let i = 0; i < parts.length - 1; i++) {
            ctx = ctx && ctx[parts[i]];
        }
        const fn = ctx && ctx[parts[parts.length - 1]];
        if (typeof fn !== 'function') return null;
        return { ctx, fn };
    }

    function parseArgs(el) {
        const raw = el.getAttribute('data-bd-args');
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }

    function invoke(el, evt) {
        if (el.getAttribute('data-bd-self-only') === '1' && evt.target !== el) return;
        const path = el.getAttribute('data-bd-call');
        const resolved = resolveCall(path);
        if (!resolved) {
            console.warn('[bd-actions] unresolved', path);
            return;
        }
        const args = parseArgs(el);
        if (el.getAttribute('data-bd-value') === '1') {
            args.push(el.value);
        }
        resolved.fn.apply(resolved.ctx, args);
    }

    document.addEventListener('click', (evt) => {
        const copyEl = evt.target && evt.target.closest && evt.target.closest('[data-bd-copy]');
        if (copyEl && navigator.clipboard && navigator.clipboard.writeText) {
            const text = copyEl.getAttribute('data-bd-copy')
                || (copyEl.previousElementSibling && copyEl.previousElementSibling.textContent)
                || '';
            navigator.clipboard.writeText(text).catch(() => {});
            return;
        }
        const el = evt.target && evt.target.closest && evt.target.closest('[data-bd-call]');
        if (!el) return;
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'select' || tag === 'textarea') return;
        if (tag === 'input' && el.type !== 'button' && el.type !== 'submit' && el.type !== 'checkbox' && el.type !== 'radio') {
            return;
        }
        invoke(el, evt);
    }, false);

    document.addEventListener('change', (evt) => {
        const el = evt.target && evt.target.closest && evt.target.closest('[data-bd-call][data-bd-on="change"]');
        if (!el) return;
        invoke(el, evt);
    }, false);
})();
