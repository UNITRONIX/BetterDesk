'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    OUT_OF_SCOPE,
    atLeastVersion,
    calculateOverall,
    containsUnexpectedSkip,
    discoverSecurityManifests,
    extractPyprojectDependencies,
    formatCommand,
    parseArgs,
    parseVersion,
    processInvocation,
    redactSensitive,
    resultStatus,
    run,
} = require('./local-gate');

test('argument parsing keeps the gate local and supports dry runs', () => {
    const options = parseArgs(['--dry-run', '--report-dir', '.local-test-results/test']);
    assert.equal(options.dryRun, true);
    assert.match(options.reportDir, /local-test-results[\\/]+test$/u);
});

test('command formatting redacts database credentials', () => {
    const command = formatCommand('node', [
        'scripts/local-docker-smoke.js',
        '--database-url',
        'postgres://user:password@example.test:5432/db?sslmode=disable',
    ]);
    assert.match(command, /postgres:\/\/user:\[REDACTED\]@example\.test/u);
    assert.doesNotMatch(command, /password/u);
});

test('captured diagnostics redact passwords and bearer tokens', () => {
    const safe = redactSensitive(
        'password=plain-secret token:plain-token Authorization: Bearer bearer-secret',
    );
    assert.doesNotMatch(safe, /plain-secret|plain-token|bearer-secret/u);
    assert.match(safe, /\[REDACTED\]/u);
});

test('Windows command shims are invoked through cmd.exe', () => {
    const invocation = processInvocation('npm.cmd', ['--version']);
    if (process.platform === 'win32') {
        assert.equal(invocation.command, 'cmd.exe');
        assert.deepEqual(invocation.args.slice(0, 3), ['/d', '/s', '/c']);
        assert.match(invocation.args[3], /npm\.cmd --version/u);
    } else {
        assert.equal(invocation.command, 'npm.cmd');
    }
});

test('skips are blocking unless explicitly allowed', () => {
    assert.equal(containsUnexpectedSkip('--- SKIP: Docker is not available'), true);
    assert.equal(containsUnexpectedSkip('Tests: 12 passed, 0 skipped'), false);
    assert.equal(resultStatus({ code: 0, stdout: 'SKIP: unavailable', stderr: '' }), 'BLOCKED');
    assert.equal(
        resultStatus({ code: 0, stdout: 'SKIP: unavailable', stderr: '' }, { allowSkip: true }),
        'PASS',
    );
    assert.equal(
        resultStatus({ code: 0, stdout: '1 skipped', stderr: '' }, { expectedSkip: true }),
        'OUT_OF_SCOPE',
    );
    assert.equal(resultStatus({ code: null, error: { code: 'ENOENT' } }), 'BLOCKED');
});

test('version checks compare semantic versions conservatively', () => {
    assert.deepEqual(parseVersion('go version go1.26.6 windows/amd64'), {
        major: 1,
        minor: 26,
        patch: 6,
    });
    assert.equal(atLeastVersion(parseVersion('v22.1.0'), { major: 22, minor: 0, patch: 0 }), true);
    assert.equal(atLeastVersion(parseVersion('v21.9.0'), { major: 22, minor: 0, patch: 0 }), false);
});

test('security manifest discovery includes all dependency ecosystems', () => {
    const manifests = discoverSecurityManifests();
    assert.ok(manifests.pythonRequirements.some((file) => file.endsWith('bridges\\modbus\\requirements.txt')
        || file.endsWith('bridges/modbus/requirements.txt')));
    assert.ok(manifests.pythonProjects.some((file) => file.endsWith('sdks\\python\\pyproject.toml')
        || file.endsWith('sdks/python/pyproject.toml')));
    assert.deepEqual(manifests.rustProjects, []);
});

test('Python project dependencies can be converted for pip-audit', () => {
    const dependencies = extractPyprojectDependencies('sdks/python/pyproject.toml');
    assert.deepEqual(dependencies, ['websockets>=12.0']);
});

test('overall status blocks on required failures but ignores explicit boundaries', () => {
    const report = {
        results: [
            { status: 'PASS', required: true },
            { status: 'OUT_OF_SCOPE', required: false },
        ],
    };
    assert.equal(calculateOverall(report), 'PASS');
    report.results.push({ status: 'BLOCKED', required: true });
    assert.equal(calculateOverall(report), 'BLOCKED');
    report.results.push({ status: 'FAIL', required: true });
    assert.equal(calculateOverall(report), 'FAIL');
    assert.equal(OUT_OF_SCOPE.length >= 1, true);
});

test('dry run does not execute the external test suites', async () => {
    const report = await run({ dryRun: true });
    assert.equal(report.dryRun, true);
    assert.equal(report.overall, 'PASS');
    assert.equal(report.results.length, 0);
});
