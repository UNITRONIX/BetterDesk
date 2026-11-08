/**
 * BetterDesk Console - Utility Functions
 */

const Utils = {
    /**
     * Turn an API timestamp into a Date, or null when there is no real date.
     * SQLite writes "2026-11-08 17:05:28" (UTC, no zone); those are read as
     * UTC, not as local time. Empty values, 0 and Go's zero time
     * ("0001-01-01T00:00:00Z") count as no date.
     */
    parseDate(value) {
        if (value === null || value === undefined || value === '' || value === 0) return null;
        let date;
        if (value instanceof Date) {
            date = value;
        } else if (typeof value === 'number') {
            date = new Date(value);
        } else {
            let text = String(value).trim();
            if (!text) return null;
            if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) {
                text = text.replace(' ', 'T') + 'Z';
            }
            date = new Date(text);
        }
        if (isNaN(date.getTime()) || date.getUTCFullYear() < 1971) return null;
        return date;
    },

    /** Console language for date formatting, falling back to the browser's */
    _dateLocale() {
        const lang = window.BetterDesk && window.BetterDesk.lang;
        if (!lang) return undefined;
        try {
            return Intl.DateTimeFormat.supportedLocalesOf([lang]).length ? lang : undefined;
        } catch (e) {
            return undefined;
        }
    },

    /**
     * Format date to locale string in the console language.
     * options.empty: text for a missing date (default "-").
     */
    formatDate(dateStr, options = {}) {
        const { empty = '-', ...formatOptions } = options || {};
        const date = Utils.parseDate(dateStr);
        if (!date) return empty;

        const defaultOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };

        return date.toLocaleString(Utils._dateLocale(), { ...defaultOptions, ...formatOptions });
    },

    /**
     * Format relative time (e.g., "5 minutes ago").
     * options.empty: text for a missing date (default "-").
     */
    formatRelativeTime(dateStr, options = {}) {
        const empty = options && options.empty !== undefined ? options.empty : '-';
        const date = Utils.parseDate(dateStr);
        if (!date) return empty;

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

        return Utils.formatDate(date);
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
    /**
     * Whether the signed-in user may do something (see BetterDesk.permissions
     * in the layout). Used to hide actions that would only fail; the server
     * still checks every request. Unknown on pages without the list: true.
     */
    can(permission) {
        const list = window.BetterDesk && window.BetterDesk.permissions;
        if (!Array.isArray(list)) return true;
        return list.includes(permission);
    },

    /** Plain sentence for a refused request (HTTP 403 from a permission check) */
    permissionDeniedMessage() {
        const key = 'errors.no_permission';
        const text = typeof _ === 'function' ? _(key) : '';
        return text && text !== key ? text : "You don't have permission to do this. Ask an administrator.";
    },

    /**
     * One icon per meaning, used in menus and on action buttons everywhere,
     * so the same action always looks the same (Material Symbols names).
     */
    ICONS: {
        connect: 'desktop_windows',        // remote session in the browser
        connect_app: 'open_in_new',        // open in the RustDesk app / another program
        guest_link: 'share',
        snapshot: 'photo_camera',
        details: 'info',
        edit: 'edit',
        rename: 'drive_file_rename_outline',
        tags: 'sell',
        groups: 'workspaces',
        folder: 'folder',
        access_policy: 'shield',
        ban: 'block',
        unban: 'lock_open',
        delete: 'delete',
        delete_forever: 'delete_forever',
        restore: 'restore_from_trash',
        copy: 'content_copy',
        download: 'download',
        upload: 'upload',
        export: 'download',
        refresh: 'refresh',
        add: 'add',
        approve: 'check',
        reject: 'close',
        accept: 'check',
        resolve: 'task_alt',
        open: 'arrow_forward',
        history: 'history',
        password: 'key',
        organization: 'business',
        user: 'person',
        terminal: 'terminal',
        files: 'folder_open',
        run: 'play_arrow',
        link: 'link',
        unlink: 'link_off',
        network_port: 'settings_ethernet',
        power_on: 'power_settings_new',
        sleep: 'bedtime',
        restart: 'restart_alt',
        power_off: 'power_off',
        enable: 'toggle_on',
        disable: 'toggle_off',
        qr: 'qr_code_2',
        billing: 'payments',
        settings: 'settings',
        search: 'search',
        send: 'send',
        print: 'print',
        check_now: 'network_ping',
        revoke: 'cancel',
        view: 'visibility',
        hide: 'visibility_off',
        retry: 'replay',                   // run a failed task or request again
        reload: 'autorenew',               // reload a service's configuration
        duplicate: 'control_point_duplicate',
        connect_terminal: 'terminal',      // open a terminal session on a device
        start: 'play_arrow',               // start a service or a monitor loop
        stop: 'stop',
        compliance_scan: 'fact_check',
        remediate: 'build',                // fix automatically
        encode: 'code',                    // text to Base64, URL encoding
        decode: 'text_fields',             // back to readable text
        generate: 'summarize',
        save: 'save',
        reset: 'settings_backup_restore',
        import: 'upload',
        help_request: 'support_agent',    // someone asked for help from the desktop app
        enrollment_request: 'how_to_reg', // a new device asks to join the server
    },

    /** <span> for the icon of a meaning (see ICONS); decorative, the label carries the meaning */
    icon(meaning) {
        const name = (this.ICONS && this.ICONS[meaning]) || meaning;
        return `<span class="material-icons" aria-hidden="true">${String(name).replace(/[^a-z0-9_]/g, '')}</span>`;
    },

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
                // "Permission denied: device.ban" from requirePermission is a raw
                // permission key; show a sentence instead and keep the key on the error.
                let permission = null;
                if (response.status === 403 && (/^Permission denied\b/i.test(message) || /^Request failed \(HTTP 403\)$/.test(message))) {
                    const match = message.match(/^Permission denied:\s*(.+)$/i);
                    permission = match ? match[1].trim() : null;
                    message = Utils.permissionDeniedMessage();
                }
                const error = new Error(message);
                error.permission = permission;
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
     * Get platform icon name based on platform string
     */
    getPlatformIcon(platform) {
        if (!platform) return 'devices';
        const p = platform.toLowerCase();
        if (p.includes('windows')) return 'desktop_windows';
        if (p.includes('mac') || p.includes('darwin')) return 'desktop_mac';
        if (p.includes('linux')) return 'computer';
        if (p.includes('android')) return 'smartphone';
        if (p.includes('ios') || p.includes('iphone')) return 'phone_iphone';
        return 'devices';
    },

    /**
     * Operating system mark for a platform string, as HTML.
     * Uses the logo sprite (/img/os-icons.svg) when the OS is recognised and an
     * empty space of the same size otherwise, so names stay aligned.
     * Decorative: the OS name is always shown as text next to it.
     * @param {string} platform - e.g. "Windows 11 Pro", "Ubuntu 24.04", "macOS 15.1"
     * @returns {string}
     */
    getPlatformIconHtml(platform) {
        const id = Utils.getPlatformLogoId(platform);
        if (!id) {
            return '<span class="os-icon os-icon-none" aria-hidden="true"></span>';
        }
        const v = (window.BetterDesk && window.BetterDesk.cacheVersion) || '';
        return `<svg class="os-icon os-${id}" aria-hidden="true" focusable="false"><use href="/img/os-icons.svg?v=${encodeURIComponent(v)}#${id}"></use></svg>`;
    },

    /**
     * Symbol id in /img/os-icons.svg for a platform string, or '' if unknown.
     */
    getPlatformLogoId(platform) {
        if (!platform) return '';
        const p = String(platform).toLowerCase();
        // One mark per OS family; distributions use the Linux mark and keep
        // their name in the text next to it.
        const rules = [
            ['windows', /windows|win32|win64|^win\b/],
            ['apple', /mac ?os|macintosh|darwin|\bmac\b|\bios\b|iphone|ipad|apple/],
            ['android', /android/],
            ['chrome', /chrome ?os|chromeos/],
            ['linux', /linux|ubuntu|debian|raspberry|raspbian|fedora|centos|red ?hat|rhel|\barch\b|manjaro|alpine|mint|suse|kali|bsd/]
        ];
        const hit = rules.find(([, re]) => re.test(p));
        return hit ? hit[0] : '';
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
    },

    /* ── Data display ──
     * One look per kind of value on every page (components.css "Data display",
     * .ui-rework/GUIDE.md "Data display"). Every helper returns an HTML string
     * and escapes what it is given. */

    /** Escape text for HTML text and attribute values (quotes too) */
    escapeAttr(text) {
        return String(text === null || text === undefined ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /** Translation with an English fallback while a new key is not loaded yet */
    _t(key, fallback, params) {
        if (typeof _ === 'function') {
            const text = _(key, params || {});
            if (text && text !== key) return text;
        }
        return String(fallback).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] !== undefined ? params[k] : m));
    },

    /**
     * Status words grouped by tone. Each tone has one colour and one shape:
     * good (filled circle), waiting (hourglass), neutral (hollow circle),
     * warning (triangle), danger (square).
     */
    STATUS_TONES: {
        good: ['online', 'ok', 'success', 'active', 'running', 'enabled', 'on', 'approved', 'accepted', 'passed',
            'done', 'completed', 'connected', 'resolved', 'healthy', 'valid', 'allowed', 'yes'],
        waiting: ['pending', 'waiting', 'queued', 'checking', 'scheduled', 'in_progress', 'starting', 'sending', 'open'],
        neutral: ['offline', 'stopped', 'inactive', 'disabled', 'off', 'rejected', 'revoked', 'expired', 'deleted',
            'closed', 'cancelled', 'canceled', 'skipped', 'paused', 'draft', 'unknown', 'low', 'no', 'none'],
        warning: ['warning', 'degraded', 'no_signal', 'partial', 'expiring', 'outdated', 'medium'],
        danger: ['error', 'failed', 'failure', 'banned', 'blocked', 'denied', 'invalid', 'unreachable', 'down',
            'critical', 'high']
    },

    /** Tone for a status word ("approved" → "good"); unknown words are neutral */
    statusTone(word) {
        const w = String(word || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        if (Utils.STATUS_TONES[w]) return w;
        for (const [tone, words] of Object.entries(Utils.STATUS_TONES)) {
            if (words.includes(w)) return tone;
        }
        return 'neutral';
    },

    /**
     * Status: a mark and a word. `tone` is a tone (good, waiting, neutral,
     * warning, danger) or a status word that maps to one ("pending").
     * options.title: longer explanation on hover.
     */
    statusHtml(tone, label, options = {}) {
        const t = Utils.statusTone(tone);
        const title = options && options.title ? ` title="${Utils.escapeAttr(options.title)}"` : '';
        return `<span class="status is-${t}"${title}>${Utils.escapeAttr(label)}</span>`;
    },

    /** Yes/no setting as a status: "On" (good) or "Off" (neutral); options.on/off change the words */
    booleanHtml(value, options = {}) {
        const on = options.on || Utils._t('common.on', 'On');
        const off = options.off || Utils._t('common.off', 'Off');
        return Utils.statusHtml(value ? 'good' : 'neutral', value ? on : off);
    },

    /** Tag token for a category, source, type or a tag people set. options.icon: a Utils.ICONS meaning or icon name */
    tagHtml(label, options = {}) {
        const icon = options.icon ? Utils.icon(options.icon) : '';
        const title = options.title ? ` title="${Utils.escapeAttr(options.title)}"` : '';
        return `<span class="tag"${title}>${icon}<span class="tag-text">${Utils.escapeAttr(label)}</span></span>`;
    },

    /** Several tags (array or comma-separated text); none gives the empty dash */
    tagsHtml(list, options = {}) {
        const items = (Array.isArray(list) ? list : String(list || '').split(','))
            .map((s) => String(s === null || s === undefined ? '' : s).trim()).filter(Boolean);
        if (!items.length) return Utils.emptyHtml(options.empty);
        return `<span class="tag-set">${items.map((s) => Utils.tagHtml(s, { title: s.length > 24 ? s : '' })).join('')}</span>`;
    },

    /**
     * A value people read exactly or copy: ID, IP address, host:port, key.
     * options.mono (default true), options.copy (adds a copy button that shows
     * on row hover; the full value is copied), options.label (names the value
     * in the button's label, default the value itself), options.empty.
     */
    valueHtml(text, options = {}) {
        if (text === null || text === undefined || String(text).trim() === '') return Utils.emptyHtml(options.empty);
        const value = String(text);
        const mono = options.mono !== false;
        const inner = `<span class="${mono ? 'mono' : 'value-text'}"${options.copy ? ` title="${Utils.escapeAttr(value)}"` : ''}>${Utils.escapeAttr(value)}</span>`;
        if (!options.copy) return inner;
        const aria = Utils._t('common.copy_value', 'Copy {value}', { value: options.label || value });
        return `<span class="value-copy">${inner}<button type="button" class="copy-btn" data-copy-value="${Utils.escapeAttr(value)}" aria-label="${Utils.escapeAttr(aria)}" title="${Utils.escapeAttr(aria)}">${Utils.icon('copy')}</button></span>`;
    },

    /**
     * A point in time as <time datetime>: "3h ago" with the full date and time
     * in the tooltip and for screen readers. Older than a week, or with
     * options.relative = false, the date itself. options.format: Intl options
     * for the date (e.g. date only). options.empty: word for no date
     * ("Never"); without it a dash.
     */
    timeHtml(value, options = {}) {
        const date = Utils.parseDate(value);
        if (!date) return Utils.emptyHtml(options.empty);
        const full = Utils.formatDate(date);
        const shown = options.relative === false
            ? Utils.formatDate(date, options.format || {})
            : Utils.formatRelativeTime(date);
        const extra = shown !== full ? `<span class="sr-only"> (${Utils.escapeAttr(full)})</span>` : '';
        return `<time class="time" datetime="${date.toISOString()}" title="${Utils.escapeAttr(full)}">${Utils.escapeAttr(shown)}${extra}</time>`;
    },

    /** Version number without a leading "v": "1.4.2" */
    versionHtml(version, options = {}) {
        const v = String(version === null || version === undefined ? '' : version).trim().replace(/^v(?=\d)/i, '');
        if (!v) return Utils.emptyHtml(options.empty);
        return `<span class="version">${Utils.escapeAttr(v)}</span>`;
    },

    /** Operating system: its mark and its name ("Windows 11 Pro") */
    platformHtml(platform, options = {}) {
        const p = String(platform || '').trim();
        if (!p) return Utils.emptyHtml(options.empty);
        return `<span class="platform">${Utils.getPlatformIconHtml(p)}<span>${Utils.escapeAttr(p)}</span></span>`;
    },

    /** Initials for a name: "Linus Rath" → "LR", "admin" → "A" */
    initials(name) {
        const words = String(name || '').trim().split(/[\s._@-]+/).filter(Boolean);
        const first = (w) => Array.from(w)[0] || '';
        return (words.length > 1 ? first(words[0]) + first(words[1]) : first(words[0] || '')).toUpperCase();
    },

    /** Avatar colour for a name, 1..6 (.avatar.is-c1..6): the same name always gets the same colour */
    avatarColor(name) {
        let h = 0;
        for (const ch of String(name || '').trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
        return (h % 6) + 1;
    },

    /**
     * The avatar box (components.css .avatar): the picture when there is one,
     * otherwise the initials in the name's colour. Decorative: the name is
     * shown next to it. options.picture: image URL; options.size: 'md' | 'lg'.
     */
    avatarBoxHtml(name, options = {}) {
        const size = options.size === 'md' || options.size === 'lg' ? ` is-${options.size}` : '';
        if (options.picture) {
            return `<span class="avatar${size}" aria-hidden="true"><img src="${Utils.escapeAttr(options.picture)}" alt="" loading="lazy"></span>`;
        }
        return `<span class="avatar${size} is-c${Utils.avatarColor(name)}" aria-hidden="true">${Utils.escapeAttr(Utils.initials(name))}</span>`;
    },

    /**
     * A person's name. options.avatar adds the avatar box before it (only where
     * people are the subject of the list); options.picture and options.size go
     * to the box.
     */
    userHtml(name, options = {}) {
        const n = String(name || '').trim();
        if (!n) return Utils.emptyHtml(options.empty);
        if (!options.avatar) return `<span class="user-name">${Utils.escapeAttr(n)}</span>`;
        return `<span class="user">${Utils.avatarBoxHtml(n, options)}<span class="user-name">${Utils.escapeAttr(n)}</span></span>`;
    },

    /**
     * No value. Without a word: one muted dash, read as "None". With a word
     * ("Never", "Unassigned"): that word, muted.
     */
    emptyHtml(word) {
        if (word) return `<span class="value-empty">${Utils.escapeAttr(word)}</span>`;
        return `<span class="value-empty"><span aria-hidden="true">–</span><span class="sr-only">${Utils.escapeAttr(Utils._t('common.none', 'None'))}</span></span>`;
    },

    /** Number in the console language: 12 345 */
    formatNumber(value, options = {}) {
        const n = Number(value);
        if (value === null || value === undefined || value === '' || !isFinite(n)) return '';
        return new Intl.NumberFormat(Utils._dateLocale(), options).format(n);
    },

    /** Bytes as B, kB, MB, GB, TB with one decimal: "1.5 GB" */
    formatBytes(bytes) {
        const n = Number(bytes);
        if (bytes === null || bytes === undefined || bytes === '' || !isFinite(n) || n < 0) return '';
        const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte', 'petabyte'];
        let i = 0;
        let v = n;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        return Utils.formatNumber(v, { style: 'unit', unit: units[i], unitDisplay: 'short', maximumFractionDigits: i ? 1 : 0 });
    },

    /** Seconds as the two largest units: "2d 3h", "5m 40s" (localised short units) */
    formatDuration(seconds) {
        let s = Math.round(Number(seconds));
        if (seconds === null || seconds === undefined || seconds === '' || !isFinite(s) || s < 0) return '';
        const parts = [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]]
            .map(([unit, size]) => { const n = Math.floor(s / size); s -= n * size; return [unit, n]; });
        const start = parts.findIndex(([, n]) => n > 0);
        if (start === -1) return Utils.formatNumber(0, { style: 'unit', unit: 'second', unitDisplay: 'narrow' });
        return parts.slice(start, start + 2).filter(([, n]) => n > 0)
            .map(([unit, n]) => Utils.formatNumber(n, { style: 'unit', unit, unitDisplay: 'narrow' })).join(' ');
    },

    /** Percent of 0..100 (options.fraction: value is 0..1): "62 %" or "62%" as the language writes it */
    formatPercent(value, options = {}) {
        const n = Number(value);
        if (value === null || value === undefined || value === '' || !isFinite(n)) return '';
        return Utils.formatNumber(options.fraction ? n : n / 100, { style: 'percent', maximumFractionDigits: options.digits === undefined ? 0 : options.digits });
    }
};

// Copy buttons from Utils.valueHtml: copy the value, show a tick for a moment
// and confirm with a toast.
if (typeof document !== 'undefined') {
    document.addEventListener('click', async (event) => {
        const btn = event.target && event.target.closest ? event.target.closest('[data-copy-value]') : null;
        if (!btn) return;
        event.preventDefault();
        let ok = false;
        try { ok = await Utils.copyToClipboard(btn.getAttribute('data-copy-value')); } catch (e) { ok = false; }
        if (ok) {
            const icon = btn.querySelector('.material-icons');
            btn.classList.add('copied');
            if (icon) icon.textContent = 'check';
            clearTimeout(btn._copyTimer);
            btn._copyTimer = setTimeout(() => {
                btn.classList.remove('copied');
                if (icon) icon.textContent = Utils.ICONS.copy;
            }, 1500);
        }
        if (window.Notifications) {
            if (ok) window.Notifications.success(Utils._t('common.copied', 'Copied to clipboard'));
            else window.Notifications.error(Utils._t('common.copy_failed', 'Could not copy. Select the text and copy it yourself.'));
        }
    });
}

// Export for modules or attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
} else {
    window.Utils = Utils;
}
