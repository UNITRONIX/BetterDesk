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

// TestPanelCatalogIsComplete proves the catalog Go serves is usable on its own:
// every section names permissions that exist, every role default is a subset of
// the vocabulary, and the groups cover every section.
func TestPanelCatalogIsComplete(t *testing.T) {
	known := make(map[string]bool, len(auth.AllPermissions))
	for _, p := range auth.AllPermissions {
		known[p] = true
	}
	groups := make(map[string]bool, len(panelSectionGroups))
	for _, g := range panelSectionGroups {
		groups[g["key"]] = true
	}

	seen := make(map[string]bool, len(panelSectionCatalog))
	for _, section := range panelSectionCatalog {
		if section.Key == "" || section.Label == "" {
			t.Errorf("section without key or label: %+v", section)
		}
		if seen[section.Key] {
			t.Errorf("duplicate section key %q", section.Key)
		}
		seen[section.Key] = true
		if !groups[section.Group] {
			t.Errorf("section %q names unknown group %q", section.Key, section.Group)
		}
		if section.ReadPermission != "" && !known[section.ReadPermission] {
			t.Errorf("section %q has unknown read permission %q", section.Key, section.ReadPermission)
		}
		if section.WritePermission != "" && !known[section.WritePermission] {
			t.Errorf("section %q has unknown write permission %q", section.Key, section.WritePermission)
		}
	}

	for role, permissions := range roleDefaults() {
		if !auth.ValidRole(role) {
			t.Errorf("role defaults for unknown role %q", role)
		}
		for _, permission := range permissions {
			if !known[permission] {
				t.Errorf("role %q grants unknown permission %q", role, permission)
			}
		}
	}

	// The catalog must not grant the pro role any device permission: that role
	// exists for RustDesk PRO activation only.
	if perms := roleDefaults()[auth.RolePro]; len(perms) != 0 {
		t.Errorf("pro role should have no permissions, got %v", perms)
	}
}

// TestPanelCatalogEndpoint proves the route is reachable for any signed-in
// principal — every role needs it to render its own navigation.
func TestPanelCatalogEndpoint(t *testing.T) {
	srv, base := panelGroupTestServer(t, 19910)

	operatorKey := "operator-catalog-key"
	if err := srv.db.CreateAPIKey(&db.APIKey{
		KeyHash:   hashAPIKey(operatorKey),
		KeyPrefix: operatorKey[:8],
		Name:      "viewer-catalog",
		Role:      auth.RoleViewer,
	}); err != nil {
		t.Fatal(err)
	}

	resp, body := doPanelJSONWithKey(t, http.MethodGet, base+"/api/panel/catalog", nil, operatorKey)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("catalog status %d, want 200 for a viewer", resp.StatusCode)
	}
	sections, _ := body["sections"].([]any)
	if len(sections) < 30 {
		t.Fatalf("sections = %d, want the full catalog", len(sections))
	}
	perms, _ := body["permissions"].([]any)
	if len(perms) < 30 {
		t.Fatalf("permissions = %d, want the full vocabulary", len(perms))
	}
	if body["source"] != "go" {
		t.Errorf("source = %v, want go", body["source"])
	}

	// Without credentials the catalog is still behind auth.
	req, err := http.NewRequest(http.MethodGet, base+"/api/panel/catalog", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous status %d, want 401", resp2.StatusCode)
	}
}

// doPanelJSONWithKey reads or writes as a specific API key.
func doPanelJSONWithKey(t *testing.T, method, url string, body any, key string) (*http.Response, map[string]any) {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-API-Key", key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var parsed map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&parsed)
	return resp, parsed
}

// Keep the catalog response stable: a reload must not reorder the sections,
// or the console's cached copy would churn on every request.
func TestPanelCatalogOrderIsStable(t *testing.T) {
	first := make([]string, len(panelSectionCatalog))
	for i, s := range panelSectionCatalog {
		first[i] = s.Key
	}
	time.Sleep(2 * time.Millisecond)
	for i, s := range panelSectionCatalog {
		if first[i] != s.Key {
			t.Fatalf("catalog order changed at %d: %q != %q", i, s.Key, first[i])
		}
	}
}
