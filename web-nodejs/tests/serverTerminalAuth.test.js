/**
 * The server terminal socket (/ws/server-management/terminal) lets in the
 * same people as the Server management page and its HTTP routes: anyone
 * whose role has server.config, with the role overrides from the
 * permissions page applied. It used to check the role names super_admin,
 * admin and server_admin, so an override that gave or took server.config
 * changed the page but not the terminal.
 */

'use strict';

const { EventEmitter } = require('events');

const mockHandleUpgrade = jest.fn();
jest.mock('ws', () => ({
    OPEN: 1,
    Server: jest.fn().mockImplementation(() => ({
        handleUpgrade: mockHandleUpgrade,
        on: jest.fn(),
        emit: jest.fn()
    }))
}));
jest.mock('../middleware/wsOrigin', () => ({ enforceOrigin: () => true }));
jest.mock('../services/rolePermissionService', () => ({
    getEffectivePermissions: jest.fn(),
    loadEffectivePermissions: (_req, _res, next) => next()
}));

const { getEffectivePermissions } = require('../services/rolePermissionService');
const { initServerTerminalProxy } = require('../services/serverTerminalProxy');

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Open the terminal socket as a signed-in user with this role */
async function upgrade(role) {
    const server = new EventEmitter();
    const session = (req, _res, next) => {
        req.session = { userId: 7, user: { id: 7, username: 'u', role } };
        next();
    };
    initServerTerminalProxy(server, session);
    const socket = { write: jest.fn(), destroy: jest.fn(), remoteAddress: '127.0.0.1' };
    const req = { url: '/ws/server-management/terminal', headers: { host: 'localhost' }, socket };
    server.emit('upgrade', req, socket, Buffer.alloc(0));
    await flush();
    await flush();
    const refused = socket.write.mock.calls.some(([line]) => /403 Forbidden/.test(String(line)));
    return { opened: mockHandleUpgrade.mock.calls.length > 0, refused };
}

describe('server terminal socket permission', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    test('a role given server.config by an override may open it', async () => {
        getEffectivePermissions.mockResolvedValue(new Set(['device.view', 'server.config']));
        const r = await upgrade('operator');
        expect(r).toEqual({ opened: true, refused: false });
        expect(getEffectivePermissions).toHaveBeenCalledWith('operator');
    });

    test('server_admin without server.config (override) is refused', async () => {
        getEffectivePermissions.mockResolvedValue(new Set(['device.view', 'audit.view']));
        const r = await upgrade('server_admin');
        expect(r).toEqual({ opened: false, refused: true });
    });

    test('server_admin with its default permissions may open it', async () => {
        getEffectivePermissions.mockResolvedValue(new Set(['server.config', 'server.keys']));
        expect(await upgrade('server_admin')).toEqual({ opened: true, refused: false });
    });

    test('roles without server.config are refused', async () => {
        getEffectivePermissions.mockResolvedValue(new Set(['device.view', 'user.view']));
        expect(await upgrade('global_admin')).toEqual({ opened: false, refused: true });
        expect(await upgrade('viewer')).toEqual({ opened: false, refused: true });
    });

    test('super admins may open it without a lookup', async () => {
        expect(await upgrade('super_admin')).toEqual({ opened: true, refused: false });
        expect(getEffectivePermissions).not.toHaveBeenCalled();
    });

    test('a failing permission lookup refuses the socket', async () => {
        getEffectivePermissions.mockRejectedValue(new Error('go down'));
        expect(await upgrade('server_admin')).toEqual({ opened: false, refused: true });
    });
});
