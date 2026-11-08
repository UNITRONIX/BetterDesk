/**
 * Save bar for settings forms.
 *
 * Markup:
 *   <form data-save-form> ...fields...
 *     <div class="save-bar">
 *       <span class="save-status" data-save-status aria-live="polite"></span>
 *       <button type="submit" class="btn btn-primary" data-save-button>Save</button>
 *     </div>
 *   </form>
 *
 * The form's own script still does the saving. It tells this helper how it
 * went with UiForm.saved(form) or UiForm.failed(form, message). Until then
 * any change marks the form as having unsaved changes, and leaving the page
 * asks first.
 */
(function () {
    'use strict';

    const t = (key, fallback) => {
        if (typeof window._ === 'function') {
            const v = window._(key);
            if (v && v !== key) return v;
        }
        return fallback;
    };

    const forms = new Set();

    function parts(form) {
        return {
            bar: form.querySelector('.save-bar'),
            status: form.querySelector('[data-save-status]'),
        };
    }

    // Only a form with unsaved changes gets the primary save button, so a page
    // with several forms still shows one primary action at a time.
    function setPrimary(form, on) {
        // A page with one form keeps its save button primary
        if (document.querySelectorAll('[data-save-form]').length < 2) return;
        form.querySelectorAll('[data-save-button]').forEach((b) => {
            b.classList.toggle('btn-primary', on);
        });
    }

    function setStatus(form, text, kind) {
        const { bar, status } = parts(form);
        if (bar) bar.classList.toggle('is-dirty', kind === 'dirty');
        setPrimary(form, kind === 'dirty');
        if (!status) return;
        status.textContent = text || '';
        status.classList.toggle('is-ok', kind === 'ok');
        status.classList.toggle('is-error', kind === 'error');
    }

    function markDirty(form) {
        if (form.dataset.dirty === 'true') return;
        form.dataset.dirty = 'true';
        setStatus(form, t('ui_form.unsaved', 'Unsaved changes'), 'dirty');
    }

    function saved(form, message) {
        if (!form) return;
        form.dataset.dirty = 'false';
        setStatus(form, message || t('ui_form.saved', 'Saved'), 'ok');
    }

    function failed(form, message) {
        if (!form) return;
        setStatus(form, message || t('ui_form.save_failed', 'Could not save. Your changes are still here.'), 'error');
    }

    function reset(form) {
        if (!form) return;
        form.dataset.dirty = 'false';
        setStatus(form, '', '');
    }

    function attach(form) {
        if (forms.has(form)) return;
        forms.add(form);
        form.dataset.dirty = 'false';
        if (forms.size > 1 || document.querySelectorAll('[data-save-form]').length > 1) {
            document.querySelectorAll('[data-save-form]').forEach((f) => { if (f.dataset.dirty !== 'true') setPrimary(f, false); });
        }
        const onChange = (e) => {
            if (e.target && e.target.closest('[data-save-ignore]')) return;
            markDirty(form);
        };
        form.addEventListener('input', onChange);
        form.addEventListener('change', onChange);
    }

    function scan(root) {
        (root || document).querySelectorAll('[data-save-form]').forEach(attach);
    }

    window.addEventListener('beforeunload', (e) => {
        for (const f of forms) {
            if (f.dataset.dirty === 'true' && document.body.contains(f)) {
                e.preventDefault();
                e.returnValue = '';
                return '';
            }
        }
        return undefined;
    });

    window.UiForm = { scan, attach, saved, failed, reset, markDirty, isDirty: (f) => f && f.dataset.dirty === 'true' };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => scan());
    } else {
        scan();
    }
})();
