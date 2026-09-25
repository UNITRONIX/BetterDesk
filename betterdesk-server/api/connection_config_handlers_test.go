package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unitronix/betterdesk-server/auth"
	"github.com/unitronix/betterdesk-server/config"
	"github.com/unitronix/betterdesk-server/peer"
)

func withRoleAndUsername(ctx context.Context, role, username string) context.Context {
	ctx = context.WithValue(ctx, ctxKeyRole, role)
	return context.WithValue(ctx, ctxKeyUsername, username)
}

func newConnectionConfigTestServer(t *testing.T) (*Server, interface {
	GetConfig(string) (string, error)
}) {
	t.Helper()
	database := testSetupDB(t)
	t.Cleanup(func() { database.Close() })
	cfg := config.DefaultConfig()
	return New(cfg, database, peer.NewMap(), nil, "test"), database
}

func TestSetConnectionConfigPersistsAndApplies(t *testing.T) {
	srv, database := newConnectionConfigTestServer(t)
	body := bytes.NewBufferString(`{
		"mode":"relay_only",
		"p2p_fallback_ms":3500,
		"same_nat_relay":false,
		"allow_shared_nat_initiator":true,
		"logged_in_only_initiator":true,
		"operator_only_outbound":true
	}`)
	req := httptest.NewRequest(http.MethodPut, "/api/connection/config", body)
	req = req.WithContext(withRoleAndUsername(req.Context(), auth.RoleAdmin, "admin"))
	rec := httptest.NewRecorder()

	srv.handleSetConnectionConfig(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var response struct {
		Config config.ConnectionSettings `json:"config"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Config.Mode != "relay_only" || response.Config.P2PFallbackMs != 3500 {
		t.Fatalf("unexpected response config: %+v", response.Config)
	}

	raw, err := database.GetConfig(config.PersistedConnectionSettingsKey)
	if err != nil {
		t.Fatalf("read persisted config: %v", err)
	}
	if !bytes.Contains([]byte(raw), []byte(`"allow_shared_nat_initiator":true`)) {
		t.Fatalf("persisted config does not contain shared-NAT flag: %s", raw)
	}

	active := srv.cfg.ConnectionSettings()
	if active.Mode != "relay_only" || active.P2PFallbackMs != 3500 ||
		active.SameNATRelay || !active.AllowSharedNATInitiator ||
		!active.LoggedInOnlyInitiator || !active.OperatorOnlyOutbound {
		t.Fatalf("unexpected active config: %+v", active)
	}
}

func TestSetConnectionConfigRejectsUnsafeInput(t *testing.T) {
	tests := []string{
		`{"mode":"p2p_first","p2p_fallback_ms":30001}`,
		`{"mode":"p2p_first","p2p_fallback_ms":2000,"allow_shared_nat_initiator":"true"}`,
		`{"mode":"p2p_first","p2p_fallback_ms":2000,"unexpected":true}`,
	}
	for _, raw := range tests {
		t.Run(raw, func(t *testing.T) {
			srv, _ := newConnectionConfigTestServer(t)
			req := httptest.NewRequest(http.MethodPut, "/api/connection/config", bytes.NewBufferString(raw))
			rec := httptest.NewRecorder()

			srv.handleSetConnectionConfig(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
			if _, err := srv.db.GetConfig(config.PersistedConnectionSettingsKey); err != nil {
				t.Fatalf("read persisted config: %v", err)
			}
			if active := srv.cfg.ConnectionSettings(); active.P2PFallbackMs != 2000 {
				t.Fatalf("unsafe input changed runtime config: %+v", active)
			}
		})
	}
}

func TestConnectionConfigRequiresServerConfigPermission(t *testing.T) {
	srv, _ := newConnectionConfigTestServer(t)
	body := bytes.NewBufferString(`{"mode":"p2p_first","p2p_fallback_ms":2000}`)
	req := httptest.NewRequest(http.MethodPut, "/api/connection/config", body)
	req = req.WithContext(withRoleAndUsername(req.Context(), auth.RoleViewer, "viewer"))
	rec := httptest.NewRecorder()

	srv.requirePermission(auth.PermServerConfig, srv.handleSetConnectionConfig)(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestGetConnectionConfigReturnsNormalizedSnapshot(t *testing.T) {
	srv, _ := newConnectionConfigTestServer(t)
	srv.cfg.ApplyConnectionSettings(config.ConnectionSettings{
		Mode:           "relay_only",
		P2PFallbackMs:  2500,
		SameNATRelay:   true,
		P2PFirst:       false,
		AlwaysUseRelay: true,
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/connection/config", nil)

	srv.handleGetConnectionConfig(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var response config.ConnectionSettings
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Mode != "relay_only" || response.P2PFallbackMs != 2500 ||
		!response.AlwaysUseRelay || response.P2PFirst {
		t.Fatalf("unexpected response config: %+v", response)
	}
}
