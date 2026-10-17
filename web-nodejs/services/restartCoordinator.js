'use strict';

/**
 * Coordinates settings changes that need a BetterDesk service restart.
 *
 * A transaction is deliberately persisted outside the database. The console
 * process may be unavailable while the transaction is being completed, so the
 * browser must be able to read a small, non-sensitive status record when the
 * process comes back.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');

const STATE_PATH = path.join(config.dataDir, '.restart-transaction.json');
const BOOT_ID = crypto.randomBytes(16).toString('hex');
const MAX_CHANGES = 32;
const RESTART_TOKEN_BYTES = 24;

function ensureDataDir() {
    fs.mkdirSync(config.dataDir, { recursive: true });
}

function readState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.warn(`[RESTART] Could not read transaction state: ${err.message}`);
        }
        return null;
    }
}

function writeState(state) {
    ensureDataDir();
    const tmp = `${STATE_PATH}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, STATE_PATH);
}

function removeState() {
    try { fs.unlinkSync(STATE_PATH); } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }
}

function safeUserId(req) {
    const value = req?.session?.userId;
    return value === undefined || value === null ? null : String(value);
}

function publicState(state) {
    if (!state) return null;
    return {
        id: state.id,
        phase: state.phase,
        status: state.phase,
        ready: state.phase === 'ready',
        failed: state.phase === 'failed',
        startedAt: state.startedAt || null,
        updatedAt: state.updatedAt || null,
        changes: (state.changes || []).map((change) => ({
            key: change.key,
            label: change.label,
        })),
        error: state.error || null,
    };
}

function operatorState(state, req) {
    if (!state) return null;
    const userId = safeUserId(req);
    if (state.userId !== userId) return null;
    return publicState(state);
}

function touch(state) {
    state.updatedAt = new Date().toISOString();
    writeState(state);
    return state;
}

function getPending(req) {
    const state = readState();
    if (!state || !['pending', 'restarting', 'ready', 'failed'].includes(state.phase)) return null;
    return operatorState(state, req);
}

function getRawForOperator(req, id) {
    const state = readState();
    if (!state || state.id !== id || state.userId !== safeUserId(req)) {
        const err = new Error('restart_transaction_not_found');
        err.statusCode = 404;
        throw err;
    }
    return state;
}

function assertChange(change) {
    if (!change || typeof change !== 'object' || typeof change.key !== 'string') {
        throw new Error('invalid_restart_change');
    }
    if (typeof change.rollback !== 'object' || !change.rollback) {
        throw new Error('restart_change_not_reversible');
    }
}

/**
 * Add a reversible saved setting change to the operator's pending transaction.
 * `rollback` contains a small operation descriptor, never a secret value.
 */
function registerChange(req, change) {
    assertChange(change);
    const userId = safeUserId(req);
    if (!userId) throw new Error('restart_auth_required');

    let state = readState();
    if (state && state.phase !== 'pending') {
        state = null;
    }
    if (state && state.userId !== userId) {
        const err = new Error('restart_transaction_owned');
        err.statusCode = 409;
        throw err;
    }
    if (!state) {
        state = {
            id: crypto.randomUUID(),
            userId,
            phase: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            changes: [],
        };
    }

    const existing = state.changes.find((item) => item.key === change.key);
    const next = {
        key: change.key,
        label: change.label || change.key,
        rollback: change.rollback,
    };
    if (existing) {
        // Keep the first snapshot so cancel always returns to the pre-edit
        // value, while replacing the display label with the latest one.
        existing.label = next.label;
    } else {
        if (state.changes.length >= MAX_CHANGES) throw new Error('restart_too_many_changes');
        state.changes.push(next);
    }
    touch(state);
    return publicState(state);
}

async function rollbackChange(change) {
    const descriptor = change.rollback || {};
    switch (descriptor.type) {
    case 'connection-mode': {
        const service = require('./serverConnectionConfigService');
        await service.setConnectionMode(descriptor.settings);
        return;
    }
    case 'advanced-file': {
        const service = require('./advancedConfigService');
        await service.restoreBackup(descriptor.fileId, descriptor.backupPath);
        return;
    }
    case 'billing-clock': {
        const service = require('./billingClockConfigService');
        service.restoreClockSettings(descriptor.settings);
        return;
    }
    case 'go-config': {
        const api = require('./betterdeskApi');
        const result = await api.setConfig(descriptor.key, descriptor.value);
        if (!result.success) throw new Error(result.error || 'go_config_rollback_failed');
        return;
    }
    case 'env-config': {
        const management = require('../lib/managementCapabilities');
        try {
            management.restoreEnvBackup(descriptor.backupPath, descriptor.options || {});
        } catch (err) {
            const helper = require('../lib/privilegedUpdateHelper');
            if (!helper.canUsePrivilegedUpdate()) throw err;
            helper.invokePrivilegedUpdate({
                action: 'restore_env',
                path: descriptor.options?.envPath,
                backupPath: descriptor.backupPath,
            });
        }
        return;
    }
    default:
        throw new Error('unknown_restart_rollback');
    }
}

