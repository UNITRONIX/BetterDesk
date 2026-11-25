#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'views', 'dashboard.ejs');
let html = fs.readFileSync(filePath, 'utf8');
const start = html.indexOf('<section class="client-config-card"');
const endMarker = '</section>';
const end = html.indexOf(endMarker, start);
if (start < 0 || end < 0) {
    throw new Error('client-config-card section not found');
}
const endExclusive = end + endMarker.length;

const replacement = `                    <section class="client-config-card" aria-labelledby="client-config-title" id="client-config-card">
                        <div class="client-config-body" id="client-config-body">
                            <div class="client-config-header">
                                <div>
                                    <span class="dashboard-eyebrow">\${_('dashboard.client_config_eyebrow')}</span>
                                    <h2 class="section-title" id="client-config-title">
                                        <span class="material-icons" aria-hidden="true">integration_instructions</span>
                                        \${_('dashboard.client_config_title')}
                                    </h2>
                                    <p class="client-config-subtitle">\${_('dashboard.client_config_subtitle')}</p>
                                </div>
                                <div class="client-config-actions" role="toolbar" aria-label="\${_('dashboard.client_config_title')}">
                                    <button type="button" class="client-config-tool" id="copy-client-config-btn"
                                            title="\${_('dashboard.copy_all_config')}"
                                            aria-label="\${_('dashboard.copy_all_config')}">
                                        <span class="material-icons" aria-hidden="true">content_copy</span>
                                    </button>
                                    <button type="button" class="client-config-tool" id="copy-deploy-string-btn"
                                            title="\${_('dashboard.copy_deploy_string')}"
                                            aria-label="\${_('dashboard.copy_deploy_string')}">
                                        <span class="material-icons" aria-hidden="true">terminal</span>
                                    </button>
                                    <button type="button" class="client-config-tool" id="show-intune-script-btn"
                                            title="\${_('dashboard.show_intune_script')}"
                                            aria-label="\${_('dashboard.show_intune_script')}">
                                        <span class="material-icons" aria-hidden="true">code</span>
                                    </button>
                                    <button type="button" class="client-config-tool" id="show-client-qr-btn"
                                            title="\${_('dashboard.show_config_qr')}"
                                            aria-label="\${_('dashboard.show_config_qr')}">
                                        <span class="material-icons" aria-hidden="true">qr_code_2</span>
                                    </button>
                                    \${typeof hasPermission === 'function' && hasPermission('enrollment.approve') ? \`<button type="button" class="client-config-tool client-config-tool-primary" id="activate-agent-code-btn" title="\${_('dashboard.pair_with_code')}" aria-label="\${_('dashboard.pair_with_code')}">\` : ''}
                                        \${typeof hasPermission === 'function' && hasPermission('enrollment.approve') ? '<span class="material-icons" aria-hidden="true">pin</span>' : ''}
                                    \${typeof hasPermission === 'function' && hasPermission('enrollment.approve') ? '</button>' : ''}
                                </div>
                            </div>

                            <div class="client-config-host-row" id="client-config-host-row">
                                <label class="client-config-host-label" for="client-config-host-input">\${_('dashboard.client_server_host_label')}</label>
                                <div class="client-config-host-controls">
                                    <input type="text" class="form-input client-config-host-input" id="client-config-host-input"
                                           placeholder="\${_('dashboard.client_server_host_placeholder')}" autocomplete="off">
                                    <button type="button" class="btn btn-secondary btn-sm" id="apply-client-host-btn">\${_('dashboard.apply_client_host')}</button>
                                    <span class="client-config-env-badge" id="client-config-env-badge" hidden title="\${_('dashboard.client_server_host_env_hint')}">\${_('dashboard.client_host_env_badge') || 'From env'}</span>
                                </div>
                                <p class="client-config-host-hint" id="client-config-host-hint">\${_('dashboard.client_server_host_hint')}</p>
                                <p class="client-config-host-env-link" id="client-config-host-env-link" hidden>
                                    <a href="/settings?tab=general#public-endpoints-section">\${_('dashboard.client_host_settings_link') || 'Open Settings → Public client endpoints'}</a>
                                </p>
                            </div>

                            <div class="client-config-grid">
                                <div class="client-config-field">
                                    <span class="client-config-label">\${_('dashboard.config_server_id')}</span>
                                    <code class="client-config-value" id="client-config-server-id"><span class="skeleton skeleton-text"></span></code>
                                    <button type="button" class="client-config-copy" data-copy-target="client-config-server-id" title="\${_('actions.copy')}" aria-label="\${_('actions.copy')} \${_('dashboard.config_server_id')}">
                                        <span class="material-icons" aria-hidden="true">content_copy</span>
                                    </button>
                                </div>
                                <div class="client-config-field">
                                    <span class="client-config-label">\${_('dashboard.config_relay_server')}</span>
                                    <code class="client-config-value" id="client-config-relay-server"><span class="skeleton skeleton-text"></span></code>
                                    <button type="button" class="client-config-copy" data-copy-target="client-config-relay-server" title="\${_('actions.copy')}" aria-label="\${_('actions.copy')} \${_('dashboard.config_relay_server')}">
                                        <span class="material-icons" aria-hidden="true">content_copy</span>
                                    </button>
                                </div>
                                <div class="client-config-field">
                                    <span class="client-config-label">\${_('dashboard.config_api_server')}</span>
                                    <code class="client-config-value" id="client-config-api-url"><span class="skeleton skeleton-text"></span></code>
                                    <button type="button" class="client-config-copy" data-copy-target="client-config-api-url" title="\${_('actions.copy')}" aria-label="\${_('actions.copy')} \${_('dashboard.config_api_server')}">
                                        <span class="material-icons" aria-hidden="true">content_copy</span>
                                    </button>
                                </div>
                                <div class="client-config-field client-config-field-wide">
                                    <span class="client-config-label">\${_('dashboard.config_key')}</span>
                                    <code class="client-config-value is-masked" id="client-config-public-key"><span class="skeleton skeleton-text"></span></code>
                                    <button type="button" class="client-config-reveal" id="client-config-key-reveal" title="\${_('actions.show_value')}" aria-label="\${_('actions.show_value')} \${_('dashboard.config_key')}" aria-pressed="false">
                                        <span class="material-icons" aria-hidden="true">visibility</span>
                                    </button>
                                    <button type="button" class="client-config-copy" data-copy-target="client-config-public-key" title="\${_('actions.copy')}" aria-label="\${_('actions.copy')} \${_('dashboard.config_key')}">
                                        <span class="material-icons" aria-hidden="true">content_copy</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="client-config-lock" id="client-config-lock" hidden>
                            <div class="client-config-lock-panel" role="status">
                                <span class="material-icons" aria-hidden="true">public_off</span>
                                <p class="client-config-lock-title">\${_('dashboard.client_config_endpoints_required_title')}</p>
                                <p class="client-config-lock-text">\${_('dashboard.client_config_endpoints_required_text')}</p>
                                <a class="btn btn-primary" href="/settings?tab=general#public-endpoints-section" id="client-config-lock-settings-btn">
                                    <span class="material-icons" aria-hidden="true">settings</span>
                                    \${_('dashboard.client_config_endpoints_required_cta')}
                                </a>
                            </div>
                        </div>
                    </section>`;

html = html.slice(0, start) + replacement + html.slice(endExclusive);
fs.writeFileSync(filePath, html);
console.log('patched dashboard.ejs client-config-card');
