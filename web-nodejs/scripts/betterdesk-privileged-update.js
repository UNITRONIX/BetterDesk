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
