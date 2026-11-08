/* BetterDesk Console — Client app branding (/client-branding) */

(function () {
    'use strict';

    const t = (k, vars) => (typeof window._ === 'function' ? window._(k, vars) : k);
    const csrf = () => (window.BetterDesk && window.BetterDesk.csrfToken) || '';

    const MAX_LOGO = 512 * 1024;
    const DEFAULT_ACCENT = '#4f6ef7';
    const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
    const state = {
        logo: null,
        clearLogo: false,
        revision: '',
    };

    async function api(method, url, body) {
        const headers = { Accept: 'application/json' };
        const write = method === 'POST' || method === 'PUT' || method === 'PATCH';
        if (write) headers['Content-Type'] = 'application/json';
        if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrf();
        const opts = { method, headers, credentials: 'same-origin' };
        if (body !== undefined) opts.body = JSON.stringify(body);
        else if (write) opts.body = '{}';
        const res = await fetch(url, opts);
        const ct = res.headers.get('content-type') || '';
        const data = ct.includes('application/json') ? await res.json() : null;
        if (res.status === 403) throw new Error(Utils.permissionDeniedMessage());
        if (!res.ok || (data && data.success === false)) {
            throw new Error((data && data.error) || `HTTP ${res.status}`);
        }
        return data;
    }

    function $(id) {
        return document.getElementById(id);
    }

    const form = () => $('cb-form');

    function expandHex(c) {
        return c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c;
    }

    /** Picker → text always; text → picker only once it is a valid hex value */
    function syncAccentInputs(fromPicker) {
        const picker = $('cb-accent-picker');
        const text = $('cb-accent');
        if (!picker || !text) return;
        if (fromPicker) {
            text.value = picker.value;
        } else {
            const v = text.value.trim();
            if (HEX.test(v)) picker.value = expandHex(v.toLowerCase());
        }
    }

    function renderLogo() {
        const img = $('cb-preview-logo');
        const fallback = $('cb-preview-logo-fallback');
        const clear = $('cb-clear-logo');
        const src = state.logo && state.logo.data_base64
            ? `data:${state.logo.mime};base64,${state.logo.data_base64}`
            : (state.logo && state.logo.url ? state.logo.url : '');
        const show = Boolean(src) && !state.clearLogo;
        if (img) {
            if (show) img.src = src; else img.removeAttribute('src');
            img.hidden = !show;
        }
        if (fallback) fallback.hidden = show;
        if (clear) clear.hidden = !show;
        renderPreview();
    }

    /** Relative luminance of a #rrggbb colour (WCAG) */
    function luminance(hex) {
        const n = parseInt(hex.slice(1), 16);
        const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    }

    /**
     * Live preview in the side column, built from the current form values:
     * name and logo in the header, the contact lines, a button in the accent.
     */
    function renderPreview() {
        const name = ($('cb-company')?.value || '').trim();
        const nameEl = $('cb-pv-name');
        if (nameEl) nameEl.textContent = name || 'BetterDesk';

        const line = (id, value) => {
            const el = $(id);
            if (!el) return;
            el.textContent = value;
            el.hidden = !value;
        };
        line('cb-pv-support', ($('cb-support')?.value || '').trim());
        line('cb-pv-phone', ($('cb-phone')?.value || '').trim());
        line('cb-pv-email', ($('cb-email')?.value || '').trim());
        line('cb-pv-website', ($('cb-website')?.value || '').trim());

        const logo = $('cb-pv-logo');
        if (logo) {
            const own = !state.clearLogo && state.logo && (state.logo.data_base64
                ? `data:${state.logo.mime};base64,${state.logo.data_base64}`
                : state.logo.url);
            logo.src = own || '/img/betterdesk_icon.png';
        }

        // Text on the accent is black or white, whichever reads better on it
        const button = $('cb-pv-button');
        if (button) {
            const v = ($('cb-accent')?.value || '').trim();
            const hex = HEX.test(v) ? expandHex(v.toLowerCase()) : DEFAULT_ACCENT;
            const l = luminance(hex);
            const onWhite = 1.05 / (l + 0.05);
            const onBlack = (l + 0.05) / 0.05;
            button.style.backgroundColor = hex;
            button.style.color = onBlack >= onWhite ? '#000000' : '#ffffff';
        }
    }

    function renderRevision() {
        const el = $('cb-revision');
        if (!el) return;
        const ms = Number(state.revision);
        if (Number.isFinite(ms) && ms > 1e12) {
            el.textContent = t('client_branding.last_saved', { date: Utils.formatDate(new Date(ms)) });
        } else {
            el.textContent = t('client_branding.never_saved');
        }
    }

    function fillForm(data) {
        data = data || {};
        $('cb-company').value = data.company_name || '';
        $('cb-phone').value = data.phone || '';
        $('cb-email').value = data.email || '';
        $('cb-website').value = data.website || '';
        $('cb-support').value = data.support_contact || '';
        $('cb-accent').value = data.accent_color || DEFAULT_ACCENT;
        const file = $('cb-logo-file');
        if (file) file.value = '';
        state.revision = data.revision || '';
        state.clearLogo = false;
        state.logo = data.logo || null;
        syncAccentInputs(false);
        renderLogo();
        renderRevision();
        renderPreview();
    }

    function readFileAsLogo(file) {
        return new Promise((resolve, reject) => {
            if (!file) return resolve(null);
            if (file.size <= 0 || file.size > MAX_LOGO) {
                return reject(new Error(t('client_branding.logo_too_large')));
            }
            const mime = (file.type || '').toLowerCase();
            if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(mime)) {
                return reject(new Error(t('client_branding.logo_invalid')));
            }
            const reader = new FileReader();
            reader.onload = () => {
                const result = String(reader.result || '');
                const comma = result.indexOf(',');
                const dataBase64 = comma >= 0 ? result.slice(comma + 1) : result;
                resolve({ mime: mime === 'image/jpg' ? 'image/jpeg' : mime, data_base64: dataBase64 });
            };
            reader.onerror = () => reject(new Error(t('client_branding.logo_invalid')));
            reader.readAsDataURL(file);
        });
    }

    async function load() {
        const result = await api('GET', '/api/client-branding');
        fillForm(result.data || {});
        if (window.UiForm) UiForm.reset(form());
    }

    async function save() {
        const accent = ($('cb-accent')?.value || '').trim();
        if (!HEX.test(accent)) {
            throw new Error(t('client_branding.accent_invalid'));
        }
        const payload = {
            company_name: ($('cb-company')?.value || '').trim(),
            phone: ($('cb-phone')?.value || '').trim(),
            email: ($('cb-email')?.value || '').trim(),
            website: ($('cb-website')?.value || '').trim(),
            support_contact: ($('cb-support')?.value || '').trim(),
            accent_color: accent,
        };
        if (state.clearLogo) payload.clear_logo = true;
        else if (state.logo && (state.logo.data_base64 || state.logo.url)) {
            payload.logo = state.logo;
        }
        const result = await api('POST', '/api/client-branding', payload);
        const branding = (result.data && result.data.branding) || result.data || {};
        if (result.revision) branding.revision = result.revision;
        if (result.data && result.data.revision) branding.revision = result.data.revision;
        fillForm(branding);
    }

    function bind() {
        form()?.addEventListener('input', renderPreview);
        $('cb-accent')?.addEventListener('input', () => syncAccentInputs(false));
        $('cb-accent-picker')?.addEventListener('input', () => syncAccentInputs(true));
        $('cb-logo-file')?.addEventListener('change', async (ev) => {
            const file = ev.target.files && ev.target.files[0];
            try {
                const logo = await readFileAsLogo(file);
                if (logo) {
                    state.logo = logo;
                    state.clearLogo = false;
                    renderLogo();
                }
            } catch (err) {
                ev.target.value = '';
                if (window.UiForm) UiForm.failed(form(), err.message);
            }
        });
        $('cb-clear-logo')?.addEventListener('click', () => {
            state.logo = null;
            state.clearLogo = true;
            const input = $('cb-logo-file');
            if (input) input.value = '';
            renderLogo();
            if (window.UiForm) UiForm.markDirty(form());
        });
        form()?.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const button = $('cb-save');
            if (button) button.disabled = true;
            try {
                await save();
                if (window.UiForm) UiForm.saved(form(), t('client_branding.saved'));
            } catch (err) {
                const msg = `${t('client_branding.save_failed')} ${err.message || ''}`.trim();
                if (window.UiForm) UiForm.failed(form(), msg);
            } finally {
                if (button) button.disabled = false;
            }
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        bind();
        try {
            await load();
        } catch (err) {
            const box = $('cb-load-error');
            if (box) {
                box.textContent = `${t('client_branding.load_failed')} ${err.message || ''}`.trim();
                const retry = document.createElement('button');
                retry.type = 'button';
                retry.className = 'btn btn-sm';
                retry.textContent = t('actions.retry');
                retry.addEventListener('click', () => window.location.reload());
                box.appendChild(retry);
                box.hidden = false;
            }
            renderLogo();
        }
    });
})();
