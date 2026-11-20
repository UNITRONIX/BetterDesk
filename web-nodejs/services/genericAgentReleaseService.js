/**
 * Local cache for generic BetterDesk Support Agent GitHub Releases.
 *
 * The console never builds the client in this path. It imports a release,
 * verifies the manifest/checksums, stores it outside the web source tree, and
 * serves only the verified local copy.
 */
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const nacl = require('tweetnacl');
const config = require('../config/config');

const DEFAULT_REPO = 'UNITRONIX/BetterDesk-Client';
const RELEASE_PREFIX = 'support-v';
const MAX_RELEASE_BYTES = 2 * 1024 * 1024 * 1024;
// Public half of the protected GitHub Actions release-signing key.
// An environment override is supported for rotation and staged migration.
const DEFAULT_RELEASE_PUBLIC_KEY = 'eXGPOvUvFfz1FGGbYogKfYEEWVWzeJEKpmI1ngAU490=';
/** Literal host map so CodeQL sees an untainted hostname after allowlist lookup (parity with supportGeneratorModule). */
const GITHUB_FETCH_HOSTS = Object.freeze({
    'api.github.com': 'api.github.com',
    'github.com': 'github.com',
    'objects.githubusercontent.com': 'objects.githubusercontent.com',
    // GitHub Release asset CDN — browser_download_url redirects here in production.
    'release-assets.githubusercontent.com': 'release-assets.githubusercontent.com',
});

function resolveAllowedGithubHost(hostname) {
    const allowed = GITHUB_FETCH_HOSTS[String(hostname || '').toLowerCase()];
    if (!allowed) return null;
    return allowed;
}

function root() {
    return path.join(
        config.dataDir || path.join(__dirname, '..', 'data'),
        'modules',
        'betterdesk-support-releases'
    );
}

function safeName(name) {
    return typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name) ? name : '';
}

function repo() {
    return String(process.env.BETTERDESK_SUPPORT_RELEASE_REPO || DEFAULT_REPO).trim();
}

function signingKeyFingerprint() {
    const publicKey = String(
        process.env.BETTERDESK_SUPPORT_RELEASE_PUBLIC_KEY || DEFAULT_RELEASE_PUBLIC_KEY
    ).trim();
    return crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
}

function githubRequest(url, headers = {}, redirects = 0) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            headers: {
                'User-Agent': 'BetterDesk-Console-Support-Releases',
                Accept: 'application/vnd.github+json',
                ...headers,
            },
            timeout: 30_000,
        }, (response) => {
            if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
                if (redirects >= 3) {
                    response.resume();
                    reject(new Error('generic_agent_release_redirect_limit'));
                    return;
                }
                const next = new URL(response.headers.location, url);
                const allowedHost = resolveAllowedGithubHost(next.hostname);
                if (!allowedHost) {
                    response.resume();
                    reject(new Error('generic_agent_release_redirect_host_invalid'));
                    return;
                }
                next.hostname = allowedHost;
                response.resume();
                githubRequest(next.toString(), headers, redirects + 1).then(resolve, reject);
                return;
            }
            const chunks = [];
            let size = 0;
            response.on('data', (chunk) => {
                size += chunk.length;
                if (size <= MAX_RELEASE_BYTES) chunks.push(chunk);
            });
            response.on('end', () => resolve({
                statusCode: response.statusCode || 0,
                headers: response.headers,
                body: Buffer.concat(chunks),
                tooLarge: size > MAX_RELEASE_BYTES,
            }));
        });
        request.on('error', reject);
        request.on('timeout', () => {
            request.destroy();
            reject(new Error('generic_agent_release_timeout'));
        });
    });
}

async function fetchLatestRelease() {
    const response = await githubRequest(
        `https://api.github.com/repos/${repo()}/releases?per_page=30`
    );
    if (response.statusCode !== 200 || response.tooLarge) {
        throw new Error(`generic_agent_release_list_failed:${response.statusCode}`);
    }
    const releases = JSON.parse(response.body.toString('utf8'));
    const release = releases.find((item) => (
        !item.draft
        && !item.prerelease
        && String(item.tag_name || '').startsWith(RELEASE_PREFIX)
    ));
    if (!release) throw new Error('generic_agent_release_not_found');
    return release;
}

