'use strict';

/**
 * Profile pictures: check and fetch the image for a user's avatar.
 *
 * Pictures come from the identity provider's "picture" claim (an http(s) URL
 * or a data:image URL) or from the avatar URL a local user saves in their
 * profile. The console stores the bytes and serves them itself, so a picture
 * is never hotlinked and nothing but PNG, JPEG, WebP or GIF is ever served.
 *
 * Fetch rules (fetchAvatarUrl):
 *   - http and https only, no credentials in the URL
 *   - 5 s for the whole fetch, at most 3 redirects, at most 512 KB
 *   - the response must say it is an image, and its first bytes must match
 *     the type it claims
 *   - the address is checked after DNS resolution, inside the socket's own
 *     lookup, so the address that is checked is the address that is used: a
 *     DNS rebind between check and connect cannot reach a refused address
 *   - refused: loopback, "this host" (0.0.0.0/8), link-local (which holds the
 *     cloud metadata service at 169.254.169.254), other metadata addresses,
 *     multicast and reserved ranges
 *   - allowed: private LAN ranges (10/8, 172.16/12, 192.168/16, 100.64/10,
 *     fc00::/7). Identity providers such as authentik often run on the same
 *     LAN as the console, and their avatar URLs point there. Only signed-in
 *     users can make the console fetch a URL (their own sign-in or profile),
 *     and the response is only ever used as an image, never shown as text.
 */

const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const crypto = require('crypto');

const MAX_AVATAR_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

class AvatarError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'AvatarError';
        this.code = code;
    }
}

/** Image type from the first bytes, or null when it is not PNG, JPEG, WebP or GIF */
function sniffImageType(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
        && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.length >= 6) {
        const head = buf.subarray(0, 6).toString('latin1');
        if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
    }
    if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF'
        && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    return null;
}

function normalizeMime(value) {
    const m = String(value || '').split(';')[0].trim().toLowerCase();
    if (m === 'image/jpg' || m === 'image/pjpeg') return 'image/jpeg';
    return m;
}

/** Short stable version for cache busting and the ETag */
function imageVersion(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/**
 * Decode and check a data:image URL. Returns { mimeType, data }.
 * The declared type must be PNG, JPEG, WebP or GIF and match the bytes.
 */
function parseAvatarDataUrl(value, { maxBytes = MAX_AVATAR_BYTES } = {}) {
    const str = String(value || '').trim();
    const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/_-]+={0,2})$/i.exec(str);
    if (!m) throw new AvatarError('invalid_data_url', 'Not a base64 data:image URL');
    const declared = normalizeMime(m[1]);
    if (!ALLOWED_TYPES.has(declared)) throw new AvatarError('unsupported_type', `Type ${declared} is not allowed`);
    // Refuse before decoding when the text alone is clearly too long
    if (Math.floor(m[2].length * 3 / 4) > maxBytes + 3) throw new AvatarError('too_large', 'Picture is too large');
    const data = Buffer.from(m[2], 'base64');
    if (!data.length) throw new AvatarError('invalid_data_url', 'Empty picture');
    if (data.length > maxBytes) throw new AvatarError('too_large', 'Picture is too large');
    const sniffed = sniffImageType(data);
    if (!sniffed) throw new AvatarError('not_an_image', 'The data is not a PNG, JPEG, WebP or GIF image');
    if (sniffed !== declared) throw new AvatarError('type_mismatch', `Declared ${declared} but the data is ${sniffed}`);
    return { mimeType: sniffed, data };
}

// ---------------------------------------------------------------------------
//  Address checks
// ---------------------------------------------------------------------------

