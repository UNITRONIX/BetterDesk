package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unitronix/betterdesk-server/config"
	"github.com/unitronix/betterdesk-server/db"
	"github.com/unitronix/betterdesk-server/peer"
)

// newPairingTestServer builds a server with a real DB but no listener; handlers are
// exercised directly so the test does not depend on port availability in CI.
func newPairingTestServer(t *testing.T) *Server {
	t.Helper()
	cfg := config.DefaultConfig()
	database := testSetupDB(t)
	t.Cleanup(func() { database.Close() })
	return New(cfg, database, peer.NewMap(), nil, "1.0.0-test")
}

func pairingPost(t *testing.T, srv *Server, handler http.HandlerFunc, body any) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(payload))
	req.RemoteAddr = "203.0.113.7:12345"
	rec := httptest.NewRecorder()
	srv.rateLimitPublic(srv.pairingLimiter, handler)(rec, req)
	return rec
}

func mintCode(t *testing.T, srv *Server, label string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"label":"`+label+`"}`))
	req.RemoteAddr = "203.0.113.7:12345"
	rec := httptest.NewRecorder()
	srv.handleCreatePairingCode(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("mint status %d: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Code      string `json:"code"`
		ExpiresIn int    `json:"expires_in"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Code) != pairingCodeLen {
		t.Fatalf("code %q is not %d characters", out.Code, pairingCodeLen)
	}
	if out.ExpiresIn != int(pairingCodeTTL.Seconds()) {
		t.Fatalf("expires_in=%d", out.ExpiresIn)
	}
	return out.Code
}

func TestPairingCodeFormatAndNormalization(t *testing.T) {
	for _, valid := range []string{"ABC234", "abc234", "AB C-234", "a2b3c4"} {
		if !validPairingCodeFormat(valid) {
			t.Fatalf("expected %q to normalize to a valid code", valid)
		}
	}
	// Ambiguous characters are not part of the alphabet, so they are rejected rather than
	// silently guessed: the operator reads the code off the screen.
	for _, invalid := range []string{"", "ABC23", "ABC2345", "ABC23O", "ABC23L", "ABC$34", "abcI23"} {
		if validPairingCodeFormat(invalid) {
			t.Fatalf("expected %q to be rejected", invalid)
		}
	}
	if got := normalizePairingCode("a-b c"); got != "ABC" {
		t.Fatalf("normalize: %q", got)
	}
}

func TestPairingCodeUsesUnambiguousAlphabet(t *testing.T) {
	seen := map[rune]bool{}
	for i := 0; i < 200; i++ {
		code, err := generatePairingCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != pairingCodeLen {
			t.Fatalf("length %d for %q", len(code), code)
		}
		for _, r := range code {
			// Crockford excludes these so a printed code has one reading.
			if strings.ContainsRune("01OILU", r) {
				t.Fatalf("code %q contains an ambiguous character %q", code, r)
			}
			seen[r] = true
		}
	}
	if len(seen) < 20 {
		t.Fatalf("alphabet looks truncated: only %d distinct symbols over 200 codes", len(seen))
	}
}

func TestPairingCodeIsStoredHashedOnly(t *testing.T) {
	srv := newPairingTestServer(t)
	code := mintCode(t, srv, "laptop")

	configs, err := srv.db.ListConfigByPrefix(pairingCodePrefix)
	if err != nil {
		t.Fatal(err)
	}
	if len(configs) != 1 {
		t.Fatalf("expected 1 stored code, got %d", len(configs))
	}
	for _, cfg := range configs {
		if strings.Contains(cfg.Value, code) {
			t.Fatalf("plaintext code leaked into server_config value %q", cfg.Value)
		}
	}
	if srv.loadPairingRecord(pairingCodeHash(code)) == nil {
		t.Fatal("expected a record under the hashed code")
	}
}

