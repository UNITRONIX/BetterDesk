/**
 * BetterDesk Console - Rate Limiter Middleware
 */

const rateLimit = require('express-rate-limit');
const config = require('../config/config');

const defaultKeyGenerator = (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown';

/**
 * Authenticated panel read/poll endpoints (dashboard widgets, status cards).
 * GET/HEAD only — mutations still use the general apiLimiter budget.
 *
 * Mounted with widgetLimiter in server.js and skipped by apiLimiter so the
 * 100/min general cap does not starve normal console usage.
 */
const PANEL_POLL_PATHS = new Set([
    '/api/stats',
    '/api/server/status',
    '/api/server/bandwidth',
    '/api/devices',
    '/api/audit/conn',
    '/api/dashboard/client-config',
    '/api/dashboard/activity',
    '/api/registrations/count',
    '/api/network/targets',
    '/api/tickets/stats',
    '/api/cdap/devices',
    '/api/users',
    '/api/audit-log',
    '/api/system/info',
    '/api/logs/recent',
    '/api/database/stats',
    '/api/docker/containers',
    '/api/settings/restart-status',
    '/api/folders',
    '/api/tags',
    '/api/device-groups',
    '/api/bd/notifications'
]);

/**
 * Lightweight, authenticated settings reads. These endpoints can be loaded
 * together when the Settings page initializes and should not consume the
 * stricter mutation/general API budget.
 */
const PANEL_READ_PATHS = new Set([
    '/api/settings/audit',
    '/api/settings/info',
    '/api/settings/restart/pending',
    '/api/settings/device-scope',
    '/api/settings/connection-mode',
    '/api/settings/public-endpoints',
    '/api/settings/branding',
    '/api/settings/appearance',
    '/api/settings/branding/backgrounds',
    '/api/settings/branding/export',
    '/api/settings/branding/profiles',
    '/api/settings/themes',
    '/api/settings/fonts',
    '/api/settings/fonts/local',
    '/api/settings/backup/stats',
    '/api/settings/updates/channel',
    '/api/settings/updates/last-result',
    '/api/settings/updates/server-binary/status',
    '/api/settings/backup/retention',
    '/api/settings/enrollment',
    '/api/settings/client-sessions',
    '/api/settings/ldap',
    '/api/settings/oidc',
    '/api/settings/email/smtp'
]);

/** Prefixes for read-only dashboard sub-routes (future-safe). */
const PANEL_POLL_PREFIXES = [
    '/api/dashboard/',
    '/api/panel/'
];

/**
 * Resolve the full API pathname for rate-limit classification.
 *
 * When middleware is mounted at `/api/` (see server.js), Express strips that
 * prefix from `req.path` (`/bd/notifications` instead of `/api/bd/notifications`).
 * PANEL_POLL_PATHS / preference checks use the full `/api/...` form, so we must
 * rejoin `baseUrl` + `path` (or fall back to `originalUrl`).
 */
function resolveApiPath(req) {
    const base = String(req.baseUrl || '');
    const path = String(req.path || '');
    if (base === '/api' || base.startsWith('/api/')) {
        return '/api' + (path.startsWith('/') ? path : `/${path}`);
    }
    if (path.startsWith('/api/') || path === '/api') return path;
    const orig = String(req.originalUrl || '').split('?')[0];
    if (orig.startsWith('/api/') || orig === '/api') return orig;
    return path;
}

function isPanelPollRequest(req) {
    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return false;
    const path = resolveApiPath(req);
    if (PANEL_POLL_PATHS.has(path)) return true;
    return PANEL_POLL_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isPanelReadRequest(req) {
    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return false;
    return PANEL_READ_PATHS.has(resolveApiPath(req));
}

/** Session-authenticated UI preference writes (desktop layout save). */
function isPanelPreferenceWrite(req) {
    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'POST') return false;
    return resolveApiPath(req) === '/api/desktop/layout';
}

/** Paths that receive widgetLimiter in server.js (exact paths only). */
function getPanelPollMountPaths() {
    return Array.from(PANEL_POLL_PATHS);
}

/** Paths that receive panelReadLimiter in server.js (exact paths only). */
function getPanelReadMountPaths() {
    return Array.from(PANEL_READ_PATHS);
}

/**
 * General API rate limiter.
 *
 * SECURITY (audit fix M-03, 2026-04-10): the previous Referer-based skip was
 * removed because Referer is fully client-controlled. High-frequency widget /
 * dashboard refresh endpoints now have their own higher-quota limiter
 * (`widgetLimiter`) that the panel routes opt into explicitly.
 */
const apiLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many requests. Please try again later.'
    },
    keyGenerator: defaultKeyGenerator,
    skip: (req) => isPanelPollRequest(req) || isPanelReadRequest(req) || isPanelPreferenceWrite(req)
});

