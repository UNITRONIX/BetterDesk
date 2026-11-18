'use strict';

/**
 * HTTP→HTTPS redirect host validation (audit H5, 2026-11-13).
 *
 * The redirect used `req.hostname`, i.e. the raw `Host` header, so
 * `Host: attacker.example` produced `Location: https://attacker.example:5443/`
 * and an absolute request target was concatenated verbatim.
 */

const {
    normalizeConfiguredHost,
    resolveRedirectHost,
    buildSafeRedirectUrl,
} = require('../lib/redirectHost');

describe('normalizeConfiguredHost', () => {
    it('accepts hostnames, IPs and full origins', () => {
        expect(normalizeConfiguredHost('desk.example.com')).toBe('desk.example.com');
        expect(normalizeConfiguredHost('  DESK.Example.COM  ')).toBe('desk.example.com');
        expect(normalizeConfiguredHost('https://desk.example.com:5443/login')).toBe('desk.example.com');
        expect(normalizeConfiguredHost('192.0.2.10')).toBe('192.0.2.10');
        expect(normalizeConfiguredHost('[2001:db8::1]')).toBe('2001:db8::1');
    });

    it('rejects header-injection and markup payloads', () => {
        expect(normalizeConfiguredHost('attacker.example\r\nX-Injected: 1')).toBeNull();
        expect(normalizeConfiguredHost('evil.example"><script>alert(1)</script>')).toBeNull();
        expect(normalizeConfiguredHost('a b')).toBeNull();
        expect(normalizeConfiguredHost('')).toBeNull();
        expect(normalizeConfiguredHost(undefined)).toBeNull();
    });
});

describe('resolveRedirectHost', () => {
    it('prefers configured host over anything from the request', () => {
        const resolved = resolveRedirectHost({
            configuredHost: 'desk.example.com',
            listenHost: '0.0.0.0',
        });
        expect(resolved).toEqual({ host: 'desk.example.com', source: 'config' });
    });

    it('uses the bound listener address when nothing is configured', () => {
        expect(resolveRedirectHost({ listenHost: '192.0.2.10' }))
            .toEqual({ host: '192.0.2.10', source: 'listen' });
    });

    it('never uses a wildcard bind address', () => {
        expect(resolveRedirectHost({ listenHost: '0.0.0.0' }).host).toBe('localhost');
        expect(resolveRedirectHost({ listenHost: '::' }).host).toBe('localhost');
    });
});

describe('buildSafeRedirectUrl', () => {
    it('builds a normal same-origin redirect', () => {
        expect(buildSafeRedirectUrl({ host: 'desk.example.com', port: 5443, urlPath: '/login?x=1' }))
            .toBe('https://desk.example.com:5443/login?x=1');
    });

    it('omits the port for 443', () => {
        expect(buildSafeRedirectUrl({ host: 'desk.example.com', port: 443, urlPath: '/login' }))
            .toBe('https://desk.example.com/login');
    });

    it('ignores a hostile host value', () => {
        expect(buildSafeRedirectUrl({ host: 'attacker.example\r\nSet-Cookie: x', port: 5443, urlPath: '/login' }))
            .toBe('https://localhost:5443/login');
    });

    it('refuses absolute request targets (no header/URL smuggling)', () => {
        expect(buildSafeRedirectUrl({ host: 'desk.example.com', port: 5443, urlPath: 'http://evil.example/login' }))
            .toBe('https://desk.example.com:5443/');
        expect(buildSafeRedirectUrl({ host: 'desk.example.com', port: 5443, urlPath: '//evil.example/login' }))
            .toBe('https://desk.example.com:5443/');
    });
});
