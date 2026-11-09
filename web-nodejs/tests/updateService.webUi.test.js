'use strict';

// The in-app updater brings web-ui/ (the new console) along: it syncs the
// sources from GitHub, builds them with npm 11 and keeps the previous build
// when that fails. GitHub (https.get) and the build (child_process.spawn)
// are faked; the files are real, in a temporary folder.

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');

const SHA = 'b'.repeat(40);
const OWNER_REPO = '/repos/UNITRONIX/BetterDesk';

/** GitHub: raw files by repo path, API answers by request path */
function fakeGithub({ raw = {}, api = {} } = {}) {
    const requested = [];
    jest.spyOn(https, 'get').mockImplementation((target, optsOrCb, maybeCb) => {
        const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
        const url = target instanceof URL
            ? target
            : new URL(typeof target === 'string' ? target : `https://${target.hostname}${target.path}`);
        const route = decodeURIComponent(url.pathname) + url.search;
        requested.push(`${url.hostname}${route}`);
        let body = null;
        if (url.hostname === 'raw.githubusercontent.com') {
            const repoPath = route.split('/').slice(4).join('/');
            if (raw[repoPath] !== undefined) body = Buffer.from(raw[repoPath]);
        } else if (api[route] !== undefined) {
            body = Buffer.from(JSON.stringify(api[route]));
        }
        process.nextTick(() => cb({
            statusCode: body ? 200 : 404,
            headers: {},
            resume() {},
            on(event, handler) {
                if (event === 'data' && body) process.nextTick(() => handler(body));
                if (event === 'end') process.nextTick(handler);
                return this;
            },
        }));
        return { on: jest.fn(), setTimeout: jest.fn(), destroy: jest.fn() };
    });
    return requested;
}

/** child_process.spawn that runs `behaviour(cmd, args, opts)` instead */
function fakeSpawn(behaviour) {
    const spawn = jest.fn((cmd, args, opts) => {
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = jest.fn();
        setImmediate(() => {
            const r = behaviour(cmd, args, opts) || {};
            if (r.stdout) proc.stdout.emit('data', r.stdout);
            if (r.stderr) proc.stderr.emit('data', r.stderr);
            proc.emit('close', r.code ?? 0, null);
        });
        return proc;
    });
    return spawn;
}

/** What @sveltejs/adapter-static does: empty build/, then write the new site */
function adapterWrites(root, html) {
    const build = path.join(root, 'build');
    fs.rmSync(build, { recursive: true, force: true });
    fs.mkdirSync(path.join(build, '_ui'), { recursive: true });
    fs.writeFileSync(path.join(build, 'index.html'), html);
}

/** A build that works: npm ci passes, npm run build writes `html` */
function buildingTo(html) {
    return (cmd, args, opts) => {
        if (args.includes('build')) adapterWrites(opts.cwd, html);
        return { code: 0, stdout: `${cmd} ok\n` };
    };
}

