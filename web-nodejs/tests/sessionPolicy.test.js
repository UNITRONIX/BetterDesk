'use strict';

const {
    resolveSessionPolicy,
    sanitizeFingerprint,
    sanitizeIp,
    DEFAULT_IDLE_MS,
    DEFAULT_MAX_AGE_MS,
    DEFAULT_MAX_SESSIONS_PER_USER,
    MAX_MAX_SESSIONS_PER_USER
} = require('../lib/sessionPolicy');

describe('sessionPolicy', () => {
    const original = { ...process.env };

    afterEach(() => {
        process.env = { ...original };
    });

    it('uses secure defaults', () => {
        delete process.env.SESSION_IDLE_TIMEOUT;
        delete process.env.SESSION_MAX_AGE;
        const policy = resolveSessionPolicy({});
        expect(policy.idleTimeoutMs).toBe(DEFAULT_IDLE_MS);
        expect(policy.maxAgeMs).toBe(DEFAULT_MAX_AGE_MS);
        expect(policy.maxAgeMs).toBeGreaterThanOrEqual(policy.idleTimeoutMs);
    });

    it('clamps invalid values and keeps maxAge >= idle', () => {
        const policy = resolveSessionPolicy({
            SESSION_IDLE_TIMEOUT: '999999999999',
            SESSION_MAX_AGE: '1000'
        });
        expect(policy.idleTimeoutMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
        expect(policy.maxAgeMs).toBeGreaterThanOrEqual(policy.idleTimeoutMs);
    });

    it('defaults to one session per user and accepts 0 (unlimited) or N', () => {
        expect(resolveSessionPolicy({}).maxSessionsPerUser).toBe(DEFAULT_MAX_SESSIONS_PER_USER);
        expect(DEFAULT_MAX_SESSIONS_PER_USER).toBe(1);
        expect(resolveSessionPolicy({ SESSION_MAX_PER_USER: '' }).maxSessionsPerUser).toBe(1);
        expect(resolveSessionPolicy({ SESSION_MAX_PER_USER: '0' }).maxSessionsPerUser).toBe(0);
        expect(resolveSessionPolicy({ SESSION_MAX_PER_USER: '5' }).maxSessionsPerUser).toBe(5);
        expect(resolveSessionPolicy({ SESSION_MAX_PER_USER: '-3' }).maxSessionsPerUser).toBe(1);
        expect(resolveSessionPolicy({ SESSION_MAX_PER_USER: 'many' }).maxSessionsPerUser).toBe(1);
        expect(resolveSessionPolicy({ SESSION_MAX_PER_USER: '99999999' }).maxSessionsPerUser)
            .toBe(MAX_MAX_SESSIONS_PER_USER);
    });

    it('sanitizes fingerprint and IP', () => {
        expect(sanitizeFingerprint('abc123def456')).toBe('abc123def456');
        expect(sanitizeFingerprint('bad fingerprint!!')).toBe('');
        expect(sanitizeIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
    });
});
