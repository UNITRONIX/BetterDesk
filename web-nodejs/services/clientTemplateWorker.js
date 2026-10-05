/**
 * BetterDesk Support Generator — embedded local build worker
 *
 * Builds BetterDesk-Client with a signed Support payload embedded at compile
 * time and packages artifacts under data/agent-builds/.
 * The legacy template path remains available only when explicitly selected.
 */

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const AdmZip = require('adm-zip');

const db = require('./database');
const bundleService = require('./agentBundleService');
const supportModule = require('./supportGeneratorModule');
const clientBuilder = require('./clientBuilderService');
const windowsSupportInstaller = require('./windowsSupportInstaller');
const customTxt = require('./customTxtBuilder');
const keyService = require('./keyService');
const conn = require('./agentBundleConnection');
const platformSupportInstaller = require('./platformSupportInstaller');
const config = require('../config/config');
const {
    PRODUCT_TYPES,
    normalizeProductType,
    isQueuedBuildStatus,
} = require('../lib/generatorBuildTypes');

const ARTIFACT_ROOT = process.env.AGENT_ARTIFACT_DIR
    || path.join(config.dataDir || '/opt/BetterDeskConsole/data', 'agent-builds');
const WORK_ROOT = path.join(
    config.dataDir || path.join(__dirname, '..', 'data'),
    'build-cache',
    'support-templates'
);
const POLL_INTERVAL_MS = parseInt(process.env.AGENT_BUILD_POLL_MS || '5000', 10);
const BUILD_COOLDOWN_MS = parseInt(process.env.AGENT_BUILD_COOLDOWN_MS || '1000', 10);
const IS_WINDOWS = process.platform === 'win32';
const EMBEDDED_MODE = String(
    process.env.BETTERDESK_CLIENT_GENERATOR_MODE || 'embedded'
).trim().toLowerCase() === 'embedded';

let _pollHandle = null;
let _running = false;
let _activeBuilds = 0;
let _lastBuildFinishedAt = 0;
let _startupReady = false;

function _isSupportProduct(row) {
    const pt = normalizeProductType(row?.product_type);
    return pt === PRODUCT_TYPES.BETTERDESK_SUPPORT;
}

function _parseBranding(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (_) { return {}; }
}

function _availablePlatforms() {
    const all = bundleService.PLATFORMS || [];
    if (!EMBEDDED_MODE) return all;
    const capabilities = clientBuilder.getBuildCapabilities();
    if (capabilities.mode === 'remote') return all;
    const supported = new Set((capabilities.targets || []).map((p) => (
        `${p.platform}/${p.arch}/${p.format}`
    )));
    return all.filter((p) => supported.has(`${p.platform}/${p.arch}/${p.format}`));
}

function _filterPlatforms(only) {
    const all = _availablePlatforms();
    if (!Array.isArray(only) || only.length === 0) return all;
    return all.filter((p) => only.some((o) => (
        String(o.platform || o.os || '') === p.platform
        && String(o.arch || 'x64') === p.arch
        && String(o.format || 'portable') === p.format
    )));
}

function _hostPlatformKey() {
    const platform = process.platform === 'win32'
        ? 'windows'
        : process.platform === 'darwin' ? 'macos' : 'linux';
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return `${platform}/${arch}/portable`;
}

async function enqueueBuildsForHash(brandingHash, { force = false, platforms: onlyPlatforms = null } = {}) {
    if (!brandingHash) throw new Error('brandingHash required');
    if (EMBEDDED_MODE && !clientBuilder.isReady()) {
        throw new Error('betterdesk_client_builder_not_ready');
    }
    if (!EMBEDDED_MODE && !supportModule.isReady()) {
        throw new Error('support_generator_module_not_ready');
    }
    if (!EMBEDDED_MODE && !supportModule.templatesHaveBinaries()) {
        throw new Error(
            'support_generator_templates_incomplete: installed templates have no BetterDesk desktop binaries. '
            + 'Publish a full Client release with generator-templates, then reinstall the module.'
        );
    }
    const platforms = _filterPlatforms(onlyPlatforms);
    if (!platforms.length) {
        throw new Error('local_builder_no_supported_targets');
    }
    for (const p of platforms) {
        const existing = await db.getAgentBundleBuild({
            brandingHash, platform: p.platform, arch: p.arch, format: p.format,
        });
        if (!force && existing && (existing.status === 'ready' || existing.status === 'building')) {
            continue;
        }
        await db.upsertAgentBundleBuild({
            brandingHash,
            platform: p.platform,
            arch: p.arch,
            format: p.format,
            status: 'queued',
            artifactPath: existing?.artifact_path || null,
            artifactSize: existing?.artifact_size || 0,
            artifactSha256: existing?.artifact_sha256 || null,
            errorMessage: '',
        });
    }
}

