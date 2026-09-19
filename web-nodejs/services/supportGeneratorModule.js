/**
 * BetterDesk Support Generator module install gate.
 *
 * Downloads portable desktop templates from BetterDesk-Client GitHub Releases
 * into `{dataDir}/modules/betterdesk-support-generator/` and tracks install state.
 */

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

const config = require('../config/config');

const MODULE_ID = 'betterdesk-support-generator';
const DEFAULT_CLIENT_REPO = 'UNITRONIX/BetterDesk-Client';
const STATE_STATUSES = new Set(['not_installed', 'downloading', 'ready', 'error']);
const SIGNING_SEED_NAME = 'custom-client-signing.seed';
const MIN_BINARY_SIZE = 32 * 1024;
const REQUIRED_TEMPLATES = Object.freeze([
    'windows-x86_64',
    'windows-aarch64',
    'linux-x86_64',
    'linux-aarch64',
    'macos-x86_64',
    'macos-aarch64',
]);
let installPromise = null;

function moduleDir() {
    return path.join(config.dataDir || path.join(__dirname, '..', 'data'), 'modules', MODULE_ID);
}

function statePath() {
    return path.join(moduleDir(), 'state.json');
}

function templatesDir() {
    return path.join(moduleDir(), 'templates');
}

function signingSeedPath() {
    return path.join(moduleDir(), SIGNING_SEED_NAME);
}

function _isSafeRelativePath(value) {
    if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false;
    const normalized = value.replace(/\\/g, '/');
    return !normalized.split('/').includes('..') && !/^[a-zA-Z]:/.test(normalized);
}

function _findFile(root, name) {
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (entry.name === name) return full;
        }
    }
    return null;
}

function _readManifestAt(root) {
    const manifestPath = path.join(root, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function _assertNoSymlinks(root) {
    const stack = [root];
    while (stack.length) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            const stat = fs.lstatSync(full);
            if (stat.isSymbolicLink()) throw new Error('generator_archive_symlink');
            if (stat.isDirectory()) stack.push(full);
        }
    }
}

function validateTemplates(root) {
    const manifest = _readManifestAt(root);
    if (!manifest || manifest.schema_version !== 2 || manifest.sku !== 'generator-templates') {
        throw new Error('generator_manifest_invalid');
    }
    _assertNoSymlinks(root);
    const declared = Array.isArray(manifest.required_platforms)
        ? manifest.required_platforms.slice().sort()
        : [];
    if (declared.join('|') !== REQUIRED_TEMPLATES.slice().sort().join('|')) {
        throw new Error('generator_manifest_platforms_invalid');
    }

    const entries = Array.isArray(manifest.templates) ? manifest.templates : [];
    const portable = new Set();
    for (const entry of entries) {
        if (entry?.format !== 'portable') continue;
        const key = `${entry.platform}-${entry.arch}`;
        if (portable.has(key)) throw new Error(`generator_template_duplicate:${key}`);
        portable.add(key);
        if (!_isSafeRelativePath(entry.template_path)) {
            throw new Error(`generator_template_path_invalid:${key}`);
        }
        const templateRoot = path.resolve(root, entry.template_path);
        if (!templateRoot.startsWith(`${path.resolve(root)}${path.sep}`)) {
            throw new Error(`generator_template_path_escape:${key}`);
        }
        if (!fs.existsSync(templateRoot) || !fs.statSync(templateRoot).isDirectory()) {
            throw new Error(`generator_template_missing:${key}`);
        }
        if (!_findFile(templateRoot, '.custom-txt-here')) {
            throw new Error(`generator_template_marker_missing:${key}`);
        }
        if (_findFile(templateRoot, 'custom.txt')) {
            throw new Error(`generator_template_contains_custom_txt:${key}`);
        }
        if (!_isSafeRelativePath(entry.binary_path)) {
            throw new Error(`generator_template_binary_path_invalid:${key}`);
        }
        const binary = path.resolve(templateRoot, entry.binary_path);
        if (!binary.startsWith(`${templateRoot}${path.sep}`)
            || !fs.existsSync(binary)
            || !fs.statSync(binary).isFile()
            || fs.statSync(binary).size < MIN_BINARY_SIZE) {
            throw new Error(`generator_template_binary_missing:${key}`);
        }
        if (!/^[a-f0-9]{64}$/i.test(String(entry.sha256 || ''))) {
            throw new Error(`generator_template_hash_invalid:${key}`);
        }
        if (!_isSafeRelativePath(entry.archive)) {
            throw new Error(`generator_template_archive_path_invalid:${key}`);
        }
        const archive = path.resolve(root, entry.archive);
        if (!archive.startsWith(`${path.resolve(root)}${path.sep}`)
            || !fs.existsSync(archive)
            || !fs.statSync(archive).isFile()) {
            throw new Error(`generator_template_archive_missing:${key}`);
        }
    }
    if (portable.size !== REQUIRED_TEMPLATES.length) {
        throw new Error('generator_manifest_templates_incomplete');
    }
    return { manifest, templateCount: portable.size };
}

