'use strict';

/**
 * Profile pictures: data URL checks and the fetch guard (lib/avatarImage.js).
 * The fetch tests run a local HTTP server. "Private LAN allowed" reaches it
 * through this machine's own LAN address (in Docker: the container's
 * 172.x address), which must work while loopback must not.
 */

const http = require('http');
const os = require('os');
const zlib = require('zlib');
const {
    MAX_AVATAR_BYTES,
    parseAvatarDataUrl,
    sniffImageType,
    isRefusedAvatarAddress,
    fetchAvatarUrl,
    loadAvatarPicture,
} = require('../lib/avatarImage');

const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('0000000d49484452000000010000000108020000009077' + '53de', 'hex'),
    zlib.deflateSync(Buffer.from([0, 255, 0, 0])),
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;

function lanAddress() {
    for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list || []) {
            if (a.family === 'IPv4' && !a.internal) return a.address;
        }
    }
    return null;
}

describe('sniffImageType', () => {
    it('knows PNG, JPEG, GIF and WebP by their first bytes', () => {
        expect(sniffImageType(PNG)).toBe('image/png');
        expect(sniffImageType(JPEG)).toBe('image/jpeg');
        expect(sniffImageType(GIF)).toBe('image/gif');
        expect(sniffImageType(WEBP)).toBe('image/webp');
        expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    });
});

describe('parseAvatarDataUrl', () => {
    it('accepts a good PNG and returns its bytes', () => {
        const out = parseAvatarDataUrl(dataUrl('image/png', PNG));
        expect(out.mimeType).toBe('image/png');
        expect(out.data.equals(PNG)).toBe(true);
    });

    it('refuses bytes that are not the image they claim to be', () => {
        const html = Buffer.from('<html><script>alert(1)</script></html>');
        expect(() => parseAvatarDataUrl(dataUrl('image/png', html))).toThrow(expect.objectContaining({ code: 'not_an_image' }));
        expect(() => parseAvatarDataUrl(dataUrl('image/png', JPEG))).toThrow(expect.objectContaining({ code: 'type_mismatch' }));
    });

    it('refuses a picture over 512 KB', () => {
        const big = Buffer.concat([PNG, Buffer.alloc(MAX_AVATAR_BYTES)]);
        expect(() => parseAvatarDataUrl(dataUrl('image/png', big))).toThrow(expect.objectContaining({ code: 'too_large' }));
        const justFits = Buffer.concat([PNG, Buffer.alloc(MAX_AVATAR_BYTES - PNG.length)]);
        expect(parseAvatarDataUrl(dataUrl('image/png', justFits)).data.length).toBe(MAX_AVATAR_BYTES);
    });

    it('refuses SVG and other types, and anything that is not base64', () => {
        expect(() => parseAvatarDataUrl(dataUrl('image/svg+xml', Buffer.from('<svg/>')))).toThrow(expect.objectContaining({ code: 'unsupported_type' }));
        expect(() => parseAvatarDataUrl('data:image/png,abc')).toThrow(expect.objectContaining({ code: 'invalid_data_url' }));
        expect(() => parseAvatarDataUrl('data:text/html;base64,PGI+')).toThrow();
    });
});

describe('isRefusedAvatarAddress', () => {
    it.each([
        '127.0.0.1', '127.8.8.8', '0.0.0.0', '169.254.169.254', '169.254.1.1', '100.100.100.200',
        '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'ff02::1', 'fd00:ec2::254',
        '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1',
        'not-an-ip',
    ])('refuses %s', (ip) => {
        expect(isRefusedAvatarAddress(ip)).toBe(true);
    });

    it.each([
        '10.0.0.5', '172.16.4.2', '192.168.1.20', '100.64.0.7', 'fd12:3456::1', '::ffff:192.168.1.20',
        '8.8.8.8', '2a01:4f8::1',
    ])('allows %s (public or private LAN)', (ip) => {
        expect(isRefusedAvatarAddress(ip)).toBe(false);
    });
});

