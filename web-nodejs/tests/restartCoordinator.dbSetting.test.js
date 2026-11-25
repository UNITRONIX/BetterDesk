'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('restartCoordinator db-setting rollback', () => {
    let tempDir;
    let restartCoordinator;
    let setSettingCalls;

    beforeEach(() => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-restart-'));
        setSettingCalls = [];

        jest.doMock('../config/config', () => ({
            dataDir: tempDir
        }));
        jest.doMock('../services/database', () => ({
            setSetting: async (key, value) => {
                setSettingCalls.push({ key, value });
            }
        }));
        jest.doMock('../services/deviceGroupService', () => ({
            invalidateDeviceScopeDefaultCache: jest.fn()
        }));

        restartCoordinator = require('../services/restartCoordinator');
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) { /* ignore */ }
        jest.resetModules();
    });

    it('restores a panel DB setting and clears device-scope cache', async () => {
        const req = { session: { userId: 7 } };
        const pending = restartCoordinator.registerChange(req, {
            key: 'device-scope-default',
            label: 'Device visibility default',
            rollback: {
                type: 'db-setting',
                key: 'device_scope_default',
                previousValue: 'open',
                afterRestore: 'device-scope-cache'
            }
        });
        assert.ok(pending?.id);

        const result = await restartCoordinator.cancel(req, pending.id);
        assert.strictEqual(result.canceled, true);
        assert.deepStrictEqual(setSettingCalls, [
            { key: 'device_scope_default', value: 'open' }
        ]);

        const deviceGroupService = require('../services/deviceGroupService');
        assert.strictEqual(deviceGroupService.invalidateDeviceScopeDefaultCache.mock.calls.length, 1);
    });
});