function clientRepo() {
    return String(process.env.BETTERDESK_CLIENT_REPO || DEFAULT_CLIENT_REPO).trim()
        || DEFAULT_CLIENT_REPO;
}

function defaultState() {
    return {
        termsAccepted: false,
        installedVersion: null,
        status: 'not_installed',
        error: null,
        installedAt: null,
        manifestVersion: null,
        templateCount: 0,
    };
}

async function ensureModuleDir() {
    await fsp.mkdir(moduleDir(), { recursive: true });
}

async function readState() {
    await ensureModuleDir();
    try {
        const raw = await fsp.readFile(statePath(), 'utf8');
        const parsed = JSON.parse(raw);
        const base = defaultState();
        return {
            ...base,
            ...parsed,
            status: STATE_STATUSES.has(parsed.status) ? parsed.status : base.status,
            termsAccepted: !!parsed.termsAccepted,
        };
    } catch (_) {
        return defaultState();
    }
}

async function writeState(patch) {
    await ensureModuleDir();
    const current = await readState();
    const next = {
        ...current,
        ...patch,
    };
    if (!STATE_STATUSES.has(next.status)) next.status = current.status;
    await fsp.writeFile(
        statePath(),
        JSON.stringify(next, null, 2) + '\n',
        { encoding: 'utf8', mode: 0o600 },
    );
    return next;
}

function templatesExist() {
    const root = templatesDir();
    if (!fs.existsSync(root)) return false;
    try {
        validateTemplates(root);
        return true;
    } catch (_) {
        return false;
    }
}

/** True when at least one platform tree contains a BetterDesk desktop binary. */
function templatesHaveBinaries() {
    const root = templatesDir();
    return templatesExist() && fs.existsSync(root);
}

function isReady(state) {
    const s = state || (fs.existsSync(statePath())
        ? JSON.parse(fs.readFileSync(statePath(), 'utf8'))
        : defaultState());
    return !!(
        s.termsAccepted
        && s.status === 'ready'
        && templatesExist()
        && isSigningSeedValid()
    );
}

async function getStatus() {
    const state = await readState();
    const binariesPresent = templatesHaveBinaries();
    let manifest = null;
    let manifestError = null;
    try {
        const result = validateTemplates(templatesDir());
        manifest = result.manifest;
    } catch (err) {
        manifestError = err.message || String(err);
    }
    return {
        ...state,
        moduleDir: moduleDir(),
        templatesDir: templatesDir(),
        templatesPresent: templatesExist(),
        binariesPresent,
        buildsPossible: binariesPresent,
        signingSeedPresent: isSigningSeedValid(),
        manifestValid: !!manifest,
        manifestError,
        templateCount: manifest ? manifest.templates.length : 0,
        ready: isReady(state),
        clientRepo: clientRepo(),
        warning: !binariesPresent
            ? 'Templates are missing, invalid, or incomplete. '
              + 'Publish a complete Client release and reinstall.'
            : !isSigningSeedValid()
                ? 'Signing seed is missing or invalid; production Support builds are disabled.'
                : null,
    };
}

function isSigningSeedValid() {
    if (!fs.existsSync(signingSeedPath())) return false;
    try {
        const value = fs.readFileSync(signingSeedPath(), 'utf8').trim();
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
        return Buffer.from(value, 'base64').length === 32;
    } catch (_) {
        return false;
    }
}

async function acceptTerms() {
    return writeState({ termsAccepted: true, error: null });
}