async function rebuildBundleById(bundleId, { platforms: onlyPlatforms = null } = {}) {
    const row = await db.getAgentBundle(bundleId);
    if (!row) return { success: false, error: 'not_found' };
    if (!_isSupportProduct(row)) return { success: false, error: 'not_betterdesk_support' };
    if (!row.branding_hash) return { success: false, error: 'missing_hash' };
    const platforms = _filterPlatforms(onlyPlatforms);
    await enqueueBuildsForHash(row.branding_hash, { force: true, platforms });
    return { success: true, platforms: platforms.length, brandingHash: row.branding_hash };
}

/**
 * Prepare a new Client generation for every non-revoked Support config.
 * Existing active_generation_hash values are deliberately left untouched
 * until all target builds for the new generation are ready.
 */
async function rebuildAllForClientRevision(clientCommit, { force = false } = {}) {
    const commit = String(clientCommit || '').trim();
    if (!/^[a-f0-9]{40}$/i.test(commit)) {
        throw new Error('betterdesk_client_commit_invalid');
    }
    const bundles = await db.listAgentBundles();
    const queued = [];
    for (const bundle of bundles || []) {
        if (bundle.revoked || !_isSupportProduct(bundle)) continue;
        const configFingerprint = bundle.config_fingerprint || bundle.branding_hash;
        const generationHash = clientBuilder.generationKey(configFingerprint, commit);
        if (!force && bundle.branding_hash === generationHash) continue;
        await db.prepareAgentBundleGeneration(bundle.bundle_id, {
            brandingHash: generationHash,
            configFingerprint,
            clientCommit: commit,
        });
        await enqueueBuildsForHash(generationHash, { force, platforms: null });
        queued.push({
            bundleId: bundle.bundle_id,
            configFingerprint,
            brandingHash: generationHash,
        });
    }
    return { clientCommit: commit, queued };
}

async function requeuePlatformBuild(brandingHash, platform, arch, format) {
    if (!brandingHash || !platform || !arch || !format) {
        return { success: false, error: 'missing_args' };
    }
    const allowed = (bundleService.PLATFORMS || []).some(
        (p) => p.platform === platform && p.arch === arch && p.format === format
    );
    if (!allowed) return { success: false, error: 'unsupported_platform' };
    const available = _availablePlatforms().some(
        (p) => p.platform === platform && p.arch === arch && p.format === format
    );
    if (!available) return { success: false, error: 'unsupported_platform' };
    await db.upsertAgentBundleBuild({
        brandingHash,
        platform,
        arch,
        format,
        status: 'queued',
        artifactPath: null,
        artifactSize: 0,
        artifactSha256: null,
        errorMessage: '',
    });
    return { success: true, brandingHash };
}

function getBuildWorkerStatus() {
    const moduleStatus = (() => {
        try {
            return {
                ready: supportModule.isReady(),
                templatesPresent: supportModule.templatesExist(),
            };
        } catch (_) {
            return { ready: false, templatesPresent: false };
        }
    })();
    return {
        workerEnabled: process.env.AGENT_BUILD_WORKER !== 'off',
        kind: 'client-template',
        mode: EMBEDDED_MODE ? 'embedded' : 'legacy-custom-txt',
        clientBuilderReady: EMBEDDED_MODE ? clientBuilder.isReady() : false,
        moduleReady: moduleStatus.ready,
        templatesPresent: moduleStatus.templatesPresent,
        templatesDir: supportModule.templatesDir(),
        artifactRoot: ARTIFACT_ROOT,
        platforms: _availablePlatforms().map((p) => ({
            platform: p.platform,
            arch: p.arch,
            format: p.format,
            label: p.label,
        })),
        capabilities: EMBEDDED_MODE ? clientBuilder.getBuildCapabilities() : null,
        activeBuilds: _activeBuilds,
        startupReady: _startupReady,
    };
}

