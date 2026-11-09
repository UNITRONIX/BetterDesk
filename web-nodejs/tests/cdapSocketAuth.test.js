/**
 * The five IoT device (CDAP) sockets let in the roles whose permissions
 * allow them, with the role overrides from the permissions page applied:
 *
 *   terminal  /api/cdap/devices/:id/terminal  cdap.terminal
 *   desktop   /api/cdap/devices/:id/desktop   cdap.terminal (remote control of the device)
 *   files     /api/cdap/devices/:id/files     cdap.files
 *   video     /api/cdap/devices/:id/video     cdap.command
 *   audio     /api/cdap/devices/:id/audio     cdap.command
 *
 * They used to check fixed role names or levels (terminal, desktop and
 * files: super_admin or admin only; video and audio: operator and above,
 * server_admin included although it has no CDAP permission at all), so an
 * override that gave or took a permission changed the page but not the
 * socket.
 */

'use strict';

const { EventEmitter } = require('events');

const mockHandleUpgrade = jest.fn();
jest.mock('ws', () => ({
    OPEN: 1,
    CONNECTING: 0,
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
const { initCdapTerminalProxy } = require('../services/cdapTerminalProxy');
const { initCdapMediaProxies } = require('../services/cdapMediaProxy');

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Open one CDAP socket as a signed-in user with this role */
async function upgrade(channel, role, deviceId = 'CDAP-0A1B2C3D') {
    mockHandleUpgrade.mockClear();
    const server = new EventEmitter();
    const session = (req, _res, next) => {
        req.session = { userId: 7, user: { id: 7, username: 'u', role } };
        next();
    };
    initCdapTerminalProxy(server, session);
    initCdapMediaProxies(server, session);
    const socket = { write: jest.fn(), destroy: jest.fn(), remoteAddress: '127.0.0.1' };
    const req = { url: `/api/cdap/devices/${deviceId}/${channel}`, headers: { host: 'localhost' }, socket };
    server.emit('upgrade', req, socket, Buffer.alloc(0));
    await flush();
    await flush();
    const refused = socket.write.mock.calls.some(([line]) => /403 Forbidden/.test(String(line)));
    return { opened: mockHandleUpgrade.mock.calls.length > 0, refused };
}

const OPEN = { opened: true, refused: false };
const REFUSED = { opened: false, refused: true };

describe('CDAP socket permissions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    test('global_admin with cdap.terminal and cdap.files (its defaults) opens terminal, desktop and files', async () => {
        getEffectivePermissions.mockResolvedValue(new Set(['cdap.view', 'cdap.command', 'cdap.terminal', 'cdap.files']));
        expect(await upgrade('terminal', 'global_admin')).toEqual(OPEN);
        expect(await upgrade('desktop', 'global_admin')).toEqual(OPEN);
        expect(await upgrade('files', 'global_admin')).toEqual(OPEN);
        expect(getEffectivePermissions).toHaveBeenCalledWith('global_admin');
    });

    test('an override that gives an operator cdap.terminal opens the terminal, not the files', async () => {
        getEffectivePermissions.mockResolvedValue(new Set(['cdap.view', 'cdap.command', 'cdap.terminal']));
        expect(await upgrade('terminal', 'operator')).toEqual(OPEN);
        expect(await upgrade('desktop', 'operator')).toEqual(OPEN);
        expect(await upgrade('files', 'operator')).toEqual(REFUSED);
    });

    test('operator with its defaults watches video and audio but gets no terminal, desktop or files', async () => {
        getEffectivePermissions.mockResolvedValue(new Set(['cdap.view', 'cdap.command']));
        expect(await upgrade('video', 'operator')).toEqual(OPEN);
        expect(await upgrade('audio', 'operator')).toEqual(OPEN);
        expect(await upgrade('terminal', 'operator')).toEqual(REFUSED);
        expect(await upgrade('desktop', 'operator')).toEqual(REFUSED);
        expect(await upgrade('files', 'operator')).toEqual(REFUSED);
    });

    test('server_admin, which has no CDAP permission, opens none of them', async () => {
        getEffectivePermissions.mockResolvedValue(new Set(['server.config', 'device.view']));
        for (const channel of ['terminal', 'desktop', 'files', 'video', 'audio']) {
            expect(await upgrade(channel, 'server_admin')).toEqual(REFUSED);
        }
    });

    test('viewer (cdap.view only) opens none of them', async () => {
        getEffectivePermissions.mockResolvedValue(new Set(['cdap.view', 'device.view']));
        for (const channel of ['terminal', 'desktop', 'files', 'video', 'audio']) {
            expect(await upgrade(channel, 'viewer')).toEqual(REFUSED);
        }
    });

    test('an override that takes cdap.command away from an operator closes video', async () => {
        getEffectivePermissions.mockResolvedValue(new Set(['cdap.view']));
        expect(await upgrade('video', 'operator')).toEqual(REFUSED);
    });

    test('super admins open every socket without a lookup', async () => {
        for (const channel of ['terminal', 'desktop', 'files', 'video', 'audio']) {
            expect(await upgrade(channel, 'super_admin')).toEqual(OPEN);
            expect(await upgrade(channel, 'admin')).toEqual(OPEN);
        }
        expect(getEffectivePermissions).not.toHaveBeenCalled();
    });

    test('a failing permission lookup refuses the socket', async () => {
        getEffectivePermissions.mockRejectedValue(new Error('go down'));
        expect(await upgrade('terminal', 'global_admin')).toEqual(REFUSED);
        expect(await upgrade('video', 'operator')).toEqual(REFUSED);
    });

    test('the terminal accepts the same device IDs as the other sockets and the gateway', async () => {
        expect(await upgrade('terminal', 'super_admin', 'abc')).toEqual(OPEN);
    });
});
