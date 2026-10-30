'use strict';

/**
 * Panel console session policy helpers.
 * Idle timeout slides with activity; absolute maxAge is hard from login time.
 */

const MIN_IDLE_MS = 60 * 1000; // 1 minute
const MAX_IDLE_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_IDLE_MS = 30 * 60 * 1000; // 30 minutes
const MIN_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const MAX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_WARN_BEFORE_MS = 60 * 1000; // 1 minute

function parsePositiveInt(raw, fallback) {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

/**
 * Resolve session policy from environment / config overrides.
 * @param {object} [env]
 * @returns {{ idleTimeoutMs: number, maxAgeMs: number, warnBeforeMs: number }}
 */
function resolveSessionPolicy(env = process.env) {
    const idleTimeoutMs = clamp(
        parsePositiveInt(env.SESSION_IDLE_TIMEOUT, DEFAULT_IDLE_MS),
        MIN_IDLE_MS,
        MAX_IDLE_MS
    );
    let maxAgeMs = clamp(
        parsePositiveInt(env.SESSION_MAX_AGE, DEFAULT_MAX_AGE_MS),
        MIN_MAX_AGE_MS,
        MAX_MAX_AGE_MS
    );
    // Absolute lifetime must always be at least idle timeout.
    if (maxAgeMs < idleTimeoutMs) {
        maxAgeMs = idleTimeoutMs;
    }
    const warnBeforeMs = clamp(
        parsePositiveInt(env.SESSION_IDLE_WARN_MS, DEFAULT_WARN_BEFORE_MS),
        15 * 1000,
        Math.min(idleTimeoutMs, 10 * 60 * 1000)
    );
    return { idleTimeoutMs, maxAgeMs, warnBeforeMs };
}

const END_REASONS = Object.freeze({
    LOGOUT: 'logout',
    REPLACED: 'replaced',
    IDLE: 'idle',
    MAX_AGE: 'max_age',
    REVOKED: 'revoked',
    DESTROYED: 'destroyed'
});

function sanitizeUserAgent(ua) {
    const s = String(ua || '').trim();
    if (!s) return '';
    return s.length > 512 ? s.slice(0, 512) : s;
}

function sanitizeIp(ip) {
    let s = String(ip || '').trim();
    if (s.startsWith('::ffff:')) s = s.slice(7);
    return s.length > 128 ? s.slice(0, 128) : s;
}

function sanitizeFingerprint(fp) {
    const s = String(fp || '').trim();
    if (!s) return '';
    // Accept only opaque hex/base64url-like fingerprints from the browser.
    if (!/^[A-Za-z0-9_.=+/-]{8,128}$/.test(s)) return '';
    return s;
}

module.exports = {
    MIN_IDLE_MS,
    MAX_IDLE_MS,
    DEFAULT_IDLE_MS,
    MIN_MAX_AGE_MS,
    MAX_MAX_AGE_MS,
    DEFAULT_MAX_AGE_MS,
    DEFAULT_WARN_BEFORE_MS,
    END_REASONS,
    resolveSessionPolicy,
    sanitizeUserAgent,
    sanitizeIp,
    sanitizeFingerprint
};
