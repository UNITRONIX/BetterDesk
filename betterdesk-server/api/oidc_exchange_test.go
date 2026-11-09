package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unitronix/betterdesk-server/auth"
)

func exchangeOIDCCodeForTest(t *testing.T, s *Server, code string) map[string]interface{} {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/oidc/exchange", strings.NewReader(`{"code":"`+code+`"}`))
	rec := httptest.NewRecorder()
	s.handleOIDCExchange(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body
}

// The exchange response keeps its fields and adds "picture".
func TestHandleOIDCExchangeIncludesPicture(t *testing.T) {
	p := auth.NewOIDCProvider(&auth.OIDCConfig{Enabled: true, ClientID: "c"})
	t.Cleanup(p.Close)
	s := &Server{oidcProvider: p}

	code, err := p.StoreAuthCode("jwt-token", "alice", "operator", "/devices", "https://idp.example/alice.png")
	if err != nil {
		t.Fatal(err)
	}
	body := exchangeOIDCCodeForTest(t, s, code)
	want := map[string]string{
		"token":      "jwt-token",
		"username":   "alice",
		"role":       "operator",
		"return_url": "/devices",
		"picture":    "https://idp.example/alice.png",
	}
	for k, v := range want {
		if body[k] != v {
			t.Errorf("%s = %v, want %q", k, body[k], v)
		}
	}
}

// Without a picture the field is present and empty, so the console can clear
// a stored picture.
func TestHandleOIDCExchangeEmptyPicture(t *testing.T) {
	p := auth.NewOIDCProvider(&auth.OIDCConfig{Enabled: true, ClientID: "c"})
	t.Cleanup(p.Close)
	s := &Server{oidcProvider: p}

	code, _ := p.StoreAuthCode("jwt-token", "bob", "viewer", "/", "")
	body := exchangeOIDCCodeForTest(t, s, code)
	pic, ok := body["picture"]
	if !ok {
		t.Fatal("picture field missing")
	}
	if pic != "" {
		t.Fatalf("picture = %v, want empty", pic)
	}
}
