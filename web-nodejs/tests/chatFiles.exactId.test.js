/**
 * Chat file downloads match the whole file id (S3). The route used to take
 * any file whose name started with the given hex, so /api/chat/files/a
 * returned the first upload starting with "a" and anyone with chat access
 * could walk the uploads one character at a time.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const request = require('supertest');
const { createTestApp } = require('./helpers');

const chatRoutes = require('../routes/chat.routes');
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'chat-files');

function app(role = 'operator') {
    const a = createTestApp();
    a.use((req, _res, next) => {
        req.session.userId = 5;
        req.session.user = { id: 5, username: 'u', role };
        next();
    });
    a.use(chatRoutes);
    return a;
}

describe('chat file ids', () => {
    const id = crypto.randomBytes(16).toString('hex');
    const file = path.join(UPLOAD_DIR, `${id}.txt`);

    beforeAll(() => {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        fs.writeFileSync(file, 'secret');
    });
    afterAll(() => fs.rmSync(file, { force: true }));

    test('the full id downloads the file', async () => {
        const res = await request(app()).get(`/api/chat/files/${id}`);
        expect(res.status).toBe(200);
        expect(res.text).toBe('secret');
    });

    test.each([1, 4, 31])('the first %i characters are not enough', async (n) => {
        const res = await request(app()).get(`/api/chat/files/${id.slice(0, n)}`);
        expect(res.status).toBe(400);
    });

    test('a longer id that starts with a real one finds nothing', async () => {
        const res = await request(app()).get(`/api/chat/files/${id}00`);
        expect(res.status).toBe(400);
    });

    test('an unknown full id is 404', async () => {
        const other = crypto.randomBytes(16).toString('hex');
        const res = await request(app()).get(`/api/chat/files/${other}`);
        expect(res.status).toBe(404);
    });

    test('roles without chat access get 403', async () => {
        const res = await request(app('server_admin')).get(`/api/chat/files/${id}`);
        expect(res.status).toBe(403);
    });
});
