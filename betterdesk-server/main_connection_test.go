package main

import (
	"path/filepath"
	"testing"

	"github.com/unitronix/betterdesk-server/config"
	"github.com/unitronix/betterdesk-server/db"
)

func TestApplyPersistedConnectionSettings(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "server.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	defer database.Close()
	if err := database.Migrate(); err != nil {
		t.Fatalf("migrate database: %v", err)
	}

	if err := database.SetConfig(config.PersistedConnectionSettingsKey, `{
		"mode":"relay_only",
		"p2p_fallback_ms":4500,
		"same_nat_relay":false,
		"allow_shared_nat_initiator":true,
		"logged_in_only_initiator":true,
		"operator_only_outbound":true
	}`); err != nil {
		t.Fatalf("save persisted config: %v", err)
	}

	cfg := config.DefaultConfig()
	applyPersistedConnectionSettings(cfg, database)

	active := cfg.ConnectionSettings()
	if active.Mode != "relay_only" || active.P2PFallbackMs != 4500 ||
		active.SameNATRelay || !active.AllowSharedNATInitiator ||
		!active.LoggedInOnlyInitiator || !active.OperatorOnlyOutbound {
		t.Fatalf("unexpected persisted settings: %+v", active)
	}
}

func TestApplyPersistedConnectionSettingsIgnoresInvalidValues(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "server.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	defer database.Close()
	if err := database.Migrate(); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	if err := database.SetConfig(config.PersistedConnectionSettingsKey, `{
		"mode":"relay_only",
		"p2p_fallback_ms":999999,
		"same_nat_relay":false
	}`); err != nil {
		t.Fatalf("save persisted config: %v", err)
	}

	cfg := config.DefaultConfig()
	applyPersistedConnectionSettings(cfg, database)

	active := cfg.ConnectionSettings()
	if active.Mode != "p2p_first" || active.P2PFallbackMs != 2000 || !active.SameNATRelay {
		t.Fatalf("invalid persisted settings were applied: %+v", active)
	}
}
