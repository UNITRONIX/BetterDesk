'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

describe('UX 3.5 mobile and accessibility contracts', () => {
    const mobileCss = read('public', 'css', 'mobile-shell.css');
    const pagesCss = read('public', 'css', 'pages.css');
    const ux35Css = read('public', 'css', 'ux35.css');
    const shellJs = read('public', 'js', 'ux35-shell.js');
    const settingsJs = read('public', 'js', 'settings.js');
    const mobileJs = read('public', 'js', 'mobile-nav.js');
    const topbar = read('views', 'partials', 'ux35-topbar.ejs');
    const bottomNav = read('views', 'partials', 'mobile-bottom-nav.ejs');
    const sidebar = read('views', 'partials', 'ux35-sidebar.ejs');
    const navItem = read('views', 'partials', 'nav-item.ejs');
    const consoleNav = read('lib', 'consoleNav.js');
    const layout = read('views', 'layouts', 'main.ejs');
    const automation = read('public', 'js', 'automation.js');
    const appJs = read('public', 'js', 'app.js');
    const devicesJs = read('public', 'js', 'devices.js');
    const registrationRoutes = read('routes', 'registration.routes.js');
    const notifCenter = read('public', 'js', 'notif-center.js');
    const uiShell = read('public', 'js', 'ui-shell.js');
    const classicNavbar = read('views', 'partials', 'navbar.ejs');
    const settingsView = read('views', 'settings.ejs');
    const loginJs = read('public', 'js', 'login.js');
    const loginView = read('views', 'login.ejs');
    const desktopLoginJs = read('public', 'js', 'desktop-login.js');
    const desktopLoginView = read('views', 'desktop-login.ejs');

    it('keeps classic mobile height rules out of the UX 3.5 scroll region', () => {
        assert.match(mobileCss, /\.app-layout \.main-content/);
        assert.match(mobileCss, /\.ux35-content\.main-content/);
        assert.match(mobileCss, /--ux35-topbar-height/);
    });

    it('uses a single UX 3.5 drawer from the mobile More control', () => {
        assert.match(mobileJs, /function isUx35Drawer/);
        assert.match(mobileJs, /setAttribute\('aria-controls', 'ux35-sidebar'\)/);
        assert.doesNotMatch(mobileJs, /\/\* UX 3\.5: full-list sidebar sections \*\//);
    });

    it('provides responsive action overflow and visible keyboard focus', () => {
        assert.match(topbar, /ux35-actions-menu-btn/);
        assert.match(topbar, /aria-controls="ux35-topbar-action-list"/);
        assert.match(ux35Css, /\.ux35-topbar-btn:focus-visible/);
        assert.match(ux35Css, /\.ux35-topbar-action-list\.is-open/);
    });

    it('makes drawer and sidebar resize interactions keyboard accessible', () => {
        assert.match(sidebar, /role="separator"/);
        assert.match(sidebar, /aria-valuemin="200"/);
        assert.match(shellJs, /focusableIn/);
        assert.match(shellJs, /e\.key === 'ArrowLeft'/);
        assert.match(shellJs, /sidebar\.inert/);
    });

    it('only renders aria-current for the active bottom navigation item', () => {
        assert.doesNotMatch(bottomNav, /aria-current="<%= .*: 'false' %>"/);
        assert.match(bottomNav, /aria-current="page"/);
    });

    it('points mobile bottom-nav Remote at the live /remote route', () => {
        assert.match(bottomNav, /href="\/remote"/);
        assert.match(bottomNav, /data-nav="remote"/);
        assert.doesNotMatch(bottomNav, /href="\/remote-dashboard"/);
    });

    it('escapes dynamic automation values before inserting rule rows', () => {
        // The threshold cell goes through escapeHtml (formatted as a number, or the empty dash for custom rules)
        assert.match(automation, /<td class="is-num">\$\{[^\n]*escapeHtml\([^\n]*r\.condition_value[^\n]*\}<\/td>/);
        assert.doesNotMatch(automation, /<td[^>]*>\$\{r\.condition_value\}<\/td>/);
        assert.match(automation, /function safeSeverity/);
        assert.match(automation, /function safeStatus/);
    });

    it('defers console scripts without changing their document order', () => {
        assert.match(layout, /<script defer src="\/js\/utils\.js/);
        assert.match(layout, /<script defer src="\/js\/ux35-shell\.js/);
        assert.match(layout, /<script defer src="\/js\/<%= script %>\.js/);
    });

    it('keeps registration notifications visible without opening the registrations page', () => {
        assert.match(appJs, /\/ws\/panel-events/);
        assert.match(appJs, /registrations:pending-changed/);
        assert.match(appJs, /setInterval\(updateBadge, 15000\)/);
        assert.match(notifCenter, /data\.unread_count/);
        assert.match(notifCenter, /registration_pending/);
        assert.match(topbar, /id="notif-badge"/);
        assert.match(topbar, /href="\/registrations"/);
        assert.match(consoleNav, /countId: 'reg-sidebar-badge'/);
        assert.match(navItem, /id="<%= item.countId %>"/);
    });

    it('keeps the notification badge hidden when unread count is zero', () => {
        assert.match(notifCenter, /if \(count > 0\)/);
        assert.match(notifCenter, /dom\.badge\.hidden = true/);
        assert.match(notifCenter, /dom\.badge\.setAttribute\('aria-hidden', 'true'\)/);
        assert.match(topbar, /id="notif-badge" hidden aria-hidden="true"/);
    });

    it('refreshes the Devices list after managed or LAN approval', () => {
        assert.match(appJs, /data\.type === 'registration_changed'/);
        assert.match(appJs, /new CustomEvent\('app:refresh'/);
        assert.match(devicesJs, /window\.addEventListener\('app:refresh'/);
        assert.match(registrationRoutes, /publishPanelEvent\(\{/);
        assert.match(registrationRoutes, /type: 'registration_changed'/);
    });

    it('uses UX 3.5 as the only shell without beta or classic switch controls', () => {
        assert.match(layout, /const shell = 'ux35'/);
        assert.match(uiShell, /return 'ux35'/);
        assert.doesNotMatch(topbar, /ux35-beta-chip|data-ui-shell-switch/);
        assert.doesNotMatch(topbar, /beta_tooltip|beta_badge/);
        assert.doesNotMatch(classicNavbar, /navbar-btn--shell-beta|ui-shell-beta-badge|data-ui-shell-switch/);
    });

    it('renders the settings tab named by currentTab (?tab=) and sends old #tab links there', () => {
        // Each settings tab is its own page in the sidebar; there is no in-page tab bar.
        assert.match(settingsView, /typeof currentTab !== 'undefined' && currentTab \? currentTab : 'general'/);
        assert.match(settingsView, /currentTab: tab,/);
        assert.match(settingsView, /name === tab \? '' : 'hidden'/);
        assert.match(settingsView, /data-current-tab="\$\{tab\}"/);
        assert.doesNotMatch(settingsView, /settings-shell-nav/);
        assert.match(settingsJs, /function redirectHashTab\(\)/);
        assert.match(settingsJs, /params\.set\('tab', name\)/);
    });

    it('keeps OIDC password recovery explicit on the login page', () => {
        assert.match(loginJs, /params\.get\('autoLaunch'\) === '0'/);
        assert.match(loginJs, /data\.prefer_sso && !passwordBypass && !data\.local_bypass && !hasOidcError/);
        assert.match(loginJs, /window\.location\.replace\('\/api\/auth\/oidc\/authorize'\)/);
    });

    it('shows session-expired as a toast instead of stretching the login card', () => {
        assert.match(loginView, /\/js\/notifications\.js/);
        assert.match(loginJs, /function showSessionExpiredNotice/);
        assert.match(loginJs, /Notifications\.error\(message\)/);
        assert.match(loginJs, /params\.get\('expired'\) !== '1'/);
        assert.match(desktopLoginView, /\/js\/notifications\.js/);
        assert.match(desktopLoginJs, /params\.get\('expired'\) === '1'/);
        assert.match(desktopLoginJs, /Notifications\.error\(message\)/);
    });

    it('supports split login promo modes and editable slides in branding', () => {
        assert.match(loginView, /login-layout-<%= promoMode %>/);
        assert.match(loginView, /login-promo-slide/);
        assert.match(loginJs, /function initLoginPromoCarousel/);
        assert.match(settingsView, /name="login-promo-mode"/);
        assert.match(settingsView, /id="login-slides-panel"/);
        assert.match(settingsJs, /MAX_LOGIN_SLIDES = 10/);
        assert.match(settingsJs, /function renderLoginSlidesEditor/);
        assert.match(settingsJs, /loginPromoMode/);
        assert.match(settingsJs, /loginSlides/);
    });

    it('keeps personal TOTP in Sign-in for everyone while gating admin panels', () => {
        const auth = settingsView.slice(settingsView.indexOf("panelAttrs('auth')"), settingsView.indexOf("panelAttrs('backup')"));
        const everyoneAt = auth.lastIndexOf('${canServerConfig', auth.indexOf('for-everyone-title'));
        const yourAccount = auth.slice(auth.indexOf('your-account-title'), everyoneAt);
        // Your own password and two-factor setup are not behind a permission check
        assert.match(yourAccount, /id="password-form"/);
        assert.match(yourAccount, /id="auth-panel-totp"/);
        assert.doesNotMatch(yourAccount, /canServerConfig/);
        const accountAt = auth.indexOf('<section class="section" aria-labelledby="your-account-title">');
        assert.ok(accountAt > 0);
        assert.doesNotMatch(auth.slice(Math.max(0, accountAt - 40), accountAt), /canServerConfig \? `\s*$/);
        // Server-wide sign-in options need server.config
        assert.match(auth, /\$\{canServerConfig \? `\s*<section class="section" aria-labelledby="for-everyone-title">/);
        assert.match(auth.slice(auth.indexOf('for-everyone-title')), /id="ldap-form"[\s\S]*id="oidc-form"/);
        assert.match(settingsJs, /initTotpSection\(\)/);
    });
});
