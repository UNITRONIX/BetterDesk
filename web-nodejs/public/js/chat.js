/**
 * BetterDesk Console — Chat 2.0 Client
 *
 * Features:
 *  - E2E encryption (ECDH P-256 + AES-256-GCM) via chatCrypto.js
 *  - 1:1 and group conversations
 *  - File sharing (encrypted, up to 50MB)
 *  - Typing indicator, read receipts, online presence
 *  - Message search, push notifications, emoji reactions
 *  - Quick commands (/screenshot, /restart, /lock, /deploy)
 */

'use strict';

/* global _, Utils, Toast */

(function () {
    // ==================== State ====================
    let ws = null;
    let reconnectTimer = null;
    let reconnectDelay = 2000;
    const MAX_RECONNECT = 60000;

    let contacts = [];
    let groups = [];
    let conversations = new Map(); // conv_id → { messages: [], unread: 0 }
    let activeConvId = null;
    let activeConvType = 'contact'; // 'contact' | 'group'
    let myPresence = 'online';
    let typingTimers = new Map(); // conv_id → timeout
    let lastTypingSent = 0;
    let pendingFile = null;
    let e2eKeys = new Map(); // conv_id → { publicKey, sharedSecret }

    // Quick commands definition
    const QUICK_COMMANDS = {
        '/screenshot': { icon: 'screenshot_monitor', label: 'Screenshot', action: 'screenshot' },
        '/restart': { icon: 'restart_alt', label: 'Restart', action: 'restart', confirm: true },
        '/lock': { icon: 'lock', label: 'Lock screen', action: 'lock' },
        '/shutdown': { icon: 'power_settings_new', label: 'Shutdown', action: 'shutdown', confirm: true },
        '/deploy': { icon: 'cloud_upload', label: 'Deploy script', action: 'deploy', hasArg: true },
        '/info': { icon: 'info', label: 'Device info', action: 'info' },
    };

    // Common emoji set (lightweight)
    const EMOJI_SET = ['👍', '👎', '❤️', '😂', '😮', '😢', '🔥', '🎉', '✅', '❌',
        '👏', '🤔', '💯', '⭐', '🚀', '🐛', '🔧', '📎', '🔒', '⚡'];

    // ==================== DOM References ====================
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const dom = {};

    function initDom() {
        dom.contactsList = $('#chat-contacts-list');
        dom.groupsList = $('#chat-groups-list');
        dom.emptyState = $('#chat-empty-state');
        dom.conversation = $('#chat-conversation');
        dom.convName = $('#chat-conv-name');
        dom.convStatus = $('#chat-conv-status');
        dom.convAvatar = $('#chat-conv-avatar');
        dom.messagesInner = $('#chat-messages-inner');
        dom.messagesWrap = $('#chat-messages');
        dom.input = $('#chat-input');
        dom.sendBtn = $('#chat-send-btn');
        dom.typing = $('#chat-typing');
        dom.typingText = $('#chat-typing-text');
        dom.e2eBanner = $('#chat-e2e-banner');
        dom.e2eText = $('#chat-e2e-text');
        dom.fileInput = $('#chat-file-input');
        dom.filePreview = $('#chat-file-preview');
        dom.fileName = $('#chat-file-name');
        dom.fileSize = $('#chat-file-size');
        dom.searchBar = $('#chat-search-bar');
        dom.searchInput = $('#chat-search-input');
        dom.searchResults = $('#chat-search-results');
        dom.emojiPicker = $('#chat-emoji-picker');
        dom.presenceSelect = $('#chat-presence-select');
        dom.presenceDot = $('#chat-my-presence-dot');
        dom.split = $('#chat-split');
        dom.connection = $('#chat-connection');
        dom.sendStatus = $('#chat-send-status');
        dom.searchToggle = $('#chat-search-toggle');
        dom.emojiBtn = $('#chat-emoji-btn');
    }

    // "{count} new" and similar templates
    function fill(template, values) {
        return String(template).replace(/\{(\w+)\}/g, (m, k) => (values[k] !== undefined ? values[k] : m));
    }

    // Go stores group ids as "group:xxxx" and uses that id as the
    // conversation id; older ids without the prefix get "group_".
    function groupConvId(g) {
        const id = String(g.id);
        return id.startsWith('group:') ? id : 'group_' + id;
    }

    // Members come as a comma-separated string from the server (or an array)
    function memberCount(g) {
        const m = g.members;
        if (Array.isArray(m)) return m.length;
        if (typeof m === 'string') return m.split(',').map(s => s.trim()).filter(Boolean).length;
        return 0;
    }

    function roleLabel(role) {
        if (role === 'device') return _('chat.role_device');
        if (role === 'operator') return _('chat.role_operator');
        return role ? String(role) : '';
    }

    function unreadText(count) {
        return fill(_('chat.unread_count'), { count: count > 99 ? '99+' : count });
    }

    function setConnected(connected) {
        if (dom.connection) dom.connection.hidden = !!connected;
    }

    // ==================== WebSocket ====================
    function connect() {
        if (ws && ws.readyState <= WebSocket.OPEN) return;

        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        // Connect as operator — deviceId = 'panel' for standalone chat
        ws = new WebSocket(`${proto}://${location.host}/ws/chat-operator/panel`);

        ws.onopen = () => {
            reconnectDelay = 2000;
            setConnected(true);
            ws.send(JSON.stringify({ type: 'hello', device_id: 'panel', role: 'operator' }));
            ws.send(JSON.stringify({ type: 'get_contacts', device_id: 'panel' }));

            // Send presence
            sendPresence(myPresence);
        };

        ws.onmessage = (evt) => {
            let frame;
            try { frame = JSON.parse(evt.data); } catch { return; }
            handleFrame(frame);
        };

        ws.onclose = () => {
            setConnected(false);
            scheduleReconnect();
        };

        ws.onerror = () => {};
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT);
            connect();
        }, reconnectDelay);
    }

    function send(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    // ==================== Frame Handler ====================
    function handleFrame(frame) {
        switch (frame.type) {
            case 'welcome':
                updateConnectionStatus(true);
                break;

            case 'contacts':
                contacts = frame.contacts || [];
                renderContacts();
                break;

            case 'groups':
                groups = frame.groups || [];
                renderGroups();
                break;

            case 'group_created':
                if (typeof Notifications !== 'undefined') {
                    Notifications.success(fill(_('chat.group_created'), { name: frame.name || '' }));
                }
                showTab('groups');
                break;

            case 'history': {
                const convId = frame.conversation_id || 'default';
                if (!conversations.has(convId)) {
                    conversations.set(convId, { messages: [], unread: 0 });
                }
                const conv = conversations.get(convId);
                conv.messages = (frame.messages || []).map(normalizeMessage);
                if (convId === activeConvId) renderMessages();
                break;
            }

            case 'message': {
                const msg = normalizeMessage(frame);
                const convId = msg.conversation_id || 'default';
                if (!conversations.has(convId)) {
                    conversations.set(convId, { messages: [], unread: 0 });
                }
                const conv = conversations.get(convId);
                conv.messages.push(msg);
                if (conv.messages.length > 1000) conv.messages.splice(0, conv.messages.length - 1000);

                if (convId === activeConvId) {
                    appendMessageDom(msg);
                    scrollToBottom();
                    // Auto send read receipt
                    send({ type: 'read_receipt', conversation_id: convId, message_ids: [msg.id] });
                } else {
                    conv.unread++;
                    updateUnreadBadge(convId, conv.unread);
                    showNotification(msg);
                }
                break;
            }

            case 'typing': {
                const convId = frame.conversation_id || 'default';
                if (convId !== activeConvId) return;
                const name = frame.from_name || frame.from || frame.operator || '';
                showTyping(name);
                break;
            }

            case 'read_receipt':
                if (frame.conversation_id === activeConvId) {
                    markMessagesRead(frame.message_ids || []);
                }
                break;

            case 'presence': {
                const deviceId = frame.device_id;
                const c = contacts.find(c => c.id === deviceId);
                if (c) {
                    c.online = frame.online;
                    c.status = frame.status || (frame.online ? 'online' : 'offline');
                    renderContacts();
                    if (activeConvId === deviceId) updateConvHeader();
                }
                break;
            }

            case 'key_exchange':
                handleKeyExchange(frame);
                break;

            case 'file_share':
                handleFileShare(frame);
                break;

            case 'status':
                updateConnectionStatus(true);
                break;

            case 'system_message': {
                const sysMsg = {
                    id: frame.id || Date.now(),
                    from: 'system',
                    text: frame.text || '',
                    timestamp: frame.timestamp || Date.now(),
                    system: true,
                    conversation_id: frame.conversation_id || activeConvId || 'default',
                };
                const convId = sysMsg.conversation_id;
                if (!conversations.has(convId)) conversations.set(convId, { messages: [], unread: 0 });
                conversations.get(convId).messages.push(sysMsg);
                if (convId === activeConvId) {
                    appendMessageDom(sysMsg);
                    scrollToBottom();
                }
                break;
            }

            case 'reaction': {
                const convId = frame.conversation_id;
                if (convId !== activeConvId) return;
                const msgEl = document.querySelector(`.chat-msg[data-id="${frame.message_id}"]`);
                if (msgEl) addReactionBadge(msgEl, frame.emoji, frame.from);
                break;
            }

            case 'command_result': {
                const text = `Command result (${frame.action}): ${frame.result || frame.error || 'done'}`;
                const sysMsg = { id: Date.now(), from: 'system', text, timestamp: Date.now(), system: true, conversation_id: frame.conversation_id || activeConvId };
                if (sysMsg.conversation_id && conversations.has(sysMsg.conversation_id)) {
                    conversations.get(sysMsg.conversation_id).messages.push(sysMsg);
                    if (sysMsg.conversation_id === activeConvId) {
                        appendMessageDom(sysMsg);
                        scrollToBottom();
                    }
                }
                break;
            }
        }
    }

    // ==================== Key Exchange (E2E) ====================
    async function initE2E(convId) {
        if (typeof ChatCrypto === 'undefined') return;
        try {
            await ChatCrypto.init(convId);
            const pubKey = await ChatCrypto.getPublicKey();
            send({ type: 'key_exchange', conversation_id: convId, public_key: pubKey });
            showE2EBanner('establishing');
        } catch (e) {
            console.warn('[Chat] E2E init failed:', e.message);
        }
    }

    async function handleKeyExchange(frame) {
        if (typeof ChatCrypto === 'undefined') return;
        try {
            await ChatCrypto.receivePublicKey(frame.conversation_id || activeConvId, frame.public_key);
            showE2EBanner('established');
        } catch (e) {
            console.warn('[Chat] Key exchange failed:', e.message);
        }
    }

    function showE2EBanner(state) {
        if (!dom.e2eBanner) return;
        dom.e2eBanner.style.display = 'flex';
        if (state === 'established') {
            dom.e2eText.textContent = _('chat.e2e_established');
            dom.e2eBanner.classList.add('established');
            setTimeout(() => { dom.e2eBanner.style.display = 'none'; }, 5000);
        } else {
            dom.e2eText.textContent = _('chat.e2e_establishing');
            dom.e2eBanner.classList.remove('established');
        }
    }

    // ==================== Contacts & Groups ====================
    function renderContacts() {
        if (!dom.contactsList) return;
        if (contacts.length === 0) {
            dom.contactsList.innerHTML = `<li class="list-row is-empty chat-list-empty">${Utils.escapeHtml(_('chat.no_contacts'))}</li>`;
            return;
        }

        // Sort: online first, then alphabetical
        const sorted = [...contacts].sort((a, b) => {
            if (a.online && !b.online) return -1;
            if (!a.online && b.online) return 1;
            return (a.name || a.id).localeCompare(b.name || b.id);
        });

        dom.contactsList.innerHTML = sorted.map(c => {
            const conv = conversations.get(c.id);
            const unread = conv ? conv.unread : 0;
            const presenceKey = c.online ? (c.status || 'online') : 'offline';
            const sub = [roleLabel(c.role), _(`chat.presence_${presenceKey}`)].filter(Boolean).join(', ');
            const lastMsg = conv && conv.messages.length > 0 ? conv.messages[conv.messages.length - 1] : null;
            return listRowHtml({
                id: c.id,
                type: 'contact',
                name: c.name || c.id,
                sub,
                presence: presenceKey,
                lastMsg,
                unread,
            });
        }).join('');
    }

    // One conversation row: name, who or what it is, the last message, unread count as text
    function listRowHtml({ id, type, name, sub, presence, lastMsg, unread }) {
        const active = activeConvId === id;
        const preview = lastMsg ? (lastMsg.text || (lastMsg.file ? lastMsg.file.name : '')) : '';
        return `
            <li>
                <button type="button" class="list-row chat-list-item${active ? ' active' : ''}" data-id="${Utils.escapeHtml(id)}" data-type="${type}"${active ? ' aria-current="true"' : ''}>
                    <span class="row-main">
                        <span class="row-title chat-list-name">${presence ? `<span class="chat-presence-mark presence-${Utils.escapeHtml(presence)}" aria-hidden="true"></span>` : ''}${Utils.escapeHtml(name)}</span>
                        <span class="row-sub chat-list-meta">${Utils.escapeHtml(sub)}</span>
                        ${preview ? `<span class="row-sub chat-list-preview">${Utils.escapeHtml(preview)}</span>` : ''}
                    </span>
                    <span class="row-end">
                        ${lastMsg ? `<span class="chat-list-time">${formatTime(lastMsg.timestamp)}</span>` : ''}
                        ${unread > 0 ? `<span class="chat-unread-badge">${Utils.escapeHtml(unreadText(unread))}</span>` : ''}
                    </span>
                </button>
            </li>`;
    }

    function renderGroups() {
        if (!dom.groupsList) return;
        if (groups.length === 0) {
            dom.groupsList.innerHTML = `<li class="list-row is-empty chat-list-empty">${Utils.escapeHtml(_('chat.no_groups_hint'))}</li>`;
            return;
        }

        dom.groupsList.innerHTML = groups.map(g => {
            const convId = groupConvId(g);
            const conv = conversations.get(convId);
            const lastMsg = conv && conv.messages.length > 0 ? conv.messages[conv.messages.length - 1] : null;
            return listRowHtml({
                id: convId,
                type: 'group',
                name: g.name,
                sub: fill(_('chat.member_count'), { count: memberCount(g) }),
                presence: '',
                lastMsg,
                unread: conv ? conv.unread : 0,
            });
        }).join('');
    }

    // ==================== Conversation ====================
    function openConversation(convId, type) {
        activeConvId = convId;
        activeConvType = type || 'contact';

        // Create conversation if needed
        if (!conversations.has(convId)) {
            conversations.set(convId, { messages: [], unread: 0 });
        }

        // Clear unread
        const conv = conversations.get(convId);
        conv.unread = 0;
        updateUnreadBadge(convId, 0);

        // Update UI
        dom.emptyState.style.display = 'none';
        dom.conversation.style.display = 'flex';
        // On a phone the list and the conversation take turns
        if (dom.split) dom.split.classList.add('is-detail-open');
        if (dom.sendStatus) dom.sendStatus.textContent = '';

        updateConvHeader();
        renderMessages();
        scrollToBottom();

        // Mark active in list
        $$('.chat-list-item').forEach(el => {
            const on = el.dataset.id === convId;
            el.classList.toggle('active', on);
            if (on) el.setAttribute('aria-current', 'true');
            else el.removeAttribute('aria-current');
        });

        // Load history from server
        send({ type: 'get_history', device_id: 'panel', conversation_id: convId });

        // Init E2E for this conversation
        initE2E(convId);

        // Focus input
        if (dom.input) dom.input.focus();
    }

    function updateConvHeader() {
        if (!activeConvId) return;

        if (activeConvType === 'group') {
            const g = groups.find(g => groupConvId(g) === activeConvId);
            if (g) {
                dom.convName.textContent = g.name;
                dom.convStatus.textContent = fill(_('chat.member_count'), { count: memberCount(g) });
                dom.convStatus.className = 'chat-conv-status';
            }
        } else {
            const c = contacts.find(c => c.id === activeConvId);
            if (c) {
                const name = c.name || c.id;
                dom.convName.textContent = name;
                const presenceKey = c.online ? (c.status || 'online') : 'offline';
                dom.convStatus.textContent = [roleLabel(c.role), _(`chat.presence_${presenceKey}`)].filter(Boolean).join(', ');
                dom.convStatus.className = `chat-conv-status presence-${presenceKey}`;
            } else {
                dom.convName.textContent = activeConvId;
                dom.convStatus.textContent = '';
            }
        }
    }

    // ==================== Messages ====================
    function normalizeMessage(msg) {
        return {
            id: msg.id || Date.now(),
            from: msg.from || msg.from_id || '',
            from_name: msg.from_name || msg.operator || msg.from || msg.from_id || '',
            text: msg.text || '',
            timestamp: msg.timestamp || msg.created_at || Date.now(),
            conversation_id: msg.conversation_id || '',
            system: !!msg.system,
            file: msg.file || null,
            reactions: msg.reactions || {},
            read_by: msg.read_by || [],
        };
    }

    function renderMessages() {
        if (!dom.messagesInner) return;
        const conv = conversations.get(activeConvId);
        if (!conv || conv.messages.length === 0) {
            dom.messagesInner.innerHTML = `<p class="state chat-messages-empty">${Utils.escapeHtml(_('chat.no_messages'))}</p>`;
            return;
        }

        let html = '';
        let lastDate = '';

        for (const msg of conv.messages) {
            // Date separator
            const date = formatDate(msg.timestamp);
            if (date !== lastDate) {
                html += `<p class="chat-date-separator">${Utils.escapeHtml(date)}</p>`;
                lastDate = date;
            }
            html += renderMessageHtml(msg);
        }

        dom.messagesInner.innerHTML = html;
        attachMessageHandlers();
        scrollToBottom();
    }

    function renderMessageHtml(msg) {
        const msgId = Utils.escapeHtml(String(msg.id ?? ''));

        if (msg.system) {
            return `<div class="chat-msg system" data-id="${msgId}">${Utils.escapeHtml(msg.text)}</div>`;
        }

        const isMe = msg.from === 'operator' || msg.from === 'panel';
        const name = Utils.escapeHtml(msg.from_name || msg.from);
        const time = formatTime(msg.timestamp);
        const readText = msg.read_by && msg.read_by.length > 0 ? _('chat.read_receipt') : _('chat.delivered');

        let content = '';
        if (msg.file) {
            content = `<p class="chat-file-msg">
                <a href="${Utils.escapeHtml(msg.file.url)}" target="_blank" rel="noopener">${Utils.escapeHtml(msg.file.name)}</a>
                <span class="chat-file-size-label">${formatFileSize(msg.file.size)}</span>
            </p>`;
        }
        content += msg.text ? `<div class="chat-msg-text">${linkify(Utils.escapeHtml(msg.text))}</div>` : '';

        // Reactions: the emoji and how many, as plain buttons
        let reactionsHtml = '';
        if (msg.reactions && Object.keys(msg.reactions).length > 0) {
            reactionsHtml = '<div class="chat-reactions">';
            for (const [emoji, users] of Object.entries(msg.reactions)) {
                const safeEmoji = Utils.escapeHtml(emoji);
                const safeTitle = Utils.escapeHtml((users || []).join(', '));
                reactionsHtml += `<button type="button" class="chat-reaction" data-emoji="${safeEmoji}" title="${safeTitle}">${safeEmoji} ${(users || []).length}</button>`;
            }
            reactionsHtml += '</div>';
        }

        return `
            <div class="chat-msg ${isMe ? 'mine' : 'theirs'}" data-id="${msgId}">
                <div class="chat-msg-head">
                    <span class="chat-msg-sender">${name}</span>
                    <span class="chat-msg-meta">
                        <span class="chat-msg-time">${time}</span>${isMe ? `, <span class="chat-msg-read">${Utils.escapeHtml(readText)}</span>` : ''}
                    </span>
                    <button type="button" class="btn-link chat-msg-react-btn">${Utils.escapeHtml(_('chat.react'))}</button>
                </div>
                <div class="chat-msg-bubble">${content}</div>
                ${reactionsHtml}
            </div>
        `;
    }

    function appendMessageDom(msg) {
        if (!dom.messagesInner) return;
        // Remove empty state
        const empty = dom.messagesInner.querySelector('.chat-messages-empty');
        if (empty) empty.remove();

        const html = renderMessageHtml(msg);
        dom.messagesInner.insertAdjacentHTML('beforeend', html);

        // Attach handlers to new message
        const lastMsg = dom.messagesInner.lastElementChild;
        if (lastMsg) attachSingleMessageHandlers(lastMsg);
    }

    function attachMessageHandlers() {
        dom.messagesInner.querySelectorAll('.chat-msg').forEach(el => attachSingleMessageHandlers(el));
    }

    function attachSingleMessageHandlers(el) {
        const reactBtn = el.querySelector('.chat-msg-react-btn');
        if (reactBtn) {
            reactBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showReactionPicker(el, e.currentTarget);
            });
        }
        el.querySelectorAll('.chat-reaction').forEach(badge => {
            badge.addEventListener('click', () => {
                const emoji = badge.dataset.emoji;
                const msgId = el.dataset.id;
                toggleReaction(msgId, emoji);
            });
        });
    }

    function scrollToBottom() {
        if (dom.messagesWrap) {
            requestAnimationFrame(() => {
                dom.messagesWrap.scrollTop = dom.messagesWrap.scrollHeight;
            });
        }
    }

    function markMessagesRead(ids) {
        ids.forEach(id => {
            const el = document.querySelector(`.chat-msg[data-id="${CSS.escape(String(id))}"] .chat-msg-read`);
            if (el) el.textContent = _('chat.read_receipt');
        });
    }

    // ==================== Sending ====================
    function sendMessage() {
        const text = (dom.input.value || '').trim();
        if (!text && !pendingFile) return;

        // Say so instead of dropping the message while the socket is down
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            if (dom.sendStatus) {
                dom.sendStatus.textContent = _('chat.send_failed');
                dom.sendStatus.className = 'form-status chat-send-status is-error';
            }
            return;
        }
        if (dom.sendStatus) dom.sendStatus.textContent = '';

        // Check for quick commands
        if (text.startsWith('/')) {
            const handled = handleQuickCommand(text);
            if (handled) {
                dom.input.value = '';
                autoResizeInput();
                return;
            }
        }

        // Build message
        const msg = {
            type: 'message',
            text: text,
            conversation_id: activeConvId,
            timestamp: Date.now(),
        };

        // If file is pending, upload first
        if (pendingFile) {
            uploadAndSendFile(pendingFile, text);
            pendingFile = null;
            dom.filePreview.style.display = 'none';
            dom.input.value = '';
            autoResizeInput();
            return;
        }

        send(msg);
        dom.input.value = '';
        autoResizeInput();
    }

    async function uploadAndSendFile(file, caption) {
        try {
            const formData = new FormData();
            formData.append('file', file);

            const resp = await fetch('/api/chat/upload', {
                method: 'POST',
                body: formData,
                headers: { 'X-CSRF-Token': (typeof BetterDesk !== 'undefined' && BetterDesk.csrfToken) || '' },
            });
            const data = await resp.json();
            if (!data.success) throw new Error(data.error);

            // Send file_share frame
            send({
                type: 'file_share',
                conversation_id: activeConvId,
                file_id: data.file_id,
                file_name_encrypted: file.name,
                file_size: file.size,
                file_url: data.url,
            });

            // Send caption as message
            if (caption) {
                send({
                    type: 'message',
                    text: caption,
                    conversation_id: activeConvId,
                    timestamp: Date.now(),
                });
            }

            if (typeof Notifications !== 'undefined') Notifications.success(file.name, _('chat.file_share'));
        } catch (e) {
            if (typeof Notifications !== 'undefined') Notifications.error(e.message);
        }
    }

    // ==================== Typing ====================
    function sendTyping() {
        const now = Date.now();
        if (now - lastTypingSent < 2000) return;
        lastTypingSent = now;
        send({ type: 'typing', conversation_id: activeConvId });
    }

    function showTyping(name) {
        if (!dom.typing) return;
        dom.typingText.textContent = fill(_('chat.typing_name'), { name });
        dom.typing.style.display = 'flex';

        // Clear after 3s
        const key = activeConvId || 'default';
        if (typingTimers.has(key)) clearTimeout(typingTimers.get(key));
        typingTimers.set(key, setTimeout(() => {
            dom.typing.style.display = 'none';
        }, 3000));
    }

    // ==================== Quick Commands ====================
    function handleQuickCommand(text) {
        const parts = text.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const def = QUICK_COMMANDS[cmd];
        if (!def) return false;

        if (def.confirm && typeof Modal !== 'undefined') {
            const convId = activeConvId;
            Modal.confirm({
                title: fill(_('chat.command_confirm'), { command: def.label, device: convId }),
                message: fill(_('chat.command_confirm_hint'), { device: convId }),
                confirmLabel: def.label,
                danger: true,
            }).then(ok => { if (ok) runQuickCommand(cmd, def, parts, convId); });
            return true;
        }

        runQuickCommand(cmd, def, parts, activeConvId);
        return true;
    }

    function runQuickCommand(cmd, def, parts, convId) {
        send({
            type: 'quick_command',
            conversation_id: convId,
            device_id: convId,
            action: def.action,
            args: parts.slice(1).join(' '),
        });

        // Show system message locally
        const sysMsg = {
            id: Date.now(), from: 'system', system: true,
            text: `Command sent: ${cmd} ${parts.slice(1).join(' ')}`,
            timestamp: Date.now(), conversation_id: convId,
        };
        const conv = conversations.get(convId);
        if (conv) {
            conv.messages.push(sysMsg);
            if (convId === activeConvId) {
                appendMessageDom(sysMsg);
                scrollToBottom();
            }
        }
    }

    // ==================== Reactions ====================
    // One small floating picker for reactions and for the message field.
    // Escape or a click outside closes it and puts focus back on the button.
    let pickerAnchor = null;

    function closeEmojiPicker(returnFocus) {
        if (!dom.emojiPicker || dom.emojiPicker.style.display === 'none') return;
        dom.emojiPicker.style.display = 'none';
        document.removeEventListener('click', onPickerOutside, true);
        document.removeEventListener('keydown', onPickerKey, true);
        if (pickerAnchor) {
            pickerAnchor.setAttribute('aria-expanded', 'false');
            if (returnFocus && document.contains(pickerAnchor)) pickerAnchor.focus();
        }
        pickerAnchor = null;
    }

    function onPickerOutside(e) {
        if (dom.emojiPicker.contains(e.target) || (pickerAnchor && pickerAnchor.contains(e.target))) return;
        closeEmojiPicker(false);
    }

    function onPickerKey(e) {
        if (e.key === 'Escape') {
            e.stopPropagation();
            closeEmojiPicker(true);
        }
    }

    function openEmojiPicker(anchorEl, onPick, placeAbove) {
        if (!dom.emojiPicker) return;
        closeEmojiPicker(false);
        dom.emojiPicker.innerHTML = EMOJI_SET.map(e =>
            `<button type="button" class="emoji-btn" role="menuitem" data-emoji="${e}">${e}</button>`
        ).join('');
        dom.emojiPicker.style.display = 'flex';
        pickerAnchor = anchorEl;
        anchorEl.setAttribute('aria-expanded', 'true');

        // Fixed position next to the button, kept inside the window
        const rect = anchorEl.getBoundingClientRect();
        const pw = dom.emojiPicker.offsetWidth;
        const ph = dom.emojiPicker.offsetHeight;
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - pw - 8));
        const top = placeAbove || rect.bottom + ph + 8 > window.innerHeight
            ? Math.max(8, rect.top - ph - 4)
            : rect.bottom + 4;
        dom.emojiPicker.style.left = left + 'px';
        dom.emojiPicker.style.top = top + 'px';

        dom.emojiPicker.querySelectorAll('.emoji-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                closeEmojiPicker(false);
                onPick(btn.dataset.emoji);
            });
        });
        const first = dom.emojiPicker.querySelector('.emoji-btn');
        if (first) first.focus();

        setTimeout(() => {
            document.addEventListener('click', onPickerOutside, true);
            document.addEventListener('keydown', onPickerKey, true);
        }, 0);
    }

    function showReactionPicker(msgEl, anchorEl) {
        openEmojiPicker(anchorEl, (emoji) => {
            toggleReaction(msgEl.dataset.id, emoji);
            anchorEl.focus();
        }, false);
    }

    function toggleReaction(messageId, emoji) {
        send({
            type: 'reaction',
            conversation_id: activeConvId,
            message_id: messageId,
            emoji: emoji,
        });
    }

    function addReactionBadge(msgEl, emoji, from) {
        let reactionsDiv = msgEl.querySelector('.chat-reactions');
        if (!reactionsDiv) {
            reactionsDiv = document.createElement('div');
            reactionsDiv.className = 'chat-reactions';
            msgEl.appendChild(reactionsDiv);
        }

        let badge = reactionsDiv.querySelector(`[data-emoji="${emoji}"]`);
        if (badge) {
            const count = parseInt(badge.textContent.replace(emoji, '').trim()) || 1;
            badge.textContent = `${emoji} ${count + 1}`;
        } else {
            badge = document.createElement('button');
            badge.type = 'button';
            badge.className = 'chat-reaction';
            badge.dataset.emoji = emoji;
            badge.textContent = `${emoji} 1`;
            badge.addEventListener('click', () => toggleReaction(msgEl.dataset.id, emoji));
            reactionsDiv.appendChild(badge);
        }
    }

    // ==================== File Sharing ====================
    function handleFileShare(frame) {
        const convId = frame.conversation_id || activeConvId || 'default';
        if (!conversations.has(convId)) conversations.set(convId, { messages: [], unread: 0 });

        const msg = {
            id: frame.file_id || Date.now(),
            from: frame.from,
            from_name: frame.from_name || frame.from,
            text: '',
            timestamp: frame.timestamp || Date.now(),
            conversation_id: convId,
            file: {
                id: frame.file_id,
                name: frame.file_name_encrypted || 'file',
                size: frame.file_size || 0,
                url: frame.file_url || `/api/chat/files/${frame.file_id}`,
            },
        };

        conversations.get(convId).messages.push(msg);
        if (convId === activeConvId) {
            appendMessageDom(msg);
            scrollToBottom();
        }
    }

    // ==================== Search ====================
    let searchDebounce = null;

    async function searchMessages(query) {
        if (!query || query.length < 2) {
            dom.searchResults.style.display = 'none';
            return;
        }
        dom.searchResults.style.display = 'block';
        dom.searchResults.innerHTML = `<p class="state">${Utils.escapeHtml(_('chat.searching'))}</p>`;
        try {
            const resp = await fetch(`/api/chat/search?q=${encodeURIComponent(query)}&conversation_id=${encodeURIComponent(activeConvId || '')}`);
            if (!resp.ok) throw new Error(resp.statusText || String(resp.status));
            const data = await resp.json();
            const msgs = data.messages || [];

            if (msgs.length === 0) {
                dom.searchResults.innerHTML = `<p class="state chat-search-no-results">${Utils.escapeHtml(_('chat.no_results'))}</p>`;
                return;
            }

            dom.searchResults.innerHTML = `<ul class="list">${msgs.map(m => `
                <li><button type="button" class="list-row chat-search-result" data-conv="${Utils.escapeHtml(m.conversation_id)}" data-id="${Utils.escapeHtml(String(m.id ?? ''))}">
                    <span class="row-main">
                        <span class="row-title chat-search-from">${Utils.escapeHtml(m.from_name || m.from_id)}</span>
                        <span class="row-sub chat-search-text">${Utils.escapeHtml((m.text || '').slice(0, 120))}</span>
                    </span>
                    <span class="row-end chat-search-time">${formatTime(m.created_at || m.timestamp)}</span>
                </button></li>
            `).join('')}</ul>`;

            dom.searchResults.querySelectorAll('.chat-search-result').forEach(el => {
                el.addEventListener('click', () => {
                    const conv = el.dataset.conv;
                    openConversation(conv, conv.startsWith('group') ? 'group' : 'contact');
                    closeSearch();
                });
            });
        } catch (e) {
            dom.searchResults.innerHTML = `<p class="state is-error">${Utils.escapeHtml(_('chat.search_failed'))}
                <button type="button" class="btn btn-sm" data-search-retry>${Utils.escapeHtml(_('actions.retry'))}</button></p>`;
            const retry = dom.searchResults.querySelector('[data-search-retry]');
            if (retry) retry.addEventListener('click', () => searchMessages(dom.searchInput.value));
        }
    }

    function closeSearch() {
        dom.searchBar.style.display = 'none';
        dom.searchResults.style.display = 'none';
        dom.searchInput.value = '';
        if (dom.searchToggle) dom.searchToggle.setAttribute('aria-expanded', 'false');
    }

    // ==================== Push Notifications ====================
    function showNotification(msg) {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'default') {
            Notification.requestPermission();
            return;
        }
        if (Notification.permission !== 'granted') return;
        if (document.hasFocus()) return; // Don't notify if page is focused

        const name = msg.from_name || msg.from || 'Unknown';
        const body = msg.text ? msg.text.slice(0, 100) : _('chat.file_share');

        const notification = new Notification(`${name} — ${_('chat.new_message')}`, {
            body,
            icon: '/branding/favicon.svg',
            tag: `chat-${msg.conversation_id}`,
            requireInteraction: false,
        });

        notification.onclick = () => {
            window.focus();
            openConversation(msg.conversation_id, 'contact');
            notification.close();
        };

        setTimeout(() => notification.close(), 8000);
    }

    // ==================== Presence ====================
    function sendPresence(status) {
        myPresence = status;
        send({ type: 'presence_update', online: status !== 'offline', status: status });
        if (dom.presenceDot) {
            dom.presenceDot.className = `chat-presence-dot presence-${status}`;
        }
    }

    // ==================== Group Creation ====================
    function showCreateGroupModal() {
        if (typeof Modal === 'undefined') return;
        const people = contacts.filter(c => c.role === 'operator');
        const devices = contacts.filter(c => c.role !== 'operator');
        const option = (c) => `
            <li><label class="checkbox-row chat-member-option">
                <input type="checkbox" value="${Utils.escapeHtml(c.id)}">
                <span>${Utils.escapeHtml(c.name || c.id)}</span>
            </label></li>`;
        const block = (title, list) => list.length ? `
            <fieldset class="chat-member-group">
                <legend>${Utils.escapeHtml(title)}</legend>
                <ul class="chat-member-list">${list.map(option).join('')}</ul>
            </fieldset>` : '';

        Modal.show({
            title: _('chat.create_group'),
            content: `
                <div class="form-group">
                    <label class="form-label" for="chat-group-name-input">${Utils.escapeHtml(_('chat.group_name'))}</label>
                    <input type="text" class="form-input" id="chat-group-name-input" maxlength="64">
                </div>
                <div class="form-group">
                    <span class="form-label" id="chat-member-select-label">${Utils.escapeHtml(_('chat.group_members'))}</span>
                    <p class="form-hint">${Utils.escapeHtml(_('chat.group_members_hint'))}</p>
                    <div class="chat-member-select" id="chat-member-select" role="group" aria-labelledby="chat-member-select-label">
                        ${contacts.length
                            ? block(_('chat.role_operators'), people) + block(_('chat.role_devices'), devices)
                            : `<p class="state">${Utils.escapeHtml(_('chat.no_contacts'))}</p>`}
                    </div>
                </div>
                <p class="form-status is-error" id="chat-group-status" aria-live="polite"></p>`,
            buttons: [
                { label: _('actions.cancel'), class: '', onClick: () => Modal.close() },
                { label: _('chat.create_group'), class: 'btn-primary', onClick: createGroup },
            ],
        });
    }

    function createGroup() {
        const nameInput = document.getElementById('chat-group-name-input');
        const memberSelect = document.getElementById('chat-member-select');
        const status = document.getElementById('chat-group-status');
        if (!nameInput || !memberSelect) return;

        const name = (nameInput.value || '').trim();
        if (!name) {
            status.textContent = _('chat.group_name_required');
            nameInput.focus();
            return;
        }

        const memberIds = [];
        memberSelect.querySelectorAll('input:checked').forEach(cb => memberIds.push(cb.value));
        if (memberIds.length === 0) {
            status.textContent = _('chat.group_members_required');
            return;
        }
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            status.textContent = _('chat.send_failed');
            return;
        }

        // The console lists groups that include "panel", so the group is
        // always created with the console as a member.
        if (!memberIds.includes('panel')) memberIds.unshift('panel');

        send({ type: 'create_group', name, member_ids: memberIds });
        Modal.close();
    }

    // ==================== Helpers ====================
    function formatTime(ts) {
        if (!ts) return '';
        const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function formatDate(ts) {
        if (!ts) return '';
        const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
        const today = new Date();
        if (d.toDateString() === today.toDateString()) return _('chat.today') || 'Today';
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return _('chat.yesterday') || 'Yesterday';
        return d.toLocaleDateString();
    }

    function formatFileSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function linkify(text) {
        return text.replace(/(https?:\/\/[^\s<>"']+)/gi, (rawUrl) => {
            try {
                const parsed = new URL(rawUrl);
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                    return Utils.escapeHtml(rawUrl);
                }
                const safeHref = Utils.escapeHtml(parsed.href);
                const safeLabel = Utils.escapeHtml(rawUrl);
                return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
            } catch (_) {
                return Utils.escapeHtml(rawUrl);
            }
        });
    }

    function updateUnreadBadge(convId, count) {
        // The lists are re-rendered, which writes the "{count} new" text
        renderContacts();
        renderGroups();
    }

    function updateConnectionStatus(connected) {
        // Could add a status indicator to the header
    }

    function autoResizeInput() {
        if (!dom.input) return;
        dom.input.style.height = 'auto';
        dom.input.style.height = Math.min(dom.input.scrollHeight, 120) + 'px';
    }

    function showTab(target) {
        $$('.chat-tab').forEach(t => {
            const on = t.dataset.tab === target;
            t.classList.toggle('active', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
            t.tabIndex = on ? 0 : -1;
        });
        $$('[data-tab-content]').forEach(panel => {
            panel.style.display = panel.dataset.tabContent === target ? '' : 'none';
        });
    }

    // ==================== Event Binding ====================
    function bindEvents() {
        // Send message
        dom.sendBtn.addEventListener('click', sendMessage);
        dom.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            } else {
                sendTyping();
            }
        });
        dom.input.addEventListener('input', autoResizeInput);

        // Tab switching (arrow keys move between the two tabs)
        $$('.chat-tab').forEach(tab => {
            tab.addEventListener('click', () => showTab(tab.dataset.tab));
            tab.addEventListener('keydown', (e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                const tabs = [...$$('.chat-tab')];
                const next = tabs[(tabs.indexOf(tab) + 1) % tabs.length];
                showTab(next.dataset.tab);
                next.focus();
            });
        });

        // Opening a conversation from either list
        [dom.contactsList, dom.groupsList].forEach(list => {
            if (!list) return;
            list.addEventListener('click', (e) => {
                const row = e.target.closest('.chat-list-item');
                if (row) openConversation(row.dataset.id, row.dataset.type === 'group' ? 'group' : 'contact');
            });
        });

        // Back to the list (shown on narrow screens, where only one pane fits)
        $('#chat-back-btn').addEventListener('click', () => {
            const wasActive = activeConvId;
            dom.conversation.style.display = 'none';
            dom.emptyState.style.display = '';
            activeConvId = null;
            if (dom.split) dom.split.classList.remove('is-detail-open');
            $$('.chat-list-item').forEach(el => {
                el.classList.remove('active');
                el.removeAttribute('aria-current');
            });
            const row = wasActive && document.querySelector(`.chat-list-item[data-id="${CSS.escape(wasActive)}"]`);
            if (row) row.focus();
        });

        // Search toggle
        $('#chat-search-toggle').addEventListener('click', () => {
            const visible = dom.searchBar.style.display !== 'none';
            if (visible) {
                closeSearch();
                return;
            }
            dom.searchBar.style.display = '';
            dom.searchResults.style.display = 'none';
            dom.searchToggle.setAttribute('aria-expanded', 'true');
            dom.searchInput.focus();
        });
        $('#chat-search-close').addEventListener('click', () => {
            closeSearch();
            dom.searchToggle.focus();
        });
        dom.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeSearch();
                dom.searchToggle.focus();
            }
        });
        dom.searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => searchMessages(dom.searchInput.value), 300);
        });

        // File attach
        $('#chat-attach-btn').addEventListener('click', () => dom.fileInput.click());
        dom.fileInput.addEventListener('change', () => {
            const file = dom.fileInput.files[0];
            if (!file) return;
            if (file.size > 50 * 1024 * 1024) {
                if (typeof Notifications !== 'undefined') Notifications.error(_('chat.file_too_large'));
                return;
            }
            pendingFile = file;
            dom.fileName.textContent = file.name;
            dom.fileSize.textContent = formatFileSize(file.size);
            dom.filePreview.style.display = 'flex';
        });
        $('#chat-file-remove').addEventListener('click', () => {
            pendingFile = null;
            dom.filePreview.style.display = 'none';
            dom.fileInput.value = '';
        });

        // Emoji picker
        $('#chat-emoji-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (dom.emojiPicker.style.display === 'flex') {
                closeEmojiPicker(true);
                return;
            }
            openEmojiPicker(e.currentTarget, (emoji) => {
                dom.input.value += emoji;
                dom.input.focus();
            }, true);
        });

        // Presence selector
        dom.presenceSelect.addEventListener('change', () => {
            sendPresence(dom.presenceSelect.value);
        });

        // New group
        $('#chat-new-group-btn').addEventListener('click', showCreateGroupModal);

        // Request notification permission
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    // ==================== Init ====================
    function init() {
        initDom();
        bindEvents();
        connect();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
