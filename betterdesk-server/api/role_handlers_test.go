package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/unitronix/betterdesk-server/auth"
	"github.com/unitronix/betterdesk-server/config"
	"github.com/unitronix/betterdesk-server/db"
	"github.com/unitronix/betterdesk-server/peer"
)

func newRoleTestServer(t *testing.T) (*Server, db.Database, *auth.JWTManager) {
	t.Helper()
	database := testSetupDB(t)
	t.Cleanup(func() { database.Close() })
	srv := New(config.DefaultConfig(), database, peer.NewMap(), nil, "test")
	jwtManager := auth.NewJWTManager("role-handlers-test-secret", time.Hour)
	srv.SetJWTManager(jwtManager)
	return srv, database, jwtManager
}

func roleTestRequest(t *testing.T, jwtManager *auth.JWTManager, role, method, target, body string) *http.Request {
	t.Helper()
	token, err := jwtManager.Generate("tester-"+role, role)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	return req
}

func TestCustomRoleLifecycle(t *testing.T) {
	srv, database, jwtManager := newRoleTestServer(t)

	create := srv.authMiddleware(srv.requirePermission(auth.PermServerConfig, srv.handleCreateCustomRole))
	rec := httptest.NewRecorder()
	create.ServeHTTP(rec, roleTestRequest(t, jwtManager, auth.RoleSuperAdmin, http.MethodPost, "/api/roles",
		`{"name":"helpdesk","description":"Front line","copy_from":"viewer","permissions":["device.connect"]}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", rec.Code, rec.Body.String())
	}
	var created roleInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if !created.IsCustom || !slices.Contains(created.Permissions, auth.PermDeviceView) ||
		!slices.Contains(created.Permissions, auth.PermDeviceConnect) ||
		slices.Contains(created.Permissions, auth.PermUserView) {
		t.Fatalf("unexpected created role: %+v", created)
	}

	// Duplicate and reserved names are rejected.
	for _, body := range []string{`{"name":"helpdesk"}`, `{"name":"operator"}`, `{"name":"Bad Name"}`, `{"name":"device"}`, `{"name":"owner"}`, `{"name":"user"}`} {
		rec = httptest.NewRecorder()
		create.ServeHTTP(rec, roleTestRequest(t, jwtManager, auth.RoleSuperAdmin, http.MethodPost, "/api/roles", body))
		if rec.Code != http.StatusBadRequest && rec.Code != http.StatusConflict {
			t.Fatalf("create %s status = %d, want 400/409", body, rec.Code)
		}
	}

	if !srv.isKnownRole("helpdesk") {
		t.Fatal("custom role is not recognised")
	}

	// The custom role is enforced through requirePermission.
	reached := func(role, perm string) bool {
		called := false
		h := srv.authMiddleware(srv.requirePermission(perm, func(w http.ResponseWriter, r *http.Request) {
			called = true
			w.WriteHeader(http.StatusNoContent)
		}))
		h.ServeHTTP(httptest.NewRecorder(), roleTestRequest(t, jwtManager, role, http.MethodGet, "/x", ""))
		return called
	}
	if !reached("helpdesk", auth.PermDeviceConnect) {
		t.Fatal("custom role grant was not honoured")
	}
	if reached("helpdesk", auth.PermUserView) {
		t.Fatal("custom role received a permission it was not granted")
	}

	// Revoking user.view from a built-in role hides user management.
	if !reached(auth.RoleOperator, auth.PermUserView) {
		t.Fatal("operator should see users by default")
	}
	if err := database.SetRolePermission(auth.RoleOperator, auth.PermUserView, false); err != nil {
		t.Fatal(err)
	}
	if reached(auth.RoleOperator, auth.PermUserView) {
		t.Fatal("revoked user.view override was ignored")
	}
	if srv.roleHasPermission(auth.RoleOperator, auth.PermUserView) {
		t.Fatal("roleHasPermission ignored the DB override")
	}

	// A role assigned to users cannot be deleted.
	if err := database.CreateUser(&db.User{Username: "alice", PasswordHash: "x", Role: "helpdesk"}); err != nil {
		t.Fatal(err)
	}
	del := srv.authMiddleware(srv.requirePermission(auth.PermServerConfig, srv.handleDeleteCustomRole))
	delReq := func(role string) *httptest.ResponseRecorder {
		req := roleTestRequest(t, jwtManager, auth.RoleSuperAdmin, http.MethodDelete, "/api/roles/"+role, "")
		req.SetPathValue("role", role)
		rec := httptest.NewRecorder()
		del.ServeHTTP(rec, req)
		return rec
	}
	if rec := delReq("helpdesk"); rec.Code != http.StatusConflict {
		t.Fatalf("delete in-use role status = %d, want 409", rec.Code)
	}
	if rec := delReq(auth.RoleOperator); rec.Code != http.StatusBadRequest {
		t.Fatalf("delete built-in role status = %d, want 400", rec.Code)
	}

	user, err := database.GetUser("alice")
	if err != nil || user == nil {
		t.Fatalf("lookup alice: %v", err)
	}
	if err := database.DeleteUser(user.ID); err != nil {
		t.Fatal(err)
	}
	if rec := delReq("helpdesk"); rec.Code != http.StatusOK {
		t.Fatalf("delete unused role status = %d: %s", rec.Code, rec.Body.String())
	}
	if srv.isKnownRole("helpdesk") {
		t.Fatal("deleted custom role is still recognised")
	}
	if overrides, _ := database.ListRolePermissions("helpdesk"); len(overrides) != 0 {
		t.Fatalf("deleted role left %d permission rows", len(overrides))
	}
}

func TestCustomRoleCannotBeAssignedByGlobalAdmin(t *testing.T) {
	if auth.CanAssignRole(auth.RoleGlobalAdmin, "helpdesk") {
		t.Fatal("global_admin must not assign custom roles")
	}
	if !auth.CanAssignRole(auth.RoleSuperAdmin, "helpdesk") {
		t.Fatal("super_admin must be able to assign custom roles")
	}
}

func TestListRolesIncludesCustomRoles(t *testing.T) {
	srv, database, jwtManager := newRoleTestServer(t)
	if err := database.CreateCustomRole(&db.CustomRole{Name: "auditor"}, []string{auth.PermAuditView}); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	srv.authMiddleware(srv.requirePermission(auth.PermUserView, srv.handleListRoles)).
		ServeHTTP(rec, roleTestRequest(t, jwtManager, auth.RoleSuperAdmin, http.MethodGet, "/api/roles", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var resp struct {
		Roles []roleInfo `json:"roles"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	idx := slices.IndexFunc(resp.Roles, func(r roleInfo) bool { return r.Name == "auditor" })
	if idx < 0 {
		t.Fatal("custom role missing from /api/roles")
	}
	if got := resp.Roles[idx]; !got.IsCustom || !slices.Equal(got.Permissions, []string{auth.PermAuditView}) {
		t.Fatalf("unexpected custom role entry: %+v", got)
	}
}

func TestOrgMemberVisibilityFollowsUserViewPermission(t *testing.T) {
	srv, database, jwtManager := newRoleTestServer(t)
	if err := database.CreateOrganization(&db.Organization{ID: "org-1", Name: "Acme", Slug: "acme"}); err != nil {
		t.Fatal(err)
	}
	for _, u := range []*db.OrgUser{
		{ID: "ou-owner", OrgID: "org-1", Username: "tester-viewer", Role: db.OrgRoleOwner},
		{ID: "ou-op", OrgID: "org-1", Username: "tester-operator", Role: db.OrgRoleOperator},
		{ID: "ou-user", OrgID: "org-1", Username: "tester-helpdesk", Role: db.OrgRoleUser},
	} {
		if err := database.CreateOrgUser(u); err != nil {
			t.Fatal(err)
		}
	}
	if err := database.CreateCustomRole(&db.CustomRole{Name: "helpdesk"}, []string{auth.PermUserView}); err != nil {
		t.Fatal(err)
	}

	listCount := func(role string) int {
		req := roleTestRequest(t, jwtManager, role, http.MethodGet, "/api/org/org-1/users", "")
		req.SetPathValue("id", "org-1")
		rec := httptest.NewRecorder()
		srv.authMiddleware(srv.requireOrgMembership("id", srv.handleListOrgUsers)).ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d: %s", role, rec.Code, rec.Body.String())
		}
		var resp struct {
			Users []db.OrgUser `json:"users"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		return len(resp.Users)
	}

	if n := listCount(auth.RoleOperator); n != 3 {
		t.Fatalf("operator with user.view saw %d members, want 3", n)
	}
	if n := listCount(auth.RoleViewer); n != 3 {
		t.Fatalf("org owner saw %d members, want 3", n)
	}
	if n := listCount("helpdesk"); n != 3 {
		t.Fatalf("custom role with user.view saw %d members, want 3", n)
	}

	// Hiding users from a role applies to org member lists too.
	if err := database.SetRolePermission(auth.RoleOperator, auth.PermUserView, false); err != nil {
		t.Fatal(err)
	}
	if err := database.SetRolePermission("helpdesk", auth.PermUserView, false); err != nil {
		t.Fatal(err)
	}
	if n := listCount(auth.RoleOperator); n != 1 {
		t.Fatalf("operator without user.view saw %d members, want only self", n)
	}
	if n := listCount("helpdesk"); n != 1 {
		t.Fatalf("custom role without user.view saw %d members, want only self", n)
	}
	if n := listCount(auth.RoleViewer); n != 3 {
		t.Fatalf("org owner saw %d members, want 3", n)
	}
}
