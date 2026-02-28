/**
 * BetterDesk Console - RustDesk Client API Routes
 * 
 * RustDesk-compatible login/logout/currentUser endpoints.
 * Runs on a dedicated port (default 21121) for WAN access.
 * 
 * Protocol Reference:
 *   POST /api/login         - Authenticate (username+password or TFA code)
 *   POST /api/logout        - Revoke token
 *   GET  /api/currentUser   - Get current user info (Bearer auth)
 *   GET  /api/login-options - List available login methods
 * 
 * @author UNITRONIX
 * @version 1.0.0
 */

const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const db = require('../services/database');

// ==================== Helper Functions ====================

/**
 * Extract client IP from request (supports proxies)
 */
function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.socket?.remoteAddress
        || 'unknown';
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(req) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
        return null;
    }
    return auth.substring(7).trim();
}

/**
 * Build a RustDesk-compatible user payload
 */
function buildUserPayload(user) {
    return {
        name: user.username,
        email: '',
        note: '',
        status: 1, // kNormal
        is_admin: user.role === 'admin'
    };
}

// ==================== Endpoints ====================

/**
 * GET /api/login-options
 * Returns available login methods.
 * RustDesk client calls this to check for OIDC providers.
 * We only support account-password.
 */
router.get('/api/login-options', (req, res) => {
    res.json(['account-password']);
});

/**
 * POST /api/heartbeat
 * RustDesk client sends periodic heartbeat to report status.
 * Must return a valid JSON response to prevent client errors.
 */
router.post('/api/heartbeat', (req, res) => {
    const { id } = req.body || {};
    if (id) {
        db.setDeviceOnline(id);
    }
    
    const token = extractBearerToken(req);
    if (token) {
        const user = authService.validateAccessToken(token);
        if (user) {
            if (user.clientId && !id) {
                db.setDeviceOnline(user.clientId);
            }
            return res.json({ modified_at: new Date().toISOString() });
        }
    }
    return res.json({ modified_at: new Date().toISOString() });
});

/**
 * POST /api/sysinfo
 * RustDesk client reports system information.
 * Acknowledge the report.
 */
router.post('/api/sysinfo', (req, res) => {
    const { id } = req.body || {};
    if (id) {
        db.setDeviceOnline(id);
    }
    return res.json({});
});

/**
 * GET /api/ab
 * Address book — return stored address book for the authenticated user.
 * RustDesk expects: { data: "<json-string-with-tags-and-peers>", licensed_devices: 0 }
 */
router.get('/api/ab', (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const data = db.getAddressBook(user.id, 'legacy');
    return res.json({ data: data, licensed_devices: 0 });
});

/**
 * POST /api/ab
 * Address book update — save the address book data from the client.
 * RustDesk sends: { data: "<json-string>" }
 */
router.post('/api/ab', (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const { data } = req.body || {};
    if (data !== undefined) {
        const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
        db.saveAddressBook(user.id, dataStr, 'legacy');
        console.log(`[API:AB] Saved legacy address book for user ${user.username} (${dataStr.length} bytes)`);
    }
    return res.json({});
});

/**
 * GET /api/ab/personal
 * Personal address book — return stored personal AB.
 */
router.get('/api/ab/personal', (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const data = db.getAddressBook(user.id, 'personal');
    return res.json({ data: data });
});

/**
 * GET /api/audit
 * Audit log — return empty for now.
 */
router.get('/api/audit', (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    return res.json({ data: [] });
});

/**
 * POST /api/ab/personal
 * Personal address book update — save personal AB data.
 */
router.post('/api/ab/personal', (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const { data } = req.body || {};
    if (data !== undefined) {
        const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
        db.saveAddressBook(user.id, dataStr, 'personal');
        console.log(`[API:AB] Saved personal address book for user ${user.username} (${dataStr.length} bytes)`);
    }
    return res.json({});
});

/**
 * GET /api/ab/tags
 * Address book tags — return tags from legacy address book.
 */
router.get('/api/ab/tags', (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const tags = db.getAddressBookTags(user.id);
    return res.json({ data: tags });
});

/**
 * GET /api/users
 * List users — return current user only.
 */
