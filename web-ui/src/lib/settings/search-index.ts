/**
 * The settings search index and the element ids of every settings tab.
 * Generated from the old settings view (views/settings.ejs) by
 * .ui-rework/tools/svelte-settings-index.mjs; don't edit by hand, run it
 * again when a tab gains or loses a setting.
 *
 * Each entry: tab, element id it jumps to, label key, section key, up to two
 * hint keys (searched too), and the permission a person needs to see it
 * ('' for everyone who may open the tab).
 */

export type IndexRow = readonly [
	tab: string,
	id: string,
	label: string,
	section: string,
	hints: readonly string[],
	need: '' | 'server.config' | 'branding.edit'
];

export const SEARCH_INDEX: readonly IndexRow[] = [
	[
		'general',
		'public-endpoints',
		'settings.public_endpoints_title',
		'',
		['settings.public_endpoints_desc', 'settings.general.endpoint_id_hint'],
		'server.config'
	],
	[
		'general',
		'public-server-id',
		'settings.public_endpoints_server_id',
		'settings.public_endpoints_title',
		['settings.general.endpoint_id_hint'],
		'server.config'
	],
	[
		'general',
		'public-relay-server',
		'settings.public_endpoints_relay',
		'settings.public_endpoints_title',
		['settings.general.endpoint_relay_hint'],
		'server.config'
	],
	[
		'general',
		'public-api-url',
		'settings.public_endpoints_api_url',
		'settings.public_endpoints_title',
		['settings.general.endpoint_api_hint'],
		'server.config'
	],
	[
		'general',
		'connection-mode-section',
		'settings.connection_mode_title',
		'',
		['settings.connection_mode_desc', 'settings.general.conn_p2p_desc'],
		'server.config'
	],
	[
		'general',
		'conn-mode-p2p',
		'settings.general.conn_p2p',
		'settings.connection_mode_title',
		['settings.general.conn_p2p_desc'],
		'server.config'
	],
	[
		'general',
		'conn-mode-relay',
		'settings.general.conn_relay',
		'settings.connection_mode_title',
		['settings.general.conn_relay_desc'],
		'server.config'
	],
	[
		'general',
		'conn-p2p-fallback-ms',
		'settings.general.conn_fallback_label',
		'settings.connection_mode_title',
		['settings.general.conn_fallback_hint'],
		'server.config'
	],
	[
		'general',
		'conn-same-nat-relay',
		'settings.general.conn_same_nat',
		'settings.connection_mode_title',
		['settings.general.conn_same_nat_hint'],
		'server.config'
	],
	[
		'general',
		'conn-allow-shared-nat-initiator',
		'settings.general.conn_shared_nat',
		'settings.connection_mode_title',
		['settings.general.conn_shared_nat_hint'],
		'server.config'
	],
	[
		'general',
		'conn-logged-in-only-initiator',
		'settings.general.conn_logged_in',
		'settings.connection_mode_title',
		['settings.general.conn_logged_in_hint'],
		'server.config'
	],
	[
		'general',
		'conn-operator-only-outbound',
		'settings.general.conn_operator_only',
		'settings.connection_mode_title',
		['settings.general.conn_operator_only_hint'],
		'server.config'
	],
	[
		'general',
		'device-scope-settings-panel',
		'settings.device_scope_title',
		'',
		['settings.general.scope_note', 'settings.general.scope_open_desc'],
		'server.config'
	],
	[
		'general',
		'device-scope-open',
		'settings.general.scope_open',
		'settings.device_scope_title',
		['settings.general.scope_open_desc'],
		'server.config'
	],
	[
		'general',
		'device-scope-restricted',
		'settings.general.scope_restricted',
		'settings.device_scope_title',
		['settings.general.scope_restricted_desc'],
		'server.config'
	],
	[
		'general',
		'availability-history-settings-panel',
		'settings.availability_history_title',
		'',
		['settings.general.availability_note', 'settings.general.availability_enable_hint'],
		'server.config'
	],
	[
		'general',
		'availability-history-enabled',
		'settings.availability_history_enable',
		'settings.availability_history_title',
		['settings.general.availability_enable_hint'],
		'server.config'
	],
	[
		'general',
		'availability-history-retention',
		'settings.general.retention_label',
		'settings.availability_history_title',
		['settings.general.retention_hint'],
		'server.config'
	],
	[
		'general',
		'mesh-settings-panel',
		'mesh.settings_title',
		'',
		['settings.general.mesh_note2', 'settings.general.mesh_groups_note'],
		'server.config'
	],
	[
		'general',
		'mesh-status-enabled',
		'settings.general.mesh_status',
		'mesh.settings_title',
		[],
		'server.config'
	],
	[
		'general',
		'mesh-agents-online',
		'settings.general.mesh_agents',
		'mesh.settings_title',
		[],
		'server.config'
	],
	[
		'general',
		'mesh-settings-panel',
		'settings.general.mesh_server_id',
		'mesh.settings_title',
		[],
		'server.config'
	],
	['general', 'mesh-cert-state', 'settings.general.mesh_cert', 'mesh.settings_title', [], 'server.config'],
	[
		'general',
		'mesh-groups-form',
		'mesh.groups_title',
		'',
		['settings.general.mesh_groups_note'],
		'server.config'
	],
	[
		'general',
		'mesh-msh-name',
		'settings.general.mesh_msh_name',
		'mesh.settings_title',
		['settings.general.mesh_msh_name_hint'],
		'server.config'
	],
	['general', 'mesh-recordings', 'settings.general.rec_title', '', [], 'server.config'],
	['general', 'server-info', 'settings.server_info', '', [], ''],
	['general', 'server-info', 'settings.general.console_version', 'settings.server_info', [], ''],
	['general', 'go-server-version', 'settings.general.server_version', 'settings.server_info', [], ''],
	['general', 'db-path', 'settings.general.database_file', 'settings.server_info', [], ''],
	['general', 'uptime', 'settings.general.running_for', 'settings.server_info', [], ''],
	[
		'branding',
		'branding-theme',
		'theme.title',
		'',
		['settings.appearance.theme_note', 'settings.appearance.mode_system'],
		''
	],
	['branding', 'theme-mode-selector', 'theme.auto', 'theme.title', ['settings.appearance.mode_system'], ''],
	['branding', 'theme-mode-selector', 'theme.light', 'theme.title', ['settings.appearance.mode_light'], ''],
	['branding', 'theme-mode-selector', 'theme.dark', 'theme.title', ['settings.appearance.mode_dark'], ''],
	['branding', 'theme-mode-selector', 'theme.custom', 'theme.title', ['settings.appearance.mode_custom'], ''],
	[
		'branding',
		'branding-theme-select',
		'branding.builtin_themes',
		'theme.title',
		['settings.appearance.builtin_hint'],
		''
	],
	[
		'branding',
		'branding-custom-colors',
		'settings.appearance.custom_colors',
		'',
		['settings.appearance.custom_colors_note'],
		''
	],
	[
		'branding',
		'color-bgPrimary',
		'settings.appearance.color_bg',
		'settings.appearance.custom_colors',
		[],
		''
	],
	[
		'branding',
		'color-bgSecondary',
		'settings.appearance.color_bg_subtle',
		'settings.appearance.custom_colors',
		[],
		''
	],
	[
		'branding',
		'color-bgTertiary',
		'settings.appearance.color_hover',
		'settings.appearance.custom_colors',
		[],
		''
	],
	[
		'branding',
		'color-bgElevated',
		'settings.appearance.color_float',
		'settings.appearance.custom_colors',
		[],
		''
	],
	[
		'branding',
		'color-textPrimary',
		'settings.appearance.color_text',
		'settings.appearance.custom_colors',
		[],
		''
	],
	[
		'branding',
		'color-textSecondary',
		'settings.appearance.color_text_muted',
		'settings.appearance.custom_colors',
		[],
		''
	],
	[
		'branding',
		'color-accentBlue',
		'settings.appearance.color_accent',
		'settings.appearance.custom_colors',
		[],
		''
	],
	[
		'branding',
		'color-accentGreen',
		'settings.appearance.color_success',
		'settings.appearance.custom_colors',
		[],
		''
	],
	[
		'branding',
		'color-accentRed',
		'settings.appearance.color_danger',
		'settings.appearance.custom_colors',
		[],
		''
	],
	[
		'branding',
		'color-accentYellow',
		'settings.appearance.color_warning',
		'settings.appearance.custom_colors',
		[],
		''
	],
	[
		'branding',
		'color-accentPurple',
		'settings.appearance.color_info',
		'settings.appearance.custom_colors',
		[],
		''
	],
	[
		'branding',
		'color-borderPrimary',
		'settings.appearance.color_border',
		'settings.appearance.custom_colors',
		[],
		''
	],
	[
		'branding',
		'color-borderSecondary',
		'settings.appearance.color_rule',
		'settings.appearance.custom_colors',
		[],
		''
	],
	[
		'branding',
		'branding-identity',
		'settings.appearance.identity',
		'',
		['branding.identity_desc', 'branding.logo_desc'],
		''
	],
	['branding', 'brand-name', 'branding.app_name', 'settings.appearance.identity', [], ''],
	['branding', 'brand-description', 'branding.app_description', 'settings.appearance.identity', [], ''],
	[
		'branding',
		'branding-identity',
		'branding.logo_title',
		'settings.appearance.identity',
		['branding.logo_desc'],
		''
	],
	[
		'branding',
		'logo-text-input',
		'branding.logo_text',
		'settings.appearance.identity',
		['branding.logo_text_hint'],
		''
	],
	[
		'branding',
		'logo-text-accent',
		'branding.logo_text_accent',
		'settings.appearance.identity',
		['branding.logo_text_accent_hint'],
		''
	],
	[
		'branding',
		'logo-icon-name',
		'branding.logo_icon_name',
		'settings.appearance.identity',
		['branding.logo_icon_hint'],
		''
	],
	[
		'branding',
		'logo-svg-input',
		'branding.logo_svg_code',
		'settings.appearance.identity',
		['branding.logo_svg_hint'],
		''
	],
	[
		'branding',
		'logo-image-file',
		'branding.logo_image_upload',
		'settings.appearance.identity',
		['branding.logo_image_hint'],
		''
	],
	[
		'branding',
		'logo-image-url',
		'branding.logo_image_url',
		'settings.appearance.identity',
		['branding.logo_image_url_hint'],
		''
	],
	[
		'branding',
		'branding-fonts',
		'branding.typography_title',
		'',
		['branding.typography_desc', 'branding.font_heading_hint'],
		''
	],
	[
		'branding',
		'font-heading-search',
		'branding.font_heading',
		'branding.typography_title',
		['branding.font_heading_hint'],
		''
	],
	[
		'branding',
		'font-body-search',
		'branding.font_body',
		'branding.typography_title',
		['branding.font_body_hint'],
		''
	],
	['branding', 'branding-fonts', 'settings.appearance.font_source', 'branding.typography_title', [], ''],
	['branding', 'font-upload-name', 'branding.font_upload_name', 'branding.typography_title', [], ''],
	['branding', 'font-upload-file', 'branding.font_upload_choose', 'branding.typography_title', [], ''],
	[
		'branding',
		'branding-footer',
		'branding.footer_title',
		'',
		['branding.footer_desc', 'branding.footer_text_hint'],
		''
	],
	[
		'branding',
		'footer-text',
		'branding.footer_text',
		'branding.footer_title',
		['branding.footer_text_hint'],
		''
	],
	[
		'branding',
		'show-powered',
		'branding.show_powered',
		'branding.footer_title',
		['branding.show_powered_hint'],
		''
	],
	[
		'branding',
		'branding-background',
		'settings.appearance.console_background',
		'',
		['branding.background_desc', 'branding.bg_gradient_hint'],
		''
	],
	[
		'branding',
		'branding-background',
		'settings.appearance.background_type',
		'settings.appearance.console_background',
		[],
		''
	],
	['branding', 'bg-color-picker', 'branding.bg_color', 'settings.appearance.console_background', [], ''],
	[
		'branding',
		'bg-gradient',
		'branding.bg_gradient',
		'settings.appearance.console_background',
		['branding.bg_gradient_hint'],
		''
	],
	['branding', 'bg-image-panel', 'desktop.wp_images', 'settings.appearance.console_background', [], ''],
	[
		'branding',
		'bg-image-file',
		'branding.bg_image_upload',
		'settings.appearance.console_background',
		['branding.bg_image_hint'],
		''
	],
	['branding', 'bg-image-url', 'branding.bg_image_url', 'settings.appearance.console_background', [], ''],
	['branding', 'bg-size', 'branding.bg_size', 'settings.appearance.console_background', [], ''],
	['branding', 'bg-blur', 'branding.bg_blur', 'settings.appearance.console_background', [], ''],
	[
		'branding',
		'bg-overlay',
		'branding.bg_overlay',
		'settings.appearance.console_background',
		['branding.bg_overlay_hint'],
		''
	],
	['branding', 'glass-enabled', 'branding.glass_enabled', '', [], ''],
	['branding', 'glass-color-picker', 'branding.glass_color', '', ['branding.glass_color_hint'], ''],
	['branding', 'glass-blur', 'branding.glass_blur', '', [], ''],
	['branding', 'glass-opacity', 'branding.glass_opacity', '', [], ''],
	[
		'branding',
		'branding-login',
		'branding.login_title',
		'',
		['branding.login_desc', 'branding.login_promo_mode_hint'],
		''
	],
	['branding', 'login-title', 'branding.login_heading', 'branding.login_title', [], ''],
	['branding', 'login-subtitle', 'branding.login_subheading', 'branding.login_title', [], ''],
	[
		'branding',
		'login-promo-mode-selector',
		'branding.login_promo_mode',
		'branding.login_title',
		['branding.login_promo_mode_hint'],
		''
	],
	[
		'branding',
		'login-slides-panel',
		'branding.login_slides_title',
		'',
		['branding.login_slides_desc', 'branding.login_slides_max'],
		''
	],
	['branding', 'login-bg-config', 'settings.appearance.login_background', '', ['branding.bg_image_hint'], ''],
	[
		'branding',
		'login-bg-config',
		'settings.appearance.background_type',
		'settings.appearance.login_background',
		[],
		''
	],
	['branding', 'login-bg-color-picker', 'branding.bg_color', 'settings.appearance.login_background', [], ''],
	['branding', 'login-bg-gradient', 'branding.bg_gradient', 'settings.appearance.login_background', [], ''],
	[
		'branding',
		'login-bg-image-file',
		'branding.bg_image_upload',
		'settings.appearance.login_background',
		['branding.bg_image_hint'],
		''
	],
	['branding', 'login-bg-image-url', 'branding.bg_image_url', 'settings.appearance.login_background', [], ''],
	['branding', 'login-bg-overlay', 'branding.bg_overlay', 'settings.appearance.login_background', [], ''],
	[
		'branding',
		'branding-agent',
		'branding.agent_title',
		'',
		['branding.agent_desc', 'branding.bg_image_hint'],
		''
	],
	['branding', 'branding-agent', 'settings.appearance.background_type', 'branding.agent_title', [], ''],
	['branding', 'agent-bg-color-picker', 'branding.bg_color', 'branding.agent_title', [], ''],
	['branding', 'agent-bg-gradient', 'branding.bg_gradient', 'branding.agent_title', [], ''],
	[
		'branding',
		'agent-bg-image-file',
		'branding.bg_image_upload',
		'branding.agent_title',
		['branding.bg_image_hint'],
		''
	],
	['branding', 'agent-bg-image-url', 'branding.bg_image_url', 'branding.agent_title', [], ''],
	[
		'branding',
		'agent-show-powered',
		'branding.agent_show_powered',
		'branding.agent_title',
		['branding.agent_show_powered_hint'],
		''
	],
	[
		'branding',
		'branding-rdclient',
		'settings.appearance.rdclient',
		'',
		['remote_dashboard.subtitle', 'branding.bg_image_hint'],
		''
	],
	[
		'branding',
		'branding-rdclient',
		'settings.appearance.background_type',
		'settings.appearance.rdclient',
		[],
		''
	],
	['branding', 'rdclient-bg-color-picker', 'branding.bg_color', 'settings.appearance.rdclient', [], ''],
	['branding', 'rdclient-bg-gradient', 'branding.bg_gradient', 'settings.appearance.rdclient', [], ''],
	[
		'branding',
		'rdclient-bg-image-file',
		'branding.bg_image_upload',
		'settings.appearance.rdclient',
		['branding.bg_image_hint'],
		''
	],
	['branding', 'rdclient-bg-image-url', 'branding.bg_image_url', 'settings.appearance.rdclient', [], ''],
	['branding', 'rdclient-bg-size', 'branding.bg_size', 'settings.appearance.rdclient', [], ''],
	[
		'branding',
		'rdclient-bg-overlay',
		'branding.bg_overlay',
		'settings.appearance.rdclient',
		['branding.bg_overlay_hint'],
		''
	],
	['branding', 'custom-css', 'branding.custom_css_title', '', ['branding.custom_css_hint'], ''],
	[
		'branding',
		'branding-profiles',
		'settings.appearance.profiles',
		'',
		['settings.appearance.profiles_note'],
		'branding.edit'
	],
	[
		'branding',
		'branding-profile-select',
		'branding.profiles_label',
		'settings.appearance.profiles',
		[],
		'branding.edit'
	],
	[
		'branding',
		'branding-import-export',
		'branding.import_export_title',
		'',
		['branding.import_export_desc'],
		'branding.edit'
	],
	[
		'branding',
		'branding-import-input',
		'branding.import_theme',
		'branding.import_export_title',
		[],
		'branding.edit'
	],
	['auth', 'password-form', 'settings.change_password', '', ['settings.password_requirements'], ''],
	['auth', 'current-password', 'settings.current_password', 'settings.change_password', [], ''],
	[
		'auth',
		'new-password',
		'settings.new_password',
		'settings.change_password',
		['settings.password_requirements'],
		''
	],
	['auth', 'confirm-password', 'settings.confirm_password', 'settings.change_password', [], ''],
	['auth', 'auth-panel-totp', 'settings.totp_title', '', ['settings.signin.totp_note'], ''],
	[
		'auth',
		'enrollment-settings-section',
		'settings.enrollment_title',
		'',
		['settings.enrollment_desc', 'tokens.mode_open_desc'],
		'server.config'
	],
	[
		'auth',
		'enrollment-settings-section',
		'tokens.mode_open',
		'settings.enrollment_title',
		['tokens.mode_open_desc'],
		'server.config'
	],
	[
		'auth',
		'enrollment-settings-section',
		'tokens.mode_managed',
		'settings.enrollment_title',
		['tokens.mode_managed_desc'],
		'server.config'
	],
	[
		'auth',
		'enrollment-settings-section',
		'tokens.mode_locked',
		'settings.enrollment_title',
		['tokens.mode_locked_desc'],
		'server.config'
	],
	[
		'auth',
		'enrollment-rich-approve',
		'settings.enrollment_rich_approve',
		'settings.enrollment_title',
		['settings.enrollment_rich_approve_hint'],
		'server.config'
	],
	[
		'auth',
		'enrollment-tag-picker',
		'settings.enrollment_tag_picker',
		'settings.enrollment_title',
		['settings.enrollment_tag_picker_hint'],
		'server.config'
	],
	[
		'auth',
		'client-sessions-form',
		'settings.client_sessions_title',
		'',
		['settings.client_sessions_desc', 'settings.client_sessions_expiry_hint'],
		'server.config'
	],
	[
		'auth',
		'client-sessions-expiry-days',
		'settings.client_sessions_expiry_days',
		'settings.client_sessions_title',
		['settings.client_sessions_expiry_hint'],
		'server.config'
	],
	[
		'auth',
		'client-sessions-sliding',
		'settings.client_sessions_sliding',
		'settings.client_sessions_title',
		['settings.client_sessions_sliding_hint'],
		'server.config'
	],
	[
		'auth',
		'client-sessions-max-days',
		'settings.client_sessions_max_days',
		'settings.client_sessions_title',
		['settings.client_sessions_max_days_hint'],
		'server.config'
	],
	[
		'auth',
		'ldap-form',
		'settings.ldap_title',
		'',
		['settings.ldap_desc', 'settings.signin.ldap_enabled_hint'],
		'server.config'
	],
	[
		'auth',
		'ldap-enabled',
		'settings.ldap_enabled',
		'settings.ldap_title',
		['settings.signin.ldap_enabled_hint'],
		'server.config'
	],
	['auth', 'ldap-host', 'settings.ldap_host', 'settings.ldap_title', [], 'server.config'],
	['auth', 'ldap-port', 'settings.ldap_port', 'settings.ldap_title', [], 'server.config'],
	['auth', 'ldap-use-tls', 'settings.ldap_use_tls', 'settings.ldap_title', [], 'server.config'],
	['auth', 'ldap-start-tls', 'settings.ldap_start_tls', 'settings.ldap_title', [], 'server.config'],
	['auth', 'ldap-skip-tls-verify', 'settings.ldap_skip_verify', 'settings.ldap_title', [], 'server.config'],
	[
		'auth',
		'ldap-conn-timeout',
		'settings.ldap_timeout',
		'settings.ldap_title',
		['settings.ldap_timeout_hint'],
		'server.config'
	],
	[
		'auth',
		'ldap-direct-bind',
		'settings.ldap_direct_bind',
		'settings.ldap_title',
		['settings.ldap_direct_bind_hint'],
		'server.config'
	],
	[
		'auth',
		'ldap-bind-dn',
		'settings.ldap_bind_dn',
		'settings.ldap_title',
		['settings.ldap_bind_dn_hint'],
		'server.config'
	],
	['auth', 'ldap-bind-password', 'settings.ldap_bind_password', 'settings.ldap_title', [], 'server.config'],
	[
		'auth',
		'ldap-base-dn',
		'settings.ldap_base_dn',
		'settings.ldap_title',
		['settings.ldap_base_dn_hint'],
		'server.config'
	],
	[
		'auth',
		'ldap-user-filter',
		'settings.ldap_user_filter',
		'settings.ldap_title',
		['settings.ldap_user_filter_hint'],
		'server.config'
	],
	[
		'auth',
		'ldap-direct-bind-dn',
		'settings.ldap_direct_bind_dn',
		'settings.ldap_title',
		['settings.ldap_direct_bind_dn_hint'],
		'server.config'
	],
	['auth', 'ldap-user-attr-id', 'settings.ldap_attr_id', 'settings.ldap_title', [], 'server.config'],
	['auth', 'ldap-user-attr-email', 'settings.ldap_attr_email', 'settings.ldap_title', [], 'server.config'],
	['auth', 'ldap-user-attr-name', 'settings.ldap_attr_name', 'settings.ldap_title', [], 'server.config'],
	[
		'auth',
		'ldap-group-base-dn',
		'settings.ldap_group_base_dn',
		'settings.ldap_title',
		['settings.ldap_group_base_dn_hint'],
		'server.config'
	],
	['auth', 'ldap-group-filter', 'settings.ldap_group_filter', 'settings.ldap_title', [], 'server.config'],
	[
		'auth',
		'ldap-group-attr-name',
		'settings.ldap_group_attr_name',
		'settings.ldap_title',
		[],
		'server.config'
	],
	[
		'auth',
		'ldap-default-role',
		'settings.ldap_default_role',
		'settings.ldap_title',
		['settings.ldap_default_role_hint'],
		'server.config'
	],
	[
		'auth',
		'ldap-group-role-map',
		'settings.ldap_group_role_map',
		'settings.ldap_title',
		['settings.ldap_group_role_map_hint'],
		'server.config'
	],
	[
		'auth',
		'oidc-form',
		'settings.oidc_title',
		'',
		['settings.oidc_desc', 'settings.oidc_enabled_hint'],
		'server.config'
	],
	[
		'auth',
		'oidc-enabled',
		'settings.oidc_enabled',
		'settings.oidc_title',
		['settings.oidc_enabled_hint'],
		'server.config'
	],
	[
		'auth',
		'oidc-display-name',
		'settings.oidc_display_name',
		'settings.oidc_title',
		['settings.oidc_display_name_hint'],
		'server.config'
	],
	[
		'auth',
		'oidc-issuer-url',
		'settings.oidc_issuer_url',
		'settings.oidc_title',
		['settings.oidc_issuer_url_hint'],
		'server.config'
	],
	[
		'auth',
		'oidc-allowed-private-cidrs',
		'settings.oidc_allowed_private_cidrs',
		'settings.oidc_title',
		['settings.oidc_allowed_private_cidrs_hint'],
		'server.config'
	],
	['auth', 'oidc-client-id', 'settings.oidc_client_id', 'settings.oidc_title', [], 'server.config'],
	['auth', 'oidc-client-secret', 'settings.oidc_client_secret', 'settings.oidc_title', [], 'server.config'],
	[
		'auth',
		'oidc-redirect-url',
		'settings.oidc_redirect_url',
		'settings.oidc_title',
		['settings.oidc_redirect_url_hint'],
		'server.config'
	],
	[
		'auth',
		'oidc-panel-url',
		'settings.oidc_panel_url',
		'settings.oidc_title',
		['settings.oidc_panel_url_hint'],
		'server.config'
	],
	['auth', 'oidc-scopes', 'settings.oidc_scopes', 'settings.oidc_title', [], 'server.config'],
	['auth', 'oidc-use-pkce', 'settings.oidc_use_pkce', 'settings.oidc_title', [], 'server.config'],
	['auth', 'oidc-auto-discovery', 'settings.oidc_auto_discovery', 'settings.oidc_title', [], 'server.config'],
	['auth', 'oidc-allow-signup', 'settings.oidc_allow_signup', 'settings.oidc_title', [], 'server.config'],
	[
		'auth',
		'oidc-prefer-sso',
		'settings.oidc_prefer_sso',
		'settings.oidc_title',
		['settings.oidc_prefer_sso_hint'],
		'server.config'
	],
	[
		'auth',
		'oidc-authorization-url',
		'settings.oidc_authorization_url',
		'settings.oidc_title',
		[],
		'server.config'
	],
	['auth', 'oidc-token-url', 'settings.oidc_token_url', 'settings.oidc_title', [], 'server.config'],
	['auth', 'oidc-userinfo-url', 'settings.oidc_userinfo_url', 'settings.oidc_title', [], 'server.config'],
	['auth', 'oidc-claim-username', 'settings.oidc_claim_username', 'settings.oidc_title', [], 'server.config'],
	['auth', 'oidc-claim-email', 'settings.oidc_claim_email', 'settings.oidc_title', [], 'server.config'],
	['auth', 'oidc-claim-name', 'settings.oidc_claim_name', 'settings.oidc_title', [], 'server.config'],
	['auth', 'oidc-claim-groups', 'settings.oidc_claim_groups', 'settings.oidc_title', [], 'server.config'],
	['auth', 'oidc-default-role', 'settings.oidc_default_role', 'settings.oidc_title', [], 'server.config'],
	[
		'auth',
		'oidc-group-role-map',
		'settings.oidc_group_role_map',
		'settings.oidc_title',
		['settings.oidc_group_role_map_hint'],
		'server.config'
	],
	[
		'backup',
		'backup-create',
		'settings.backup_tab.create_title',
		'',
		['settings.backup_tab.create_note'],
		'server.config'
	],
	[
		'backup',
		'scheduled-backup-panel',
		'backup.schedule_title',
		'',
		['settings.backup_tab.schedule_note', 'settings.backup_tab.schedule_enabled_hint'],
		'server.config'
	],
	[
		'backup',
		'scheduled-backup-enabled',
		'backup.schedule_enabled',
		'backup.schedule_title',
		['settings.backup_tab.schedule_enabled_hint'],
		'server.config'
	],
	[
		'backup',
		'scheduled-backup-interval',
		'backup.schedule_interval',
		'backup.schedule_title',
		[],
		'server.config'
	],
	[
		'backup',
		'scheduled-backup-retention',
		'backup.schedule_retention',
		'backup.schedule_title',
		['settings.backup_tab.retention_hint'],
		'server.config'
	],
	[
		'backup',
		'scheduled-backup-destination-type',
		'backup.schedule_destination',
		'backup.schedule_title',
		[],
		'server.config'
	],
	[
		'backup',
		'scheduled-backup-path',
		'backup.schedule_destination_path_label',
		'backup.schedule_title',
		['backup.schedule_destination_path_hint'],
		'server.config'
	],
	['backup', 'backup-smb-host', 'backup.smb_host', '', [], 'server.config'],
	['backup', 'backup-smb-share', 'backup.smb_share', '', [], 'server.config'],
	[
		'backup',
		'backup-smb-domain',
		'backup.smb_domain',
		'',
		['settings.backup_tab.smb_domain_hint'],
		'server.config'
	],
	['backup', 'backup-smb-username', 'backup.smb_username', '', [], 'server.config'],
	['backup', 'backup-smb-password', 'backup.smb_password', '', ['backup.smb_password_hint'], 'server.config'],
	[
		'backup',
		'backup-smb-mount-path',
		'settings.backup_tab.smb_mount_path',
		'',
		['settings.backup_tab.smb_mount_path_hint'],
		'server.config'
	],
	[
		'backup',
		'backup-restore',
		'settings.backup_tab.restore_title',
		'',
		['settings.backup_tab.restore_note', 'settings.backup_tab.restore_file_hint'],
		'server.config'
	],
	[
		'backup',
		'restore-file-input',
		'settings.backup_tab.restore_file',
		'settings.backup_tab.restore_title',
		['settings.backup_tab.restore_file_hint'],
		'server.config'
	],
	[
		'backup',
		'restore-database',
		'settings.backup_tab.opt_database',
		'',
		['settings.backup_tab.opt_database_desc'],
		'server.config'
	],
	[
		'backup',
		'restore-uploads',
		'settings.backup_tab.opt_uploads',
		'',
		['settings.backup_tab.opt_uploads_desc'],
		'server.config'
	],
	[
		'backup',
		'restore-secrets',
		'settings.backup_tab.opt_secrets',
		'',
		['settings.backup_tab.opt_secrets_desc'],
		'server.config'
	],
	[
		'backup',
		'restore-env',
		'settings.backup_tab.opt_env',
		'',
		['settings.backup_tab.opt_env_desc'],
		'server.config'
	],
	[
		'backup',
		'restore-godb',
		'settings.backup_tab.opt_godb',
		'',
		['settings.backup_tab.opt_godb_desc'],
		'server.config'
	],
	['backup', 'backup-stat-users', 'backup.stat_users', '', [], 'server.config'],
	['backup', 'backup-stat-settings', 'backup.stat_settings', '', [], 'server.config'],
	['backup', 'backup-stat-folders', 'backup.stat_folders', '', [], 'server.config'],
	['backup', 'backup-stat-groups', 'backup.stat_groups', '', [], 'server.config'],
	['backup', 'backup-stat-strategies', 'settings.backup_tab.stat_strategies', '', [], 'server.config'],
	['backup', 'backup-stat-backend', 'settings.backup_tab.stat_backend', '', [], 'server.config'],
	['backup', 'backup-stat-database', 'backup.stat_database', '', [], 'server.config'],
	['backup', 'backup-stat-keys', 'backup.stat_keys', '', [], 'server.config'],
	['backup', 'backup-stat-env', 'backup.stat_env', '', [], 'server.config'],
	['backup', 'backup-stat-uploads', 'settings.backup_tab.stat_uploads', '', [], 'server.config'],
	[
		'updates',
		'update-details-section',
		'updates.update_available',
		'',
		['updates.install_blocked_hint', 'settings.updates_tab.docker_install_note'],
		'server.config'
	],
	[
		'updates',
		'update-backup-toggle',
		'updates.create_backup',
		'updates.update_available',
		[],
		'server.config'
	],
	[
		'updates',
		'update-channel-panel',
		'updates.channel_title',
		'',
		['settings.updates_tab.channel_note', 'settings.updates_tab.channel_stable_desc'],
		'server.config'
	],
	[
		'updates',
		'update-channel-stable',
		'updates.channel_title',
		'',
		['settings.updates_tab.channel_stable_desc', 'settings.updates_tab.channel_development_desc'],
		'server.config'
	],
	[
		'updates',
		'update-channel-stable',
		'settings.updates_tab.channel_stable',
		'updates.channel_title',
		['settings.updates_tab.channel_stable_desc'],
		'server.config'
	],
	[
		'updates',
		'update-channel-development',
		'settings.updates_tab.channel_development',
		'updates.channel_title',
		['settings.updates_tab.channel_development_desc'],
		'server.config'
	],
	[
		'updates',
		'backup-retention-input',
		'settings.updates_tab.retention_label',
		'',
		['updates.retention_hint'],
		'server.config'
	],
	['updates', 'update-local-version', 'updates.current_version', '', [], 'server.config'],
	['updates', 'update-remote-version', 'settings.updates_tab.newest_version', '', [], 'server.config'],
	['updates', 'update-status-badge', 'updates.status', '', [], 'server.config'],
	['email', 'email-smtp-host', 'settings.email.host_label', '', [], 'server.config'],
	['email', 'email-smtp-port', 'settings.email.smtp_port', '', ['settings.email.port_hint'], 'server.config'],
	[
		'email',
		'email-smtp-secure',
		'settings.email.secure_label',
		'',
		['settings.email.secure_hint'],
		'server.config'
	],
	[
		'email',
		'email-smtp-auth',
		'settings.email.auth_label',
		'',
		['settings.email.auth_hint'],
		'server.config'
	],
	['email', 'email-smtp-user', 'settings.email.smtp_user', '', [], 'server.config'],
	['email', 'email-smtp-pass', 'settings.email.smtp_pass', '', ['settings.email.pass_hint'], 'server.config'],
	['email', 'email-smtp-from', 'settings.email.smtp_from', '', ['settings.email.from_hint'], 'server.config'],
	[
		'email',
		'email-smtp-alert',
		'settings.email.alert_email',
		'',
		['settings.email.alert_email_hint'],
		'server.config'
	],
	['time', 'time-billing-timezone', 'settings.time.billing_timezone', '', [], 'server.config'],
	[
		'time',
		'time-billing-timezone-custom',
		'settings.time.custom_zone_label',
		'',
		['settings.time.custom_timezone_hint'],
		'server.config'
	],
	[
		'time',
		'time-clock-ntp-servers',
		'settings.time.servers_label',
		'',
		['settings.time.servers_hint'],
		'server.config'
	],
	[
		'time',
		'time-clock-require-sync',
		'commercialization.clock.require_sync',
		'',
		['settings.time.require_sync_hint'],
		'server.config'
	],
	[
		'time',
		'time-clock-max-skew',
		'settings.time.max_skew_label',
		'',
		['settings.time.max_skew_hint'],
		'server.config'
	],
	[
		'time',
		'time-clock-trust-os',
		'settings.time.trust_os_label',
		'',
		['settings.time.trust_os_hint'],
		'server.config'
	],
	['time', 'time-clock-offset', 'commercialization.clock.status_offset', '', [], 'server.config'],
	['time', 'time-clock-ntp-server', 'commercialization.clock.status_server', '', [], 'server.config'],
	['time', 'time-clock-os-sync', 'commercialization.clock.status_os', '', [], 'server.config'],
	['time', 'time-clock-last-error', 'commercialization.clock.status_error', '', [], 'server.config'],
	['advanced', 'advanced-restart-zone', 'settings.advanced_tab.restart_title', '', [], 'server.config']
];

