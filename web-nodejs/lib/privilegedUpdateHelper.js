'use strict';

const { execFileSync } = require('child_process');

const PRIVILEGED_UPDATE_HELPER_PATH = '/usr/local/libexec/betterdesk/betterdesk-privileged-update.js';
const ALLOWED_SERVICES = new Set(['betterdesk-console', 'betterdesk-server']);

/**
 * Broker protocol version this panel expects (audit H10, 2026-11-13).
 *
 * The deployed broker is root-owned and updated independently of the panel, so
 * the panel must detect a stale copy instead of assuming it supports the same
 * actions. Version 2 is the first one that reports its version and whose
 * managed-key manifest no longer contains database/session/update secrets.
 */
const BROKER_PROTOCOL_VERSION = 2;

function isRoot() {
    return typeof process.getuid === 'function' && process.getuid() === 0;
}

function invokePrivilegedUpdate(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Invalid privileged update request');
    }

    const command = isRoot() ? process.execPath : 'sudo';
    const args = isRoot()
        ? [PRIVILEGED_UPDATE_HELPER_PATH]
        : ['-n', process.execPath, PRIVILEGED_UPDATE_HELPER_PATH];

    // The command is fixed; the helper validates the JSON action and service.
    const output = execFileSync(command, args, {
        input: JSON.stringify(payload),
        encoding: 'utf8',
        timeout: 35_000,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const result = JSON.parse(String(output || '').trim() || '{}');
    if (!result.success) {
        throw new Error(result.error || 'Privileged update failed');
    }
    return result;
}

function canUsePrivilegedUpdate() {
    try {
        if (isRoot()) return true;
        const output = execFileSync(
            'sudo',
            ['-n', process.execPath, PRIVILEGED_UPDATE_HELPER_PATH],
            {
                input: JSON.stringify({ action: 'check' }),
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe'],
            },
        );
        return JSON.parse(String(output || '{}')).success === true;
    } catch (_) {
        return false;
    }
}

/**
 * Read the installed broker's protocol version.
 *
 * @returns {{ available: boolean, version: number|null, stale: boolean }}
 *   `stale` is true when the broker answers but predates
 *   BROKER_PROTOCOL_VERSION (it may still expose actions we no longer trust).
 */
function getBrokerVersion() {
    try {
        const command = isRoot() ? process.execPath : 'sudo';
        const args = isRoot()
            ? [PRIVILEGED_UPDATE_HELPER_PATH, '--check']
            : ['-n', process.execPath, PRIVILEGED_UPDATE_HELPER_PATH, '--check'];
        const output = execFileSync(command, args, {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const parsed = JSON.parse(String(output || '{}').trim() || '{}');
        if (!parsed || parsed.success !== true) {
            return { available: false, version: null, stale: false };
        }
        const version = Number.isInteger(parsed.version) ? parsed.version : null;
        return {
            available: true,
            version,
            stale: version === null || version < BROKER_PROTOCOL_VERSION,
        };
    } catch (_) {
        return { available: false, version: null, stale: false };
    }
}

function restartService(service) {
    if (!ALLOWED_SERVICES.has(service)) {
        throw new Error('Service is not allowlisted');
    }
    return invokePrivilegedUpdate({ action: 'restart', service });
}

function daemonReload() {
    return invokePrivilegedUpdate({ action: 'daemon_reload' });
}

module.exports = {
    PRIVILEGED_UPDATE_HELPER_PATH,
    ALLOWED_SERVICES,
    BROKER_PROTOCOL_VERSION,
    canUsePrivilegedUpdate,
    daemonReload,
    getBrokerVersion,
    invokePrivilegedUpdate,
    isRoot,
    restartService,
};
