/**
 * Alert rule device scope helpers.
 *
 * Storage (`alert_rules.scope_device_id` TEXT):
 *   - null / empty  → all devices
 *   - single id     → one device (legacy)
 *   - JSON array    → multiple devices, e.g. ["id1","id2"]
 *   - CSV           → accepted on read for robustness
 */

'use strict';

/**
 * @param {unknown} scope
 * @returns {string[]|null} null means "all devices"
 */
function parseScopeDeviceIds(scope) {
    if (scope == null) return null;
    const raw = String(scope).trim();
    if (!raw) return null;

    if (raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                const ids = [...new Set(parsed.map((x) => String(x).trim()).filter(Boolean))];
                return ids.length ? ids : null;
            }
        } catch (_) {
            /* fall through */
        }
    }

    if (raw.includes(',')) {
        const ids = [...new Set(raw.split(',').map((x) => x.trim()).filter(Boolean))];
        return ids.length ? ids : null;
    }

    return [raw];
}

/**
 * @param {unknown} ids
 * @returns {string|null}
 */
function serializeScopeDeviceIds(ids) {
    if (ids == null) return null;
    const list = Array.isArray(ids)
        ? ids
        : String(ids).split(',').map((x) => x.trim());
    const unique = [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
    if (!unique.length) return null;
    if (unique.length === 1) return unique[0];
    return JSON.stringify(unique);
}

/**
 * Normalize create/update body fields into a storable scope value.
 * Prefers `scope_device_ids` (array) when present.
 *
 * @param {{ scope_device_id?: unknown, scope_device_ids?: unknown }} body
 * @returns {string|null}
 */
function normalizeScopeFromBody(body = {}) {
    if (Object.prototype.hasOwnProperty.call(body, 'scope_device_ids')) {
        return serializeScopeDeviceIds(body.scope_device_ids);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'scope_device_id')) {
        const value = body.scope_device_id;
        if (Array.isArray(value)) return serializeScopeDeviceIds(value);
        return serializeScopeDeviceIds(value == null || value === '' ? [] : [value]);
    }
    return undefined;
}

/**
 * @param {{ scope_device_id?: unknown }} rule
 * @param {string} deviceId
 */
function ruleMatchesDevice(rule, deviceId) {
    const ids = parseScopeDeviceIds(rule?.scope_device_id);
    if (!ids) return true;
    return ids.includes(String(deviceId));
}

/**
 * Attach `scope_device_ids` for API consumers.
 * @param {object|null} rule
 */
function enrichRuleScope(rule) {
    if (!rule || typeof rule !== 'object') return rule;
    return {
        ...rule,
        scope_device_ids: parseScopeDeviceIds(rule.scope_device_id) || [],
    };
}

module.exports = {
    parseScopeDeviceIds,
    serializeScopeDeviceIds,
    normalizeScopeFromBody,
    ruleMatchesDevice,
    enrichRuleScope,
};
