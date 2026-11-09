/**
 * Serves the Svelte console build (web-ui/build) next to the old pages.
 *
 * - Hashed assets under <base>/_ui/immutable/ are cached for a year and sent
 *   precompressed (brotli or gzip) when the browser accepts it.
 * - Every other GET under <base> gets the app's fallback page. Console pages
 *   need a session (the same redirect as requireAuth); public pages do not.
 * - The old URL of a page the new console serves (lib/portedPages.js)
 *   redirects to the same URL under <base>, once there is a build.
 * - The page's Content-Security-Policy comes from the build: SvelteKit writes
 *   the hashes of its inline scripts into a <meta> tag, and the header carries
 *   the same policy plus the directives a <meta> tag can't set.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config/config');
const { PORTED_PAGES, isPortedPath } = require('./portedPages');
const { safeReturnPath, loginRedirectUrl } = require('./returnUrl');

// The console sign-in page (the remote client has its own at /remote/login)
const LOGIN_PATH = /^\/login(\/|$)/;

const DEFAULT_DIR = process.env.WEB_UI_DIR
    || path.join(__dirname, '..', '..', 'web-ui', 'build');

// Paths of the new app that anyone may open (login and friends). Everything
// else under the base needs a signed-in, non-pro session.
const PUBLIC_PATHS = [/^\/login(\/|$)/, /^\/portal(\/|$)/, /^\/d\//, /^\/desktop-login(\/|$)/, /^\/remote\/login(\/|$)/, /^\/remote\/guest(\/|$)/];

// The remote viewer (/remote/<device id>) also opens for guest links and mesh
// shares, which have no console session. The page holds no data: it asks
// /api/remote/viewer/<id>, which applies the viewer's access rules
// (routes/remote.routes.js requireRemoteAccess) and answers 401 otherwise.
const VIEWER_PATH = /^\/remote\/(?!login(\/|$)|guest(\/|$))[A-Za-z0-9_-]{3,64}$/;

// Remote client pages send signed-out people to the remote client's own
// sign-in (/remote/login), as requireRdClientAuth does for the old pages.
const REMOTE_PATH = /^\/remote(\/|$)/;

const TYPES = {
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.wasm': 'application/wasm'
};

function readCsp(html) {
    const m = html.match(/<meta http-equiv="content-security-policy" content="([^"]*)"/i);
    return m ? m[1].replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null;
}

/** The header policy: the build's policy plus what only a header can say. */
function headerPolicy(metaPolicy) {
    const parts = (metaPolicy || "default-src 'self'; script-src 'self'")
        .split(';').map((s) => s.trim()).filter(Boolean)
        .filter((d) => !/^(frame-ancestors|report-uri|sandbox)\b/.test(d));
    parts.push("frame-ancestors 'none'");
    if (config.httpsEnabled) parts.push('upgrade-insecure-requests');
    return parts.join('; ');
}

