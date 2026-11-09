/**
 * BetterDesk Console - GET /api/dashboard/activity
 *
 * The feed reads the Go server's audit log, which answers { events: [...] }
 * (api/server.go handleAuditEvents), and audit data needs audit.view, as the
 * Go endpoint and the console's own audit views do.
 */

const request = require('supertest');
const { createTestApp, withAuth } = require('./helpers');

const mockDb = {
    getAuditLogs: jest.fn(),
    getRecentConnections: jest.fn(),
};
const mockBetterdeskApi = {
    getAuditEvents: jest.fn(),
};

jest.mock('../services/database', () => mockDb);
jest.mock('../services/betterdeskApi', () => mockBetterdeskApi);

const dashboardRoutes = require('../routes/dashboard.routes');

function appFor(role) {
    const app = createTestApp();
    withAuth(app, { role });
    app.use('/', dashboardRoutes);
    return app;
}

describe('GET /api/dashboard/activity', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDb.getAuditLogs.mockResolvedValue([{ action: 'local_only', details: 'panel log', created_at: '2026-11-09 10:00:00' }]);
        mockDb.getRecentConnections.mockResolvedValue([]);
        // What betterdeskApi.getAuditEvents makes of Go's answer (wrap: { success, data })
        mockBetterdeskApi.getAuditEvents.mockResolvedValue({
            success: true,
            data: {
                enabled: true,
                total: 2,
                count: 2,
                events: [
                    { timestamp: '2026-11-09T09:58:00Z', action: 'peer_banned', actor: 'admin', target: '123456789', details: { reason: 'lost laptop' } },
                    { timestamp: '2026-11-09T09:59:00Z', action: 'config_changed', actor: 'api', details: { message: 'relay changed', peer_id: '987654321' } },
                ],
            },
        });
    });

    it('lists the events the Go server sends', async () => {
        const res = await request(appFor('admin')).get('/api/dashboard/activity');

        expect(res.status).toBe(200);
        expect(res.body.events).toEqual([
            { action: 'peer_banned', action_label: 'peer_banned', device_id: '123456789', details: 'lost laptop', timestamp: '2026-11-09T09:58:00Z' },
            { action: 'config_changed', action_label: 'config_changed', device_id: '987654321', details: 'relay changed', timestamp: '2026-11-09T09:59:00Z' },
        ]);
        // Go answered, so the console's own log is not the source
        expect(mockDb.getAuditLogs).not.toHaveBeenCalled();
    });

    it('still reads the older entries shape', async () => {
        mockBetterdeskApi.getAuditEvents.mockResolvedValue({
            success: true,
            data: { entries: [{ action: 'peer_deleted', peer_id: '555555555', details: { message: 'gone' }, created_at: '2026-11-08T08:00:00Z' }] },
        });
        const res = await request(appFor('admin')).get('/api/dashboard/activity');

        expect(res.status).toBe(200);
        expect(res.body.events).toEqual([
            { action: 'peer_deleted', action_label: 'peer_deleted', device_id: '555555555', details: 'gone', timestamp: '2026-11-08T08:00:00Z' },
        ]);
    });

    it('needs audit.view, like every other view of the audit log', async () => {
        // guest_issuer has device.view but not audit.view
        for (const role of ['guest_issuer', 'pro']) {
            const res = await request(appFor(role)).get('/api/dashboard/activity');
            expect(res.status).toBe(403);
        }
        expect(mockBetterdeskApi.getAuditEvents).not.toHaveBeenCalled();
        expect(mockDb.getAuditLogs).not.toHaveBeenCalled();
    });
});
