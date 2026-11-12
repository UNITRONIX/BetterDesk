'use strict';

/**
 * UX 3.6 — a closed overlay must not block the page.
 *
 * The beta sheet replaced the v2 overlay rules with `display: flex` plus
 * `opacity: 0`, which left an invisible full-viewport layer over the console.
 * Every click landed on it, so the whole panel looked frozen — the
 * assign-package modal on the Commercialization → Sessions tab reproduced it.
 *
 * Opacity is a paint property: it does not remove a box from hit testing.
 * These tests pin the rule that keeps a closed overlay out of the way, for all
 * three overlay kinds the beta defines.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const componentsCss = read('public', 'css', 'ux36', 'components.css');
const shellCss = read('public', 'css', 'ux36', 'shell.css');

/** Body of one CSS rule, first top-level match. */
function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    return match ? match[2] : null;
}

/** True when the rule keeps a closed layer out of hit testing. */
function hidesFromPointer(body) {
    return /display:\s*none/.test(body)
        || (/visibility:\s*hidden/.test(body) && /pointer-events:\s*none/.test(body));
}

describe('UX 3.6 overlays keep the page clickable when closed', () => {
    it('hides a closed modal overlay', () => {
        const body = ruleBody(componentsCss, '.modal-overlay');
        assert.ok(body, '.modal-overlay rule missing');
        assert.ok(hidesFromPointer(body),
            'a closed .modal-overlay still covers the viewport and swallows clicks');

        // And it is a real overlay again once open.
        const open = componentsCss.match(/\.modal-overlay\.open[\s\S]{0,200}?\{([^}]*)\}/);
        assert.ok(open, '.modal-overlay.open rule missing');
        assert.match(open[1], /display:\s*flex|visibility:\s*visible/);
    });

    it('hides a closed sidebar overlay', () => {
        const body = ruleBody(shellCss, '.ux35-sidebar-overlay');
        assert.ok(body, '.ux35-sidebar-overlay rule missing');
        assert.ok(hidesFromPointer(body),
            'a closed .ux35-sidebar-overlay still swallows clicks');
        assert.match(shellCss, /\.ux35-sidebar-overlay\.visible\s*\{[^}]*pointer-events:\s*auto/);
    });

    it('hides a closed sheet layer', () => {
        const body = ruleBody(componentsCss, '.sheet-layer');
        assert.ok(body, '.sheet-layer rule missing');
        assert.ok(hidesFromPointer(body),
            'a closed .sheet-layer still swallows clicks');
    });

    it('does not rely on opacity alone for any fixed full-viewport layer', () => {
        // Every position:fixed + inset:0 layer in the beta must have a way to
        // stop hit testing while closed. This catches a new overlay added later.
        [componentsCss, shellCss].forEach((css, index) => {
            const name = index === 0 ? 'components.css' : 'shell.css';
            const blocks = css.split(/\n(?=[.#:a-zA-Z][^\n{]*\{)/);
            blocks.forEach((block) => {
                if (!/position:\s*fixed/.test(block)) return;
                if (!/inset:\s*0\b|inset-inline:\s*0|inset:\s*0;/.test(block)) return;
                const selector = block.slice(0, block.indexOf('{')).trim().split('\n').pop();
                // Overlays that are always-on chrome (toast container, reading mask)
                // are allowed to be visible; anything else must hide when closed.
                if (/toast|reading|mask/i.test(selector)) return;
                if (!/opacity:\s*0/.test(block)) return;
                assert.ok(hidesFromPointer(block),
                    `${name}: ${selector} is fixed, full-viewport and fades out, but stays clickable`);
            });
        });
    });
});
