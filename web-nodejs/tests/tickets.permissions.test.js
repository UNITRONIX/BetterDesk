/**
 * Ticket API permissions follow the device permissions the Tickets page
 * uses: device.view to read, device.edit to create, change, delete and
 * attach. The writes used to check the role names admin and operator, so
 * super_admin and global_admin got 403 while the page offered the buttons.
 * PATCH also takes device_id now (it used to drop it).
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/database', () => ({}));
jest.mock('../middleware/deviceAuth', () => ({ requireDeviceToken: (_req, _res, next) => next() }));
jest.mock('../middleware/rateLimiter', () => ({
    uploadLimiter: (_req, _res, next) => next(),
    fileAccessLimiter: (_req, _res, next) => next()
}));

const mockTicket = { id: 7, title: 'Printer', description: '', status: 'open', priority: 'medium', device_id: null };
const mockAdapter = {
    getAllTickets: jest.fn().mockResolvedValue([mockTicket]),
    getTicketStats: jest.fn().mockResolvedValue({ total: 1 }),
    getTicketById: jest.fn().mockResolvedValue(mockTicket),
    getTicketComments: jest.fn().mockResolvedValue([]),
    getTicketAttachments: jest.fn().mockResolvedValue([]),
    createTicket: jest.fn().mockResolvedValue({ id: 8, title: 'New' }),
    updateTicket: jest.fn().mockResolvedValue(undefined),
    deleteTicket: jest.fn().mockResolvedValue(undefined),
    addTicketComment: jest.fn().mockResolvedValue({ id: 1 }),
    addTicketAttachment: jest.fn().mockResolvedValue({ id: 3 }),
    logAction: jest.fn().mockResolvedValue(undefined)
};
jest.mock('../services/dbAdapter', () => ({ getAdapter: () => mockAdapter }));

jest.mock('fs', () => {
    const real = jest.requireActual('fs');
    return { ...real, writeFileSync: jest.fn(), unlinkSync: jest.fn() };
});

const ticketsRoutes = require('../routes/tickets.routes');

function app(role) {
    const a = createTestApp();
    a.use((req, _res, next) => {
        req.session.userId = 5;
        req.session.user = { id: 5, username: 'u', role };
        next();
    });
    a.use('/api/tickets', ticketsRoutes);
    return a;
}

const writes = [
    ['create', (a) => request(a).post('/api/tickets').send({ title: 'New' }), 201],
    ['update', (a) => request(a).patch('/api/tickets/7').send({ status: 'in_progress' }), 200],
    ['delete', (a) => request(a).delete('/api/tickets/7'), 200],
    ['attach', (a) => request(a).post('/api/tickets/7/attachments').send({ filename: 'a.txt', data: 'aGk=' }), 201]
];

describe('ticket writes need device.edit', () => {
    beforeEach(() => jest.clearAllMocks());

    test.each(['super_admin', 'admin', 'global_admin', 'operator'])('%s can create, change, delete and attach', async (role) => {
        for (const [, send, status] of writes) {
            const res = await send(app(role));
            expect(res.status).toBe(status);
        }
        expect(mockAdapter.createTicket).toHaveBeenCalledTimes(1);
        expect(mockAdapter.updateTicket).toHaveBeenCalledTimes(1);
        expect(mockAdapter.deleteTicket).toHaveBeenCalledTimes(1);
        expect(mockAdapter.addTicketAttachment).toHaveBeenCalledTimes(1);
    });

    test.each(['viewer', 'server_admin', 'guest_issuer', 'pro'])('%s cannot', async (role) => {
        for (const [, send] of writes) {
            const res = await send(app(role));
            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
        }
        expect(mockAdapter.createTicket).not.toHaveBeenCalled();
        expect(mockAdapter.updateTicket).not.toHaveBeenCalled();
        expect(mockAdapter.deleteTicket).not.toHaveBeenCalled();
        expect(mockAdapter.addTicketAttachment).not.toHaveBeenCalled();
    });
});

describe('ticket reads need device.view', () => {
    beforeEach(() => jest.clearAllMocks());

    test.each(['viewer', 'server_admin', 'operator', 'global_admin', 'super_admin'])('%s can read and comment', async (role) => {
        expect((await request(app(role)).get('/api/tickets')).status).toBe(200);
        expect((await request(app(role)).get('/api/tickets/7')).status).toBe(200);
        expect((await request(app(role)).get('/api/tickets/7/comments')).status).toBe(200);
        expect((await request(app(role)).post('/api/tickets/7/comments').send({ body: 'hi' })).status).toBe(201);
    });

    test('a role without device.view reads nothing', async () => {
        expect((await request(app('pro')).get('/api/tickets')).status).toBe(403);
        expect((await request(app('pro')).get('/api/tickets/7')).status).toBe(403);
        expect((await request(app('pro')).post('/api/tickets/7/comments').send({ body: 'hi' })).status).toBe(403);
        expect(mockAdapter.addTicketComment).not.toHaveBeenCalled();
    });

    test('no session is 401', async () => {
        const a = createTestApp();
        a.use('/api/tickets', ticketsRoutes);
        expect((await request(a).get('/api/tickets')).status).toBe(401);
        expect((await request(a).post('/api/tickets').send({ title: 'x' })).status).toBe(401);
    });
});

describe('attachments above 2 MB (A7)', () => {
    // The console's own body parser, not the test helper's
    function consoleApp(role) {
        const express = require('express');
        const session = require('express-session');
        const { jsonBody } = require('../lib/jsonBody');
        const a = express();
        a.use(jsonBody());
        a.use(session({ secret: 'test', resave: false, saveUninitialized: true }));
        a.use((req, _res, next) => {
            req.session.userId = 5;
            req.session.user = { id: 5, username: 'u', role };
            next();
        });
        a.use('/api/tickets', ticketsRoutes);
        return a;
    }
    const big = { filename: 'log.zip', data: Buffer.alloc(4 * 1024 * 1024, 7).toString('base64') };

    beforeEach(() => jest.clearAllMocks());

    test('reach the attachment route', async () => {
        const res = await request(consoleApp('operator')).post('/api/tickets/7/attachments').send(big);
        expect(res.status).toBe(201);
        expect(mockAdapter.addTicketAttachment).toHaveBeenCalledTimes(1);
    });

    test('are refused without device.edit', async () => {
        const res = await request(consoleApp('viewer')).post('/api/tickets/7/attachments').send(big);
        expect(res.status).toBe(403);
        expect(mockAdapter.addTicketAttachment).not.toHaveBeenCalled();
    });
});

describe('ticket PATCH', () => {
    beforeEach(() => jest.clearAllMocks());

    test('changes the device and clears it with null (P10)', async () => {
        await request(app('operator')).patch('/api/tickets/7').send({ device_id: '900100001' }).expect(200);
        expect(mockAdapter.updateTicket).toHaveBeenLastCalledWith(7, { device_id: '900100001' });
        await request(app('operator')).patch('/api/tickets/7').send({ device_id: '' }).expect(200);
        expect(mockAdapter.updateTicket).toHaveBeenLastCalledWith(7, { device_id: null });
    });

    test('refuses a device ID that is not text', async () => {
        const res = await request(app('operator')).patch('/api/tickets/7').send({ device_id: { x: 1 } });
        expect(res.status).toBe(400);
        expect(mockAdapter.updateTicket).not.toHaveBeenCalled();
    });
});