async function downloadAsset(asset) {
    const name = safeName(asset?.name);
    const url = String(asset?.browser_download_url || '');
    if (!name || !/^https:\/\/api\.github\.com\/|^https:\/\/github\.com\//.test(url)) {
        throw new Error('generic_agent_release_asset_invalid');
    }
    const response = await githubRequest(url, { Accept: 'application/octet-stream' });
    if (response.statusCode !== 200 || response.tooLarge) {
        throw new Error(`generic_agent_release_asset_download_failed:${name}`);
    }
    return { name, body: response.body };
}

function checksum(file) {
    return crypto.createHash('sha256').update(file).digest('hex');
}

function assertNoExternalConfig(fileName, file) {
    if (fileName.endsWith('.zip')) {
        const zip = new AdmZip(file);
        for (const entry of zip.getEntries()) {
            const entryName = String(entry.entryName || '').replace(/\\/g, '/').toLowerCase();
            if (entryName.endsWith('/custom.txt') || entryName.endsWith('/.custom-txt-here')) {
                throw new Error('generic_agent_release_external_config');
            }
        }
        return;
    }
    if (fileName.endsWith('.tar.gz')) {
        const listed = spawnSync('tar', ['-tzf', '-'], {
            input: file,
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024,
        });
        if (listed.error || listed.status !== 0) {
            throw new Error('generic_agent_release_archive_invalid');
        }
        for (const line of listed.stdout.split(/\r?\n/)) {
            const entryName = line.replace(/\\/g, '/').toLowerCase();
            if (entryName.endsWith('/custom.txt') || entryName.endsWith('/.custom-txt-here')) {
                throw new Error('generic_agent_release_external_config');
            }
        }
    }
}

function releasePublicKey() {
    const publicKeyText = String(
        process.env.BETTERDESK_SUPPORT_RELEASE_PUBLIC_KEY || DEFAULT_RELEASE_PUBLIC_KEY
    ).trim();
    if (!publicKeyText) throw new Error('generic_agent_release_public_key_missing');
    return Buffer.from(publicKeyText, 'base64');
}

/**
 * Verify a signed release manifest. Shared by the download path and the
 * idempotent cache path: a cached release is only trusted again after its
 * stored signature has been re-checked, so a tampered cache is never served.
 */
function verifyReleaseSignature(manifestBody, sumsBody, signatureBody) {
    let signature;
    let publicKey;
    try {
        publicKey = releasePublicKey();
        signature = Buffer.from(String(signatureBody || '').trim(), 'base64');
    } catch (error) {
        if (error && error.message === 'generic_agent_release_public_key_missing') throw error;
        throw new Error('generic_agent_release_signature_invalid');
    }
    if (
        publicKey.length !== nacl.sign.publicKeyLength
        || signature.length !== nacl.sign.signatureLength
        || !nacl.sign.detached.verify(
            new Uint8Array(manifestBody),
            new Uint8Array(signature),
            new Uint8Array(publicKey)
        )
    ) {
        throw new Error('generic_agent_release_signature_invalid');
    }
    const checksums = new Map(
        String(sumsBody || '').split(/\r?\n/).map((line) => {
            const match = /^([a-f0-9]{64})\s+\*?([A-Za-z0-9._-]+)$/.exec(line.trim());
            return match ? [match[2], match[1]] : null;
        }).filter(Boolean)
    );
    return checksums;
}

/**
 * Return the cached release when the same tag is already installed.
 *
 * Issue #515: importLatest() used to re-download all six assets (~181 MB) and
 * then fail on rename(staging, destination) with ENOTEMPTY when the tag was
 * already present. Besides being slow, every failure leaked a staging
 * directory. The cache is only reused after the stored signature and
 * checksums have been verified again.
 */
