/**
 * The console's built-in role map (middleware/auth.js) is a copy of the Go
 * server's (betterdesk-server/auth/permissions.go). It decides when the
 * effective permissions aren't loaded, so it must match Go grant for grant.
 * It had drifted (BUGS.md P21): global_admin lacked the CDAP terminal and
 * files and MeshCentral grants, operator lacked mesh.power and had
 * enrollment.approve, which Go doesn't give it.
 */

const fs = require('fs');
const path = require('path');
const { roleHasPermission } = require('../middleware/auth');

const goDir = path.join(__dirname, '..', '..', 'betterdesk-server', 'auth');
const permsGo = fs.readFileSync(path.join(goDir, 'permissions.go'), 'utf8');
const rolesGo = fs.readFileSync(path.join(goDir, 'roles.go'), 'utf8');

// PermDeviceView = "device.view"
const PERM = Object.fromEntries([...permsGo.matchAll(/\b(Perm\w+)\s*=\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
// RoleOperator = "operator"
const ROLE = Object.fromEntries([...rolesGo.matchAll(/\b(Role\w+)\s*=\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));

function goRoles() {
    const block = permsGo.slice(permsGo.indexOf('var DefaultRolePermissions'));
    const out = {};
    for (const m of block.matchAll(/\b(Role\w+):\s*buildPermMap\(([^)]*)\)/g)) {
        const names = m[2].includes('AllPermissions') ? Object.keys(PERM) : [...m[2].matchAll(/\bPerm\w+/g)].map((x) => x[0]);
        out[ROLE[m[1]]] = new Set(names.map((n) => PERM[n]));
    }
    return out;
}

describe('built-in role map matches the Go server', () => {
    const go = goRoles();
    const all = Object.values(PERM);

    test('the Go map was read', () => {
        expect(all.length).toBeGreaterThan(30);
        expect(Object.keys(go)).toEqual(expect.arrayContaining(['super_admin', 'server_admin', 'global_admin', 'operator', 'viewer', 'guest_issuer']));
    });

    test.each(['super_admin', 'admin', 'server_admin', 'global_admin', 'operator', 'viewer', 'guest_issuer', 'pro'])('%s', (role) => {
        const differences = all.filter((p) => roleHasPermission(role, p) !== go[role].has(p));
        expect(differences).toEqual([]);
    });
});
