#!/usr/bin/env node
'use strict';

/**
 * BetterDesk local-only diagnostic gate.
 *
 * This file intentionally uses Node.js built-ins only. It is called by local
 * Git hooks and is never referenced by GitHub Actions. A non-zero exit code
 * means that a commit or push must not proceed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WEB_ROOT = path.join(ROOT, 'web-nodejs');
const SDK_NODE_ROOT = path.join(ROOT, 'sdks', 'nodejs');
const SDK_PYTHON_ROOT = path.join(ROOT, 'sdks', 'python');
const REPORT_DIR = process.env.BETTERDESK_LOCAL_GATE_REPORT_DIR
    ? path.resolve(process.env.BETTERDESK_LOCAL_GATE_REPORT_DIR)
    : path.join(ROOT, '.local-test-results');
const MAX_CAPTURE_BYTES = 512 * 1024;
const COMMAND_TIMEOUT_MS = 30 * 60 * 1000;
const SECURITY_TIMEOUT_MS = 20 * 60 * 1000;
const POSTGRES_PASSWORD = 'BetterDeskLocalGateOnly2026';

const COMPOSE_FILES = [
    'docker-compose.yml',
    'docker-compose.single.yml',
    'docker-compose.quick.yml',
    'docker-compose.quick.single.yml',
    'docker-compose.quick.macvlan.yml',
    'docker-compose.quick.single.macvlan.yml',
];

const BASH_INSTALLER_FILES = [
    'install.sh',
    'betterdesk.sh',
    'betterdesk-docker.sh',
    'scripts/test-native-installer.sh',
    'scripts/test-betterdesk-node-install.sh',
    'scripts/test-postgresql-hba.sh',
    'scripts/test-docker-hardening.sh',
    'scripts/local-gate.sh',
];

const OUT_OF_SCOPE = [
    {
        id: 'native-host-lifecycle',
        area: 'Installer lifecycle on the host',
        reason: 'Requires a disposable Linux/Windows VM and can change services or permissions.',
    },
    {
        id: 'external-rustdesk-client',
        area: 'External RustDesk client and physical devices',
        reason: 'Requires a real client/device pair and is not reproducible from this checkout alone.',
    },
    {
        id: 'missing-desktop-trees',
        area: 'Desktop/agent trees absent from this checkout',
        reason: 'The documented desktop and agent source directories are not tracked here.',
    },
    {
        id: 'platform-specific-linux-tests',
        area: 'Linux-only tests on a Windows host',
        reason: 'Systemd/privileged Linux checks cannot run natively on Windows without changing a host or VM.',
    },
];

function parseArgs(argv) {
    const options = {
        dryRun: false,
        preflightOnly: false,
        reportDir: REPORT_DIR,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--preflight-only') {
            options.preflightOnly = true;
        } else if (arg === '--report-dir') {
            options.reportDir = path.resolve(argv[++index] || '');
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }
    return options;
}

function printUsage() {
    console.log(`Usage: node scripts/local-gate.js [options]

Runs the complete local-only BetterDesk diagnostic gate.

Options:
  --dry-run             Print the planned command categories without running them
  --preflight-only      Validate local tools and versions without running application tests
  --report-dir DIR      Write JSON/Markdown reports to DIR
  --help                Show this help

The gate fails closed: missing required tools, skipped required tests and failed
checks return a non-zero exit code.`);
}

function isWindows() {
    return process.platform === 'win32';
}

function appendOutput(current, chunk) {
    const next = current + String(chunk);
    if (next.length <= MAX_CAPTURE_BYTES) return next;
    return `${next.slice(0, MAX_CAPTURE_BYTES)}\n...[output truncated]`;
}

function redactSensitive(value) {
    return String(value)
        .replace(
            /(postgres(?:ql)?:\/\/[^:]+:)[^@/\s]+(@)/giu,
            '$1[REDACTED]$2',
        )
        .replace(
            /((?:["']?(?:password|passwd|token|secret|api[_-]?key|private[_-]?key)["']?\s*[:=]\s*["']?))[^"',}\s]+/giu,
            '$1[REDACTED]',
        )
        .replace(
            /(authorization\s*:\s*bearer\s+)[^\s]+/giu,
            '$1[REDACTED]',
        );
}

function formatCommand(command, args = []) {
    const rendered = [command, ...args].map((value) => {
        const text = String(value);
        if (/[\s"]/u.test(text)) return `"${text.replace(/"/g, '\\"')}"`;
        return text;
    }).join(' ');
    return rendered.replace(
        /(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi,
        '$1[REDACTED]$3',
    );
}

function quoteCmdArg(value) {
    const text = String(value);
    if (/^[\w./:=+-]+$/u.test(text)) return text;
    return `"${text.replace(/(["^&|<>])/gu, '^$1')}"`;
}

function processInvocation(command, args = []) {
    if (isWindows() && /\.cmd$/iu.test(command)) {
        return {
            command: 'cmd.exe',
            args: ['/d', '/s', '/c', [command, ...args].map(quoteCmdArg).join(' ')],
        };
    }
    return { command, args };
}

function commandCandidates(name) {
    const candidates = [name];
    if (!isWindows()) return candidates;
    if (!name.endsWith('.exe') && !name.endsWith('.cmd')) {
        candidates.unshift(`${name}.exe`, `${name}.cmd`);
    }
    return [...new Set(candidates)];
}

function preferredCommand(name) {
    if (!isWindows() || name !== 'bash') return null;
    const gitInstallRoots = [
        process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Git') : '',
        process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Git') : '',
        'C:\\Program Files\\Git',
    ].filter(Boolean);
    for (const root of [...new Set(gitInstallRoots)]) {
        const candidate = path.join(root, 'bin', 'bash.exe');
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function resolveCommand(name) {
    const preferred = preferredCommand(name);
    if (preferred) return preferred;
    const locator = isWindows() ? 'where.exe' : 'which';
    for (const candidate of commandCandidates(name)) {
        const result = spawnSync(locator, [candidate], {
            cwd: ROOT,
            encoding: 'utf8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (!result.error && result.status === 0) return candidate;
    }
    return null;
}

function executable(name) {
    return resolveCommand(name);
}

function runProcess(command, args = [], options = {}) {
    return new Promise((resolve) => {
        const invocation = processInvocation(command, args);
        const child = spawn(invocation.command, invocation.args, {
            cwd: options.cwd || ROOT,
            env: { ...process.env, ...(options.env || {}) },
            windowsHide: true,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;
        const timeoutMs = options.timeoutMs || COMMAND_TIMEOUT_MS;
        const timer = setTimeout(() => {
            timedOut = true;
            if (isWindows() && child.pid) {
                spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
                    windowsHide: true,
                    stdio: 'ignore',
                });
            } else {
                child.kill('SIGTERM');
            }
        }, timeoutMs);

        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
                command,
                args,
                stdout,
                stderr,
                timedOut,
                ...result,
            });
        };

        child.stdout.on('data', (chunk) => {
            const safeChunk = redactSensitive(chunk);
            stdout = appendOutput(stdout, safeChunk);
            process.stdout.write(safeChunk);
        });
        child.stderr.on('data', (chunk) => {
            const safeChunk = redactSensitive(chunk);
            stderr = appendOutput(stderr, safeChunk);
            process.stderr.write(safeChunk);
        });
        child.once('error', (error) => finish({ code: null, signal: null, error }));
        child.once('close', (code, signal) => finish({ code, signal }));
    });
}

function containsUnexpectedSkip(text) {
    const patterns = [
        /\bSKIP(?:PED)?\s*:/iu,
        /(?:^|\s)[1-9]\d*\s+skipped\b/iu,
        /\btests?\s+skipped\b/iu,
        /\bno tests? to run\b/iu,
    ];
    return patterns.some((pattern) => pattern.test(text));
}

function resultStatus(result, { allowSkip = false, expectedSkip = false } = {}) {
    if (result.error?.code === 'ENOENT') return 'BLOCKED';
    if (result.error) return 'FAIL';
    if (result.timedOut) return 'FAIL';
    if (result.code !== 0) return 'FAIL';
    if (!allowSkip && containsUnexpectedSkip(`${result.stdout}\n${result.stderr}`)) {
        if (expectedSkip) return 'OUT_OF_SCOPE';
        return 'BLOCKED';
    }
    return 'PASS';
}

async function runCheck(report, id, label, command, args = [], options = {}) {
    const commandText = formatCommand(command, args);
    console.log(`\n=== ${label} ===\n$ ${commandText}`);
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const result = await runProcess(command, args, options);
    const status = resultStatus(result, options);
    const detail = result.error?.code === 'ENOENT'
        ? `Required command not found: ${command}`
        : result.timedOut
            ? `Timed out after ${options.timeoutMs || COMMAND_TIMEOUT_MS} ms`
            : result.error?.message || (result.code === 0 ? 'Completed successfully' : `Exit code ${result.code}`);
    const record = {
        id,
        label,
        status,
        required: options.required !== false && status !== 'OUT_OF_SCOPE',
        command: commandText,
        cwd: options.cwd || ROOT,
        startedAt,
        durationMs: Date.now() - started,
        exitCode: result.code,
        signal: result.signal,
        detail,
        stdout: result.stdout,
        stderr: result.stderr,
    };
    report.results.push(record);
    console.log(`[${status}] ${label} (${record.durationMs} ms): ${detail}`);
    return record;
}

function addInternalResult(report, id, label, status, detail, extra = {}) {
    const record = {
        id,
        label,
        status,
        required: extra.required !== false,
        command: extra.command || '',
        cwd: extra.cwd || ROOT,
        startedAt: new Date().toISOString(),
        durationMs: extra.durationMs || 0,
        exitCode: extra.exitCode ?? null,
        signal: null,
        detail,
        stdout: extra.stdout || '',
        stderr: extra.stderr || '',
    };
    report.results.push(record);
    console.log(`[${status}] ${label}: ${detail}`);
    return record;
}

function getRepoState() {
    const branchResult = spawnSync('git', ['branch', '--show-current'], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
    });
    const shaResult = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
    });
    return {
        branch: String(branchResult.stdout || '').trim() || 'unknown',
        sha: String(shaResult.stdout || '').trim() || 'unknown',
        dirty: Boolean(spawnSync('git', ['status', '--porcelain'], {
            cwd: ROOT,
            encoding: 'utf8',
            windowsHide: true,
        }).stdout),
    };
}

function parseVersion(value) {
    const match = String(value).match(/(\d+)\.(\d+)(?:\.(\d+))?/u);
    if (!match) return null;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3] || 0),
    };
}

function atLeastVersion(actual, required) {
    if (!actual) return false;
    if (actual.major !== required.major) return actual.major > required.major;
    if (actual.minor !== required.minor) return actual.minor > required.minor;
    return actual.patch >= required.patch;
}

function listFiles(root, predicate, output = []) {
    if (!fs.existsSync(root)) return output;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if ([
            '.git',
            '.cargo-cache',
            '.cache',
            '.local-test-results',
            '.venv',
            '__pycache__',
            'build',
            'dist',
            'node_modules',
            'target',
        ].includes(entry.name)) {
            continue;
        }
        if (entry.name.endsWith('_old')) continue;
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
            listFiles(fullPath, predicate, output);
        } else if (entry.isFile() && predicate(fullPath)) {
            output.push(fullPath);
        }
    }
    return output;
}

function discoverSecurityManifests() {
    return {
        pythonRequirements: listFiles(ROOT, (file) => /(^|[\\/])requirements[^\\/]*\.txt$/iu.test(file)),
        pythonProjects: listFiles(ROOT, (file) => path.basename(file).toLowerCase() === 'pyproject.toml'),
        rustProjects: listFiles(ROOT, (file) => path.basename(file) === 'Cargo.toml'),
    };
}

function extractPyprojectDependencies(file) {
    const text = fs.readFileSync(file, 'utf8');
    const dependencies = [];
    const block = text.match(/dependencies\s*=\s*\[([\s\S]*?)\]/u)?.[1] || '';
    for (const line of block.split(/\r?\n/u)) {
        const match = line.match(/["']([^"']+)["']/u);
        if (match) dependencies.push(match[1]);
    }
    return dependencies;
}

function findPowerShell() {
    return executable('pwsh') || executable('powershell');
}

function findPython() {
    return executable('python') || executable('python3');
}

function checkDockerCompose(docker) {
    const result = spawnSync(docker, ['compose', 'version'], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15_000,
    });
    return !result.error && result.status === 0
        ? String(result.stdout || result.stderr).trim()
        : '';
}

function checkDockerDaemon(docker) {
    const result = spawnSync(docker, ['info'], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 20_000,
    });
    return !result.error && result.status === 0;
}

function commandVersion(command, args = ['--version']) {
    const invocation = processInvocation(command, args);
    const result = spawnSync(invocation.command, invocation.args, {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15_000,
    });
    if (result.error || result.status !== 0) return '';
    return String(result.stdout || result.stderr).trim();
}

function preflight(report) {
    const tools = {};
    const missing = [];
    const manifests = discoverSecurityManifests();

    const requiredTools = [
        ['node', executable('node')],
        ['npm', executable('npm')],
        ['go', executable('go')],
        ['govulncheck', executable('govulncheck')],
        ['docker', executable('docker')],
        ['gitleaks', executable('gitleaks')],
        ['rg', executable('rg')],
        ['bash', executable('bash')],
        ['shellcheck', executable('shellcheck')],
        ['trivy', executable('trivy')],
        ['powershell', findPowerShell()],
    ];

    if (manifests.pythonRequirements.length || manifests.pythonProjects.length) {
        requiredTools.push(['python', findPython()], ['pip-audit', executable('pip-audit')]);
    }
    if (manifests.rustProjects.length) {
        requiredTools.push(['cargo', executable('cargo')], ['cargo-audit', executable('cargo-audit')]);
    }

    for (const [name, command] of requiredTools) {
        if (!command) {
            missing.push(name);
            addInternalResult(report, `preflight-${name}`, `Required tool: ${name}`, 'BLOCKED', 'Command not found');
        } else {
            tools[name] = command;
            addInternalResult(
                report,
                `preflight-${name}`,
                `Required tool: ${name}`,
                'PASS',
                commandVersion(command, name === 'go' ? ['version'] : ['--version']),
            );
        }
    }

    if (tools.docker) {
        const composeVersion = checkDockerCompose(tools.docker);
        if (!composeVersion) {
            missing.push('docker compose');
            addInternalResult(report, 'preflight-docker-compose', 'Docker Compose plugin', 'BLOCKED', 'docker compose version failed');
        } else {
            addInternalResult(report, 'preflight-docker-compose', 'Docker Compose plugin', 'PASS', composeVersion);
        }
        if (!checkDockerDaemon(tools.docker)) {
            missing.push('Docker daemon');
            addInternalResult(report, 'preflight-docker-daemon', 'Docker daemon', 'BLOCKED', 'docker info failed');
        } else {
            addInternalResult(report, 'preflight-docker-daemon', 'Docker daemon', 'PASS', 'Docker daemon is available');
        }
    }

    if (tools.node) {
        const nodeVersion = parseVersion(process.version);
        const nodeOk = atLeastVersion(nodeVersion, { major: 22, minor: 0, patch: 0 });
        if (!nodeOk) {
            missing.push('Node.js >= 22');
            addInternalResult(report, 'preflight-node-version', 'Node.js version', 'BLOCKED', `${process.version}; required >= 22.0.0`);
        } else {
            addInternalResult(report, 'preflight-node-version', 'Node.js version', 'PASS', process.version);
        }
    }

    if (tools.go) {
        const goVersion = parseVersion(commandVersion(tools.go, ['version']));
        if (!atLeastVersion(goVersion, { major: 1, minor: 25, patch: 0 })) {
            missing.push('Go >= 1.25');
            addInternalResult(report, 'preflight-go-version', 'Go version', 'BLOCKED', `${goVersion ? JSON.stringify(goVersion) : 'unknown'}; required >= 1.25`);
        } else {
            addInternalResult(report, 'preflight-go-version', 'Go version', 'PASS', JSON.stringify(goVersion));
        }
    }

    if (missing.length) {
        addInternalResult(
            report,
            'preflight-summary',
            'Required local environment',
            'BLOCKED',
            `Missing or unavailable: ${[...new Set(missing)].join(', ')}`,
        );
    } else {
        addInternalResult(report, 'preflight-summary', 'Required local environment', 'PASS', 'All required tools and services are available');
    }

    return { ok: missing.length === 0, tools, manifests };
}

function bashCommand(tools, script, args = []) {
    return { command: tools.bash, args: [script, ...args] };
}

function npmCommand(tools) {
    return tools.npm;
}

function pythonCommand(tools) {
    return tools.python;
}

function powershellCommand(tools) {
    return tools.powershell;
}

async function runNodeChecks(report, tools) {
    await runCheck(report, 'node-root-install', 'Install root Node dependencies', npmCommand(tools), [
        'ci', '--no-audit', '--no-fund',
    ], { cwd: ROOT });
    await runCheck(report, 'node-console-install', 'Install console Node dependencies', npmCommand(tools), [
        'ci', '--no-audit', '--no-fund',
    ], { cwd: WEB_ROOT });
    await runCheck(report, 'node-sdk-install', 'Install Node SDK dependencies', npmCommand(tools), [
        'ci', '--no-audit', '--no-fund',
    ], { cwd: SDK_NODE_ROOT });

    for (const [id, cwd, label] of [
        ['npm-audit-root', ROOT, 'Audit root npm dependencies'],
        ['npm-audit-console', WEB_ROOT, 'Audit console npm dependencies'],
        ['npm-audit-sdk', SDK_NODE_ROOT, 'Audit Node SDK dependencies'],
    ]) {
        await runCheck(report, id, label, npmCommand(tools), [
            'audit', '--audit-level=moderate',
        ], { cwd, timeoutMs: SECURITY_TIMEOUT_MS });
    }

    await runCheck(report, 'frontend-syntax', 'Check browser JavaScript syntax', npmCommand(tools), [
        'run', 'check:frontend',
    ], { cwd: WEB_ROOT });
    await runCheck(report, 'protocol-artifacts', 'Verify protocol schema artifacts', npmCommand(tools), [
        'run', 'protocols:check',
    ], { cwd: WEB_ROOT });
    await runCheck(report, 'i18n-parity', 'Verify all locale keys and translations', npmCommand(tools), [
        'run', 'i18n:check',
    ], { cwd: ROOT });
    await runCheck(report, 'provenance-policy', 'Verify clean-room provenance policy', npmCommand(tools), [
        'run', 'check:provenance',
    ], { cwd: WEB_ROOT });
}

async function runGoChecks(report, tools, postgresDsn = '') {
    const goEnv = postgresDsn ? { BETTERDESK_TEST_POSTGRES_DSN: postgresDsn } : {};
    await runCheck(report, 'go-vet', 'Go static analysis', tools.go, ['vet', './...'], {
        cwd: path.join(ROOT, 'betterdesk-server'),
        timeoutMs: COMMAND_TIMEOUT_MS,
        env: goEnv,
    });
    await runCheck(report, 'go-tests-race', 'Go tests with race detector', tools.go, [
        'test', '-race', '-count=1', './...',
    ], {
        cwd: path.join(ROOT, 'betterdesk-server'),
        timeoutMs: COMMAND_TIMEOUT_MS,
        env: goEnv,
    });
    await runCheck(report, 'go-vulnerability-scan', 'Go dependency vulnerability scan', tools.govulncheck, [
        './...',
    ], {
        cwd: path.join(ROOT, 'betterdesk-server'),
        timeoutMs: SECURITY_TIMEOUT_MS,
    });

    const binaryPath = path.join(os.tmpdir(), `betterdesk-server-local-gate-${process.pid}${isWindows() ? '.exe' : ''}`);
    try {
        await runCheck(report, 'go-build', 'Build BetterDesk server binary', tools.go, [
            'build', '-o', binaryPath, '.',
        ], {
            cwd: path.join(ROOT, 'betterdesk-server'),
            timeoutMs: COMMAND_TIMEOUT_MS,
        });
        if (fs.existsSync(binaryPath)) {
            await runCheck(report, 'go-binary-help', 'Verify BetterDesk server binary help', binaryPath, [
                '--help',
            ], { cwd: path.join(ROOT, 'betterdesk-server'), timeoutMs: 15_000 });
        } else {
            addInternalResult(report, 'go-binary-help', 'Verify BetterDesk server binary help', 'BLOCKED', 'Build did not create the expected binary');
        }
    } finally {
        try {
            fs.rmSync(binaryPath, { force: true });
        } catch {
            // The command result is more useful than a cleanup warning.
        }
    }

    for (const [goos, goarch] of [['linux', 'amd64'], ['linux', 'arm64'], ['windows', 'amd64']]) {
        const output = path.join(os.tmpdir(), `betterdesk-server-${goos}-${goarch}-${process.pid}${goos === 'windows' ? '.exe' : ''}`);
        try {
            await runCheck(report, `go-cross-${goos}-${goarch}`, `Cross-compile Go server for ${goos}/${goarch}`, tools.go, [
                'build', '-o', output, '.',
            ], {
                cwd: path.join(ROOT, 'betterdesk-server'),
                timeoutMs: COMMAND_TIMEOUT_MS,
                env: { GOOS: goos, GOARCH: goarch },
            });
        } finally {
            try {
                fs.rmSync(output, { force: true });
            } catch {
                // Keep the original command result.
            }
        }
    }

    if (postgresDsn) {
        await runCheck(report, 'go-postgres-tests', 'Go PostgreSQL integration tests', tools.go, [
            'test', './db/...', '-run', 'Postgres', '-count=1',
        ], {
            cwd: path.join(ROOT, 'betterdesk-server'),
            timeoutMs: COMMAND_TIMEOUT_MS,
            env: { BETTERDESK_TEST_POSTGRES_DSN: postgresDsn },
        });
    } else {
        addInternalResult(report, 'go-postgres-tests', 'Go PostgreSQL integration tests', 'BLOCKED', 'No temporary PostgreSQL DSN was created');
    }
}

async function runPythonChecks(report, tools, manifests) {
    const python = pythonCommand(tools);
    await runCheck(report, 'python-compile', 'Compile Python bridges and SDK', python, [
        '-m', 'compileall', '-q', path.join(ROOT, 'bridges'), SDK_PYTHON_ROOT,
    ], { timeoutMs: COMMAND_TIMEOUT_MS });
    await runCheck(report, 'python-sdk-tests', 'Run Python SDK tests', python, [
        '-m', 'unittest', 'discover', '-s', path.join(SDK_PYTHON_ROOT, 'tests'), '-p', 'test_*.py',
    ], { cwd: ROOT, timeoutMs: COMMAND_TIMEOUT_MS });

    for (const requirements of manifests.pythonRequirements) {
        await runCheck(report, `pip-audit-${path.basename(path.dirname(requirements))}`, `Audit Python requirements ${path.relative(ROOT, requirements)}`, tools['pip-audit'], [
            '-r', requirements,
        ], { cwd: ROOT, timeoutMs: SECURITY_TIMEOUT_MS });
    }

    for (const project of manifests.pythonProjects) {
        const dependencies = extractPyprojectDependencies(project);
        if (!dependencies.length) {
            addInternalResult(report, `pip-audit-project-${path.basename(path.dirname(project))}`, `Audit Python project ${path.relative(ROOT, project)}`, 'BLOCKED', 'No project dependencies could be extracted');
            continue;
        }
        const tempFile = path.join(os.tmpdir(), `betterdesk-python-deps-${process.pid}.txt`);
        fs.writeFileSync(tempFile, `${dependencies.join('\n')}\n`, 'utf8');
        try {
            await runCheck(report, `pip-audit-project-${path.basename(path.dirname(project))}`, `Audit Python project ${path.relative(ROOT, project)}`, tools['pip-audit'], [
                '-r', tempFile,
            ], { cwd: ROOT, timeoutMs: SECURITY_TIMEOUT_MS });
        } finally {
            fs.rmSync(tempFile, { force: true });
        }
    }
}

async function runRustChecks(report, tools, manifests) {
    const projectDirectories = [...new Set(
        manifests.rustProjects.map((file) => path.dirname(file)),
    )];
    for (const projectDirectory of projectDirectories) {
        const relativeDirectory = path.relative(ROOT, projectDirectory);
        await runCheck(report, `cargo-audit-${relativeDirectory}`, `Audit Rust dependencies in ${relativeDirectory}`, tools.cargo, [
            'audit',
        ], { cwd: projectDirectory, timeoutMs: SECURITY_TIMEOUT_MS });
        await runCheck(report, `cargo-test-${relativeDirectory}`, `Run Rust tests in ${relativeDirectory}`, tools.cargo, [
            'test', '--locked',
        ], { cwd: projectDirectory, timeoutMs: COMMAND_TIMEOUT_MS });
    }
}

async function runInstallerChecks(report, tools) {
    const discoveredShellFiles = listFiles(ROOT, (file) => file.toLowerCase().endsWith('.sh'))
        .map((file) => path.relative(ROOT, file).split(path.sep).join('/'));
    const files = [...new Set([...BASH_INSTALLER_FILES, ...discoveredShellFiles])].sort();
    await runCheck(report, 'bash-syntax', 'Parse Bash installers and local wrappers', tools.bash, [
        '-n', ...files,
    ], { timeoutMs: 60_000 });
    await runCheck(report, 'shellcheck', 'Run ShellCheck on installers and wrappers', tools.shellcheck, [
        '--severity=error', ...files,
    ], { timeoutMs: 120_000 });

    for (const [id, script, label] of [
        ['installer-node-recovery', 'scripts/test-betterdesk-node-install.sh', 'Test Node installer recovery'],
        ['installer-native-recovery', 'scripts/test-native-installer.sh', 'Test native installer recovery'],
        ['installer-postgres-hba', 'scripts/test-postgresql-hba.sh', 'Test PostgreSQL HBA setup'],
    ]) {
        const invocation = bashCommand(tools, script);
        await runCheck(report, id, label, invocation.command, invocation.args, { timeoutMs: 120_000 });
    }

    for (const [id, script, label] of [
        ['installer-help', 'install.sh', 'Check install.sh help path'],
        ['betterdesk-help', 'betterdesk.sh', 'Check betterdesk.sh help path'],
        ['docker-installer-help', 'betterdesk-docker.sh', 'Check betterdesk-docker.sh help path'],
    ]) {
        const invocation = bashCommand(tools, script, ['--help']);
        await runCheck(report, id, label, invocation.command, invocation.args, { timeoutMs: 60_000 });
    }

    const powershellCheck = path.join(ROOT, 'scripts', 'check-powershell-syntax.ps1');
    await runCheck(report, 'powershell-syntax', 'Parse PowerShell installers', powershellCommand(tools), [
        '-NoProfile', '-NonInteractive', '-File', powershellCheck,
    ], { timeoutMs: 60_000 });
}

async function runSecurityChecks(report, tools) {
    await runCheck(report, 'gitleaks', 'Scan repository for secrets with gitleaks', tools.gitleaks, [
        'detect', '--source', '.', '--config', '.gitleaks.toml',
        '--exclude', '.local-test-results/**',
        '--exclude', '**/node_modules/**',
        '--exclude', '**/*_old/**',
        '--exclude', '.cargo-cache/**',
    ], { cwd: ROOT, timeoutMs: SECURITY_TIMEOUT_MS });

    const sensitive = bashCommand(tools, 'scripts/check-no-sensitive-paths.sh');
    await runCheck(report, 'sensitive-paths', 'Scan for operator-specific sensitive paths', sensitive.command, sensitive.args, {
        cwd: ROOT,
        timeoutMs: 120_000,
    });

    await runCheck(report, 'trivy-filesystem', 'Scan source tree for vulnerabilities, secrets and misconfiguration', tools.trivy, [
        'fs',
        '--scanners', 'vuln,secret,misconfig',
        '--severity', 'HIGH,CRITICAL',
        '--exit-code', '1',
        '--skip-dirs', '.git',
        '--skip-dirs', 'node_modules',
        '--skip-dirs', '.local-test-results',
        '--skip-dirs', '*_old',
        '--skip-dirs', '.cargo-cache',
        '.',
    ], { cwd: ROOT, timeoutMs: SECURITY_TIMEOUT_MS });
}

async function runComposeConfigChecks(report, tools) {
    for (const composeFile of COMPOSE_FILES) {
        const fullPath = path.join(ROOT, composeFile);
        if (!fs.existsSync(fullPath)) {
            addInternalResult(report, `compose-config-${composeFile}`, `Validate ${composeFile}`, 'BLOCKED', 'Compose file is missing');
            continue;
        }
        await runCheck(report, `compose-config-${composeFile}`, `Validate ${composeFile}`, tools.docker, [
            'compose', '-f', fullPath, 'config', '--quiet',
        ], {
            cwd: ROOT,
            env: {
                PG_PASSWORD: POSTGRES_PASSWORD,
                MACVLAN_IPV4: '192.0.2.51',
            },
            timeoutMs: 120_000,
        });
    }

    const singleBuild = await runCheck(report, 'docker-build-single', 'Build local single-container image', tools.docker, [
        'compose', '-f', path.join(ROOT, 'docker-compose.single.yml'), 'build', 'betterdesk',
    ], { cwd: ROOT, timeoutMs: COMMAND_TIMEOUT_MS });
    const splitBuild = await runCheck(report, 'docker-build-split', 'Build local split server and console images', tools.docker, [
        'compose', '-f', path.join(ROOT, 'docker-compose.yml'), 'build', 'server', 'console',
    ], { cwd: ROOT, timeoutMs: COMMAND_TIMEOUT_MS });
    return {
        singleBuilt: singleBuild.status === 'PASS',
        splitBuilt: splitBuild.status === 'PASS',
    };
}

async function startPostgres(report, tools) {
    const name = `betterdesk-local-gate-postgres-${process.pid}-${Date.now()}`;
    const startResult = await runCheck(report, 'postgres-start', 'Start isolated PostgreSQL container', tools.docker, [
        'run', '--detach',
        '--name', name,
        '--label', 'com.betterdesk.local-gate=true',
        '--publish', '127.0.0.1::5432',
        '--env', 'POSTGRES_USER=betterdesk',
        '--env', 'POSTGRES_DB=betterdesk',
        '--env', 'POSTGRES_PASSWORD',
        'postgres:16-alpine',
    ], {
        cwd: ROOT,
        env: { POSTGRES_PASSWORD },
        timeoutMs: COMMAND_TIMEOUT_MS,
    });
    if (startResult.status !== 'PASS') {
        return { name, dsn: '', containerDsn: '' };
    }

    const deadline = Date.now() + 120_000;
    let ready = false;
    while (Date.now() < deadline) {
        const probe = await runProcess(tools.docker, [
            'exec', name, 'pg_isready', '-U', 'betterdesk', '-d', 'betterdesk',
        ], { timeoutMs: 10_000 });
        if (probe.code === 0) {
            ready = true;
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    if (!ready) {
        addInternalResult(report, 'postgres-ready', 'Wait for isolated PostgreSQL', 'FAIL', 'pg_isready did not succeed within 120 seconds');
        return { name, dsn: '', containerDsn: '' };
    }
    const portResult = spawnSync(tools.docker, ['port', name, '5432/tcp'], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
    });
    const port = String(portResult.stdout || '').match(/:(\d+)\s*$/m)?.[1];
    if (!port) {
        addInternalResult(report, 'postgres-ready', 'Wait for isolated PostgreSQL', 'FAIL', 'Could not determine the mapped PostgreSQL port');
        return { name, dsn: '', containerDsn: '' };
    }
    const hostDsn = `postgres://betterdesk:${POSTGRES_PASSWORD}@127.0.0.1:${port}/betterdesk?sslmode=disable`;
    const containerDsn = `postgres://betterdesk:${POSTGRES_PASSWORD}@host.docker.internal:${port}/betterdesk?sslmode=disable`;
    addInternalResult(report, 'postgres-ready', 'Wait for isolated PostgreSQL', 'PASS', `PostgreSQL is ready on an ephemeral local port ${port}`);
    return { name, dsn: hostDsn, containerDsn };
}

async function runDockerRuntimeChecks(report, tools, postgres, builds) {
    if (!builds.singleBuilt) {
        addInternalResult(
            report,
            'docker-runtime-prerequisite',
            'Local Docker runtime prerequisite',
            'BLOCKED',
            'The single-container image build failed; runtime checks will not use a stale local image.',
        );
        return;
    }

    const smoke = path.join(ROOT, 'scripts', 'local-docker-smoke.js');
    await runCheck(report, 'docker-smoke-sqlite', 'Smoke-test local Docker image with SQLite', process.execPath, [
        smoke,
        '--database-type', 'sqlite',
    ], { cwd: ROOT, timeoutMs: COMMAND_TIMEOUT_MS });

    if (postgres?.containerDsn) {
        await runCheck(report, 'docker-smoke-postgres', 'Smoke-test local Docker image with PostgreSQL', process.execPath, [
            smoke,
            '--database-type', 'postgres',
            '--database-url', postgres.containerDsn,
        ], { cwd: ROOT, timeoutMs: COMMAND_TIMEOUT_MS });
    } else {
        addInternalResult(report, 'docker-smoke-postgres', 'Smoke-test local Docker image with PostgreSQL', 'BLOCKED', 'PostgreSQL container was not ready');
    }

    for (const image of ['betterdesk:local', 'betterdesk-server:local', 'betterdesk-console:local']) {
        await runCheck(report, `trivy-image-${image.replace(/[^a-z0-9]+/giu, '-')}`, `Scan local image ${image}`, tools.trivy, [
            'image',
            '--scanners', 'vuln,secret,misconfig',
            '--severity', 'HIGH,CRITICAL',
            '--exit-code', '1',
            image,
        ], { cwd: ROOT, timeoutMs: SECURITY_TIMEOUT_MS });
    }

    const hardening = bashCommand(tools, 'scripts/test-docker-hardening.sh');
    await runCheck(report, 'docker-hardening', 'Test hardened Docker bind mounts and restart behavior', hardening.command, hardening.args, {
        cwd: ROOT,
        env: { BETTERDESK_HARDENING_IMAGE: 'betterdesk:local' },
        timeoutMs: COMMAND_TIMEOUT_MS,
    });
}

async function runFullNodeTests(report, tools, builds) {
    if (!builds.splitBuilt) {
        addInternalResult(
            report,
            'console-docker-integration-prerequisite',
            'Console Docker integration prerequisite',
            'BLOCKED',
            'The split server/console image build failed; integration tests will not use stale local images.',
        );
        await runCheck(report, 'console-tests-unit-only', 'Run console tests without unavailable Docker integration', npmCommand(tools), [
            'run', 'test:ci',
        ], {
            cwd: WEB_ROOT,
            env: { RUN_DOCKER_INTEGRATION: '0' },
            expectedSkip: true,
            timeoutMs: COMMAND_TIMEOUT_MS,
        });
        return;
    }
    await runCheck(report, 'console-tests', 'Run full Node.js console test suite including Docker integration', npmCommand(tools), [
        'run', 'test:ci',
    ], {
        cwd: WEB_ROOT,
        env: {
            RUN_DOCKER_INTEGRATION: '1',
            BETTERDESK_SERVER_IMAGE: 'betterdesk-server:local',
            BETTERDESK_CONSOLE_IMAGE: 'betterdesk-console:local',
        },
        expectedSkip: true,
        timeoutMs: COMMAND_TIMEOUT_MS,
    });
    await runCheck(report, 'node-sdk-tests', 'Run Node.js SDK tests', npmCommand(tools), [
        'test',
    ], { cwd: SDK_NODE_ROOT, timeoutMs: 120_000 });
}

async function runVersionAndDiffChecks(report, tools) {
    await runCheck(report, 'version-parity', 'Verify repository version parity', npmCommand(tools), [
        'scripts/bump-version.js', '--verify',
    ], { cwd: ROOT, timeoutMs: 60_000 });
    await runCheck(report, 'git-diff-check', 'Check whitespace and patch errors', 'git', [
        'diff', '--check',
    ], { cwd: ROOT, timeoutMs: 60_000 });
}

function writeReports(report, reportDir) {
    fs.mkdirSync(reportDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
    const jsonPath = path.join(reportDir, `local-gate-${stamp}.json`);
    const markdownPath = path.join(reportDir, `local-gate-${stamp}.md`);
    const latestJson = path.join(reportDir, 'latest.json');
    const latestMarkdown = path.join(reportDir, 'latest.md');
    const json = JSON.stringify(report, null, 2) + '\n';
    const lines = [
        `# BetterDesk local gate`,
        ``,
        `- Overall: **${report.overall}**`,
        `- Branch: \`${report.repository.branch}\``,
        `- Commit: \`${report.repository.sha}\``,
        `- Host: \`${report.environment.platform} ${report.environment.release}\``,
        `- Started: ${report.startedAt}`,
        `- Finished: ${report.finishedAt || 'in progress'}`,
        ``,
        `## Checks`,
        ``,
        ...report.results.map((result) => (
            `- **${result.status}** \`${result.id}\` — ${result.label}: ${result.detail}`
        )),
        ``,
        `## Explicit boundaries`,
        ``,
        ...report.outOfScope.map((entry) => `- **OUT_OF_SCOPE** ${entry.area}: ${entry.reason}`),
        ``,
        `The report is local-only. It does not prove external client, physical-device, or disposable-host lifecycle behavior.`,
        ``,
    ];
    const markdown = lines.join('\n');
    fs.writeFileSync(jsonPath, json, 'utf8');
    fs.writeFileSync(markdownPath, markdown, 'utf8');
    fs.writeFileSync(latestJson, json, 'utf8');
    fs.writeFileSync(latestMarkdown, markdown, 'utf8');
    return { jsonPath, markdownPath, latestJson, latestMarkdown };
}

function calculateOverall(report) {
    const required = report.results.filter((result) => result.required !== false);
    if (required.some((result) => result.status === 'FAIL')) return 'FAIL';
    if (required.some((result) => result.status === 'BLOCKED')) return 'BLOCKED';
    return 'PASS';
}

function printSummary(report, paths) {
    const counts = report.results.reduce((accumulator, result) => {
        accumulator[result.status] = (accumulator[result.status] || 0) + 1;
        return accumulator;
    }, {});
    console.log(`\nLOCAL GATE: ${report.overall}`);
    console.log(Object.entries(counts).map(([status, count]) => `${status}=${count}`).join(' '));
    console.log(`JSON report: ${paths.latestJson}`);
    console.log(`Markdown report: ${paths.latestMarkdown}`);
}

async function run(options = {}) {
    const report = {
        schemaVersion: 1,
        localOnly: true,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        repository: getRepoState(),
        environment: {
            platform: process.platform,
            release: os.release(),
            arch: process.arch,
            node: process.version,
        },
        results: [],
        outOfScope: OUT_OF_SCOPE,
        overall: 'BLOCKED',
    };
    let postgres = null;

    if (options.dryRun) {
        console.log('Dry run: full local gate categories:');
        console.log('- preflight and version checks');
        console.log('- npm install/audit, frontend/protocol/i18n/provenance and Jest');
        console.log('- Go vet/tests/race/vulnerability scan/build/cross-build');
        console.log('- Python compile/tests/pip-audit');
        console.log('- Rust tests and cargo-audit when Rust manifests are present');
        console.log('- gitleaks, sensitive path scan and Trivy');
        console.log('- Bash/ShellCheck/PowerShell installer checks');
        console.log('- Compose validation, local image builds, PostgreSQL and runtime smoke');
        return { ...report, overall: 'PASS', dryRun: true };
    }

    try {
        if (process.env.GITHUB_ACTIONS === 'true') {
            addInternalResult(
                report,
                'local-only-guard',
                'Local-only execution guard',
                'BLOCKED',
                'The local gate is intentionally disabled inside GitHub Actions.',
            );
        } else {
            const environment = preflight(report);
            if (options.preflightOnly) {
                if (!environment.ok) {
                    // The final status is calculated in finally.
                }
            } else if (environment.ok) {
                const { tools, manifests } = environment;
                await runVersionAndDiffChecks(report, tools);
                await runNodeChecks(report, tools);
                await runPythonChecks(report, tools, manifests);
                await runRustChecks(report, tools, manifests);
                await runInstallerChecks(report, tools);
                await runSecurityChecks(report, tools);
                const dockerBuilds = await runComposeConfigChecks(report, tools);

                postgres = await startPostgres(report, tools);
                await runGoChecks(report, tools, postgres.dsn);
                await runFullNodeTests(report, tools, dockerBuilds);
                await runDockerRuntimeChecks(report, tools, postgres, dockerBuilds);
            }
        }
    } catch (error) {
        addInternalResult(report, 'local-gate-fatal', 'Local gate orchestration', 'FAIL', error.message);
    } finally {
        if (postgres?.name) {
            const docker = executable('docker');
            if (docker) {
                spawnSync(docker, ['rm', '--force', postgres.name], {
                    cwd: ROOT,
                    windowsHide: true,
                    stdio: 'ignore',
                });
            }
        }
        report.finishedAt = new Date().toISOString();
        report.overall = calculateOverall(report);
    }

    const paths = writeReports(report, options.reportDir || REPORT_DIR);
    printSummary(report, paths);
    return report;
}

async function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        if (options.help) {
            printUsage();
            return;
        }
        const report = await run(options);
        if (report.overall !== 'PASS') process.exitCode = 1;
    } catch (error) {
        console.error(`LOCAL GATE FAILED: ${error.message}`);
        process.exitCode = 1;
    }
}

if (require.main === module) main();

module.exports = {
    ROOT,
    REPORT_DIR,
    COMPOSE_FILES,
    OUT_OF_SCOPE,
    parseArgs,
    redactSensitive,
    formatCommand,
    processInvocation,
    containsUnexpectedSkip,
    resultStatus,
    parseVersion,
    atLeastVersion,
    discoverSecurityManifests,
    extractPyprojectDependencies,
    calculateOverall,
    run,
};
