'use strict';

/**
 * UX 3.6 beta — every console page renders in both shells.
 *
 * The focused tests in `ux36-pages.render.test.js` cover the pages the beta
 * lays out by hand (dashboard, devices, settings). This suite walks every view
 * that uses the main layout, so a new page cannot ship with a broken shell
 * branch, a beta-only asset leaking into UX 3.5, or a beta page without its
 * own chrome.
 *
 * Views that need request-specific locals (remote viewer, studio, portal,
 * login screens) are out of scope: they do not use the main layout or are
 * asserted elsewhere.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const views = path.join(root, 'views');
const en = JSON.parse(fs.readFileSync(path.join(root, 'lang', 'en.json'), 'utf8'));
const { buildNav } = require('../lib/consoleNav');

function translate(key) {
    const value = key.split('.').reduce((cur, part) => (
        cur && typeof cur === 'object' && part in cur ? cur[part] : undefined
    ), en);
    return typeof value === 'string' && value.length ? value : key;
}

/** Any local a view asks for is present, so only real template errors surface. */
function locals(shell, page) {
    const nav = buildNav({
        t: translate,
        allows: () => true,
        can: () => true,
        role: 'admin',
        currentPage: page,
    });
    const base = {
        _: translate,
        t: translate,
        req: { t: translate },
        lang: 'en',
        title: translate(`nav.${page}`),
        appName: 'BetterDesk',
        appDescription: 'test',
        cacheVersion: 'test',
        cspNonce: 'nonce',
        csrfToken: 'csrf',
        user: { username: 'admin', role: 'admin' },
        branding: {},
        translations: {},
        availableLanguageList: [],
        availableLanguages: {},
        themePalettes: {},
        embed: false,
        isSuperAdmin: true,
        hasPermission: () => true,
        hasSectionAccess: () => true,
        buildConsoleNav: () => nav,
        uiShell: shell,
        uiShellBeta: shell === 'ux36',
        currentPage: page,
        activePage: page,
        consoleTab: '',
        breadcrumb: [],
        canServerConfig: true,
        canBrandingEdit: true,
        sessionPolicy: null,
        appVersion: '3.6.0-test',
        consoleSearchPages: [],
        // Page-specific detail locals the views read directly.
        pageStyles: [],
        pageScripts: [],
        activeTab: 'overview',
        deviceId: '123456789',
        orgId: 'org-test',
        suggested_host: 'panel.example.test',
        escapeHtml: (value) => String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;'),
        // Audit M11 (2026-11-13): templates embed server data inside inline
        // <script> blocks through this helper instead of raw JSON.stringify.
        safeJsonScript: (value) => JSON.stringify(value === undefined ? null : value)
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026'),
    };
    return new Proxy(base, {
        has: () => true,
        get: (target, prop) => (prop in target ? target[prop] : undefined),
    });
}

const MAIN_LAYOUT_VIEWS = fs.readdirSync(views)
    .filter((file) => file.endsWith('.ejs'))
    .filter((file) => fs.readFileSync(path.join(views, file), 'utf8').includes("layouts/main"));

function render(file, shell) {
    const page = file.replace(/\.ejs$/, '');
    const full = path.join(views, file);
    return ejs.render(fs.readFileSync(full, 'utf8'), locals(shell, page), {
        filename: full,
        root: views,
        // The console renders these pages with view locals in scope (the
        // defaults below), so a view that reads an optional local the test
        // does not set must see `undefined` instead of throwing.
        _with: true,
    });
}

describe('UX 3.6 beta — every main-layout page', () => {
    it('finds the pages that use the main layout', () => {
        assert.ok(MAIN_LAYOUT_VIEWS.length >= 25, `only ${MAIN_LAYOUT_VIEWS.length} views found`);
    });

    MAIN_LAYOUT_VIEWS.forEach((file) => {
        describe(file, () => {
            it('renders under UX 3.5 without beta chrome or beta assets', () => {
                const html = render(file, 'ux35');
                assert.ok(html.length > 500, 'page rendered empty');
                assert.match(html, /data-ui-shell="ux35"/);
                assert.doesNotMatch(html, /ux36-sidebar/);
                assert.doesNotMatch(html, /\/css\/ux36\/(tokens|base|components|palette|shell|pages)\.css/);
                assert.doesNotMatch(html, /\/js\/ui-search\.js/);
                assert.doesNotMatch(html, /nav-more-toggle/);
            });

            it('renders under UX 3.6 with the grouped shell', () => {
                const html = render(file, 'ux36');
                assert.match(html, /data-ui-shell="ux36"/);
                assert.match(html, /class="ux35-shell ux36-shell" id="app"/);
                assert.match(html, /class="ux35-sidebar ux36-sidebar"/);
                assert.match(html, /\/css\/ux36\/pages\.css/);
                // Search and its server-built index load only in the beta.
                assert.match(html, /\/js\/ui-search\.js/);
                assert.match(html, /searchPages:/);
                // UX 3.5 assets stay shared, never forked.
                assert.match(html, /\/css\/ux35\.css/);
                assert.match(html, /\/js\/ux35-shell\.js/);
            });
        });
    });
});
