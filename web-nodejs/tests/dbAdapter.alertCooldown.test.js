'use strict';

/**
 * The alert cooldown (getRecentAlert) on SQLite: alerts are stored with an
 * ISO time ("2026-11-09T10:00:00.000Z") and compared with datetime('now', ...)
 * ("2026-11-09 10:05:00"). Compared as text, the "T" sorts after the space,
 * so every alert of the same day counted as recent and a rule raised at most
 * one alert per device and day.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('dbAdapter alert cooldown (SQLite)', () => {
    let tempDir;
    let adapter;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betterdesk-alert-cooldown-'));
        process.env.DATA_DIR = path.join(tempDir, 'panel-data');
        process.env.DB_PATH = path.join(tempDir, 'db_v2.sqlite3');
        process.env.DB_TYPE = 'sqlite';
        jest.resetModules();
        const { getAdapter } = require('../services/dbAdapter');
        adapter = getAdapter();
        await adapter.init();
    });

    afterEach(async () => {
        if (adapter && typeof adapter.close === 'function') await adapter.close();
        delete process.env.DATA_DIR;
        delete process.env.DB_PATH;
        delete process.env.DB_TYPE;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function ruleWithAlertAgo(seconds) {
        const rule = await adapter.createAlertRule({ name: 'cpu', condition_type: 'cpu_usage', condition_value: 90 });
        await adapter.createAlert({
            rule_id: rule.id,
            device_id: 'dev-1',
            severity: 'warning',
            message: 'x',
            triggered_at: new Date(Date.now() - seconds * 1000).toISOString(),
        });
        return rule;
    }

    it('counts an alert inside the cooldown as recent', async () => {
        const rule = await ruleWithAlertAgo(60);
        expect(await adapter.getRecentAlert(rule.id, 'dev-1', 300)).not.toBeNull();
    });

    it('does not count an alert older than the cooldown', async () => {
        // 20 minutes ago: still today in UTC unless the test runs just after midnight
        const rule = await ruleWithAlertAgo(20 * 60);
        expect(await adapter.getRecentAlert(rule.id, 'dev-1', 300)).toBeNull();
    });

    it('keeps rules and devices apart', async () => {
        const rule = await ruleWithAlertAgo(60);
        expect(await adapter.getRecentAlert(rule.id, 'dev-2', 300)).toBeNull();
        expect(await adapter.getRecentAlert(rule.id + 1, 'dev-1', 300)).toBeNull();
    });
});
