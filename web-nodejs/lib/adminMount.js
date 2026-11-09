'use strict';

/**
 * Some routers are mounted twice: at an admin prefix (/api/inventory,
 * /api/activity, /api/automation) and at /api/bd for their device routes.
 * Their admin routes then also answer under /api/bd, where a route like
 * GET /:id catches a device path (GET /api/bd/commands) and answers 401
 * before the device route, later in the chain, is reached.
 *
 * Admin routes put this first: under /api/bd they step aside and Express
 * goes on to the next matching route.
 */
function notOnDeviceMount(req, res, next) {
    return req.baseUrl === '/api/bd' ? next('route') : next();
}

module.exports = { notOnDeviceMount };