describe('fetchAvatarUrl', () => {
    let server;
    let port;
    let hits;
    const lan = lanAddress();

    beforeAll(async () => {
        hits = [];
        server = http.createServer((req, res) => {
            hits.push(req.url);
            const routes = {
                '/a.png': () => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); },
                '/big.png': () => {
                    // No Content-Length: the size limit has to hold while streaming
                    res.writeHead(200, { 'Content-Type': 'image/png' });
                    res.write(PNG);
                    res.end(Buffer.alloc(MAX_AVATAR_BYTES + 1024));
                },
                '/big-declared.png': () => {
                    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(MAX_AVATAR_BYTES + 1) });
                    res.end();
                },
                '/html': () => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h1>hi</h1>'); },
                '/svg': () => { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end('<svg/>'); },
                '/lies.png': () => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end('<script>x</script>'); },
                '/slow.png': () => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.write(PNG.subarray(0, 4)); },
                '/to-loopback': () => { res.writeHead(302, { Location: `http://127.0.0.1:${port}/a.png` }); res.end(); },
                '/to-metadata': () => { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); },
            };
            const m = /^\/hop(\d+)$/.exec(req.url);
            if (m) {
                const n = Number(m[1]);
                res.writeHead(302, { Location: n > 0 ? `/hop${n - 1}` : '/a.png' });
                return res.end();
            }
            (routes[req.url] || (() => { res.writeHead(404); res.end(); }))();
        });
        await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
        port = server.address().port;
    });

    afterAll(async () => {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
    });

    beforeEach(() => { hits = []; });

    it('refuses loopback, even though the server is listening there', async () => {
        await expect(fetchAvatarUrl(`http://127.0.0.1:${port}/a.png`)).rejects.toMatchObject({ code: 'address_refused' });
        await expect(fetchAvatarUrl(`http://localhost:${port}/a.png`)).rejects.toMatchObject({ code: 'address_refused' });
        await expect(fetchAvatarUrl(`http://[::1]:${port}/a.png`)).rejects.toMatchObject({ code: 'address_refused' });
        expect(hits).toEqual([]);
    });

    it('refuses the cloud metadata address', async () => {
        await expect(fetchAvatarUrl('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({ code: 'address_refused' });
        await expect(fetchAvatarUrl('http://metadata.google.internal/')).rejects.toMatchObject({ code: 'address_refused' });
    });

    it('checks the address after DNS resolution (a name that resolves to loopback)', async () => {
        const rebind = (host, opts, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
        await expect(fetchAvatarUrl(`http://pictures.example.test:${port}/a.png`, { lookup: rebind }))
            .rejects.toMatchObject({ code: 'address_refused' });
        expect(hits).toEqual([]);
    });

    it('refuses a name when any of its addresses is refused', async () => {
        const mixed = (host, opts, cb) => cb(null, [{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }]);
        await expect(fetchAvatarUrl('http://mixed.example.test/a.png', { lookup: mixed })).rejects.toMatchObject({ code: 'address_refused' });
    });

    it('refuses non-http schemes and credentials', async () => {
        await expect(fetchAvatarUrl('file:///etc/passwd')).rejects.toMatchObject({ code: 'invalid_url' });
        await expect(fetchAvatarUrl('ftp://example.com/a.png')).rejects.toMatchObject({ code: 'invalid_url' });
        await expect(fetchAvatarUrl('http://u:p@example.com/a.png')).rejects.toMatchObject({ code: 'invalid_url' });
    });

    const lanIt = lan ? it : it.skip;

    lanIt('allows a private LAN address', async () => {
        const out = await fetchAvatarUrl(`http://${lan}:${port}/a.png`);
        expect(out.mimeType).toBe('image/png');
        expect(out.data.equals(PNG)).toBe(true);
    });

    lanIt('allows a name that resolves to a private LAN address', async () => {
        const toLan = (host, opts, cb) => cb(null, [{ address: lan, family: 4 }]);
        const out = await fetchAvatarUrl(`http://idp.lan.test:${port}/a.png`, { lookup: toLan });
        expect(out.mimeType).toBe('image/png');
    });

    lanIt('refuses a response over 512 KB, with or without Content-Length', async () => {
        await expect(fetchAvatarUrl(`http://${lan}:${port}/big.png`)).rejects.toMatchObject({ code: 'too_large' });
        await expect(fetchAvatarUrl(`http://${lan}:${port}/big-declared.png`)).rejects.toMatchObject({ code: 'too_large' });
    });

    lanIt('refuses responses that are not a PNG, JPEG, WebP or GIF image', async () => {
        await expect(fetchAvatarUrl(`http://${lan}:${port}/html`)).rejects.toMatchObject({ code: 'not_an_image' });
        await expect(fetchAvatarUrl(`http://${lan}:${port}/svg`)).rejects.toMatchObject({ code: 'not_an_image' });
        await expect(fetchAvatarUrl(`http://${lan}:${port}/lies.png`)).rejects.toMatchObject({ code: 'not_an_image' });
        await expect(fetchAvatarUrl(`http://${lan}:${port}/missing.png`)).rejects.toMatchObject({ code: 'http_status' });
    });

    lanIt('follows up to 3 redirects and no more', async () => {
        await expect(fetchAvatarUrl(`http://${lan}:${port}/hop2`)).resolves.toMatchObject({ mimeType: 'image/png' });
        await expect(fetchAvatarUrl(`http://${lan}:${port}/hop3`)).rejects.toMatchObject({ code: 'too_many_redirects' });
    });

    lanIt('checks every redirect target', async () => {
        await expect(fetchAvatarUrl(`http://${lan}:${port}/to-loopback`)).rejects.toMatchObject({ code: 'address_refused' });
        await expect(fetchAvatarUrl(`http://${lan}:${port}/to-metadata`)).rejects.toMatchObject({ code: 'address_refused' });
        expect(hits.filter((h) => h === '/a.png')).toEqual([]);
    });

    lanIt('gives up after the timeout', async () => {
        const started = Date.now();
        await expect(fetchAvatarUrl(`http://${lan}:${port}/slow.png`, { timeoutMs: 300 })).rejects.toMatchObject({ code: 'timeout' });
        expect(Date.now() - started).toBeLessThan(2000);
    });

    lanIt('loadAvatarPicture keeps the source URL and gives a version', async () => {
        const out = await loadAvatarPicture(`http://${lan}:${port}/a.png`);
        expect(out.sourceUrl).toBe(`http://${lan}:${port}/a.png`);
        expect(out.version).toMatch(/^[0-9a-f]{16}$/);
    });
});
