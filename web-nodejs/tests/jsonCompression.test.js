/**
 * Compressed JSON answers on the console API (lib/jsonCompression.js).
 */

const http = require('http');
const zlib = require('zlib');
const express = require('express');
const { jsonCompression, pickEncoding } = require('../lib/jsonCompression');

const big = { devices: Array.from({ length: 400 }, (_, i) => ({ id: String(100000000 + i), hostname: `host-${i}`, online: i % 2 === 0 })) };
const small = { success: true };

let server;
let port;
let secondAnswerError;

beforeAll(async () => {
    const app = express();
    app.use('/api/', jsonCompression());
    app.get('/api/big', (req, res) => res.json(big));
    app.get('/api/small', (req, res) => res.json(small));
    app.get('/api/missing', (req, res) => res.status(404).json({ ...big, error: 'not found' }));
    app.get('/api/text', (req, res) => res.type('text').send('x'.repeat(5000)));
    app.get('/api/twice', (req, res) => {
        res.json(big);
        try {
            res.json(small);
        } catch (err) {
            secondAnswerError = err;
        }
    });
    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', resolve);
    });
    port = server.address().port;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

/** GET without any decoding: status, headers and the raw body */
function get(path, headers = {}) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        }).on('error', reject);
    });
}

describe('JSON compression', () => {
    test('a large answer is sent with Brotli when the browser offers it', async () => {
        const res = await get('/api/big', { 'Accept-Encoding': 'gzip, deflate, br, zstd' });
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('br');
        expect(res.headers['content-type']).toMatch(/^application\/json/);
        expect(res.headers.vary).toMatch(/Accept-Encoding/);
        const json = zlib.brotliDecompressSync(res.body).toString('utf8');
        expect(JSON.parse(json)).toEqual(big);
        expect(res.body.length).toBeLessThan(Buffer.byteLength(json) / 5);
    });

    test('gzip when the client offers only gzip, or turns Brotli off', async () => {
        for (const accept of ['gzip', 'br;q=0, gzip;q=0.8']) {
            const res = await get('/api/big', { 'Accept-Encoding': accept });
            expect(res.headers['content-encoding']).toBe('gzip');
            expect(JSON.parse(zlib.gunzipSync(res.body).toString('utf8'))).toEqual(big);
        }
    });

    test('nothing is compressed for a client that does not ask', async () => {
        const res = await get('/api/big');
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(JSON.parse(res.body.toString('utf8'))).toEqual(big);
    });

    test('small answers and answers other than res.json stay as they are', async () => {
        const s = await get('/api/small', { 'Accept-Encoding': 'br' });
        expect(s.headers['content-encoding']).toBeUndefined();
        expect(JSON.parse(s.body.toString('utf8'))).toEqual(small);
        const t = await get('/api/text', { 'Accept-Encoding': 'br' });
        expect(t.headers['content-encoding']).toBeUndefined();
        expect(t.body.toString('utf8')).toBe('x'.repeat(5000));
    });

    test('the status code is kept', async () => {
        const res = await get('/api/missing', { 'Accept-Encoding': 'br' });
        expect(res.status).toBe(404);
        expect(JSON.parse(zlib.brotliDecompressSync(res.body).toString('utf8')).error).toBe('not found');
    });

    test('an unchanged answer is a 304 for the ETag the browser has', async () => {
        const first = await get('/api/big', { 'Accept-Encoding': 'br' });
        expect(first.headers.etag).toBeTruthy();
        const again = await get('/api/big', { 'Accept-Encoding': 'br', 'If-None-Match': first.headers.etag });
        expect(again.status).toBe(304);
        expect(again.body.length).toBe(0);
    });

    test('a handler that answers twice still fails on the second answer', async () => {
        secondAnswerError = undefined;
        const res = await get('/api/twice', { 'Accept-Encoding': 'br' });
        expect(JSON.parse(zlib.brotliDecompressSync(res.body).toString('utf8'))).toEqual(big);
        expect(secondAnswerError && secondAnswerError.code).toBe('ERR_HTTP_HEADERS_SENT');
    });
});

describe('pickEncoding', () => {
    test.each([
        ['gzip, deflate, br', 'br'],
        ['br;q=0.5, gzip', 'br'],
        ['br;q=0, gzip', 'gzip'],
        ['identity', null],
        ['', null],
        [undefined, null],
    ])('%s → %s', (header, expected) => {
        expect(pickEncoding(header)).toBe(expected);
    });
});
