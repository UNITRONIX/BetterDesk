/**
 * BetterDesk Console - network monitor checks each target on its own interval
 */

const { NetworkMonitor } = require('../services/networkMonitor');

describe('NetworkMonitor schedule', () => {
    it('checks only targets whose own interval has passed', async () => {
        const now = Date.now();
        const targets = [
            { id: 1, interval_ms: 60000, last_check_at: new Date(now - 61000).toISOString() },
            { id: 2, interval_ms: 600000, last_check_at: new Date(now - 120000).toISOString() },
            { id: 3, interval_ms: 300000, last_check_at: null },
        ];
        const db = { getNetworkTargets: jest.fn().mockResolvedValue(targets) };
        const monitor = new NetworkMonitor(db);
        monitor.pollInterval = 30000;
        monitor.checkTarget = jest.fn(async (t) => ({ target_id: t.id, status: 'up' }));

        await monitor.checkAll();

        expect(monitor.checkTarget.mock.calls.map(([t]) => t.id)).toEqual([1, 3]);
    });
});
