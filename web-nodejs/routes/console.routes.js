/**
 * BetterDesk Console - endpoints for the Svelte console (web-ui/)
 *
 * GET /console-boot.js         Public. Runs in <head> before first paint: sets
 *                              theme, language and direction on <html> and
 *                              starts the bootstrap and strings requests.
 *                              Holds only what the login page shows anyway.
 * GET /api/console/bootstrap   Signed in. Everything the console needs to
 *                              render for this person in one response.
 * GET /api/console/strings/:code
 *                              Public. One language's strings merged over
 *                              English, cached for a year under ?v=<revision>.
 * GET /api/console/supporters  Signed in. The Help panel's supporters and links.
 *
 * The old pages keep their own calls (window.BetterDesk, /api/i18n/*).
 */

'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const express = require('express');
const config = require('../config/config');
const { requireAuth, requestHasPermission, isSuperAdminRole } = require('../middleware/auth');
const { buildNav } = require('../lib/consoleNav');
const { manager } = require('../services/i18nService');
const brandingService = require('../services/brandingService');
const panelSessionService = require('../services/panelSessionService');
const avatarService = require('../services/avatarService');
const supportersService = require('../services/supportersService');

const router = express.Router();

/**
 * Every permission the console checks in the browser. The server checks each
 * request on its own; this list only decides what the UI hides.
 */
const UI_PERMISSIONS = Object.freeze([
    'server.config', 'server.keys', 'server.attestation', 'blocklist.edit',
    'device.edit', 'device.view', 'device.connect', 'device.ban', 'device.delete',
    'device.connection_mode', 'device.change_id',
    'org.manage_devices', 'org.manage_users', 'org.create', 'org.edit', 'org.delete',
    'branding.edit', 'enrollment.approve', 'enrollment.manage',
    'billing.view', 'billing.manage', 'billing.reports', 'billing.export',
    'audit.view', 'user.view', 'user.create', 'user.edit', 'user.delete', 'metrics.view',
    'remote_target.view', 'remote_target.edit', 'remote_target.delete',
    'remote_target.connect', 'remote_target.test',
    'guest.create', 'chat.access', 'cdap.view', 'cdap.command', 'cdap.terminal', 'cdap.files',
    'mesh.terminal', 'mesh.power', 'mesh.files'
]);

const LANG_CODE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

// Strings revision per language: a hash of the merged JSON, computed once per
// process (language files are read at startup).
const stringsCache = new Map();
function stringsFor(code) {
    let entry = stringsCache.get(code);
    if (!entry) {
        const body = JSON.stringify(manager.getMergedTranslations(code));
        const revision = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
        entry = { body, revision, br: null, gzip: null };
        stringsCache.set(code, entry);
    }
    return entry;
}

/** The strings compressed once per language (about 423 KB of JSON for English) */
function compressed(entry, encoding) {
    if (encoding === 'br') {
        entry.br = entry.br || zlib.brotliCompressSync(entry.body, {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 }
        });
        return entry.br;
    }
    entry.gzip = entry.gzip || zlib.gzipSync(entry.body, { level: 9 });
    return entry.gzip;
}

function languageList() {
    return manager.getAvailableList().map((l) => ({
        code: l.code,
        name: l.name,
        native: l.native || l.name,
        flag: l.flag || '',
        rtl: !!l.rtl
    }));
}

/** What the pre-paint script and the login page may know: no user data. */
function publicBoot(req) {
    const lang = req.lang || config.defaultLanguage || 'en';
    const meta = manager.getLanguageMeta(lang) || {};
    const branding = brandingService.getBranding() || {};
    const palettes = brandingService.getThemePalettes() || {};
    return {
        lang,
        dir: meta.rtl ? 'rtl' : 'ltr',
        themeMode: branding.themeMode || 'system',
        palettes: { light: palettes.light || null, dark: palettes.dark || null },
        brandingRevision: brandingService.getBrandingRevision(),
        stringsUrl: `/api/console/strings/${encodeURIComponent(lang)}?v=${stringsFor(lang).revision}`
    };
}

