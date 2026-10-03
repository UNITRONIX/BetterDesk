/**
 * BetterDesk Console — Instant Chat WebSocket Relay (v2)
 *
 * Bridges agent WebSocket connections with server-side persistent storage.
 * Messages are persisted via the Go server REST API so they survive restarts.
 *
 * Endpoints:
 *   WS /ws/chat/<device_id>              — agent connection
 *   WS /ws/chat-operator/<device_id>     — operator browser connection
 *
 * Protocol (JSON text frames):
 *   Agent/Operator → Server:
 *     { "type": "hello",        "device_id": "ABC", "capabilities": [...] }
 *     { "type": "message",      "text": "hello", "conversation_id": "..." }
 *     { "type": "typing",       "conversation_id": "..." }
 *     { "type": "get_contacts", "device_id": "ABC" }
 *     { "type": "get_history",  "device_id": "ABC", "conversation_id": "..." }
 *     { "type": "mark_read",    "conversation_id": "..." }
 *     { "type": "create_group", "name": "...", "member_ids": [...] }
 *
 *   Server → Client:
 *     { "type": "message",  "id": N, "from": "...", "text": "...", "timestamp": N }
 *     { "type": "history",  "conversation_id": "...", "messages": [...] }
 *     { "type": "contacts", "contacts": [...] }
 *     { "type": "groups",   "groups": [...] }
 *     { "type": "status",   "agent_connected": true|false }
 *     { "type": "typing",   "from": "..." }
 *     { "type": "presence", "device_id": "...", "online": true|false }
 */

'use strict';

const WebSocket = require('ws');
const db = require('./database');
const { verifyDeviceWsAuth } = require('../lib/deviceTokenAuth');
const { roleHasPermission } = require('../middleware/auth');

const log = {
    info:  (...a) => console.log('[Chat]', ...a),
    warn:  (...a) => console.warn('[Chat]', ...a),
    error: (...a) => console.error('[Chat]', ...a),
};

const MAX_TEXT_BYTES = 8192;
const PING_INTERVAL = 30000;
const HISTORY_LIMIT = 500; // in-memory fallback

// device_id → { agentWs, operatorWss, messages (fallback ring buffer) }
const rooms = new Map();
// Standalone panel operators are not attached to a device room. Keep a
// separate index so device-originated events can reach the chat inbox.
const panelOperators = new Set();

// Reference to betterdeskApi for Go server calls
let goApi = null;

function getRoom(deviceId) {
    if (!rooms.has(deviceId)) {
        rooms.set(deviceId, { agentWs: null, operatorWss: new Set(), messages: [] });
    }
    return rooms.get(deviceId);
}

function appendMessage(room, msg) {
    room.messages.push(msg);
    if (room.messages.length > HISTORY_LIMIT) {
        room.messages.splice(0, room.messages.length - HISTORY_LIMIT);
    }
}

function broadcast(room, data, excludeWs = null) {
    const text = JSON.stringify(data);
    const send = (ws) => {
        if (ws && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
            ws.send(text);
        }
    };
    if (room.agentWs) send(room.agentWs);
    room.operatorWss.forEach(send);
}

function sendTo(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcastToPanelOperators(data, excludeWs = null, room = null) {
    const text = JSON.stringify(data);
    panelOperators.forEach((ws) => {
        // A device-scoped operator already receives the frame through its room.
        if (ws === excludeWs || (room && room.operatorWss.has(ws))) return;
        if (ws.readyState === WebSocket.OPEN) ws.send(text);
    });
}

function fallbackContacts(currentDeviceId) {
    const contacts = [{
        id: 'operator',
        name: 'Support',
        hostname: '',
        online: true,
        last_seen: Date.now(),
        unread: 0,
        avatar_color: '#4f6ef7',
        role: 'operator',
    }];
    for (const [did, room] of rooms) {
        if (did !== currentDeviceId && room.agentWs?.readyState === WebSocket.OPEN) {
            contacts.push({
                id: did,
                name: did,
                hostname: '',
                online: true,
                last_seen: Date.now(),
                unread: 0,
                avatar_color: '',
            });
        }
    }
    return contacts;
}

function setupPing(ws) {
    const timer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
        else clearInterval(timer);
    }, PING_INTERVAL);
    ws.on('close', () => clearInterval(timer));
}