async function cancel(req, id) {
    const state = getRawForOperator(req, id);
    if (state.phase !== 'pending') {
        const err = new Error('restart_transaction_not_cancelable');
        err.statusCode = 409;
        throw err;
    }
    const failures = [];
    for (const change of [...state.changes].reverse()) {
        try {
            await rollbackChange(change);
        } catch (err) {
            failures.push({ key: change.key, error: err.message });
        }
    }
    if (failures.length) {
        state.phase = 'failed';
        state.error = 'rollback_failed';
        state.rollbackFailures = failures;
        touch(state);
        const err = new Error('restart_rollback_failed');
        err.statusCode = 500;
        err.details = failures;
        throw err;
    }
    removeState();
    return { canceled: true, id };
}

function restartResultFailed(result) {
    return (result?.daemonReload && result.daemonReload.success === false)
        || (result?.restarts || []).some((item) => item.success === false);
}

async function rollbackStateChanges(state) {
    const failures = [];
    for (const change of [...(state.changes || [])].reverse()) {
        try {
            await rollbackChange(change);
        } catch (err) {
            failures.push({ key: change.key, error: err.message });
        }
    }
    return failures;
}

async function confirm(req, id) {
    const state = getRawForOperator(req, id);
    if (state.phase !== 'pending' && state.phase !== 'failed') {
        const err = new Error('restart_transaction_not_pending');
        err.statusCode = 409;
        throw err;
    }
    state.phase = 'restarting';
    state.startedAt = new Date().toISOString();
    state.bootId = BOOT_ID;
    state.token = crypto.randomBytes(RESTART_TOKEN_BYTES).toString('hex');
    state.error = null;
    touch(state);

    try {
        // Lazy imports avoid a circular dependency with the connection mode
        // service, which itself uses updateService.
        const serverConnection = require('./serverConnectionConfigService');
        const restart = serverConnection.restartServer();
        state.restart = restart;
        if (restartResultFailed(restart)) {
            state.rollbackFailures = await rollbackStateChanges(state);
            state.phase = 'failed';
            state.error = state.rollbackFailures.length
                ? 'service_restart_failed_rollback_failed'
                : 'service_restart_failed_rolled_back';
            touch(state);
            return {
                ...publicState(state),
                token: state.token,
                restart,
            };
        }
        touch(state);

        // Let the HTTP response flush before the console supervisor is asked
        // to bring the process back. The persisted state is the hand-off
        // between the old and new console process.
        if (process.env.NODE_ENV !== 'test') {
            setTimeout(() => {
                console.log('[RESTART] Exiting console for the confirmed full service restart');
                process.exit(0);
            }, 1500);
        }
        return {
            ...publicState(state),
            token: state.token,
            restart,
        };
    } catch (err) {
        state.phase = 'failed';
        state.error = err.message || 'service_restart_failed';
        touch(state);
        throw err;
    }
}

async function getPublicStatus(id, token) {
    const state = readState();
    if (!state || state.id !== id || state.token !== token) {
        return { phase: 'unknown', status: 'unknown', ready: false };
    }
    if (state.phase === 'restarting' && state.bootId !== BOOT_ID) {
        const api = require('./betterdeskApi');
        const health = await api.getHealth();
        if (health.status === 'running') {
            state.phase = 'ready';
            touch(state);
        }
    }
    return publicState(state);
}

function complete(req, id) {
    const state = getRawForOperator(req, id);
    if (state.phase !== 'ready' && state.phase !== 'failed') {
        const err = new Error('restart_transaction_not_ready');
        err.statusCode = 409;
        throw err;
    }
    removeState();
    return { completed: true, id };
}

function dismissFailed(req, key) {
    const state = readState();
    if (!state || state.phase !== 'failed' || state.userId !== safeUserId(req)) return false;
    if (key && !(state.changes || []).some((change) => change.key === key)) return false;
    removeState();
    return true;
}

module.exports = {
    STATE_PATH,
    getPending,
    registerChange,
    cancel,
    confirm,
    getPublicStatus,
    complete,
    dismissFailed,
    readState,
};
