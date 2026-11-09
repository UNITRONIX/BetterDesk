/**
 * BetterDesk Console - Security Middleware
 * Configures Helmet and custom security headers
 */

const helmet = require('helmet');
const config = require('../config/config');

/**
 * connect-src: the server's own address, also over WebSocket (ws:/wss:
 * depending on the mode)
 */
const connectSources = config.httpsEnabled ? ["'self'", 'wss:'] : ["'self'", 'ws:'];

/**
 * HSTS is disabled for self-signed / LAN installs so HTTP↔HTTPS toggles do not
 * leave a year-long browser enforcement (#219). Set HSTS_ENABLED=true to force it.
 */
function shouldSendStrictTransportSecurity() {
    if (!config.httpsEnabled) return false;
    const hstsEnv = String(process.env.HSTS_ENABLED || '').toLowerCase();
    if (hstsEnv === 'false' || hstsEnv === '0' || hstsEnv === 'off') return false;
    if (hstsEnv === 'true' || hstsEnv === '1' || hstsEnv === 'on') return true;
    return !config.allowSelfSignedCerts;
}

/**
 * Helmet with a strict policy for everything the server answers itself:
 * the API, redirects, files and the branding CSS. The console's pages
 * replace it with the policy from their build (lib/webUi.js), and nothing
 * the server sends needs inline scripts, other origins or a frame.
 */
const helmetMiddleware = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            fontSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            mediaSrc: ["'self'", 'blob:'],
            connectSrc: connectSources,
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            workerSrc: ["'self'", 'blob:'],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            upgradeInsecureRequests: config.httpsEnabled ? [] : null
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginOpenerPolicy: config.httpsEnabled ? { policy: 'same-origin' } : false,
    originAgentCluster: config.httpsEnabled,
    strictTransportSecurity: shouldSendStrictTransportSecurity()
        ? { maxAge: 31536000, includeSubDomains: true, preload: false }
        : false,
    dnsPrefetchControl: { allow: false },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
});

/**
 * Custom security headers beyond what Helmet provides
 */
function customSecurityHeaders(req, res, next) {
    // Prevent clickjacking (belt + suspenders with CSP frame-ancestors)
    res.setHeader('X-Frame-Options', 'DENY');

    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // XSS Protection (disabled — CSP is the modern replacement)
    res.setHeader('X-XSS-Protection', '0');

    // Permissions policy — restrict powerful APIs
    // Only use standardized features; non-standard ones (browsing-topics,
    // attribution-reporting, private-state-token-*, etc.) cause console warnings.
    res.setHeader('Permissions-Policy',
        'geolocation=(), microphone=(self), camera=(), ' +
        'payment=(), usb=(), ' +
        'accelerometer=(), gyroscope=(), magnetometer=()');

    // Prevent cross-site leak via cache timing
    res.setHeader('Cache-Control', 'no-store');
    // Allow static assets to be cached (overridden in express.static options)
    if (req.path.startsWith('/css/') || req.path.startsWith('/img/') || req.path.startsWith('/fonts/')) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
    }

    next();
}

/**
 * Combined security middleware
 */
function securityMiddleware(req, res, next) {
    helmetMiddleware(req, res, () => {
        customSecurityHeaders(req, res, next);
    });
}

module.exports = securityMiddleware;
