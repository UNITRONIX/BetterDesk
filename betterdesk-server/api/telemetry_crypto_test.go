package api

import (
	"crypto/ed25519"
	cryptoRand "crypto/rand"
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

func TestHardDeleteAllowsSecureSequenceRestartWithNewIdentity(t *testing.T) {
	srv, deviceID, _, oldPriv, responsePub, _ := newConnectionModeFixture(t)
	oldEnvelope := sealClientHeartbeat(
		t,
		srv,
		deviceID,
		oldPriv,
		100,
		map[string]any{"generation": "old"},
		responsePub,
	)

	if err := srv.db.SetConfig("telemetry_seq_"+deviceID, "100"); err != nil {
		t.Fatalf("seed telemetry sequence: %v", err)
	}
	if err := srv.db.HardDeletePeer(deviceID); err != nil {
		t.Fatalf("HardDeletePeer: %v", err)
	}
	srv.forgetSecureDeviceState(deviceID)

	newPub, newPriv, err := ed25519.GenerateKey(cryptoRand.Reader)
	if err != nil {
		t.Fatalf("new device key: %v", err)
	}
	if err := srv.db.UpsertPeer(&db.Peer{ID: deviceID, PK: newPub}); err != nil {
		t.Fatalf("re-enroll peer: %v", err)
	}

	newEnvelope := sealClientHeartbeat(
		t,
		srv,
		deviceID,
		newPriv,
		1,
		map[string]any{"generation": "new"},
		responsePub,
	)
	if _, err := srv.openTelemetryEnvelope(deviceID, newEnvelope); err != nil {
		t.Fatalf("new identity sequence restart rejected: %v", err)
	}
	if _, err := srv.openTelemetryEnvelope(deviceID, oldEnvelope); err == nil {
		t.Fatal("old identity envelope accepted after re-enrollment")
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
