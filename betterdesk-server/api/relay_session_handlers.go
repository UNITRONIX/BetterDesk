package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

type relaySessionEventRequest struct {
	Action    string `json:"action"`
	RelayUUID string `json:"relay_uuid"`
	EndedAt   string `json:"ended_at"`
	Reason    string `json:"reason"`
}

// handleRelaySessionEvent lets a relay report that a session it was carrying has
// finished.
//
// Signal records a session when it hands out a relay ticket, but the bytes then
// flow through the relay — which on a split deployment is a different host with
// its own database. Only the relay sees the pipe close, so without this the
// session stays open until the target device goes offline, and the connected-time
// report keeps counting long after the operator disconnected.
//
// The internal API key is the trust boundary, as it is for the console handler.
func (s *Server) handleRelaySessionEvent(w http.ResponseWriter, r *http.Request) {
	var request relaySessionEventRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid session event"})
		return
	}
	request.Action = strings.ToLower(strings.TrimSpace(request.Action))
	request.RelayUUID = strings.TrimSpace(request.RelayUUID)
	request.Reason = truncStr(strings.TrimSpace(request.Reason), 64)

	if request.Action != "end" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid action"})
		return
	}
	if _, err := uuid.Parse(request.RelayUUID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid relay_uuid"})
		return
	}

	// Trust the relay's clock only within bounds it cannot distort: never later
	// than now, and EndRemoteAccessSession keeps it from preceding the start.
	endedAt := time.Now().UTC()
	if request.EndedAt != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, request.EndedAt); err == nil {
			parsed = parsed.UTC()
			if parsed.Before(endedAt) {
				endedAt = parsed
			}
		}
	}
	reason := request.Reason
	if reason == "" {
		reason = "relay_session_ended"
	}
	if err := s.db.EndRemoteAccessSession("signal:"+request.RelayUUID, endedAt, reason); err != nil {
		writeInternalError(w, err, "EndRemoteAccessSession")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "ended_at": endedAt})
}