func TestPairingRedeemConsumesCode(t *testing.T) {
	srv := newPairingTestServer(t)
	code := mintCode(t, srv, "desk")

	body := map[string]any{
		"code":      code,
		"device_id": "100200300",
		"hostname":  "workstation",
		"platform":  "Windows",
		"version":   "1.5.0",
	}
	first := pairingPost(t, srv, srv.handlePairingRedeem, body)
	if first.Code != http.StatusOK {
		t.Fatalf("first redeem status %d: %s", first.Code, first.Body.String())
	}
	var payload struct {
		Success    bool           `json:"success"`
		Enrollment map[string]any `json:"enrollment"`
		Connection map[string]any `json:"connection"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Success {
		t.Fatalf("redeem did not succeed: %s", first.Body.String())
	}
	if payload.Enrollment["status"] != "approved" {
		t.Fatalf("enrollment status %v", payload.Enrollment["status"])
	}
	// The client needs the connection bundle to configure itself without typing ports.
	for _, key := range []string{"signal", "relay", "api"} {
		if _, ok := payload.Connection[key]; !ok {
			t.Fatalf("connection bundle missing %q: %v", key, payload.Connection)
		}
	}

	// Single use: the same code is rejected afterwards with the same body a never-existing
	// code produces, so a prober cannot distinguish the two.
	second := pairingPost(t, srv, srv.handlePairingRedeem, body)
	if second.Code != http.StatusUnauthorized {
		t.Fatalf("second redeem status %d: %s", second.Code, second.Body.String())
	}
	unknown := pairingPost(t, srv, srv.handlePairingRedeem, map[string]any{
		"code": "ABC234X", "device_id": "100200301",
	})
	if unknown.Body.String() != second.Body.String() {
		t.Fatalf("used and unknown codes are distinguishable:\nused=%s\nunknown=%s",
			second.Body.String(), unknown.Body.String())
	}
}

func TestPairingRedeemRejectsExpiredCode(t *testing.T) {
	srv := newPairingTestServer(t)
	code := mintCode(t, srv, "expired")
	hash := pairingCodeHash(code)
	record := srv.loadPairingRecord(hash)
	if record == nil {
		t.Fatal("missing record")
	}
	record.ExpiresAt = time.Now().UTC().Add(-time.Minute).Format(time.RFC3339)
	if err := srv.storePairingRecord(hash, record); err != nil {
		t.Fatal(err)
	}

	rec := pairingPost(t, srv, srv.handlePairingRedeem, map[string]any{
		"code": code, "device_id": "100200302",
	})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired code status %d", rec.Code)
	}
	if srv.loadPairingRecord(hash) != nil {
		t.Fatal("expired code must be deleted on first use")
	}
}

func TestPairingRedeemRespectsDeviceBans(t *testing.T) {
	srv := newPairingTestServer(t)
	code := mintCode(t, srv, "banned")
	if err := srv.db.UpsertPeer(&db.Peer{ID: "100200303", Status: "OFFLINE"}); err != nil {
		t.Fatal(err)
	}
	if err := srv.db.BanPeer("100200303", "test"); err != nil {
		t.Fatal(err)
	}
	rec := pairingPost(t, srv, srv.handlePairingRedeem, map[string]any{
		"code": code, "device_id": "100200303",
	})
	// A valid code does not bypass the ban.
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "banned") {
		t.Fatalf("expected a ban rejection, got %s", rec.Body.String())
	}
}

func TestPairingConfigPreviewDoesNotConsumeCode(t *testing.T) {
	srv := newPairingTestServer(t)
	code := mintCode(t, srv, "preview")

	for i := 0; i < 2; i++ {
		rec := pairingPost(t, srv, srv.handlePairingConfigPreview, map[string]any{"code": code})
		if rec.Code != http.StatusOK {
			t.Fatalf("preview %d status %d: %s", i, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "connection") {
			t.Fatalf("preview missing connection bundle: %s", rec.Body.String())
		}
	}
	rec := pairingPost(t, srv, srv.handlePairingRedeem, map[string]any{
		"code": code, "device_id": "100200304",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("redeem after preview status %d", rec.Code)
	}
}

func TestPairingListAndRevoke(t *testing.T) {
	srv := newPairingTestServer(t)
	mintCode(t, srv, "one")
	mintCode(t, srv, "two")

	listRec := httptest.NewRecorder()
	srv.handleListPairingCodes(listRec, httptest.NewRequest(http.MethodGet, "/", nil))
	if listRec.Code != http.StatusOK {
		t.Fatalf("list status %d", listRec.Code)
	}
	var listed struct {
		Codes []map[string]any `json:"codes"`
		Count int              `json:"count"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if listed.Count != 2 {
		t.Fatalf("expected 2 live codes, got %d", listed.Count)
	}
	// The listing must never contain the plaintext code.
	for _, item := range listed.Codes {
		if _, ok := item["code"]; ok {
			t.Fatalf("listing exposed a plaintext code: %v", item)
		}
	}

	id, _ := listed.Codes[0]["id"].(string)
	delReq := httptest.NewRequest(http.MethodDelete, "/api/pairing/codes/"+id, nil)
	delReq.SetPathValue("id", id)
	delRec := httptest.NewRecorder()
	srv.handleDeletePairingCode(delRec, delReq)
	if delRec.Code != http.StatusOK {
		t.Fatalf("revoke status %d: %s", delRec.Code, delRec.Body.String())
	}

	missingReq := httptest.NewRequest(http.MethodDelete, "/api/pairing/codes/nope", nil)
	missingReq.SetPathValue("id", "nope")
	missingRec := httptest.NewRecorder()
	srv.handleDeletePairingCode(missingRec, missingReq)
	if missingRec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown id, got %d", missingRec.Code)
	}
}

