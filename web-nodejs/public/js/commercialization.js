'use strict';

/**
 * Billing packages (?tab=packages) and billable sessions (?tab=sessions).
 * Dialogs are built from the <template> blocks in commercialization.ejs and
 * opened with Modal.show, so Escape and focus return come from modal.js.
 */
(function () {
    const page = document.querySelector('.commercialization-page');
    if (!page) return;

    function t(key, fallback, params) {
        if (typeof window._ === 'function') {
            const val = window._(key, params || {});
            if (val && val !== key) return val;
        }
        let text = fallback !== undefined ? fallback : key;
        if (params) text = text.replace(/\{(\w+)\}/g, (m, p) => (params[p] !== undefined ? params[p] : m));
        return text;
    }

    const perms = (window.BetterDesk && window.BetterDesk.permissions) || [];
    const can = (p) => perms.includes(p);
    const canManage = can('billing.manage');
    const canWriteReport = can('billing.reports');

    function api(path, opts = {}) {
        return Utils.api(path, opts);
    }

    function notifySuccess(msg) {
        if (typeof Notifications !== 'undefined' && Notifications.success) Notifications.success(msg);
    }

    function notifyError(msg) {
        if (typeof Notifications !== 'undefined' && Notifications.error) Notifications.error(msg);
    }

    function formatMinutes(m) {
        const n = Math.max(0, Math.round(Number(m) || 0));
        if (!n) return t('commercialization.ui.minutes_short', '{n} min', { n: 0 });
        const h = Math.floor(n / 60);
        const min = n % 60;
        if (h > 0) return t('commercialization.ui.hours_minutes', '{h} h {m} min', { h, m: min });
        return t('commercialization.ui.minutes_short', '{n} min', { n: min });
    }

    function formatMoney(amount, currency) {
        const n = Number(amount) || 0;
        try {
            return new Intl.NumberFormat(window.BetterDesk?.lang || undefined, {
                style: 'currency', currency: currency || 'EUR'
            }).format(n);
        } catch (_) {
            return `${n.toFixed(2)} ${currency || ''}`.trim();
        }
    }

    function formatDate(value) {
        if (!value) return '';
        return Utils.formatDate(value);
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function triggerDownload(url) {
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    function stateRow(tbody, cols, text, onRetry) {
        if (!tbody) return;
        if (onRetry) {
            tbody.innerHTML = `<tr><td colspan="${cols}" class="state-cell"><p class="state is-error">${escapeHtml(text)}
                <button type="button" class="btn btn-sm" data-retry>${escapeHtml(t('commercialization.ui.try_again', 'Try again'))}</button></p></td></tr>`;
            tbody.querySelector('[data-retry]').addEventListener('click', onRetry);
        } else {
            tbody.innerHTML = `<tr><td colspan="${cols}" class="state-cell">${escapeHtml(text)}</td></tr>`;
        }
    }

    function statusLabel(status) {
        const key = `commercialization.status.${status}`;
        const val = t(key, '');
        return val || status || '';
    }

    function statusHtml(status) {
        const cls = { active: 'active', suspended: 'offline', pending_report: 'warning', closed: 'offline' }[status] || '';
        return `<span class="status ${cls}">${escapeHtml(statusLabel(status))}</span>`;
    }

    function categoryLabel(cat) {
        if (!cat) return '';
        const val = t(`commercialization.ui.category_${cat}`, '');
        return val || cat;
    }

    /* ── Row menus inside scrolling tables ──
       The table wrapper scrolls sideways, which would clip a menu that hangs
       below the last rows. Open row menus as fixed-position layers instead. */
    let menuSeq = 0;
    function rowMenu(label, items) {
        const id = `comm-menu-${++menuSeq}`;
        return `<span class="menu-anchor">
            <button type="button" class="kebab-btn" data-menu-button data-row-menu aria-haspopup="menu" aria-expanded="false" aria-controls="${id}" aria-label="${escapeHtml(label)}">
                <span class="material-icons" aria-hidden="true">more_vert</span></button>
            <span class="menu menu-end" id="${id}" role="menu">${items}</span>
        </span>`;
    }

    function positionRowMenu(btn, menu) {
        const r = btn.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.insetInlineStart = 'auto';
        menu.style.insetInlineEnd = 'auto';
        menu.style.bottom = 'auto';
        const mw = menu.offsetWidth;
        const mh = menu.offsetHeight;
        const rtl = document.documentElement.dir === 'rtl';
        let left = rtl ? r.left : r.right - mw;
        left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
        let top = r.bottom + 4;
        if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    }

    function openRowMenus() {
        return Array.from(document.querySelectorAll('[data-row-menu][aria-expanded="true"]'));
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-row-menu]');
        if (!btn) return;
        const menu = document.getElementById(btn.getAttribute('aria-controls'));
        if (menu && menu.classList.contains('open')) positionRowMenu(btn, menu);
    });
    // Keep an open row menu next to its button while the page scrolls
    const followMenus = () => openRowMenus().forEach((btn) => {
        const menu = document.getElementById(btn.getAttribute('aria-controls'));
        if (menu && menu.classList.contains('open')) positionRowMenu(btn, menu);
    });
    window.addEventListener('scroll', followMenus, true);
    window.addEventListener('resize', followMenus);

    /* ── Dialogs from templates ── */

    function openDialog(templateId, title, buttons, size) {
        const tpl = document.getElementById(templateId);
        Modal.show({ title, content: tpl ? tpl.innerHTML : '', buttons, size: size || 'medium' });
        return document.querySelector('#modal-container .modal-overlay:last-child .modal');
    }

    function showError(id, message) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = message || '';
        el.hidden = !message;
    }

    function withBusy(buttonLabel, fn) {
        return async () => {
            const btn = Array.from(document.querySelectorAll('#modal-container .modal-footer .btn'))
                .find((b) => b.textContent.trim() === buttonLabel);
            if (btn) btn.disabled = true;
            try { await fn(); } finally { if (btn && document.contains(btn)) btn.disabled = false; }
        };
    }

    /* ── Time sync banner ── */

    async function loadTimesync() {
        const banner = document.getElementById('timesync-banner');
        try {
            const st = await api('/api/panel/billing/timesync/status');
            if (banner) {
                banner.hidden = !!st.synced;
                banner.textContent = st.synced ? '' : t('commercialization.clock.unsynced', 'The server clock is not synchronized. Billable sessions may be blocked until it is.');
            }
        } catch (e) {
            console.warn('[commercialization] timesync', e);
        }
    }

    /* ══ Packages ══ */

    let packagesAll = [];
    let previewsById = {};

    function renderPackages() {
        const tbody = document.querySelector('#packages-table tbody');
        if (!tbody) return;
        const search = (document.getElementById('filter-package-search')?.value || '').trim().toLowerCase();
        const pkgs = search
            ? packagesAll.filter((p) => `${p.name || ''} ${p.description || ''}`.toLowerCase().includes(search))
            : packagesAll;
        if (!packagesAll.length) {
            stateRow(tbody, 8, t('commercialization.empty.packages', 'No packages yet.'));
            return;
        }
        if (!pkgs.length) {
            stateRow(tbody, 8, t('commercialization.ui.no_match_packages', 'No packages match the search.'));
            return;
        }
        tbody.innerHTML = pkgs.map((p) => {
            const prev = previewsById[p.id] || {};
            const companies = (prev.companies || []).join(', ');
            const remaining = prev.remaining_minutes != null ? prev.remaining_minutes : p.included_minutes;
            const label = t('commercialization.ui.actions_for', 'Actions for {name}', { name: p.name || '' });
            const menu = canManage ? rowMenu(label, `
                <button type="button" class="menu-item" role="menuitem" data-edit-package="${escapeHtml(p.id)}">${escapeHtml(t('commercialization.actions.edit', 'Edit'))}</button>
                <span class="menu-divider"></span>
                <button type="button" class="menu-item danger" role="menuitem" data-delete-package="${escapeHtml(p.id)}">${escapeHtml(t('commercialization.ui.delete_package', 'Delete package'))}</button>`) : '';
            return `<tr data-id="${escapeHtml(p.id)}">
                <td><span class="cell-title">${escapeHtml(p.name)}</span>${p.description ? `<span class="cell-sub">${escapeHtml(p.description)}</span>` : ''}</td>
                <td>${escapeHtml(companies || '–')}</td>
                <td class="num-col">${prev.device_count != null ? prev.device_count : '–'}</td>
                <td class="nowrap">${formatMinutes(p.included_minutes)}</td>
                <td class="nowrap">${formatMinutes(prev.included_minutes_used || 0)}</td>
                <td class="nowrap">${formatMinutes(remaining)}</td>
                <td class="nowrap">${escapeHtml(formatMoney(p.overage_rate, p.currency))}</td>
                <td class="actions"><button type="button" class="btn btn-sm" data-preview-package="${escapeHtml(p.id)}">${escapeHtml(t('commercialization.preview.open', 'Month preview'))}</button>${menu}</td>
            </tr>`;
        }).join('');
        tbody.querySelectorAll('[data-preview-package]').forEach((btn) => {
            btn.addEventListener('click', () => openPackagePreview(btn.getAttribute('data-preview-package')));
        });
        tbody.querySelectorAll('[data-edit-package]').forEach((btn) => {
            btn.addEventListener('click', () => openPackageModal(btn.getAttribute('data-edit-package')));
        });
        tbody.querySelectorAll('[data-delete-package]').forEach((btn) => {
            btn.addEventListener('click', () => deletePackage(btn.getAttribute('data-delete-package')));
        });
    }

    async function loadPackages() {
        const tbody = document.querySelector('#packages-table tbody');
        if (!tbody) return [];
        try {
            const data = await api('/api/panel/billing/packages');
            packagesAll = data.packages || [];
            const previews = await Promise.all(packagesAll.map((p) =>
                api(`/api/panel/billing/packages/${encodeURIComponent(p.id)}/preview`).catch(() => null)));
            previewsById = {};
            packagesAll.forEach((p, i) => { if (previews[i]) previewsById[p.id] = previews[i]; });
            renderPackages();
        } catch (e) {
            stateRow(tbody, 8, t('commercialization.ui.error_packages', 'Could not load packages.'), () => {
                stateRow(tbody, 8, t('commercialization.ui.loading_packages', 'Loading packages…'));
                loadPackages();
            });
        }
        return packagesAll;
    }

    let previewPackageId = null;

    function renderPreview(data) {
        const sel = document.getElementById('package-preview-period');
        const period = data.period_ym || '';
        if (sel) {
            const periods = data.available_periods && data.available_periods.length ? data.available_periods : [period];
            sel.innerHTML = periods.map((p) => `<option value="${escapeHtml(p)}" ${p === period ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('');
            const idx = periods.indexOf(period);
            const prev = document.getElementById('btn-preview-prev-month');
            const next = document.getElementById('btn-preview-next-month');
            // Periods are listed newest first
            if (prev) prev.disabled = idx >= periods.length - 1;
            if (next) next.disabled = idx <= 0;
        }
        const stats = document.getElementById('package-preview-stats');
        if (!stats) return;
        const companies = (data.companies || []).join(', ') || '–';
        const used = data.included_minutes_used || 0;
        const over = data.overage_minutes || 0;
        stats.innerHTML = `
            <dt>${escapeHtml(t('commercialization.preview.company', 'Company'))}</dt><dd>${escapeHtml(companies)}</dd>
            <dt>${escapeHtml(t('commercialization.preview.devices', 'Devices'))}</dt><dd>${data.device_count || 0}</dd>
            <dt>${escapeHtml(t('commercialization.preview.used', 'Used'))}</dt><dd>${formatMinutes(used)}</dd>
            <dt>${escapeHtml(t('commercialization.preview.remaining', 'Remaining'))}</dt><dd>${formatMinutes(data.remaining_minutes || 0)}</dd>
            <dt>${escapeHtml(t('commercialization.preview.overage', 'Overage'))}</dt><dd>${formatMinutes(over)}, ${escapeHtml(formatMoney(data.amount_overage || 0, data.currency))}</dd>
            <dt>${escapeHtml(t('commercialization.preview.month_total', 'Month total'))}</dt><dd>${formatMinutes(used + over)}</dd>
            <dt>${escapeHtml(t('commercialization.preview.timezone', 'Billing time zone'))}</dt><dd>${escapeHtml(data.timezone || 'UTC')}</dd>`;
    }

    async function loadPreview(period) {
        const stats = document.getElementById('package-preview-stats');
        try {
            const qs = period ? `?period=${encodeURIComponent(period)}` : '';
            const data = await api(`/api/panel/billing/packages/${encodeURIComponent(previewPackageId)}/preview${qs}`);
            renderPreview(data);
        } catch (e) {
            if (stats) stats.outerHTML = `<p class="state is-error" id="package-preview-stats">${escapeHtml(t('commercialization.ui.error_preview', 'Could not load the month preview.'))} ${escapeHtml(e.message || '')}</p>`;
        }
    }

    function openPackagePreview(packageId) {
        previewPackageId = packageId;
        const pkg = packagesAll.find((p) => p.id === packageId);
        openDialog('package-preview-template', pkg ? pkg.name : t('commercialization.preview.title', 'Package preview'), [
            { label: t('common.close', 'Close'), class: 'btn', onClick: () => Modal.close() }
        ], 'large');
        const cached = previewsById[packageId];
        if (cached) renderPreview(cached);
        else loadPreview();
        const shift = (delta) => {
            const sel = document.getElementById('package-preview-period');
            if (!sel) return;
            const opts = Array.from(sel.options).map((o) => o.value);
            const idx = Math.max(0, Math.min(opts.length - 1, opts.indexOf(sel.value) + delta));
            loadPreview(opts[idx]);
        };
        document.getElementById('btn-preview-prev-month')?.addEventListener('click', () => shift(1));
        document.getElementById('btn-preview-next-month')?.addEventListener('click', () => shift(-1));
        document.getElementById('package-preview-period')?.addEventListener('change', (e) => loadPreview(e.target.value));
    }

    function syncPackageMinutesFromAmount() {
        const unit = document.getElementById('package-unit')?.value || 'hours';
        const amount = parseFloat(document.getElementById('package-amount')?.value) || 0;
        const minutes = Math.max(0, unit === 'hours' ? Math.round(amount * 60) : Math.round(amount));
        const hidden = document.getElementById('package-minutes');
        if (hidden) hidden.value = String(minutes);
        return minutes;
    }

    function setRounding(value) {
        const sel = document.getElementById('package-rounding');
        const wrap = document.getElementById('package-rounding-custom-wrap');
        const custom = document.getElementById('package-rounding-custom');
        const v = String(value || 10);
        if (Array.from(sel.options).some((o) => o.value === v)) {
            sel.value = v;
            wrap.hidden = true;
        } else {
            sel.value = 'custom';
            custom.value = v;
            wrap.hidden = false;
        }
    }

    function openPackageModal(editId) {
        const pkg = editId ? packagesAll.find((p) => p.id === editId) : null;
        if (editId && !pkg) return;
        const submitLabel = pkg ? t('commercialization.actions.save', 'Save') : t('commercialization.packages.create_submit', 'Create package');
        openDialog('package-modal-template',
            pkg ? t('commercialization.packages.edit_title', 'Edit package') : t('commercialization.packages.create_title', 'New support package'), [
                { label: t('commercialization.form.cancel', 'Cancel'), class: 'btn', onClick: () => Modal.close() },
                { label: submitLabel, class: 'btn-primary', onClick: withBusy(submitLabel, () => submitPackageModal(pkg ? pkg.id : null)) }
            ]);
        const minutes = pkg ? (pkg.included_minutes || 0) : 600;
        const asHours = minutes % 60 === 0;
        document.getElementById('package-name').value = pkg ? (pkg.name || '') : '';
        document.getElementById('package-description').value = pkg ? (pkg.description || '') : '';
        document.getElementById('package-unit').value = asHours ? 'hours' : 'minutes';
        document.getElementById('package-amount').value = String(asHours ? minutes / 60 : minutes);
        document.getElementById('package-overage').value = pkg ? (pkg.overage_rate ?? 0) : '100';
        document.getElementById('package-currency').value = pkg ? (pkg.currency || 'EUR') : (packagesAll[0]?.currency || 'EUR');
        setRounding(pkg ? pkg.rounding_minutes : 10);
        syncPackageMinutesFromAmount();
        document.getElementById('package-unit').addEventListener('change', syncPackageMinutesFromAmount);
        document.getElementById('package-amount').addEventListener('input', syncPackageMinutesFromAmount);
        document.getElementById('package-rounding').addEventListener('change', () => {
            document.getElementById('package-rounding-custom-wrap').hidden = document.getElementById('package-rounding').value !== 'custom';
        });
    }

    async function submitPackageModal(editId) {
        const name = document.getElementById('package-name')?.value.trim();
        const description = document.getElementById('package-description')?.value.trim();
        const includedMinutes = syncPackageMinutesFromAmount();
        const overageRate = parseFloat(document.getElementById('package-overage')?.value);
        const currency = document.getElementById('package-currency')?.value.trim().toUpperCase();
        let rounding = document.getElementById('package-rounding')?.value;
        if (rounding === 'custom') rounding = document.getElementById('package-rounding-custom')?.value || '15';

        if (!name) {
            showError('package-modal-error', t('commercialization.ui.name_required', 'Enter a name for the package.'));
            document.getElementById('package-name')?.focus();
            return;
        }
        if (Number.isNaN(overageRate) || overageRate < 0) {
            showError('package-modal-error', t('commercialization.ui.rate_required', 'Enter an overage rate of 0 or more.'));
            document.getElementById('package-overage')?.focus();
            return;
        }
        const body = {
            name,
            description,
            included_minutes: includedMinutes,
            overage_rate: overageRate,
            currency: currency || 'EUR',
            rounding_minutes: parseInt(rounding, 10) || 10
        };
        try {
            if (editId) {
                await api(`/api/panel/billing/packages/${encodeURIComponent(editId)}`, { method: 'PUT', body });
                notifySuccess(t('commercialization.packages.updated', 'Package updated'));
            } else {
                await api('/api/panel/billing/packages', { method: 'POST', body });
                notifySuccess(t('commercialization.packages.created', 'Package created'));
            }
            Modal.close();
            await loadPackages();
        } catch (e) {
            showError('package-modal-error', e.message);
        }
    }

    async function deletePackage(id) {
        const pkg = packagesAll.find((p) => p.id === id);
        const ok = await Modal.confirm({
            title: t('commercialization.ui.delete_package_title', 'Delete {name}?', { name: pkg ? pkg.name : '' }),
            message: t('commercialization.packages.delete_confirm', 'Assignments that use this package must be removed first.'),
            confirmLabel: t('commercialization.ui.delete_package', 'Delete package'),
            danger: true
        });
        if (!ok) return;
        try {
            await api(`/api/panel/billing/packages/${encodeURIComponent(id)}`, { method: 'DELETE' });
            notifySuccess(t('commercialization.packages.deleted', 'Package deleted'));
            await loadPackages();
        } catch (e) {
            notifyError(e.message);
        }
    }

    /* ══ Assignments (contracts) ══ */

    let contractsAll = [];

    function targetTypeLabel(type) {
        return t(`commercialization.targets.${type}`, type);
    }

    function formatValidity(c) {
        if (!c.valid_from && !c.valid_until) return t('commercialization.ui.no_end', 'No end date');
        const from = c.valid_from ? formatDate(c.valid_from).split(',')[0] : '…';
        const until = c.valid_until ? formatDate(c.valid_until).split(',')[0] : '…';
        return `${from} – ${until}`;
    }

    function renderContracts() {
        const tbody = document.querySelector('#contracts-table tbody');
        if (!tbody) return;
        const search = (document.getElementById('filter-contract-search')?.value || '').trim().toLowerCase();
        const contracts = search
            ? contractsAll.filter((c) => `${c.target_name || ''} ${c.target_key || ''} ${c.package_name || ''}`.toLowerCase().includes(search))
            : contractsAll;
        if (!contracts.length) {
            const filtered = search || document.getElementById('filter-contract-status')?.value;
            stateRow(tbody, 6, filtered
                ? t('commercialization.ui.no_match_assignments', 'No assignments match the filters.')
                : t('commercialization.empty.contracts', 'No package assignments yet.'));
            return;
        }
        tbody.innerHTML = contracts.map((c) => {
            const suspended = c.status === 'suspended';
            const label = t('commercialization.ui.actions_for', 'Actions for {name}', { name: c.target_name || c.target_key || '' });
            const menu = canManage ? rowMenu(label, `
                <button type="button" class="menu-item" role="menuitem" data-edit-contract="${escapeHtml(c.id)}">${escapeHtml(t('commercialization.actions.edit', 'Edit'))}</button>
                <button type="button" class="menu-item" role="menuitem" data-contract-id="${escapeHtml(c.id)}" data-status="${suspended ? 'active' : 'suspended'}">${escapeHtml(suspended ? t('commercialization.contracts.activate', 'Activate') : t('commercialization.contracts.suspend', 'Suspend'))}</button>
                <span class="menu-divider"></span>
                <button type="button" class="menu-item danger" role="menuitem" data-delete-contract="${escapeHtml(c.id)}">${escapeHtml(t('commercialization.ui.remove_assignment', 'Remove assignment'))}</button>`) : '';
            return `<tr data-id="${escapeHtml(c.id)}">
                <td><span class="cell-title">${escapeHtml(c.target_name || c.target_key)}</span><span class="cell-sub">${escapeHtml(targetTypeLabel(c.target_type))}</span></td>
                <td>${escapeHtml(c.package_name || c.package_id)}</td>
                <td class="nowrap">${formatMinutes(c.remaining_minutes)}</td>
                <td>${statusHtml(c.status)}</td>
                <td>${escapeHtml(formatValidity(c))}</td>
                <td class="actions">${menu}</td>
            </tr>`;
        }).join('');
        tbody.querySelectorAll('[data-contract-id]').forEach((btn) => {
            btn.addEventListener('click', () => toggleContract(btn.getAttribute('data-contract-id'), btn.getAttribute('data-status')));
        });
        tbody.querySelectorAll('[data-edit-contract]').forEach((btn) => {
            btn.addEventListener('click', () => openContractEditModal(btn.getAttribute('data-edit-contract')));
        });
        tbody.querySelectorAll('[data-delete-contract]').forEach((btn) => {
            btn.addEventListener('click', () => deleteContract(btn.getAttribute('data-delete-contract')));
        });
    }

    async function loadContracts() {
        const tbody = document.querySelector('#contracts-table tbody');
        if (!tbody) return;
        const params = new URLSearchParams();
        const type = document.getElementById('filter-contract-type')?.value;
        const status = document.getElementById('filter-contract-status')?.value;
        if (type) params.set('target_type', type);
        if (status) params.set('status', status);
        const qs = params.toString();
        try {
            const data = await api(`/api/panel/billing/contracts${qs ? `?${qs}` : ''}`);
            contractsAll = data.contracts || [];
            renderContracts();
        } catch (e) {
            stateRow(tbody, 6, t('commercialization.ui.error_assignments', 'Could not load assignments.'), () => {
                stateRow(tbody, 6, t('commercialization.ui.loading_assignments', 'Loading assignments…'));
                loadContracts();
            });
        }
    }

    async function toggleContract(id, status) {
        try {
            await api(`/api/panel/billing/contracts/${encodeURIComponent(id)}`, { method: 'PUT', body: { status } });
            notifySuccess(status === 'suspended'
                ? t('commercialization.ui.assignment_suspended', 'Assignment suspended')
                : t('commercialization.ui.assignment_activated', 'Assignment active again'));
            await loadContracts();
        } catch (e) {
            notifyError(e.message);
        }
    }

    async function deleteContract(id) {
        const c = contractsAll.find((x) => x.id === id);
        const ok = await Modal.confirm({
            title: t('commercialization.ui.remove_assignment_title', 'Remove {name} from {package}?', {
                name: c ? (c.target_name || c.target_key) : '', package: c ? (c.package_name || '') : ''
            }),
            message: t('commercialization.ui.remove_assignment_message', 'Sessions on these devices are no longer billed against this package.'),
            confirmLabel: t('commercialization.ui.remove_assignment', 'Remove assignment'),
            danger: true
        });
        if (!ok) return;
        try {
            await api(`/api/panel/billing/contracts/${encodeURIComponent(id)}`, { method: 'DELETE' });
            notifySuccess(t('commercialization.contracts.deleted', 'Assignment removed'));
            await loadContracts();
        } catch (e) {
            notifyError(e.message);
        }
    }

    async function loadTargetOptions(targetType) {
        const select = document.getElementById('assign-target-select');
        if (!select) return;
        select.innerHTML = `<option value="">${escapeHtml(t('commercialization.assign.select_target', 'Select target…'))}</option>`;
        const add = (value, label) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            select.appendChild(opt);
        };
        if (targetType === 'org') {
            const data = await api('/api/panel/org');
            (data.organizations || data.orgs || []).forEach((o) => add(o.id, o.name || o.id));
        } else if (targetType === 'device_group') {
            const data = await api('/api/device-groups');
            (data.groups || data.device_groups || []).forEach((g) => add(g.guid || g.id, g.name || g.guid));
        } else if (targetType === 'folder') {
            const data = await api('/api/folders');
            (data.folders || []).forEach((f) => add(String(f.id), f.name || f.id));
        } else if (targetType === 'device') {
            const data = await api('/api/devices');
            (data.devices || []).forEach((d) => add(d.id || d.device_id, d.name || d.hostname || d.id));
        }
    }

    async function openAssignModal() {
        let packages;
        try {
            packages = packagesAll.length ? packagesAll : await loadPackages();
        } catch (e) {
            notifyError(e.message);
            return;
        }
        if (!packages.length) {
            notifyError(t('commercialization.contracts.no_packages', 'Create a package first'));
            return;
        }
        const submitLabel = t('commercialization.assign.submit', 'Assign');
        openDialog('assign-modal-template', t('commercialization.assign.title', 'Assign package'), [
            { label: t('commercialization.form.cancel', 'Cancel'), class: 'btn', onClick: () => Modal.close() },
            { label: submitLabel, class: 'btn-primary', onClick: withBusy(submitLabel, () => submitAssignModal(null)) }
        ]);
        const pkgSelect = document.getElementById('assign-package-select');
        pkgSelect.innerHTML = packages.map((p) =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(formatMinutes(p.included_minutes))})</option>`).join('');
        try {
            await loadTargetOptions('device_group');
        } catch (e) {
            showError('assign-modal-error', e.message);
        }
    }

    async function openContractEditModal(contractId) {
        const contract = contractsAll.find((c) => c.id === contractId);
        if (!contract) return;
        const submitLabel = t('commercialization.actions.save', 'Save');
        openDialog('assign-modal-template', t('commercialization.contracts.edit_title', 'Edit assignment'), [
            { label: t('commercialization.form.cancel', 'Cancel'), class: 'btn', onClick: () => Modal.close() },
            { label: submitLabel, class: 'btn-primary', onClick: withBusy(submitLabel, () => submitAssignModal(contractId)) }
        ]);
        const typeInput = document.getElementById('assign-target-type');
        typeInput.value = contract.target_type || 'device_group';
        const targetLabel = document.querySelector('label[for="assign-target-select"]');
        if (targetLabel) targetLabel.textContent = targetTypeLabel(typeInput.value);
        const targetSelect = document.getElementById('assign-target-select');
        targetSelect.innerHTML = `<option value="${escapeHtml(contract.target_key)}">${escapeHtml(contract.target_name || contract.target_key)}</option>`;
        targetSelect.disabled = true;
        const pkgSelect = document.getElementById('assign-package-select');
        pkgSelect.innerHTML = `<option value="${escapeHtml(contract.package_id)}">${escapeHtml(contract.package_name || contract.package_id)}</option>`;
        pkgSelect.disabled = true;
        document.getElementById('assign-remaining').value = contract.remaining_minutes ?? 0;
        document.getElementById('assign-hourly-rate').value = contract.hourly_rate ?? 0;
        document.getElementById('assign-overage-rate').value = contract.overage_rate ?? '';
        document.getElementById('assign-valid-from').value = contract.valid_from ? String(contract.valid_from).slice(0, 10) : '';
        document.getElementById('assign-valid-until').value = contract.valid_until ? String(contract.valid_until).slice(0, 10) : '';
    }

    async function submitAssignModal(editingContractId) {
        const targetType = document.getElementById('assign-target-type')?.value;
        const targetKey = document.getElementById('assign-target-select')?.value;
        const packageId = document.getElementById('assign-package-select')?.value;
        const remainingRaw = document.getElementById('assign-remaining')?.value;
        const hourlyRate = parseFloat(document.getElementById('assign-hourly-rate')?.value);
        const overageRaw = document.getElementById('assign-overage-rate')?.value;
        const validFrom = document.getElementById('assign-valid-from')?.value;
        const validUntil = document.getElementById('assign-valid-until')?.value;

        if (validFrom && validUntil && validUntil < validFrom) {
            showError('assign-modal-error', t('commercialization.ui.dates_order', 'The end date is before the start date.'));
            return;
        }

        if (editingContractId) {
            const patch = {};
            if (remainingRaw !== '') patch.remaining_minutes = parseInt(remainingRaw, 10);
            if (!Number.isNaN(hourlyRate)) patch.hourly_rate = hourlyRate;
            if (overageRaw !== '') patch.overage_rate = parseFloat(overageRaw);
            patch.valid_from = validFrom ? `${validFrom}T00:00:00Z` : null;
            patch.valid_until = validUntil ? `${validUntil}T23:59:59Z` : null;
            try {
                await api(`/api/panel/billing/contracts/${encodeURIComponent(editingContractId)}`, { method: 'PUT', body: patch });
                Modal.close();
                notifySuccess(t('commercialization.contracts.updated', 'Assignment updated'));
                await loadContracts();
            } catch (e) {
                showError('assign-modal-error', e.message);
            }
            return;
        }

        if (!targetType || !targetKey || !packageId) {
            showError('assign-modal-error', t('commercialization.assign.missing_fields', 'Select a device group and a package.'));
            return;
        }
        const pkg = packagesAll.find((p) => p.id === packageId);
        const body = {
            target_type: targetType,
            target_key: targetKey,
            package_id: packageId,
            currency: pkg?.currency || 'EUR'
        };
        if (remainingRaw !== '') body.remaining_minutes = parseInt(remainingRaw, 10);
        if (!Number.isNaN(hourlyRate)) body.hourly_rate = hourlyRate;
        if (overageRaw !== '') body.overage_rate = parseFloat(overageRaw);
        if (validFrom) body.valid_from = `${validFrom}T00:00:00Z`;
        if (validUntil) body.valid_until = `${validUntil}T23:59:59Z`;
        try {
            await api('/api/panel/billing/contracts', { method: 'POST', body });
            Modal.close();
            notifySuccess(t('commercialization.assign.success', 'Package assigned'));
            await Promise.all([loadContracts(), loadPackages()]);
        } catch (e) {
            showError('assign-modal-error', e.message);
        }
    }

    /* ── Billing settings (notifications) ── */

    let settingsLoaded = false;
    async function loadEmailNotificationSettings() {
        settingsLoaded = true;
        const statusEl = document.getElementById('email-smtp-status');
        try {
            const smtp = await api('/api/panel/commercialization/smtp-status');
            if (statusEl) {
                statusEl.textContent = smtp.configured
                    ? t('commercialization.notifications.smtp_configured', 'Email sending (SMTP) is set up.')
                    : t('commercialization.notifications.smtp_missing', 'Email sending (SMTP) is not set up yet.');
            }
        } catch (_) {
            if (statusEl) statusEl.textContent = t('commercialization.notifications.smtp_missing', 'Email sending (SMTP) is not set up yet.');
        }
        try {
            const data = await api('/api/panel/commercialization/email-config');
            const cfg = data.config || {};
            document.getElementById('notif-help-requests-enabled').checked = cfg.help_requests_enabled !== false;
            document.getElementById('notif-assigned-operators').checked = cfg.notify_assigned_operators !== false;
            document.getElementById('notif-fallback-alert').checked = cfg.fallback_alert_email !== false;
            document.getElementById('notif-folder-subject').checked = cfg.include_folder_in_subject !== false;
        } catch (e) {
            const st = document.getElementById('email-notifications-status');
            if (st) {
                st.textContent = t('commercialization.ui.error_settings', 'Could not load the notification settings.');
                st.className = 'form-status is-error';
            }
        }
    }

    const settingsPanel = document.getElementById('billing-settings-panel');
    settingsPanel?.addEventListener('toggle', () => {
        if (settingsPanel.open && !settingsLoaded) loadEmailNotificationSettings();
    });

    document.getElementById('btn-save-email-notifications')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const st = document.getElementById('email-notifications-status');
        btn.disabled = true;
        if (st) { st.textContent = t('commercialization.ui.saving', 'Saving…'); st.className = 'form-status'; }
        try {
            await api('/api/panel/commercialization/email-config', {
                method: 'PUT',
                body: {
                    help_requests_enabled: document.getElementById('notif-help-requests-enabled')?.checked === true,
                    notify_assigned_operators: document.getElementById('notif-assigned-operators')?.checked === true,
                    fallback_alert_email: document.getElementById('notif-fallback-alert')?.checked === true,
                    include_folder_in_subject: document.getElementById('notif-folder-subject')?.checked === true
                }
            });
            if (st) { st.textContent = t('commercialization.notifications.saved', 'Notification settings saved'); st.className = 'form-status is-ok'; }
        } catch (err) {
            if (st) { st.textContent = err.message; st.className = 'form-status is-error'; }
        } finally {
            btn.disabled = false;
        }
    });

    /* ══ Sessions ══ */

    let sessionsAll = [];
    let reportsBySession = {};
    let orgNames = {};

    function sessionQuery() {
        const params = new URLSearchParams();
        const orgId = document.getElementById('filter-session-org')?.value;
        const status = document.getElementById('filter-session-status')?.value;
        const deviceId = document.getElementById('filter-session-device')?.value?.trim();
        if (orgId) params.set('org_id', orgId);
        if (status) params.set('status', status);
        if (deviceId) params.set('device_id', deviceId);
        return params.toString();
    }

    function renderSessions() {
        const tbody = document.querySelector('#sessions-table tbody');
        const count = document.getElementById('sessions-count');
        if (!tbody) return;
        const filtered = !!sessionQuery();
        if (!sessionsAll.length) {
            if (count) count.textContent = '';
            stateRow(tbody, 8, filtered
                ? t('commercialization.ui.no_match_sessions', 'No sessions match the filters.')
                : t('commercialization.empty.sessions', 'No billable sessions yet.'));
            return;
        }
        const pending = sessionsAll.filter((s) => s.status === 'pending_report').length;
        const active = sessionsAll.filter((s) => s.status === 'active').length;
        if (count) {
            let line = t('commercialization.ui.sessions_count', '{count} sessions', { count: `<strong>${sessionsAll.length}</strong>` });
            if (active) line += `, ${t('commercialization.ui.sessions_active', '{count} active', { count: active })}`;
            if (pending) line += `, ${t('commercialization.ui.sessions_pending', '{count} waiting for a report', { count: pending })}`;
            count.innerHTML = line;
        }
        tbody.innerHTML = sessionsAll.map((s) => {
            const report = reportsBySession[s.id];
            const reportCell = report
                ? escapeHtml(report.summary || '')
                : `<span class="text-muted">${escapeHtml(s.status === 'pending_report'
                    ? t('commercialization.ui.report_missing', 'Not written yet')
                    : t('commercialization.ui.report_none', 'None'))}</span>`;
            const write = s.status === 'pending_report' && canWriteReport
                ? `<button type="button" class="btn btn-sm" data-complete-report="${escapeHtml(s.id)}">${escapeHtml(t('commercialization.ui.write_report', 'Write report'))}</button>`
                : '';
            return `<tr data-id="${escapeHtml(s.id)}">
                <td class="nowrap"><span class="cell-title">${escapeHtml(s.device_name || s.device_id)}</span><span class="cell-sub mono">${escapeHtml(s.device_id || '')}</span></td>
                <td>${escapeHtml(s.operator_name || s.operator_id || '')}</td>
                <td>${escapeHtml(formatDate(s.started_at))}</td>
                <td>${escapeHtml(formatDate(s.ended_at)) || '<span class="text-muted">–</span>'}</td>
                <td class="nowrap">${formatMinutes(s.billed_minutes)}</td>
                <td>${statusHtml(s.status)}</td>
                <td class="report-cell">${reportCell}</td>
                <td class="actions">${write}<button type="button" class="btn btn-sm" data-session-detail="${escapeHtml(s.id)}">${escapeHtml(t('commercialization.ui.details', 'Details'))}</button></td>
            </tr>`;
        }).join('');
        tbody.querySelectorAll('[data-complete-report]').forEach((btn) => {
            btn.addEventListener('click', () => completePendingReport(btn.getAttribute('data-complete-report')));
        });
        tbody.querySelectorAll('[data-session-detail]').forEach((btn) => {
            btn.addEventListener('click', () => openSessionDetail(btn.getAttribute('data-session-detail')));
        });
    }

    async function loadSessions() {
        const tbody = document.querySelector('#sessions-table tbody');
        if (!tbody) return;
        const qs = sessionQuery();
        try {
            const [sessData, reportData] = await Promise.all([
                api(`/api/panel/billing/sessions${qs ? `?${qs}` : ''}`),
                api('/api/panel/billing/reports').catch(() => ({ reports: [] }))
            ]);
            reportsBySession = {};
            (reportData.reports || []).forEach((r) => { reportsBySession[r.session_id] = r; });
            // The Go API ignores device_id, so narrow the list here as well
            const device = (document.getElementById('filter-session-device')?.value || '').trim().toLowerCase();
            sessionsAll = (sessData.sessions || []).filter((s) => !device
                || `${s.device_id || ''} ${s.device_name || ''}`.toLowerCase().includes(device));
            renderSessions();
        } catch (e) {
            const count = document.getElementById('sessions-count');
            if (count) count.textContent = '';
            stateRow(tbody, 8, t('commercialization.ui.error_sessions', 'Could not load sessions. The billing service did not answer.'), () => {
                stateRow(tbody, 8, t('commercialization.ui.loading_sessions', 'Loading sessions…'));
                loadSessions();
            });
        }
    }

    function fact(label, value) {
        if (value === undefined || value === null || value === '') return '';
        return `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`;
    }

    function openSessionDetail(id) {
        const s = sessionsAll.find((x) => x.id === id);
        if (!s) return;
        const r = reportsBySession[id];
        const yesNo = (v) => escapeHtml(v ? t('common.yes', 'Yes') : t('common.no', 'No'));
        const contract = s.contract_id ? `<span class="mono">${escapeHtml(s.contract_id)}</span>` : '';
        const phase = s.billing_phase ? escapeHtml(t(`commercialization.ui.phase_${s.billing_phase}`, s.billing_phase)) : '';
        const raw = s.raw_seconds != null ? formatMinutes(Math.round((s.raw_seconds || 0) / 60)) : '';
        const reportFacts = r
            ? fact(t('commercialization.report.summary', 'Work performed'), escapeHtml(r.summary || ''))
              + fact(t('commercialization.report.category', 'Category'), escapeHtml(categoryLabel(r.category)))
              + fact(t('commercialization.report.ticket_ref', 'Ticket reference'), escapeHtml(r.ticket_ref || ''))
              + fact(t('commercialization.ui.report_author', 'Written by'), escapeHtml(r.operator_id || ''))
              + fact(t('commercialization.ui.report_date', 'Written'), escapeHtml(formatDate(r.created_at)))
            : '';
        const content = `
            <dl class="facts">
                ${fact(t('commercialization.sessions.device', 'Device'), `${escapeHtml(s.device_name || s.device_id)} <span class="mono">${escapeHtml(s.device_id || '')}</span>`)}
                ${fact(t('commercialization.sessions.operator', 'Operator'), escapeHtml(s.operator_name || s.operator_id || ''))}
                ${fact(t('commercialization.sessions.org', 'Organization'), escapeHtml(orgNames[s.org_id] || s.org_id || ''))}
                ${fact(t('commercialization.contracts.status', 'Status'), statusHtml(s.status))}
                ${fact(t('commercialization.sessions.started', 'Started'), escapeHtml(formatDate(s.started_at)))}
                ${fact(t('commercialization.sessions.ended', 'Ended'), escapeHtml(formatDate(s.ended_at)))}
                ${fact(t('commercialization.ui.measured_time', 'Measured time'), raw)}
                ${fact(t('commercialization.ui.billed_time', 'Billed time'), formatMinutes(s.billed_minutes))}
                ${fact(t('commercialization.sessions.phase', 'Phase'), phase)}
                ${fact(t('commercialization.ui.included_used', 'From included time'), formatMinutes(s.included_minutes_used))}
                ${fact(t('commercialization.ui.overage_time', 'Overage time'), formatMinutes(s.overage_minutes))}
                ${fact(t('commercialization.ui.amount_included', 'Amount, included time'), escapeHtml(formatMoney(s.amount_included, s.currency)))}
                ${fact(t('commercialization.ui.amount_overage', 'Amount, overage'), escapeHtml(formatMoney(s.amount_overage, s.currency)))}
                ${fact(t('commercialization.ui.transport', 'Connection'), escapeHtml(s.transport || ''))}
                ${fact(t('commercialization.ui.clock_synced', 'Clock in sync at start'), `${yesNo(s.clock_synced_at_start)}${s.clock_offset_ms_at_start ? ` (${escapeHtml(String(s.clock_offset_ms_at_start))} ms)` : ''}`)}
                ${fact(t('commercialization.ui.contract_id', 'Assignment ID'), contract)}
                ${fact(t('commercialization.ui.session_id', 'Session ID'), `<span class="mono">${escapeHtml(s.id)}</span>`)}
                ${fact(t('commercialization.ui.relay_id', 'Relay ID'), s.relay_uuid ? `<span class="mono">${escapeHtml(s.relay_uuid)}</span>` : '')}
            </dl>
            <h3 class="dialog-subhead">${escapeHtml(t('commercialization.report.title', 'Work report'))}</h3>
            ${r ? `<dl class="facts">${reportFacts}</dl>` : `<p class="text-muted">${escapeHtml(t('commercialization.ui.no_report', 'No work report for this session yet.'))}</p>`}`;
        const buttons = [];
        if (!r && s.status === 'pending_report' && canWriteReport) {
            buttons.push({ label: t('commercialization.ui.write_report', 'Write report'), class: 'btn', onClick: () => { Modal.close(); completePendingReport(id); } });
        }
        buttons.push({ label: t('common.close', 'Close'), class: 'btn', onClick: () => Modal.close() });
        Modal.show({ title: t('commercialization.ui.session_details', 'Session details'), content, buttons, size: 'large' });
    }

    function completePendingReport(sessionId) {
        const s = sessionsAll.find((x) => x.id === sessionId);
        const submitLabel = t('commercialization.report.submit', 'Save report');
        openDialog('report-modal-template', t('commercialization.report.title', 'Work report'), [
            { label: t('commercialization.form.cancel', 'Cancel'), class: 'btn', onClick: () => Modal.close() },
            { label: submitLabel, class: 'btn-primary', onClick: withBusy(submitLabel, () => submitReport(sessionId)) }
        ]);
        const info = document.getElementById('report-modal-session');
        if (info && s) {
            info.textContent = t('commercialization.ui.report_for', '{device}, started {date}', {
                device: s.device_name || s.device_id, date: formatDate(s.started_at)
            });
        }
    }

    async function submitReport(sessionId) {
        const summary = (document.getElementById('report-summary')?.value || '').trim();
        if (!summary) {
            showError('report-modal-error', t('commercialization.report.summary_required', 'Describe the work you did.'));
            document.getElementById('report-summary')?.focus();
            return;
        }
        try {
            await api(`/api/panel/billing/sessions/${encodeURIComponent(sessionId)}/report`, {
                method: 'POST',
                body: {
                    summary,
                    category: document.getElementById('report-category')?.value || '',
                    ticket_ref: (document.getElementById('report-ticket')?.value || '').trim()
                }
            });
            Modal.close();
            notifySuccess(t('commercialization.report.saved', 'Work report saved'));
            await loadSessions();
        } catch (e) {
            showError('report-modal-error', e.message);
        }
    }

    async function populateOrgFilterSelect(selectEl) {
        if (!selectEl) return;
        try {
            const data = await api('/api/panel/org');
            const current = selectEl.value;
            selectEl.innerHTML = `<option value="">${escapeHtml(t('commercialization.filters.all_orgs', 'All organizations'))}</option>`;
            (data.organizations || data.orgs || []).forEach((org) => {
                orgNames[org.id] = org.name || org.id;
                const opt = document.createElement('option');
                opt.value = org.id;
                opt.textContent = org.name || org.id;
                selectEl.appendChild(opt);
            });
            if (current) selectEl.value = current;
        } catch (e) {
            console.warn('[commercialization] orgs', e);
        }
    }

    /* ── Wiring ── */

    document.getElementById('btn-new-package')?.addEventListener('click', () => openPackageModal());
    document.getElementById('btn-new-contract')?.addEventListener('click', () => openAssignModal());

    document.getElementById('btn-export-sessions')?.addEventListener('click', () => {
        const qs = sessionQuery();
        triggerDownload(`/api/panel/billing/sessions/export?format=csv${qs ? `&${qs}` : ''}`);
    });
    document.getElementById('btn-export-reports-csv')?.addEventListener('click', () => {
        const orgId = document.getElementById('filter-session-org')?.value;
        triggerDownload(`/api/panel/billing/reports/export?format=csv${orgId ? `&org_id=${encodeURIComponent(orgId)}` : ''}`);
    });
    document.getElementById('btn-export-reports-pdf')?.addEventListener('click', () => {
        const orgId = document.getElementById('filter-session-org')?.value;
        triggerDownload(`/api/panel/billing/reports/export?format=pdf${orgId ? `&org_id=${encodeURIComponent(orgId)}` : ''}`);
    });

    document.getElementById('filter-contract-status')?.addEventListener('change', () => loadContracts());
    document.getElementById('filter-contract-search')?.addEventListener('input', renderContracts);
    document.getElementById('filter-package-search')?.addEventListener('input', renderPackages);

    document.getElementById('btn-refresh-sessions')?.addEventListener('click', () => loadSessions());
    document.getElementById('filter-session-org')?.addEventListener('change', () => loadSessions());
    document.getElementById('filter-session-status')?.addEventListener('change', () => loadSessions());
    let deviceTimer = null;
    document.getElementById('filter-session-device')?.addEventListener('input', () => {
        clearTimeout(deviceTimer);
        deviceTimer = setTimeout(() => loadSessions(), 300);
    });

    const tab = page.dataset.activeTab || 'packages';
    loadTimesync();
    if (tab === 'sessions') {
        populateOrgFilterSelect(document.getElementById('filter-session-org'));
        loadSessions();
    } else {
        loadPackages();
        loadContracts();
        if (settingsPanel && settingsPanel.open) {
            loadEmailNotificationSettings();
            settingsPanel.scrollIntoView({ block: 'start' });
        }
    }
})();
