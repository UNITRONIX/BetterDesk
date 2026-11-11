'use strict';

/**
 * The pairing page is for the operator, not for the device.
 *
 * It used to look like a client setup form: a "Server address" field the operator
 * was expected to fill in, and a code only after pressing a button. That reads as
 * "pair this panel with a server", which is not what the page does — the panel IS
 * the server. The operator's only job is to hand a code to somebody installing the
 * client, so the page now mints one on arrival and shows the address to type.
 *
 * The client already supports this (BetterDesk-Client, "Connect with a code":
 * address + 6 characters), and the Go endpoint accepts exactly that.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const en = JSON.parse(read('lang', 'en.json'));
const { buildNav } = require('../lib/consoleNav');

const translate = (key) => key.split('.').reduce((cur, part) => (
    cur && typeof cur === 'object' && part in cur ? cur[part] : undefined
), en) || key;

function renderPage() {
    const nav = buildNav({ t: translate, allows: () => true, can: () => true, role: 'admin', currentPage: 'pairing' });
    const file = path.join(root, 'views', 'pairing.ejs');
    return ejs.render(fs.readFileSync(file, 'utf8'), {
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
        availableLanguages: {},
        themePalettes: {},
        embed: false,
        isSuperAdmin: true,
        hasPermission: () => true,
        hasSectionAccess: () => true,
        buildConsoleNav: () => nav,
        uiShell: 'ux36',
        currentPage: 'pairing',
        activePage: 'pairing',
        consoleTab: '',
        breadcrumb: [],
        suggested_host: 'desk.example.com',
    }, { filename: file, root: path.join(root, 'views'), _with: true });
}

describe('pairing page hands out a code', () => {
    const html = renderPage();
    const script = read('public', 'js', 'pairing.js');

    it('shows the code before the operator touches anything', () => {
        assert.match(html, /id="pairing-code"/, 'the code block is missing');
        // Minted on load, not on click: the page exists to give out a code.
        assert.match(script, /if \(\$\('pairing-code'\)\) generate\(\)/,
            'the page must mint a code on arrival');
    });

    it('no longer asks the operator for a server address', () => {
        // The old form had a host input; the panel already knows its own address.
        assert.doesNotMatch(html, /id="pairing-host"/, 'the server-address input is back');
        assert.doesNotMatch(html, /id="pairing-label"/, 'the operator should not have to label a pairing');
        // The address is still shown — it is what the user types.
        assert.match(html, /id="pairing-code-host"/);
        assert.match(html, new RegExp(en.pairing.client_address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });

    it('groups the code so it can be read aloud', () => {
        // 6 characters shown as ABC-DEF; the client strips separators.
        assert.match(script, /match\(\/\.\{1,3\}\/g\)/, 'the code should be grouped in threes');
        assert.match(script, /pairing-code-group/);
    });

    it('keeps the copy and regenerate controls', () => {
        assert.match(html, /id="pairing-copy"/);
        assert.match(html, /id="pairing-generate"/);
        assert.match(script, /navigator\.clipboard\.writeText/);
    });

    it('lists active codes so the operator can revoke one', () => {
        assert.match(html, /id="pairing-tbody"/);
        assert.match(script, /\/api\/panel\/pairing\/codes/);
        assert.match(html, new RegExp(en.common.refresh), 'the refresh label must resolve, not show a key');
    });

    it('has every string it renders in all locales', () => {
        const locales = fs.readdirSync(path.join(root, 'lang')).filter((f) => f.endsWith('.json'));
        const required = ['title', 'subtitle', 'code_hint', 'expires_in', 'copy', 'new_code',
            'client_address', 'active_title', 'active_hint', 'col_label', 'revoke'];
        const missing = [];
        for (const file of locales) {
            const json = JSON.parse(read('lang', file));
            for (const key of required) {
                if (!json.pairing || !json.pairing[key]) missing.push(`${file}:pairing.${key}`);
            }
            if (!json.common || !json.common.refresh) missing.push(`${file}:common.refresh`);
        }
        assert.deepStrictEqual(missing, []);
    });
});
