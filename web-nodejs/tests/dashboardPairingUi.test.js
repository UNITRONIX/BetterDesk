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
        const block = script.slice(
            script.indexOf("params.get('activateAgent')"),
            script.indexOf("params.get('activateAgent')") + 400);
        expect(block).toContain('openPairCodeModal()');
        expect(block).not.toContain('openAgentActivation()');
    });

    test('code generation goes through the operator-only panel endpoint', () => {
        expect(script).toContain("'/api/panel/pairing/codes'");
        expect(script).toContain("method: 'POST'");
    });
});
