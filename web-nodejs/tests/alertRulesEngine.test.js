/**
 * Alert rules are evaluated: CPU and memory when a device sends telemetry,
 * disk when it sends an inventory, idle time with its activity report, and
 * offline time in a sweep over the device list. They used to be stored and
 * never checked.
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

const mockAdapter = {
    getAlertRules: jest.fn(),
    getRecentAlert: jest.fn(),
    createAlert: jest.fn(),
    upsertTelemetry: jest.fn().mockResolvedValue(undefined),
    upsertInventory: jest.fn().mockResolvedValue(undefined),
    upsertActivitySummary: jest.fn().mockResolvedValue(undefined),
    insertActivitySessions: jest.fn().mockResolvedValue(undefined),
};
const mockDb = {
    getAccessToken: jest.fn(),
    touchAccessToken: jest.fn().mockResolvedValue(undefined),
    getPeerById: jest.fn().mockResolvedValue(null),
};
const mockBackend = { getAllDevices: jest.fn() };

jest.mock('../services/database', () => mockDb);
jest.mock('../services/dbAdapter', () => ({ getAdapter: jest.fn(() => mockAdapter) }));
jest.mock('../services/betterdeskApi', () => ({ getAllPeers: jest.fn().mockResolvedValue([]) }));
jest.mock('../services/serverBackend', () => mockBackend);
jest.mock('../services/emailService', () => ({ sendAlertEmail: jest.fn().mockResolvedValue(undefined) }));

const engine = require('../services/alertRulesEngine');

function rule(over = {}) {
    return {
        id: 1,
        name: 'Rule',
        enabled: 1,
        condition_type: 'cpu_usage',
        condition_op: 'gt',
        condition_value: 90,
        severity: 'warning',
        scope_device_id: null,
        cooldown_secs: 300,
        notify_emails: '',
        ...over,
    };
}

/** Rules by condition type, as getAlertRules({ enabled: true, condition_type }) answers */
function useRules(list) {
    mockAdapter.getAlertRules.mockImplementation(async (f = {}) =>
        list.filter((r) => (!f.condition_type || r.condition_type === f.condition_type) && (f.enabled === undefined || !!r.enabled === f.enabled)));
}

const flush = () => new Promise((r) => setImmediate(r));

function deviceApp(router, mount = '/api/bd') {
    const app = createTestApp();
    app.use(mount, router);
    return app;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.getAccessToken.mockResolvedValue({ client_id: 'dev-1' });
    mockAdapter.getRecentAlert.mockResolvedValue(null);
    mockAdapter.createAlert.mockImplementation(async (a) => ({ id: 1, ...a }));
    useRules([]);
});

describe('telemetry', () => {
    it('raises a CPU alert when a device reports usage over the limit', async () => {
        useRules([rule({ id: 3, condition_type: 'cpu_usage', condition_value: 80 })]);
        const app = deviceApp(require('../routes/inventory.routes'));
        const res = await request(app)
            .post('/api/bd/telemetry')
            .set('Authorization', 'Bearer t')
            .send({ device_id: 'dev-1', cpu_usage_percent: 95, memory_used_bytes: 1, memory_total_bytes: 4 });
        expect(res.status).toBe(200);
        await flush();
        expect(mockAdapter.createAlert).toHaveBeenCalledTimes(1);
        expect(mockAdapter.createAlert).toHaveBeenCalledWith(expect.objectContaining({ rule_id: 3, device_id: 'dev-1' }));
    });

    it('raises nothing under the limit', async () => {
        useRules([rule({ condition_type: 'cpu_usage', condition_value: 80 })]);
        const app = deviceApp(require('../routes/inventory.routes'));
        await request(app)
            .post('/api/bd/telemetry')
            .set('Authorization', 'Bearer t')
            .send({ device_id: 'dev-1', cpu_usage_percent: 20 });
        await flush();
        expect(mockAdapter.createAlert).not.toHaveBeenCalled();
    });
});

