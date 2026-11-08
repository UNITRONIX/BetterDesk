/**
 * BetterDesk Console - Modal Dialog System
 */

const Modal = (function() {
    'use strict';
    
    let container = null;
    let activeModal = null;
    
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
    
    /**
     * Show a modal dialog
     * @param {Object} options
     * @param {string} options.title - Modal title
     * @param {string} options.content - Modal body HTML content
     * @param {Array} options.buttons - Array of button configs [{ label, class, onClick }]
     * @param {boolean} options.closable - Whether the modal can be closed (default: true)
     * @param {string} options.size - 'small', 'medium', 'large' (default: 'medium')
     * @param {Function} options.onOpen - Callback when modal opens
     * @param {Function} options.onClose - Callback when modal closes
     */
    function show(options) {
        const { 
            title = '', 
            content = '', 
            buttons = [], 
            closable = true,
            size = 'medium',
            onOpen = null,
            onClose = null
        } = options;
        
        // Close any existing modal
        if (activeModal) {
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
        overlay.className = 'modal-overlay';
        const closeLabel = (typeof _ === 'function' && _('actions.close')) || 'Close';
        overlay.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${id}-title" style="${sizeStyles[size] || sizeStyles.medium}">
                <div class="modal-header">
                    <h2 class="modal-title" id="${id}-title">${Utils.escapeHtml(title)}</h2>
                    ${closable ? `
                        <button type="button" class="modal-close" aria-label="${Utils.escapeHtml(closeLabel)}">
                            <span class="material-icons" aria-hidden="true">close</span>
                        </button>
                    ` : ''}
                </div>
                <div class="modal-body">
                    ${content}
                </div>
                ${buttons.length > 0 ? `
                    <div class="modal-footer">
                        ${buttons.map((btn, idx) => `
                            <button type="button" class="btn ${btn.class || 'btn-secondary'}" data-btn-index="${idx}">${Utils.escapeHtml(btn.label)}</button>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
        
        // Event handlers
        if (closable) {
            overlay.querySelector('.modal-close').addEventListener('click', () => {
                close();
                if (onClose) onClose();
            });
            
            // Close on overlay click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    close();
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
                    if (activeModal && activeModal.id === id) onOpen();
                }, 50);
            }
        });
        
        // Focus the first field (or the first button) and keep Tab inside the dialog
        const modal = overlay.querySelector('.modal');
        const focusables = () => Array.from(modal.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetParent !== null || el === document.activeElement);
        const firstField = modal.querySelector('.modal-body input:not([type="hidden"]):not([disabled]), .modal-body select, .modal-body textarea');
        const initial = firstField || modal.querySelector('.modal-footer .btn') || focusables()[0];
        if (initial) initial.focus();
        modal.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const list = focusables();
            if (!list.length) return;
            const first = list[0];
            const last = list[list.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        });

        // Escape key handler
        const escHandler = (e) => {
            if (e.key === 'Escape' && closable) {
                e.stopPropagation();
                close();
                if (onClose) onClose();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        activeModal = { id, escHandler, onClose, opener };
        
        return id;
    }
    
    /**
     * Close the active modal
     */
    function close() {
        if (!activeModal) return;
        
        const overlay = document.getElementById(activeModal.id);
        if (overlay) {
            overlay.classList.remove('open');
            setTimeout(() => overlay.remove(), 200);
        }

        document.removeEventListener('keydown', activeModal.escHandler);
        // Return focus to whatever opened the dialog
        const opener = activeModal.opener;
        activeModal = null;
        if (opener && document.contains(opener) && typeof opener.focus === 'function'
            && (overlay ? !overlay.contains(opener) : true)) {
            opener.focus({ preventScroll: true });
        }
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
        close,
        confirm,
        alert,
        prompt
    };
})();

// Export
window.Modal = Modal;
