#!/usr/bin/env node
/**
 * Dev-only: fill a local BetterDesk console with fake data so UI work
 * has something to show. Never run this against a real server.
 *
 * Run inside the container (or wherever the console and Go server run):
 *
 *   docker compose exec -u betterdesk betterdesk \
 *     node /app/scripts/dev/seed-ui-data.js --admin-password <password>
 *
 * Then keep some devices online with fake heartbeats:
 *
 *   docker compose exec -d -u betterdesk betterdesk \
 *     node /app/scripts/dev/fake-heartbeats.js
 *
 * Devices, help requests and pending enrollments go straight into the Go
 * server's SQLite database. Users, folders, groups and tags go through the
 * console API so they are created the normal way.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
function arg(name, fallback) {
    const i = args.indexOf('--' + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const GO_DB = arg('go-db', process.env.DB_PATH || '/opt/rustdesk/db_v2.sqlite3');
const AUTH_DB = arg('auth-db', process.env.AUTH_DB_PATH || '/app/data/auth.db');
const PANEL = arg('panel', 'http://127.0.0.1:' + (process.env.PORT || 5000));
const ADMIN_USER = arg('admin-user', 'admin');
const ADMIN_PASSWORD = arg('admin-password', process.env.ADMIN_PASSWORD || '');
const ONLINE_FILE = arg('online-file', '/app/data/dev-online-ids.json');

if (process.env.NODE_ENV === 'production' && !args.includes('--force')) {
    console.error('Refusing to seed with NODE_ENV=production. Pass --force for a throwaway container.');
    process.exit(1);
}
if (!ADMIN_PASSWORD) {
    console.error('Pass --admin-password (or set ADMIN_PASSWORD).');
    process.exit(1);
}

// Obviously fake devices. [id, hostname, os, version, user, tags, folder, online, extra]
const DEVICES = [
    ['900100001', 'demo-reception-01', 'Windows 11 Pro', '1.4.2', 'demo.front', 'office,ground-floor', 'Office', true],
    ['900100002', 'demo-reception-02', 'Windows 11 Pro', '1.4.2', 'demo.front', 'office,ground-floor', 'Office', false],
    ['900100003', 'demo-accounts-01', 'Windows 10 Pro', '1.3.9', 'demo.ledger', 'office,finance', 'Office', true],
    ['900100004', 'demo-accounts-02', 'Windows 10 Pro', '1.3.9', 'demo.ledger', 'finance', 'Office', false],
    ['900100005', 'demo-ceo-macbook', 'macOS 15.1', '1.4.2', 'demo.boss', 'vip', 'Office', true],
    ['900100006', 'demo-design-imac', 'macOS 14.6', '1.4.1', 'demo.pixel', 'design', 'Office', true],
    ['900100007', 'demo-design-mbp', 'macOS 15.0', '1.4.2', 'demo.pixel', 'design,laptop', 'Office', false],
    ['900100008', 'demo-warehouse-pc', 'Windows 10 IoT', '1.3.7', 'demo.stock', 'warehouse', 'Warehouse', true],
    ['900100009', 'demo-warehouse-scan-1', 'Android 14', '1.4.0', '', 'warehouse,scanner', 'Warehouse', true],
    ['900100010', 'demo-warehouse-scan-2', 'Android 13', '1.3.9', '', 'warehouse,scanner', 'Warehouse', false],
    ['900100011', 'demo-warehouse-scan-3', 'Android 14', '1.4.0', '', 'warehouse,scanner', 'Warehouse', false],
    ['900100012', 'demo-build-server', 'Ubuntu 24.04', '1.4.2', 'demo.ci', 'server,linux', 'Servers', true],
    ['900100013', 'demo-file-server', 'Debian 12', '1.4.1', 'demo.ops', 'server,linux', 'Servers', true],
    ['900100014', 'demo-backup-nas', 'Linux 6.1', '1.3.8', 'demo.ops', 'server,storage', 'Servers', false],
    ['900100015', 'demo-db-primary', 'Ubuntu 22.04', '1.4.2', 'demo.ops', 'server,linux,critical', 'Servers', true],
    ['900100016', 'demo-db-replica', 'Ubuntu 22.04', '1.4.2', 'demo.ops', 'server,linux', 'Servers', false],
    ['900100017', 'demo-sales-laptop-01', 'Windows 11 Home', '1.4.0', 'demo.seller', 'laptop,sales', '', true],
    ['900100018', 'demo-sales-laptop-02', 'Windows 11 Home', '1.3.9', 'demo.seller', 'laptop,sales', '', false],
    ['900100019', 'demo-sales-laptop-03', 'Windows 11 Pro', '1.4.2', 'demo.seller', 'laptop,sales', '', false],
    ['900100020', 'demo-kiosk-lobby', 'Windows 10 IoT', '1.3.5', '', 'kiosk', '', true],
    ['900100021', 'demo-kiosk-canteen', 'Windows 10 IoT', '1.3.5', '', 'kiosk', '', false],
    ['900100022', 'demo-support-ipad', 'iOS 18.1', '1.4.0', 'demo.help', 'mobile', '', false],
    ['900100023', 'demo-support-pixel', 'Android 15', '1.4.2', 'demo.help', 'mobile', '', true],
    ['900100024', 'demo-lab-rpi-01', 'Linux 6.6 (Raspberry Pi)', '1.3.9', '', 'lab,iot', 'Lab', true],
    ['900100025', 'demo-lab-rpi-02', 'Linux 6.6 (Raspberry Pi)', '1.3.9', '', 'lab,iot', 'Lab', false],
    ['900100026', 'demo-lab-win-vm', 'Windows Server 2022', '1.4.1', 'demo.lab', 'lab,vm', 'Lab', true],
    ['900100027', 'demo-old-xp-box', 'Windows 7', '1.1.9', '', 'legacy', 'Lab', false],
    ['900100028', 'demo-stolen-laptop', 'Windows 11 Pro', '1.4.0', 'demo.lost', 'laptop', '', false, { banned: 'Reported stolen' }],
    ['900100029', 'demo-unknown-box', 'Linux 5.15', '1.2.0', '', '', '', false, { banned: 'Unknown device, blocked' }],
    ['900100030', 'demo-retired-pc', 'Windows 10 Pro', '1.3.0', 'demo.old', 'retired', '', false, { deleted: true }],
    ['900100031', 'demo-noted-pc', 'Windows 11 Pro', '1.4.2', 'demo.front', 'office', 'Office', false, { note: 'Fan is loud, replace in spring' }],
];

const FOLDERS = [
    { name: 'Office', color: '#22c55e' },
    { name: 'Warehouse', color: '#f59e0b' },
    { name: 'Servers', color: '#6366f1' },
    { name: 'Lab', color: '#64748b' },
];

const GROUPS = [
    { name: 'All laptops', source_type: 'tag', tag_filter: 'laptop' },
    { name: 'Critical servers', source_type: 'tag', tag_filter: 'critical' },
    { name: 'Support team devices', source_type: 'manual', members: ['900100022', '900100023'] },
];

// The user API allows three new accounts per five minutes.
const USERS = [
    { username: 'demo_operator', role: 'operator', email: 'operator@example.invalid' },
    { username: 'demo_viewer', role: 'viewer', email: 'viewer@example.invalid' },
    { username: 'demo_serveradmin', role: 'server_admin', email: 'serveradmin@example.invalid' },
];

const PENDING = [
    { id: '900200001', hostname: 'demo-new-laptop', platform: 'Windows', version: '1.4.2', ip: '10.0.0.51' },
    { id: '900200002', hostname: 'demo-new-tablet', platform: 'Android', version: '1.4.0', ip: '10.0.0.52' },
    { id: '900200003', hostname: '', platform: 'Linux', version: '1.4.2', ip: '10.0.0.53' },
];

const HELP_REQUESTS = [
    ['900100001', 'demo-reception-01', 'Printer does not show up', 'pending', ''],
    ['900100017', 'demo-sales-laptop-01', 'VPN keeps dropping since the update', 'pending', ''],
    ['900100008', 'demo-warehouse-pc', 'Label software crashes on start', 'accepted', 'demo_operator'],
    ['900100006', 'demo-design-imac', 'Need a font installed', 'resolved', 'demo_helpdesk'],
];

function iso(minutesAgo) {
    return new Date(Date.now() - minutesAgo * 60000).toISOString().replace('T', ' ').slice(0, 19);
}

function seedGoDb() {
    const db = new Database(GO_DB);
    db.pragma('busy_timeout = 5000');
    const cols = db.prepare('PRAGMA table_info(peers)').all().map((c) => c.name);
    const has = (c) => cols.includes(c);

    const insert = db.prepare(`
        INSERT INTO peers (id, uuid, ip, user, hostname, os, version, status, last_online, created_at,
                           banned, ban_reason, banned_at, soft_deleted, deleted_at, note, tags
                           ${has('device_type') ? ', device_type' : ''})
        VALUES (@id, @uuid, @ip, @user, @hostname, @os, @version, 'OFFLINE', @last_online, @created_at,
                @banned, @ban_reason, @banned_at, @soft_deleted, @deleted_at, @note, ''
                ${has('device_type') ? ', @device_type' : ''})
        ON CONFLICT(id) DO UPDATE SET hostname = excluded.hostname, os = excluded.os,
            version = excluded.version, user = excluded.user, last_online = excluded.last_online,
            banned = excluded.banned, ban_reason = excluded.ban_reason, banned_at = excluded.banned_at,
            soft_deleted = excluded.soft_deleted, deleted_at = excluded.deleted_at, note = excluded.note
    `);

    const tx = db.transaction(() => {
        DEVICES.forEach(([id, hostname, os, version, user, , , online, extra = {}], i) => {
            insert.run({
                id,
                uuid: 'demo-uuid-' + id,
                ip: '10.0.' + (1 + (i % 4)) + '.' + (20 + i),
                user,
                hostname,
                os,
                version,
                last_online: online ? iso(0) : iso(60 * (2 + i * 7)),
                created_at: iso(60 * 24 * (40 - i)),
                banned: extra.banned ? 1 : 0,
                ban_reason: extra.banned || '',
                banned_at: extra.banned ? iso(60 * 24 * 3) : null,
                soft_deleted: extra.deleted ? 1 : 0,
                deleted_at: extra.deleted ? iso(60 * 24 * 10) : null,
                note: extra.note || '',
                device_type: /Android|iOS/.test(os) ? 'mobile' : 'rustdesk',
            });
        });

        const setConfig = db.prepare(`INSERT INTO server_config (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
        PENDING.forEach((p, i) => {
            setConfig.run('pending_device_' + p.id, JSON.stringify({
                device_id: p.id,
                hostname: p.hostname,
                platform: p.platform,
                version: p.version,
                ip: p.ip,
                created_at: new Date(Date.now() - (i + 1) * 3600000).toISOString(),
            }));
        });

        db.prepare("DELETE FROM help_requests WHERE device_id LIKE '9001000%'").run();
        const help = db.prepare(`INSERT INTO help_requests (device_id, hostname, message, status, handled_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`);
        HELP_REQUESTS.forEach(([id, host, msg, status, by], i) => {
            help.run(id, host, msg, status, by, iso(20 + i * 90), iso(10 + i * 60));
        });
    });
    tx();
    db.close();
    console.log(`Go DB: ${DEVICES.length} devices, ${PENDING.length} pending enrollments, ${HELP_REQUESTS.length} help requests`);
}

function seedAuthDb() {
    const db = new Database(AUTH_DB);
    db.pragma('busy_timeout = 5000');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    if (tables.includes('pending_registrations')) {
        db.prepare("DELETE FROM pending_registrations WHERE device_id LIKE '9003%'").run();
        db.prepare(`INSERT INTO pending_registrations (device_id, hostname, platform, version, ip_address, status)
            VALUES (?, ?, ?, ?, ?, 'pending')`).run('900300001', 'demo-lan-printer-pc', 'Windows', '1.4.2', '10.0.9.14');
    }
    if (tables.includes('audit_log')) {
        const log = db.prepare('INSERT INTO audit_log (user_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?)');
        const entries = [
            ['device_ban', 'Banned 900100028 (Reported stolen)'],
            ['device_ban', 'Banned 900100029 (Unknown device, blocked)'],
            ['device_delete', 'Deleted 900100030'],
            ['settings_change', 'Changed relay server'],
            ['user_create', 'Created user demo_viewer'],
            ['remote_connect', 'Connected to 900100012'],
            ['remote_connect', 'Connected to 900100005'],
            ['folder_create', 'Created folder Lab'],
        ];
        entries.forEach(([action, details], i) => log.run(1, action, details, '10.0.0.' + (2 + i), iso(30 + i * 200)));
    }
    db.close();
    console.log('Auth DB: LAN registration and audit entries');
}

// ── Console API (users, folders, groups, tags) ──

let cookies = {};
let csrf = '';

function cookieHeader() {
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function keepCookies(res) {
    const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    raw.forEach((line) => {
        const [pair] = line.split(';');
        const eq = pair.indexOf('=');
        cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    });
}

async function refreshCsrf() {
    const res = await fetch(PANEL + '/login', { headers: { cookie: cookieHeader() }, redirect: 'manual' });
    keepCookies(res);
    let html = await res.text();
    if (res.status >= 300 && res.status < 400) {
        const page = await fetch(PANEL + '/', { headers: { cookie: cookieHeader() } });
        keepCookies(page);
        html = await page.text();
    }
    const m = html.match(/csrfToken:\s*'([^']*)'/);
    csrf = m ? m[1] : '';
}

async function api(method, url, body) {
    const res = await fetch(PANEL + url, {
        method,
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, cookie: cookieHeader() },
        body: body ? JSON.stringify(body) : undefined,
    });
    keepCookies(res);
    let json = null;
    try { json = await res.json(); } catch (_) { /* not json */ }
    if (!res.ok) {
        console.warn(`  ${method} ${url} -> ${res.status} ${json && (json.error || json.message) || ''}`);
    }
    return json || {};
}

