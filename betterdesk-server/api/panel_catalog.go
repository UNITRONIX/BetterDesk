package api

// Panel authorization catalog.
//
// The console needs three things to draw its navigation and enforce access:
//
//   - the list of panel sections (key, group, read/write permission);
//   - the default permission set of every role;
//   - the permission strings that exist at all (so a policy cannot name a
//     permission the server will never honour).
//
// All three are defined here, in the package that already owns permissions,
// and served to the console. That removes the second copy of the role map the
// community review pointed at (discussion #496): the panel may cache this, but
// it no longer decides it.
//
// Route: GET /api/panel/catalog — any signed-in principal, because every role
// needs it to render its own navigation.

import (
	"net/http"
	"sort"

	"github.com/unitronix/betterdesk-server/auth"
)

// panelSection is one entry of the console's navigation contract.
type panelSection struct {
	Key             string `json:"key"`
	Label           string `json:"label"`
	Group           string `json:"group"`
	ReadPermission  string `json:"read_permission,omitempty"`
	WritePermission string `json:"write_permission,omitempty"`
}

// panelSectionCatalog mirrors web-nodejs/lib/panelAccessCatalog.js.
//
// The keys are the panel access section names used by routes and middleware;
// read/write permissions are the existing RBAC permissions, so an old role is
// always a safe upper bound for a finer policy. tests/panelCatalogParity.test.js
// keeps this list and the console's file identical.
var panelSectionCatalog = []panelSection{
	{Key: "dashboard", Label: "Dashboard", Group: "core", ReadPermission: auth.PermDeviceView},
	{Key: "devices", Label: "Devices", Group: "core", ReadPermission: auth.PermDeviceView, WritePermission: auth.PermDeviceEdit},
	{Key: "registrations", Label: "Registrations", Group: "core", ReadPermission: auth.PermEnrollmentApprove, WritePermission: auth.PermEnrollmentManage},
	{Key: "remote", Label: "Remote access", Group: "core", ReadPermission: auth.PermRemoteTargetView, WritePermission: auth.PermRemoteTargetConnect},
	{Key: "users", Label: "Users", Group: "administration", ReadPermission: auth.PermUserView, WritePermission: auth.PermUserEdit},
	{Key: "organizations", Label: "Organizations", Group: "administration", ReadPermission: auth.PermUserView, WritePermission: auth.PermOrgEdit},
	{Key: "folders", Label: "Folders", Group: "administration", ReadPermission: auth.PermDeviceView, WritePermission: auth.PermDeviceEdit},
	{Key: "strategies", Label: "Strategies", Group: "administration", ReadPermission: auth.PermDeviceView, WritePermission: auth.PermDeviceEdit},
	{Key: "guests", Label: "Guest access", Group: "administration", ReadPermission: auth.PermGuestCreate, WritePermission: auth.PermGuestCreate},
	{Key: "tickets", Label: "Tickets", Group: "operations", ReadPermission: auth.PermDeviceView, WritePermission: auth.PermDeviceEdit},
	{Key: "help-requests", Label: "Help requests", Group: "operations", ReadPermission: auth.PermDeviceView, WritePermission: auth.PermDeviceEdit},
	{Key: "cdap", Label: "CDAP", Group: "operations", ReadPermission: auth.PermCDAPView, WritePermission: auth.PermCDAPCommand},
	{Key: "fleet", Label: "Fleet", Group: "operations", ReadPermission: auth.PermOrgManageDevices, WritePermission: auth.PermOrgManageDevices},
	{Key: "chat", Label: "Chat", Group: "operations", ReadPermission: auth.PermChatAccess, WritePermission: auth.PermChatAccess},
	{Key: "activity", Label: "Activity", Group: "operations", ReadPermission: auth.PermAuditView},
	{Key: "automation", Label: "Automation", Group: "operations", ReadPermission: auth.PermDeviceView, WritePermission: auth.PermDeviceEdit},
	{Key: "files", Label: "File transfer", Group: "operations", ReadPermission: auth.PermDeviceView, WritePermission: auth.PermDeviceEdit},
	{Key: "network", Label: "Network", Group: "operations", ReadPermission: auth.PermServerConfig, WritePermission: auth.PermServerConfig},
	{Key: "dataguard", Label: "Data guard", Group: "operations", ReadPermission: auth.PermServerConfig, WritePermission: auth.PermServerConfig},
	{Key: "reports", Label: "Reports", Group: "operations", ReadPermission: auth.PermMetricsView},
	{Key: "agents", Label: "Agents", Group: "operations", ReadPermission: auth.PermDeviceView, WritePermission: auth.PermDeviceEdit},
	{Key: "toolkit", Label: "Toolkit", Group: "operations", ReadPermission: auth.PermDeviceConnect, WritePermission: auth.PermDeviceEdit},
	{Key: "commercialization", Label: "Commercialization", Group: "commercialization", ReadPermission: auth.PermBillingView, WritePermission: auth.PermBillingManage},
	{Key: "scaling", Label: "Scaling", Group: "commercialization", ReadPermission: auth.PermServerConfig, WritePermission: auth.PermServerConfig},
	{Key: "cross-platform", Label: "Cross-platform", Group: "commercialization", ReadPermission: auth.PermServerConfig, WritePermission: auth.PermServerConfig},
	{Key: "security-audit", Label: "Security audit", Group: "security", ReadPermission: auth.PermAuditView, WritePermission: auth.PermServerConfig},
	{Key: "languages", Label: "Languages", Group: "system", ReadPermission: auth.PermServerConfig, WritePermission: auth.PermServerConfig},
	{Key: "resource-control", Label: "Resource control", Group: "system", ReadPermission: auth.PermServerConfig, WritePermission: auth.PermServerConfig},
	{Key: "system", Label: "System", Group: "system", ReadPermission: auth.PermServerConfig, WritePermission: auth.PermServerConfig},
	{Key: "permissions", Label: "Permissions", Group: "system", ReadPermission: auth.PermServerConfig, WritePermission: auth.PermServerConfig},
	{Key: "server-management", Label: "Server management", Group: "system", ReadPermission: auth.PermServerConfig, WritePermission: auth.PermServerConfig},
	{Key: "settings", Label: "Settings", Group: "system", ReadPermission: auth.PermServerConfig, WritePermission: auth.PermServerConfig},
	{Key: "server-attestation", Label: "Server attestation", Group: "system", ReadPermission: auth.PermServerAttestation, WritePermission: auth.PermBrandingEdit},
}

