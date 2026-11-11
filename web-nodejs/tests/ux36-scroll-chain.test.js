'use strict';

/**
 * UX 3.6 shell — the page column scrolls, the shell does not.
 *
 * A regression shipped here once: the beta shell declared only min-height while
 * page sheets (main.css `body.app-page`) clip overflow, so the shell grew past
 * the viewport with nothing left to scroll. On Devices (a long table) the list
 * could not be scrolled at all, and the floating horizontal scrollbar — which is
 * positioned from the table container's bounding box against the content box —
 * ended up at the very bottom of the list instead of the bottom of the screen.
 *
 * These tests pin the scroll chain and the bar's anchoring, because both are
 * easy to break by "just removing overflow" in one place.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const shellCss = read('public', 'css', 'ux36', 'shell.css');
const mainCss = read('public', 'css', 'main.css');
const devicesCss = read('public', 'css', 'devices.css');
const devicesJs = read('public', 'js', 'devices.js');

/** Body of one CSS rule, by selector (first match, top-level). */
function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    return match ? match[2] : null;
}

describe('UX 3.6 shell scroll chain', () => {
    it('gives the shell a viewport height and clips its own overflow', () => {
        const body = ruleBody(shellCss, '.ux35-shell');
        assert.ok(body, '.ux35-shell rule missing');
        assert.match(body, /height:\s*100dvh/, 'shell must fill the viewport');
        assert.match(body, /overflow:\s*hidden/, 'the shell itself must not scroll');
        // min-height alone is the bug: it lets the shell grow past the viewport.
        assert.doesNotMatch(body, /^\s*min-height:\s*100dvh;\s*$/m,
            'min-height alone leaves nothing to scroll when the body clips overflow');
    });

    it('keeps embedded windows content-sized', () => {
        const body = ruleBody(shellCss, '.ux35-shell.embed-mode');
        assert.ok(body, 'embed-mode rule missing');
        assert.match(body, /height:\s*auto/);
        assert.match(body, /overflow:\s*visible/);
    });

    it('makes the page column the single scroll box', () => {
        const main = ruleBody(shellCss, '.ux35-main');
        assert.ok(main, '.ux35-main rule missing');
        assert.match(main, /overflow:\s*hidden/, 'main must clip so the content column can scroll');

        const content = ruleBody(shellCss, '.ux35-content.main-content');
        assert.ok(content, '.ux35-content.main-content rule missing');
        assert.match(content, /overflow-y:\s*auto/, 'the content column is the scrollport');
        assert.doesNotMatch(content, /overflow:\s*visible/,
            'overflow: visible disables scrolling entirely under a clipped body');
    });

    it('does not offset the sidebar by the top bar', () => {
        // Sticky was correct while the document scrolled; inside a fixed shell it
        // would push the sidebar down by the top bar's height instead.
        const sidebar = ruleBody(shellCss, '.ux35-sidebar');
        assert.ok(sidebar, '.ux35-sidebar rule missing');
        assert.doesNotMatch(sidebar, /position:\s*sticky/,
            'the shell does not scroll, so the sidebar must not be sticky');
        assert.match(sidebar, /height:\s*100%/, 'the sidebar fills its column');
    });

    it('keeps the drawer fixed below the drawer breakpoint', () => {
        // The drawer replaces the in-flow sidebar; it must stay positioned to the
        // viewport rather than inherit height: 100% from the desktop rule.
        const drawerBlock = shellCss.slice(shellCss.indexOf('@media (max-width: 1099px)'));
        assert.match(drawerBlock, /\.ux35-sidebar\s*\{[^}]*position:\s*fixed/);
        assert.match(drawerBlock, /\.ux35-sidebar\s*\{[^}]*height:\s*auto/);
    });

    it('keeps the Devices header actions on the left, next to the title', () => {
        // The title used to carry margin-inline-end: auto, which pushed the
        // page's own controls (Add RDP/VNC target, Sync status) to the far right
        // edge where they read as unrelated chrome.
        const pagesCss = read('public', 'css', 'ux36', 'pages.css');
        const header = ruleBody(pagesCss, '.ux36-page .devices-header');
        assert.ok(header, '.ux36-page .devices-header rule missing');
        assert.match(header, /justify-content:\s*flex-start/,
            'the v2 sheet space-betweens the header, pushing the actions right');

        const title = ruleBody(pagesCss, '.ux36-page .devices-title');
        assert.ok(title, '.ux36-page .devices-title rule missing');
        assert.doesNotMatch(title, /margin-inline-end:\s*auto/,
            'margin-inline-end: auto pushes the header actions to the right');

        // The actions keep their own row gap so both buttons stay together.
        const actions = ruleBody(pagesCss, '.ux36-page .devices-actions');
        assert.ok(actions, '.ux36-page .devices-actions rule missing');
        assert.match(actions, /gap:/);
    });

    it('matches the reason the body clips overflow in the first place', () => {
        // If main.css ever stops clipping the body, this test should be revisited
        // rather than silently passing on a stale assumption.
        assert.match(mainCss, /body\.app-page\s*\{[^}]*overflow:\s*hidden/);
    });
});

