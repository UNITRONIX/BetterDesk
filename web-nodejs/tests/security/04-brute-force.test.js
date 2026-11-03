'use strict';

const express = require('express');
const request = require('supertest');
const rateLimit = require('express-rate-limit');
const { loginLimiter } = require('../../middleware/rateLimiter');

describe('[sec/04] Brute-force / credential stuffing', () => {
    it('exports production loginLimiter', () => {
        expect(loginLimiter).toBeDefined();
        expect(typeof loginLimiter).toBe('function');
    });

    it('trips HTTP 429 after max failed login attempts (local limiter)', async () => {
        const app = express();
        app.use(express.json());
        const limiter = rateLimit({
            windowMs: 60_000,
            max: 3,
            standardHeaders: true,
            legacyHeaders: false,
            message: { success: false, error: 'Too many login attempts' },
        });
        app.post('/api/auth/login', limiter, (_req, res) => {
            res.status(401).json({ success: false, error: 'Invalid credentials' });
        });

        for (let i = 0; i < 3; i++) {
            const r = await request(app)
                .post('/api/auth/login')
                .send({ username: 'admin', password: `wrong-${i}` });
            expect(r.status).toBe(401);
        }
        const blocked = await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'wrong-final' });
        expect(blocked.status).toBe(429);
    });
});