function writeFile(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

function read(file) {
    return fs.readFileSync(file, 'utf8');
}

const PACKAGE_JSON = JSON.stringify({ name: 'betterdesk-web-ui', engines: { node: '>=22.17' } });

describe('updateService web-ui (new console)', () => {
    let tmpRoot;
    let dataDir;
    let webUi;
    let spawn;

    function load({ behaviour = buildingTo('<html>new</html>'), docker = false } = {}) {
        jest.resetModules();
        spawn = fakeSpawn(behaviour);
        jest.doMock('../config/config', () => ({ isDocker: docker, dataDir, appVersion: '3.0.0-test' }));
        jest.doMock('child_process', () => ({
            ...jest.requireActual('child_process'),
            spawn,
            // security-patch-verify, systemctl: not run here
            execSync: jest.fn(() => Buffer.from('')),
        }));
        jest.doMock('../scripts/linux-ensure-console-user', () => ({
            ensureLinuxConsoleServiceUser: () => ({ changed: false, changes: [], warnings: [], permissionsOk: true }),
        }));
        // The console's own .env merge would touch web-nodejs/.env
        jest.doMock('../lib/envMerge', () => ({
            ...jest.requireActual('../lib/envMerge'),
            mergeEnvFile: jest.fn(() => ({ mode: 'merge', added: [] })),
        }));
        // eslint-disable-next-line global-require
        return require('../services/updateService');
    }

    function installedWebUi() {
        writeFile(path.join(webUi, 'package.json'), PACKAGE_JSON);
        writeFile(path.join(webUi, 'src', 'app.html'), 'old app');
        writeFile(path.join(webUi, 'build', 'index.html'), '<html>old</html>');
        writeFile(path.join(webUi, 'build', '_ui', 'immutable', 'old.js'), 'old chunk');
    }

    function changed(webuiFiles) {
        return {
            grouped: { console: [], webui: webuiFiles, server: [], agent: [], scripts: [], other: [] },
            totalFiles: webuiFiles.length,
            compareTruncated: false,
        };
    }

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-webui-update-'));
        dataDir = path.join(tmpRoot, 'data');
        webUi = path.join(tmpRoot, 'console', 'web-ui');
        fs.mkdirSync(dataDir, { recursive: true });
        // Never let a test fall back to the repo's own web-ui/
        process.env.WEB_UI_DIR = path.join(webUi, 'build');
        delete process.env.BETTERDESK_UPDATE_MODE;
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.resetModules();
        for (const mod of ['../config/config', 'child_process', '../scripts/linux-ensure-console-user', '../lib/envMerge']) {
            jest.dontMock(mod);
        }
        delete process.env.WEB_UI_DIR;
        delete process.env.BETTERDESK_UPDATE_MODE;
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    test('groups web-ui files, keeps src/lib/data, drops tests and build output, removes renamed files', async () => {
        const updateService = load();
        fs.writeFileSync(path.join(dataDir, '.update_sha'), `${'a'.repeat(40)}\n`);
        fakeGithub({
            api: {
                [`${OWNER_REPO}/compare/${'a'.repeat(40)}...${SHA}`]: {
                    total_commits: 1,
                    files: [
                        { filename: 'web-ui/src/app.html', status: 'modified' },
                        { filename: 'web-ui/src/lib/data/fleet.ts', status: 'added' },
                        { filename: 'web-ui/tests/unit/x.test.ts', status: 'modified' },
                        { filename: 'web-ui/build/index.html', status: 'modified' },
                        {
                            filename: 'web-ui/src/routes/(console)/new/+page.svelte',
                            previous_filename: 'web-ui/src/routes/(console)/old/+page.svelte',
                            status: 'renamed',
                        },
                        { filename: 'web-ui/tests/moved.ts', previous_filename: 'web-ui/src/moved.ts', status: 'renamed' },
                    ],
                },
            },
        });

        const data = await updateService.getChangedFiles(SHA);

        expect(data.grouped.webui).toEqual([
            expect.objectContaining({ localPath: 'src/app.html', status: 'modified' }),
            expect.objectContaining({ localPath: 'src/lib/data/fleet.ts', status: 'added' }),
            expect.objectContaining({
                localPath: 'src/routes/(console)/new/+page.svelte',
                previousPath: 'src/routes/(console)/old/+page.svelte',
            }),
            expect.objectContaining({ localPath: 'src/moved.ts', status: 'removed' }),
        ]);
        expect(data.grouped.other).toEqual([]);
    });

    test('applies a web-ui change, builds it with npm 11 and restarts the console on the new build', async () => {
        installedWebUi();
        const updateService = load();
        fakeGithub({ raw: { 'web-ui/src/app.html': 'new app' } });

        const result = await updateService.applyUpdate(SHA, changed([
            { path: 'web-ui/src/app.html', localPath: 'src/app.html', status: 'modified', component: 'webui' },
        ]), { createBackup: false });

        expect(read(path.join(webUi, 'src', 'app.html'))).toBe('new app');
        expect(spawn.mock.calls.map(([cmd, args]) => [cmd, ...args].join(' '))).toEqual([
            `npx -y ${updateService.WEB_UI_NPM} ci --include=dev --no-audit --no-fund`,
            'npm run build',
        ]);
        expect(spawn.mock.calls.every(([, , opts]) => opts.cwd === webUi)).toBe(true);
        expect(read(path.join(webUi, 'build', 'index.html'))).toBe('<html>new</html>');
        expect(fs.existsSync(path.join(webUi, '.build-prev'))).toBe(false);
        expect(result.selectedComponents).toContain('webui');
        expect(result.webUi.build).toMatchObject({ success: true });
        expect(result.failed).toEqual([]);
        expect(result.needsConsoleRestart).toBe(true);
        expect(result.shaSaved).toBe(true);
    });

    test('a failed build is non-critical, puts the previous build back and is retried by the next update', async () => {
        installedWebUi();
        // The adapter emptied build/ and then failed: build/ is half written
        let attempt = 0;
        const updateService = load({
            behaviour: (cmd, args, opts) => {
                if (!args.includes('build')) return { code: 0 };
                attempt += 1;
                if (attempt === 1) {
                    fs.rmSync(path.join(opts.cwd, 'build'), { recursive: true, force: true });
                    writeFile(path.join(opts.cwd, 'build', '_ui', 'half.js'), 'half');
                    return { code: 1, stderr: 'Error: fallback page failed to render\n' };
                }
                adapterWrites(opts.cwd, '<html>retried</html>');
                return { code: 0 };
            },
        });
        fakeGithub({ raw: { 'web-ui/src/app.html': 'new app' } });

        const result = await updateService.applyUpdate(SHA, changed([
            { path: 'web-ui/src/app.html', localPath: 'src/app.html', status: 'modified', component: 'webui' },
        ]), { createBackup: false });

        const failure = result.failed.find((f) => f.file === 'web-ui build');
        expect(failure).toMatchObject({ nonCritical: true, previousBuildKept: true });
        expect(failure.error).toMatch(/fallback page failed to render/);
        expect(failure.error).toContain(path.join(dataDir, 'web-ui-build.log'));
        expect(result.criticalFailures).toEqual([]);
        expect(result.nonCriticalFailures.map((f) => f.file)).toContain('web-ui build');
        expect(result.shaSaved).toBe(true);
        expect(result.needsConsoleRestart).toBe(false);
        expect(read(path.join(webUi, 'build', 'index.html'))).toBe('<html>old</html>');
        expect(read(path.join(webUi, 'build', '_ui', 'immutable', 'old.js'))).toBe('old chunk');
        expect(fs.existsSync(path.join(webUi, 'build', '_ui', 'half.js'))).toBe(false);
        expect(read(path.join(dataDir, 'web-ui-build.log'))).toMatch(/fallback page failed to render/);

        // Next update, nothing new in web-ui/: the failed build is redone
        const retry = await updateService.updateWebUi('c'.repeat(40), changed([]));
        expect(retry.build).toMatchObject({ success: true });
        expect(read(path.join(webUi, 'build', 'index.html'))).toBe('<html>retried</html>');
        expect(await updateService.updateWebUi('d'.repeat(40), changed([]))).toBeNull();
    });

    test('without a previous build a failed build leaves no half-written build behind', async () => {
        writeFile(path.join(webUi, 'package.json'), PACKAGE_JSON);
        const updateService = load({
            behaviour: (cmd, args, opts) => {
                if (!args.includes('build')) return { code: 0 };
                writeFile(path.join(opts.cwd, 'build', '_ui', 'half.js'), 'half');
                return { code: 1, stderr: 'boom' };
            },
        });
        fakeGithub({ raw: { 'web-ui/src/app.html': 'new app' } });

        const result = await updateService.updateWebUi(SHA, changed([
            { path: 'web-ui/src/app.html', localPath: 'src/app.html', status: 'modified', component: 'webui' },
        ]));

        expect(result.failed).toEqual([
            expect.objectContaining({ file: 'web-ui build', nonCritical: true, previousBuildKept: false }),
        ]);
        expect(fs.existsSync(path.join(webUi, 'build'))).toBe(false);
    });

    test('docs-only changes are synced without a rebuild; removed and renamed files are deleted', async () => {
        installedWebUi();
        writeFile(path.join(webUi, 'src', 'routes', 'old', '+page.svelte'), 'old route');
        writeFile(path.join(webUi, 'src', 'gone.ts'), 'gone');
        const updateService = load();
        fakeGithub({ raw: { 'web-ui/README.md': '# new readme' } });

        const docsOnly = await updateService.applyUpdate(SHA, changed([
            { path: 'web-ui/README.md', localPath: 'README.md', status: 'modified', component: 'webui' },
        ]), { createBackup: false });

        expect(read(path.join(webUi, 'README.md'))).toBe('# new readme');
        expect(spawn).not.toHaveBeenCalled();
        expect(docsOnly.needsConsoleRestart).toBe(false);

        fakeGithub({ raw: { 'web-ui/src/routes/new/+page.svelte': 'new route' } });
        const moved = await updateService.updateWebUi('c'.repeat(40), changed([
            { path: 'web-ui/src/gone.ts', localPath: 'src/gone.ts', status: 'removed', component: 'webui' },
            {
                path: 'web-ui/src/routes/new/+page.svelte',
                localPath: 'src/routes/new/+page.svelte',
                previousPath: 'src/routes/old/+page.svelte',
                status: 'renamed',
                component: 'webui',
            },
        ]));

        expect(fs.existsSync(path.join(webUi, 'src', 'gone.ts'))).toBe(false);
        expect(fs.existsSync(path.join(webUi, 'src', 'routes', 'old', '+page.svelte'))).toBe(false);
        expect(read(path.join(webUi, 'src', 'routes', 'new', '+page.svelte'))).toBe('new route');
        expect(moved.build).toMatchObject({ success: true });
    });

    test('an install without web-ui gets the whole tree, a WEB_UI_DIR in .env and a build', async () => {
        // Console installed by an installer that didn't know web-ui: no WEB_UI_DIR
        const consoleDir = path.join(tmpRoot, 'BetterDeskConsole');
        const envPath = path.join(consoleDir, '.env');
        writeFile(envPath, 'PORT=5000\n');
        const updateService = load();
        const layout = updateService.resolveWebUiLayout({ env: {}, rootDir: consoleDir });
        expect(layout).toEqual({
            root: path.join(consoleDir, 'web-ui'),
            buildDir: path.join(consoleDir, 'web-ui', 'build'),
            writeEnv: true,
        });
        // Left over from an older copy: gone upstream, under src/
        writeFile(path.join(layout.root, 'src', 'stale.ts'), 'stale');
        writeFile(path.join(layout.root, 'node_modules', 'x', 'index.js'), 'dep');
        fakeGithub({
            api: {
                [`${OWNER_REPO}/git/commits/${SHA}`]: { tree: { sha: 'r'.repeat(40) } },
                [`${OWNER_REPO}/git/trees/${'r'.repeat(40)}`]: { tree: [{ type: 'tree', path: 'web-ui', sha: 'w'.repeat(40) }] },
                [`${OWNER_REPO}/git/trees/${'w'.repeat(40)}?recursive=1`]: {
                    tree: [
                        { type: 'blob', path: 'package.json' },
                        { type: 'blob', path: 'src/app.html' },
                        { type: 'blob', path: 'src/lib/data/fleet.ts' },
                        { type: 'blob', path: 'tests/unit/a.test.ts' },
                        { type: 'blob', path: 'e2e/smoke.spec.ts' },
                    ],
                },
            },
            raw: {
                'web-ui/package.json': PACKAGE_JSON,
                'web-ui/src/app.html': 'app',
                'web-ui/src/lib/data/fleet.ts': 'fleet',
            },
        });

        const result = await updateService.updateWebUi(SHA, changed([]), { layout, envPath });

        expect(result.sync).toMatchObject({ full: true, downloaded: 3, removed: 1, failed: [] });
        expect(read(path.join(layout.root, 'src', 'lib', 'data', 'fleet.ts'))).toBe('fleet');
        expect(fs.existsSync(path.join(layout.root, 'src', 'stale.ts'))).toBe(false);
        expect(fs.existsSync(path.join(layout.root, 'tests'))).toBe(false);
        expect(read(path.join(layout.root, 'node_modules', 'x', 'index.js'))).toBe('dep');
        expect(read(envPath)).toBe(`PORT=5000\nWEB_UI_DIR=${layout.buildDir}\n`);
        expect(result.build).toMatchObject({ success: true });
        expect(read(path.join(layout.buildDir, 'index.html'))).toBe('<html>new</html>');
    });

    test('does not build on a Node older than web-ui/package.json engines, and keeps the build', async () => {
        installedWebUi();
        const updateService = load();
        fakeGithub({ raw: { 'web-ui/src/app.html': 'new app' } });

        const result = await updateService.updateWebUi(SHA, changed([
            { path: 'web-ui/src/app.html', localPath: 'src/app.html', status: 'modified', component: 'webui' },
        ]), { nodeVersion: '22.11.0' });

        expect(spawn).not.toHaveBeenCalled();
        expect(result.failed).toEqual([expect.objectContaining({ file: 'web-ui build', nonCritical: true })]);
        expect(result.failed[0].error).toMatch(/Node\.js 22\.17\.0 or newer.*22\.11\.0.*previous build stays/);
        expect(read(path.join(webUi, 'build', 'index.html'))).toBe('<html>old</html>');
        expect(updateService.webUiNodeProblem(PACKAGE_JSON, '22.17.0')).toBeNull();
        expect(updateService.webUiNodeProblem(PACKAGE_JSON, '24.1.0')).toBeNull();
        expect(updateService.webUiNodeProblem(PACKAGE_JSON, '20.19.0')).toMatch(/22\.17\.0/);
    });

    test('Docker image installs leave web-ui to the image', async () => {
        installedWebUi();
        process.env.BETTERDESK_UPDATE_MODE = 'image';
        const updateService = load({ docker: true });
        const requested = fakeGithub({ raw: { 'web-ui/src/app.html': 'new app' } });

        const result = await updateService.updateWebUi(SHA, changed([
            { path: 'web-ui/src/app.html', localPath: 'src/app.html', status: 'modified', component: 'webui' },
        ]));

        expect(result).toBeNull();
        expect(requested).toEqual([]);
        expect(spawn).not.toHaveBeenCalled();
        expect(read(path.join(webUi, 'src', 'app.html'))).toBe('old app');
    });

    test('leaves a WEB_UI_DIR alone that is not a web-ui build folder', () => {
        const updateService = load();
        expect(updateService.resolveWebUiLayout({ env: { WEB_UI_DIR: '/srv/ui-dist' } }))
            .toMatchObject({ root: null });
        expect(updateService.resolveWebUiLayout({ env: { WEB_UI_DIR: '/opt/c/web-ui/build' } }))
            .toMatchObject({ root: path.resolve('/opt/c/web-ui'), writeEnv: false });
        expect(updateService.resolveWebUiLayout({ env: {}, rootDir: '/repo/web-nodejs' }))
            .toMatchObject({ root: path.resolve('/repo/web-ui'), writeEnv: false });
    });
});
