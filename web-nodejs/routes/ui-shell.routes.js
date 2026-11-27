/**
 * BetterDesk Console — UI shell preference (UX 3.5 only).
 *
 * Keeps the existing `bd_ui_shell` cookie API so older clients can still call
 * it, but only UX 3.5 is accepted. Stale `ux36` cookies are overwritten on
 * read/write so operators stuck on the retired beta land on UX 3.5.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const config = require('../config/config');
const {
    SHELL_COOKIE,
    SHELL_UX35,
    SUPPORTED_SHELLS,
    normalizeShell,
    shellCookieOptions,
} = require('../lib/uiShell');

const jsonBody = express.json({ limit: '2kb' });

function writeUx35Cookie(res) {
    res.cookie(SHELL_COOKIE, SHELL_UX35, shellCookieOptions(config.httpsEnabled));
}

/**
 * POST /api/ui-shell — set the console shell for this browser.
 * Body: { shell: 'ux35' } (only UX 3.5 is accepted).
 */
router.post('/api/ui-shell', requireAuth, jsonBody, (req, res) => {
    const shell = normalizeShell(req.body?.shell);
    if (!shell) {
        return res.status(400).json({
            success: false,
            error: 'Unsupported shell. Allowed: ' + SUPPORTED_SHELLS.join(', '),
        });
    }
    writeUx35Cookie(res);
    return res.json({ success: true, data: { shell: SHELL_UX35 } });
});

/** GET /api/ui-shell — read the active shell (always UX 3.5; clears stale beta). */
router.get('/api/ui-shell', requireAuth, (req, res) => {
    const raw = typeof req.cookies?.[SHELL_COOKIE] === 'string'
        ? req.cookies[SHELL_COOKIE].trim().toLowerCase()
        : '';
    if (raw && raw !== SHELL_UX35) {
        writeUx35Cookie(res);
    }
    res.json({
        success: true,
        data: {
            shell: SHELL_UX35,
            supported: SUPPORTED_SHELLS,
        },
    });
});

module.exports = router;