// Persist message to Go server
async function persistMessage(msg) {
    if (!goApi) return;
    try {
        await goApi.post('/chat/messages', {
            conversation_id: msg.conversation_id || msg.from || 'operator',
            from_id: msg.from || 'unknown',
            from_name: msg.from_name || msg.from || '',
            to_id: msg.to_id || '',
            text: msg.text || '',
        });
    } catch (e) {
        log.warn('Failed to persist chat message:', e.message);
    }
}

// Load history from Go server
async function loadHistory(conversationId) {
    if (!goApi) return null;
    try {
        const resp = await goApi.get(`/chat/history/${encodeURIComponent(conversationId)}?limit=100`);
        return resp.data;
    } catch (e) {
        log.warn('Failed to load chat history:', e.message);
        return null;
    }
}

// Load contacts from Go server
async function loadContacts(deviceId) {
    if (!goApi) return null;
    try {
        const resp = await goApi.get(`/chat/contacts/${encodeURIComponent(deviceId)}`);
        return resp.data;
    } catch (e) {
        log.warn('Failed to load chat contacts:', e.message);
        return null;
    }
}

// Load groups from Go server
async function loadGroups(deviceId) {
    if (!goApi) return null;
    try {
        const resp = await goApi.get(`/chat/groups/${encodeURIComponent(deviceId)}`);
        return resp.data;
    } catch (e) {
        log.warn('Failed to load chat groups:', e.message);
        return null;
    }
}

// --- Agent handler ---

