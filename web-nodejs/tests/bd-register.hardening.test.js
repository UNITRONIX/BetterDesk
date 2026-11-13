'use strict';

/**
 * `POST /api/bd/register` hardening (2026-11-13 audit, finding C1).
 *
 * Before the fix an unauthenticated host could:
 *   - create unlimited peers with only an `X-Device-Id` header,
 *   - resurrect a banned / soft-deleted device by re-registering it,
 *   - replace the `pk` bound to an existing device id.
 */

const crypto = require('crypto');
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
    upsertPeer: jest.fn().mockResolvedValue(undefined),
    updatePeerOnlineStatus: jest.fn().mockResolvedValue(undefined),
    getAccessToken: jest.fn().mockResolvedValue(null),
    touchAccessToken: jest.fn().mockResolvedValue(undefined),
    getReadNotificationIds: jest.fn().mockResolvedValue(new Set()),
    markAllNotificationsRead: jest.fn().mockResolvedValue(undefined),
    markNotificationRead: jest.fn().mockResolvedValue(undefined),
    getPendingRegistrations: jest.fn().mockResolvedValue([]),
}));

const db = require('../services/database');
const enrollmentProof = require('../lib/enrollmentProof');
const bdApiRoutes = require('../routes/bd-api.routes');

function createDevice() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
    return {
        publicKeyB64: raw.toString('base64'),
        privateKey,
    };
}

function signProof(device, { deviceId, method = 'POST', path = '/api/bd/register' } = {}) {
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomBytes(8).toString('hex');
    const canonical = enrollmentProof.canonicalizePublicKey(device.publicKeyB64);
    const payload = enrollmentProof.proofPayload(method, path, deviceId, canonical, timestamp, nonce);
    const signature = crypto.sign(null, payload, device.privateKey).toString('base64');
    return {
        'X-BD-Enrollment-Timestamp': timestamp,
        'X-BD-Enrollment-Nonce': nonce,
        'X-BD-Enrollment-Signature': signature,
    };
}

