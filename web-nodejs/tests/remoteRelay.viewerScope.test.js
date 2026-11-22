/**
 * Regressions for GHSA-22mg-g52q-x75c.
 *
 * The /ws/remote-viewer/:device_id upgrade handler checked device.connect but
 * never checked that the user may access *that* device, so an operator whose
 * device scope excluded a device could watch its screen and send input.
 *
 * remoteRelay.authorizeViewerDevice is the extracted decision point; these tests
 * pin its behaviour, including that an out-of-scope device is indistinguishable
 * from a missing one.
 */

const path = require('path');

// The service pulls in the whole database layer at require time; mock it so this
// stays a focused unit test.
jest.mock('../services/database', () => ({
    getPeerById: jest.fn(),
}));

jest.mock('../services/deviceGroupService', () => ({
    authorizeUserDeviceAccess: jest.fn(),
}));

const db = require('../services/database');
const deviceGroupService = require('../services/deviceGroupService');
const remoteRelay = require('../services/remoteRelay');

describe('remoteRelay.authorizeViewerDevice (GHSA-22mg-g52q-x75c)', () => {
    const operator = { id: 7, username: 'olga', role: 'operator' };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('allows a device the user can access', async () => {
        deviceGroupService.authorizeUserDeviceAccess.mockResolvedValue({ allowed: true });

        const result = await remoteRelay.authorizeViewerDevice(operator, 'DEVICE_B');

        expect(result.allowed).toBe(true);
        expect(deviceGroupService.authorizeUserDeviceAccess).toHaveBeenCalledWith(db, operator, 'DEVICE_B');
    });

    test('rejects a device outside the user scope', async () => {
        deviceGroupService.authorizeUserDeviceAccess.mockResolvedValue({
            allowed: false,
            statusCode: 404,
            reason: 'out-of-scope'
        });

        const result = await remoteRelay.authorizeViewerDevice(operator, 'DEVICE_B');

        expect(result.allowed).toBe(false);
        expect(result.statusCode).toBe(404);
        expect(result.statusText).toBe('Not Found');
    });

    test('rejects an unknown device', async () => {
        deviceGroupService.authorizeUserDeviceAccess.mockResolvedValue({
            allowed: false,
            statusCode: 404,
            reason: 'unknown-device'
        });

        const result = await remoteRelay.authorizeViewerDevice(operator, 'NOPE');

        expect(result.allowed).toBe(false);
        expect(result.statusCode).toBe(404);
    });

    test('out-of-scope and missing devices are indistinguishable', async () => {
        deviceGroupService.authorizeUserDeviceAccess.mockResolvedValue({
            allowed: false,
            statusCode: 404,
            reason: 'out-of-scope'
        });
        const outOfScope = await remoteRelay.authorizeViewerDevice(operator, 'DEVICE_B');

        deviceGroupService.authorizeUserDeviceAccess.mockResolvedValue({
            allowed: false,
            statusCode: 404,
            reason: 'unknown-device'
        });
        const missing = await remoteRelay.authorizeViewerDevice(operator, 'DEVICE_B');

        expect(outOfScope.statusCode).toBe(missing.statusCode);
        expect(outOfScope.statusText).toBe(missing.statusText);
    });

    test('is exported for the upgrade handler to call', () => {
        expect(typeof remoteRelay.authorizeViewerDevice).toBe('function');
    });
});

describe('remote-viewer upgrade handler wires the scope check', () => {
    test('the handler awaits authorizeViewerDevice before upgrading', () => {
        const source = require('fs').readFileSync(
            path.join(__dirname, '..', 'services', 'remoteRelay.js'),
            'utf8'
        );
        const viewerBlock = source.slice(
            source.indexOf('/ws/remote-viewer/'),
            source.indexOf('log.info(\'Remote relay initialized')
        );
        expect(viewerBlock).toContain('authorizeViewerDevice');
        // The device id must come from the URL match, not an unvalidated echo.
        expect(viewerBlock).toContain('viewerMatch[1]');
        // Must be checked before the socket is upgraded.
        expect(viewerBlock.indexOf('authorizeViewerDevice'))
            .toBeLessThan(viewerBlock.indexOf('wss.handleUpgrade'));
    });
});
