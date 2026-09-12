package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
)

const secureHTTPEnvelopeHeader = "X-BetterDesk-Envelope"

type secureHTTPResponseWriter struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (w *secureHTTPResponseWriter) Header() http.Header {
	return w.header
}

func (w *secureHTTPResponseWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}

func (w *secureHTTPResponseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.body.Write(data)
}

func (s *Server) secureEnvelopeMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(secureHTTPEnvelopeHeader) != "1" {
			next.ServeHTTP(w, r)
			return
		}

		deviceID := r.Header.Get("X-BetterDesk-Device")
		if deviceID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "secure_device_required"})
			return
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, telemetryMaxPayloadBytes+1))
		if err != nil || len(raw) > telemetryMaxPayloadBytes {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "secure_payload_too_large"})
			return
		}
		opened, err := s.openTelemetryEnvelope(deviceID, raw)
		if err != nil || opened.ResponsePublicKey == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "secure_envelope_rejected"})
			return
		}
		s.rememberSecureClientKey(deviceID, opened.ResponsePublicKey)
		r.Body = io.NopCloser(bytes.NewReader(opened.Payload))

		capture := &secureHTTPResponseWriter{header: make(http.Header)}
		next.ServeHTTP(capture, r)
		status := capture.status
		if status == 0 {
			status = http.StatusOK
		}
		payload := map[string]any{
			"__betterdesk_http": true,
			"status_code":       status,
			"content_type":      capture.header.Get("Content-Type"),
			"body":              base64.StdEncoding.EncodeToString(capture.body.Bytes()),
		}
		envelope, err := s.sealTelemetryResponse(deviceID, payload, *opened.ResponsePublicKey)
		if err != nil {
			http.Error(w, "secure response unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set(secureHTTPEnvelopeHeader, "1")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]any{"betterdesk_envelope": envelope})
	})
}