/** Space-separated element ids per tab, for #<id> links into another tab */
export const TAB_IDS: Readonly<Record<string, string>> = {
	general:
		'availability-history-enabled availability-history-form availability-history-retention availability-history-settings-panel availability-retention-group availability-title conn-allow-shared-nat-initiator conn-logged-in-only-initiator conn-mode-p2p conn-mode-relay conn-operator-only-outbound conn-p2p-fallback-ms conn-same-nat-relay connection-diagram connection-diagram-title connection-mode-effect connection-mode-fields connection-mode-form connection-mode-info connection-mode-section connection-mode-source connection-mode-title db-path device-scope-form device-scope-open device-scope-restricted device-scope-settings-panel device-scope-title device-scope-warning general-form general-save go-server-version mesh-agents-online mesh-body mesh-cert-banner mesh-cert-state mesh-copy-server-id mesh-download-msh mesh-group-add mesh-groups-form mesh-groups-list mesh-groups-status mesh-groups-title mesh-install mesh-msh-name mesh-recordings mesh-recordings-table mesh-server-id mesh-settings-panel mesh-state mesh-status-enabled mesh-title public-api-url public-endpoints public-endpoints-form public-endpoints-title public-relay-server public-server-id server-info server-info-title uptime',
	branding:
		'agent-bg-color agent-bg-color-panel agent-bg-color-picker agent-bg-file-name agent-bg-gradient agent-bg-gradient-panel agent-bg-image-file agent-bg-image-panel agent-bg-image-url agent-bg-upload-status agent-show-powered bg-blur bg-blur-value bg-color bg-color-panel bg-color-picker bg-effects-group bg-file-name bg-gradient bg-gradient-panel bg-image-file bg-image-library bg-image-panel bg-image-url bg-overlay bg-overlay-group bg-overlay-value bg-size bg-upload-status brand-description brand-name branding-agent branding-agent-title branding-background branding-background-title branding-builtin-themes branding-colors-title branding-css branding-css-title branding-custom-colors branding-danger-title branding-export-btn branding-fonts branding-fonts-title branding-footer branding-footer-title branding-form branding-identity branding-identity-title branding-ie-status branding-ie-title branding-import-export branding-import-input branding-login branding-login-title branding-profile-apply-btn branding-profile-delete-btn branding-profile-duplicate-btn branding-profile-menu branding-profile-new-btn branding-profile-save-btn branding-profile-select branding-profile-status branding-profiles branding-profiles-title branding-rdclient branding-rdclient-title branding-readability-alert branding-readability-text branding-reset-btn branding-revert-btn branding-save-btn branding-theme branding-theme-apply branding-theme-gallery branding-theme-select branding-theme-title branding-toc color-accentBlue color-accentGreen color-accentPurple color-accentRed color-accentYellow color-bgElevated color-bgPrimary color-bgSecondary color-bgTertiary color-borderPrimary color-borderSecondary color-textPrimary color-textSecondary custom-css font-body-clear font-body-current font-body-dropdown font-body-search font-body-slot font-body-value font-heading-clear font-heading-current font-heading-dropdown font-heading-search font-heading-slot font-heading-value font-local-count font-local-info font-local-list font-source-google font-source-label font-source-local font-source-upload font-upload-file font-upload-name footer-text glass-blur glass-blur-value glass-color glass-color-picker glass-enabled glass-fields glass-opacity glass-opacity-value login-bg-color login-bg-color-panel login-bg-color-picker login-bg-config login-bg-file-name login-bg-gradient login-bg-gradient-panel login-bg-image-file login-bg-image-panel login-bg-image-url login-bg-overlay login-bg-overlay-group login-bg-overlay-value login-bg-upload-status login-promo-mode-selector login-slides-add login-slides-list login-slides-max-hint login-slides-panel login-slides-restore login-subtitle login-title logo-file-name logo-icon-name logo-icon-panel logo-image-file logo-image-panel logo-image-url logo-svg-input logo-svg-panel logo-text-accent logo-text-input logo-text-panel rdclient-bg-color rdclient-bg-color-panel rdclient-bg-color-picker rdclient-bg-file-name rdclient-bg-gradient rdclient-bg-gradient-panel rdclient-bg-image-file rdclient-bg-image-panel rdclient-bg-image-url rdclient-bg-overlay rdclient-bg-overlay-group rdclient-bg-overlay-value rdclient-bg-size rdclient-bg-upload-status show-powered theme-mode-selector',
	auth: 'account-password auth-panel-ldap auth-panel-oidc auth-panel-totp client-sessions-expiry-days client-sessions-form client-sessions-max-days client-sessions-max-group client-sessions-settings-section client-sessions-sliding confirm-password current-password enrollment-pending-hint enrollment-rich-approve enrollment-settings-section enrollment-tag-picker for-everyone-title ldap-attrs ldap-base-dn ldap-bind-dn ldap-bind-password ldap-bind-search-fields ldap-config-fields ldap-conn-timeout ldap-default-role ldap-direct-bind ldap-direct-bind-dn ldap-direct-bind-fields ldap-enabled ldap-form ldap-group-attr-name ldap-group-base-dn ldap-group-filter ldap-group-role-map ldap-host ldap-port ldap-skip-tls-verify ldap-start-tls ldap-test-btn ldap-test-result ldap-use-tls ldap-user-attr-email ldap-user-attr-id ldap-user-attr-name ldap-user-filter new-password oidc-allow-signup oidc-allowed-private-cidrs oidc-authorization-url oidc-auto-discovery oidc-claim-email oidc-claim-groups oidc-claim-name oidc-claim-username oidc-claims oidc-client-id oidc-client-secret oidc-config-fields oidc-default-role oidc-display-name oidc-enabled oidc-form oidc-group-role-map oidc-issuer-url oidc-manual-endpoints oidc-panel-url oidc-prefer-sso oidc-redirect-url oidc-redirect-url-warning oidc-scopes oidc-test-btn oidc-test-result oidc-token-url oidc-use-pkce oidc-userinfo-url password-form password-requirements req-length req-lowercase req-number req-uppercase totp-status-container your-account-title',
	backup:
		'backup-contents-title backup-create backup-create-title backup-download-btn backup-download-status backup-restore backup-restore-title backup-smb-domain backup-smb-host backup-smb-mount-path backup-smb-password backup-smb-share backup-smb-status backup-smb-test-btn backup-smb-username backup-stat-backend backup-stat-database backup-stat-env backup-stat-folders backup-stat-groups backup-stat-keys backup-stat-settings backup-stat-strategies backup-stat-uploads backup-stat-users backup-stats restore-actions restore-database restore-env restore-file-hint restore-file-input restore-godb restore-json-note restore-options restore-options-hint restore-result restore-secrets restore-start-btn restore-status restore-uploads scheduled-backup-destination-type scheduled-backup-details scheduled-backup-enabled scheduled-backup-form scheduled-backup-interval scheduled-backup-panel scheduled-backup-path scheduled-backup-path-group scheduled-backup-retention scheduled-backup-run-btn scheduled-backup-smb-form scheduled-backup-smb-panel scheduled-backup-status scheduled-backup-test-btn scheduled-backup-title smb-title',
	updates:
		'backup-prune-now backup-retention-input backup-retention-save backup-summary update-alerts update-available-heading update-backup-toggle update-backups-list update-backups-panel update-changelog update-channel-active-badge update-channel-branch update-channel-development update-channel-docker-hint update-channel-effect update-channel-panel update-channel-select update-channel-stable update-channel-title update-check-btn update-details-section update-docker-commands update-docker-desc update-docker-images update-docker-info update-docker-install-note update-files-summary update-install-blocked-hint update-install-btn update-local-version update-progress update-progress-fill update-progress-text update-rebuild-server-btn update-remote-version update-stale-detail update-stale-warning update-status-badge update-status-desc update-status-headline update-status-row updates-side-title',
	email:
		'email-smtp-alert email-smtp-auth email-smtp-auth-fields email-smtp-form email-smtp-from email-smtp-host email-smtp-pass email-smtp-port email-smtp-save-btn email-smtp-secure email-smtp-user email-title',
	time: 'time-billing-month-hint time-billing-timezone time-billing-timezone-custom time-check-status time-clock-advanced time-clock-detail time-clock-last-error time-clock-max-skew time-clock-ntp-server time-clock-ntp-servers time-clock-offset time-clock-os-sync time-clock-require-sync time-clock-settings-form time-clock-trust-os time-custom-zone time-detect-timezone-btn time-ntp-title time-save-clock-settings-btn time-side-title time-timesync-check-btn time-zone-now time-zone-title',
	advanced:
		'advanced-config-file-list advanced-config-meta advanced-config-path advanced-config-placeholder advanced-config-reload advanced-config-restart advanced-config-restart-hint advanced-config-save advanced-config-textarea advanced-config-toolbar advanced-files-label advanced-restart-desc advanced-restart-title advanced-restart-zone advanced-title'
};
