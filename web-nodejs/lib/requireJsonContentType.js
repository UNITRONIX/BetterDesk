'use strict';

/**
 * POST, PUT and PATCH requests to /api/* must send JSON. A cross-site form
 * can't send that content type, so this adds a layer of CSRF protection.
 * Routes that take files as multipart/form-data are exempt.
 */

/** Uploads that are multipart/form-data, by exact path */
const MULTIPART_PATHS = new Set([
    // Disaster-recovery restore (field "backup"). /api/settings/updates/restore stays JSON-only.
    '/api/settings/restore',
    // A support agent module archive (field "archive"), BUGS.md A3
    '/api/generator/module/install-local',
]);

function requireJsonContentType(req, res, next) {
    if (['GET', 'DELETE', 'OPTIONS', 'HEAD'].includes(req.method)) {
        return next();
    }
    // Not the API: form submissions and file uploads
    if (!req.path.startsWith('/api/')) {
        return next();
    }
    if (req.path.includes('/upload') || req.path.includes('/import')) {
        return next();
    }
    if (MULTIPART_PATHS.has(req.path)) {
        return next();
    }
    if (!req.is('application/json')) {
        return res.status(415).json({
            success: false,
            error: 'Content-Type must be application/json'
        });
    }
    next();
}

module.exports = { requireJsonContentType, MULTIPART_PATHS };
