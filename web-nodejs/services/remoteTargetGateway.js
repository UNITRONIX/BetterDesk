/**
 * BetterDesk Console — RDP/VNC session proxy.
 *
 * The browser talks only to this authenticated WebSocket. The Go API owns
 * target lookup, credential decryption and the guacd connection.
 */
'use strict';

const WebSocket = require('ws');
const config = require('../config/config');
const db = require('./database');
const betterdeskApi = require('./betterdeskApi');
const deviceGroupService = require('./deviceGroupService');
const { roleHasPermission } = require('../middleware/auth');
const { enforceOrigin } = require('../middleware/wsOrigin');
const { registerUpgradeHandler } = require('./wsUpgradeRouter');

const TARGET_PATH = /^\/ws\/remote-target\/(rt_[A-Za-z0-9-]{8,80})$/;

function reject(socket, status, message) {
    try {
        socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
    } catch (_) { /* socket already closed */ }
    try { socket.destroy(); } catch (_) { /* socket already closed */ }
}

function initRemoteTargetGateway(server, sessionMiddleware) {
    const wss = new WebSocket.Server({ noServer: true, maxPayload: 16 * 1024 * 1024 });

    registerUpgradeHandler(
        server,
        pathname => TARGET_PATH.test(pathname),
        (req, socket, head) => {
            const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const match = url.pathname.match(TARGET_PATH);
            if (!match) return reject(socket, 404, 'Not Found');
            if (!enforceOrigin(req, socket, `remote-target ${match[1]}`)) return;

            sessionMiddleware(req, {}, async () => {
                const user = req.session?.user || {};
                const role = user.role || req.session?.role || '';
                if (!req.session?.userId || !roleHasPermission(role, 'remote_target.connect')) {
                    return reject(socket, 403, 'Forbidden');
                }
                try {
                    const target = await betterdeskApi.getRemoteTarget(match[1]);
                    const visible = target && await deviceGroupService.userCanAccessDevice(
                        db, user, target
                    );
                    if (!target || !visible) return reject(socket, 404, 'Not Found');
                    req._remoteTargetUser = {
                        username: user.username || `user#${req.session.userId}`,
                        role,
                        targetId: match[1]
                    };
                    wss.handleUpgrade(req, socket, head, ws => {
                        wss.emit('connection', ws, req);
                    });
                } catch (error) {
                    console.warn('[remote-target] upgrade rejected:', error.message);
                    reject(socket, 502, 'Bad Gateway');
                }
            });
        }
    );

    wss.on('connection', (browserWs, req) => {
        const meta = req._remoteTargetUser;
        const base = (config.betterdeskApiUrl || 'http://127.0.0.1:21121/api')
            .replace(/\/api\/?$/, '');
        const goWsUrl = `${base.replace(/^http/, 'ws')}/api/remote-targets/` +
            `${encodeURIComponent(meta.targetId)}/tunnel`;
        const goWs = new WebSocket(goWsUrl, {
            headers: {
                'X-API-Key': config.betterdeskApiKey || '',
                'X-Username': meta.username,
                'X-Role': meta.role
            },
            maxPayload: 16 * 1024 * 1024,
            rejectUnauthorized: !config.allowSelfSignedCerts
        });

        let upstreamOpen = false;
        const pending = [];
        const closeBoth = () => {
            if (browserWs.readyState < WebSocket.CLOSING) browserWs.close();
            if (goWs.readyState < WebSocket.CLOSING) goWs.close();
        };

        browserWs.on('message', (data, isBinary) => {
            if (upstreamOpen && goWs.readyState === WebSocket.OPEN) {
                goWs.send(data, { binary: isBinary });
            } else if (goWs.readyState === WebSocket.CONNECTING) {
                pending.push({ data, isBinary });
            }
        });
        goWs.on('open', () => {
            upstreamOpen = true;
            while (pending.length && goWs.readyState === WebSocket.OPEN) {
                const item = pending.shift();
                goWs.send(item.data, { binary: item.isBinary });
            }
        });
        goWs.on('message', (data, isBinary) => {
            if (browserWs.readyState === WebSocket.OPEN) {
                browserWs.send(data, { binary: isBinary });
            }
        });
        browserWs.on('close', closeBoth);
        goWs.on('close', closeBoth);
        browserWs.on('error', closeBoth);
        goWs.on('error', error => {
            console.warn('[remote-target] upstream error:', error.message);
            closeBoth();
        });
    });
}

module.exports = { initRemoteTargetGateway };
