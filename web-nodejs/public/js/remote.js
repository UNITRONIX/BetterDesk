/**
 * BetterDesk Console - Remote Desktop Session Manager
 * Multi-tab remote desktop viewer with shared toolbar
 * Supports multiple concurrent RDClient sessions
 */

/* global RDClient, RDVideo, CDAPSession, RemoteTargetSession */

(function () {
    'use strict';

    // ---- i18n helper ----
    // window.t (from i18n-client.js) returns the key itself when missing;
    // wrap it so callers can provide an English fallback string.
    function t(key, fallback) {
        if (typeof window.t === 'function') {
            const val = window.t(key);
            if (val && val !== key) return val;
        }
        return fallback !== undefined ? fallback : key;
    }

    // ---- Transport selection (PR 2.3) ----
    // The unified web client picks the right transport per-device based
    // on `window.__capabilities.transport` (set server-side from the Go
    // peer record). RustDesk peers go through `RDClient`; OS-agent /
    // CDAP-connected peers use `CDAPSession`, which exposes the same
    // public surface so the rest of the session manager is transport-
    // agnostic.
    function getTransportName() {
        const caps = window.__capabilities || {};
        const t = String(caps.transport || 'rd').toLowerCase();
        if (t === 'mesh') return 'mesh';
        if (t === 'cdap') return 'cdap';
        if (t === 'rdp' || t === 'vnc') return t;
        return 'rd';
    }

    function isGuestAccessMode() {
        const caps = window.__capabilities || {};
        return !!(caps.guest_access || caps.mesh_share);
    }

    function guestAllowedPeerIds() {
        const caps = window.__capabilities || {};
        if (Array.isArray(caps.guest_peer_ids) && caps.guest_peer_ids.length) {
            return caps.guest_peer_ids.map(String);
        }
        if (caps.mesh_share && window.__initialDeviceId) {
            return [String(window.__initialDeviceId)];
        }
        return [];
    }

    function isPeerAllowedForGuest(deviceId) {
        if (!isGuestAccessMode()) return true;
        const allowed = guestAllowedPeerIds();
        if (!allowed.length) return false;
        return allowed.includes(String(deviceId));
    }

    function applyGuestUiLockdown() {
        if (!isGuestAccessMode()) return;
        const hideIds = ['btn-add-session', 'session-picker-backdrop', 'session-picker-panel'];
        hideIds.forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.hidden = true;
                el.style.display = 'none';
            }
        });
        const back = document.getElementById('btn-back-devices');
        if (back) {
            back.title = t('guest_access.back_to_list', 'Back to guest devices');
            const backLabel = back.querySelector('.tab-bar-label');
            if (backLabel) backLabel.textContent = t('guest_access.back_to_list', 'Back to guest devices');
            else back.textContent = t('guest_access.back_to_list', 'Back to guest devices');
            back.onclick = function (e) {
                e.preventDefault();
                e.stopPropagation();
                const token = new URLSearchParams(window.location.search).get('guest')
                    || new URLSearchParams(window.location.search).get('t')
                    || window.__guestToken
                    || '';
                window.location.href = token ? ('/remote/guest?t=' + encodeURIComponent(token)) : '/remote/guest';
            };
        }
        if (window.__capabilities && (window.__capabilities.guest_view_only || window.__capabilities.mesh_view_only)) {
            // View-only: leave transport adapters to enforce; hide file transfer / chat when present
            ['btn-file-transfer', 'btn-chat'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) {
                    el.disabled = true;
                    el.classList.add('disabled');
                    el.style.display = 'none';
                }
            });
        }
    }
    function createTransportClient(canvas, opts) {
        // Dev only: /dev/mock-remote.js (served when BD_DEV_MOCK_REMOTE=1) defines a
        // fake device that replaces the network, so the viewer can be reviewed.
        if (window.__mockRemote && typeof window.MockRemoteSession === 'function') {
            return new window.MockRemoteSession(canvas, opts);
        }
        const name = getTransportName();
        if (name === 'mesh' && typeof MeshSession === 'function') {
            return new MeshSession(canvas, opts);
        }
        if (name === 'cdap' && typeof CDAPSession === 'function') {
            return new CDAPSession(canvas, opts);
        }
        if ((name === 'rdp' || name === 'vnc') && typeof RemoteTargetSession === 'function') {
            return new RemoteTargetSession(canvas, opts);
        }
        return new RDClient(canvas, opts);
    }

    // ---- Simple toast notification ----
    function showToast(message, type) {
        const toast = document.createElement('div');
        toast.className = 'rd-toast rd-toast-' + (type || 'info');
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // The viewer has no console toast script: copy buttons (Utils.valueHtml) and
    // older code paths call Notifications, so route them to the viewer's toast.
    if (!window.Notifications) {
        window.Notifications = {
            success: (m) => showToast(m, 'success'),
            error: (m) => showToast(m, 'error'),
            warning: (m) => showToast(m, 'warning'),
            info: (m) => showToast(m, 'info'),
        };
    }

    // "{name}" placeholders in a translated sentence
    function fmt(key, fallback, vars) {
        let s = t(key, fallback);
        Object.keys(vars || {}).forEach((k) => { s = s.split('{' + k + '}').join(String(vars[k])); });
        return s;
    }

    // ---- Session storage ----
    const sessions = new Map(); // deviceId → SessionInfo
    let activeSessionId = null;

    const Prefs = window.RemoteViewerPrefs || {};
    const globalViewerPrefs = typeof Prefs.loadRemoteViewerPrefs === 'function'
        ? Prefs.loadRemoteViewerPrefs(window.BetterDesk?.user?.id)
        : { quality: 'Best', scale: 'fit', codec: 'Auto', fpsMode: 'adaptive', adaptiveQuality: true, backgroundFps: 1 };

    function cloneViewerPrefs(prefs) {
        return Object.assign({
            quality: 'Best',
            scale: 'fit',
            codec: 'Auto',
            fpsMode: 'adaptive',
            adaptiveQuality: true,
            backgroundFps: 1,
            keyboardMode: 'Auto',
        }, prefs || globalViewerPrefs);
    }

    function persistGlobalViewerPrefs(prefs) {
        Object.assign(globalViewerPrefs, prefs);
        if (typeof Prefs.saveRemoteViewerPrefs === 'function') {
            Prefs.saveRemoteViewerPrefs(window.BetterDesk?.user?.id, globalViewerPrefs);
        }
    }

    function buildClientOpts(session) {
        const prefs = session.viewerPrefs || globalViewerPrefs;
        const userName = (window.BetterDesk.user && (window.BetterDesk.user.display_name || window.BetterDesk.user.username)) || 'BetterDesk Web';
        const activeFps = typeof Prefs.getActiveFpsForMode === 'function'
            ? Prefs.getActiveFpsForMode(prefs.fpsMode, prefs.quality)
            : 60;
        return {
            deviceId: session.deviceId,
            serverPubKey: window.BetterDesk.serverPubKey || '',
            connection: window.BetterDesk.connection || null,
            myName: userName,
            scaleMode: prefs.scale || 'fit',
            fps: activeFps,
            fpsMode: prefs.fpsMode || 'adaptive',
            imageQuality: prefs.quality || 'Best',
            qualityPreset: typeof Prefs.getPresetForQuality === 'function'
                ? Prefs.getPresetForQuality(prefs.quality)
                : 'best',
            adaptiveQuality: prefs.fpsMode === 'adaptive' && prefs.adaptiveQuality !== false,
            preferCodec: prefs.codec || 'Auto',
            disableAudio: false,
            serverRecord: session.meshServerRecord || false,
        };
    }

    function applyViewerPrefsToClient(client, prefs) {
        if (!client || !prefs) return;
        if (typeof client.setBackgroundFps === 'function') {
            client.setBackgroundFps(prefs.backgroundFps || 1);
        }
        if (client._state === 'streaming' || client.state === 'streaming') {
            const preset = typeof Prefs.getPresetForQuality === 'function'
                ? Prefs.getPresetForQuality(prefs.quality)
                : ({ Best: 'best', Balanced: 'balanced', Low: 'speed' }[prefs.quality] || 'best');
            if (typeof client.setQualityPreset === 'function') {
                client.setQualityPreset(preset);
            }
            if (typeof client.setFpsMode === 'function') {
                client.setFpsMode(prefs.fpsMode || 'adaptive');
            }
            if (typeof client.setScaleMode === 'function') {
                client.setScaleMode(prefs.scale || 'fit');
            }
            if (prefs.codec && prefs.codec !== 'Auto' && typeof client.setCodec === 'function') {
                client.setCodec(prefs.codec);
            }
            if (typeof client.setKeyboardMode === 'function' && prefs.keyboardMode) {
                client.setKeyboardMode(prefs.keyboardMode);
            }
        }
    }

    function updateSessionViewerPref(session, patch) {
        if (!session) return;
        session.viewerPrefs = Object.assign({}, session.viewerPrefs || cloneViewerPrefs(), patch);
        persistGlobalViewerPrefs(session.viewerPrefs);
    }

    /**
     * Session info wrapper for a single remote connection
     */
    class SessionInfo {
        constructor(deviceId, deviceName, panel) {
            this.deviceId = deviceId;
            this.deviceName = deviceName || '';
            this.panel = panel;
            this.canvas = panel.querySelector('.session-canvas');
            this.connectionOverlay = panel.querySelector('.session-connection-overlay');
            this.passwordOverlay = panel.querySelector('.session-password-overlay');
            this.passwordInput = panel.querySelector('.session-password-input');
            this.rememberPeerCheckbox = panel.querySelector('.session-remember-peer-checkbox');
            this.loginError = panel.querySelector('.session-login-error');
            this.statusText = panel.querySelector('.session-status-text');
            this.overlayActions = panel.querySelector('.session-overlay-actions');
            this.chatPanel = panel.querySelector('.session-chat-panel');
            this.chatMessages = panel.querySelector('.session-chat-messages');
            this.chatInput = panel.querySelector('.session-chat-input');
            this.tfaOverlay = panel.querySelector('.session-2fa-overlay');
            this.tfaInput = panel.querySelector('.session-2fa-input');
            this.tfaError = panel.querySelector('.session-2fa-error');
            this.cdapFallbackBtn = panel.querySelector('.session-btn-cdap-fallback');
            this.client = null;
            this.state = 'idle';
            this.meshServerRecord = false;
            this.latency = 0;
            this.lastStats = null;
            this.audioMuted = false;
            this.viewerPrefs = cloneViewerPrefs();
            this.mediaRecorder = null;
            this.recordedChunks = [];
            // What the state screen and the tab show
            this.platform = '';
            this.stepId = null;          // find | route | accept | signin | screen
            this.stepStartedAt = 0;
            this.slowTimer = null;
            this.everStreamed = false;
            this.connectedAt = null;
            this.endedBy = '';           // '' | 'user' | 'cancel'
            this.endInfo = null;         // { reason, meta, at, step }
            this.endPending = false;
            this.view = 'connecting';    // connecting | password | failed | ended | streaming
            this.encryptionWarning = '';
            this.domWired = false;
            this.closed = false;
        }
    }

    // ---- DOM References (shared) ----
    const viewerContainer = document.getElementById('viewer-container');
    const viewerShell = document.getElementById('rd-viewer-shell');
    const toolbar = document.getElementById('viewer-toolbar');
    const toolbarHandle = document.getElementById('toolbar-handle');
    const toolbarNotchSlot = document.getElementById('toolbar-notch-slot');
    const toolbarStatus = document.getElementById('toolbar-status');
    const toolbarDeviceId = document.getElementById('toolbar-device-id');
    const tabBar = document.getElementById('session-tabs');
    const sheetHost = document.getElementById('rd-sheet-host');
    let currentSheet = null; // 'chat' | 'files' | 'info'

    // ---- Notch toolbar (integrated in session tab bar) ----
    // Compact handle pulls the action drawer open; fullscreen stays on the handle only.
    let toolbarPinned = false;
    let drawerPullTimer = null;

    function syncToolbarHandleAria(expanded) {
        const exp = document.getElementById('btn-toolbar-expand');
        if (!exp) return;
        exp.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    function setDrawerPulling(active) {
        toolbar?.classList.toggle('drawer-pulling', active);
        if (!active) {
            clearTimeout(drawerPullTimer);
            drawerPullTimer = null;
            return;
        }
        clearTimeout(drawerPullTimer);
        drawerPullTimer = setTimeout(() => toolbar?.classList.remove('drawer-pulling'), 440);
    }

    function syncExpandControlIcon(expanded) {
        const exp = document.getElementById('btn-toolbar-expand');
        if (!exp) return;
        exp.classList.toggle('active', expanded);
        const ic = exp.querySelector('.btn-caret');
        if (ic) ic.textContent = expanded ? 'expand_less' : 'expand_more';
    }

    function expandToolbar() {
        if (toolbarNotchSlot?.classList.contains('toolbar-chrome-hidden')) return;
        toolbar.classList.remove('hover-preview');
        toolbar.classList.add('expanded');
        syncToolbarHandleAria(true);
        syncExpandControlIcon(true);
        setDrawerPulling(true);
    }

    function collapseToolbar() {
        if (toolbarPinned) return;
        if (document.querySelector('.toolbar-dropdown-menu.open')) return;
        setDrawerPulling(true);
        toolbar.classList.remove('expanded');
        toolbar.classList.remove('hover-preview');
        syncToolbarHandleAria(false);
        syncExpandControlIcon(false);
    }

    function toggleToolbar() {
        if (toolbar.classList.contains('expanded') || toolbar.classList.contains('pinned')) {
            toolbar.classList.remove('expanded', 'hover-preview');
            syncExpandControlIcon(false);
            syncToolbarHandleAria(false);
            setDrawerPulling(true);
            if (toolbarPinned) {
                toolbarPinned = false;
                toolbar.classList.remove('pinned');
                document.getElementById('btn-pin')?.classList.remove('active');
            }
        } else {
            expandToolbar();
        }
    }

    if (toolbarHandle && toolbar) {
        toolbarHandle.addEventListener('mouseenter', () => {
            if (!toolbar.classList.contains('expanded') && !toolbarPinned) {
                toolbar.classList.add('hover-preview');
            }
        });
        toolbarHandle.addEventListener('mouseleave', () => {
            if (!toolbar.classList.contains('expanded')) {
                toolbar.classList.remove('hover-preview');
            }
        });
        toolbarHandle.addEventListener('focusin', () => {
            if (!toolbar.classList.contains('expanded') && !toolbarPinned) {
                toolbar.classList.add('hover-preview');
            }
        });
        toolbarHandle.addEventListener('focusout', () => {
            if (!toolbar.classList.contains('expanded')) {
                toolbar.classList.remove('hover-preview');
            }
        });
        toolbarHandle.addEventListener('click', (e) => {
            if (toolbarNotchSlot?.classList.contains('toolbar-chrome-hidden')) return;
            if (e.target.closest('#btn-handle-fullscreen')) return;
            e.preventDefault();
            toggleToolbar();
        });
        toolbarHandle.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (e.target.closest('#btn-handle-fullscreen')) return;
            e.preventDefault();
            toggleToolbar();
        });
    }

    // Legacy compatibility shims — older code paths call these to surface the
    // status while overlays are visible. They now drive expand/collapse only,
    // never an auto-hide timer.
    function showToolbar() {
        if (toolbarNotchSlot?.classList.contains('toolbar-chrome-hidden')) return;
        expandToolbar();
    }

    let toolbarChromeExiting = false;

    function forceCollapseToolbar() {
        toolbarPinned = false;
        toolbar.classList.remove('expanded', 'pinned', 'hover-preview', 'drawer-pulling');
        document.getElementById('btn-pin')?.classList.remove('active');
        syncToolbarHandleAria(false);
        syncExpandControlIcon(false);
        clearTimeout(drawerPullTimer);
        drawerPullTimer = null;
    }

    function setToolbarChromeVisible(visible) {
        if (!toolbarNotchSlot) return;
        const wasHidden = toolbarNotchSlot.classList.contains('toolbar-chrome-hidden');

        if (!visible) {
            if (wasHidden || toolbarChromeExiting) return;
            const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (reducedMotion) {
                toolbarNotchSlot.classList.add('toolbar-chrome-hidden');
                forceCollapseToolbar();
                toolbarNotchSlot.classList.remove('toolbar-chrome-enter', 'toolbar-chrome-exit');
                return;
            }
            toolbarChromeExiting = true;
            playToolbarChromeExit(() => {
                toolbarNotchSlot.classList.add('toolbar-chrome-hidden');
                forceCollapseToolbar();
                toolbarNotchSlot.classList.remove('toolbar-chrome-enter', 'toolbar-chrome-exit');
                toolbarChromeExiting = false;
            });
            return;
        }

        toolbarChromeExiting = false;
        toolbarNotchSlot.classList.remove('toolbar-chrome-hidden', 'toolbar-chrome-exit');
        if (wasHidden) playToolbarChromeEnter();
    }

    function playToolbarChromeExit(done) {
        if (!toolbarNotchSlot) {
            done?.();
            return;
        }
        toolbarNotchSlot.classList.remove('toolbar-chrome-enter');
        void toolbarNotchSlot.offsetWidth;
        toolbarNotchSlot.classList.add('toolbar-chrome-exit');

        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            toolbarNotchSlot.classList.remove('toolbar-chrome-exit');
            toolbarNotchSlot.removeEventListener('animationend', onEnd);
            clearTimeout(fallback);
            done?.();
        };

        const onEnd = (ev) => {
            if (ev.target !== toolbarNotchSlot) return;
            finish();
        };

        toolbarNotchSlot.addEventListener('animationend', onEnd);
        const fallback = setTimeout(finish, 420);
    }

    function playToolbarChromeEnter() {
        if (!toolbarNotchSlot) return;
        toolbarNotchSlot.classList.remove('toolbar-chrome-enter');
        void toolbarNotchSlot.offsetWidth;
        toolbarNotchSlot.classList.add('toolbar-chrome-enter');
        const onEnd = (ev) => {
            if (ev.target !== toolbarNotchSlot && !ev.target.classList.contains('toolbar-handle')) return;
            toolbarNotchSlot.classList.remove('toolbar-chrome-enter');
            toolbarNotchSlot.removeEventListener('animationend', onEnd);
        };
        toolbarNotchSlot.addEventListener('animationend', onEnd);
        setTimeout(() => toolbarNotchSlot.classList.remove('toolbar-chrome-enter'), 500);
    }

    /** Show notch only during active streaming; hidden on login/connect overlays. */
    function syncToolbarChrome(session) {
        if (!session || !isActive(session) || session.state !== 'streaming') {
            setToolbarChromeVisible(false);
            return;
        }
        setToolbarChromeVisible(true);
        if (!toolbarPinned) collapseToolbar();
    }

    // Keep toolbar chrome in sync when session ends (disconnect / error / idle).
    function hideToolbarChromeForSession(session) {
        if (!session || !isActive(session)) return;
        setToolbarChromeVisible(false);
    }

    function setToolbarAutoHide(enable) {
        if (enable) {
            syncToolbarChrome(getActiveSession());
        } else {
            setToolbarChromeVisible(false);
        }
    }

    // ---- Independent "back to devices" navigation ----
    // The rdclient page is opened as a script-launched tab (window.open) from
    // the web panel. Navigating THIS tab to /devices spawned duplicate panel
    // tabs that accumulated over time. Instead, close this tab and re-focus the
    // opener; only fall back to navigation when there is no opener (e.g. the
    // page was opened directly via URL).
    function isRdClientDesktop() {
        if (window.__BETTERDESK_RDCLIENT_DESKTOP__) return true;
        return !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');
    }

    function returnToDevices() {
        if (isRdClientDesktop()) {
            const invoke = window.__TAURI__?.core?.invoke;
            if (invoke) {
                invoke('close_current_window').catch(() => {
                    window.__TAURI__?.window?.getCurrentWindow?.()?.close?.().catch(() => {});
                });
                return;
            }
            // Desktop shell injected flag but IPC not ready — never navigate to /devices.
            if (window.__BETTERDESK_RDCLIENT_DESKTOP__ && /\/remote\/[^/?#]+/.test(location.pathname)) {
                return;
            }
        }

        try {
            if (window.opener && !window.opener.closed) {
                try { window.opener.focus(); } catch { /* ignore */ }
                window.close();
                // If the browser blocked window.close() (not script-opened),
                // fall through to navigation after a short delay.
                setTimeout(() => {
                    if (!window.closed) window.location.href = '/devices';
                }, 150);
                return;
            }
        } catch { /* ignore */ }
        window.location.href = '/devices';
    }

    // ---- Automatic clipboard sync (local -> remote) ----
    // Native RustDesk pushes the controlling side's clipboard to the peer
    // automatically, so a plain Ctrl+V on the remote pastes local content.
    // The browser cannot observe clipboard changes, but it can read the
    // clipboard once the tab regains focus (with transient activation), so we
    // push the current local clipboard to the active streaming session then.
    let _lastSyncedClipboard = '';
    async function syncLocalClipboardToRemote() {
        const session = getActiveSession();
        if (!session || !session.client || session.state !== 'streaming') return;
        if (session.client.viewOnly) return;
        if (!navigator.clipboard || !navigator.clipboard.readText) return;
        try {
            const text = await navigator.clipboard.readText();
            if (text && text !== _lastSyncedClipboard) {
                _lastSyncedClipboard = text;
                session.client.sendClipboard(text);
            }
        } catch {
            // Permission denied or not focused — ignore, the manual paste
            // button remains available as a fallback.
        }
    }
    window.addEventListener('focus', syncLocalClipboardToRemote);
    if (viewerContainer) {
        viewerContainer.addEventListener('mousedown', syncLocalClipboardToRemote);
    }


    // ---- Tab Bar (slim + expandable cards) ----

    const sessionTabBarEl = document.getElementById('session-tab-bar');
    let expandedTabId = null;

    function collapseExpandedTabBarItems() {
        tabBar.querySelectorAll('.session-tab-card.is-expanded').forEach((t) => t.classList.remove('is-expanded'));
        document.getElementById('btn-back-devices')?.classList.remove('is-expanded');
        document.getElementById('btn-add-session')?.classList.remove('is-expanded');
        expandedTabId = null;
    }

    // Tab status: one tone per state (data display): connecting = waiting,
    // connected = good, failed = danger, ended = neutral. The word is in the
    // tab's accessible name and its tooltip; the mark's shape tells them apart.
    const TAB_STATUS_CLASSES = ['status-online', 'status-connecting', 'status-error', 'status-offline'];

    function tabStatusFor(session) {
        if (!session) return { tone: 'neutral', cls: 'status-offline', label: t('remote_viewer.tab_ended', 'Ended') };
        switch (session.view) {
        case 'streaming':
            return { tone: 'good', cls: 'status-online', label: t('remote.streaming', 'Connected') };
        case 'failed':
            return { tone: 'danger', cls: 'status-error', label: t('remote_viewer.tab_failed', 'Could not connect') };
        case 'ended':
            return { tone: 'neutral', cls: 'status-offline', label: t('remote_viewer.tab_ended', 'Ended') };
        case 'password':
            return { tone: 'waiting', cls: 'status-connecting', label: t('remote_viewer.tab_password', 'Needs a password') };
        default:
            return { tone: 'waiting', cls: 'status-connecting', label: t('remote_viewer.tab_connecting', 'Connecting') };
        }
    }

    function tabDomId(deviceId) { return 'rd-tab-' + String(deviceId).replace(/[^A-Za-z0-9_-]/g, '_'); }
    function panelDomId(deviceId) { return 'rd-panel-' + String(deviceId).replace(/[^A-Za-z0-9_-]/g, '_'); }

    function createTab(deviceId, deviceName) {
        const tab = document.createElement('div');
        tab.className = 'session-tab session-tab-card status-connecting';
        tab.dataset.sessionId = deviceId;
        tab.setAttribute('role', 'presentation');

        const inner = document.createElement('div');
        inner.className = 'session-tab-card-inner';
        inner.setAttribute('role', 'presentation');

        const select = document.createElement('button');
        select.type = 'button';
        select.className = 'session-tab-select';
        select.id = tabDomId(deviceId);
        select.setAttribute('role', 'tab');
        select.setAttribute('aria-selected', 'false');
        select.setAttribute('aria-controls', panelDomId(deviceId));
        select.tabIndex = -1;

        const dot = document.createElement('span');
        dot.className = 'status is-waiting session-tab-dot';
        dot.setAttribute('aria-hidden', 'true');
        select.appendChild(dot);

        const label = document.createElement('span');
        label.className = 'session-tab-label';
        label.textContent = deviceName || deviceId;
        select.appendChild(label);

        const stateText = document.createElement('span');
        stateText.className = 'session-tab-state sr-only';
        stateText.textContent = ', ' + t('remote_viewer.tab_connecting', 'Connecting');
        select.appendChild(stateText);
        inner.appendChild(select);

        // Pointer users close with the ×; keyboard users press Delete on the tab
        // (the button stays out of the tab order, so the tab list only holds tabs).
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'icon-btn session-tab-close';
        closeBtn.tabIndex = -1;
        closeBtn.setAttribute('aria-hidden', 'true');
        closeBtn.innerHTML = '<span class="material-icons" aria-hidden="true">close</span>';
        closeBtn.title = fmt('remote_viewer.close_tab_named', 'Close {name}', { name: deviceName || deviceId });
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeSession(deviceId);
        });
        inner.appendChild(closeBtn);

        tab.appendChild(inner);

        select.addEventListener('click', () => {
            switchSession(deviceId);
            if (window.matchMedia('(hover: none)').matches) {
                collapseExpandedTabBarItems();
                tab.classList.add('is-expanded');
                expandedTabId = deviceId;
            }
        });
        select.addEventListener('keydown', onTabKeydown);

        tabBar.appendChild(tab);
        refreshTab(sessions.get(deviceId) || null, deviceId);
    }

    // Arrow keys move between tabs (and open them), Home/End jump, Delete closes.
    function onTabKeydown(e) {
        const tabs = Array.from(tabBar.querySelectorAll('[role="tab"]'));
        const i = tabs.indexOf(e.currentTarget);
        if (i < 0) return;
        const rtl = document.documentElement.dir === 'rtl';
        let next = -1;
        switch (e.key) {
        case 'ArrowRight': next = rtl ? i - 1 : i + 1; break;
        case 'ArrowLeft': next = rtl ? i + 1 : i - 1; break;
        case 'Home': next = 0; break;
        case 'End': next = tabs.length - 1; break;
        case 'Delete': {
            e.preventDefault();
            e.stopPropagation();
            const id = e.currentTarget.closest('.session-tab')?.dataset.sessionId;
            const neighbour = tabs[i + 1] || tabs[i - 1] || null;
            if (id) closeSession(id);
            if (neighbour && neighbour.isConnected) neighbour.focus();
            return;
        }
        default: return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (next < 0) next = tabs.length - 1;
        if (next >= tabs.length) next = 0;
        const target = tabs[next];
        const id = target.closest('.session-tab')?.dataset.sessionId;
        if (id) switchSession(id);
        target.focus();
    }

    function refreshTab(session, deviceId) {
        const id = session ? session.deviceId : deviceId;
        const tab = findTab(id);
        if (!tab) return;
        const st = tabStatusFor(session);
        tab.classList.remove(...TAB_STATUS_CLASSES);
        tab.classList.add(st.cls);
        const dot = tab.querySelector('.session-tab-dot');
        if (dot) dot.className = 'status is-' + st.tone + ' session-tab-dot';
        const stateText = tab.querySelector('.session-tab-state');
        if (stateText) stateText.textContent = ', ' + st.label;
        const name = session ? deviceLabel(session) : id;
        const label = tab.querySelector('.session-tab-label');
        if (label && label.textContent !== name) label.textContent = name;
        const select = tab.querySelector('.session-tab-select');
        if (select) select.title = name + (name !== id ? ' (' + id + ')' : '') + ' · ' + st.label;
        const closeBtn = tab.querySelector('.session-tab-close');
        if (closeBtn) closeBtn.title = fmt('remote_viewer.close_tab_named', 'Close {name}', { name });
    }

    // Kept for callers that pass a transport state: the tab follows session.view
    function updateTabState(deviceId) {
        refreshTab(sessions.get(deviceId) || null, deviceId);
    }

    function setActiveTab(deviceId) {
        tabBar.querySelectorAll('.session-tab').forEach((tb) => {
            tb.classList.remove('active');
            const sel = tb.querySelector('.session-tab-select');
            if (sel) {
                sel.setAttribute('aria-selected', 'false');
                sel.tabIndex = -1;
            }
        });
        const tab = findTab(deviceId);
        if (tab) {
            tab.classList.add('active');
            const sel = tab.querySelector('.session-tab-select');
            if (sel) {
                sel.setAttribute('aria-selected', 'true');
                sel.tabIndex = 0;
            }
            if (typeof tab.scrollIntoView === 'function') tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    function findTab(deviceId) {
        return tabBar.querySelector('[data-session-id="' + CSS.escape(deviceId) + '"]');
    }

    function bindSlimTabBar() {
        if (!sessionTabBarEl) return;

        ['btn-back-devices', 'btn-add-session'].forEach((id) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('click', () => {
                if (window.matchMedia('(hover: none)').matches) {
                    collapseExpandedTabBarItems();
                    btn.classList.add('is-expanded');
                }
            }, { capture: true });
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#session-tab-bar')) {
                collapseExpandedTabBarItems();
            }
        });
    }

    // ---- Session Lifecycle ----

    function deviceLabel(session) {
        return (session && (session.deviceName || session.deviceId)) || '';
    }

    function isRemoteTargetId(deviceId) {
        return String(deviceId || '').startsWith('rt_');
    }

    // Name, system mark and ID (with copy) at the top of every state screen
    function fillDeviceHeader(session) {
        const name = deviceLabel(session);
        const panel = session.panel;
        panel.querySelectorAll('.session-device-name, .session-device-name-copy').forEach((el) => { el.textContent = name; });
        const idHtml = (window.Utils && Utils.valueHtml)
            ? Utils.valueHtml(session.deviceId, { copy: true, label: fmt('remote_viewer.device_id_named', 'ID of {name}', { name }) })
            : '';
        panel.querySelectorAll('.session-device-label, .session-device-id-copy').forEach((el) => {
            if (idHtml) el.innerHTML = idHtml;
            else el.textContent = session.deviceId;
            el.hidden = name === session.deviceId && !idHtml;
        });
        const osHtml = (session.platform && window.Utils && Utils.platformHtml) ? Utils.platformHtml(session.platform) : '';
        panel.querySelectorAll('.session-device-os').forEach((el) => {
            el.innerHTML = osHtml;
            el.hidden = !osHtml;
        });
        if (session.canvas) {
            session.canvas.setAttribute('aria-label', fmt('remote_viewer.screen_label', 'Screen of {name}', { name }));
        }
        session.passwordLabel = panel.querySelector('.session-password-label');
        if (session.passwordLabel) {
            session.passwordLabel.textContent = fmt('remote_viewer.password_intro',
                '{name} asks for a password. Use the one set in RustDesk on that device.', { name });
        }
        const tfaLabel = panel.querySelector('.session-2fa-label');
        if (tfaLabel) {
            tfaLabel.textContent = fmt('remote_viewer.tfa_intro',
                '{name} asks for a code from the authenticator app linked to it.', { name });
        }
        const openDevice = panel.querySelector('.session-btn-open-device');
        if (openDevice) {
            openDevice.href = '/devices?open=' + encodeURIComponent(session.deviceId);
            openDevice.hidden = isGuestAccessMode() || isRemoteTargetId(session.deviceId);
        }
        refreshTab(session);
        const chat = session.chatPanel;
        if (chat) chat.setAttribute('aria-label', fmt('remote_viewer.chat_with', 'Chat with {name}', { name }));
    }

    // Name and system for sessions opened from the picker or a link
    function loadDeviceDetails(session) {
        if (isGuestAccessMode() || isRemoteTargetId(session.deviceId)) return;
        if (session.platform && session.deviceName) return;
        fetch('/api/devices/' + encodeURIComponent(session.deviceId), {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
        }).then((r) => (r.ok ? r.json() : null)).then((body) => {
            const d = body && (body.data || body.device);
            if (!d || session.closed) return;
            session.deviceName = session.deviceName && session.deviceName !== session.deviceId
                ? session.deviceName
                : (d.display_name || d.hostname || session.deviceName);
            session.platform = session.platform || d.platform || d.os || '';
            fillDeviceHeader(session);
            renderSteps(session);
            if (session.view === 'connecting' && session.stepId) setStep(session, session.stepId, true);
            if (isActive(session) && currentSheet === 'info') renderSessionInfo();
        }).catch(() => { /* the ID is enough to connect */ });
    }

    function createSession(deviceId, deviceName, platform) {
        if (!isPeerAllowedForGuest(deviceId)) {
            console.warn('Guest access: refused session outside allowlist', deviceId);
            return;
        }
        if (sessions.has(deviceId)) {
            switchSession(deviceId);
            return;
        }

        // Clone template
        const template = document.getElementById('session-panel-template');
        const panel = template.content.firstElementChild.cloneNode(true);

        panel.dataset.deviceId = deviceId;
        panel.id = panelDomId(deviceId);
        panel.setAttribute('aria-labelledby', tabDomId(deviceId));

        viewerContainer.appendChild(panel);

        const session = new SessionInfo(deviceId, deviceName && deviceName !== deviceId ? deviceName : '', panel);
        session.platform = platform || '';

        // The chat is a side sheet beside the screen, like files and session info
        if (session.chatPanel && sheetHost) sheetHost.appendChild(session.chatPanel);

        // Show HTTP / WebCodecs warning once
        if (!RDVideo.isSupported()) {
            const isInsecure = window.location.protocol === 'http:' &&
                window.location.hostname !== 'localhost' &&
                window.location.hostname !== '127.0.0.1';
            if (isInsecure) showHttpWarningBanner();
        }

        sessions.set(deviceId, session);
        createTab(deviceId, session.deviceName);
        fillDeviceHeader(session);
        startConnecting(session);
        switchSession(deviceId);
        loadDeviceDetails(session);

        session.client.renderer.resize();
        session.client.connect().catch(err => {
            failSession(session, err && err.message ? err.message : '');
        });
    }

    function wireNewClient(session) {
        session.client = createTransportClient(session.canvas, buildClientOpts(session));
        if (typeof session.client.setBackgroundFps === 'function') {
            session.client.setBackgroundFps((session.viewerPrefs || globalViewerPrefs).backgroundFps || 1);
        }
        wireSessionEvents(session);
        if (!session.domWired) {
            wireSessionDomEvents(session);
            session.domWired = true;
        }
        attachMobileTouch(session);
    }

    function switchSession(deviceId) {
        if (!sessions.has(deviceId)) return;
        const previous = activeSessionId;
        activeSessionId = deviceId;
        const session = sessions.get(deviceId);

        // Hide all, show active
        viewerContainer.querySelectorAll('.session-panel').forEach(p => {
            p.style.display = 'none';
        });
        session.panel.style.display = '';

        setActiveTab(deviceId);
        toolbarDeviceId.textContent = deviceId;

        // Files belong to one session; chat and info follow the tab
        if (previous !== deviceId) {
            if (currentSheet === 'files') closeSheet();
            else if (currentSheet === 'chat') openSheet('chat');
            else if (currentSheet === 'info') renderSessionInfo();
        }

        // Sync toolbar state
        syncToolbarToSession(session);
        syncToolbarFromSession(session);

        if (session.state === 'streaming') {
            session.canvas.focus();
            session.client.renderer.resize();
        }
        syncToolbarChrome(session);

        syncSessionMediaCapture();

        if (session.state === 'streaming' && session.client) {
            session.client.setAudioMuted(session.audioMuted);
        }
        syncMobileTouchForActive();

        if (typeof window.BillingReport !== 'undefined') {
            window.BillingReport.refreshToolbarPackage(deviceId).catch(() => {});
        }
    }

    function closeSession(deviceId, options) {
        options = options || {};
        const session = sessions.get(deviceId);
        if (!session) {
            const tab = findTab(deviceId);
            if (tab) tab.remove();
            return;
        }

        session.closed = true;
        clearStepTimer(session);
        if (session.endTimer) clearTimeout(session.endTimer);
        try { if (session.client) session.client.disconnect(); } catch { /* ignore */ }
        if (window.__fileTransferModal?.isOpen() &&
            window.__fileTransferModal._session?.deviceId === deviceId) {
            window.__fileTransferModal.close();
        }
        if (session.mediaRecorder && session.mediaRecorder.state === 'recording') {
            try { session.mediaRecorder.stop(); } catch { /* ignore */ }
        }

        if (session.panel) session.panel.remove();
        if (session.chatPanel) session.chatPanel.remove();
        const tab = findTab(deviceId);
        if (tab) tab.remove();
        sessions.delete(deviceId);

        if (expandedTabId === deviceId) expandedTabId = null;

        if (activeSessionId === deviceId) {
            activeSessionId = null;
            if (sessions.size > 0) {
                switchSession(sessions.keys().next().value);
            } else {
                closeSheet();
                if (!options.suppressReturn) returnToDevices();
            }
        } else {
            syncSessionMediaCapture();
        }
    }

    function closeAllSessions() {
        Array.from(sessions.keys()).forEach((id) => closeSession(id, { suppressReturn: true }));
    }

    function reconnectSession(session) {
        const old = session.client;
        session.client = null;
        try { if (old) old.disconnect(); } catch { /* ignore */ }
        session.passwordOverlay.style.display = 'none';
        if (session.tfaOverlay) session.tfaOverlay.style.display = 'none';
        if (session.cdapFallbackBtn) session.cdapFallbackBtn.style.display = 'none';
        if (typeof window.BillingReport !== 'undefined' && window.BillingReport.hideBillingPane) {
            window.BillingReport.hideBillingPane(session.panel);
        }
        const autoplay = session.panel.querySelector('.autoplay-overlay');
        if (autoplay) autoplay.style.display = 'none';

        startConnecting(session);
        session.client.renderer.resize();
        session.client.connect().catch(err => {
            failSession(session, err && err.message ? err.message : '');
        });
    }

    // A fresh client and the connecting screen at step one
    function startConnecting(session) {
        session.state = 'connecting';
        session.everStreamed = false;
        session.connectedAt = null;
        session.endedBy = '';
        session.endInfo = null;
        session.endPending = false;
        session.lastError = '';
        session.encryptionWarning = '';
        session.panel.classList.remove('streaming');
        wireNewClient(session);
        showView(session, 'connecting');
        setStep(session, 'find', true);
    }

    function getActiveSession() {
        return activeSessionId ? sessions.get(activeSessionId) : null;
    }

    // ---- Wire session events ----

    function wireSessionEvents(session) {
        const c = session.client;
        // Events from a client this session has replaced (reconnect) or closed are ignored
        const live = () => session.client === c && !session.closed;

        c.on('state', (state) => {
            if (!live()) return;
            session.state = state;
            if (isActive(session)) {
                if (state !== 'streaming') hideToolbarChromeForSession(session);
                syncToolbarToSession(session);
            }
            handleSessionState(session, state);
        });

        c.on('log', (msg) => {
            if (!live()) return;
            if (session.view !== 'connecting') return;
            const step = stepFromLog(msg);
            if (step) setStep(session, step);
        });

        c.on('step', (step) => {
            if (!live() || session.view !== 'connecting') return;
            setStep(session, step);
        });

        c.on('error', (msg, meta) => {
            if (!live()) return;
            const text = msg && typeof msg === 'object' ? (msg.message || '') : (msg || '');
            failSession(session, text, meta);
            if (meta && meta.cdapFallback) showCdapFallback(session);
        });

        c.on('cdap_fallback_available', () => {
            if (!live()) return;
            showCdapFallback(session);
        });

        c.on('disconnected', (reason, info) => {
            if (!live()) return;
            // A failure already on screen keeps its own message
            if (session.view === 'failed') return;
            session.endInfo = {
                reason: typeof reason === 'string' ? reason : '',
                meta: info || null,
                at: Date.now(),
                step: session.stepId,
            };
            finishEnd(session);
            const autoplay = session.panel.querySelector('.autoplay-overlay');
            if (autoplay) autoplay.style.display = 'none';
        });

        c.on('password_required', () => {
            if (!live()) return;
            setStep(session, 'signin');
            showView(session, 'password');
            session.loginError.style.display = 'none';
            session.passwordInput.value = '';
            var applySaved = function (saved) {
                if (saved) {
                    session.passwordInput.value = saved;
                    if (session.rememberPeerCheckbox) session.rememberPeerCheckbox.checked = true;
                }
                if (isActive(session)) session.passwordInput.focus();
            };
            var localPromise = (window.RdClientSecureStore && session.deviceId)
                ? window.RdClientSecureStore.loadPeerPassword(session.deviceId).catch(function () { return ''; })
                : Promise.resolve('');
            var orgPromise = session.deviceId && !window.__mockRemote
                ? fetch('/api/devices/' + encodeURIComponent(session.deviceId) + '/connect-password', {
                    credentials: 'same-origin',
                    headers: { 'Accept': 'application/json' }
                }).then(function (r) {
                    if (!r.ok) return '';
                    return r.json().then(function (body) {
                        return (body && body.password) ? String(body.password) : '';
                    });
                }).catch(function () { return ''; })
                : Promise.resolve('');
            Promise.all([localPromise, orgPromise]).then(function (pair) {
                applySaved(pair[0] || pair[1] || '');
            });
            if (isActive(session)) setToolbarChromeVisible(false);
        });

        c.on('login_error', (error) => {
            if (!live()) return;
            if (session.state === 'waiting_2fa' || session.tfaOverlay.style.display === 'flex') {
                session.tfaError.textContent = error;
                session.tfaError.style.display = 'block';
                session.tfaInput.value = '';
                if (isActive(session)) session.tfaInput.focus();
                return;
            }
            showView(session, 'password');
            session.loginError.textContent = loginErrorText(error);
            session.loginError.style.display = 'block';
            session.passwordInput.value = '';
            if (isActive(session)) session.passwordInput.focus();
        });

        c.on('certificate_required', async (details) => {
            if (!live()) return;
            const fingerprint = String(details?.fingerprint || '');
            if (!fingerprint) return;
            const accepted = window.confirm(
                t('remote.certificate_confirm',
                    'The remote certificate is not trusted. Trust fingerprint ' + fingerprint + '?')
            );
            if (!accepted) return;
            try {
                await Utils.api('/api/remote-targets/' + encodeURIComponent(session.deviceId) + '/certificate/accept', {
                    method: 'POST',
                    body: { fingerprint }
                });
                c.disconnect();
                c.connect();
            } catch (error) {
                failSession(session, error.message || 'Certificate was not trusted');
            }
        });

        c.on('2fa_error', (error) => {
            if (!live()) return;
            showView(session, 'tfa');
            session.tfaError.textContent = error || (_('remote.2fa_invalid') || 'Invalid code');
            session.tfaError.style.display = 'block';
            session.tfaInput.value = '';
            if (isActive(session)) session.tfaInput.focus();
            if (isActive(session)) setToolbarChromeVisible(false);
        });

        c.on('2fa_required', () => {
            if (!live()) return;
            setStep(session, 'signin');
            showView(session, 'tfa');
            session.tfaError.style.display = 'none';
            session.tfaInput.value = '';
            if (isActive(session)) session.tfaInput.focus();
            if (isActive(session)) setToolbarChromeVisible(false);
        });

        c.on('login_success', () => {
            if (!live()) return;
            session.passwordOverlay.style.display = 'none';
            session.tfaOverlay.style.display = 'none';
            session.passwordInput.blur();
            if (session.view === 'password' || session.view === 'tfa') showView(session, 'connecting');
            setStep(session, 'screen');
            if (window.RdClientSecureStore && session.rememberPeerCheckbox) {
                var pw = session.passwordInput.value;
                if (session.rememberPeerCheckbox.checked && pw) {
                    window.RdClientSecureStore.savePeerPassword(session.deviceId, pw).catch(function () { /* ignore */ });
                } else if (!session.rememberPeerCheckbox.checked) {
                    window.RdClientSecureStore.clearPeerPassword(session.deviceId).catch(function () { /* ignore */ });
                }
            }
        });

        c.on('session_start', () => {
            if (!live()) return;
            showView(session, 'streaming');
            session.client.renderer.resize();
            if (isActive(session)) {
                applyViewerPrefsToClient(session.client, session.viewerPrefs);
            }
            syncSessionMediaCapture();
            if (isActive(session)) {
                session.canvas.focus();
                syncToolbarChrome(session);
                try { refreshMonitorButton(session); } catch { /* not ready */ }
            }
            if (session.client.video) {
                session.client.video.onAutoplayBlocked = () => {
                    if (isActive(session)) showAutoplayOverlay(session);
                };
            }
            if (window.__openFilePanelOnConnect && isActive(session)) {
                window.__openFilePanelOnConnect = false;
                openSheet('files');
            }
        });

        c.on('stats', (stats) => {
            session.lastStats = stats;
        });

        c.on('diagnostics', (diagnostics) => {
            session.lastDiagnostics = diagnostics;
            if (window.BetterDesk && window.BetterDesk.debugRelay === true) {
                console.info('[Remote] Session diagnostics:', diagnostics);
            }
        });

        c.on('latency', (rtt) => { session.latency = rtt; });

        c.on('chat', (text) => addChatMessage(session, text, 'received'));

        // CDAP transport: agent emits `monitors` after `monitor_list`. Show
        // the toolbar dropdown on multi-display agents and refresh contents.
        c.on('monitors', (list) => {
            if (!live()) return;
            const btn = document.getElementById('btn-monitors');
            if (btn) btn.style.display = (Array.isArray(list) && list.length > 1) ? '' : 'none';
            if (isActive(session)) {
                try { updateMonitorMenu(); } catch { /* menu not yet built */ }
            }
        });

        // Native RustDesk transport: the rdclient emits `peer_info` once the
        // login completes. Reveal the monitors dropdown when the peer has more
        // than one display OR supports virtual displays, then rebuild it.
        c.on('peer_info', (info) => {
            if (!live()) return;
            if (info && !session.platform && (info.platform || info.os)) {
                session.platform = String(info.platform || info.os);
                fillDeviceHeader(session);
            }
            if (isActive(session)) {
                try { refreshMonitorButton(session); } catch { /* not ready */ }
                try { updateWindowsSessionMenu(session); } catch { /* not ready */ }
            }
        });
        c.on('display_switched', () => {
            if (isActive(session)) {
                try { updateMonitorMenu(); } catch { /* menu not yet built */ }
                try { refreshMonitorButton(session); } catch { /* not ready */ }
            }
        });
        c.on('virtual_display_toggled', () => {
            if (isActive(session)) {
                try { updateMonitorMenu(); } catch { /* menu not yet built */ }
            }
        });

        // Security events: show warnings for E2E encryption issues
        c.on('signature_warning', (msg) => {
            console.warn('[Remote] Signature warning:', msg);
            session.encryptionWarning = msg || '';
            showSecurityWarning(session, msg, 'warning');
        });
        c.on('encryption_warning', (msg) => {
            console.warn('[Remote] Encryption warning:', msg);
            session.encryptionWarning = msg || '';
            showSecurityWarning(session, msg, 'error');
        });
    }

    /**
     * Show a security warning banner in the session panel
     */
    function showSecurityWarning(session, message, level) {
        let banner = session.panel.querySelector('.security-warning-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.className = 'security-warning-banner security-' + level;
            banner.setAttribute('role', 'alert');
            banner.innerHTML = '<span class="security-warning-text"></span>'
                + '<button type="button" class="icon-btn security-warning-dismiss" aria-label="' + escapeHtml(t('actions.dismiss', 'Dismiss')) + '">'
                + '<span class="material-icons" aria-hidden="true">close</span></button>';
            banner.querySelector('.security-warning-dismiss').addEventListener('click', () => banner.remove());
            session.panel.appendChild(banner);
        }
        banner.querySelector('.security-warning-text').textContent = message;
    }

    function wireSessionDomEvents(session) {
        session.panel.querySelector('.session-btn-reconnect')
            ?.addEventListener('click', () => reconnectSession(session));

        session.panel.querySelector('.session-btn-cdap-fallback')
            ?.addEventListener('click', () => {
                window.location.href = '/remote-cdap/' + encodeURIComponent(session.deviceId);
            });

        session.panel.querySelector('.session-btn-close-tab')
            ?.addEventListener('click', () => closeSession(session.deviceId));

        // Cancel while connecting or at the password / code prompt
        session.panel.querySelectorAll('.session-btn-cancel, .session-btn-auth-cancel').forEach((btn) => {
            btn.addEventListener('click', () => cancelSession(session));
        });

        session.panel.querySelector('.session-btn-copy-details')
            ?.addEventListener('click', async () => {
                const text = detailsText(session);
                let ok = false;
                try { ok = await Utils.copyToClipboard(text); } catch { ok = false; }
                showToast(ok ? t('common.copied', 'Copied to clipboard')
                    : t('common.copy_failed', 'Could not copy. Select the text and copy it yourself.'), ok ? 'success' : 'error');
            });

        session.panel.querySelector('.session-btn-authenticate')
            ?.addEventListener('click', () => {
                const pw = session.passwordInput.value;
                if (!pw) { session.passwordInput.focus(); return; }
                session.loginError.style.display = 'none';
                if (session.client) session.client.authenticate(pw);
            });

        session.passwordInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                session.panel.querySelector('.session-btn-authenticate')?.click();
            }
        });

        // 2FA verification
        session.panel.querySelector('.session-btn-verify-2fa')
            ?.addEventListener('click', () => {
                const code = session.tfaInput.value.replace(/\s/g, '');
                if (!code || code.length !== 6) {
                    session.tfaError.textContent = _('remote.2fa_invalid') || 'Enter a valid 6-digit code';
                    session.tfaError.style.display = 'block';
                    session.tfaInput.focus();
                    return;
                }
                session.tfaError.style.display = 'none';
                if (session.client) session.client.submit2FA(code);
            });

        session.tfaInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                session.panel.querySelector('.session-btn-verify-2fa')?.click();
            }
        });

        // Only allow digits in 2FA input
        session.tfaInput?.addEventListener('input', () => {
            session.tfaInput.value = session.tfaInput.value.replace(/[^0-9]/g, '');
        });

        session.chatPanel?.querySelector('.session-btn-chat-close')
            ?.addEventListener('click', () => closeSheet());

        session.chatPanel?.querySelector('.session-btn-chat-send')
            ?.addEventListener('click', () => sendChat(session));

        session.chatInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendChat(session);
            if (e.key === 'Escape') { closeSheet(); return; }
            e.stopPropagation();
        });
    }

    // ---- Session state helpers ----

    function isActive(session) {
        return session.deviceId === activeSessionId;
    }

    /**
     * Keep keyboard/mouse capture, inbound clipboard, and audio scoped to the
     * active streaming tab so background sessions cannot receive input.
     */
    function syncSessionMediaCapture() {
        if (typeof window.syncSessionMediaCapture === 'function') {
            window.syncSessionMediaCapture(sessions, activeSessionId);
        }
    }

    function handleSessionState(session, state) {
        switch (state) {
        case 'connecting':
            if (session.view !== 'connecting') showView(session, 'connecting');
            if (isActive(session)) setToolbarChromeVisible(false);
            break;
        case 'waiting_password':
            // RDClient waits here for the device's answer (a password request,
            // or someone accepting on the device) after the relay is set up.
            if (session.view === 'connecting') setStep(session, 'accept');
            break;
        case 'authenticating':
        case 'waiting_2fa':
            if (session.view === 'connecting') setStep(session, 'signin');
            break;
        case 'streaming':
            session.everStreamed = true;
            if (!session.connectedAt) session.connectedAt = Date.now();
            showView(session, 'streaming');
            session.panel.classList.add('streaming');
            syncSessionMediaCapture();
            attachMobileTouch(session);
            syncMobileTouchForActive();
            if (isActive(session)) syncToolbarChrome(session);
            break;
        case 'disconnected':
        case 'error':
            session.panel.classList.remove('streaming');
            if (isActive(session)) setToolbarChromeVisible(false);
            if (state === 'error') {
                // The error event came first and already said what happened
                if (session.view !== 'failed') failSession(session, session.lastError || '');
                break;
            }
            if (session.view === 'failed' || session.view === 'ended') break;
            // RDClient sends the reason right after this state; wait one tick for it
            session.endPending = true;
            if (session.endTimer) clearTimeout(session.endTimer);
            session.endTimer = setTimeout(() => finishEnd(session), 0);
            break;
        }
        refreshTab(session);
    }

    // ---- Connection states in plain words ----

    const STEP_IDS = ['find', 'route', 'accept', 'signin', 'screen'];
    const SLOW_AFTER_MS = 8000;

    function stepStrings(session, id) {
        const name = deviceLabel(session);
        const throughServer = getTransportName() !== 'rd';
        const S = {
            find: {
                label: ['remote_viewer.step_find', 'Find {name} on the server'],
                now: ['remote_viewer.now_find', 'Looking for {name} on the server.'],
                slow: ['remote_viewer.slow_find', 'This takes long when the server is busy or this browser cannot reach it. Check the server address and your network.'],
            },
            route: {
                label: throughServer
                    ? ['remote_viewer.step_route_server', 'Connect through the server']
                    : ['remote_viewer.step_route', 'Connect through the relay server'],
                now: throughServer
                    ? ['remote_viewer.now_route_server', 'Setting up the connection through the server.']
                    : ['remote_viewer.now_route', 'Setting up the connection through the relay server.'],
                slow: ['remote_viewer.slow_route', 'This takes long when the relay server is slow or a firewall blocks it.'],
            },
            accept: {
                label: ['remote_viewer.step_accept', 'Wait for {name} to answer'],
                now: ['remote_viewer.now_accept', 'Waiting for {name} to answer.'],
                slow: ['remote_viewer.slow_accept', '{name} may be asleep, or someone has to accept the connection on the device. Ask them to click Accept.'],
            },
            signin: {
                label: ['remote_viewer.step_signin', 'Sign in, if the device asks for a password'],
                now: ['remote_viewer.now_signin', 'Signing in to {name}.'],
                slow: ['remote_viewer.slow_signin', 'Signing in takes long when the device is busy.'],
            },
            screen: {
                label: ['remote_viewer.step_screen', 'Receive the screen'],
                now: ['remote_viewer.now_screen', 'Waiting for the first picture from {name}.'],
                slow: ['remote_viewer.slow_screen', 'The device is starting its screen capture. On a slow network this takes a moment.'],
            },
        };
        const e = S[id] || S.find;
        return {
            label: fmt(e.label[0], e.label[1], { name }),
            now: fmt(e.now[0], e.now[1], { name }),
            slow: fmt(e.slow[0], e.slow[1], { name }),
        };
    }

    // Transport log lines to steps (RDClient, CDAP, mesh and the gateway all log in English)
    function stepFromLog(msg) {
        const m = String(msg || '').toLowerCase();
        if (/login successful|no password required|video codec|streaming/.test(m)) return 'screen';
        if (/authenticat|password required|2fa|verifying/.test(m)) return 'signin';
        if (/handshake|peer identified|key exchange|consent|accept/.test(m)) return 'accept';
        if (/relay|tunnel|desktop session|gateway/.test(m)) return 'route';
        if (/protocol|rendezvous|requesting connection|loading/.test(m)) return 'find';
        return null;
    }

    function clearStepTimer(session) {
        if (session.slowTimer) {
            clearTimeout(session.slowTimer);
            session.slowTimer = null;
        }
    }

    function setStep(session, id, force) {
        if (!STEP_IDS.includes(id)) return;
        const cur = STEP_IDS.indexOf(session.stepId);
        const next = STEP_IDS.indexOf(id);
        if (!force && cur >= next) return;
        if (session.stepId !== id || force) {
            session.stepId = id;
            session.stepStartedAt = Date.now();
        }
        renderSteps(session);
        if (session.view === 'connecting') {
            session.statusText.textContent = stepStrings(session, id).now;
            const hint = session.panel.querySelector('.session-slow-hint');
            if (hint) hint.hidden = true;
            clearStepTimer(session);
            session.slowTimer = setTimeout(() => {
                if (session.closed || session.view !== 'connecting' || session.stepId !== id) return;
                const h = session.panel.querySelector('.session-slow-hint');
                if (h) {
                    h.textContent = stepStrings(session, id).slow;
                    h.hidden = false;
                }
            }, SLOW_AFTER_MS);
        }
    }

    // Steps with a status mark each: done (good), now (waiting), stopped (danger), still to come (neutral)
    function renderSteps(session) {
        const list = session.panel.querySelector('.session-steps');
        if (!list) return;
        const at = STEP_IDS.indexOf(session.stepId);
        const failed = session.view === 'failed';
        const words = {
            done: t('remote_viewer.step_done', 'done'),
            now: t('remote_viewer.step_now', 'in progress'),
            failed: t('remote_viewer.step_failed', 'stopped here'),
            todo: t('remote_viewer.step_todo', 'not started'),
        };
        list.innerHTML = STEP_IDS.map((id, i) => {
            let tone = 'neutral';
            let word = words.todo;
            let current = '';
            if (i < at) { tone = 'good'; word = words.done; }
            else if (i === at) {
                tone = failed ? 'danger' : 'waiting';
                word = failed ? words.failed : words.now;
                current = ' aria-current="step"';
            }
            const label = escapeHtml(stepStrings(session, id).label);
            return '<li class="rd-step is-' + tone + '"' + current + '><span class="status is-' + tone + '">'
                + label + '<span class="sr-only"> (' + escapeHtml(word) + ')</span></span></li>';
        }).join('');
    }

    // Which overlay shows, and what the tab says
    function showView(session, view) {
        session.view = view;
        // The screen is a tab stop only while it shows the remote device
        if (session.canvas) session.canvas.tabIndex = view === 'streaming' ? 0 : -1;
        const conn = session.connectionOverlay;
        const pw = session.passwordOverlay;
        const tfa = session.tfaOverlay;
        conn.style.display = (view === 'connecting' || view === 'failed' || view === 'ended') ? 'flex' : 'none';
        pw.style.display = view === 'password' ? 'flex' : 'none';
        if (tfa) tfa.style.display = view === 'tfa' ? 'flex' : 'none';
        conn.classList.toggle('is-failed', view === 'failed');
        conn.classList.toggle('is-ended', view === 'ended');
        const connecting = view === 'connecting';
        const result = view === 'failed' || view === 'ended';
        const title = session.panel.querySelector('.session-state-title');
        if (title) {
            // The title carries the state's mark when the steps no longer show it
            title.className = 'rd-state-title session-state-title'
                + (view === 'failed' ? ' status is-danger' : view === 'ended' ? ' status is-neutral' : '');
            if (connecting) title.textContent = t('remote_viewer.title_connecting', 'Connecting');
        }
        const steps = session.panel.querySelector('.session-steps');
        if (steps) steps.hidden = !(connecting || view === 'failed');
        const tryEl = session.panel.querySelector('.session-state-try');
        if (tryEl && connecting) tryEl.hidden = true;
        const details = session.panel.querySelector('.session-details');
        if (details && connecting) { details.hidden = true; details.open = false; }
        const hint = session.panel.querySelector('.session-slow-hint');
        if (hint && !connecting) hint.hidden = true;
        const statusEl = conn.querySelector('.overlay-status');
        if (statusEl) statusEl.className = 'overlay-status' + (view === 'failed' ? ' error' : '');
        const connectingActions = session.panel.querySelector('.session-connecting-actions');
        if (connectingActions) connectingActions.hidden = !connecting;
        session.overlayActions.style.display = result ? 'flex' : 'none';
        if (!connecting) clearStepTimer(session);
        refreshTab(session);
    }

    // Wrong password from the device, in plain words
    function loginErrorText(error) {
        const raw = String(error || '');
        if (/wrong|incorrect|invalid|bad/i.test(raw) && /pass/i.test(raw)) {
            return t('remote_viewer.password_wrong', 'That password was not accepted. Check it and try again.');
        }
        return raw || t('remote_viewer.password_wrong', 'That password was not accepted. Check it and try again.');
    }

    // Known messages and close codes to a sentence on what happened and what to try
    function classifyEnd(session, reason, meta) {
        const raw = String(reason || '');
        const m = raw.toLowerCase();
        const code = Number((meta && (meta.closeCode || meta.code)) || (m.match(/websocket (\d{4})/) || [])[1] || 0);
        const name = deviceLabel(session);
        const early = !session.everStreamed;
        const pick = (kind, textKey, textFb, tryKey, tryFb) => ({
            kind,
            text: fmt(textKey, textFb, { name }),
            tryText: fmt(tryKey, tryFb, { name }),
        });

        if (/^remote:|closed manually|by the peer|peer closed|session (was )?ended|agent_end/.test(m) && !/refus|reject|declin|denied/.test(m)) {
            return Object.assign(pick('peer', 'remote_viewer.ended_peer', 'The session was ended on {name}.',
                'remote_viewer.try_ended', 'Reconnect to continue, or close the tab.'), { ended: true });
        }
        if (/permission|not allowed|forbidden|\b403\b|unauthori[sz]ed/.test(m)) {
            return pick('permission', 'remote_viewer.fail_permission', 'You do not have permission to connect to {name}.',
                'remote_viewer.try_permission', 'Ask an administrator to give you access to this device.');
        }
        if (/wrong password|password (was )?(wrong|incorrect|invalid)|invalid password/.test(m)) {
            return pick('password', 'remote_viewer.fail_password', 'The password was not accepted.',
                'remote_viewer.try_password', 'Reconnect and enter the password set in RustDesk on the device.');
        }
        if (/refus|reject|declin|dismiss|denied/.test(m) && !/relay refused: *$/.test(m) && !/offline|not online|not found|not exist|timeout/.test(m)) {
            return pick('refused', 'remote_viewer.fail_refused', '{name} refused the connection.',
                'remote_viewer.try_refused', 'Someone on the device declined it, or the device only accepts connections that are approved there. Ask them to accept, then reconnect.');
        }
        if (/timeout|timed out|did not respond|no response/.test(m)) {
            return pick('timeout', 'remote_viewer.fail_timeout', '{name} did not answer in time.',
                'remote_viewer.try_timeout', 'The device may be asleep, busy or offline. Wake it up or wait a moment, then reconnect.');
        }
        if (/not found|not exist|id_not_exist|unknown id|not registered/.test(m)) {
            return pick('notfound', 'remote_viewer.fail_notfound', 'This ID is not registered on the server.',
                'remote_viewer.try_notfound', 'Check the ID. The device may have been removed or registered again under a new ID.');
        }
        if (/offline|not online/.test(m)) {
            return pick('offline', 'remote_viewer.fail_offline', '{name} is offline.',
                'remote_viewer.try_offline', 'It has not checked in with the server recently. Turn it on or wake it up, then reconnect.');
        }
        if (/license|licence|too many/.test(m)) {
            return pick('limit', 'remote_viewer.fail_limit', 'The server does not allow this connection right now.',
                'remote_viewer.try_limit', 'The licence or the number of connections is at its limit. Ask an administrator.');
        }
        if (/rendezvous connection failed|relay connection failed|relay error|gateway connection failed|websocket open failed|mesh relay error/.test(m)) {
            return pick('relay', 'remote_viewer.fail_relay', 'The relay server could not be reached.',
                'remote_viewer.try_relay', 'Check that the relay server is running and that this browser can reach it, then reconnect.');
        }
        if (code === 1005 || code === 1006 || /connection closed|socket closed|closed/.test(m)) {
            if (early) {
                return pick('dropped_early', 'remote_viewer.fail_dropped_early', 'The connection closed before {name} answered.',
                    'remote_viewer.try_dropped_early', 'The device may be asleep or offline, or it cannot reach the relay server. Wake it up, then reconnect.');
            }
            return pick('dropped', 'remote_viewer.fail_dropped', 'The connection to {name} dropped.',
                'remote_viewer.try_dropped', 'The network between this browser, the server and the device was interrupted. Reconnect. If it keeps happening, check the network of the device.');
        }
        return pick('generic', 'remote_viewer.fail_generic', 'Could not connect to {name}.',
            'remote_viewer.try_generic', 'Reconnect. If it keeps failing, copy the details below and send them to your administrator.');
    }

    function renderResult(session, view, info) {
        clearStepTimer(session);
        showView(session, view);
        const title = session.panel.querySelector('.session-state-title');
        const tryEl = session.panel.querySelector('.session-state-try');
        if (title) {
            title.textContent = view === 'failed'
                ? t('remote_viewer.title_failed', 'Could not connect')
                : t('remote_viewer.title_ended', 'Session ended');
        }
        session.statusText.textContent = info.text;
        if (tryEl) {
            tryEl.textContent = info.tryText || '';
            tryEl.hidden = !info.tryText;
        }
        renderSteps(session);
        renderDetails(session);
        // Keyboard users land on Reconnect; focus elsewhere in the chrome stays put
        const focused = document.activeElement;
        if (isActive(session) && (!focused || focused === document.body || focused === session.canvas)) {
            session.panel.querySelector('.session-btn-reconnect')?.focus({ preventScroll: true });
        }
    }

    // Failed before or while connecting: what happened, what to try, details
    function failSession(session, reason, meta) {
        if (session.closed) return;
        session.lastError = reason || session.lastError || '';
        session.endInfo = { reason: session.lastError, meta: meta || null, at: Date.now(), step: session.stepId };
        session.endPending = false;
        if (session.endedBy) { finishEnd(session); return; }
        const info = classifyEnd(session, session.lastError, meta);
        renderResult(session, info.ended ? 'ended' : 'failed', info);
    }

    // The connection closed: ended by you, by the device, or failed on the way
    function finishEnd(session) {
        if (session.closed) return;
        if (session.endTimer) { clearTimeout(session.endTimer); session.endTimer = null; }
        session.endPending = false;
        const name = deviceLabel(session);
        const end = session.endInfo || { reason: '', meta: null, at: Date.now(), step: session.stepId };
        session.endInfo = end;
        let info;
        if (session.endedBy === 'cancel') {
            info = { text: t('remote_viewer.ended_cancel', 'You cancelled the connection.'),
                tryText: t('remote_viewer.try_ended', 'Reconnect to continue, or close the tab.'), ended: true };
        } else if (session.endedBy === 'user') {
            info = { text: fmt('remote_viewer.ended_user', 'You ended the session with {name}.', { name }),
                tryText: t('remote_viewer.try_ended', 'Reconnect to continue, or close the tab.'), ended: true };
        } else if (!end.reason && session.everStreamed) {
            info = { text: fmt('remote_viewer.ended_plain', 'The session with {name} ended.', { name }),
                tryText: t('remote_viewer.try_ended', 'Reconnect to continue, or close the tab.'), ended: true };
        } else {
            info = classifyEnd(session, end.reason, end.meta);
        }
        renderResult(session, info.ended ? 'ended' : 'failed', info);
        if (session.everStreamed && typeof window.BillingReport !== 'undefined') {
            window.BillingReport.promptAfterSession(session.deviceId, session.deviceName)
                .then((submitted) => {
                    if (submitted) showToast(t('commercialization.report.saved', 'Work report saved'), 'success');
                })
                .catch(() => {});
        }
    }

    function cancelSession(session) {
        session.endedBy = 'cancel';
        session.passwordOverlay.style.display = 'none';
        if (session.tfaOverlay) session.tfaOverlay.style.display = 'none';
        try { if (session.client) session.client.disconnect(); } catch { /* ignore */ }
        // Transports that do not report the state change still end here
        if (session.view !== 'ended') {
            session.endPending = true;
            finishEnd(session);
        }
    }

    function detailRows(session) {
        const end = session.endInfo || {};
        const meta = end.meta || {};
        const rows = [];
        const add = (label, value) => { if (value !== undefined && value !== null && String(value) !== '') rows.push([label, String(value)]); };
        add(t('remote_viewer.detail_message', 'Message'), end.reason || session.lastError || '');
        add(t('remote_viewer.detail_code', 'Close code'), meta.closeCode || '');
        add(t('remote_viewer.detail_close_reason', 'Close reason'), meta.closeReason || meta.peerReason || '');
        if (end.step) add(t('remote_viewer.detail_step', 'Last step'), stepStrings(session, end.step).label);
        add(t('remote_viewer.detail_time', 'Time'), (window.Utils && Utils.formatDate) ? Utils.formatDate(new Date(end.at || Date.now()), { second: '2-digit' }) : new Date(end.at || Date.now()).toISOString());
        add(t('remote_viewer.detail_device', 'Device ID'), session.deviceId);
        add(t('remote_viewer.detail_transport', 'Connection type'), getTransportName() === 'rd' ? 'RustDesk relay' : getTransportName().toUpperCase());
        return rows;
    }

    function renderDetails(session) {
        const details = session.panel.querySelector('.session-details');
        const facts = session.panel.querySelector('.session-details-facts');
        if (!details || !facts) return;
        const rows = detailRows(session);
        const hasMessage = !!((session.endInfo && session.endInfo.reason) || session.lastError);
        details.hidden = !(hasMessage && session.view === 'failed') && !(hasMessage && session.view === 'ended' && !session.endedBy);
        details.open = false;
        facts.innerHTML = rows.map(([k, v]) => '<dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(v) + '</dd>').join('');
    }

    function detailsText(session) {
        return [deviceLabel(session) + ' (' + session.deviceId + ')',
            session.statusText.textContent]
            .concat(detailRows(session).map(([k, v]) => k + ': ' + v)).join('\n');
    }

    // Older callers: "Could not connect: Device offline"
    function connectFailedText(reason) {
        const clean = String(reason || '').replace(/^(Error:\s*)?(Connection refused:\s*)?/i, '').trim();
        if (!clean) return t('remote.error', 'Could not connect.');
        return t('remote_viewer.connect_failed', 'Could not connect: {reason}').replace('{reason}', clean);
    }

    function setSessionStatus(session, type, text) {
        if (type === 'error') { failSession(session, text); return; }
        session.statusText.textContent = text;
    }

    function showSessionActions(session) {
        session.overlayActions.style.display = 'flex';
    }

    function showCdapFallback(session) {
        if (session.cdapFallbackBtn) session.cdapFallbackBtn.style.display = 'inline-flex';
    }


    function syncToolbarToSession(session) {
        const isStreaming = session.state === 'streaming';
        toolbar.classList.toggle('toolbar-streaming', isStreaming);
        if (toolbarStatus) toolbarStatus.style.display = 'none';
        document.querySelector('.toolbar-status-sep')?.style.setProperty('display', 'none');

        if (isStreaming) {
            syncToolbarChrome(session);
        }

        // Audio icon
        const audioBtn = document.getElementById('btn-audio');
        if (audioBtn) audioBtn.classList.toggle('is-muted', !!session.audioMuted);

        // Recording icon
        const recBtn = document.getElementById('btn-record');
        if (recBtn) {
            recBtn.classList.toggle('recording',
                session.mediaRecorder && session.mediaRecorder.state === 'recording');
        }
    }

    function syncToolbarFromSession(session) {
        if (!session || !session.viewerPrefs) return;
        const p = session.viewerPrefs;
        document.querySelectorAll('.quality-item').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.quality === p.quality);
        });
        document.querySelectorAll('.fps-mode-item').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.fpsMode === (p.fpsMode || 'adaptive'));
        });
        document.querySelectorAll('.scale-item').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.scale === p.scale);
        });
        document.querySelectorAll('.codec-item').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.codec === p.codec);
        });
        document.querySelectorAll('.keyboard-mode-item').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.keyboardMode === (p.keyboardMode || 'Auto'));
        });
    }

    // ---- Autoplay blocked overlay ----

    function showAutoplayOverlay(session) {
        let overlay = session.panel.querySelector('.autoplay-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'viewer-overlay autoplay-overlay';
            overlay.innerHTML = `
                <div class="overlay-card autoplay-card">
                    <h2 class="overlay-title">${_('remote.click_to_start') || 'Click to Start'}</h2>
                    <p class="overlay-hint">${_('remote.autoplay_blocked') || 'Browser requires user interaction to start video and audio playback.'}</p>
                    <button type="button" class="btn btn-primary btn-block autoplay-start-btn">${_('remote.start_playback') || 'Start Playback'}</button>
                </div>`;
            session.panel.appendChild(overlay);
        }
        overlay.style.display = 'flex';
        const dismiss = () => {
            overlay.style.display = 'none';
            if (session.client && session.client.video) session.client.video.retryPlay();
            if (session.client && session.client.audio && session.client.audio.audioCtx &&
                session.client.audio.audioCtx.state === 'suspended') {
                session.client.audio.audioCtx.resume();
            }
        };
        overlay.querySelector('.autoplay-start-btn')?.addEventListener('click', dismiss, { once: true });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); }, { once: true });
    }

    // ---- Chat ----

    function sendChat(session) {
        const text = session.chatInput?.value?.trim();
        if (!text || !session.client) return;
        session.client.sendChat(text);
        addChatMessage(session, text, 'sent');
        session.chatInput.value = '';
    }

    function addChatMessage(session, text, type) {
        const div = document.createElement('div');
        div.className = 'chat-msg ' + type;
        div.textContent = text;
        session.chatMessages?.appendChild(div);
        if (session.chatMessages) session.chatMessages.scrollTop = session.chatMessages.scrollHeight;
    }

    // ---- Shared Toolbar Handlers ----
    // All toolbar buttons delegate to the active session's client

    function withClient(fn) {
        const session = getActiveSession();
        if (session && session.client) fn(session.client, session);
    }

    function toggleViewerShellFullscreen() {
        const target = viewerShell || viewerContainer;
        if (!target) return;
        if (!document.fullscreenElement) {
            target.requestFullscreen().catch(function () { /* ignore */ });
            if (navigator.keyboard && navigator.keyboard.lock) {
                navigator.keyboard.lock().catch(function () { /* permission / unsupported */ });
            }
        } else {
            if (navigator.keyboard && navigator.keyboard.unlock) {
                navigator.keyboard.unlock();
            }
            document.exitFullscreen().catch(function () { /* ignore */ });
        }
    }

    function applyTransportCapabilities() {
        const fileBtn = document.getElementById('btn-file-transfer');
        if (fileBtn && getTransportName() === 'cdap') {
            // CDAP file transfer is wired via CDAPFileTransfer + /files WS.
            fileBtn.disabled = false;
            fileBtn.classList.remove('disabled');
            fileBtn.title = t('remote.file_transfer', 'File transfer');
        }
        applyGuestUiLockdown();
    }

    // Disconnect
    document.getElementById('btn-disconnect')?.addEventListener('click', () => {
        withClient((c, session) => {
            session.endedBy = 'user';
            c.disconnect();
        });
    });

    // After a remote action from a menu, typing goes to the remote screen again
    function focusScreen() {
        const session = getActiveSession();
        if (session && session.state === 'streaming' && session.canvas) session.canvas.focus({ preventScroll: true });
    }

    // Billing work-report intent (during session → disconnect overlay)
    document.getElementById('btn-billing-report')?.addEventListener('click', () => {
        const session = getActiveSession();
        if (!session || typeof window.BillingReport === 'undefined') return;
        window.BillingReport.markReportIntent(session.deviceId);
        showToast(
            t('commercialization.report.intent_hint', 'Report form will open when the session ends'),
            'info'
        );
    });

    // Audio toggle
    document.getElementById('btn-audio')?.addEventListener('click', function () {
        const session = getActiveSession();
        if (!session) return;
        session.audioMuted = !session.audioMuted;
        if (session.client) session.client.setAudioMuted(session.audioMuted);
        this.classList.toggle('is-muted', !!session.audioMuted);
        this.title = session.audioMuted ? t('remote_viewer.unmute', 'Turn sound on') : t('remote_viewer.mute', 'Mute sound');
    });

    // Ctrl+Alt+Del
    document.getElementById('btn-cad')?.addEventListener('click', () => {
        withClient(c => c.sendCtrlAltDel());
        closeAllDropdowns();
        focusScreen();
    });

    // Lock Screen
    document.getElementById('btn-lock')?.addEventListener('click', () => {
        withClient(c => c.sendLockScreen());
        closeAllDropdowns();
        focusScreen();
    });

    // Restart Remote
    document.getElementById('btn-restart-remote')?.addEventListener('click', () => {
        withClient((c) => {
            if (confirm(_('remote.confirm_restart'))) c.sendRestartRemoteDevice();
        });
        closeAllDropdowns();
    });

    // Refresh Screen
    document.getElementById('btn-refresh-screen')?.addEventListener('click', () => {
        withClient(c => c.sendRefreshScreen());
        closeAllDropdowns();
        focusScreen();
    });

    // Reset keyboard (release stuck modifiers on remote)
    document.getElementById('btn-reset-keyboard')?.addEventListener('click', () => {
        withClient(c => {
            if (typeof c.resetKeyboard === 'function') {
                c.resetKeyboard();
            } else if (c.input && typeof c.input.resetKeyboard === 'function') {
                c.input.resetKeyboard();
            }
        });
        showToast(_('remote.reset_keyboard_done') || 'Keyboard state reset on remote', 'success');
        closeAllDropdowns();
        focusScreen();
    });

    // Clipboard Paste
    document.getElementById('btn-clipboard-paste')?.addEventListener('click', async () => {
        const session = getActiveSession();
        if (!session || !session.client) return;
        if (session.client.viewOnly) {
            showToast(_('remote.view_only') || 'View only mode', 'warning');
            closeAllDropdowns();
            return;
        }
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                session.client.sendClipboard(text);
            } else {
                showToast(_('remote.clipboard_empty') || 'Clipboard is empty', 'warning');
            }
        } catch {
            // Clipboard API requires HTTPS or user permission
            showToast(_('remote.clipboard_denied') || 'Clipboard access denied. HTTPS required or permission not granted.', 'error');
        }
        closeAllDropdowns();
    });

    // Type text as remote keystrokes (Winlogon / password fields)
    function sendTypeTextFromPanel() {
        const session = getActiveSession();
        const input = document.getElementById('type-text-input');
        const text = input?.value || '';
        if (!session || !session.client) return;
        if (session.client.viewOnly) {
            showToast(_('remote.view_only') || 'View only mode', 'warning');
            return;
        }
        if (!text) {
            showToast(_('remote.type_text_empty') || 'Enter text to type on the remote', 'warning');
            return;
        }
        if (typeof session.client.sendText !== 'function') {
            showToast(_('remote.type_text_unavailable') || 'Type text is not available on this transport', 'warning');
            return;
        }
        const ok = session.client.sendText(text);
        if (ok === false) {
            showToast(_('remote.type_text_unavailable') || 'Type text is not available on this transport', 'warning');
            return;
        }
        if (input) input.value = '';
        showToast(_('remote.type_text_done') || 'Text sent to remote keyboard', 'success');
        closeAllDropdowns();
    }

    document.getElementById('btn-type-text')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllDropdowns('type-text-menu');
        const menu = document.getElementById('type-text-menu');
        const btn = document.getElementById('btn-type-text');
        menu?.classList.toggle('open');
        const open = menu?.classList.contains('open');
        if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            setTimeout(() => document.getElementById('type-text-input')?.focus(), 0);
        }
    });

    document.getElementById('btn-type-text-send')?.addEventListener('click', (e) => {
        e.stopPropagation();
        sendTypeTextFromPanel();
    });

    document.getElementById('type-text-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeAllDropdowns();
            document.getElementById('btn-type-text')?.focus();
            return;
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            sendTypeTextFromPanel();
        }
    });

    document.getElementById('type-text-menu')?.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Block Input toggle
    setupToggle('btn-block-input', (on) => withClient(c => c.setBlockInput(on)));

    // Quality items — map HTML data-quality to client presets (includes FPS adjustment)
    var qualityToPreset = { 'Best': 'best', 'Balanced': 'balanced', 'Low': 'speed' };
    document.querySelectorAll('.quality-item').forEach(btn => {
        btn.addEventListener('click', function () {
            var preset = qualityToPreset[this.dataset.quality] || 'balanced';
            var session = getActiveSession();
            withClient(c => c.setQualityPreset(preset));
            if (session) updateSessionViewerPref(session, { quality: this.dataset.quality });
            document.querySelectorAll('.quality-item').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });

    document.querySelectorAll('.fps-mode-item').forEach(btn => {
        btn.addEventListener('click', function () {
            var mode = this.dataset.fpsMode || '30';
            var session = getActiveSession();
            withClient(c => {
                if (typeof c.setFpsMode === 'function') c.setFpsMode(mode);
            });
            if (session) updateSessionViewerPref(session, { fpsMode: mode });
            document.querySelectorAll('.fps-mode-item').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // Keyboard mode (Legacy / Map / Auto)
    document.querySelectorAll('.keyboard-mode-item').forEach(btn => {
        btn.addEventListener('click', function () {
            var mode = this.dataset.keyboardMode || 'Auto';
            var session = getActiveSession();
            withClient(c => {
                if (typeof c.setKeyboardMode === 'function') c.setKeyboardMode(mode);
            });
            if (session) updateSessionViewerPref(session, { keyboardMode: mode });
            document.querySelectorAll('.keyboard-mode-item').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // Scale items
    document.querySelectorAll('.scale-item').forEach(btn => {
        btn.addEventListener('click', function () {
            var session = getActiveSession();
            withClient(c => c.setScaleMode(this.dataset.scale));
            if (session) updateSessionViewerPref(session, { scale: this.dataset.scale });
            document.querySelectorAll('.scale-item').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // Codec items — request the peer to (re)encode with a specific codec (GPU-friendly).
    document.querySelectorAll('.codec-item').forEach(btn => {
        btn.addEventListener('click', function () {
            if (this.classList.contains('disabled')) return;
            var session = getActiveSession();
            withClient(c => c.setCodec(this.dataset.codec));
            if (session) updateSessionViewerPref(session, { codec: this.dataset.codec });
            document.querySelectorAll('.codec-item').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // Disable codec options the browser's decoder cannot handle.
    (function probeCodecMenu() {
        if (!window.RDVideo || typeof RDVideo.getSupportedCodecs !== 'function') return;
        RDVideo.getSupportedCodecs().then(function (support) {
            document.querySelectorAll('.codec-item').forEach(function (btn) {
                var codec = (btn.dataset.codec || '').toLowerCase();
                if (codec === 'auto') return; // always allowed
                if (support && support[codec] === false) {
                    btn.classList.add('disabled');
                    btn.setAttribute('disabled', 'disabled');
                    btn.title = 'Not supported by this browser';
                }
            });
        }).catch(function () { /* ignore */ });
    })();

    // Toggle helpers
    setupToggle('btn-show-cursor', (on) => withClient(c => c.setShowRemoteCursor(on)));
    setupToggle('btn-lock-session', (on) => withClient(c => c.setLockAfterSession(on)));
    setupToggle('btn-privacy-mode', (on) => withClient(c => c.setPrivacyMode(on)));
    setupToggle('btn-disable-clipboard', (on) => withClient(c => c.setDisableClipboard(on)));

    // Dropdown toggles
    document.getElementById('btn-actions')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllDropdowns('actions-menu');
        document.getElementById('actions-menu')?.classList.toggle('open');
    });

    document.getElementById('btn-display')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllDropdowns('display-menu');
        document.getElementById('display-menu')?.classList.toggle('open');
    });

    document.getElementById('btn-monitors')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllDropdowns('monitors-menu');
        updateMonitorMenu();
        document.getElementById('monitors-menu')?.classList.toggle('open');
    });

    function refreshMonitorButton(session) {
        session = session || getActiveSession();
        if (!session || !session.client) return;
        const btn = document.getElementById('btn-monitors');
        if (!btn) return;
        let monitors = [];
        let vd = { supported: false };
        try { monitors = session.client.getMonitors() || []; } catch { monitors = []; }
        try {
            vd = (typeof session.client.getVirtualDisplaySupport === 'function')
                ? session.client.getVirtualDisplaySupport()
                : { supported: false };
        } catch { vd = { supported: false }; }
        const useStrip = monitors.length >= 2 && monitors.length <= 4;
        const showDropdown = (monitors.length > 1 && !useStrip) || (vd && vd.supported);
        btn.style.display = showDropdown ? '' : 'none';
        updateMonitorStrip(session, monitors, useStrip);
        if (showDropdown) updateMonitorMenu();
    }

    function updateMonitorStrip(session, monitors, useStrip) {
        const strip = document.getElementById('toolbar-monitor-strip');
        if (!strip) return;
        strip.innerHTML = '';
        if (!useStrip || !session || !session.client || monitors.length < 2) {
            strip.hidden = true;
            return;
        }
        strip.hidden = false;
        monitors.forEach(function (m, i) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'toolbar-monitor-btn' + (m.current ? ' active' : '');
            const screenName = fmt('remote_viewer.screen_n', 'Screen {n}', { n: i + 1 });
            item.title = screenName + (m.name ? ' (' + m.name + (m.width ? ', ' + m.width + ' × ' + m.height : '') + ')' : '');
            item.setAttribute('aria-label', item.title);
            item.setAttribute('aria-pressed', m.current ? 'true' : 'false');
            item.textContent = String(i + 1);
            item.addEventListener('click', function (e) {
                e.stopPropagation();
                session.client.switchMonitor(m.idx);
                strip.querySelectorAll('.toolbar-monitor-btn').forEach(function (b) {
                    b.classList.remove('active');
                    b.setAttribute('aria-pressed', 'false');
                });
                item.classList.add('active');
                item.setAttribute('aria-pressed', 'true');
                updateMonitorMenu();
            });
            strip.appendChild(item);
        });
    }

    function updateWindowsSessionMenu(session) {
        session = session || getActiveSession();
        const menu = document.getElementById('actions-menu');
        if (!menu || !session || !session.client) return;
        menu.querySelectorAll('.windows-session-item, .windows-session-sep').forEach(function (el) {
            el.remove();
        });
        let ws = { sessions: [], currentSid: 0 };
        try {
            ws = (typeof session.client.getWindowsSessions === 'function')
                ? session.client.getWindowsSessions()
                : { sessions: [], currentSid: 0 };
        } catch { ws = { sessions: [], currentSid: 0 }; }
        if (!ws.sessions || ws.sessions.length < 2) return;

        const sep = document.createElement('div');
        sep.className = 'dropdown-separator windows-session-sep';
        menu.appendChild(sep);

        const label = document.createElement('div');
        label.className = 'dropdown-label windows-session-sep';
        label.textContent = t('remote.windows_sessions', 'Windows sessions');
        menu.appendChild(label);

        ws.sessions.forEach(function (s) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'dropdown-item windows-session-item' +
                (s.sid === ws.currentSid ? ' active' : '');
            item.innerHTML = '<span class="material-icons">desktop_windows</span> ' + escapeHtml(s.name);
            item.addEventListener('click', function () {
                session.client.selectWindowsSession(s.sid);
                menu.querySelectorAll('.windows-session-item').forEach(function (b) {
                    b.classList.remove('active');
                });
                item.classList.add('active');
                closeAllDropdowns();
            });
            menu.appendChild(item);
        });
    }

    function updateMonitorMenu() {
        const session = getActiveSession();
        if (!session || !session.client) return;
        const monitors = session.client.getMonitors() || [];
        const menu = document.getElementById('monitors-menu');
        if (!menu) return;

        let vd = { supported: false };
        try {
            vd = (typeof session.client.getVirtualDisplaySupport === 'function')
                ? session.client.getVirtualDisplaySupport()
                : { supported: false };
        } catch { vd = { supported: false }; }

        // Nothing meaningful to show: a single physical display and no virtual
        // display support.
        if (monitors.length < 2 && !(vd && vd.supported)) return;

        const label = menu.querySelector('.dropdown-label');
        menu.innerHTML = '';
        if (label) menu.appendChild(label);

        const listWrap = document.createElement('div');
        listWrap.className = 'monitors-menu-list';

        // Physical monitors
        monitors.forEach(m => {
            const item = document.createElement('button');
            item.className = 'dropdown-item monitor-item' + (m.current ? ' active' : '');
            item.dataset.idx = m.idx;
            const res = (m.width && m.height)
                ? '<span class="monitor-item-meta">' + m.width + '\u00d7' + m.height + '</span>'
                : '';
            item.innerHTML = '<span class="material-icons">' +
                (m.primary ? 'desktop_windows' : 'monitor') +
                '</span><span class="monitor-item-text">' +
                '<span class="monitor-item-name">' + escapeHtml(m.name) + '</span>' +
                res +
                '</span>';
            item.addEventListener('click', () => {
                session.client.switchMonitor(m.idx);
                menu.querySelectorAll('.monitor-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                refreshMonitorButton(session);
            });
            listWrap.appendChild(item);
        });

        menu.appendChild(listWrap);

        // Virtual displays (RustDesk IDD / Amyuni IDD)
        if (vd && vd.supported) {
            const vdWrap = document.createElement('div');
            vdWrap.className = 'monitors-menu-vd';

            const vdLabel = document.createElement('div');
            vdLabel.className = 'dropdown-label';
            vdLabel.textContent = t('remote.virtual_displays', 'Virtual displays');
            vdWrap.appendChild(vdLabel);

            if (vd.impl === 'rustdesk_idd') {
                const active = Array.isArray(vd.rustdeskDisplays) ? vd.rustdeskDisplays : [];
                for (let i = 0; i < 4; i++) {
                    const idx = i + 1;
                    const on = active.indexOf(idx) !== -1;
                    const item = document.createElement('button');
                    item.className = 'dropdown-item virtual-display-item' + (on ? ' active' : '');
                    item.innerHTML = '<span class="material-icons">' +
                        (on ? 'check_box' : 'check_box_outline_blank') + '</span> ' +
                        escapeHtml(t('remote.virtual_display', 'Virtual display') + ' ' + idx);
                    item.addEventListener('click', () => {
                        session.client.toggleVirtualDisplay(idx, !on);
                    });
                    vdWrap.appendChild(item);
                }
            } else if (vd.impl === 'amyuni_idd') {
                const count = (typeof vd.amyuniCount === 'number') ? vd.amyuniCount : 0;
                const row = document.createElement('div');
                row.className = 'virtual-display-counter';

                const minus = document.createElement('button');
                minus.type = 'button';
                minus.className = 'vd-count-btn';
                minus.setAttribute('aria-label', t('remote_viewer.fewer_displays', 'Remove a virtual display'));
                minus.innerHTML = '<span class="material-icons" aria-hidden="true">remove</span>';
                minus.disabled = count <= 0;
                minus.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    session.client.toggleVirtualDisplay(0, false);
                });

                const num = document.createElement('span');
                num.className = 'vd-count-value';
                num.textContent = String(count);

                const plus = document.createElement('button');
                plus.type = 'button';
                plus.className = 'vd-count-btn';
                plus.setAttribute('aria-label', t('remote_viewer.more_displays', 'Add a virtual display'));
                plus.innerHTML = '<span class="material-icons" aria-hidden="true">add</span>';
                plus.disabled = count >= 4;
                plus.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    session.client.toggleVirtualDisplay(0, true);
                });

                row.appendChild(minus);
                row.appendChild(num);
                row.appendChild(plus);
                vdWrap.appendChild(row);
            }

            // Plug out all
            const plugOut = document.createElement('button');
            plugOut.className = 'dropdown-item virtual-display-item';
            plugOut.innerHTML = '<span class="material-icons">power_off</span> ' +
                escapeHtml(t('remote.plug_out_all', 'Plug out all'));
            plugOut.addEventListener('click', () => {
                session.client.toggleVirtualDisplay(-1, false);
            });
            vdWrap.appendChild(plugOut);
            menu.appendChild(vdWrap);
        }
    }

    // ---- Side sheets: chat, file transfer, session info ----
    // One sheet at a time, beside the screen: the screen gets narrower instead
    // of being covered. Chat is per session (each tab keeps its messages).

    const sheetButtons = { chat: 'btn-chat', files: 'btn-file-transfer', info: 'btn-session-info' };
    let infoTimer = null;

    function syncSheetButtons() {
        Object.entries(sheetButtons).forEach(([name, id]) => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.toggle('active', currentSheet === name);
        });
        viewerShell?.classList.toggle('has-sheet', !!currentSheet);
    }

    function hideAllSheets() {
        sessions.forEach((s) => { if (s.chatPanel) s.chatPanel.style.display = 'none'; });
        if (window.__fileTransferModal?.isOpen()) window.__fileTransferModal.close();
        const info = document.getElementById('session-info-sheet');
        if (info) info.hidden = true;
        if (infoTimer) { clearInterval(infoTimer); infoTimer = null; }
    }

    function openSheet(name) {
        const session = getActiveSession();
        if (!session) return;
        hideAllSheets();
        currentSheet = name;
        if (name === 'chat') {
            session.chatPanel.style.display = 'flex';
            if (session.chatInput) session.chatInput.focus();
        } else if (name === 'files') {
            const modal = window.__fileTransferModal;
            if (!modal) { currentSheet = null; syncSheetButtons(); return; }
            modal.open(session);
            modal._el?.querySelector('.ft-modal-close')?.focus();
        } else if (name === 'info') {
            const info = document.getElementById('session-info-sheet');
            if (info) info.hidden = false;
            renderSessionInfo();
            infoTimer = setInterval(renderSessionInfo, 1000);
            document.getElementById('session-info-close')?.focus();
        }
        syncSheetButtons();
        resizeActiveScreen();
    }

    function closeSheet(returnFocus) {
        const was = currentSheet;
        hideAllSheets();
        currentSheet = null;
        syncSheetButtons();
        resizeActiveScreen();
        if (returnFocus && was && sheetButtons[was]) document.getElementById(sheetButtons[was])?.focus();
    }

    function toggleSheet(name) {
        if (currentSheet === name) closeSheet();
        else openSheet(name);
    }

    function resizeActiveScreen() {
        const session = getActiveSession();
        if (session && session.client && session.client.renderer) {
            requestAnimationFrame(() => session.client && session.client.renderer.resize());
        }
    }

    // Facts about the active session; values the transport does not report are left out
    function renderSessionInfo() {
        const dl = document.getElementById('session-info-facts');
        const session = getActiveSession();
        if (!dl) return;
        if (!session) { dl.innerHTML = ''; return; }
        const rows = [];
        const add = (label, html) => { if (html) rows.push('<dt>' + escapeHtml(label) + '</dt><dd>' + html + '</dd>'); };
        const U = window.Utils;
        const name = deviceLabel(session);
        add(t('remote_viewer.info_device', 'Device'), escapeHtml(name));
        add(t('remote_viewer.info_id', 'ID'), U ? U.valueHtml(session.deviceId, { copy: true }) : escapeHtml(session.deviceId));
        if (session.platform) add(t('remote_viewer.info_system', 'System'), U ? U.platformHtml(session.platform) : escapeHtml(session.platform));
        const st = tabStatusFor(session);
        add(t('remote_viewer.info_state', 'State'), U ? U.statusHtml(st.tone, st.label) : escapeHtml(st.label));
        if (session.connectedAt && session.view === 'streaming') {
            add(t('remote_viewer.info_since', 'Connected since'), U ? U.timeHtml(new Date(session.connectedAt), { relative: false, format: { year: undefined, month: undefined, day: undefined, hour: '2-digit', minute: '2-digit', second: '2-digit' } }) : '');
            if (U) add(t('remote_viewer.info_duration', 'Connected for'), escapeHtml(U.formatDuration((Date.now() - session.connectedAt) / 1000)));
        }
        add(t('remote_viewer.info_route', 'Connection'), escapeHtml(getTransportName() === 'rd'
            ? t('remote_viewer.info_route_relay', 'Through the relay server')
            : t('remote_viewer.info_route_server', 'Through the server')));
        if (session.view === 'streaming') {
            add(t('remote_viewer.info_encryption', 'Encryption'), session.encryptionWarning
                ? (U ? U.statusHtml('warning', session.encryptionWarning) : escapeHtml(session.encryptionWarning))
                : (U ? U.statusHtml('good', t('remote_viewer.info_encrypted', 'End-to-end encrypted')) : ''));
            let stats = null;
            try { stats = session.client && typeof session.client.getStats === 'function' ? session.client.getStats() : null; } catch { stats = null; }
            const r = stats && stats.renderer;
            if (session.latency) add(t('remote_viewer.info_latency', 'Round trip'), escapeHtml((U ? U.formatNumber(Math.round(session.latency)) : Math.round(session.latency)) + ' ms'));
            if (r && r.fps !== undefined) add(t('remote_viewer.info_fps', 'Frame rate'), escapeHtml(r.fps + ' fps'));
            if (r && r.remoteWidth) add(t('remote_viewer.info_resolution', 'Screen size'), '<span class="tabular">' + r.remoteWidth + ' × ' + r.remoteHeight + '</span>');
            const codec = stats && stats.video && (stats.video.codec || stats.video.currentCodec);
            if (codec) add(t('remote_viewer.info_codec', 'Video format'), escapeHtml(String(codec).toUpperCase()));
            const p = session.viewerPrefs || {};
            const quality = { Best: t('remote.quality_best', 'Best'), Balanced: t('remote.quality_balanced', 'Balanced'), Low: t('remote.quality_low', 'Low') }[p.quality];
            if (quality) add(t('remote.image_quality', 'Image quality'), escapeHtml(quality));
        }
        dl.innerHTML = rows.join('');
    }

    document.getElementById('btn-chat')?.addEventListener('click', () => toggleSheet('chat'));
    document.getElementById('btn-file-transfer')?.addEventListener('click', () => {
        const session = getActiveSession();
        if (!session || !session.client?.fileTransfer) {
            showToast(t('remote.file_transfer_unavailable', 'File transfer is not available for this session.'), 'warning');
            return;
        }
        toggleSheet('files');
    });
    document.getElementById('btn-session-info')?.addEventListener('click', () => toggleSheet('info'));
    document.getElementById('session-info-close')?.addEventListener('click', () => closeSheet(true));
    document.getElementById('session-info-sheet')?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); closeSheet(true); }
    });
    // The file sheet closes itself (its × or Escape): keep the toolbar in step
    document.addEventListener('rd-file-sheet-closed', () => {
        if (currentSheet === 'files') {
            currentSheet = null;
            syncSheetButtons();
            resizeActiveScreen();
        }
    });

    // Recording
    document.getElementById('btn-record')?.addEventListener('click', function () {
        const session = getActiveSession();
        if (!session) return;

        if (session.mediaRecorder && session.mediaRecorder.state === 'recording') {
            session.mediaRecorder.stop();
            this.classList.remove('recording');
        } else if (window.__capabilities && window.__capabilities.transport === 'mesh') {
            session.meshServerRecord = !session.meshServerRecord;
            this.classList.toggle('recording', session.meshServerRecord);
            Notifications.info(session.meshServerRecord
                ? (_('mesh.recording_server_on') || 'Server recording enabled — reconnecting…')
                : (_('mesh.recording_server_off') || 'Server recording disabled — reconnecting…'));
            reconnectSession(session);
        } else {
            try {
                const stream = session.canvas.captureStream(30);
                session.recordedChunks = [];
                const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
                let mimeType = '';
                for (const mt of mimeTypes) {
                    if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; }
                }
                session.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
                session.mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) session.recordedChunks.push(e.data);
                };
                session.mediaRecorder.onstop = () => {
                    const blob = new Blob(session.recordedChunks, { type: mimeType || 'video/webm' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'betterdesk-' + session.deviceId + '-' + Date.now() + '.webm';
                    a.click();
                    URL.revokeObjectURL(url);
                    session.mediaRecorder = null;
                };
                session.mediaRecorder.start(1000);
                this.classList.add('recording');
            } catch (err) {
                console.warn('[Remote] Recording not supported:', err);
            }
        }
    });

    // View Only toggle
    document.getElementById('btn-viewonly')?.addEventListener('click', function () {
        const isViewOnly = !this.classList.contains('active');
        this.classList.toggle('active', isViewOnly);
        withClient(c => c.setViewOnly(isViewOnly));
        syncMobileTouchForActive();
    });

    // Pin Toolbar toggle — keeps the expanded action pill open
    document.getElementById('btn-pin')?.addEventListener('click', function () {
        if (toolbarNotchSlot?.classList.contains('toolbar-chrome-hidden')) return;
        toolbarPinned = !toolbarPinned;
        toolbar.classList.toggle('pinned', toolbarPinned);
        this.classList.toggle('active', toolbarPinned);
        if (toolbarPinned) expandToolbar();
    });

    // ---- Compact handle: fullscreen (drawer toggle is on the handle itself) ----
    document.getElementById('btn-handle-fullscreen')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleViewerShellFullscreen();
    });

    // ---- Back to devices — close all sessions first ----
    document.getElementById('btn-back-devices')?.addEventListener('click', (e) => {
        e.preventDefault();
        closeAllSessions();
        returnToDevices();
    });

    function syncDropdownAria() {
        document.querySelectorAll('.toolbar-dropdown').forEach((dd) => {
            const btn = dd.querySelector(':scope > button');
            const menu = dd.querySelector('.toolbar-dropdown-menu');
            if (btn && menu) btn.setAttribute('aria-expanded', menu.classList.contains('open') ? 'true' : 'false');
        });
    }

    document.querySelectorAll('.toolbar-dropdown > button').forEach((btn) => {
        btn.addEventListener('click', () => setTimeout(syncDropdownAria, 0));
    });

    function closeAllDropdowns(exceptId) {
        document.querySelectorAll('.toolbar-dropdown-menu.open').forEach(m => {
            if (m.id !== exceptId) m.classList.remove('open');
        });
        setTimeout(syncDropdownAria, 0);
        const typeBtn = document.getElementById('btn-type-text');
        const typeMenu = document.getElementById('type-text-menu');
        if (typeBtn && typeMenu && !typeMenu.classList.contains('open')) {
            typeBtn.setAttribute('aria-expanded', 'false');
        }
    }

    function setupToggle(btnId, onChange) {
        document.getElementById(btnId)?.addEventListener('click', function () {
            const active = this.dataset.active !== 'true';
            this.dataset.active = active.toString();
            onChange(active);
        });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.toolbar-dropdown')) {
            closeAllDropdowns();
        }
    });

    // Fullscreen handler
    document.addEventListener('fullscreenchange', () => {
        const fsBtn = document.getElementById('btn-handle-fullscreen');
        const fsLabel = fsBtn?.querySelector('.fullscreen-label');
        const label = document.fullscreenElement
            ? t('remote_viewer.exit_fullscreen', 'Exit full screen')
            : t('remote.fullscreen', 'Full screen');
        if (fsLabel) fsLabel.textContent = label;
        if (fsBtn) fsBtn.title = label + ' (F11)';
        const fsIcon = fsBtn?.querySelector('.fullscreen-icon');
        if (fsIcon) fsIcon.textContent = document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen';
        setTimeout(() => {
            const session = getActiveSession();
            if (session && session.client && session.client.renderer) session.client.renderer.resize();
        }, 100);
    });

    // Escape to show toolbar; F11 toggles viewer shell fullscreen
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F11') {
            e.preventDefault();
            toggleViewerShellFullscreen();
            return;
        }
        if (e.key === 'Escape') {
            const open = document.querySelector('.toolbar-dropdown-menu.open');
            if (open) {
                const owner = open.closest('.toolbar-dropdown')?.querySelector(':scope > button');
                closeAllDropdowns();
                owner?.focus();
                return;
            }
            // Escape inside a side sheet closes it (the remote screen keeps Escape otherwise)
            if (currentSheet && e.target && e.target.closest && e.target.closest('#rd-sheet-host')) {
                closeSheet(true);
                return;
            }
        }
        if (e.key === 'Escape' && !document.fullscreenElement) showToolbar();
    });

    // F8 leaves the remote screen: it opens the controls and moves focus to them
    // (on the screen every other key, Tab included, goes to the remote device).
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'F8' || e.ctrlKey || e.altKey || e.metaKey) return;
        const notch = document.getElementById('toolbar-notch-slot');
        e.preventDefault();
        e.stopPropagation();
        if (notch && !notch.classList.contains('toolbar-chrome-hidden')) {
            expandToolbar();
            document.getElementById('btn-toolbar-expand')?.focus();
        } else {
            tabBar.querySelector('[role="tab"][aria-selected="true"]')?.focus();
        }
    }, true);

    // Toggle buttons in the toolbar keep aria-pressed in step with their visual state
    (function syncPressedState() {
        const toggles = ['btn-chat', 'btn-file-transfer', 'btn-session-info', 'btn-viewonly', 'btn-pin', 'btn-record', 'btn-audio'];
        const apply = (btn) => {
            const on = btn.classList.contains('active') || btn.classList.contains('recording')
                || btn.classList.contains('is-muted');
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        };
        const applyItem = (item) => {
            const on = item.dataset.active === 'true' || item.classList.contains('active');
            item.setAttribute('aria-pressed', on ? 'true' : 'false');
        };
        const observer = new MutationObserver((records) => {
            records.forEach((r) => {
                if (r.target.classList.contains('dropdown-item')) applyItem(r.target);
                else apply(r.target);
            });
        });
        toggles.forEach((id) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            apply(btn);
            observer.observe(btn, { attributes: true, attributeFilter: ['class'] });
        });
        document.querySelectorAll('.toolbar-dropdown-menu .toggle-item, .quality-item, .fps-mode-item, .codec-item, .keyboard-mode-item, .scale-item').forEach((item) => {
            applyItem(item);
            observer.observe(item, { attributes: true, attributeFilter: ['class', 'data-active'] });
        });
    })();

    // Window resize, and the screen area changing size (controls row, side sheet)
    window.addEventListener('resize', () => {
        const session = getActiveSession();
        if (session && session.client && session.client.renderer) session.client.renderer.resize();
    });
    if (typeof ResizeObserver === 'function' && viewerContainer) {
        new ResizeObserver(() => {
            const session = getActiveSession();
            if (session && session.client && session.client.renderer) session.client.renderer.resize();
        }).observe(viewerContainer);
    }

    // ---- Session picker (address book) ----

    let sessionPicker = null;
    let sessionPickerLoaded = false;
    const sessionPickerBackdrop = document.getElementById('session-picker-backdrop');

    function openSessionPicker() {
        if (!sessionPickerBackdrop) return;
        sessionPickerBackdrop.hidden = false;
        sessionPickerBackdrop.classList.add('open');
        if (!sessionPickerLoaded && sessionPicker) {
            sessionPicker.loadAll(false).then(() => { sessionPickerLoaded = true; });
        } else if (sessionPicker) {
            sessionPicker.renderDevices();
        }
        document.getElementById('session-picker-search')?.focus();
    }

    function closeSessionPicker() {
        if (!sessionPickerBackdrop) return;
        sessionPickerBackdrop.classList.remove('open');
        sessionPickerBackdrop.hidden = true;
    }

    function toggleSessionPicker() {
        if (sessionPickerBackdrop?.classList.contains('open')) closeSessionPicker();
        else openSessionPicker();
    }

    function initSessionPicker() {
        if (isGuestAccessMode()) {
            applyGuestUiLockdown();
            return;
        }
        if (!window.RemoteAddressBook || !document.getElementById('session-picker-panel')) return;

        sessionPicker = window.RemoteAddressBook.create({
            classPrefix: 'rd-picker',
            compact: true,
            ids: {
                sidebar: 'session-picker-sidebar',
                contentRoot: 'session-picker-content',
                foldersCustom: 'session-picker-folders-custom',
                groups: 'session-picker-groups',
                groupsEmpty: 'session-picker-groups-empty',
                tags: 'session-picker-tags',
                tagsEmpty: 'session-picker-tags-empty',
                grid: 'session-picker-grid',
                tableWrap: 'session-picker-table-wrap',
                tbody: 'session-picker-tbody',
                loading: 'session-picker-loading',
                error: 'session-picker-error',
                errorText: 'session-picker-error-text',
                empty: 'session-picker-empty',
                search: 'session-picker-search',
                sectionTitle: 'session-picker-section-title',
                deviceCount: 'session-picker-count',
                countAll: 'rd-picker-count-all',
                countUnassigned: 'rd-picker-count-unassigned',
                viewGrid: 'session-picker-view-grid',
                viewList: 'session-picker-view-list',
                refreshBtn: 'session-picker-refresh',
                retry: 'session-picker-retry',
                quickId: 'session-picker-quick-id'
            },
            getConnectedIds: function () {
                return new Set(sessions.keys());
            },
            onConnect: function (deviceId, deviceName) {
                closeSessionPicker();
                createSession(deviceId, deviceName || '');
                if (sessionPicker) sessionPicker.renderDevices();
            }
        });

        sessionPicker.bindUi(document.getElementById('session-picker-panel'));

        document.getElementById('btn-add-session')?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSessionPicker();
        });

        document.getElementById('session-picker-close')?.addEventListener('click', closeSessionPicker);

        document.getElementById('session-picker-quick-btn')?.addEventListener('click', () => {
            if (sessionPicker?.quickConnect('session-picker-quick-id')) {
                closeSessionPicker();
            }
        });

        document.getElementById('session-picker-quick-id')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('session-picker-quick-btn')?.click();
            }
        });

        sessionPickerBackdrop?.addEventListener('click', (e) => {
            if (e.target === sessionPickerBackdrop) closeSessionPicker();
        });

        const sessionPickerPanel = document.getElementById('session-picker-panel');
        sessionPickerPanel?.addEventListener('click', (e) => e.stopPropagation());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sessionPickerBackdrop?.classList.contains('open')) {
                closeSessionPicker();
            }
        });
    }

    bindSlimTabBar();
    initSessionPicker();

    // ---- HTTP Warning Banner ----

    let httpWarningShown = false;
    function showHttpWarningBanner() {
        if (httpWarningShown) return;
        httpWarningShown = true;
        const banner = document.createElement('div');
        banner.className = 'http-warning-banner';
        banner.setAttribute('role', 'status');
        banner.innerHTML = '<span>' + (_('remote.http_warning') || 'HTTP mode: limited to H.264 software decode (~15 FPS). Use HTTPS for full performance (WebCodecs, VP9, 60 FPS).') + '</span>' +
            '<button type="button" class="http-warning-dismiss" aria-label="' + escapeHtml(t('actions.dismiss', 'Dismiss')) + '">' +
            '<span class="material-icons" aria-hidden="true">close</span></button>';
        document.body.appendChild(banner);
        banner.querySelector('.http-warning-dismiss').addEventListener('click', () => banner.remove());
    }

    // ---- Translation helper fallback ----
    if (typeof window._ === 'undefined') {
        window._ = function (key) {
            const parts = key.split('.');
            let val = window.BetterDesk?.translations;
            for (const p of parts) {
                if (!val) return key;
                val = val[p];
            }
            return val || key;
        };
    }

    // ---- Initialize ----

    // ---- Mobile / tablet rdclient ----
    const touchHandlers = new Map();
    let mobileTouchMode = 'direct';

    function attachMobileTouch(session) {
        if (!window.RdClientMobile || !window.RdClientMobile.isMobileRdClient()) return;
        if (typeof RDTouch !== 'function' || !session.client) return;
        // RDTouch emits RustDesk mouseEvent messages. CDAP and Mesh expose
        // different input contracts, so do not attach it unless this
        // transport explicitly provides the RDClient sendMessage callback.
        if (!session.client.input || typeof session.client.input.sendMessage !== 'function') return;
        let touch = touchHandlers.get(session.deviceId);
        if (!touch) {
            touch = new RDTouch(session.canvas, session.client.renderer, function(msg) {
                if (session.client && session.client.input) {
                    session.client.input.sendMessage(msg);
                }
            });
            touchHandlers.set(session.deviceId, touch);
        }
        touch.setMode(mobileTouchMode);
        if (session.deviceId === activeSessionId && session.state === 'streaming' && !(session.client && session.client.viewOnly)) {
            touch.start();
        } else {
            touch.stop();
        }
    }

    function syncMobileTouchForActive() {
        if (!window.RdClientMobile || !window.RdClientMobile.isMobileRdClient()) return;
        touchHandlers.forEach(function(touch, id) {
            var session = sessions.get(id);
            if (id === activeSessionId && session && session.state === 'streaming' && !(session.client && session.client.viewOnly)) {
                touch.setMode(mobileTouchMode);
                touch.start();
            } else {
                touch.stop();
            }
        });
    }

    function resizeViewerForViewport() {
        sessions.forEach(function(session) {
            if (session.client && session.client.renderer) {
                session.client.renderer.resize();
            }
        });
    }

    function initMobileViewerBindings() {
        var kbBridge = document.getElementById('rd-keyboard-bridge');
        var specialPanel = document.getElementById('rd-special-keys-panel');

        document.getElementById('rd-mob-input-touch')?.addEventListener('click', function() {
            mobileTouchMode = 'direct';
            document.querySelectorAll('#rd-mobile-toolbar [data-mode]').forEach(function(b) {
                b.classList.toggle('active', b.dataset.mode === 'direct');
            });
            syncMobileTouchForActive();
        });

        document.getElementById('rd-mob-input-touchpad')?.addEventListener('click', function() {
            mobileTouchMode = 'touchpad';
            document.querySelectorAll('#rd-mobile-toolbar [data-mode]').forEach(function(b) {
                b.classList.toggle('active', b.dataset.mode === 'touchpad');
            });
            syncMobileTouchForActive();
        });

        document.getElementById('rd-mob-keyboard')?.addEventListener('click', function() {
            if (window.RdClientMobile) window.RdClientMobile.focusKeyboardBridge(kbBridge);
        });

        document.getElementById('rd-mob-special')?.addEventListener('click', function() {
            if (specialPanel) specialPanel.classList.toggle('open');
        });

        document.getElementById('rd-mob-cad')?.addEventListener('click', function() {
            withClient(function(c) { c.sendCtrlAltDel(); });
        });

        document.getElementById('rd-mob-fullscreen')?.addEventListener('click', function() {
            toggleViewerShellFullscreen();
        });

        specialPanel?.querySelectorAll('.rd-special-key-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var session = getActiveSession();
                if (!session || !session.client || !session.client.input) return;
                var input = session.client.input;
                var map = {
                    Meta: 'MetaLeft',
                    'Alt+Tab': 'Tab',
                    PrintScreen: 'PrintScreen',
                    Escape: 'Escape'
                };
                var code = map[btn.dataset.special];
                if (!code) return;
                var down = new KeyboardEvent('keydown', { code: code, bubbles: true, cancelable: true });
                if (btn.dataset.special === 'Alt+Tab') {
                    down = new KeyboardEvent('keydown', { code: 'Tab', altKey: true, bubbles: true, cancelable: true });
                }
                input._handleKeyDown(down);
                var up = new KeyboardEvent('keyup', { code: code, bubbles: true, cancelable: true });
                if (btn.dataset.special === 'Alt+Tab') {
                    up = new KeyboardEvent('keyup', { code: 'Tab', altKey: true, bubbles: true, cancelable: true });
                }
                input._handleKeyUp(up);
                specialPanel.classList.remove('open');
            });
        });

        if (kbBridge) {
            kbBridge.addEventListener('keydown', function(e) {
                var session = getActiveSession();
                if (!session || !session.client || !session.client.input) return;
                session.client.input._handleKeyDown(e);
            });
            kbBridge.addEventListener('keyup', function(e) {
                var session = getActiveSession();
                if (!session || !session.client || !session.client.input) return;
                session.client.input._handleKeyUp(e);
            });
        }

        if (window.RdClientMobile) {
            window.RdClientMobile.initVisualViewport(resizeViewerForViewport);
        }
    }

    var viewerInitialized = false;
    var mobileBindingsDone = false;

    function startViewerInit() {
        if (viewerInitialized) return;
        viewerInitialized = true;

        applyTransportCapabilities();
        if (!mobileBindingsDone) {
            initMobileViewerBindings();
            mobileBindingsDone = true;
        }

        const deviceId = window.__initialDeviceId;
        const deviceName = window.__initialDeviceName || '';
        const devicePlatform = window.__initialDevicePlatform || '';
        const panelPref = new URLSearchParams(window.location.search).get('panel');
        if (panelPref === 'files') {
            window.__openFilePanelOnConnect = true;
        }
        if (deviceId) {
            createSession(deviceId, deviceName, devicePlatform);
        }

        // Support opening additional sessions via URL hash: #add=DEVICE_ID
        if (window.location.hash && !isGuestAccessMode()) {
            const match = window.location.hash.match(/add=([A-Za-z0-9_-]+)/);
            if (match && match[1] && match[1] !== deviceId) {
                createSession(match[1], '');
            }
        }

        // ---- BroadcastChannel for cross-tab session adding ----
        // Devices page can send {type:'add-session', deviceId, deviceName}
        // to add a new tab here without opening a new browser tab.
        try {
            const bc = new BroadcastChannel('betterdesk-remote');
            bc.onmessage = (ev) => {
                const msg = ev.data;
                if (!msg || typeof msg !== 'object') return;
                if (msg.type === 'add-session' && msg.deviceId) {
                    // Validate deviceId format (alphanumeric, hyphens, underscores)
                    if (!/^[A-Za-z0-9_-]+$/.test(msg.deviceId)) return;
                    if (!isPeerAllowedForGuest(msg.deviceId)) return;
                    createSession(msg.deviceId, msg.deviceName || '');
                    // Acknowledge so the sender knows we handled it
                    bc.postMessage({ type: 'session-added', deviceId: msg.deviceId });
                    // Bring this window to front
                    window.focus();
                } else if (msg.type === 'ping') {
                    bc.postMessage({ type: 'pong' });
                }
            };
        } catch (_) {
            // BroadcastChannel not supported — cross-tab disabled
        }
    }

    function bootViewer() {
        installLifecycleHandlers();
        if (window.RdClientMobile && window.RdClientMobile.watchPhoneGate) {
            window.RdClientMobile.watchPhoneGate(startViewerInit);
        } else {
            startViewerInit();
        }
    }

    // ── Tab / window lifecycle: auto-disconnect on tab close ─────────────
    //
    // Without this hook the remote peer keeps streaming video/audio until
    // the relay notices the WebSocket is gone (seconds, sometimes longer
    // when the OS pauses the page). An explicit `pagehide` / `beforeunload`
    // triggers a clean `disconnect()` on every active session so the peer
    // tears down immediately — saves bandwidth and CPU on the remote end.
    function installLifecycleHandlers() {
        const teardown = (event) => {
            // Mobile browsers can place the viewer in the back-forward cache.
            // Preserve the live session while the page is restorable; unload
            // and navigation events still perform the normal cleanup.
            if (event && event.persisted) return;
            for (const session of sessions.values()) {
                try {
                    if (session.client) session.client.disconnect();
                } catch { /* ignore */ }
                if (session.mediaRecorder && session.mediaRecorder.state === 'recording') {
                    try { session.mediaRecorder.stop(); } catch { /* ignore */ }
                }
            }
        };
        // pagehide fires on tab close, navigation, and bfcache eviction —
        // the most reliable modern hook.
        window.addEventListener('pagehide', teardown, { capture: true });
        // Keep the legacy fallback only where pagehide is unavailable;
        // beforeunload listeners can prevent mobile bfcache restoration.
        if (!('onpagehide' in window)) {
            window.addEventListener('beforeunload', teardown, { capture: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootViewer);
    } else {
        bootViewer();
    }
})();
