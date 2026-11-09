'use strict';

/**
 * Ticket attachments come as base64 in JSON. The console capped every JSON
 * body at 2 MB, so a 2 MB file (2.7 MB as base64) never reached the route
 * that allows 25 MB (A7). The attachment route parses its own body with a
 * larger limit, after the sign-in and permission checks; the console-wide
 * parser leaves that one path alone, so nobody can make the server read
 * 35 MB before it knows who is asking. Every other path keeps 2 MB.
 */

const express = require('express');
const request = require('supertest');
const { jsonBody, attachmentBody } = require('../lib/jsonBody');

function app() {
    const a = express();
    a.use(jsonBody());
    a.post('/api/tickets/:id/attachments', attachmentBody, (req, res) => res.json({ size: req.body.data.length }));
    a.post('/api/other', (req, res) => res.json({ size: req.body.data.length }));
    a.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.type || 'error' }));
    return a;
}

// A 4 MB file as base64 (about 5.6 MB of JSON)
const big = { filename: 'log.zip', data: Buffer.alloc(4 * 1024 * 1024, 7).toString('base64') };

describe('JSON body limits', () => {
    test('a ticket attachment above 2 MB reaches the route', async () => {
        const res = await request(app()).post('/api/tickets/7/attachments').send(big);
        expect(res.status).toBe(200);
        expect(res.body.size).toBe(big.data.length);
    });

    test('the console-wide parser leaves the attachment body to its route', async () => {
        const a = express();
        a.use(jsonBody());
        a.post('/api/tickets/:id/attachments', (req, res) => res.json({ parsed: req.body !== undefined }));
        const res = await request(a).post('/api/tickets/7/attachments').send({ filename: 'a', data: 'aGk=' });
        expect(res.body.parsed).toBe(false);
    });

    test('other paths keep the 2 MB cap', async () => {
        const res = await request(app()).post('/api/other').send(big);
        expect(res.status).toBe(413);
    });

    test('only POST to the attachment path is left to the route', async () => {
        const a = express();
        a.use(jsonBody());
        a.put('/api/tickets/:id/attachments', (_req, res) => res.json({ ok: true }));
        a.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.type }));
        expect((await request(a).put('/api/tickets/7/attachments').send(big)).status).toBe(413);
    });

    test('small bodies parse on every path', async () => {
        const res = await request(app()).post('/api/other').send({ data: 'abc' });
        expect(res.body.size).toBe(3);
    });
});
