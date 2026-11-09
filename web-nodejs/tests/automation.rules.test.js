/**
 * Alert rules API: a rule keeps the "enabled" state it was created with
 * (it used to come back enabled whatever the request said).
 */

const request = require('supertest');
const { createTestApp, withAuth } = require('./helpers');

const mockAdapter = {
    createAlertRule: jest.fn(),
    logAction: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../services/database', () => ({}));
jest.mock('../services/dbAdapter', () => ({ getAdapter: jest.fn(() => mockAdapter) }));
jest.mock('../lib/smtpSettingsHandlers', () => ({
    getSmtpSettings: (req, res) => res.json({}),
    putSmtpSettings: (req, res) => res.json({}),
    testSmtpSettings: (req, res) => res.json({}),
}));

const automationRoutes = require('../routes/automation.routes');

function app() {
    const a = createTestApp();
    withAuth(a, { id: 1, username: 'admin', role: 'admin' });
    a.use('/api/automation', automationRoutes);
    return a;
}

const rule = {
    name: 'CPU high',
    condition_type: 'cpu_usage',
    condition_op: 'gt',
    condition_value: 90,
    severity: 'warning',
};

describe('POST /api/automation/rules', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAdapter.createAlertRule.mockImplementation(async (r) => ({ id: 7, ...r }));
    });

    it('stores a rule created as disabled as disabled', async () => {
        const res = await request(app()).post('/api/automation/rules').send({ ...rule, enabled: false });
        expect(res.status).toBe(201);
        expect(mockAdapter.createAlertRule).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });

    it('stores a rule created as enabled, or without the field, as enabled', async () => {
        await request(app()).post('/api/automation/rules').send({ ...rule, enabled: true });
        await request(app()).post('/api/automation/rules').send(rule);
        expect(mockAdapter.createAlertRule.mock.calls.map(([r]) => r.enabled)).toEqual([true, true]);
    });
});
