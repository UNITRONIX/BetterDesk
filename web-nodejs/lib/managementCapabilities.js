'use strict';

/**
 * Shared host capability and runtime configuration helpers.
 *
 * This module deliberately validates configuration keys and values without
 * ever accepting service commands, shell fragments, or arbitrary paths from a
 * caller. The installer and the panel can use the same contract while the
 * privileged Linux broker remains the only root boundary.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const BOOLEAN_KEYS = new Set([
    'API_ENABLED',
    'RUSTDESK_API_PROXY',
    'RUSTDESK_API_DISABLE_TOTP',
    'RUSTDESK_API_DISABLE_TOTP_ACKNOWLEDGED',
    'SMTP_SECURE',
    'SMTP_TLS_VERIFY',
    'TRUST_PROXY',
    'HTTPS_ENABLED',
    'HTTP_REDIRECT_HTTPS',
    'P2P_FIRST',
    'ALWAYS_USE_RELAY',
    'SAME_NAT_RELAY',
    'ALLOW_SHARED_NAT_INITIATOR',
    'LOGGED_IN_ONLY_INITIATOR',
    'OPERATOR_ONLY_OUTBOUND',
    'CDAP_ENABLED',
    'CDAP_TLS',
    'CDAP_TLS_REQUIRED',
    'BILLING_REQUIRE_SYNCED_CLOCK',
    'BILLING_TRUST_OS_NTP',
    'BILLING_REQUIRE_WORK_REPORT',
    'STORE_ADMIN_CREDENTIALS',
]);

const PORT_KEYS = new Set([
    'PORT',
    'HTTPS_PORT',
    'SMTP_PORT',
    'API_PORT',
    'GO_API_PORT',
    'CLIENT_API_PORT',
    'CHAT_PORT',
]);
const PATH_KEYS = new Set([
    'RUSTDESK_DIR',
    'KEYS_PATH',
    'PUB_KEY_PATH',
    'API_KEY_PATH',
    'DB_PATH',
    'DATA_DIR',
    'SSL_CERT_PATH',
    'SSL_KEY_PATH',
    'SSL_CA_PATH',
]);

const ENUM_VALUES = new Map([
    ['DB_TYPE', new Set(['sqlite', 'postgres', 'postgresql'])],
    ['NODE_ENV', new Set(['development', 'test', 'production'])],
    ['LOG_LEVEL', new Set(['error', 'warn', 'info', 'debug'])],
    ['SERVER_BACKEND', new Set(['betterdesk', 'rustdesk'])],
    ['RUSTDESK_API_TLS', new Set(['auto', 'true', 'false'])],
    ['UPDATE_GITHUB_BRANCH', new Set(['main', 'dev'])],
    ['CDAP_TLS', new Set(['Y', 'N', 'y', 'n', 'true', 'false', '1', '0'])],
]);

const SECRET_KEY_RE = /(PASSWORD|PASS|SECRET|TOKEN|API_KEY|PRIVATE_KEY|DATABASE_URL)/i;
const SERVICE_NAMES = {
    linux: ['betterdesk-server', 'betterdesk-console'],
    win32: ['BetterDeskServer', 'BetterDeskConsole'],
    docker: ['betterdesk', 'betterdesk-server', 'betterdesk-console'],
};

function isWindows() {
    return process.platform === 'win32';
}

function isDocker() {
    return fs.existsSync('/.dockerenv') || process.env.DOCKER === 'true';
}

function isRoot() {
    return typeof process.getuid === 'function' && process.getuid() === 0;
}

function commandExists(command) {
    const probe = isWindows() ? 'where' : 'sh';
    const args = isWindows() ? [command] : ['-c', `command -v "${command}"`];
    try {
        return spawnSync(probe, args, { stdio: 'ignore', timeout: 3000 }).status === 0;
    } catch (_) {
        return false;
    }
}

function dockerDaemonAvailable() {
    if (!commandExists('docker')) return false;
    try {
        return spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 5000 }).status === 0;
    } catch (_) {
        return false;
    }
}

function canUsePrivilegedBroker() {
    if (isRoot()) return true;
    if (isWindows() || isDocker()) return false;
    try {
        const helper = require('./privilegedUpdateHelper');
        return helper.canUsePrivilegedUpdate();
    } catch (_) {
        return false;
    }
}

function isWindowsAdministrator() {
    if (!isWindows()) return false;
    try {
        return spawnSync('net', ['session'], { stdio: 'ignore', timeout: 3000 }).status === 0;
    } catch (_) {
        return false;
    }
}

function normalizePath(value) {
    return path.resolve(String(value || ''));
}

function pathCheck(filePath, mode, label) {
    const target = normalizePath(filePath);
    const result = { id: label, path: target, ready: false };
    try {
        const stat = fs.existsSync(target) ? fs.statSync(target) : null;
        const accessPath = stat ? target : path.dirname(target);
        fs.accessSync(accessPath, mode);
        result.ready = true;
        result.exists = !!stat;
        result.directory = !!stat && stat.isDirectory();
    } catch (err) {
        result.error = err.code || err.message || 'access_denied';
    }
    return result;
}

function parseEnvKeys(examplePath) {
    const keys = new Set();
    try {
        const content = fs.readFileSync(examplePath, 'utf8');
        for (const line of content.split(/\r?\n/)) {
            const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/);
            if (match) keys.add(match[1]);
        }
    } catch (_) {
        // A missing template is reported by the caller, not treated as an
        // opportunity to accept arbitrary environment variables.
    }
    return keys;
}

function resolvePaths(options = {}) {
    const consolePath = options.consolePath
        || process.env.BETTERDESK_CONSOLE_PATH
        || path.resolve(__dirname, '..');
    const serverPath = options.serverPath
        || process.env.BETTERDESK_PATH
        || process.env.RUSTDESK_DIR
        || process.env.RUSTDESK_PATH
        || (isWindows() ? 'C:\\BetterDesk' : '/opt/betterdesk');
    const dataPath = options.dataPath
        || process.env.DATA_DIR
        || path.join(consolePath, 'data');
    const backupPath = options.backupPath
        || path.join(dataPath, 'backups');
    return {
        consolePath: normalizePath(consolePath),
        serverPath: normalizePath(serverPath),
        dataPath: normalizePath(dataPath),
        backupPath: normalizePath(backupPath),
        envPath: normalizePath(options.envPath || path.join(consolePath, '.env')),
        examplePath: normalizePath(options.examplePath || path.join(consolePath, '.env.example')),
    };
}

function getAllowedEnvKeys(options = {}) {
    const paths = resolvePaths(options);
    return parseEnvKeys(paths.examplePath);
}

function validateEnvKey(key, options = {}) {
    const allowed = getAllowedEnvKeys(options);
    if (typeof key !== 'string' || !allowed.has(key)) {
        throw new Error(`Environment key is not allowlisted: ${key || '(empty)'}`);
    }
    return key;
}

function isPathWithin(candidate, root) {
    const normalizedCandidate = path.resolve(candidate);
    const normalizedRoot = path.resolve(root);
    return normalizedCandidate === normalizedRoot
        || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function validateEnvValue(key, value, options = {}) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`Invalid value for ${key}`);
    }
    const raw = String(value);
    if (/[\0\r\n]/.test(raw)) throw new Error(`Invalid control character in ${key}`);
    if (PATH_KEYS.has(key)) {
        if (!path.isAbsolute(raw)) throw new Error(`Path must be absolute for ${key}`);
        const paths = resolvePaths(options);
        const allowedRoots = [
            paths.consolePath,
            paths.serverPath,
            paths.dataPath,
            '/etc/letsencrypt',
        ];
        if (!allowedRoots.some((root) => isPathWithin(raw, root))) {
            throw new Error(`Path is outside BetterDesk roots for ${key}`);
        }
    }
    if (PORT_KEYS.has(key)) {
        if (!/^\d{1,5}$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
            throw new Error(`Invalid port for ${key}`);
        }
    }
    const allowedValues = ENUM_VALUES.get(key);
    if (allowedValues && !allowedValues.has(raw)) {
        throw new Error(`Invalid value for ${key}`);
    }
    if (BOOLEAN_KEYS.has(key)) {
        const normalized = raw.toLowerCase();
        if (!['true', 'false', '1', '0', 'yes', 'no', 'on', 'off', 'y', 'n'].includes(normalized)) {
            throw new Error(`Invalid boolean for ${key}`);
        }
    }
    return raw;
}

function validateEnvChanges(changes, options = {}) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
        throw new Error('Configuration changes must be an object');
    }
    const validated = {};
    for (const [key, value] of Object.entries(changes)) {
        validateEnvKey(key, options);
        validated[key] = validateEnvValue(key, value, options);
    }
    if (!Object.keys(validated).length) throw new Error('No configuration changes supplied');
    return validated;
}

function readEnvFile(envPath) {
    const values = {};
    if (!fs.existsSync(envPath)) return values;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/);
        if (match) values[match[1]] = match[2];
    }
    return values;
}

function applyEnvChanges(changes, options = {}) {
    const paths = resolvePaths(options);
    const validated = validateEnvChanges(changes, paths);
    const existing = fs.existsSync(paths.envPath)
        ? fs.readFileSync(paths.envPath, 'utf8')
        : '';
    const lines = existing ? existing.split(/\r?\n/) : [];
    const changed = new Set(Object.keys(validated));
    const seen = new Set();
    const output = lines.map((line) => {
        const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/);
        if (!match || !changed.has(match[1])) return line;
        seen.add(match[1]);
        return `${match[1]}=${validated[match[1]]}`;
    });
    for (const [key, value] of Object.entries(validated)) {
        if (!seen.has(key)) output.push(`${key}=${value}`);
    }

    fs.mkdirSync(path.dirname(paths.envPath), { recursive: true });
    const backupPath = `${paths.envPath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.writeFileSync(backupPath, existing, { encoding: 'utf8', mode: 0o600 });
    const tmpPath = `${paths.envPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, `${output.join('\n').replace(/\n+$/, '')}\n`, {
        encoding: 'utf8',
        mode: 0o600,
    });
    fs.renameSync(tmpPath, paths.envPath);
    try {
        if (!isWindows()) fs.chmodSync(paths.envPath, 0o600);
    } catch (_) { /* best effort on non-POSIX test doubles */ }
    return {
        envPath: paths.envPath,
        backupPath,
        changed: Object.keys(validated),
        values: Object.fromEntries(Object.keys(validated).map((key) => [
            key,
            SECRET_KEY_RE.test(key) ? '********' : validated[key],
        ])),
    };
}