describe('inventory', () => {
    it('raises a disk alert for the fullest disk', async () => {
        useRules([rule({ id: 4, condition_type: 'disk_usage', condition_value: 90 })]);
        const app = deviceApp(require('../routes/inventory.routes'));
        const res = await request(app)
            .post('/api/bd/inventory')
            .set('Authorization', 'Bearer t')
            .send({
                device_id: 'dev-1',
                hardware: { disks: [{ total_bytes: 100, used_bytes: 50 }, { total_bytes: 100, free_bytes: 3 }] },
                software: {},
            });
        expect(res.status).toBe(200);
        await flush();
        expect(mockAdapter.createAlert).toHaveBeenCalledWith(expect.objectContaining({ rule_id: 4, device_id: 'dev-1' }));
    });
});

describe('activity', () => {
    it('raises an idle alert when the user has been idle longer than the limit', async () => {
        useRules([rule({ id: 5, condition_type: 'idle_duration', condition_value: 600 })]);
        const app = deviceApp(require('../routes/activity.routes'));
        const res = await request(app)
            .post('/api/bd/activity')
            .set('Authorization', 'Bearer t')
            .send({ device_id: 'dev-1', sessions: [], idle_seconds: 3600 });
        expect(res.status).toBe(200);
        await flush();
        expect(mockAdapter.createAlert).toHaveBeenCalledWith(expect.objectContaining({ rule_id: 5, device_id: 'dev-1' }));
    });
});

describe('offline sweep', () => {
    const now = Date.parse('2026-11-09T12:00:00Z');
    const devices = [
        { id: 'off-2h', online: false, last_online: '2026-11-09T10:00:00Z' },
        { id: 'off-1m', online: false, last_online: '2026-11-09T11:59:00Z' },
        { id: 'on', online: true, last_online: '2026-11-09T09:00:00Z' },
        { id: 'banned', online: false, banned: true, last_online: '2026-11-01T00:00:00Z' },
        { id: 'gone', online: false, soft_deleted: true, last_online: '2026-11-01T00:00:00Z' },
        { id: 'never', online: false, last_online: '' },
    ];

    it('does not read the device list when no offline rule is on', async () => {
        useRules([rule({ condition_type: 'cpu_usage' })]);
        await engine.periodicCheck({ now });
        expect(mockBackend.getAllDevices).not.toHaveBeenCalled();
    });

    it('raises one alert per device that has been offline longer than the limit', async () => {
        useRules([rule({ id: 6, condition_type: 'offline_duration', condition_value: 3600 })]);
        mockBackend.getAllDevices.mockResolvedValue(devices);
        await engine.periodicCheck({ now });
        expect(mockAdapter.createAlert).toHaveBeenCalledTimes(1);
        expect(mockAdapter.createAlert).toHaveBeenCalledWith(expect.objectContaining({ rule_id: 6, device_id: 'off-2h' }));
    });

    it('does not raise it again while the device stays offline', async () => {
        useRules([rule({ id: 6, condition_type: 'offline_duration', condition_value: 3600, cooldown_secs: 300 })]);
        mockBackend.getAllDevices.mockResolvedValue(devices);
        await engine.periodicCheck({ now });
        // The cooldown covers the whole time the device has been offline (2 h), not just 5 minutes
        expect(mockAdapter.getRecentAlert).toHaveBeenCalledWith(6, 'off-2h', 7200);
    });

    it('keeps a rule for one device to that device', async () => {
        useRules([rule({ id: 7, condition_type: 'offline_duration', condition_value: 30, scope_device_id: 'off-1m' })]);
        mockBackend.getAllDevices.mockResolvedValue(devices);
        await engine.periodicCheck({ now });
        expect(mockAdapter.createAlert.mock.calls.map(([a]) => a.device_id)).toEqual(['off-1m']);
    });
});

describe('start', () => {
    it('runs the sweep on a timer and stops it again', async () => {
        jest.useFakeTimers();
        try {
            const spy = jest.spyOn(engine, 'periodicCheck').mockResolvedValue(undefined);
            const stop = engine.start({ every: 1000 });
            await jest.advanceTimersByTimeAsync(2500);
            stop();
            await jest.advanceTimersByTimeAsync(5000);
            expect(spy).toHaveBeenCalledTimes(2);
            spy.mockRestore();
        } finally {
            jest.useRealTimers();
        }
    });
});
