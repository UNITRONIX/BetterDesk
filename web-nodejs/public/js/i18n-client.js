/**
 * BetterDesk Console - Client-side i18n
 */

(function() {
    'use strict';
    
    const translations = window.BetterDesk?.translations || {};
    const currentLang = window.BetterDesk?.lang || 'en';
    const availableLanguages = Array.isArray(window.BetterDesk?.availableLanguages)
        ? window.BetterDesk.availableLanguages
        : [];
    const availableLanguageCodes = new Set(availableLanguages.map(lang => lang.code));

    function hasCookieLanguage() {
        return document.cookie.split(';').some(part => part.trim().startsWith('betterdesk_lang='));
    }

    function isSupportedLanguage(langCode) {
        return typeof langCode === 'string' && availableLanguageCodes.has(langCode);
    }

    try {
        const savedLang = localStorage.getItem('betterdesk_lang');
        const accountLang = window.BetterDesk?.user?.preferred_language;
        if (savedLang && savedLang !== currentLang && isSupportedLanguage(savedLang) && !hasCookieLanguage() && !accountLang) {
            window.__betterdeskPendingLanguageRestore = savedLang;
        } else if (currentLang) {
            localStorage.setItem('betterdesk_lang', currentLang);
        }
    } catch (_) { /* localStorage may be disabled */ }
    
    /**
     * Get translation by key with optional interpolation
     * @param {string} key - Translation key (e.g., 'nav.dashboard')
     * @param {Object} params - Parameters for interpolation
     * @returns {string} Translated string or key if not found
     */
    function translate(key, params = {}) {
        // Get nested value by dot notation
        const keys = key.split('.');
        let value = translations;
        
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                // Key not found, return the key itself
                return key;
            }
        }
        
        if (typeof value !== 'string') {
            return key;
        }
        
        // Interpolate parameters: {param} → value
        return value.replace(/\{(\w+)\}/g, (match, param) => {
            return params[param] !== undefined ? params[param] : match;
        });
    }
    
    /**
     * Alias for translate
     */
    window._ = translate;
    window.t = translate;
    // Legacy double-underscore alias used by some page scripts (e.g. settings clock).
    window.__ = translate;
    
    /**
     * Get current language code
     */
    window.getCurrentLang = function() {
        return currentLang;
    };
    
    /**
     * Change language by reloading with new lang parameter
     */
    window.changeLanguage = async function(langCode) {
        try {
            if (!isSupportedLanguage(langCode)) {
                throw new Error('Unsupported language');
            }

            try { localStorage.setItem('betterdesk_lang', langCode); } catch (_) {}

            // Set language preference via API
            await Utils.api(`/api/i18n/set/${langCode}`, { method: 'POST' });
            
            // Reload the page to apply
            window.location.reload();
        } catch (error) {
            console.error('Failed to change language:', error);
            if (window.Notifications?.error) {
                Notifications.error(_('errors.language_change_failed'));
            }
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-language-select]').forEach(select => {
            select.addEventListener('change', () => {
                if (select.value) {
                    window.changeLanguage(select.value);
                }
            });
        });
    });

    if (window.__betterdeskPendingLanguageRestore) {
        const langToRestore = window.__betterdeskPendingLanguageRestore;
        delete window.__betterdeskPendingLanguageRestore;
        window.changeLanguage(langToRestore);
    }
    
    /**
     * Pluralization helper
     * @param {number} count - Number to check
     * @param {Object} forms - { one: '1 item', other: '{count} items' }
     */
    window.plural = function(count, forms) {
        const form = count === 1 ? 'one' : 'other';
        const template = forms[form] || forms.other || '';
        return template.replace('{count}', count);
    };
    
})();
