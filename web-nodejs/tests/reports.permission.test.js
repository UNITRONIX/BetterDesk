/**
 * Reports read device, audit, security and ticket data, so reading and
 * generating them needs audit.view, like the Reports page. They used to
 * need only a session (BUGS.md P22): a guest link issuer or a pro account
 * could generate any report through the API.
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/reportEngine', () => ({
    listReportTypes: jest.fn(() => [{ id: 'devices' }]),
    generateReport: jest.fn(async (type) => ({ type, label: 'Devices', generated_at: 'now', data: [], filters: {} })),
    toCsv: jest.fn(() => 'a,b\n')
}));
jest.mock('../services/dbAdapter', () => ({
    getAdapter: () => ({
        listSavedReports: jest.fn(async () => []),
        getSavedReport: jest.fn(async () => ({ id: 1, payload: '[]', filters: '{}' }))
    })
}));

const reportsRoutes = require('../routes/reports.routes');

function app(role) {
    const a = createTestApp();
    a.use((req, _res, next) => {
        req.session.userId = 5;
        req.session.user = { id: 5, username: 'u', role };
        next();
    });
    a.use('/api/reports', reportsRoutes);
    return a;
}

const READS = [
    ['get', '/api/reports/types'],
    ['post', '/api/reports/generate'],
    ['post', '/api/reports/generate/csv'],
    ['get', '/api/reports/saved'],
    ['get', '/api/reports/saved/1']
];

describe('reports need audit.view', () => {
    test.each(['guest_issuer', 'pro'])('%s gets 403 everywhere', async (role) => {
        for (const [method, path] of READS) {
            const res = await request(app(role))[method](path).send({ type: 'devices' });
            expect([path, res.status]).toEqual([path, 403]);
        }
    });

    test.each(['viewer', 'operator', 'server_admin'])('%s can list and generate', async (role) => {
        expect((await request(app(role)).get('/api/reports/types')).status).toBe(200);
        expect((await request(app(role)).post('/api/reports/generate').send({ type: 'devices' })).status).toBe(200);
    });
});
