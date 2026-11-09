'use strict';

/**
 * Dev-only mock remote session for reviewing the web viewer without a device.
 *
 * Off unless the environment sets BD_DEV_MOCK_REMOTE=1 (only the local dev
 * compose file does). With the flag off:
 *   - GET /dev/mock-remote.js falls through to the console's 404,
 *   - /remote/:deviceId?mock=1 renders the normal viewer without the script.
 * With the flag on, the seed scripts' demo devices use the mock without ?mock=1.
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
 * The fake devices of the dev seed scripts (scripts/dev): seed-ui-data.js
 * gives them IDs 900100001 to 900100099, seed-many-devices.js IDs from
 * 950000000. They have no client behind them, so they get the mock session
 * without ?mock=1. Matched by ID because a device note replaces its host name.
 * @param {string} [deviceId]
 */
function isSeededDevice(deviceId) {
    return /^(9001000\d\d|950\d{6})$/.test(String(deviceId || ''));
}

/**
 * Mock settings for one viewer request, or null when the mock is off: with
 * the flag, for ?mock=1 or a seeded device (?mock=0 opts out).
 * @param {{ query?: object }} req
 * @param {object} [env]
 * @param {string} [deviceId]
 * @returns {{ scenario: string } | null}
 */
function forRequest(req, env = process.env, deviceId = '') {
    if (!isEnabled(env)) return null;
    const query = (req && req.query) || {};
    const mock = String(query.mock || '');
    if (mock !== '1' && (mock === '0' || !isSeededDevice(deviceId))) return null;
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
    isSeededDevice,
    forRequest,
    router,
};
