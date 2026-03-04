/**
 * BetterDesk Console — Desktop Client API Routes
 *
 * REST endpoints consumed by the BetterDesk desktop client (Tauri).
 * These run on the main console server (port 5000) under /api/bd/*.
 *
 * Endpoints:
 *   POST   /api/bd/register     — Register / heartbeat a desktop device
 *   POST   /api/bd/connect      — Request relay session to a target device
 *   GET    /api/bd/session/:id  — Check session status
 *   POST   /api/bd/heartbeat    — Lightweight keepalive
 *   GET    /api/bd/peers        — List online peers (requires auth)
 *   GET    /api/bd/peer/:id     — Get single peer info
 *   DELETE /api/bd/session/:id  — Cancel/close a relay session
 *
 * Authentication:
 *   Desktop clients authenticate via access tokens (Bearer header) obtained
 *   from the RustDesk Client API (/api/login on port 21121).
 *   Token is validated with the same authService.
 *
 * @author UNITRONIX
 * @version 1.0.0
 */

'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../services/database');
const bdRelay = require('../services/bdRelay');

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.socket?.remoteAddress
        || 'unknown';
}

function extractBearerToken(req) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) return null;
    return auth.substring(7).trim();
}

// ---------------------------------------------------------------------------
//  Middleware — authenticate desktop client via access token
// ---------------------------------------------------------------------------

async function requireDeviceAuth(req, res, next) {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Missing authorization token' });
    }
    try {
        const tokenRow = await db.getAccessToken(token);
        if (!tokenRow) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        // Attach user + token info to request
        const user = await db.getUserById(tokenRow.user_id);
        req.deviceToken = tokenRow;
        req.deviceUser = user || null;
        await db.touchAccessToken(token);
        next();
    } catch (err) {
        console.error('[BD-API] Auth error:', err.message);
        res.status(500).json({ error: 'Authentication failed' });
    }
}

/**
 * Lightweight auth — token OR device_id header (for unauthenticated heartbeat).
 * Sets req.deviceId from token's client_id or from X-Device-Id header.
 */
async function identifyDevice(req, res, next) {
    const token = extractBearerToken(req);
    if (token) {
        try {
            const tokenRow = await db.getAccessToken(token);
            if (tokenRow) {
                req.deviceId = tokenRow.client_id || null;
                req.deviceToken = tokenRow;
                await db.touchAccessToken(token);
                return next();
            }
        } catch (_) {}
    }
    // Fallback: X-Device-Id header (for registration before login)
    const deviceId = req.headers['x-device-id'];
    if (deviceId && /^[A-Za-z0-9_-]{3,32}$/.test(deviceId)) {
        req.deviceId = deviceId;
        return next();
    }
    return res.status(401).json({ error: 'Missing device identification' });
}

// ---------------------------------------------------------------------------
//  POST /api/bd/register — Register or update a desktop device
// ---------------------------------------------------------------------------

