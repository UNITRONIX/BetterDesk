/**
 * BetterDesk Console - Main Application
 */

(function() {
    'use strict';
    
    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', init);
    
    function init() {
        initSidebar();
        initNavbar();
        initLanguageSelector();
        initUserMenu();
        initRefreshButton();
        initRegistrationBadge();
        initPanelEvents();
    }

    /**
     * Classic rail sidebar — mobile overlay support
     */
    function initSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (!sidebar) return;

        overlay?.addEventListener('click', () => {
            sidebar.classList.remove('open');
        });

        sidebar.querySelectorAll('.sidebar-link, .sidebar-rail-btn[href]').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 1024) {
                    sidebar.classList.remove('open');
                }
            });
        });

        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', () => {
                if (window.MobileNav && window.DeviceCapabilities?.isMobileShell()) {
                    window.MobileNav.openDrawer();
                    return;
                }
                sidebar.classList.toggle('open');
            });

            function checkMobile() {
                const useLegacy = window.innerWidth <= 1024
                    && !(window.DeviceCapabilities && window.DeviceCapabilities.isMobileShell());
                mobileMenuBtn.style.display = useLegacy ? 'flex' : 'none';
            }
            checkMobile();
            window.addEventListener('resize', Utils.debounce(checkMobile, 200));
        }
    }
    
    /**
     * Navbar functionality
     */
    function initNavbar() {
        function closeAllTopbarPopovers(except) {
            document.querySelectorAll('.lang-dropdown.open').forEach(d => {
                if (except && (d === except || except.contains?.(d))) return;
                d.classList.remove('open');
                d.parentElement?.querySelector('button')?.setAttribute('aria-expanded', 'false');
            });
            const notif = document.getElementById('notif-dropdown');
            if (notif && !(except && (except === notif || except.contains?.(notif)))) {
                notif.hidden = true;
                document.getElementById('notif-btn')?.setAttribute('aria-expanded', 'false');
            }
        }
        window.BetterDesk = window.BetterDesk || {};
        window.BetterDesk.closeAllTopbarPopovers = closeAllTopbarPopovers;

        // Dropdowns
        document.querySelectorAll('.lang-selector').forEach(selector => {
            const btn = selector.querySelector('button');
            const dropdown = selector.querySelector('.lang-dropdown');
            
            if (!btn || !dropdown) return;
            
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const willOpen = !dropdown.classList.contains('open');
                closeAllTopbarPopovers(willOpen ? dropdown : null);
                dropdown.classList.toggle('open', willOpen);
                btn.setAttribute('aria-expanded', String(willOpen));
            });
        });
        
        // Close dropdowns on outside click
        document.addEventListener('click', () => {
            closeAllTopbarPopovers();
        });

        // Escape closes an open language or account menu and returns focus to its button
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const open = document.querySelector('.lang-selector .lang-dropdown.open');
            if (!open) return;
            const btn = open.parentElement?.querySelector('button');
            open.classList.remove('open');
            btn?.setAttribute('aria-expanded', 'false');
            btn?.focus();
        });
    }
    
    /**
     * Language selector
     */
    function initLanguageSelector() {
        const langDropdown = document.getElementById('lang-dropdown');
        if (!langDropdown) return;
        
        langDropdown.querySelectorAll('.lang-option').forEach(option => {
            option.addEventListener('click', async (e) => {
                const lang = option.dataset.lang;
                if (lang) {
                    await window.changeLanguage(lang);
                }
            });
            option.addEventListener('keydown', async (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                const lang = option.dataset.lang;
                if (lang) {
                    await window.changeLanguage(lang);
                }
            });
        });
    }
    
    /**
     * User menu
     */
    function initUserMenu() {
        // Account menu (views/partials/user-menu.ejs): the same items in the
        // sidebar footer and the top bar, so they are found by data attributes.
        const t = (key, fallback) => { const v = _(key); return v && v !== key ? v : fallback; };

        async function signOut() {
            const label = t('user_menu.sign_out', 'Sign out');
            const confirmed = await Modal.confirm({
                title: label,
                message: _('auth.logout_confirm'),
                confirmLabel: label
            });
            if (!confirmed) return;
            try {
                await Utils.api('/api/auth/logout', { method: 'POST' });
                window.location.href = '/login';
            } catch (error) {
                Notifications.error(_('errors.logout_failed'));
            }
        }

        // My status: shared with the chat page through Utils.presence
        function showPresence(status) {
            document.querySelectorAll('[data-presence]').forEach((item) => {
                const on = item.getAttribute('data-presence') === status;
                item.setAttribute('aria-checked', on ? 'true' : 'false');
                const mark = item.querySelector('.user-menu-check');
                if (mark) mark.textContent = on ? 'check' : '';
            });
            // The dot on my avatar and the status word read with the menu button
            document.querySelectorAll('[data-presence-dot]').forEach((dot) => {
                dot.className = 'presence is-' + status;
            });
            const chosen = document.querySelector('[data-presence="' + status + '"] span:not(.presence):not(.user-menu-check)');
            document.querySelectorAll('[data-presence-text]').forEach((text) => {
                if (chosen) text.textContent = chosen.textContent;
            });
        }
        showPresence(Utils.presence.get());
        Utils.presence.onChange(showPresence);

        document.addEventListener('click', (event) => {
            const item = event.target.closest('[data-presence], [data-user-action], #change-password-btn, #logout-btn');
            if (!item) return;
            if (item.hasAttribute('data-presence')) {
                Utils.presence.set(item.getAttribute('data-presence'));
                return;
            }
            const action = item.getAttribute('data-user-action') || (item.id === 'logout-btn' ? 'logout' : 'change-password');
            if (action === 'change-password') window.location.href = '/settings';
            else if (action === 'logout') signOut();
        });
    }
    
    /**
     * Refresh button
     */
    function initRefreshButton() {
        const refreshBtn = document.getElementById('refresh-btn');
        if (!refreshBtn) return;
        
        refreshBtn.addEventListener('click', () => {
            // Dispatch custom event for page-specific refresh handlers
            window.dispatchEvent(new CustomEvent('app:refresh'));
            
            // Visual feedback
            const icon = refreshBtn.querySelector('.material-icons');
            if (icon) {
                icon.style.animation = 'spin 0.5s linear';
                setTimeout(() => {
                    icon.style.animation = '';
                }, 500);
            }
        });
    }
    
    // Add spin animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);

    /**
     * Periodically fetch pending registration count for sidebar badge.
     */
    function initRegistrationBadge() {
        const badges = () => [
            document.getElementById('reg-sidebar-badge'),
            document.getElementById('pending-count'),
        ].filter(Boolean);
        if (!badges().length) return;

        let badgeInterval = null;

        function renderRegistrationCount(count) {
            badges().forEach((badge) => {
                badge.textContent = String(count);
                badge.style.display = count > 0 ? '' : 'none';
            });
        }

        async function updateBadge() {
            try {
                const resp = await fetch('/api/registrations/count', {
                    credentials: 'same-origin',
                    headers: { Accept: 'application/json' },
                });
                if (!resp.ok) {
                    if (resp.status === 401 && badgeInterval) {
                        clearInterval(badgeInterval);
                        badgeInterval = null;
                    }
                    return;
                }
                const data = await resp.json();
                const count = Number.isFinite(Number(data.count)) ? Number(data.count) : 0;
                renderRegistrationCount(Math.max(0, count));
            } catch (_) { /* silent */ }
        }

        updateBadge();
        badgeInterval = setInterval(updateBadge, 15000); // real-time fallback
    }

    /**
     * Subscribe once per page to events produced by the Go event bus and
     * Node.js LAN registration route. The notification center and the
     * registrations page consume the normalized browser event.
     */
    function initPanelEvents() {
        // The stream contains registration metadata, so only approvers need
        // to open it. The server repeats this authorization check during the
        // WebSocket upgrade.
        if (typeof WebSocket !== 'function' ||
            !document.getElementById('reg-sidebar-badge')) return;

        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${proto}//${location.host}/ws/panel-events`;
        let ws = null;
        let retryDelay = 3000;

        function connect() {
            // The console is intentionally unavailable during an in-panel
            // restart. Do not create a burst of failed WSS handshakes while
            // systemd/NSSM is bringing the replacement process up.
            if (window.BetterDesk?.consoleRestarting) return;
            try {
                ws = new WebSocket(wsUrl);
            } catch (_) {
                if (window.BetterDesk?.consoleRestarting) return;
                setTimeout(connect, retryDelay);
                retryDelay = Math.min(retryDelay * 2, 60000);
                return;
            }

            ws.onopen = () => {
                retryDelay = 3000;
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'registration_pending' ||
                        data.type === 'registration_changed') {
                        window.dispatchEvent(new CustomEvent('registrations:pending-changed', {
                            detail: data,
                        }));
                    }
                    if (data.type === 'registration_changed') {
                        // Approval creates the Go peer immediately, but the
                        // Devices page may otherwise wait for its 60s
                        // reconciliation timer before showing it.
                        window.dispatchEvent(new CustomEvent('app:refresh', {
                            detail: data,
                        }));
                    }
                    window.dispatchEvent(new CustomEvent('betterdesk:panel-event', {
                        detail: data,
                    }));
                } catch (_) {}
            };

            ws.onclose = () => {
                if (window.BetterDesk?.consoleRestarting) return;
                setTimeout(connect, retryDelay);
                retryDelay = Math.min(retryDelay * 2, 60000);
            };

            ws.onerror = () => {
                if (window.BetterDesk?.consoleRestarting) return;
                ws.close();
            };
        }

        connect();
    }
    
})();
