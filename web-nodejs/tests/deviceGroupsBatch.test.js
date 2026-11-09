'use strict';

/**
 * The device list loads every device's groups in one query
 * (getDeviceGroupsForPeers) instead of one query per device.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.setTimeout(20000);

describe('getDeviceGroupsForPeers (SQLite)', () => {
    let tmpDir;
    let adapter;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-groups-batch-'));
        const dataDir = path.join(tmpDir, 'data');
        fs.mkdirSync(dataDir);
        process.env.DATA_DIR = dataDir;
        process.env.DB_TYPE = 'sqlite';
        process.env.DB_PATH = path.join(dataDir, 'db_v2.sqlite3');
        jest.resetModules();
        adapter = require('../services/dbAdapter').getAdapter();
        await adapter.init();
    });

    afterEach(async () => {
        if (adapter && typeof adapter.close === 'function') await adapter.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('matches the per-device lookup for every device', async () => {
        const office = await adapter.createDeviceGroup({ name: 'Office' });
        const lab = await adapter.createDeviceGroup({ name: 'Lab' });
        await adapter.addDeviceToGroup(office.guid, '100');
        await adapter.addDeviceToGroup(lab.guid, '100');
        await adapter.addDeviceToGroup(lab.guid, '200');

        const ids = ['100', '200', '300'];
        const batch = await adapter.getDeviceGroupsForPeers(ids);
        for (const id of ids) {
            const single = await adapter.getDeviceGroupsForPeer(id);
            expect(batch.get(id) || []).toEqual(single);
        }
        expect(batch.get('100').map((g) => g.name)).toEqual(['Lab', 'Office']);
        expect(batch.has('300')).toBe(false);
        expect((await adapter.getDeviceGroupsForPeers([])).size).toBe(0);
        // Only the devices asked for
        expect([...(await adapter.getDeviceGroupsForPeers(['200'])).keys()]).toEqual(['200']);
    });
});

describe('GET /api/devices group enrichment', () => {
    test('uses one batched query, not one per device', async () => {
        jest.resetModules();
        jest.doMock('../services/serverBackend', () => ({
            getAllDevices: jest.fn().mockResolvedValue([{ id: 'A1' }, { id: 'B2' }, { id: 'C3' }])
        }));
        jest.doMock('../services/deviceGroupService', () => ({
            getDeviceScopeForUser: jest.fn().mockResolvedValue(null),
            filterDevicesByScope: (devices) => devices
        }));
        const groups = new Map([['B2', [{ guid: 'g1', name: 'Lab' }]]]);
        jest.doMock('../services/database', () => ({
            getDeviceGroupsForPeer: jest.fn().mockResolvedValue([{ guid: 'x' }]),
            getDeviceGroupsForPeers: jest.fn().mockResolvedValue(groups)
        }));
        jest.doMock('../services/bdRelay', () => ({ requestFromDevice: jest.fn() }));
        jest.doMock('../services/betterdeskApi', () => ({}));
        const request = require('supertest');
        const { createTestApp } = require('./helpers');
        const db = require('../services/database');
        const app = createTestApp();
        app.use((req, _res, next) => {
            req.session.userId = 1;
            req.session.user = { id: 1, username: 'a', role: 'admin' };
            next();
        });
        app.use('/', require('../routes/devices.routes'));
        const res = await request(app).get('/api/devices');
        expect(res.status).toBe(200);
        expect(db.getDeviceGroupsForPeers).toHaveBeenCalledTimes(1);
        expect(db.getDeviceGroupsForPeers).toHaveBeenCalledWith(['A1', 'B2', 'C3']);
        expect(db.getDeviceGroupsForPeer).not.toHaveBeenCalled();
        expect(res.body.data.devices.map((d) => d.groups.length)).toEqual([0, 1, 0]);
    });
});
