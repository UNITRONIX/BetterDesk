'use strict';

/**
 * BetterDesk Console — panel trust bridge (signing side).
 *
 * Stage P1 of docs/important/console-backend-strangler.md. The Go server can
 * authorize a request on behalf of a signed-in operator without owning a
 * browser session; this module produces the statement it verifies.
 *
 * Why it matters for the new `/api/panel/*` endpoints: those calls go out with
 * the panel's API key, which carries the admin role. Without this statement the
 * server would authorize every panel call as an administrator and a viewer's
 * session could write a device group. With it, the role in the statement (and
 * the role the server reads back from the database) is the operator's own.
 *
 * Format — must stay byte-identical to betterdesk-server/api/panel_trust.go:
 *
 *   statement = v1 \n METHOD \n path \n subject \n role \n org \n issued \n expires \n nonce
 *   header    = base64url(statement) "." hex(hmac_sha256(secret, statement))
 *
 * The statement covers the method and path, so a header captured for one request
 * cannot be replayed against another. It lives 60 seconds and is single-use.
 */

const crypto = require('crypto');

const HEADER = 'X-BetterDesk-Panel';
const VERSION = 'v1';
const TTL_SECONDS = 60;

/** The shared secret, or '' when the bridge is not configured. */
function panelTrustSecret() {
    return String(process.env.PANEL_TRUST_SECRET || '').trim();
}

/** True when this console can sign statements. */
function panelTrustEnabled() {
    return panelTrustSecret().length > 0;
}

/**
 * Build the header value for one request.
 *
 * @param {object} identity  { username, role, orgId }
 * @param {string} method    HTTP method (any case)
 * @param {string} path      Request path as the server will see it, e.g. /api/panel/folders
 * @returns {string|null}    header value, or null when the bridge is off
 */
function signPanelStatement(identity, method, path, now = Date.now()) {
    const secret = panelTrustSecret();
    if (!secret) return null;
    const subject = String(identity?.username || '').trim();
    const role = String(identity?.role || '').trim();
    if (!subject || !role) return null;
    if (typeof path !== 'string' || !path.startsWith('/')) return null;

    const issued = Math.floor(now / 1000);
    const expires = issued + TTL_SECONDS;
    const statement = [
        VERSION,
        String(method || 'GET').toUpperCase(),
        path,
        subject,
        role,
        String(identity?.orgId || ''),
        String(issued),
        String(expires),
        crypto.randomBytes(16).toString('hex'),
    ].join('\n');

    const mac = crypto.createHmac('sha256', secret).update(statement, 'utf8').digest('hex');
    const payload = Buffer.from(statement, 'utf8').toString('base64url');
    return `${payload}.${mac}`;
}

/**
 * Headers to add to a panel-originated request. Returns an empty object when the
 * bridge is off, so callers can spread it unconditionally.
 */
function panelTrustHeaders(identity, method, path) {
    const value = signPanelStatement(identity, method, path);
    return value ? { [HEADER]: value } : {};
}

/** Identity shape a route can pass down from the session. */
function identityFromRequest(req) {
    const user = req?.session?.user;
    if (!user) return null;
    return {
        username: user.username,
        role: user.role,
        orgId: user.orgId || user.organizationId || '',
    };
}

module.exports = {
    HEADER,
    TTL_SECONDS,
    panelTrustSecret,
    panelTrustEnabled,
    signPanelStatement,
    panelTrustHeaders,
    identityFromRequest,
};
