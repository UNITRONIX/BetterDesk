/**
 * BetterDesk Console - Backup & Restore Service
 *
 * Creates/restores JSON snapshots of console configuration:
 *   - Console settings (key/value pairs)
 *   - Branding configuration
 *   - Users (admin/operator accounts — passwords are hashed)
 *   - Folders structure
 *   - User groups, device groups, strategies
 *   - Address books
 *   - Go server peers + blocklist + config (fetched via REST when available)
 *
 * Archive format: single JSON file (*.betterdesk-backup.json)
 */

const db = require('./database');
const brandingService = require('./brandingService');
const serverBackend = require('./serverBackend');
const config = require('../config/config');

// Current backup format version — increment on breaking schema changes
const BACKUP_FORMAT_VERSION = 1;

// ========================== Export ========================================

/**
 * Build a full backup payload.
 * @returns {Promise<Object>} Serialisable backup object
 */
async function createBackup() {
    const timestamp = new Date().toISOString();

    // --- Console local data ---
    const settings = await db.getAllSettings();
    const branding = brandingService.getBranding();
    const users = await db.getAllUsersForBackup();
    const folders = await db.getAllFolders();
    const userGroups = await db.getAllUserGroups();
    const deviceGroups = await db.getAllDeviceGroups();
    const strategies = await db.getAllStrategies();

    // Address books (all users)
    const addressBooks = await db.getAllAddressBooks();

    // --- Go server data (best-effort) ---
    let goServer = null;
    if (serverBackend.isBetterDesk()) {
        goServer = await fetchGoServerData();
    }

    return {
        _format: 'betterdesk-backup',
        _version: BACKUP_FORMAT_VERSION,
        _created: timestamp,
        _console_version: config.appVersion,
        _backend: serverBackend.getActiveBackend(),
        console: {
            settings,
            branding,
            users,
            folders,
            userGroups,
            deviceGroups,
            strategies,
            addressBooks
        },
        goServer
    };
}

/**
 * Fetch data from BetterDesk Go server via REST API.
 * Non-critical — returns null on failure.
 */
async function fetchGoServerData() {
    try {
        const betterdeskApi = require('./betterdeskApi');
        const [peersRes, blocklistRes, auditRes, healthRes] = await Promise.all([
            betterdeskApi.getAllPeers().catch(() => []),
            betterdeskApi.getBlocklist().catch(() => []),
            betterdeskApi.getAuditEvents(500).catch(() => []),
            betterdeskApi.getHealth().catch(() => ({}))
        ]);

        return {
            peers: peersRes || [],
            blocklist: blocklistRes || [],
            auditEvents: auditRes || [],
            serverHealth: healthRes || {}
        };
    } catch {
        return null;
    }
}

// ========================== Import ========================================

/**
 * Validate a backup payload before restoring.
 * @param {Object} data - Parsed backup JSON
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateBackup(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
        errors.push('Invalid backup file: not a JSON object');
        return { valid: false, errors };
    }
    if (data._format !== 'betterdesk-backup') {
        errors.push('Invalid backup file: missing or wrong _format field');
    }
    if (typeof data._version !== 'number' || data._version > BACKUP_FORMAT_VERSION) {
        errors.push(`Unsupported backup version: ${data._version} (max supported: ${BACKUP_FORMAT_VERSION})`);
    }
    if (!data.console || typeof data.console !== 'object') {
        errors.push('Invalid backup file: missing console section');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Restore console data from a backup payload.
 * Only restores console-local data. Go server data is informational.
 *
 * @param {Object} data - Validated backup payload
 * @param {Object} options
 * @param {boolean} options.restoreSettings   - Restore console settings (default true)
 * @param {boolean} options.restoreBranding   - Restore branding/theme (default true)
 * @param {boolean} options.restoreUsers      - Restore user accounts (default false — destructive!)
 * @param {boolean} options.restoreFolders    - Restore folder structure (default true)
 * @param {boolean} options.restoreGroups     - Restore user/device groups + strategies (default true)
 * @param {boolean} options.restoreAddressBooks - Restore address books (default true)
 * @returns {{ restored: string[], skipped: string[], warnings: string[] }}
 */