router.get('/api/users', (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    return res.json({
        data: [{
            name: user.username,
            email: '',
            note: '',
            status: 1,
            is_admin: user.role === 'admin',
            group_name: 'Default'
        }],
        total: 1
    });
});

/**
 * GET /api/peers
 * List peers/devices — return empty for now.
 */
router.get('/api/peers', (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    return res.json({ data: [], total: 0 });
});

/**
 * GET /api/device-group/accessible
 * Returns accessible device groups for the current user.
 */
router.get('/api/device-group/accessible', (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    return res.json({
        data: [{
            guid: 'default',
            name: 'Default',
            note: '',
            team_id: '',
            accessed_count: 0
        }],
        total: 1
    });
});

/**
 * GET /api/device-group
 * List all device groups.
 */
router.get('/api/device-group', (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    return res.json({
        data: [{
            guid: 'default',
            name: 'Default',
            note: '',
            team_id: ''
        }],
        total: 1
    });
});

/**
 * GET /api/user/group
 * Get current user group info.
 */
router.get('/api/user/group', (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    return res.json({
        data: {
            name: 'Default',
            guid: 'default'
        }
    });
});

/**
 * GET /api/software/client-download-link
 * Client download link — return empty.
 */
router.get('/api/software/client-download-link', (req, res) => {
    return res.json({});
});

/**
 * GET /api/software
 * Software update check — return empty.
 */
router.get('/api/software', (req, res) => {
    return res.json({});
});

/**
 * POST /api/login
 * RustDesk-compatible login endpoint.
 * 
 * Request body (initial login):
 *   { username, password, id, uuid, autoLogin, type: "account" }
 * 
 * Request body (2FA verification):
 *   { username, tfaCode, secret, id, uuid, type: "email_code" }
 * 
 * Response types:
 *   { type: "access_token", access_token, user } — success
 *   { type: "tfa_check", tfa_type: "totp", secret } — 2FA required
 */
