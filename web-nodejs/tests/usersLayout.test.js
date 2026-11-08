'use strict';

/**
 * Renders the Users page and checks the two-column structure: the groups
 * manager sits in a 25% rail on the left, the users table in the 75% pane on
 * the right, and the removed security-tips card no longer appears.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');

function renderUsersPage() {
    const en = JSON.parse(fs.readFileSync(path.join(root, 'lang', 'en.json'), 'utf8'));
    const _ = (key) => {
        const parts = key.split('.');
        let node = en;
        for (const part of parts) node = node && node[part];
        return typeof node === 'string' && node ? node : key;
    };
    const viewPath = path.join(root, 'views', 'users.ejs');
    return ejs.render(fs.readFileSync(viewPath, 'utf8'), {
        _,
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
        currentPage: 'users',
        shell: 'ux35',
        embed: true,
        hasPermission: () => true
    }, { filename: viewPath });
}

describe('Users page layout', () => {
    let html;

    beforeAll(() => {
        html = renderUsersPage();
    });

    it('drops the security best-practices card', () => {
        assert.doesNotMatch(html, /security-tips-card/);
        assert.doesNotMatch(html, /security_tips_title/);
    });

    it('places the groups manager in the left rail', () => {
        const sidebar = html.match(/<aside class="users-layout-sidebar">([\s\S]*?)<\/aside>/);
        assert.ok(sidebar, 'left rail (users-layout-sidebar) missing');
        assert.match(sidebar[1], /id="user-groups"/);
        assert.match(sidebar[1], /id="user-groups-manager-list"/);
        assert.match(sidebar[1], /id="add-user-group-btn"/);
    });

    it('places the users table in the right pane', () => {
        const main = html.match(/<div class="users-layout-main">([\s\S]*?)\n\s{8}<\/div>/);
        assert.ok(main, 'right pane (users-layout-main) missing');
        assert.match(main[1], /id="users-table"/);
        assert.match(main[1], /id="users-tbody"/);
        assert.match(main[1], /id="users-empty"/);
        assert.doesNotMatch(main[1], /users\.actions/);
    });

    it('exposes a right-click context menu host instead of an actions column', () => {
        assert.match(html, /id="users-context-menu"/);
        assert.match(html, /class="users-context-menu"/);
        const css = fs.readFileSync(path.join(root, 'public', 'css', 'users.css'), 'utf8');
        assert.match(css, /\.users-context-menu\s*\{/);
        assert.match(css, /tr\.user-row\s*\{[\s\S]*?cursor:\s*context-menu/);
        const js = fs.readFileSync(path.join(root, 'public', 'js', 'users.js'), 'utf8');
        assert.match(js, /addEventListener\('contextmenu'/);
        assert.match(js, /function buildUserMenuHtml/);
        assert.match(js, /function buildUserGroupMenuHtml/);
        assert.match(js, /user-group-manager-item\[data-guid\]/);
        assert.doesNotMatch(js, /class="user-actions"/);
    });

    it('includes the three-state policy matrix and client feature toggles', () => {
        assert.match(html, /user-access-policy-editor/);
        const js = fs.readFileSync(path.join(root, 'public', 'js', 'users.js'), 'utf8');
        assert.match(js, /data-policy-section/);
        assert.match(js, /data-policy-feature/);
        assert.match(js, /\/api\/panel\/access\/users/);
        assert.match(js, /\/api\/panel\/access\/groups/);
    });

    it('splits the layout 25/75 and collapses on narrow screens', () => {
        const css = fs.readFileSync(path.join(root, 'public', 'css', 'users.css'), 'utf8');
        assert.match(
            css,
            /\.users-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*3fr\)/
        );
        assert.match(css, /@media \(max-width: 1199px\)\s*\{[\s\S]*?\.users-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    });

    it('keeps the groups rail from pushing the table out of view', () => {
        const css = fs.readFileSync(path.join(root, 'public', 'css', 'users.css'), 'utf8');
        assert.match(css, /\.users-layout-sidebar\s*\{[\s\S]*?min-width:\s*0/);
        assert.match(css, /\.users-layout-main\s*\{[\s\S]*?min-width:\s*0/);
    });
});
