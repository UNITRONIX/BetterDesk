'use strict';

const ACCESS_LEVELS = Object.freeze({
    NONE: 'none',
    READ: 'read',
    WRITE: 'write',
});

const ACCESS_LEVEL_RANK = Object.freeze({
    [ACCESS_LEVELS.NONE]: 0,
    [ACCESS_LEVELS.READ]: 1,
    [ACCESS_LEVELS.WRITE]: 2,
});

/**
 * The catalog is the contract shared by policy storage, authorization
 * middleware, the sidebar and the user/group editors. `readPermission` and
 * `writePermission` deliberately point at the existing RBAC permissions so
 * old roles remain a safe upper bound for new policy overrides.
 */
const PANEL_ACCESS_CATALOG = Object.freeze([
    { key: 'dashboard', label: 'Dashboard', group: 'core', readPermission: 'device.view', writePermission: null },
    { key: 'devices', label: 'Devices', group: 'core', readPermission: 'device.view', writePermission: 'device.edit' },
    { key: 'registrations', label: 'Registrations', group: 'core', readPermission: 'enrollment.approve', writePermission: 'enrollment.manage' },
    { key: 'remote', label: 'Remote access', group: 'core', readPermission: 'remote_target.view', writePermission: 'remote_target.connect' },
    { key: 'users', label: 'Users', group: 'administration', readPermission: 'user.view', writePermission: 'user.edit' },
    { key: 'organizations', label: 'Organizations', group: 'administration', readPermission: 'user.view', writePermission: 'org.edit' },
    { key: 'folders', label: 'Folders', group: 'administration', readPermission: 'device.view', writePermission: 'device.edit' },
    { key: 'strategies', label: 'Strategies', group: 'administration', readPermission: 'device.view', writePermission: 'device.edit' },
    { key: 'guests', label: 'Guest access', group: 'administration', readPermission: 'guest.create', writePermission: 'guest.create' },
    { key: 'tickets', label: 'Tickets', group: 'operations', readPermission: 'device.view', writePermission: 'device.edit' },
    { key: 'help-requests', label: 'Help requests', group: 'operations', readPermission: 'device.view', writePermission: 'device.edit' },
    { key: 'cdap', label: 'CDAP', group: 'operations', readPermission: 'cdap.view', writePermission: 'cdap.command' },
    { key: 'fleet', label: 'Fleet', group: 'operations', readPermission: 'org.manage_devices', writePermission: 'org.manage_devices' },
    { key: 'chat', label: 'Chat', group: 'operations', readPermission: 'chat.access', writePermission: 'chat.access' },
    { key: 'activity', label: 'Activity', group: 'operations', readPermission: 'audit.view', writePermission: null },
    { key: 'automation', label: 'Automation', group: 'operations', readPermission: 'device.view', writePermission: 'device.edit' },
    { key: 'files', label: 'File transfer', group: 'operations', readPermission: 'device.view', writePermission: 'device.edit' },
    { key: 'network', label: 'Network', group: 'operations', readPermission: 'server.config', writePermission: 'server.config' },
    { key: 'dataguard', label: 'Data guard', group: 'operations', readPermission: 'server.config', writePermission: 'server.config' },
    { key: 'reports', label: 'Reports', group: 'operations', readPermission: 'metrics.view', writePermission: null },
    { key: 'agents', label: 'Agents', group: 'operations', readPermission: 'device.view', writePermission: 'device.edit' },
    { key: 'toolkit', label: 'Toolkit', group: 'operations', readPermission: 'device.connect', writePermission: 'device.edit' },
    { key: 'commercialization', label: 'Commercialization', group: 'commercialization', readPermission: 'billing.view', writePermission: 'billing.manage' },
    { key: 'scaling', label: 'Scaling', group: 'commercialization', readPermission: 'server.config', writePermission: 'server.config' },
    { key: 'cross-platform', label: 'Cross-platform', group: 'commercialization', readPermission: 'server.config', writePermission: 'server.config' },
    { key: 'toolkit', label: 'Toolkit', group: 'commercialization', readPermission: 'server.config', writePermission: 'server.config' },
    { key: 'security-audit', label: 'Security audit', group: 'security', readPermission: 'audit.view', writePermission: 'server.config' },
    { key: 'languages', label: 'Languages', group: 'system', readPermission: 'server.config', writePermission: 'server.config' },
    { key: 'resource-control', label: 'Resource control', group: 'system', readPermission: 'server.config', writePermission: 'server.config' },
    { key: 'system', label: 'System', group: 'system', readPermission: 'server.config', writePermission: 'server.config' },
    { key: 'permissions', label: 'Permissions', group: 'system', readPermission: 'server.config', writePermission: 'server.config' },
    { key: 'server-management', label: 'Server management', group: 'system', readPermission: 'server.config', writePermission: 'server.config' },
    { key: 'settings', label: 'Settings', group: 'system', readPermission: 'server.config', writePermission: 'server.config' },
    { key: 'server-attestation', label: 'Server attestation', group: 'system', readPermission: 'server.attestation', writePermission: 'branding.edit' },
]);