function _githubHeaders(accept) {
    const headers = {
        'User-Agent': 'BetterDesk-Console-Generator',
        Accept: accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    const token = String(process.env.BETTERDESK_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '').trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

function _httpGetBuffer(url, redirects = 0, accept) {
    return new Promise((resolve, reject) => {
        if (redirects > 8) {
            reject(new Error('too many redirects'));
            return;
        }
        const lib = String(url).startsWith('https:') ? https : http;
        const req = lib.get(url, {
            headers: _githubHeaders(accept || 'application/octet-stream, application/json'),
            timeout: 120000,
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                _httpGetBuffer(res.headers.location, redirects + 1, accept).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                const err = new Error(`HTTP ${res.statusCode} for ${url}`);
                err.statusCode = res.statusCode;
                reject(err);
                return;
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('download timeout'));
        });
    });
}

async function _httpGetJson(url) {
    const buf = await _httpGetBuffer(url, 0, 'application/vnd.github+json');
    return JSON.parse(buf.toString('utf8'));
}

/**
 * Resolve a GitHub release that carries generator-templates-*.tar.gz.
 * Prefers /releases/latest, then env tag, then newest release with the asset.
 */
async function _resolveRelease(targetRepo, preferredTag) {
    const apiBase = `https://api.github.com/repos/${targetRepo}/releases`;
    const envTag = String(
        preferredTag
        || process.env.BETTERDESK_CLIENT_RELEASE_TAG
        || ''
    ).trim();

    async function loadTag(tag) {
        return _httpGetJson(`${apiBase}/tags/${encodeURIComponent(tag)}`);
    }

    if (envTag) {
        const release = await loadTag(envTag);
        if (_pickTemplateAsset(release.assets || [])) return release;
        const err = new Error(
            `Release ${envTag} on ${targetRepo} has no generator-templates-*.tar.gz asset`
        );
        err.code = 'no_template_asset';
        throw err;
    }

    try {
        const latest = await _httpGetJson(`${apiBase}/latest`);
        if (_pickTemplateAsset(latest.assets || [])) return latest;
    } catch (err) {
        if (err.statusCode && err.statusCode !== 404) throw err;
    }

    // /latest is missing or has no asset — scan recent releases (incl. prereleases).
    const list = await _httpGetJson(`${apiBase}?per_page=30`);
    if (!Array.isArray(list) || list.length === 0) {
        const err = new Error(
            `No GitHub releases found for ${targetRepo}. `
            + 'Publish a release with generator-templates-*.tar.gz '
            + '(workflow betterdesk-desktop-release.yml, tag desktop/*), '
            + 'or set BETTERDESK_CLIENT_RELEASE_TAG.'
        );
        err.code = 'no_release';
        throw err;
    }

    for (const release of list) {
        if (_pickTemplateAsset(release.assets || [])) return release;
    }

    const err = new Error(
        `No generator-templates-*.tar.gz found in the last ${list.length} releases of ${targetRepo}. `
        + 'Run Client CI workflow betterdesk-desktop-release.yml or attach the archive to a release.'
    );
    err.code = 'no_template_asset';
    throw err;
}

function _runTar(args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn('tar', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(`tar failed (${code}): ${stderr.trim() || 'unknown'}`));
        });
    });
}

async function _extractTarGz(archivePath, destDir) {
    await fsp.mkdir(destDir, { recursive: true });
    const listing = await _runTar(['-tzf', archivePath], path.dirname(archivePath));
    for (const raw of listing.split(/\r?\n/).filter(Boolean)) {
        const entry = raw.replace(/\\/g, '/');
        if (entry.startsWith('/') || /^[a-zA-Z]:/.test(entry)
            || entry.split('/').includes('..')) {
            throw new Error('generator_archive_path_traversal');
        }
    }
    await _runTar(['-xzf', archivePath, '-C', destDir]);
}

async function _rimraf(target) {
    await fsp.rm(target, { recursive: true, force: true });
}

async function _sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest('hex');
}

function _checksumAsset(assets, archiveName) {
    const list = Array.isArray(assets) ? assets : [];
    return list.find((asset) => (
        asset.name === `${archiveName}.sha256`
        || asset.name === `${archiveName}.sha256sum`
    )) || list.find((asset) => (
        /generator-templates.*\.sha256(?:sum)?$/i.test(asset.name || '')
    )) || null;
}

