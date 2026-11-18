package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testPanelSecret = "0123456789abcdef0123456789abcdef"

func newClaim(now time.Time) panelClaim {
	return panelClaim{
		Subject: "operator1",
		Role:    "operator",
		OrgID:   "",
		Issued:  now,
		Expires: now.Add(60 * time.Second),
		Nonce:   "nonce-1",
	}
}

func TestPanelTrustRejectsMissingHeader(t *testing.T) {
	_, err := parsePanelClaim("", []byte(testPanelSecret), http.MethodGet, "/api/peers", time.Now())
	if err != errPanelTrustMissing {
		t.Fatalf("want errPanelTrustMissing, got %v", err)
	}
}

func TestPanelTrustRejectsWithoutSecret(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/peers", nil)
	req.Header.Set(PanelTrustHeader, "anything")
	s := &Server{}
	if _, err := s.verifyPanelTrust(req); err != errPanelTrustNoSecret {
		t.Fatalf("want errPanelTrustNoSecret, got %v", err)
	}
}

func TestPanelTrustAcceptsValidStatement(t *testing.T) {
	now := time.Now()
	claim := newClaim(now)
	header := claim.signFor([]byte(testPanelSecret), http.MethodGet, "/api/peers")

	parsed, err := parsePanelClaim(header, []byte(testPanelSecret), http.MethodGet, "/api/peers", now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if parsed.Subject != claim.Subject || parsed.Role != claim.Role || parsed.Nonce != claim.Nonce {
		t.Fatalf("parsed claim does not match: %+v", parsed)
	}
}

func TestPanelTrustRejectsWrongSecret(t *testing.T) {
	now := time.Now()
	claim := newClaim(now)
	header := claim.signFor([]byte(testPanelSecret), http.MethodGet, "/api/peers")

	if _, err := parsePanelClaim(header, []byte("ffffffffffffffffffffffffffffffff"), http.MethodGet, "/api/peers", now); err != errPanelTrustSignature {
		t.Fatalf("want errPanelTrustSignature, got %v", err)
	}
}

func TestPanelTrustRejectsTamperedStatement(t *testing.T) {
	now := time.Now()
	claim := newClaim(now)
	claim.Role = "viewer"
	header := claim.signFor([]byte(testPanelSecret), http.MethodGet, "/api/peers")

	// Same signature, different statement (role raised by editing the payload).
	parts := strings.SplitN(header, ".", 2)
	raised := newClaim(now)
	raised.Role = "super_admin"
	tamperedPayload := strings.SplitN(raised.signFor([]byte(testPanelSecret), http.MethodGet, "/api/peers"), ".", 2)[0]
	forged := tamperedPayload + "." + parts[1]

	if _, err := parsePanelClaim(forged, []byte(testPanelSecret), http.MethodGet, "/api/peers", now); err != errPanelTrustSignature {
		t.Fatalf("want errPanelTrustSignature, got %v", err)
	}
}

func TestPanelTrustRejectsExpiredStatement(t *testing.T) {
	now := time.Now()
	claim := newClaim(now.Add(-10 * time.Minute))
	header := claim.signFor([]byte(testPanelSecret), http.MethodGet, "/api/peers")

	if _, err := parsePanelClaim(header, []byte(testPanelSecret), http.MethodGet, "/api/peers", now); err != errPanelTrustExpired {
		t.Fatalf("want errPanelTrustExpired, got %v", err)
	}
}

func TestPanelTrustRejectsStatementFromTheFuture(t *testing.T) {
	now := time.Now()
	claim := newClaim(now.Add(10 * time.Minute))
	header := claim.signFor([]byte(testPanelSecret), http.MethodGet, "/api/peers")

	if _, err := parsePanelClaim(header, []byte(testPanelSecret), http.MethodGet, "/api/peers", now); err != errPanelTrustExpired {
		t.Fatalf("want errPanelTrustExpired, got %v", err)
	}
}

func TestPanelTrustRejectsOverlongTTL(t *testing.T) {
	now := time.Now()
	claim := newClaim(now)
	claim.Expires = now.Add(30 * time.Minute)
	header := claim.signFor([]byte(testPanelSecret), http.MethodGet, "/api/peers")

	if _, err := parsePanelClaim(header, []byte(testPanelSecret), http.MethodGet, "/api/peers", now); err != errPanelTrustMalformed {
		t.Fatalf("want errPanelTrustMalformed for an overlong TTL, got %v", err)
	}
}

func TestPanelTrustRejectsReuseOnAnotherEndpoint(t *testing.T) {
	now := time.Now()
	claim := newClaim(now)
	header := claim.signFor([]byte(testPanelSecret), http.MethodGet, "/api/peers")

	// Same header, a different path: the statement no longer matches.
	if _, err := parsePanelClaim(header, []byte(testPanelSecret), http.MethodGet, "/api/users", now); err != errPanelTrustSignature {
		t.Fatalf("want errPanelTrustSignature for a cross-endpoint replay, got %v", err)
	}
	// Same header, a different method (a write): refused.
	if _, err := parsePanelClaim(header, []byte(testPanelSecret), http.MethodPost, "/api/peers", now); err != errPanelTrustSignature {
		t.Fatalf("want errPanelTrustSignature for a cross-method replay, got %v", err)
	}
}

func TestPanelTrustRejectsReplay(t *testing.T) {
	now := time.Now()
	claim := newClaim(now)
	header := claim.signFor([]byte(testPanelSecret), http.MethodGet, "/api/peers")

	s := &Server{}
	s.SetPanelTrustSecret(testPanelSecret)

	first := httptest.NewRequest(http.MethodGet, "/api/peers", nil)
	first.Header.Set(PanelTrustHeader, header)
	first.RemoteAddr = "127.0.0.1:5555"
	if _, err := s.verifyPanelTrust(first); err != nil {
		t.Fatalf("first use should pass, got %v", err)
	}

	second := httptest.NewRequest(http.MethodGet, "/api/peers", nil)
	second.Header.Set(PanelTrustHeader, header)
	second.RemoteAddr = "127.0.0.1:5556"
	if _, err := s.verifyPanelTrust(second); err != errPanelTrustReplay {
		t.Fatalf("want errPanelTrustReplay, got %v", err)
	}
}

func TestPanelTrustOnlyFromAllowedPeer(t *testing.T) {
	t.Setenv("PANEL_TRUST_ALLOWED_HOSTS", "")
	s := &Server{}

	local := httptest.NewRequest(http.MethodGet, "/api/peers", nil)
	local.RemoteAddr = "127.0.0.1:5000"
	if !s.panelTrustPeerAllowed(local) {
		t.Fatal("loopback should be allowed")
	}

	remote := httptest.NewRequest(http.MethodGet, "/api/peers", nil)
	remote.RemoteAddr = "203.0.113.7:5000"
	if s.panelTrustPeerAllowed(remote) {
		t.Fatal("a public address must not be allowed by default")
	}

	t.Setenv("PANEL_TRUST_ALLOWED_HOSTS", "172.18.0.0/16")
	docker := httptest.NewRequest(http.MethodGet, "/api/peers", nil)
	docker.RemoteAddr = "172.18.0.4:5000"
	if !s.panelTrustPeerAllowed(docker) {
		t.Fatal("an allowlisted container network should be allowed")
	}
}

func TestPanelTrustDoesNotRaiseRole(t *testing.T) {
	// No database: the claim is used, but only for a role that may act on the
	// API at all. Device and pro roles exist for other transports.
	s := &Server{}
	if got := s.resolvePanelRole(panelClaim{Subject: "x", Role: "device"}); got != "" {
		t.Fatalf("device role must not be accepted, got %q", got)
	}
	if got := s.resolvePanelRole(panelClaim{Subject: "x", Role: "pro"}); got != "" {
		t.Fatalf("pro role must not be accepted, got %q", got)
	}
	if got := s.resolvePanelRole(panelClaim{Subject: "x", Role: "not-a-role"}); got != "" {
		t.Fatalf("unknown role must not be accepted, got %q", got)
	}
	if got := s.resolvePanelRole(panelClaim{Subject: "x", Role: "operator"}); got != "operator" {
		t.Fatalf("a known operator role should pass, got %q", got)
	}
}

func TestPanelTrustDisabledKeepsLegacyAuth(t *testing.T) {
	s := &Server{}
	if s.panelTrustEnabled() {
		t.Fatal("bridge must be off without a secret")
	}
	req := httptest.NewRequest(http.MethodGet, "/api/peers", nil)
	// No credentials at all: the usual 401 path, not a trust decision.
	if _, _, ok := s.authenticateRequest(req); ok {
		t.Fatal("an unauthenticated request must not pass")
	}
}