router.post('/api/login', async (req, res) => {
    const ip = getClientIp(req);

    try {
        const body = req.body || {};
        console.log('[API:LOGIN] Request body keys:', Object.keys(body).join(', '), 'IP:', ip);

        const {
            username,
            password,
            id: clientId,
            uuid: clientUuid,
            type: reqType,
            tfaCode,
            verificationCode,
            secret: tfaSecret,
            deviceInfo
        } = body;

        // Support both field names: tfaCode (our API) and verificationCode (RustDesk client)
        const totpCode = tfaCode || verificationCode;

        // ── TFA verification step ──
        if (totpCode && tfaSecret) {
            return handleTfaVerification(req, res, ip, totpCode);
        }

        // ── Initial login step ──
        if (!username || !password) {
            return res.status(400).json({ error: 'Missing credentials' });
        }

        // Check brute-force protection
        const bruteCheck = authService.checkBruteForce(username, ip);
        if (bruteCheck.blocked) {
            db.logAction(null, 'api_login_blocked', `User: ${username}, IP: ${ip}, Reason: ${bruteCheck.reason}`, ip);
            return res.status(429).json({
                error: bruteCheck.reason,
                retry_after: bruteCheck.retryAfter
            });
        }

        // Authenticate
        const user = await authService.authenticate(username, password);

        if (!user) {
            authService.recordAttempt(username, ip, false);
            db.logAction(null, 'api_login_failed', `User: ${username}`, ip);

            // Generic error — don't reveal whether user exists
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if TOTP 2FA is required
        if (user.totpRequired) {
            // Generate a temporary secret for the TFA session
            const tfaSessionSecret = require('crypto').randomBytes(16).toString('hex');

            // Store TFA session in memory (short-lived)
            if (!req.app.locals._tfaSessions) {
                req.app.locals._tfaSessions = new Map();
            }
            req.app.locals._tfaSessions.set(tfaSessionSecret, {
                userId: user.id,
                username: user.username,
                role: user.role,
                clientId: clientId || '',
                clientUuid: clientUuid || '',
                ip,
                createdAt: Date.now()
            });

            // Cleanup old TFA sessions (>5 min)
            cleanupTfaSessions(req.app.locals._tfaSessions);

            db.logAction(user.id, 'api_login_tfa_required', `Client: ${clientId || 'unknown'}`, ip);

            return res.json({
                type: 'tfa_check',
                tfa_type: 'totp',
                secret: tfaSessionSecret
            });
        }

        // No 2FA — issue token directly
        authService.recordAttempt(username, ip, true);
        const token = authService.generateAccessToken(user.id, clientId, clientUuid, ip);
        db.updateLastLogin(user.id);
        db.logAction(user.id, 'api_login_success', `Client: ${clientId || 'unknown'}`, ip);

        return res.json({
            type: 'access_token',
            access_token: token,
            user: buildUserPayload(user)
        });

    } catch (err) {
        console.error('RustDesk API login error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

/**
 * Handle TFA verification (second step of login)
 */
async function handleTfaVerification(req, res, ip, totpCode) {
    try {
        const {
            verificationCode,
            tfaCode,
            secret: tfaSecret,
            id: clientId,
            uuid: clientUuid
        } = req.body;

        const code = totpCode || tfaCode || verificationCode;

        const sessions = req.app.locals._tfaSessions;
        if (!sessions || !sessions.has(tfaSecret)) {
            return res.status(401).json({ error: 'TFA session expired or invalid' });
        }

        const session = sessions.get(tfaSecret);

        // Verify TOTP code
        const verified = authService.verifyTotpCode(session.userId, code);

        if (!verified) {
            authService.recordAttempt(session.username, ip, false);
            db.logAction(session.userId, 'api_tfa_failed', `Client: ${session.clientId || 'unknown'}`, ip);
            return res.status(401).json({ error: 'Invalid verification code' });
        }

        // TFA passed — clean up session and issue token
        sessions.delete(tfaSecret);

        authService.recordAttempt(session.username, ip, true);
        const token = authService.generateAccessToken(
            session.userId,
            clientId || session.clientId,
            clientUuid || session.clientUuid,
            ip
        );
        db.updateLastLogin(session.userId);
        db.logAction(session.userId, 'api_login_success', `Client: ${clientId || session.clientId || 'unknown'} (2FA: totp)`, ip);

        return res.json({
            type: 'access_token',
            access_token: token,
            user: buildUserPayload({
                username: session.username,
                role: session.role
            })
        });

    } catch (err) {
        console.error('RustDesk API TFA error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
}

/**
 * POST /api/logout
 * Revoke the Bearer token.
 * RustDesk client sends { id, uuid } in body.
 */
router.post('/api/logout', (req, res) => {
    const ip = getClientIp(req);

    try {
        const token = extractBearerToken(req);
        const { id: clientId, uuid: clientUuid } = req.body || {};

        if (token) {
            // Validate token to get user info for logging
            const user = authService.validateAccessToken(token);
            if (user) {
                authService.revokeClientTokens(user.id, clientId, clientUuid);
                db.logAction(user.id, 'api_logout', `Client: ${clientId || 'unknown'}`, ip);
            }
        }

        // Always return success (don't reveal token validity)
        return res.json({});

    } catch (err) {
        console.error('RustDesk API logout error:', err);
        return res.json({});
    }
});

/**
 * GET /api/currentUser
 * Returns current user info based on Bearer token.
 * RustDesk client uses this to refresh user state.
 */
router.get('/api/currentUser', (req, res) => {
    try {
        const token = extractBearerToken(req);

        if (!token) {
            return res.status(401).json({ error: 'Authorization required' });
        }

        const user = authService.validateAccessToken(token);
        if (!user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        return res.json({
            name: user.username,
            email: '',
            note: '',
            status: 1,
            is_admin: user.role === 'admin'
        });

    } catch (err) {
        console.error('RustDesk API currentUser error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

// ==================== Internal Helpers ====================

/**
 * Cleanup expired TFA sessions (>5 min old)
 */
function cleanupTfaSessions(sessions) {
    if (!sessions) return;
    const maxAge = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    for (const [key, session] of sessions) {
        if (now - session.createdAt > maxAge) {
            sessions.delete(key);
        }
    }
}

module.exports = router;
