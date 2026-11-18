'use strict';

/**
 * Panel trust bridge — signing side (strangler stage P1).
 *
 * The Go server authorizes panel-originated calls from a signed statement. What
 * matters on this side is that the statement carries the operator's real role
 * (not the panel API key's administrator role), covers the exact method and
 * path, expires quickly, and never appears when the bridge is not configured.
 *
 * The cross-language contract itself is pinned from the Go side
 * (betterdesk-server/api/panel_trust_test.go) plus the parity test for the
 * catalog; here we test what this process produces.
 */

const crypto = require('crypto');

const panelTrust = require('../services/panelTrust');

const SECRET = '0123456789abcdef0123456789abcdef';

/** Recompute what Go does: verify and decode the statement. */
function decodeStatement(header, secret) {
    const dot = header.lastIndexOf('.');
    const statement = Buffer.from(header.slice(0, dot), 'base64url').toString('utf8');
    const mac = crypto.createHmac('sha256', secret).update(statement, 'utf8').digest('hex');
    return { statement, signature: header.slice(dot + 1), expected: mac, parts: statement.split('\n') };
}

describe('panel trust signing', () => {
    const original = process.env.PANEL_TRUST_SECRET;
    afterEach(() => {
        if (original === undefined) delete process.env.PANEL_TRUST_SECRET;
        else process.env.PANEL_TRUST_SECRET = original;
    });

    it('is off when no secret is configured', () => {
        delete process.env.PANEL_TRUST_SECRET;
        expect(panelTrust.panelTrustEnabled()).toBe(false);
        expect(panelTrust.signPanelStatement({ username: 'a', role: 'operator' }, 'GET', '/api/panel/folders')).toBeNull();
        expect(panelTrust.panelTrustHeaders({ username: 'a', role: 'operator' }, 'GET', '/api/panel/folders')).toEqual({});
    });

    it('produces a statement Go can verify byte for byte', () => {
        process.env.PANEL_TRUST_SECRET = SECRET;
        const now = 1_800_000_000_000; // fixed clock so the assertion is exact
        const header = panelTrust.signPanelStatement(
            { username: 'operator1', role: 'operator', orgId: 'org-7' }, 'put', '/api/panel/device-groups/g1/acl', now,
        );
        expect(header).toBeTruthy();

        const { statement, signature, expected, parts } = decodeStatement(header, SECRET);
        // Byte-identical HMAC — this is the cross-language contract.
        expect(signature).toBe(expected);
        expect(parts[0]).toBe('v1');
        expect(parts[1]).toBe('PUT'); // method normalised, matching Go
        expect(parts[2]).toBe('/api/panel/device-groups/g1/acl');
        expect(parts[3]).toBe('operator1');
        expect(parts[4]).toBe('operator'); // the operator's role, not the API key's
        expect(parts[5]).toBe('org-7');
        expect(Number(parts[6])).toBe(1_800_000_000);
        expect(Number(parts[7]) - Number(parts[6])).toBe(panelTrust.TTL_SECONDS);
        expect(parts[8]).toMatch(/^[0-9a-f]{32}$/); // nonce
    });

    it('never reuses a nonce', () => {
        process.env.PANEL_TRUST_SECRET = SECRET;
        const identity = { username: 'operator1', role: 'operator' };
        const first = decodeStatement(panelTrust.signPanelStatement(identity, 'GET', '/api/panel/folders'), SECRET);
        const second = decodeStatement(panelTrust.signPanelStatement(identity, 'GET', '/api/panel/folders'), SECRET);
        expect(first.parts[8]).not.toBe(second.parts[8]);
    });

    it('binds the statement to the method and path', () => {
        process.env.PANEL_TRUST_SECRET = SECRET;
        const identity = { username: 'operator1', role: 'operator' };
        const get = panelTrust.signPanelStatement(identity, 'GET', '/api/panel/folders');
        const post = panelTrust.signPanelStatement(identity, 'POST', '/api/panel/folders');
        expect(decodeStatement(get, SECRET).parts[1]).toBe('GET');
        // A GET statement's signature does not validate a POST statement.
        const forged = decodeStatement(post, SECRET).parts;
        forged[1] = 'GET';
        const tamperedMac = crypto.createHmac('sha256', SECRET).update(forged.join('\n'), 'utf8').digest('hex');
        expect(tamperedMac).not.toBe(decodeStatement(get, SECRET).signature);
    });

    it('refuses to sign without a username, a role or an absolute path', () => {
        process.env.PANEL_TRUST_SECRET = SECRET;
        expect(panelTrust.signPanelStatement({ role: 'operator' }, 'GET', '/api/panel/folders')).toBeNull();
        expect(panelTrust.signPanelStatement({ username: 'x' }, 'GET', '/api/panel/folders')).toBeNull();
        expect(panelTrust.signPanelStatement({ username: 'x', role: 'operator' }, 'GET', 'panel/folders')).toBeNull();
    });

    it('takes the identity from the panel session', () => {
        const identity = panelTrust.identityFromRequest({
            session: { user: { username: 'op', role: 'operator', orgId: 'o-1' } },
        });
        expect(identity).toEqual({ username: 'op', role: 'operator', orgId: 'o-1' });
        expect(panelTrust.identityFromRequest({ session: {} })).toBeNull();
        expect(panelTrust.identityFromRequest(null)).toBeNull();
    });

    it('is rejected by Go when the secret differs', () => {
        process.env.PANEL_TRUST_SECRET = SECRET;
        const header = panelTrust.signPanelStatement({ username: 'op', role: 'operator' }, 'GET', '/api/panel/folders');
        const { expected } = decodeStatement(header, SECRET);
        const otherExpected = crypto.createHmac('sha256', 'a-different-secret-value-here!!')
            .update(decodeStatement(header, SECRET).statement, 'utf8').digest('hex');
        expect(otherExpected).not.toBe(expected);
    });
});