async function seedViaApi() {
    await refreshCsrf();
    const login = await api('POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
    if (!login.success) throw new Error('Admin login failed');
    await refreshCsrf();

    for (const u of USERS) {
        await api('POST', '/api/users', { ...u, password: 'Demo-Password-' + u.username + '-42!' });
    }

    const existing = ((await api('GET', '/api/folders')).data || {}).folders || [];
    const folderIds = {};
    for (const f of FOLDERS) {
        const found = existing.find((x) => x.name === f.name);
        if (found) {
            folderIds[f.name] = found.id;
        } else {
            const r = await api('POST', '/api/folders', f);
            folderIds[f.name] = r.data && r.data.id;
        }
    }

    for (const [id, , , , , tags, folder] of DEVICES) {
        if (tags) await api('PUT', `/api/devices/${id}/tags`, { tags: tags.split(',') });
        if (folder && folderIds[folder]) await api('PATCH', `/api/devices/${id}/folder`, { folderId: folderIds[folder] });
    }

    const groups = ((await api('GET', '/api/device-groups')).data || {}).groups || [];
    for (const g of GROUPS) {
        let group = groups.find((x) => x.name === g.name);
        if (!group) {
            const r = await api('POST', '/api/device-groups', { name: g.name, source_type: g.source_type, tag_filter: g.tag_filter });
            group = r.data || r.group;
        }
        if (group && g.members) {
            for (const id of g.members) {
                await api('PUT', `/api/devices/${id}/groups`, { groupGuids: [group.guid] });
            }
        }
    }
    console.log(`API: ${USERS.length} users, ${FOLDERS.length} folders, ${GROUPS.length} groups, tags set`);
}

(async () => {
    seedGoDb();
    seedAuthDb();
    await seedViaApi();
    const online = DEVICES.filter((d) => d[7] && !(d[8] && (d[8].banned || d[8].deleted))).map((d) => d[0]);
    fs.writeFileSync(ONLINE_FILE, JSON.stringify(online));
    console.log(`${online.length} device IDs for fake-heartbeats.js written to ${ONLINE_FILE}`);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