function _isArtifactPathSafe(filePath) {
    if (!filePath) return false;
    const root = path.resolve(ARTIFACT_ROOT);
    const candidate = path.resolve(String(filePath));
    const relative = path.relative(root, candidate);
    return !!relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function getReadyArtifact({ brandingHash, platform, arch, format }) {
    const row = await db.getAgentBundleBuild({ brandingHash, platform, arch, format });
    if (!row || row.status !== 'ready' || !row.artifact_path) return null;
    if (!_isArtifactPathSafe(row.artifact_path)) return null;
    try {
        await fsp.access(row.artifact_path, fs.constants.R_OK);
    } catch {
        return null;
    }
    return row;
}

async function recoverInterruptedBuilds() {
    const bundles = await db.listAgentBundles({ includeRevoked: true });
    let recovered = 0;
    for (const bundle of bundles || []) {
        const builds = await db.listAgentBundleBuildsForHash(bundle.branding_hash);
        for (const build of builds || []) {
            if (build.status !== 'building') continue;
            await db.upsertAgentBundleBuild({
                brandingHash: build.branding_hash,
                platform: build.platform,
                arch: build.arch,
                format: build.format,
                status: 'queued',
                artifactPath: null,
                artifactSize: 0,
                artifactSha256: null,
                errorMessage: 'requeued_after_worker_restart',
                clientCommit: build.client_commit || bundle.client_commit || null,
                generationId: build.generation_id || null,
                configFingerprint: build.config_fingerprint || bundle.config_fingerprint || null,
                progressPercent: 0,
                progressPhase: 'requeued_after_restart',
            });
            recovered++;
        }
    }
    if (recovered) {
        console.log(`[clientTemplateWorker] recovered ${recovered} interrupted build(s)`);
    }
}

function startWorker() {
    if (_pollHandle) return;
    console.log(`[clientTemplateWorker] templates=${supportModule.templatesDir()}`);
    _startupReady = false;
    _pollHandle = setInterval(() => {
        _tick().catch((e) => console.error('[clientTemplateWorker] tick error:', e.message));
    }, POLL_INTERVAL_MS);
    recoverInterruptedBuilds()
        .catch((err) => console.error('[clientTemplateWorker] recovery error:', err.message))
        .finally(() => {
            _startupReady = true;
            _tick().catch(() => {});
        });
    console.log(`[clientTemplateWorker] started (poll ${POLL_INTERVAL_MS}ms)`);
}

function stopWorker() {
    if (_pollHandle) {
        clearInterval(_pollHandle);
        _pollHandle = null;
    }
    _startupReady = false;
}

async function _tick() {
    if (!_startupReady) return;
    if (_running || _activeBuilds > 0) return;
    if (BUILD_COOLDOWN_MS > 0 && Date.now() - _lastBuildFinishedAt < BUILD_COOLDOWN_MS) return;

    _running = true;
    try {
        const claimed = await _claimNextBuild();
        if (!claimed) return;
        _activeBuilds++;
        try {
            await _runOne(claimed);
        } catch (e) {
            console.error('[clientTemplateWorker] build crashed:', e);
        } finally {
            _activeBuilds--;
            _lastBuildFinishedAt = Date.now();
        }
    } finally {
        _running = false;
    }
}

async function _findBundleForHash(brandingHash) {
    const bundles = await db.listAgentBundles({ includeRevoked: true });
    return (bundles || []).find((b) => b.branding_hash === brandingHash) || null;
}

async function _listPendingBuilds(limit = 50) {
    const bundles = await db.listAgentBundles();
    const out = [];
    for (const b of bundles || []) {
        if (b.revoked || !_isSupportProduct(b)) continue;
        const builds = await db.listAgentBundleBuildsForHash(b.branding_hash);
        for (const row of builds || []) {
            if (isQueuedBuildStatus(row.status)) out.push(row);
            if (out.length >= limit) return out;
        }
    }
    return out;
}

async function _claimNextBuild() {
    if (EMBEDDED_MODE ? !clientBuilder.isReady() : !supportModule.isReady()) return null;
    const candidates = await _listPendingBuilds(50);
    const hostKey = _hostPlatformKey();
    candidates.sort((a, b) => {
        const aHost = `${a.platform}/${a.arch}/${a.format}` === hostKey ? 0 : 1;
        const bHost = `${b.platform}/${b.arch}/${b.format}` === hostKey ? 0 : 1;
        return aHost - bHost
            || String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
    for (const row of candidates) {
        const bundleRow = await _findBundleForHash(row.branding_hash);
        if (!bundleRow || !_isSupportProduct(bundleRow)) continue;
        if (!EMBEDDED_MODE && !supportModule.resolveTemplateDir(row.platform, row.arch)) {
            await db.upsertAgentBundleBuild({
                brandingHash: row.branding_hash,
                platform: row.platform,
                arch: row.arch,
                format: row.format,
                status: 'failed',
                artifactPath: null,
                artifactSize: 0,
                artifactSha256: null,
                errorMessage: `template_missing:${row.platform}/${row.arch}`,
            });
            continue;
        }
        await db.upsertAgentBundleBuild({
            brandingHash: row.branding_hash,
            platform: row.platform,
            arch: row.arch,
            format: row.format,
            status: 'building',
            artifactPath: row.artifact_path || null,
            artifactSize: row.artifact_size || 0,
            artifactSha256: row.artifact_sha256 || null,
            errorMessage: '',
        });
        return { ...row, _bundle: bundleRow };
    }
    return null;
}

function _buildApiServer(branding) {
    if (branding.api_server) return String(branding.api_server).trim();
    const host = branding.server_host || conn.defaultServerHost();
    const useHttps = branding.use_https ?? true;
    const port = String(branding.api_port || conn.defaultApiPort());
    const scheme = useHttps ? 'https' : 'http';
    const omit = (scheme === 'https' && port === '443') || (scheme === 'http' && port === '80');
    return omit ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;
}

async function _buildCustomTxtContent(branding) {
    const host = branding.server_host || conn.defaultServerHost();
    const key = branding.public_key
        || branding.server_key
        || branding.server?.public_key
        || (await keyService.resolvePublicKey())
        || '';
    const built = customTxt.buildAndSignSupportCustomTxt({
        appName: branding.app_name || branding.company_name || branding.product_name || 'BetterDesk Support Agent',
        host,
        relay: branding.relay_host || branding.relay_server || host,
        api: _buildApiServer(branding),
        key,
        disableSettings: branding.disable_settings !== false,
    }, supportModule.getSigningSeedBase64());
    return built;
}

async function _copyDir(src, dest) {
    await fsp.cp(src, dest, { recursive: true });
}

function _findCustomTxtTarget(stageDir, platform) {
    if (String(platform).toLowerCase() === 'macos') {
        const marker = _findFile(stageDir, '.custom-txt-here');
        if (marker) return path.dirname(marker);
        const app = _findDirEnding(stageDir, '.app');
        if (app) {
            const macos = path.join(app, 'Contents', 'MacOS');
            if (fs.existsSync(macos)) return macos;
        }
        const contentsMac = _findDirNamed(stageDir, 'MacOS');
        if (contentsMac) return contentsMac;
    }
    const marker = path.join(stageDir, '.custom-txt-here');
    if (fs.existsSync(marker)) return stageDir;
    return stageDir;
}

function _findFile(root, name) {
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) stack.push(full);
            else if (e.name === name) return full;
        }
    }
    return null;
}