function ipv4ToInt(ip) {
    const p = ip.split('.').map(Number);
    return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function inV4(ip, base, bits) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((ipv4ToInt(ip) & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

const REFUSED_V4 = [
    ['0.0.0.0', 8],          // "this host"; 0.0.0.0 reaches the local machine
    ['127.0.0.0', 8],        // loopback
    ['169.254.0.0', 16],     // link-local, cloud metadata (169.254.169.254)
    ['100.100.100.200', 32], // Alibaba Cloud metadata
    ['192.0.0.0', 24],       // IETF protocol assignments
    ['198.18.0.0', 15],      // benchmarking
    ['224.0.0.0', 4],        // multicast
    ['240.0.0.0', 4],        // reserved and broadcast
];

/** Expand an IPv6 address to 8 numbers, or null */
function parseIpv6(ip) {
    let s = String(ip).toLowerCase();
    const zone = s.indexOf('%');
    if (zone !== -1) s = s.slice(0, zone);
    // A trailing dotted IPv4 part becomes two hex groups
    const lastColon = s.lastIndexOf(':');
    const lastPart = s.slice(lastColon + 1);
    if (lastPart.includes('.')) {
        if (!net.isIPv4(lastPart)) return null;
        const n = ipv4ToInt(lastPart);
        s = s.slice(0, lastColon + 1) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
    }
    const halves = s.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    let parts;
    if (halves.length === 2) {
        const fill = 8 - head.length - rest.length;
        if (fill < 1) return null;
        parts = [...head, ...new Array(fill).fill('0'), ...rest];
    } else {
        parts = head;
    }
    if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
    return parts.map((p) => parseInt(p, 16));
}

function v4FromWords(hi, lo) {
    return [hi >>> 8, hi & 0xff, lo >>> 8, lo & 0xff].join('.');
}

/**
 * True when the console must not fetch a picture from this address.
 * Private LAN addresses are allowed (see the header comment).
 */
function isRefusedAvatarAddress(ip) {
    if (!ip || typeof ip !== 'string') return true;
    if (net.isIPv4(ip)) return REFUSED_V4.some(([base, bits]) => inV4(ip, base, bits));
    if (!net.isIPv6(ip)) return true;
    const g = parseIpv6(ip);
    if (!g) return true;
    const allZeroUpTo = (n) => g.slice(0, n).every((w) => w === 0);
    if (allZeroUpTo(8)) return true;                                   // ::
    if (allZeroUpTo(7) && g[7] === 1) return true;                     // ::1
    if ((g[0] & 0xffc0) === 0xfe80) return true;                       // fe80::/10 link-local
    if ((g[0] & 0xff00) === 0xff00) return true;                       // ff00::/8 multicast
    if (g[0] === 0xfd00 && g[1] === 0x0ec2 && g.slice(2, 7).every((w) => w === 0) && g[7] === 0x254) {
        return true;                                                   // AWS metadata fd00:ec2::254
    }
    // Addresses that carry an IPv4 address: judge that address
    if (allZeroUpTo(5) && g[5] === 0xffff) return isRefusedAvatarAddress(v4FromWords(g[6], g[7])); // ::ffff:a.b.c.d
    if (allZeroUpTo(6)) return isRefusedAvatarAddress(v4FromWords(g[6], g[7]));                    // ::a.b.c.d
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((w) => w === 0)) {
        return isRefusedAvatarAddress(v4FromWords(g[6], g[7]));                                    // NAT64
    }
    if (g[0] === 0x2002) return isRefusedAvatarAddress(v4FromWords(g[1], g[2]));                   // 6to4
    return false;
}

const REFUSED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', 'metadata.goog']);

/**
 * dns.lookup replacement for http.request: resolves the name, refuses the
 * whole name when any of its addresses is refused, and hands the checked
 * addresses to the socket.
 */
function makeGuardedLookup(baseLookup = dns.lookup) {
    return function guardedLookup(hostname, options, callback) {
        if (typeof options === 'function') { callback = options; options = {}; }
        const opts = typeof options === 'number' ? { family: options } : (options || {});
        baseLookup(hostname, { family: opts.family || 0, all: true, hints: opts.hints }, (err, addresses) => {
            if (err) return callback(err);
            const list = (Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIPv6(addresses) ? 6 : 4 }])
                .filter((a) => a && a.address);
            if (!list.length) return callback(new AvatarError('dns_failed', `No address for ${hostname}`));
            const refused = list.find((a) => isRefusedAvatarAddress(a.address));
            if (refused) {
                return callback(new AvatarError('address_refused', `${hostname} resolves to refused address ${refused.address}`));
            }
            if (opts.all) return callback(null, list.map((a) => ({ address: a.address, family: a.family })));
            return callback(null, list[0].address, list[0].family);
        });
    };
}

