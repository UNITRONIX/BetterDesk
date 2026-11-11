/**
 * BetterDesk Console — UX 3.6 navigation model.
 *
 * One list feeds the desktop sidebar, the breadcrumb hints, the mobile
 * drawer and the global search (Ctrl+K). The grouping follows the redesign
 * contributed by @rathlinus (issue #493 / PR #495), but every entry keeps the
 * route, the RBAC permission and the panel-access section used by the current
 * console, so a role sees exactly the pages it could open before.
 *
 * `section` is the panel access key (routes + middleware/panelAccess.js).
 * `perm` is the legacy RBAC permission (middleware/auth.js).
 * `when` can add an extra check (role-based routes).
 * `core` marks the pages that stay visible in the sidebar; the rest sit under
 * the section's own "More" row, exactly like the redesign.
 * `keywords` are extra search words (English, plus the older page names), so
 * "keys" or "dataguard" find the page even after it moved into a group.
 */

'use strict';

const ADMIN_ROLES = new Set(['super_admin', 'admin', 'global_admin', 'server_admin']);

const always = () => true;
const adminRole = ({ role }) => ADMIN_ROLES.has(role);

const SECTIONS = [
    {
        id: 'devices',
        label: 'nav.section_devices',
        icon: 'devices',
        pages: [
            { page: 'dashboard', section: 'dashboard', href: '/', label: 'nav.dashboard', icon: 'dashboard', core: true, keywords: 'home dashboard start overview' },
            { page: 'devices', section: 'devices', href: '/devices', label: 'nav.devices', icon: 'devices', core: true, keywords: 'computers peers machines connect list' },
            {
                page: 'registrations', section: 'registrations', href: '/registrations', label: 'nav.registrations',
                icon: 'how_to_reg', core: true, badgeId: 'reg-sidebar-badge',
                keywords: 'enrollment approve new device registration pending',
            },
            {
                page: 'activate-agent', section: 'registrations', href: '/?activateAgent=1', label: 'nav.pair_agent',
                icon: 'pin', id: 'nav-activate-agent', keywords: 'qr agent activation pair code',
            },
            { page: 'remote', section: 'remote', href: '/remote', label: 'nav.remote', icon: 'connected_tv', core: true, external: true, keywords: 'web client browser remote control desktop' },
            { page: 'inventory', section: 'devices', perm: 'device.view', href: '/inventory', label: 'nav.inventory', icon: 'inventory_2', keywords: 'hardware software assets' },
            { page: 'network', section: 'network', href: '/network', label: 'nav.network', icon: 'lan', keywords: 'ping monitor latency targets checks' },
            { page: 'fleet', section: 'fleet', href: '/fleet', label: 'nav.fleet', icon: 'hub', keywords: 'fleet bulk tasks workflows compliance' },
            { page: 'cross-platform', section: 'cross-platform', href: '/cross-platform', label: 'nav.cross_platform', icon: 'devices_other', keywords: 'cross-platform matrix features os' },
            { page: 'cdap', section: 'cdap', href: '/cdap', label: 'nav.cdap', icon: 'developer_board', keywords: 'cdap iot scada sensors gateway devices' },
        ],
    },
    {
        id: 'support',
        label: 'nav.section_support',
        icon: 'support_agent',
        pages: [
            { page: 'help-requests', section: 'help-requests', href: '/help-requests', label: 'nav.help_requests', icon: 'support_agent', core: true, keywords: 'help support requests assist' },
            { page: 'tickets', section: 'tickets', href: '/tickets', label: 'nav.tickets', icon: 'confirmation_number', core: true, keywords: 'tickets issues helpdesk cases' },
            { page: 'chat', section: 'chat', href: '/chat', label: 'nav.chat', icon: 'chat', core: true, keywords: 'chat messages conversation' },
            { page: 'toolkit', section: 'toolkit', href: '/toolkit', label: 'nav.toolkit', icon: 'handyman', keywords: 'toolkit ping dns port ssl diagnostics' },
        ],
    },
    {
        id: 'people',
        label: 'nav.section_people',
        icon: 'group',
        pages: [
            { page: 'users', section: 'users', href: '/users', label: 'nav.users', icon: 'group', core: true, keywords: 'users accounts people operators' },
            { page: 'organizations', section: 'organizations', href: '/organizations', label: 'nav.organizations', icon: 'corporate_fare', keywords: 'organizations tenants customers companies' },
            { page: 'permissions', section: 'permissions', href: '/permissions', label: 'nav.permissions', icon: 'admin_panel_settings', keywords: 'permissions roles rights access' },
        ],
    },
    {
        id: 'activity',
        label: 'nav.activity',
        icon: 'history',
        pages: [
            { page: 'security-audit', section: 'security-audit', href: '/security-audit', label: 'nav.security_audit', icon: 'security', core: true, keywords: 'audit log security events who banned' },
            { page: 'activity', section: 'activity', href: '/activity', label: 'activity.title', icon: 'timeline', keywords: 'activity app usage monitoring' },
            { page: 'reports', section: 'reports', href: '/reports', label: 'nav.reports', icon: 'assessment', keywords: 'reports export trends charts' },
            {
                page: 'commercialization:sessions', section: 'commercialization', href: '/commercialization?tab=sessions',
                label: 'commercialization.tabs.sessions', icon: 'schedule',
                keywords: 'sessions billing minutes work reports',
            },
        ],
    },
    {
        id: 'settings',
        label: 'nav.settings',
        icon: 'settings',
        pages: [
            { page: 'settings:general', section: 'settings', href: '/settings', label: 'settings.tab_general', icon: 'tune', core: true, group: 'nav.group_console', keywords: 'settings general relay address public endpoints connection strategy meshcentral' },
            { page: 'settings:branding', section: 'settings', href: '/settings?tab=branding', label: 'settings.tab_branding', icon: 'palette', group: 'nav.group_console', keywords: 'branding theme colours colors logo dark light mode' },
            { page: 'settings:auth', section: 'settings', href: '/settings?tab=auth', label: 'settings.tab_auth', icon: 'admin_panel_settings', group: 'nav.group_console', keywords: 'authentication password 2fa two-factor totp ldap sso oidc' },
            { page: 'settings:backup', section: 'settings', perm: 'server.config', href: '/settings?tab=backup', label: 'settings.tab_backup', icon: 'backup', group: 'nav.group_console', keywords: 'backup restore snapshot' },
            { page: 'settings:updates', section: 'settings', perm: 'server.config', href: '/settings?tab=updates', label: 'updates.tab_title', icon: 'system_update', group: 'nav.group_console', keywords: 'updates update version upgrade release channel' },
            { page: 'settings:email', section: 'settings', perm: 'server.config', href: '/settings?tab=email', label: 'settings.tab_email', icon: 'email', group: 'nav.group_console', keywords: 'email smtp mail notifications' },
            { page: 'settings:time', section: 'settings', perm: 'server.config', href: '/settings?tab=time', label: 'settings.tab_time', icon: 'schedule', group: 'nav.group_console', keywords: 'time zone timezone ntp clock' },
            { page: 'settings:advanced', section: 'settings', perm: 'server.config', href: '/settings?tab=advanced', label: 'settings.tab_advanced', icon: 'code', group: 'nav.group_console', keywords: 'advanced environment config files restart' },
            { page: 'languages', section: 'languages', href: '/languages', label: 'nav.languages', icon: 'translate', group: 'nav.group_console', keywords: 'languages translations i18n locale' },
            { page: 'keys', section: 'settings', href: '/keys', label: 'nav.keys', icon: 'vpn_key', core: true, group: 'nav.group_clients', keywords: 'keys public key qr client setup rustdesk config' },
            { page: 'tokens', section: 'settings', href: '/tokens', label: 'nav.tokens', icon: 'token', group: 'nav.group_clients', keywords: 'tokens enrollment mode api access' },
            { page: 'pairing', section: 'registrations', href: '/pairing', label: 'nav.pairing', icon: 'qr_code_2', group: 'nav.group_clients', keywords: 'pairing code enroll agent qr' },
            {
                page: 'agents', section: 'agents', href: '/agents', label: 'nav.agents', icon: 'support_agent',
                alsoActiveFor: ['generator'], group: 'nav.group_clients',
                keywords: 'agents installers downloads builds generator packages',
            },
            { page: 'client-branding', section: 'settings', href: '/client-branding', label: 'nav.client_branding', icon: 'branding_watermark', group: 'nav.group_clients', keywords: 'client branding white label' },
            { page: 'policies', section: 'settings', href: '/policies', label: 'nav.policies', icon: 'policy', group: 'nav.group_rules', keywords: 'policies rules guardrails' },
            {
                page: 'strategies', section: 'strategies', href: '/strategies', label: 'devices.strategies_title',
                icon: 'policy', group: 'nav.group_rules',
                keywords: 'strategies access control rustdesk pro security policy user group device group',
            },
            { page: 'automation', section: 'automation', href: '/automation', label: 'nav.automation', icon: 'smart_toy', group: 'nav.group_rules', keywords: 'automation alerts rules commands' },
            { page: 'resource-control', section: 'resource-control', href: '/resource-control', label: 'nav.resource_control', icon: 'tune', group: 'nav.group_rules', keywords: 'resource control limits usb drives disks' },
            { page: 'dataguard', section: 'dataguard', href: '/dataguard', label: 'nav.dataguard', icon: 'shield', group: 'nav.group_rules', keywords: 'dataguard dlp data loss prevention' },
            { page: 'attestation', section: 'server-attestation', href: '/attestation', label: 'nav.attestation', icon: 'fingerprint', group: 'nav.group_rules', keywords: 'attestation fingerprint device identity' },
            {
                page: 'server-management:overview', section: 'server-management', href: '/server-management?tab=overview',
                label: 'server_mgmt.tab_overview', icon: 'monitoring', core: true, group: 'nav.group_server',
                keywords: 'server status health cpu memory disk uptime overview',
            },
            {
                page: 'server-management:terminal', section: 'server-management', perm: 'server.config', href: '/server-management?tab=terminal',
                label: 'server_mgmt.tab_terminal', icon: 'terminal', group: 'nav.group_server', keywords: 'terminal shell console command line',
            },
            {
                page: 'server-management:files', section: 'server-management', perm: 'server.config', href: '/server-management?tab=files',
                label: 'server_mgmt.tab_files', icon: 'folder_open', group: 'nav.group_server', keywords: 'files file browser server filesystem',
            },
            {
                page: 'server-management:services', section: 'server-management', perm: 'server.config', href: '/server-management?tab=services',
                label: 'server_mgmt.tab_services', icon: 'home_repair_service', beta: true, group: 'nav.group_server',
                keywords: 'services systemd restart unit',
            },
            { page: 'scaling', section: 'scaling', href: '/scaling', label: 'nav.scaling', icon: 'cell_tower', group: 'nav.group_server', keywords: 'scaling relays nodes capacity' },
            {
                page: 'server-attestation', section: 'server-attestation', href: '/server-attestation',
                label: 'nav.server_attestation', icon: 'verified', group: 'nav.group_server',
                keywords: 'server attestation benchmark performance badge',
            },
            {
                page: 'commercialization:packages', section: 'commercialization', href: '/commercialization?tab=packages',
                label: 'commercialization.tabs.packages', icon: 'inventory_2', group: 'nav.group_billing',
                keywords: 'commercialization packages contracts billing pricing',
            },
            { page: 'cdap-studio', section: 'cdap', href: '/cdap-studio', label: 'nav.sdk_studio', icon: 'account_tree', when: adminRole, group: 'nav.group_developer', keywords: 'sdk studio flows widgets developer' },
        ],
    },
];

