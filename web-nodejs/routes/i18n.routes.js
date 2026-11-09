/**
 * BetterDesk Console - i18n API Routes
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { manager, isValidLangCode } = require('../services/i18nService');
const { requireAuth, requirePermission } = require('../middleware/auth');
const db = require('../services/database');

// Configure multer for JSON file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 1024 * 1024 // 1MB max
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/json') {
            cb(null, true);
        } else {
            cb(new Error('Only JSON files allowed'), false);
        }
    }
});

/**
 * GET /languages - Languages list (available)
 */
router.get('/languages', (req, res) => {
    try {
        const languages = manager.getAvailable();
        res.json({
            success: true,
            data: languages,
            list: manager.getAvailableList()
        });
    } catch (err) {
        console.error('Get languages error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get languages'
        });
    }
});

/**
 * GET /translations/:code - Get translations for a language
 */
router.get('/translations/:code', (req, res) => {
    try {
        const { code } = req.params;
        if (!isValidLangCode(code)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid language code'
            });
        }

        const translations = manager.getMergedTranslations(code);
        
        if (!manager.hasLanguage(code)) {
            return res.status(404).json({
                success: false,
                error: 'Language not found'
            });
        }
        
        res.json({
            success: true,
            data: translations
        });
    } catch (err) {
        console.error('Get translations error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get translations'
        });
    }
});

/**
 * POST /set/:code - Set current language (cookie)
 */
router.post('/set/:code', (req, res) => {
    try {
        const { code } = req.params;
        
        if (!isValidLangCode(code) || !manager.hasLanguage(code)) {
            return res.status(400).json({
                success: false,
                error: 'Language not supported'
            });
        }
        
        res.cookie('betterdesk_lang', code, {
            maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
            httpOnly: false, // Intentionally accessible to JS for client-side i18n
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production' || process.env.HTTPS_ENABLED === 'true'
        });

        if (req.session?.userId && typeof db.updateUserLanguage === 'function') {
            db.updateUserLanguage(req.session.userId, code).catch(err => {
                console.warn(`[i18n] Failed to persist language for user ${req.session.userId}:`, err.message);
            });
            req.session.user = req.session.user || {};
            req.session.user.preferred_language = code;
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Set language error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to set language'
        });
    }
});

/**
 * GET /validate/:code - Validate a language file
 */
router.get('/validate/:code', requireAuth, (req, res) => {
    try {
        const { code } = req.params;
        const result = manager.validateLanguage(code);
        
        res.json({
            success: true,
            data: result
        });
    } catch (err) {
        console.error('Validate language error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to validate language'
        });
    }
});

/**
 * POST /upload - Upload a new language file
 */
router.post('/upload', requireAuth, requirePermission('server.config'), upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }
        
        const content = req.file.buffer.toString('utf8');
        let translations;
        
        try {
            translations = JSON.parse(content);
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: 'Invalid JSON file'
            });
        }
        
        // Get language code from _meta or filename
        const meta = translations._meta;
        const code = meta?.code || req.body.code || req.file.originalname.replace('.json', '');
        
        if (!code || code.length < 2 || code.length > 5) {
            return res.status(400).json({
                success: false,
                error: 'Invalid language code'
            });
        }
        
        const result = manager.saveLanguage(code, translations);
        
        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error
            });
        }
        
        // Log action
        await db.logAction(req.session.userId, 'language_uploaded', `Language ${code} uploaded`, req.ip);
        
        res.json({
            success: true,
            data: {
                code,
                meta: manager.getLanguageMeta(code)
            }
        });
    } catch (err) {
        console.error('Upload language error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to upload language'
        });
    }
});

/**
 * DELETE /:code - Delete a language
 */
router.delete('/:code', requireAuth, requirePermission('server.config'), async (req, res) => {
    try {
        const { code } = req.params;
        
        const result = manager.deleteLanguage(code);
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }
        
        // Log action
        await db.logAction(req.session.userId, 'language_deleted', `Language ${code} deleted`, req.ip);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Delete language error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to delete language'
        });
    }
});

module.exports = router;