function checkUrl(urlString) {
    let u;
    try { u = new URL(urlString); } catch (_) { throw new AvatarError('invalid_url', 'Not a valid URL'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new AvatarError('invalid_url', 'Only http and https URLs');
    if (u.username || u.password) throw new AvatarError('invalid_url', 'Credentials in the URL are not allowed');
    let host = u.hostname.toLowerCase();
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
    if (!host) throw new AvatarError('invalid_url', 'URL has no host');
    if (REFUSED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
        throw new AvatarError('address_refused', `Host ${host} is refused`);
    }
    // The socket skips the lookup for an address literal, so check it here
    if (net.isIP(host) && isRefusedAvatarAddress(host)) {
        throw new AvatarError('address_refused', `Address ${host} is refused`);
    }
    return u;
}

function requestOnce(u, { deadline, maxBytes, lookup }) {
    return new Promise((resolve, reject) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return reject(new AvatarError('timeout', 'Picture fetch timed out'));
        const lib = u.protocol === 'https:' ? https : http;
        let settled = false;
        const done = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(value);
        };
        const req = lib.request(u, {
            method: 'GET',
            agent: false,
            lookup,
            headers: {
                Accept: 'image/png,image/jpeg,image/webp,image/gif;q=0.9',
                'User-Agent': 'BetterDesk-Console/avatar',
            },
        }, (res) => {
            const status = res.statusCode || 0;
            if (status >= 300 && status < 400 && res.headers.location) {
                res.resume();
                return done(resolve, { redirect: res.headers.location });
            }
            if (status !== 200) {
                res.resume();
                return done(reject, new AvatarError('http_status', `Picture URL answered ${status}`));
            }
            const declared = normalizeMime(res.headers['content-type']);
            if (!ALLOWED_TYPES.has(declared)) {
                res.resume();
                return done(reject, new AvatarError('not_an_image', `Content type ${declared || 'none'} is not an allowed image type`));
            }
            const length = Number(res.headers['content-length']);
            if (Number.isFinite(length) && length > maxBytes) {
                res.destroy();
                return done(reject, new AvatarError('too_large', 'Picture is too large'));
            }
            const chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
                size += chunk.length;
                if (size > maxBytes) {
                    res.destroy();
                    req.destroy();
                    return done(reject, new AvatarError('too_large', 'Picture is too large'));
                }
                chunks.push(chunk);
            });
            res.on('end', () => {
                const data = Buffer.concat(chunks);
                const sniffed = sniffImageType(data);
                if (!sniffed) return done(reject, new AvatarError('not_an_image', 'The response is not a PNG, JPEG, WebP or GIF image'));
                if (sniffed !== declared) return done(reject, new AvatarError('type_mismatch', `Declared ${declared} but the data is ${sniffed}`));
                return done(resolve, { mimeType: sniffed, data });
            });
            res.on('error', (err) => done(reject, err instanceof AvatarError ? err : new AvatarError('fetch_failed', err.message)));
        });
        const timer = setTimeout(() => {
            req.destroy();
            done(reject, new AvatarError('timeout', 'Picture fetch timed out'));
        }, remaining);
        req.on('error', (err) => done(reject, err instanceof AvatarError ? err : new AvatarError('fetch_failed', err.message)));
        req.end();
    });
}

/**
 * Fetch a picture from an http(s) URL under the rules in the header.
 * Returns { mimeType, data }. Options exist for tests.
 */
async function fetchAvatarUrl(urlString, options = {}) {
    const timeoutMs = options.timeoutMs || FETCH_TIMEOUT_MS;
    const maxBytes = options.maxBytes || MAX_AVATAR_BYTES;
    const maxRedirects = options.maxRedirects === undefined ? MAX_REDIRECTS : options.maxRedirects;
    const lookup = makeGuardedLookup(options.lookup || dns.lookup);
    const deadline = Date.now() + timeoutMs;
    let current = checkUrl(urlString);
    for (let redirects = 0; ; redirects++) {
        const result = await requestOnce(current, { deadline, maxBytes, lookup });
        if (!result.redirect) return result;
        if (redirects >= maxRedirects) throw new AvatarError('too_many_redirects', 'Too many redirects');
        let next;
        try { next = new URL(result.redirect, current).href; } catch (_) { throw new AvatarError('invalid_url', 'Bad redirect'); }
        current = checkUrl(next);
    }
}

/**
 * Turn a picture value (data:image URL or http(s) URL) into stored bytes.
 * Returns { mimeType, data, version, sourceUrl }.
 */
async function loadAvatarPicture(picture, options = {}) {
    const value = String(picture || '').trim();
    if (!value) throw new AvatarError('empty', 'No picture');
    let img;
    let sourceUrl = '';
    if (/^data:/i.test(value)) {
        img = parseAvatarDataUrl(value, options);
    } else if (/^https?:\/\//i.test(value)) {
        img = await fetchAvatarUrl(value, options);
        sourceUrl = value.slice(0, 2048);
    } else {
        throw new AvatarError('invalid_url', 'Picture is neither an http(s) URL nor a data:image URL');
    }
    return { ...img, version: imageVersion(img.data), sourceUrl };
}

module.exports = {
    MAX_AVATAR_BYTES,
    FETCH_TIMEOUT_MS,
    MAX_REDIRECTS,
    AvatarError,
    sniffImageType,
    parseAvatarDataUrl,
    isRefusedAvatarAddress,
    makeGuardedLookup,
    fetchAvatarUrl,
    loadAvatarPicture,
    imageVersion,
};
