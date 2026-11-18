'use strict';

/**
 * Ed25519 proof-of-possession for device registration.
 *
 * Mirrors the Go server's `bd-enrollment-v1` challenge (see
 * `betterdesk-server/api/enrollment_proof.go`) so a device that already proves
 * possession to `/api/devices/register` can use the same routine here.
 *
 * Payload layout (newline separated, no trailing newline):
 *
 *   bd-enrollment-v1
 *   <METHOD>
 *   <PATH>
 *   <DEVICE_ID>
 *   <PUBLIC_KEY canonical base64>
 *   <RFC3339 timestamp>
 *   <nonce>
 *
 * The proof is deliberately bound to method + path + device id, so a captured
 * signature cannot be replayed against another endpoint or another device.
 */

const crypto = require('crypto');

const PROOF_VERSION = 'bd-enrollment-v1';
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const NONCE_MAX_LENGTH = 256;
const NONCE_TTL_MS = 10 * 60 * 1000;
const NONCE_CACHE_MAX = 20000;

const HEADER_TIMESTAMP = 'x-bd-enrollment-timestamp';
const HEADER_NONCE = 'x-bd-enrollment-nonce';
const HEADER_SIGNATURE = 'x-bd-enrollment-signature';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Device id charset accepted by the device API. */
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{3,64}$/;

const usedNonces = new Map();

function pruneNonces(now) {
    if (usedNonces.size < NONCE_CACHE_MAX) {
        for (const [key, usedAt] of usedNonces) {
            if (now - usedAt > NONCE_TTL_MS) usedNonces.delete(key);
        }
        return;
    }
    for (const [key, usedAt] of usedNonces) {
        if (now - usedAt > NONCE_TTL_MS) usedNonces.delete(key);
        if (usedNonces.size <= NONCE_CACHE_MAX / 2) break;
    }
}

/**
 * Mark a nonce as used. Returns true when it was already consumed (replay).
 */
function markNonceUsed(key, now = Date.now()) {
    pruneNonces(now);
    if (usedNonces.has(key)) return true;
    usedNonces.set(key, now);
    return false;
}

function resetNonceCache() {
    usedNonces.clear();
}

/**
 * Decode a base64 Ed25519 public key (32 raw bytes) into a KeyObject.
 * @returns {crypto.KeyObject|null}
 */
function publicKeyObjectFromBase64(encoded) {
    if (typeof encoded !== 'string' || !encoded.trim()) return null;
    let raw;
    try {
        raw = Buffer.from(encoded.trim(), 'base64');
    } catch (_) {
        return null;
    }
    if (raw.length !== 32) return null;
    try {
        const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
        return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    } catch (_) {
        return null;
    }
}

/**
 * Canonical base64 form of a raw Ed25519 public key (matches Go's
 * `canonicalizeDevicePublicKey`).
 * @returns {string|null}
 */
function canonicalizePublicKey(encoded) {
    if (typeof encoded !== 'string' || !encoded.trim()) return null;
    let raw;
    try {
        raw = Buffer.from(encoded.trim(), 'base64');
    } catch (_) {
        return null;
    }
    if (raw.length !== 32) return null;
    return raw.toString('base64');
}

function proofPayload(method, path, deviceId, canonicalKey, timestamp, nonce) {
    return Buffer.from(
        [
            PROOF_VERSION,
            String(method || '').toUpperCase(),
            String(path || ''),
            String(deviceId || ''),
            String(canonicalKey || ''),
            String(timestamp || ''),
            String(nonce || ''),
        ].join('\n'),
        'utf8'
    );
}

function readProofHeaders(req) {
    const headers = (req && req.headers) || {};
    return {
        timestamp: String(headers[HEADER_TIMESTAMP] || '').trim(),
        nonce: String(headers[HEADER_NONCE] || '').trim(),
        signature: String(headers[HEADER_SIGNATURE] || '').trim(),
    };
}

/** True when the caller attempted a proof (even a malformed one). */
function proofProvided(req) {
    const { timestamp, nonce, signature } = readProofHeaders(req);
    return Boolean(timestamp || nonce || signature);
}

function requestPath(req) {
    const base = String((req && req.baseUrl) || '');
    const path = String((req && req.path) || '');
    if (!base) return path || '/';
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Verify an Ed25519 proof of possession.
 *
 * @param {object} req Express request (headers + method + baseUrl/path).
 * @param {string} deviceId Device id the proof must be bound to.
 * @param {string} publicKeyB64 Public key that must have signed the proof.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function verifyProof(req, deviceId, publicKeyB64) {
    const { timestamp, nonce, signature } = readProofHeaders(req);
    if (!timestamp || !nonce || !signature) {
        return { ok: false, reason: 'missing_proof_headers' };
    }
    if (nonce.length > NONCE_MAX_LENGTH) {
        return { ok: false, reason: 'nonce_too_long' };
    }
    if (!DEVICE_ID_RE.test(String(deviceId || ''))) {
        return { ok: false, reason: 'invalid_device_id' };
    }

    const signedAt = Date.parse(timestamp);
    if (!Number.isFinite(signedAt)) {
        return { ok: false, reason: 'invalid_timestamp' };
    }
    if (Math.abs(Date.now() - signedAt) > CLOCK_SKEW_MS) {
        return { ok: false, reason: 'timestamp_outside_skew' };
    }

    const canonicalKey = canonicalizePublicKey(publicKeyB64);
    if (!canonicalKey) {
        return { ok: false, reason: 'invalid_public_key' };
    }
    const keyObject = publicKeyObjectFromBase64(canonicalKey);
    if (!keyObject) {
        return { ok: false, reason: 'invalid_public_key' };
    }

    let signatureBytes;
    try {
        signatureBytes = Buffer.from(signature, 'base64');
    } catch (_) {
        return { ok: false, reason: 'invalid_signature_encoding' };
    }
    if (signatureBytes.length !== 64) {
        return { ok: false, reason: 'invalid_signature_length' };
    }

    const payload = proofPayload(req.method, requestPath(req), deviceId, canonicalKey, timestamp, nonce);
    let valid = false;
    try {
        valid = crypto.verify(null, payload, keyObject, signatureBytes);
    } catch (_) {
        valid = false;
    }
    if (!valid) {
        return { ok: false, reason: 'invalid_signature' };
    }

    if (markNonceUsed(`enrollment:${deviceId}:${nonce}`)) {
        return { ok: false, reason: 'replayed_proof' };
    }
    return { ok: true };
}

module.exports = {
    PROOF_VERSION,
    CLOCK_SKEW_MS,
    NONCE_MAX_LENGTH,
    HEADER_TIMESTAMP,
    HEADER_NONCE,
    HEADER_SIGNATURE,
    DEVICE_ID_RE,
    canonicalizePublicKey,
    proofPayload,
    proofProvided,
    publicKeyObjectFromBase64,
    readProofHeaders,
    requestPath,
    resetNonceCache,
    verifyProof,
};
