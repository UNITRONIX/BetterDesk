'use strict';

/**
 * Panel session lifecycle helpers used by auth routes and middleware.
 * The store instance is attached once from server.js.
 */

const logger = require('../lib/logger');
const {
    END_REASONS,
    resolveSessionPolicy,
    sanitizeIp,
    sanitizeUserAgent,
    sanitizeFingerprint
} = require('../lib/sessionPolicy');

let store = null;
let policy = resolveSessionPolicy();

function attachStore(sessionStore) {
    store = sessionStore;
    if (sessionStore?.idleTimeoutMs && sessionStore?.maxAgeMs) {
        policy = {
            idleTimeoutMs: sessionStore.idleTimeoutMs,
            maxAgeMs: sessionStore.maxAgeMs,
            warnBeforeMs: resolveSessionPolicy().warnBeforeMs
        };
    }
}

function getStore() {
    return store;
}

function getPolicy() {
    return { ...policy };
}

function clientMetaFromRequest(req, body = {}) {
    const ip = sanitizeIp(req.ip || req.socket?.remoteAddress || '');
    const userAgent = sanitizeUserAgent(req.get('user-agent') || '');
    const clientFingerprint = sanitizeFingerprint(
        body.clientFingerprint || body.fingerprint || req.get('x-client-fingerprint') || ''
    );
    return { ip, userAgent, clientFingerprint };
}

/**
 * Stamp an authenticated express session and enforce single-session-per-account.
 */
async function establishAuthenticatedSession(req, user, options = {}) {
    const now = Date.now();
    const meta = options.meta || clientMetaFromRequest(req, options.body || {});
    req.session.userId = user.id;
    req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        preferred_language: user.preferred_language || null
    };
    req.session.createdAt = now;
    req.session.lastActivityAt = now;
    req.session.loginIp = meta.ip;
    req.session.loginUserAgent = meta.userAgent;
    req.session.clientFingerprint = meta.clientFingerprint || '';
    if (options.extra) {
        Object.assign(req.session, options.extra);
    }

    // Persist cookie absolute ceiling; rolling idle is enforced via maxAge + store.
    if (req.session.cookie) {
        req.session.cookie.maxAge = Math.min(policy.idleTimeoutMs, policy.maxAgeMs);
        req.session.cookie.expires = new Date(now + req.session.cookie.maxAge);
    }

    let replaced = [];
    if (store && typeof store.activateExclusiveSession === 'function') {
        // Ensure the new sid row exists before exclusive activation.
        await new Promise((resolve, reject) => {
            store.set(req.sessionID, req.session, (err) => (err ? reject(err) : resolve()));
        });
        const result = await store.activateExclusiveSession(req.sessionID, {
            userId: user.id,
            username: user.username,
            ip: meta.ip,
            userAgent: meta.userAgent,
            clientFingerprint: meta.clientFingerprint,
            createdAt: now,
            lastActivityAt: now
        });
        replaced = result.replaced || [];
    }

    if (replaced.length) {
        logger.warn(
            `[Session] Replaced ${replaced.length} prior session(s) for user ${user.username} (id=${user.id}) ` +
            `from new login ip=${meta.ip || 'unknown'}`
        );
        for (const prev of replaced) {
            logger.warn(
                `[Session] Prior session ended (replaced): user=${user.username} ` +
                `prevIp=${prev.ip_address || 'unknown'} prevUa=${String(prev.user_agent || '').slice(0, 120)}`
            );
        }
    }

    return { replaced, meta, createdAt: now };
}

async function endCurrentSession(req, reason = END_REASONS.LOGOUT) {
    if (!req?.sessionID || !store) return;
    try {
        await store.endSession(req.sessionID, reason);
    } catch (err) {
        logger.warn('[Session] endCurrentSession failed:', err.message);
    }
}

/**
 * Refresh last activity / idle cookie window for an authenticated request.
 * Returns { ok, reason } when the session should be rejected.
 */
function touchActivity(req) {
    if (!req.session?.userId) return { ok: true };
    const now = Date.now();
    const createdAt = Number(req.session.createdAt) || now;
    if (!req.session.createdAt) req.session.createdAt = createdAt;

    if (now - createdAt > policy.maxAgeMs) {
        return { ok: false, reason: END_REASONS.MAX_AGE };
    }
    const last = Number(req.session.lastActivityAt) || createdAt;
    if (now - last > policy.idleTimeoutMs) {
        return { ok: false, reason: END_REASONS.IDLE };
    }

    req.session.lastActivityAt = now;
    if (req.session.cookie) {
        const remainingAbsolute = createdAt + policy.maxAgeMs - now;
        const nextIdle = Math.min(policy.idleTimeoutMs, remainingAbsolute);
        if (nextIdle <= 0) {
            return { ok: false, reason: END_REASONS.MAX_AGE };
        }
        req.session.cookie.maxAge = nextIdle;
        req.session.cookie.expires = new Date(now + nextIdle);
    }
    return { ok: true };
}

/**
 * Detect and log access from an IP different from the login IP.
 */
function noteIpChange(req, logAction) {
    if (!req.session?.userId || !req.session.loginIp) return;
    const currentIp = sanitizeIp(req.ip || req.socket?.remoteAddress || '');
    if (!currentIp || currentIp === req.session.loginIp) return;
    if (req.session._lastSeenIp === currentIp) return;
    req.session._lastSeenIp = currentIp;
    const details =
        `IP change during session: loginIp=${req.session.loginIp} currentIp=${currentIp} ` +
        `ua=${sanitizeUserAgent(req.get('user-agent') || '').slice(0, 160)}`;
    logger.warn(`[Session] ${details} userId=${req.session.userId}`);
    if (typeof logAction === 'function') {
        Promise.resolve(
            logAction(req.session.userId, 'session_ip_change', details, currentIp)
        ).catch(() => {});
    }
}

function publicSessionView(row, currentSid) {
    if (!row) return null;
    const isActive = row.is_active === true || Number(row.is_active) === 1;
    return {
        id: row.sid,
        current: row.sid === currentSid,
        username: row.username || null,
        ipAddress: row.ip_address || null,
        userAgent: row.user_agent || null,
        clientFingerprint: row.client_fingerprint || null,
        createdAt: row.created_at || null,
        lastActivityAt: row.last_activity_at || null,
        endedAt: row.ended_at || null,
        endReason: row.end_reason || null,
        active: isActive,
        expiresAt: row.expires_at
            ? (typeof row.expires_at === 'number' ? row.expires_at : new Date(row.expires_at).getTime())
            : null
    };
}

async function listSessionsForUser(userId, currentSid, opts) {
    if (!store) return [];
    const rows = await store.listUserSessions(userId, opts);
    return rows.map((r) => publicSessionView(r, currentSid));
}

module.exports = {
    attachStore,
    getStore,
    getPolicy,
    clientMetaFromRequest,
    establishAuthenticatedSession,
    endCurrentSession,
    touchActivity,
    noteIpChange,
    listSessionsForUser,
    publicSessionView,
    END_REASONS
};
