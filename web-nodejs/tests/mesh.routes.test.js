'use strict';

const assert = require('assert');
const { meshActionLimiter } = require('../middleware/rateLimiter');

jest.mock('../services/betterdeskApi', () => ({
    getMeshStatus: jest.fn(),
    apiClient: {},
}));

describe('meshcentral.routes', () => {
    it('registers mesh status, recordings, and group routes', () => {
        const router = require('../routes/meshcentral.routes');
        assert.ok(router);
        const paths = (router.stack || []).map((layer) => layer.route && layer.route.path).filter(Boolean);
        assert.ok(paths.includes('/api/mesh/status'));
        assert.ok(paths.includes('/api/session/recordings'));
        assert.ok(paths.includes('/api/mesh/devices/:id/group'));
        assert.ok(paths.includes('/api/mesh/recordings'));
    });

    it('rate-limits every MeshCentral device action route', () => {
        const router = require('../routes/meshcentral.routes');
        const actionPaths = [
            '/api/mesh/devices/:id/terminal',
            '/api/mesh/devices/:id/files',
            '/api/mesh/devices/:id/share',
            '/api/mesh/devices/:id/tcp',
            '/api/mesh/devices/:id/udp',
            '/api/mesh/devices/:id/power',
            '/api/mesh/devices/:id/exec',
        ];

        for (const path of actionPaths) {
            const layer = (router.stack || []).find((entry) => entry.route && entry.route.path === path);
            assert.ok(layer, `missing route ${path}`);
            assert.ok(
                layer.route.stack.some((entry) => entry.handle === meshActionLimiter),
                `missing MeshCentral action limiter on ${path}`
            );
        }
    });
});
