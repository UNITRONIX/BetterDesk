/**
 * Access rules (strategies) and the Go server's copy (BUGS.md D6):
 * - Deleting a rule also deletes it on the Go server; it used to stay there
 *   and keep applying to clients.
 * - Reading a rule the console doesn't have falls back to the Go server's
 *   copy; the check read a field the wrapped answer doesn't have, so the
 *   fallback never ran.
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/bdRelay', () => ({ requestFromDevice: jest.fn() }));
jest.mock('../services/database', () => ({
    logAction: jest.fn().mockResolvedValue(undefined),
    getStrategyByGuid: jest.fn(),
    deleteStrategy: jest.fn().mockResolvedValue(undefined),
    getStrategyAssignmentDisplayRefs: jest.fn().mockResolvedValue({ peers: [], users: [], groups: [] })
}));
jest.mock('../services/serverBackend', () => ({ isBetterDesk: jest.fn().mockResolvedValue(true) }));
jest.mock('../services/betterdeskApi', () => ({
    getStrategy: jest.fn(),
    deleteStrategy: jest.fn().mockResolvedValue({ success: true, data: {} })
}));
jest.mock('../services/deviceGroupService', () => ({ userCanAccessDevice: jest.fn().mockResolvedValue(true) }));

const db = require('../services/database');
const betterdeskApi = require('../services/betterdeskApi');
const devicesRoutes = require('../routes/devices.routes');

function app() {
    const a = createTestApp();
    a.use((req, _res, next) => {
        req.session.userId = 1;
        req.session.user = { id: 1, username: 'admin', role: 'super_admin' };
        next();
    });
    a.use('/', devicesRoutes);
    return a;
}

beforeEach(() => jest.clearAllMocks());

test('deleting a rule deletes the Go server copy too', async () => {
    db.getStrategyByGuid.mockResolvedValue({ guid: 'st-1', name: 'Office' });
    const res = await request(app()).delete('/api/panel/strategies/st-1');
    expect(res.status).toBe(200);
    expect(db.deleteStrategy).toHaveBeenCalledWith('st-1');
    expect(betterdeskApi.deleteStrategy).toHaveBeenCalledWith('st-1');
});

test('a rule only the Go server has is shown from there', async () => {
    db.getStrategyByGuid.mockResolvedValue(null);
    betterdeskApi.getStrategy.mockResolvedValue({ success: true, data: { guid: 'st-9', name: 'From Go', enabled: true } });
    const res = await request(app()).get('/api/panel/strategies/st-9');
    expect(res.status).toBe(200);
    expect(res.body.data.strategy).toMatchObject({ guid: 'st-9', name: 'From Go', enabled: true });
});

test('a rule nobody has is 404', async () => {
    db.getStrategyByGuid.mockResolvedValue(null);
    betterdeskApi.getStrategy.mockResolvedValue({ success: false, error: 'Strategy not found' });
    const res = await request(app()).get('/api/panel/strategies/st-0');
    expect(res.status).toBe(404);
});