router.post('/register', identifyDevice, async (req, res) => {
    try {
        const ip = getClientIp(req);
        const { device_id, uuid, hostname, platform, version, public_key } = req.body;

        const id = device_id || req.deviceId;
        if (!id) {
            return res.status(400).json({ error: 'device_id is required' });
        }

        // Build info JSON
        const info = JSON.stringify({
            hostname: hostname || '',
            os: platform || '',
            version: version || '',
            ip: ip,
        });

        // Upsert peer in DB
        await db.upsertPeer({ id, uuid: uuid || '', pk: public_key || null, info, ip });

        // Update online status
        try {
            await db.updatePeerOnlineStatus(id);
        } catch (_) {}

        res.json({
            success: true,
            device_id: id,
            server_time: Date.now(),
            heartbeat_interval: 15, // seconds
        });
    } catch (err) {
        console.error('[BD-API] Register error:', err.message);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ---------------------------------------------------------------------------
//  POST /api/bd/heartbeat — Lightweight keepalive
// ---------------------------------------------------------------------------

router.post('/heartbeat', identifyDevice, async (req, res) => {
    try {
        const id = req.body.device_id || req.deviceId;
        if (!id) {
            return res.status(400).json({ error: 'device_id is required' });
        }

        // Touch online status
        try {
            await db.updatePeerOnlineStatus(id);
        } catch (_) {}

        // Check for pending incoming connection requests
        const pending = [];
        for (const [sid, session] of bdRelay.activeSessions) {
            if (session.targetId === id && session.status === 'pending') {
                pending.push({
                    session_id: sid,
                    initiator_id: session.initiatorId,
                    created_at: session.createdAt,
                });
            }
        }

        res.json({
            success: true,
            server_time: Date.now(),
            pending_connections: pending,
        });
    } catch (err) {
        console.error('[BD-API] Heartbeat error:', err.message);
        res.status(500).json({ error: 'Heartbeat failed' });
    }
});

// ---------------------------------------------------------------------------
//  POST /api/bd/connect — Request relay session to a target device
// ---------------------------------------------------------------------------

router.post('/connect', requireDeviceAuth, async (req, res) => {
    try {
        const { target_id, initiator_id, public_key } = req.body;

        if (!target_id) {
            return res.status(400).json({ error: 'target_id is required' });
        }

        const srcId = initiator_id || req.deviceToken?.client_id;
        if (!srcId) {
            return res.status(400).json({ error: 'initiator_id is required' });
        }

        // Check if target exists
        const target = await db.getDeviceById(target_id);
        if (!target) {
            return res.status(404).json({ error: 'Target device not found' });
        }

        // Check if target is banned
        if (target.is_banned) {
            return res.status(403).json({ error: 'Target device is banned' });
        }

        // Create relay session
        const { sessionId, initiatorToken, targetToken } = bdRelay.createRelaySession(srcId, target_id);

        // Try to notify target via WebSocket signal channel
        const targetNotified = bdRelay.notifyTarget(target_id, {
            type: 'incoming_connection',
            session_id: sessionId,
            initiator_id: srcId,
            initiator_pk: public_key || null,
        });

        res.json({
            success: true,
            session_id: sessionId,
            token: initiatorToken,
            target_online: targetNotified,
            relay_url: `/ws/bd-relay?session=${sessionId}&token=${initiatorToken}&role=initiator`,
        });
    } catch (err) {
        console.error('[BD-API] Connect error:', err.message);
        res.status(500).json({ error: 'Connection request failed' });
    }
});

// ---------------------------------------------------------------------------
//  GET /api/bd/session/:id — Check session status
// ---------------------------------------------------------------------------

router.get('/session/:id', identifyDevice, (req, res) => {
    const session = bdRelay.getRelaySession(req.params.id);
    if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
    }
    res.json({ success: true, session });
});

// ---------------------------------------------------------------------------
//  DELETE /api/bd/session/:id — Cancel relay session
// ---------------------------------------------------------------------------

router.delete('/session/:id', identifyDevice, (req, res) => {
    const sessionId = req.params.id;
    const session = bdRelay.getRelaySession(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    // Only participants can cancel
    const id = req.deviceId;
    if (session.initiatorId !== id && session.targetId !== id) {
        return res.status(403).json({ error: 'Not a participant of this session' });
    }
    // Teardown handled internally
    bdRelay.activeSessions.delete(sessionId);
    res.json({ success: true });
});

// ---------------------------------------------------------------------------
//  GET /api/bd/peers — List online peers
// ---------------------------------------------------------------------------

router.get('/peers', requireDeviceAuth, async (req, res) => {
    try {
        const onlineIds = bdRelay.getOnlineDeviceIds();
        const peers = [];

        for (const id of onlineIds) {
            const device = await db.getDeviceById(id);
            if (device && !device.is_banned && !device.is_deleted) {
                peers.push({
                    id: device.id,
                    hostname: device.note || '',
                    platform: '',
                    online: true,
                });
            }
        }

        res.json({ success: true, peers });
    } catch (err) {
        console.error('[BD-API] Peers error:', err.message);
        res.status(500).json({ error: 'Failed to list peers' });
    }
});

// ---------------------------------------------------------------------------
//  GET /api/bd/peer/:id — Get single peer info
// ---------------------------------------------------------------------------

router.get('/peer/:id', identifyDevice, async (req, res) => {
    try {
        const device = await db.getDeviceById(req.params.id);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        res.json({
            success: true,
            peer: {
                id: device.id,
                hostname: device.note || '',
                online: bdRelay.isDeviceOnline(device.id),
                banned: !!device.is_banned,
            },
        });
    } catch (err) {
        console.error('[BD-API] Peer error:', err.message);
        res.status(500).json({ error: 'Failed to get peer info' });
    }
});

module.exports = router;
