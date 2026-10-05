/**
 * Local BetterDesk-Client build provider.
 *
 * Invoked by clientBuilderService with one request JSON path. The source
 * tree is always the runtime snapshot outside the BetterDesk checkout.
 * This provider never builds or publishes the full client profile: it
 * requires the signed Support payload and passes it to Cargo through the
 * compile-time environment.
 */

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');

const requestPath = path.resolve(process.argv[2] || '');
const sourceDir = path.resolve(process.env.BETTERDESK_CLIENT_SOURCE_DIR || '');
const outputDir = path.resolve(process.env.BETTERDESK_CLIENT_OUTPUT_DIR || '');

function toolPath(name, configured) {
    const candidates = [
        configured,
        process.env.BETTERDESK_CLIENT_TOOLCHAIN_BIN
            ? path.join(process.env.BETTERDESK_CLIENT_TOOLCHAIN_BIN, name)
            : '',
        `/opt/betterdesk-toolchain/bin/${name}`,
        `/opt/betterdesk-toolchain/cargo/bin/${name}`,
        `/opt/flutter-3.24.5/bin/${name}`,
        ...(process.env.PATH || '')
            .split(path.delimiter)
            .filter(Boolean)
            .map((dir) => path.join(dir, name)),
    ].filter(Boolean);
    return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function resolveVcpkgRoot() {
    const configured = String(process.env.VCPKG_ROOT || '').trim();
    if (configured) return configured;
    const conventional = process.platform === 'win32' ? 'C:\\vcpkg' : '/opt/vcpkg';
    return fs.existsSync(path.join(conventional, process.platform === 'win32' ? 'vcpkg.exe' : 'vcpkg'))
        ? conventional
        : '';
}

function buildEnvironment() {
    const cargo = toolPath('cargo', process.env.BETTERDESK_CLIENT_CARGO);
    const flutter = toolPath('flutter', process.env.BETTERDESK_CLIENT_FLUTTER);
    if (!cargo) throw new Error('local_builder_toolchain_missing:cargo');
    if (!flutter) throw new Error('local_builder_toolchain_missing:flutter');
    const vcpkgRoot = resolveVcpkgRoot();
    if (!vcpkgRoot) {
        throw new Error('local_builder_toolchain_missing:VCPKG_ROOT');
    }
    if (!fs.existsSync(path.join(vcpkgRoot, process.platform === 'win32' ? 'vcpkg.exe' : 'vcpkg'))) {
        throw new Error('local_builder_toolchain_invalid:VCPKG_ROOT');
    }
    const binDir = path.dirname(cargo);
    const flutterDir = path.dirname(flutter);
    const dartDir = path.join(flutterDir, 'cache', 'dart-sdk', 'bin');
    const pubCache = process.env.PUB_CACHE
        || path.join(process.env.BETTERDESK_CLIENT_TOOLCHAIN_BIN || '/opt/betterdesk-toolchain', 'flutter-pub-cache');
    const pubBin = path.join(pubCache, 'bin');
    const libclangPath = process.env.LIBCLANG_PATH
        || (fs.existsSync('/usr/lib/llvm-18/lib') ? '/usr/lib/llvm-18/lib' : '');
    return {
        ...process.env,
        VCPKG_ROOT: vcpkgRoot,
        PUB_CACHE: pubCache,
        ...(libclangPath ? { LIBCLANG_PATH: libclangPath } : {}),
        PATH: [
            binDir,
            flutterDir,
            fs.existsSync(dartDir) ? dartDir : '',
            pubBin,
            process.env.PATH || '',
        ].filter(Boolean).join(path.delimiter),
        BETTERDESK_CLIENT_SUPPORT_BUILD: '1',
    };
}

async function ensureFlutterRustBridge(sourceDir, environment) {
    const bridgeRust = path.join(sourceDir, 'src', 'bridge_generated.rs');
    const bridgeDart = path.join(sourceDir, 'flutter', 'lib', 'generated_bridge.dart');
    if (fs.existsSync(bridgeRust) && fs.existsSync(bridgeDart)) return;

    const codegenRoot = process.env.BETTERDESK_CLIENT_BRIDGE_CODEGEN_ROOT
        || '/opt/betterdesk-toolchain/bridge-codegen';
    const codegen = path.join(codegenRoot, 'bin', 'flutter_rust_bridge_codegen');
    await fsp.mkdir(codegenRoot, { recursive: true });
    if (!fs.existsSync(codegen)) {
        const install = await run('cargo', [
            'install', 'flutter_rust_bridge_codegen',
            '--version', '1.80.1',
            '--features', 'uuid',
            '--locked',
            '--root', codegenRoot,
        ], { cwd: sourceDir, env: environment });
        if (install.code !== 0) {
            throw new Error(`local_builder_bridge_codegen_install_failed:${install.stderr.slice(-4000)}`);
        }
    }

    const pub = await run('flutter', ['pub', 'get'], {
        cwd: path.join(sourceDir, 'flutter'),
        env: environment,
    });
    if (pub.code !== 0) {
        throw new Error(`local_builder_flutter_pub_get_failed:${pub.stderr.slice(-4000)}`);
    }
    const ffigen = await run('dart', [
        'pub', 'global', 'activate', 'ffigen', '--version', '5.0.1',
    ], { cwd: sourceDir, env: environment });
    if (ffigen.code !== 0) {
        throw new Error(`local_builder_ffigen_install_failed:${ffigen.stderr.slice(-4000)}`);
    }
    const codegenArgs = [
        '--rust-input', './src/flutter_ffi.rs',
        '--dart-output', './flutter/lib/generated_bridge.dart',
        '--c-output', './flutter/macos/Runner/bridge_generated.h',
    ];
    if (fs.existsSync('/usr/lib/llvm-18')) {
        codegenArgs.push('--llvm-path', '/usr/lib/llvm-18');
    }
    const generated = await run(codegen, codegenArgs, { cwd: sourceDir, env: environment });
    if (generated.code !== 0) {
        throw new Error(`local_builder_bridge_codegen_failed:${generated.stderr.slice(-4000)}`);
    }
    const macHeader = path.join(sourceDir, 'flutter', 'macos', 'Runner', 'bridge_generated.h');
    const iosHeader = path.join(sourceDir, 'flutter', 'ios', 'Runner', 'bridge_generated.h');
    if (fs.existsSync(macHeader)) await fsp.copyFile(macHeader, iosHeader);
    if (!fs.existsSync(bridgeRust) || !fs.existsSync(bridgeDart)) {
        throw new Error('local_builder_bridge_codegen_incomplete');
    }
}

function ensureBuildCapacity() {
    const minimumMb = Math.max(
        512,
        Number.parseInt(process.env.BETTERDESK_CLIENT_BUILD_MIN_FREE_MB || '3072', 10)
    );
    const stats = fs.statfsSync(outputDir);
    const freeMb = Math.floor((Number(stats.bavail) * Number(stats.bsize)) / (1024 * 1024));
    if (freeMb < minimumMb) {
        throw new Error(
            `local_builder_disk_space_insufficient:${freeMb}MB<${minimumMb}MB`
        );
    }
    return freeMb;
}

function fail(message) {
    console.error(message);
    process.exitCode = 1;
}

function hostTarget() {
    const platform = process.platform === 'win32'
        ? 'windows'
        : process.platform === 'darwin' ? 'macos' : 'linux';
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return { platform, arch };
}

function providerArch(arch) {
    return arch === 'x64' ? 'x86_64' : 'aarch64';
}

function localToolchainStatus() {
    const missing = [];
    if (!toolPath('cargo', process.env.BETTERDESK_CLIENT_CARGO)) missing.push('cargo');
    if (!toolPath('flutter', process.env.BETTERDESK_CLIENT_FLUTTER)) missing.push('flutter');
    const vcpkgRoot = resolveVcpkgRoot();
    if (!vcpkgRoot) {
        missing.push('VCPKG_ROOT');
    } else if (!fs.existsSync(path.join(vcpkgRoot, process.platform === 'win32' ? 'vcpkg.exe' : 'vcpkg'))) {
        missing.push('VCPKG_ROOT');
    }
    return { ready: missing.length === 0, missing };
}

function getCapabilities() {
    const host = hostTarget();
    const toolchain = localToolchainStatus();
    return {
        mode: 'local',
        host,
        toolchain,
        targets: toolchain.ready ? [{
            platform: host.platform,
            arch: host.arch,
            format: 'portable',
        }] : [],
    };
}

function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
}

