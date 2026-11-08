/**
 * BetterDesk Console - Profile picture routes
 *
 * GET /api/users/avatars       who has a picture: [{ id, username, avatar_version }]
 * GET /api/users/:id/avatar    the picture itself
 *
 * Any signed-in console user may see any user's picture and the list of who
 * has one. That is the same reach as the names people already see next to
 * chat messages and in the audit log, and the pictures are what the identity
 * provider shows to everyone in the organisation anyway.
 */

'use strict';

const express = require('express');
const router = express.Router();
const avatarService = require('../services/avatarService');
const { requireAuth } = require('../middleware/auth');
const { panelReadLimiter } = require('../middleware/rateLimiter');

const SERVABLE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

router.get('/api/users/avatars', requireAuth, panelReadLimiter, async (req, res) => {
    try {
        const users = await avatarService.listDirectory();
        res.set('Cache-Control', 'private, no-cache');
        res.json({ success: true, data: { users } });
    } catch (err) {
        console.error('[Avatar] list error:', err.message);
        res.status(500).json({ success: false, error: 'server_error' });
    }
});

router.get('/api/users/:id/avatar', requireAuth, panelReadLimiter, async (req, res) => {
    const id = /^\d{1,10}$/.test(req.params.id) ? Number(req.params.id) : 0;
    if (!id) return res.status(404).json({ success: false, error: 'not_found' });
    let row;
    try {
        row = await avatarService.getAvatar(id);
    } catch (err) {
        console.error('[Avatar] read error:', err.message);
        return res.status(500).json({ success: false, error: 'server_error' });
    }
    const mime = row && String(row.mime_type || '').toLowerCase();
    if (!row || !row.data || !SERVABLE_TYPES.has(mime)) {
        res.set('Cache-Control', 'private, no-cache');
        return res.status(404).json({ success: false, error: 'not_found' });
    }
    const etag = `"${row.version}"`;
    // A URL with the current ?v= never changes, so the browser may keep it;
    // any other URL is checked against the ETag each time.
    const versioned = typeof req.query.v === 'string' && req.query.v === row.version;
    res.set({
        'Content-Type': mime,
        'Cache-Control': versioned ? 'private, max-age=86400' : 'private, no-cache',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
        'Content-Disposition': 'inline',
        'Cross-Origin-Resource-Policy': 'same-origin',
    });
    const inm = req.headers['if-none-match'];
    if (inm && inm.split(',').map((s) => s.trim().replace(/^W\//, '')).includes(etag)) {
        return res.status(304).end();
    }
    const data = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
    res.set('Content-Length', String(data.length));
    return res.status(200).end(data);
});

module.exports = router;
