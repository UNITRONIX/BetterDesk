package auth

import (
	"context"
	"testing"
	"time"
)

func TestTokenValidationClaims(t *testing.T) {
	tests := []struct {
		name   string
		change func(map[string]interface{})
		reject bool
	}{
		{"valid", nil, false},
		{"wrong audience", func(m map[string]interface{}) { m["aud"] = "other-client" }, true},
		{"wrong issuer", func(m map[string]interface{}) { m["iss"] = "https://other.example.test" }, true},
		{"expired", func(m map[string]interface{}) { m["exp"] = time.Now().Add(-time.Hour).Unix() }, true},
		{"wrong nonce", func(m map[string]interface{}) { m["nonce"] = "different" }, true},
		{"missing nonce", func(m map[string]interface{}) { delete(m, "nonce") }, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, state := tokenValidationFixture(t, tt.change, false, "owner")
			result, err := p.ExchangeCode(context.Background(), "fixture-code", state)
			if tt.reject && err == nil {
				t.Fatal("invalid claims accepted")
			}
			if !tt.reject && (err != nil || result.Username != "owner") {
				t.Fatalf("valid token failed: %v", err)
			}
		})
	}
}

func TestTokenValidationUserInfoSubjectMismatch(t *testing.T) {
	p, state := tokenValidationFixture(t, nil, false, "different-owner")
	if _, err := p.ExchangeCode(context.Background(), "fixture-code", state); err == nil {
		t.Fatal("UserInfo replaced verified ID token subject")
	}
}
