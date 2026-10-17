'use strict';

const { execFileSync } = require('child_process');

const runDockerIntegration = process.env.RUN_DOCKER_INTEGRATION === '1';
const serverImage = process.env.BETTERDESK_SERVER_IMAGE || 'betterdesk-server:issue385';
const consoleImage = process.env.BETTERDESK_CONSOLE_IMAGE || 'betterdesk-console:issue385';
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function sleep(ms) {
    Atomics.wait(sleepBuffer, 0, 0, ms);
}

function docker(args, options = {}) {
    return execFileSync('docker', args, {
        encoding: 'utf8',
        stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
        ...options,
    });
}

function dockerQuiet(args) {
    try {
        docker(args, { stdio: 'ignore' });
    } catch (_) {
        // Cleanup is best effort so the original assertion remains visible.
    }
}

const describeDocker = runDockerIntegration ? describe : describe.skip;

describeDocker('split Docker bootstrap and panel login', () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const network = `bd385-jest-net-${suffix}`;
    const server = `bd385-jest-server-${suffix}`;
    const console = `bd385-jest-console-${suffix}`;
    const dataVolume = `bd385-jest-data-${suffix}`;
    const panelVolume = `bd385-jest-panel-${suffix}`;
    const password = 'Issue385-Test-Password-123!';

    function waitForConsole() {
        const deadline = Date.now() + 45_000;
        while (Date.now() < deadline) {
            try {
                docker([
                    'exec', console, 'curl', '-fsS',
                    'http://127.0.0.1:5000/login',
                ], { stdio: 'ignore' });
                return;
            } catch (_) {
                const delayUntilRetry = Math.min(1_000, Math.max(1, deadline - Date.now()));
                sleep(delayUntilRetry);
            }
        }
        throw new Error('Console did not become ready within 45 seconds');
    }

    function waitForConsoleBootstrapWait() {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
            try {
                if (docker(['logs', console]).includes(
                    'Waiting for Go server to create the Docker bootstrap admin'
                )) {
                    return;
                }
            } catch (_) {
                // The container may not have emitted startup output yet.
            }
            sleep(500);
        }
        throw new Error('Console did not reach the Go-owned bootstrap wait state');
    }

    afterAll(() => {
        dockerQuiet(['rm', '-f', console, server]);
        dockerQuiet(['volume', 'rm', dataVolume, panelVolume]);
        dockerQuiet(['network', 'rm', network]);
    });

    test('converges on one admin and accepts the bootstrap password', () => {
        docker(['network', 'create', network]);
        docker(['volume', 'create', dataVolume]);
        docker(['volume', 'create', panelVolume]);

        docker([
            'run', '-d', '--name', console,
            '--network', network, '--network-alias', 'console',
            '-v', `${dataVolume}:/opt/rustdesk`,
            '-v', `${panelVolume}:/app/data`,
            '--env', 'NODE_ENV=production',
            '--env', 'PORT=5000',
            '--env', 'HOST=0.0.0.0',
            '--env', 'API_HOST=0.0.0.0',
            '--env', 'API_ENABLED=false',
            '--env', 'SERVER_BACKEND=betterdesk',
            '--env', 'BETTERDESK_API_URL=http://server:21114/api',
            '--env', 'RUSTDESK_PATH=/opt/rustdesk',
            '--env', 'DATA_DIR=/app/data',
            '--env', 'DB_PATH=/opt/rustdesk/db_v2.sqlite3',
            '--env', `ADMIN_PASSWORD=${password}`,
            '--env', 'DEFAULT_ADMIN_USERNAME=admin',
            '--env', `DEFAULT_ADMIN_PASSWORD=${password}`,
            '--env', 'DOCKER=true',
            '--env', 'WS_HBBS_HOST=server',
            '--env', 'WS_HBBS_PORT=21116',
            '--env', 'WS_HBBR_HOST=server',
            '--env', 'WS_HBBR_PORT=21117',
            '--env', 'PUID=10001',
            '--env', 'PGID=10001',
            consoleImage,
        ]);

        // Start Node first and wait until it reaches the guard so this test
        // deterministically exercises the race that caused issue #385.
        waitForConsoleBootstrapWait();
        docker([
            'run', '-d', '--name', server,
            '--network', network, '--network-alias', 'server',
            '-v', `${dataVolume}:/opt/rustdesk`,
            '-v', `${panelVolume}:/app/data:ro`,
            '--env', 'ENCRYPTED_ONLY=1',
            '--env', 'DB_URL=/opt/rustdesk/db_v2.sqlite3',
            '--env', 'AUTH_DB_PATH=/app/data/auth.db',
            '--env', `ADMIN_PASSWORD=${password}`,
            '--env', 'INIT_ADMIN_USER=admin',
            '--env', `INIT_ADMIN_PASS=${password}`,
            '--env', 'PUID=10001',
            '--env', 'PGID=10001',
            serverImage,
            '/usr/local/bin/betterdesk-server',
            '-mode', 'all',
            '-api-port', '21114',
            '-key-file', '/opt/rustdesk/id_ed25519',
        ]);

        waitForConsole();

        const credentials = docker([
            'exec', '-u', 'betterdesk', console,
            'betterdesk-show-admin-credentials',
        ]);
        expect(credentials).toContain(`Admin Password: ${password}`);

        const users = docker([
            'exec', console, 'sqlite3', '/opt/rustdesk/db_v2.sqlite3',
            'SELECT username, substr(password_hash,1,4), role FROM users;',
        ]);
        expect(users).toContain('admin|$2b$|admin');

        expect(() => docker([
            'exec', console, 'sh', '-c',
            'test ! -e /app/data/auth.db',
        ])).not.toThrow();

        const consoleLogs = docker(['logs', console]);
        expect(consoleLogs).toContain('Waiting for Go server to create the Docker bootstrap admin');
        expect(consoleLogs).toContain('Admin password hash migrated from PBKDF2 to bcrypt');

        const loginProbe = [
            'set -eu',
            'curl -fsS -c /tmp/bd-cookies http://127.0.0.1:5000/login > /tmp/bd-login.html',
            "csrf=$(sed -n \"s/.*csrfToken: '\\([^']*\\)'.*/\\1/p\" /tmp/bd-login.html | head -n 1)",
            'test -n "$csrf"',
            `printf '%s' '${Buffer.from(JSON.stringify({ username: 'admin', password })).toString('base64')}' | base64 -d > /tmp/bd-body.json`,
            'login=$(curl -fsS -b /tmp/bd-cookies -c /tmp/bd-cookies -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" --data-binary @/tmp/bd-body.json http://127.0.0.1:5000/api/auth/login)',
            'printf "%s\\n" "$login"',
            'case "$login" in *\'"success":true\'*) ;; *) echo "login response: $login" >&2; exit 1 ;; esac',
            'verify=$(curl -fsS -b /tmp/bd-cookies http://127.0.0.1:5000/api/auth/verify)',
            'case "$verify" in *\'"success":true\'*\'"user":\'*) ;; *) echo "verify response: $verify" >&2; exit 1 ;; esac',
        ].join('\n');
        const loginResult = docker(['exec', console, 'sh', '-c', loginProbe]);
        expect(loginResult).toContain('"success":true');
    });
});