function restoreEnvBackup(backupPath, options = {}) {
    const paths = resolvePaths(options);
    if (typeof backupPath !== 'string'
        || !backupPath.startsWith(`${paths.envPath}.bak.`)
        || path.resolve(backupPath) !== backupPath
        || !fs.existsSync(backupPath)) {
        throw new Error('Invalid environment backup path');
    }
    const tmpPath = `${paths.envPath}.rollback-${process.pid}`;
    fs.copyFileSync(backupPath, tmpPath);
    fs.renameSync(tmpPath, paths.envPath);
    try {
        if (!isWindows()) fs.chmodSync(paths.envPath, 0o600);
    } catch (_) { /* best effort on non-POSIX test doubles */ }
    return { envPath: paths.envPath, restoredFrom: backupPath };
}

function checkServiceControl() {
    if (isDocker()) {
        const ready = dockerDaemonAvailable();
        return {
            id: 'restart',
            ready,
            method: ready ? 'docker-compose' : 'unavailable',
            error: ready ? undefined : 'Docker CLI or daemon unavailable',
        };
    }
    if (isWindows()) {
        const ready = isWindowsAdministrator() || commandExists('nssm');
        return {
            id: 'restart',
            ready,
            method: isWindowsAdministrator() ? 'administrator' : 'nssm',
            error: ready ? undefined : 'Administrator/NSSM service control unavailable',
        };
    }
    const broker = canUsePrivilegedBroker();
    return {
        id: 'restart',
        ready: broker && commandExists('systemctl'),
        method: broker ? 'root-broker' : 'unavailable',
        error: broker ? undefined : 'Root update broker is not available',
    };
}