func TestPairingRedeemIsRateLimited(t *testing.T) {
	srv := newPairingTestServer(t)
	// The limiter allows 10/min per IP; within 12 attempts one must be refused.
	for i := 0; i < 12; i++ {
		rec := pairingPost(t, srv, srv.handlePairingRedeem, map[string]any{
			"code": "ABC234", "device_id": "100200310",
		})
		if rec.Code == http.StatusTooManyRequests {
			if i < 10 {
				t.Fatalf("rate limited after only %d attempts", i+1)
			}
			return
		}
	}
	t.Fatal("expected a 429 within 12 attempts")
}

func TestPairingRejectsMalformedCodeWithoutTouchingStore(t *testing.T) {
	srv := newPairingTestServer(t)
	rec := pairingPost(t, srv, srv.handlePairingRedeem, map[string]any{
		"code": "!!!", "device_id": "100200311",
	})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d", rec.Code)
	}
	configs, _ := srv.db.ListConfigByPrefix(pairingCodePrefix)
	if len(configs) != 0 {
		t.Fatalf("malformed input created %d records", len(configs))
	}
}

func TestPairingRedeemRouteIsPublic(t *testing.T) {
	// Guards against a rename that leaves the route unreachable while handlers compile.
	cfg := config.DefaultConfig()
	database := testSetupDB(t)
	defer database.Close()
	cfg.APIPort = 19891
	srv := New(cfg, database, peer.NewMap(), nil, "1.0.0-test")
	if err := srv.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()
	time.Sleep(80 * time.Millisecond)

	base := fmt.Sprintf("http://127.0.0.1:%d/api", cfg.APIPort)
	resp, err := http.Post(base+"/pairing/redeem", "application/json",
		strings.NewReader(`{"code":"ABC234","device_id":"1"}`))
	if err != nil {
		t.Fatalf("POST /pairing/redeem: %v", err)
	}
	defer resp.Body.Close()
	// 401 (bad code) proves the route exists and is reachable without credentials;
	// 404/405 would mean it is not registered.
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 from public redeem, got %d", resp.StatusCode)
	}
}
