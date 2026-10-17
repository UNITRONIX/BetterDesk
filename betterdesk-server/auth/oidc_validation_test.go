package auth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func tokenValidationFixture(t *testing.T, change func(map[string]interface{}), unsigned bool, userinfoSubject string) (*OIDCProvider, string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var issuer *httptest.Server
	issuer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			json.NewEncoder(w).Encode(map[string]interface{}{"issuer": issuer.URL, "authorization_endpoint": issuer.URL + "/authorize", "token_endpoint": issuer.URL + "/token", "userinfo_endpoint": issuer.URL + "/userinfo", "jwks_uri": issuer.URL + "/jwks", "response_types_supported": []string{"code"}, "subject_types_supported": []string{"public"}, "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/jwks":
			json.NewEncoder(w).Encode(map[string]interface{}{"keys": []interface{}{map[string]interface{}{"kty": "RSA", "kid": "test", "alg": "RS256", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())}}})
		case "/token":
			claims := map[string]interface{}{"iss": issuer.URL, "aud": "fixture-client", "sub": "owner", "iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix(), "nonce": "expected-nonce", "email": "owner@example.test"}
			if change != nil {
				change(claims)
			}
			raw, _ := json.Marshal(claims)
			header := `{"alg":"RS256","kid":"test"}`
			if unsigned {
				header = `{"alg":"none"}`
			}
			payload := base64.RawURLEncoding.EncodeToString([]byte(header)) + "." + base64.RawURLEncoding.EncodeToString(raw)
			var sig []byte
			if !unsigned {
				hash := sha256.Sum256([]byte(payload))
				sig, err = rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, hash[:])
				if err != nil {
					t.Error(err)
				}
			}
			json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "fixture-access", "token_type": "Bearer", "id_token": payload + "." + base64.RawURLEncoding.EncodeToString(sig)})
		case "/userinfo":
			json.NewEncoder(w).Encode(map[string]interface{}{"sub": userinfoSubject, "email": "owner@example.test"})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(issuer.Close)
	p := NewOIDCProvider(&OIDCConfig{Enabled: true, IssuerURL: issuer.URL, ClientID: "fixture-client", ClaimUsername: "sub", AutoDiscovery: false, TokenURL: issuer.URL + "/token", UserinfoURL: issuer.URL + "/userinfo", DefaultRole: "admin"})
	p.client = issuer.Client()
	p.states["fixture-state"] = &oidcState{Nonce: "expected-nonce", CreatedAt: time.Now()}
	return p, "fixture-state"
}

func TestTokenValidationRejectsUnsigned(t *testing.T) {
	p, state := tokenValidationFixture(t, nil, true, "owner")
	if result, err := p.ExchangeCode(context.Background(), "fixture-code", state); err == nil {
		t.Fatalf("accepted unsigned ID token: %+v", result)
	}
}