function handleAgentConnection(ws, deviceId) {
    const room = getRoom(deviceId);

    if (room.agentWs && room.agentWs.readyState !== WebSocket.CLOSED) {
        room.agentWs.close(1001, 'New agent connected');
    }
    room.agentWs = ws;

    log.info(`Agent connected: ${deviceId}`);
    broadcast(room, { type: 'status', agent_connected: true }, ws);
    broadcast(room, { type: 'presence', device_id: deviceId, online: true }, ws);
    broadcastToPanelOperators({ type: 'status', device_id: deviceId, agent_connected: true }, null, room);
    broadcastToPanelOperators({ type: 'presence', device_id: deviceId, online: true }, null, room);

    // Send history from DB
    loadHistory(deviceId).then(data => {
        if (data && data.messages) {
            sendTo(ws, { type: 'history', conversation_id: deviceId, messages: data.messages });
        } else {
            sendTo(ws, { type: 'history', messages: room.messages });
        }
    });

    // Send contacts
    loadContacts(deviceId).then(data => {
        if (data && data.contacts && data.contacts.length > 0) {
            sendTo(ws, { type: 'contacts', contacts: data.contacts });
        } else {
            // Fallback: at least show operator support contact
            sendTo(ws, { type: 'contacts', contacts: [{
                id: 'operator',
                name: 'Support',
                hostname: '',
                online: true,
                last_seen: Date.now(),
                unread: 0,
                avatar_color: '#4f6ef7',
                role: 'operator',
            }] });
        }
    });

    // Send groups
    loadGroups(deviceId).then(data => {
        if (data && data.groups) {
            sendTo(ws, { type: 'groups', groups: data.groups });
        }
    });

    setupPing(ws);

    ws.on('message', (data, isBinary) => {
        if (isBinary || data.length > MAX_TEXT_BYTES) return;
        let frame;
        try { frame = JSON.parse(data.toString()); } catch { return; }

        switch (frame.type) {
            case 'hello':
                // Acknowledge the hello so the client knows the connection is alive
                sendTo(ws, {
                    type: 'welcome',
                    device_id: deviceId,
                    server_time: Date.now(),
                    capabilities: ['multi_conversation', 'contacts', 'groups', 'history', 'e2e_encryption', 'read_receipts', 'typing', 'presence', 'file_share'],
                });
                break;

            case 'message': {
                const msg = {
                    type: 'message',
                    id: Date.now(),
                    from: deviceId,
                    from_name: frame.from_name || deviceId,
                    conversation_id: frame.conversation_id || 'operator',
                    text: String(frame.text || '').slice(0, 2048),
                    timestamp: frame.timestamp || Date.now(),
                };
                appendMessage(room, msg);
                broadcast(room, msg, ws);
                broadcastToPanelOperators(msg, ws, room);
                persistMessage(msg);
                break;
            }

            case 'typing':
                {
                    const typing = {
                    type: 'typing',
                    from: deviceId,
                    conversation_id: frame.conversation_id || 'operator',
                    };
                    broadcast(room, typing, ws);
                    broadcastToPanelOperators(typing, ws, room);
                }
                break;

            case 'get_contacts':
                loadContacts(frame.device_id || deviceId).then(data => {
                    if (data && data.contacts && data.contacts.length > 0) {
                        sendTo(ws, { type: 'contacts', contacts: data.contacts });
                    } else {
                        sendTo(ws, { type: 'contacts', contacts: fallbackContacts(deviceId) });
                    }
                });
                break;

            case 'get_history':
                loadHistory(frame.conversation_id || deviceId).then(data => {
                    if (data && data.messages) {
                        sendTo(ws, {
                            type: 'history',
                            conversation_id: frame.conversation_id,
                            messages: data.messages,
                        });
                    }
                });
                break;

            case 'mark_read':
                if (goApi && frame.conversation_id) {
                    goApi.post('/chat/read', {
                        conversation_id: frame.conversation_id,
                        reader_id: deviceId,
                    }).catch(() => {});
                }
                break;

            case 'create_group':
                if (goApi && frame.name && frame.member_ids) {
                    goApi.post('/chat/groups', {
                        name: frame.name,
                        members: frame.member_ids,
                        created_by: deviceId,
                    }).then(resp => {
                        sendTo(ws, { type: 'group_created', ...resp.data });
                        loadGroups(deviceId).then(data => {
                            if (data && data.groups) {
                                sendTo(ws, { type: 'groups', groups: data.groups });
                            }
                        });
                    }).catch(() => {});
                }
                break;

            // E2E key exchange: relay public key to operators
            case 'key_exchange':
                {
                    const keyExchange = {
                    type: 'key_exchange',
                    from: deviceId,
                    public_key: frame.public_key,
                    conversation_id: frame.conversation_id || deviceId,
                    };
                    broadcast(room, keyExchange, ws);
                    broadcastToPanelOperators(keyExchange, ws, room);
                }
                break;

            // Read receipts
            case 'read_receipt':
                {
                    const receipt = {
                    type: 'read_receipt',
                    from: deviceId,
                    message_ids: frame.message_ids || [],
                    conversation_id: frame.conversation_id || deviceId,
                    timestamp: Date.now(),
                    };
                    broadcast(room, receipt, ws);
                    broadcastToPanelOperators(receipt, ws, room);
                }
                if (goApi && frame.conversation_id) {
                    goApi.post('/chat/read', {
                        conversation_id: frame.conversation_id,
                        reader_id: deviceId,
                        message_ids: frame.message_ids || [],
                    }).catch(() => {});
                }
                break;

            // Online presence broadcast
            case 'presence_update':
                {
                    const presence = {
                    type: 'presence',
                    device_id: deviceId,
                    online: frame.online !== false,
                    status: frame.status || 'available',
                    timestamp: Date.now(),
                    };
                    broadcast(room, presence, ws);
                    broadcastToPanelOperators(presence, ws, room);
                }
                break;

            // Encrypted file share: relay encrypted file metadata
            case 'file_share':
                {
                    const fileShare = {
                    type: 'file_share',
                    from: deviceId,
                    from_name: frame.from_name || deviceId,
                    conversation_id: frame.conversation_id || 'operator',
                    file_id: frame.file_id || ('file_' + Date.now()),
                    file_name_encrypted: frame.file_name_encrypted || '',
                    file_size: frame.file_size || 0,
                    encrypted_metadata: frame.encrypted_metadata || '',
                    timestamp: Date.now(),
                    };
                    broadcast(room, fileShare, ws);
                    broadcastToPanelOperators(fileShare, ws, room);
                }
                break;

            default:
                break;
        }
    });

    ws.on('close', () => {
        if (room.agentWs === ws) {
            room.agentWs = null;
            log.info(`Agent disconnected: ${deviceId}`);
            broadcast(room, { type: 'status', agent_connected: false });
            broadcast(room, { type: 'presence', device_id: deviceId, online: false });
            broadcastToPanelOperators({ type: 'status', device_id: deviceId, agent_connected: false }, null, room);
            broadcastToPanelOperators({ type: 'presence', device_id: deviceId, online: false }, null, room);
        }
    });

    ws.on('error', (err) => {
        log.warn(`Agent WS error ${deviceId}: ${err.message}`);
    });
}