// panelSectionGroups mirrors the group list the console renders.
var panelSectionGroups = []map[string]string{
	{"key": "core", "label": "Core"},
	{"key": "administration", "label": "Administration"},
	{"key": "operations", "label": "Operations"},
	{"key": "commercialization", "label": "Commercialization"},
	{"key": "security", "label": "Security"},
	{"key": "system", "label": "System"},
}

// roleDefaults returns the built-in permission list per role, sorted so the
// response is stable and diffable. The internal device principal is omitted:
// it authenticates agents on their own transport and is not user-assignable.
func roleDefaults() map[string][]string {
	out := make(map[string][]string, len(auth.DefaultRolePermissions))
	for role, perms := range auth.DefaultRolePermissions {
		if !auth.ValidRole(role) {
			continue
		}
		list := make([]string, 0, len(perms))
		for permission, granted := range perms {
			if granted {
				list = append(list, permission)
			}
		}
		sort.Strings(list)
		out[role] = list
	}
	return out
}

// handlePanelCatalog returns the section list, the group list, the permission
// vocabulary and the built-in role defaults.
func (s *Server) handlePanelCatalog(w http.ResponseWriter, r *http.Request) {
	permissions := append([]string(nil), auth.AllPermissions...)
	sort.Strings(permissions)
	writeJSON(w, http.StatusOK, map[string]any{
		"sections":     panelSectionCatalog,
		"groups":       panelSectionGroups,
		"permissions":  permissions,
		"role_defaults": roleDefaults(),
		"source":       "go",
	})
}
