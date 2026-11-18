'use strict';

/**
 * Host validation for redirect and absolute-URL construction.
 *
 * SECURITY (audit H5, 2026-11-13): the HTTP→HTTPS redirect built its Location
 * header from `req.hostname`, which is the raw `Host` header (or
 * `X-Forwarded-Host` behind a proxy). That turned port 5000 into an open
 * redirect — `Host: attacker.example` produced
 * `Location: https://attacker.example:5443/login` — and also allowed
 * request-target smuggling (`https://host:5443http://evil/...`).
 *
 * The redirect must instead use a host the operator actually configured. When
 * no public host is configured we fall back to the listener address we bound to
 * (never to a header), so a redirect can only ever point at this server.
 */

const net = require('net');

/** Hostname / IPv4 syntax we are willing to emit into a URL. */
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * Validate a raw host value taken from configuration (not from a request).
 *
 * @param {string} raw
 * @returns {string|null} normalized hostname (lowercase, no port) or null
 */
function normalizeConfiguredHost(raw) {
    const value = String(raw || '').trim();
    if (!value) return null;
    // Accept a full origin in configuration: keep only the hostname.
    let host = value;
    try {
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
            host = new URL(value).hostname;
        }
    } catch (_) {
        return null;
    }
    host = host.replace(/^\[|\]$/g, '').trim().toLowerCase();
    if (!host || host.length > 253) return null;
    if (net.isIP(host)) return host;
    if (!HOSTNAME_RE.test(host)) return null;
    return host;
}

/**
 * Resolve the host to use in a redirect.
 *
 * Priority:
 *   1. Explicit operator configuration (PANEL_PUBLIC_HOST / PANEL_PUBLIC_URL).
 *   2. The address the redirect listener actually bound to, when it is a
 *      concrete address (not 0.0.0.0 / ::).
 *   3. `localhost` — never a request header.
 *
 * @param {{ configuredHost?: string, listenHost?: string }} options
 * @returns {{ host: string, source: 'config'|'listen'|'fallback' }}
 */
function resolveRedirectHost(options = {}) {
    const configured = normalizeConfiguredHost(options.configuredHost);
    if (configured) return { host: configured, source: 'config' };

    const listenHost = String(options.listenHost || '').trim().replace(/^\[|\]$/g, '');
    if (listenHost && listenHost !== '0.0.0.0' && listenHost !== '::' && net.isIP(listenHost)) {
        return { host: listenHost, source: 'listen' };
    }
    return { host: 'localhost', source: 'fallback' };
}

/**
 * Build the redirect URL for a request without ever trusting request headers.
 *
 * @param {object} options
 * @param {string} options.host validated host (see resolveRedirectHost)
 * @param {number} options.port HTTPS port
 * @param {string} options.urlPath request URL (path + query)
 * @returns {string}
 */
function buildSafeRedirectUrl({ host, port, urlPath }) {
    const safeHost = normalizeConfiguredHost(host) || 'localhost';
    const numericPort = Number(port);
    const suffix = Number.isInteger(numericPort) && numericPort > 0 && numericPort !== 443
        ? `:${numericPort}`
        : '';
    // Only a same-origin path may be appended: a request target such as
    // `http://evil.example/login` would otherwise be concatenated verbatim.
    const rawPath = String(urlPath || '/');
    const path = rawPath.startsWith('/') && !rawPath.startsWith('//')
        ? rawPath
        : '/';
    return `https://${safeHost}${suffix}${path}`;
}

module.exports = {
    HOSTNAME_RE,
    normalizeConfiguredHost,
    resolveRedirectHost,
    buildSafeRedirectUrl,
};
