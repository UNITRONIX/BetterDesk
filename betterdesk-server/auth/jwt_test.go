package auth

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestJWTGenerateAndValidate(t *testing.T) {
	mgr := NewJWTManager("test-secret-key-32bytes-minimum!", 1*time.Hour)

	token, err := mgr.Generate("admin", "admin")
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}

	parts := strings.SplitN(token, ".", 3)
	if len(parts) != 3 {
		t.Fatalf("Expected 3 parts, got %d", len(parts))
	}

	claims, err := mgr.Validate(token)
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if claims.Sub != "admin" {
		t.Errorf("Expected sub=admin, got %q", claims.Sub)
	}
	if claims.Role != "admin" {
		t.Errorf("Expected role=admin, got %q", claims.Role)
	}
	if claims.Jti == "" {
		t.Error("Expected non-empty jti")
	}
	if claims.Iss != jwtIssuer {
		t.Errorf("Expected iss=%q, got %q", jwtIssuer, claims.Iss)
	}
	if claims.Aud != jwtAudience {
		t.Errorf("Expected aud=%q, got %q", jwtAudience, claims.Aud)
	}
	if claims.Nbf == 0 {
		t.Error("Expected non-zero nbf")
	}
}

func TestJWTRejectsMissingAudienceIssuer(t *testing.T) {
	mgr := NewJWTManager("test-secret-key-32bytes-minimum!", 1*time.Hour)
	token, err := mgr.Generate("admin", "admin")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.SplitN(token, ".", 3)
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatal(err)
	}
	claims.Aud = ""
	claims.Iss = ""
	parts[1] = base64.RawURLEncoding.EncodeToString(mustJSON(claims))
	parts[2] = mgr.sign(parts[0] + "." + parts[1])
	tampered := strings.Join(parts, ".")
	if _, err := mgr.Validate(tampered); err != ErrInvalidToken {
		t.Fatalf("expected ErrInvalidToken for missing aud/iss, got %v", err)
	}
}

func TestJWTRejectsWrongIssuer(t *testing.T) {
	mgr := NewJWTManager("test-secret-key-32bytes-minimum!", 1*time.Hour)
	token, err := mgr.Generate("admin", "admin")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.SplitN(token, ".", 3)
	payload, _ := base64.RawURLEncoding.DecodeString(parts[1])
	var claims Claims
	_ = json.Unmarshal(payload, &claims)
	claims.Iss = "evil-issuer"
	parts[1] = base64.RawURLEncoding.EncodeToString(mustJSON(claims))
	parts[2] = mgr.sign(parts[0] + "." + parts[1])
	if _, err := mgr.Validate(strings.Join(parts, ".")); err != ErrInvalidToken {
		t.Fatalf("expected ErrInvalidToken for wrong iss, got %v", err)
	}
}

func TestJWTRejectsFutureNbf(t *testing.T) {
	mgr := NewJWTManager("test-secret-key-32bytes-minimum!", 1*time.Hour)
	token, err := mgr.Generate("admin", "admin")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.SplitN(token, ".", 3)
	payload, _ := base64.RawURLEncoding.DecodeString(parts[1])
	var claims Claims
	_ = json.Unmarshal(payload, &claims)
	claims.Nbf = time.Now().Unix() + 3600
	parts[1] = base64.RawURLEncoding.EncodeToString(mustJSON(claims))
	parts[2] = mgr.sign(parts[0] + "." + parts[1])
	if _, err := mgr.Validate(strings.Join(parts, ".")); err != ErrTokenNotYet {
		t.Fatalf("expected ErrTokenNotYet, got %v", err)
	}
}

func TestJWTRejectsNonHS256Alg(t *testing.T) {
	mgr := NewJWTManager("test-secret-key-32bytes-minimum!", 1*time.Hour)
	token, err := mgr.Generate("admin", "admin")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.SplitN(token, ".", 3)
	parts[0] = base64.RawURLEncoding.EncodeToString(mustJSON(jwtHeader{Alg: "none", Typ: "JWT"}))
	parts[2] = mgr.sign(parts[0] + "." + parts[1])
	if _, err := mgr.Validate(strings.Join(parts, ".")); err != ErrInvalidToken {
		t.Fatalf("expected ErrInvalidToken for alg=none, got %v", err)
	}
}

func TestJWTExpired(t *testing.T) {
	mgr := NewJWTManager("test-secret", 0) // 0 expiry = already expired

	token, _ := mgr.Generate("user", "viewer")
	time.Sleep(2 * time.Second)
	_, err := mgr.Validate(token)
	if err != ErrTokenExpired {
		t.Errorf("Expected ErrTokenExpired, got %v", err)
	}
}

func TestJWTInvalidSignature(t *testing.T) {
	mgr1 := NewJWTManager("secret-one", 1*time.Hour)
	mgr2 := NewJWTManager("secret-two", 1*time.Hour)

	token, _ := mgr1.Generate("user", "admin")
	_, err := mgr2.Validate(token)
	if err != ErrInvalidToken {
		t.Errorf("Expected ErrInvalidToken, got %v", err)
	}
}

func TestJWTMalformed(t *testing.T) {
	mgr := NewJWTManager("secret", 1*time.Hour)

	tests := []string{
		"",
		"one",
		"one.two",
		"one.two.three",
	}
	for _, tok := range tests {
		_, err := mgr.Validate(tok)
		if err == nil {
			t.Errorf("Expected error for token %q", tok)
		}
	}
}