function _findDirEnding(root, suffix) {
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const full = path.join(dir, e.name);
            if (e.name.endsWith(suffix)) return full;
            stack.push(full);
        }
    }
    return null;
}

function _findDirNamed(root, name) {
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const full = path.join(dir, e.name);
            if (e.name === name) return full;
            stack.push(full);
        }
    }
    return null;
}

function _runTar(args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn('tar', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`tar failed (${code}): ${stderr.trim() || 'unknown'}`));
        });
    });
}

async function _packArtifact(stageDir, outPath, platform) {
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    if (fs.existsSync(outPath)) await fsp.unlink(outPath);

    if (String(platform).toLowerCase() === 'windows' || outPath.endsWith('.zip')) {
        const zip = new AdmZip();
        zip.addLocalFolder(stageDir, path.basename(stageDir));
        zip.writeZip(outPath);
        return;
    }

    // tar.gz — archive the stage directory contents under a single top-level folder
    const parent = path.dirname(stageDir);
    const base = path.basename(stageDir);
    await _runTar(['-czf', outPath, base], parent);
}

function _sha256OfFile(filePath) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        const s = fs.createReadStream(filePath);
        s.on('error', reject);
        s.on('data', (d) => h.update(d));
        s.on('end', () => resolve(h.digest('hex')));
    });
}