async function restoreBackup(data, options = {}) {
    const {
        restoreSettings = true,
        restoreBranding = true,
        restoreUsers = false,
        restoreFolders = true,
        restoreGroups = true,
        restoreAddressBooks = true
    } = options;

    const result = { restored: [], skipped: [], warnings: [] };

    // --- Settings ---
    if (restoreSettings && data.console.settings) {
        try {
            const settings = data.console.settings;
            for (const [key, value] of Object.entries(settings)) {
                await db.setSetting(key, value);
            }
            result.restored.push('settings');
        } catch (err) {
            result.warnings.push(`Settings restore failed: ${err.message}`);
        }
    } else {
        result.skipped.push('settings');
    }

    // --- Branding ---
    if (restoreBranding && data.console.branding) {
        try {
            await brandingService.saveBranding(data.console.branding);
            result.restored.push('branding');
        } catch (err) {
            result.warnings.push(`Branding restore failed: ${err.message}`);
        }
    } else {
        result.skipped.push('branding');
    }

    // --- Users (destructive — replaces all users) ---
    if (restoreUsers && Array.isArray(data.console.users) && data.console.users.length > 0) {
        try {
            await db.restoreUsers(data.console.users);
            result.restored.push('users');
        } catch (err) {
            result.warnings.push(`Users restore failed: ${err.message}`);
        }
    } else {
        result.skipped.push('users');
    }

    // --- Folders ---
    if (restoreFolders && Array.isArray(data.console.folders)) {
        try {
            // Merge: insert folders that don't exist
            const existingFolders = await db.getAllFolders();
            const existing = new Set(existingFolders.map(f => f.name));
            for (const f of data.console.folders) {
                if (!existing.has(f.name)) {
                    await db.createFolder(f.name, f.color || '#6366f1', f.icon || 'folder');
                }
            }
            result.restored.push('folders');
        } catch (err) {
            result.warnings.push(`Folders restore failed: ${err.message}`);
        }
    } else {
        result.skipped.push('folders');
    }

    // --- User Groups + Device Groups + Strategies ---
    if (restoreGroups) {
        try {
            await restoreGroupsData(data.console, result);
            result.restored.push('groups');
        } catch (err) {
            result.warnings.push(`Groups restore failed: ${err.message}`);
        }
    } else {
        result.skipped.push('groups');
    }

    // --- Address Books ---
    if (restoreAddressBooks && Array.isArray(data.console.addressBooks)) {
        try {
            for (const ab of data.console.addressBooks) {
                if (ab.user_id && ab.ab_type) {
                    await db.saveAddressBook(ab.user_id, ab.ab_type, ab.data || '{}');
                }
            }
            result.restored.push('addressBooks');
        } catch (err) {
            result.warnings.push(`Address books restore failed: ${err.message}`);
        }
    } else {
        result.skipped.push('addressBooks');
    }

    return result;
}

/**
 * Restore user groups, device groups and strategies (merge, don't duplicate).
 */
async function restoreGroupsData(consoleData, result) {
    // User groups
    if (Array.isArray(consoleData.userGroups)) {
        const existing = new Set((await db.getAllUserGroups()).map(g => g.guid));
        for (const g of consoleData.userGroups) {
            if (g.guid && !existing.has(g.guid)) {
                try {
                    await db.createUserGroup({ guid: g.guid, name: g.name, note: g.note || '' });
                } catch { /* duplicate guid — skip */ }
            }
        }
    }

    // Device groups
    if (Array.isArray(consoleData.deviceGroups)) {
        const existing = new Set((await db.getAllDeviceGroups()).map(g => g.guid));
        for (const g of consoleData.deviceGroups) {
            if (g.guid && !existing.has(g.guid)) {
                try {
                    await db.createDeviceGroup({ guid: g.guid, name: g.name, note: g.note || '' });
                } catch { /* duplicate guid — skip */ }
            }
        }
    }

    // Strategies
    if (Array.isArray(consoleData.strategies)) {
        const existing = new Set((await db.getAllStrategies()).map(s => s.guid));
        for (const s of consoleData.strategies) {
            if (s.guid && !existing.has(s.guid)) {
                try {
                    await db.createStrategy({
                        guid: s.guid,
                        name: s.name,
                        user_group_guid: s.user_group_guid || '',
                        device_group_guid: s.device_group_guid || '',
                        enabled: s.enabled !== undefined ? s.enabled : 1,
                        permissions: typeof s.permissions === 'string' ? s.permissions : JSON.stringify(s.permissions || {})
                    });
                } catch { /* duplicate guid — skip */ }
            }
        }
    }
}

/**
 * Get size estimate for a backup (useful for UI info).
 * @returns {{ tables: Object<string, number>, totalRows: number }}
 */
async function getBackupStats() {
    const stats = await db.getBackupStats();
    return {
        ...stats,
        backend: serverBackend.getActiveBackend()
    };
}

module.exports = {
    createBackup,
    validateBackup,
    restoreBackup,
    getBackupStats,
    BACKUP_FORMAT_VERSION
};
