package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unitronix/betterdesk-server/config"
	"github.com/unitronix/betterdesk-server/peer"
)

func TestAuthMiddlewarePublicBootstrapEndpoints(t *testing.T) {
	server := New(config.DefaultConfig(), nil, peer.NewMap(), nil, "test")
	handler := server.authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	tests := []struct {
		name   string
		method string
		path   string
		status int
	}{
		{name: "telemetry key", method: http.MethodGet, path: "/api/telemetry/key", status: http.StatusNoContent},
		{name: "branding read", method: http.MethodGet, path: "/api/branding", status: http.StatusNoContent},
		{name: "branding write", method: http.MethodPost, path: "/api/branding", status: http.StatusUnauthorized},
		{name: "protected peers", method: http.MethodGet, path: "/api/peers", status: http.StatusUnauthorized},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, test.path, nil)
			recorder := httptest.NewRecorder()

			handler.ServeHTTP(recorder, request)

			if recorder.Code != test.status {
				t.Fatalf("status = %d, want %d", recorder.Code, test.status)
			}
		})
	}
}
