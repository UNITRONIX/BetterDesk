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

    it('keeps the Devices title group left-aligned in the header', () => {
        // Title + count stay a left-aligned header; page actions (RDP/VNC target,
        // create folder/group) live in the left rail under folders/groups.
        const pagesCss = read('public', 'css', 'ux36', 'pages.css');
        const header = ruleBody(pagesCss, '.ux36-page .devices-header');
        assert.ok(header, '.ux36-page .devices-header rule missing');
        assert.match(header, /justify-content:\s*flex-start/,
            'the v2 sheet space-betweens the header, pushing leftover actions right');

        const title = ruleBody(pagesCss, '.ux36-page .devices-title');
        assert.ok(title, '.ux36-page .devices-title rule missing');
        assert.doesNotMatch(title, /margin-inline-end:\s*auto/,
            'margin-inline-end: auto pushes the title cluster to the right');
    });

    it('keeps Add RDP/VNC target in the groups rail, not the page header', () => {
        const view = read('views', 'devices.ejs');
        const headerSlice = view.slice(
            view.indexOf('class="devices-header"'),
            view.indexOf('class="devices-tile-bars"'));
        assert.doesNotMatch(headerSlice, /id="add-remote-target-btn"/,
            'Add RDP/VNC must not sit in the page header');
        assert.match(view, /id="groups-chips"[\s\S]*?id="add-remote-target-btn"/,
            'Add RDP/VNC belongs under the groups list');
    });

    it('matches the reason the body clips overflow in the first place', () => {
        // If main.css ever stops clipping the body, this test should be revisited
        // rather than silently passing on a stale assumption.
        assert.match(mainCss, /body\.app-page\s*\{[^}]*overflow:\s*hidden/);
    });

    it('frames the settings search as one field, not a rule across the column', () => {
        // The field used to be a borderless input on a full-width rule, so the
        // focus ring painted a floating frame wider than the input and the field
        // looked wider than the panels under it.
        const pagesCss = read('public', 'css', 'ux36', 'pages.css');
        const search = ruleBody(pagesCss, '.ux36-page .settings-search');
        assert.ok(search, '.ux36-page .settings-search rule missing');
        assert.match(search, /max-width:/, 'the search must not span the whole column');
        assert.match(search, /border:\s*1px solid var\(--rule\)/, 'the row carries the field border');
        assert.doesNotMatch(search, /border:\s*0;/, 'a borderless row cannot frame its focus state');

        // The row owns the focus state; the input inside it draws nothing.
        assert.match(pagesCss, /\.ux36-page \.settings-search:focus-within\s*\{[^}]*border-color:\s*var\(--accent\)/);
        assert.match(pagesCss, /\.ux36-page \.settings-search \.form-input:focus[\s\S]{0,120}?outline:\s*none/);
        assert.match(pagesCss, /\.ux36-page \.settings-search \.form-input\s*\{[^}]*background:\s*transparent/);
    });

    it('keeps the icon font rule out of page layout', () => {
        // base.css loads after the page sheets, so a plain .material-icons rule
        // there beats .tool-icon on a specificity tie and forces inline-block and
        // 18px — which is what pushed the toolkit icons into the corner of their
        // squares. :where() keeps the font setup at zero specificity.
        const baseCss = read('public', 'css', 'ux36', 'base.css');
        const rule = baseCss.match(/:where\(\.material-icons[\s\S]{0,120}?\)\s*\{([^}]*)\}/);
        assert.ok(rule, 'the icon font rule must be wrapped in :where()');
        assert.match(rule[1], /font-family:\s*"Material Symbols Outlined"/,
            'the rule still has to define the icon font');

        // No plain .material-icons selector may sit beside it and compete again.
        assert.doesNotMatch(baseCss, /^\s*\.material-icons\s*[,{]/m,
            'a plain .material-icons rule in base.css would override component layout');

        // The component that centres icons in a square keeps its own rules.
        const toolkitCss = read('public', 'css', 'toolkit.css');
        const icon = toolkitCss.match(/\.tool-icon\s*\{([^}]*)\}/);
        assert.ok(icon, '.tool-icon rule missing');
        assert.match(icon[1], /display:\s*flex/);
        assert.match(icon[1], /align-items:\s*center/);
        assert.match(icon[1], /justify-content:\s*center/);
        assert.match(icon[1], /font-size:\s*24px/);
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

    it('keeps the Devices sticky toolbar flush under the top bar', () => {
        // Chromium will not let position:sticky enter the scrollport padding box,
        // so --page-pad on .ux35-content leaves a gap where table rows paint above
        // the stuck search/filters. Padding-top must move onto .devices-page.
        const pagesCss = read('public', 'css', 'ux36', 'pages.css');
        assert.match(pagesCss,
            /\.ux36-page \.ux35-content:has\(\.devices-page\)\s*\{[^}]*padding-top:\s*0/);
        assert.match(pagesCss,
            /\.ux36-page \.ux35-content:has\(\.devices-page\) > \.devices-page\s*\{[^}]*padding-top:\s*var\(--page-pad\)/);
        assert.match(pagesCss,
            /\.ux36-page \.devices-page \.devices-toolbar\s*\{[\s\S]*?position:\s*sticky[\s\S]*?top:\s*0/);
    });

    it('keeps Settings topic tabs above branding content while scrolling', () => {
        // Branding hero steps used z-index:1; with --layer-sticky also at 1 the
        // pills painted over the stuck topic row. Topic nav must win stacking.
        const pagesCss = read('public', 'css', 'ux36', 'pages.css');
        assert.match(pagesCss,
            /\.ux36-page \.settings-shell-nav\s*\{[\s\S]*?z-index:\s*var\(--z-sticky/);
        assert.match(pagesCss,
            /\.ux36-page \.branding-hero-steps\s*\{[^}]*z-index:\s*auto/);
    });

    it('flattens the Dashboard cards that still carry v2 gradients and glow', () => {
        // dashboard.css (v2) used to put a radial glow on the hero and a linear
        // gradient on the client-config card; those are now flat surfaces at the
        // source. The beta sheet still overrides glass/borders so activity and
        // sibling cards stay on the same hairline language.
        const pagesCss = read('public', 'css', 'ux36', 'pages.css');

        assert.match(pagesCss, /\.ux36-page \.dashboard-shell :is\([\s\S]*?\.client-config-card[\s\S]*?\)\s*\{[^}]*background:\s*var\(--bg\)/);
        assert.match(pagesCss, /\.ux36-page \.dashboard-shell :is\([\s\S]*?\)\s*\{[^}]*background-image:\s*none/);
        assert.match(pagesCss, /\.ux36-page \.dashboard-shell :is\([\s\S]*?\)\s*\{[^}]*border:\s*1px solid var\(--rule\)/);
        assert.match(pagesCss, /\.ux36-page \.dashboard-shell :is\([\s\S]*?\)\s*\{[^}]*box-shadow:\s*none/);

        // The hero loses any remaining glow/panel treatment too.
        assert.match(pagesCss, /\.ux36-page \.dashboard-hero\s*\{[^}]*background:\s*none/);
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