// --- Operator handler ---

function handleOperatorConnection(ws, deviceId, operatorName) {
    const room = getRoom(deviceId);
    room.operatorWss.add(ws);
    const isPanel = deviceId === 'panel';
    if (isPanel) panelOperators.add(ws);

    log.info(`Operator ${operatorName} connected to ${deviceId}`);

    sendTo(ws, {
        type: 'status',
        agent_connected: !!room.agentWs && room.agentWs.readyState === WebSocket.OPEN,
    });

    // The standalone panel is a directory, not a device conversation. Load its
    // real users and devices immediately so the sidebar is useful on first open.
    if (isPanel) {
        loadContacts('panel').then(data => {
            sendTo(ws, {
                type: 'contacts',
                contacts: data?.contacts?.length ? data.contacts : fallbackContacts('panel'),
            });
        });
        loadGroups('panel').then(data => {
            if (data?.groups) sendTo(ws, { type: 'groups', groups: data.groups });
        });
    } else {
        loadHistory(deviceId).then(data => {
            if (data && data.messages) {
                sendTo(ws, { type: 'history', conversation_id: deviceId, messages: data.messages });
            } else {
                sendTo(ws, { type: 'history', messages: room.messages });
            }
        });
    }

    setupPing(ws);

    ws.on('message', (data, isBinary) => {
        if (isBinary || data.length > MAX_TEXT_BYTES) return;
        let frame;
        try { frame = JSON.parse(data.toString()); } catch { return; }

        switch (frame.type) {
            case 'hello':
                sendTo(ws, {
                    type: 'welcome',
                    device_id: deviceId,
                    server_time: Date.now(),
                    capabilities: ['multi_conversation', 'contacts', 'groups', 'history', 'e2e_encryption', 'read_receipts', 'typing', 'presence', 'file_share'],
                });
                break;

            case 'get_contacts':
                loadContacts(frame.device_id || deviceId).then(data => {
                    sendTo(ws, {
                        type: 'contacts',
                        contacts: data?.contacts?.length ? data.contacts : fallbackContacts(deviceId),
                    });
                });
                break;

            case 'get_groups':
                loadGroups(frame.device_id || deviceId).then(data => {
                    if (data?.groups) sendTo(ws, { type: 'groups', groups: data.groups });
                });
                break;

            case 'get_history':
                loadHistory(frame.conversation_id || deviceId).then(data => {
                    if (data && data.messages) {
                        sendTo(ws, {
                            type: 'history',
                            conversation_id: frame.conversation_id,
                            messages: data.messages,
                        });
                    } else if (frame.conversation_id && frame.conversation_id === deviceId) {
                        sendTo(ws, { type: 'history', conversation_id: deviceId, messages: room.messages });
                    }
                });
                break;

            case 'message': {
                const conversationId = frame.conversation_id || deviceId;
                const targetRoom = rooms.get(conversationId);
                const msg = {
                    type: 'message',
                    id: Date.now(),
                    from: 'operator',
                    from_name: operatorName,
                    conversation_id: conversationId,
                    operator: operatorName,
                    to_id: conversationId,
                    text: String(frame.text || '').slice(0, 2048),
                    timestamp: Date.now(),
                };
                appendMessage(targetRoom || room, msg);
                if (targetRoom && targetRoom !== room) {
                    // Deliver to the selected device and any device-scoped
                    // clients. The panel socket receives an explicit echo.
                    broadcast(targetRoom, msg, ws);
                } else if (isPanel) {
                    broadcastToPanelOperators(msg, ws);
                } else {
                    broadcast(room, msg, ws);
                }
                sendTo(ws, msg);
                persistMessage(msg);
                break;
            }

            case 'typing': {
                const conversationId = frame.conversation_id || deviceId;
                const targetRoom = rooms.get(conversationId);
                const typing = {
                    type: 'typing',
                    from: 'operator',
                    operator: operatorName,
                    conversation_id: conversationId,
                };
                if (targetRoom && targetRoom !== room) broadcast(targetRoom, typing, ws);
                else if (isPanel) broadcastToPanelOperators(typing, ws);
                else broadcast(room, typing, ws);
                break;
            }

            // E2E key exchange: relay operator public key to agents
            case 'key_exchange': {
                const conversationId = frame.conversation_id || deviceId;
                const targetRoom = rooms.get(conversationId);
                const keyExchange = {
                    type: 'key_exchange',
                    from: 'operator',
                    operator: operatorName,
                    public_key: frame.public_key,
                    conversation_id: conversationId,
                };
                if (targetRoom && targetRoom !== room) broadcast(targetRoom, keyExchange, ws);
                else if (isPanel) broadcastToPanelOperators(keyExchange, ws);
                else broadcast(room, keyExchange, ws);
                break;
            }

            // Read receipts from operator
            case 'read_receipt': {
                const conversationId = frame.conversation_id || deviceId;
                const targetRoom = rooms.get(conversationId);
                const receipt = {
                    type: 'read_receipt',
                    from: 'operator',
                    operator: operatorName,
                    message_ids: frame.message_ids || [],
                    conversation_id: conversationId,
                    timestamp: Date.now(),
                };
                if (targetRoom && targetRoom !== room) broadcast(targetRoom, receipt, ws);
                else if (isPanel) broadcastToPanelOperators(receipt, ws);
                else broadcast(room, receipt, ws);
                if (goApi && conversationId) {
                    goApi.post('/chat/read', {
                        conversation_id: conversationId,
                        reader_id: operatorName,
                        message_ids: frame.message_ids || [],
                    }).catch(() => {});
                }
                break;
            }

            case 'mark_read':
                if (goApi && frame.conversation_id) {
                    goApi.post('/chat/read', {
                        conversation_id: frame.conversation_id,
                        reader_id: operatorName,
                    }).catch(() => {});
                }
                break;

            case 'create_group':
                if (goApi && frame.name && Array.isArray(frame.member_ids)) {
                    goApi.post('/chat/groups', {
                        name: String(frame.name).slice(0, 120),
                        members: frame.member_ids,
                        created_by: operatorName,
                    }).then(resp => {
                        sendTo(ws, { type: 'group_created', ...resp.data });
                        return loadGroups(deviceId);
                    }).then(data => {
                        if (data?.groups) sendTo(ws, { type: 'groups', groups: data.groups });
                    }).catch(() => {});
                }
                break;

            case 'presence_update': {
                const presence = {
                    type: 'presence',
                    device_id: `operator:${operatorName}`,
                    online: frame.online !== false,
                    status: frame.status || 'available',
                    timestamp: Date.now(),
                };
                if (isPanel) broadcastToPanelOperators(presence, ws);
                else broadcast(room, presence, ws);
                break;
            }

            // Encrypted file share from operator
            case 'file_share': {
                const conversationId = frame.conversation_id || deviceId;
                const targetRoom = rooms.get(conversationId);
                const fileShare = {
                    type: 'file_share',
                    from: 'operator',
                    from_name: operatorName,
                    conversation_id: conversationId,
                    file_id: frame.file_id || ('file_' + Date.now()),
                    file_name_encrypted: frame.file_name_encrypted || '',
                    file_size: frame.file_size || 0,
                    encrypted_metadata: frame.encrypted_metadata || '',
                    timestamp: Date.now(),
                };
                if (targetRoom && targetRoom !== room) broadcast(targetRoom, fileShare, ws);
                else if (isPanel) broadcastToPanelOperators(fileShare, ws);
                else broadcast(room, fileShare, ws);
                break;
            }

            default:
                break;
        }
    });

    ws.on('close', () => {
        room.operatorWss.delete(ws);
        panelOperators.delete(ws);
        log.info(`Operator ${operatorName} left ${deviceId}`);
    });

    ws.on('error', (err) => {
        log.warn(`Operator WS error ${deviceId}: ${err.message}`);
    });
}