/**
 * Widget / dashboard refresh limiter. Higher quota (600 req/min by default)
 * because the panel polls many widgets in parallel. Still authenticated —
 * mount only on routes that require an active session.
 */
const widgetLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.WIDGET_RATE_LIMIT_MAX, 10) || 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many widget requests. Please slow down.'
    },
    keyGenerator: defaultKeyGenerator
});

/**
 * Settings reads are authenticated by their route handlers and keyed to the
 * session user when available. Unauthenticated requests still fall back to
 * the client IP, so the limiter does not create an unbounded bypass.
 */
const panelReadLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: parseInt(process.env.PANEL_READ_RATE_LIMIT_MAX, 10) || 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many panel read requests. Please slow down.'
    },
    keyGenerator: (req) => {
        const userId = req.session && (req.session.userId || req.session.user?.id);
        if (userId) return `panel-read:${userId}`;
        return defaultKeyGenerator(req);
    }
});

/**
 * Desktop layout / wallpaper preference saves (session + CSRF, debounced in UI).
 */
const panelPreferenceLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.PANEL_PREFERENCE_RATE_LIMIT_MAX, 10) || 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many layout save requests. Please slow down.'
    },
    keyGenerator: (req) => {
        const userId = req.session && req.session.userId;
        if (userId) return `pref:${userId}`;
        return defaultKeyGenerator(req);
    }
});

/**
 * RdClient HTML page limiter. Keeps remote viewer/login pages bounded without
 * using the stricter credential-attempt budget.
 */
const rdClientPageLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.RDCLIENT_PAGE_RATE_LIMIT_MAX, 10) || 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many remote page requests. Please slow down.'
    },
    keyGenerator: defaultKeyGenerator
});

/**
 * Strict rate limiter for login attempts
 */
const loginLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.loginRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many login attempts. Please try again in a minute.'
    },
    keyGenerator: (req) => {
        return req.ip || req.headers['x-forwarded-for'] || 'unknown';
    }
});

/**
 * Very strict limiter for password changes
 */
const passwordChangeLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many password change attempts. Please try again later.'
    }
});

/**
 * Upload / mutation limiter for ticket and file endpoints.
 */
const uploadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.UPLOAD_RATE_LIMIT_MAX, 10) || 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many upload requests. Please try again later.'
    },
    keyGenerator: defaultKeyGenerator
});

/**
 * File-system read/download limiter (language files, theme presets, completed transfers).
 */
const fileAccessLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.FILE_ACCESS_RATE_LIMIT_MAX, 10) || 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many file requests. Please try again later.'
    },
    keyGenerator: defaultKeyGenerator
});

module.exports = {
    apiLimiter,
    widgetLimiter,
    panelReadLimiter,
    panelPreferenceLimiter,
    rdClientPageLimiter,
    loginLimiter,
    passwordChangeLimiter,
    uploadLimiter,
    fileAccessLimiter,
    isPanelPollRequest,
    isPanelReadRequest,
    isPanelPreferenceWrite,
    resolveApiPath,
    getPanelPollMountPaths,
    getPanelReadMountPaths,
    PANEL_POLL_PATHS,
    PANEL_READ_PATHS
};
