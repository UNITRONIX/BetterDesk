'use strict';

/**
 * Idempotency and cleanup coverage for issue #515.
 *
 * "Import latest release" re-downloaded all six assets (~181 MB) and then died
 * on rename(staging, destination) with ENOTEMPTY when the tag was already
 * present, leaking one ~181 MB staging directory per attempt.
 *
 * The HTTP transport is stubbed; the filesystem, the signature verification,
 * the staging directory and the cache reuse all run for real.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nacl = require('tweetnacl');

const RELEASE_TAG = 'support-v9.9.9';
let tempRoot;
let dataDir;
let publicKey;
let secretKey;

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Build a minimal but structurally valid .tar.gz without shelling out to tar,
 * so the fixture works on Windows CI as well as Linux.
 */
function makeTarGz(name) {
    const zlib = require('zlib');
    const content = Buffer.from(`payload for ${name}\n`);
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 100, 'utf8');          // name
    header.write('0000644\0', 100, 8, 'utf8');   // mode
    header.write('0000000\0', 108, 8, 'utf8');   // uid
    header.write('0000000\0', 116, 8, 'utf8');   // gid
    header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf8'); // size
    header.write('00000000000\0', 136, 12, 'utf8'); // mtime
    header.write('        ', 148, 8, 'utf8');    // checksum placeholder
    header.write('0', 156, 1, 'utf8');           // typeflag: regular file
    header.write('ustar\0', 257, 6, 'utf8');
    header.write('00', 263, 2, 'utf8');
    // Checksum: sum of all header bytes with the checksum field as spaces.
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');

    const body = Buffer.concat([
        header,
        content,
        Buffer.alloc((512 - (content.length % 512)) % 512, 0),
        Buffer.alloc(1024, 0), // two zero blocks terminate the archive
    ]);
    return zlib.gzipSync(body, { level: 9 });
}

let assets;
let manifestBody;

function buildFixtures() {
    const fileName = 'betterdesk-support-generic-linux-x86_64.tar.gz';
    const body = makeTarGz(fileName);
    const manifest = {
        schema_version: 1,
        sku: 'betterdesk-support',
        generic: true,
        external_config: false,
        assets: [
            { name: fileName, sha256: sha256(body), size: body.length },
        ],
    };
    manifestBody = Buffer.from(JSON.stringify(manifest, null, 2));
    const sumsBody = Buffer.from(`${sha256(body)}  ${fileName}\n`);
    const signature = Buffer.from(nacl.sign.detached(
        new Uint8Array(manifestBody),
        secretKey
    )).toString('base64');
    assets = {
        'manifest.json': manifestBody,
        SHA256SUMS: sumsBody,
        'manifest.sig': Buffer.from(signature + '\n'),
        [fileName]: body,
    };
}

function assetUrl(name) {
    return `https://api.github.com/repos/UNITRONIX/BetterDesk-Client/releases/assets/${name}`;
}

/** Stub the GitHub transport with a counting downloader. */
jest.mock('https', () => {
    const { EventEmitter } = require('events');

    // The service calls https.get(url, options, callback) and then attaches
    // timeout/error handlers, so the fake request must be an EventEmitter.
    function fakeGet(url, options, callback) {
        const state = global.__bdReleaseStub;
        const name = String(url).split('/').pop();
        const releaseList = String(url).includes('/releases?');
        const body = releaseList
            ? Buffer.from(JSON.stringify(state.releases))
            : state.assets[name];
        state.requests.push({ name: releaseList ? '__list__' : name });

        const req = new EventEmitter();
        req.setTimeout = () => {};
        req.destroy = () => {};
        req.end = () => {};

        process.nextTick(() => {
            const res = new EventEmitter();
            res.statusCode = body === undefined ? 404 : 200;
            res.headers = {};
            res.resume = () => {};
            callback(res);
            if (body !== undefined) res.emit('data', body);
            res.emit('end');
        });
        return req;
    }

    return { get: fakeGet, request: fakeGet };
});

function loadService() {
    jest.resetModules();
    return require('../services/genericAgentReleaseService');
}

function stagingDirs() {
    const root = path.join(dataDir, 'modules', 'betterdesk-support-releases');
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root).filter((name) => name.includes('.tmp-'));
}

