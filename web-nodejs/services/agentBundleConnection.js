/**
 * Connection profile helpers for the support-agent bundle generator.
 * Operators supply a public hostname/IP; the console injects API URLs,
 * server public key, and a backend-issued enrollment token.
 */

'use strict';

const config = require('../config/config');

const HOST_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,253}[a-zA-Z0-9])?$/;
const IP_V4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const CERT_PIN_RE = /^[a-f0-9]{64}$/;

function clip(s, max) {
    if (typeof s !== 'string') return '';
    return s.trim().slice(0, max);
}

/** Default API port from console config (BetterDesk Go API). */
function defaultApiPort() {
    try {
        const raw = config.hbbsApiUrl || config.betterdeskApiUrl || '';
        const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
        if (u.port) return u.port;
        return u.protocol === 'https:' ? '443' : '21114';
    } catch (_) {
        return '21114';
    }
}

/** CDAP WebSocket gateway port (BetterDesk Go server). */
function defaultCdapPort() {
    const fromEnv = parseInt(process.env.CDAP_PORT || process.env.SIGNAL_PORT, 10);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
    return 21122;
}

/**
 * Relay (hbbr) port advertised to RustDesk clients.
 *
 * Always explicit: RustDesk 1.4.8/1.4.9 clients given a bare `relay-server`
 * (no port) fall back to the API port and then request relay on that socket.
 * The Go server used to echo it back, so both peers dialled the HTTP API and
 * every session died with `[relay] Pair timeout`.
 */
function defaultRelayPort() {
    const fromEnv = parseInt(
        process.env.RELAY_PORT || process.env.WS_HBBR_PORT || process.env.HBBR_PORT,
        10
    );
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
    return 21117;
}

/**
 * Build the `host:port` relay endpoint clients must dial.
 * Keeps an explicit port already present in `hostPort`, otherwise appends the
 * relay port. Returns '' for empty input.
 *
 * @param {string} hostPort - hostname, IPv4, bracketed IPv6, optionally with port
 * @param {number|string} [port] - relay port override (defaults to config/env)
 * @returns {string}
 */
function relayEndpointForHost(hostPort, port) {
    const raw = clip(hostPort, 300);
    if (!raw) return '';
    const relayPort = String(port || defaultRelayPort());

    // Already host:port (IPv4/hostname).
    const plain = raw.match(/^([^:/\s]+):(\d{1,5})$/);
    if (plain) {
        const n = parseInt(plain[2], 10);
        if (Number.isFinite(n) && n > 0 && n <= 65535) return `${plain[1]}:${n}`;
    }

    // Bracketed IPv6, with or without port.
    const v6 = raw.match(/^\[([0-9a-fA-F:]+)\](?::(\d{1,5}))?$/);
    if (v6) {
        const n = parseInt(v6[2] || '', 10);
        const usePort = Number.isFinite(n) && n > 0 && n <= 65535 ? n : relayPort;
        return `[${v6[1]}]:${usePort}`;
    }

    // Bare IPv6 without brackets.
    if ((raw.match(/:/g) || []).length > 1) return `[${raw}]:${relayPort}`;

    const host = raw.replace(/^https?:\/\//i, '').split('/')[0];
    return `${host}:${relayPort}`;
}

function formatOrigin(scheme, hostPart, port) {
    const omitPort = (scheme === 'https' && port === 443) || (scheme === 'http' && port === 80);
    return omitPort ? `${scheme}://${hostPart}` : `${scheme}://${hostPart}:${port}`;
}

function configuredCertificatePin() {
    const normalized = String(config.agentServerCertPin || '')
        .replace(/:/g, '')
        .trim()
        .toLowerCase();
    return CERT_PIN_RE.test(normalized) ? normalized : '';
}

/** Suggested host prefill from local server config. */
function defaultServerHost() {
    try {
        const raw = config.hbbsApiUrl || config.betterdeskApiUrl || '';
        const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
        return u.hostname || '';
    } catch (_) {
        return '';
    }
}

function defaultUseHttps() {
    try {
        const raw = config.hbbsApiUrl || config.betterdeskApiUrl || '';
        const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
        return u.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

/**
 * Normalize operator input: strip scheme/path/port — keep hostname or IPv4.
 */
function normalizeServerHost(input) {
    let host = clip(input, 253);
    if (!host) return { valid: false, error: 'server_host_required', host: '' };

    host = host.replace(/^https?:\/\//i, '');
    host = host.split('/')[0];
    host = host.split(':')[0];
    host = host.replace(/^\[|\]$/g, '');

    const valid = HOST_RE.test(host) || IP_V4_RE.test(host);
    if (!valid) {
        return { valid: false, error: 'server_host_invalid', host: '' };
    }
    return { valid: true, host };
}

/**
 * Build server { address, api_url, cdap/console ports and URLs } from host + TLS.
 */
function buildServerUrls(host, useHttps, apiPort) {
    const port = String(apiPort || defaultApiPort());
    const scheme = useHttps ? 'https' : 'http';
    const wsScheme = useHttps ? 'wss' : 'ws';
    const omitPort = (scheme === 'https' && port === '443') || (scheme === 'http' && port === '80');
    const hostPart = host.includes(':') ? `[${host}]` : host;
    const authority = omitPort ? hostPart : `${hostPart}:${port}`;
    const origin = `${scheme}://${authority}`;

    const cdapPort = defaultCdapPort();
    const cdapUrl = `${wsScheme}://${hostPart}:${cdapPort}/cdap`;

    return {
        address: origin,
        api_url: `${origin}/api`,
        cert_pin: configuredCertificatePin(),
        cdap_port: cdapPort,
        cdap_url: cdapUrl,
    };
}

function hostFromBranding(branding) {
    if (branding?.server_host) return branding.server_host;
    const addr = branding?.server?.address;
    if (!addr) return '';
    try {
        return new URL(addr).hostname;
    } catch (_) {
        return String(addr).replace(/^https?:\/\//i, '').split(/[/:]/)[0];
    }
}

function tlsFromBranding(branding) {
    if (typeof branding?.use_https === 'boolean') return branding.use_https;
    const addr = branding?.server?.address || '';
    return addr.startsWith('https://');
}

function connectionFingerprint(branding) {
    return `${hostFromBranding(branding)}|${tlsFromBranding(branding)}`;
}

module.exports = {
    defaultApiPort,
    defaultCdapPort,
    defaultRelayPort,
    relayEndpointForHost,
    defaultServerHost,
    defaultUseHttps,
    normalizeServerHost,
    buildServerUrls,
    configuredCertificatePin,
    connectionFingerprint,
};
