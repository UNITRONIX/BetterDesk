// Package api — panel trust bridge.
//
// The console today is a Node.js process that owns the browser session (cookie,
// CSRF, idle timeout) and forwards most work to this server. Moving domains
// into Go stage by stage needs a way for Go to authorize a request that a
// signed-in operator made through the panel, without Go owning a browser
// session of its own.
//
// The bridge is deliberately narrow:
//
//   - Node signs a short-lived statement with HMAC-SHA256 over
//     method, path, subject, role, org, issued-at, expiry and a nonce;
//   - Go verifies the signature, the time window and replays;
//   - the claimed role is never trusted above the session's real role, and the
//     existing permission middleware still runs afterwards;
//   - the header never reaches the browser: it is added on the loopback hop.
//
// The secret lives in the installer-managed .env (appended, never overwritten
// by updates). With no secret configured the bridge is off and behaviour is
// exactly what it was before.
package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/unitronix/betterdesk-server/auth"
)

const (
	// PanelTrustHeader carries the signed panel identity.
	PanelTrustHeader = "X-BetterDesk-Panel"
	// PanelTrustSecretEnv names the shared secret in the environment.
	PanelTrustSecretEnv = "PANEL_TRUST_SECRET"
	// panelTrustVersion prefixes every statement so a future format can be
	// rejected instead of misread.
	panelTrustVersion = "v1"
	// panelTrustMaxTTL bounds how long a statement may live, whatever the
	// signer asks for.
	panelTrustMaxTTL = 120 * time.Second
	// panelTrustClockSkew allows for small clock differences between the two
	// processes on the same host.
	panelTrustClockSkew = 30 * time.Second
	// panelTrustNonceTTL is how long a used nonce is remembered.
	panelTrustNonceTTL = 150 * time.Second
)

var (
	errPanelTrustMissing   = errors.New("panel trust header missing")
	errPanelTrustMalformed = errors.New("panel trust header malformed")
	errPanelTrustSignature = errors.New("panel trust signature invalid")
	errPanelTrustExpired   = errors.New("panel trust statement expired")
	errPanelTrustReplay    = errors.New("panel trust statement replayed")
	errPanelTrustNoSecret  = errors.New("panel trust secret not configured")
)

// panelClaim is the verified identity of a panel-originated request.
type panelClaim struct {
	Subject string
	Role    string
	OrgID   string
	Issued  time.Time
	Expires time.Time
	Nonce   string
}

// statement is the canonical string that gets signed. Field order and
// separators are part of the format: both sides must produce it identically.
func (c panelClaim) statement(method, path string) string {
	return strings.Join([]string{
		panelTrustVersion,
		strings.ToUpper(method),
		path,
		c.Subject,
		c.Role,
		c.OrgID,
		fmt.Sprintf("%d", c.Issued.Unix()),
		fmt.Sprintf("%d", c.Expires.Unix()),
		c.Nonce,
	}, "\n")
}

// signFor is the only signing entry point: the signature always covers the
// method and path, so a statement captured for one endpoint cannot be replayed
// against another.
func (c panelClaim) signFor(secret []byte, method, path string) string {
	stmt := c.statement(method, path)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(stmt))
	payload := base64.RawURLEncoding.EncodeToString([]byte(stmt))
	return payload + "." + hex.EncodeToString(mac.Sum(nil))
}

// parsePanelClaim decodes and verifies the header value for this request.
func parsePanelClaim(headerValue string, secret []byte, method, path string, now time.Time) (panelClaim, error) {
	var claim panelClaim
	if secret == nil || len(secret) == 0 {
		return claim, errPanelTrustNoSecret
	}
	value := strings.TrimSpace(headerValue)
	if value == "" {
		return claim, errPanelTrustMissing
	}
	dot := strings.LastIndexByte(value, '.')
	if dot <= 0 || dot == len(value)-1 {
		return claim, errPanelTrustMalformed
	}
	stmtBytes, err := base64.RawURLEncoding.DecodeString(value[:dot])
	if err != nil {
		return claim, errPanelTrustMalformed
	}
	sig, err := hex.DecodeString(value[dot+1:])
	if err != nil || len(sig) != sha256.Size {
		return claim, errPanelTrustMalformed
	}
	stmt := string(stmtBytes)

	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(stmt))
	if subtle.ConstantTimeCompare(mac.Sum(nil), sig) != 1 {
		return claim, errPanelTrustSignature
	}

	parts := strings.Split(stmt, "\n")
	if len(parts) != 9 || parts[0] != panelTrustVersion {
		return claim, errPanelTrustMalformed
	}
	if !strings.EqualFold(parts[1], strings.ToUpper(method)) || parts[2] != path {
		// The statement was signed for another method or endpoint.
		return claim, errPanelTrustSignature
	}

	claim.Subject = parts[3]
	claim.Role = parts[4]
	claim.OrgID = parts[5]
	if claim.Subject == "" || claim.Role == "" {
		return claim, errPanelTrustMalformed
	}
	issuedUnix, err := parseInt64Strict(parts[6])
	if err != nil {
		return claim, errPanelTrustMalformed
	}
	expiresUnix, err := parseInt64Strict(parts[7])
	if err != nil {
		return claim, errPanelTrustMalformed
	}
	claim.Issued = time.Unix(issuedUnix, 0)
	claim.Expires = time.Unix(expiresUnix, 0)
	claim.Nonce = parts[8]
	if claim.Nonce == "" {
		return claim, errPanelTrustMalformed
	}
	if claim.Expires.Sub(claim.Issued) > panelTrustMaxTTL {
		return claim, errPanelTrustMalformed
	}
	if now.Add(panelTrustClockSkew).Before(claim.Issued) {
		return claim, errPanelTrustExpired
	}
	if now.After(claim.Expires) {
		return claim, errPanelTrustExpired
	}
	return claim, nil
}

