package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestValidateOIDCFetchURL(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		{name: "https issuer", raw: "https://accounts.google.com/.well-known/openid-configuration", wantErr: false},
		{name: "http issuer", raw: "http://idp.example.com/.well-known/openid-configuration", wantErr: false},
		{name: "file scheme", raw: "file:///etc/passwd", wantErr: true},
		{name: "metadata IP", raw: "http://169.254.169.254/latest", wantErr: false},
		{name: "private IP", raw: "http://10.0.0.1/.well-known/openid-configuration", wantErr: false},
		{name: "localhost", raw: "http://localhost/.well-known/openid-configuration", wantErr: false},
		{name: "credentials", raw: "https://user:pass@idp.example.com/", wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := validateOIDCFetchURL(tc.raw)
			if tc.wantErr && err == nil {
				t.Fatal("expected error")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestValidateOIDCFetchHost(t *testing.T) {
	ctx := context.Background()
	tests := []struct {
		name    string
		host    string
		wantErr bool
	}{
		{name: "metadata IP", host: "169.254.169.254", wantErr: true},
		{name: "private IP", host: "10.0.0.1", wantErr: true},
		{name: "localhost", host: "localhost", wantErr: true},
		{name: "loopback IP", host: "127.0.0.1", wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := resolveOIDCFetchHost(ctx, tc.host)
			if tc.wantErr && err == nil {
				t.Fatal("expected error")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestValidateOIDCAllowedPrivateCIDRs(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		err  bool
	}{
		{name: "empty", raw: ""},
		{name: "single private IP", raw: "10.20.30.40"},
		{name: "multiple private networks", raw: "10.20.0.0/16, 192.168.50.0/24, fd12:3456::/48"},
		{name: "public network rejected", raw: "8.8.8.0/24", err: true},
		{name: "broad network rejected", raw: "10.0.0.0/7", err: true},
		{name: "loopback rejected", raw: "127.0.0.1", err: true},
		{name: "metadata network rejected", raw: "169.254.0.0/16", err: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateOIDCAllowedPrivateCIDRs(tc.raw); (err != nil) != tc.err {
				t.Fatalf("ValidateOIDCAllowedPrivateCIDRs() error = %v, want error %v", err, tc.err)
			}
		})
	}

	policy, err := newOIDCFetchPolicy("10.20.0.0/16")
	if err != nil {
		t.Fatal(err)
	}
	if err := validateOIDCFetchHostWithPolicy("10.20.30.40", policy); err != nil {
		t.Fatalf("allowlisted private IP rejected: %v", err)
	}
	if err := validateOIDCFetchHostWithPolicy("10.21.30.40", policy); err == nil {
		t.Fatal("private IP outside allowlist was accepted")
	}
	if err := validateOIDCFetchHostWithPolicy("127.0.0.1", policy); err == nil {
		t.Fatal("loopback IP was accepted by private allowlist")
	}
}

func TestValidatedOIDCClientRejectsPrivateRedirect(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://10.0.0.1/internal", http.StatusFound)
	}))
	defer srv.Close()

	_, err := fetchValidatedHTTPGet(http.DefaultClient, srv.URL)
	if err == nil {
		t.Fatal("expected private redirect to be rejected")
	}
}
