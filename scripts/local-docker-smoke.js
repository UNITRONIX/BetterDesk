#!/usr/bin/env node
'use strict';

/**
 * Destructive-looking but isolated local smoke test.
 *
 * The test uses a temporary Docker container and named volumes with a unique
 * label. It never touches the host installation paths or the project's
 * production Compose container names.
 */

const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = require('path').join(__dirname, '..');
const IMAGE = process.env.BETTERDESK_LOCAL_IMAGE || 'betterdesk:local';
const PASSWORD = 'BetterDesk-Local-Gate-Only-2026!';
const REQUEST_TIMEOUT_MS = 5_000;
const STARTUP_TIMEOUT_MS = 120_000;

function parseArgs(argv) {
    const options = {
        databaseUrl: '',
        databaseType: 'sqlite',
        keep: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--database-url') {
            options.databaseUrl = argv[++index] || '';
        } else if (arg === '--database-type') {
            options.databaseType = argv[++index] || 'sqlite';
        } else if (arg === '--keep') {
            options.keep = true;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }

    if (!['sqlite', 'postgres'].includes(options.databaseType)) {
        throw new Error('--database-type must be sqlite or postgres');
    }
    if (options.databaseType === 'postgres' && !options.databaseUrl) {
        throw new Error('--database-url is required for postgres smoke tests');
    }
    return options;
}

function docker(args, { allowFailure = false } = {}) {
    const result = spawnSync('docker', args, {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
    });
    if (!allowFailure && (result.error || result.status !== 0)) {
        const detail = result.error?.message
            || String(result.stderr || result.stdout || '').trim()
            || `exit code ${result.status}`;
        throw new Error(`docker ${args.join(' ')} failed: ${detail}`);
    }
    return result;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(url, options = {}) {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const req = transport.request(target, {
            method: options.method || 'GET',
            timeout: options.timeoutMs || REQUEST_TIMEOUT_MS,
            headers: options.headers || {},
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode || 0,
                    headers: res.headers,
                    body,
                });
            });
        });
        req.on('timeout', () => req.destroy(new Error('request timed out')));
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function firstCookie(headers) {
    return (headers['set-cookie'] || [])
        .map((cookie) => String(cookie).split(';', 1)[0])
        .filter(Boolean)
        .join('; ');
}

function getCsrfToken(html) {
    const patterns = [
        /csrfToken:\s*'([^']+)'/,
        /csrfToken:\s*"([^"]+)"/,
        /name=["']_csrf["'][^>]+value=["']([^"']+)["']/i,
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(html);
        if (match) return match[1];
    }
    return '';
}

