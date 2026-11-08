/**
 * Console navigation: five top-level sections, each with its pages.
 *
 * The sidebar, the breadcrumb and the mobile drawer all read this list.
 * Each page lists the permission check the old sidebar used for it, so a
 * role sees the same pages as before; only the grouping changed. A section
 * is shown when at least one of its pages is visible.
 *
 * `when` receives { can, isSuperAdmin } where can(perm) is the request's
 * permission check.
 */

'use strict';

const always = () => true;
const perm = (p) => ({ can }) => can(p);
const anyPerm = (...ps) => ({ can }) => ps.some((p) => can(p));

const SECTIONS = [
    {
        id: 'devices',
        label: 'nav.devices',
        icon: 'devices',
        pages: [
            { page: 'dashboard', href: '/', label: 'nav.dashboard', when: always },
            { page: 'devices', href: '/devices', label: 'folders.all_devices', when: perm('device.view') },
            { page: 'registrations', href: '/registrations', label: 'nav.registrations', when: perm('enrollment.approve'), countId: 'reg-sidebar-badge' },
            { page: 'activate-agent', href: '/?activateAgent=1', label: 'nav.activate_agent', when: perm('enrollment.approve'), id: 'nav-activate-agent' },
            { page: 'remote', href: '/remote', label: 'nav.remote', when: perm('device.connect'), external: true },
            { page: 'inventory', href: '/inventory', label: 'nav.inventory', when: perm('device.view') },
            { page: 'network', href: '/network', label: 'nav.network', when: perm('device.view') },
            { page: 'fleet', href: '/fleet', label: 'nav.fleet', when: perm('org.manage_devices') },
            { page: 'cross-platform', href: '/cross-platform', label: 'nav.cross_platform', when: perm('device.view') },
            { page: 'cdap', href: '/cdap', label: 'nav.cdap', when: perm('cdap.view') },
        ],
    },
    {
        // In the card sort every tester put these four together as support work
        id: 'support',
        label: 'nav.section_support',
        icon: 'support_agent',
        pages: [
            { page: 'help-requests', href: '/help-requests', label: 'nav.help_requests', when: perm('device.view') },
            { page: 'tickets', href: '/tickets', label: 'nav.tickets', when: perm('device.view') },
            { page: 'chat', href: '/chat', label: 'nav.chat', when: always },
            { page: 'toolkit', href: '/toolkit', label: 'nav.toolkit', when: perm('device.connect') },
        ],
    },
    {
        id: 'people',
        label: 'nav.section_people',
        icon: 'group',
        pages: [
            { page: 'users', href: '/users', label: 'nav.users', when: perm('user.view') },
            { page: 'organizations', href: '/organizations', label: 'nav.organizations', when: anyPerm('org.create', 'org.edit', 'org.manage_users') },
            { page: 'permissions', href: '/permissions', label: 'nav.permissions', when: ({ isSuperAdmin }) => isSuperAdmin },
        ],
    },
    {
        id: 'activity',
        label: 'nav.activity',
        icon: 'history',
        pages: [
            { page: 'security-audit', href: '/security-audit', label: 'nav.security_audit', when: perm('audit.view') },
            { page: 'activity', href: '/activity', label: 'activity.title', when: perm('audit.view') },
            { page: 'reports', href: '/reports', label: 'nav.reports', when: perm('audit.view') },
            { page: 'commercialization:sessions', href: '/commercialization?tab=sessions', label: 'commercialization.tabs.sessions', when: perm('billing.view') },
        ],
    },
    {
        // Pages carry a group; the sidebar prints a small heading where the group changes
        id: 'settings',
        label: 'nav.settings',
        icon: 'settings',
        pages: [
            { page: 'settings:general', href: '/settings', label: 'settings.tab_general', when: always, group: 'nav.group_console' },
            { page: 'settings:branding', href: '/settings?tab=branding', label: 'settings.tab_branding', when: always, group: 'nav.group_console' },
            { page: 'settings:auth', href: '/settings?tab=auth', label: 'settings.tab_auth', when: always, group: 'nav.group_console' },
            { page: 'settings:backup', href: '/settings?tab=backup', label: 'settings.tab_backup', when: always, group: 'nav.group_console' },
            { page: 'settings:updates', href: '/settings?tab=updates', label: 'updates.tab_title', when: always, group: 'nav.group_console' },
            { page: 'settings:email', href: '/settings?tab=email', label: 'settings.tab_email', when: always, group: 'nav.group_console' },
            { page: 'settings:time', href: '/settings?tab=time', label: 'settings.tab_time', when: always, group: 'nav.group_console' },
            { page: 'settings:advanced', href: '/settings?tab=advanced', label: 'settings.tab_advanced', when: always, group: 'nav.group_console' },
            { page: 'languages', href: '/languages', label: 'nav.languages', when: perm('server.config'), group: 'nav.group_console' },
            { page: 'keys', href: '/keys', label: 'nav.keys', when: perm('server.config'), group: 'nav.group_clients' },
            { page: 'tokens', href: '/tokens', label: 'nav.tokens', when: perm('enrollment.manage'), group: 'nav.group_clients' },
            { page: 'pairing', href: '/pairing', label: 'nav.pairing', when: perm('enrollment.approve'), group: 'nav.group_clients' },
            { page: 'agents', href: '/agents', label: 'nav.agents', when: perm('server.config'), alsoActiveFor: ['generator'], group: 'nav.group_clients' },
            { page: 'client-branding', href: '/client-branding', label: 'nav.client_branding', when: perm('branding.edit'), group: 'nav.group_clients' },
            { page: 'policies', href: '/policies', label: 'nav.policies', when: perm('server.config'), group: 'nav.group_rules' },
            { page: 'automation', href: '/automation', label: 'nav.automation', when: perm('server.config'), group: 'nav.group_rules' },
            { page: 'resource-control', href: '/resource-control', label: 'nav.resource_control', when: perm('server.config'), group: 'nav.group_rules' },
            { page: 'dataguard', href: '/dataguard', label: 'nav.dataguard', when: perm('server.config'), group: 'nav.group_rules' },
            { page: 'attestation', href: '/attestation', label: 'nav.attestation', when: perm('server.config'), group: 'nav.group_rules' },
            { page: 'server-management:overview', href: '/server-management?tab=overview', label: 'nav.server_status', when: perm('server.config'), group: 'nav.group_server' },
            { page: 'server-management:terminal', href: '/server-management?tab=terminal', label: 'server_mgmt.tab_terminal', when: perm('server.config'), group: 'nav.group_server' },
            { page: 'server-management:files', href: '/server-management?tab=files', label: 'server_mgmt.tab_files', when: perm('server.config'), group: 'nav.group_server' },
            { page: 'server-management:services', href: '/server-management?tab=services', label: 'server_mgmt.tab_services', when: perm('server.config'), beta: true, group: 'nav.group_server' },
            { page: 'scaling', href: '/scaling', label: 'nav.scaling', when: perm('server.config'), group: 'nav.group_server' },
            { page: 'server-attestation', href: '/server-attestation', label: 'nav.server_attestation', when: perm('server.attestation'), group: 'nav.group_server' },
            { page: 'commercialization:packages', href: '/commercialization?tab=packages', label: 'commercialization.tabs.packages', when: perm('billing.view'), group: 'nav.group_billing' },
            { page: 'cdap-studio', href: '/cdap-studio', label: 'nav.sdk_studio', when: perm('cdap.view'), group: 'nav.group_developer' },
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
function buildNav({ can, isSuperAdmin, t, currentPage, currentTab, activateAgentNav }) {
    const key = pageKey(currentPage, currentTab, activateAgentNav);
    const ctx = { can: can || (() => false), isSuperAdmin: !!isSuperAdmin };
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
