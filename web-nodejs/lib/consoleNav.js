/**
 * Console navigation: five top-level sections, each with its pages.
 *
 * The sidebar, the breadcrumb and the mobile drawer all read this list.
 * Each page lists the permission check the old sidebar used for it, so a
 * role sees the same pages as before; only the grouping changed. A section
 * is shown when at least one of its pages is visible.
 *
 * `when` receives { can, isSuperAdmin, role } where can(perm) is the
 * request's permission check. A few routes check role names instead of
 * permissions (requireAdmin, requireRole); their pages use the same check
 * here, so the menu shows them to exactly the roles the route lets in.
 */

'use strict';

const always = () => true;
const perm = (p) => ({ can }) => can(p);
const anyPerm = (...ps) => ({ can }) => ps.some((p) => can(p));
// requireAdmin in middleware/auth.js
const ADMIN_ROLES = new Set(['super_admin', 'admin', 'global_admin', 'server_admin']);
const adminRole = ({ role }) => ADMIN_ROLES.has(role);
// requireRole(r) in middleware/auth.js: that role, or a super admin
const roleOrSuper = (r) => ({ role }) => role === r || role === 'super_admin' || role === 'admin';

const SECTIONS = [
    {
        id: 'devices',
        label: 'nav.devices',
        icon: 'devices',
        pages: [
            { page: 'dashboard', keywords: 'home dashboard start', core: true, href: '/', label: 'nav.dashboard', when: always },
            { page: 'devices', keywords: 'computers peers machines connect', core: true, href: '/devices', label: 'folders.all_devices', when: perm('device.view') },
            { page: 'registrations', keywords: 'enrollment approve new device registration pending', core: true, href: '/registrations', label: 'nav.registrations', when: perm('enrollment.approve'), countId: 'reg-sidebar-badge' },
            { page: 'activate-agent', keywords: 'qr agent activation', href: '/?activateAgent=1', label: 'nav.activate_agent', when: perm('enrollment.approve'), id: 'nav-activate-agent' },
            { page: 'remote', keywords: 'web client browser remote control', core: true, href: '/remote', label: 'nav.remote', when: perm('device.connect'), external: true },
            { page: 'inventory', keywords: 'hardware software', href: '/inventory', label: 'nav.inventory', when: perm('device.view') },
            { page: 'network', keywords: 'ping monitor latency targets', href: '/network', label: 'nav.network', when: perm('device.view') },
            { page: 'fleet', keywords: 'fleet bulk tasks workflows compliance', href: '/fleet', label: 'nav.fleet', when: perm('org.manage_devices') },
            { page: 'cross-platform', keywords: 'cross-platform matrix features os', href: '/cross-platform', label: 'nav.cross_platform', when: perm('device.view') },
            { page: 'cdap', keywords: 'cdap iot scada sensors gateway', href: '/cdap', label: 'nav.cdap', when: perm('cdap.view') },
        ],
    },
    {
        // In the card sort every tester put these four together as support work
        id: 'support',
        label: 'nav.section_support',
        icon: 'support_agent',
        pages: [
            { page: 'help-requests', keywords: 'help support requests', core: true, href: '/help-requests', label: 'nav.help_requests', when: perm('device.view') },
            { page: 'tickets', keywords: 'issues', core: true, href: '/tickets', label: 'nav.tickets', when: perm('device.view') },
            { page: 'chat', keywords: 'messages', core: true, href: '/chat', label: 'nav.chat', when: perm('chat.access') },
            { page: 'toolkit', keywords: 'toolkit ping dns port ssl diagnostics', href: '/toolkit', label: 'nav.toolkit', when: perm('device.connect') },
        ],
    },
    {
        id: 'people',
        label: 'nav.section_people',
        icon: 'group',
        pages: [
            { page: 'users', keywords: 'accounts people operators', core: true, href: '/users', label: 'nav.users', when: perm('user.view') },
            { page: 'organizations', keywords: 'tenants customers', href: '/organizations', label: 'nav.organizations', when: anyPerm('org.create', 'org.edit', 'org.manage_users') },
            { page: 'permissions', keywords: 'roles rights access', href: '/permissions', label: 'nav.permissions', when: ({ isSuperAdmin }) => isSuperAdmin },
        ],
    },
    {
        id: 'activity',
        label: 'nav.activity',
        icon: 'history',
        pages: [
            { page: 'security-audit', keywords: 'audit log who banned security events', core: true, href: '/security-audit', label: 'nav.security_audit', when: perm('audit.view') },
            { page: 'activity', keywords: 'app usage activity monitoring', href: '/activity', label: 'activity.title', when: perm('audit.view') },
            { page: 'reports', keywords: 'reports export trends', core: true, href: '/reports', label: 'nav.reports', when: perm('audit.view') },
            { page: 'commercialization:sessions', keywords: 'sessions billing minutes work reports', href: '/commercialization?tab=sessions', label: 'commercialization.tabs.sessions', when: perm('billing.view') },
        ],
    },
    {
        // Pages carry a group; the sidebar prints a small heading where the group changes
        id: 'settings',
        label: 'nav.settings',
        icon: 'settings',
        pages: [
            { page: 'settings:general', keywords: 'settings relay address public endpoints connection strategy meshcentral', core: true, href: '/settings', label: 'settings.tab_general', when: always, group: 'nav.group_console' },
            { page: 'settings:branding', keywords: 'branding theme colours colors logo dark mode', href: '/settings?tab=branding', label: 'settings.tab_branding', when: always, group: 'nav.group_console' },
            { page: 'settings:auth', keywords: 'authentication 2fa two-factor totp password ldap sso oidc', href: '/settings?tab=auth', label: 'settings.tab_auth', when: always, group: 'nav.group_console' },
            { page: 'settings:backup', keywords: 'backup restore', href: '/settings?tab=backup', label: 'settings.tab_backup', when: perm('server.config'), group: 'nav.group_console' },
            { page: 'settings:updates', keywords: 'updates version upgrade', href: '/settings?tab=updates', label: 'updates.tab_title', when: perm('server.config'), group: 'nav.group_console' },
            { page: 'settings:email', keywords: 'email smtp mail', href: '/settings?tab=email', label: 'settings.tab_email', when: perm('server.config'), group: 'nav.group_console' },
            { page: 'settings:time', keywords: 'time zone timezone ntp clock', href: '/settings?tab=time', label: 'settings.tab_time', when: perm('server.config'), group: 'nav.group_console' },
            { page: 'settings:advanced', keywords: 'advanced config files restart', href: '/settings?tab=advanced', label: 'settings.tab_advanced', when: perm('server.config'), group: 'nav.group_console' },
            { page: 'languages', keywords: 'languages translations i18n', href: '/languages', label: 'nav.languages', when: perm('server.config'), group: 'nav.group_console' },
            { page: 'keys', keywords: 'keys public key qr client setup rustdesk config', core: true, href: '/keys', label: 'nav.keys', when: always, group: 'nav.group_clients' },
            { page: 'tokens', keywords: 'tokens enrollment mode', href: '/tokens', label: 'nav.tokens', when: perm('enrollment.manage'), group: 'nav.group_clients' },
            { page: 'pairing', keywords: 'pairing code', href: '/pairing', label: 'nav.pairing', when: perm('enrollment.approve'), group: 'nav.group_clients' },
            { page: 'agents', keywords: 'agents installers generator', href: '/agents', label: 'nav.agents', when: adminRole, alsoActiveFor: ['generator'], group: 'nav.group_clients' },
            { page: 'client-branding', keywords: 'client branding white label', href: '/client-branding', label: 'nav.client_branding', when: perm('branding.edit'), group: 'nav.group_clients' },
            { page: 'policies', keywords: 'policies rules', href: '/policies', label: 'nav.policies', when: adminRole, group: 'nav.group_rules' },
            { page: 'automation', keywords: 'automation alerts commands', href: '/automation', label: 'nav.automation', when: perm('server.config'), group: 'nav.group_rules' },
            { page: 'resource-control', keywords: 'resource control usb drives disks', href: '/resource-control', label: 'nav.resource_control', when: perm('server.config'), group: 'nav.group_rules' },
            { page: 'dataguard', keywords: 'dataguard dlp data loss', href: '/dataguard', label: 'nav.dataguard', when: perm('server.config'), group: 'nav.group_rules' },
            { page: 'attestation', keywords: 'attestation fingerprint hardware identity', href: '/attestation', label: 'nav.attestation', when: adminRole, group: 'nav.group_rules' },
            { page: 'server-management:overview', keywords: 'server management status health cpu memory uptime', core: true, href: '/server-management?tab=overview', label: 'nav.server_status', when: perm('server.config'), group: 'nav.group_server' },
            { page: 'server-management:terminal', keywords: 'shell console ssh', href: '/server-management?tab=terminal', label: 'server_mgmt.tab_terminal', when: perm('server.config'), group: 'nav.group_server' },
            { page: 'server-management:files', keywords: 'file browser', href: '/server-management?tab=files', label: 'server_mgmt.tab_files', when: perm('server.config'), group: 'nav.group_server' },
            { page: 'server-management:services', keywords: 'systemd services', href: '/server-management?tab=services', label: 'server_mgmt.tab_services', when: perm('server.config'), group: 'nav.group_server' },
            { page: 'scaling', keywords: 'scaling relays', href: '/scaling', label: 'nav.scaling', when: perm('server.config'), group: 'nav.group_server' },
            { page: 'server-attestation', keywords: 'server attestation benchmark load test badge', href: '/server-attestation', label: 'nav.server_attestation', when: perm('server.attestation'), group: 'nav.group_server' },
            { page: 'commercialization:packages', keywords: 'packages contracts billing', href: '/commercialization?tab=packages', label: 'commercialization.tabs.packages', when: perm('billing.view'), group: 'nav.group_billing' },
            { page: 'cdap-studio', keywords: 'sdk studio flows widgets', href: '/cdap-studio', label: 'nav.sdk_studio', when: roleOrSuper('operator'), group: 'nav.group_developer' },
        ],
    },
];

