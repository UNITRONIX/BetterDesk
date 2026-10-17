package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/unitronix/betterdesk-server/config"
)

type connectionConfigRequest struct {
	Mode                    string       `json:"mode"`
	P2PFallbackMs           *int         `json:"p2p_fallback_ms"`
	SameNATRelay            optionalBool `json:"same_nat_relay"`
	AllowSharedNATInitiator optionalBool `json:"allow_shared_nat_initiator"`
	LoggedInOnlyInitiator   optionalBool `json:"logged_in_only_initiator"`
	OperatorOnlyOutbound    optionalBool `json:"operator_only_outbound"`
}

type optionalBool struct {
	value bool
	set   bool
}

func (b *optionalBool) UnmarshalJSON(data []byte) error {
	if strings.TrimSpace(string(data)) == "null" {
		return fmt.Errorf("boolean must not be null")
	}
	var value bool
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	b.value = value
	b.set = true
	return nil
}

func connectionConfigPayload(settings config.ConnectionSettings) config.ConnectionSettings {
	settings.P2PFirst = settings.Mode != "relay_only"
	settings.AlwaysUseRelay = settings.Mode == "relay_only"
	return settings
}

// GET /api/connection/config
func (s *Server) handleGetConnectionConfig(w http.ResponseWriter, r *http.Request) {
	if s.cfg == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "connection configuration unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, connectionConfigPayload(s.cfg.ConnectionSettings()))
}

// PUT /api/connection/config
//
// This endpoint is used by the panel in split Docker deployments. The
// console cannot write the host's systemd unit or compose file, so the Go
// server persists and applies the allowlisted policy in the shared database.
func (s *Server) handleSetConnectionConfig(w http.ResponseWriter, r *http.Request) {
	if s.cfg == nil || s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "connection configuration unavailable"})
		return
	}

	var body connectionConfigRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid connection configuration"})
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid connection configuration"})
		return
	}
	if body.Mode == "" || body.P2PFallbackMs == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "mode and p2p_fallback_ms are required"})
		return
	}

	next := s.cfg.ConnectionSettings()
	next.Mode = body.Mode
	next.P2PFallbackMs = *body.P2PFallbackMs
	if body.SameNATRelay.set {
		next.SameNATRelay = body.SameNATRelay.value
	}
	if body.AllowSharedNATInitiator.set {
		next.AllowSharedNATInitiator = body.AllowSharedNATInitiator.value
	}
	if body.LoggedInOnlyInitiator.set {
		next.LoggedInOnlyInitiator = body.LoggedInOnlyInitiator.value
	}
	if body.OperatorOnlyOutbound.set {
		next.OperatorOnlyOutbound = body.OperatorOnlyOutbound.value
	}
	if err := next.Validate(); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	next = connectionConfigPayload(next)

	encoded, err := json.Marshal(next)
	if err != nil {
		writeInternalError(w, err, "EncodeConnectionConfig")
		return
	}
	if err := s.db.SetConfig(config.PersistedConnectionSettingsKey, string(encoded)); err != nil {
		writeInternalError(w, err, "SetConnectionConfig")
		return
	}

	// Apply only after persistence succeeds. ApplyConnectionSettings is
	// atomic and cannot fail, so a subsequent restart can always restore the
	// same value from server_config if the process exits before this line.
	s.cfg.ApplyConnectionSettings(next)

	if s.auditLog != nil {
		s.auditLog.Log("connection_config_changed", s.remoteIP(r), getUsernameFromCtx(r), map[string]string{
			"mode":                       next.Mode,
			"p2p_fallback_ms":            strconv.Itoa(next.P2PFallbackMs),
			"same_nat_relay":             formatBool(next.SameNATRelay),
			"allow_shared_nat_initiator": formatBool(next.AllowSharedNATInitiator),
			"logged_in_only_initiator":   formatBool(next.LoggedInOnlyInitiator),
			"operator_only_outbound":     formatBool(next.OperatorOnlyOutbound),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"config": next})
}

func formatBool(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
