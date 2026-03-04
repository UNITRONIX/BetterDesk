/**
 * BetterDesk Console - Remote Desktop Routes
 * Serves the web-based remote desktop viewer page (RustDesk compat + BetterDesk native)
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const db = require('../services/database');
const config = require('../config/config');
const { requireAuth } = require('../middleware/auth');

// Lazy-loaded relay helper — avoid circular require at module load time
function getRemoteRelay() {
    try { return require('../services/remoteRelay'); } catch { return null; }
}

// Read server public key once at startup
let serverPubKey = '';
try {
    if (fs.existsSync(config.pubKeyPath)) {
        serverPubKey = fs.readFileSync(config.pubKeyPath, 'utf8').trim();
    }
} catch (err) {
    console.warn('Warning: Could not read server public key:', err.message);
}

/**
 * GET /remote/:deviceId - RustDesk-compatible remote desktop viewer
 */
router.get('/remote/:deviceId', requireAuth, async (req, res) => {
    const deviceId = req.params.deviceId;

    // Validate device ID format
    if (!deviceId || !/^[A-Za-z0-9_-]{3,32}$/.test(deviceId)) {
        return res.redirect('/devices');
    }

    // Look up device in database for display info (optional, not blocking)
    let device = null;
    try {
        device = await db.getDevice(deviceId);
    } catch {
        // Database lookup failure is non-blocking - viewer can still work
    }

    res.render('remote', {
        title: `${req.t('remote.title')} - ${deviceId}`,
        activePage: 'remote',
        deviceId: deviceId,
        device: device || { id: deviceId, hostname: '', platform: '', note: '' },
        serverPubKey: serverPubKey,
        // Use viewer layout instead of main layout
        layout: 'viewer'
    });
});

/**
 * GET /remote-desktop/:deviceId - BetterDesk native JPEG stream viewer
 */
router.get('/remote-desktop/:deviceId', requireAuth, async (req, res) => {
    const deviceId = req.params.deviceId;

    if (!deviceId || !/^[A-Za-z0-9_-]{3,32}$/.test(deviceId)) {
        return res.redirect('/devices');
    }

    let device = null;
    try {
        device = await db.getDevice(deviceId);
    } catch { /* non-blocking */ }

    res.render('remote-viewer', {
        title: device?.hostname ? `Remote — ${device.hostname}` : `Remote — ${deviceId}`,
        activePage: 'remote',
        deviceId,
        device: device || { id: deviceId, hostname: '', platform: '', note: '' },
        layout: false  // remote-viewer.ejs handles its own layout via include()
    });
});

/**
 * GET /api/remote/sessions - List active native remote sessions
 */
router.get('/api/remote/sessions', requireAuth, (req, res) => {
    const relay = getRemoteRelay();
    if (!relay) return res.json({ sessions: [] });
    const sessions = relay.getActiveSessions();
    res.json({ sessions });
});

/**
 * GET /api/remote/session/:deviceId - Get state of a single native remote session
 */
router.get('/api/remote/session/:deviceId', requireAuth, (req, res) => {
    const relay = getRemoteRelay();
    if (!relay) return res.status(404).json({ error: 'Remote relay not available' });
    const state = relay.getSessionState(req.params.deviceId);
    if (!state) return res.status(404).json({ error: 'Session not found' });
    res.json(state);
});

module.exports = router;
