/**
 * RustDesk-style centered file transfer modal for Web Remote.
 */
(function () {
    'use strict';

    function t(key, fallback) {
        if (typeof window.t === 'function') {
            var val = window.t(key);
            if (val && val !== key) return val;
        }
        return fallback !== undefined ? fallback : key;
    }

    function escapeHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatSize(bytes) {
        if (typeof RDFileTransfer !== 'undefined' && RDFileTransfer.formatSize) {
            return RDFileTransfer.formatSize(bytes);
        }
        if (!bytes) return '0 B';
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + ['B', 'KB', 'MB', 'GB'][i];
    }

    /**
     * Mount overlays inside the viewer shell so they stay visible when
     * #rd-viewer-shell is the Fullscreen API element (body children are hidden).
     */
    function getOverlayHost() {
        return document.fullscreenElement
            || document.getElementById('rd-viewer-shell')
            || document.body;
    }

    function FileTransferModal() {
        this._el = null;
        this._open = false;
        this._session = null;
        this._local = typeof LocalFiles === 'function' ? new LocalFiles() : null;
        this._localEntries = [];
        this._remoteEntries = [];
        this._selectedLocal = null;
        this._selectedRemote = null;
        this._leftTarget = { type: 'local' };
        this._rightTarget = null;
        this._leftRemoteEntries = [];
        this._leftRemotePath = '';
        this._selectedLeftRemote = null;
        this._rightLocalEntries = [];
        this._selectedRightLocal = null;
        this._wiredTransferSessions = new Set();
        this._transferMeta = new Map();
        this._wiredSessionId = null;
        this._remoteReady = false;
        this._pendingNativePaths = null;
        this._contextMenu = null;
        this._queuePaintTimer = null;
        this._queuePaintPending = false;
    }

    FileTransferModal.prototype._ensureDom = function () {
        if (this._el) return;
        var el = document.createElement('div');
        el.className = 'file-transfer-modal-overlay';
        el.id = 'file-transfer-modal';
        el.style.display = 'none';
        el.innerHTML =
            '<div class="file-transfer-modal" role="dialog" aria-modal="true">' +
                '<div class="ft-modal-header">' +
                    '<span class="material-icons">folder_open</span>' +
                    '<span class="ft-modal-title"></span>' +
                    '<button type="button" class="ft-modal-close"><span class="material-icons">close</span></button>' +
                '</div>' +
                '<div class="ft-modal-body">' +
                    '<div class="ft-pane ft-pane-local">' +
                        '<div class="ft-pane-head"><span class="material-icons">computer</span><select class="ft-target-picker ft-left-picker" aria-label=""></select></div>' +
                        '<div class="ft-pane-toolbar">' +
                            '<button type="button" class="ft-btn ft-local-pick" title=""><span class="material-icons">folder_open</span></button>' +
                            '<button type="button" class="ft-btn ft-local-up"><span class="material-icons">arrow_upward</span></button>' +
                            '<button type="button" class="ft-btn ft-local-home"><span class="material-icons">home</span></button>' +
                            '<span class="ft-path ft-local-path"></span>' +
                            '<button type="button" class="ft-btn ft-btn-action ft-local-send"></button>' +
                        '</div>' +
                        '<div class="ft-local-body">' +
                            '<div class="ft-local-dropzone ft-dropzone-disabled" tabindex="0" role="button">' +
                                '<span class="material-icons ft-dropzone-icon">upload_file</span>' +
                                '<span class="ft-dropzone-title"></span>' +
                                '<span class="ft-dropzone-subtitle"></span>' +
                                '<span class="ft-dropzone-multiple"></span>' +
                                '<span class="ft-dropzone-target"></span>' +
                            '</div>' +
                            '<div class="ft-list ft-local-list" hidden></div>' +
                        '</div>' +
                        '<input type="file" class="ft-local-file-input" multiple hidden />' +
                    '</div>' +
                    '<div class="ft-pane ft-pane-remote">' +
                        '<div class="ft-pane-head"><span class="material-icons">desktop_windows</span><select class="ft-target-picker ft-right-picker" aria-label=""></select></div>' +
                        '<div class="ft-pane-toolbar">' +
                            '<button type="button" class="ft-btn ft-remote-new-folder" title=""><span class="material-icons">create_new_folder</span></button>' +
                            '<button type="button" class="ft-btn ft-remote-hidden" title=""><span class="material-icons">visibility_off</span></button>' +
                            '<button type="button" class="ft-btn ft-remote-up"><span class="material-icons">arrow_upward</span></button>' +
                            '<button type="button" class="ft-btn ft-remote-home"><span class="material-icons">home</span></button>' +
                            '<span class="ft-path ft-remote-path"></span>' +
                            '<button type="button" class="ft-btn ft-btn-action ft-remote-download"></button>' +
                        '</div>' +
                        '<div class="ft-list ft-remote-list"></div>' +
                        '<div class="ft-drop-overlay" hidden>' +
                            '<span class="material-icons">cloud_upload</span>' +
                            '<span class="ft-drop-overlay-text"></span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="ft-pane ft-pane-queue">' +
                        '<div class="ft-pane-head"><span class="material-icons">swap_vert</span><span class="ft-pane-label"></span></div>' +
                        '<div class="ft-queue-list"></div>' +
                        '<div class="ft-queue-empty"><span class="material-icons">sync_alt</span><span></span></div>' +
                    '</div>' +
                '</div>' +
                '<div class="ft-overwrite-dialog" hidden role="alertdialog" aria-modal="true">' +
                    '<div class="ft-overwrite-panel">' +
                        '<div class="ft-overwrite-title"></div>' +
                        '<div class="ft-overwrite-message"></div>' +
                        '<div class="ft-overwrite-actions">' +
                            '<button type="button" class="btn btn-sm btn-secondary ft-overwrite-skip"></button>' +
                            '<button type="button" class="btn btn-sm btn-secondary ft-overwrite-skip-all"></button>' +
                            '<button type="button" class="btn btn-sm btn-primary ft-overwrite-confirm"></button>' +
                            '<button type="button" class="btn btn-sm btn-primary ft-overwrite-all"></button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
        getOverlayHost().appendChild(el);
        this._el = el;
        el.querySelector('.ft-pane-queue .ft-pane-label').textContent = t('remote.file_transfers', 'Transfers');
        el.querySelector('.ft-local-send').innerHTML = t('remote.file_send', 'Send') + ' <span class="material-icons">chevron_right</span>';
        el.querySelector('.ft-remote-download').innerHTML = '<span class="material-icons">chevron_left</span> ' + t('remote.file_download', 'Download');
        el.querySelector('.ft-queue-empty span:last-child').textContent = t('remote.file_queue_empty', 'No transfers in progress');
        el.querySelector('.ft-local-pick').title = t('remote.file_pick_folder', 'Choose folder');
        el.querySelector('.ft-remote-new-folder').title = t('remote.file_new_folder', 'New Folder');
        el.querySelector('.ft-remote-hidden').title = t('remote.file_show_hidden', 'Show hidden files');

        this._initDropzoneLabels();
        this._initOverwriteDialogLabels();

        var self = this;
        el.querySelector('.ft-modal-close').addEventListener('click', function () { self.close(); });
        el.addEventListener('click', function (e) { if (e.target === el) self.close(); });
        el.querySelector('.ft-local-pick').addEventListener('click', function () {
            if (self._leftTarget && self._leftTarget.type === 'session') {
                self._toggleSideHidden('left');
            } else {
                self._pickLocalFolder();
            }
        });
        el.querySelector('.ft-local-up').addEventListener('click', function () {
            if (self._leftTarget && self._leftTarget.type === 'session') self._remoteSideGoUp('left');
            else self._localGoUp();
        });
        el.querySelector('.ft-local-home').addEventListener('click', function () {
            if (self._leftTarget && self._leftTarget.type === 'session') self._remoteSideGoHome('left');
            else self._localGoHome();
        });
        el.querySelector('.ft-local-send').addEventListener('click', function () {
            if (self._leftTarget && self._leftTarget.type === 'session') self._copySelectedTarget('left');
            else self._sendSelectedLocal();
        });
        el.querySelector('.ft-remote-up').addEventListener('click', function () {
            if (self._rightTarget && self._rightTarget.type === 'local') self._localGoUp();
            else self._remoteGoUp();
        });
        el.querySelector('.ft-remote-home').addEventListener('click', function () {
            if (self._rightTarget && self._rightTarget.type === 'local') self._localGoHome();
            else self._remoteGoHome();
        });
        el.querySelector('.ft-remote-download').addEventListener('click', function () {
            if (self._rightTarget && self._rightTarget.type === 'local') {
                self._copySelectedTarget('left');
            } else if (self._leftTarget && self._leftTarget.type === 'session') {
                self._copySelectedTarget('right');
            } else {
                self._downloadSelectedRemote();
            }
        });
        el.querySelector('.ft-remote-new-folder').addEventListener('click', function () {
            if (self._rightTarget && self._rightTarget.type === 'local') self._pickLocalFolder();
            else self._remoteNewFolder();
        });
        el.querySelector('.ft-remote-hidden').addEventListener('click', function () {
            if (self._rightTarget && self._rightTarget.type === 'local') return;
            self._toggleRemoteHidden();
        });
        el.querySelector('.ft-local-file-input').addEventListener('change', function (e) {
            self._uploadFiles(e.target.files);
            e.target.value = '';
        });
        el.querySelector('.ft-left-picker').addEventListener('change', function (e) {
            self._selectTransferTarget('left', e.target.value);
        });
        el.querySelector('.ft-right-picker').addEventListener('change', function (e) {
            self._selectTransferTarget('right', e.target.value);
        });

        var dropzone = el.querySelector('.ft-local-dropzone');
        dropzone.addEventListener('click', function () {
            if (dropzone.classList.contains('ft-dropzone-disabled')) return;
            if (typeof LocalFiles !== 'undefined' && LocalFiles.isDesktopBridge && LocalFiles.isDesktopBridge()) {
                LocalFiles.pickNativeFiles().then(function (files) {
                    self._uploadNativeFiles(files);
                }).catch(function (e) {
                    if (e && e.message !== 'AbortError') console.warn('[FileModal]', e);
                });
                return;
            }
            self._el.querySelector('.ft-local-file-input').click();
        });
        dropzone.addEventListener('keydown', function (e) {
            if (dropzone.classList.contains('ft-dropzone-disabled')) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                self._el.querySelector('.ft-local-file-input').click();
            }
        });
        dropzone.addEventListener('dragover', function (e) {
            if (dropzone.classList.contains('ft-dropzone-disabled')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            dropzone.classList.add('ft-dropzone-active');
        });
        dropzone.addEventListener('dragleave', function (e) {
            if (dropzone.contains(e.relatedTarget)) return;
            dropzone.classList.remove('ft-dropzone-active');
        });
        dropzone.addEventListener('drop', function (e) {
            if (dropzone.classList.contains('ft-dropzone-disabled')) return;
            e.preventDefault();
            dropzone.classList.remove('ft-dropzone-active');
            if (typeof LocalFiles !== 'undefined' && LocalFiles.isDesktopBridge && LocalFiles.isDesktopBridge()) {
                return;
            }
            if (e.dataTransfer && e.dataTransfer.files.length) self._uploadFiles(e.dataTransfer.files);
        });

        var remotePane = el.querySelector('.ft-pane-remote');
        remotePane.addEventListener('dragover', function (e) {
            if (!self._remoteReady) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            remotePane.classList.add('ft-drag-over');
            self._showDragOverlay();
        });
        remotePane.addEventListener('dragleave', function (e) {
            if (remotePane.contains(e.relatedTarget)) return;
            remotePane.classList.remove('ft-drag-over');
            self._hideDragOverlay();
        });
        remotePane.addEventListener('drop', function (e) {
            if (!self._remoteReady) return;
            e.preventDefault();
            remotePane.classList.remove('ft-drag-over');
            self._hideDragOverlay();
            if (typeof LocalFiles !== 'undefined' && LocalFiles.isDesktopBridge && LocalFiles.isDesktopBridge()) {
                return;
            }
            if (e.dataTransfer && e.dataTransfer.files.length) self._uploadFiles(e.dataTransfer.files);
        });

        document.addEventListener('click', function () { self._hideContextMenu(); });
    };

    FileTransferModal.prototype._initDropzoneLabels = function () {
        if (!this._el) return;
        var dz = this._el.querySelector('.ft-local-dropzone');
        if (!dz) return;
        dz.querySelector('.ft-dropzone-title').textContent = t('remote.file_dropzone_title', 'Drop files or folders here');
        dz.querySelector('.ft-dropzone-subtitle').textContent = t('remote.file_dropzone_subtitle', 'or click to choose files');
        dz.querySelector('.ft-dropzone-multiple').textContent = t('remote.file_dropzone_multiple', 'Files and folders supported');
        dz.setAttribute('aria-label', t('remote.file_dropzone_title', 'Drop files or folders here'));
    };

    FileTransferModal.prototype._initOverwriteDialogLabels = function () {
        if (!this._el) return;
        this._el.querySelector('.ft-overwrite-title').textContent = t('remote.file_overwrite_title', 'File already exists');
        this._el.querySelector('.ft-overwrite-skip').textContent = t('remote.file_overwrite_skip', 'Skip');
        this._el.querySelector('.ft-overwrite-skip-all').textContent = t('remote.file_overwrite_skip_all', 'Skip all');
        this._el.querySelector('.ft-overwrite-confirm').textContent = t('remote.file_overwrite_confirm', 'Overwrite');
        this._el.querySelector('.ft-overwrite-all').textContent = t('remote.file_overwrite_all', 'Overwrite all');
    };

    FileTransferModal.prototype._updateDropzoneTarget = function () {
        if (!this._el) return;
        var target = this._el.querySelector('.ft-dropzone-target');
        if (!target) return;
        var ft = this._session && this._session.client && this._session.client.fileTransfer;
        var path = (ft && ft.currentPath) ? ft.currentPath : t('remote.file_remote', 'Remote');
        var hint = t('remote.file_drop_upload_hint', 'Drop to upload to: {path}');
        target.textContent = hint.replace('{path}', path);
    };

    FileTransferModal.prototype._setDropzoneEnabled = function (enabled) {
        if (!this._el) return;
        this._remoteReady = !!enabled;
        var dz = this._el.querySelector('.ft-local-dropzone');
        if (dz) {
            dz.classList.toggle('ft-dropzone-disabled', !enabled);
            if (!enabled) {
                var wait = t('remote.file_dropzone_waiting', 'Waiting for remote connection…');
                dz.querySelector('.ft-dropzone-target').textContent = wait;
            } else {
                this._updateDropzoneTarget();
            }
        }
        if (enabled && this._pendingNativePaths && this._pendingNativePaths.length) {
            var pending = this._pendingNativePaths;
            this._pendingNativePaths = null;
            this.uploadNativePaths(pending);
        }
    };

    FileTransferModal.prototype._syncLocalLayout = function () {
        if (!this._el) return;
        var hasRoot = !!(this._local && this._local.hasRoot);
        var dz = this._el.querySelector('.ft-local-dropzone');
        var list = this._el.querySelector('.ft-local-list');
        if (dz) dz.classList.toggle('compact', hasRoot);
        if (list) list.hidden = !hasRoot;
    };

    FileTransferModal.prototype._syncSaveDownloadHook = function () {
        var self = this;
        var ft = this._session && this._session.client && this._session.client.fileTransfer;
        if (!ft) return;
        if (!this._local) {
            ft._saveDownload = null;
            return;
        }
        if (typeof LocalFiles !== 'undefined' && LocalFiles.isDesktopBridge && LocalFiles.isDesktopBridge()) {
            ft._saveDownload = function (fileName, blob) {
                return self._local.saveDownload(fileName, blob);
            };
            return;
        }
        if (this._local.hasRoot) {
            ft._saveDownload = function (fileName, blob) {
                return self._local.saveDownload(fileName, blob);
            };
        } else {
            ft._saveDownload = null;
        }
    };

    FileTransferModal.prototype._showDragOverlay = function () {
        var overlay = this._el && this._el.querySelector('.ft-drop-overlay');
        if (!overlay) return;
        var ft = this._session && this._session.client && this._session.client.fileTransfer;
        var path = (ft && ft.currentPath) ? ft.currentPath : t('remote.file_remote', 'Remote');
        var hint = t('remote.file_drop_upload_hint', 'Drop to upload to: {path}');
        overlay.querySelector('.ft-drop-overlay-text').textContent = hint.replace('{path}', path);
        overlay.hidden = false;
    };

    FileTransferModal.prototype._hideDragOverlay = function () {
        var overlay = this._el && this._el.querySelector('.ft-drop-overlay');
        if (overlay) overlay.hidden = true;
    };

    FileTransferModal.prototype._updateLocalToolbarState = function () {
        if (!this._el) return;
        var hasRoot = !!(this._local && this._local.hasRoot);
        var noTreeTitle = t('remote.file_no_local_tree', 'Choose a folder to browse local files (optional)');
        var upBtn = this._el.querySelector('.ft-local-up');
        var homeBtn = this._el.querySelector('.ft-local-home');
        var sendBtn = this._el.querySelector('.ft-local-send');
        if (upBtn) {
            if (!upBtn.dataset.defaultTitle) upBtn.title = t('remote.file_up', 'Up');
            upBtn.dataset.defaultTitle = upBtn.title;
            upBtn.disabled = !hasRoot;
            upBtn.title = hasRoot ? upBtn.dataset.defaultTitle : noTreeTitle;
        }
        if (homeBtn) {
            if (!homeBtn.dataset.defaultTitle) homeBtn.title = t('remote.file_home', 'Home');
            homeBtn.dataset.defaultTitle = homeBtn.title;
            homeBtn.disabled = !hasRoot;
            homeBtn.title = hasRoot ? homeBtn.dataset.defaultTitle : noTreeTitle;
        }
        if (sendBtn) sendBtn.style.display = hasRoot ? '' : 'none';
        this._syncLocalLayout();
    };

    FileTransferModal.prototype._updateRemoteHiddenButton = function () {
        var btn = this._el && this._el.querySelector('.ft-remote-hidden');
        var ft = this._session && this._session.client && this._session.client.fileTransfer;
        if (!btn || !ft) return;
        var icon = btn.querySelector('.material-icons');
        if (ft.showHidden) {
            icon.textContent = 'visibility';
            btn.title = t('remote.file_hide_hidden', 'Hide hidden files');
            btn.classList.add('active');
        } else {
            icon.textContent = 'visibility_off';
            btn.title = t('remote.file_show_hidden', 'Show hidden files');
            btn.classList.remove('active');
        }
    };

    FileTransferModal.prototype._ensureMountedInHost = function () {
        if (!this._el) return;
        var host = getOverlayHost();
        if (this._el.parentNode !== host) {
            host.appendChild(this._el);
        }
    };

    FileTransferModal.prototype._getTransferSessions = function () {
        if (typeof window.__rdGetTransferSessions !== 'function') return [];
        try { return window.__rdGetTransferSessions() || []; } catch (_) { return []; }
    };

    FileTransferModal.prototype._targetKey = function (target) {
        return target && target.type === 'session'
            ? 'session:' + String(target.session.deviceId)
            : 'local';
    };

    FileTransferModal.prototype._targetLabel = function (target) {
        if (!target || target.type === 'local') return t('remote.file_local', 'Local computer');
        return target.session.deviceName || target.session.deviceId;
    };

    FileTransferModal.prototype._populateTargetPickers = function () {
        if (!this._el) return;
        var sessions = this._getTransferSessions();
        var self = this;
        ['left', 'right'].forEach(function (side) {
            var picker = self._el.querySelector('.ft-' + side + '-picker');
            if (!picker) return;
            picker.innerHTML = '';
            var local = document.createElement('option');
            local.value = 'local';
            local.textContent = t('remote.file_local', 'Local computer');
            picker.appendChild(local);
            sessions.forEach(function (item) {
                var option = document.createElement('option');
                option.value = 'session:' + item.id;
                option.textContent = item.name || item.id;
                picker.appendChild(option);
            });
        });
        this._syncTargetPickerValues();
    };

    FileTransferModal.prototype._syncTargetPickerValues = function () {
        if (!this._el) return;
        var left = this._el.querySelector('.ft-left-picker');
        var right = this._el.querySelector('.ft-right-picker');
        if (left) left.value = this._targetKey(this._leftTarget);
        if (right && this._rightTarget) right.value = this._targetKey(this._rightTarget);
    };

    FileTransferModal.prototype._findTransferTarget = function (value) {
        if (value === 'local') return { type: 'local' };
        var id = String(value || '').replace(/^session:/, '');
        var item = this._getTransferSessions().find(function (candidate) {
            return String(candidate.id) === id;
        });
        return item ? { type: 'session', session: item.session || item } : null;
    };

    FileTransferModal.prototype._selectTransferTarget = function (side, value) {
        var target = this._findTransferTarget(value);
        if (!target) return;
        var other = side === 'left' ? this._rightTarget : this._leftTarget;
        if (target.type === 'session' && other && other.type === 'session'
            && target.session.deviceId === other.session.deviceId) {
            this._showTransferMessage(t('remote.file_same_side',
                'Choose two different computers for a remote-to-remote transfer.'));
            this._syncTargetPickerValues();
            return;
        }
        if (side === 'left') this._leftTarget = target;
        else this._rightTarget = target;
        this._activateTransferTargets();
    };

    FileTransferModal.prototype._showTransferMessage = function (message) {
        if (typeof window.showToast === 'function') window.showToast(message, 'warning');
        else console.warn('[FileModal]', message);
    };

    FileTransferModal.prototype._sidePane = function (side) {
        return this._el && this._el.querySelector(side === 'left' ? '.ft-pane-local' : '.ft-pane-remote');
    };

    FileTransferModal.prototype._sideList = function (side) {
        var pane = this._sidePane(side);
        return pane && pane.querySelector(side === 'left' ? '.ft-local-list' : '.ft-remote-list');
    };

    FileTransferModal.prototype._wireLeftClient = function (session) {
        var self = this;
        if (!session || !session.client || this._wiredTransferSessions.has('left:' + session.deviceId)) return;
        this._wiredTransferSessions.add('left:' + session.deviceId);
        var client = session.client;
        client.on('file_browsing', function () {
            self._leftRemoteEntries = [];
            self._renderLeftRemoteLoading(t('remote.file_loading', 'Loading…'));
        });
        client.on('file_connecting', function () {
            if (!self._leftRemoteEntries.length) {
                self._renderLeftRemoteLoading(t('remote.file_connecting', 'Connecting file transfer session…'));
            }
        });
        client.on('file_connect_error', function (data) {
            self._renderLeftRemoteError(data.error || t('remote.file_connect_failed',
                'Could not open file transfer session'));
        });
        client.on('file_dir', function (data) {
            if (!self._leftTarget || self._leftTarget.type !== 'session'
                || self._leftTarget.session.deviceId !== session.deviceId) return;
            self._leftRemoteEntries = data.entries || [];
            self._selectedLeftRemote = null;
            self._leftRemotePath = data.path || '';
            var path = self._el.querySelector('.ft-local-path');
            if (path) path.textContent = self._leftRemotePath || '/';
            self._renderLeftRemoteList();
        });
        client.on('file_browse_timeout', function () {
            if (self._leftTarget && self._leftTarget.type === 'session'
                && self._leftTarget.session.deviceId === session.deviceId) {
                self._renderLeftRemoteError(t('remote.file_timeout', 'Remote device did not respond.'));
            }
        });
        client.on('file_transfer_start', function (data) { self._addTransfer(data); });
        client.on('file_transfer_progress', function (data) { self._updateTransfer(data); });
        client.on('file_transfer_complete', function (data) { self._completeTransfer(data); });
        client.on('file_transfer_error', function (data) { self._errorTransfer(data); });
        client.on('file_transfer_cancelled', function (data) { self._removeTransfer(data.id); });
    };

    FileTransferModal.prototype._renderLeftRemoteLoading = function (message) {
        var list = this._sideList('left');
        if (list) list.hidden = false;
        if (list) list.innerHTML = '<div class="ft-empty"><span class="material-icons spinning">sync</span> ' +
            escapeHtml(message) + '</div>';
    };

    FileTransferModal.prototype._renderLeftRemoteError = function (message) {
        var list = this._sideList('left');
        if (!list) return;
        list.hidden = false;
        list.innerHTML = '<div class="ft-empty ft-error"><span class="material-icons">warning</span> ' +
            escapeHtml(message) + '</div>';
    };

    FileTransferModal.prototype._renderLeftRemoteList = function () {
        var list = this._sideList('left');
        if (!list) return;
        list.hidden = false;
        list.innerHTML = '';
        if (!this._leftRemoteEntries.length) {
            list.innerHTML = '<div class="ft-empty">' + escapeHtml(t('remote.file_empty', 'No files')) + '</div>';
            return;
        }
        var self = this;
        var ft = this._leftTarget.session.client.fileTransfer;
        this._leftRemoteEntries.forEach(function (entry) {
            var row = document.createElement('div');
            row.className = 'ft-row' + (entry.isDir ? ' ft-row-dir' : '');
            if (self._selectedLeftRemote === entry) row.classList.add('selected');
            var icon = typeof RDFileTransfer !== 'undefined'
                ? RDFileTransfer.getFileIcon(entry) : (entry.isDir ? 'folder' : 'insert_drive_file');
            row.innerHTML = '<span class="material-icons ft-row-icon">' + icon + '</span>' +
                '<span class="ft-row-name">' + escapeHtml(entry.name) + '</span>' +
                '<span class="ft-row-size">' + (entry.isDir ? '' : formatSize(entry.size)) + '</span>';
            row.addEventListener('click', function () {
                if (entry.isDir) {
                    var sep = (ft.currentPath || '').includes('\\') ? '\\' : '/';
                    var base = ft.currentPath || '';
                    ft.browseDir(base ? base.replace(/[\\/]+$/, '') + sep + entry.name : entry.name);
                } else {
                    self._selectedLeftRemote = entry;
                    self._renderLeftRemoteList();
                }
            });
            row.addEventListener('dblclick', function () {
                if (!entry.isDir) self._copySelectedTarget('left');
            });
            list.appendChild(row);
        });
    };

    FileTransferModal.prototype._renderLocalEntriesInto = function (list, entries, side) {
        if (!list) return;
        list.hidden = false;
        list.innerHTML = '';
        if (!entries.length) {
            list.innerHTML = '<div class="ft-empty">' + escapeHtml(t('remote.file_empty', 'No files')) + '</div>';
            return;
        }
        var self = this;
        entries.forEach(function (entry) {
            var row = document.createElement('div');
            row.className = 'ft-row' + (entry.isDir ? ' ft-row-dir' : '');
            var selected = side === 'left' ? self._selectedLocal : self._selectedRightLocal;
            if (selected === entry) row.classList.add('selected');
            row.innerHTML = '<span class="material-icons ft-row-icon">' +
                (entry.isDir ? 'folder' : 'insert_drive_file') + '</span>' +
                '<span class="ft-row-name">' + escapeHtml(entry.name) + '</span>' +
                '<span class="ft-row-size">' + (entry.isDir ? '' : formatSize(entry.size)) + '</span>';
            row.addEventListener('click', function () {
                if (entry.isDir) {
                    self._local.enterDir(entry).then(function () {
                        return self._local.listCurrent();
                    }).then(function (next) {
                        self._localEntries = next;
                        self._selectedLocal = null;
                        self._selectedRightLocal = null;
                        self._renderTransferLocalLists();
                    });
                } else if (side === 'left') {
                    self._selectedLocal = entry;
                    self._renderLocalList();
                } else {
                    self._selectedRightLocal = entry;
                    self._renderLocalEntriesInto(list, self._localEntries, side);
                }
            });
            list.appendChild(row);
        });
    };

    FileTransferModal.prototype._renderTransferLocalLists = function () {
        var leftLocal = this._leftTarget && this._leftTarget.type === 'local';
        var rightLocal = this._rightTarget && this._rightTarget.type === 'local';
        var leftList = this._sideList('left');
        var rightList = this._sideList('right');
        if (leftLocal) {
            this._renderLocalList();
        } else if (leftList) {
            leftList.hidden = true;
        }
        if (rightLocal) {
            this._renderLocalEntriesInto(rightList, this._localEntries, 'right');
            var rightPath = this._el.querySelector('.ft-remote-path');
            if (rightPath) rightPath.textContent = this._local ? this._local.currentPath : '';
        }
    };

    FileTransferModal.prototype._activateTransferTargets = function () {
        if (!this._el) return;
        var leftRemote = this._leftTarget && this._leftTarget.type === 'session';
        var rightRemote = this._rightTarget && this._rightTarget.type === 'session';
        var leftDrop = this._el.querySelector('.ft-local-dropzone');
        if (leftDrop) leftDrop.style.display = leftRemote ? 'none' : '';
        this._el.querySelector('.ft-local-send').innerHTML = leftRemote
            ? t('remote.file_copy_to_right', 'Copy to right') + ' <span class="material-icons">chevron_right</span>'
            : t('remote.file_send', 'Send') + ' <span class="material-icons">chevron_right</span>';
        this._el.querySelector('.ft-remote-download').innerHTML = rightRemote
            ? '<span class="material-icons">chevron_left</span> ' + t('remote.file_download', 'Download')
            : '<span class="material-icons">save</span> ' + t('remote.file_copy_to_right', 'Copy here');
        var rightFolderButton = this._el.querySelector('.ft-remote-new-folder');
        rightFolderButton.style.display = '';
        if (rightRemote) {
            rightFolderButton.querySelector('.material-icons').textContent = 'create_new_folder';
            rightFolderButton.title = t('remote.file_new_folder', 'New Folder');
        } else {
            rightFolderButton.querySelector('.material-icons').textContent = 'folder_open';
            rightFolderButton.title = t('remote.file_pick_folder', 'Choose folder');
        }
        this._el.querySelector('.ft-remote-hidden').style.display = rightRemote ? '' : 'none';
        this._renderTransferLocalLists();

        var self = this;
        if (leftRemote) {
            var leftSession = this._leftTarget.session;
            this._wireLeftClient(leftSession);
            var ftLeft = leftSession.client && leftSession.client.fileTransfer;
            if (ftLeft && typeof ftLeft.enable === 'function' && !ftLeft.enabled) ftLeft.enable();
            if (ftLeft) ftLeft.browseDir(ftLeft.currentPath || '');
        }
        if (rightRemote) {
            this._session = this._rightTarget.session;
            this._remoteReady = false;
            this._remoteEntries = [];
            this._selectedRemote = null;
            this._renderRemoteLoading(t('remote.file_connecting', 'Connecting file transfer session…'));
            if (this._wiredSessionId !== this._session.deviceId) {
                this._wireClient(this._session);
                this._wiredSessionId = this._session.deviceId;
            }
            var ftRight = this._session.client.fileTransfer;
            if (ftRight && typeof ftRight.enable === 'function' && !ftRight.enabled) ftRight.enable();
            if (ftRight) ftRight.browseDir(ftRight.currentPath || '');
        } else {
            this._session = null;
            this._remoteReady = false;
        }
        this._syncTargetPickerValues();
        this._updateTransferButtons();
    };

    FileTransferModal.prototype._updateTransferButtons = function () {
        if (!this._el) return;
        var sameRemote = this._leftTarget && this._rightTarget
            && this._leftTarget.type === 'session'
            && this._rightTarget.type === 'session'
            && this._leftTarget.session.deviceId === this._rightTarget.session.deviceId;
        var localToLocal = this._leftTarget && this._rightTarget
            && this._leftTarget.type === 'local' && this._rightTarget.type === 'local';
        var leftAction = this._el.querySelector('.ft-local-send');
        var rightAction = this._el.querySelector('.ft-remote-download');
        if (leftAction) leftAction.disabled = !!sameRemote || !!localToLocal;
        if (rightAction) rightAction.disabled = !!sameRemote || !!localToLocal;
    };

    FileTransferModal.prototype._remoteSideGoUp = function (side) {
        var target = side === 'left' ? this._leftTarget : this._rightTarget;
        var ft = target && target.type === 'session' && target.session.client.fileTransfer;
        if (ft) ft.browseParent();
    };

    FileTransferModal.prototype._remoteSideGoHome = function (side) {
        var target = side === 'left' ? this._leftTarget : this._rightTarget;
        var ft = target && target.type === 'session' && target.session.client.fileTransfer;
        if (ft) ft.browseDir('');
    };

    FileTransferModal.prototype._toggleSideHidden = function (side) {
        var target = side === 'left' ? this._leftTarget : this._rightTarget;
        var ft = target && target.type === 'session' && target.session.client.fileTransfer;
        if (ft) ft.setShowHidden(!ft.showHidden);
    };

    FileTransferModal.prototype._copySelectedTarget = function (sourceSide) {
        var source = sourceSide === 'left' ? this._leftTarget : this._rightTarget;
        var destination = sourceSide === 'left' ? this._rightTarget : this._leftTarget;
        var entry = sourceSide === 'left' ? this._selectedLeftRemote : this._selectedRemote;
        if (!source || !destination || !entry) return;
        if (entry.isDir) {
            this._showTransferMessage(t('remote.file_folder_copy_not_supported',
                'Select a file. Folder copy is not available for this transfer yet.'));
            return;
        }
        if (source.type === 'session' && destination.type === 'session') {
            this._copyRemoteToRemote(source, destination, entry);
            return;
        }
        if (source.type === 'session' && destination.type === 'local') {
            this._copyRemoteToLocal(source, entry);
            return;
        }
        if (source.type === 'local' && destination.type === 'session') {
            if (sourceSide === 'left') this._uploadLocalEntry(entry);
            return;
        }
        this._showTransferMessage(t('remote.file_same_side',
            'Choose two different computers for a transfer.'));
    };

    FileTransferModal.prototype._copyRemoteToRemote = function (source, destination, entry) {
        var sourceFt = source.session.client && source.session.client.fileTransfer;
        var destFt = destination.session.client && destination.session.client.fileTransfer;
        var destClient = destination.session.client;
        if (!sourceFt || !destFt || typeof sourceFt.downloadFileToBlob !== 'function') {
            this._showTransferMessage(t('remote.file_transfer_unavailable',
                'File transfer is not available for this session.'));
            return;
        }
        var sourcePath = sourceFt.currentPath || '';
        var destPath = destFt.currentPath || '';
        this._showTransferMessage(t('remote.file_copy_started', 'Copy started'));
        sourceFt.downloadFileToBlob(sourcePath, entry).then(function (blob) {
            var file = new File([blob], entry.name, {
                type: blob.type || 'application/octet-stream',
                lastModified: Date.now()
            });
            return new Promise(function (resolve, reject) {
                var done = function (data) {
                    if (!data || data.type !== 'upload') return;
                    if (data.fileName !== entry.name) return;
                    destClient.off('file_transfer_complete', done);
                    destClient.off('file_transfer_error', failed);
                    resolve();
                };
                var failed = function (data) {
                    if (!data || data.fileName !== entry.name) return;
                    destClient.off('file_transfer_complete', done);
                    destClient.off('file_transfer_error', failed);
                    reject(new Error(data.error || 'Upload failed'));
                };
                destClient.on('file_transfer_complete', done);
                destClient.on('file_transfer_error', failed);
                destFt.uploadFile(file, destPath);
            });
        }).then(function () {
            var ft = destination.session.client.fileTransfer;
            ft.browseDir(ft.currentPath || '');
        }).catch(function (error) {
            this._showTransferMessage(error.message || t('remote.file_copy_failed', 'Copy failed'));
        }.bind(this));
    };

    FileTransferModal.prototype._copyRemoteToLocal = function (source, entry) {
        var sourceFt = source.session.client && source.session.client.fileTransfer;
        if (!sourceFt || !this._local || !this._local.hasRoot) {
            this._showTransferMessage(t('remote.file_need_local_folder',
                'Choose a local folder first.'));
            return;
        }
        var self = this;
        sourceFt._saveDownload = function (fileName, blob) {
            return self._local.saveDownload(fileName, blob);
        };
        sourceFt.downloadFile(sourceFt.currentPath || '', entry);
    };

    FileTransferModal.prototype.open = function (session) {
        if (!this._local && typeof LocalFiles === 'function') {
            this._local = new LocalFiles();
        }
        this._ensureDom();
        this._ensureMountedInHost();
        this._session = session || null;
        this._leftTarget = { type: 'local' };
        this._rightTarget = session ? { type: 'session', session: session } : { type: 'local' };
        this._leftRemoteEntries = [];
        this._selectedLeftRemote = null;
        this._rightLocalEntries = [];
        this._selectedRightLocal = null;
        this._populateTargetPickers();

        // Always show the overlay first — never fail closed with a silent return.
        this._el.style.display = 'flex';
        this._open = true;
        document.getElementById('btn-file-transfer')?.classList.add('active');

        var title = t('remote.file_transfer', 'File Transfer');
        if (session && (session.deviceName || session.deviceId)) {
            title += ' — ' + (session.deviceName || session.deviceId);
        }
        this._el.querySelector('.ft-modal-title').textContent = title;

        if (!session || !session.client || !session.client.fileTransfer) {
            this._remoteReady = false;
            this._setDropzoneEnabled(false);
            this._renderRemoteError(t('remote.file_transfer_unavailable', 'File transfer is not available for this session.'));
            this._paintTransferQueue();
            return;
        }

        this._transferMeta.clear();
        this._remoteReady = false;
        this._initDropzoneLabels();
        this._setDropzoneEnabled(false);
        this._updateLocalToolbarState();
        this._renderLocalList();
        this._remoteEntries = [];
        this._selectedRemote = null;
        this._el.querySelector('.ft-remote-path').textContent = '';
        this._renderRemoteLoading(t('remote.file_connecting', 'Connecting file transfer session…'));
        this._updateRemoteHiddenButton();
        this._syncSaveDownloadHook();
        this._activateTransferTargets();
        this._paintTransferQueue();
    };

    FileTransferModal.prototype.close = function () {
        this._open = false;
        if (this._el) this._el.style.display = 'none';
        this._hideDragOverlay();
        this._hideContextMenu();
        this._hideOverwriteDialog();
        this._pendingNativePaths = null;
        document.getElementById('btn-file-transfer')?.classList.remove('active');
        if (this._session && this._session.client && this._session.client.fileTransfer) {
            this._session.client.fileTransfer._saveDownload = null;
        }
    };

    FileTransferModal.prototype.isOpen = function () {
        return !!this._open && !!this._el && this._el.style.display !== 'none';
    };

    FileTransferModal.prototype._wireClient = function (session) {
        var self = this;
        var client = session.client;
        client.on('file_browsing', function () {
            self._remoteEntries = [];
            self._renderRemoteLoading(t('remote.file_loading', 'Loading…'));
            self._setDropzoneEnabled(false);
        });
        client.on('file_connecting', function () {
            if (!self._remoteEntries.length) {
                self._renderRemoteLoading(t('remote.file_connecting', 'Connecting file transfer session…'));
            }
            self._setDropzoneEnabled(false);
        });
        client.on('file_connect_error', function (data) {
            self._renderRemoteError(data.error || t('remote.file_connect_failed', 'Could not open file transfer session'));
            self._setDropzoneEnabled(false);
        });
        client.on('file_dir', function (data) {
            self._remoteEntries = data.entries || [];
            self._selectedRemote = null;
            self._el.querySelector('.ft-remote-path').textContent = data.path || '/';
            self._renderRemoteList();
            self._setDropzoneEnabled(true);
            self._updateDropzoneTarget();
            self._updateRemoteHiddenButton();
        });
        client.on('file_browse_timeout', function () {
            self._renderRemoteError(t('remote.file_timeout', 'Remote device did not respond.'));
            self._setDropzoneEnabled(false);
        });
        client.on('file_transfer_start', function (data) { self._addTransfer(data); });
        client.on('file_transfer_progress', function (data) { self._updateTransfer(data); });
        client.on('file_transfer_complete', function (data) { self._completeTransfer(data); });
        client.on('file_transfer_error', function (data) { self._errorTransfer(data); });
        client.on('file_transfer_cancelled', function (data) { self._removeTransfer(data.id); });
        client.on('file_transfer_overwrite_prompt', function (data) { self._showOverwriteDialog(data); });
        client.on('file_action', function () {
            setTimeout(function () {
                var ft = self._session && self._session.client && self._session.client.fileTransfer;
                if (ft) ft.browseDir(ft.currentPath || '');
            }, 400);
        });
    };

    FileTransferModal.prototype._pickLocalFolder = async function () {
        try {
            await this._local.pickRoot();
            this._el.querySelector('.ft-local-path').textContent = this._local.currentPath;
            this._localEntries = await this._local.listCurrent();
            this._selectedLocal = null;
            this._renderLocalList();
            this._syncSaveDownloadHook();
            this._updateLocalToolbarState();
        } catch (e) {
            if (e.name !== 'AbortError' && e.message !== 'unsupported') console.warn('[FileModal]', e);
        }
    };

    FileTransferModal.prototype._localGoUp = async function () {
        if (!this._local.hasRoot) return;
        await this._local.goUp();
        this._el.querySelector('.ft-local-path').textContent = this._local.currentPath;
        this._localEntries = await this._local.listCurrent();
        this._selectedLocal = null;
        this._renderLocalList();
    };

    FileTransferModal.prototype._localGoHome = async function () {
        if (!this._local.hasRoot) return;
        await this._local.goHome();
        this._el.querySelector('.ft-local-path').textContent = this._local.currentPath;
        this._localEntries = await this._local.listCurrent();
        this._selectedLocal = null;
        this._renderLocalList();
    };

    FileTransferModal.prototype._renderLocalList = function () {
        var list = this._el.querySelector('.ft-local-list');
        if (!list) return;
        if (!this._local || !this._local.hasRoot) {
            list.innerHTML = '';
            return;
        }
        list.innerHTML = '';
        if (!this._localEntries.length) {
            list.innerHTML = '<div class="ft-empty">' + escapeHtml(t('remote.file_empty', 'No files')) + '</div>';
            return;
        }
        var self = this;
        this._localEntries.forEach(function (entry) {
            var row = document.createElement('div');
            row.className = 'ft-row' + (entry.isDir ? ' ft-row-dir' : '');
            if (self._selectedLocal === entry) row.classList.add('selected');
            row.innerHTML = '<span class="material-icons ft-row-icon">' + (entry.isDir ? 'folder' : 'insert_drive_file') + '</span>' +
                '<span class="ft-row-name">' + escapeHtml(entry.name) + '</span>' +
                '<span class="ft-row-size">' + (entry.isDir ? '' : formatSize(entry.size)) + '</span>';
            row.addEventListener('click', function () {
                if (entry.isDir) {
                    self._local.enterDir(entry).then(function () {
                        self._el.querySelector('.ft-local-path').textContent = self._local.currentPath;
                        return self._local.listCurrent();
                    }).then(function (entries) {
                        self._localEntries = entries;
                        self._selectedLocal = null;
                        self._renderLocalList();
                    });
                } else {
                    self._selectedLocal = entry;
                    self._renderLocalList();
                }
            });
            row.addEventListener('dblclick', function () {
                if (entry.isDir) self._uploadLocalFolder(entry);
                else self._uploadLocalEntry(entry);
            });
            row.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                self._showLocalContextMenu(e, entry);
            });
            list.appendChild(row);
        });
    };

    FileTransferModal.prototype._renderRemoteLoading = function (msg) {
        this._el.querySelector('.ft-remote-list').innerHTML =
            '<div class="ft-empty"><span class="material-icons spinning">sync</span> ' +
            escapeHtml(msg || t('remote.file_loading', 'Loading…')) + '</div>';
    };

    FileTransferModal.prototype._renderRemoteError = function (msg) {
        this._el.querySelector('.ft-remote-list').innerHTML =
            '<div class="ft-empty ft-error"><span class="material-icons">warning</span> ' + escapeHtml(msg) +
            '<br><button type="button" class="btn btn-sm btn-primary ft-retry">' +
            escapeHtml(t('actions.retry', 'Retry')) + '</button></div>';
        var self = this;
        this._el.querySelector('.ft-retry')?.addEventListener('click', function () {
            var ft = self._session.client?.fileTransfer;
            if (ft) ft.browseDir(ft.currentPath || '');
        });
    };

    FileTransferModal.prototype._buildRemoteFullPath = function (entry) {
        var ft = this._session.client.fileTransfer;
        var sep = (ft.currentPath || '').includes('\\') ? '\\' : '/';
        var base = ft.currentPath || '';
        return base ? (base.replace(/[\\/]+$/, '') + sep + entry.name) : entry.name;
    };

    FileTransferModal.prototype._renderRemoteList = function () {
        var list = this._el.querySelector('.ft-remote-list');
        list.innerHTML = '';
        if (!this._remoteEntries.length) {
            list.innerHTML = '<div class="ft-empty">' + escapeHtml(t('remote.file_empty', 'No files')) + '</div>';
            return;
        }
        var self = this;
        var ft = this._session.client.fileTransfer;
        this._remoteEntries.forEach(function (entry) {
            var row = document.createElement('div');
            row.className = 'ft-row' + (entry.isDir ? ' ft-row-dir' : '');
            if (self._selectedRemote === entry) row.classList.add('selected');
            var icon = typeof RDFileTransfer !== 'undefined' ? RDFileTransfer.getFileIcon(entry) : (entry.isDir ? 'folder' : 'insert_drive_file');
            row.innerHTML = '<span class="material-icons ft-row-icon">' + icon + '</span>' +
                '<span class="ft-row-name">' + escapeHtml(entry.name) + '</span>' +
                '<span class="ft-row-size">' + (entry.isDir ? '' : formatSize(entry.size)) + '</span>';
            row.addEventListener('click', function () {
                if (entry.isDir) {
                    var sep = (ft.currentPath || '').includes('\\') ? '\\' : '/';
                    var base = ft.currentPath || '';
                    var next = base ? (base.replace(/[\\/]+$/, '') + sep + entry.name) : entry.name;
                    ft.browseDir(next);
                } else {
                    self._selectedRemote = entry;
                    self._renderRemoteList();
                }
            });
            row.addEventListener('dblclick', function () {
                if (entry.isDir) self._downloadRemoteFolder(entry);
                else self._downloadRemoteEntry(entry);
            });
            row.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                self._showRemoteContextMenu(e, entry);
            });
            list.appendChild(row);
        });
    };

    FileTransferModal.prototype._remoteGoUp = function () {
        this._session.client?.fileTransfer?.browseParent();
    };

    FileTransferModal.prototype._remoteGoHome = function () {
        this._session.client?.fileTransfer?.browseDir('');
    };

    FileTransferModal.prototype._remoteNewFolder = function () {
        var ft = this._session.client?.fileTransfer;
        if (!ft) return;
        var name = window.prompt(t('remote.file_new_folder_prompt', 'Enter folder name:'));
        if (!name || !name.trim()) return;
        var sep = (ft.currentPath || '').includes('\\') ? '\\' : '/';
        var base = ft.currentPath || '';
        var path = base ? (base.replace(/[\\/]+$/, '') + sep + name.trim()) : name.trim();
        ft.createDir(path);
    };

    FileTransferModal.prototype._toggleRemoteHidden = function () {
        var ft = this._session.client?.fileTransfer;
        if (!ft) return;
        ft.setShowHidden(!ft.showHidden);
        this._updateRemoteHiddenButton();
    };

    FileTransferModal.prototype._hideContextMenu = function () {
        if (this._contextMenu) {
            this._contextMenu.remove();
            this._contextMenu = null;
        }
    };

    FileTransferModal.prototype._showRemoteContextMenu = function (e, entry) {
        var self = this;
        this._hideContextMenu();
        var menu = document.createElement('div');
        menu.className = 'ft-context-menu';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';

        function addItem(label, icon, action) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ft-context-item';
            btn.innerHTML = '<span class="material-icons">' + icon + '</span><span>' + escapeHtml(label) + '</span>';
            btn.addEventListener('click', function () {
                self._hideContextMenu();
                action();
            });
            menu.appendChild(btn);
        }

        if (entry.isDir) {
            addItem(t('remote.file_open', 'Open'), 'folder_open', function () {
                var ft = self._session.client.fileTransfer;
                var sep = (ft.currentPath || '').includes('\\') ? '\\' : '/';
                var base = ft.currentPath || '';
                var next = base ? (base.replace(/[\\/]+$/, '') + sep + entry.name) : entry.name;
                ft.browseDir(next);
            });
            addItem(t('remote.file_download_folder', 'Download folder'), 'folder_zip', function () {
                self._downloadRemoteFolder(entry);
            });
        } else {
            addItem(t('remote.file_download', 'Download'), 'download', function () {
                self._downloadRemoteEntry(entry);
            });
        }
        addItem(t('remote.file_rename', 'Rename'), 'drive_file_rename_outline', function () {
            self._remoteRename(entry);
        });
        addItem(t('actions.delete', 'Delete'), 'delete_outline', function () {
            self._remoteDelete(entry);
        });

        getOverlayHost().appendChild(menu);
        this._contextMenu = menu;
    };

    FileTransferModal.prototype._remoteRename = function (entry) {
        var ft = this._session.client?.fileTransfer;
        if (!ft) return;
        var newName = window.prompt(t('remote.file_rename_prompt', 'Enter new name:'), entry.name);
        if (!newName || !newName.trim() || newName.trim() === entry.name) return;
        ft.rename(this._buildRemoteFullPath(entry), newName.trim());
    };

    FileTransferModal.prototype._remoteDelete = function (entry) {
        var ft = this._session.client?.fileTransfer;
        if (!ft) return;
        if (!window.confirm(t('remote.file_delete_confirm', 'Are you sure you want to delete this item?'))) return;
        var path = this._buildRemoteFullPath(entry);
        if (entry.isDir) ft.removeDir(path, true);
        else ft.removeFile(path);
    };

    FileTransferModal.prototype._showOverwriteDialog = function (data) {
        var dlg = this._el.querySelector('.ft-overwrite-dialog');
        if (!dlg) return;
        var msg = t('remote.file_overwrite_message', 'A file named "{name}" already exists on the remote computer. Overwrite it?');
        dlg.querySelector('.ft-overwrite-message').textContent = msg.replace('{name}', data.fileName || 'file');
        dlg.hidden = false;
        var self = this;
        var ft = this._session.client?.fileTransfer;
        var id = data.id;
        var bind = function (sel, skip, all) {
            var btn = dlg.querySelector(sel);
            var clone = btn.cloneNode(true);
            btn.parentNode.replaceChild(clone, btn);
            clone.addEventListener('click', function () {
                self._hideOverwriteDialog();
                if (ft) ft.confirmOverwrite(id, skip, all);
            });
        };
        bind('.ft-overwrite-skip', true, false);
        bind('.ft-overwrite-skip-all', true, true);
        bind('.ft-overwrite-confirm', false, false);
        bind('.ft-overwrite-all', false, true);
    };

    FileTransferModal.prototype._hideOverwriteDialog = function () {
        var dlg = this._el && this._el.querySelector('.ft-overwrite-dialog');
        if (dlg) dlg.hidden = true;
    };

    FileTransferModal.prototype._showLocalContextMenu = function (e, entry) {
        var self = this;
        this._hideContextMenu();
        var menu = document.createElement('div');
        menu.className = 'ft-context-menu';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';

        function addItem(label, icon, action) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ft-context-item';
            btn.innerHTML = '<span class="material-icons">' + icon + '</span><span>' + escapeHtml(label) + '</span>';
            btn.addEventListener('click', function () {
                self._hideContextMenu();
                action();
            });
            menu.appendChild(btn);
        }

        if (entry.isDir) {
            addItem(t('remote.file_open', 'Open'), 'folder_open', function () {
                self._local.enterDir(entry).then(function () {
                    self._el.querySelector('.ft-local-path').textContent = self._local.currentPath;
                    return self._local.listCurrent();
                }).then(function (entries) {
                    self._localEntries = entries;
                    self._selectedLocal = null;
                    self._renderLocalList();
                });
            });
            addItem(t('remote.file_upload_folder', 'Upload folder'), 'drive_folder_upload', function () {
                self._uploadLocalFolder(entry);
            });
        } else {
            addItem(t('remote.file_upload', 'Upload'), 'upload', function () {
                self._uploadLocalEntry(entry);
            });
        }

        getOverlayHost().appendChild(menu);
        this._contextMenu = menu;
    };

    FileTransferModal.prototype._sendSelectedLocal = function () {
        if (!this._selectedLocal) return;
        if (this._selectedLocal.isDir) this._uploadLocalFolder(this._selectedLocal);
        else this._uploadLocalEntry(this._selectedLocal);
    };

    FileTransferModal.prototype._uploadLocalEntry = async function (entry) {
        var ft = this._session.client?.fileTransfer;
        if (!ft) return;
        var file = await this._local.readFile(entry);
        if (file) ft.uploadFile(file, ft.currentPath || '');
    };

    FileTransferModal.prototype._uploadLocalFolder = async function (entry) {
        var ft = this._session.client?.fileTransfer;
        if (!ft || !entry || !entry.isDir || !this._remoteReady) return;
        try {
            var walk = await this._local.walkFolder(entry);
            if (!walk || (!walk.files.length && !walk.dirs.length)) {
                // Empty folder — still create remote root
                walk = walk || { rootName: entry.name, dirs: [], files: [] };
                walk.rootName = walk.rootName || entry.name;
            }
            ft.uploadFolder(walk, ft.currentPath || '');
        } catch (e) {
            console.warn('[FileModal] folder upload failed:', e);
        }
    };

    FileTransferModal.prototype._uploadFiles = function (fileList) {
        var ft = this._session.client?.fileTransfer;
        if (!ft || !fileList || !this._remoteReady) return;
        for (var i = 0; i < fileList.length; i++) ft.uploadFile(fileList[i], ft.currentPath || '');
    };

    FileTransferModal.prototype._uploadNativeFiles = function (files) {
        var ft = this._session.client?.fileTransfer;
        if (!ft || !files || !files.length || !this._remoteReady) return;
        for (var i = 0; i < files.length; i++) {
            if (files[i]) ft.uploadFile(files[i], ft.currentPath || '');
        }
    };

    FileTransferModal.prototype.uploadNativePaths = function (paths) {
        var self = this;
        if (!paths || !paths.length) return;
        if (!this._remoteReady) {
            this._pendingNativePaths = (this._pendingNativePaths || []).concat(paths);
            return;
        }
        if (typeof LocalFiles === 'undefined' || !LocalFiles.isDesktopBridge || !LocalFiles.isDesktopBridge()) {
            if (typeof RDDesktopDnd !== 'undefined' && RDDesktopDnd.openPaths) {
                RDDesktopDnd.openPaths(paths).then(function (files) {
                    self._uploadNativeFiles(files);
                }).catch(function (e) {
                    console.warn('[FileModal] native drop upload failed:', e);
                });
            }
            return;
        }

        var ft = this._session.client && this._session.client.fileTransfer;
        if (!ft) return;

        // Classify each path: files upload directly; directories become folder jobs.
        var chain = Promise.resolve();
        paths.forEach(function (path) {
            chain = chain.then(function () {
                return LocalFiles.walkDesktopPath(path).then(function (walk) {
                    if (walk.isFile && walk.files.length === 1) {
                        return window.__TAURI__.core.invoke('desktop_open_file', {
                            path: walk.files[0].path
                        }).then(function (info) {
                            var file = LocalFiles.createNativeUploadFile(info);
                            if (file) ft.uploadFile(file, ft.currentPath || '');
                        });
                    }
                    walk.rootName = walk.rootName || (path.split(/[\\/]/).pop() || 'folder');
                    ft.uploadFolder(walk, ft.currentPath || '');
                });
            });
        });
        chain.catch(function (e) {
            console.warn('[FileModal] native drop upload failed:', e);
        });
    };

    FileTransferModal.prototype._downloadSelectedRemote = function () {
        if (!this._selectedRemote) return;
        if (this._selectedRemote.isDir) this._downloadRemoteFolder(this._selectedRemote);
        else this._downloadRemoteEntry(this._selectedRemote);
    };

    FileTransferModal.prototype._downloadRemoteEntry = function (entry) {
        var ft = this._session.client?.fileTransfer;
        if (!ft) return;
        ft.downloadFile(ft.currentPath || '', entry);
    };

    FileTransferModal.prototype._downloadRemoteFolder = async function (entry) {
        var ft = this._session.client?.fileTransfer;
        if (!ft || !entry || !entry.isDir) return;
        try {
            var localRoot = null;
            if (typeof LocalFiles !== 'undefined' && LocalFiles.isDesktopBridge && LocalFiles.isDesktopBridge()) {
                if (this._local.hasRoot && this._local.currentPath) {
                    localRoot = this._local.currentPath;
                } else {
                    var picked = await LocalFiles.pickFolder();
                    if (!picked || !picked.path) return;
                    localRoot = picked.path;
                }
            } else if (this._local.hasRoot && this._local._mode === 'fsa') {
                // Browser FSA folder download streams via per-file save hooks; not supported as tree yet.
                window.alert(t('remote.file_folder_download_desktop_only',
                    'Folder download requires RdClient desktop. Download files individually, or use RdClient desktop.'));
                return;
            } else {
                window.alert(t('remote.file_folder_download_desktop_only',
                    'Folder download requires RdClient desktop. Download files individually, or use RdClient desktop.'));
                return;
            }
            ft.downloadFolder(ft.currentPath || '', entry, localRoot);
        } catch (e) {
            if (e && e.message !== 'AbortError') console.warn('[FileModal] folder download failed:', e);
        }
    };

    FileTransferModal.prototype._ensureTransferMeta = function (data) {
        var id = data.id;
        if (!this._transferMeta.has(id)) {
            this._transferMeta.set(id, {
                id: id,
                fileName: data.fileName || 'file',
                type: data.type || 'download',
                phase: 'pending',
                percent: 0,
                transferred: 0,
                total: data.fileSize || 0,
                error: null,
                resumable: false,
                isFolder: !!data.isFolder,
                currentFile: data.currentFile || null
            });
        }
        return this._transferMeta.get(id);
    };

    FileTransferModal.prototype._transferStatusText = function (meta) {
        if (meta.error) return meta.error;
        if (meta.phase === 'pending') return t('remote.file_status_waiting', 'Waiting…');
        if (meta.phase === 'saving') return t('remote.file_status_saving', 'Saving…');
        if (meta.phase === 'done') {
            if (meta.isFolder) {
                return meta.type === 'upload'
                    ? t('remote.file_status_folder_uploaded', 'Folder uploaded')
                    : t('remote.file_status_folder_downloaded', 'Folder downloaded');
            }
            return meta.type === 'upload'
                ? t('remote.file_status_uploaded', 'Uploaded')
                : t('remote.file_status_downloaded', 'Downloaded');
        }
        var progress = '';
        if (meta.total > 0) {
            progress = (meta.percent || 0) + '% · ' + formatSize(meta.transferred) + ' / ' + formatSize(meta.total);
        } else {
            progress = t('remote.file_status_transferring', 'Transferring…');
        }
        if (meta.isFolder && meta.currentFile) {
            var cur = t('remote.file_status_current_file', 'Current: {name}').replace('{name}', meta.currentFile);
            return progress + ' · ' + cur;
        }
        return progress;
    };

    FileTransferModal.prototype._renderTransferRowHtml = function (meta) {
        var rowClass = ['ft-transfer-row'];
        if (meta.phase === 'done') rowClass.push('done');
        if (meta.error) rowClass.push('error');
        if (meta.phase === 'pending') rowClass.push('pending');
        if (meta.isFolder) rowClass.push('folder');

        var icon = meta.type === 'upload' ? 'upload' : 'download';
        if (meta.isFolder) icon = meta.type === 'upload' ? 'drive_folder_upload' : 'folder_zip';
        if (meta.phase === 'pending') icon = 'hourglass_empty';
        if (meta.error && meta.resumable) icon = 'replay';

        var indeterminate = meta.phase === 'pending' || (meta.isFolder && !meta.total && meta.phase !== 'done' && !meta.error);
        var fillWidth = meta.error ? 0 : Math.min(100, meta.percent || 0);
        var fillClass = 'ft-transfer-fill' + (indeterminate ? ' indeterminate' : '');
        var fillStyle = indeterminate ? '' : ' style="width:' + fillWidth + '%"';
        var canCancel = !meta.error && meta.phase !== 'done' && meta.phase !== 'saving';
        var canResume = meta.error && meta.resumable && !meta.isFolder;
        var titleName = meta.isFolder && meta.currentFile
            ? (meta.fileName + ' / ' + meta.currentFile)
            : meta.fileName;

        return '<div class="' + rowClass.join(' ') + '" data-id="' + meta.id + '">' +
            '<span class="material-icons ft-transfer-icon">' + icon + '</span>' +
            '<div class="ft-transfer-info">' +
            '<div class="ft-transfer-name" title="' + escapeHtml(titleName) + '">' + escapeHtml(meta.fileName) +
            (meta.isFolder ? ' <span class="ft-transfer-folder-tag">' + escapeHtml(t('remote.file_folder_tag', 'folder')) + '</span>' : '') +
            '</div>' +
            '<div class="ft-transfer-bar"><div class="' + fillClass + '"' + fillStyle + '></div></div>' +
            '<div class="ft-transfer-status">' + escapeHtml(this._transferStatusText(meta)) + '</div>' +
            '</div>' +
            (canResume ? '<button type="button" class="ft-transfer-resume" title="' + escapeHtml(t('remote.file_resume', 'Resume')) + '">' +
                '<span class="material-icons">replay</span></button>' : '') +
            (canCancel ? '<button type="button" class="ft-transfer-cancel" title="' + escapeHtml(t('common.cancel', 'Cancel')) + '">' +
                '<span class="material-icons">close</span></button>' : '') +
            '</div>';
    };

    FileTransferModal.prototype._scheduleTransferQueuePaint = function (immediate) {
        if (immediate) {
            if (this._queuePaintTimer) {
                clearTimeout(this._queuePaintTimer);
                this._queuePaintTimer = null;
            }
            this._queuePaintPending = false;
            this._paintTransferQueue();
            return;
        }
        if (this._queuePaintTimer) {
            this._queuePaintPending = true;
            return;
        }
        var self = this;
        this._queuePaintTimer = setTimeout(function () {
            self._queuePaintTimer = null;
            self._queuePaintPending = false;
            self._paintTransferQueue();
        }, 150);
    };

    FileTransferModal.prototype._paintTransferQueue = function () {
        if (!this._el) return;
        var list = this._el.querySelector('.ft-queue-list');
        var empty = this._el.querySelector('.ft-queue-empty');
        if (!list) return;
        var rows = Array.from(this._transferMeta.values());
        if (!rows.length) {
            list.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';
        var self = this;
        list.innerHTML = rows.map(function (m) { return self._renderTransferRowHtml(m); }).join('');
        list.querySelectorAll('.ft-transfer-cancel').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var row = btn.closest('.ft-transfer-row');
                var id = Number(row && row.dataset.id);
                var ft = self._session.client?.fileTransfer;
                if (id && ft) ft.cancelTransfer(id);
            });
        });
        list.querySelectorAll('.ft-transfer-resume').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var row = btn.closest('.ft-transfer-row');
                var id = Number(row && row.dataset.id);
                var ft = self._session.client?.fileTransfer;
                if (id && ft) {
                    var meta = self._transferMeta.get(id);
                    if (meta) {
                        meta.error = null;
                        meta.phase = 'pending';
                        meta.resumable = false;
                    }
                    ft.resumeTransfer(id);
                    self._scheduleTransferQueuePaint(true);
                }
            });
        });
    };

    FileTransferModal.prototype._addTransfer = function (data) {
        // Child transfers inside a folder job do not get their own queue row.
        if (data.folderJobId && !data.isFolder) return;
        var meta = this._ensureTransferMeta(data);
        meta.fileName = data.fileName || meta.fileName;
        meta.type = data.type || meta.type;
        meta.total = data.fileSize || meta.total;
        meta.phase = 'pending';
        meta.percent = 0;
        meta.error = null;
        meta.resumable = false;
        meta.isFolder = !!data.isFolder || meta.isFolder;
        meta.currentFile = data.currentFile || null;
        this._scheduleTransferQueuePaint(true);
    };

    FileTransferModal.prototype._updateTransfer = function (data) {
        if (data.folderJobId && !data.isFolder) return;
        var meta = this._ensureTransferMeta(data);
        if (data.phase === 'saving') {
            meta.phase = 'saving';
            meta.percent = 100;
            this._scheduleTransferQueuePaint(true);
            return;
        }
        meta.phase = 'transferring';
        meta.percent = data.percent || 0;
        meta.transferred = data.transferred || 0;
        meta.total = data.fileSize != null ? data.fileSize : meta.total;
        if (data.isFolder) meta.isFolder = true;
        if (data.currentFile != null) meta.currentFile = data.currentFile;
        // Progress fires many times per second — throttle full queue DOM rebuilds.
        this._scheduleTransferQueuePaint(false);
    };

    FileTransferModal.prototype._completeTransfer = function (data) {
        if (data.folderJobId && !data.isFolder) return;
        var meta = this._ensureTransferMeta(data);
        meta.phase = 'done';
        meta.percent = 100;
        meta.transferred = meta.total || meta.transferred;
        meta.error = null;
        meta.resumable = false;
        meta.currentFile = null;
        if (data.isFolder) meta.isFolder = true;
        this._scheduleTransferQueuePaint(true);
    };

    FileTransferModal.prototype._errorTransfer = function (data) {
        if (data.folderJobId && !data.isFolder) return;
        var meta = this._ensureTransferMeta(data);
        var errMsg = data.error || t('remote.file_error', 'Failed');
        if (errMsg === 'Remote did not start transfer') {
            errMsg = t('remote.file_transfer_stalled', 'Remote did not start transfer');
        }
        meta.error = errMsg;
        meta.phase = 'error';
        meta.resumable = !!data.resumable;
        if (data.isFolder) meta.isFolder = true;
        if (data.currentFile != null) meta.currentFile = data.currentFile;
        this._scheduleTransferQueuePaint(true);
    };

    FileTransferModal.prototype._removeTransfer = function (id) {
        this._transferMeta.delete(id);
        this._scheduleTransferQueuePaint(true);
    };

    window.FileTransferModal = FileTransferModal;
    try {
        window.__fileTransferModal = new FileTransferModal();
    } catch (err) {
        console.error('[FileModal] failed to initialize — clipboard/Cliprdr must still work:', err);
        window.__fileTransferModal = null;
    }

    // Keep modal/context menus inside the fullscreen element when FS toggles.
    document.addEventListener('fullscreenchange', function () {
        var modal = window.__fileTransferModal;
        if (modal && typeof modal._ensureMountedInHost === 'function') {
            modal._ensureMountedInHost();
        }
        if (modal && modal._contextMenu && modal._contextMenu.parentNode) {
            getOverlayHost().appendChild(modal._contextMenu);
        }
    });
})();
