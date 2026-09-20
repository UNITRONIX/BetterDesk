package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unitronix/betterdesk-server/config"
	"github.com/unitronix/betterdesk-server/peer"
	"github.com/unitronix/betterdesk-server/timesync"
)

func newTimeSyncTestServer(t *testing.T) (*Server, interface {
	GetConfig(string) (string, error)
}) {
	t.Helper()
	database := testSetupDB(t)
	t.Cleanup(func() { database.Close() })

	srv := New(config.DefaultConfig(), database, peer.NewMap(), nil, "test")
	srv.SetTimeSyncService(timesync.NewService(database, timesync.Config{
		Servers:      []string{"pool.ntp.org"},
		Interval:     time.Hour,
		QueryTimeout: time.Millisecond,
		MaxSkew:      2 * time.Second,
		RequireSync:  true,
		TrustOSNTP:   true,
	}))
	return srv, database
}

func TestSetTimeSyncConfigPersistsAndHotReloads(t *testing.T) {
	srv, database := newTimeSyncTestServer(t)
	body := bytes.NewBufferString(`{
		"ntp_servers":"127.0.0.1,time.example.com",
		"max_skew_ms":3500,
		"require_synced_clock":false,
		"trust_os_ntp":false
	}`)
	req := httptest.NewRequest(http.MethodPut, "/api/timesync/config", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	srv.handleSetTimeSyncConfig(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var response struct {
		Config timeSyncConfigPayload `json:"config"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Config.NTPServers != "127.0.0.1,time.example.com" {
		t.Fatalf("NTP servers = %q", response.Config.NTPServers)
	}
	if response.Config.MaxSkewMS != 3500 || response.Config.RequireSyncedClock || response.Config.TrustOSNTP {
		t.Fatalf("unexpected response config: %+v", response.Config)
	}

	raw, err := database.GetConfig(timesync.PersistedConfigKey)
	if err != nil {
		t.Fatalf("read persisted config: %v", err)
	}
	if !bytes.Contains([]byte(raw), []byte(`"max_skew_ms":3500`)) {
		t.Fatalf("persisted config does not contain max skew: %s", raw)
	}

	active := srv.timeSync.GetConfig()
	if active.MaxSkew != 3500*time.Millisecond || active.RequireSync || active.TrustOSNTP {
		t.Fatalf("unexpected active config: %+v", active)
	}
}

func TestSetTimeSyncConfigRejectsInvalidValues(t *testing.T) {
	srv, _ := newTimeSyncTestServer(t)
	body := bytes.NewBufferString(`{
		"ntp_servers":"not a hostname",
		"max_skew_ms":3500
	}`)
	req := httptest.NewRequest(http.MethodPut, "/api/timesync/config", body)
	rec := httptest.NewRecorder()

	srv.handleSetTimeSyncConfig(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}