describe('Devices horizontal scrollbar anchoring', () => {
    it('positions the floating bar from the content box, not the page bottom', () => {
        // The bar is fixed and placed relative to the content box's viewport
        // rect. If the content box were unconstrained, that rect would end at the
        // bottom of the table instead of the bottom of the screen.
        assert.match(devicesJs, /getBoundingClientRect\(\)/);
        assert.match(devicesJs, /viewportRect\.bottom - barHeight/);
        assert.match(devicesJs, /const mainContent = document\.querySelector\('\.main-content'\)/);
    });

    it('listens for scrolling on the element that actually scrolls', () => {
        // The beta shell scrolls .main-content (not the window), so the bar has
        // to recompute on that element's scroll events.
        assert.match(devicesJs, /mainContent\.addEventListener\('scroll', updateTableHScroll/);
        assert.match(devicesJs, /window\.addEventListener\('scroll', updateTableHScroll/);
    });

    it('keeps the bar clear of the docked bottom navigation', () => {
        // On phones the shell docks a fixed bottom nav; the bar must sit above it
        // or the last rows of the table stay unreachable.
        assert.match(devicesJs, /querySelector\('\.mobile-bottom-nav'\)/);
        assert.match(devicesJs, /reservedBottom/);
        assert.match(devicesJs, /viewportRect\.bottom - barHeight - reservedBottom/);
    });

    it('lets a workspace fill the column without a second scroll range', () => {
        // Chat is sized to the viewport, so the column must stop scrolling for it;
        // otherwise the page gets an empty scroll range of its own.
        const pagesCss = read('public', 'css', 'ux36', 'pages.css');
        assert.match(pagesCss, /\.ux36-page \.ux35-content:has\(\.chat-page\)\s*\{[^}]*overflow:\s*hidden/);
        assert.match(pagesCss, /\.ux36-page \.chat-page\s*\{[^}]*height:\s*100%/);
    });

    it('flattens the Dashboard cards that still carry v2 gradients and glow', () => {        // dashboard.css (v2) puts a radial glow on the hero, a linear gradient and
        // a blue border on the client-config card, and glass on the activity
        // panel. Next to the beta layout those read as a different design
        // language, so the beta sheet must override all of them.
        const pagesCss = read('public', 'css', 'ux36', 'pages.css');
        const dashboardCss = read('public', 'css', 'dashboard.css');

        // The v2 gradients really are there — this test would be pointless if not.
        assert.match(dashboardCss, /radial-gradient\(circle at top left/);
        assert.match(dashboardCss, /linear-gradient\(135deg, rgba\(88, 166, 255, 0\.12\)/);

        // And the beta overrides them with plain surfaces on hairlines.
        assert.match(pagesCss, /\.ux36-page \.dashboard-shell :is\([\s\S]*?\.client-config-card[\s\S]*?\)\s*\{[^}]*background:\s*var\(--bg\)/);
        assert.match(pagesCss, /\.ux36-page \.dashboard-shell :is\([\s\S]*?\)\s*\{[^}]*background-image:\s*none/);
        assert.match(pagesCss, /\.ux36-page \.dashboard-shell :is\([\s\S]*?\)\s*\{[^}]*border:\s*1px solid var\(--rule\)/);
        assert.match(pagesCss, /\.ux36-page \.dashboard-shell :is\([\s\S]*?\)\s*\{[^}]*box-shadow:\s*none/);

        // The hero and the status pills lose their glow too.
        assert.match(pagesCss, /\.ux36-page \.dashboard-hero\s*\{[^}]*background:\s*none/);
        assert.match(pagesCss, /\.ux36-page \.system-pill\s*\{[^}]*border:\s*1px solid var\(--rule\)/);
    });
});

describe('Devices table horizontal scrollport', () => {
    it('keeps the native table scrollport but hides its own scrollbar', () => {
        const scroll = ruleBody(devicesCss, '.devices-table-scroll');
        assert.ok(scroll, '.devices-table-scroll rule missing');
        assert.match(scroll, /overflow-x:\s*auto/, 'the table still scrolls horizontally');
        assert.match(scroll, /scrollbar-width:\s*none/, 'its own bar is replaced by the floating one');
    });
});