const PANEL_ACCESS_GROUPS = Object.freeze([
    { key: 'core', label: 'Core' },
    { key: 'administration', label: 'Administration' },
    { key: 'operations', label: 'Operations' },
    { key: 'commercialization', label: 'Commercialization' },
    { key: 'security', label: 'Security' },
    { key: 'system', label: 'System' },
]);

const CLIENT_FEATURES = Object.freeze([
    { key: 'remote_control', label: 'Remote control', hardLock: false },
    { key: 'file_transfer', label: 'File transfer', hardLock: false },
    { key: 'clipboard', label: 'Clipboard', hardLock: false },
    { key: 'audio', label: 'Audio', hardLock: false },
    { key: 'tunnel', label: 'Tunnel', hardLock: false },
    { key: 'terminal', label: 'Terminal', hardLock: false },
    { key: 'port_forwarding', label: 'Port forwarding', hardLock: false },
    { key: 'reboot', label: 'Remote reboot', hardLock: false },
    { key: 'privacy_mode', label: 'Privacy mode', hardLock: false },
    { key: 'client_actions', label: 'Client actions', hardLock: true },
]);

function normalizeAccessLevel(value) {
    if (typeof value === 'number') {
        if (value >= 2) return ACCESS_LEVELS.WRITE;
        if (value === 1) return ACCESS_LEVELS.READ;
        return ACCESS_LEVELS.NONE;
    }
    const normalized = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(ACCESS_LEVEL_RANK, normalized)
        ? normalized
        : ACCESS_LEVELS.NONE;
}

function compareAccessLevels(left, right) {
    return ACCESS_LEVEL_RANK[normalizeAccessLevel(left)]
        - ACCESS_LEVEL_RANK[normalizeAccessLevel(right)];
}

function getCatalogEntry(key) {
    return PANEL_ACCESS_CATALOG.find((entry) => entry.key === key) || null;
}

function getLegacySectionCeiling(key, hasPermission, isSuperAdmin = false) {
    const entry = getCatalogEntry(key);
    if (!entry || isSuperAdmin) return isSuperAdmin ? ACCESS_LEVELS.WRITE : ACCESS_LEVELS.NONE;
    if (entry.writePermission && hasPermission(entry.writePermission)) return ACCESS_LEVELS.WRITE;
    if (entry.readPermission && hasPermission(entry.readPermission)) return ACCESS_LEVELS.READ;
    return ACCESS_LEVELS.NONE;
}

module.exports = {
    ACCESS_LEVELS,
    ACCESS_LEVEL_RANK,
    PANEL_ACCESS_CATALOG,
    PANEL_ACCESS_GROUPS,
    CLIENT_FEATURES,
    normalizeAccessLevel,
    compareAccessLevels,
    getCatalogEntry,
    getLegacySectionCeiling,
};
