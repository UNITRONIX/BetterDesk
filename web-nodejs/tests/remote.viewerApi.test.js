/**
 * The JSON endpoints behind the new remote client pages (web-ui):
 *
 * - GET /api/remote/viewer/:id applies the viewer's access rules (console
 *   session with device.connect or remote_target.connect, guest grant for
 *   the device, mesh share, id check) and answers JSON.
 * - The dev mock is set only with BD_DEV_MOCK_REMOTE=1 and ?mock=1.
 * - /api/remote/login-info, /api/remote/guest-info and /api/remote/desk
 *   carry the checks the old /remote/login, /remote/guest and /remote pages
 *   made.
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/betterdeskApi', () => ({
    getRemoteTarget: jest.fn(),
    getPeer: jest.fn(),
    getHealth: jest.fn().mockResolvedValue({ connection: { p2p_first: false } }),
    apiClient: { get: jest.fn() }
}));
jest.mock('../services/database', () => ({
    getDevice: jest.fn()
}));
jest.mock('../services/keyService', () => ({
    resolvePublicKey: jest.fn().mockResolvedValue('PUBKEY=')
}));
jest.mock('../services/serverConnectionConfigService', () => ({
    getConnectionMode: jest.fn().mockResolvedValue({ mode: 'p2p_first' })
}));

const betterdeskApi = require('../services/betterdeskApi');
const db = require('../services/database');
const remoteRoutes = require('../routes/remote.routes');

const FLAG = 'BD_DEV_MOCK_REMOTE';

function app(user) {
    const a = createTestApp();
    a.use(require('cookie-parser')());
    a.use((req, res, next) => {
        if (user) {
            req.session.userId = user.id;
            req.session.user = user;
        }
        res.locals.csrfToken = 'csrf-1';
        req.t = (key, fallback) => fallback || key;
        next();
    });
    a.use(remoteRoutes);
    return a;
}

const ADMIN = { id: 1, username: 'demo_ui_admin', role: 'admin' };
const VIEWER = { id: 3, username: 'demo_viewer', role: 'viewer' };

let savedFlag;
beforeEach(() => {
    savedFlag = process.env[FLAG];
    delete process.env[FLAG];
    jest.clearAllMocks();
    db.getDevice.mockResolvedValue({ id: '900100012', hostname: 'demo-build-server', platform: 'Ubuntu 24.04' });
    betterdeskApi.getPeer.mockResolvedValue({ id: '900100012', device_type: '' });
});
afterEach(() => {
    if (savedFlag === undefined) delete process.env[FLAG];
    else process.env[FLAG] = savedFlag;
});

describe('GET /api/remote/viewer/:deviceId', () => {
    test('gives a signed-in operator the viewer data', async () => {
        const res = await request(app(ADMIN)).get('/api/remote/viewer/900100012');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/json/);
        expect(res.body).toMatchObject({
            success: true,
            deviceId: '900100012',
            device: { name: 'demo-build-server', platform: 'Ubuntu 24.04' },
            serverPubKey: 'PUBKEY=',
            connection: { p2p_first: false },
            capabilities: { transport: 'rd', guest_access: false, remote_target: false },
            mockRemote: null,
            user: { id: 1, name: 'demo_ui_admin' },
            workReports: true,
            csrfToken: 'csrf-1'
        });
    });

    test('offers the work report only to roles that may write one', async () => {
        // A role override that keeps device.connect but not billing.reports
        const a = createTestApp();
        a.use((req, res, next) => {
            req.session.userId = 2;
            req.session.user = { id: 2, username: 'demo_operator', role: 'operator' };
            req.effectivePermissions = new Set(['device.connect']);
            req.t = (key, fallback) => fallback || key;
            next();
        });
        a.use(remoteRoutes);
        const res = await request(a).get('/api/remote/viewer/900100012');
        expect(res.status).toBe(200);
        expect(res.body.workReports).toBe(false);
    });

    test('answers 401 as JSON without a session', async () => {
        const res = await request(app(null)).get('/api/remote/viewer/900100012');
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    test('refuses a role without device.connect', async () => {
        const res = await request(app(VIEWER)).get('/api/remote/viewer/900100012');
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/device\.connect/);
    });

    test('needs remote_target.connect for a remote target', async () => {
        betterdeskApi.getRemoteTarget.mockResolvedValue({ id: 'rt_abc', name: 'Office PC', remote_protocol: 'rdp' });
        const ok = await request(app(ADMIN)).get('/api/remote/viewer/rt_abc');
        expect(ok.status).toBe(200);
        expect(ok.body.capabilities).toMatchObject({ transport: 'rdp', remote_target: true });
        expect(ok.body.device.name).toBe('Office PC');
        const denied = await request(app(VIEWER)).get('/api/remote/viewer/rt_abc');
        expect(denied.status).toBe(403);
    });

    test('answers 404 for a missing remote target and 400 for a bad id', async () => {
        betterdeskApi.getRemoteTarget.mockResolvedValue(null);
        const missing = await request(app(ADMIN)).get('/api/remote/viewer/rt_missing');
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBe('not_found');
        const bad = await request(app(ADMIN)).get('/api/remote/viewer/a%3Cb');
        expect(bad.status).toBe(400);
    });

    test('lets a guest with a grant for this device in, without user data', async () => {
        betterdeskApi.apiClient.get.mockResolvedValue({ data: { valid: true, peer_ids: ['900100012'], view_only: true } });
        const res = await request(app(null)).get('/api/remote/viewer/900100012?guest=tok123');
        expect(res.status).toBe(200);
        expect(res.body.capabilities).toMatchObject({ guest_access: true, guest_view_only: true, guest_peer_ids: ['900100012'] });
        expect(res.body.user).toBeNull();
        expect(res.body.workReports).toBe(false);
        expect(res.body.guestToken).toBe('tok123');
    });

    test('refuses an explicit guest link that does not allow the device, as JSON', async () => {
        betterdeskApi.apiClient.get.mockResolvedValue({ data: { valid: true, peer_ids: ['OTHER01'] } });
        const res = await request(app(null)).get('/api/remote/viewer/900100012?guest=tok123');
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('guest_denied');
    });

    test('forces the transport with ?transport=', async () => {
        const res = await request(app(ADMIN)).get('/api/remote/viewer/900100012?transport=cdap');
        expect(res.body.capabilities.transport).toBe('cdap');
    });
});

describe('dev mock remote device through the viewer data', () => {
    test('is never set without the flag, whatever the query', async () => {
        const res = await request(app(ADMIN)).get('/api/remote/viewer/900100012?mock=1&scenario=refused');
        expect(res.status).toBe(200);
        expect(res.body.mockRemote).toBeNull();
        process.env[FLAG] = 'true';
        const wrong = await request(app(ADMIN)).get('/api/remote/viewer/900100012?mock=1');
        expect(wrong.body.mockRemote).toBeNull();
    });

    test('is set with the flag for ?mock=1 or a seeded demo device, with a known scenario only', async () => {
        process.env[FLAG] = '1';
        const other = await request(app(ADMIN)).get('/api/remote/viewer/123456789');
        expect(other.body.mockRemote).toBeNull();
        const otherOn = await request(app(ADMIN)).get('/api/remote/viewer/123456789?mock=1');
        expect(otherOn.body.mockRemote).toEqual({ scenario: 'ok' });
        // The seed scripts' demo devices need no ?mock=1; ?mock=0 opts out
        const demo = await request(app(ADMIN)).get('/api/remote/viewer/900100012');
        expect(demo.body.mockRemote).toEqual({ scenario: 'ok' });
        const demoOff = await request(app(ADMIN)).get('/api/remote/viewer/900100012?mock=0');
        expect(demoOff.body.mockRemote).toBeNull();
        const on = await request(app(ADMIN)).get('/api/remote/viewer/900100012?mock=1&scenario=refused');
        expect(on.body.mockRemote).toEqual({ scenario: 'refused' });
        const odd = await request(app(ADMIN)).get('/api/remote/viewer/900100012?mock=1&scenario=%3Cscript%3E');
        expect(odd.body.mockRemote).toEqual({ scenario: 'ok' });
    });

    test('still needs access to the device', async () => {
        process.env[FLAG] = '1';
        const res = await request(app(null)).get('/api/remote/viewer/900100012?mock=1');
        expect(res.status).toBe(401);
        expect(res.body.mockRemote).toBeUndefined();
    });
});

describe('GET /api/remote/login-info', () => {
    test('says who is signed in and keeps return paths under /remote only', async () => {
        const out = await request(app(null)).get('/api/remote/login-info?return=%2Fremote%2F900100012%3Fpanel%3Dfiles');
        expect(out.body).toMatchObject({ success: true, signedIn: false, returnUrl: '/remote/900100012?panel=files', csrfToken: 'csrf-1' });
        expect(out.body.user).toBeUndefined();
        for (const bad of ['//evil.example/x', 'https://evil.example/', '/devices', '/remote/login']) {
            const res = await request(app(null)).get('/api/remote/login-info').query({ return: bad });
            expect(res.body.returnUrl).toBe('/remote');
        }
        const signedIn = await request(app(ADMIN)).get('/api/remote/login-info');
        expect(signedIn.body.signedIn).toBe(true);
        const noConnect = await request(app(VIEWER)).get('/api/remote/login-info');
        expect(noConnect.body.signedIn).toBe(false);
    });
});

describe('GET /api/remote/guest-info', () => {
    test('needs a token', async () => {
        const res = await request(app(null)).get('/api/remote/guest-info');
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('missing_token');
    });

    test('refuses an invalid link', async () => {
        betterdeskApi.apiClient.get.mockResolvedValue({ data: { valid: false, error: 'expired' } });
        const res = await request(app(null)).get('/api/remote/guest-info?t=old');
        expect(res.status).toBe(403);
        expect(String(res.headers['set-cookie'] || '')).not.toMatch(/guest=/);
    });

    test('lists the devices of a valid link and keeps the token in the guest cookie', async () => {
        betterdeskApi.apiClient.get.mockResolvedValue({
            data: { valid: true, label: 'Support', view_only: false, expires_at: '2030-01-01T00:00:00Z', devices: [{ id: '900100012', online: true }] }
        });
        const res = await request(app(null)).get('/api/remote/guest-info?t=good');
        expect(res.status).toBe(200);
        expect(res.body.guest).toMatchObject({ label: 'Support', view_only: false, devices: [{ id: '900100012' }] });
        expect(String(res.headers['set-cookie'])).toMatch(/guest=good/);
    });
});

describe('GET /api/remote/desk', () => {
    test('needs device.connect and drops a guest cookie', async () => {
        expect((await request(app(null)).get('/api/remote/desk')).status).toBe(401);
        expect((await request(app(VIEWER)).get('/api/remote/desk')).status).toBe(403);
        const res = await request(app(ADMIN)).get('/api/remote/desk').set('Cookie', 'bd.guest=tok');
        expect(res.status).toBe(200);
        expect(String(res.headers['set-cookie'])).toMatch(/guest=;/);
    });
});
