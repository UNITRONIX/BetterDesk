'use strict';

/**
 * Dev-only mock remote session for reviewing the web viewer without a device.
 *
 * Off unless the environment sets BD_DEV_MOCK_REMOTE=1 (only the local dev
 * compose file does). With the flag off:
 *   - GET /dev/mock-remote.js falls through to the console's 404,
 *   - /remote/:deviceId?mock=1 renders the normal viewer without the script.
 * The browser script lives outside public/ so express.static never serves it.
 */

const path = require('path');
const express = require('express');

const SCRIPT_PATH = path.join(__dirname, 'mock-session.js');

const SCENARIOS = Object.freeze([
    'ok',
    'slow',
    'password',
    '2fa',
    'fail-relay',
    'refused',
    'offline',
    'timeout',
    'ended',
    'dropped',
]);

function isEnabled(env = process.env) {
    return String((env && env.BD_DEV_MOCK_REMOTE) || '').trim() === '1';
}

/**
 * Mock settings for one viewer request, or null when the mock is off.
 * @param {{ query?: object }} req
 * @param {object} [env]
 * @returns {{ scenario: string } | null}
 */
function forRequest(req, env = process.env) {
    if (!isEnabled(env)) return null;
    const query = (req && req.query) || {};
    if (String(query.mock || '') !== '1') return null;
    const wanted = String(query.scenario || 'ok').toLowerCase();
    return { scenario: SCENARIOS.includes(wanted) ? wanted : 'ok' };
}

const router = express.Router();

router.get('/dev/mock-remote.js', (req, res, next) => {
    if (!isEnabled()) return next();
    res.set('Cache-Control', 'no-store');
    res.type('application/javascript');
    return res.sendFile(SCRIPT_PATH);
});

module.exports = {
    SCENARIOS,
    SCRIPT_PATH,
    isEnabled,
    forRequest,
    router,
};
