/**
 * GET /api/panel/fleet/availability tells the Fleet page whether the Go
 * server has fleet handlers (BUGS.md P4: without them every /api/fleet path
 * answers 404). Go's 404 means "not offered"; any other answer, or Go being
 * unreachable, means the lists are tried and show their own errors.
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

const mockApiClient = jest.fn();
jest.mock('../services/betterdeskApi', () => ({ apiClient: (...args) => mockApiClient(...args) }));

const fleetRoutes = require('../routes/fleet.routes');

function app(role) {
    const a = createTestApp();
    a.use((req, _res, next) => {
        if (role) {
            req.session.userId = 5;
            req.session.user = { id: 5, username: 'u', role };
        }
        next();
    });
    a.use('/', fleetRoutes);
    return a;
}

const goError = (status) => Object.assign(new Error('Request failed'), status ? { response: { status, data: { error: 'not found' } } } : {});

beforeEach(() => mockApiClient.mockReset());

describe('GET /api/panel/fleet/availability', () => {
    test('a 404 from Go means fleet is not offered', async () => {
        mockApiClient.mockRejectedValue(goError(404));
        const res = await request(app('operator')).get('/api/panel/fleet/availability');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, available: false });
        expect(mockApiClient).toHaveBeenCalledWith({ method: 'GET', url: '/fleet/tasks' });
    });

    test('a list from Go means fleet is offered', async () => {
        mockApiClient.mockResolvedValue({ status: 200, data: { tasks: [] } });
        const res = await request(app('admin')).get('/api/panel/fleet/availability');
        expect(res.body).toEqual({ success: true, available: true });
    });

    test.each([[500], [503], [null]])('Go answering %s (or not at all) leaves it to the lists', async (status) => {
        mockApiClient.mockRejectedValue(goError(status));
        const res = await request(app('operator')).get('/api/panel/fleet/availability');
        expect(res.body).toEqual({ success: true, available: true });
    });

    test('needs org.manage_devices, like every fleet route', async () => {
        mockApiClient.mockResolvedValue({ status: 200, data: {} });
        expect((await request(app('viewer')).get('/api/panel/fleet/availability')).status).toBe(403);
        expect((await request(app('server_admin')).get('/api/panel/fleet/availability')).status).toBe(403);
        expect((await request(app(null)).get('/api/panel/fleet/availability')).status).toBe(401);
        expect(mockApiClient).not.toHaveBeenCalled();
    });
});
