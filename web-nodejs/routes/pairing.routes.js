/**
 * BetterDesk Console — short-code pairing (operator side)
 *
 * Generates and revokes one-time pairing codes. The client redeems a code directly
 * against the Go API (`POST /api/pairing/redeem`); the panel only mints and lists them.
 *
 * The plaintext code is returned once, to the operator who requested it, and is never
 * stored or logged — the server keeps sha256(code) only.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const betterdeskApi = require('../services/betterdeskApi');
const db = require('../db');

const jsonBody = express.json({ limit: '4kb' });

/**
 * GET /pairing — code pairing page (operator).
 * Shown next to Generator → Activate agent, which uses QR codes.
 */
router.get('/pairing', requireAuth, requirePermission('enrollment.approve'), (req, res) => {
    let publicHost = '';
    try {
        const endpoints = require('../services/rustDeskPublicEndpointsService');
        if (endpoints && typeof endpoints.getPublicEndpoints === 'function') {
            const resolved = endpoints.getPublicEndpoints();
            publicHost = (resolved && (resolved.serverId || resolved.apiUrl)) || '';
        }
    } catch (_) {
        // Display-only hint; the Go server reports the authoritative host on mint.
    }
    res.render('pairing', {
        title: req.t('nav.pairing'),
        suggested_host: publicHost,
    });
});

/** GET /api/panel/pairing/codes — active codes (no plaintext). */
router.get(
    '/api/panel/pairing/codes',
    requireAuth,
    requirePermission('enrollment.approve'),
    async (req, res) => {
        const result = await betterdeskApi.listPairingCodes();
        if (!result.success) {
            return res.status(502).json({ success: false, error: result.error || 'upstream_error' });
        }
        return res.json({ success: true, codes: result.data?.codes || [] });
    }
);

/** POST /api/panel/pairing/codes — mint one code. */
router.post(
    '/api/panel/pairing/codes',
    requireAuth,
    requirePermission('enrollment.approve'),
    jsonBody,
    async (req, res) => {
        const label = String((req.body && req.body.label) || '').trim().slice(0, 64);
        const result = await betterdeskApi.createPairingCode(label);
        if (!result.success) {
            return res.status(502).json({ success: false, error: result.error || 'upstream_error' });
        }
        // The plaintext code exists only in this response.
        try {
            await db.logAction(
                req.session.userId,
                'pairing_code_created',
                `Created pairing code ${result.data?.id || ''}${label ? ` (${label})` : ''}`,
                req.ip
            );
        } catch (_) {
            // Audit failure must not hide a code the operator has not seen yet.
        }
        return res.status(201).json({
            success: true,
            code: result.data?.code,
            id: result.data?.id,
            host: result.data?.host || '',
            label,
            expires_at: result.data?.expires_at,
            expires_in: result.data?.expires_in,
        });
    }
);

/** DELETE /api/panel/pairing/codes/:id — revoke before use. */
router.delete(
    '/api/panel/pairing/codes/:id',
    requireAuth,
    requirePermission('enrollment.approve'),
    async (req, res) => {
        const id = String(req.params.id || '').trim();
        if (!/^[a-f0-9]{8,32}$/i.test(id)) {
            return res.status(400).json({ success: false, error: 'invalid_id' });
        }
        const result = await betterdeskApi.revokePairingCode(id);
        if (!result.success) {
            const status = result.status === 404 ? 404 : 502;
            return res.status(status).json({ success: false, error: result.error || 'upstream_error' });
        }
        try {
            await db.logAction(req.session.userId, 'pairing_code_revoked', `Revoked pairing code ${id}`, req.ip);
        } catch (_) {}
        return res.json({ success: true, id });
    }
);

module.exports = router;
