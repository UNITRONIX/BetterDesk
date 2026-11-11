'use strict';

/**
 * Główne → agent pairing must open the one-time code dialog.
 *
 * Operators reported the dashboard button (and the `/?activateAgent=1` deep link) opening the
 * QR scanner after short-code pairing shipped, which reads as "pair by QR" and hides the new
 * flow. These assertions keep the dashboard wired to the pairing-code modal while the QR
 * scanner stays available inside it.
 */

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const CONSOLE_ROOT = path.join(__dirname, '..');
const en = JSON.parse(fs.readFileSync(path.join(CONSOLE_ROOT, 'lang', 'en.json'), 'utf8'));

function translate(key) {
    const value = key.split('.').reduce((cur, part) => (
        cur && typeof cur === 'object' && part in cur ? cur[part] : undefined
    ), en);
    return typeof value === 'string' ? value : key;
}

function renderDashboard() {
    // `require` inside the test keeps a single EJS instance with the console app.
    const file = path.join(CONSOLE_ROOT, 'views', 'dashboard.ejs');
    return ejs.render(fs.readFileSync(file, 'utf8'), {
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
        embed: false,
        isSuperAdmin: true,
        hasPermission: () => true,
        currentPage: 'dashboard',
        currentTab: 'overview',
        breadcrumb: [],
        pageStyles: [],
        pageScripts: [],
        // The layout renders the shell sidebar, which asks for these.
        hasSectionAccess: () => true,
        activateAgentNav: false,
        consoleTab: '',
        isBetaShell: false,
        uiShell: 'ux35',
        buildConsoleNav: () => ({ sections: [], activeSection: null, activePage: null }),
    }, { filename: file, root: path.join(CONSOLE_ROOT, 'views') });
}

describe('dashboard agent pairing UI', () => {
    const html = renderDashboard();

    test('client-config card offers the pairing-code button', () => {
        expect(html).toContain('id="activate-agent-code-btn"');
        expect(html).toContain(en.dashboard.pair_with_code);
        expect(html).not.toContain('activate-agent-qr-btn');
    });

    test('pairing-code dialog renders with generate, copy and QR fallback', () => {
        expect(html).toContain('id="dashboard-pair-code-modal"');
        expect(html).toContain('id="dashboard-pair-code-generate"');
        expect(html).toContain('id="dashboard-pair-code-copy"');
        expect(html).toContain('id="dashboard-pair-code-scan"');
        expect(html).toContain(en.pairing.scan_qr_agent);
    });

    test('no unresolved template expressions leak into the page', () => {
        expect(html).not.toMatch(/\$\{[^}]*\}/);
    });
});

describe('dashboard pairing script wiring', () => {
    const script = fs.readFileSync(
        path.join(CONSOLE_ROOT, 'public', 'js', 'dashboard.js'), 'utf8');

    test('the deep link opens the code dialog, not the QR scanner', () => {
        // Główne → Pair agent now routes to /pairing instead of opening a dialog
        // over the dashboard; the route performs that redirect.
        const routes = fs.readFileSync(
            path.join(CONSOLE_ROOT, 'routes', 'dashboard.routes.js'), 'utf8');
        expect(routes).toContain("String(req.query.activateAgent || '') === '1'");
        expect(routes).toContain("res.redirect('/pairing')");
    });

    test('no surface links to the old dashboard deep link any more', () => {
        // /?activateAgent=1 rendered the dashboard behind a dialog. Every entry
        // now points at the pairing page, which is where a code is generated.
        const surfaces = [
            path.join(CONSOLE_ROOT, 'views', 'partials', 'ux35-sidebar.ejs'),
            path.join(CONSOLE_ROOT, 'views', 'agents.ejs'),
            path.join(CONSOLE_ROOT, 'lib', 'consoleNav.js'),
        ];
        surfaces.forEach((file) => {
            const text = fs.readFileSync(file, 'utf8');
            expect(text).not.toContain('href="/?activateAgent=1"');
        });

        const nav = fs.readFileSync(path.join(CONSOLE_ROOT, 'lib', 'consoleNav.js'), 'utf8');
        const entry = nav.slice(nav.indexOf("page: 'pairing'"), nav.indexOf("page: 'pairing'") + 220);
        expect(entry).toContain("href: '/pairing'");
        expect(entry).toContain('nav.pair_agent');
    });

    test('the pairing dialog is toggled with a class, never inline display', () => {
        // An inline display: flex left the overlay covering the panel while the
        // sheet kept it transparent (opacity: 0), so every click was swallowed.
        const script = fs.readFileSync(
            path.join(CONSOLE_ROOT, 'public', 'js', 'dashboard.js'), 'utf8');
        const openBlock = script.slice(
            script.indexOf('function openPairCodeModal'),
            script.indexOf('function openPairCodeModal') + 400);
        expect(openBlock).toContain("classList.add('open')");
        expect(openBlock).not.toContain('style.display');

        const closeBlock = script.slice(
            script.indexOf('function closePairCodeModal'),
            script.indexOf('function closePairCodeModal') + 400);
        expect(closeBlock).toContain("classList.remove('open')");
        expect(closeBlock).not.toContain('style.display');
    });

    test('code generation goes through the operator-only panel endpoint', () => {
        expect(script).toContain("'/api/panel/pairing/codes'");
        expect(script).toContain("method: 'POST'");
    });
});
