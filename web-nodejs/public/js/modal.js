/**
 * BetterDesk Console - Modal Dialog System
 *
 * Two kinds, one API (the rule for which to use is in GUIDE.md "Dialogs and sheets"):
 *   Modal.show({ title, content, buttons })                    centred dialog (.modal)
 *   Modal.show({ variant: 'sheet', title, subtitle, content,   side sheet (.sheet): from the
 *                buttons, wide, status: true })                end side, full height, full
 *   Modal.sheet({ ... })                                      screen on phones
 * A dialog opened while a sheet is open sits on top of it; Modal.close()
 * closes the top one. Any other new dialog or sheet replaces the open one.
 */

const Modal = (function() {
    'use strict';

    let container = null;
    // Open dialogs and sheets, the top one last
    const stack = [];

    function getContainer() {
        if (!container) {
            container = document.getElementById('modal-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'modal-container';
                document.body.appendChild(container);
            }
        }
        return container;
    }

    function top() {
        return stack[stack.length - 1] || null;
    }

    /**
     * Show a modal dialog or a side sheet
     * @param {Object} options
     * @param {string} options.title - Title
     * @param {string} options.content - Body HTML content
     * @param {Array} options.buttons - Array of button configs [{ label, class, onClick, icon, id, start }];
     *   icon is a Utils.ICONS meaning (or a Material Symbols name) drawn before the label, which is always escaped;
     *   start: true puts the button on the start side of the footer (Cancel in a sheet, a destructive action in a dialog)
     * @param {boolean} options.closable - Whether the modal can be closed (default: true)
     * @param {string} options.size - 'small', 'medium', 'large' (default: 'medium'); dialogs only
     * @param {string} options.variant - 'dialog' (default) or 'sheet'
     * @param {string} options.subtitle - Sheets: one sentence under the title
     * @param {boolean} options.wide - Sheets: 720px instead of 560px (editors, tables)
     * @param {boolean} options.status - Sheets: a status line above the footer buttons, set with Modal.setStatus()
     * @param {string} options.className - Extra class on the dialog or sheet element
     * @param {Function} options.onOpen - Callback when modal opens
     * @param {Function} options.onClose - Callback when modal closes
     * @returns {string} the id of the layer element
     */
    function show(options) {
        const {
            title = '',
            content = '',
            buttons = [],
            closable = true,
            size = 'medium',
            variant = 'dialog',
            subtitle = '',
            wide = false,
            status = false,
            className = '',
            onOpen = null,
            onClose = null
        } = options;
        const isSheet = variant === 'sheet';

        // A dialog stacks on an open sheet; anything else replaces what is open
        while (top() && !(!isSheet && top().variant === 'sheet')) {
            close();
        }

        const container = getContainer();
        const id = Utils.generateId();

        const sizeStyles = {
            small: 'max-width: 350px;',
            medium: 'max-width: 500px;',
            large: 'max-width: 700px;'
        };

        const opener = document.activeElement;
        const overlay = document.createElement('div');
        overlay.id = id;
        overlay.className = isSheet ? 'modal-overlay sheet-layer' : 'modal-overlay';
        const closeLabel = (typeof _ === 'function' && _('actions.close')) || 'Close';
        const closeButton = closable ? `
                        <button type="button" class="modal-close" aria-label="${Utils.escapeHtml(closeLabel)}">
                            <span class="material-icons" aria-hidden="true">close</span>
                        </button>` : '';
        const buttonsHtml = buttons.map((btn, idx) => `
                            <button type="button" class="btn ${btn.class || 'btn-secondary'}${btn.start ? ' modal-footer-start' : ''}" data-btn-index="${idx}"${btn.id ? ` id="${Utils.escapeHtml(btn.id)}"` : ''}>${btn.icon ? Utils.icon(btn.icon) : ''}${Utils.escapeHtml(btn.label)}</button>
                        `).join('');
        const extraClass = className ? ' ' + Utils.escapeHtml(className) : '';

        if (isSheet) {
            overlay.innerHTML = `
            <div class="sheet${wide || size === 'wide' ? ' is-wide' : ''}${extraClass}" role="dialog" aria-modal="true" aria-labelledby="${id}-title"${subtitle ? ` aria-describedby="${id}-desc"` : ''} tabindex="-1">
                <div class="sheet-header">
                    <div class="sheet-titles">
                        <h2 class="sheet-title modal-title" id="${id}-title">${Utils.escapeHtml(title)}</h2>
                        ${subtitle ? `<p class="sheet-subtitle" id="${id}-desc">${Utils.escapeHtml(subtitle)}</p>` : ''}
                    </div>${closeButton}
                </div>
                <div class="sheet-body modal-body">
                    ${content}
                </div>
                ${buttons.length > 0 || status ? `
                    <div class="sheet-footer modal-footer">
                        ${status ? '<p class="form-status sheet-status" role="status" aria-live="polite" data-modal-status></p>' : ''}
                        ${buttonsHtml}
                    </div>
                ` : ''}
            </div>
        `;
        } else {
            overlay.innerHTML = `
            <div class="modal${extraClass}" role="dialog" aria-modal="true" aria-labelledby="${id}-title" style="${sizeStyles[size] || sizeStyles.medium}">
                <div class="modal-header">
                    <h2 class="modal-title" id="${id}-title">${Utils.escapeHtml(title)}</h2>${closeButton}
                </div>
                <div class="modal-body">
                    ${content}
                </div>
                ${buttons.length > 0 ? `
                    <div class="modal-footer">
                        ${buttonsHtml}
                    </div>
                ` : ''}
            </div>
        `;
        }
        const dialog = overlay.querySelector('[role="dialog"]');

        // Event handlers
        if (closable) {
            overlay.querySelector('.modal-close').addEventListener('click', () => {
                close(id);
                if (onClose) onClose();
            });

            // Close on overlay click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    close(id);
                    if (onClose) onClose();
                }
            });
        }

        // Button handlers
        buttons.forEach((btn, idx) => {
            const btnEl = overlay.querySelector(`[data-btn-index="${idx}"]`);
            if (btnEl && btn.onClick) {
                btnEl.addEventListener('click', () => btn.onClick());
            }
        });

        container.appendChild(overlay);

        // Trigger animation
        requestAnimationFrame(() => {
            overlay.classList.add('open');

            // Call onOpen callback after animation frame
            if (onOpen) {
                // Skip if the dialog was closed again within those 50 ms
                setTimeout(() => {
                    if (stack.some(entry => entry.id === id)) onOpen();
                }, 50);
            }
        });

        // Focus the first field (or the first button) and keep Tab inside the dialog
        const focusables = () => Array.from(dialog.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetParent !== null || el === document.activeElement);
        const firstField = dialog.querySelector('.modal-body input:not([type="hidden"]):not([disabled]), .modal-body select, .modal-body textarea');
        const initial = firstField || dialog.querySelector('.modal-footer .btn') || focusables()[0];
        if (initial) initial.focus();
        dialog.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const list = focusables();
            if (!list.length) return;
            const first = list[0];
            const last = list[list.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        });

        // Escape closes the top dialog or sheet only
        const entry = { id, onClose, opener, variant: isSheet ? 'sheet' : 'dialog' };
        entry.escHandler = (e) => {
            if (e.key === 'Escape' && closable && top() === entry) {
                e.stopPropagation();
                close(id);
                if (onClose) onClose();
            }
        };
        document.addEventListener('keydown', entry.escHandler);

        stack.push(entry);

        return id;
    }

    /**
     * Open a side sheet: Modal.show with variant 'sheet'
     */
    function sheet(options) {
        return show({ ...options, variant: 'sheet' });
    }

    /**
     * Close the top dialog or sheet (or the one with this id)
     */
    function close(id) {
        let index = stack.length - 1;
        if (typeof id === 'string') {
            index = stack.findIndex(entry => entry.id === id);
        }
        if (index < 0) return;
        // Closing a sheet also closes (and answers) a dialog that sits on it
        while (stack.length - 1 > index) {
            const above = top();
            close();
            if (above.onClose) above.onClose();
        }
        const entry = stack.pop();

        const overlay = document.getElementById(entry.id);
        if (overlay) {
            overlay.classList.remove('open');
            overlay.setAttribute('aria-hidden', 'true');
            setTimeout(() => overlay.remove(), 200);
        }

        document.removeEventListener('keydown', entry.escHandler);
        // Return focus to whatever opened the dialog
        const opener = entry.opener;
        if (opener && document.contains(opener) && typeof opener.focus === 'function'
            && (overlay ? !overlay.contains(opener) : true)) {
            opener.focus({ preventScroll: true });
        }
    }

    /**
     * Status line of the top sheet (opened with status: true): what the last
     * action did. tone: '' (neutral, e.g. "Testing…"), 'ok' or 'error'.
     */
    function setStatus(message, tone) {
        const entry = top();
        const overlay = entry && document.getElementById(entry.id);
        const el = overlay && overlay.querySelector('[data-modal-status]');
        if (!el) return;
        el.classList.toggle('is-ok', tone === 'ok');
        el.classList.toggle('is-error', tone === 'error');
        el.textContent = message || '';
    }

    /**
     * Confirm dialog shorthand
     */
    function confirm(options) {
        return new Promise((resolve) => {
            show({
                title: options.title || _('common.confirm'),
                content: `<p>${Utils.escapeHtml(options.message || '')}</p>`,
                buttons: [
                    {
                        label: options.cancelLabel || _('actions.cancel'),
                        class: 'btn-secondary',
                        onClick: () => {
                            close();
                            resolve(false);
                        }
                    },
                    {
                        label: options.confirmLabel || _('actions.confirm'),
                        class: options.danger ? 'btn-danger' : 'btn-primary',
                        icon: options.confirmIcon,
                        onClick: () => {
                            close();
                            resolve(true);
                        }
                    }
                ],
                closable: true,
                onClose: () => resolve(false)
            });
        });
    }

    /**
     * Alert dialog shorthand
     */
    function alert(options) {
        return new Promise((resolve) => {
            show({
                title: options.title || _('common.alert'),
                content: `<p>${Utils.escapeHtml(options.message || '')}</p>`,
                buttons: [
                    {
                        label: options.okLabel || _('actions.ok'),
                        class: 'btn-primary',
                        onClick: () => {
                            close();
                            resolve();
                        }
                    }
                ],
                closable: true,
                onClose: () => resolve()
            });
        });
    }

    /**
     * Prompt dialog shorthand
     */
    function prompt(options) {
        const inputId = Utils.generateId();

        return new Promise((resolve) => {
            show({
                title: options.title || _('common.prompt'),
                content: `
                    <div class="form-group">
                        ${options.label ? `<label class="form-label" for="${inputId}">${Utils.escapeHtml(options.label)}</label>` : ''}
                        <input type="${options.type || options.inputType || 'text'}" id="${inputId}" class="form-input"
                            value="${Utils.escapeHtml(options.value || '')}"
                            placeholder="${Utils.escapeHtml(options.placeholder || '')}">
                        ${options.hint ? `<p class="form-hint">${Utils.escapeHtml(options.hint)}</p>` : ''}
                    </div>
                `,
                buttons: [
                    {
                        label: options.cancelLabel || _('actions.cancel'),
                        class: 'btn-secondary',
                        onClick: () => {
                            close();
                            resolve(null);
                        }
                    },
                    {
                        label: options.confirmLabel || _('actions.confirm'),
                        class: 'btn-primary',
                        onClick: () => {
                            const input = document.getElementById(inputId);
                            close();
                            resolve(input ? input.value : null);
                        }
                    }
                ],
                closable: true,
                onClose: () => resolve(null)
            });

            // Focus input
            setTimeout(() => {
                const input = document.getElementById(inputId);
                if (input) input.focus();
            }, 100);
        });
    }

    return {
        show,
        open: show,
        sheet,
        close,
        setStatus,
        confirm,
        alert,
        prompt
    };
})();

// Export
window.Modal = Modal;
