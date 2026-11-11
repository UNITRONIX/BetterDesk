package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/unitronix/betterdesk-server/auth"
	"github.com/unitronix/betterdesk-server/db"
)

// panelTrustRequest builds a panel-originated request: the panel API key plus a
// signed statement for the operator's own identity.
func panelTrustRequest(t *testing.T, method, url, path, subject, role, nonce string, body []byte) *http.Request {
	t.Helper()
	claim := newClaim(time.Now())
	claim.Subject = subject
	claim.Role = role
	claim.Nonce = nonce
	header := claim.signFor([]byte(testPanelSecret), method, path)

	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-API-Key", testAPIKey)
	req.Header.Set(PanelTrustHeader, header)
	req.Header.Set("Content-Type", "application/json")
	return req
}

// TestPanelTrustEnforcesOperatorRole is the end-to-end proof that the bridge
// does what it is for: a viewer's session cannot write a device group even
// though the HTTP call arrives with the panel's administrator API key.
//
// Without the statement the same call would be authorized as an administrator,
// which is exactly the privilege escalation the bridge exists to prevent.
func TestPanelTrustEnforcesOperatorRole(t *testing.T) {
	srv, base := panelGroupTestServer(t, 19920)
	srv.SetPanelTrustSecret(testPanelSecret)

	if err := srv.db.CreateUser(&db.User{
		Username:     "viewer-trust",
		PasswordHash: "hash",
		Role:         auth.RoleViewer,
		AuthProvider: db.AuthProviderLocal,
	}); err != nil {
		t.Fatal(err)
	}

	path := "/api/panel/device-groups"
	req := panelTrustRequest(t, http.MethodPost, base+path, path,
		"viewer-trust", auth.RoleViewer, "nonce-viewer-1", []byte(`{"name":"viewer group"}`))
	req.RemoteAddr = "127.0.0.1:5000"

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer status %d, want 403 — the trust statement must not raise the role",
			resp.StatusCode)
	}
}

// TestPanelTrustAllowsOperatorWrite proves the same call succeeds for a role
// that may edit devices, so the previous test is not passing merely because the
// route is broken.
func TestPanelTrustAllowsOperatorWrite(t *testing.T) {
	srv, base := panelGroupTestServer(t, 19921)
	srv.SetPanelTrustSecret(testPanelSecret)

	path := "/api/panel/device-groups"
	// operator-grp is created by panelGroupTestServer with the operator role.
	req := panelTrustRequest(t, http.MethodPost, base+path, path,
		"operator-grp", auth.RoleOperator, "nonce-operator-1", []byte(`{"name":"operator group"}`))
	req.RemoteAddr = "127.0.0.1:5000"

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		var body map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&body)
		t.Fatalf("operator status %d, want 201 (%v)", resp.StatusCode, body)
	}
}

// TestPanelTrustRoleComesFromTheDatabase proves a stale claim cannot keep
// privileges: the session was created when the account was an administrator,
// the account is now a viewer, and the write is refused.
func TestPanelTrustRoleComesFromTheDatabase(t *testing.T) {
	srv, base := panelGroupTestServer(t, 19923)
	srv.SetPanelTrustSecret(testPanelSecret)

	user, err := srv.db.GetUser("operator-grp")
	if err != nil || user == nil {
		t.Fatalf("GetUser: %v", err)
	}
	user.Role = auth.RoleViewer
	if err := srv.db.UpdateUser(user); err != nil {
		t.Fatal(err)
	}

	path := "/api/panel/device-groups"
	// The statement still claims operator — the server must not honour it.
	req := panelTrustRequest(t, http.MethodPost, base+path, path,
		"operator-grp", auth.RoleOperator, "nonce-demoted-1", []byte(`{"name":"demoted group"}`))
	req.RemoteAddr = "127.0.0.1:5000"

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("demoted status %d, want 403 — the database role must win",
			resp.StatusCode)
	}
}

// TestPanelTrustRejectsForgedHeaderWithoutTheSecret proves that a statement is
// useless without the shared secret, even from loopback with a valid API key.
func TestPanelTrustRejectsForgedHeaderWithoutTheSecret(t *testing.T) {
	srv, base := panelGroupTestServer(t, 19924)
	srv.SetPanelTrustSecret("a-completely-different-secret-value")

	path := "/api/panel/device-groups"
	req := panelTrustRequest(t, http.MethodPost, base+path, path,
		"operator-grp", auth.RoleOperator, "nonce-forged-1", []byte(`{"name":"forged group"}`))
	req.RemoteAddr = "127.0.0.1:5000"

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("forged status %d, want 401", resp.StatusCode)
	}
}
