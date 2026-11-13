'use strict';

/**
 * Signed update manifest verification (audit H8, 2026-11-13).
 *
 * In-app updates download a commit tree from GitHub and overwrite console files
 * as the service user. Integrity today is TLS + "it came from GitHub"; there is
 * no cryptographic proof that a given file set was published by the project.
 * Combined with a root-run Go server that is a supply-chain path to host root.
 *
 * This module verifies a detached Ed25519 signature over a canonical manifest
 * describing exactly which files (path + sha256) an update may write.
 *
 * Modes:
 *   - verified:  `UPDATE_MANIFEST_PUBLIC_KEY` is set and a valid signature is
 *                present → update proceeds.
 *   - unsigned:  no key configured. The update proceeds only when signatures are
 *                not required; a warning is recorded either way so operators can
 *                see the gap on the Updates page.
 *   - rejected:  a key is configured (or signatures are required) and the
 *                signature is missing/invalid → update is refused.
 *
 * `UPDATE_REQUIRE_SIGNED_MANIFEST=true` forces the verified path. Enable it on
 * the stable channel once release signing is published; until then a strict
 * default would silently stop every installation from updating.
 */

const crypto = require('crypto');

const ENV_PUBLIC_KEY = 'UPDATE_MANIFEST_PUBLIC_KEY';
const ENV_REQUIRE = 'UPDATE_REQUIRE_SIGNED_MANIFEST';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Manifest keys that participate in the signature, in canonical order. */
const SIGNED_FIELDS = ['branch', 'owner', 'repo', 'sha', 'files'];

function isSignatureRequired() {
    const raw = String(process.env[ENV_REQUIRE] || '').trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes';
}

function configuredPublicKey() {
    const raw = String(process.env[ENV_PUBLIC_KEY] || '').trim();
    if (!raw) return null;
    let bytes;
    try {
        bytes = Buffer.from(raw, 'base64');
    } catch (_) {
        return null;
    }
    return bytes.length === 32 ? bytes : null;
}

/**
 * Canonical, newline-delimited representation of the signed payload.
 * Files are sorted by path so two equivalent manifests never disagree.
 *
 * @param {{ owner?: string, repo?: string, branch?: string, sha?: string,
 *   files: Array<{ path: string, sha256: string }> }} manifest
 * @returns {Buffer}
 */
function canonicalPayload(manifest) {
    const files = (manifest && Array.isArray(manifest.files) ? manifest.files : [])
        .map((file) => ({
            path: String((file && file.path) || '').replace(/\\/g, '/'),
            sha256: String((file && file.sha256) || '').toLowerCase(),
        }))
        .filter((file) => file.path && file.sha256)
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const lines = [
        'betterdesk-update-manifest-v1',
        `owner=${String(manifest?.owner || '')}`,
        `repo=${String(manifest?.repo || '')}`,
        `branch=${String(manifest?.branch || '')}`,
        `sha=${String(manifest?.sha || '')}`,
        `files=${files.length}`,
    ];
    for (const file of files) {
        lines.push(`${file.sha256}  ${file.path}`);
    }
    return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

function publicKeyObject(rawBytes) {
    try {
        const der = Buffer.concat([ED25519_SPKI_PREFIX, rawBytes]);
        return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    } catch (_) {
        return null;
    }
}

/**
 * Verify a detached base64 Ed25519 signature over the canonical manifest.
 *
 * @param {object} manifest
 * @param {string|Buffer} signature Base64 signature (64 bytes when decoded).
 * @param {Buffer} [publicKeyBytes] Raw 32-byte key; defaults to configuration.
 * @returns {boolean}
 */
function verifyManifestSignature(manifest, signature, publicKeyBytes) {
    const keyBytes = publicKeyBytes || configuredPublicKey();
    if (!keyBytes) return false;

    const sigText = Buffer.isBuffer(signature) ? signature.toString('utf8') : String(signature || '');
    let signatureBytes;
    try {
        signatureBytes = Buffer.from(sigText.trim(), 'base64');
    } catch (_) {
        return false;
    }
    if (signatureBytes.length !== 64) return false;

    const keyObject = publicKeyObject(keyBytes);
    if (!keyObject) return false;

    try {
        return crypto.verify(null, canonicalPayload(manifest), keyObject, signatureBytes);
    } catch (_) {
        return false;
    }
}

/**
 * Decide whether an update may be applied.
 *
 * @param {{ manifest?: object, signature?: string|null }} input
 * @returns {{ ok: boolean, verified: boolean, reason?: string, code?: string }}
 */
function evaluateUpdateTrust({ manifest, signature } = {}) {
    const keyConfigured = Boolean(configuredPublicKey());
    const required = isSignatureRequired();

    if (!manifest) {
        if (keyConfigured || required) {
            return {
                ok: false,
                verified: false,
                code: 'manifest_missing',
                reason: 'A signed update manifest is required but none was provided.',
            };
        }
        return {
            ok: true,
            verified: false,
            code: 'manifest_absent_unsigned',
            reason: 'Update ran without a signed manifest (UPDATE_MANIFEST_PUBLIC_KEY is not set).',
        };
    }

    if (signature && keyConfigured) {
        if (verifyManifestSignature(manifest, signature)) {
            return { ok: true, verified: true };
        }
        return {
            ok: false,
            verified: false,
            code: 'signature_invalid',
            reason: 'Update manifest signature did not verify against the configured public key.',
        };
    }

    if (required) {
        return {
            ok: false,
            verified: false,
            code: 'signature_required',
            reason: 'UPDATE_REQUIRE_SIGNED_MANIFEST is enabled but the update carried no valid signature.',
        };
    }

    return {
        ok: true,
        verified: false,
        code: 'unsigned_allowed',
        reason: 'Update manifest was not signed; proceeding because signatures are not required.',
    };
}

module.exports = {
    ENV_PUBLIC_KEY,
    ENV_REQUIRE,
    SIGNED_FIELDS,
    canonicalPayload,
    configuredPublicKey,
    evaluateUpdateTrust,
    isSignatureRequired,
    verifyManifestSignature,
};
