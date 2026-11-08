/**
 * BetterDesk Console - Accessibility Preferences
 */

(function() {
    'use strict';

    const STORAGE_KEY = 'betterdesk_accessibility_v1';
    const DEFAULTS = Object.freeze({
        fontScale: 100,
        lineHeight: 1.5,
        letterSpacing: 0,
        wordSpacing: 0,
        saturation: 100,
        contrast: 'normal',
        colorFilter: 'none',
        activeProfile: '',
        readableFont: false,
        dyslexiaFont: false,
        underlineLinks: false,
        highlightLinks: false,
        highlightHeadings: false,
        strongFocus: false,
        largeCursor: false,
        reduceMotion: false,
        pauseAnimations: false,
        readingGuide: false,
        readingMask: false,
        hideMedia: false
    });

    const SELECT_VALUES = {
        contrast: ['normal', 'high-dark', 'high-light', 'yellow-black'],
        colorFilter: ['none', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']
    };

    let settings = loadSettings();
    let modalEl = null;
    let lastFocusedEl = null;
    let readingUiReady = false;
    let currentPointerY = Math.round(window.innerHeight / 2);

    function tr(key, fallback) {
        const value = typeof window._ === 'function' ? window._(`accessibility.${key}`) : `accessibility.${key}`;
        return value === `accessibility.${key}` ? fallback : value;
    }

    function esc(value) {
        return window.Utils?.escapeHtml ? Utils.escapeHtml(String(value)) : String(value);
    }

    function clampNumber(value, min, max, fallback) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return fallback;
        return Math.min(max, Math.max(min, numeric));
    }

    function sanitize(candidate) {
        const source = candidate && typeof candidate === 'object' ? candidate : {};
        const clean = { ...DEFAULTS };

        clean.fontScale = clampNumber(source.fontScale, 90, 160, DEFAULTS.fontScale);
        clean.lineHeight = clampNumber(source.lineHeight, 1.2, 2.1, DEFAULTS.lineHeight);
        clean.letterSpacing = clampNumber(source.letterSpacing, 0, 0.14, DEFAULTS.letterSpacing);
        clean.wordSpacing = clampNumber(source.wordSpacing, 0, 0.22, DEFAULTS.wordSpacing);
        clean.saturation = clampNumber(source.saturation, 0, 180, DEFAULTS.saturation);

        clean.contrast = SELECT_VALUES.contrast.includes(source.contrast) ? source.contrast : DEFAULTS.contrast;
        clean.colorFilter = SELECT_VALUES.colorFilter.includes(source.colorFilter) ? source.colorFilter : DEFAULTS.colorFilter;
        clean.activeProfile = ['lowVision', 'dyslexia', 'motionSafe', 'colorAssist'].includes(source.activeProfile) ? source.activeProfile : DEFAULTS.activeProfile;

        Object.keys(DEFAULTS).forEach(key => {
            if (typeof DEFAULTS[key] === 'boolean') clean[key] = source[key] === true;
        });

        return clean;
    }

    function loadSettings() {
        try {
            return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
        } catch (_) {
            return { ...DEFAULTS };
        }
    }

    function saveSettings(nextSettings) {
        settings = sanitize(nextSettings);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (_) { /* localStorage may be disabled */ }
        applySettings(settings);
        syncButtonState();
        return settings;
    }

    function resetSettings() {
        settings = { ...DEFAULTS };
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        applySettings(settings);
        syncButtonState();
        if (modalEl) syncModalControls();
    }

    function isDefault(current) {
        return Object.keys(DEFAULTS).every(key => current[key] === DEFAULTS[key]);
    }

    function applySettings(current) {
        const root = document.documentElement;

        root.style.setProperty('--bd-a11y-font-scale', String(current.fontScale / 100));
        root.style.setProperty('--bd-a11y-line-height', String(current.lineHeight));
        root.style.setProperty('--bd-a11y-letter-spacing', `${current.letterSpacing}em`);
        root.style.setProperty('--bd-a11y-word-spacing', `${current.wordSpacing}em`);

        root.dataset.a11yActive = isDefault(current) ? 'false' : 'true';
        root.dataset.a11yFontScaled = current.fontScale !== DEFAULTS.fontScale ? 'true' : 'false';
        root.dataset.a11yContrast = current.contrast;
        root.dataset.a11yReadableFont = String(current.readableFont);
        root.dataset.a11yDyslexia = String(current.dyslexiaFont);
        root.dataset.a11yUnderlineLinks = String(current.underlineLinks);
        root.dataset.a11yHighlightLinks = String(current.highlightLinks);
        root.dataset.a11yHighlightHeadings = String(current.highlightHeadings);
        root.dataset.a11yStrongFocus = String(current.strongFocus);
        root.dataset.a11yLargeCursor = String(current.largeCursor);
        root.dataset.a11yReduceMotion = String(current.reduceMotion);
        root.dataset.a11yPauseAnimations = String(current.pauseAnimations);
        root.dataset.a11yReadingGuide = String(current.readingGuide);
        root.dataset.a11yReadingMask = String(current.readingMask);
        root.dataset.a11yHideMedia = String(current.hideMedia);

        const filters = [];
        if (current.colorFilter !== 'none') filters.push(`url(#bd-a11y-${current.colorFilter})`);
        if (current.saturation !== 100) filters.push(`saturate(${current.saturation}%)`);
        root.dataset.a11yFiltered = filters.length > 0 ? 'true' : 'false';
        root.style.setProperty('--bd-a11y-visual-filter', filters.length > 0 ? filters.join(' ') : 'none');

        ensureFilterDefs();
        ensureReadingUi();
        updateReadingUi(currentPointerY);
    }

    function syncButtonState() {
        const btn = document.getElementById('accessibility-btn');
        if (!btn) return;
        const active = !isDefault(settings);
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
    }

    function ensureFilterDefs() {
        if (document.getElementById('bd-a11y-filter-defs')) return;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <svg id="bd-a11y-filter-defs" class="bd-a11y-filter-defs" aria-hidden="true" focusable="false">
                <filter id="bd-a11y-protanopia" color-interpolation-filters="sRGB">
                    <feColorMatrix type="matrix" values="0.567 0.433 0 0 0 0.558 0.442 0 0 0 0 0.242 0.758 0 0 0 0 0 1 0" />
                </filter>
                <filter id="bd-a11y-deuteranopia" color-interpolation-filters="sRGB">
                    <feColorMatrix type="matrix" values="0.625 0.375 0 0 0 0.7 0.3 0 0 0 0 0.3 0.7 0 0 0 0 0 1 0" />
                </filter>
                <filter id="bd-a11y-tritanopia" color-interpolation-filters="sRGB">
                    <feColorMatrix type="matrix" values="0.95 0.05 0 0 0 0 0.433 0.567 0 0 0 0.475 0.525 0 0 0 0 0 1 0" />
                </filter>
                <filter id="bd-a11y-achromatopsia" color-interpolation-filters="sRGB">
                    <feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0" />
                </filter>
            </svg>
        `;
        document.body.appendChild(wrapper.firstElementChild);
    }

    function ensureReadingUi() {
        if (readingUiReady) return;
        const guide = document.createElement('div');
        const maskTop = document.createElement('div');
        const maskBottom = document.createElement('div');
        guide.className = 'bd-a11y-reading-guide';
        maskTop.className = 'bd-a11y-reading-mask-top';
        maskBottom.className = 'bd-a11y-reading-mask-bottom';
        document.body.append(guide, maskTop, maskBottom);

        document.addEventListener('pointermove', event => {
            currentPointerY = event.clientY;
            updateReadingUi(currentPointerY);
        }, { passive: true });

        window.addEventListener('resize', () => updateReadingUi(currentPointerY), { passive: true });
        readingUiReady = true;
    }

    function updateReadingUi(y) {
        const guide = document.querySelector('.bd-a11y-reading-guide');
        const maskTop = document.querySelector('.bd-a11y-reading-mask-top');
        const maskBottom = document.querySelector('.bd-a11y-reading-mask-bottom');
        if (!guide || !maskTop || !maskBottom) return;

        const focusHeight = 150;
        const top = Math.max(0, y - focusHeight / 2);
        const bottom = Math.min(window.innerHeight, y + focusHeight / 2);

        guide.style.top = `${Math.max(0, y - 2)}px`;
        maskTop.style.top = '0';
        maskTop.style.height = `${top}px`;
        maskBottom.style.top = `${bottom}px`;
        maskBottom.style.height = `${Math.max(0, window.innerHeight - bottom)}px`;
    }

    // ── Panel: a side sheet dialog, built on open and removed on close ──

    function uiLang() {
        return document.documentElement.lang || window.BetterDesk?.lang || 'en';
    }

    function formatNumber(value, options) {
        try {
            return new Intl.NumberFormat(uiLang(), options).format(value);
        } catch (_) {
            return String(value);
        }
    }

    // Values in plain units: "100 %", "1.5", "Normal" or "+0.05 em"
    function formatValue(key, value) {
        const numeric = Number(value);
        if (key === 'fontScale' || key === 'saturation') {
            return formatNumber(numeric / 100, { style: 'percent', maximumFractionDigits: 0 });
        }
        if (key === 'lineHeight') return formatNumber(numeric, { maximumFractionDigits: 2 });
        if (numeric === 0) return tr('spacing_normal', 'Normal');
        return `+${formatNumber(numeric, { maximumFractionDigits: 3 })} em`;
    }

    function rangeField(key, label, min, max, step) {
        const id = `bd-a11y-${key}`;
        const text = formatValue(key, settings[key]);
        return `
            <div class="a11y-range">
                <label class="a11y-label" for="${id}">${esc(label)}</label>
                <output class="a11y-value" for="${id}" data-a11y-output="${key}">${esc(text)}</output>
                <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${esc(settings[key])}" aria-valuetext="${esc(text)}" data-a11y-field="${key}">
            </div>
        `;
    }

    function selectField(key, label, options) {
        const id = `bd-a11y-${key}`;
        return `
            <div class="a11y-field">
                <label class="a11y-label" for="${id}">${esc(label)}</label>
                <select class="a11y-select" id="${id}" data-a11y-field="${key}">
                    ${options.map(opt => `<option value="${esc(opt.value)}"${settings[key] === opt.value ? ' selected' : ''}>${esc(opt.label)}</option>`).join('')}
                </select>
            </div>
        `;
    }

    function checkField(key, label, hint) {
        const id = `bd-a11y-${key}`;
        return `
            <label class="a11y-check" for="${id}">
                <input id="${id}" type="checkbox" data-a11y-toggle="${key}"${settings[key] ? ' checked' : ''} aria-labelledby="${id}-label" aria-describedby="${id}-hint">
                <span class="a11y-check-label" id="${id}-label">${esc(label)}</span>
                <span class="a11y-hint" id="${id}-hint">${esc(hint)}</span>
            </label>
        `;
    }

    function profileButton(profile, label, hint) {
        return `
            <li>
                <button type="button" class="a11y-profile" data-a11y-profile="${profile}" aria-pressed="${settings.activeProfile === profile ? 'true' : 'false'}">
                    <span class="a11y-profile-mark" aria-hidden="true"></span>
                    <span class="a11y-profile-title">${esc(label)}</span>
                    <span class="a11y-hint">${esc(hint)}</span>
                </button>
            </li>
        `;
    }

    function section(id, title, inner) {
        return `
            <section class="a11y-section" aria-labelledby="bd-a11y-h-${id}">
                <h3 id="bd-a11y-h-${id}">${esc(title)}</h3>
                ${inner}
            </section>
        `;
    }

    function buildPanelHtml() {
        const closeLabel = tr('close', 'Close accessibility settings');
        return `
            <div class="sheet a11y-sheet bd-a11y-modal" role="dialog" aria-modal="true" aria-labelledby="bd-a11y-title" aria-describedby="bd-a11y-desc" tabindex="-1">
                <div class="sheet-header a11y-sheet-head">
                    <div class="sheet-titles a11y-sheet-titles">
                        <h2 class="sheet-title" id="bd-a11y-title">${esc(tr('title', 'Accessibility'))}</h2>
                        <p class="sheet-subtitle" id="bd-a11y-desc">${esc(tr('subtitle', 'Changes to text, color and motion apply right away and are saved in this browser.'))}</p>
                    </div>
                    <button type="button" class="a11y-close bd-a11y-close" data-a11y-close aria-label="${esc(closeLabel)}" title="${esc(closeLabel)}">
                        <span class="material-icons" aria-hidden="true">close</span>
                    </button>
                </div>
                <div class="sheet-body a11y-sheet-body">
                    ${section('profiles', tr('profiles', 'Quick profiles'), `
                        <p class="a11y-note">${esc(tr('profiles_note', 'Each profile changes several settings below at once. Choose it again to go back to the defaults.'))}</p>
                        <ul class="a11y-profiles">
                            ${profileButton('lowVision', tr('profile_low_vision', 'Low vision'), tr('profile_low_vision_hint', 'Larger text, high contrast, a strong focus ring and a large pointer.'))}
                            ${profileButton('dyslexia', tr('profile_dyslexia', 'Reading comfort'), tr('profile_dyslexia_hint', 'Readable font, larger text and wider spacing.'))}
                            ${profileButton('motionSafe', tr('profile_motion_safe', 'Less motion'), tr('profile_motion_safe_hint', 'Stops animations and adds a reading guide and a strong focus ring.'))}
                            ${profileButton('colorAssist', tr('profile_color_assist', 'Color support'), tr('profile_color_assist_hint', 'Color filter, stronger colors, underlined links and marked headings.'))}
                        </ul>
                    `)}
                    ${section('reading', tr('reading', 'Reading'), `
                        <div class="a11y-ranges">
                            ${rangeField('fontScale', tr('font_size', 'Font size'), 90, 160, 5)}
                            ${rangeField('lineHeight', tr('line_height', 'Line height'), 1.2, 2.1, 0.05)}
                            ${rangeField('letterSpacing', tr('letter_spacing', 'Letter spacing'), 0, 0.14, 0.005)}
                            ${rangeField('wordSpacing', tr('word_spacing', 'Word spacing'), 0, 0.22, 0.01)}
                        </div>
                        <div class="a11y-checks">
                            ${checkField('readableFont', tr('readable_font', 'Readable font'), tr('readable_font_hint', 'Uses a wide, plain font such as Verdana.'))}
                            ${checkField('dyslexiaFont', tr('dyslexia_spacing', 'Dyslexia spacing'), tr('dyslexia_spacing_hint', 'Adds space between letters and words.'))}
                        </div>
                    `)}
                    ${section('visual', tr('visual', 'Visual'), `
                        ${selectField('contrast', tr('contrast', 'Contrast'), [
                            { value: 'normal', label: tr('contrast_normal', 'Normal') },
                            { value: 'high-dark', label: tr('contrast_high_dark', 'High contrast dark') },
                            { value: 'high-light', label: tr('contrast_high_light', 'High contrast light') },
                            { value: 'yellow-black', label: tr('contrast_yellow_black', 'Yellow on black') }
                        ])}
                        ${selectField('colorFilter', tr('color_filter', 'Color vision filter'), [
                            { value: 'none', label: tr('filter_none', 'None') },
                            { value: 'protanopia', label: tr('filter_protanopia', 'Protanopia (red-blind)') },
                            { value: 'deuteranopia', label: tr('filter_deuteranopia', 'Deuteranopia (green-blind)') },
                            { value: 'tritanopia', label: tr('filter_tritanopia', 'Tritanopia (blue-blind)') },
                            { value: 'achromatopsia', label: tr('filter_achromatopsia', 'Grayscale') }
                        ])}
                        <div class="a11y-ranges">
                            ${rangeField('saturation', tr('saturation', 'Color saturation'), 0, 180, 5)}
                        </div>
                        <div class="a11y-checks">
                            ${checkField('underlineLinks', tr('underline_links', 'Underline links'), tr('underline_links_hint', 'Makes links visible without relying on color.'))}
                            ${checkField('highlightLinks', tr('highlight_links', 'Highlight actions'), tr('highlight_links_hint', 'Outlines links and buttons.'))}
                            ${checkField('highlightHeadings', tr('highlight_headings', 'Highlight headings'), tr('highlight_headings_hint', 'Marks section titles with a color bar.'))}
                            ${checkField('hideMedia', tr('hide_media', 'Dim media'), tr('hide_media_hint', 'Fades out images, videos and charts.'))}
                        </div>
                    `)}
                    ${section('interaction', tr('interaction', 'Interaction'), `
                        <div class="a11y-checks">
                            ${checkField('strongFocus', tr('strong_focus', 'Strong focus'), tr('strong_focus_hint', 'Shows a large keyboard focus ring.'))}
                            ${checkField('largeCursor', tr('large_cursor', 'Large cursor'), tr('large_cursor_hint', 'Uses a larger high-contrast pointer.'))}
                            ${checkField('reduceMotion', tr('reduce_motion', 'Reduce motion'), tr('reduce_motion_hint', 'Turns off transitions and smooth scrolling.'))}
                            ${checkField('pauseAnimations', tr('pause_animations', 'Pause animations'), tr('pause_animations_hint', 'Freezes animations such as loading spinners.'))}
                            ${checkField('readingGuide', tr('reading_guide', 'Reading guide'), tr('reading_guide_hint', 'A line follows the pointer to help you keep your place.'))}
                            ${checkField('readingMask', tr('reading_mask', 'Reading mask'), tr('reading_mask_hint', 'Dims content above and below the pointer.'))}
                        </div>
                    `)}
                </div>
                <div class="sheet-footer a11y-sheet-foot">
                    <button type="button" class="btn a11y-btn sheet-footer-start" data-a11y-reset>${esc(tr('reset_defaults', 'Reset to defaults'))}</button>
                    <button type="button" class="btn btn-primary a11y-btn a11y-btn-primary" data-a11y-close>${esc(tr('done', 'Done'))}</button>
                </div>
            </div>
        `;
    }

    function openModal() {
        if (modalEl) return;
        lastFocusedEl = document.activeElement;

        // The layer hangs off <body>, outside the shell, so no stacking
        // context in the page (sticky headers, the top bar) can cover it.
        modalEl = document.createElement('div');
        modalEl.className = 'sheet-layer a11y-layer';
        modalEl.innerHTML = `<div class="a11y-backdrop" data-a11y-close></div>${buildPanelHtml()}`;
        document.body.appendChild(modalEl);
        // Shown on the next frame, so the sheet slides in like the others (.sheet in components.css)
        const layer = modalEl;
        requestAnimationFrame(() => layer.classList.add('open'));
        document.body.classList.add('bd-a11y-modal-open');
        const app = document.getElementById('app');
        if (app && !app.inert) {
            app.inert = true;
            app.dataset.a11yInert = 'true';
        }

        modalEl.addEventListener('keydown', handleModalKeydown);
        modalEl.addEventListener('input', handleModalInput);
        modalEl.addEventListener('change', handleModalInput);
        modalEl.addEventListener('click', handleModalAction);
        document.addEventListener('focusin', keepFocusInside);

        const btn = document.getElementById('accessibility-btn');
        if (btn) btn.setAttribute('aria-expanded', 'true');

        modalEl.querySelector('[role="dialog"]').focus();
    }

    function closeModal() {
        if (!modalEl) return;
        document.removeEventListener('focusin', keepFocusInside);
        modalEl.remove();
        modalEl = null;
        document.body.classList.remove('bd-a11y-modal-open');
        const app = document.getElementById('app');
        if (app && app.dataset.a11yInert === 'true') {
            app.inert = false;
            delete app.dataset.a11yInert;
        }
        const btn = document.getElementById('accessibility-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
        // Back to the opener; on phones it sits in the folded top bar menu, which may have closed
        let target = lastFocusedEl && lastFocusedEl.isConnected && typeof lastFocusedEl.focus === 'function' ? lastFocusedEl : btn;
        if (target && target.getClientRects().length === 0) target = document.getElementById('ux35-actions-menu-btn') || target;
        if (target) target.focus();
    }

    function focusableInPanel() {
        return [...modalEl.querySelectorAll('button, select, input, a[href], [tabindex]:not([tabindex="-1"])')]
            .filter(el => !el.disabled && el.getClientRects().length > 0 && !el.classList.contains('a11y-backdrop'));
    }

    function keepFocusInside(event) {
        if (!modalEl || modalEl.contains(event.target)) return;
        const first = focusableInPanel()[0];
        if (first) first.focus();
    }

    function handleModalKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeModal();
            return;
        }
        if (event.key !== 'Tab') return;

        const focusable = focusableInPanel();
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const dialog = modalEl.querySelector('[role="dialog"]');
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function handleModalInput(event) {
        const toggle = event.target.closest('[data-a11y-toggle]');
        if (toggle) {
            if (event.type !== 'change') return;
            const key = toggle.dataset.a11yToggle;
            saveSettings({ ...settings, activeProfile: '', [key]: toggle.checked });
            syncModalControls();
            return;
        }
        const field = event.target.closest('[data-a11y-field]');
        if (!field) return;
        const key = field.dataset.a11yField;
        const value = field.type === 'range' ? Number(field.value) : field.value;
        saveSettings({ ...settings, activeProfile: '', [key]: value });
        updateOutput(key);
        syncProfiles();
    }

    function handleModalAction(event) {
        const profile = event.target.closest('[data-a11y-profile]');
        if (profile) {
            applyProfile(profile.dataset.a11yProfile);
            return;
        }

        if (event.target.closest('[data-a11y-reset]')) {
            resetSettings();
            return;
        }

        if (event.target.closest('[data-a11y-close]')) closeModal();
    }

    function updateOutput(key) {
        if (!modalEl) return;
        const text = formatValue(key, settings[key]);
        const output = modalEl.querySelector(`[data-a11y-output="${key}"]`);
        if (output) output.textContent = text;
        const field = modalEl.querySelector(`input[type="range"][data-a11y-field="${key}"]`);
        if (field) field.setAttribute('aria-valuetext', text);
    }

    function syncProfiles() {
        if (!modalEl) return;
        modalEl.querySelectorAll('[data-a11y-profile]').forEach(profile => {
            profile.setAttribute('aria-pressed', String(settings.activeProfile === profile.dataset.a11yProfile));
        });
    }

    function syncModalControls() {
        if (!modalEl) return;
        modalEl.querySelectorAll('[data-a11y-field]').forEach(field => {
            const key = field.dataset.a11yField;
            field.value = settings[key];
            updateOutput(key);
        });
        modalEl.querySelectorAll('[data-a11y-toggle]').forEach(toggle => {
            toggle.checked = settings[toggle.dataset.a11yToggle] === true;
        });
        syncProfiles();
    }

    function applyProfile(profile) {
        if (settings.activeProfile === profile) {
            resetSettings();
            return;
        }

        const next = { ...settings };
        next.activeProfile = profile;
        if (profile === 'lowVision') {
            Object.assign(next, {
                fontScale: 130,
                lineHeight: 1.75,
                contrast: 'high-dark',
                underlineLinks: true,
                highlightLinks: true,
                strongFocus: true,
                largeCursor: true
            });
        } else if (profile === 'dyslexia') {
            Object.assign(next, {
                fontScale: 112,
                lineHeight: 1.85,
                letterSpacing: 0.045,
                wordSpacing: 0.09,
                readableFont: true,
                dyslexiaFont: true,
                underlineLinks: true
            });
        } else if (profile === 'motionSafe') {
            Object.assign(next, {
                reduceMotion: true,
                pauseAnimations: true,
                readingGuide: true,
                strongFocus: true
            });
        } else if (profile === 'colorAssist') {
            Object.assign(next, {
                colorFilter: 'deuteranopia',
                saturation: 125,
                underlineLinks: true,
                highlightLinks: true,
                highlightHeadings: true
            });
        }
        saveSettings(next);
        syncModalControls();
    }

    function init() {
        applySettings(settings);
        syncButtonState();
        const button = document.getElementById('accessibility-btn');
        if (button) {
            button.setAttribute('aria-expanded', 'false');
            button.addEventListener('click', openModal);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.AccessibilityPreferences = {
        open: openModal,
        apply: saveSettings,
        reset: resetSettings,
        get: () => ({ ...settings })
    };
})();