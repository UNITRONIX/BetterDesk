/**
 * BetterDesk-Client source synchronisation and embedded-build provider.
 *
 * This service deliberately keeps the Client repository outside the
 * BetterDesk checkout. It only stores a pinned source snapshot and invokes an
 * built-in local build provider (or an explicitly configured replacement)
 * with a request file. The provider is responsible for producing platform
 * artifacts with the signed Support payload compiled into the binary.
 */

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const nacl = require('tweetnacl');

const config = require('../config/config');
const localClientBuilder = require('./localClientBuilder');

const DEFAULT_REPO = 'UNITRONIX/BetterDesk-Client';
const DEFAULT_REF = 'master';
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const BUILD_TIMEOUT_MS = Math.max(
    60_000,
    Number.parseInt(process.env.BETTERDESK_CLIENT_BUILD_TIMEOUT_MS || '3600000', 10)
);

function dataRoot() {
    return path.join(
        config.dataDir || path.join(__dirname, '..', 'data'),
        'modules',
        'betterdesk-client-builder'
    );
}

function sourceRoot() {
    return path.join(dataRoot(), 'source');
}

function statePath() {
    return path.join(dataRoot(), 'state.json');
}

function requestRoot() {
    return path.join(dataRoot(), 'requests');
}

function signingSeedPath() {
    return require('./supportGeneratorModule').signingSeedPath();
}

function signingPublicKeyPath() {
    return path.join(dataRoot(), 'custom-client-signing.pub');
}

function outputRoot() {
    return path.join(dataRoot(), 'outputs');
}

function normalizeRepo(value) {
    const repo = String(value || process.env.BETTERDESK_CLIENT_REPO || DEFAULT_REPO).trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
        throw new Error('betterdesk_client_repo_invalid');
    }
    const allowed = String(
        process.env.BETTERDESK_CLIENT_ALLOWED_REPOS || DEFAULT_REPO
    ).split(',').map((entry) => entry.trim()).filter(Boolean);
    if (!allowed.includes(repo)) {
        throw new Error('betterdesk_client_repo_not_allowed');
    }
    return repo;
}

function clientRef(value) {
    const ref = String(value || process.env.BETTERDESK_CLIENT_REF || DEFAULT_REF).trim();
    if (!ref || ref.length > 200 || /[\0\r\n]/.test(ref)) {
        throw new Error('betterdesk_client_ref_invalid');
    }
    return ref;
}

function decodeSigningSeed(value) {
    const text = String(value || '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
    try {
        const seed = Buffer.from(text, 'base64');
        return seed.length === 32 ? seed : null;
    } catch (_) {
        return null;
    }
}

function readStoredSigningSeed() {
    try {
        return decodeSigningSeed(fs.readFileSync(signingSeedPath(), 'utf8'));
    } catch (_) {
        return null;
    }
}

function writeSigningFile(filePath, value, mode) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, `${value}\n`, { encoding: 'utf8', mode });
    try { fs.chmodSync(temporary, mode); } catch (_) { /* Windows */ }
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) { /* replace below */ }
    fs.renameSync(temporary, filePath);
}

/**
 * Generate an instance-specific signing key on first use. A configured
 * environment seed remains supported for managed deployments, but the
 * default path never downloads or reuses a public test seed.
 */
function ensureSigningKeySync() {
    const configured = decodeSigningSeed(process.env.BETTERDESK_CUSTOM_CLIENT_SIGNING_SEED);
    const existing = readStoredSigningSeed();
    const seed = configured || existing || Buffer.from(nacl.randomBytes(32));
    const generated = !configured && !existing;
    const publicKey = Buffer.from(
        nacl.sign.keyPair.fromSeed(new Uint8Array(seed)).publicKey
    ).toString('base64');
    const seedText = seed.toString('base64');
    const currentSeed = existing ? existing.toString('base64') : '';
    if (configured || !existing || currentSeed !== seedText) {
        writeSigningFile(signingSeedPath(), seedText, 0o600);
    }
    const currentPublic = fs.existsSync(signingPublicKeyPath())
        ? fs.readFileSync(signingPublicKeyPath(), 'utf8').trim()
        : '';
    if (currentPublic !== publicKey) {
        writeSigningFile(signingPublicKeyPath(), publicKey, 0o644);
    }
    return { seed: seedText, publicKey, generated };
}