function _templateHasBinary(stageDir, platform) {
    const p = String(platform || '').toLowerCase();
    if (p === 'macos') {
        if (_findDirEnding(stageDir, '.app')) return true;
    }
    const names = new Set(['betterdesk.exe', 'rustdesk.exe', 'betterdesk', 'rustdesk']);
    const stack = [stageDir];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name.endsWith('.app')) return true;
                stack.push(full);
            } else if (names.has(e.name) || names.has(e.name.toLowerCase())) {
                try {
                    if (fs.statSync(full).size > 100 * 1024) return true;
                } catch (_) { /* ignore */ }
            }
        }
    }
    return false;
}

async function _runOne(buildRow) {
    if (EMBEDDED_MODE) {
        return _runEmbeddedOne(buildRow);
    }

    const key = `${buildRow.platform}/${buildRow.arch}/${buildRow.format}`;
    const startTs = Date.now();
    console.log(`[clientTemplateWorker] build start hash=${String(buildRow.branding_hash).slice(0, 12)} ${key}`);

    const workDir = path.join(WORK_ROOT, `${buildRow.branding_hash.slice(0, 16)}_${buildRow.platform}_${buildRow.arch}`);
    try {
        await fsp.rm(workDir, { recursive: true, force: true });
        await fsp.mkdir(workDir, { recursive: true });
        await fsp.mkdir(ARTIFACT_ROOT, { recursive: true });

        const templateDir = supportModule.resolveTemplateDir(buildRow.platform, buildRow.arch);
        if (!templateDir) throw new Error(`template_missing:${key}`);

        const stageDir = path.join(workDir, `betterdesk-support-${buildRow.platform}-${buildRow.arch}`);
        await _copyDir(templateDir, stageDir);

        if (!_templateHasBinary(stageDir, buildRow.platform)) {
            throw new Error(
                `template_missing_binary:${key} — installed templates are a stub without betterdesk.exe / binary. `
                + 'Publish a full BetterDesk-Client release (workflow betterdesk-desktop-release.yml) '
                + 'with generator-templates containing desktop binaries, then reinstall the module.'
            );
        }

        const branding = _parseBranding(buildRow._bundle?.branding);
        const { content } = await _buildCustomTxtContent(branding);
        const injectDir = _findCustomTxtTarget(stageDir, buildRow.platform);
        await fsp.mkdir(injectDir, { recursive: true });
        await fsp.writeFile(path.join(injectDir, 'custom.txt'), content, 'utf8');

        // Drop helper markers from shipped artifacts
        try { await fsp.unlink(path.join(stageDir, '.custom-txt-here')); } catch (_) { /* ok */ }
        const nestedMarker = _findFile(stageDir, '.custom-txt-here');
        if (nestedMarker) {
            try { await fsp.unlink(nestedMarker); } catch (_) { /* ok */ }
        }

        if (buildRow.platform === 'windows') {
            await windowsSupportInstaller.writeWindowsSupportInstallers(stageDir, {
                installService: branding.install_service,
                autostart: branding.autostart,
            });
        } else {
            await platformSupportInstaller.writeUnixSupportInstallers(stageDir, buildRow.platform, {
                installService: branding.install_service,
                autostart: branding.autostart,
            });
        }

        const ext = buildRow.platform === 'windows' ? 'zip' : 'tar.gz';
        const artifactName = `betterdesk-support-${buildRow.branding_hash.slice(0, 12)}-${buildRow.platform}-${buildRow.arch}.${ext}`;
        const artifactPath = path.join(ARTIFACT_ROOT, artifactName);
        await _packArtifact(stageDir, artifactPath, buildRow.platform);

        const stat = await fsp.stat(artifactPath);
        const sha = await _sha256OfFile(artifactPath);
        await db.upsertAgentBundleBuild({
            brandingHash: buildRow.branding_hash,
            platform: buildRow.platform,
            arch: buildRow.arch,
            format: buildRow.format,
            status: 'ready',
            artifactPath,
            artifactSize: stat.size,
            artifactSha256: sha,
            errorMessage: '',
        });
        console.log(
            `[clientTemplateWorker] build ready ${key} signed=true`
            + ` (${(stat.size / 1024 / 1024).toFixed(2)} MB, ${((Date.now() - startTs) / 1000).toFixed(1)}s)`
        );
    } catch (err) {
        const msg = err.message || String(err);
        console.error(`[clientTemplateWorker] build FAILED ${key}: ${msg}`);
        await db.upsertAgentBundleBuild({
            brandingHash: buildRow.branding_hash,
            platform: buildRow.platform,
            arch: buildRow.arch,
            format: buildRow.format,
            status: 'failed',
            artifactPath: null,
            artifactSize: 0,
            artifactSha256: null,
            errorMessage: msg.slice(0, 2000),
        });
    } finally {
        try { await fsp.rm(workDir, { recursive: true, force: true }); } catch (_) { /* ok */ }
    }
}

