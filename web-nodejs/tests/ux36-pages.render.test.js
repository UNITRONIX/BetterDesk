'use strict';

/**
 * UX 3.6 beta — render smoke tests.
 *
 * Renders the pages whose layout the beta changes (dashboard, devices,
 * settings) in both shells and asserts the contract: UX 3.5 output is
 * unchanged, UX 3.6 swaps only the sidebar partial and adds its own assets,
 * and neither shell loses a page feature or an accessibility hook.
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
    return typeof value === 'string' ? value : key;
}

function renderPage(file, shell, currentPage) {
    const full = path.join(views, file);
    const nav = buildNav({
        t: translate,
        allows: () => true,
        can: () => true,
        role: 'admin',
        currentPage,
    });
    return ejs.render(fs.readFileSync(full, 'utf8'), {
        _: translate,
        t: translate,
        lang: 'en',
        appName: 'BetterDesk',
        appDescription: 'test',
        cacheVersion: 'test',
        cspNonce: 'nonce',
        csrfToken: 'csrf',
        user: { username: 'admin', role: 'admin' },
        branding: {},
        translations: {},
        availableLanguageList: [],
        themePalettes: {},
        embed: false,
        isSuperAdmin: true,
        hasPermission: () => true,
        hasSectionAccess: () => true,
        buildConsoleNav: () => nav,
        uiShell: shell,
        activePage: currentPage,
        currentPage,
        consoleTab: '',
        breadcrumb: [],
        canServerConfig: true,
        canBrandingEdit: true,
        sessionPolicy: null,
        availableLanguages: {},
        appVersion: '3.6.0-test',
    }, { filename: full, root: views });
}

describe('UX 3.6 beta pages render in both shells', () => {
    const pages = [
        { file: 'dashboard.ejs', page: 'dashboard' },
        { file: 'devices.ejs', page: 'devices' },
        { file: 'settings.ejs', page: 'settings' },
    ];

    pages.forEach(({ file, page }) => {
        it(`renders ${file} under UX 3.5 without beta shell assets`, () => {
            const html = renderPage(file, 'ux35', page);
            assert.ok(html.length > 1000, 'page rendered empty');
            assert.match(html, /data-ui-shell="ux35"/);
            assert.match(html, /class="ux35-shell" id="app"/);
            assert.doesNotMatch(html, /\/css\/ux36\.css/);
            assert.doesNotMatch(html, /\/js\/ux36-shell\.js/);
            assert.doesNotMatch(html, /class="ux35-sidebar ux36-sidebar"/);
            assert.doesNotMatch(html, /class="ux35-shell ux36-shell/);
            // The flat UX 3.5 sidebar is still rendered.
            assert.match(html, /data-panel="management"/);
        });

        it(`renders ${file} under UX 3.6 with the grouped sidebar only`, () => {
            const html = renderPage(file, 'ux36', page);
            assert.match(html, /data-ui-shell="ux36"/);
            assert.match(html, /class="ux35-shell ux36-shell" id="app"/);
            assert.match(html, /class="ux35-sidebar ux36-sidebar"/);
            assert.match(html, /\/css\/ux36\.css/);
            assert.match(html, /\/js\/ux36-shell\.js/);
            // UX 3.5 chrome assets stay shared, never forked.
            assert.match(html, /\/css\/ux35\.css/);
            assert.match(html, /\/js\/ux35-shell\.js/);
            // Grouped navigation replaces the flat list.
            assert.match(html, /data-panel="devices"/);
            assert.match(html, /data-panel="settings"/);
        });
    });

    it('keeps the shell preference control on the Settings page', () => {
        const html = renderPage('settings.ejs', 'ux36', 'settings');
        assert.match(html, /id="ux36-shell-panel"/);
        assert.match(html, /data-current-shell="ux36"/);
        assert.match(html, /name="ui-shell" value="ux35" >/);
        assert.match(html, /name="ui-shell" value="ux36" checked>/);
    });

    it('marks the active navigation item for assistive tech', () => {
        const beta = renderPage('devices.ejs', 'ux36', 'devices');
        const current = beta.match(/aria-current="page"/g) || [];
        assert.strictEqual(current.length, 1, `ux36: ${current.length} aria-current markers`);

        // UX 3.5 markup is unchanged: it flags the active item with a class.
        const stable = renderPage('devices.ejs', 'ux35', 'devices');
        assert.match(stable, /class="ux35-sidebar-item active"/);
    });

    it('keeps embed mode free of chrome in both shells', () => {
        const full = path.join(views, 'devices.ejs');
        ['ux35', 'ux36'].forEach((shell) => {
            const html = ejs.render(fs.readFileSync(full, 'utf8'), {
                _: translate,
                lang: 'en',
                appName: 'BetterDesk',
                appDescription: 'test',
                cacheVersion: 'test',
                cspNonce: 'nonce',
                csrfToken: 'csrf',
                user: { username: 'admin', role: 'admin' },
                branding: {},
                translations: {},
                availableLanguageList: [],
                themePalettes: {},
                embed: true,
                isSuperAdmin: true,
                hasPermission: () => true,
                hasSectionAccess: () => true,
                buildConsoleNav: () => ({ sections: [] }),
                uiShell: shell,
                currentPage: 'devices',
                breadcrumb: [],
            }, { filename: full, root: views });
            assert.doesNotMatch(html, /ux36-sidebar/);
            assert.doesNotMatch(html, /ux35-sidebar/);
        });
    });
});