/** Page key used for the active state (settings/server tab aware). */
function pageKey(currentPage, currentTab, activateAgentNav) {
    if (activateAgentNav) return 'activate-agent';
    if (currentPage === 'settings') return 'settings:' + (currentTab || 'general');
    if (currentPage === 'server-management') return 'server-management:' + (currentTab || 'overview');
    if (currentPage === 'commercialization') {
        const tab = currentTab || 'packages';
        return 'commercialization:' + (tab === 'sessions' || tab === 'reports' ? 'sessions' : 'packages');
    }
    return currentPage || '';
}

/** Resolve one page entry into the shape views and the search index read. */
function resolvePage(p, translate, key) {
    const active = p.page === key || (p.alsoActiveFor || []).includes(key);
    return {
        page: p.page,
        section: p.section,
        href: p.href,
        label: translate(p.label),
        icon: p.icon,
        group: p.group ? translate(p.group) : '',
        groupKey: p.group || '',
        external: !!p.external,
        beta: !!p.beta,
        core: !!p.core,
        keywords: p.keywords || '',
        badgeId: p.badgeId || '',
        id: p.id || '',
        active,
    };
}

/**
 * Build the visible navigation for one request.
 *
 * @param {object} options
 * @param {function} options.t           translation helper
 * @param {function} options.allows      (page) => boolean, panel access check
 * @param {function} options.can         (permission) => boolean
 * @param {string}  options.role
 * @param {string}  options.currentPage
 * @param {string}  options.currentTab
 * @param {boolean} options.activateAgentNav
 */
