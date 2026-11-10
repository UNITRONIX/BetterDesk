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
        it('defaults to UX 3.5 and accepts only known shells', () => {
            assert.strictEqual(uiShell.resolveShell({}), 'ux35');
            assert.strictEqual(uiShell.resolveShell({ query: {}, cookies: {} }), 'ux35');
            assert.strictEqual(uiShell.resolveShell({ query: { ui: 'ux36' } }), 'ux36');
            assert.strictEqual(uiShell.resolveShell({ query: {}, cookies: { bd_ui_shell: 'ux36' } }), 'ux36');
        });

        it('ignores removed and malformed values instead of failing', () => {
            ['classic', 'ux34', '', 'constructor', '__proto__', 'UX36<script>'].forEach((value) => {
                assert.strictEqual(uiShell.normalizeShell(value), null, value);
            });
            assert.strictEqual(uiShell.resolveShell({ query: { ui: 'classic' } }), 'ux35');
            assert.strictEqual(uiShell.resolveShell({ cookies: { bd_ui_shell: '  UX36  ' } }), 'ux36');
        });

        it('serves the beta cookie without marking it httpOnly', () => {
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

        it('treats activation and generator pages as active aliases', () => {
            assert.strictEqual(pageKey('devices', '', true), 'activate-agent');
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
        it('renders the grouped sidebar and its own design system for UX 3.6 only', () => {
            const layout = read('views', 'layouts', 'main.ejs');
            assert.match(layout, /include\(isBetaShell \? '\.\.\/partials\/ux36-topbar' : '\.\.\/partials\/ux35-topbar'\)/);
            assert.match(layout, /include\(isBetaShell \? '\.\.\/partials\/ux36-sidebar' : '\.\.\/partials\/ux35-sidebar'\)/);
            // The contributor's design system, loaded for the beta only.
            ['palette', 'tokens', 'base', 'components', 'legacy-bridge', 'shell', 'pages'].forEach((sheet) => {
                assert.match(layout, new RegExp(`/css/ux36/${sheet}\\.css`), `missing ${sheet}.css`);
            });
            // Shared chrome (switch + badge) loads in both shells.
            assert.match(layout, /\/css\/ux36\/shared-chrome\.css/);
            // UX 3.5 assets stay shared, never forked.
            assert.match(layout, /\/css\/ux35-tokens\.css/);
            assert.match(layout, /\/js\/ux35-shell\.js/);
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

        it('offers the shell switch in the topbar of both shells, with a beta badge', () => {
            const topbar = read('views', 'partials', 'ux35-topbar.ejs');
            // Always the same control; only its target/icon/label flips.
            assert.match(topbar, /id="ui-shell-toggle"/);
            assert.match(topbar, /data-target-shell=/);
            assert.match(topbar, /ux36-beta-chip/);
            // The switch is a plain settings action, never a competing shell switch widget.
            assert.doesNotMatch(topbar, /data-ui-shell-switch/);

            const render = (uiShellBeta) => ejs.render(topbar, {
                _: (key) => key,
                appName: 'BetterDesk',
                branding: {},
                user: { username: 'admin' },
                availableLanguageList: [],
                lang: 'en',
                currentPage: 'dashboard',
                uiShellBeta,
            }, { filename: path.join(root, 'views', 'partials', 'ux35-topbar.ejs') });

            // UX 3.5: offers the beta, so it carries the BETA badge.
            const stable = render(false);
            assert.match(stable, /data-target-shell="ux36"/);
            assert.match(stable, /ux36-beta-chip/);

            // UX 3.6: the same button goes back, and no beta badge is needed.
            const beta = render(true);
            assert.match(beta, /data-target-shell="ux35"/);
            assert.doesNotMatch(beta, /ux36-beta-chip/);
        });

        it('skips the beta palette when the operator uses custom colours', () => {
            const layout = read('views', 'layouts', 'main.ejs');
            assert.match(layout, /branding\.themeMode !== 'custom'/);
        });

        it('exposes the shell switch through a CSRF-protected endpoint', () => {
            const routes = read('routes', 'ui-shell.routes.js');
            assert.match(routes, /router\.post\('\/api\/ui-shell', requireAuth/);
            assert.match(routes, /SUPPORTED_SHELLS\.join/);
            assert.match(routes, /res\.cookie\(SHELL_COOKIE, shell/);

            // The client bridge owns the request, because the toggle renders in
            // both shells (ux36-shell.js only adds beta-specific behaviour).
            const client = read('public', 'js', 'ui-shell.js');
            assert.match(client, /X-CSRF-Token/);
            assert.match(client, /window\.location\.reload\(\)/);
            assert.match(client, /initTopbarToggle/);
            assert.match(client, /initSidebarSwitch/);
            assert.match(client, /initSettingsChoice/);

            const beta = read('public', 'js', 'ux36-shell.js');
            assert.doesNotMatch(beta, /fetch\('\/api\/ui-shell'/);
        });

        it('offers the beta choice in Settings without touching branding logic', () => {
            const settingsView = read('views', 'settings.ejs');
            assert.match(settingsView, /id="ux36-shell-panel"/);
            assert.match(settingsView, /name="ui-shell" value="ux36"/);
            assert.match(settingsView, /ux36\.credits/);
            // Credit links must point at the contributor and the design threads.
            assert.match(settingsView, /href="https:\/\/github\.com\/rathlinus"/);
            assert.match(settingsView, /issues\/493/);
            assert.match(settingsView, /pull\/495/);
        });
    });

    describe('sidebar partial renders', () => {
        it('renders grouped sections from the navigation model', () => {
            const viewPath = path.join(root, 'views', 'partials', 'ux36-sidebar.ejs');
            const nav = buildNav({
                t: (key) => key,
                allows: () => true,
                can: () => true,
                role: 'admin',
                currentPage: 'devices',
            });
            const html = ejs.render(read('views', 'partials', 'ux36-sidebar.ejs'), {
                _: (key) => key,
                currentPage: 'devices',
                consoleTab: '',
                buildConsoleNav: () => nav,
                user: { username: 'admin', role: 'admin' },
                branding: {},
            }, { filename: viewPath });

            assert.match(html, /data-panel="devices"/);
            assert.match(html, /data-panel="settings"/);
            assert.match(html, /href="\/devices"/);
            assert.match(html, /id="reg-sidebar-badge"/);
            // The active item is the only one flagged for assistive tech.
            const current = html.match(/aria-current="page"/g) || [];
            assert.strictEqual(current.length, 1);
        });
    });
});
