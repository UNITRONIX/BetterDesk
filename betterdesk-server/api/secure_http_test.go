package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSecureEnvelopeMiddlewareAcceptsClientWrapper(t *testing.T) {
	srv, deviceID, _, devicePriv, responsePub, _ := newConnectionModeFixture(t)
	envelope := sealClientHeartbeat(
		t,
		srv,
		deviceID,
		devicePriv,
		1,
		map[string]any{"request": "ok"},
		responsePub,
	)
	body, err := json.Marshal(map[string]json.RawMessage{
		"betterdesk_envelope": envelope,
	})
	if err != nil {
		t.Fatalf("marshal wrapped envelope: %v", err)
	}

	req := httptest.NewRequest(
		http.MethodGet,
		"/api/device-group/accessible",
		bytes.NewReader(body),
	)
	req.Header.Set("X-BetterDesk-Envelope", "1")
	req.Header.Set("X-BetterDesk-Device", deviceID)
	rec := httptest.NewRecorder()

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		payload, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read decrypted payload: %v", err)
		}
		if string(payload) != `{"request":"ok"}` {
			t.Fatalf("decrypted payload = %s", payload)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	srv.secureEnvelopeMiddleware(next).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var response map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode encrypted response: %v", err)
	}
	if _, ok := response["betterdesk_envelope"]; !ok {
		t.Fatalf("response missing betterdesk_envelope: %s", rec.Body.String())
	}
}