async function sha256(filePath) {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest('hex');
}

function assertNoExternalConfig(root) {
    const stack = [root];
    while (stack.length) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (
                entry.name.toLowerCase() === 'custom.txt'
                || entry.name === '.custom-txt-here'
            ) {
                throw new Error('local_builder_external_config_present');
            }
        }
    }
}

async function packageTarget(request, target) {
    const arch = providerArch(target.arch);
    const targetName = `${target.platform}-${arch}`;
    const stage = path.join(outputDir, 'stage', targetName);
    await fsp.rm(stage, { recursive: true, force: true });
    await fsp.mkdir(stage, { recursive: true });

    if (target.platform === 'windows') {
        const source = path.join(
            sourceDir,
            'flutter',
            'build',
            'windows',
            target.arch,
            'runner',
            'Release'
        );
        if (!fs.existsSync(source)) throw new Error(`local_builder_output_missing:${source}`);
        await fsp.cp(source, stage, { recursive: true });
        assertNoExternalConfig(stage);
        const zipPath = path.join(
            outputDir,
            `betterdesk-support-${request.generationId}-${targetName}.zip`
        );
        const zip = new AdmZip();
        zip.addLocalFolder(stage, targetName);
        zip.writeZip(zipPath);
        return zipPath;
    }

    let source;
    if (target.platform === 'linux') {
        source = path.join(
            sourceDir,
            'flutter',
            'build',
            'linux',
            target.arch,
            'release',
            'bundle'
        );
    } else {
        source = path.join(
            sourceDir,
            'flutter',
            'build',
            'macos',
            'Build',
            'Products',
            'Release',
            'BetterDesk Client.app'
        );
    }
    if (!fs.existsSync(source)) throw new Error(`local_builder_output_missing:${source}`);
    await fsp.cp(source, path.join(stage, path.basename(source)), { recursive: true });
    assertNoExternalConfig(stage);
    const archivePath = path.join(
        outputDir,
        `betterdesk-support-${request.generationId}-${targetName}.tar.gz`
    );
    const result = await run('tar', ['-czf', archivePath, targetName], {
        cwd: path.dirname(stage),
        env: process.env,
    });
    if (result.code !== 0) throw new Error(`local_builder_tar_failed:${result.stderr.slice(-2000)}`);
    return archivePath;
}