function prepareClientSigningPublicKey() {
    const key = ensureSigningKeySync();
    const target = path.join(sourceRoot(), 'res', 'betterdesk', 'custom-client-signing.pub');
    if (!fs.existsSync(sourceRoot()) || !fs.existsSync(path.dirname(target))) {
        throw new Error('betterdesk_client_source_missing_for_signing_key');
    }
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error('betterdesk_client_signing_key_symlink');
    const current = fs.readFileSync(target, 'utf8').trim();
    if (current !== key.publicKey) {
        const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(temporary, `${key.publicKey}\n`, { encoding: 'utf8', mode: 0o644 });
        try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch (_) { /* replace below */ }
        fs.renameSync(temporary, target);
    }
    return key;
}

function githubHeaders(accept = 'application/vnd.github+json', requestUrl = 'https://api.github.com') {
    const headers = {
        'User-Agent': 'BetterDesk-Console-Client-Builder',
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
    };
    const token = String(
        process.env.BETTERDESK_GITHUB_TOKEN || process.env.GITHUB_TOKEN || ''
    ).trim();
    let host = '';
    try { host = new URL(requestUrl).hostname.toLowerCase(); } catch (_) { /* use no token */ }
    if (token && host === 'api.github.com') headers.Authorization = `Bearer ${token}`;
    return headers;
}

function githubJson(url) {
    return new Promise((resolve, reject) => {
        const lib = String(url).startsWith('https:') ? https : http;
        const req = lib.get(url, { headers: githubHeaders(), timeout: 30_000 }, (res) => {
            const chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
                size += chunk.length;
                if (size <= MAX_RESPONSE_BYTES) chunks.push(chunk);
            });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    const err = new Error(`GitHub HTTP ${res.statusCode}`);
                    err.statusCode = res.statusCode;
                    reject(err);
                    return;
                }
                if (size > MAX_RESPONSE_BYTES) {
                    reject(new Error('github_response_too_large'));
                    return;
                }
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                } catch (err) {
                    reject(new Error(`github_json_invalid:${err.message}`));
                }
            });
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('github_request_timeout'));
        });
    });
}

function githubRequest(method, url, body = null) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const lib = target.protocol === 'https:' ? https : http;
        const payload = body === null ? null : Buffer.from(JSON.stringify(body));
        const req = lib.request(target, {
            method,
            headers: {
                ...githubHeaders('application/vnd.github+json'),
                ...(payload ? {
                    'Content-Type': 'application/json',
                    'Content-Length': payload.length,
                } : {}),
            },
            timeout: 30_000,
        }, (res) => {
            const chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
                size += chunk.length;
                if (size <= MAX_RESPONSE_BYTES) chunks.push(chunk);
            });
            res.on('end', () => {
                const response = Buffer.concat(chunks);
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const err = new Error(`GitHub HTTP ${res.statusCode}`);
                    err.statusCode = res.statusCode;
                    err.body = response.toString('utf8').slice(0, 4000);
                    reject(err);
                    return;
                }
                if (!response.length) {
                    resolve(null);
                    return;
                }
                try {
                    resolve(JSON.parse(response.toString('utf8')));
                } catch (_) {
                    resolve(response);
                }
            });
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('github_request_timeout'));
        });
        if (payload) req.write(payload);
        req.end();
    });
}

