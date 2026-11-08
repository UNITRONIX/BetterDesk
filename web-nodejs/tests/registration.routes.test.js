/**
 * BetterDesk Console — Registration Routes Tests (#351 sidebar badge)
 */

'use strict';

const request = require('supertest');
const { createTestApp } = require('./helpers');

const mockDb = {
    getPendingRegistrationCount: jest.fn().mockResolvedValue(0),
    logAction: jest.fn().mockResolvedValue(undefined),
    getLatestAuditEntry: jest.fn().mockResolvedValue(null),
};

const mockBetterdeskApi = {
    getEnrollmentPending: jest.fn().mockResolvedValue({ success: true, data: [], count: 0 }),
    listHelpRequests: jest.fn().mockResolvedValue({ success: true, data: [] }),
    acknowledgeHelpRequest: jest.fn().mockResolvedValue({ success: true, data: {} }),
};

jest.mock('../services/database', () => mockDb);
jest.mock('../services/betterdeskApi', () => mockBetterdeskApi);
jest.mock('../services/deviceGroupService', () => ({}));
jest.mock('../services/serverBackend', () => ({}));

const registrationRoutes = require('../routes/registration.routes');

describe('Registration Routes — pending count', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockDb.getPendingRegistrationCount.mockResolvedValue(0);
        mockBetterdeskApi.getEnrollmentPending.mockResolvedValue({ success: true, data: [], count: 0 });

        app = createTestApp();
        app.use((req, _res, next) => {
            req.session.userId = 1;
            req.session.user = { id: 1, username: 'admin', role: 'admin' };
            next();
        });
        app.use('/', registrationRoutes);
    });

    it('GET /api/registrations/count sums LAN + Go managed enrollment pending', async () => {
        mockDb.getPendingRegistrationCount.mockResolvedValue(0);
        mockBetterdeskApi.getEnrollmentPending.mockResolvedValue({
            success: true,
            data: [{ device_id: 'Client-A' }],
            count: 2,
        });

        const res = await request(app).get('/api/registrations/count');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.count).toBe(2);
        expect(mockDb.getPendingRegistrationCount).toHaveBeenCalled();
        expect(mockBetterdeskApi.getEnrollmentPending).toHaveBeenCalled();
    });

    it('GET /api/registrations/count adds LAN and enrollment counts', async () => {
        mockDb.getPendingRegistrationCount.mockResolvedValue(3);
        mockBetterdeskApi.getEnrollmentPending.mockResolvedValue({
            success: true,
            data: [],
            count: 1,
        });

        const res = await request(app).get('/api/registrations/count');

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(4);
    });

    it('GET /api/registrations/count treats Go failure as zero enrollment pending', async () => {
        mockDb.getPendingRegistrationCount.mockResolvedValue(5);
        mockBetterdeskApi.getEnrollmentPending.mockResolvedValue({
            success: false,
            error: 'connection refused',
            data: [],
            count: 0,
        });

        const res = await request(app).get('/api/registrations/count');

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(5);
    });
});

describe('Registration Routes — help request handler names', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockDb.getLatestAuditEntry.mockResolvedValue(null);
        app = createTestApp();
        app.use((req, _res, next) => {
            req.session.userId = 7;
            req.session.user = { id: 7, username: 'demo_operator', role: 'admin' };
            next();
        });
        app.use('/', registrationRoutes);
    });

    it('records who accepted a request and shows that name instead of the API key', async () => {
        mockBetterdeskApi.acknowledgeHelpRequest.mockResolvedValue({ success: true, data: { id: 501 } });
        const accept = await request(app).post('/api/help/requests/501/accept');
        expect(accept.status).toBe(200);
        expect(mockDb.logAction).toHaveBeenCalledWith(7, 'help_request_accepted', 'Help request 501 accepted', expect.anything());

        mockBetterdeskApi.listHelpRequests.mockResolvedValue({
            success: true,
            data: [{ id: 501, device_id: '900100001', status: 'acknowledged', handled_by: 'apikey:console-bridge' }],
        });
        const list = await request(app).get('/api/help/requests');
        expect(list.body.requests[0].accepted_by).toBe('demo_operator');
    });

    it('looks the name up in the audit log and hides an unknown API key', async () => {
        mockDb.getLatestAuditEntry.mockImplementation(async (action, prefix) =>
            (prefix === 'Help request 502 accepted' ? { username: 'admin' } : null));
        mockBetterdeskApi.listHelpRequests.mockResolvedValue({
            success: true,
            data: [
                { id: 502, device_id: '900100002', status: 'acknowledged', handled_by: 'apikey:console-bridge' },
                { id: 503, device_id: '900100003', status: 'acknowledged', handled_by: 'apikey:console-bridge' },
                { id: 504, device_id: '900100004', status: 'resolved', handled_by: 'demo_helpdesk' },
            ],
        });
        const list = await request(app).get('/api/help/requests');
        const byId = Object.fromEntries(list.body.requests.map(r => [r.id, r]));
        expect(byId['502'].accepted_by).toBe('admin');
        expect(byId['503'].accepted_by).toBe('');
        expect(byId['504'].resolved_by).toBe('demo_helpdesk');
    });

    it('ignores an audit entry older than the request (id reused after a reset)', async () => {
        mockDb.getLatestAuditEntry.mockResolvedValue({ username: 'someone_else', created_at: '2020-01-01 00:00:00' });
        mockBetterdeskApi.listHelpRequests.mockResolvedValue({
            success: true,
            data: [{ id: 505, device_id: '900100005', status: 'acknowledged', handled_by: 'apikey:console-bridge', created_at: '2026-11-08T10:00:00Z' }],
        });
        const list = await request(app).get('/api/help/requests');
        expect(list.body.requests[0].accepted_by).toBe('');
    });
});
