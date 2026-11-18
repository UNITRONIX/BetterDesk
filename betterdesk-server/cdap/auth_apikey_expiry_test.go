package cdap

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/unitronix/betterdesk-server/config"
	"github.com/unitronix/betterdesk-server/db"
	"github.com/unitronix/betterdesk-server/events"
	"github.com/unitronix/betterdesk-server/peer"
)

func newAPIKeyAuthGateway(t *testing.T) (*Gateway, db.Database) {
	t.Helper()

	database, err := db.OpenSQLite(filepath.Join(t.TempDir(), "cdap-apikey.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Migrate(); err != nil {
		database.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })

	return New(config.DefaultConfig(), database, peer.NewMap(), events.NewBus()), database
}

func createAPIKey(t *testing.T, database db.Database, plain, name, role, expiresAt string) {
	t.Helper()
	sum := sha256.Sum256([]byte(plain))
	if err := database.CreateAPIKey(&db.APIKey{
		KeyHash:   hex.EncodeToString(sum[:]),
		KeyPrefix: plain[:8],
		Name:      name,
		Role:      role,
		ExpiresAt: expiresAt,
	}); err != nil {
		t.Fatal(err)
	}
}

// GHSA-7j6j-h4qf-86mq: the CDAP agent authentication path looked up API keys
// without checking expiry, so a key that had expired still authenticated agent
// connections forever while the REST path correctly rejected it.
func TestAPIKeyWithoutExpiryAuthenticates(t *testing.T) {
	gateway, database := newAPIKeyAuthGateway(t)
	createAPIKey(t, database, "apikey-no-expiry-0123456789", "permanent", "operator", "")

	username, role, err := gateway.authAPIKey(AuthPayload{Key: "apikey-no-expiry-0123456789"}, "127.0.0.1")
	if err != nil {
		t.Fatalf("authAPIKey: %v", err)
	}
	if username != "apikey:permanent" {
		t.Errorf("username = %q, want apikey:permanent", username)
	}
	if role != "operator" {
		t.Errorf("role = %q, want operator", role)
	}
}

func TestAPIKeyFutureExpiryAuthenticates(t *testing.T) {
	gateway, database := newAPIKeyAuthGateway(t)
	future := time.Now().Add(24 * time.Hour).Format("2006-01-02 15:04:05")
	createAPIKey(t, database, "apikey-future-expiry-0123456789", "valid", "operator", future)

	if _, _, err := gateway.authAPIKey(AuthPayload{Key: "apikey-future-expiry-0123456789"}, "127.0.0.1"); err != nil {
		t.Fatalf("a key that has not expired must authenticate: %v", err)
	}
}

func TestExpiredAPIKeyIsRejected(t *testing.T) {
	gateway, database := newAPIKeyAuthGateway(t)
	past := time.Now().Add(-1 * time.Hour).Format("2006-01-02 15:04:05")
	createAPIKey(t, database, "apikey-expired-0123456789", "expired", "operator", past)

	_, _, err := gateway.authAPIKey(AuthPayload{Key: "apikey-expired-0123456789"}, "127.0.0.1")
	if err == nil {
		t.Fatal("an expired API key must not authenticate over CDAP")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "expired") {
		t.Errorf("rejection should mention expiry, got: %v", err)
	}
}
