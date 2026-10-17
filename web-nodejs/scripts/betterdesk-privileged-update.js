#!/usr/bin/env node
'use strict';

/**
 * Root-owned Linux update broker.
 *
 * This file is copied to /usr/local/libexec/betterdesk by the root installer.
 * The panel must never execute a JavaScript file from its writable application
 * directory as root. Only the fixed, argument-validated service operations
 * below are exposed through sudo.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ALLOWED_SERVICES = new Set(['betterdesk-console', 'betterdesk-server']);
const SYSTEMCTL_PATHS = ['/usr/bin/systemctl', '/bin/systemctl'];
const MAX_PAYLOAD_BYTES = 16 * 1024;

/** Connection-mode drop-in written by write_connection_env (panel Settings). */
const CONNECTION_DROPIN_DIR = '/etc/systemd/system/betterdesk-server.service.d';
const CONNECTION_DROPIN_PATH = path.join(CONNECTION_DROPIN_DIR, '50-betterdesk-connection.conf');

const CONNECTION_ENV_KEYS = new Set([
    'P2P_FIRST',
    'ALWAYS_USE_RELAY',
    'P2P_FALLBACK_MS',
    'SAME_NAT_RELAY',
    'ALLOW_SHARED_NAT_INITIATOR',
    'LOGGED_IN_ONLY_INITIATOR',
    'OPERATOR_ONLY_OUTBOUND',
]);
const MANAGEMENT_MANIFEST_PATH = path.join(__dirname, 'management-capabilities.json');
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;
const SECRET_KEY_RE = /(PASSWORD|PASS|SECRET|TOKEN|API_KEY|PRIVATE_KEY|DATABASE_URL)/i;
const BOOLEAN_VALUES = new Set(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off', 'y', 'n']);
const PORT_KEYS = new Set(['PORT', 'HTTPS_PORT', 'SMTP_PORT', 'API_PORT', 'GO_API_PORT', 'CLIENT_API_PORT', 'CHAT_PORT']);
const PATH_KEYS = new Set([
    'RUSTDESK_DIR', 'KEYS_PATH', 'PUB_KEY_PATH', 'API_KEY_PATH', 'DB_PATH',
    'DATA_DIR', 'SSL_CERT_PATH', 'SSL_KEY_PATH', 'SSL_CA_PATH',
]);
const MANAGED_ENV_PATHS = new Set([
    '/opt/BetterDeskConsole/.env',
    '/opt/betterdesk/.env',
    '/var/lib/betterdesk/.env',
]);

function isRoot() {
    return typeof process.getuid === 'function' && process.getuid() === 0;
}

function systemctlPath() {
    return SYSTEMCTL_PATHS.find((candidate) => fs.existsSync(candidate)) || '/usr/bin/systemctl';
}

function runSystemctl(args) {
    return execFileSync(systemctlPath(), args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
        env: {
            PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
            LANG: 'C',
        },
    });
}

function readPayload() {
    const data = fs.readFileSync(0);
    if (data.length > MAX_PAYLOAD_BYTES) {
        throw new Error('Privileged update payload is too large');
    }
    const parsed = JSON.parse(data.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid privileged update payload');
    }
    return parsed;
}

function validateConnectionEnvValue(key, value) {
    const raw = String(value == null ? '' : value).trim();
    if (!CONNECTION_ENV_KEYS.has(key)) {
        throw new Error(`Connection env key is not allowlisted: ${key}`);
    }
    if (key === 'P2P_FALLBACK_MS') {
        if (!/^\d{1,8}$/.test(raw)) {
            throw new Error('P2P_FALLBACK_MS must be an integer');
        }
        return raw;
    }
    const upper = raw.toUpperCase();
    if (upper !== 'Y' && upper !== 'N') {
        throw new Error(`${key} must be Y or N`);
    }
    return upper;
}

/**
 * Persist panel connection-mode flags as a systemd drop-in (does not rewrite
 * the main unit file, which is root-owned and may contain secrets in ExecStart).
 */