function _findManifestArtifact(root, manifest, platform, arch) {
    const providerArch = {
        x64: 'x86_64',
        amd64: 'x86_64',
        arm64: 'aarch64',
    }[String(arch).toLowerCase()] || String(arch).toLowerCase();
    const target = `${String(platform).toLowerCase()}/${providerArch}`;
    const assets = (manifest?.assets || []).filter((asset) => (
        `${String(asset.platform || '').toLowerCase()}/${String(asset.arch || '').toLowerCase()}` === target
    ));
    if (assets.length !== 1) {
        throw new Error(`embedded_manifest_asset_target_count_invalid:${platform}/${arch}`);
    }
    const assetName = assets[0].name;
    const candidate = path.resolve(root, assetName);
    const relative = path.relative(path.resolve(root), candidate);
    const expectedExt = String(platform).toLowerCase() === 'windows' ? '.zip' : '.tar.gz';
    if (
        !relative
        || relative.startsWith(`..${path.sep}`)
        || relative === '..'
        || path.isAbsolute(relative)
        || !candidate.toLowerCase().endsWith(expectedExt)
        || !fs.existsSync(candidate)
        || !fs.statSync(candidate).isFile()
    ) {
        throw new Error(`embedded_manifest_asset_invalid:${assetName}`);
    }
    return candidate;
}

function _failedPlatformsForError(message, buildRow) {
    const localSingleTarget = EMBEDDED_MODE
        && clientBuilder.getBuildCapabilities().mode === 'local';
    return localSingleTarget || String(message).startsWith('local_builder')
        ? [{
            platform: buildRow.platform,
            arch: buildRow.arch,
            format: buildRow.format,
        }]
        : bundleService.PLATFORMS;
}

