#!/usr/bin/env node
/**
 * Dev-only: add many fake devices for performance checks of the device
 * list (the Svelte console's budget is measured with 5,000). Never run this
 * against a real server.
 *
 *   docker compose exec -u betterdesk betterdesk \
 *     node /app/scripts/dev/seed-many-devices.js --count 5000
 *   docker compose exec -u betterdesk betterdesk \
 *     node /app/scripts/dev/seed-many-devices.js --remove
 *
 * The devices get IDs 950000000 and up and the host name prefix "perf-",
 * so --remove deletes exactly them and nothing from seed-ui-data.js.
 */

'use strict';

const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const i = args.indexOf('--' + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const GO_DB = arg('go-db', process.env.DB_PATH || '/opt/rustdesk/db_v2.sqlite3');
const COUNT = Math.max(1, Math.min(20000, Number(arg('count', '5000'))));
const FIRST_ID = 950000000;

const OSES = ['Windows 11 Pro', 'Windows 10 Enterprise', 'Ubuntu 24.04', 'macOS 15.1', 'Android 14', 'Debian 12', 'ChromeOS 128'];
const PLACES = ['reception', 'warehouse', 'lab', 'office', 'kiosk', 'branch', 'lobby', 'workshop'];
const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString().replace('T', ' ').slice(0, 19);

const db = new Database(GO_DB);
db.pragma('busy_timeout = 5000');

if (args.includes('--remove')) {
    const n = db.prepare("DELETE FROM peers WHERE CAST(id AS INTEGER) >= ? AND hostname LIKE 'perf-%'").run(FIRST_ID).changes;
    console.log(`removed ${n} perf devices`);
    process.exit(0);
}

const cols = db.prepare('PRAGMA table_info(peers)').all().map((c) => c.name);
const extra = cols.includes('device_type') ? ', device_type' : '';
const extraVal = cols.includes('device_type') ? ", 'rustdesk'" : '';
const insert = db.prepare(`
    INSERT INTO peers (id, uuid, ip, user, hostname, os, version, status, last_online, created_at,
                       banned, ban_reason, banned_at, soft_deleted, deleted_at, note, tags${extra})
    VALUES (@id, @uuid, @ip, @user, @hostname, @os, '1.4.2', 'OFFLINE', @last_online, @created_at,
            @banned, '', NULL, 0, NULL, @note, @tags${extraVal})
    ON CONFLICT(id) DO NOTHING
`);

db.transaction(() => {
    for (let i = 0; i < COUNT; i++) {
        const place = PLACES[i % PLACES.length];
        insert.run({
            id: String(FIRST_ID + i),
            uuid: 'perf-uuid-' + i,
            ip: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`,
            user: `user${i % 97}`,
            hostname: `perf-${place}-${String(i).padStart(5, '0')}`,
            os: OSES[i % OSES.length],
            last_online: iso(5 + (i % 10000)),
            created_at: iso(60 * 24 * (i % 365)),
            banned: i % 211 === 0 ? 1 : 0,
            note: i % 13 === 0 ? `Perf note ${i}` : '',
            tags: i % 5 === 0 ? 'perf,' + place : ''
        });
    }
})();
console.log(`added up to ${COUNT} perf devices (IDs ${FIRST_ID}..${FIRST_ID + COUNT - 1})`);
