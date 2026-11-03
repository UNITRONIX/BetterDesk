/**
 * Helpers for the unified security suite (local in-process only).
 */
'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const http = require('http');
const net = require('net');
const { createTestApp } = require('../helpers');
const { csrfTokenProvider, doubleCsrfProtection } = require('../../middleware/csrf');

function createCsrfApp(mutateRoutes) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(session({
        secret: 'security-suite-csrf-secret-key!!',
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false },
    }));
    app.use(csrfTokenProvider);
    app.use((req, res, next) => doubleCsrfProtection(req, res, next));
    app.use((err, _req, res, _next) => {
        if (err.code === 'EBADCSRFTOKEN' || /csrf/i.test(err.message || '')) {
            return res.status(403).json({ success: false, error: 'Invalid CSRF token' });
        }
        return res.status(500).json({ success: false, error: 'error' });
    });
    if (typeof mutateRoutes === 'function') mutateRoutes(app);
    return app;
}

/**
 * Raw WebSocket upgrade against a local loopback server.
 * @returns {Promise<{ statusLine: string, raw: string }>}
 */
function rawUpgrade(port, path, headers = {}) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(port, '127.0.0.1');
        let data = '';
        socket.setTimeout(3000);
        socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
        socket.on('error', reject);
        socket.on('data', (chunk) => {
            data += chunk.toString();
            if (data.includes('\r\n\r\n')) {
                socket.destroy();
                resolve({ statusLine: data.split('\r\n')[0], raw: data });
            }
        });
        socket.on('connect', () => {
            const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
            socket.write(
                `GET ${path} HTTP/1.1\r\n` +
                `Host: 127.0.0.1:${port}\r\n` +
                `Upgrade: websocket\r\n` +
                `Connection: Upgrade\r\n` +
                `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
                `Sec-WebSocket-Version: 13\r\n` +
                (extra ? `${extra}\r\n` : '') +
                `\r\n`
            );
        });
    });
}

function listenLoopback(server) {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
}

function closeServer(server) {
    return new Promise((resolve) => {
        if (!server) return resolve();
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        if (server.listening) server.close(() => resolve());
        else resolve();
    });
}

module.exports = {
    createTestApp,
    createCsrfApp,
    rawUpgrade,
    listenLoopback,
    closeServer,
    http,
};