func parseInt64Strict(s string) (int64, error) {
	if s == "" || len(s) > 20 {
		return 0, errPanelTrustMalformed
	}
	var out int64
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0, errPanelTrustMalformed
		}
		out = out*10 + int64(ch-'0')
	}
	return out, nil
}

// panelNonceCache remembers nonces for the statement window, so a captured
// header cannot be replayed while it is still inside its TTL.
type panelNonceCache struct {
	mu    sync.Mutex
	seen  map[string]time.Time
	lastS time.Time
}

func newPanelNonceCache() *panelNonceCache {
	return &panelNonceCache{seen: make(map[string]time.Time)}
}

// use records a nonce. It returns false when the nonce was already used.
func (c *panelNonceCache) use(nonce string, now time.Time) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.seen == nil {
		c.seen = make(map[string]time.Time)
	}
	if now.Sub(c.lastS) > panelTrustNonceTTL {
		for key, at := range c.seen {
			if now.Sub(at) > panelTrustNonceTTL {
				delete(c.seen, key)
			}
		}
		c.lastS = now
	}
	if _, dup := c.seen[nonce]; dup {
		return false
	}
	c.seen[nonce] = now
	return true
}

// SetPanelTrustSecret enables the bridge. An empty secret leaves it disabled.
func (s *Server) SetPanelTrustSecret(secret string) {
	trimmed := strings.TrimSpace(secret)
	if trimmed == "" {
		s.panelTrustSecret = nil
		return
	}
	s.panelTrustSecret = []byte(trimmed)
}

// panelTrustEnabled reports whether the bridge can verify statements.
func (s *Server) panelTrustEnabled() bool {
	return len(s.panelTrustSecret) > 0
}

// panelTrustPeerAllowed limits the bridge to the hop from the console process.
// The console always talks to Go over loopback (both on the same host, or
// through the container network where the panel container's address is in the
// operator's allowlist). Anything else must be listed in
// PANEL_TRUST_ALLOWED_HOSTS — a statement from an arbitrary client is refused
// before the signature is even checked.
func (s *Server) panelTrustPeerAllowed(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(strings.TrimSpace(host))
	if ip == nil {
		return false
	}
	if ip.IsLoopback() {
		return true
	}
	allowed := strings.TrimSpace(os.Getenv("PANEL_TRUST_ALLOWED_HOSTS"))
	if allowed == "" {
		return false
	}
	for _, entry := range strings.Split(allowed, ",") {
		candidate := strings.TrimSpace(entry)
		if candidate == "" {
			continue
		}
		if parsed := net.ParseIP(candidate); parsed != nil && parsed.Equal(ip) {
			return true
		}
		if _, network, err := net.ParseCIDR(candidate); err == nil && network.Contains(ip) {
			return true
		}
	}
	return false
}

// resolvePanelRole returns the role a panel statement may act with.
//
// The claim is a hint, not authority: when the account still exists, its role
// in the database wins, so a demoted or deleted user cannot keep the role their
// session was created with. When the account does not exist, the claim is used
// only for a known role — never a device or pro role, which exist for other
// transports.
func (s *Server) resolvePanelRole(claim panelClaim) string {
	if s.db != nil {
		if user, err := s.db.GetUser(claim.Subject); err == nil && user != nil {
			if user.Role != "" && user.Role != claim.Role {
				log.Printf("[panel-trust] role for %s updated %q -> %q", claim.Subject, claim.Role, user.Role)
			}
			if !auth.ValidRole(user.Role) {
				return ""
			}
			return user.Role
		}
	}
	if !auth.ValidRole(claim.Role) || auth.IsDeviceRole(claim.Role) || auth.IsProRole(claim.Role) {
		return ""
	}
	return claim.Role
}

// verifyPanelTrust reads and verifies the panel statement for this request.
func (s *Server) verifyPanelTrust(r *http.Request) (panelClaim, error) {
	var claim panelClaim
	if !s.panelTrustEnabled() {
		return claim, errPanelTrustNoSecret
	}
	claim, err := parsePanelClaim(
		r.Header.Get(PanelTrustHeader),
		s.panelTrustSecret,
		r.Method,
		r.URL.EscapedPath(),
		time.Now(),
	)
	if err != nil {
		return claim, err
	}
	if s.panelNonces == nil {
		s.panelNonces = newPanelNonceCache()
	}
	if !s.panelNonces.use(claim.Nonce, time.Now()) {
		return claim, errPanelTrustReplay
	}
	return claim, nil
}
