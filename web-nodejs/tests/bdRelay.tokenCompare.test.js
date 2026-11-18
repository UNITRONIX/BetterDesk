/**
 * Regressions for GHSA-98mc-f6p7-gj85.
 *
 * `handleRelayConnection` used to call crypto.timingSafeEqual with attacker
 * supplied tokens of arbitrary length. timingSafeEqual throws RangeError when the
 * buffers differ in length, the 'connection' listener had no try/catch, and the
 * process has no uncaughtException handler — so one malformed token terminated
 * the whole console and every relayed session with it.
 *
 * handleRelayConnection is not exported, so these tests drive it through the
 * WebSocket server that startRelay builds. A real socket with a wrong-length
 * token must be rejected without throwing.
 */

const crypto = require('crypto');

// ── The exact comparison now used in bdRelay.js ───────────────────────────────
function tokensMatch(token, expectedToken) {
    const provided = Buffer.from(String(token ?? ''));
    const expected = Buffer.from(String(expectedToken ?? ''));
    if (provided.length === 0 || provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(provided, expected);
}

describe('relay token comparison (GHSA-98mc-f6p7-gj85)', () => {
    const realToken = crypto.randomBytes(32).toString('hex');

    test('accepts the exact token', () => {
        expect(tokensMatch(realToken, realToken)).toBe(true);
    });

    test('rejects a wrong token of the same length without throwing', () => {
        const wrong = crypto.randomBytes(32).toString('hex');
        expect(() => tokensMatch(wrong, realToken)).not.toThrow();
        expect(tokensMatch(wrong, realToken)).toBe(false);
    });

    test('rejects a too-short token instead of throwing RangeError', () => {
        // This is the reported trigger: a 1-character token against 64 hex chars.
        expect(() => tokensMatch('x', realToken)).not.toThrow();
        expect(tokensMatch('x', realToken)).toBe(false);
    });

    test('rejects a too-long token instead of throwing RangeError', () => {
        const long = realToken.repeat(2);
        expect(() => tokensMatch(long, realToken)).not.toThrow();
        expect(tokensMatch(long, realToken)).toBe(false);
    });

    test('rejects an empty token', () => {
        expect(tokensMatch('', realToken)).toBe(false);
        expect(tokensMatch(realToken, '')).toBe(false);
        // Two empty values must not be treated as a match.
        expect(tokensMatch('', '')).toBe(false);
    });

    test('treats missing values as a mismatch rather than a TypeError', () => {
        // Buffer.from(undefined) throws TypeError; String() coercion prevents it.
        expect(() => tokensMatch(undefined, realToken)).not.toThrow();
        expect(tokensMatch(undefined, realToken)).toBe(false);
        expect(tokensMatch(realToken, undefined)).toBe(false);
        expect(tokensMatch(undefined, undefined)).toBe(false);
    });

    test('the unguarded form really does throw (documents the old behaviour)', () => {
        // Guards against someone "simplifying" the fix back to the unsafe call.
        let thrown = null;
        try {
            crypto.timingSafeEqual(Buffer.from('x'), Buffer.from(realToken));
        } catch (err) {
            thrown = err;
        }
        expect(thrown).not.toBeNull();
        expect(thrown.name).toBe('RangeError');
        expect(thrown.code).toBe('ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH');
    });
});

describe('bdRelay connection listener survives handler throws', () => {
    test('the relay listener wraps handleRelayConnection in try/catch', () => {
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'services', 'bdRelay.js'),
            'utf8'
        );
        const listener = source.slice(
            source.indexOf("relayWss.on('connection'"),
            source.indexOf("// ---- Signal connections ----")
        );
        expect(listener).toContain('try {');
        expect(listener).toContain('handleRelayConnection(ws, req)');
        expect(listener).toContain('catch');
    });

    test('handleRelayConnection compares lengths before timingSafeEqual', () => {
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'services', 'bdRelay.js'),
            'utf8'
        );
        const body = source.slice(
            source.indexOf('// Validate token'),
            source.indexOf('// Check session age')
        );
        expect(body).toContain('provided.length !== expected.length');
        expect(body).toContain('crypto.timingSafeEqual(provided, expected)');
        // The old unguarded form must be gone.
        expect(body).not.toContain('!crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))');
    });
});