// --- Init ---

function initChatRelay(server, sessionMiddleware, betterdeskApi) {
    // Store API reference for persistence
    if (betterdeskApi) {
        goApi = betterdeskApi;
        log.info('Chat persistence enabled via Go server API');
    }

    const wss = new WebSocket.Server({ noServer: true });
    const { enforceOrigin } = require('../middleware/wsOrigin');
    const { registerUpgradeHandler } = require('./wsUpgradeRouter');

    registerUpgradeHandler(
        server,
        (pathname) => /^\/ws\/chat\/[^/]+$/.test(pathname) || /^\/ws\/chat-operator\/[^/]+$/.test(pathname),
        (req, socket, head) => {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const pathname = url.pathname;

            const agentMatch = pathname.match(/^\/ws\/chat\/([^/]+)$/);
            if (agentMatch) {
                if (!enforceOrigin(req, socket, `chat-agent ${pathname}`)) return;
                const authHeader = req.headers.authorization || '';
                const headerToken = /^Bearer\s+(\S+)$/.exec(authHeader)?.[1] || '';
                const token = url.searchParams.get('token') || headerToken;
                verifyDeviceWsAuth(agentMatch[1], token, db).then((ok) => {
                    if (!ok) {
                        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                        socket.destroy();
                        return;
                    }
                    wss.handleUpgrade(req, socket, head, (ws) => {
                        wss.emit('connection', ws, req, 'agent', agentMatch[1]);
                    });
                }).catch(() => {
                    try {
                        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
                        socket.destroy();
                    } catch (_) { /* socket already closed */ }
                });
                return;
            }

            const opMatch = pathname.match(/^\/ws\/chat-operator\/([^/]+)$/);
            if (opMatch) {
                if (!enforceOrigin(req, socket, `chat-operator ${pathname}`)) return;
                sessionMiddleware(req, {}, () => {
                    if (!req.session || !req.session.userId) {
                        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                        socket.destroy();
                        return;
                    }
                    if (!roleHasPermission(req.session.user?.role, 'chat.access')) {
                        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                        socket.destroy();
                        return;
                    }
                    wss.handleUpgrade(req, socket, head, (ws) => {
                        wss.emit('connection', ws, req, 'operator', opMatch[1]);
                    });
                });
            }
        }
    );

    wss.on('connection', (ws, req, role, deviceId) => {
        if (role === 'agent') {
            handleAgentConnection(ws, deviceId);
        } else {
            sessionMiddleware(req, {}, () => {
                const operatorName = req.session?.user?.username || req.session?.username || 'operator';
                handleOperatorConnection(ws, deviceId, operatorName);
            });
        }
    });

    log.info('Chat relay v2 initialized (persistent via Go API)');
    return wss;
}

module.exports = {
    initChatRelay,
    getRoomState(deviceId) {
        const room = rooms.get(deviceId);
        if (!room) return null;
        return {
            agentConnected: !!room.agentWs && room.agentWs.readyState === WebSocket.OPEN,
            operatorCount: room.operatorWss.size,
            messageCount: room.messages.length,
            lastMessages: room.messages.slice(-20),
        };
    },
    getRooms: () => [...rooms.keys()],
};