async function login(panelUrl) {
    const page = await request(`${panelUrl}/login`);
    if (page.statusCode < 200 || page.statusCode >= 300) {
        throw new Error(`login page returned HTTP ${page.statusCode}`);
    }

    const csrf = getCsrfToken(page.body);
    if (!csrf) throw new Error('login page did not expose a CSRF token');
    const cookie = firstCookie(page.headers);
    const body = JSON.stringify({ username: 'admin', password: PASSWORD });
    const response = await request(`${panelUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Cookie': cookie,
            'X-CSRF-Token': csrf,
        },
        body,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`login returned HTTP ${response.statusCode}: ${response.body}`);
    }

    let payload;
    try {
        payload = JSON.parse(response.body);
    } catch {
        throw new Error(`login returned invalid JSON: ${response.body}`);
    }
    if (payload.success !== true) {
        throw new Error(`login was rejected: ${response.body}`);
    }

    const loginCookie = [cookie, firstCookie(response.headers)].filter(Boolean).join('; ');
    const verify = await request(`${panelUrl}/api/auth/verify`, {
        headers: { Cookie: loginCookie },
    });
    if (verify.statusCode < 200 || verify.statusCode >= 300) {
        throw new Error(`session verification returned HTTP ${verify.statusCode}`);
    }
    let verifyPayload;
    try {
        verifyPayload = JSON.parse(verify.body);
    } catch {
        throw new Error(`session verification returned invalid JSON: ${verify.body}`);
    }
    if (verifyPayload.success !== true || !verifyPayload.user) {
        throw new Error(`session verification failed: ${verify.body}`);
    }
}

function mappedPort(container, port) {
    const result = docker(['port', container, `${port}/tcp`]);
    const match = String(result.stdout).match(/:(\d+)\s*$/m);
    if (!match) throw new Error(`could not determine mapped port ${port} for ${container}`);
    return Number(match[1]);
}

async function waitForHealth(apiUrl, panelUrl) {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    let lastError = 'services have not started';
    while (Date.now() < deadline) {
        try {
            const [api, panel] = await Promise.all([
                request(`${apiUrl}/api/health`),
                request(`${panelUrl}/health`),
            ]);
            if (api.statusCode >= 200 && api.statusCode < 300
                && panel.statusCode >= 200 && panel.statusCode < 300) {
                return;
            }
            lastError = `API ${api.statusCode}, panel ${panel.statusCode}`;
        } catch (error) {
            lastError = error.message;
        }
        await sleep(1_000);
    }
    throw new Error(`services did not become healthy: ${lastError}`);
}

async function waitForContainerHealthy(container) {
    const deadline = Date.now() + 60_000;
    let status = 'unknown';
    while (Date.now() < deadline) {
        status = String(docker([
            'inspect', '--format', '{{.State.Health.Status}}', container,
        ]).stdout).trim();
        if (status === 'healthy') return;
        if (status === 'unhealthy') throw new Error('container health status is unhealthy');
        await sleep(1_000);
    }
    throw new Error(`container health status remained ${status || 'unknown'}`);
}

function containerExec(container, args) {
    return docker(['exec', container, ...args]);
}

async function run(options) {
    const suffix = `${process.pid}-${Date.now()}`;
    const container = `betterdesk-local-gate-${suffix}`;
    const dataVolume = `betterdesk-local-gate-data-${suffix}`;
    const consoleVolume = `betterdesk-local-gate-console-${suffix}`;
    let apiUrl = '';
    let panelUrl = '';

    const environment = [
        'NODE_ENV=production',
        'PORT=5000',
        'HOST=0.0.0.0',
        'API_HOST=0.0.0.0',
        'API_ENABLED=false',
        'SERVER_BACKEND=betterdesk',
        'BETTERDESK_API_URL=http://127.0.0.1:21121/api',
        'HBBS_API_URL=http://127.0.0.1:21121/api',
        'RUSTDESK_PATH=/opt/rustdesk',
        'DATA_DIR=/app/data',
        'DB_PATH=/opt/rustdesk/db_v2.sqlite3',
        'AUTH_DB_PATH=/app/data/auth.db',
        'SQLITE_AUTH_DB_MODE=',
        'ADMIN_PASSWORD=' + PASSWORD,
        'INIT_ADMIN_USER=admin',
        'INIT_ADMIN_PASS=' + PASSWORD,
        'DEFAULT_ADMIN_USERNAME=admin',
        'DEFAULT_ADMIN_PASSWORD=' + PASSWORD,
        'DOCKER=true',
        'AGENT_BUILD_WORKER=off',
        'BETTERDESK_GITHUB_TOKEN=',
        'PUID=10001',
        'PGID=10001',
        'ENROLLMENT_MODE=managed',
    ];

    if (options.databaseType === 'postgres') {
        environment.push('DB_TYPE=postgres', `DATABASE_URL=${options.databaseUrl}`, `DB_URL=${options.databaseUrl}`);
    } else {
        environment.push('DB_TYPE=sqlite');
    }

    try {
        docker(['volume', 'create', dataVolume]);
        docker(['volume', 'create', consoleVolume]);
        docker([
            'run', '--detach',
            '--name', container,
            '--label', 'com.betterdesk.local-gate=true',
            '--publish', '127.0.0.1::5000',
            '--publish', '127.0.0.1::21121',
            '--volume', `${dataVolume}:/opt/rustdesk`,
            '--volume', `${consoleVolume}:/app/data`,
            '--add-host', 'host.docker.internal:host-gateway',
            ...environment.flatMap((value) => ['--env', value]),
            IMAGE,
        ]);

        const panelPort = mappedPort(container, 5000);
        const apiPort = mappedPort(container, 21121);
        panelUrl = `http://127.0.0.1:${panelPort}`;
        apiUrl = `http://127.0.0.1:${apiPort}`;
        await waitForHealth(apiUrl, panelUrl);
        await login(panelUrl);

        const firstKey = String(containerExec(container, ['sh', '-c', 'cat /opt/rustdesk/.api_key']).stdout)
            .trim();
        if (!firstKey) throw new Error('container did not create an API key');

        const protocol = spawnSync(process.execPath, [
            require('path').join(__dirname, 'installer-protocol-check.js'),
            '--api-url', `${apiUrl}/api/health`,
            '--panel-url', `${panelUrl}/health`,
            '--port', `127.0.0.1:${apiPort}`,
        ], {
            cwd: ROOT,
            encoding: 'utf8',
            windowsHide: true,
            maxBuffer: 2 * 1024 * 1024,
        });
        process.stdout.write(protocol.stdout || '');
        process.stderr.write(protocol.stderr || '');
        if (protocol.error || protocol.status !== 0) {
            throw new Error(`installer protocol check failed with exit code ${protocol.status}`);
        }

        docker(['restart', container]);
        const restartedPanelPort = mappedPort(container, 5000);
        const restartedApiPort = mappedPort(container, 21121);
        panelUrl = `http://127.0.0.1:${restartedPanelPort}`;
        apiUrl = `http://127.0.0.1:${restartedApiPort}`;
        await waitForHealth(apiUrl, panelUrl);
        await login(panelUrl);
        const secondKey = String(containerExec(container, ['sh', '-c', 'cat /opt/rustdesk/.api_key']).stdout)
            .trim();
        if (firstKey !== secondKey) {
            throw new Error('API key changed after a container restart');
        }

        await waitForContainerHealthy(container);

        console.log(`PASS local Docker smoke (${options.databaseType}) ${apiUrl} ${panelUrl}`);
        return { apiUrl, panelUrl, container, dataVolume, consoleVolume };
    } catch (error) {
        const logs = docker(['logs', '--tail', '200', container], { allowFailure: true });
        if (logs.stdout) process.stderr.write(logs.stdout);
        if (logs.stderr) process.stderr.write(logs.stderr);
        throw error;
    } finally {
        if (!options.keep) {
            docker(['rm', '--force', container], { allowFailure: true });
            docker(['volume', 'rm', '--force', dataVolume], { allowFailure: true });
            docker(['volume', 'rm', '--force', consoleVolume], { allowFailure: true });
        }
    }
}

async function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        if (options.help) {
            console.log('Usage: node scripts/local-docker-smoke.js [--database-type sqlite|postgres] [--database-url URL] [--keep]');
            return;
        }
        await run(options);
    } catch (error) {
        console.error(`FAIL local Docker smoke: ${error.message}`);
        process.exitCode = 1;
    }
}

if (require.main === module) main();

module.exports = {
    parseArgs,
    getCsrfToken,
    firstCookie,
    mappedPort,
    waitForHealth,
    waitForContainerHealthy,
    login,
    run,
};
