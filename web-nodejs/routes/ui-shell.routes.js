/**
 * BetterDesk Console — UI shell preference (UX 3.5 / UX 3.6 beta).
 *
 * Persists the operator's choice in the existing `bd_ui_shell` cookie so the
 * switch survives restarts without a database migration. Only the two known
 * shells are accepted; anything else is rejected.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const config = require('../config/config');
const {
    SHELL_COOKIE,
    SUPPORTED_SHELLS,
    normalizeShell,
    shellCookieOptions,
} = require('../lib/uiShell');

const jsonBody = express.json({ limit: '2kb' });

/**
 * POST /api/ui-shell — set the console shell for this browser.
 * Body: { shell: 'ux35' | 'ux36' }
 */
router.post('/api/ui-shell', requireAuth, jsonBody, (req, res) => {
    const shell = normalizeShell(req.body?.shell);
    if (!shell) {
        return res.status(400).json({
            success: false,
            error: 'Unsupported shell. Allowed: ' + SUPPORTED_SHELLS.join(', '),
        });
    }
    res.cookie(SHELL_COOKIE, shell, shellCookieOptions(config.httpsEnabled));
    return res.json({ success: true, data: { shell } });
});

/** GET /api/ui-shell — read the active shell (used by Settings). */
router.get('/api/ui-shell', requireAuth, (req, res) => {
    res.json({
        success: true,
        data: {
            shell: normalizeShell(req.cookies?.[SHELL_COOKIE]) || 'ux35',
            supported: SUPPORTED_SHELLS,
        },
    });
});

module.exports = router;
