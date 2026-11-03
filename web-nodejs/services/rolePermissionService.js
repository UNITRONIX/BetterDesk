'use strict';

/**
 * Resolves the effective permission set for a panel role.
 *
 * The Go API is the source of truth because it owns the role_permissions
 * table. Keeping this lookup in one service prevents the Node panel from
 * silently falling back to its stale default map after an override changes.
 */

const betterdeskApi = require('./betterdeskApi');

const CACHE_TTL_MS = 1000;
const cache = new Map();
const inFlight = new Map();

function toPermissionSet(result, role) {
    if (!result || result.success !== true || !result.data || !Array.isArray(result.data.permissions)) {
        const detail = result && result.error ? `: ${result.error}` : '';
        throw new Error(`Failed to resolve effective permissions for role ${role}${detail}`);
    }
    return new Set(result.data.permissions.filter((permission) => typeof permission === 'string'));
}

async function getEffectivePermissions(role) {
    if (typeof role !== 'string' || role.length === 0) {
        throw new Error('Cannot resolve permissions without a role');
    }

    const now = Date.now();
    const cached = cache.get(role);
    if (cached && cached.expiresAt > now) {
        return new Set(cached.permissions);
    }

    if (inFlight.has(role)) {
        return new Set(await inFlight.get(role));
    }

    const request = Promise.resolve()
        .then(() => betterdeskApi.getRolePermissions(role))
        .then((result) => {
            const permissions = toPermissionSet(result, role);
            cache.set(role, {
                permissions,
                expiresAt: Date.now() + CACHE_TTL_MS,
            });
            return permissions;
        })
        .finally(() => {
            inFlight.delete(role);
        });

    inFlight.set(role, request);
    return new Set(await request);
}

function invalidateRole(role) {
    if (typeof role === 'string' && role.length > 0) {
        cache.delete(role);
    }
}

function clearCache() {
    cache.clear();
}

/**
 * Populate request-local authorization state before panel routes/templates.
 * Permission resolution failures are intentionally retained on the request
 * and handled fail-closed by requirePermission/requestHasPermission.
 */
function loadEffectivePermissions(req, _res, next) {
    req.permissionContextLoaded = true;

    const role = req.session?.user?.role;
    if (!role || role === 'super_admin' || role === 'admin') {
        return next();
    }

    getEffectivePermissions(role)
        .then((permissions) => {
            req.effectivePermissions = permissions;
            next();
        })
        .catch((error) => {
            req.permissionLoadError = error;
            next();
        });
}

module.exports = {
    getEffectivePermissions,
    invalidateRole,
    clearCache,
    loadEffectivePermissions,
};