function escapeAttr(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadIndex(dir) {
    const file = path.join(dir, 'index.html');
    try {
        const html = fs.readFileSync(file, 'utf8');
        return { html, csp: headerPolicy(readCsp(html)), mtime: fs.statSync(file).mtimeMs };
    } catch (_) {
        return null;
    }
}

/**
 * @param {object} opts
 * @param {string} opts.base   URL prefix, e.g. "/app"
 * @param {string} [opts.dir]  build directory
 * @param {string[]} [opts.ported]  old pages to redirect (lib/portedPages.js)
 */
function createWebUi({ base, dir = DEFAULT_DIR, ported = PORTED_PAGES }) {
    const router = express.Router();
    let index = loadIndex(dir);
    const devReload = process.env.NODE_ENV !== 'production';

    function current() {
        if (!devReload) return index;
        const file = path.join(dir, 'index.html');
        try {
            const mtime = fs.statSync(file).mtimeMs;
            if (!index || index.mtime !== mtime) index = loadIndex(dir);
        } catch (_) {
            index = null;
        }
        return index;
    }

    // res.sendErrorPage(kind, { status, title, message }): the error page in the
    // new console, for addresses the app serves (all of them once the base is
    // ''). The server decides the error and the status; the app page carries
    // <meta name="bd-error" content="403|404|500"> and shows the error page at
    // this address (web-ui src/hooks.ts). Answers false when it can't (no
    // build, or an old page's address), and the caller renders the old view.
    router.use((req, res, next) => {
        res.sendErrorPage = (kind, opts = {}) => {
            const page = current();
            if (!page || res.headersSent) return false;
            if (base && req.path !== base && !req.path.startsWith(base + '/')) return false;
            const code = kind === 403 || kind === 404 ? kind : 500;
            const attrs = (opts.title ? ` data-title="${escapeAttr(opts.title)}"` : '')
                + (opts.message ? ` data-message="${escapeAttr(opts.message)}"` : '');
            const html = page.html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}<meta name="bd-error" content="${code}"${attrs}>`);
            res.status(opts.status || kind);
            res.setHeader('Content-Security-Policy', page.csp);
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
            return true;
        };
        next();
    });

    // Old URLs of ported pages: the same URL in the new console
    router.get('*', (req, res, next) => {
        if (!isPortedPath(req.path, ported) || !current()) return next();
        const url = req.originalUrl;
        return res.redirect(302, base + (req.path === '/' ? url.slice(1) : url));
    });

    // Hashed build output: precompressed, cached for a year
    router.get(`${base}/_ui/immutable/*`, (req, res, next) => {
        const rel = req.path.slice(base.length);
        const file = path.normalize(path.join(dir, rel));
        if (!file.startsWith(path.normalize(dir) + path.sep)) return res.status(404).end();
        const accept = String(req.headers['accept-encoding'] || '');
        const type = TYPES[path.extname(file)] || 'application/octet-stream';
        const candidates = [];
        if (/\bbr\b/.test(accept)) candidates.push(['.br', 'br']);
        if (/\bgzip\b/.test(accept)) candidates.push(['.gz', 'gzip']);
        candidates.push(['', null]);
        for (const [ext, enc] of candidates) {
            if (!fs.existsSync(file + ext)) continue;
            res.setHeader('Content-Type', type);
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            res.setHeader('Vary', 'Accept-Encoding');
            if (enc) res.setHeader('Content-Encoding', enc);
            return res.sendFile(file + ext);
        }
        return next();
    });

    // Other files of the build (version.json, fonts copied from static/).
    // HTML only ever comes from the page handler below, behind the session check.
    const files = express.static(dir, {
        index: false,
        redirect: false,
        maxAge: '1h',
        setHeaders(res, filePath) {
            if (filePath.endsWith('version.json')) res.setHeader('Cache-Control', 'no-cache');
        }
    });
    router.use(base, (req, res, next) => {
        let p;
        try { p = decodeURIComponent(req.path); } catch (_) { return res.status(400).end(); }
        return /\.html?$/i.test(p) ? next() : files(req, res, next);
    });

    // The app's pages
    router.get([base, `${base}/*`], (req, res, next) => {
        const page = current();
        if (!page) return next();
        const sub = req.path.slice(base.length) || '/';
        if (path.extname(sub) && !sub.endsWith('.html')) return next(); // a missing file, not a page
        const isPublic = PUBLIC_PATHS.some((re) => re.test(sub)) || VIEWER_PATH.test(sub);
        // The sign-in page is for people who aren't signed in (guestOnly): someone who
        // is goes where ?return= points when it is a console path, or to the start
        if (LOGIN_PATH.test(sub) && req.session && req.session.userId
            && !(req.session.user && req.session.user.role === 'pro')) {
            return res.redirect(safeReturnPath(req.query.return) || '/');
        }
        if (!isPublic) {
            const role = req.session && req.session.user && req.session.user.role;
            if (!req.session || !req.session.userId || role === 'pro') {
                const target = req.originalUrl.startsWith('/') && !req.originalUrl.startsWith('//') ? req.originalUrl : base;
                if (REMOTE_PATH.test(sub)) {
                    return res.redirect(`${base}/remote/login?return=${encodeURIComponent(target)}`);
                }
                // "expired" only when a session ended, not on a first visit (R4)
                return res.redirect(loginRedirectUrl(req, { returnTo: safeReturnPath(req.originalUrl) || base }));
            }
        }
        res.setHeader('Content-Security-Policy', page.csp);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(page.html);
    });

    return router;
}

module.exports = { createWebUi, headerPolicy, readCsp, PUBLIC_PATHS, VIEWER_PATH };