/**
 * Turn the current page (plus tab for pages that split by tab) into the
 * key used in SECTIONS.
 */
function pageKey(currentPage, currentTab, activateAgentNav) {
    if (activateAgentNav) return 'activate-agent';
    if (currentPage === 'settings') {
        return 'settings:' + (currentTab || 'general');
    }
    if (currentPage === 'server-management') {
        return 'server-management:' + (currentTab || 'overview');
    }
    if (currentPage === 'commercialization') {
        const tab = currentTab || 'packages';
        return 'commercialization:' + (tab === 'sessions' || tab === 'reports' ? 'sessions' : 'packages');
    }
    return currentPage || '';
}

/**
 * Build the visible navigation for one request.
 * @returns {{ sections: Array, activeSection: object|null, activePage: object|null }}
 */
function buildNav({ can, isSuperAdmin, role, t, currentPage, currentTab, activateAgentNav }) {
    const key = pageKey(currentPage, currentTab, activateAgentNav);
    const ctx = { can: can || (() => false), isSuperAdmin: !!isSuperAdmin, role: role || '' };
    let activeSection = null;
    let activePage = null;

    const sections = SECTIONS.map((section) => {
        const pages = section.pages
            .filter((p) => p.when(ctx))
            .map((p) => {
                const active = p.page === key || (p.alsoActiveFor || []).includes(key);
                const item = { ...p, text: t(p.label), groupText: p.group ? t(p.group) : '', active };
                delete item.when;
                if (active) activePage = item;
                return item;
            });
        const out = { id: section.id, icon: section.icon, text: t(section.label), pages, active: pages.some((p) => p.active) };
        if (out.active) activeSection = out;
        return out;
    }).filter((s) => s.pages.length > 0);

    return { sections, activeSection, activePage };
}

module.exports = { SECTIONS, buildNav, pageKey };
