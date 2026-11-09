/**
 * The navigation shows a page to exactly the roles its route lets in.
 * Agents, Policies and Device identity check requireAdmin (super_admin,
 * admin, global_admin, server_admin); the Flow builder checks
 * requireRole('operator') (operator, super_admin, admin). Showing them by a
 * permission instead hid working pages from global_admin and showed a 403
 * page to viewers and global admins.
 */

const { buildNav } = require('../lib/consoleNav');
const { roleHasPermission, isSuperAdminRole } = require('../middleware/auth');

function pagesFor(role) {
    const nav = buildNav({
        can: (p) => roleHasPermission(role, p),
        isSuperAdmin: isSuperAdminRole(role),
        role,
        t: (k) => k,
        currentPage: '',
        currentTab: ''
    });
    return new Set(nav.sections.flatMap((s) => s.pages.map((p) => p.page)));
}

describe('console navigation follows the route guards', () => {
    test.each(['super_admin', 'admin', 'global_admin', 'server_admin'])('%s sees Agents, Policies and Device identity', (role) => {
        const pages = pagesFor(role);
        expect(pages.has('agents')).toBe(true);
        expect(pages.has('policies')).toBe(true);
        expect(pages.has('attestation')).toBe(true);
    });

    test.each(['operator', 'viewer'])('%s does not see Agents, Policies or Device identity', (role) => {
        const pages = pagesFor(role);
        expect(pages.has('agents')).toBe(false);
        expect(pages.has('policies')).toBe(false);
        expect(pages.has('attestation')).toBe(false);
    });

    test.each([
        ['operator', true],
        ['super_admin', true],
        ['admin', true],
        ['global_admin', false],
        ['server_admin', false],
        ['viewer', false]
    ])('%s sees the Flow builder: %s', (role, shown) => {
        expect(pagesFor(role).has('cdap-studio')).toBe(shown);
    });

    test.each([
        ['operator', true],
        ['viewer', true],
        ['global_admin', true],
        ['server_admin', false]
    ])('%s sees Chat (chat.access, as the chat socket needs): %s', (role, shown) => {
        expect(pagesFor(role).has('chat')).toBe(shown);
    });

    // GET /keys and its API need a session only; the full API key needs server.keys on its own
    test.each(['super_admin', 'admin', 'global_admin', 'server_admin', 'operator', 'viewer'])(
        '%s sees Client setup, which every signed-in role may open',
        (role) => {
            expect(pagesFor(role).has('keys')).toBe(true);
        }
    );

    test('without a role, role-guarded pages stay hidden', () => {
        const nav = buildNav({ can: () => true, isSuperAdmin: false, t: (k) => k, currentPage: '', currentTab: '' });
        const pages = new Set(nav.sections.flatMap((s) => s.pages.map((p) => p.page)));
        expect(pages.has('agents')).toBe(false);
        expect(pages.has('cdap-studio')).toBe(false);
    });
});
