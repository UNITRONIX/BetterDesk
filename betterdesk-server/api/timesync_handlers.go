package api

import (
	"encoding/json"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/unitronix/betterdesk-server/timesync"
)

var ntpHostnamePattern = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$`)

type timeSyncConfigPayload struct {
	NTPServers         string `json:"ntp_servers"`
	MaxSkewMS          int    `json:"max_skew_ms"`
	RequireSyncedClock bool   `json:"require_synced_clock"`
	TrustOSNTP         bool   `json:"trust_os_ntp"`
}

func timeSyncConfigFromService(service *timesync.Service) timeSyncConfigPayload {
	cfg := service.GetConfig()
	return timeSyncConfigPayload{
		NTPServers:         strings.Join(cfg.Servers, ","),
		MaxSkewMS:          int(cfg.MaxSkew.Milliseconds()),
		RequireSyncedClock: cfg.RequireSync,
		TrustOSNTP:         cfg.TrustOSNTP,
	}
}

func validateNTPServers(raw string) (string, error) {
	parts := strings.Split(raw, ",")
	servers := make([]string, 0, len(parts))
	for _, part := range parts {
		server := strings.TrimSpace(part)
		if server == "" || len(server) > 253 {
			return "", &timeSyncValidationError{"ntp_servers must contain valid hostnames or IP addresses"}
		}
		if net.ParseIP(server) == nil && !ntpHostnamePattern.MatchString(server) {
			return "", &timeSyncValidationError{"ntp_servers contains an invalid hostname or IP address"}
		}
		servers = append(servers, server)
	}
	if len(servers) == 0 {
		return "", &timeSyncValidationError{"ntp_servers must not be empty"}
	}
	return strings.Join(servers, ","), nil
}

type timeSyncValidationError struct {
	message string
}

func (e *timeSyncValidationError) Error() string {
	return e.message
}

// SetTimeSyncService attaches the clock monitor.
func (s *Server) SetTimeSyncService(ts *timesync.Service) {
	s.timeSync = ts
}

// GET /api/timesync/status
func (s *Server) handleTimeSyncStatus(w http.ResponseWriter, r *http.Request) {
	if s.timeSync == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "timesync not configured"})
		return
	}
	writeJSON(w, http.StatusOK, s.timeSync.GetStatus())
}

// POST /api/timesync/check
func (s *Server) handleTimeSyncCheck(w http.ResponseWriter, r *http.Request) {
	if s.timeSync == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "timesync not configured"})
		return
	}
	st := s.timeSync.CheckNow()
	writeJSON(w, http.StatusOK, st)
}

// GET /api/timesync/config
func (s *Server) handleGetTimeSyncConfig(w http.ResponseWriter, r *http.Request) {
	if s.timeSync == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "timesync not configured"})
		return
	}
	writeJSON(w, http.StatusOK, timeSyncConfigFromService(s.timeSync))
}

// PUT /api/timesync/config
//
// This endpoint is used by the panel in Docker image deployments, where the
// console cannot access systemd or the host Docker daemon. The values are
// persisted in the shared server database and applied without restarting the
// Go process.
func (s *Server) handleSetTimeSyncConfig(w http.ResponseWriter, r *http.Request) {
	if s.timeSync == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "timesync not configured"})
		return
	}

	var body timeSyncConfigPayload
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}

	servers, err := validateNTPServers(body.NTPServers)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if body.MaxSkewMS <= 0 || body.MaxSkewMS > 600000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "max_skew_ms must be between 1 and 600000"})
		return
	}

	next := timeSyncConfigPayload{
		NTPServers:         servers,
		MaxSkewMS:          body.MaxSkewMS,
		RequireSyncedClock: body.RequireSyncedClock,
		TrustOSNTP:         body.TrustOSNTP,
	}
	encoded, err := json.Marshal(next)
	if err != nil {
		writeInternalError(w, err, "EncodeTimeSyncConfig")
		return
	}
	if err := s.db.SetConfig(timesync.PersistedConfigKey, string(encoded)); err != nil {
		writeInternalError(w, err, "SetTimeSyncConfig")
		return
	}

	active := s.timeSync.GetConfig()
	s.timeSync.ApplyConfig(timesync.Config{
		Servers:      strings.Split(next.NTPServers, ","),
		Interval:     active.Interval,
		QueryTimeout: active.QueryTimeout,
		MaxSkew:      time.Duration(next.MaxSkewMS) * time.Millisecond,
		RequireSync:  next.RequireSyncedClock,
		TrustOSNTP:   next.TrustOSNTP,
	})
	status := s.timeSync.CheckNow()

	if s.auditLog != nil {
		s.auditLog.Log("timesync_config_changed", s.remoteIP(r), "", map[string]string{
			"ntp_servers":          next.NTPServers,
			"max_skew_ms":          strconv.Itoa(next.MaxSkewMS),
			"require_synced_clock": strconv.FormatBool(next.RequireSyncedClock),
			"trust_os_ntp":         strconv.FormatBool(next.TrustOSNTP),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"config": next,
		"status": status,
	})
}
