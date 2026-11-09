/**
 * Organization policies and device identity are read with the same check
 * as their pages (requireAdmin: super admin, admin, global admin, server
 * admin). They used to need only a session, so any signed-in user could
 * read every organization's policies and change log.
 */

const request = require('supertest');
const { createTestApp, withAuth } = require('./helpers');

const mockApiClient = jest.fn();
jest.mock('../services/database', () => ({ getAccessToken: jest.fn(), touchAccessToken: jest.fn() }));
jest.mock('../services/betterdeskApi', () => ({ apiClient: (...args) => mockApiClient(...args) }));

const policiesRoutes = require('../routes/policies.routes');

const READS = [
    '/api/panel/policies/org-1',
    '/api/panel/policies/org-1/effective/dev-1',
    '/api/panel/policies/org-1/audit',
    '/api/panel/attestation/dev-1',
];

function app(role) {
    const a = createTestApp();
    withAuth(a, { id: 3, username: role, role });
    a.use('/', policiesRoutes);
    return a;
}

beforeEach(() => {
    mockApiClient.mockReset();
    mockApiClient.mockResolvedValue({ status: 200, data: { ok: true } });
});

describe('policy and device identity reads', () => {
    it.each(['viewer', 'operator'])('refuse %s without asking the server', async (role) => {
        for (const path of READS) {
            const res = await request(app(role)).get(path);
            expect([path, res.status]).toEqual([path, 403]);
        }
        expect(mockApiClient).not.toHaveBeenCalled();
    });

    it.each(['global_admin', 'server_admin', 'admin', 'super_admin'])('answer %s', async (role) => {
        for (const path of READS) {
            const res = await request(app(role)).get(path);
            expect([path, res.status]).toEqual([path, 200]);
        }
        expect(mockApiClient).toHaveBeenCalledTimes(READS.length);
    });

    it('a request without a session gets 401', async () => {
        const a = createTestApp();
        a.use('/', policiesRoutes);
        for (const path of READS) expect((await request(a).get(path)).status).toBe(401);
    });
});