async function reuseCachedRelease(release) {
    const destination = path.join(root(), release.tag_name);
    // The signature covers the manifest exactly as published. manifest.json is
    // an enriched copy (release_tag, imported_at), so verification has to use
    // the stored original bytes.
    const signedPath = path.join(destination, 'manifest.signed');
    const manifestPath = path.join(destination, 'manifest.json');
    try {
        const [signedBody, sumsBody, signatureBody] = await Promise.all([
            fsp.readFile(signedPath),
            fsp.readFile(path.join(destination, 'SHA256SUMS')),
            fsp.readFile(path.join(destination, 'manifest.sig')),
        ]);
        const checksums = verifyReleaseSignature(signedBody, sumsBody, signatureBody);
        const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
        if (!manifest || manifest.release_tag !== release.tag_name
            || manifest.schema_version !== 1
            || manifest.sku !== 'betterdesk-support'
            || manifest.generic !== true
            || !Array.isArray(manifest.assets)) {
            return null;
        }
        // The enriched copy must describe exactly the same assets as the signed
        // one, so editing manifest.json cannot change what gets served.
        const signed = JSON.parse(signedBody.toString('utf8'));
        const project = (list) => (list || [])
            .map((asset) => `${asset.name}:${String(asset.sha256 || '').toLowerCase()}:${asset.size}`)
            .sort();
        if (JSON.stringify(project(signed.assets)) !== JSON.stringify(project(manifest.assets))) {
            return null;
        }
        // Every asset must still be present and match its checksum, so a
        // partially deleted or modified cache is re-imported instead of served.
        for (const asset of manifest.assets) {
            const name = safeName(asset.name);
            const expected = checksums.get(name);
            if (!name || !expected || String(expected).toLowerCase() !== String(asset.sha256 || '').toLowerCase()) {
                return null;
            }
            const filePath = path.join(destination, name);
            const digest = checksum(await fsp.readFile(filePath));
            if (digest !== expected) return null;
        }
        return { tag: release.tag_name, manifest, path: destination, alreadyImported: true };
    } catch (_) {
        // Missing, unreadable, tampered or unverifiable -> fall through to a
        // full re-import. Never surface a half-trusted cache entry.
        return null;
    }
}