describe('genericAgentReleaseService importLatest idempotency (#515)', () => {
    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-release-515-'));
        dataDir = path.join(tempRoot, 'data');
        fs.mkdirSync(dataDir, { recursive: true });

        const keypair = nacl.sign.keyPair();
        publicKey = Buffer.from(keypair.publicKey).toString('base64');
        secretKey = keypair.secretKey;
        buildFixtures();

        process.env.DATA_DIR = dataDir;
        process.env.BETTERDESK_SUPPORT_RELEASE_PUBLIC_KEY = publicKey;
        process.env.BETTERDESK_SUPPORT_RELEASE_REPO = 'UNITRONIX/BetterDesk-Client';

        global.__bdReleaseStub = {
            assets,
            requests: [],
            releases: [{
                tag_name: RELEASE_TAG,
                draft: false,
                prerelease: false,
                assets: Object.keys(assets).map((name) => ({
                    name,
                    browser_download_url: assetUrl(name),
                })),
            }],
        };
    });

    afterEach(() => {
        delete process.env.DATA_DIR;
        delete process.env.BETTERDESK_SUPPORT_RELEASE_PUBLIC_KEY;
        delete process.env.BETTERDESK_SUPPORT_RELEASE_REPO;
        delete global.__bdReleaseStub;
        jest.resetModules();
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('imports a release and stores the manifest, signature and checksums', async () => {
        const service = loadService();
        const result = await service.importLatest();

        expect(result.tag).toBe(RELEASE_TAG);
        expect(result.alreadyImported).toBe(false);
        const dir = path.join(dataDir, 'modules', 'betterdesk-support-releases', RELEASE_TAG);
        for (const name of ['manifest.json', 'manifest.sig', 'SHA256SUMS']) {
            expect(fs.existsSync(path.join(dir, name))).toBe(true);
        }
        expect(stagingDirs()).toEqual([]);
    });

    it('returns immediately on a second import without downloading assets again', async () => {
        const service = loadService();
        await service.importLatest();
        const afterFirst = global.__bdReleaseStub.requests.length;

        const second = await service.importLatest();

        expect(second.alreadyImported).toBe(true);
        expect(second.tag).toBe(RELEASE_TAG);
        const secondRequests = global.__bdReleaseStub.requests.slice(afterFirst).filter(
            (entry) => entry.name !== '__list__'
        );
        expect(secondRequests).toEqual([]);
        expect(stagingDirs()).toEqual([]);
    });

    it('leaves no staging directory on any import, successful or repeated', async () => {
        const service = loadService();
        await service.importLatest();
        await service.importLatest();
        await service.importLatest();
        expect(stagingDirs()).toEqual([]);
    });

    it('re-imports when the cached manifest is missing, without leaking staging dirs', async () => {
        const service = loadService();
        await service.importLatest();
        const dir = path.join(dataDir, 'modules', 'betterdesk-support-releases', RELEASE_TAG);
        fs.rmSync(path.join(dir, 'manifest.json'));

        const again = await service.importLatest();
        expect(again.alreadyImported).toBe(false);
        expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);
        expect(stagingDirs()).toEqual([]);
    });

    it('does not trust a cached asset whose bytes were modified', async () => {
        const service = loadService();
        const first = await service.importLatest();
        const dir = first.path;
        const assetName = Object.keys(assets).find((name) => name.endsWith('.tar.gz'));
        fs.writeFileSync(path.join(dir, assetName), 'tampered bytes');

        const again = await service.importLatest();

        // The cache is rejected, so a real re-import happens and restores the
        // verified bytes.
        expect(again.alreadyImported).toBe(false);
        expect(sha256(fs.readFileSync(path.join(dir, assetName))))
            .toBe(sha256(assets[assetName]));
    });

    it('does not serve a cache whose manifest signature no longer verifies', async () => {
        const service = loadService();
        const first = await service.importLatest();
        const dir = first.path;
        const manifestPath = path.join(dir, 'manifest.json');
        const cached = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        cached.release_tag = RELEASE_TAG;
        cached.assets[0].size = 1; // mutate inside the signed payload
        fs.writeFileSync(manifestPath, JSON.stringify(cached, null, 2));

        const again = await service.importLatest();

        expect(again.alreadyImported).toBe(false);
        const restored = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(restored.assets[0].size).toBe(assets[restored.assets[0].name].length);
    });

    it('cleans up staging when the checksum verification fails', async () => {
        const service = loadService();
        const assetName = Object.keys(assets).find((name) => name.endsWith('.tar.gz'));
        // Corrupt the downloaded payload so the import aborts mid-way.
        assets[assetName] = Buffer.concat([assets[assetName], Buffer.from('x')]);

        await expect(service.importLatest()).rejects.toThrow(/checksum_mismatch/);
        expect(stagingDirs()).toEqual([]);
    });

    it('rejects a tag that would escape the release directory', async () => {
        const service = loadService();
        // safeName() rejects traversal and separators. Such a release can never
        // reach path.join(root(), tag) as a usable path.
        const unsafe = ['../../etc', 'support-v1/../../x', 'support v1;rm -rf'];
        for (const tag of unsafe) {
            global.__bdReleaseStub.releases = [{
                tag_name: tag,
                draft: false,
                prerelease: false,
                assets: Object.keys(assets).map((name) => ({
                    name,
                    browser_download_url: assetUrl(name),
                })),
            }];
            await expect(service.importLatest()).rejects.toThrow(/tag_invalid|not_found/);
        }
        // Nothing may have been written outside the module directory.
        expect(fs.existsSync(path.join(tempRoot, 'etc'))).toBe(false);
    });

    it('force re-import replaces the existing tag and keeps a single directory', async () => {
        const service = loadService();
        const first = await service.importLatest();

        const forced = await service.importLatest({ force: true });

        expect(forced.alreadyImported).toBe(false);
        const root = path.join(dataDir, 'modules', 'betterdesk-support-releases');
        const entries = fs.readdirSync(root).filter((name) => !name.includes('.tmp-') && !name.includes('.old-'));
        expect(entries).toEqual([RELEASE_TAG]);
        expect(fs.existsSync(path.join(first.path, 'manifest.json'))).toBe(true);
        expect(stagingDirs()).toEqual([]);
    });
});
