'use strict';

const { pathWhitelist } = require('../middleware/wanSecurity');

function runWhitelist(path, method) {
    const req = { path, method };
    const response = {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        end() {
            this.ended = true;
            return this;
        },
    };
    let nextCalled = false;
    pathWhitelist(req, response, () => {
        nextCalled = true;
    });
    return { ...response, nextCalled };
}

describe('WAN API path whitelist', () => {
    test('allows the public telemetry key endpoint', () => {
        const result = runWhitelist('/api/telemetry/key', 'GET');

        expect(result.nextCalled).toBe(true);
        expect(result.statusCode).toBe(200);
    });

    test('rejects non-GET telemetry key requests', () => {
        const result = runWhitelist('/api/telemetry/key', 'POST');

        expect(result.nextCalled).toBe(false);
        expect(result.statusCode).toBe(405);
    });

    test('allows public branding reads and rejects branding writes', () => {
        expect(runWhitelist('/api/branding', 'GET').nextCalled).toBe(true);

        const result = runWhitelist('/api/branding', 'POST');
        expect(result.nextCalled).toBe(false);
        expect(result.statusCode).toBe(405);
    });

    test('allows unauthenticated enrollment bootstrap endpoints', () => {
        expect(runWhitelist('/api/devices/register', 'POST').nextCalled).toBe(true);
        expect(runWhitelist('/api/devices/register/status', 'GET').nextCalled).toBe(true);
    });

    test('allows both current-user methods used by clients', () => {
        expect(runWhitelist('/api/currentUser', 'GET').nextCalled).toBe(true);
        expect(runWhitelist('/api/currentUser', 'POST').nextCalled).toBe(true);
    });

    test('continues rejecting unknown paths', () => {
        const result = runWhitelist('/api/not-allowed', 'GET');

        expect(result.nextCalled).toBe(false);
        expect(result.statusCode).toBe(404);
    });
});
