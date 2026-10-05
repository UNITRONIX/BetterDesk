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

function commandAvailable(name) {
    const candidates = [
        ...(process.env.PATH || '')
            .split(path.delimiter)
            .filter(Boolean)
            .map((dir) => path.join(dir, name)),
        `/usr/bin/${name}`,
        `/usr/sbin/${name}`,
        `/bin/${name}`,
        `/usr/local/bin/${name}`,
    ];
    return candidates.some((candidate) => fs.existsSync(candidate));
}

function linuxPackageFormats() {
    if (process.platform !== 'linux') return [];
    const formats = ['portable'];
    if (commandAvailable('dpkg-deb')) formats.push('deb');
    if (commandAvailable('rpmbuild')) formats.push('rpm');
    if (commandAvailable('tar') && commandAvailable('zstd')) formats.push('arch');
    return formats;
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
    return {
        ready: missing.length === 0,
        missing,
        packageFormats: linuxPackageFormats(),
    };
}

function getCapabilities() {
    const host = hostTarget();
    const toolchain = localToolchainStatus();
    const formats = host.platform === 'linux'
        ? toolchain.packageFormats
        : ['portable'];
    return {
        mode: 'local',
        host,
        toolchain,
        targets: toolchain.ready ? formats.map((format) => ({
            platform: host.platform,
            arch: host.arch,
            format,
        })) : [],
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

function packageVersion(request) {
    const commit = String(request.clientCommit || '').toLowerCase();
    return `0.0.0.${commit.slice(0, 12).replace(/[^a-f0-9]/g, '') || 'local'}`;
}

async function prepareLinuxBundle(source, target) {
    const arch = providerArch(target.arch);
    const targetName = `linux-${arch}-${target.format}`;
    const stage = path.join(outputDir, 'stage', targetName);
    await fsp.rm(stage, { recursive: true, force: true });
    await fsp.mkdir(stage, { recursive: true });
    await fsp.cp(source, path.join(stage, 'bundle'), { recursive: true });
    assertNoExternalConfig(stage);
    return { arch, targetName, stage };
}

async function packageLinuxDeb(request, target, bundle) {
    const root = path.join(outputDir, 'packages', `${bundle.targetName}-deb`);
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.mkdir(path.join(root, 'DEBIAN'), { recursive: true });
    await fsp.mkdir(path.join(root, 'opt', 'betterdesk-support'), { recursive: true });
    await fsp.cp(path.join(bundle.stage, 'bundle'), path.join(root, 'opt', 'betterdesk-support'), { recursive: true });
    await fsp.mkdir(path.join(root, 'usr', 'bin'), { recursive: true });
    await fsp.symlink('/opt/betterdesk-support/betterdesk', path.join(root, 'usr', 'bin', 'betterdesk'));
    await fsp.writeFile(path.join(root, 'DEBIAN', 'control'), [
        'Package: betterdesk-support',
        `Version: ${packageVersion(request)}`,
        `Architecture: ${target.arch === 'arm64' ? 'arm64' : 'amd64'}`,
        'Section: net',
        'Priority: optional',
        'Maintainer: BetterDesk',
        'Description: BetterDesk Support client',
        ' Embedded support client with signed server configuration.',
        '',
    ].join('\n'));
    const artifact = path.join(
        outputDir,
        `betterdesk-support-${request.generationId}-linux-${bundle.arch}.deb`
    );
    const result = await run('dpkg-deb', ['--build', root, artifact], { env: process.env });
    if (result.code !== 0) throw new Error(`local_builder_deb_failed:${result.stderr.slice(-2000)}`);
    return artifact;
}

async function packageLinuxRpm(request, target, bundle) {
    const top = path.join(outputDir, 'packages', `${bundle.targetName}-rpm`);
    const specDir = path.join(top, 'SPECS');
    const sourceDirForRpm = path.join(top, 'SOURCES');
    await fsp.rm(top, { recursive: true, force: true });
    await fsp.mkdir(specDir, { recursive: true });
    await fsp.mkdir(sourceDirForRpm, { recursive: true });
    await fsp.cp(bundle.stage, path.join(sourceDirForRpm, 'bundle'), { recursive: true });
    const version = packageVersion(request);
    const spec = [
        'Name: betterdesk-support',
        `Version: ${version}`,
        'Release: 1',
        'Summary: BetterDesk Support client',
        'License: AGPL-3.0',
        `BuildArch: ${target.arch === 'arm64' ? 'aarch64' : 'x86_64'}`,
        '%description',
        'BetterDesk Support client with signed server configuration.',
        '%prep',
        '%build',
        '%install',
        'mkdir -p %{buildroot}/opt/betterdesk-support',
        'cp -a %{_sourcedir}/bundle/bundle/. %{buildroot}/opt/betterdesk-support/',
        'mkdir -p %{buildroot}/usr/bin',
        'ln -s /opt/betterdesk-support/betterdesk %{buildroot}/usr/bin/betterdesk',
        '%files',
        '/opt/betterdesk-support',
        '/usr/bin/betterdesk',
        '%changelog',
        '* Mon Oct 05 2026 BetterDesk <support@betterdesk.local> - 0.0.0-1',
        '- Build signed BetterDesk Support client.',
        '',
    ].join('\n');
    const specPath = path.join(specDir, 'betterdesk-support.spec');
    await fsp.writeFile(specPath, spec);
    const result = await run('rpmbuild', [
        '--define', `_topdir ${top}`,
        '-bb',
        specPath,
    ], { env: process.env });
    if (result.code !== 0) throw new Error(`local_builder_rpm_failed:${result.stderr.slice(-2000)}`);
    const rpmArch = target.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const artifact = path.join(
        outputDir,
        `betterdesk-support-${request.generationId}-linux-${bundle.arch}.rpm`
    );
    const built = path.join(top, 'RPMS', rpmArch, `betterdesk-support-${version}-1.${rpmArch}.rpm`);
    if (!fs.existsSync(built)) throw new Error(`local_builder_rpm_output_missing:${built}`);
    await fsp.rename(built, artifact);
    return artifact;
}

async function packageLinuxArch(request, target, bundle) {
    const root = path.join(outputDir, 'packages', `${bundle.targetName}-arch`);
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.mkdir(path.join(root, 'opt', 'betterdesk-support'), { recursive: true });
    await fsp.cp(
        path.join(bundle.stage, 'bundle'),
        path.join(root, 'opt', 'betterdesk-support'),
        { recursive: true }
    );
    await fsp.mkdir(path.join(root, 'usr', 'bin'), { recursive: true });
    await fsp.symlink('/opt/betterdesk-support/betterdesk', path.join(root, 'usr', 'bin', 'betterdesk'));
    const arch = target.arch === 'arm64' ? 'aarch64' : 'x86_64';
    await fsp.writeFile(path.join(root, '.PKGINFO'), [
        'pkgname = betterdesk-support',
        'pkgbase = betterdesk-support',
        'pkgver = 0.0.0-1',
        'pkgdesc = BetterDesk Support client',
        'url = https://betterdesk.eu',
        'builddate = 1791158400',
        'packager = BetterDesk',
        `arch = ${arch}`,
        '',
    ].join('\n'));
    const artifact = path.join(
        outputDir,
        `betterdesk-support-${request.generationId}-linux-${bundle.arch}.pkg.tar.zst`
    );
    const result = await run('tar', ['--zstd', '-cf', artifact, '.'], {
        cwd: root,
        env: process.env,
    });
    if (result.code !== 0) throw new Error(`local_builder_arch_failed:${result.stderr.slice(-2000)}`);
    return artifact;
}

async function packageTarget(request, target) {
    const arch = providerArch(target.arch);
    const targetName = `${target.platform}-${arch}-${target.format}`;
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
        const linuxBundleCandidates = [
            path.join(sourceDir, 'flutter', 'build', 'linux', target.arch, 'release', 'bundle'),
            // BetterDesk-Client's build.py currently uses the Flutter x64
            // directory name for Linux even when the native host is ARM64.
            path.join(sourceDir, 'flutter', 'build', 'linux', 'x64', 'release', 'bundle'),
        ];
        source = linuxBundleCandidates.find((candidate) => fs.existsSync(candidate))
            || linuxBundleCandidates[0];
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
    if (target.platform === 'linux' && target.format !== 'portable') {
        const bundle = await prepareLinuxBundle(source, target);
        if (target.format === 'deb') return packageLinuxDeb(request, target, bundle);
        if (target.format === 'rpm') return packageLinuxRpm(request, target, bundle);
        if (target.format === 'arch') return packageLinuxArch(request, target, bundle);
        throw new Error(`local_builder_format_unsupported:${target.format}`);
    }
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
    if (!Array.isArray(request.targets) || request.targets.length === 0) {
        throw new Error('local_builder_targets_required');
    }
    const host = hostTarget();
    const targets = request.targets
        .filter((candidate) => (
            candidate.platform === host.platform && candidate.arch === host.arch
        ))
        .map((candidate) => ({ ...candidate, format: candidate.format || 'portable' }));
    if (!targets.length) {
        throw new Error(`local_builder_target_unsupported:${request.targets[0]?.platform || 'unknown'}/${request.targets[0]?.arch || 'unknown'}`);
    }
    const available = new Set(getCapabilities().targets.map((candidate) => (
        `${candidate.platform}/${candidate.arch}/${candidate.format}`
    )));
    for (const target of targets) {
        if (!available.has(`${target.platform}/${target.arch}/${target.format}`)) {
            throw new Error(`local_builder_format_unsupported:${target.format || 'portable'}`);
        }
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
    const artifacts = [];
    for (const target of targets) {
        artifacts.push({ target, path: await packageTarget(request, target) });
    }
    progress(94, 'verifying');
    const manifest = {
        schema_version: 1,
        sku: 'betterdesk-support',
        generation_id: request.generationId,
        client_commit: request.clientCommit || null,
        external_config: false,
        assets: await Promise.all(artifacts.map(async ({ target, path: artifact }) => ({
            name: path.basename(artifact),
            sha256: await sha256(artifact),
            size: (await fsp.stat(artifact)).size,
            platform: target.platform,
            arch: providerArch(target.arch),
            format: target.format || 'portable',
        }))),
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
