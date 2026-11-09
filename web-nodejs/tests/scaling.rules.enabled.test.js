/**
 * Relay assignment rules keep their on/off state: an edit that does not
 * send `enabled` (the rule sheet has no switch for it) used to turn a
 * disabled rule back on.
 */

const request = require('supertest');
const { createTestApp, withAuth } = require('./helpers');

const store = {};
const mockDb = {
    getSetting: jest.fn(async (k) => (k in store ? store[k] : null)),
    setSetting: jest.fn(async (k, v) => { store[k] = v; }),
};
jest.mock('../services/database', () => mockDb);

const scalingRoutes = require('../routes/scaling.routes');

function app() {
    const a = createTestApp();
    withAuth(a, { id: 1, username: 'admin', role: 'admin' });
    a.use('/', scalingRoutes);
    return a;
}

const body = { name: 'Office', match_type: 'subnet', match_value: '10.0.0.0/8', target_relay: 'r-1', priority: 5 };
const saved = () => JSON.parse(store.scaling_assignment_rules);

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
});

describe('relay assignment rules', () => {
    it('stores a rule created as disabled as disabled', async () => {
        const res = await request(app()).post('/api/panel/scaling/rules').send({ ...body, enabled: false });
        expect(res.status).toBeLessThan(300);
        expect(saved()[0].enabled).toBe(false);
    });

    it('keeps a disabled rule disabled when an edit leaves the switch out', async () => {
        store.scaling_assignment_rules = JSON.stringify([{ id: 'r-a', ...body, enabled: false }]);
        const res = await request(app()).put('/api/panel/scaling/rules/r-a').send({ ...body, name: 'Office 2' });
        expect(res.status).toBe(200);
        expect(saved()[0]).toMatchObject({ name: 'Office 2', enabled: false });
    });

    it('turns a rule on and off when the edit sends the switch', async () => {
        store.scaling_assignment_rules = JSON.stringify([{ id: 'r-a', ...body, enabled: false }]);
        await request(app()).put('/api/panel/scaling/rules/r-a').send({ ...body, enabled: true });
        expect(saved()[0].enabled).toBe(true);
        await request(app()).put('/api/panel/scaling/rules/r-a').send({ ...body, enabled: false });
        expect(saved()[0].enabled).toBe(false);
    });

    it('creates a rule enabled when the request leaves the switch out', async () => {
        await request(app()).post('/api/panel/scaling/rules').send(body);
        expect(saved()[0].enabled).toBe(true);
    });
});
