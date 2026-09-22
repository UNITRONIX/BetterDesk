package api

import (
	"testing"

	"github.com/unitronix/betterdesk-server/config"
	bdcrypto "github.com/unitronix/betterdesk-server/crypto"
	"github.com/unitronix/betterdesk-server/db"
	"github.com/unitronix/betterdesk-server/peer"
)

func TestTelemetryKeyPersistsAcrossServerInstances(t *testing.T) {
	database, err := db.OpenSQLite(t.TempDir() + "/telemetry.db")
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	defer database.Close()
	if err := database.Migrate(); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	keyPair, err := bdcrypto.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair: %v", err)
	}
	first := New(config.DefaultConfig(), database, peer.NewMap(), nil, "test")
	first.SetKeyPair(keyPair)
	firstKey := first.telemetryKeyID()

	second := New(config.DefaultConfig(), database, peer.NewMap(), nil, "test")
	second.SetKeyPair(keyPair)
	if second.telemetryKeyID() != firstKey {
		t.Fatalf("telemetry key changed across server instances")
	}
}

func TestClassifyBetterDeskDevice(t *testing.T) {
	tests := []struct {
		name, sku, mode, want string
	}{
		{"legacy rustdesk", "", "", ""},
		{"managed betterdesk", "betterdesk-desktop", "normal", "betterdesk"},
		{"desktop incoming-only", "betterdesk-desktop", "incoming-only", "betterdesk"},
		{"support sku", "betterdesk-support", "incoming-only", "betterdesk-support"},
		{"support mode", "", "incoming-only", "betterdesk-support"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := classifyBetterDeskDevice(test.sku, test.mode); got != test.want {
				t.Fatalf("classifyBetterDeskDevice(%q, %q) = %q, want %q",
					test.sku, test.mode, got, test.want)
			}
		})
	}
}
