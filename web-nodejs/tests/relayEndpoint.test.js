'use strict';

/**
 * Relay endpoint must always be advertised as `host:port`.
 *
 * RustDesk 1.4.8/1.4.9 clients configured with a bare `relay-server` fall back
 * to the API port and request relay on that socket. The relay then never pairs
 * and every session dies with `[relay] Pair timeout` (observed in production
 * as `relay=85.14.70.12:21114`).
 */

const conn = require('../services/agentBundleConnection');

describe('relayEndpointForHost', () => {
    const prevRelayPort = process.env.RELAY_PORT;

    beforeEach(() => {
        delete process.env.RELAY_PORT;
    });

    afterEach(() => {
        if (prevRelayPort === undefined) delete process.env.RELAY_PORT;
        else process.env.RELAY_PORT = prevRelayPort;
    });

    it('appends the default relay port to a bare host', () => {
        expect(conn.relayEndpointForHost('85.14.70.12')).toBe('85.14.70.12:21117');
        expect(conn.relayEndpointForHost('desk.example.com')).toBe('desk.example.com:21117');
    });

    it('keeps an explicit port instead of overriding it', () => {
        expect(conn.relayEndpointForHost('desk.example.com:21117')).toBe('desk.example.com:21117');
        expect(conn.relayEndpointForHost('198.51.100.20:21119')).toBe('198.51.100.20:21119');
    });

    it('strips scheme and path before adding the port', () => {
        expect(conn.relayEndpointForHost('https://desk.example.com/ws')).toBe('desk.example.com:21117');
    });

    it('handles IPv6 with and without brackets', () => {
        expect(conn.relayEndpointForHost('2001:db8::1')).toBe('[2001:db8::1]:21117');
        expect(conn.relayEndpointForHost('[2001:db8::1]')).toBe('[2001:db8::1]:21117');
        expect(conn.relayEndpointForHost('[2001:db8::1]:21117')).toBe('[2001:db8::1]:21117');
    });

    it('honours an explicit port argument and RELAY_PORT', () => {
        expect(conn.relayEndpointForHost('desk.example.com', 21119)).toBe('desk.example.com:21119');
        process.env.RELAY_PORT = '21118';
        expect(conn.relayEndpointForHost('desk.example.com')).toBe('desk.example.com:21118');
    });

    it('returns empty string for empty input', () => {
        expect(conn.relayEndpointForHost('')).toBe('');
        expect(conn.relayEndpointForHost(null)).toBe('');
        expect(conn.relayEndpointForHost(undefined)).toBe('');
    });

    it('never yields the API port for a bare host', () => {
        // 21114 is the Go API; advertising it makes both peers dial HTTP.
        expect(conn.relayEndpointForHost('85.14.70.12')).not.toContain(':21114');
    });
});
