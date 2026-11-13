'use strict';

/**
 * Agent template (enrollment token) store.
 *
 * Templates hold the single-use enrollment token an operator hands to a Support
 * Agent. Backend-agnostic: SQLite keeps them in `auth.db` beside users/groups,
 * PostgreSQL keeps them in the single console database. Both schemas are created
 * by the adapter, so this module only queries.
 *
 * History (2026-11-13): the routes called `db.get()` / `db.query()`, which the
 * database facade never exposed, so `POST /api/bd/enroll` could never find a
 * token and always answered 401 — and the template tab returned nothing on
 * PostgreSQL, which had no `agent_templates` table at all.
 */

const crypto = require('crypto');

const TABLE = 'agent_templates';

/** True when the adapter talks to PostgreSQL. */
function isPostgres(adapter) {
    return Boolean(adapter && String(adapter.type || '').toLowerCase() === 'postgres');
}

/**
 * Run one query through whichever raw accessor the adapter exposes.
 * Both adapters implement the domain methods below, so this is only a fallback.
 */
async function queryOne(adapter, sql, params) {
    if (typeof adapter.getAgentTemplateByToken === 'function') {
        return adapter.getAgentTemplateByToken(params[0]);
    }
    return null;
}

/**
 * @param {object} adapter database adapter
 * @param {string} token
 * @returns {Promise<{ id:number, name:string, config_json:string,
 *   enrolled_device_id:string|null }|null>}
 */
async function findByEnrollmentToken(adapter, token) {
    const clean = String(token || '').trim();
    if (!clean || clean.length > 64) return null;
    if (!adapter || typeof adapter.getAgentTemplateByToken !== 'function') return null;
    try {
        return await adapter.getAgentTemplateByToken(clean);
    } catch (err) {
        console.warn('[agentTemplates] lookup failed:', err.message);
        return null;
    }
}

/**
 * Bind a token to the device redeeming it. A token is single-use: once bound it
 * only admits the same device again, so a leaked token cannot enrol a second
 * machine.
 *
 * @returns {Promise<{ ok: boolean, boundTo: string }>}
 */
async function redeemEnrollmentToken(adapter, token, deviceId) {
    const clean = String(token || '').trim();
    const device = String(deviceId || '').trim();
    if (!clean || !device || !adapter) return { ok: false, boundTo: '' };

    const row = await findByEnrollmentToken(adapter, clean);
    if (!row) return { ok: false, boundTo: '' };

    const boundTo = String(row.enrolled_device_id || '').trim();
    if (boundTo) return { ok: boundTo === device, boundTo };

    if (typeof adapter.bindAgentTemplateDevice !== 'function') {
        // Older adapter: admit without single-use binding rather than lock the
        // agent out, but leave a trace so the gap is visible in the log.
        console.warn('[agentTemplates] adapter cannot bind tokens; single-use enforcement skipped');
        return { ok: true, boundTo: '' };
    }
    try {
        await adapter.bindAgentTemplateDevice(clean, device);
        return { ok: true, boundTo: device };
    } catch (err) {
        console.warn('[agentTemplates] bind failed:', err.message);
        return { ok: false, boundTo: '' };
    }
}

function generateEnrollmentToken() {
    return crypto.randomBytes(24).toString('hex');
}

module.exports = {
    TABLE,
    isPostgres,
    findByEnrollmentToken,
    redeemEnrollmentToken,
    generateEnrollmentToken,
};
