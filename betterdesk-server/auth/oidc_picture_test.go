package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSanitizeOIDCPicture(t *testing.T) {
	big := "data:image/png;base64," + strings.Repeat("A", MaxOIDCPictureLen)
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"https url", "https://auth.example.com/media/avatars/a.png", "https://auth.example.com/media/avatars/a.png"},
		{"http url", "http://10.0.0.5:9000/a.jpg", "http://10.0.0.5:9000/a.jpg"},
		{"trimmed", "  https://idp.example/a.png  ", "https://idp.example/a.png"},
		{"png data url", "data:image/png;base64,iVBORw0KGgo=", "data:image/png;base64,iVBORw0KGgo="},
		{"jpeg data url upper-case type", "data:IMAGE/JPEG;base64,/9j/4AAQ", "data:image/jpeg;base64,/9j/4AAQ"},
		{"webp data url", "data:image/webp;base64,UklGRg==", "data:image/webp;base64,UklGRg=="},
		{"gif data url", "data:image/gif;base64,R0lGODlh", "data:image/gif;base64,R0lGODlh"},
		{"svg data url", "data:image/svg+xml;base64,PHN2Zz4=", ""},
		{"html data url", "data:text/html;base64,PHNjcmlwdD4=", ""},
		{"data url not base64", "data:image/png,<svg>", ""},
		{"data url bad payload", "data:image/png;base64,<script>", ""},
		{"data url empty payload", "data:image/png;base64,", ""},
		{"javascript", "javascript:alert(1)", ""},
		{"file", "file:///etc/passwd", ""},
		{"relative", "/media/a.png", ""},
		{"protocol relative", "//evil.example/a.png", ""},
		{"credentials", "https://user:pass@idp.example/a.png", ""},
		{"newline", "https://idp.example/a.png\r\nX: y", ""},
		{"too long", big, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := SanitizeOIDCPicture(tc.in); got != tc.want {
				t.Errorf("SanitizeOIDCPicture(%.60q) = %.60q, want %.60q", tc.in, got, tc.want)
			}
		})
	}
}

// The picture claim is read from the ID token, the userinfo document wins
// when it has one, and the result is sanitized.
func TestExchangeCodeReadsPictureClaim(t *testing.T) {
	run := func(t *testing.T, idTokenPicture string, userinfo map[string]interface{}) *OIDCResult {
		t.Helper()
		payload := map[string]interface{}{"preferred_username": "pic-user"}
		if idTokenPicture != "" {
			payload["picture"] = idTokenPicture
		}
		payloadJSON, _ := json.Marshal(payload)
		idToken := "eyJhbGciOiJSUzI1NiJ9." + base64.RawURLEncoding.EncodeToString(payloadJSON) + ".sig"

		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/token":
				_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "at", "id_token": idToken})
			case "/userinfo":
				if userinfo == nil {
					http.NotFound(w, r)
					return
				}
				_ = json.NewEncoder(w).Encode(userinfo)
			default:
				http.NotFound(w, r)
			}
		}))
		t.Cleanup(srv.Close)

		p := newTestOIDCProvider(t, &OIDCConfig{
			Enabled:          true,
			ClientID:         "client",
			RedirectURL:      "http://localhost/callback",
			AuthorizationURL: "https://idp.example.com/authorize",
			TokenURL:         srv.URL + "/token",
			UserinfoURL:      srv.URL + "/userinfo",
			Scopes:           "openid profile",
		})
		_, state, err := p.BuildAuthURL("/")
		if err != nil {
			t.Fatalf("BuildAuthURL: %v", err)
		}
		result, err := p.ExchangeCode(context.Background(), "code", state)
		if err != nil {
			t.Fatalf("ExchangeCode: %v", err)
		}
		return result
	}

	t.Run("from id token", func(t *testing.T) {
		got := run(t, "https://idp.example/a.png", nil)
		if got.Picture != "https://idp.example/a.png" {
			t.Fatalf("Picture = %q", got.Picture)
		}
	})
	t.Run("userinfo wins", func(t *testing.T) {
		got := run(t, "https://idp.example/old.png", map[string]interface{}{
			"preferred_username": "pic-user",
			"picture":            "data:image/png;base64,iVBORw0KGgo=",
		})
		if got.Picture != "data:image/png;base64,iVBORw0KGgo=" {
			t.Fatalf("Picture = %q", got.Picture)
		}
	})
	t.Run("large inline picture in userinfo", func(t *testing.T) {
		// 1.2 MB of base64: above the old 1 MB response limit, below the cap.
		pic := "data:image/png;base64," + strings.Repeat("A", 1200*1024)
		got := run(t, "", map[string]interface{}{"preferred_username": "pic-user", "picture": pic})
		if got.Picture != pic {
			t.Fatalf("Picture has length %d, want %d", len(got.Picture), len(pic))
		}
	})
	t.Run("svg refused", func(t *testing.T) {
		got := run(t, "data:image/svg+xml;base64,PHN2Zz4=", nil)
		if got.Picture != "" {
			t.Fatalf("Picture = %q, want empty", got.Picture)
		}
	})
	t.Run("absent", func(t *testing.T) {
		got := run(t, "", nil)
		if got.Picture != "" {
			t.Fatalf("Picture = %q, want empty", got.Picture)
		}
	})
}

func TestAuthCodeCarriesPicture(t *testing.T) {
	p := newTestOIDCProvider(t, &OIDCConfig{Enabled: true, ClientID: "c"})
	code, err := p.StoreAuthCode("jwt", "u", "viewer", "/", "https://idp.example/a.png")
	if err != nil {
		t.Fatal(err)
	}
	entry := p.ConsumeAuthCode(code)
	if entry == nil || entry.Picture != "https://idp.example/a.png" {
		t.Fatalf("entry = %+v", entry)
	}
	code, _ = p.StoreAuthCode("jwt", "u", "viewer", "/", "javascript:alert(1)")
	if entry := p.ConsumeAuthCode(code); entry == nil || entry.Picture != "" {
		t.Fatalf("unsafe picture kept: %+v", entry)
	}
}
