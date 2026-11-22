/**
 * BetterDesk Console - Utility Functions
 */

const Utils = {
    /**
     * Format date to locale string
     */
    formatDate(dateStr, options = {}) {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '-';
        
        const defaultOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };
        
        return date.toLocaleDateString(window.BetterDesk.lang, { ...defaultOptions, ...options });
    },
    
    /**
     * Format relative time (e.g., "5 minutes ago")
     */
    formatRelativeTime(dateStr) {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '-';
        
        const now = new Date();
        const diff = now - date;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (seconds < 60) return _('time.just_now');
        if (minutes < 60) return _('time.minutes_ago', { count: minutes });
        if (hours < 24) return _('time.hours_ago', { count: hours });
        if (days < 7) return _('time.days_ago', { count: days });
        
        return Utils.formatDate(dateStr);
    },
    
    /**
     * Debounce function
     */
    debounce(fn, delay = 300) {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn.apply(this, args), delay);
        };
    },
    
    /**
     * Throttle function
     */
    throttle(fn, limit = 300) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                fn.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },
    
    /**
     * Copy text to clipboard
     */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                return true;
            } finally {
                document.body.removeChild(textarea);
            }
        }
    },
    
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    /**
     * Sanitize color value to prevent XSS
     * Only allows valid hex colors (#RGB, #RRGGBB) and named colors
     */
    sanitizeColor(color) {
        if (!color || typeof color !== 'string') return '#808080';
        // Allow hex colors
        if (/^#[0-9A-Fa-f]{3}$/.test(color) || /^#[0-9A-Fa-f]{6}$/.test(color)) {
            return color;
        }
        // Allow safe named colors
        const safeColors = ['red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 
                           'cyan', 'magenta', 'brown', 'gray', 'grey', 'black', 'white',
                           'lime', 'teal', 'navy', 'maroon', 'olive', 'aqua', 'silver'];
        if (safeColors.includes(color.toLowerCase())) {
            return color;
        }
        return '#808080'; // Default gray
    },
    
    /**
     * Parse URL query parameters
     */
    getQueryParams() {
        return Object.fromEntries(new URLSearchParams(window.location.search));
    },
    
    /**
     * Update URL query parameter without reload
     */
    setQueryParam(key, value) {
        const url = new URL(window.location);
        if (value === null || value === undefined) {
            url.searchParams.delete(key);
        } else {
            url.searchParams.set(key, value);
        }
        window.history.replaceState({}, '', url);
    },
    
    /**
     * Generate a simple unique ID (using crypto.randomUUID when available)
     */
    generateId() {
        if (window.crypto && window.crypto.randomUUID) {
            return 'id-' + crypto.randomUUID().split('-')[0];
        }
        // Fallback for older browsers
        return 'id-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    },
    
    /**
     * Check if element is in viewport
     */
    isInViewport(element) {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.right <= window.innerWidth
        );
    },
    
    /**
     * Sleep/delay function
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
    
    /**
     * Restrict client-side fetch targets to same-origin relative API paths.
     */
    resolveApiEndpoint(endpoint) {
        if (typeof endpoint !== 'string') {
            throw new Error('Invalid API endpoint');
        }
        const trimmed = endpoint.trim();
        if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
            throw new Error('Invalid API endpoint');
        }
        if (/[\0\\]/.test(trimmed)) {
            throw new Error('Invalid API endpoint');
        }
        const parsed = new URL(trimmed, window.location.origin);
        if (parsed.origin !== window.location.origin) {
            throw new Error('Invalid API endpoint');
        }
        return parsed.pathname + parsed.search;
    },

    /**
     * API request helper with error handling
     */
    async api(endpoint, options = {}) {
        const safeEndpoint = Utils.resolveApiEndpoint(endpoint);
        const defaults = {
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        };
        
        // Add CSRF token if available
        if (window.BetterDesk.csrfToken) {
            defaults.headers['X-CSRF-Token'] = window.BetterDesk.csrfToken;
        }
        
        const config = {
            ...defaults,
            ...options,
            headers: { ...defaults.headers, ...options.headers }
        };
        
        // Don't send body for GET/HEAD requests
        if (['GET', 'HEAD'].includes(config.method?.toUpperCase())) {
            delete config.body;
        } else if (config.body && typeof config.body === 'object') {
            config.body = JSON.stringify(config.body);
        }
        
        try {
            const response = await fetch(safeEndpoint, config);
            const contentType = response.headers.get('content-type');
            
            let data;
            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                data = await response.text();
            }
            
            if (!response.ok) {
                let message = (data && typeof data === 'object')
                    ? (data.error || data.message)
                    : null;
                // Reverse proxies often return HTML 502/504 with no JSON body (#464).
                if (!message) {
                    if (response.status === 502 || response.status === 504) {
                        message = 'Gateway/proxy timeout — the request may still be running on the server. Check update status or raise proxy_read_timeout (≥600s).';
                    } else if (typeof data === 'string' && /<(html|head|body|title)/i.test(data)) {
                        message = `Request failed (HTTP ${response.status}) — gateway returned HTML instead of JSON. The server operation may still be running.`;
                    } else {
                        message = `Request failed (HTTP ${response.status})`;
                    }
                }
                const error = new Error(message);
                error.status = response.status;
                error.data = data;
                error.gatewayTimeout = response.status === 502 || response.status === 504
                    || (typeof data === 'string' && /<(html|head|body|title)/i.test(data));
                throw error;
            }
            
            // Automatically extract data field from standard API responses
            // API format: { success: true, data: { ... } }
            if (data && typeof data === 'object' && data.success === true && data.data !== undefined) {
                return data.data;
            }
            
            return data;
        } catch (error) {
            if (error.status === 401) {
                var path = window.location.pathname || '';
                var code = error.data && error.data.code;
                if (typeof window.BetterDeskSession !== 'undefined' && window.BetterDeskSession.broadcastExpired) {
                    window.BetterDeskSession.broadcastExpired(code || 'session_expired');
                }
                if (path.startsWith('/remote') && !path.startsWith('/remote/login')) {
                    window.location.href = '/remote/login?return=' +
                        encodeURIComponent(path + (window.location.search || '')) + '&expired=1';
                } else if (!path.startsWith('/login')) {
                    window.location.href = '/login?expired=1';
                }
            }
            throw error;
        }
    },
    
    /**
     * Normalize a device platform/os string into a UX36 OS kind.
     * @returns {'windows'|'android'|'linux'|'apple'|'chrome'|''}
     */
    getPlatformKind(platform) {
        if (!platform) return '';
        const p = String(platform).toLowerCase();
        if (p.includes('windows') || p.includes('win32') || p.includes('win64')) return 'windows';
        if (p.includes('android')) return 'android';
        if (p.includes('chrome os') || p.includes('chromeos') || p.includes('chromium os')) return 'chrome';
        if (p.includes('mac') || p.includes('darwin') || p.includes('ios') || p.includes('iphone') || p.includes('ipad')) return 'apple';
        if (
            p.includes('linux') || p.includes('ubuntu') || p.includes('debian') ||
            p.includes('fedora') || p.includes('centos') || p.includes('redhat') ||
            p.includes('suse') || p.includes('arch') || p.includes('manjaro') ||
            p.includes('mint') || p.includes('rocky') || p.includes('alma')
        ) return 'linux';
        return '';
    },

    /**
     * Get Material Icons glyph for a platform (legacy callers).
     */
    getPlatformIcon(platform) {
        switch (this.getPlatformKind(platform)) {
            case 'windows': return 'laptop_windows';
            case 'apple': return 'laptop_mac';
            case 'linux': return 'terminal';
            case 'android': return 'android';
            case 'chrome': return 'laptop_chromebook';
            default: return 'devices';
        }
    },

    /**
     * Coloured OS mark used by UX 3.6 (.os-icon + --os-* tokens).
     * Safe SVG markup (no user-controlled path data).
     */
    getPlatformIconHtml(platform, options = {}) {
        const kind = this.getPlatformKind(platform);
        const size = Number(options.size) > 0 ? Number(options.size) : 16;
        const title = options.title != null ? String(options.title) : String(platform || '');
        const extraClass = options.className ? ` ${options.className}` : '';
        if (!kind) {
            return `<span class="os-icon os-icon-none material-icons${extraClass}" style="font-size:${size}px" aria-hidden="true">devices</span>`;
        }
        const paths = {
            // Four-pane Windows mark
            windows: '<path d="M3 3h8.2v8.2H3zm9.8 0H21v8.2h-8.2zM3 12.8H11.2V21H3zm9.8 0H21V21h-8.2z"/>',
            // Android robot (simplified)
            android: '<path d="M17.6 9.5l1.5-2.6a.6.6 0 10-1-.6l-1.6 2.7A7.4 7.4 0 0012 8c-1.6 0-3.1.5-4.4 1.3L6 6.3a.6.6 0 10-1 .6l1.5 2.6A7.3 7.3 0 004.5 15v.8h15V15c0-2.1-.9-4-2-5.5zM8.4 13.2a.9.9 0 110-1.8.9.9 0 010 1.8zm7.2 0a.9.9 0 110-1.8.9.9 0 010 1.8zM7.2 17.2h1.6V21H7.2zm8 0H16.8V21H15.2z"/>',
            // Tux-less Linux mark (circle + beak)
            linux: '<path d="M12 2.5c-2.4 0-4.4 2.4-4.4 5.4 0 1.5.5 2.8 1.3 3.7-.9.5-1.6 1.5-1.9 2.8-.4 1.7.1 3.3 1.3 4.1.6.4 1.3.6 2 .6.7 0 1.3-.3 1.7-.8.4.5 1 .8 1.7.8.7 0 1.4-.2 2-.6 1.2-.8 1.7-2.4 1.3-4.1-.3-1.3-1-2.3-1.9-2.8.8-.9 1.3-2.2 1.3-3.7C16.4 4.9 14.4 2.5 12 2.5zm-2.2 6.2a1 1 0 110-2 1 1 0 010 2zm4.4 0a1 1 0 110-2 1 1 0 010 2z"/>',
            // Apple logo (simplified)
            apple: '<path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.9-3.5.9-.7 0-1.9-.8-3.1-.8-1.6 0-3.1 1-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.1 1.7 2.4 3 2.3 1.2 0 1.6-.8 3.1-.8s1.8.8 3.1.8c1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.7zM14.2 5.8c.6-.8 1.1-1.9.9-3-.9 0-2 .6-2.6 1.4-.6.7-1.1 1.8-.9 2.9 1 .1 2-.5 2.6-1.3z"/>',
            // Chrome-ish circle mark
            chrome: '<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 3.5A6.5 6.5 0 0118 10H12a2.5 2.5 0 00-2.3 1.5L7.2 6.3A6.5 6.5 0 0112 5.5zM5.5 12c0-1.3.4-2.6 1-3.7L9.7 14A2.5 2.5 0 0012 15.5c.7 0 1.3-.3 1.8-.7l2.5 4.3A6.5 6.5 0 015.5 12zm9 0a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"/>'
        };
        const label = title ? ` title="${String(title).replace(/"/g, '&quot;')}"` : '';
        return `<svg class="os-icon os-${kind}${extraClass}" viewBox="0 0 24 24" width="${size}" height="${size}" focusable="false" aria-hidden="true"${label}>${paths[kind]}</svg>`;
    },

    /**
     * Localize audit action codes (login, branding_update, theme_toggle, …).
     */
    formatAuditAction(action, fallback) {
        const raw = String(action || '').trim();
        if (!raw) return fallback || '-';
        const key = 'audit.action_' + raw.replace(/[^a-z0-9_]/gi, '_');
        if (typeof _ === 'function') {
            const label = _(key);
            if (label && label !== key) return label;
        }
        return fallback || raw;
    }
};

// Export for modules or attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
} else {
    window.Utils = Utils;
}