function writeConnectionEnv(vars) {
    if (!vars || typeof vars !== 'object' || Array.isArray(vars)) {
        throw new Error('write_connection_env requires a vars object');
    }
    const lines = ['[Service]'];
    for (const key of CONNECTION_ENV_KEYS) {
        if (vars[key] === undefined || vars[key] === null || vars[key] === '') continue;
        const safe = validateConnectionEnvValue(key, vars[key]);
        lines.push(`Environment=${key}=${safe}`);
    }
    if (lines.length === 1) {
        throw new Error('write_connection_env requires at least one managed var');
    }
    lines.push('');
    fs.mkdirSync(CONNECTION_DROPIN_DIR, { recursive: true, mode: 0o755 });
    const body = lines.join('\n');
    const tmp = `${CONNECTION_DROPIN_PATH}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o644 });
    fs.renameSync(tmp, CONNECTION_DROPIN_PATH);
    return { path: CONNECTION_DROPIN_PATH, keys: lines.length - 2 };
}

function readManagementManifest() {
    try {
        const parsed = JSON.parse(fs.readFileSync(MANAGEMENT_MANIFEST_PATH, 'utf8'));
        return parsed && Array.isArray(parsed.environmentKeys)
            ? new Set(parsed.environmentKeys)
            : new Set();
    } catch (_) {
        return new Set();
    }
}

function validateManagedEnvPath(filePath) {
    const normalized = path.resolve(String(filePath || ''));
    if (!MANAGED_ENV_PATHS.has(normalized)) {
        throw new Error('Environment path is not allowlisted');
    }
    return normalized;
}

function validateManagedEnvValue(key, value) {
    if (!ENV_KEY_RE.test(key) || !readManagementManifest().has(key)) {
        throw new Error(`Environment key is not allowlisted: ${key}`);
    }
    const raw = String(value == null ? '' : value);
    if (/[\0\r\n]/.test(raw)) throw new Error(`Invalid control character in ${key}`);
    if (PATH_KEYS.has(key)) {
        const normalized = path.resolve(raw);
        const allowedRoots = ['/opt/BetterDeskConsole', '/opt/betterdesk', '/var/lib/betterdesk', '/etc/letsencrypt'];
        if (!path.isAbsolute(raw) || !allowedRoots.some((root) =>
            normalized === root || normalized.startsWith(`${root}${path.sep}`))) {
            throw new Error(`Path is outside BetterDesk roots for ${key}`);
        }
    }
    if (PORT_KEYS.has(key)
        && (!/^\d{1,5}$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535)) {
        throw new Error(`Invalid port for ${key}`);
    }
    if (key === 'DB_TYPE' && !new Set(['sqlite', 'postgres', 'postgresql']).has(raw)) {
        throw new Error(`Invalid value for ${key}`);
    }
    if (key === 'UPDATE_GITHUB_BRANCH' && !new Set(['main', 'dev']).has(raw)) {
        throw new Error(`Invalid value for ${key}`);
    }
    if (['HTTPS_ENABLED', 'HTTP_REDIRECT_HTTPS', 'TRUST_PROXY', 'API_ENABLED'].includes(key)
        && !BOOLEAN_VALUES.has(raw.toLowerCase())) {
        throw new Error(`Invalid boolean for ${key}`);
    }
    return raw;
}

function writeManagedEnv(payload) {
    const envPath = validateManagedEnvPath(payload.path);
    if (!payload.vars || typeof payload.vars !== 'object' || Array.isArray(payload.vars)) {
        throw new Error('write_env requires a vars object');
    }
    const vars = {};
    for (const [key, value] of Object.entries(payload.vars)) {
        vars[key] = validateManagedEnvValue(key, value);
    }
    if (!Object.keys(vars).length) throw new Error('write_env requires at least one key');
    const original = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const lines = original ? original.split(/\r?\n/) : [];
    const seen = new Set();
    const output = lines.map((line) => {
        const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/);
        if (!match || !Object.prototype.hasOwnProperty.call(vars, match[1])) return line;
        seen.add(match[1]);
        return `${match[1]}=${vars[match[1]]}`;
    });
    for (const [key, value] of Object.entries(vars)) {
        if (!seen.has(key)) output.push(`${key}=${value}`);
    }
    const backupPath = `${envPath}.bak.${Date.now()}`;
    fs.writeFileSync(backupPath, original, { mode: 0o600 });
    const tmp = `${envPath}.betterdesk.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${output.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
    fs.renameSync(tmp, envPath);
    try { fs.chmodSync(envPath, 0o600); } catch (_) { /* root-owned file */ }
    return {
        path: envPath,
        backupPath,
        keys: Object.keys(vars),
        values: Object.fromEntries(Object.keys(vars).map((key) => [
            key,
            SECRET_KEY_RE.test(key) ? '********' : vars[key],
        ])),
    };
}

function restoreManagedEnv(payload) {
    const envPath = validateManagedEnvPath(payload.path);
    const backupPath = path.resolve(String(payload.backupPath || ''));
    if (!backupPath.startsWith(`${envPath}.bak.`) || !fs.existsSync(backupPath)) {
        throw new Error('Environment backup path is not allowlisted');
    }
    const tmp = `${envPath}.betterdesk-rollback.${process.pid}.tmp`;
    fs.copyFileSync(backupPath, tmp);
    fs.renameSync(tmp, envPath);
    try { fs.chmodSync(envPath, 0o600); } catch (_) { /* root-owned file */ }
    return { path: envPath, restoredFrom: backupPath };
}

function handle(payload) {
    if (!isRoot()) {
        throw new Error('Privileged update broker must run as root');
    }

    switch (payload.action) {
        case 'check':
            return { success: true, action: 'check' };
        case 'daemon_reload':
            runSystemctl(['daemon-reload']);
            return { success: true, action: payload.action };
        case 'restart':
            if (!ALLOWED_SERVICES.has(payload.service)) {
                throw new Error('Service is not allowlisted');
            }
            runSystemctl(['restart', payload.service]);
            return { success: true, action: payload.action, service: payload.service };
        case 'write_connection_env': {
            const written = writeConnectionEnv(payload.vars);
            return { success: true, action: payload.action, ...written };
        }
        case 'write_env': {
            const written = writeManagedEnv(payload);
            return { success: true, action: payload.action, ...written };
        }
        case 'restore_env': {
            const restored = restoreManagedEnv(payload);
            return { success: true, action: payload.action, ...restored };
        }
        default:
            throw new Error('Privileged update action is not allowlisted');
    }
}

try {
    if (process.argv.includes('--check')) {
        process.stdout.write(JSON.stringify(handle({ action: 'check' })));
    } else {
        process.stdout.write(JSON.stringify(handle(readPayload())));
    }
} catch (err) {
    process.stdout.write(JSON.stringify({
        success: false,
        error: err.message || String(err),
    }));
    process.exitCode = 1;
}
