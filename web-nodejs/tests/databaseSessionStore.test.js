'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { DatabaseSessionStore } = require('../services/databaseSessionStore');
const { END_REASONS } = require('../lib/sessionPolicy');

function invoke(method, ...args) {
    return new Promise((resolve, reject) => {
        method(...args, (err, value) => (err ? reject(err) : resolve(value)));
    });
}

describe('DatabaseSessionStore', () => {
    let tempDir;
    let store;
    let previousDbType;
    let previousDatabaseUrl;

    beforeEach(async () => {
        previousDbType = process.env.DB_TYPE;
        previousDatabaseUrl = process.env.DATABASE_URL;
        process.env.DB_TYPE = 'sqlite';
        delete process.env.DATABASE_URL;
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betterdesk-session-store-'));
        store = new DatabaseSessionStore({
            config: { dbPath: path.join(tempDir, 'db_v2.sqlite3') },
            ttlMs: 24 * 60 * 60 * 1000,
            idleTimeoutMs: 60_000,
            maxAgeMs: 24 * 60 * 60 * 1000
        });
        await store.ready;
    });

    afterEach(async () => {
        if (store) await store.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
        store = null;
        if (previousDbType === undefined) delete process.env.DB_TYPE;
        else process.env.DB_TYPE = previousDbType;
        if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousDatabaseUrl;
    });

    it('persists, expires and destroys console sessions in SQLite', async () => {
        const sid = 'session-id';
        const session = {
            user: { id: 7, username: 'alice', role: 'operator' },
            userId: 7,
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
            cookie: { expires: new Date(Date.now() + 60_000).toISOString() }
        };

        await invoke(store.set.bind(store), sid, session);
        expect(await invoke(store.get.bind(store), sid)).toEqual(session);

        await invoke(store.touch.bind(store), sid, {
            ...session,
            lastActivityAt: Date.now(),
            cookie: { expires: new Date(Date.now() + 120_000).toISOString() }
        });
        expect(await invoke(store.get.bind(store), sid)).toEqual(session);

        await invoke(store.destroy.bind(store), sid);
        expect(await invoke(store.get.bind(store), sid)).toBeNull();
    });

    it('enforces one active session per account and keeps history', async () => {
        const now = Date.now();
        const base = {
            userId: 42,
            user: { id: 42, username: 'bob', role: 'admin' },
            createdAt: now,
            lastActivityAt: now,
            loginIp: '203.0.113.10',
            loginUserAgent: 'TestAgent/1.0',
            cookie: { expires: new Date(now + 30_000).toISOString() }
        };

        await invoke(store.set.bind(store), 'sid-a', base);
        await store.activateExclusiveSession('sid-a', {
            userId: 42,
            username: 'bob',
            ip: '203.0.113.10',
            userAgent: 'TestAgent/1.0',
            createdAt: now,
            lastActivityAt: now
        });

        await invoke(store.set.bind(store), 'sid-b', {
            ...base,
            loginIp: '198.51.100.20',
            loginUserAgent: 'OtherAgent/2.0'
        });
        const result = await store.activateExclusiveSession('sid-b', {
            userId: 42,
            username: 'bob',
            ip: '198.51.100.20',
            userAgent: 'OtherAgent/2.0',
            createdAt: now,
            lastActivityAt: now
        });

        expect(result.replaced).toHaveLength(1);
        expect(result.replaced[0].sid).toBe('sid-a');
        expect(await invoke(store.get.bind(store), 'sid-a')).toBeNull();
        expect(await invoke(store.get.bind(store), 'sid-b')).toBeTruthy();

        const history = await store.listUserSessions(42, { includeEnded: true });
        expect(history.length).toBeGreaterThanOrEqual(2);
        const ended = history.find((r) => r.sid === 'sid-a');
        expect(ended.end_reason).toBe(END_REASONS.REPLACED);
        expect(Number(ended.is_active)).toBe(0);
    });

    it('rejects idle sessions on get()', async () => {
        const sid = 'idle-sid';
        const created = Date.now() - 10 * 60 * 1000;
        const session = {
            userId: 9,
            user: { id: 9, username: 'idle', role: 'viewer' },
            createdAt: created,
            lastActivityAt: created,
            cookie: { expires: new Date(Date.now() + 60_000).toISOString() }
        };
        await invoke(store.set.bind(store), sid, session);
        await store.activateExclusiveSession(sid, {
            userId: 9,
            username: 'idle',
            createdAt: created,
            lastActivityAt: created
        });
        // Force last activity beyond idleTimeoutMs (60s floor)
        store.sqlite.prepare(
            'UPDATE panel_sessions SET last_activity_at = ?, created_at = ? WHERE sid = ?'
        ).run(Date.now() - 5 * 60 * 1000, created, sid);

        expect(await invoke(store.get.bind(store), sid)).toBeNull();
        const row = await store.getSessionRecord(sid);
        expect(row.end_reason).toBe(END_REASONS.IDLE);
    });
});
