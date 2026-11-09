/**
 * BetterDesk Console — Chat Routes
 * API endpoints for Chat 2.0. The chat page (/chat) is in the console
 * (web-ui).
 */

'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { requireAuth, requirePermission } = require('../middleware/auth');

// The chat WebSocket needs chat.access; its HTTP routes need the same
const chatAccess = requirePermission('chat.access');

// File upload config — max 50MB, store in data/chat-files/
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'chat-files');
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
        filename: (_req, file, cb) => {
            const id = crypto.randomBytes(16).toString('hex');
            const ext = path.extname(file.originalname).slice(0, 10);
            cb(null, `${id}${ext}`);
        },
    }),
    limits: { fileSize: MAX_FILE_SIZE },
});

// ========== API Routes ==========

// Upload encrypted file
router.post('/api/chat/upload', requireAuth, chatAccess, upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file provided' });
    }
    const fileId = path.basename(req.file.filename, path.extname(req.file.filename));
    res.json({
        success: true,
        file_id: fileId,
        filename: req.file.filename,
        size: req.file.size,
        url: `/api/chat/files/${fileId}`,
    });
});

// Download file
router.get('/api/chat/files/:fileId', requireAuth, chatAccess, (req, res) => {
    // Upload ids are 16 random bytes in hex; only a whole id finds its file
    // (a prefix used to match, so a short id walked the uploads)
    const fileId = String(req.params.fileId).toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(fileId)) return res.status(400).json({ success: false, error: 'Invalid file ID' });

    const files = fs.readdirSync(UPLOAD_DIR).filter(f => f === fileId || f.startsWith(fileId + '.'));
    if (files.length === 0) {
        return res.status(404).json({ success: false, error: 'File not found' });
    }
    const filePath = path.join(UPLOAD_DIR, files[0]);
    // Verify path traversal protection
    if (!filePath.startsWith(UPLOAD_DIR)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    res.download(filePath);
});

// Search messages via Go server proxy
router.get('/api/chat/search', requireAuth, chatAccess, async (req, res) => {
    try {
        const { apiClient } = require('../services/betterdeskApi');
        const query = String(req.query.q || '').slice(0, 200);
        const conversationId = req.query.conversation_id || '';
        if (!query) return res.json({ success: true, messages: [] });

        const resp = await apiClient.get('/api/chat/search', {
            params: { q: query, conversation_id: conversationId, limit: 50 },
        });
        res.json({ success: true, messages: resp.data?.messages || [] });
    } catch (e) {
        res.json({ success: true, messages: [] });
    }
});

module.exports = router;