async function _verifyArchive(archivePath, asset, assets) {
    const expectedFromApi = String(asset?.digest || '').match(/^sha256:([a-f0-9]{64})$/i)?.[1];
    let expected = expectedFromApi;
    const checksumAsset = _checksumAsset(assets, asset?.name);
    if (!expected && checksumAsset?.browser_download_url) {
        const checksum = await _httpGetBuffer(checksumAsset.browser_download_url, 0, 'text/plain');
        expected = checksum.toString('utf8').match(/\b[a-f0-9]{64}\b/i)?.[0];
    }
    if (!expected) throw new Error('generator_archive_checksum_missing');
    const actual = await _sha256File(archivePath);
    if (actual.toLowerCase() !== expected.toLowerCase()) {
        throw new Error('generator_archive_checksum_mismatch');
    }
}

async function _installArchive(archivePath, version) {
    await copySigningSeedIfPresent();
    if (!isSigningSeedValid()) throw new Error('custom_client_signing_seed_required');

    const tmpDir = path.join(moduleDir(), `.tmp-install-${process.pid}-${Date.now()}`);
    const extractRoot = path.join(tmpDir, 'extract');
    const previousDir = path.join(moduleDir(), '.templates.previous');
    const dest = templatesDir();
    try {
        await _rimraf(tmpDir);
        await fsp.mkdir(extractRoot, { recursive: true });
        await _extractTarGz(archivePath, extractRoot);
        _assertNoSymlinks(extractRoot);

        let sourceTemplates = path.join(extractRoot, 'generator-templates');
        if (!fs.existsSync(sourceTemplates)) {
            const kids = await fsp.readdir(extractRoot, { withFileTypes: true });
            const dir = kids.find((entry) => entry.isDirectory());
            sourceTemplates = dir ? path.join(extractRoot, dir.name) : extractRoot;
        }
        const result = validateTemplates(sourceTemplates);

        await _rimraf(previousDir);
        if (fs.existsSync(dest)) await fsp.rename(dest, previousDir);
        try {
            await fsp.rename(sourceTemplates, dest);
        } catch (err) {
            if (fs.existsSync(previousDir) && !fs.existsSync(dest)) {
                await fsp.rename(previousDir, dest).catch(() => {});
            }
            throw err;
        }
        await _rimraf(previousDir);
        return writeState({
            status: 'ready',
            error: null,
            installedVersion: String(version || result.manifest.version || 'unknown'),
            manifestVersion: result.manifest.version || null,
            templateCount: result.templateCount,
            installedAt: new Date().toISOString(),
        });
    } catch (err) {
        await writeState({ status: 'error', error: err.message || String(err) });
        throw err;
    } finally {
        await _rimraf(tmpDir);
    }
}

/**
 * Copy signing seed from env or a known on-disk seed into the module dir.
 */
async function copySigningSeedIfPresent() {
    await ensureModuleDir();
    const fromEnv = String(process.env.BETTERDESK_CUSTOM_CLIENT_SIGNING_SEED || '').trim();
    if (fromEnv) {
        const value = fromEnv.replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || Buffer.from(value, 'base64').length !== 32) {
            throw new Error('custom_client_signing_seed_invalid');
        }
        await fsp.writeFile(signingSeedPath(), `${value}\n`, { encoding: 'utf8', mode: 0o600 });
        return true;
    }
    const candidates = [
        path.join(config.dataDir || path.join(__dirname, '..', 'data'), SIGNING_SEED_NAME),
        path.join(__dirname, '..', SIGNING_SEED_NAME),
        path.join(__dirname, '..', '..', 'res', 'betterdesk', SIGNING_SEED_NAME),
        path.join(process.cwd(), SIGNING_SEED_NAME),
    ];
    for (const src of candidates) {
        if (!fs.existsSync(src)) continue;
        const value = (await fsp.readFile(src, 'utf8')).replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || Buffer.from(value, 'base64').length !== 32) {
            throw new Error('custom_client_signing_seed_invalid');
        }
        await fsp.writeFile(signingSeedPath(), `${value}\n`, { encoding: 'utf8', mode: 0o600 });
        return true;
    }
    return false;
}

function _pickTemplateAsset(assets) {
    const list = Array.isArray(assets) ? assets : [];
    const preferred = list.find((a) => /^generator-templates-.*\.tar\.gz$/i.test(a.name || ''));
    if (preferred) return preferred;
    return list.find((a) => /generator-templates/i.test(a.name || '') && /\.tar\.gz$/i.test(a.name || ''))
        || null;
}