// Runs synchronously in <head>. Keep it small and dependency free; it must
// not throw when storage is blocked.
const BOOT_SCRIPT = `(function (boot) {
    var root = document.documentElement;
    var VARS = {
        bgPrimary: '--bg-primary', bgSecondary: '--bg-secondary', bgTertiary: '--bg-tertiary',
        bgElevated: '--bg-elevated', textPrimary: '--text-primary', textSecondary: '--text-secondary',
        accentBlue: '--accent-blue', accentBlueHover: '--accent-blue-hover', accentBlueMuted: '--accent-blue-muted',
        accentGreen: '--accent-green', accentGreenHover: '--accent-green-hover', accentGreenMuted: '--accent-green-muted',
        accentRed: '--accent-red', accentRedHover: '--accent-red-hover', accentRedMuted: '--accent-red-muted',
        accentYellow: '--accent-yellow', accentYellowHover: '--accent-yellow-hover', accentYellowMuted: '--accent-yellow-muted',
        accentPurple: '--accent-purple', accentPurpleHover: '--accent-purple-hover', accentPurpleMuted: '--accent-purple-muted',
        borderPrimary: '--border-primary', borderSecondary: '--border-secondary'
    };
    function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    root.lang = boot.lang;
    root.dir = boot.dir;
    root.setAttribute('data-theme-mode', boot.themeMode);
    var choice = get('bd-theme-choice');
    var mode = boot.themeMode;
    if ((choice === 'light' || choice === 'dark') && boot.palettes[choice]) {
        root.setAttribute('data-theme-default', boot.themeMode);
        root.setAttribute('data-theme-mode', choice);
        mode = choice;
        var p = boot.palettes[choice];
        for (var k in VARS) { if (p[k]) root.style.setProperty(VARS[k], p[k]); }
    }
    var theme = mode === 'dark' ? 'dark' : 'light';
    if (mode === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) theme = 'dark';
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    // Accessibility panel settings: same key, defaults and limits as
    // public/js/accessibility.js and web-ui/src/lib/shell/a11y.svelte.ts
    var a = {};
    try { a = JSON.parse(get('betterdesk_accessibility_v1') || '{}') || {}; } catch (e) { a = {}; }
    function num(v, min, max, d) { v = Number(v); return isFinite(v) ? Math.min(max, Math.max(min, v)) : d; }
    var fontScale = num(a.fontScale, 90, 160, 100), lineHeight = num(a.lineHeight, 1.2, 2.1, 1.5);
    var letter = num(a.letterSpacing, 0, 0.14, 0), word = num(a.wordSpacing, 0, 0.22, 0), sat = num(a.saturation, 0, 180, 100);
    var contrast = ['normal', 'high-dark', 'high-light', 'yellow-black'].indexOf(a.contrast) >= 0 ? a.contrast : 'normal';
    var filter = ['none', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'].indexOf(a.colorFilter) >= 0 ? a.colorFilter : 'none';
    var FLAGS = { readableFont: 'a11yReadableFont', dyslexiaFont: 'a11yDyslexia', underlineLinks: 'a11yUnderlineLinks',
        highlightLinks: 'a11yHighlightLinks', highlightHeadings: 'a11yHighlightHeadings', strongFocus: 'a11yStrongFocus',
        largeCursor: 'a11yLargeCursor', reduceMotion: 'a11yReduceMotion', pauseAnimations: 'a11yPauseAnimations',
        readingGuide: 'a11yReadingGuide', readingMask: 'a11yReadingMask', hideMedia: 'a11yHideMedia' };
    var active = fontScale !== 100 || lineHeight !== 1.5 || letter !== 0 || word !== 0 || sat !== 100 || contrast !== 'normal' || filter !== 'none';
    for (var f in FLAGS) { var on = a[f] === true; if (on) active = true; root.dataset[FLAGS[f]] = String(on); }
    root.style.setProperty('--bd-a11y-font-scale', String(fontScale / 100));
    root.style.setProperty('--bd-a11y-line-height', String(lineHeight));
    root.style.setProperty('--bd-a11y-letter-spacing', letter + 'em');
    root.style.setProperty('--bd-a11y-word-spacing', word + 'em');
    root.dataset.a11yActive = String(active);
    root.dataset.a11yFontScaled = String(fontScale !== 100);
    root.dataset.a11yContrast = contrast;
    var filters = [];
    if (filter !== 'none') filters.push('url(#bd-a11y-' + filter + ')');
    if (sat !== 100) filters.push('saturate(' + sat + '%)');
    root.dataset.a11yFiltered = String(filters.length > 0);
    root.style.setProperty('--bd-a11y-visual-filter', filters.length ? filters.join(' ') : 'none');
    // Sidebar width (same key and 200-320 px range as the shell), so the layout does not jump on load
    var sw = parseInt(get('bd_ux35_sidebar_width') || '', 10);
    if (sw > 0) root.style.setProperty('--sidebar-w', Math.min(320, Math.max(200, sw)) + 'px');
    window.__BD_BOOT__ = boot;
    // Start both requests now, before the app's modules load
    var opts = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
    window.__BD_BOOT__.strings = fetch(boot.stringsUrl, opts);
    // Public pages (login, portal, downloads) have no session to ask for
    var path = location.pathname || '/';
    var isPublic = false;
    for (var i = 0; i < boot.publicPaths.length; i++) { if (path === boot.publicPaths[i] || path.indexOf(boot.publicPaths[i] + '/') === 0) isPublic = true; }
    if (!isPublic) window.__BD_BOOT__.session = fetch('/api/console/bootstrap', opts);
})(`;

