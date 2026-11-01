package api

import (
	"crypto/ed25519"
	cryptoRand "crypto/rand"
	"errors"
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

func TestFreshEnrollmentClearsOrphanedSecureSequence(t *testing.T) {
	srv, deviceID, deviceUUID, oldPriv, responsePub, _ := newConnectionModeFixture(t)
	oldEnvelope := sealClientHeartbeat(
		t,
		srv,
		deviceID,
		oldPriv,
		100,
		map[string]any{"generation": "old"},
		responsePub,
	)
	if _, err := srv.openTelemetryEnvelope(deviceID, oldEnvelope); err != nil {
		t.Fatalf("open old envelope: %v", err)
	}

	// Simulate a 3.5.201 permanent delete, which removed the peer but
	// retained the telemetry sequence row.
	if err := srv.db.HardDeletePeer(deviceID); err != nil {
		t.Fatalf("HardDeletePeer: %v", err)
	}
	if err := srv.db.SetConfig(telemetrySequenceConfigPrefix+deviceID, "100"); err != nil {
		t.Fatalf("seed orphaned telemetry sequence: %v", err)
	}

	newPub, newPriv, err := ed25519.GenerateKey(cryptoRand.Reader)
	if err != nil {
		t.Fatalf("new device key: %v", err)
	}
	if err := srv.createPeerFromEnrollment(&EnrollmentRequest{
		DeviceID: deviceID,
		UUID:     deviceUUID,
	}, "", true); err != nil {
		t.Fatalf("fresh enrollment: %v", err)
	}
	if stored, err := srv.db.GetConfig(telemetrySequenceConfigPrefix + deviceID); err != nil {
		t.Fatalf("read reset telemetry sequence: %v", err)
	} else if stored != "" {
		t.Fatalf("fresh enrollment retained telemetry sequence %q", stored)
	}
	if err := srv.db.UpsertPeer(&db.Peer{ID: deviceID, PK: newPub}); err != nil {
		t.Fatalf("register new device key: %v", err)
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
		t.Fatal("old identity envelope accepted after fresh enrollment")
	}
}

func TestFreshEnrollmentDoesNotResetActiveOrDeletedPeerState(t *testing.T) {
	t.Run("active", func(t *testing.T) {
		srv, deviceID, deviceUUID, _, _, _ := newConnectionModeFixture(t)
		if err := srv.db.SetConfig(telemetrySequenceConfigPrefix+deviceID, "100"); err != nil {
			t.Fatalf("seed telemetry sequence: %v", err)
		}
		if err := srv.createPeerFromEnrollment(&EnrollmentRequest{
			DeviceID: deviceID,
			UUID:     deviceUUID,
		}, "", true); err != nil {
			t.Fatalf("active enrollment: %v", err)
		}
		if stored, err := srv.db.GetConfig(telemetrySequenceConfigPrefix + deviceID); err != nil {
			t.Fatalf("read active telemetry sequence: %v", err)
		} else if stored != "100" {
			t.Fatalf("active enrollment changed telemetry sequence to %q", stored)
		}
	})

	t.Run("soft_deleted", func(t *testing.T) {
		srv, deviceID, deviceUUID, _, _, _ := newConnectionModeFixture(t)
		if err := srv.db.SetConfig(telemetrySequenceConfigPrefix+deviceID, "100"); err != nil {
			t.Fatalf("seed telemetry sequence: %v", err)
		}
		if err := srv.db.DeletePeer(deviceID); err != nil {
			t.Fatalf("DeletePeer: %v", err)
		}
		if err := srv.createPeerFromEnrollment(&EnrollmentRequest{
			DeviceID: deviceID,
			UUID:     deviceUUID,
		}, "", true); !errors.Is(err, db.ErrPeerIDSoftDeleted) {
			t.Fatalf("soft-deleted enrollment error = %v, want %v", err, db.ErrPeerIDSoftDeleted)
		}
		if stored, err := srv.db.GetConfig(telemetrySequenceConfigPrefix + deviceID); err != nil {
			t.Fatalf("read deleted telemetry sequence: %v", err)
		} else if stored != "100" {
			t.Fatalf("soft-deleted enrollment changed telemetry sequence to %q", stored)
		}
	})
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
