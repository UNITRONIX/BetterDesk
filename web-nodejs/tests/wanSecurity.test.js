'use strict';

const { EventEmitter } = require('node:events');
const { bodySizeLimit, pathWhitelist } = require('../middleware/wanSecurity');

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

function runBodySizeLimit(path, size) {
    const request = new EventEmitter();
    request.path = path;
    request.destroy = jest.fn();

    const response = {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json() {
            this.headersSent = true;
            return this;
        },
    };
    let nextCalled = false;

    bodySizeLimit(request, response, () => {
        nextCalled = true;
    });
    request.emit('data', Buffer.alloc(size));

    return { ...response, nextCalled, destroyed: request.destroy.mock.calls.length > 0 };
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

    test('allows heartbeat payloads larger than the default body limit', () => {
        const result = runBodySizeLimit('/api/heartbeat', 2048);

        expect(result.nextCalled).toBe(true);
        expect(result.statusCode).toBe(200);
        expect(result.destroyed).toBe(false);
    });

    test('rejects oversized unknown request bodies', () => {
        const result = runBodySizeLimit('/api/unknown', 2048);

        expect(result.nextCalled).toBe(true);
        expect(result.statusCode).toBe(413);
        expect(result.destroyed).toBe(true);
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
