/**
 * The end of the request pipeline (server.js): the server's routes, then the
 * console's pages, then the error handlers.
 *
 * The console lives at the root, and its page handler (lib/webUi.js) answers
 * every GET that is left, so it comes after the routes: /api, /health,
 * /logout, /console-boot.js, /css/branding.css, the old addresses that
 * redirect (/tenants, /generator, /remote-dashboard, ...) and downloads
 * answer first. tests/serverRoutes.order.test.js goes through this order.
 */

'use strict';

const config = require('../config/config');
const logger = require('./logger');

/**
 * @param {import('express').Express} app
 * @param {{ routes: import('express').Router, webUi: import('express').Router }} parts
 */
function mountRoutes(app, { routes, webUi }) {
    app.use('/', routes);

    // The console's pages and files (web-ui/build)
    app.use(webUi);

    // CSRF token mismatch
    app.use((err, req, res, next) => {
        if (err.code === 'EBADCSRFTOKEN' || err.message?.includes('csrf') || err.message?.includes('CSRF')) {
            res.status(403);
            // Detect likely SSL→HTTP transition: cookie missing because browser held Secure cookie
            const likelySslTransition = !config.httpsEnabled && !req.secure;
            const hint = likelySslTransition
                ? ' If you recently disabled SSL, clear your browser cookies for this site and reload.'
                : '';
            // Always return JSON for API routes (fetch sends Accept: */*)
            if (req.path.startsWith('/api/') || (req.headers['content-type'] && req.headers['content-type'].includes('application/json'))) {
                return res.json({ success: false, error: 'Invalid CSRF token. Please refresh the page and try again.' + hint });
            }
            if (req.accepts('html')) {
                return res.render('errors/500', {
                    title: 'Forbidden',
                    activePage: 'error',
                    error: 'Invalid or missing CSRF token. Please refresh the page and try again.' + hint
                });
            }
            return res.json({ success: false, error: 'Invalid CSRF token' + hint });
        }
        next(err);
    });

    // 404 Not Found
    app.use((req, res, _next) => {
        res.status(404);

        // Log unmatched /api/* and /ws/* paths only (avoid noise from missing
        // static assets like favicons).  Diagnostics suggestion credit:
        // progloto (PR #81).
        if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/ws/')) {
            const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
            const ua = String(req.headers['user-agent'] || '').slice(0, 80);
            console.warn(`[panel] 404 ${req.method} ${req.originalUrl} from ${ip} ua="${ua}"`);
        }

        if (req.accepts('html')) {
            res.render('errors/404', {
                title: req.t ? req.t('errors.not_found') : 'Not Found',
                activePage: 'error'
            });
        } else {
            res.json({
                success: false,
                error: 'Not Found'
            });
        }
    });

    // 500 Server Error
    app.use((err, req, res, _next) => {
        logger.error('Server error:', err);

        res.status(err.status || 500);

        // Always return JSON for API routes
        if (req.path.startsWith('/api/') || (req.headers['content-type'] && req.headers['content-type'].includes('application/json'))) {
            return res.json({
                success: false,
                error: config.isProduction ? 'Internal Server Error' : err.message
            });
        }

        if (req.accepts('html')) {
            res.render('errors/500', {
                title: req.t ? req.t('errors.server_error') : 'Server Error',
                activePage: 'error',
                error: config.isProduction ? null : err.message
            });
        } else {
            res.json({
                success: false,
                error: config.isProduction ? 'Internal Server Error' : err.message
            });
        }
    });
}

module.exports = { mountRoutes };
