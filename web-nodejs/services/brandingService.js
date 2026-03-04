/**
 * BetterDesk Console - Branding Service
 * Manages white-label branding configuration (name, logo, colors, favicon)
 * Stored in auth.db branding_config table
 */

const db = require('./database');

// Dangerous SVG elements that can execute scripts
const SVG_DANGEROUS_TAGS = /<\s*(script|foreignobject|iframe|embed|object|applet|animate|set)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const SVG_DANGEROUS_TAGS_SELFCLOSING = /<\s*(script|foreignobject|iframe|embed|object|applet)[^>]*\/>/gi;

// Dangerous attributes that can execute JavaScript
const SVG_DANGEROUS_ATTRS = /\s(on\w+|xlink:href\s*=\s*["']javascript:)[^>]*/gi;
const SVG_JAVASCRIPT_HREF = /\bhref\s*=\s*["']javascript:[^"']*/gi;

/**
 * Sanitize SVG content to prevent XSS attacks.
 * Removes script tags, event handlers, and javascript: URLs.
 * @param {string} svg - Raw SVG string
 * @returns {string} - Sanitized SVG string
 */
function sanitizeSvg(svg) {
    if (!svg || typeof svg !== 'string') return '';
    
    let sanitized = svg;
    
    // Remove dangerous elements (script, foreignObject, iframe, etc.)
    sanitized = sanitized.replace(SVG_DANGEROUS_TAGS, '');
    sanitized = sanitized.replace(SVG_DANGEROUS_TAGS_SELFCLOSING, '');
    
    // Remove event handler attributes (onclick, onload, etc.)
    sanitized = sanitized.replace(SVG_DANGEROUS_ATTRS, '');
    
    // Remove javascript: URLs in href
    sanitized = sanitized.replace(SVG_JAVASCRIPT_HREF, ' href="');
    
    return sanitized;
}

// Default branding (BetterDesk original theme)
const DEFAULT_BRANDING = {
    // Brand identity
    appName: 'BetterDesk',
    appDescription: 'RustDesk Server Management',
    
    // Logo configuration
    logoType: 'image', // 'icon' | 'svg' | 'image'
    logoIcon: 'dns',   // Material Icons name (when logoType === 'icon')
    logoSvg: '',       // Raw SVG markup or SVG path data (when logoType === 'svg')
    logoUrl: '/img/betterdesk_icon.png', // URL to image file (when logoType === 'image')
    
    // Favicon (SVG)
    faviconSvg: '',   // Custom favicon SVG (empty = default)
    
    // Color scheme overrides (empty = use defaults from variables.css)
    colors: {
        bgPrimary: '',
        bgSecondary: '',
        bgTertiary: '',
        bgElevated: '',
        textPrimary: '',
        textSecondary: '',
        accentBlue: '',
        accentBlueHover: '',
        accentBlueMuted: '',
        accentGreen: '',
        accentGreenHover: '',
        accentGreenMuted: '',
        accentRed: '',
        accentRedHover: '',
        accentRedMuted: '',
        accentYellow: '',
        accentYellowHover: '',
        accentYellowMuted: '',
        accentPurple: '',
        accentPurpleHover: '',
        accentPurpleMuted: '',
        borderPrimary: '',
        borderSecondary: ''
    }
};

// CSS variable name mapping
const COLOR_TO_CSS_VAR = {
    bgPrimary: '--bg-primary',
    bgSecondary: '--bg-secondary',
    bgTertiary: '--bg-tertiary',
    bgElevated: '--bg-elevated',
    textPrimary: '--text-primary',
    textSecondary: '--text-secondary',
    accentBlue: '--accent-blue',
    accentBlueHover: '--accent-blue-hover',
    accentBlueMuted: '--accent-blue-muted',
    accentGreen: '--accent-green',
    accentGreenHover: '--accent-green-hover',
    accentGreenMuted: '--accent-green-muted',
    accentRed: '--accent-red',
    accentRedHover: '--accent-red-hover',
    accentRedMuted: '--accent-red-muted',
    accentYellow: '--accent-yellow',
    accentYellowHover: '--accent-yellow-hover',
    accentYellowMuted: '--accent-yellow-muted',
    accentPurple: '--accent-purple',
    accentPurpleHover: '--accent-purple-hover',
    accentPurpleMuted: '--accent-purple-muted',
    borderPrimary: '--border-primary',
    borderSecondary: '--border-secondary'
};

// In-memory cache
let brandingCache = null;

/**
 * Load branding configuration from database into cache (async).
 * Must be called once at startup before any request is served.
 * @returns {Promise<Object>} Merged branding config
 */
async function loadBranding() {
    try {
        const rows = await db.getBrandingConfig();

        // Start with defaults
        const branding = JSON.parse(JSON.stringify(DEFAULT_BRANDING));

        for (const row of rows) {
            if (row.key === 'colors') {
                try {
                    const savedColors = JSON.parse(row.value);
                    Object.assign(branding.colors, savedColors);
                } catch (e) {
                    // Ignore invalid JSON
                }
            } else if (row.key in branding) {
                branding[row.key] = row.value;
            }
        }

        brandingCache = branding;
        return branding;
    } catch (err) {
        console.error('[Branding] Failed to load from DB, using defaults:', err.message);
        brandingCache = JSON.parse(JSON.stringify(DEFAULT_BRANDING));
        return brandingCache;
    }
}

/**
 * Get branding configuration (synchronous, from cache).
 * Returns defaults if cache has not been warmed yet.
 * @returns {Object} Merged branding config (defaults + overrides)
 */
function getBranding() {
    if (brandingCache) return brandingCache;
    // Cache not yet loaded — return defaults (startup race condition safety)
    return JSON.parse(JSON.stringify(DEFAULT_BRANDING));
}

/**
 * Save branding configuration (async — uses database adapter)
 * @param {Object} updates - Partial branding config to save
 */
async function saveBranding(updates) {
    const entries = [];
    for (const [key, value] of Object.entries(updates)) {
        if (key === 'colors') {
            entries.push({ key, value: JSON.stringify(value) });
        } else if (key in DEFAULT_BRANDING) {
            // Security: Sanitize SVG content to prevent XSS
            if (key === 'logoSvg' || key === 'faviconSvg') {
                entries.push({ key, value: sanitizeSvg(String(value)) });
            } else {
                entries.push({ key, value: String(value) });
            }
        }
    }

    if (entries.length > 0) {
        await db.saveBrandingConfigBatch(entries);
    }

    // Reload cache from DB
    await loadBranding();
}

/**
 * Reset branding to defaults (async — uses database adapter)
 */
async function resetBranding() {
    await db.resetBrandingConfig();

    // Clear cache — next getBranding() will return defaults
    brandingCache = null;
}

/**
 * Generate CSS :root overrides from branding colors
 * @returns {string} CSS string with :root variable overrides
 */
function generateThemeCss() {
    const branding = getBranding();
    const overrides = [];
    
    for (const [key, cssVar] of Object.entries(COLOR_TO_CSS_VAR)) {
        const value = branding.colors[key];
        if (value && value.trim()) {
            // For muted colors, auto-generate rgba if a hex color is provided
            if (key.endsWith('Muted') && value.startsWith('#')) {
                const hex = value.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                overrides.push(`    ${cssVar}: rgba(${r}, ${g}, ${b}, 0.15);`);
            } else {
                overrides.push(`    ${cssVar}: ${value};`);
            }
        }
    }
    
    if (overrides.length === 0) return '';
    
    return `:root {\n${overrides.join('\n')}\n}\n`;
}

/**
 * Generate favicon SVG from branding
 * @returns {string} SVG markup for favicon
 */
function generateFavicon() {
    const branding = getBranding();
    
    // If custom favicon SVG is set, use it
    if (branding.faviconSvg && branding.faviconSvg.trim()) {
        return branding.faviconSvg;
    }
    
    // Generate from branding colors (use accent color or default blue)
    const bgColor = branding.colors.bgPrimary || '#0d1117';
    const accentColor = branding.colors.accentBlue || '#58a6ff';
    const greenColor = branding.colors.accentGreen || '#2ea44f';
    
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="6" fill="${bgColor}"/>
  <path d="M8 10h16M8 16h16M8 22h12" stroke="${accentColor}" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="24" cy="22" r="3" fill="${greenColor}"/>
</svg>`;
}

/**
 * Export a branding preset as JSON (for import/export)
 * @returns {Object} Full branding config for export
 */
function exportPreset() {
    const branding = getBranding();
    return {
        version: '1.0',
        type: 'betterdesk-theme',
        branding
    };
}

/**
 * Import a branding preset from JSON
 * @param {Object} preset - Preset object with version + branding fields
 * @returns {boolean} Success
 */
async function importPreset(preset) {
    if (!preset || preset.type !== 'betterdesk-theme' || !preset.branding) {
        return false;
    }
    
    // Validate and sanitize
    const allowed = Object.keys(DEFAULT_BRANDING);
    const sanitized = {};
    
    for (const key of allowed) {
        if (key in preset.branding) {
            if (key === 'colors') {
                const allowedColors = Object.keys(DEFAULT_BRANDING.colors);
                const colors = {};
                for (const ck of allowedColors) {
                    if (ck in preset.branding.colors) {
                        colors[ck] = String(preset.branding.colors[ck]).substring(0, 100);
                    }
                }
                sanitized.colors = colors;
            } else {
                // Limit string length for safety
                sanitized[key] = String(preset.branding[key]).substring(0, key === 'logoSvg' || key === 'faviconSvg' ? 50000 : 500);
            }
        }
    }
    
    await saveBranding(sanitized);
    return true;
}

/**
 * Invalidate the branding cache (call after DB changes)
 */
function invalidateCache() {
    brandingCache = null;
}

module.exports = {
    DEFAULT_BRANDING,
    COLOR_TO_CSS_VAR,
    loadBranding,
    getBranding,
    saveBranding,
    resetBranding,
    generateThemeCss,
    generateFavicon,
    exportPreset,
    importPreset,
    invalidateCache
};
