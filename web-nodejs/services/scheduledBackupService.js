'use strict';

/**
 * Scheduled full-instance backups.
 *
 * The archive is produced by backupService so scheduled backups have the same
 * disaster-recovery contents as a manual download. This service only owns
 * scheduling, durable storage, validation, retention and destination checks.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const config = require('../config/config');
const db = require('./database');
const backupService = require('./backupService');

const CONFIG_KEY = 'scheduled_backup_config';
const STATUS_KEY = 'scheduled_backup_status';
const SMB_KEY = 'scheduled_backup_smb';
const DEFAULT_INTERVAL_HOURS = 24;
const DEFAULT_RETENTION = 7;
const MIN_INTERVAL_HOURS = 1;
const MAX_INTERVAL_HOURS = 24 * 30;
const MAX_RETENTION = 365;

let timer = null;
let running = false;

function defaultDestination() {
    return path.join(config.dataDir, 'scheduled-backups');
}

function parseStored(value, fallback) {
    if (!value) return fallback;
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
        return fallback;
    }
}

function normalizeConfig(value = {}) {
    const intervalHours = Number(value.intervalHours);
    const retentionCount = Number(value.retentionCount);
    const destinationType = value.destinationType === 'path' ? 'path' : 'local';
    const destinationPath = destinationType === 'path' && typeof value.destinationPath === 'string'
        ? value.destinationPath.trim()
        : '';

    return {
        enabled: value.enabled === true || value.enabled === 'true',
        intervalHours: Number.isFinite(intervalHours)
            ? Math.min(MAX_INTERVAL_HOURS, Math.max(MIN_INTERVAL_HOURS, Math.round(intervalHours)))
            : DEFAULT_INTERVAL_HOURS,
        retentionCount: Number.isFinite(retentionCount)
            ? Math.min(MAX_RETENTION, Math.max(1, Math.round(retentionCount)))
            : DEFAULT_RETENTION,
        destinationType,
        destinationPath
    };
}

function publicConfig(value) {
    const normalized = normalizeConfig(value);
    return {
        ...normalized,
        destinationPath: normalized.destinationType === 'local'
            ? defaultDestination()
            : normalized.destinationPath
    };
}

function validateDestinationPath(destinationPath) {
    if (typeof destinationPath !== 'string' || !destinationPath.trim()) {
        throw new Error('Backup destination path is required');
    }
    const input = destinationPath.trim();
    if (!path.isAbsolute(input)) {
        throw new Error('Backup destination path must be absolute');
    }
    const resolved = path.resolve(input);
    const root = path.parse(resolved).root;
    const isWindowsUncRoot = process.platform === 'win32' && resolved.startsWith('\\\\');
    if (resolved === root && !isWindowsUncRoot) {
        throw new Error('The filesystem root cannot be used as a backup destination');
    }
    const projectRoot = path.resolve(__dirname, '..');
    if (resolved === projectRoot || resolved.startsWith(projectRoot + path.sep)) {
        throw new Error('The BetterDesk application directory cannot be used as a backup destination');
    }
    return resolved;
}

function resolveDestination(value) {
    const normalized = normalizeConfig(value);
    if (normalized.destinationType === 'local') return defaultDestination();
    return validateDestinationPath(normalized.destinationPath);
}

async function getConfig() {
    const stored = await db.getSetting(CONFIG_KEY, null);
    return normalizeConfig(parseStored(stored, {}));
}

async function getStatus() {
    const stored = await db.getSetting(STATUS_KEY, null);
    return parseStored(stored, {
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFile: null,
        lastSha256: null,
        lastValidation: null,
        lastError: null
    });
}

async function saveStatus(status) {
    await db.setSetting(STATUS_KEY, JSON.stringify(status));
    return status;
}

async function saveConfig(value) {
    const normalized = normalizeConfig(value);
    if (normalized.destinationType === 'path') {
        validateDestinationPath(normalized.destinationPath);
    }
    await db.setSetting(CONFIG_KEY, JSON.stringify(normalized));
    return publicConfig(normalized);
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function listArchives(destination) {
    try {
        return fs.readdirSync(destination)
            .filter((name) => /^betterdesk-backup-.*\.tar\.gz$/.test(name))
            .map((name) => {
                const fullPath = path.join(destination, name);
                const stat = fs.statSync(fullPath);
                return { name, fullPath, mtimeMs: stat.mtimeMs };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch (_) {
        return [];
    }
}

function prune(destination, retentionCount) {
    const deleted = [];
    for (const archive of listArchives(destination).slice(retentionCount)) {
        try {
            fs.rmSync(archive.fullPath, { force: true });
            fs.rmSync(`${archive.fullPath}.sha256`, { force: true });
            deleted.push(archive.name);
        } catch (_) {
            // A failed prune must not turn a verified backup into a failure.
        }
    }
    return deleted;
}

async function createScheduledBackup(options = {}) {
    if (running) throw new Error('A scheduled backup is already running');
    running = true;
    const startedAt = new Date().toISOString();
    let status = await getStatus();
    status = { ...status, lastAttemptAt: startedAt, lastError: null };
    await saveStatus(status);

    try {
        const schedule = await getConfig();
        const destination = resolveDestination(schedule);
        fs.mkdirSync(destination, { recursive: true });

        const created = await backupService.createFullBackup();
        const initialValidation = backupService.validateFullBackup(created.buffer);
        if (!initialValidation.valid) {
            throw new Error(`Generated backup failed validation: ${initialValidation.errors.join('; ')}`);
        }

        const finalPath = path.join(destination, created.filename);
        const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tempPath, created.buffer, { mode: 0o600 });
        fs.renameSync(tempPath, finalPath);

        const persisted = fs.readFileSync(finalPath);
        const persistedValidation = backupService.validateFullBackup(persisted);
        if (!persistedValidation.valid) {
            fs.rmSync(finalPath, { force: true });
            throw new Error(`Stored backup failed validation: ${persistedValidation.errors.join('; ')}`);
        }

        const digest = sha256(persisted);
        fs.writeFileSync(`${finalPath}.sha256`, `${digest}  ${created.filename}\n`, { mode: 0o600 });
        const deleted = prune(destination, schedule.retentionCount);
        status = await saveStatus({
            ...status,
            lastSuccessAt: new Date().toISOString(),
            lastFile: finalPath,
            lastSha256: digest,
            lastValidation: {
                valid: true,
                components: persistedValidation.manifest?.components || [],
                sizeBytes: persisted.length
            },
            lastPruned: deleted.length,
            lastError: null
        });
        return { filename: finalPath, sha256: digest, validation: status.lastValidation, deleted };
    } catch (err) {
        await saveStatus({ ...status, lastValidation: { valid: false }, lastError: err.message });
        throw err;
    } finally {
        running = false;
    }
}

async function runIfDue() {
    if (running) return { skipped: true, reason: 'running' };
    const schedule = await getConfig();
    if (!schedule.enabled) return { skipped: true, reason: 'disabled' };
    const status = await getStatus();
    const lastAttempt = Date.parse(status.lastAttemptAt || '');
    const due = !Number.isFinite(lastAttempt)
        || Date.now() - lastAttempt >= schedule.intervalHours * 60 * 60 * 1000;
    if (!due) return { skipped: true, reason: 'not_due' };
    return createScheduledBackup();
}

function start() {
    if (timer) return;
    timer = setInterval(() => {
        runIfDue().catch((err) => console.warn('[backup] Scheduled backup failed:', err.message));
    }, 60 * 1000);
    timer.unref?.();
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
}

async function testDestination(value) {
    const destination = resolveDestination(value);
    fs.mkdirSync(destination, { recursive: true });
    const probe = path.join(destination, `.betterdesk-backup-probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'BetterDesk backup destination test\n', { flag: 'wx', mode: 0o600 });
    fs.rmSync(probe, { force: true });
    return { valid: true, destination };
}

function validateSmbDetails(value = {}) {
    const host = String(value.host || '').trim();
    const share = String(value.share || '').trim();
    if (!/^[A-Za-z0-9._-]+$/.test(host)) throw new Error('SMB host contains invalid characters');
    if (!/^[A-Za-z0-9$._-]+$/.test(share)) throw new Error('SMB share contains invalid characters');
    return {
        host,
        share,
        domain: String(value.domain || '').trim().slice(0, 128),
        username: String(value.username || '').trim().slice(0, 128),
        password: String(value.password || '').slice(0, 512),
        mountPath: String(value.mountPath || '').trim().slice(0, 1024)
    };
}

function runCommand(command, args, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let stdout = '';
        let stderr = '';
        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error('SMB connection test timed out'));
        }, timeoutMs);
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        child.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(`SMB command failed with exit code ${code}`));
        });
    });
}

async function testSmbConnection(value) {
    const smb = validateSmbDetails(value);
    const target = `\\\\${smb.host}\\${smb.share}`;
    if (process.platform === 'win32') {
        const user = smb.domain ? `${smb.domain}\\${smb.username}` : smb.username;
        const args = [target];
        if (user) args.push(`/user:${user}`, smb.password);
        try {
            await runCommand('net', ['use', ...args], 15000);
            return { valid: true, target };
        } finally {
            await runCommand('net', ['use', target, '/delete', '/y'], 10000).catch(() => {});
        }
    }

    const uncTarget = `//${smb.host}/${smb.share}`;
    const auth = smb.username
        ? `${smb.domain ? `${smb.domain}\\` : ''}${smb.username}%${smb.password}`
        : '';
    const args = [uncTarget, auth ? '-U' : '-N'];
    if (auth) args.push(auth);
    args.push('-c', 'dir');
    try {
        await runCommand('smbclient', args, 15000);
        return { valid: true, target: uncTarget };
    } catch (err) {
        if (err.code === 'ENOENT') {
            throw new Error('smbclient is not installed; mount the share in the operating system and test its path instead');
        }
        throw err;
    }
}

async function getSmbSettings() {
    const stored = await db.getSetting(SMB_KEY, null);
    const smb = parseStored(stored, {});
    return { ...smb, password: smb.password ? '********' : '' };
}

async function saveSmbSettings(value) {
    const current = parseStored(await db.getSetting(SMB_KEY, null), {});
    const input = validateSmbDetails(value);
    if (input.password === '********') input.password = current.password || '';
    await db.setSetting(SMB_KEY, JSON.stringify(input));
    return { ...input, password: input.password ? '********' : '' };
}

module.exports = {
    createScheduledBackup,
    getConfig,
    saveConfig,
    getStatus,
    runIfDue,
    start,
    stop,
    testDestination,
    getSmbSettings,
    saveSmbSettings,
    testSmbConnection,
    resolveDestination,
    DEFAULT_INTERVAL_HOURS,
    DEFAULT_RETENTION
};
