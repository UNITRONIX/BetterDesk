'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const uiShell = require('../lib/uiShell');
const { buildNav, pageKey, SECTIONS } = require('../lib/consoleNav');
const { PANEL_ACCESS_CATALOG } = require('../lib/panelAccessCatalog');

describe('UX 3.6 beta shell contract', () => {
    describe('shell resolver', () => {
        it('always resolves to UX 3.5 (retired beta is ignored)', () => {
            assert.strictEqual(uiShell.resolveShell({}), 'ux35');
            assert.strictEqual(uiShell.resolveShell({ query: {}, cookies: {} }), 'ux35');
            assert.strictEqual(uiShell.resolveShell({ query: { ui: 'ux36' } }), 'ux35');
            assert.strictEqual(uiShell.resolveShell({ query: {}, cookies: { bd_ui_shell: 'ux36' } }), 'ux35');
            assert.deepStrictEqual(uiShell.SUPPORTED_SHELLS, ['ux35']);
            assert.strictEqual(uiShell.isBetaShell('ux36'), false);
        });

        it('ignores removed and malformed values instead of failing', () => {
            ['classic', 'ux34', 'ux36', '', 'constructor', '__proto__', 'UX36<script>'].forEach((value) => {
                assert.strictEqual(uiShell.normalizeShell(value), null, value);
            });
            assert.strictEqual(uiShell.resolveShell({ query: { ui: 'classic' } }), 'ux35');
            assert.strictEqual(uiShell.resolveShell({ cookies: { bd_ui_shell: '  UX36  ' } }), 'ux35');
        });

        it('serves the shell cookie without marking it httpOnly', () => {
            const opts = uiShell.shellCookieOptions(true);
            assert.strictEqual(opts.httpOnly, false);
            assert.strictEqual(opts.secure, true);
            assert.strictEqual(opts.sameSite, 'lax');
        });
    });

    describe('navigation model', () => {
        const translate = (key) => key;
        const full = () => ({
            t: translate,
            allows: () => true,
            can: () => true,
            role: 'admin',
            currentPage: 'devices',
            currentTab: '',
            activateAgentNav: false,
        });

        it('groups every entry into the five redesign sections', () => {
            const nav = buildNav(full());
            assert.deepStrictEqual(nav.sections.map((s) => s.id), ['devices', 'support', 'people', 'activity', 'settings']);
        });

        it('never widens access: an empty panel policy hides everything', () => {
            const nav = buildNav({ ...full(), allows: () => false });
            assert.strictEqual(nav.sections.length, 0);
            assert.strictEqual(nav.activePage, null);
        });

        it('drops pages the role cannot use', () => {
            const limited = buildNav({ ...full(), can: () => false, allows: (p) => p.section === 'devices' });
            const pages = limited.sections.flatMap((s) => s.pages.map((p) => p.page));
            assert.ok(pages.includes('devices'));
            // server.config-only pages are permission gated
            assert.ok(!pages.includes('settings:backup'));
        });

        it('marks the active page for tab-scoped entries', () => {
            const nav = buildNav({ ...full(), currentPage: 'settings', currentTab: 'branding' });
            assert.strictEqual(nav.activeSection.id, 'settings');
            assert.strictEqual(nav.activePage.page, 'settings:branding');
            assert.strictEqual(pageKey('settings', 'branding', false), 'settings:branding');
        });

        it('treats the pairing page and the generator page as active entries', () => {
            // Pairing has one entry, pointing at its own page. It used to be a
            // dashboard deep link with a dialog on top, so it needed an alias.
            assert.strictEqual(pageKey('pairing', '', false), 'pairing');
            const pairingNav = buildNav({ ...full(), currentPage: 'pairing' });
            assert.strictEqual(pairingNav.activePage.page, 'pairing');
            assert.strictEqual(pairingNav.activePage.href, '/pairing');

            const nav = buildNav({ ...full(), currentPage: 'generator' });
            assert.strictEqual(nav.activePage.page, 'agents');
        });

        it('only points at translation keys that exist in English', () => {
            const en = JSON.parse(fs.readFileSync(path.join(root, 'lang', 'en.json'), 'utf8'));
            const has = (key) => {
                const value = key.split('.').reduce((cur, part) => (
                    cur && typeof cur === 'object' && part in cur ? cur[part] : undefined
                ), en);
                return typeof value === 'string' && value.trim().length > 0;
            };
            const missing = new Set();
            SECTIONS.forEach((section) => {
                if (!has(section.label)) missing.add(section.label);
                section.pages.forEach((page) => {
                    if (!has(page.label)) missing.add(page.label);
                    if (page.group && !has(page.group)) missing.add(page.group);
                });
            });
            assert.deepStrictEqual([...missing], []);
        });

        it('exposes a search index limited to what the role may open', () => {
            const { buildSearchPages } = require('../lib/consoleNav');
            const ctx = {
                t: translate,
                allows: () => true,
                can: () => true,
                role: 'admin',
            };
            const all = buildSearchPages(ctx);
            assert.ok(all.length > 30, 'index should cover every visible page');
            assert.ok(all.every((p) => typeof p.href === 'string' && p.href.length > 0));
            // Keywords make old page names findable after the regrouping.
            const keys = all.find((p) => p.href === '/keys');
            assert.match(keys.keywords, /rustdesk|keys/i);

            const restricted = buildSearchPages({ ...ctx, can: () => false, allows: () => true });
            const hrefs = restricted.map((p) => p.href);
            assert.ok(!hrefs.includes('/settings?tab=backup'));
            // Panel access still gates the index: nothing passes when it denies.
            assert.strictEqual(buildSearchPages({ ...ctx, allows: () => false }).length, 0);
        });

        it('keeps the search index and the sidebar on the same page list', () => {
            const { buildSearchPages } = require('../lib/consoleNav');
            const ctx = {
                t: translate,
                allows: () => true,
                can: () => true,
                role: 'admin',
                currentPage: 'devices',
            };
            const navHrefs = buildNav(ctx).sections
                .flatMap((s) => s.pages.map((p) => p.href)).sort();
            const searchHrefs = buildSearchPages(ctx).map((p) => p.href).sort();
            assert.deepStrictEqual(searchHrefs, navHrefs);
        });

        it('only points at panel access sections that exist in the catalog', () => {
            const known = new Set(PANEL_ACCESS_CATALOG.map((entry) => entry.key));
            SECTIONS.forEach((section) => {
                section.pages.forEach((page) => {
                    assert.ok(known.has(page.section), `${page.page} -> unknown section ${page.section}`);
                });
            });
        });
    });

    describe('layout and assets', () => {
        it('loads only the UX 3.5 console shell (UX 3.6 beta disconnected)', () => {
            const layout = read('views', 'layouts', 'main.ejs');
            assert.match(layout, /include\('\.\.\/partials\/ux35-topbar'\)/);
            assert.match(layout, /include\('\.\.\/partials\/ux35-sidebar'\)/);
            assert.doesNotMatch(layout, /ux36-topbar|ux36-sidebar/);
            assert.doesNotMatch(layout, /\/css\/ux36\//);
            assert.doesNotMatch(layout, /\/js\/ux36-shell\.js/);
            assert.match(layout, /\/js\/ui-search\.js/);
            assert.match(layout, /\/css\/ux35-tokens\.css/);
            assert.match(layout, /\/js\/ux35-shell\.js/);
            assert.match(layout, /const shell = 'ux35'/);
        });

        it('keeps the sidebar partial accessible and permission-driven', () => {
            const sidebar = read('views', 'partials', 'ux36-sidebar.ejs');
            assert.match(sidebar, /buildConsoleNav\(_navPage, _navTab, _navActivate\)/);
            assert.match(sidebar, /aria-expanded=/);
            assert.match(sidebar, /aria-current="page"/);
            assert.match(sidebar, /role="separator"/);
            // The contributor's structure: a <ul> per section.
            assert.match(sidebar, /<ul class="nav-list"/);
            assert.match(sidebar, /nav-section-icon/);
            // Visibility is decided server-side in the nav model, not in the view.
            assert.doesNotMatch(sidebar, /hasSectionAccess\(/);
        });

        it('renders the menu filter, the More row and the pre-paint restore', () => {
            const sidebar = read('views', 'partials', 'ux36-sidebar.ejs');
            // The filter input ux35-shell.js already binds to lives in the beta sidebar too.
            assert.match(sidebar, /id="ux35-sidebar-filter-input"/);
            // Sections split into core links plus their own "More" row.
            assert.match(sidebar, /nav-more-toggle/);
            assert.match(sidebar, /nav-more-list/);
            assert.match(sidebar, /_splitPages\(section\.pages\)/);
            // Restored before the first paint, with the keys ux35-shell.js writes.
            assert.match(sidebar, /<script nonce=/);
            assert.match(sidebar, /bd_ux35_sidebar_collapsed/);
            assert.match(sidebar, /bd_ux36_nav_more_open/);
            assert.match(sidebar, /bd_ux35_sidebar_width/);
            assert.match(sidebar, /bd_ux35_sidebar_scroll/);
        });

        it('loads global search on UX 3.5 and keeps retired UX 3.6 search chrome on disk', () => {
            const topbar = read('views', 'partials', 'ux36-topbar.ejs');
            assert.match(topbar, /data-global-search/);
            assert.match(topbar, /id="ux36-search-trigger"/);
            assert.match(topbar, /aria-keyshortcuts="Control\+K/);

            const layout = read('views', 'layouts', 'main.ejs');
            assert.match(layout, /\/js\/ui-search\.js/);
            assert.match(layout, /searchPages:/);
            assert.match(layout, /searchCaps:/);

            const client = read('public', 'js', 'ui-search.js');
            assert.ok(client.includes('window.BetterDesk.searchPages'));
            assert.ok(client.includes('window.BetterDesk.searchPages) || []'));
            assert.ok(client.includes('e.ctrlKey || e.metaKey'));
        });

        it('does not offer a shell switch in the UX 3.5 topbar', () => {
            const topbar = read('views', 'partials', 'ux35-topbar.ejs');
            assert.doesNotMatch(topbar, /id="ui-shell-toggle"/);
            assert.doesNotMatch(topbar, /ux36-shell-toggle|ux36-beta-chip|data-target-shell/);
            assert.doesNotMatch(topbar, /data-ui-shell-switch/);

            const html = ejs.render(topbar, {
                _: (key) => key,
                appName: 'BetterDesk',
                branding: {},
                user: { username: 'admin' },
                availableLanguageList: [],
                lang: 'en',
                currentPage: 'dashboard',
                uiShellBeta: false,
            }, { filename: path.join(root, 'views', 'partials', 'ux35-topbar.ejs') });
            assert.doesNotMatch(html, /science|BETA|ui-shell-toggle/);
            assert.match(html, /id="refresh-btn"/);
        });

        it('keeps the preference API CSRF-protected and UX 3.5-only', () => {
            const routes = read('routes', 'ui-shell.routes.js');
            assert.match(routes, /router\.post\('\/api\/ui-shell', requireAuth/);
            assert.match(routes, /SUPPORTED_SHELLS\.join/);
            assert.match(routes, /writeUx35Cookie|SHELL_UX35/);

            const client = read('public', 'js', 'ui-shell.js');
            assert.match(client, /X-CSRF-Token/);
            assert.match(client, /var SUPPORTED = \['ux35'\]/);
            assert.doesNotMatch(client, /initTopbarToggle|initSidebarSwitch|initSettingsChoice/);
        });

        it('removes the console interface switcher from Settings', () => {
            const settingsView = read('views', 'settings.ejs');
            assert.doesNotMatch(settingsView, /id="ux36-shell-panel"/);
            assert.doesNotMatch(settingsView, /name="ui-shell"/);
            assert.doesNotMatch(settingsView, /ux36\.credits/);
        });
    });

    describe('sidebar partial renders', () => {
        const renderSidebar = (currentPage = 'devices') => {
            const nav = buildNav({
                t: (key) => key,
                allows: () => true,
                can: () => true,
                role: 'admin',
                currentPage,
            });
            return ejs.render(read('views', 'partials', 'ux36-sidebar.ejs'), {
                _: (key) => key,
                currentPage,
                consoleTab: '',
                buildConsoleNav: () => nav,
                user: { username: 'admin', role: 'admin' },
                branding: {},
                cspNonce: 'nonce',
            }, { filename: path.join(root, 'views', 'partials', 'ux36-sidebar.ejs') });
        };

        it('renders grouped sections from the navigation model', () => {
            const html = renderSidebar();

            assert.match(html, /data-panel="devices"/);
            assert.match(html, /data-panel="settings"/);
            assert.match(html, /href="\/devices"/);
            assert.match(html, /id="reg-sidebar-badge"/);
            // The active item is the only one flagged for assistive tech.
            const current = html.match(/aria-current="page"/g) || [];
            assert.strictEqual(current.length, 1);
        });

        it('hides long sections behind their own More row', () => {
            const html = renderSidebar('devices');
            // Devices has ten entries: dashboard, devices and registrations stay
            // visible, the rest sit in the More list.
            assert.match(html, /data-more="devices"/);
            assert.match(html, /id="nav-more-devices"/);
            // The Devices page itself is a core link, not a hidden one.
            assert.match(html, /class="ux35-sidebar-item active"[\s\S]{0,200}href="\/devices"|href="\/devices"[\s\S]{0,200}class="ux35-sidebar-item active"/);
            // A section with a single extra page prints it directly.
            const support = html.slice(html.indexOf('data-panel="support"'), html.indexOf('data-panel="people"'));
            assert.doesNotMatch(support, /nav-more-toggle/);
        });
    });
});
