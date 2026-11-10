'use strict';

const { findRule, getRequiredLevel, panelAccessGuard } = require('../middleware/panelAccess');

describe('panel access route guard', () => {
    test('maps page and API paths to the same section', () => {
        expect(findRule('/users')).toMatchObject({ section: 'users' });
        expect(findRule('/api/users/42')).toMatchObject({ section: 'users' });
        expect(findRule('/api/settings/server-info')).toMatchObject({ section: 'settings' });
        expect(findRule('/unknown')).toBeNull();
    });

    test('requires read for reads and write for mutations', () => {
        expect(getRequiredLevel({ method: 'GET' })).toBe('read');
        expect(getRequiredLevel({ method: 'HEAD' })).toBe('read');
        expect(getRequiredLevel({ method: 'POST' })).toBe('write');
        expect(getRequiredLevel({ method: 'DELETE' })).toBe('write');
    });

    test('allows read-only access while denying mutations', () => {
        const policy = { sections: { users: { access: 'read' } } };
        const run = (method) => {
            const req = {
                path: '/api/users',
                method,
                session: { userId: 7, user: { role: 'viewer' } },
                panelAccessPolicy: policy,
            };
            const response = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
                render: jest.fn(),
            };
            const next = jest.fn();
            panelAccessGuard(req, response, next);
            return { response, next };
        };

        expect(run('GET').next).toHaveBeenCalled();
        expect(run('POST').response.status).toHaveBeenCalledWith(403);
    });

    test('serves a page load, so the app shows its own no-access view; the API stays refused', () => {
        const policy = { sections: { users: { access: 'none' } } };
        const call = (path, method = 'GET') => {
            const req = { path, method, session: { userId: 7, user: { role: 'viewer' } }, panelAccessPolicy: policy };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
                type: jest.fn().mockReturnThis(),
                send: jest.fn(),
            };
            const next = jest.fn();
            panelAccessGuard(req, res, next);
            return { res, next };
        };
        expect(call('/users').next).toHaveBeenCalled();
        expect(call('/users', 'HEAD').next).toHaveBeenCalled();
        expect(call('/api/users').res.status).toHaveBeenCalledWith(403);
        expect(call('/api/users').next).not.toHaveBeenCalled();
        expect(call('/users', 'POST').res.status).toHaveBeenCalledWith(403);
    });
});