async function importLatest(options = {}) {
    const force = options.force === true;
    const release = await fetchLatestRelease();
    const tagName = safeName(release.tag_name);
    if (!tagName || !String(release.tag_name).startsWith(RELEASE_PREFIX)) {
        // The tag becomes a path segment; never let an unexpected value through.
        throw new Error('generic_agent_release_tag_invalid');
    }
    const releaseTag = String(release.tag_name);
    const manifestAsset = release.assets?.find((asset) => asset.name === 'manifest.json');
    const sumsAsset = release.assets?.find((asset) => asset.name === 'SHA256SUMS');
    const signatureAsset = release.assets?.find((asset) => asset.name === 'manifest.sig');
    if (!manifestAsset || !sumsAsset || !signatureAsset) {
        throw new Error('generic_agent_release_manifest_missing');
    }

    const destination = path.join(root(), releaseTag);
    if (!force) {
        const cached = await reuseCachedRelease(release);
        if (cached) return cached;
    }

    const manifestFile = await downloadAsset(manifestAsset);
    const sumsFile = await downloadAsset(sumsAsset);
    const signatureFile = await downloadAsset(signatureAsset);
    const checksums = verifyReleaseSignature(
        manifestFile.body,
        sumsFile.body.toString('utf8'),
        signatureFile.body.toString('utf8')
    );
    const manifest = JSON.parse(manifestFile.body.toString('utf8'));
    if (manifest.schema_version !== 1
        || manifest.sku !== 'betterdesk-support'
        || manifest.generic !== true
        || manifest.external_config !== false
        || !Array.isArray(manifest.assets)
        || !manifest.assets.length) {
        throw new Error('generic_agent_release_manifest_invalid');
    }

    const files = [];
    for (const asset of manifest.assets) {
        const name = safeName(asset.name);
        if (!name || !/^[a-f0-9]{64}$/i.test(String(asset.sha256 || ''))) {
            throw new Error('generic_agent_release_asset_invalid');
        }
        const downloaded = await downloadAsset(
            release.assets.find((candidate) => candidate.name === name)
        );
        const digest = checksum(downloaded.body);
        if (
            digest !== String(asset.sha256).toLowerCase()
            || checksums.get(name) !== digest
            || downloaded.body.length !== asset.size
        ) {
            throw new Error(`generic_agent_release_checksum_mismatch:${name}`);
        }
        assertNoExternalConfig(name, downloaded.body);
        files.push(downloaded);
    }

    // Issue #515: staging is always removed. Previously a failure here (for
    // example ENOTEMPTY on rename) left one ~181 MB directory behind per
    // attempt, and nothing ever cleaned them up.
    const staging = `${destination}.tmp-${process.pid}-${Date.now()}`;
    await fsp.rm(staging, { recursive: true, force: true });
    try {
        await fsp.mkdir(staging, { recursive: true, mode: 0o750 });
        await Promise.all(files.map((file) => fsp.writeFile(
            path.join(staging, file.name),
            file.body,
            { mode: 0o640 }
        )));
        // Keep the signature, the signed manifest bytes and the checksums next
        // to the manifest: the idempotent path above re-verifies them instead
        // of trusting the cache. manifest.json itself is an enriched copy.
        await fsp.writeFile(
            path.join(staging, 'manifest.signed'),
            manifestFile.body,
            { mode: 0o640 }
        );
        await fsp.writeFile(
            path.join(staging, 'manifest.sig'),
            signatureFile.body,
            { mode: 0o640 }
        );
        await fsp.writeFile(
            path.join(staging, 'SHA256SUMS'),
            sumsFile.body,
            { mode: 0o640 }
        );
        await fsp.writeFile(path.join(staging, 'manifest.json'), JSON.stringify({
            ...manifest,
            release_tag: releaseTag,
            imported_at: new Date().toISOString(),
        }, null, 2) + '\n', { mode: 0o640 });

        if (force) {
            // Explicit re-import: replace the existing tag atomically. The old
            // directory is moved aside first so a partial state is impossible,
            // and only the derived backup path is deleted afterwards.
            const previous = `${destination}.old-${process.pid}-${Date.now()}`;
            const existed = await fsp.stat(destination).then(() => true).catch(() => false);
            if (existed) await fsp.rename(destination, previous);
            try {
                await fsp.rename(staging, destination);
            } catch (error) {
                if (existed) await fsp.rename(previous, destination).catch(() => {});
                throw error;
            }
            if (existed) {
                await fsp.rm(previous, { recursive: true, force: true }).catch(() => {});
            }
        } else {
            // An untrusted cache (missing manifest, modified asset, bad
            // signature) must be replaced, not merged into. rename(2) cannot
            // overwrite a non-empty directory, which is the ENOTEMPTY failure
            // from issue #515, so the stale tree is moved aside first.
            const stale = await fsp.stat(destination).then(() => true).catch(() => false);
            if (stale) {
                const previous = `${destination}.old-${process.pid}-${Date.now()}`;
                await fsp.rename(destination, previous);
                try {
                    await fsp.rename(staging, destination);
                } catch (error) {
                    await fsp.rename(previous, destination).catch(() => {});
                    throw error;
                }
                await fsp.rm(previous, { recursive: true, force: true }).catch(() => {});
            } else {
                await fsp.rename(staging, destination);
            }
        }
    } finally {
        // Only ever the staging path - never `destination`.
        await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
    return { tag: releaseTag, manifest, path: destination, alreadyImported: false };
}

async function listCached() {
    try {
        const entries = await fsp.readdir(root(), { withFileTypes: true });
        const releases = [];
        for (const entry of entries.filter((item) => item.isDirectory())) {
            try {
                const manifest = JSON.parse(await fsp.readFile(
                    path.join(root(), entry.name, 'manifest.json'),
                    'utf8'
                ));
                releases.push({ tag: entry.name, imported_at: manifest.imported_at, manifest });
            } catch (_) { /* ignore incomplete cache entries */ }
        }
        return releases.sort((a, b) => String(b.tag).localeCompare(String(a.tag)));
    } catch (_) {
        return [];
    }
}

async function resolveAsset(tag, name) {
    const safeTag = safeName(tag);
    const safeAsset = safeName(name);
    if (!safeTag || !safeAsset) return null;
    const candidate = path.join(root(), safeTag, safeAsset);
    const relative = path.relative(root(), candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    try {
        const stat = await fsp.stat(candidate);
        return stat.isFile() ? candidate : null;
    } catch (_) {
        return null;
    }
}

module.exports = {
    root,
    signingKeyFingerprint,
    importLatest,
    listCached,
    resolveAsset,
    resolveAllowedGithubHost,
    GITHUB_FETCH_HOSTS,
};