async function _assertEmbeddedArtifact(artifactPath) {
    if (artifactPath.endsWith('.zip')) {
        const zip = new AdmZip(artifactPath);
        for (const entry of zip.getEntries()) {
            const name = String(entry.entryName || '').replace(/\\/g, '/').toLowerCase();
            if (name.endsWith('/custom.txt') || name.endsWith('/.custom-txt-here')) {
                throw new Error('embedded_artifact_contains_external_config');
            }
        }
        return;
    }
    const listing = await new Promise((resolve, reject) => {
        const child = spawn('tar', ['-tzf', artifactPath], {
            cwd: path.dirname(artifactPath),
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let output = '';
        let error = '';
        child.stdout.on('data', (chunk) => { output += chunk.toString(); });
        child.stderr.on('data', (chunk) => { error += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => code === 0
            ? resolve(output)
            : reject(new Error(`embedded_artifact_list_failed:${error.trim() || code}`)));
    });
    for (const line of listing.split(/\r?\n/)) {
        const name = line.replace(/\\/g, '/').toLowerCase();
        if (name.endsWith('/custom.txt') || name.endsWith('/.custom-txt-here')) {
            throw new Error('embedded_artifact_contains_external_config');
        }
    }
}

async function _validateEmbeddedManifest(outputDir, buildRow) {
    const manifestPath = path.join(outputDir, 'manifest.json');
    let manifest;
    try {
        manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    } catch (err) {
        throw new Error(`embedded_manifest_invalid:${err.message || String(err)}`);
    }
    if (manifest.schema_version !== 1 || manifest.sku !== 'betterdesk-support') {
        throw new Error('embedded_manifest_contract_invalid');
    }
    if (manifest.external_config !== false) {
        throw new Error('embedded_manifest_external_config');
    }
    if (
        buildRow._bundle?.client_commit
        && String(manifest.client_commit || '').toLowerCase()
            !== String(buildRow._bundle.client_commit).toLowerCase()
    ) {
        throw new Error('embedded_manifest_client_commit_mismatch');
    }
    if (!Array.isArray(manifest.assets)) throw new Error('embedded_manifest_assets_missing');
    for (const asset of manifest.assets) {
        if (!asset || typeof asset.name !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(asset.name)) {
            throw new Error('embedded_manifest_asset_invalid');
        }
        const assetPath = path.join(outputDir, asset.name);
        if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
            throw new Error(`embedded_manifest_asset_missing:${asset.name}`);
        }
        if (asset.sha256) {
            const actual = await _sha256OfFile(assetPath);
            if (actual.toLowerCase() !== String(asset.sha256).toLowerCase()) {
                throw new Error(`embedded_manifest_asset_checksum_mismatch:${asset.name}`);
            }
        }
    }
    return manifest;
}

async function _runEmbeddedOne(buildRow) {
    const key = `${buildRow.platform}/${buildRow.arch}/${buildRow.format}`;
    const startTs = Date.now();
    const generationId = buildRow.branding_hash.slice(0, 48);
    try {
        await db.upsertAgentBundleBuild({
            brandingHash: buildRow.branding_hash,
            platform: buildRow.platform,
            arch: buildRow.arch,
            format: buildRow.format,
            status: 'building',
            artifactPath: null,
            artifactSize: 0,
            artifactSha256: null,
            errorMessage: '',
            clientCommit: buildRow._bundle?.client_commit || null,
            generationId,
            configFingerprint: buildRow._bundle?.config_fingerprint || null,
            progressPercent: 0,
            progressPhase: 'preparing',
        });
        const branding = _parseBranding(buildRow._bundle?.branding);
        const { content } = await _buildCustomTxtContent(branding);
        const buildPlatforms = _availablePlatforms();
        if (!buildPlatforms.length) {
            throw new Error('local_builder_no_supported_targets');
        }
        const result = await clientBuilder.runBuild({
            schema_version: 1,
            product_sku: 'betterdesk-support',
            generationId,
            clientCommit: buildRow._bundle?.client_commit || null,
            configFingerprint: buildRow._bundle?.config_fingerprint || null,
            targets: buildPlatforms.map((platform) => ({
                platform: platform.platform,
                arch: platform.arch,
                format: platform.format,
            })),
            signed_config_b64: content,
        }, {
            onProgress: async ({ percent, phase }) => {
                await db.upsertAgentBundleBuild({
                    brandingHash: buildRow.branding_hash,
                    platform: buildRow.platform,
                    arch: buildRow.arch,
                    format: buildRow.format,
                    status: 'building',
                    artifactPath: null,
                    artifactSize: 0,
                    artifactSha256: null,
                    errorMessage: '',
                    clientCommit: buildRow._bundle?.client_commit || null,
                    generationId,
                    configFingerprint: buildRow._bundle?.config_fingerprint || null,
                    progressPercent: percent,
                    progressPhase: phase,
                });
            },
        });
        const manifest = await _validateEmbeddedManifest(result.outputDir, buildRow);
        await fsp.mkdir(ARTIFACT_ROOT, { recursive: true });
        const availableTargets = new Set((manifest.assets || []).map((asset) => (
            `${asset.platform}/${asset.arch}`
        )));
        const localProvider = manifest.builder === 'betterdesk-local';
        for (const platform of buildPlatforms) {
            const targetKey = `${platform.platform}/${platform.arch === 'x64' ? 'x86_64' : 'aarch64'}`;
            if (!availableTargets.has(targetKey)) {
                if (!localProvider) {
                    throw new Error(`embedded_build_target_missing:${targetKey}`);
                }
                await db.upsertAgentBundleBuild({
                    brandingHash: buildRow.branding_hash,
                    platform: platform.platform,
                    arch: platform.arch,
                    format: platform.format,
                    status: 'failed',
                    artifactPath: null,
                    artifactSize: 0,
                    artifactSha256: null,
                    errorMessage: `local_builder_target_unavailable:${targetKey}`,
                    clientCommit: buildRow._bundle?.client_commit || null,
                    generationId,
                    configFingerprint: buildRow._bundle?.config_fingerprint || null,
                    progressPercent: 0,
                    progressPhase: 'target_unavailable',
                });
                continue;
            }
            const sourceArtifact = _findManifestArtifact(
                result.outputDir,
                manifest,
                platform.platform,
                platform.arch
            );
            await _assertEmbeddedArtifact(sourceArtifact);
            const ext = platform.platform === 'windows' ? 'zip' : 'tar.gz';
            const artifactPath = path.join(
                ARTIFACT_ROOT,
                `betterdesk-support-${buildRow.branding_hash.slice(0, 12)}-${platform.platform}-${platform.arch}.${ext}`
            );
            const temporaryArtifact = `${artifactPath}.tmp-${process.pid}-${Date.now()}`;
            await fsp.copyFile(sourceArtifact, temporaryArtifact);
            await fsp.rename(temporaryArtifact, artifactPath);
            const stat = await fsp.stat(artifactPath);
            const sha = await _sha256OfFile(artifactPath);
            await db.upsertAgentBundleBuild({
                brandingHash: buildRow.branding_hash,
                platform: platform.platform,
                arch: platform.arch,
                format: platform.format,
                status: 'ready',
                artifactPath,
                artifactSize: stat.size,
                artifactSha256: sha,
                errorMessage: '',
                clientCommit: buildRow._bundle?.client_commit || null,
                generationId,
                configFingerprint: buildRow._bundle?.config_fingerprint || null,
                progressPercent: 100,
                progressPhase: 'complete',
            });
        }
        await _promoteIfComplete(buildRow.branding_hash);
        console.log(
            `[clientTemplateWorker] embedded build ready ${key}`
            + ` (${((Date.now() - startTs) / 1000).toFixed(1)}s)`
        );
    } catch (err) {
        const msg = err.message || String(err);
        console.error(`[clientTemplateWorker] embedded build FAILED ${key}: ${msg}`);
        const failedPlatforms = _failedPlatformsForError(msg, buildRow);
        await Promise.all(failedPlatforms.map((platform) => (
            db.upsertAgentBundleBuild({
                brandingHash: buildRow.branding_hash,
                platform: platform.platform,
                arch: platform.arch,
                format: platform.format,
                status: 'failed',
                artifactPath: null,
                artifactSize: 0,
                artifactSha256: null,
                errorMessage: msg.slice(0, 2000),
                clientCommit: buildRow._bundle?.client_commit || null,
                generationId,
                configFingerprint: buildRow._bundle?.config_fingerprint || null,
                progressPercent: 0,
                progressPhase: 'failed',
            })
        )));
    }
}

async function _promoteIfComplete(brandingHash) {
    const builds = await db.listAgentBundleBuildsForHash(brandingHash);
    const required = _availablePlatforms().map((p) => (
        `${p.platform}/${p.arch}/${p.format}`
    ));
    const ready = new Set((builds || [])
        .filter((row) => row.status === 'ready')
        .map((row) => `${row.platform}/${row.arch}/${row.format}`));
    if (required.every((key) => ready.has(key))) {
        await db.promoteAgentBundleGeneration(brandingHash);
    }
}

module.exports = {
    enqueueBuildsForHash,
    rebuildBundleById,
    rebuildAllForClientRevision,
    requeuePlatformBuild,
    startWorker,
    stopWorker,
    getBuildWorkerStatus,
    getAvailablePlatforms: _availablePlatforms,
    getReadyArtifact,
    _internals: {
        isSupportProduct: _isSupportProduct,
        buildCustomTxtContent: _buildCustomTxtContent,
        findCustomTxtTarget: _findCustomTxtTarget,
        filterPlatforms: _filterPlatforms,
        findManifestArtifact: _findManifestArtifact,
        failedPlatformsForError: _failedPlatformsForError,
        hasWindowsSupportInstallers: windowsSupportInstaller.hasWindowsSupportInstallers,
        isArtifactPathSafe: _isArtifactPathSafe,
        ARTIFACT_ROOT,
        WORK_ROOT,
        IS_WINDOWS,
    },
};
