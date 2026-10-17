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
                if (!['api.github.com', 'github.com', 'objects.githubusercontent.com']
                    .includes(next.hostname)) {
                    response.resume();
                    reject(new Error('generic_agent_release_redirect_host_invalid'));
                    return;
                }
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

async function importLatest() {
    const release = await fetchLatestRelease();
    const manifestAsset = release.assets?.find((asset) => asset.name === 'manifest.json');
    const sumsAsset = release.assets?.find((asset) => asset.name === 'SHA256SUMS');
    const signatureAsset = release.assets?.find((asset) => asset.name === 'manifest.sig');
    if (!manifestAsset || !sumsAsset || !signatureAsset) {
        throw new Error('generic_agent_release_manifest_missing');
    }

    const manifestFile = await downloadAsset(manifestAsset);
    const sumsFile = await downloadAsset(sumsAsset);
    const signatureFile = await downloadAsset(signatureAsset);
    const publicKeyText = String(
        process.env.BETTERDESK_SUPPORT_RELEASE_PUBLIC_KEY || DEFAULT_RELEASE_PUBLIC_KEY
    ).trim();
    if (!publicKeyText) throw new Error('generic_agent_release_public_key_missing');
    let signature;
    let publicKey;
    try {
        signature = Buffer.from(signatureFile.body.toString('utf8').trim(), 'base64');
        publicKey = Buffer.from(publicKeyText, 'base64');
    } catch (_) {
        throw new Error('generic_agent_release_signature_invalid');
    }
    if (
        publicKey.length !== nacl.sign.publicKeyLength
        || signature.length !== nacl.sign.signatureLength
        || !nacl.sign.detached.verify(
            new Uint8Array(manifestFile.body),
            new Uint8Array(signature),
            new Uint8Array(publicKey)
        )
    ) {
        throw new Error('generic_agent_release_signature_invalid');
    }
    const manifest = JSON.parse(manifestFile.body.toString('utf8'));
    if (manifest.schema_version !== 1
        || manifest.sku !== 'betterdesk-support'
        || manifest.generic !== true
        || manifest.external_config !== false
        || !Array.isArray(manifest.assets)
        || !manifest.assets.length) {
        throw new Error('generic_agent_release_manifest_invalid');
    }

    const checksums = new Map(
        sumsFile.body.toString('utf8').split(/\r?\n/).map((line) => {
            const match = /^([a-f0-9]{64})\s+\*?([A-Za-z0-9._-]+)$/.exec(line.trim());
            return match ? [match[2], match[1]] : null;
        }).filter(Boolean)
    );
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

    const destination = path.join(root(), release.tag_name);
    const staging = `${destination}.tmp-${process.pid}-${Date.now()}`;
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.mkdir(staging, { recursive: true, mode: 0o750 });
    await Promise.all(files.map((file) => fsp.writeFile(
        path.join(staging, file.name),
        file.body,
        { mode: 0o640 }
    )));
    await fsp.writeFile(path.join(staging, 'manifest.json'), JSON.stringify({
        ...manifest,
        release_tag: release.tag_name,
        imported_at: new Date().toISOString(),
    }, null, 2) + '\n', { mode: 0o640 });
    await fsp.rename(staging, destination);
    return { tag: release.tag_name, manifest, path: destination };
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
};