function getCapabilityReport(options = {}) {
    const paths = resolvePaths(options);
    const checks = [
        pathCheck(paths.consolePath, fs.constants.R_OK, 'console-read'),
        pathCheck(paths.consolePath, fs.constants.W_OK, 'console-write'),
        pathCheck(paths.dataPath, fs.constants.W_OK, 'data-write'),
        pathCheck(paths.serverPath, fs.constants.R_OK, 'server-read'),
        pathCheck(paths.serverPath, fs.constants.W_OK, 'server-write'),
        pathCheck(paths.backupPath, fs.constants.W_OK, 'backup-write'),
        pathCheck(paths.envPath, fs.constants.W_OK, 'env-write'),
        checkServiceControl(),
    ];
    if (!fs.existsSync(paths.examplePath)) {
        checks.push({ id: 'config-schema', ready: false, error: 'Missing .env.example allowlist' });
    } else {
        checks.push({ id: 'config-schema', ready: getAllowedEnvKeys(paths).size > 0 });
    }
    if (!isDocker()) {
        checks.push({
            id: 'update',
            ready: commandExists('node') && commandExists('npm'),
            method: 'local-toolchain',
            error: commandExists('node') && commandExists('npm')
                ? undefined : 'Node.js/npm unavailable',
        });
    } else {
        const dockerReady = dockerDaemonAvailable();
        checks.push({
            id: 'update',
            ready: dockerReady,
            method: 'docker-compose',
            error: dockerReady ? undefined : 'Docker CLI unavailable',
        });
    }
    const groups = {};
    for (const id of ['update', 'config', 'restart', 'permissions', 'backup', 'health']) {
        const relevant = id === 'update'
            ? checks.filter((check) => ['console-read', 'console-write', 'data-write', 'server-read', 'server-write', 'update'].includes(check.id))
            : id === 'config'
                ? checks.filter((check) => ['env-write', 'config-schema', 'console-write'].includes(check.id))
                : id === 'restart'
                    ? checks.filter((check) => check.id === 'restart')
                    : id === 'backup'
                        ? checks.filter((check) => check.id === 'backup-write')
                        : id === 'permissions'
                            ? checks.filter((check) => ['server-write', 'data-write', 'env-write'].includes(check.id))
                            : [];
        groups[id] = {
            ready: relevant.length > 0 && relevant.every((check) => check.ready),
            checks: relevant,
        };
    }
    groups.health = {
        ready: true,
        checks: [{ id: 'health', ready: true, method: 'post-operation-health-check' }],
    };
    return {
        success: true,
        platform: process.platform,
        docker: isDocker(),
        paths,
        services: SERVICE_NAMES[isDocker() ? 'docker' : process.platform] || SERVICE_NAMES.linux,
        groups,
        checks,
    };
}

function maskValue(key, value) {
    return SECRET_KEY_RE.test(key) ? '********' : String(value ?? '');
}

module.exports = {
    BOOLEAN_KEYS,
    ENUM_VALUES,
    PORT_KEYS,
    PATH_KEYS,
    SERVICE_NAMES,
    applyEnvChanges,
    canUsePrivilegedBroker,
    checkServiceControl,
    commandExists,
    dockerDaemonAvailable,
    getAllowedEnvKeys,
    getCapabilityReport,
    isDocker,
    isRoot,
    maskValue,
    parseEnvKeys,
    readEnvFile,
    restoreEnvBackup,
    resolvePaths,
    validateEnvChanges,
    validateEnvKey,
    validateEnvValue,
};
