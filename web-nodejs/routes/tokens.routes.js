/**
 * BetterDesk Console - Device Token Routes
 * Proxy routes for Go server device token management API.
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const betterdeskApi = require('../services/betterdeskApi');

// ── API Proxy Routes ─────────────────────────────────────────────────────

// List all tokens
router.get('/api/panel/tokens', requireAuth, requirePermission('enrollment.manage'), async (req, res) => {
    try {
        const includeRevoked = req.query.include_revoked === 'true';
        const result = await betterdeskApi.listDeviceTokens(includeRevoked);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list tokens' });
    }
});

// Create token
router.post('/api/panel/tokens', requireAuth, requirePermission('enrollment.manage'), async (req, res) => {
    try {
        const result = await betterdeskApi.createDeviceToken(req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to create token' });
    }
});

// Bulk generate tokens
router.post('/api/panel/tokens/generate-bulk', requireAuth, requirePermission('enrollment.manage'), async (req, res) => {
    try {
        const result = await betterdeskApi.bulkGenerateTokens(req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to generate tokens' });
    }
});

// Update token
router.put('/api/panel/tokens/:id', requireAuth, requirePermission('enrollment.manage'), async (req, res) => {
    try {
        const result = await betterdeskApi.updateDeviceToken(req.params.id, req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update token' });
    }
});

// Revoke token
router.delete('/api/panel/tokens/:id', requireAuth, requirePermission('enrollment.manage'), async (req, res) => {
    try {
        const result = await betterdeskApi.revokeDeviceToken(req.params.id);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to revoke token' });
    }
});

// Bind token to peer
router.post('/api/panel/tokens/:id/bind', requireAuth, requirePermission('enrollment.manage'), async (req, res) => {
    try {
        const result = await betterdeskApi.bindTokenToPeer(req.params.id, req.body.peer_id);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to bind token' });
    }
});

// Get enrollment mode
router.get('/api/panel/enrollment/mode', requireAuth, requirePermission('enrollment.manage'), async (req, res) => {
    try {
        const result = await betterdeskApi.getEnrollmentMode();
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get enrollment mode' });
    }
});

// Set enrollment mode
router.put('/api/panel/enrollment/mode', requireAuth, requirePermission('enrollment.manage'), async (req, res) => {
    try {
        const result = await betterdeskApi.setEnrollmentMode(req.body.mode);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to set enrollment mode' });
    }
});

module.exports = router;
