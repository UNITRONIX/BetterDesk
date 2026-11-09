/**
 * BetterDesk Console — UX 3.6 navigation model.
 *
 * One list feeds the desktop sidebar, the breadcrumb hints and the mobile
 * drawer. The grouping follows the redesign contributed by @rathlinus
 * (issue #493 / PR #495), but every entry keeps the route, the RBAC
 * permission and the panel-access section used by the current console, so a
 * role sees exactly the pages it could open before.
 *
 * `section` is the panel access key (routes + middleware/panelAccess.js).
 * `perm` is the legacy RBAC permission (middleware/auth.js).
 * `when` can add an extra check (role-based routes).
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
            { page: 'dashboard', section: 'dashboard', href: '/', label: 'nav.dashboard', icon: 'dashboard', core: true },
            { page: 'devices', section: 'devices', href: '/devices', label: 'nav.devices', icon: 'devices', core: true },
            {
                page: 'registrations', section: 'registrations', href: '/registrations', label: 'nav.registrations',
                icon: 'how_to_reg', core: true, badgeId: 'reg-sidebar-badge',
            },
            {
                page: 'activate-agent', section: 'registrations', href: '/?activateAgent=1', label: 'nav.pair_agent',
                icon: 'pin', id: 'nav-activate-agent',
            },
            { page: 'remote', section: 'remote', href: '/remote', label: 'nav.remote', icon: 'connected_tv', external: true },
            { page: 'inventory', section: 'devices', perm: 'device.view', href: '/inventory', label: 'nav.inventory', icon: 'inventory_2' },
            { page: 'network', section: 'network', href: '/network', label: 'nav.network', icon: 'lan' },
            { page: 'fleet', section: 'fleet', href: '/fleet', label: 'nav.fleet', icon: 'hub' },
            { page: 'cross-platform', section: 'cross-platform', href: '/cross-platform', label: 'nav.cross_platform', icon: 'devices_other' },
            { page: 'cdap', section: 'cdap', href: '/cdap', label: 'nav.cdap', icon: 'developer_board' },
        ],
    },
    {
        id: 'support',
        label: 'nav.section_support',
        icon: 'support_agent',
        pages: [
            { page: 'help-requests', section: 'help-requests', href: '/help-requests', label: 'nav.help_requests', icon: 'support_agent', core: true },
            { page: 'tickets', section: 'tickets', href: '/tickets', label: 'nav.tickets', icon: 'confirmation_number', core: true },
            { page: 'chat', section: 'chat', href: '/chat', label: 'nav.chat', icon: 'chat', core: true },
            { page: 'toolkit', section: 'toolkit', href: '/toolkit', label: 'nav.toolkit', icon: 'handyman' },
        ],
    },
    {
        id: 'people',
        label: 'nav.section_people',
        icon: 'group',
        pages: [
            { page: 'users', section: 'users', href: '/users', label: 'nav.users', icon: 'group', core: true },
            { page: 'organizations', section: 'organizations', href: '/organizations', label: 'nav.organizations', icon: 'corporate_fare' },
            { page: 'permissions', section: 'permissions', href: '/permissions', label: 'nav.permissions', icon: 'admin_panel_settings' },
        ],
    },
    {
        id: 'activity',
        label: 'nav.activity',
        icon: 'history',
        pages: [
            { page: 'security-audit', section: 'security-audit', href: '/security-audit', label: 'nav.security_audit', icon: 'security', core: true },
            { page: 'activity', section: 'activity', href: '/activity', label: 'activity.title', icon: 'timeline' },
            { page: 'reports', section: 'reports', href: '/reports', label: 'nav.reports', icon: 'assessment' },
            {
                page: 'commercialization:sessions', section: 'commercialization', href: '/commercialization?tab=sessions',
                label: 'commercialization.tabs.sessions', icon: 'schedule',
            },
        ],
    },
    {
        id: 'settings',
        label: 'nav.settings',
        icon: 'settings',
        pages: [
            { page: 'settings:general', section: 'settings', href: '/settings', label: 'settings.tab_general', icon: 'tune', group: 'nav.group_console' },
            { page: 'settings:branding', section: 'settings', href: '/settings?tab=branding', label: 'settings.tab_branding', icon: 'palette', group: 'nav.group_console' },
            { page: 'settings:auth', section: 'settings', href: '/settings?tab=auth', label: 'settings.tab_auth', icon: 'admin_panel_settings', group: 'nav.group_console' },
            { page: 'settings:backup', section: 'settings', perm: 'server.config', href: '/settings?tab=backup', label: 'settings.tab_backup', icon: 'backup', group: 'nav.group_console' },
            { page: 'settings:updates', section: 'settings', perm: 'server.config', href: '/settings?tab=updates', label: 'updates.tab_title', icon: 'system_update', group: 'nav.group_console' },
            { page: 'settings:email', section: 'settings', perm: 'server.config', href: '/settings?tab=email', label: 'settings.tab_email', icon: 'email', group: 'nav.group_console' },
            { page: 'settings:time', section: 'settings', perm: 'server.config', href: '/settings?tab=time', label: 'settings.tab_time', icon: 'schedule', group: 'nav.group_console' },
            { page: 'settings:advanced', section: 'settings', perm: 'server.config', href: '/settings?tab=advanced', label: 'settings.tab_advanced', icon: 'code', group: 'nav.group_console' },
            { page: 'languages', section: 'languages', href: '/languages', label: 'nav.languages', icon: 'translate', group: 'nav.group_console' },
            { page: 'keys', section: 'settings', href: '/keys', label: 'nav.keys', icon: 'vpn_key', group: 'nav.group_clients' },
            { page: 'tokens', section: 'settings', href: '/tokens', label: 'nav.tokens', icon: 'token', group: 'nav.group_clients' },
            { page: 'pairing', section: 'registrations', href: '/pairing', label: 'nav.pairing', icon: 'qr_code_2', group: 'nav.group_clients' },
            {
                page: 'agents', section: 'agents', href: '/agents', label: 'nav.agents', icon: 'support_agent',
                alsoActiveFor: ['generator'], group: 'nav.group_clients',
            },
            { page: 'client-branding', section: 'settings', href: '/client-branding', label: 'nav.client_branding', icon: 'branding_watermark', group: 'nav.group_clients' },
            { page: 'policies', section: 'settings', href: '/policies', label: 'nav.policies', icon: 'policy', group: 'nav.group_rules' },
            { page: 'automation', section: 'automation', href: '/automation', label: 'nav.automation', icon: 'smart_toy', group: 'nav.group_rules' },
            { page: 'resource-control', section: 'resource-control', href: '/resource-control', label: 'nav.resource_control', icon: 'tune', group: 'nav.group_rules' },
            { page: 'dataguard', section: 'dataguard', href: '/dataguard', label: 'nav.dataguard', icon: 'shield', group: 'nav.group_rules' },
            { page: 'attestation', section: 'server-attestation', href: '/attestation', label: 'nav.attestation', icon: 'fingerprint', group: 'nav.group_rules' },
            {
                page: 'server-management:overview', section: 'server-management', href: '/server-management?tab=overview',
                label: 'server_mgmt.tab_overview', icon: 'monitoring', group: 'nav.group_server',
            },
            {
                page: 'server-management:terminal', section: 'server-management', perm: 'server.config', href: '/server-management?tab=terminal',
                label: 'server_mgmt.tab_terminal', icon: 'terminal', group: 'nav.group_server',
            },
            {
                page: 'server-management:files', section: 'server-management', perm: 'server.config', href: '/server-management?tab=files',
                label: 'server_mgmt.tab_files', icon: 'folder_open', group: 'nav.group_server',
            },
            {
                page: 'server-management:services', section: 'server-management', perm: 'server.config', href: '/server-management?tab=services',
                label: 'server_mgmt.tab_services', icon: 'home_repair_service', beta: true, group: 'nav.group_server',
            },
            { page: 'scaling', section: 'scaling', href: '/scaling', label: 'nav.scaling', icon: 'cell_tower', group: 'nav.group_server' },
            {
                page: 'server-attestation', section: 'server-attestation', href: '/server-attestation',
                label: 'nav.server_attestation', icon: 'verified', group: 'nav.group_server',
            },
            {
                page: 'commercialization:packages', section: 'commercialization', href: '/commercialization?tab=packages',
                label: 'commercialization.tabs.packages', icon: 'inventory_2', group: 'nav.group_billing',
            },
            { page: 'cdap-studio', section: 'cdap', href: '/cdap-studio', label: 'nav.sdk_studio', icon: 'account_tree', when: adminRole, group: 'nav.group_developer' },
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
                const active = p.page === key || (p.alsoActiveFor || []).includes(key);
                const item = {
                    page: p.page,
                    href: p.href,
                    label: translate(p.label),
                    icon: p.icon,
                    group: p.group ? translate(p.group) : '',
                    external: !!p.external,
                    beta: !!p.beta,
                    badgeId: p.badgeId || '',
                    id: p.id || '',
                    active,
                };
                if (active) activePage = item;
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

module.exports = { SECTIONS, buildNav, pageKey };
