package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unitronix/betterdesk-server/auth"
	"github.com/unitronix/betterdesk-server/config"
	"github.com/unitronix/betterdesk-server/peer"
)

// Only super admins may change role permissions. A server_admin holds
// server.config, which used to be enough to grant its own role anything.
func TestRolePermissionOverridesNeedSuperAdmin(t *testing.T) {
	database := testSetupDB(t)
	defer database.Close()
	srv := New(config.DefaultConfig(), database, peer.NewMap(), nil, "test")

	withRole := func(req *http.Request, role string) *http.Request {
		ctx := context.WithValue(req.Context(), ctxKeyRole, role)
		ctx = context.WithValue(ctx, ctxKeyUsername, "someone")
		return req.WithContext(ctx)
	}
	set := func(role string) int {
		body := `{"role":"server_admin","permission":"user.delete","granted":true}`
		req := withRole(httptest.NewRequest(http.MethodPost, "/api/role-permissions", strings.NewReader(body)), role)
		rec := httptest.NewRecorder()
		srv.handleSetRolePermission(rec, req)
		return rec.Code
	}
	del := func(role string) int {
		req := withRole(httptest.NewRequest(http.MethodDelete, "/api/role-permissions/server_admin/user.delete", nil), role)
		req.SetPathValue("role", "server_admin")
		req.SetPathValue("permission", "user.delete")
		rec := httptest.NewRecorder()
		srv.handleDeleteRolePermission(rec, req)
		return rec.Code
	}

	for _, role := range []string{auth.RoleServerAdmin, auth.RoleGlobalAdmin, auth.RoleOperator} {
		if code := set(role); code != http.StatusForbidden {
			t.Fatalf("%s set override: status %d, want 403", role, code)
		}
		overrides, err := database.ListRolePermissions(auth.RoleServerAdmin)
		if err != nil {
			t.Fatal(err)
		}
		for _, o := range overrides {
			if o.Permission == "user.delete" {
				t.Fatalf("%s managed to set an override on server_admin user.delete", role)
			}
		}
	}

	if code := set(auth.RoleSuperAdmin); code != http.StatusOK {
		t.Fatalf("super_admin set override: status %d, want 200", code)
	}
	if code := del(auth.RoleServerAdmin); code != http.StatusForbidden {
		t.Fatalf("server_admin delete override: status %d, want 403", code)
	}
	// The console's own API key has the admin role
	if code := del(auth.RoleAdmin); code != http.StatusOK {
		t.Fatalf("admin delete override: status %d, want 200", code)
	}
}
