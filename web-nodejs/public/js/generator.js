/* =========================================================================
   BetterDesk Support Generator
   Module install gate + simple custom.txt template bundles.
   ========================================================================= */

(function () {
    'use strict';

    const t = (k, def) => {
        const tr = window.t ? window.t(k) : k;
        return (tr && tr !== k) ? tr : (def != null ? def : k);
    };
    const errorMessage = (error, fallback) => {
        const data = error && error.data;
        if (data && data.error) return data.error;
        const raw = String((data && (data.code || data.error)) || (error && error.message) || '');
        const code = raw.split(':', 1)[0];
        const keys = {
            local_builder_no_supported_targets: 'no_supported_targets',
            local_builder_toolchain_missing: 'toolchain_missing',
            provider_host_only: 'platform_unavailable',
            template_missing: 'platform_unavailable',
        };
        const translationKey = keys[code] || code;
        return code
            ? t(`generator.errors.${translationKey}`, fallback || t('errors.bad_request', 'The request could not be completed.'))
            : (fallback || t('errors.server_error', 'The request could not be completed.'));
    };
    const notify = window.Notifications || { success: console.log, error: console.error, warning: console.warn, info: console.info };
    const csrf = () => (window.BetterDesk && window.BetterDesk.csrfToken) || '';

    async function api(method, url, body) {
        const headers = { Accept: 'application/json' };
        const writeMethods = method === 'POST' || method === 'PUT' || method === 'PATCH';
        if (writeMethods) headers['Content-Type'] = 'application/json';
        if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrf();
        const opts = { method, headers, credentials: 'same-origin' };
        if (body !== undefined) {
            opts.body = JSON.stringify(body);
        } else if (writeMethods) {
            opts.body = '{}';
        }
        const res = await fetch(url, opts);
        const ct = (res.headers.get('content-type') || '');
        const data = ct.includes('application/json') ? await res.json() : null;
        if (!res.ok || (data && data.success === false)) {
            const err = new Error((data && data.error) || `HTTP ${res.status}`);
            err.data = data;
            err.status = res.status;
            throw err;
        }
        return data;
    }

    async function uploadModuleArchive(file) {
        const form = new FormData();
        form.append('archive', file, file.name);
        const res = await fetch('/api/generator/module/install-local', {
            method: 'POST',
            headers: { Accept: 'application/json', 'X-CSRF-Token': csrf() },
            credentials: 'same-origin',
            body: form,
        });
        const data = (res.headers.get('content-type') || '').includes('application/json')
            ? await res.json()
            : null;
        if (!res.ok || (data && data.success === false)) {
            const err = new Error((data && data.error) || `HTTP ${res.status}`);
            err.data = data;
            throw err;
        }
        return data;
    }

    const state = {
        bundles: [],
        currentId: null,
        currentBundle: null,
        currentBuilds: [],
        platforms: [],
        selectedPlatforms: new Set(),
        dirty: false,
        slugManual: false,
        buildsPollTimer: null,
        moduleReady: false,
        buildReady: false,
        moduleStatus: null,
        platformCapabilities: null,
        productType: 'betterdesk-support',
    };

    const $ = (id) => document.getElementById(id);
    const els = {};
    let operationPollTimer = null;
    let operationErrorTimer = null;

    function stopOperationPoll() {
        if (operationPollTimer) {
            clearInterval(operationPollTimer);
            operationPollTimer = null;
        }
    }

    function hideOperationModal() {
        stopOperationPoll();
        if (operationErrorTimer) clearTimeout(operationErrorTimer);
        operationErrorTimer = null;
        if (els['gen-operation-modal']) {
            els['gen-operation-modal'].classList.add('hidden');
            els['gen-operation-modal'].setAttribute('aria-hidden', 'true');
        }
    }

    function showOperationModal(title, message, { poll = false } = {}) {
        if (!els['gen-operation-modal']) return;
        if (operationErrorTimer) clearTimeout(operationErrorTimer);
        operationErrorTimer = null;
        els['gen-operation-title'].textContent = title;
        els['gen-operation-message'].textContent = message;
        els['gen-operation-detail'].textContent = '';
        els['gen-operation-modal'].classList.remove('hidden');
        els['gen-operation-modal'].setAttribute('aria-hidden', 'false');
        if (poll) {
            stopOperationPoll();
            operationPollTimer = setInterval(async () => {
                try {
                    const data = await api('GET', '/api/generator/module/status');
                    const status = data.data || {};
                    const phase = status.phase || status.status || 'working';
                    const phaseText = {
                        syncing_source: 'Downloading BetterDesk-Client source…',
                        syncing_submodules: 'Downloading Client submodules…',
                        ready: 'Source synchronization complete.',
                        error: status.error || 'Builder reported an error.',
                    }[phase] || `Builder status: ${phase}`;
                    els['gen-operation-detail'].textContent = phaseText;
                } catch (err) {
                    els['gen-operation-detail'].textContent = `Status check failed: ${err.message}`;
                }
            }, 2000);
        }
    }

    function showOperationError(error) {
        stopOperationPoll();
        if (!els['gen-operation-modal']) return;
        els['gen-operation-title'].textContent = 'Builder operation failed';
        els['gen-operation-message'].textContent = errorMessage(error, 'The builder operation failed.');
        els['gen-operation-detail'].textContent = 'Check the console log and server builder status, then try again.';
        els['gen-operation-modal'].classList.remove('hidden');
        els['gen-operation-modal'].setAttribute('aria-hidden', 'false');
        operationErrorTimer = setTimeout(hideOperationModal, 7000);
    }

    function cacheEls() {
        [
            'gen-module-gate', 'gen-module-status', 'gen-accept-terms', 'gen-install-module',
            'gen-install-local-file',
            'gen-operation-modal', 'gen-operation-title', 'gen-operation-message', 'gen-operation-detail',
            'gen-finish-install', 'gen-main',
            'gen-sync-generic-release', 'gen-generic-release-list', 'gen-generic-release-status',
            'gen-legacy-leftovers', 'gen-legacy-leftovers-list', 'gen-legacy-hint',
            'gen-new-support', 'gen-bundle-list', 'gen-editor-title', 'gen-revoke-btn', 'gen-delete-btn',
            'gen-save-btn', 'gen-rebuild-btn', 'gen-builds-list', 'gen-builds-summary', 'gen-platforms',
            'gen-empty-state', 'gen-editor-form',
            'gen-name', 'gen-slug', 'gen-app-name',
            'gen-server-host', 'gen-relay-host', 'gen-use-https', 'gen-api-port', 'gen-public-key',
            'gen-install-service', 'gen-autostart',
            'gen-build-capability-status',
            'gen-download-info', 'gen-download-url', 'gen-copy-link', 'gen-open-link',
            'gen-validation-errors',
        ].forEach((id) => { els[id] = $(id); });
    }

    let connectionDefaults = {
        server_host: '',
        relay_host: '',
        use_https: true,
        api_port: '21114',
        public_key: '',
        app_name: 'BetterDesk Support Agent',
    };

    const SLUG_TRANSLIT = {
        ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
        ä: 'a', ö: 'o', ü: 'u', ß: 'ss', æ: 'ae', ø: 'o', å: 'a',
        č: 'c', ď: 'd', ě: 'e', ň: 'n', ř: 'r', š: 's', ť: 't', ů: 'u', ý: 'y', ž: 'z',
    };

    function slugifyName(name) {
        let slug = String(name || '').trim().toLowerCase().split('').map((ch) => SLUG_TRANSLIT[ch] ?? ch).join('');
        slug = slug.replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (slug.length > 32) slug = slug.slice(0, 32).replace(/-$/, '');
        return slug;
    }

    function readSlugInput() {
        return (els['gen-slug'] && els['gen-slug'].value || '').trim().toLowerCase();
    }

    function updateDownloadLinkPreview() {
        const slug = readSlugInput();
        if (!els['gen-download-url']) return;
        if (state.currentId === 'new') {
            const url = slug ? `${window.location.origin}/d/${slug}` : '';
            els['gen-download-url'].value = url;
            if (els['gen-open-link']) {
                els['gen-open-link'].href = url || '#';
                els['gen-open-link'].classList.toggle('disabled', !url);
            }
            return;
        }
        if (state.currentBundle) {
            const publicId = slug || state.currentBundle.public_id || state.currentBundle.slug || state.currentBundle.bundle_id;
            const url = `${window.location.origin}/d/${publicId}`;
            els['gen-download-url'].value = url;
            if (els['gen-open-link']) {
                els['gen-open-link'].href = url;
                els['gen-open-link'].classList.remove('disabled');
            }
        }
    }

    function syncSlugFromName() {
        if (state.slugManual || !els['gen-slug']) return;
        els['gen-slug'].value = slugifyName(els['gen-name'].value);
        updateDownloadLinkPreview();
    }

    function readBranding() {
        return {
            app_name: els['gen-app-name'].value.trim(),
            company_name: els['gen-app-name'].value.trim(),
            server_host: els['gen-server-host'].value.trim(),
            relay_host: els['gen-relay-host'].value.trim(),
            use_https: !!(els['gen-use-https'] && els['gen-use-https'].checked),
            api_port: els['gen-api-port'].value.trim(),
            public_key: els['gen-public-key'].value.trim(),
            disable_settings: true,
            install_service: !!(els['gen-install-service'] && els['gen-install-service'].checked),
            autostart: !!(els['gen-autostart'] && els['gen-autostart'].checked),
        };
    }

    function writeBranding(b) {
        b = Object.assign({}, connectionDefaults, b || {});
        els['gen-app-name'].value = b.app_name || b.company_name || connectionDefaults.app_name || '';
        els['gen-server-host'].value = b.server_host
            || (b.server?.address ? String(b.server.address).replace(/^https?:\/\//, '').split(':')[0] : '')
            || '';
        els['gen-relay-host'].value = b.relay_host || '';
        els['gen-use-https'].checked = b.use_https ?? connectionDefaults.use_https ?? true;
        els['gen-api-port'].value = b.api_port || connectionDefaults.api_port || '';
        els['gen-public-key'].value = b.public_key || b.server_key || b.server?.public_key || connectionDefaults.public_key || '';
        if (els['gen-install-service']) els['gen-install-service'].checked = !!b.install_service;
        if (els['gen-autostart']) els['gen-autostart'].checked = !!b.autostart;
    }

    function platformKey(p) {
        return `${p.platform}/${p.arch}/${p.format}`;
    }

    function renderPlatforms() {
        if (!els['gen-platforms']) return;
        els['gen-platforms'].innerHTML = state.platforms.map((p) => {
            const key = platformKey(p);
            const available = p.available !== false;
            const checked = available && state.selectedPlatforms.has(key) ? 'checked' : '';
            const disabled = available ? '' : 'disabled';
            const reason = available
                ? ''
                : `<small class="platform-unavailable">${escapeText(platformReason(p))}</small>`;
            return `<label class="platform-check${available ? '' : ' is-unavailable'}">
                <input type="checkbox" data-platform="${escapeText(p.platform)}" data-arch="${escapeText(p.arch)}" data-format="${escapeText(p.format)}" data-available="${available}" ${checked} ${disabled}>
                <span>${escapeText(p.label || key)}</span>
                ${reason}
            </label>`;
        }).join('');
        els['gen-platforms'].querySelectorAll('input[type=checkbox]').forEach((input) => {
            input.addEventListener('change', () => {
                const key = `${input.dataset.platform}/${input.dataset.arch}/${input.dataset.format}`;
                if (input.checked) state.selectedPlatforms.add(key);
                else state.selectedPlatforms.delete(key);
                markDirty();
            });
        });
    }

    function selectedPlatformPayload() {
        return state.platforms.filter((p) => (
            p.available !== false && state.selectedPlatforms.has(platformKey(p))
        ));
    }

    function selectAllPlatforms() {
        state.selectedPlatforms = new Set(
            state.platforms.filter((p) => p.available !== false).map(platformKey)
        );
        renderPlatforms();
    }

    function platformReason(platform) {
        const reason = String(platform && platform.reason || '');
        if (reason.startsWith('local_builder_toolchain_missing:')) {
            const tools = reason.split(':', 2)[1].replace(/,/g, ', ');
            return t('generator.errors.toolchain_missing', 'Required build tools are missing: {{tools}}')
                .replace('{{tools}}', tools);
        }
        if (reason === 'local_builder_toolchain_missing') {
            return t('generator.errors.no_supported_targets', 'The local build toolchain is not ready.');
        }
        if (reason === 'provider_host_only') {
            return t('generator.errors.platform_unavailable', 'This target requires a cross-platform build provider.');
        }
        if (reason === 'template_missing') {
            return t('generator.errors.platform_unavailable', 'A verified client template is not installed.');
        }
        if (reason === 'provider_targets_missing') {
            return t('generator.errors.no_supported_targets', 'No build targets are currently available. Check the builder configuration.');
        }
        if (reason === 'provider_target_unavailable') {
            return t('generator.errors.platform_unavailable', 'This target is not available from the configured builder.');
        }
        return t('generator.errors.platform_unavailable', 'This target is not available from the configured builder.');
    }

    function renderBuildCapabilityStatus() {
        const el = els['gen-build-capability-status'];
        if (!el) return;
        const available = state.platforms.filter((p) => p.available !== false);
        const shouldShow = state.moduleReady && (!state.buildReady || available.length === 0);
        if (!shouldShow) {
            el.classList.add('hidden');
            el.textContent = '';
            return;
        }
        const missing = state.platformCapabilities
            && state.platformCapabilities.toolchain
            && state.platformCapabilities.toolchain.missing;
        const remoteTargetsMissing = state.platformCapabilities
            && state.platformCapabilities.mode === 'remote'
            && (!Array.isArray(state.platformCapabilities.targets)
                || state.platformCapabilities.targets.length === 0);
        const detail = remoteTargetsMissing
            ? t('generator.errors.no_supported_targets', 'No build targets are currently available. Check the builder configuration.')
            : Array.isArray(missing) && missing.length
            ? t('generator.errors.toolchain_missing', 'Required build tools are missing: {{tools}}')
                .replace('{{tools}}', missing.join(', '))
            : t('generator.errors.no_supported_targets', 'No build targets are currently available. Check the builder configuration.');
        el.classList.remove('hidden');
        el.classList.add('is-error');
        el.textContent = detail;
    }

    function isLegacyBundle(bundle) {
        return !!(bundle && bundle.legacy);
    }

    function leftoverBundles() {
        return (state.bundles || []).filter(isLegacyBundle);
    }

    function isCurrentLegacy() {
        return isLegacyBundle(state.currentBundle);
    }

    function setFormLocked(locked) {
        ['gen-name', 'gen-slug', 'gen-app-name', 'gen-server-host', 'gen-relay-host', 'gen-api-port',
            'gen-use-https', 'gen-install-service', 'gen-autostart']
            .forEach((id) => {
                if (els[id]) els[id].disabled = !!locked;
            });
        if (els['gen-platforms']) {
            els['gen-platforms'].querySelectorAll('input').forEach((input) => {
                input.disabled = !!locked || input.dataset.available === 'false';
            });
        }
    }

    function applyLegacyEditorMode(isLegacy) {
        if (els['gen-legacy-hint']) els['gen-legacy-hint'].classList.toggle('hidden', !isLegacy);
        setFormLocked(isLegacy);
        if (els['gen-save-btn']) {
            els['gen-save-btn'].classList.toggle('hidden', !!isLegacy);
            if (isLegacy) els['gen-save-btn'].disabled = true;
        }
        if (els['gen-rebuild-btn']) els['gen-rebuild-btn'].classList.toggle('hidden', !!isLegacy);
    }

    function markDirty() {
        if (isCurrentLegacy() || !state.moduleReady || !state.buildReady) return;
        state.dirty = true;
        if (els['gen-save-btn']) els['gen-save-btn'].disabled = false;
    }

    function clearDirty() {
        state.dirty = false;
        if (els['gen-save-btn']) els['gen-save-btn'].disabled = !state.buildReady;
    }

    function showValidation(errors) {
        if (!els['gen-validation-errors']) return;
        if (!errors || !errors.length) {
            els['gen-validation-errors'].classList.add('hidden');
            els['gen-validation-errors'].innerHTML = '';
            return;
        }
        els['gen-validation-errors'].classList.remove('hidden');
        els['gen-validation-errors'].innerHTML = `<ul>${errors.map((e) => {
            const value = String(e);
            const code = value.split(':', 1)[0];
            const message = value.includes('/')
                ? `${t('generator.errors.platform_unavailable', 'This target is not available from the configured builder.')} (${value})`
                : t(`generator.errors.${code}`, value);
            return `<li>${escapeText(message)}</li>`;
        }).join('')}</ul>`;
    }

    function escapeText(s) {
        const d = document.createElement('div');
        d.textContent = String(s == null ? '' : s);
        return d.innerHTML;
    }

    function renderBundleList() {
        if (!els['gen-bundle-list']) return;
        if (!state.bundles.length) {
            els['gen-bundle-list'].innerHTML = `<p class="text-muted">${t('generator.no_bundles', 'No bundles yet')}</p>`;
            return;
        }
        els['gen-bundle-list'].innerHTML = state.bundles.map((b) => {
            const active = state.currentId === b.bundle_id ? 'active' : '';
            const revoked = b.revoked ? 'revoked' : '';
            const badge = isLegacyBundle(b)
                ? `<span class="badge-product--legacy">${escapeText(t('generator.legacy_badge', 'Legacy'))}</span>`
                : '';
            return `<button type="button" class="bundle-item ${active} ${revoked}" data-id="${escapeText(b.bundle_id)}">
                <span class="bundle-item-title">
                    <span class="bundle-item-name">${escapeText(b.name)}</span>
                    ${badge}
                </span>
                <span class="bundle-item-meta">${escapeText(b.slug || b.public_id || '')}</span>
            </button>`;
        }).join('');
        els['gen-bundle-list'].querySelectorAll('.bundle-item').forEach((btn) => {
            btn.addEventListener('click', () => openBundle(btn.dataset.id));
        });
    }

    function buildStatusLabel(status) {
        const s = String(status || 'pending').toLowerCase();
        if (s === 'ready') return t('generator.build_ready', 'Ready');
        if (s === 'building') return t('generator.build_building', 'Building');
        if (s === 'queued' || s === 'pending') return t('generator.build_queued', 'Queued');
        if (s === 'failed') return t('generator.build_failed', 'Failed');
        return s;
    }

    function renderBuilds() {
        if (!els['gen-builds-list']) return;
        const builds = state.currentBuilds || [];
        if (!builds.length) {
            els['gen-builds-list'].innerHTML = `<p class="text-muted">${t('generator.builds_empty', 'No builds yet — save to queue platforms.')}</p>`;
            if (els['gen-builds-summary']) els['gen-builds-summary'].textContent = '';
            return;
        }
        const ready = builds.filter((b) => b.status === 'ready').length;
        if (els['gen-builds-summary']) {
            els['gen-builds-summary'].textContent = `${ready}/${builds.length} ready`;
        }
        els['gen-builds-list'].innerHTML = builds.map((b) => {
            const key = `${b.platform}/${b.arch}/${b.format}`;
            const label = (state.platforms.find((p) => platformKey(p) === key) || {}).label || key;
            const err = b.error_message ? `<div class="build-error">${escapeText(b.error_message)}</div>` : '';
            const percent = Math.max(0, Math.min(100, Number(b.progress_percent || 0)));
            const progress = b.status === 'building'
                ? `<div class="build-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
                    <span style="width:${percent}%"></span>
                </div>
                <div class="build-progress-meta">${percent}% · ${escapeText(b.progress_phase || 'building')}</div>`
                : '';
            const retry = !isCurrentLegacy() && b.status === 'failed'
                ? `<button type="button" class="btn btn-sm btn-secondary gen-retry-build"
                    data-platform="${escapeText(b.platform)}" data-arch="${escapeText(b.arch)}" data-format="${escapeText(b.format)}">Retry</button>`
                : '';
            return `<div class="build-row status-${escapeText(b.status)}">
                <div class="build-row-main">
                    <span class="build-label">${escapeText(label)}</span>
                    <span class="build-status badge">${escapeText(buildStatusLabel(b.status))}</span>
                    ${retry}
                </div>
                ${progress}
                ${err}
            </div>`;
        }).join('');
        els['gen-builds-list'].querySelectorAll('.gen-retry-build').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!state.currentId || state.currentId === 'new') return;
                try {
                    const { platform, arch, format } = btn.dataset;
                    await api('POST', `/api/generator/bundles/${state.currentId}/rebuild/${platform}/${arch}/${format}`);
                    notify.success(t('generator.rebuild_queued', 'Rebuild queued'));
                    await refreshBuilds();
                } catch (err) {
                    notify.error(errorMessage(err));
                }
            });
        });
    }

    function setEditorVisible(show) {
        els['gen-empty-state'].classList.toggle('hidden', show);
        els['gen-editor-form'].classList.toggle('hidden', !show);
    }

    function setEditorForNew() {
        if (!state.moduleReady || !state.buildReady) {
            notify.error(t('generator.errors.no_supported_targets', 'No build targets are currently available.'));
            return;
        }
        stopBuildsPoll();
        state.currentId = 'new';
        state.currentBundle = null;
        state.currentBuilds = [];
        state.slugManual = false;
        state.productType = 'betterdesk-support';
        setEditorVisible(true);
        applyLegacyEditorMode(false);
        els['gen-editor-title'].textContent = t('generator.new_bundle', 'New BetterDesk Support');
        els['gen-name'].value = '';
        els['gen-slug'].value = '';
        writeBranding(connectionDefaults);
        selectAllPlatforms();
        els['gen-download-info'].classList.add('hidden');
        els['gen-revoke-btn'].classList.add('hidden');
        els['gen-delete-btn'].classList.add('hidden');
        els['gen-rebuild-btn'].classList.add('hidden');
        showValidation([]);
        renderBuilds();
        markDirty();
        renderBundleList();
        updateDownloadLinkPreview();
    }

    async function openBundle(id) {
        try {
            const data = await api('GET', `/api/generator/bundles/${id}`);
            const bundle = data.data.bundle;
            state.currentId = bundle.bundle_id;
            state.currentBundle = bundle;
            state.currentBuilds = bundle.builds || [];
            state.slugManual = true;
            state.productType = 'betterdesk-support';
            setEditorVisible(true);
            applyLegacyEditorMode(isLegacyBundle(bundle));
            els['gen-editor-title'].textContent = bundle.name;
            els['gen-name'].value = bundle.name || '';
            els['gen-slug'].value = bundle.slug || '';
            writeBranding(bundle.branding || {});
            selectAllPlatforms();
            setFormLocked(isLegacyBundle(bundle));
            els['gen-download-info'].classList.remove('hidden');
            els['gen-revoke-btn'].classList.remove('hidden');
            els['gen-delete-btn'].classList.remove('hidden');
            els['gen-rebuild-btn'].classList.toggle('hidden', isLegacyBundle(bundle));
            els['gen-revoke-btn'].textContent = bundle.revoked
                ? t('generator.unrevoke', 'Restore')
                : t('generator.revoke', 'Revoke');
            showValidation([]);
            clearDirty();
            renderBuilds();
            renderBundleList();
            updateDownloadLinkPreview();
            if (isLegacyBundle(bundle)) stopBuildsPoll();
            else startBuildsPoll();
        } catch (err) {
            notify.error(errorMessage(err));
        }
    }

    async function saveBundle() {
        if (isCurrentLegacy() || !state.moduleReady || !state.buildReady) {
            notify.error(t('generator.errors.no_supported_targets', 'No build targets are currently available.'));
            return;
        }
        if (!selectedPlatformPayload().length) {
            notify.error(t('generator.errors.platforms_required', 'Select at least one platform to build'));
            return;
        }
        const name = els['gen-name'].value.trim();
        if (!name) {
            notify.error(t('generator.errors.name_required', 'Name is required'));
            return;
        }
        const payload = {
            name,
            slug: readSlugInput(),
            product_type: 'betterdesk-support',
            branding: readBranding(),
            platforms: selectedPlatformPayload(),
        };
        try {
            let data;
            if (state.currentId === 'new') {
                data = await api('POST', '/api/generator/bundles', payload);
            } else {
                data = await api('PUT', `/api/generator/bundles/${state.currentId}`, payload);
            }
            if (data && data.warning) {
                notify.warning(errorMessage({ data: { error: data.warning } }));
            } else {
                notify.success(t('generator.saved', 'Saved'));
            }
            showValidation([]);
            await loadBundles();
            await openBundle(data.data.bundle.bundle_id);
        } catch (err) {
            const details = err.data && (err.data.details || err.data.errors);
            if (details) showValidation(details);
            notify.error(errorMessage(err));
        }
    }

    async function loadBundles() {
        const data = await api('GET', '/api/generator/bundles?includeRevoked=1&includeLegacy=1');
        state.bundles = (data.data && data.data.bundles) || [];
        renderBundleList();
        applyGeneratorLayout();
    }

    async function loadPlatforms() {
        const data = await api('GET', '/api/generator/platforms');
        state.platforms = (data.data && data.data.platforms) || [];
        state.platformCapabilities = (data.data && data.data.capabilities) || null;
        selectAllPlatforms();
        renderBuildCapabilityStatus();
    }

    async function loadDefaults() {
        const data = await api('GET', '/api/generator/defaults');
        connectionDefaults = Object.assign(connectionDefaults, data.data || {});
    }

    async function refreshBuilds() {
        if (!state.currentId || state.currentId === 'new') return;
        try {
            const data = await api('GET', `/api/generator/bundles/${state.currentId}`);
            state.currentBuilds = (data.data.bundle && data.data.bundle.builds) || [];
            renderBuilds();
        } catch (_) { /* ignore poll errors */ }
    }

    function startBuildsPoll() {
        stopBuildsPoll();
        state.buildsPollTimer = setInterval(refreshBuilds, 4000);
    }

    function stopBuildsPoll() {
        if (state.buildsPollTimer) {
            clearInterval(state.buildsPollTimer);
            state.buildsPollTimer = null;
        }
    }

    function renderModuleStatus(status) {
        state.moduleStatus = status;
        state.moduleReady = !!(status && status.ready);
        state.buildReady = status && status.buildReady !== undefined
            ? !!status.buildReady
            : state.moduleReady;
        state.platformCapabilities = status && status.buildCapabilities || null;
        const embedded = status && status.mode === 'embedded';
        const el = els['gen-module-status'];
        if (!el) return;
        const parts = [
            t('generator.module_status_label', 'Status') + ': ' + (status.status || 'unknown'),
            status.termsAccepted
                ? t('generator.module_terms_ok', 'Terms accepted')
                : t('generator.module_terms_pending', 'Terms not accepted'),
            status.templatesPresent
                ? (embedded
                    ? 'BetterDesk-Client source present'
                    : t('generator.module_templates_ok', 'Templates present'))
                : (embedded
                    ? 'BetterDesk-Client source missing'
                    : t('generator.module_templates_missing', 'Templates missing')),
            status.installedVersion
                ? t('generator.module_version', 'Version {{v}}').replace('{{v}}', status.installedVersion)
                : null,
            status.signingSeedPresent
                ? t('generator.module_seed_ok', 'Signing seed present')
                : (t('generator.module_seed_missing', 'Signing seed missing — Support builds disabled')
                    + (status.signingSeedPath ? ` (${status.signingSeedPath})` : '')),
            status.mode === 'embedded'
                ? (status.providerConfigured
                    ? 'Embedded build provider configured'
                    : 'Configure GitHub Actions token or a trusted local provider')
                : null,
            status.mode === 'embedded' && status.buildCapabilities?.mode === 'local'
                ? `Local targets: ${(status.buildCapabilities.targets || [])
                    .map((p) => `${p.platform}/${p.arch}`)
                    .join(', ') || 'none — check Cargo, Flutter and vcpkg'}`
                : null,
            status.mode === 'embedded' && status.buildReady === false
                ? t('generator.errors.no_supported_targets', 'No build targets are currently available. Check the builder configuration.')
                : null,
            status.error
                ? t('generator.module_error_prefix', 'Error') + ': ' + status.error
                : null,
            status.warning && !status.binariesPresent
                ? t('generator.module_stub_warning', 'Stub templates (no desktop binaries) — rebuilds will fail until a full Client release is installed')
                : null,
        ].filter(Boolean);
        el.textContent = parts.join(' · ');
        el.classList.toggle('is-error', status.status === 'error');

        if (els['gen-accept-terms']) {
            els['gen-accept-terms'].disabled = !!status.termsAccepted;
        }
        const installLabel = els['gen-install-module']
            && els['gen-install-module'].querySelector('.gen-install-label');
        if (els['gen-install-module']) {
            const seedMissing = embedded && !status.signingSeedPresent;
            els['gen-install-module'].disabled = !status.termsAccepted
                || status.status === 'downloading'
                || seedMissing;
            const label = status.status === 'downloading'
                ? t('generator.module_downloading', 'Downloading…')
                : seedMissing
                    ? 'Configure signing seed first'
                : (embedded
                    ? 'Sync BetterDesk-Client source'
                    : t('generator.module_install', 'Install from GitHub'));
            if (installLabel) installLabel.textContent = label;
            else {
                // Keep icon; replace trailing text nodes if label span missing
                const icon = els['gen-install-module'].querySelector('.material-icons');
                els['gen-install-module'].textContent = '';
                if (icon) els['gen-install-module'].appendChild(icon);
                els['gen-install-module'].appendChild(document.createTextNode(' ' + label));
            }
        }
        if (els['gen-install-local-file']) {
            els['gen-install-local-file'].disabled = !status.termsAccepted || status.status === 'downloading';
            const localLabel = els['gen-install-local-file'].closest('label');
            if (localLabel) localLabel.classList.toggle('hidden', !!embedded);
        }
        if (els['gen-finish-install']) {
            els['gen-finish-install'].classList.toggle('hidden', !status.ready);
        }
        renderBuildCapabilityStatus();
    }

    function leftoverPublicId(bundle) {
        return bundle.slug || bundle.public_id || bundle.bundle_id || '';
    }

    function renderLeftoverGateList() {
        const wrap = els['gen-legacy-leftovers'];
        const list = els['gen-legacy-leftovers-list'];
        if (!wrap || !list) return;
        const leftovers = leftoverBundles();
        const show = leftovers.length > 0 && !state.moduleReady;
        wrap.classList.toggle('hidden', !show);
        if (!show) {
            list.innerHTML = '';
            return;
        }
        list.innerHTML = leftovers.map((b) => {
            const publicId = leftoverPublicId(b);
            const revokeLabel = b.revoked
                ? t('generator.unrevoke', 'Restore')
                : t('generator.revoke', 'Revoke');
            return `<div class="gen-legacy-row" data-id="${escapeText(b.bundle_id)}">
                <div>
                    <div class="bundle-item-title">
                        <span class="bundle-item-name">${escapeText(b.name)}</span>
                        <span class="badge-product--legacy">${escapeText(t('generator.legacy_badge', 'Legacy'))}</span>
                    </div>
                    <div class="bundle-item-meta">${escapeText(publicId ? `/d/${publicId}` : '')}</div>
                </div>
                <div class="gen-legacy-row-actions">
                    <a class="btn btn-secondary btn-sm" href="${escapeText(publicId ? `/d/${publicId}` : '#')}" target="_blank" rel="noopener">${escapeText(t('generator.open_portal', 'Open'))}</a>
                    <button type="button" class="btn btn-warning btn-sm" data-action="revoke">${escapeText(revokeLabel)}</button>
                    <button type="button" class="btn btn-danger btn-sm" data-action="delete">${escapeText(t('common.delete', 'Delete'))}</button>
                </div>
            </div>`;
        }).join('');
        list.querySelectorAll('.gen-legacy-row').forEach((row) => {
            const id = row.dataset.id;
            const bundle = leftovers.find((b) => b.bundle_id === id);
            const revokeBtn = row.querySelector('[data-action="revoke"]');
            const deleteBtn = row.querySelector('[data-action="delete"]');
            if (revokeBtn) {
                revokeBtn.addEventListener('click', () => revokeBundle(id, !(bundle && bundle.revoked)));
            }
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => deleteBundle(id));
            }
        });
    }

    function applyGeneratorLayout() {
        const ready = !!state.moduleReady;
        if (els['gen-module-gate']) els['gen-module-gate'].classList.toggle('hidden', ready);
        if (els['gen-main']) els['gen-main'].classList.toggle('hidden', !ready);
        if (els['gen-new-support']) {
            els['gen-new-support'].classList.toggle('hidden', !ready);
            els['gen-new-support'].disabled = !state.buildReady;
            els['gen-new-support'].title = state.buildReady
                ? t('generator.new_bundle', 'New Support')
                : t('generator.errors.no_supported_targets', 'No build targets are currently available.');
        }
        renderBuildCapabilityStatus();
        renderLeftoverGateList();
    }

    async function refreshModuleStatus() {
        const data = await api('GET', '/api/generator/module/status');
        const status = data.data || {};
        renderModuleStatus(status);
        applyGeneratorLayout();
        return status;
    }

    async function revokeBundle(id, revoked) {
        if (!id) return;
        const confirmKey = revoked ? 'generator.confirm_revoke' : 'generator.confirm_unrevoke';
        const confirmDef = revoked
            ? 'Revoke this bundle? The download link will stop working.'
            : 'Re-enable this bundle?';
        if (!window.confirm(t(confirmKey, confirmDef))) return;
        try {
            await api('POST', `/api/generator/bundles/${id}/revoke`, { revoked });
            notify.success(revoked
                ? t('generator.revoked_ok', 'Bundle revoked')
                : t('generator.unrevoked_ok', 'Bundle re-enabled'));
            await loadBundles();
            if (state.currentId === id) await openBundle(id);
        } catch (err) {
            notify.error(errorMessage(err));
        }
    }

    async function deleteBundle(id) {
        if (!id) return;
        if (!window.confirm(t('generator.confirm_delete', 'Delete this bundle permanently? This cannot be undone.'))) return;
        try {
            await api('DELETE', `/api/generator/bundles/${id}`);
            notify.success(t('generator.deleted', 'Bundle deleted'));
            if (state.currentId === id) {
                state.currentId = null;
                state.currentBundle = null;
                if (els['gen-empty-state']) setEditorVisible(false);
                stopBuildsPoll();
            }
            await loadBundles();
        } catch (err) {
            notify.error(errorMessage(err));
        }
    }

    function bindEvents() {
        if (els['gen-sync-generic-release']) {
            els['gen-sync-generic-release'].addEventListener('click', syncGenericRelease);
        }
        if (els['gen-new-support']) {
            els['gen-new-support'].addEventListener('click', () => setEditorForNew());
        }
        if (els['gen-save-btn']) {
            els['gen-save-btn'].addEventListener('click', () => saveBundle());
        }
        if (els['gen-name']) {
            els['gen-name'].addEventListener('input', () => { syncSlugFromName(); markDirty(); });
        }
        if (els['gen-slug']) {
            els['gen-slug'].addEventListener('input', () => {
                state.slugManual = true;
                updateDownloadLinkPreview();
                markDirty();
            });
        }
        ['gen-app-name', 'gen-server-host', 'gen-relay-host', 'gen-api-port'].forEach((id) => {
            if (els[id]) els[id].addEventListener('input', markDirty);
        });
        if (els['gen-use-https']) els['gen-use-https'].addEventListener('change', markDirty);

        if (els['gen-copy-link']) {
            els['gen-copy-link'].addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(els['gen-download-url'].value);
                    notify.success(t('common.copied', 'Copied'));
                } catch (_) {
                    notify.error(t('common.copy_failed', 'Copy failed'));
                }
            });
        }

        if (els['gen-revoke-btn']) {
            els['gen-revoke-btn'].addEventListener('click', () => {
                if (!state.currentId || state.currentId === 'new') return;
                revokeBundle(state.currentId, !(state.currentBundle && state.currentBundle.revoked));
            });
        }

        if (els['gen-delete-btn']) {
            els['gen-delete-btn'].addEventListener('click', () => {
                if (!state.currentId || state.currentId === 'new') return;
                deleteBundle(state.currentId);
            });
        }

        if (els['gen-rebuild-btn']) {
            els['gen-rebuild-btn'].addEventListener('click', async () => {
                if (!state.currentId || state.currentId === 'new' || isCurrentLegacy()
                    || !state.moduleReady || !state.buildReady) return;
                try {
                    await api('POST', `/api/generator/bundles/${state.currentId}/rebuild`, {
                        platforms: selectedPlatformPayload(),
                    });
                    notify.success(t('generator.rebuild_queued', 'Rebuild queued'));
                    await refreshBuilds();
                    startBuildsPoll();
                } catch (err) {
                    notify.error(errorMessage(err));
                }
            });
        }

        if (els['gen-accept-terms']) {
            els['gen-accept-terms'].addEventListener('click', async () => {
                showOperationModal('Accepting terms', 'Saving AGPL acceptance…');
                try {
                    await api('POST', '/api/generator/module/accept-terms');
                    notify.success(t('generator.module_terms_ok', 'Terms accepted'));
                    await refreshModuleStatus();
                    hideOperationModal();
                } catch (err) {
                    notify.error(errorMessage(err));
                    showOperationError(err);
                }
            });
        }

        if (els['gen-install-module']) {
            els['gen-install-module'].addEventListener('click', async () => {
                try {
                    els['gen-install-module'].disabled = true;
                    showOperationModal(
                        'Synchronizing BetterDesk-Client',
                        'The server is downloading the pinned Client source and submodules. This can take several minutes.',
                        { poll: true }
                    );
                    notify.info('Synchronizing BetterDesk-Client source…');
                    await api('POST', '/api/generator/module/install', {});
                    notify.success(t('generator.module_installed', 'Module installed'));
                    await refreshModuleStatus();
                    hideOperationModal();
                } catch (err) {
                    notify.error(errorMessage(err));
                    showOperationError(err);
                    await refreshModuleStatus();
                }
            });
        }

        if (els['gen-install-local-file']) {
            els['gen-install-local-file'].addEventListener('change', async () => {
                const input = els['gen-install-local-file'];
                const file = input.files && input.files[0];
                if (!file) return;
                try {
                    input.disabled = true;
                    notify.info('Installing local generator package…');
                    await uploadModuleArchive(file);
                    notify.success(t('generator.module_installed', 'Module installed'));
                    await refreshModuleStatus();
                } catch (err) {
                    notify.error(errorMessage(err));
                    await refreshModuleStatus();
                } finally {
                    input.value = '';
                }
            });
        }

        if (els['gen-finish-install']) {
            els['gen-finish-install'].addEventListener('click', async () => {
                const status = await refreshModuleStatus();
                if (status.ready) {
                    await initGeneratorMain();
                }
            });
        }
    }

    async function initGeneratorMain() {
        await loadDefaults();
        await loadPlatforms();
        await loadBundles();
    }

    async function loadGenericReleases() {
        if (!els['gen-generic-release-list']) return;
        try {
            const data = await api('GET', '/api/agent-releases');
            const releases = data.releases || [];
            els['gen-generic-release-list'].innerHTML = releases.length
                ? releases.map((release) => `
                    <div class="generic-agent-release-item">
                        <div><strong>${escapeText(release.tag)}</strong>
                            <div class="text-muted">${(release.manifest.assets || []).length} platform artifacts</div>
                        </div>
                        <span class="status-badge ready">verified</span>
                    </div>
                `).join('')
                : '<span class="text-muted">No release imported yet.</span>';
        } catch (error) {
            els['gen-generic-release-status'].textContent = errorMessage(error);
        }
    }

    async function syncGenericRelease() {
        const button = els['gen-sync-generic-release'];
        if (button) button.disabled = true;
        if (els['gen-generic-release-status']) {
            els['gen-generic-release-status'].textContent = 'Importing and verifying the latest signed release…';
        }
        try {
            const result = await api('POST', '/api/agent-releases/sync', {});
            if (els['gen-generic-release-status']) {
                els['gen-generic-release-status'].textContent = `Imported ${result.tag}.`;
            }
            await loadGenericReleases();
        } catch (error) {
            if (els['gen-generic-release-status']) {
                els['gen-generic-release-status'].textContent = errorMessage(error);
            }
            notify.error(errorMessage(error));
        } finally {
            if (button) button.disabled = false;
        }
    }

    async function init() {
        cacheEls();
        bindEvents();
        loadGenericReleases();
        try {
            const status = await refreshModuleStatus();
            await loadBundles();
            if (status.ready) {
                await initGeneratorMain();
            }
        } catch (err) {
            notify.error(errorMessage(err));
            applyGeneratorLayout();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
