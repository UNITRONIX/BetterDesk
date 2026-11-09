/**
 * BetterDesk Console - i18n Middleware
 * Picks the request's language and gives it req.t()
 */

const { manager } = require('../services/i18nService');
const config = require('../config/config');

/**
 * Parse Accept-Language header
 */
function parseAcceptLanguage(header) {
    if (!header) return null;
    
    const languages = header.split(',')
        .map(lang => {
            const parts = lang.trim().split(';');
            const rawCode = parts[0].trim();
            const code = rawCode.split('-')[0]; // Get primary language code
            const q = parts[1] ? parseFloat(parts[1].split('=')[1]) : 1;
            return { rawCode, code, q };
        })
        .sort((a, b) => b.q - a.q);
    
    // Find first supported language
    for (const { rawCode, code } of languages) {
        if (manager.hasLanguage(rawCode)) {
            return rawCode;
        }
        if (manager.hasLanguage(code)) {
            return code;
        }
    }
    
    return null;
}

/**
 * i18n middleware
 * Detects the language and sets req.lang and req.t
 */
function i18nMiddleware(req, res, next) {
    // Language detection priority:
    // 1. URL query param ?lang=xx
    // 2. Authenticated user preference
    // 3. Cookie betterdesk_lang
    // 4. Accept-Language header
    // 5. Default language
    
    let lang = req.query.lang
        || req.session?.user?.preferred_language
        || req.cookies?.betterdesk_lang
        || parseAcceptLanguage(req.headers['accept-language'])
        || config.defaultLanguage;
    
    // Validate language exists
    if (!manager.hasLanguage(lang)) {
        lang = config.defaultLanguage;
    }
    
    // Set language cookie if from query param
    if (req.query.lang && manager.hasLanguage(req.query.lang)) {
        res.cookie('betterdesk_lang', req.query.lang, {
            maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
            httpOnly: false,
            sameSite: 'lax'
        });
    }
    
    // The language and translation function for the request (answers, emails, logs)
    req.lang = lang;
    req.t = (key, vars) => manager.translate(lang, key, vars);
    
    next();
}

/**
 * Initialize i18n system
 */
function initI18n() {
    manager.init();
    return i18nMiddleware;
}

module.exports = {
    i18nMiddleware,
    initI18n
};