function buildNav({ t, allows, can, role, currentPage, currentTab, activateAgentNav }) {
    const translate = typeof t === 'function' ? t : (key) => key;
    const allow = typeof allows === 'function' ? allows : () => true;
    const canDo = typeof can === 'function' ? can : () => true;
    const ctx = { role: role || '', can: canDo };
    const key = pageKey(currentPage, currentTab, activateAgentNav);

    let activeSection = null;
    let activePage = null;

    const sections = SECTIONS.map((section) => {
        const pages = section.pages
            .filter((p) => (!p.when || p.when(ctx)) && (!p.perm || canDo(p.perm)) && allow(p))
            .map((p) => {
                const item = resolvePage(p, translate, key);
                if (item.active) activePage = item;
                return item;
            });
        const out = {
            id: section.id,
            icon: section.icon,
            label: translate(section.label),
            pages,
            active: pages.some((p) => p.active),
        };
        if (out.active) activeSection = out;
        return out;
    }).filter((s) => s.pages.length > 0);

    return { sections, activeSection, activePage };
}

/**
 * Flat search index for the global search dialog.
 *
 * Only pages the current request may open are returned, so the client cannot
 * use the index to learn about a page its role cannot reach. `searchPages` is
 * rendered into the page as `window.BetterDesk.searchPages`.
 */
function buildSearchPages({ t, allows, can, role }) {
    const translate = typeof t === 'function' ? t : (key) => key;
    const allow = typeof allows === 'function' ? allows : () => true;
    const canDo = typeof can === 'function' ? can : () => true;
    const ctx = { role: role || '', can: canDo };

    const out = [];
    SECTIONS.forEach((section) => {
        section.pages
            .filter((p) => (!p.when || p.when(ctx)) && (!p.perm || canDo(p.perm)) && allow(p))
            .forEach((p) => {
                out.push({
                    text: translate(p.label),
                    section: translate(section.label),
                    group: p.group ? translate(p.group) : '',
                    keywords: p.keywords || '',
                    icon: p.icon,
                    href: p.href,
                    external: !!p.external,
                });
            });
    });
    return out;
}

module.exports = { SECTIONS, buildNav, buildSearchPages, pageKey };
