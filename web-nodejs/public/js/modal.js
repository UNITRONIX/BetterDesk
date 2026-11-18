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
        
        const overlay = document.createElement('div');
        overlay.id = id;
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="${sizeStyles[size] || sizeStyles.medium}">
                <div class="modal-header">
                    <h3 class="modal-title">${Utils.escapeHtml(title)}</h3>
                    ${closable ? `
                        <button class="modal-close" aria-label="Close">
                            <span class="material-icons">close</span>
                        </button>
                    ` : ''}
                </div>
                <div class="modal-body">
                    ${content}
                </div>
                ${buttons.length > 0 ? `
                    <div class="modal-footer">
                        ${buttons.map((btn, idx) => `
                            <button class="btn ${btn.class || 'btn-secondary'}" data-btn-index="${idx}">
                                ${btn.icon ? `<span class="material-icons">${btn.icon}</span>` : ''}
                                ${Utils.escapeHtml(btn.label)}
                            </button>
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
                setTimeout(() => onOpen(), 50);
            }
        });
        
        // Trap focus
        const modal = overlay.querySelector('.modal');
        const focusableElements = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusableElements.length > 0) {
            focusableElements[0].focus();
        }
        
        // Escape key handler
        const escHandler = (e) => {
            if (e.key === 'Escape' && closable) {
                close();
                if (onClose) onClose();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        activeModal = { id, escHandler, onClose };
        
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
        activeModal = null;
    }
    
    function setConfirmButtonLabel(btn, label, icon) {
        if (!btn) return;
        btn.innerHTML = `${icon ? `<span class="material-icons" aria-hidden="true">${Utils.escapeHtml(icon)}</span>` : ''}${Utils.escapeHtml(label)}`;
    }

    /**
     * Confirm dialog shorthand
     * @param {Object} options
     * @param {number} [options.confirmDelay=0] - Seconds the confirm button stays
     *   disabled (with a countdown label) before it can be pressed. Useful for
     *   destructive actions that should not be one click away.
     */
    function confirm(options) {
        return new Promise((resolve) => {
            const confirmLabel = options.confirmLabel || _('actions.confirm');
            const confirmIcon = options.confirmIcon;
            const delaySec = Math.max(0, Math.floor(Number(options.confirmDelay) || 0));
            let countdownTimer = null;
            let settled = false;

            const settle = (value) => {
                if (settled) return;
                settled = true;
                if (countdownTimer) {
                    clearInterval(countdownTimer);
                    countdownTimer = null;
                }
                resolve(value);
            };

            show({
                title: options.title || _('common.confirm'),
                content: `<p>${Utils.escapeHtml(options.message || '')}</p>`,
                buttons: [
                    {
                        label: options.cancelLabel || _('actions.cancel'),
                        class: 'btn-secondary',
                        onClick: () => {
                            close();
                            settle(false);
                        }
                    },
                    {
                        label: delaySec > 0 ? `${confirmLabel} (${delaySec})` : confirmLabel,
                        class: options.danger ? 'btn-danger' : 'btn-primary',
                        icon: confirmIcon,
                        onClick: () => {
                            close();
                            settle(true);
                        }
                    }
                ],
                closable: true,
                onClose: () => settle(false),
                onOpen: () => {
                    if (delaySec <= 0 || !activeModal) return;
                    const overlay = document.getElementById(activeModal.id);
                    const btn = overlay && overlay.querySelector('[data-btn-index="1"]');
                    if (!btn) return;

                    btn.disabled = true;
                    btn.setAttribute('aria-disabled', 'true');
                    let remaining = delaySec;
                    setConfirmButtonLabel(btn, `${confirmLabel} (${remaining})`, confirmIcon);

                    countdownTimer = setInterval(() => {
                        remaining -= 1;
                        if (remaining <= 0) {
                            clearInterval(countdownTimer);
                            countdownTimer = null;
                            btn.disabled = false;
                            btn.removeAttribute('aria-disabled');
                            setConfirmButtonLabel(btn, confirmLabel, confirmIcon);
                            return;
                        }
                        setConfirmButtonLabel(btn, `${confirmLabel} (${remaining})`, confirmIcon);
                    }, 1000);
                }
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
