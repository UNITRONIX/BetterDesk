package api

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unitronix/betterdesk-server/config"
	"github.com/unitronix/betterdesk-server/db"
	"github.com/unitronix/betterdesk-server/peer"
)

// enrollmentTokenFixture creates a server in the given enrollment mode with one
// active enrollment token, returning the plain token string.
func enrollmentTokenFixture(t *testing.T, mode string) (*Server, string) {
	t.Helper()
	database := testSetupDB(t)
	t.Cleanup(func() { database.Close() })

	cfg := config.DefaultConfig()
	cfg.EnrollmentMode = mode
	srv := New(cfg, database, peer.NewMap(), nil, "test")

	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		t.Fatal(err)
	}
	tokenValue := base64.RawURLEncoding.EncodeToString(raw)
	token := &db.DeviceToken{
		Token:     tokenValue,
		TokenHash: hashToken(tokenValue),
		Name:      "test enrollment token",
		Status:    db.TokenStatusActive,
		MaxUses:   1,
	}
	if err := database.CreateDeviceToken(token); err != nil {
		t.Fatalf("CreateDeviceToken: %v", err)
	}
	return srv, tokenValue
}

func registerWithToken(t *testing.T, srv *Server, deviceID, token string) *httptest.ResponseRecorder {
	t.Helper()
	payload := map[string]any{
		"device_id":   deviceID,
		"uuid":        "machine-" + deviceID,
		"hostname":    "token-host",
		"platform":    "linux",
		"device_type": "betterdesk-desktop",
	}
	if token != "" {
		payload["token"] = token
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/devices/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.handleDeviceRegister(rec, req)
	return rec
}

// A token in managed mode must admit the device immediately.
//
// Managed mode is the default operator-facing mode, and the approval-queue
// answer it used to give for every request meant a token-bearing unattended
// install waited for a human click forever — the exact scenario the token exists
// to remove.
func TestManagedEnrollmentAdmitsWithToken(t *testing.T) {
	srv, token := enrollmentTokenFixture(t, config.EnrollmentModeManaged)

	rec := registerWithToken(t, srv, "BD-MANAGED-TOKEN", token)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var resp EnrollmentResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Status != "approved" {
		t.Fatalf("status = %q, want approved", resp.Status)
	}
	if resp.DeviceToken == "" {
		t.Fatal("expected a device credential in the approved response")
	}
	// The device must really exist, not merely be reported as approved.
	peerRow, err := srv.db.GetPeer("BD-MANAGED-TOKEN")
	if err != nil {
		t.Fatal(err)
	}
	if peerRow == nil {
		t.Fatal("approved device has no peer row")
	}
}

// No token in managed mode keeps the operator approval queue.
func TestManagedEnrollmentWithoutTokenStaysPending(t *testing.T) {
	srv, _ := enrollmentTokenFixture(t, config.EnrollmentModeManaged)

	rec := registerWithToken(t, srv, "BD-MANAGED-PENDING", "")
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202: %s", rec.Code, rec.Body.String())
	}
	var resp EnrollmentResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Status != "pending" {
		t.Fatalf("status = %q, want pending", resp.Status)
	}
}

// A wrong token must be refused loudly, not queued as if it were fine.
func TestManagedEnrollmentRejectsInvalidToken(t *testing.T) {
	srv, _ := enrollmentTokenFixture(t, config.EnrollmentModeManaged)

	rec := registerWithToken(t, srv, "BD-MANAGED-BADTOKEN", "not-a-real-token")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403: %s", rec.Code, rec.Body.String())
	}
	var resp EnrollmentResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Status != "rejected" {
		t.Fatalf("status = %q, want rejected", resp.Status)
	}
	if resp.Error != "enrollment_token_rejected" {
		t.Fatalf("error = %q, want enrollment_token_rejected", resp.Error)
	}
	if pending, _ := srv.db.GetConfig(pendingDevicePrefix + "BD-MANAGED-BADTOKEN"); pending != "" {
		t.Fatal("a device with an invalid token must not enter the pending queue")
	}
}

// A token already bound to one device must not admit a second machine.
func TestEnrollmentTokenCannotAdmitSecondDevice(t *testing.T) {
	srv, token := enrollmentTokenFixture(t, config.EnrollmentModeManaged)

	if rec := registerWithToken(t, srv, "BD-TOKEN-FIRST", token); rec.Code != http.StatusOK {
		t.Fatalf("first device status = %d: %s", rec.Code, rec.Body.String())
	}

	rec := registerWithToken(t, srv, "BD-TOKEN-SECOND", token)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("replayed token status = %d, want 403: %s", rec.Code, rec.Body.String())
	}
	if second, _ := srv.db.GetPeer("BD-TOKEN-SECOND"); second != nil {
		t.Fatal("replayed token admitted a second device")
	}
}

// Locked mode must keep working after the shared helper was extracted.
func TestLockedEnrollmentAdmitsWithToken(t *testing.T) {
	srv, token := enrollmentTokenFixture(t, "locked")

	rec := registerWithToken(t, srv, "BD-LOCKED-TOKEN", token)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var resp EnrollmentResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Status != "approved" {
		t.Fatalf("status = %q, want approved", resp.Status)
	}
}

// Locked mode without a token stays a hard refusal.
func TestLockedEnrollmentWithoutTokenIsRefused(t *testing.T) {
	srv, _ := enrollmentTokenFixture(t, "locked")

	rec := registerWithToken(t, srv, "BD-LOCKED-NOTOKEN", "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403: %s", rec.Code, rec.Body.String())
	}
}
