'use strict';

/**
 * Enrollment compatibility (2026-11-13, C1 follow-up).
 *
 * Stock RustDesk clients and Support Agents cannot produce an Ed25519
 * signature. They are admitted through the product's own enrollment model:
 *
 *   - the operator approves the device in the Registrations tab, or
 *   - the operator hands the device a single-use enrollment token.
 *
 * The C1 hardening must keep both paths working while still refusing an
 * anonymous caller that has neither. These tests pin that contract so a future
 * "make registration stricter" change cannot lock real clients out.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../services/authService', () => ({}));
jest.mock('../services/betterdeskApi', () => ({
    listHelpRequests: jest.fn(),
    getEnrollmentPending: jest.fn(),
}));

jest.mock('../services/database', () => ({
    shouldRejectRenamedPeerRegistration: jest.fn().mockResolvedValue({ reject: false }),
    getRenamedPeerId: jest.fn().mockResolvedValue(null),
    getPeerRegistrationState: jest.fn().mockResolvedValue(null),
    getPendingRegistrationByDeviceId: jest.fn().mockResolvedValue(null),
    getAgentTemplateByToken: jest.fn().mockResolvedValue(null),
    upsertPeer: jest.fn().mockResolvedValue(undefined),
    updatePeerOnlineStatus: jest.fn().mockResolvedValue(undefined),
    getAccessToken: jest.fn().mockResolvedValue(null),
    touchAccessToken: jest.fn().mockResolvedValue(undefined),
    getReadNotificationIds: jest.fn().mockResolvedValue(new Set()),
    markAllNotificationsRead: jest.fn().mockResolvedValue(undefined),
    markNotificationRead: jest.fn().mockResolvedValue(undefined),
    getPendingRegistrations: jest.fn().mockResolvedValue([]),
}));

jest.mock('../lib/agentTemplates', () => ({
    findByEnrollmentToken: jest.fn(),
    redeemEnrollmentToken: jest.fn(),
    generateEnrollmentToken: jest.fn(() => 'token'),
    TABLE: 'agent_templates',
}));

jest.mock('../services/dbAdapter', () => ({
    getAdapter: jest.fn(() => ({ type: 'sqlite' })),
}));

const db = require('../services/database');
const agentTemplates = require('../lib/agentTemplates');
const bdApiRoutes = require('../routes/bd-api.routes');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/bd', bdApiRoutes);
    return app;
}

/** A stock client: device id + uuid + hostname, and no signing headers. */
const STOCK_BODY = {
    device_id: 'STOCKDEV01',
    uuid: 'machine-uid',
    hostname: 'STOCK-PC',
    platform: 'win',
    version: '1.4.7',
};

describe('stock client enrollment (no signature available)', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.BD_REGISTER_ALLOW_OPEN;
        db.getPeerRegistrationState.mockResolvedValue(null);
        db.getPendingRegistrationByDeviceId.mockResolvedValue(null);
        agentTemplates.findByEnrollmentToken.mockReturnValue(null);
        agentTemplates.redeemEnrollmentToken.mockReturnValue({ ok: false, boundTo: '' });
        app = makeApp();
    });

    it('admits a device the operator approved in Registrations', async () => {
        db.getPendingRegistrationByDeviceId.mockResolvedValue({
            id: 5,
            device_id: 'STOCKDEV01',
            status: 'approved',
            public_key: '',
        });

        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'STOCKDEV01')
            .send(STOCK_BODY);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(db.upsertPeer).toHaveBeenCalledTimes(1);
    });

    it('refuses an id that is only pending (operator has not approved yet)', async () => {
        db.getPendingRegistrationByDeviceId.mockResolvedValue({
            id: 5,
            device_id: 'STOCKDEV01',
            status: 'pending',
            public_key: '',
        });

        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'STOCKDEV01')
            .send(STOCK_BODY);

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('enrollment_proof_required');
        expect(db.upsertPeer).not.toHaveBeenCalled();
    });

    it('refuses an id whose approval was rejected', async () => {
        db.getPendingRegistrationByDeviceId.mockResolvedValue({
            id: 5,
            device_id: 'STOCKDEV01',
            status: 'rejected',
            public_key: '',
        });

        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'STOCKDEV01')
            .send(STOCK_BODY);

        expect(res.status).toBe(403);
        expect(db.upsertPeer).not.toHaveBeenCalled();
    });

    it('admits a device that presents a valid enrollment token', async () => {
        agentTemplates.findByEnrollmentToken.mockReturnValue({
            id: 1,
            name: 'office',
            config_json: '{}',
            enrolled_device_id: null,
        });
        agentTemplates.redeemEnrollmentToken.mockReturnValue({ ok: true, boundTo: 'STOCKDEV01' });

        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'STOCKDEV01')
            .send({ ...STOCK_BODY, enrollment_token: 'tok-abc' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(agentTemplates.redeemEnrollmentToken).toHaveBeenCalledWith(
            expect.anything(),
            'tok-abc',
            'STOCKDEV01',
        );
    });

    it('refuses an enrollment token already redeemed by another device', async () => {
        agentTemplates.findByEnrollmentToken.mockReturnValue({
            id: 1,
            name: 'office',
            config_json: '{}',
            enrolled_device_id: 'OTHERDEV99',
        });
        agentTemplates.redeemEnrollmentToken.mockReturnValue({ ok: false, boundTo: 'OTHERDEV99' });

        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'STOCKDEV01')
            .send({ ...STOCK_BODY, enrollment_token: 'tok-abc' });

        expect(res.status).toBe(403);
        expect(db.upsertPeer).not.toHaveBeenCalled();
    });

    it('still refuses a device with no approval, token, or proof', async () => {
        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'STOCKDEV01')
            .send(STOCK_BODY);

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('enrollment_proof_required');
        expect(db.upsertPeer).not.toHaveBeenCalled();
    });

    it('keeps an approved device working on later heartbeats after it exists', async () => {
        // Once the row exists with the same identity, no admission check repeats.
        db.getPeerRegistrationState.mockResolvedValue({
            id: 'STOCKDEV01',
            uuid: 'machine-uid',
            pk: null,
            banned: false,
            deleted: false,
        });

        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'STOCKDEV01')
            .send(STOCK_BODY);

        expect(res.status).toBe(200);
        expect(db.getPendingRegistrationByDeviceId).not.toHaveBeenCalled();
    });

    it('never resurrects a device the operator removed, even with a token', async () => {
        db.getPeerRegistrationState.mockResolvedValue({
            id: 'STOCKDEV01',
            uuid: 'machine-uid',
            pk: null,
            banned: false,
            deleted: true,
        });
        agentTemplates.findByEnrollmentToken.mockReturnValue({ id: 1, enrolled_device_id: null });
        agentTemplates.redeemEnrollmentToken.mockReturnValue({ ok: true, boundTo: 'STOCKDEV01' });

        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'STOCKDEV01')
            .send({ ...STOCK_BODY, enrollment_token: 'tok-abc' });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('device_removed');
        expect(db.upsertPeer).not.toHaveBeenCalled();
    });
});
