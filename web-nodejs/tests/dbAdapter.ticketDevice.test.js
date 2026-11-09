'use strict';

/**
 * A ticket's device can be changed and cleared after it was created (P10:
 * updateTicket used to drop device_id).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.setTimeout(20000);

describe('dbAdapter ticket device', () => {
    let tmpDir;
    let adapter;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-ticket-device-'));
        const dataDir = path.join(tmpDir, 'data');
        fs.mkdirSync(dataDir);
        process.env.DATA_DIR = dataDir;
        process.env.DB_TYPE = 'sqlite';
        process.env.DB_PATH = path.join(dataDir, 'db_v2.sqlite3');
        jest.resetModules();
        const { getAdapter } = require('../services/dbAdapter');
        adapter = getAdapter();
        await adapter.init();
    });

    afterEach(async () => {
        try { await adapter.close?.(); } catch (_) { /* already closed */ }
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('updateTicket sets and clears device_id', async () => {
        const created = await adapter.createTicket({
            title: 'Printer', description: '', priority: 'low', category: 'general',
            deviceId: null, createdBy: 'u', assignedTo: null, slaDueAt: null,
        });
        await adapter.updateTicket(created.id, { device_id: '900100001' });
        expect((await adapter.getTicketById(created.id)).device_id).toBe('900100001');
        await adapter.updateTicket(created.id, { device_id: null });
        expect((await adapter.getTicketById(created.id)).device_id).toBeNull();
    });
});
