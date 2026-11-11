'use strict';

/**
 * Access control strategies live on their own page.
 *
 * They used to render as a card halfway down the Devices page
 * (`#devices-strategies-card`), which is not where anybody looks for a security
 * rule. The list, the dialogs and the endpoints are unchanged; only the place
 * moved. These tests keep the move in place and keep the Devices page from
 * quietly growing the card back.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const views = path.join(root, 'views');
const en = JSON.parse(fs.readFileSync(path.join(root, 'lang', 'en.json'), 'utf8'));
const { buildNav, SECTIONS } = require('../lib/consoleNav');

const translate = (key) => key.split('.').reduce((cur, part) => (
    cur && typeof cur === 'object' && part in cur ? cur[part] : undefined
), en) || key;

function pageLocals(shell, page) {
    const nav = buildNav({ t: translate, allows: () => true, can: () => true, role: 'admin', currentPage: page });
    return {
        _: translate,
        t: translate,
        req: { t: translate },
        title: translate('devices.strategies_title'),
        pageStyles: [],
        pageScripts: [],
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
    };
}

function render(file, shell, page) {
    const full = path.join(views, file);
    return ejs.render(fs.readFileSync(full, 'utf8'), pageLocals(shell, page), {
        filename: full,
        root: views,
        _with: true,
    });
}

describe('Access control strategies page', () => {
    it('renders its own list and the add button in both shells', () => {
        ['ux35', 'ux36'].forEach((shell) => {
            const html = render('strategies.ejs', shell, 'strategies');
            assert.match(html, /id="devices-strategies-list"/, `${shell}: list missing`);
            assert.match(html, /id="add-strategy-btn"/, `${shell}: add button missing`);
            assert.match(html, /devices\.strategies_title|Access control strategies/, `${shell}: title missing`);
            // The page stylesheet and script are its own, not the devices ones.
            assert.match(html, /\/css\/strategies\.css/, `${shell}: page sheet missing`);
            assert.match(html, /\/js\/strategies\.js/, `${shell}: page script missing`);
        });
    });

    it('does not render the old card or a duplicate link on the Devices page', () => {
        ['ux35', 'ux36'].forEach((shell) => {
            const html = render('devices.ejs', shell, 'devices');
            assert.doesNotMatch(html, /id="devices-strategies-card"/,
                `${shell}: the strategies card is back on the Devices page`);
            assert.doesNotMatch(html, /id="devices-strategies-list"/,
                `${shell}: the strategies list is rendered on the Devices page`);
            assert.doesNotMatch(html, /id="add-strategy-btn"/,
                `${shell}: the add-strategy button is rendered on the Devices page`);
            // The duplicate link went too: it pushed the page header down and
            // strategies already have a sidebar entry.
            assert.doesNotMatch(html, /devices-strategies-link/,
                `${shell}: the strategies link is back on the Devices page`);
        });
    });

    it('puts the devices header first in its own container', () => {
        // The header must be the page's first block: a stray row above it makes
        // the title look anchored to the bottom of the list.
        const view = read('views', 'devices.ejs');
        const bodyStart = view.indexOf('<div class="devices-page devices-layout">');
        assert.ok(bodyStart > -1, 'devices page container missing');
        const afterContainer = view.slice(bodyStart);
        const headerIndex = afterContainer.indexOf('class="devices-header"');
        const tileIndex = afterContainer.indexOf('class="devices-tile-bars"');
        assert.ok(headerIndex > -1 && tileIndex > -1);
        assert.ok(headerIndex < tileIndex, 'the header must come before the folder rail');
        // Nothing may sit between the container opening and the header.
        const between = afterContainer.slice(0, headerIndex);
        assert.doesNotMatch(between, /class="[^"]*strateg/i,
            'the strategies block is rendered above the header again');
    });

    it('is reachable from the sidebar in both shells', () => {
        const section = SECTIONS.find((s) => s.id === 'settings');
        const entry = section.pages.find((p) => p.page === 'strategies');
        assert.ok(entry, 'strategies entry missing from the navigation model');
        assert.strictEqual(entry.href, '/strategies');
        assert.strictEqual(entry.section, 'strategies');
        // It belongs with the other security rules, not with the device list.
        assert.strictEqual(entry.group, 'nav.group_rules');

        const stableSidebar = read('views', 'partials', 'ux35-sidebar.ejs');
        assert.match(stableSidebar, /href="\/strategies"/);
        assert.match(stableSidebar, /hasSectionAccess\('strategies'\)/);
    });

    it('serves the page through an authenticated route', () => {
        const routes = read('routes', 'pages.routes.js');
        assert.match(routes, /router\.get\('\/strategies', requireAuth, requirePermission\('device\.view'\)/);
        assert.match(routes, /res\.render\('strategies'/);
    });

    it('gates the page by the strategies panel section', () => {
        const guard = read('middleware', 'panelAccess.js');
        assert.match(guard, /prefix: '\/strategies', section: 'strategies'/);
        // The API prefix must stay mapped too — moving the page must not ungate it.
        assert.match(guard, /prefix: '\/api\/panel\/strategies', section: 'strategies'/);
    });

    it('keeps the strategy logic on the new page, not in devices.js', () => {
        const pageScript = read('public', 'js', 'strategies.js');
        const devicesScript = read('public', 'js', 'devices.js');

        // The page script owns the endpoints and the dialogs.
        ['/api/panel/strategies', 'showStrategyModal', 'showStrategyAssignModal'].forEach((token) => {
            assert.ok(pageScript.includes(token), `strategies.js should handle ${token}`);
        });

        // The Devices page must not carry the code any more.
        assert.doesNotMatch(devicesScript, /loadStrategies/,
            'devices.js still loads strategies');
        assert.doesNotMatch(devicesScript, /showStrategyModal/,
            'devices.js still opens the strategy dialog');
        assert.doesNotMatch(devicesScript, /panel\/strategies/,
            'devices.js still talks to the strategies API');
    });
});