function downloadToFile(url, destination, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 8) {
            reject(new Error('too_many_redirects'));
            return;
        }
        const lib = String(url).startsWith('https:') ? https : http;
        const req = lib.get(url, {
            headers: githubHeaders('application/octet-stream', url),
            timeout: 120_000,
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                downloadToFile(res.headers.location, destination, redirects + 1).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`GitHub HTTP ${res.statusCode}`));
                return;
            }
            const output = fs.createWriteStream(destination, { mode: 0o600 });
            let settled = false;
            const fail = (err) => {
                if (settled) return;
                settled = true;
                output.destroy();
                reject(err);
            };
            res.on('error', fail);
            output.on('error', fail);
            output.on('finish', () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            });
            res.pipe(output);
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('github_download_timeout'));
        });
    });
}

function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env || process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => resolve({
            code,
            stdout: stdout.slice(-16_000),
            stderr: stderr.slice(-16_000),
        }));
    });
}

function runTar(args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn('tar', args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stderr = '';
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`tar_failed:${code}:${stderr.trim() || 'unknown'}`));
        });
    });
}

async function safeExtractTarGz(archivePath, destination) {
    const listing = await new Promise((resolve, reject) => {
        const child = spawn('tar', ['-tzf', archivePath], {
            cwd: path.dirname(archivePath),
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let output = '';
        let error = '';
        child.stdout.on('data', (chunk) => { output += chunk.toString(); });
        child.stderr.on('data', (chunk) => { error += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve(output);
            else reject(new Error(`tar_list_failed:${code}:${error.trim() || 'unknown'}`));
        });
    });
    for (const raw of listing.split(/\r?\n/).filter(Boolean)) {
        const entry = raw.replace(/\\/g, '/');
        if (
            entry.startsWith('/')
            || /^[A-Za-z]:/.test(entry)
            || entry.split('/').includes('..')
        ) {
            throw new Error('betterdesk_client_archive_path_traversal');
        }
    }
    await fsp.mkdir(destination, { recursive: true });
    await runTar(['-xzf', archivePath, '-C', destination], path.dirname(archivePath));
}

function readState() {
    try {
        return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    } catch (_) {
        return {
            repo: normalizeRepo(),
            ref: clientRef(),
            termsAccepted: false,
            installedCommit: null,
            status: 'not_installed',
            error: null,
        };
    }
}

async function writeState(patch) {
    await fsp.mkdir(dataRoot(), { recursive: true });
    const next = { ...readState(), ...patch };
    const temporary = `${statePath()}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
    });
    await fsp.rename(temporary, statePath());
    return next;
}

async function getRemoteRevision({ repo, ref } = {}) {
    const targetRepo = normalizeRepo(repo);
    const targetRef = clientRef(ref);
    const commit = await githubJson(
        `https://api.github.com/repos/${targetRepo}/commits/${encodeURIComponent(targetRef)}`
    );
    const sha = String(commit?.sha || '').trim();
    if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('betterdesk_client_commit_invalid');
    return { repo: targetRepo, ref: targetRef, sha };
}

async function syncSource({ repo, ref, force = false } = {}) {
    const remote = await getRemoteRevision({ repo, ref });
    const state = readState();
    if (
        !force
        && state.installedCommit === remote.sha
        && fs.existsSync(path.join(sourceRoot(), 'Cargo.toml'))
    ) {
        if (state.status !== 'ready' || state.phase !== 'ready') {
            await writeState({ status: 'ready', phase: 'ready', error: null });
        }
        return { changed: false, ...remote, sourceDir: sourceRoot() };
    }

    const temporary = path.join(dataRoot(), `.sync-${process.pid}-${Date.now()}`);
    const stagedSource = path.join(temporary, 'source');
    try {
        await writeState({
            status: 'downloading',
            phase: 'syncing_source',
            error: null,
            syncStartedAt: new Date().toISOString(),
        });
        await fsp.rm(temporary, { recursive: true, force: true });
        await fsp.mkdir(temporary, { recursive: true });
        const clone = await runCommand('git', [
            'clone',
            '--filter=blob:none',
            '--no-tags',
            '--no-checkout',
            `https://github.com/${remote.repo}.git`,
            stagedSource,
        ]);
        if (clone.code !== 0) {
            throw new Error(`betterdesk_client_git_clone_failed:${clone.stderr}`);
        }
        await writeState({ phase: 'syncing_submodules' });
        let checkout = await runCommand('git', [
            '-C', stagedSource, 'checkout', '--detach', remote.sha,
        ]);
        if (checkout.code !== 0) {
            const fetch = await runCommand('git', [
                '-C', stagedSource, 'fetch', '--depth', '1', 'origin', remote.sha,
            ]);
            if (fetch.code === 0) {
                checkout = await runCommand('git', [
                    '-C', stagedSource, 'checkout', '--detach', remote.sha,
                ]);
            }
        }
        if (checkout.code !== 0) {
            throw new Error(`betterdesk_client_git_checkout_failed:${checkout.stderr}`);
        }
        const submodules = await runCommand('git', [
            '-C', stagedSource, 'submodule', 'update', '--init', '--recursive',
        ]);
        if (submodules.code !== 0) {
            throw new Error(`betterdesk_client_submodule_failed:${submodules.stderr}`);
        }
        if (
            !fs.existsSync(path.join(stagedSource, 'Cargo.toml'))
            || !fs.existsSync(path.join(stagedSource, 'libs', 'hbb_common', 'Cargo.toml'))
        ) {
            throw new Error('betterdesk_client_source_invalid');
        }

        const previous = path.join(dataRoot(), '.source.previous');
        await fsp.rm(previous, { recursive: true, force: true });
        if (fs.existsSync(sourceRoot())) await fsp.rename(sourceRoot(), previous);
        try {
            await fsp.rename(stagedSource, sourceRoot());
        } catch (err) {
            if (fs.existsSync(previous) && !fs.existsSync(sourceRoot())) {
                await fsp.rename(previous, sourceRoot()).catch(() => {});
            }
            throw err;
        }
        await fsp.rm(previous, { recursive: true, force: true });
        await writeState({
            repo: remote.repo,
            ref: remote.ref,
            installedCommit: remote.sha,
            syncedAt: new Date().toISOString(),
            status: 'ready',
            phase: 'ready',
            error: null,
        });
        return { changed: state.installedCommit !== remote.sha, ...remote, sourceDir: sourceRoot() };
    } catch (err) {
        await writeState({
            status: 'error',
            phase: 'error',
            error: err.message || String(err),
        });
        throw err;
    } finally {
        await fsp.rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
}

/**
 * Startup/update hook. Source synchronisation is completed before requests
 * are queued, but the actual six-target builds remain in the background
 * worker. Existing active generations are never changed by this function.
 */
async function syncAndQueueRebuilds({ force = false } = {}) {
    const result = await syncSource({ force });
    if (!result.changed && !force) {
        return { ...result, queued: false };
    }
    const worker = require('./clientTemplateWorker');
    const rebuild = await worker.rebuildAllForClientRevision(result.sha, { force: false });
    return { ...result, queued: true, rebuild };
}

function providerCommand() {
    return String(process.env.BETTERDESK_CLIENT_BUILD_COMMAND || '').trim()
        || path.join(__dirname, 'localClientBuilder.js');
}

function externalProviderCommand() {
    return String(process.env.BETTERDESK_CLIENT_BUILD_COMMAND || '').trim();
}

function githubActionsEnabled() {
    return String(process.env.BETTERDESK_CLIENT_GITHUB_ACTIONS || 'off').trim().toLowerCase() !== 'off';
}

function githubTokenPresent() {
    return !!String(
        process.env.BETTERDESK_GITHUB_TOKEN || process.env.GITHUB_TOKEN || ''
    ).trim();
}

function usesRemoteProvider() {
    return !!(
        externalProviderCommand()
        || (githubActionsEnabled() && githubTokenPresent())
    );
}

function getBuildCapabilities() {
    if (usesRemoteProvider()) {
        return {
            mode: 'remote',
            targets: null,
            host: null,
            toolchain: { ready: true, missing: [] },
        };
    }
    return localClientBuilder.getCapabilities();
}

function signingSeedPresent() {
    try {
        ensureSigningKeySync();
        return require('./supportGeneratorModule').isSigningSeedValid();
    } catch (_) {
        return false;
    }
}

function isReady() {
    const state = readState();
    return !!(
        state.termsAccepted
        && state.installedCommit
        && state.status === 'ready'
        && fs.existsSync(path.join(sourceRoot(), 'Cargo.toml'))
        && fs.existsSync(path.join(__dirname, 'localClientBuilder.js'))
        && signingSeedPresent()
    );
}

async function acceptTerms() {
    return writeState({ termsAccepted: true, error: null });
}

async function runBuild(request, { onProgress } = {}) {
    if (!isReady()) throw new Error('betterdesk_client_builder_not_ready');
    const signingKey = prepareClientSigningPublicKey();
    request = { ...request, signing_public_key: signingKey.publicKey };
    const requestId = String(request?.generationId || '').trim();
    if (!/^[a-f0-9-]{8,128}$/i.test(requestId)) {
        throw new Error('betterdesk_client_generation_id_invalid');
    }
    await fsp.mkdir(requestRoot(), { recursive: true });
    await fsp.mkdir(outputRoot(), { recursive: true });
    const requestPath = path.join(requestRoot(), `${requestId}.json`);
    const outputDir = path.join(outputRoot(), requestId);
    await fsp.rm(outputDir, { recursive: true, force: true });
    await fsp.mkdir(outputDir, { recursive: true });
    await fsp.writeFile(requestPath, JSON.stringify(request, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
    });

    if (!externalProviderCommand() && githubActionsEnabled() && githubTokenPresent()) {
        onProgress?.({ percent: 10, phase: 'queued_remote_build' });
        const remoteResult = await runGithubActionsBuild(request, requestPath, outputDir);
        onProgress?.({ percent: 100, phase: 'complete' });
        return remoteResult;
    }
    const externalCommand = externalProviderCommand();
    const command = externalCommand || process.execPath;
    const args = externalCommand
        ? [requestPath]
        : [path.join(__dirname, 'localClientBuilder.js'), requestPath];
    const child = spawn(command, args, {
        cwd: sourceRoot(),
        env: {
            ...process.env,
            BETTERDESK_CLIENT_SOURCE_DIR: sourceRoot(),
            BETTERDESK_CLIENT_OUTPUT_DIR: outputDir,
            BETTERDESK_CLIENT_BUILD_REQUEST: requestPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        for (const line of text.split(/\r?\n/)) {
            const match = line.match(/^BETTERDESK_BUILD_PROGRESS\|(\d{1,3})\|(.+)$/);
            if (!match) continue;
            onProgress?.({
                percent: Math.max(0, Math.min(100, Number(match[1]))),
                phase: match[2].trim(),
            });
        }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('betterdesk_client_build_timeout'));
        }, BUILD_TIMEOUT_MS);
        child.on('error', reject);
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
        });
    });
    if (result.code !== 0) {
        throw new Error(
            `betterdesk_client_build_failed:${result.code}:${result.stderr.slice(-4000)}`
        );
    }
    return { outputDir, stdout: result.stdout.slice(-4000), stderr: result.stderr.slice(-4000) };
}