/**
 * Download generator templates from BetterDesk-Client releases and extract them.
 * @param {{ repo?: string, tag?: string }} [opts]
 */
async function installFromGitHub({ repo, tag } = {}) {
    if (installPromise) return installPromise;
    installPromise = _installFromGitHub({ repo, tag }).finally(() => {
        installPromise = null;
    });
    return installPromise;
}

async function _installFromGitHub({ repo, tag } = {}) {
    const state = await readState();
    if (!state.termsAccepted) {
        const err = new Error('terms_not_accepted');
        err.code = 'terms_not_accepted';
        throw err;
    }

    await writeState({ status: 'downloading', error: null });

    let tmpDir = null;
    try {
        const targetRepo = String(repo || clientRepo()).trim() || clientRepo();
        const releaseTag = String(tag || '').trim();
        const release = await _resolveRelease(targetRepo, releaseTag);
        const asset = _pickTemplateAsset(release.assets || []);
        if (!asset || !asset.browser_download_url) {
            const err = new Error(
                `No generator-templates-*.tar.gz asset found on ${targetRepo}`
                + (release.tag_name ? ` (${release.tag_name})` : '')
            );
            err.code = 'no_template_asset';
            throw err;
        }

        tmpDir = path.join(moduleDir(), '.tmp-install');
        await _rimraf(tmpDir);
        await fsp.mkdir(tmpDir, { recursive: true });
        const archivePath = path.join(tmpDir, asset.name || 'generator-templates.tar.gz');
        const body = await _httpGetBuffer(asset.browser_download_url);
        await fsp.writeFile(archivePath, body);
        const version = String(release.tag_name || release.name || releaseTag || 'unknown').replace(/^v/, '');
        await _verifyArchive(archivePath, asset, release.assets || []);
        return await _installArchive(archivePath, version);
    } catch (err) {
        await writeState({
            status: 'error',
            error: err.message || String(err),
        });
        throw err;
    } finally {
        if (tmpDir) await _rimraf(tmpDir);
    }
}

async function installFromLocalArchive(archivePath, version) {
    if (installPromise) return installPromise;
    installPromise = (async () => {
        const state = await readState();
        if (!state.termsAccepted) {
            const err = new Error('terms_not_accepted');
            err.code = 'terms_not_accepted';
            throw err;
        }
        const archive = path.resolve(String(archivePath || ''));
        if (!archive || !fs.existsSync(archive) || !fs.statSync(archive).isFile()) {
            throw new Error('generator_archive_missing');
        }
        try {
            return await _installArchive(archive, version || 'local');
        } catch (err) {
            await writeState({ status: 'error', error: err.message || String(err) });
            throw err;
        }
    })().finally(() => {
        installPromise = null;
    });
    return installPromise;
}

function resolveTemplateDir(platform, arch) {
    const archMap = {
        x64: 'x86_64',
        amd64: 'x86_64',
        x86_64: 'x86_64',
        arm64: 'aarch64',
        aarch64: 'aarch64',
    };
    const p = String(platform || '').toLowerCase();
    const a = archMap[String(arch || '').toLowerCase()] || String(arch || '');
    const name = `${p}-${a}`;
    const candidates = [
        path.join(templatesDir(), name),
        path.join(templatesDir(), 'generator-templates', name),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

function readManifest() {
    return _readManifestAt(templatesDir()) || _readManifestAt(
        path.join(templatesDir(), 'generator-templates'),
    );
}

function getSigningSeedBase64() {
    if (fs.existsSync(signingSeedPath())) {
        return fs.readFileSync(signingSeedPath(), 'utf8').trim();
    }
    const fromEnv = String(process.env.BETTERDESK_CUSTOM_CLIENT_SIGNING_SEED || '').trim();
    return fromEnv || '';
}

module.exports = {
    MODULE_ID,
    moduleDir,
    templatesDir,
    signingSeedPath,
    getStatus,
    acceptTerms,
    installFromGitHub,
    installFromLocalArchive,
    isReady,
    templatesExist,
    templatesHaveBinaries,
    resolveTemplateDir,
    readManifest,
    validateTemplates,
    isSigningSeedValid,
    getSigningSeedBase64,
    copySigningSeedIfPresent,
    clientRepo,
};
