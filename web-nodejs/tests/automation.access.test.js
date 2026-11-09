/**
 * Alerts and automation follow the menu: reading rules, alerts and remote
 * commands (whose payloads and results come from scripts run on devices)
 * and acknowledging alerts need server.config, like the writes. The device
 * routes on /api/bd keep working: an agent polling GET /api/bd/commands
 * with its token reaches the device handler (the admin routes of the
 * routers mounted at /api/bd before it used to answer 401).
 */

const request = require('supertest');
const { createTestApp, withAuth } = require('./helpers');

const mockAdapter = {
    getAlertRules: jest.fn().mockResolvedValue([]),
    getAlertRuleById: jest.fn().mockResolvedValue({ id: 1, name: 'r' }),
    getAlertHistory: jest.fn().mockResolvedValue([]),
    acknowledgeAlert: jest.fn().mockResolvedValue(undefined),
    getRemoteCommands: jest.fn().mockResolvedValue([]),
    getRemoteCommandById: jest.fn(),
    getPendingCommands: jest.fn(),
    updateRemoteCommand: jest.fn().mockResolvedValue(undefined),
    getInventory: jest.fn(),
    getAllInventories: jest.fn().mockResolvedValue([]),
    getActivitySessions: jest.fn().mockResolvedValue([]),
};
const mockDb = {
    getAccessToken: jest.fn(),
    touchAccessToken: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../services/database', () => mockDb);
jest.mock('../services/dbAdapter', () => ({ getAdapter: jest.fn(() => mockAdapter) }));
jest.mock('../services/betterdeskApi', () => ({ getAllPeers: jest.fn().mockResolvedValue([]) }));
jest.mock('../lib/smtpSettingsHandlers', () => ({
    getSmtpSettings: (req, res) => res.json({}),
    putSmtpSettings: (req, res) => res.json({}),
    testSmtpSettings: (req, res) => res.json({}),
}));

const automationRoutes = require('../routes/automation.routes');
const inventoryRoutes = require('../routes/inventory.routes');
const activityRoutes = require('../routes/activity.routes');

beforeEach(() => {
    jest.clearAllMocks();
    mockAdapter.getRemoteCommandById.mockResolvedValue({ id: 5, device_id: 'dev-1', payload: 'whoami', result: 'root' });
    mockAdapter.getPendingCommands.mockResolvedValue([{ id: 5, command_type: 'shell', payload: 'whoami' }]);
});

function panel(role) {
    const app = createTestApp();
    withAuth(app, { id: 2, username: role, role });
    app.use('/api/automation', automationRoutes);
    return app;
}

const READS = [
    ['get', '/api/automation/rules'],
    ['get', '/api/automation/rules/1'],
    ['get', '/api/automation/alerts'],
    ['post', '/api/automation/alerts/1/ack'],
    ['get', '/api/automation/commands'],
    ['get', '/api/automation/commands/5'],
];

describe('panel routes need server.config', () => {
    it.each(['viewer', 'operator', 'global_admin'])('refuses %s and reads nothing', async (role) => {
        const app = panel(role);
        for (const [method, path] of READS) {
            const res = await request(app)[method](path).send({});
            expect([method, path, res.status]).toEqual([method, path, 403]);
        }
        expect(mockAdapter.getAlertRules).not.toHaveBeenCalled();
        expect(mockAdapter.getAlertRuleById).not.toHaveBeenCalled();
        expect(mockAdapter.getAlertHistory).not.toHaveBeenCalled();
        expect(mockAdapter.acknowledgeAlert).not.toHaveBeenCalled();
        expect(mockAdapter.getRemoteCommands).not.toHaveBeenCalled();
        expect(mockAdapter.getRemoteCommandById).not.toHaveBeenCalled();
    });

    it.each(['server_admin', 'admin'])('lets %s read and acknowledge', async (role) => {
        const app = panel(role);
        for (const [method, path] of READS) {
            const res = await request(app)[method](path).send({});
            expect([method, path, res.status]).toEqual([method, path, 200]);
        }
        expect(mockAdapter.acknowledgeAlert).toHaveBeenCalledWith(1, role);
    });
});

/** The device side as routes/index.js mounts it: inventory, activity, then automation at /api/bd */
function deviceApp() {
    const app = createTestApp();
    app.use('/api/bd', inventoryRoutes);
    app.use('/api/bd', activityRoutes);
    app.use('/api/bd', automationRoutes);
    return app;
}

describe('device routes on /api/bd', () => {
    beforeEach(() => {
        mockDb.getAccessToken.mockResolvedValue({ client_id: 'dev-1' });
    });

    it('an agent polling GET /api/bd/commands with its token gets its pending commands', async () => {
        const res = await request(deviceApp()).get('/api/bd/commands').set('Authorization', 'Bearer device-token');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ commands: [{ id: 5, command_type: 'shell', payload: 'whoami' }] });
        expect(mockAdapter.getPendingCommands).toHaveBeenCalledWith('dev-1');
    });

    it('an agent can report a command result', async () => {
        const res = await request(deviceApp())
            .post('/api/bd/commands/5/result')
            .set('Authorization', 'Bearer device-token')
            .send({ status: 'completed', result: 'root' });
        expect(res.status).toBe(200);
        expect(mockAdapter.updateRemoteCommand).toHaveBeenCalledWith(5, { status: 'completed', result: 'root' });
    });

    it('a request without a token still gets 401, and no admin route answers on /api/bd', async () => {
        mockDb.getAccessToken.mockResolvedValue(null);
        const app = deviceApp();
        expect((await request(app).get('/api/bd/commands')).status).toBe(401);
        const rules = await request(app).get('/api/bd/rules');
        expect(rules.status).not.toBe(200);
        expect(mockAdapter.getAlertRules).not.toHaveBeenCalled();
    });
});

describe('the old /automation page', () => {
    const pagesRoutes = require('../routes/pages.routes');
    function pages(role) {
        const app = createTestApp();
        withAuth(app, { id: 2, username: role, role });
        // Report the template instead of rendering it
        app.use((req, res, next) => {
            res.render = (view) => res.json({ view });
            next();
        });
        app.use('/', pagesRoutes);
        return app;
    }

    it('answers 403 without server.config', async () => {
        const res = await request(pages('viewer')).get('/automation');
        expect(res.status).toBe(403);
        expect(res.body.view).toBe('errors/403');
    });

    it('renders for a server admin', async () => {
        const res = await request(pages('server_admin')).get('/automation');
        expect(res.status).toBe(200);
        expect(res.body.view).toBe('automation');
    });
});
