/**
 * BetterDesk Console - Role permission store
 *
 * In-memory mirror of the Go server's role_permissions overrides and custom
 * roles, so the synchronous panel permission checks (middleware/auth.js,
 * sidebar visibility, WebSocket relays) honour what operators configure on
 * the Permissions page instead of only the built-in defaults.
 *
 * The cache is refreshed periodically and immediately after every change made
 * through this console. If the Go server is unreachable the last known state
 * is kept; before the first successful load only built-in defaults apply.
 */

'use strict';

const REFRESH_INTERVAL_MS = 30 * 1000;

// role -> Map(permission -> granted)
let overrides = new Map();
// role name -> { name, description, user_count }
let customRoles = new Map();
let lastLoadedAt = 0;
let timer = null;
let inflight = null;

/**
 * Stored override for role+permission.
 * @returns {boolean|undefined} undefined when no override exists
 */
function getOverride(role, permission) {
    const perms = overrides.get(role);
    if (!perms) return undefined;
    return perms.has(permission) ? perms.get(permission) : undefined;
}

function isCustomRole(role) {
    return typeof role === 'string' && customRoles.has(role);
}

function listCustomRoles() {
    return Array.from(customRoles.values());
}

function setState({ overrides: overrideRows = [], roles = [] } = {}) {
    const nextOverrides = new Map();
    for (const row of overrideRows) {
        if (!row || typeof row.role !== 'string' || typeof row.permission !== 'string') continue;
        if (!nextOverrides.has(row.role)) nextOverrides.set(row.role, new Map());
        nextOverrides.get(row.role).set(row.permission, row.granted === true);
    }

    const nextCustom = new Map();
    for (const role of roles) {
        if (!role || !role.is_custom || typeof role.name !== 'string') continue;
        nextCustom.set(role.name, {
            name: role.name,
            description: role.description || '',
            user_count: role.user_count || 0
        });
    }

    overrides = nextOverrides;
    customRoles = nextCustom;
    lastLoadedAt = Date.now();
}

async function load() {
    // Lazy require keeps the auth middleware free of the HTTP client at import time.
    const { apiClient } = require('./betterdeskApi');
    const [rolesResp, overridesResp] = await Promise.all([
        apiClient.get('/roles'),
        apiClient.get('/role-permissions')
    ]);
    const rolesData = rolesResp.data && rolesResp.data.data ? rolesResp.data.data : rolesResp.data;
    const overridesData = overridesResp.data && overridesResp.data.data ? overridesResp.data.data : overridesResp.data;
    setState({
        roles: (rolesData && rolesData.roles) || [],
        overrides: (overridesData && overridesData.overrides) || []
    });
}

/**
 * Reload overrides and custom roles from the Go server.
 * Concurrent callers share one request. Never throws.
 * @returns {Promise<boolean>} true when the cache was refreshed
 */
function refresh() {
    if (inflight) return inflight;
    inflight = load()
        .then(() => true)
        .catch((err) => {
            if (process.env.NODE_ENV !== 'test') {
                console.warn('[rbac] Failed to refresh role permissions:', err.message);
            }
            return false;
        })
        .finally(() => { inflight = null; });
    return inflight;
}

function start(intervalMs = REFRESH_INTERVAL_MS) {
    if (timer) return;
    refresh();
    timer = setInterval(refresh, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
}

function reset() {
    overrides = new Map();
    customRoles = new Map();
    lastLoadedAt = 0;
}

module.exports = {
    getOverride,
    isCustomRole,
    listCustomRoles,
    refresh,
    start,
    stop,
    setState,
    reset,
    get lastLoadedAt() { return lastLoadedAt; }
};
