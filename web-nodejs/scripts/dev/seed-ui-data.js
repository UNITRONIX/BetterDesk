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
 * Each console account allows one session, so logging in here ends the admin
 * session a browser or test tool is using. To reuse that session instead,
 * copy a Playwright storageState file into the container and pass it:
 *
 *   docker cp .auth-admin.json betterdesk:/tmp/auth-admin.json
 *   docker compose exec -u betterdesk betterdesk \
 *     node /app/scripts/dev/seed-ui-data.js --cookie-file /tmp/auth-admin.json
 *
 * Then keep some devices online with fake heartbeats:
 *
 *   docker compose exec -d -u betterdesk betterdesk \
 *     node /app/scripts/dev/fake-heartbeats.js
 *
 * Devices, help requests, pending enrollments, tickets, chat, inventory,
 * activity, billing sessions and device history go straight into SQLite.
 * Users, folders, groups, tags, organizations, policies, billing packages,
 * contracts and saved reports go through the console API so they are created
 * the normal way. Running the script again replaces the demo rows instead of
 * adding more.
 */

'use strict';

const fs = require('fs');
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
function arg(name, fallback) {
    const i = args.indexOf('--' + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const GO_DB = arg('go-db', process.env.DB_PATH || '/opt/rustdesk/db_v2.sqlite3');
// Newer installs keep the console tables in the Go database ("consolidated"
// mode); only older ones still have a separate auth.db.
const AUTH_DB = arg('auth-db', '') || (() => {
    const legacy = process.env.AUTH_DB_PATH || '/app/data/auth.db';
    return fs.existsSync(legacy) ? legacy : GO_DB;
})();
const PANEL = arg('panel', 'http://127.0.0.1:' + (process.env.PORT || 5000));
const ADMIN_USER = arg('admin-user', 'admin');
const ADMIN_PASSWORD = arg('admin-password', process.env.ADMIN_PASSWORD || '');
const COOKIE_FILE = arg('cookie-file', '');
const ONLINE_FILE = arg('online-file', '/app/data/dev-online-ids.json');

if (process.env.NODE_ENV === 'production' && !args.includes('--force')) {
    console.error('Refusing to seed with NODE_ENV=production. Pass --force for a throwaway container.');
    process.exit(1);
}
if (!ADMIN_PASSWORD && !COOKIE_FILE) {
    console.error('Pass --cookie-file <storageState.json> or --admin-password (or set ADMIN_PASSWORD).');
    process.exit(1);
}

const NOW = Date.now();
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// SQLite datetime('now') format, UTC.
function sqlTime(ms) {
    return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}
function iso(minutesAgo) {
    return sqlTime(NOW - minutesAgo * MIN);
}

// Same numbers on every run, so re-seeding gives the same pictures.
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function seedFor(text) {
    let h = 2166136261;
    for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
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

const DEV = {};
DEVICES.forEach(([id, hostname, os, version, user, tags, folder, online, extra = {}], i) => {
    DEV[id] = {
        id, hostname, os, version, user, tags, folder, online, extra,
        ip: '10.0.' + (1 + (i % 4)) + '.' + (20 + i),
        lastOnlineMs: online ? NOW : NOW - (2 + i * 7) * HOUR,
    };
});

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

// Go enrollment queue (server_config pending_device_<id>).
const PENDING = [
    { id: '900200001', hostname: 'demo-new-laptop', platform: 'Windows', version: '1.4.2', ip: '10.0.0.51', ageHours: 1 },
    { id: '900200002', hostname: 'demo-new-tablet', platform: 'Android', version: '1.4.0', ip: '10.0.0.52', ageHours: 2 },
    { id: '900200003', hostname: '', platform: 'Linux', version: '1.4.2', ip: '10.0.0.53', ageHours: 3 },
    { id: '900200004', hostname: 'demo-pos-terminal', platform: 'Windows', version: '1.4.2', ip: '10.0.0.54', ageHours: 0.8 },
    { id: '900200005', hostname: 'demo-field-tablet', platform: 'Android', version: '1.3.9', ip: '10.0.0.55', ageHours: 26 },
    { id: '900200006', hostname: 'demo-intern-laptop', platform: 'Windows', version: '1.4.1', ip: '10.0.0.56', ageHours: 74 },
    { id: '900200007', hostname: '', platform: 'macOS', version: '1.4.2', ip: '10.0.0.57', ageHours: 146 },
];

// LAN discovery queue (console pending_registrations).
const LAN_PENDING = [
    ['900300001', 'demo-lan-printer-pc', 'Windows', '1.4.2', '10.0.9.14', 0],
    ['900300002', 'demo-meeting-room-pc', 'Windows', '1.4.1', '10.0.9.15', 2 * 24 * 60],
    ['900300003', 'demo-label-printer-host', 'Linux', '1.3.9', '10.0.9.16', 5 * 24 * 60 + 300],
];

const HELP_REQUESTS = [
    ['900100001', 'demo-reception-01', 'Printer does not show up', 'pending', ''],
    ['900100017', 'demo-sales-laptop-01', 'VPN keeps dropping since the update', 'pending', ''],
    ['900100008', 'demo-warehouse-pc', 'Label software crashes on start', 'accepted', 'demo_operator'],
    ['900100006', 'demo-design-imac', 'Need a font installed', 'resolved', 'demo_helpdesk'],
];

// ── Organizations, policies, billing (created through the console API) ──

const ORGS = [
    {
        key: 'northwind',
        name: 'Demo Northwind Clinic',
        slug: 'demo-northwind-clinic',
        members: [['demo_operator', 'admin'], ['demo_viewer', 'user']],
        localUsers: [
            { username: 'demo.nurse', display_name: 'Demo Nurse Station', email: 'nurse@northwind.example.invalid', role: 'user' },
            { username: 'demo.practice', display_name: 'Demo Practice Manager', email: 'manager@northwind.example.invalid', role: 'operator' },
        ],
        devices: [
            ['900100001', 'Reception', 'Front desk', 'Main building', 'demo.nurse'],
            ['900100002', 'Reception', 'Front desk', 'Main building', ''],
            ['900100003', 'Accounts', 'Room 1.04', 'Main building', 'demo.practice'],
            ['900100004', 'Accounts', 'Room 1.04', 'Main building', ''],
            ['900100005', 'Management', 'Room 2.01', 'Main building', 'demo.practice'],
            ['900100006', 'Marketing', 'Room 2.07', 'Annex', ''],
            ['900100031', 'Reception', 'Back office', 'Main building', ''],
        ],
        settings: { timezone: 'Europe/Berlin', support_email: 'it@northwind.example.invalid' },
        policies: {
            connection: { mode: 'attended', max_session_duration: 240, idle_lock_timeout: 10, wallpaper: 'hide_during_session' },
            features: { allow_file_transfer: true, allow_clipboard: true, allow_audio: false, allow_recording: true },
            security: { require_2fa: true, password_min_length: 14, password_require_special: true, password_max_age_days: 90, allowed_operators: ['admin', 'demo_operator'] },
            network: { block_direct_p2p: false, allowed_relay_servers: ['relay.example.invalid'], ip_allowlist: ['10.0.1.0/24', '10.0.2.0/24'] },
            update: { auto_update: true, channel: 'stable' },
        },
    },
    {
        key: 'harbor',
        name: 'Demo Harbor Logistics',
        slug: 'demo-harbor-logistics',
        members: [['demo_serveradmin', 'operator']],
        localUsers: [
            { username: 'demo.dispatch', display_name: 'Demo Dispatch Desk', email: 'dispatch@harbor.example.invalid', role: 'user' },
        ],
        devices: [
            ['900100008', 'Warehouse', 'Goods in', 'Hall A', 'demo.dispatch'],
            ['900100009', 'Warehouse', 'Hall A', 'Hall A', ''],
            ['900100010', 'Warehouse', 'Hall B', 'Hall B', ''],
            ['900100011', 'Warehouse', 'Hall B', 'Hall B', ''],
            ['900100017', 'Sales', 'Mobile', '', ''],
        ],
        settings: { timezone: 'Europe/Hamburg' },
        policies: {
            connection: { mode: 'unattended', max_session_duration: 480, idle_lock_timeout: 30, wallpaper: 'show' },
            update: { auto_update: false, channel: 'beta' },
        },
    },
    {
        key: 'lab',
        name: 'Demo Lab Collective',
        slug: 'demo-lab-collective',
        members: [],
        localUsers: [],
        devices: [
            ['900100024', 'Lab', 'Bench 1', 'Annex', ''],
            ['900100025', 'Lab', 'Bench 2', 'Annex', ''],
            ['900100026', 'Lab', 'Rack', 'Annex', ''],
        ],
        settings: {},
        policies: {
            network: { block_direct_p2p: true, allowed_relay_servers: [], ip_allowlist: ['10.0.4.0/24'] },
        },
    },
];

const PACKAGES = [
    { key: 'business', name: 'Demo Business Care', description: '20 hours of remote support a month for small offices', included_minutes: 1200, overage_rate: 48, currency: 'EUR', rounding_minutes: 10 },
    { key: 'basic', name: 'Demo Basic Support', description: '5 hours a month, billed in 15 minute steps', included_minutes: 300, overage_rate: 60, currency: 'EUR', rounding_minutes: 15 },
    { key: 'payg', name: 'Demo Pay As You Go', description: 'No included time, every session is billed', included_minutes: 0, overage_rate: 75, currency: 'EUR', rounding_minutes: 5 },
];

// Assignments: an org, an org's default device group, and a suspended one.
const CONTRACTS = [
    { org: 'northwind', target: 'device_group', pkg: 'business', status: 'active' },
    { org: 'harbor', target: 'device_group', pkg: 'basic', status: 'active' },
    { org: 'lab', target: 'org', pkg: 'payg', status: 'suspended' },
];

// [org, device, operator, startedMinutesAgo, rawMinutes|null (active), status, report]
const BILLING_SESSIONS = [
    ['northwind', '900100001', 'demo_operator', 6 * 24 * 60 + 120, 42, 'closed', ['Reinstalled printer driver and set default tray', 'hardware', '#2']],
    ['northwind', '900100003', 'admin', 5 * 24 * 60 + 30, 18, 'closed', ['Unlocked accounting software licence', 'software', '']],
    ['northwind', '900100005', 'demo_operator', 4 * 24 * 60 + 600, 75, 'closed', ['Moved mailbox to new laptop profile', 'software', '']],
    ['northwind', '900100006', 'demo_operator', 3 * 24 * 60 + 200, 9, 'closed', ['Installed brand fonts', 'software', '#9']],
    ['northwind', '900100002', 'admin', 2 * 24 * 60 + 90, 33, 'closed', ['Checked Windows update loop, cleared cache', 'software', '']],
    ['northwind', '900100004', 'demo_operator', 26 * 60, 51, 'pending_report', null],
    ['northwind', '900100001', 'demo_operator', 25, null, 'active', null],
    ['harbor', '900100008', 'demo_operator', 5 * 24 * 60 + 400, 118, 'closed', ['Label software crash, rebuilt print spooler', 'software', '#5']],
    ['harbor', '900100009', 'admin', 3 * 24 * 60 + 60, 131, 'closed', ['Re-enrolled scanner after factory reset', 'hardware', '']],
    ['harbor', '900100017', 'demo_operator', 20 * 60, 88, 'pending_report', null],
];

// ── Tickets ──

const TICKETS = [
    {
        title: 'Reception printer prints blank pages', status: 'open', priority: 'medium', category: 'hardware',
        device: '900100001', createdBy: 'admin', assignedTo: null, ageH: 3,
        description: 'Since this morning every job from demo-reception-01 comes out blank. The test page from the printer menu is fine.',
    },
    {
        title: 'VPN drops every 20 minutes on sales laptop', status: 'in_progress', priority: 'high', category: 'network',
        device: '900100017', createdBy: 'demo_operator', assignedTo: 'demo_operator', ageH: 27,
        description: 'Started after the client update last week. Happens on hotel Wi-Fi and at home.',
        comments: [
            ['demo_operator', 'Collected the VPN client log, it times out on rekey.', false, 24],
            ['admin', 'Try lowering the MTU to 1380, the hotel networks often break fragmented packets.', true, 20],
            ['demo_operator', 'MTU change applied. Waiting for the user to report back.', false, 4],
        ],
    },
    {
        title: 'Database replica lagging behind primary', status: 'open', priority: 'critical', category: 'software',
        device: '900100016', createdBy: 'admin', assignedTo: 'admin', ageH: 6,
        description: 'Replication lag on demo-db-replica is above 40 minutes and growing.',
        comments: [['admin', 'Replica went offline overnight, checking disk space first.', true, 5]],
    },
    {
        title: 'New starter needs accounts and a laptop', status: 'open', priority: 'low', category: 'access',
        device: null, createdBy: 'admin', assignedTo: 'demo_operator', ageH: 50,
        description: 'Starts on Monday in accounts. Needs a laptop, mail account and access to the finance share.',
    },
    {
        title: 'Label software crashes on start', status: 'resolved', priority: 'medium', category: 'software',
        device: '900100008', createdBy: 'demo_operator', assignedTo: 'demo_operator', ageH: 5 * 24 + 8, resolvedAgoH: 5 * 24 + 2,
        description: 'The label printing app closes right after the splash screen.',
        comments: [
            ['demo_operator', 'Print spooler was stuck. Rebuilt it and the app starts again.', false, 5 * 24 + 2],
        ],
    },
    {
        title: 'Replace loud fan in demo-noted-pc', status: 'closed', priority: 'low', category: 'hardware',
        device: '900100031', createdBy: 'demo_operator', assignedTo: 'admin', ageH: 12 * 24, resolvedAgoH: 6 * 24, closedAgoH: 5 * 24,
        description: 'User reports a grinding noise from the case fan.',
    },
    {
        title: 'Lobby kiosk shows a certificate warning', status: 'open', priority: 'high', category: 'network',
        device: '900100020', createdBy: 'admin', assignedTo: null, ageH: 0.5,
        description: 'Visitors see a browser certificate warning on the check-in page.',
    },
    {
        title: 'Backup NAS offline since the weekend', status: 'in_progress', priority: 'critical', category: 'hardware',
        device: '900100014', createdBy: 'demo_serveradmin', assignedTo: 'demo_serveradmin', ageH: 52,
        description: 'Nightly backups failed twice. The NAS does not answer ping.',
        comments: [
            ['demo_serveradmin', 'Power supply LED is off. Ordered a replacement.', true, 30],
            ['admin', 'Moved tonight\'s backup job to the file server as a stopgap.', false, 26],
        ],
    },
    {
        title: 'Install brand fonts on design iMac', status: 'closed', priority: 'low', category: 'software',
        device: '900100006', createdBy: 'admin', assignedTo: 'demo_operator', ageH: 4 * 24, resolvedAgoH: 3 * 24 + 20, closedAgoH: 3 * 24,
        description: 'Marketing needs the new brand fonts for the spring campaign.',
    },
];

const SLA_HOURS = { critical: 4, high: 8, medium: 24, low: 72 };

// ── Chat ──

// [sender, minutesAgo, text]. "admin" and "demo_operator" are console
// operators; a device id means a message typed on that device.
const CHAT = [
    {
        conv: 'operator:demo_operator',
        messages: [
            ['admin', 26 * 60, 'Can you take the VPN ticket for the sales laptop today?'],
            ['demo_operator', 26 * 60 - 4, 'Sure, I will call the user after lunch.'],
            ['demo_operator', 4 * 60, 'MTU change is on the laptop now. Waiting for feedback.'],
            ['admin', 4 * 60 - 2, 'Thanks. Leave the ticket in progress until they confirm.'],
            ['demo_operator', 35, 'Also: the backup NAS is still dark, should I escalate?'],
        ],
    },
    {
        conv: '900100008',
        messages: [
            ['900100008', 5 * 24 * 60 + 20, 'Hello, the label program closes as soon as I open it.'],
            ['demo_operator', 5 * 24 * 60 + 15, 'I am connecting now, please leave the PC on.'],
            ['900100008', 5 * 24 * 60 + 14, 'OK'],
            ['demo_operator', 5 * 24 * 60 - 30, 'Fixed. Please try printing a label.'],
            ['900100008', 5 * 24 * 60 - 34, 'Works again, thank you!'],
        ],
    },
    {
        conv: '900100017',
        messages: [
            ['900100017', 50, 'VPN dropped again during a customer call.'],
            ['900100017', 48, 'Is there anything I can do in the meantime?'],
        ],
    },
    {
        conv: 'group:demo0001',
        group: { name: 'Demo on-call', members: 'panel,operator:admin,operator:demo_operator,operator:demo_serveradmin' },
        messages: [
            ['admin', 3 * 24 * 60, 'On-call this week: demo_operator until Wednesday, then demo_serveradmin.'],
            ['demo_serveradmin', 3 * 24 * 60 - 10, 'Noted.'],
            ['demo_operator', 2 * 60, 'Heads-up: db replica is lagging, admin is on it.'],
        ],
    },
];

// ── Inventory, activity, history ──

const INVENTORY_DEVICES = [
    '900100001', '900100002', '900100003', '900100004', '900100005', '900100006', '900100008',
    '900100012', '900100013', '900100015', '900100016', '900100017', '900100024', '900100026',
];
const ACTIVITY_DEVICES = ['900100001', '900100003', '900100005', '900100006', '900100017', '900100026'];
// Desktops follow office hours, servers stay up with the odd reboot.
const HISTORY_DEVICES = [
    ['900100001', 'office'], ['900100003', 'office'], ['900100005', 'office'], ['900100002', 'office'],
    ['900100012', 'server'], ['900100015', 'server'], ['900100016', 'server'], ['900100026', 'server'],
];

function osClass(os) {
    if (/macOS/.test(os)) return 'mac';
    if (/Raspberry/.test(os)) return 'rpi';
    if (/Windows Server/.test(os)) return 'winserver';
    if (/Windows/.test(os)) return 'win';
    return 'linux';
}

const APPS = {
    win: [
        ['Microsoft Edge', '130.0.2849.68', 'Microsoft Corporation'],
        ['Google Chrome', '130.0.6723.117', 'Google LLC'],
        ['Microsoft 365 Apps for business', '16.0.18129.20116', 'Microsoft Corporation'],
        ['Adobe Acrobat Reader', '24.004.20243', 'Adobe'],
        ['7-Zip 24.08 (x64)', '24.08', 'Igor Pavlov'],
        ['Notepad++ (64-bit x64)', '8.7.1', 'Notepad++ Team'],
        ['VLC media player', '3.0.21', 'VideoLAN'],
        ['BetterDesk', '1.4.2', 'BetterDesk (demo)'],
        ['Demo Label Studio', '5.2.0', 'Example Software GmbH'],
        ['Demo Accounting Suite', '2024.3', 'Example Ledger Ltd'],
    ],
    mac: [
        ['Safari', '18.1', 'Apple'],
        ['Google Chrome', '130.0.6723.117', 'Google LLC'],
        ['Microsoft Outlook', '16.90', 'Microsoft Corporation'],
        ['Slack', '4.41.97', 'Slack Technologies'],
        ['Figma', '124.5.5', 'Figma, Inc.'],
        ['Adobe Photoshop 2025', '26.1', 'Adobe'],
        ['BetterDesk', '1.4.2', 'BetterDesk (demo)'],
    ],
    linux: [
        ['openssh-server', '1:9.6p1-3ubuntu13.5', 'Ubuntu Developers'],
        ['postgresql-16', '16.4-0ubuntu0.24.04.2', 'Ubuntu Developers'],
        ['docker-ce', '5:27.3.1-1~ubuntu.24.04~noble', 'Docker Inc.'],
        ['nginx', '1.24.0-2ubuntu7.1', 'Ubuntu Developers'],
        ['prometheus-node-exporter', '1.7.0-1ubuntu0.2', 'Ubuntu Developers'],
        ['betterdesk', '1.4.2', 'BetterDesk (demo)'],
    ],
    rpi: [
        ['raspi-config', '20240617', 'Raspberry Pi Ltd'],
        ['python3', '3.11.2-1+b1', 'Debian'],
        ['mosquitto', '2.0.11-1.2', 'Debian'],
        ['betterdesk', '1.3.9', 'BetterDesk (demo)'],
    ],
    winserver: [
        ['Microsoft Edge', '130.0.2849.68', 'Microsoft Corporation'],
        ['Windows Admin Center', '2410', 'Microsoft Corporation'],
        ['Microsoft SQL Server 2022 (64-bit)', '16.0.4135.4', 'Microsoft Corporation'],
        ['PowerShell 7-x64', '7.4.6', 'Microsoft Corporation'],
        ['BetterDesk', '1.4.1', 'BetterDesk (demo)'],
    ],
};

function buildInventory(dev) {
    const r = rng(seedFor('inv' + dev.id));
    const pick = (list) => list[Math.floor(r() * list.length)];
    const cls = osClass(dev.os);
    const gb = 1024 ** 3;
    const hw = {
        hostname: dev.hostname,
        os_name: dev.os,
        architecture: cls === 'mac' || cls === 'rpi' ? 'arm64' : 'x86_64',
        network_interfaces: [{
            name: cls === 'win' || cls === 'winserver' ? 'Ethernet' : (cls === 'mac' ? 'en0' : 'eth0'),
            mac: '02:00:5e:' + dev.id.slice(-6).match(/../g).join(':'),
            ip_addresses: [dev.ip],
        }],
    };
    let memGb;
    if (cls === 'win') {
        hw.os_version = /11/.test(dev.os) ? '23H2 (22631.4460)' : '22H2 (19045.5131)';
        hw.kernel = /11/.test(dev.os) ? '10.0.22631' : '10.0.19045';
        hw.cpu = { brand: pick(['Intel(R) Core(TM) i5-12500', 'Intel(R) Core(TM) i7-1365U', 'AMD Ryzen 7 PRO 7840U']), logical_cores: pick([8, 12, 16]) };
        memGb = pick([8, 16, 16, 32]);
        hw.disks = [{ device: 'C:', mount_point: 'C:\\', filesystem: 'NTFS', total_gb: pick([237.9, 475.8, 951.6]) }];
    } else if (cls === 'mac') {
        hw.os_version = dev.os.replace('macOS ', '');
        hw.kernel = 'Darwin 24.1.0';
        hw.cpu = { brand: pick(['Apple M3 Pro', 'Apple M2', 'Apple M1 Max']), logical_cores: pick([8, 10, 12]) };
        memGb = pick([16, 18, 32]);
        hw.disks = [{ device: 'disk3s1', mount_point: '/', filesystem: 'APFS', total_gb: pick([494.4, 994.7]) }];
    } else if (cls === 'rpi') {
        hw.os_version = 'Debian 12 (bookworm)';
        hw.kernel = '6.6.51+rpt-rpi-2712';
        hw.cpu = { brand: 'Broadcom BCM2712 (Cortex-A76)', logical_cores: 4 };
        memGb = 8;
        hw.disks = [{ device: '/dev/mmcblk0p2', mount_point: '/', filesystem: 'ext4', total_gb: 58.2 }];
    } else if (cls === 'winserver') {
        hw.os_version = '21H2 (20348.2849)';
        hw.kernel = '10.0.20348';
        hw.cpu = { brand: 'Intel(R) Xeon(R) Silver 4310 CPU @ 2.10GHz', logical_cores: 8 };
        memGb = 32;
        hw.disks = [
            { device: 'C:', mount_point: 'C:\\', filesystem: 'NTFS', total_gb: 126.4 },
            { device: 'D:', mount_point: 'D:\\', filesystem: 'NTFS', total_gb: 511.9 },
        ];
    } else {
        hw.os_version = dev.os.replace(/^\S+\s*/, '') || '6.1';
        hw.kernel = /24\.04/.test(dev.os) ? '6.8.0-48-generic' : (/22\.04/.test(dev.os) ? '5.15.0-125-generic' : '6.1.0-26-amd64');
        hw.cpu = { brand: pick(['Intel(R) Xeon(R) E-2388G CPU @ 3.20GHz', 'AMD EPYC 7313P 16-Core Processor']), logical_cores: pick([16, 32]) };
        memGb = pick([32, 64, 128]);
        hw.disks = [
            { device: '/dev/nvme0n1p2', mount_point: '/', filesystem: 'ext4', total_gb: 233.7 },
            { device: '/dev/md0', mount_point: '/srv', filesystem: 'xfs', total_gb: 3725.3 },
        ];
    }
    hw.disks.forEach((d) => { d.used_gb = Math.round(d.total_gb * (0.25 + r() * 0.7) * 10) / 10; });
    hw.cpu.usage_percent = Math.round((dev.online ? 4 + r() * 50 : 0) * 10) / 10;
    hw.memory = { total_bytes: memGb * gb, used_bytes: Math.round(memGb * gb * (0.3 + r() * 0.55)) };
    const apps = APPS[cls].map(([name, version, publisher]) => ({
        name, version, publisher,
        installed_at: new Date(NOW - Math.floor(30 + r() * 600) * DAY).toISOString().slice(0, 10),
    }));
    return { hardware: hw, software: { apps } };
}

const ACTIVITY_APPS = [
    ['Microsoft Outlook', 'Inbox - demo@example.invalid', 'communication'],
    ['Microsoft Teams', 'Chat | Demo Team', 'communication'],
    ['Google Chrome', 'Supplier portal - Google Chrome', 'browser'],
    ['Microsoft Edge', 'Intranet - Microsoft Edge', 'browser'],
    ['Microsoft Excel', 'Q4 budget.xlsx - Excel', 'productivity'],
    ['Microsoft Word', 'Offer draft.docx - Word', 'productivity'],
    ['Demo Accounting Suite', 'Ledger - November', 'productivity'],
    ['Visual Studio Code', 'deploy.yml - demo-infra', 'development'],
    ['Spotify', 'Focus playlist', 'media'],
    ['Windows Explorer', 'Documents', 'system'],
];

// ── DB helpers ──

function openDb(file) {
    const db = new Database(file, { fileMustExist: true });
    db.pragma('busy_timeout = 5000');
    return db;
}

function tableNames(db) {
    return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
}

function seedGoDb() {
    const db = openDb(GO_DB);
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
                ip: DEV[id].ip,
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
        PENDING.forEach((p) => {
            setConfig.run('pending_device_' + p.id, JSON.stringify({
                device_id: p.id,
                hostname: p.hostname,
                platform: p.platform,
                version: p.version,
                ip: p.ip,
                created_at: new Date(NOW - p.ageHours * HOUR).toISOString(),
            }));
        });
        // The device page only shows availability history when this is on.
        setConfig.run('availability_history_enabled', 'true');

        db.prepare("DELETE FROM help_requests WHERE device_id LIKE '9001000%'").run();
        const help = db.prepare(`INSERT INTO help_requests (device_id, hostname, message, status, handled_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`);
        HELP_REQUESTS.forEach(([id, host, msg, status, by], i) => {
            help.run(id, host, msg, status, by, iso(20 + i * 90), iso(10 + i * 60));
        });
    });
    tx();

    const tables = tableNames(db);
    seedChat(db, tables);
    seedInventory(db, tables);
    seedActivity(db, tables);
    seedHistory(db, tables);
    db.close();
    console.log(`Go DB: ${DEVICES.length} devices, ${PENDING.length} pending enrollments, ${HELP_REQUESTS.length} help requests`);
}

function seedChat(db, tables) {
    if (!tables.includes('chat_messages')) return;
    const allTexts = CHAT.flatMap((c) => c.messages.map((m) => m[2]));
    const convs = CHAT.map((c) => c.conv);
    const tx = db.transaction(() => {
        db.prepare(`DELETE FROM chat_messages WHERE conversation_id IN (${convs.map(() => '?').join(',')})
            AND text IN (${allTexts.map(() => '?').join(',')})`).run(...convs, ...allTexts);
        const ins = db.prepare(`INSERT INTO chat_messages (conversation_id, from_id, from_name, to_id, text, read, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`);
        for (const c of CHAT) {
            if (c.group && tables.includes('chat_groups')) {
                db.prepare(`INSERT INTO chat_groups (id, name, members, created_by, created_at) VALUES (?, ?, ?, 'admin', ?)
                    ON CONFLICT(id) DO UPDATE SET name = excluded.name, members = excluded.members`)
                    .run(c.conv, c.group.name, c.group.members, iso(4 * 24 * 60));
            }
            const sorted = [...c.messages].sort((a, b) => b[1] - a[1]);
            sorted.forEach(([from, minutesAgo, text], i) => {
                let fromId;
                let fromName;
                if (from === 'admin') {
                    fromId = 'operator';
                    fromName = 'admin';
                } else if (/^\d+$/.test(from)) {
                    fromId = from;
                    fromName = DEV[from].user || DEV[from].hostname;
                } else {
                    fromId = 'operator:' + from;
                    fromName = from;
                }
                // The newest incoming message stays unread.
                const isLast = i === sorted.length - 1;
                ins.run(c.conv, fromId, fromName, c.conv, text, isLast && from !== 'admin' ? 0 : 1, iso(minutesAgo));
            });
        }
    });
    tx();
    console.log(`Go DB: ${CHAT.length} chat conversations, ${allTexts.length} messages`);
}

function seedInventory(db, tables) {
    if (!tables.includes('device_inventory')) return;
    const inv = db.prepare(`INSERT INTO device_inventory (device_id, hardware, software, collected_at, received_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET hardware = excluded.hardware, software = excluded.software,
            collected_at = excluded.collected_at, received_at = excluded.received_at`);
    const tel = tables.includes('device_telemetry') ? db.prepare(`INSERT INTO device_telemetry
        (device_id, cpu_usage_percent, memory_used_bytes, memory_total_bytes, uptime_secs, timestamp, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET cpu_usage_percent = excluded.cpu_usage_percent,
            memory_used_bytes = excluded.memory_used_bytes, memory_total_bytes = excluded.memory_total_bytes,
            uptime_secs = excluded.uptime_secs, timestamp = excluded.timestamp, received_at = excluded.received_at`) : null;
    const tx = db.transaction(() => {
        for (const id of INVENTORY_DEVICES) {
            const dev = DEV[id];
            const { hardware, software } = buildInventory(dev);
            const seen = dev.online ? NOW - 12 * MIN : dev.lastOnlineMs - 5 * MIN;
            inv.run(id, JSON.stringify(hardware), JSON.stringify(software), new Date(seen).toISOString(), sqlTime(seen));
            if (tel) {
                const uptime = osClass(dev.os) === 'linux' ? 19 * 86400 + 3600 : 7 * 3600 + 1200;
                tel.run(id, hardware.cpu.usage_percent, hardware.memory.used_bytes, hardware.memory.total_bytes,
                    uptime, new Date(seen).toISOString(), sqlTime(seen));
            }
        }
    });
    tx();
    console.log(`Go DB: inventory and telemetry for ${INVENTORY_DEVICES.length} devices`);
}

function seedActivity(db, tables) {
    if (!tables.includes('activity_sessions') || !tables.includes('activity_summaries')) return;
    const ids = ACTIVITY_DEVICES;
    const sess = db.prepare(`INSERT INTO activity_sessions (device_id, app_name, window_title, category, started_at, ended_at, duration_secs, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const sum = db.prepare(`INSERT INTO activity_summaries (device_id, idle_seconds, session_count, total_active_secs, reported_at, received_at)
        VALUES (?, ?, ?, ?, ?, ?)`);
    let count = 0;
    const tx = db.transaction(() => {
        db.prepare(`DELETE FROM activity_sessions WHERE device_id IN (${ids.map(() => '?').join(',')})`).run(...ids);
        db.prepare(`DELETE FROM activity_summaries WHERE device_id IN (${ids.map(() => '?').join(',')})`).run(...ids);
        for (const id of ids) {
            const r = rng(seedFor('act' + id));
            for (let d = 6; d >= 0; d--) {
                const day = new Date(NOW - d * DAY);
                day.setUTCHours(0, 0, 0, 0);
                const weekend = [0, 6].includes(day.getUTCDay());
                if (weekend && r() < 0.7) continue;
                let t = day.getTime() + (7 * 60 + Math.floor(r() * 90)) * MIN;
                const end = day.getTime() + (weekend ? 11 : 16 + r() * 2) * HOUR;
                let active = 0;
                let n = 0;
                const dayStart = t;
                while (t < end && t < NOW - 10 * MIN) {
                    const [app, title, category] = ACTIVITY_APPS[Math.floor(r() * ACTIVITY_APPS.length)];
                    const secs = Math.floor((3 + r() * 45) * 60);
                    const stop = Math.min(t + secs * 1000, NOW - 5 * MIN);
                    const dur = Math.floor((stop - t) / 1000);
                    sess.run(id, app, title, category, new Date(t).toISOString(), new Date(stop).toISOString(), dur, sqlTime(stop));
                    active += dur;
                    n++;
                    count++;
                    t = stop + Math.floor(r() * 20) * MIN;
                }
                if (n > 0) {
                    const span = Math.floor((Math.min(t, NOW) - dayStart) / 1000);
                    sum.run(id, Math.max(0, span - active), n, active, new Date(dayStart).toISOString(), sqlTime(Math.min(t, NOW)));
                }
            }
        }
    });
    tx();
    console.log(`Go DB: ${count} activity sessions for ${ids.length} devices`);
}

// Status timeline for one device over the last 7 days: [[ms, status, source], ...]
function buildTimeline(id, kind) {
    const dev = DEV[id];
    const r = rng(seedFor('hist' + id));
    const start = NOW - 7 * DAY;
    const events = [];
    const goOffline = (t) => {
        events.push([t, 'DEGRADED', 'signal']);
        events.push([t + 30 * 1000, 'CRITICAL', 'signal']);
        events.push([t + 90 * 1000, 'OFFLINE', 'signal']);
    };
    if (kind === 'server') {
        events.push([start, 'ONLINE', 'signal']);
        const outages = 1 + Math.floor(r() * 2);
        for (let i = 0; i < outages; i++) {
            const t = start + (1 + r() * 5) * DAY;
            goOffline(t);
            events.push([t + (4 + r() * 25) * MIN, 'ONLINE', 'heartbeat']);
        }
    } else {
        for (let d = 7; d >= 0; d--) {
            const day = new Date(NOW - d * DAY);
            day.setUTCHours(0, 0, 0, 0);
            if ([0, 6].includes(day.getUTCDay())) continue;
            const on = day.getTime() + (6.5 + r() * 1.5) * HOUR;
            const off = day.getTime() + (15.5 + r() * 2.5) * HOUR;
            if (on < start) continue;
            events.push([on, 'ONLINE', 'signal']);
            if (r() < 0.25) {
                const blip = on + (2 + r() * 4) * HOUR;
                events.push([blip, 'DEGRADED', 'signal']);
                events.push([blip + 40 * 1000, 'ONLINE', 'heartbeat']);
            }
            goOffline(off);
        }
    }
    events.sort((a, b) => a[0] - b[0]);
    // Match the device's current state from the peers table.
    let out = events.filter((e) => e[0] < dev.lastOnlineMs - (dev.online ? 50 * MIN : 0));
    const last = out.length ? out[out.length - 1][1] : 'OFFLINE';
    if (dev.online && last !== 'ONLINE') out.push([NOW - 50 * MIN, 'ONLINE', 'signal']);
    const lastAt = out.length ? out[out.length - 1][0] : 0;
    if (!dev.online && last === 'OFFLINE' && lastAt < dev.lastOnlineMs - 2 * HOUR) {
        // Seen once more after the last office day, e.g. a weekend check-in.
        out.push([dev.lastOnlineMs - 40 * MIN, 'ONLINE', 'signal']);
    }
    if (!dev.online && (last !== 'OFFLINE' || lastAt < dev.lastOnlineMs - 2 * HOUR)) {
        out.push([dev.lastOnlineMs, 'DEGRADED', 'signal']);
        out.push([dev.lastOnlineMs + 30 * 1000, 'CRITICAL', 'signal']);
        out.push([dev.lastOnlineMs + 90 * 1000, 'OFFLINE', 'signal']);
    }
    out = out.filter((e) => e[0] < NOW - MIN);
    return out;
}

function statusAt(timeline, t) {
    let s = timeline.length ? (timeline[0][1] === 'ONLINE' ? 'OFFLINE' : 'ONLINE') : 'OFFLINE';
    for (const [ts, status] of timeline) {
        if (ts > t) break;
        s = status;
    }
    return s;
}

function seedHistory(db, tables) {
    const want = ['peer_availability_events', 'peer_connection_sessions', 'peer_metrics'];
    if (!want.every((t) => tables.includes(t))) {
        console.log('Go DB: history tables missing, skipped: ' + want.filter((t) => !tables.includes(t)).join(', '));
        return;
    }
    const ids = HISTORY_DEVICES.map(([id]) => id);
    const marks = ids.map(() => '?').join(',');
    const evIns = db.prepare(`INSERT INTO peer_availability_events (peer_id, from_status, to_status, source, created_at) VALUES (?, ?, ?, ?, ?)`);
    const mIns = db.prepare(`INSERT INTO peer_metrics (peer_id, cpu_usage, memory_usage, disk_usage, created_at) VALUES (?, ?, ?, ?, ?)`);
    const sIns = db.prepare(`INSERT INTO peer_connection_sessions
        (host_id, peer_id, peer_name, peer_ip, username, transport, relay_uuid, started_at, ended_at, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'signal')`);
    const counts = { events: 0, metrics: 0, sessions: 0 };
    const tx = db.transaction(() => {
        db.prepare(`DELETE FROM peer_availability_events WHERE peer_id IN (${marks})`).run(...ids);
        db.prepare(`DELETE FROM peer_metrics WHERE peer_id IN (${marks})`).run(...ids);
        db.prepare(`DELETE FROM peer_connection_sessions WHERE host_id IN (${marks})`).run(...ids);
        for (const [id, kind] of HISTORY_DEVICES) {
            const r = rng(seedFor('metrics' + id));
            const timeline = buildTimeline(id, kind);
            let prev = statusAt(timeline, timeline.length ? timeline[0][0] - 1 : NOW);
            for (const [t, status, source] of timeline) {
                evIns.run(id, prev, status, source, sqlTime(t));
                prev = status;
                counts.events++;
            }

            // Samples every 30 minutes while the device was up.
            const base = kind === 'server' ? 25 : 12;
            const disk = kind === 'server' ? 55 + r() * 20 : 35 + r() * 30;
            for (let t = NOW - 7 * DAY; t < NOW; t += 30 * MIN) {
                if (statusAt(timeline, t) !== 'ONLINE') continue;
                const hour = new Date(t).getUTCHours();
                const busy = hour >= 8 && hour <= 17 ? 1 : 0.4;
                const cpu = Math.min(99, base * busy + r() * 30 + (r() < 0.03 ? 45 : 0));
                const mem = Math.min(97, 40 + busy * 15 + r() * 20);
                const days = (t - (NOW - 7 * DAY)) / DAY;
                mIns.run(id, Math.round(cpu * 10) / 10, Math.round(mem * 10) / 10, Math.round((disk + days * 0.4) * 10) / 10, sqlTime(t));
                counts.metrics++;
            }

            // Remote sessions inside online windows.
            const n = 2 + Math.floor(r() * 3);
            for (let i = 0; i < n; i++) {
                let t = NOW - (0.3 + r() * 6.5) * DAY;
                for (let tries = 0; tries < 50 && statusAt(timeline, t) !== 'ONLINE'; tries++) t += HOUR;
                if (statusAt(timeline, t) !== 'ONLINE' || t > NOW - 30 * MIN) continue;
                const dur = (3 + r() * 70) * MIN;
                const web = r() < 0.4;
                const relay = r() < 0.5;
                sIns.run(
                    id,
                    web ? 'panel-web-remote' : '900100023',
                    web ? 'Web Remote' : 'demo-support-pixel',
                    web ? '127.0.0.1' : DEV['900100023'].ip,
                    web ? 'web_remote' : (r() < 0.5 ? 'demo_operator' : 'admin'),
                    relay ? 'request_relay' : 'punch_hole',
                    relay ? 'demo-relay-' + id + '-' + i : '',
                    sqlTime(t),
                    sqlTime(Math.min(t + dur, NOW - 5 * MIN)),
                );
                counts.sessions++;
            }
        }
    });
    tx();
    console.log(`Go DB history for ${ids.length} devices: ${counts.events} availability events, ${counts.metrics} metric samples, ${counts.sessions} connection sessions`);
}

function seedAuthDb() {
    const db = openDb(AUTH_DB);
    const tables = tableNames(db);
    const users = tables.includes('users')
        ? Object.fromEntries(db.prepare('SELECT id, username FROM users').all().map((u) => [u.username, u.id]))
        : {};

    if (tables.includes('pending_registrations')) {
        db.prepare("DELETE FROM pending_registrations WHERE device_id LIKE '9003%'").run();
        const reg = db.prepare(`INSERT INTO pending_registrations (device_id, hostname, platform, version, ip_address, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`);
        LAN_PENDING.forEach(([id, host, platform, version, ip, minutesAgo]) => reg.run(id, host, platform, version, ip, iso(minutesAgo), iso(minutesAgo)));
    }

    if (tables.includes('tickets')) seedTickets(db, tables);

    if (tables.includes('audit_log')) {
        const entries = [
            [1, 'device_ban', 'Banned 900100028 (Reported stolen)', '10.0.0.2', 30],
            [1, 'device_ban', 'Banned 900100029 (Unknown device, blocked)', '10.0.0.3', 230],
            [1, 'device_delete', 'Deleted 900100030', '10.0.0.4', 430],
            [1, 'settings_change', 'Changed relay server', '10.0.0.5', 630],
            [1, 'user_create', 'Created user demo_viewer', '10.0.0.6', 830],
            [1, 'remote_connect', 'Connected to 900100012', '10.0.0.7', 1030],
            [1, 'remote_connect', 'Connected to 900100005', '10.0.0.8', 1230],
            [1, 'folder_create', 'Created folder Lab', '10.0.0.9', 1430],
            [null, 'login_failed', 'Username: root; ip=203.0.113.45; ua=curl/8.5.0', '203.0.113.45', 6 * 60 + 3],
            [null, 'login_failed', 'Username: root; ip=203.0.113.45; ua=curl/8.5.0', '203.0.113.45', 6 * 60 + 2],
            [null, 'login_failed', 'Username: administrator; ip=198.51.100.7; ua=python-requests/2.32.3', '198.51.100.7', 14 * 60],
            [users.demo_viewer || null, 'login_failed', 'Username: demo_viewer; ip=10.0.2.41; ua=Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Firefox/132.0', '10.0.2.41', 3 * 60 + 2],
            [users.demo_viewer || null, 'login', 'User logged in; ip=10.0.2.41; ua=Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Firefox/132.0', '10.0.2.41', 3 * 60],
            [users.demo_operator || null, 'login', 'User logged in; ip=10.0.1.33; ua=Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/130.0', '10.0.1.33', 2 * 24 * 60],
            [users.demo_operator || null, 'logout', 'User logged out', '10.0.1.33', 2 * 24 * 60 - 470],
            [users.demo_serveradmin || null, 'login', 'User logged in; ip=10.0.3.12; ua=Mozilla/5.0 (X11; Linux x86_64) Firefox/132.0', '10.0.3.12', 30 * 60],
            [users.demo_serveradmin || null, 'session_expired', 'reason=idle', '10.0.3.12', 30 * 60 - 45],
        ];
        db.prepare(`DELETE FROM audit_log WHERE details IN (${entries.map(() => '?').join(',')})`).run(...entries.map((e) => e[2]));
        const log = db.prepare('INSERT INTO audit_log (user_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?)');
        entries.forEach(([uid, action, details, ip, minutesAgo]) => log.run(uid, action, details, ip, iso(minutesAgo)));
    }

    // Failed logins inside the 24 h window the console keeps. All older than
    // any lockout window and from TEST-NET addresses.
    if (tables.includes('login_attempts')) {
        const attempts = [
            ['root', '203.0.113.45', 0, 6 * 60 + 5], ['root', '203.0.113.45', 0, 6 * 60 + 4],
            ['root', '203.0.113.45', 0, 6 * 60 + 3], ['root', '203.0.113.45', 0, 6 * 60 + 2],
            ['administrator', '198.51.100.7', 0, 14 * 60 + 1], ['administrator', '198.51.100.7', 0, 14 * 60],
            ['demo_viewer', '10.0.2.41', 0, 3 * 60 + 2], ['demo_viewer', '10.0.2.41', 1, 3 * 60],
            ['demo_serveradmin', '10.0.3.12', 1, 30 * 60],
        ];
        db.prepare("DELETE FROM login_attempts WHERE ip_address IN ('203.0.113.45', '198.51.100.7', '10.0.2.41', '10.0.3.12')").run();
        const ins = db.prepare('INSERT INTO login_attempts (username, ip_address, success, created_at) VALUES (?, ?, ?, ?)');
        attempts.forEach(([u, ip, ok, m]) => ins.run(u, ip, ok, iso(m)));
    }

    // Ended sessions so the demo users' session history is not empty.
    if (tables.includes('panel_sessions')) {
        const cols = db.prepare('PRAGMA table_info(panel_sessions)').all().map((c) => c.name);
        if (cols.includes('is_active') && cols.includes('end_reason')) {
            const sessions = [
                ['demo_operator', '10.0.1.33', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', 2 * 24 * 60, 470, 'logout'],
                ['demo_operator', '10.0.1.33', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', 4 * 24 * 60, 300, 'idle'],
                ['demo_operator', '10.0.4.20', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', 5 * 24 * 60, 12, 'replaced'],
                ['demo_viewer', '10.0.2.41', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0', 3 * 24 * 60, 95, 'logout'],
                ['demo_serveradmin', '10.0.3.12', 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 30 * 60, 45, 'idle'],
            ];
            db.prepare("DELETE FROM panel_sessions WHERE sid LIKE 'demo-ended-%'").run();
            const ins = db.prepare(`INSERT INTO panel_sessions (sid, session_json, expires_at, updated_at, user_id, username, ip_address,
                user_agent, client_fingerprint, created_at, last_activity_at, ended_at, end_reason, is_active)
                VALUES (?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`);
            sessions.forEach(([username, ip, ua, startMin, lengthMin, reason], i) => {
                if (!users[username]) return;
                const created = NOW - startMin * MIN;
                const ended = created + lengthMin * MIN;
                ins.run('demo-ended-' + username + '-' + i, ended, sqlTime(ended), users[username], username, ip, ua,
                    'demo' + seedFor(username + i).toString(16), created, ended - 2 * MIN, ended, reason);
            });
        }
    }
    db.close();
    console.log(`Auth DB (${AUTH_DB}): ${LAN_PENDING.length} LAN registrations, ${TICKETS.length} tickets, audit, login and session history`);
}

function seedTickets(db, tables) {
    const titles = TICKETS.map((t) => t.title);
    const marks = titles.map(() => '?').join(',');
    const tx = db.transaction(() => {
        const old = db.prepare(`SELECT id FROM tickets WHERE title IN (${marks})`).all(...titles).map((r) => r.id);
        if (old.length) {
            const oldMarks = old.map(() => '?').join(',');
            if (tables.includes('ticket_comments')) db.prepare(`DELETE FROM ticket_comments WHERE ticket_id IN (${oldMarks})`).run(...old);
            db.prepare(`DELETE FROM tickets WHERE id IN (${oldMarks})`).run(...old);
        }
        const ins = db.prepare(`INSERT INTO tickets (title, description, status, priority, category, device_id, created_by,
            assigned_to, sla_due_at, resolved_at, closed_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const com = tables.includes('ticket_comments')
            ? db.prepare('INSERT INTO ticket_comments (ticket_id, author, body, is_internal, created_at) VALUES (?, ?, ?, ?, ?)')
            : null;
        // Oldest first, so ticket numbers follow creation order.
        [...TICKETS].sort((a, b) => b.ageH - a.ageH).forEach((t) => {
            const created = NOW - t.ageH * HOUR;
            const lastTouch = Math.min(
                t.closedAgoH != null ? t.closedAgoH : Infinity,
                t.resolvedAgoH != null ? t.resolvedAgoH : Infinity,
                ...(t.comments || []).map((c) => c[3]),
                t.ageH,
            );
            const info = ins.run(
                t.title, t.description, t.status, t.priority, t.category, t.device, t.createdBy, t.assignedTo,
                new Date(created + SLA_HOURS[t.priority] * HOUR).toISOString(),
                t.resolvedAgoH != null ? iso(t.resolvedAgoH * 60) : null,
                t.closedAgoH != null ? iso(t.closedAgoH * 60) : null,
                sqlTime(created), iso(lastTouch * 60),
            );
            if (com) {
                for (const [author, body, internal, agoH] of t.comments || []) {
                    com.run(info.lastInsertRowid, author, body, internal ? 1 : 0, iso(agoH * 60));
                }
            }
        });
    });
    tx();
}

// ── Console API ──

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

function loadCookieFile(file) {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const c of state.cookies || []) cookies[c.name] = c.value;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(method, url, body, { quiet = [] } = {}) {
    let res;
    // The API allows about 100 requests a minute per address; wait it out.
    for (let attempt = 0; ; attempt++) {
        res = await fetch(PANEL + url, {
            method,
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, cookie: cookieHeader() },
            body: body ? JSON.stringify(body) : undefined,
        });
        keepCookies(res);
        if (res.status !== 429 || attempt >= 8) break;
        const wait = Number(res.headers.get('ratelimit-reset')) || 15;
        await res.text();
        console.log(`  rate limited, waiting ${wait}s`);
        await sleep((wait + 1) * 1000);
    }
    let json = null;
    try { json = await res.json(); } catch (_) { /* not json */ }
    if (!res.ok && !quiet.includes(res.status)) {
        console.warn(`  ${method} ${url} -> ${res.status} ${json && (json.error || json.message) || ''}`);
    }
    return json || {};
}

async function signIn() {
    if (COOKIE_FILE) {
        loadCookieFile(COOKIE_FILE);
        const res = await fetch(PANEL + '/settings', { headers: { cookie: cookieHeader() }, redirect: 'manual' });
        if (res.status !== 200) throw new Error(`Session in ${COOKIE_FILE} is not valid (GET /settings -> ${res.status}). Refresh it and try again.`);
        await refreshCsrf();
        return;
    }
    await refreshCsrf();
    const login = await api('POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
    if (!login.success) throw new Error('Admin login failed');
    await refreshCsrf();
}

async function seedViaApi() {
    // Account creation has its own limit (three per five minutes), so only
    // create the ones that are missing.
    const have = (((await api('GET', '/api/users')).data || {}).users || []).map((u) => u.username);
    for (const u of USERS.filter((x) => !have.includes(x.username))) {
        await api('POST', '/api/users', { ...u, password: 'Demo-Password-' + u.username + '-42!' }, { quiet: [400, 409] });
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

    for (const [id, , , , , tags, folder, , extra = {}] of DEVICES) {
        if (extra.deleted) continue;
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

async function seedOrganizations() {
    const userList = ((await api('GET', '/api/users')).data || {}).users || [];
    const userIds = Object.fromEntries(userList.map((u) => [u.username, u.id]));
    const listed = (await api('GET', '/api/panel/org')).organizations || [];
    const orgIds = {};
    for (const o of ORGS) {
        let org = listed.find((x) => x.slug === o.slug);
        if (!org) org = await api('POST', '/api/panel/org', { name: o.name, slug: o.slug });
        if (!org || !org.id) {
            console.warn(`  could not create organization ${o.slug}`);
            continue;
        }
        orgIds[o.key] = org.id;
        const base = `/api/panel/org/${org.id}`;

        for (const [username, role] of o.members) {
            if (userIds[username]) await api('POST', `${base}/members`, { user_id: Number(userIds[username]), role }, { quiet: [409] });
        }
        for (const u of o.localUsers) {
            await api('POST', `${base}/users`, { ...u, password: 'Demo-Password-' + u.username + '-42!' }, { quiet: [409] });
        }
        const orgUsersRes = await api('GET', `${base}/users`);
        const orgUsers = Array.isArray(orgUsersRes) ? orgUsersRes : (orgUsersRes.users || []);
        const orgUserId = (name) => (orgUsers.find((u) => u.username === name) || {}).id || '';

        for (const [deviceId, department, location, building, assignee] of o.devices) {
            await api('POST', `${base}/devices`, {
                device_id: deviceId, department, location, building,
                assigned_user_id: assignee ? orgUserId(assignee) : '',
                tags: DEV[deviceId].tags,
            });
        }
        for (const [key, value] of Object.entries(o.settings)) {
            await api('PUT', `${base}/settings`, { key, value });
        }
        for (const [category, body] of Object.entries(o.policies)) {
            await api('PUT', `/api/panel/policies/${org.id}/${category}`, body);
        }

        // Put the org's devices into the default group created with the org.
        const linked = (await api('GET', `${base}/device-groups`)).device_groups || [];
        const group = linked.find((g) => g.name === o.name) || linked[0];
        if (group) {
            orgIds[o.key + ':group'] = group.guid;
            for (const [deviceId] of o.devices) {
                await api('PUT', `/api/devices/${deviceId}/groups`, { groupGuids: [group.guid] });
            }
        }
    }
    console.log('API: organizations ' + ORGS.map((o) => `${o.slug}=${orgIds[o.key] || '?'}`).join(', '));
    return orgIds;
}

async function seedBilling(orgIds) {
    const pkgList = (await api('GET', '/api/panel/billing/packages')).packages || [];
    const pkgs = {};
    for (const p of PACKAGES) {
        const { key, ...body } = p;
        let pkg = pkgList.find((x) => x.name === p.name);
        if (!pkg) pkg = await api('POST', '/api/panel/billing/packages', body);
        pkgs[key] = pkg;
    }

    const contractList = (await api('GET', '/api/panel/billing/contracts')).contracts || [];
    const contracts = {};
    for (const c of CONTRACTS) {
        const targetKey = c.target === 'org' ? orgIds[c.org] : orgIds[c.org + ':group'];
        const pkg = pkgs[c.pkg];
        if (!targetKey || !pkg || !pkg.id) continue;
        // Drop an assignment from an earlier run that used the other target type.
        const otherKey = c.target === 'org' ? orgIds[c.org + ':group'] : orgIds[c.org];
        for (const stale of contractList.filter((x) => x.target_type !== c.target && x.target_key === otherKey)) {
            await api('DELETE', `/api/panel/billing/contracts/${stale.id}`);
        }
        let contract = contractList.find((x) => x.target_type === c.target && x.target_key === targetKey);
        if (!contract) {
            contract = await api('POST', '/api/panel/billing/contracts', {
                target_type: c.target, target_key: targetKey, package_id: pkg.id, status: c.status,
                currency: pkg.currency, hourly_rate: 0,
            });
        }
        if (contract && contract.id) contracts[c.org] = { ...contract, pkg };
    }
    console.log(`API: ${Object.keys(pkgs).length} billing packages, ${Object.keys(contracts).length} contracts`);
    return contracts;
}

// Sessions and work reports have no create API (the relay opens them), so
// they go straight into the Go database once the contracts exist.
function seedBillingSessions(orgIds, contracts) {
    const db = openDb(GO_DB);
    const tables = tableNames(db);
    if (!tables.includes('billing_sessions')) {
        db.close();
        return;
    }
    const period = new Date(NOW).toISOString().slice(0, 7);
    const used = {};
    let count = 0;
    const tx = db.transaction(() => {
        const old = db.prepare("SELECT id FROM billing_sessions WHERE id LIKE 'demo-bs-%'").all().map((r) => r.id);
        if (old.length) {
            const m = old.map(() => '?').join(',');
            if (tables.includes('billing_work_reports')) db.prepare(`DELETE FROM billing_work_reports WHERE session_id IN (${m})`).run(...old);
            if (tables.includes('billing_session_ledger')) db.prepare(`DELETE FROM billing_session_ledger WHERE session_id IN (${m})`).run(...old);
            db.prepare(`DELETE FROM billing_sessions WHERE id IN (${m})`).run(...old);
        }
        const ins = db.prepare(`INSERT INTO billing_sessions (id, org_id, contract_id, operator_id, operator_name, device_id, device_name,
            relay_uuid, transport, status, billing_phase, started_at, ended_at, raw_seconds, billed_minutes, included_minutes_used,
            overage_minutes, amount_included, amount_overage, currency, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'rustdesk', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`);
        const rep = tables.includes('billing_work_reports')
            ? db.prepare('INSERT INTO billing_work_reports (session_id, operator_id, summary, category, ticket_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            : null;
        const led = tables.includes('billing_session_ledger')
            ? db.prepare('INSERT INTO billing_session_ledger (session_id, event_type, details, created_at) VALUES (?, ?, ?, ?)')
            : null;

        [...BILLING_SESSIONS].sort((a, b) => b[3] - a[3]).forEach(([org, deviceId, operator, startedAgo, rawMin, status, report], i) => {
            const contract = contracts[org];
            if (!contract || !orgIds[org]) return;
            const pkg = contract.pkg;
            const id = 'demo-bs-' + String(i + 1).padStart(3, '0');
            const started = NOW - startedAgo * MIN;
            const ended = rawMin == null ? null : started + rawMin * MIN;
            const rounding = pkg.rounding_minutes || 10;
            const billed = rawMin == null ? 0 : Math.ceil(rawMin / rounding) * rounding;
            const left = Math.max(0, pkg.included_minutes - (used[org] || 0));
            const included = Math.min(billed, left);
            const overage = billed - included;
            used[org] = (used[org] || 0) + included;
            const amount = Math.round((overage / 60) * pkg.overage_rate * 100) / 100;
            const relay = 'demo-relay-bs-' + (i + 1);
            ins.run(id, orgIds[org], contract.id, operator, operator, deviceId, DEV[deviceId].hostname, relay,
                // '' instead of NULL for the running session: the Go session
                // list scans ended_at into a string and fails on NULL.
                status, overage > 0 ? 'overage' : 'included', sqlTime(started), ended ? sqlTime(ended) : '',
                rawMin == null ? 0 : rawMin * 60 + 17, billed, included, overage, amount, pkg.currency,
                sqlTime(started), sqlTime(ended || started));
            if (led) {
                led.run(id, 'session_start', relay, sqlTime(started));
                if (overage > 0 && ended) led.run(id, 'phase_change', 'included -> overage', sqlTime(ended - overage * MIN));
                if (ended) led.run(id, 'session_end', `billed=${billed}`, sqlTime(ended));
            }
            if (rep && report && ended) rep.run(id, operator, report[0], report[1], report[2], sqlTime(ended + 6 * MIN));
            count++;
        });

        // Keep the contract counters in line with the sessions above.
        for (const [org, contract] of Object.entries(contracts)) {
            const pkg = contract.pkg;
            const inc = used[org] || 0;
            const over = db.prepare("SELECT COALESCE(SUM(overage_minutes), 0) m, COALESCE(SUM(amount_overage), 0) a FROM billing_sessions WHERE contract_id = ? AND id LIKE 'demo-bs-%'").get(contract.id);
            db.prepare("UPDATE billing_contracts SET remaining_minutes = ?, current_period_ym = ?, updated_at = datetime('now') WHERE id = ?")
                .run(Math.max(0, pkg.included_minutes - inc), period, contract.id);
            if (tables.includes('billing_period_totals')) {
                db.prepare(`INSERT INTO billing_period_totals (contract_id, package_id, period_ym, timezone, included_minutes_used,
                    overage_minutes, amount_overage, included_limit_snapshot, updated_at)
                    VALUES (?, ?, ?, 'UTC', ?, ?, ?, ?, datetime('now'))
                    ON CONFLICT(contract_id, period_ym) DO UPDATE SET included_minutes_used = excluded.included_minutes_used,
                        overage_minutes = excluded.overage_minutes, amount_overage = excluded.amount_overage,
                        included_limit_snapshot = excluded.included_limit_snapshot, updated_at = excluded.updated_at`)
                    .run(contract.id, pkg.id, period, inc, over.m, over.a, pkg.included_minutes);
            }
        }
    });
    tx();
    db.close();
    console.log(`Go DB: ${count} billing sessions with work reports`);
}

async function seedSavedReports() {
    const saved = await api('GET', '/api/reports/saved');
    const list = Array.isArray(saved) ? saved : (saved.reports || saved.data || []);
    const wanted = [
        ['devices', 'Demo weekly device summary'],
        ['tickets', 'Demo open tickets'],
        ['inventory', 'Demo hardware inventory'],
        ['activity', 'Demo app usage this week'],
    ];
    let n = 0;
    for (const [type, title] of wanted) {
        if (list.some((r) => r.title === title)) continue;
        await api('POST', '/api/reports/save', { type, title });
        n++;
    }
    console.log(`API: ${n} saved reports added (${wanted.length - n} already there)`);
}

(async () => {
    seedGoDb();
    seedAuthDb();
    await signIn();
    await seedViaApi();
    const orgIds = await seedOrganizations();
    const contracts = await seedBilling(orgIds);
    seedBillingSessions(orgIds, contracts);
    await seedSavedReports();
    const online = DEVICES.filter((d) => d[7] && !(d[8] && (d[8].banned || d[8].deleted))).map((d) => d[0]);
    fs.writeFileSync(ONLINE_FILE, JSON.stringify(online));
    console.log(`${online.length} device IDs for fake-heartbeats.js written to ${ONLINE_FILE}`);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