async function runGithubActionsBuild(request, requestPath, outputDir) {
    const state = readState();
    const repo = normalizeRepo(state.repo);
    const workflow = String(
        process.env.BETTERDESK_CLIENT_BUILD_WORKFLOW || 'support-build.yml'
    ).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(workflow)) {
        throw new Error('betterdesk_client_workflow_invalid');
    }
    const startedAt = Date.now();
    await githubRequest(
        'POST',
        `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
        {
            ref: state.ref || DEFAULT_REF,
            inputs: {
                generation_id: request.generationId,
                config_b64: request.signed_config_b64,
                client_commit: request.clientCommit || state.installedCommit,
            },
        }
    );

    const runsUrl = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=20`;
    const deadline = Date.now() + BUILD_TIMEOUT_MS;
    let run = null;
    while (Date.now() < deadline) {
        const data = await githubJson(runsUrl);
        const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
        run = runs.find((candidate) => (
            String(candidate.head_sha || '').toLowerCase()
                === String(request.clientCommit || state.installedCommit).toLowerCase()
            && new Date(candidate.created_at || 0).getTime() >= startedAt - 90_000
        )) || null;
        if (run) break;
        await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    if (!run) throw new Error('betterdesk_client_workflow_run_not_found');

    let runState = run;
    while (Date.now() < deadline) {
        runState = await githubJson(
            `https://api.github.com/repos/${repo}/actions/runs/${run.id}`
        );
        if (runState.status === 'completed') break;
        await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    if (runState.status !== 'completed' || runState.conclusion !== 'success') {
        throw new Error(
            `betterdesk_client_workflow_failed:${runState.status || 'unknown'}:${runState.conclusion || 'unknown'}`
        );
    }

    const artifacts = await githubJson(
        `https://api.github.com/repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`
    );
    const artifact = (artifacts?.artifacts || []).find((candidate) => (
        candidate.name === `betterdesk-support-${request.generationId}` && !candidate.expired
    ));
    if (!artifact?.archive_download_url) {
        throw new Error('betterdesk_client_workflow_artifact_missing');
    }
    const archivePath = path.join(requestRoot(), `${request.generationId}.actions.zip`);
    await downloadToFile(artifact.archive_download_url, archivePath);
    const zip = new AdmZip(archivePath);
    for (const entry of zip.getEntries()) {
        const name = String(entry.entryName || '').replace(/\\/g, '/');
        if (
            name.startsWith('/')
            || /^[A-Za-z]:/.test(name)
            || name.split('/').includes('..')
            || name.toLowerCase().endsWith('/custom.txt')
        ) {
            throw new Error('betterdesk_client_workflow_artifact_invalid');
        }
    }
    zip.extractAllTo(outputDir, true);
    await fsp.rm(archivePath, { force: true });
    return {
        outputDir,
        stdout: `GitHub Actions run ${run.id}`,
        stderr: '',
        requestPath,
    };
}

async function getStatus() {
    const state = readState();
    const signingKey = ensureSigningKeySync();
    let remote = null;
    let updateError = null;
    try {
        remote = await getRemoteRevision({ repo: state.repo, ref: state.ref });
    } catch (err) {
        updateError = err.message || String(err);
    }
    return {
        ...state,
        mode: 'embedded',
        sourceDir: sourceRoot(),
        providerConfigured: !!(providerCommand() || (githubActionsEnabled() && githubTokenPresent())),
        buildCapabilities: getBuildCapabilities(),
        templatesPresent: fs.existsSync(path.join(sourceRoot(), 'Cargo.toml')),
        binariesPresent: fs.existsSync(path.join(sourceRoot(), 'Cargo.toml')),
        signingSeedPresent: signingSeedPresent(),
        signingKeyGenerated: !!signingKey.generated,
        signingPublicKey: signingKey.publicKey,
        signingSeedPath: signingSeedPath(),
        ready: isReady(),
        remoteCommit: remote?.sha || null,
        updateAvailable: !!(remote?.sha && remote.sha !== state.installedCommit),
        updateError,
    };
}

function generationKey(configFingerprint, clientCommit) {
    return crypto.createHash('sha256')
        .update(`${String(configFingerprint || '')}:${String(clientCommit || '')}`)
        .digest('hex');
}

module.exports = {
    DEFAULT_REPO,
    DEFAULT_REF,
    dataRoot,
    sourceRoot,
    statePath,
    requestRoot,
    outputRoot,
    normalizeRepo,
    clientRef,
    ensureSigningKeySync,
    readState,
    writeState,
    acceptTerms,
    getRemoteRevision,
    syncSource,
    syncAndQueueRebuilds,
    getStatus,
    getBuildCapabilities,
    isReady,
    runBuild,
    generationKey,
    _internals: {
        safeExtractTarGz,
        providerCommand,
        githubActionsEnabled,
        githubTokenPresent,
        usesRemoteProvider,
    },
};
