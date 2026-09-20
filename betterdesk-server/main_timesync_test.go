package main

import (
	"path/filepath"
	"testing"

	"github.com/unitronix/betterdesk-server/config"
	"github.com/unitronix/betterdesk-server/db"
)

func TestApplyPersistedTimeSyncConfig(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "server.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	defer database.Close()
	if err := database.Migrate(); err != nil {
		t.Fatalf("migrate database: %v", err)
	}

	if err := database.SetConfig("timesync_config", `{
		"ntp_servers":"10.0.0.1,time.example.com",
		"max_skew_ms":4500,
		"require_synced_clock":false,
		"trust_os_ntp":false
	}`); err != nil {
		t.Fatalf("save persisted config: %v", err)
	}

	cfg := config.DefaultConfig()
	applyPersistedTimeSyncConfig(cfg, database)

	if cfg.NTPServers != "10.0.0.1,time.example.com" {
		t.Fatalf("NTPServers = %q", cfg.NTPServers)
	}
	if cfg.BillingMaxClockSkewMS != 4500 {
		t.Fatalf("BillingMaxClockSkewMS = %d", cfg.BillingMaxClockSkewMS)
	}
	if cfg.BillingRequireSyncedClock || cfg.BillingTrustOSNTP {
		t.Fatalf("unexpected persisted boolean settings: require=%v trust=%v",
			cfg.BillingRequireSyncedClock, cfg.BillingTrustOSNTP)
	}
}