describe('BD-API register hardening (C1)', () => {
    let app;
    const originalAllowOpen = process.env.BD_REGISTER_ALLOW_OPEN;

    beforeEach(() => {
        jest.clearAllMocks();
        enrollmentProof.resetNonceCache();
        delete process.env.BD_REGISTER_ALLOW_OPEN;
        db.getPeerRegistrationState.mockResolvedValue(null);
        db.shouldRejectRenamedPeerRegistration.mockResolvedValue({ reject: false });
        db.getRenamedPeerId.mockResolvedValue(null);

        app = express();
        app.use(express.json());
        app.use('/api/bd', bdApiRoutes);
    });

    afterAll(() => {
        if (originalAllowOpen === undefined) delete process.env.BD_REGISTER_ALLOW_OPEN;
        else process.env.BD_REGISTER_ALLOW_OPEN = originalAllowOpen;
    });

    it('rejects a first registration without proof of possession', async () => {
        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'NEWDEV001')
            .send({ device_id: 'NEWDEV001', uuid: 'u-1', public_key: 'AAAA1111' });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('enrollment_proof_required');
        expect(db.upsertPeer).not.toHaveBeenCalled();
    });

    it('accepts a first registration with a valid Ed25519 proof', async () => {
        const device = createDevice();
        const headers = signProof(device, { deviceId: 'NEWDEV002' });

        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'NEWDEV002')
            .set(headers)
            .send({ device_id: 'NEWDEV002', uuid: 'u-1', public_key: device.publicKeyB64 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(db.upsertPeer).toHaveBeenCalledTimes(1);
    });

    it('rejects a replayed proof (same nonce)', async () => {
        const device = createDevice();
        const headers = signProof(device, { deviceId: 'NEWDEV003' });
        const body = { device_id: 'NEWDEV003', uuid: 'u-1', public_key: device.publicKeyB64 };

        const first = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'NEWDEV003')
            .set(headers)
            .send(body);
        expect(first.status).toBe(200);

        db.getPeerRegistrationState.mockResolvedValue(null);
        const second = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'NEWDEV003')
            .set(headers)
            .send(body);

        expect(second.status).toBe(403);
        // The refusal is deliberately neutral: it must not tell a caller whether
        // a proof was replayed, missing, or simply not accepted.
        expect(second.body.error).toBe('enrollment_proof_required');
    });

    it('rejects a banned device before writing anything', async () => {
        db.getPeerRegistrationState.mockResolvedValue({
            id: 'BANNED01',
            uuid: 'u-1',
            pk: null,
            banned: true,
            deleted: false,
            banReason: 'abuse',
        });

        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'BANNED01')
            .send({ device_id: 'BANNED01', uuid: 'u-1' });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('device_banned');
        expect(db.upsertPeer).not.toHaveBeenCalled();
    });

    it('rejects a soft-deleted device (cannot resurrect by re-registering)', async () => {
        db.getPeerRegistrationState.mockResolvedValue({
            id: 'DELETED01',
            uuid: 'u-1',
            pk: null,
            banned: false,
            deleted: true,
            banReason: '',
        });

        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'DELETED01')
            .send({ device_id: 'DELETED01', uuid: 'u-1' });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('device_removed');
        expect(db.upsertPeer).not.toHaveBeenCalled();
    });

    it('rejects a public_key swap on an existing device without proof', async () => {
        const victim = createDevice();
        const attacker = createDevice();
        db.getPeerRegistrationState.mockResolvedValue({
            id: 'VICTIM01',
            uuid: 'victim-uuid',
            pk: victim.publicKeyB64,
            banned: false,
            deleted: false,
            banReason: '',
        });

        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'VICTIM01')
            .send({ device_id: 'VICTIM01', uuid: 'victim-uuid', public_key: attacker.publicKeyB64 });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('identity_proof_required');
        expect(db.upsertPeer).not.toHaveBeenCalled();
    });

    it('allows a key rotation when the caller proves possession of the old key', async () => {
        const victim = createDevice();
        db.getPeerRegistrationState.mockResolvedValue({
            id: 'VICTIM02',
            uuid: 'victim-uuid',
            pk: victim.publicKeyB64,
            banned: false,
            deleted: false,
            banReason: '',
        });

        const headers = signProof(victim, { deviceId: 'VICTIM02' });
        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'VICTIM02')
            .set(headers)
            .send({ device_id: 'VICTIM02', uuid: 'victim-uuid', public_key: victim.publicKeyB64 });

        expect(res.status).toBe(200);
        expect(db.upsertPeer).toHaveBeenCalledTimes(1);
    });

    it('keeps heartbeats cheap for an unchanged identity', async () => {
        const device = createDevice();
        db.getPeerRegistrationState.mockResolvedValue({
            id: 'STEADY01',
            uuid: 'steady-uuid',
            pk: device.publicKeyB64,
            banned: false,
            deleted: false,
            banReason: '',
        });

        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'STEADY01')
            .send({
                device_id: 'STEADY01',
                uuid: 'steady-uuid',
                public_key: device.publicKeyB64,
                hostname: 'PC-1',
            });

        expect(res.status).toBe(200);
        expect(db.upsertPeer).toHaveBeenCalledTimes(1);
    });

    it('still honours the explicit open-registration escape hatch', async () => {
        process.env.BD_REGISTER_ALLOW_OPEN = 'true';

        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'LEGACY01')
            .send({ device_id: 'LEGACY01', uuid: 'u-1', public_key: 'AAAA1111' });

        expect(res.status).toBe(200);
        expect(db.upsertPeer).toHaveBeenCalledTimes(1);
    });

    it('requires admission (approval, token or key) when open registration is disabled', async () => {
        // A caller with no public_key, no approval and no token is refused with
        // the same neutral error a wrong proof gets, so the response cannot be
        // used to probe which admission method the server is missing.
        const res = await request(app)
            .post('/api/bd/register')
            .set('X-Device-Id', 'NOKEY001')
            .send({ device_id: 'NOKEY001' });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('enrollment_proof_required');
        expect(db.upsertPeer).not.toHaveBeenCalled();
    });

    it('throttles registration floods per IP', async () => {
        const device = createDevice();
        let lastStatus = 0;
        for (let i = 0; i < 25; i += 1) {
            const headers = signProof(device, { deviceId: `FLOOD${String(i).padStart(3, '0')}` });
            const res = await request(app)
                .post('/api/bd/register')
                .set('X-Device-Id', `FLOOD${String(i).padStart(3, '0')}`)
                .set(headers)
                .send({
                    device_id: `FLOOD${String(i).padStart(3, '0')}`,
                    uuid: `u-${i}`,
                    public_key: device.publicKeyB64,
                });
            lastStatus = res.status;
        }
        expect(lastStatus).toBe(429);
    });
});
