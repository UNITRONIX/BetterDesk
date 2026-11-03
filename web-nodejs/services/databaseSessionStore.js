'use strict';

/**
 * Persistent express-session store backed by the selected BetterDesk database.
 * Enforces idle/absolute timeouts and one active panel session per account.
 */

const session = require('express-session');
const {
    END_REASONS,
    resolveSessionPolicy,
    sanitizeIp,
    sanitizeUserAgent,
    sanitizeFingerprint
} = require('../lib/sessionPolicy');

class DatabaseSessionStore extends session.Store {
    constructor({ config, ttlMs, idleTimeoutMs, maxAgeMs }) {
        super();
        this.config = config;
        const policy = resolveSessionPolicy(process.env);
        this.idleTimeoutMs = Math.max(60_000, Number(idleTimeoutMs) || policy.idleTimeoutMs);
        this.maxAgeMs = Math.max(this.idleTimeoutMs, Number(maxAgeMs) || Number(ttlMs) || policy.maxAgeMs);
        this.ttlMs = this.maxAgeMs;
        this.type = /^(postgres|postgresql)$/i.test(process.env.DB_TYPE || '')
            || /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL || '')
            ? 'postgres'
            : 'sqlite';
        this.sqlite = null;
        this.ownsSqlite = false;
        this.pool = null;
        this.ready = this.initialize();
    }

    async initialize() {
        if (this.type === 'postgres') {
            const { Pool } = require('pg');
            this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS panel_sessions (
                    sid TEXT PRIMARY KEY,
                    session_json TEXT NOT NULL,
                    expires_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_panel_sessions_expires ON panel_sessions (expires_at);
            `);
            await this.ensurePostgresColumns();
            return;
        }
        const { getSharedSqliteMainDbIfReady } = require('./dbAdapter');
        const shared = getSharedSqliteMainDbIfReady(this.config.dbPath);
        if (shared) {
            this.sqlite = shared;
            this.ownsSqlite = false;
        } else {
            const Database = require('better-sqlite3');
            this.sqlite = new Database(this.config.dbPath, { readonly: false, fileMustExist: false });
            this.sqlite.pragma('busy_timeout = 5000');
            this.sqlite.pragma('journal_mode = WAL');
            this.ownsSqlite = true;
        }
        this.sqlite.exec(`
            CREATE TABLE IF NOT EXISTS panel_sessions (
                sid TEXT PRIMARY KEY,
                session_json TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_panel_sessions_expires ON panel_sessions (expires_at);
        `);
        this.ensureSqliteColumns();
    }

    ensureSqliteColumns() {
        const cols = this.sqlite.prepare('PRAGMA table_info(panel_sessions)').all().map((c) => c.name);
        const add = (name, ddl) => {
            if (!cols.includes(name)) this.sqlite.exec(`ALTER TABLE panel_sessions ADD COLUMN ${ddl}`);
        };
        add('user_id', 'user_id INTEGER');
        add('username', 'username TEXT');
        add('ip_address', 'ip_address TEXT');
        add('user_agent', 'user_agent TEXT');
        add('client_fingerprint', 'client_fingerprint TEXT');
        add('created_at', 'created_at INTEGER');
        add('last_activity_at', 'last_activity_at INTEGER');
        add('ended_at', 'ended_at INTEGER');
        add('end_reason', 'end_reason TEXT');
        add('is_active', 'is_active INTEGER NOT NULL DEFAULT 1');
        this.sqlite.exec(`
            CREATE INDEX IF NOT EXISTS idx_panel_sessions_user_active
                ON panel_sessions (user_id, is_active);
            CREATE INDEX IF NOT EXISTS idx_panel_sessions_active
                ON panel_sessions (is_active, expires_at);
        `);
    }

    async ensurePostgresColumns() {
        const desired = [
            ['user_id', 'INTEGER'],
            ['username', 'TEXT'],
            ['ip_address', 'TEXT'],
            ['user_agent', 'TEXT'],
            ['client_fingerprint', 'TEXT'],
            ['created_at', 'BIGINT'],
            ['last_activity_at', 'BIGINT'],
            ['ended_at', 'BIGINT'],
            ['end_reason', 'TEXT'],
            ['is_active', 'BOOLEAN NOT NULL DEFAULT TRUE']
        ];
        for (const [name, type] of desired) {
            await this.pool.query(
                `ALTER TABLE panel_sessions ADD COLUMN IF NOT EXISTS ${name} ${type}`
            );
        }
        await this.pool.query(`
            CREATE INDEX IF NOT EXISTS idx_panel_sessions_user_active
                ON panel_sessions (user_id, is_active);
            CREATE INDEX IF NOT EXISTS idx_panel_sessions_active
                ON panel_sessions (is_active, expires_at);
        `);
    }

    expiresAt(sess) {
        const raw = sess?.cookie?.expires;
        const fromCookie = raw ? new Date(raw).getTime() : NaN;
        if (Number.isFinite(fromCookie)) return fromCookie;
        const created = Number(sess?.createdAt) || Date.now();
        const absolute = created + this.maxAgeMs;
        const idle = Date.now() + this.idleTimeoutMs;
        return Math.min(absolute, idle);
    }

    rowExpired(row, now = Date.now()) {
        if (!row) return { expired: true, reason: END_REASONS.DESTROYED };
        const active = this.type === 'postgres' ? row.is_active !== false : Number(row.is_active) === 1;
        if (!active) {
            return { expired: true, reason: row.end_reason || END_REASONS.REVOKED };
        }
        const created = Number(row.created_at) || 0;
        const last = Number(row.last_activity_at) || created || now;
        if (created && now - created > this.maxAgeMs) {
            return { expired: true, reason: END_REASONS.MAX_AGE };
        }
        if (last && now - last > this.idleTimeoutMs) {
            return { expired: true, reason: END_REASONS.IDLE };
        }
        const expiresAt = this.type === 'postgres'
            ? new Date(row.expires_at).getTime()
            : Number(row.expires_at);
        if (Number.isFinite(expiresAt) && expiresAt <= now) {
            // Prefer idle/max classification when metadata is present.
            if (created && now - created > this.maxAgeMs) {
                return { expired: true, reason: END_REASONS.MAX_AGE };
            }
            return { expired: true, reason: END_REASONS.IDLE };
        }
        return { expired: false };
    }

    async markEnded(sid, reason) {
        const endedAt = Date.now();
        if (this.type === 'postgres') {
            await this.pool.query(
                `UPDATE panel_sessions
                 SET is_active = FALSE, ended_at = $2, end_reason = COALESCE(end_reason, $3), updated_at = NOW()
                 WHERE sid = $1 AND is_active = TRUE`,
                [sid, endedAt, reason]
            );
            return;
        }
        this.sqlite.prepare(
            `UPDATE panel_sessions
             SET is_active = 0, ended_at = ?, end_reason = COALESCE(end_reason, ?), updated_at = datetime('now')
             WHERE sid = ? AND is_active = 1`
        ).run(endedAt, reason, sid);
    }

    get(sid, callback) {
        this.ready.then(async () => {
            let row;
            if (this.type === 'postgres') {
                const result = await this.pool.query(
                    'SELECT * FROM panel_sessions WHERE sid = $1',
                    [sid]
                );
                row = result.rows[0] || null;
            } else {
                row = this.sqlite.prepare('SELECT * FROM panel_sessions WHERE sid = ?').get(sid) || null;
            }
            if (!row) {
                callback(null, null);
                return;
            }
            const check = this.rowExpired(row);
            if (check.expired) {
                if (this.type === 'postgres' ? row.is_active !== false : Number(row.is_active) === 1) {
                    await this.markEnded(sid, check.reason);
                }
                callback(null, null);
                return;
            }
            callback(null, JSON.parse(row.session_json));
        }).catch((err) => callback(err));
    }

    set(sid, sess, callback = () => {}) {
        this.ready.then(async () => {
            const serialized = JSON.stringify(sess);
            const expiresAt = this.expiresAt(sess);
            const now = Date.now();
            const createdAt = Number(sess?.createdAt) || now;
            const lastActivity = Number(sess?.lastActivityAt) || now;
            const userId = sess?.userId ?? null;
            const username = sess?.user?.username || sess?.username || null;
            const ip = sanitizeIp(sess?.loginIp || '');
            const ua = sanitizeUserAgent(sess?.loginUserAgent || '');
            const fp = sanitizeFingerprint(sess?.clientFingerprint || '');

            if (this.type === 'postgres') {
                await this.pool.query(`
                    INSERT INTO panel_sessions (
                        sid, session_json, expires_at, updated_at,
                        user_id, username, ip_address, user_agent, client_fingerprint,
                        created_at, last_activity_at, ended_at, end_reason, is_active
                    ) VALUES (
                        $1, $2, to_timestamp($3 / 1000.0), NOW(),
                        $4, $5, NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''),
                        $9, $10, NULL, NULL, TRUE
                    )
                    ON CONFLICT(sid) DO UPDATE SET
                        session_json = EXCLUDED.session_json,
                        expires_at = EXCLUDED.expires_at,
                        updated_at = NOW(),
                        user_id = COALESCE(EXCLUDED.user_id, panel_sessions.user_id),
                        username = COALESCE(EXCLUDED.username, panel_sessions.username),
                        ip_address = COALESCE(NULLIF(EXCLUDED.ip_address, ''), panel_sessions.ip_address),
                        user_agent = COALESCE(NULLIF(EXCLUDED.user_agent, ''), panel_sessions.user_agent),
                        client_fingerprint = COALESCE(NULLIF(EXCLUDED.client_fingerprint, ''), panel_sessions.client_fingerprint),
                        created_at = COALESCE(panel_sessions.created_at, EXCLUDED.created_at),
                        last_activity_at = EXCLUDED.last_activity_at,
                        is_active = CASE
                            WHEN panel_sessions.is_active = FALSE THEN FALSE
                            ELSE TRUE
                        END
                `, [sid, serialized, expiresAt, userId, username, ip, ua, fp, createdAt, lastActivity]);
            } else {
                this.sqlite.prepare(`
                    INSERT INTO panel_sessions (
                        sid, session_json, expires_at, updated_at,
                        user_id, username, ip_address, user_agent, client_fingerprint,
                        created_at, last_activity_at, ended_at, end_reason, is_active
                    ) VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1)
                    ON CONFLICT(sid) DO UPDATE SET
                        session_json = excluded.session_json,
                        expires_at = excluded.expires_at,
                        updated_at = datetime('now'),
                        user_id = COALESCE(excluded.user_id, panel_sessions.user_id),
                        username = COALESCE(excluded.username, panel_sessions.username),
                        ip_address = COALESCE(NULLIF(excluded.ip_address, ''), panel_sessions.ip_address),
                        user_agent = COALESCE(NULLIF(excluded.user_agent, ''), panel_sessions.user_agent),
                        client_fingerprint = COALESCE(NULLIF(excluded.client_fingerprint, ''), panel_sessions.client_fingerprint),
                        created_at = COALESCE(panel_sessions.created_at, excluded.created_at),
                        last_activity_at = excluded.last_activity_at,
                        is_active = CASE
                            WHEN panel_sessions.is_active = 0 THEN 0
                            ELSE 1
                        END
                `).run(sid, serialized, expiresAt, userId, username, ip || null, ua || null, fp || null, createdAt, lastActivity);
            }
            callback(null);
        }).catch((err) => callback(err));
    }

    touch(sid, sess, callback = () => {}) {
        this.ready.then(async () => {
            const expiresAt = this.expiresAt(sess);
            const lastActivity = Number(sess?.lastActivityAt) || Date.now();
            if (this.type === 'postgres') {
                await this.pool.query(
                    `UPDATE panel_sessions
                     SET expires_at = to_timestamp($2 / 1000.0),
                         last_activity_at = $3,
                         updated_at = NOW()
                     WHERE sid = $1 AND is_active = TRUE`,
                    [sid, expiresAt, lastActivity]
                );
            } else {
                this.sqlite.prepare(
                    `UPDATE panel_sessions
                     SET expires_at = ?, last_activity_at = ?, updated_at = datetime('now')
                     WHERE sid = ? AND is_active = 1`
                ).run(expiresAt, lastActivity, sid);
            }
            callback(null);
        }).catch((err) => callback(err));
    }

    destroy(sid, callback = () => {}) {
        this.ready.then(async () => {
            // Soft-end so history remains available for audit UIs.
            await this.markEnded(sid, END_REASONS.DESTROYED);
            // Keep row for history; express-session only needs it gone for get().
            // Soft-end already makes get() return null. Optionally clear cookie blob.
            if (this.type === 'postgres') {
                await this.pool.query(
                    `UPDATE panel_sessions
                     SET session_json = '{}', end_reason = COALESCE(end_reason, $2), updated_at = NOW()
                     WHERE sid = $1`,
                    [sid, END_REASONS.DESTROYED]
                );
            } else {
                this.sqlite.prepare(
                    `UPDATE panel_sessions
                     SET session_json = '{}', end_reason = COALESCE(end_reason, ?), updated_at = datetime('now')
                     WHERE sid = ?`
                ).run(END_REASONS.DESTROYED, sid);
            }
            callback(null);
        }).catch((err) => callback(err));
    }

    /**
     * Atomically mark the session as the sole active session for a user.
     * Previous active sessions are ended with reason "replaced".
     * @returns {Promise<{ replaced: Array<{sid, ip_address, user_agent}> }>}
     */
    async activateExclusiveSession(sid, meta = {}) {
        await this.ready;
        const now = Date.now();
        const userId = meta.userId;
        if (userId == null) {
            throw new Error('activateExclusiveSession requires userId');
        }
        const username = meta.username || null;
        const ip = sanitizeIp(meta.ip || '');
        const ua = sanitizeUserAgent(meta.userAgent || '');
        const fp = sanitizeFingerprint(meta.clientFingerprint || '');
        const createdAt = Number(meta.createdAt) || now;
        const lastActivity = Number(meta.lastActivityAt) || now;
        const expiresAt = Math.min(createdAt + this.maxAgeMs, now + this.idleTimeoutMs);

        if (this.type === 'postgres') {
            const client = await this.pool.connect();
            try {
                await client.query('BEGIN');
                const prev = await client.query(
                    `UPDATE panel_sessions
                     SET is_active = FALSE,
                         ended_at = $2,
                         end_reason = $3,
                         updated_at = NOW()
                     WHERE user_id = $1 AND is_active = TRUE AND sid <> $4
                     RETURNING sid, ip_address, user_agent, username`,
                    [userId, now, END_REASONS.REPLACED, sid]
                );
                await client.query(
                    `UPDATE panel_sessions
                     SET user_id = $2,
                         username = $3,
                         ip_address = NULLIF($4, ''),
                         user_agent = NULLIF($5, ''),
                         client_fingerprint = NULLIF($6, ''),
                         created_at = $7,
                         last_activity_at = $8,
                         expires_at = to_timestamp($9 / 1000.0),
                         ended_at = NULL,
                         end_reason = NULL,
                         is_active = TRUE,
                         updated_at = NOW()
                     WHERE sid = $1`,
                    [sid, userId, username, ip, ua, fp, createdAt, lastActivity, expiresAt]
                );
                await client.query('COMMIT');
                return { replaced: prev.rows || [] };
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        }

        const replaceTxn = this.sqlite.transaction(() => {
            const replaced = this.sqlite.prepare(
                `SELECT sid, ip_address, user_agent, username
                 FROM panel_sessions
                 WHERE user_id = ? AND is_active = 1 AND sid <> ?`
            ).all(userId, sid);
            this.sqlite.prepare(
                `UPDATE panel_sessions
                 SET is_active = 0, ended_at = ?, end_reason = ?, updated_at = datetime('now')
                 WHERE user_id = ? AND is_active = 1 AND sid <> ?`
            ).run(now, END_REASONS.REPLACED, userId, sid);
            this.sqlite.prepare(
                `UPDATE panel_sessions
                 SET user_id = ?,
                     username = ?,
                     ip_address = ?,
                     user_agent = ?,
                     client_fingerprint = ?,
                     created_at = ?,
                     last_activity_at = ?,
                     expires_at = ?,
                     ended_at = NULL,
                     end_reason = NULL,
                     is_active = 1,
                     updated_at = datetime('now')
                 WHERE sid = ?`
            ).run(userId, username, ip || null, ua || null, fp || null, createdAt, lastActivity, expiresAt, sid);
            return replaced;
        });
        return { replaced: replaceTxn() || [] };
    }

    async endSession(sid, reason = END_REASONS.LOGOUT) {
        await this.ready;
        await this.markEnded(sid, reason);
        if (this.type === 'postgres') {
            await this.pool.query(
                `UPDATE panel_sessions SET session_json = '{}', updated_at = NOW() WHERE sid = $1`,
                [sid]
            );
        } else {
            this.sqlite.prepare(
                `UPDATE panel_sessions SET session_json = '{}', updated_at = datetime('now') WHERE sid = ?`
            ).run(sid);
        }
    }

    async getSessionRecord(sid) {
        await this.ready;
        if (this.type === 'postgres') {
            const result = await this.pool.query('SELECT * FROM panel_sessions WHERE sid = $1', [sid]);
            return result.rows[0] || null;
        }
        return this.sqlite.prepare('SELECT * FROM panel_sessions WHERE sid = ?').get(sid) || null;
    }

    async listUserSessions(userId, { includeEnded = true, limit = 50 } = {}) {
        await this.ready;
        const lim = Math.min(200, Math.max(1, Number(limit) || 50));
        if (this.type === 'postgres') {
            const result = await this.pool.query(
                includeEnded
                    ? `SELECT sid, user_id, username, ip_address, user_agent, client_fingerprint,
                              created_at, last_activity_at, ended_at, end_reason, is_active, expires_at
                       FROM panel_sessions
                       WHERE user_id = $1
                       ORDER BY COALESCE(last_activity_at, created_at) DESC NULLS LAST
                       LIMIT $2`
                    : `SELECT sid, user_id, username, ip_address, user_agent, client_fingerprint,
                              created_at, last_activity_at, ended_at, end_reason, is_active, expires_at
                       FROM panel_sessions
                       WHERE user_id = $1 AND is_active = TRUE
                       ORDER BY COALESCE(last_activity_at, created_at) DESC NULLS LAST
                       LIMIT $2`,
                [userId, lim]
            );
            return result.rows;
        }
        return this.sqlite.prepare(
            includeEnded
                ? `SELECT sid, user_id, username, ip_address, user_agent, client_fingerprint,
                          created_at, last_activity_at, ended_at, end_reason, is_active, expires_at
                   FROM panel_sessions
                   WHERE user_id = ?
                   ORDER BY COALESCE(last_activity_at, created_at) DESC
                   LIMIT ?`
                : `SELECT sid, user_id, username, ip_address, user_agent, client_fingerprint,
                          created_at, last_activity_at, ended_at, end_reason, is_active, expires_at
                   FROM panel_sessions
                   WHERE user_id = ? AND is_active = 1
                   ORDER BY COALESCE(last_activity_at, created_at) DESC
                   LIMIT ?`
        ).all(userId, lim);
    }

    cleanup(callback = () => {}) {
        this.ready.then(async () => {
            const now = Date.now();
            // Soft-expire stale active sessions first (keep history).
            if (this.type === 'postgres') {
                await this.pool.query(
                    `UPDATE panel_sessions
                     SET is_active = FALSE,
                         ended_at = COALESCE(ended_at, $1),
                         end_reason = COALESCE(end_reason, $2),
                         updated_at = NOW()
                     WHERE is_active = TRUE
                       AND (
                         expires_at <= NOW()
                         OR (created_at IS NOT NULL AND $1 - created_at > $3)
                         OR (last_activity_at IS NOT NULL AND $1 - last_activity_at > $4)
                       )`,
                    [now, END_REASONS.IDLE, this.maxAgeMs, this.idleTimeoutMs]
                );
                // Hard-delete only anonymous / never-authenticated expired blobs older than maxAge.
                await this.pool.query(
                    `DELETE FROM panel_sessions
                     WHERE user_id IS NULL
                       AND expires_at <= NOW() - INTERVAL '1 day'`
                );
            } else {
                this.sqlite.prepare(
                    `UPDATE panel_sessions
                     SET is_active = 0,
                         ended_at = COALESCE(ended_at, ?),
                         end_reason = COALESCE(end_reason, ?),
                         updated_at = datetime('now')
                     WHERE is_active = 1
                       AND (
                         expires_at <= ?
                         OR (created_at IS NOT NULL AND ? - created_at > ?)
                         OR (last_activity_at IS NOT NULL AND ? - last_activity_at > ?)
                       )`
                ).run(now, END_REASONS.IDLE, now, now, this.maxAgeMs, now, this.idleTimeoutMs);
                this.sqlite.prepare(
                    `DELETE FROM panel_sessions
                     WHERE user_id IS NULL AND expires_at <= ?`
                ).run(now - 24 * 60 * 60 * 1000);
            }
            callback(null);
        }).catch((err) => callback(err));
    }

    async close() {
        await this.ready;
        if (this.pool) await this.pool.end();
        if (this.ownsSqlite && this.sqlite) {
            this.sqlite.close();
        }
        this.sqlite = null;
    }
}

module.exports = { DatabaseSessionStore, END_REASONS };