// Pages that work without a session; they skip the bootstrap request.
// '/remote' covers the remote client: the viewer opens for guest links too
// and gets its data from /api/remote/viewer/<id>; the remote dashboard asks
// for the bootstrap itself.
const PUBLIC_PATHS = ['/login', '/portal', '/d', '/remote'];

router.get('/console-boot.js', (req, res) => {
    const boot = { ...publicBoot(req), publicPaths: PUBLIC_PATHS };
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    // JSON.stringify output is valid JS; escape "<" so a value can never close a tag
    res.send(BOOT_SCRIPT + JSON.stringify(boot).replace(/</g, '\\u003c') + ');\n');
});

router.get('/api/console/strings/:code', (req, res) => {
    const { code } = req.params;
    if (!LANG_CODE.test(code) || !manager.hasLanguage(code)) {
        return res.status(404).json({ success: false, error: 'Language not found' });
    }
    const { body, revision } = stringsFor(code);
    const etag = `"${revision}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', req.query.v === revision
        ? 'public, max-age=31536000, immutable'
        : 'no-cache');
    res.setHeader('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    const accept = String(req.headers['accept-encoding'] || '');
    const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
    if (encoding) {
        res.setHeader('Content-Encoding', encoding);
        return res.send(compressed(stringsFor(code), encoding));
    }
    return res.send(body);
});

router.get('/api/console/bootstrap', requireAuth, async (req, res) => {
    const user = req.session.user || {};
    const role = user.role;
    const can = (p) => requestHasPermission(req, p);
    const superAdmin = isSuperAdminRole(role);
    const t = res.locals._ || req.t || ((k) => k);
    const nav = buildNav({ can, isSuperAdmin: superAdmin, role, t, currentPage: '', currentTab: '' });
    const branding = res.locals.branding || brandingService.getBranding() || {};
    const boot = publicBoot(req);
    // getAvatarVersion answers null on any failure: initials instead of the picture
    const avatarVersion = await avatarService.getAvatarVersion(req.session.userId || user.id);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
        success: true,
        user: {
            id: user.id,
            username: user.username,
            role,
            preferredLanguage: user.preferred_language || null,
            avatarVersion: avatarVersion || null
        },
        permissions: UI_PERMISSIONS.filter(can),
        isSuperAdmin: superAdmin,
        emergencyMode: !!req.session.emergencyMode,
        nav: nav.sections.map((s) => ({
            id: s.id,
            icon: s.icon,
            text: s.text,
            pages: s.pages.map((p) => ({
                page: p.page,
                href: p.href,
                text: p.text,
                group: p.groupText || '',
                core: !!p.core,
                keywords: p.keywords || '',
                external: !!p.external,
                countId: p.countId || null
            }))
        })),
        lang: {
            code: boot.lang,
            dir: boot.dir,
            stringsUrl: boot.stringsUrl,
            available: languageList()
        },
        branding: {
            appName: branding.appName || config.appName,
            appDescription: branding.appDescription || '',
            themeMode: boot.themeMode,
            logoType: branding.logoType || null,
            logoIcon: branding.logoIcon || '',
            logoSvg: branding.logoSvg || '',
            logoUrl: branding.logoUrl || '',
            logoText: branding.logoText || '',
            logoTextAccent: branding.logoTextAccent || '',
            footerText: branding.footerText || '',
            showPoweredBy: String(branding.showPoweredBy) !== 'false',
            revision: boot.brandingRevision
        },
        palettes: boot.palettes,
        sessionPolicy: panelSessionService.getPolicy(),
        csrfToken: res.locals.csrfToken || '',
        appVersion: config.appVersion || ''
    });
});

// The Help panel's project supporters and links (config/supporters.json)
router.get('/api/console/supporters', requireAuth, (req, res) => {
    res.json({ success: true, ...supportersService.loadSupporters() });
});

module.exports = router;
module.exports.UI_PERMISSIONS = UI_PERMISSIONS;
module.exports.publicBoot = publicBoot;