async function main() {
    if (!fs.existsSync(requestPath) || !fs.existsSync(path.join(sourceDir, 'build.py'))) {
        throw new Error('local_builder_source_or_request_missing');
    }
    const request = JSON.parse(await fsp.readFile(requestPath, 'utf8'));
    if (request.product_sku !== 'betterdesk-support' || !request.signed_config_b64) {
        throw new Error('local_builder_support_payload_required');
    }
    if (!Array.isArray(request.targets) || request.targets.length !== 1) {
        throw new Error('local_builder_single_target_required');
    }

    const host = hostTarget();
    const target = request.targets.find((candidate) => (
        candidate.platform === host.platform && candidate.arch === host.arch
    ));
    if (!target) {
        throw new Error(`local_builder_target_unsupported:${request.targets[0]?.platform || 'unknown'}/${request.targets[0]?.arch || 'unknown'}`);
    }
    await fsp.mkdir(outputDir, { recursive: true });
    ensureBuildCapacity();
    const toolchainEnv = buildEnvironment();
    const progress = (percent, phase) => {
        console.log(`BETTERDESK_BUILD_PROGRESS|${percent}|${phase}`);
    };
    progress(5, 'preparing');
    await ensureFlutterRustBridge(sourceDir, toolchainEnv);
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const args = ['build.py', '--flutter'];
    if (
        String(process.env.BETTERDESK_CLIENT_BUILD_HWCODEC || '').trim().toLowerCase() === 'on'
        && process.env.VCPKG_ROOT
    ) {
        args.push('--hwcodec');
    }
    if (process.platform === 'win32') args.push('--skip-portable-pack');
    progress(10, 'compiling');
    const build = await run(python, args, {
        cwd: sourceDir,
        env: {
            ...toolchainEnv,
            BETTERDESK_SUPPORT_CONFIG_B64: request.signed_config_b64,
            BETTERDESK_FORCE_LOCAL_CARGO_TARGET: '1',
        },
    });
    if (build.code !== 0) {
        throw new Error(`local_builder_compile_failed:${build.stderr.slice(-4000)}`);
    }
    progress(78, 'packaging');
    const artifact = await packageTarget(request, target);
    progress(94, 'verifying');
    const manifest = {
        schema_version: 1,
        sku: 'betterdesk-support',
        generation_id: request.generationId,
        client_commit: request.clientCommit || null,
        external_config: false,
        assets: [{
            name: path.basename(artifact),
            sha256: await sha256(artifact),
            size: (await fsp.stat(artifact)).size,
            platform: target.platform,
            arch: providerArch(target.arch),
        }],
        builder: 'betterdesk-local',
    };
    await fsp.writeFile(
        path.join(outputDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n',
        { encoding: 'utf8', mode: 0o600 }
    );
    progress(100, 'complete');
}

if (require.main === module) {
    main().catch(fail);
}

module.exports = {
    hostTarget,
    providerArch,
    getCapabilities,
};
