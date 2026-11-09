/**
 * Settings › Sign-in › RustDesk client sessions: the values live on the Go
 * server; the console also copies the expiry into its own .env when it can.
 * A .env the console may not write (read-only container file) must not turn
 * a save that worked into "Server error".
 */

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { createTestApp } = require('./helpers');

jest.mock('../services/database', () => ({
    logAction: jest.fn().mockResolvedValue(undefined),
    getSetting: jest.fn().mockResolvedValue(null),
    setSetting: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../middleware/rateLimiter', () => ({
    apiLimiter: (_req, _res, next) => next()
}));

jest.mock('../services/betterdeskApi', () => ({
    apiClient: jest.fn(),
    getConfig: jest.fn().mockResolvedValue({ success: true, data: { value: '' } }),
    setConfig: jest.fn().mockResolvedValue({ success: true })
}));

const betterdeskApi = require('../services/betterdeskApi');
const settingsRoutes = require('../routes/settings.routes');

const ENV_PATH = path.join(__dirname, '..', '.env');

describe('PUT /api/settings/client-sessions', () => {
    let app;
    const realExists = fs.existsSync;
    const realRead = fs.readFileSync;

    beforeEach(() => {
        app = createTestApp();
        app.use((req, _res, next) => {
            req.session.userId = 1;
            req.session.user = { id: 1, username: 'admin', role: 'admin' };
            next();
        });
        app.use('/', settingsRoutes);
        jest.clearAllMocks();
        jest.spyOn(fs, 'existsSync').mockImplementation((p) => (p === ENV_PATH ? true : realExists(p)));
        jest.spyOn(fs, 'readFileSync').mockImplementation((p, ...rest) =>
            p === ENV_PATH ? 'API_TOKEN_EXPIRY_DAYS=7\n' : realRead(p, ...rest)
        );
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('saves on the server and answers success when the .env cannot be written', async () => {
        jest.spyOn(fs, 'writeFileSync').mockImplementation((p) => {
            if (p === ENV_PATH) {
                const err = new Error("EACCES: permission denied, open '/app/.env'");
                err.code = 'EACCES';
                throw err;
            }
        });
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await request(app)
            .put('/api/settings/client-sessions')
            .send({ expiry_days: 9, sliding: true, max_days: 30 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(betterdeskApi.setConfig).toHaveBeenCalledWith('client_session_expiry_days', '9');
        expect(process.env.API_TOKEN_EXPIRY_DAYS).toBe('9');
    });

    it('still writes the expiry into the .env when it can', async () => {
        const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

        const res = await request(app)
            .put('/api/settings/client-sessions')
            .send({ expiry_days: 12, sliding: false, max_days: 40 });

        expect(res.status).toBe(200);
        expect(write).toHaveBeenCalledWith(ENV_PATH, expect.stringContaining('API_TOKEN_EXPIRY_DAYS=12'), { mode: 0o600 });
    });

    it('a failed save on the server is still an error', async () => {
        betterdeskApi.setConfig.mockResolvedValueOnce({ success: false, error: 'Go server down' });
        const res = await request(app)
            .put('/api/settings/client-sessions')
            .send({ expiry_days: 9, sliding: true, max_days: 30 });
        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Go server down');
    });
});
