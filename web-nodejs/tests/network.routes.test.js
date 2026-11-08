/**
 * BetterDesk Console - Network monitoring route permissions
 */

const request = require('supertest');
const { createTestApp, withAuth } = require('./helpers');

const mockAdapter = {
    getNetworkTargets: jest.fn(),
    getNetworkTargetById: jest.fn(),
    createNetworkTarget: jest.fn(),
    updateNetworkTarget: jest.fn(),
    deleteNetworkTarget: jest.fn(),
    insertNetworkCheck: jest.fn(),
    getNetworkCheckHistory: jest.fn(),
};

jest.mock('../services/dbAdapter', () => ({
    getAdapter: jest.fn(() => mockAdapter),
}));

const networkRoutes = require('../routes/network.routes');

function appFor(role) {
    const app = createTestApp();
    withAuth(app, { role });
    app.use('/api/network', networkRoutes);
    return app;
}

const newTarget = { name: 'Demo router', host: '192.0.2.1', check_type: 'ping', interval_ms: 60000 };

describe('Network routes permissions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAdapter.getNetworkTargets.mockResolvedValue([]);
        mockAdapter.getNetworkTargetById.mockResolvedValue(null);
        mockAdapter.getNetworkCheckHistory.mockResolvedValue([]);
        mockAdapter.createNetworkTarget.mockResolvedValue({ id: 1, ...newTarget });
        mockAdapter.updateNetworkTarget.mockResolvedValue({ id: 1, ...newTarget });
        mockAdapter.deleteNetworkTarget.mockResolvedValue(true);
    });

    it('lets a viewer read targets, history, stats and monitor status', async () => {
        const app = appFor('viewer');
        expect((await request(app).get('/api/network/targets')).status).toBe(200);
        expect((await request(app).get('/api/network/targets/1/history')).status).toBe(200);
        expect((await request(app).get('/api/network/stats')).status).toBe(200);
        expect((await request(app).get('/api/network/monitor/status')).status).toBe(200);
    });

    it('refuses to let a viewer or operator add, edit or delete a target', async () => {
        for (const role of ['viewer', 'operator']) {
            const app = appFor(role);
            expect((await request(app).post('/api/network/targets').send(newTarget)).status).toBe(403);
            expect((await request(app).patch('/api/network/targets/1').send({ name: 'x' })).status).toBe(403);
            expect((await request(app).delete('/api/network/targets/1')).status).toBe(403);
        }
        expect(mockAdapter.createNetworkTarget).not.toHaveBeenCalled();
        expect(mockAdapter.updateNetworkTarget).not.toHaveBeenCalled();
        expect(mockAdapter.deleteNetworkTarget).not.toHaveBeenCalled();
    });

    it('refuses to let a viewer or operator start or stop the monitor', async () => {
        for (const role of ['viewer', 'operator']) {
            const app = appFor(role);
            expect((await request(app).post('/api/network/monitor/start').send({})).status).toBe(403);
            expect((await request(app).post('/api/network/monitor/stop').send({})).status).toBe(403);
        }
    });

    it('refuses to let a viewer run a check or an ad-hoc tool from the server', async () => {
        const app = appFor('viewer');
        expect((await request(app).post('/api/network/targets/1/check').send({})).status).toBe(403);
        for (const tool of ['ping', 'tcp', 'http', 'resolve']) {
            const res = await request(app).post(`/api/network/${tool}`).send({});
            expect(res.status).toBe(403);
        }
        expect(mockAdapter.getNetworkTargetById).not.toHaveBeenCalled();
    });

    it('lets an operator run a check and the ad-hoc tools', async () => {
        const app = appFor('operator');
        // Unknown target and missing fields: the request got past the permission check.
        expect((await request(app).post('/api/network/targets/1/check').send({})).status).toBe(404);
        for (const tool of ['ping', 'tcp', 'http', 'resolve']) {
            const res = await request(app).post(`/api/network/${tool}`).send({});
            expect(res.status).toBe(400);
        }
    });

    it('lets roles with server.config add, edit and delete a target', async () => {
        for (const role of ['admin', 'server_admin']) {
            const app = appFor(role);
            expect((await request(app).post('/api/network/targets').send(newTarget)).status).toBe(201);
            expect((await request(app).patch('/api/network/targets/1').send({ name: 'x' })).status).toBe(200);
            expect((await request(app).delete('/api/network/targets/1')).status).toBe(200);
        }
    });

    it('refuses a global_admin without server.config to change targets', async () => {
        const res = await request(appFor('global_admin')).post('/api/network/targets').send(newTarget);
        expect(res.status).toBe(403);
    });
});
