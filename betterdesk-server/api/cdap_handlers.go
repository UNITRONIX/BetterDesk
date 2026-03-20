package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sync/atomic"

	"github.com/unitronix/betterdesk-server/cdap"
)

// commandCounter generates unique command IDs for CDAP commands.
var commandCounter atomic.Int64

// cdapDeviceIDRegexp validates CDAP device ID format: "CDAP-" + 6-16 hex chars, or standard peer IDs.
var cdapDeviceIDRegexp = regexp.MustCompile(`^(CDAP-[A-Fa-f0-9]{6,16}|[A-Za-z0-9_-]{6,16})$`)

// handleCDAPDeviceInfo returns full device info for a connected CDAP device.
// GET /api/cdap/devices/{id}
func (s *Server) handleCDAPDeviceInfo(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !cdapDeviceIDRegexp.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid device ID"})
		return
	}

	if s.cdapGw == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "CDAP gateway not enabled"})
		return
	}

	info := s.cdapGw.GetDeviceInfo(id)
	if info == nil {
		// Device not connected via CDAP — check if manifest exists in DB
		manifest, ok := s.cdapGw.GetDeviceManifest(id)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Device not found or not a CDAP device"})
			return
		}
		writeJSON(w, http.StatusOK, &cdap.DeviceInfo{
			ID:        id,
			Connected: false,
			Manifest:  manifest,
		})
		return
	}

	writeJSON(w, http.StatusOK, info)
}

// handleCDAPDeviceManifest returns the manifest for a CDAP device.
// GET /api/cdap/devices/{id}/manifest
func (s *Server) handleCDAPDeviceManifest(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !cdapDeviceIDRegexp.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid device ID"})
		return
	}

	if s.cdapGw == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "CDAP gateway not enabled"})
		return
	}

	manifest, ok := s.cdapGw.GetDeviceManifest(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "No manifest found for device"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(manifest)
}

// handleCDAPDeviceState returns current widget values for a connected CDAP device.
// GET /api/cdap/devices/{id}/state
func (s *Server) handleCDAPDeviceState(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !cdapDeviceIDRegexp.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid device ID"})
		return
	}

	if s.cdapGw == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "CDAP gateway not enabled"})
		return
	}

	state, ok := s.cdapGw.GetDeviceWidgetState(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Device not connected"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"device_id":    id,
		"widget_state": state,
		"connected":    true,
	})
}

// handleCDAPSendCommand sends a command to a connected CDAP device.
// POST /api/cdap/devices/{id}/command
func (s *Server) handleCDAPSendCommand(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !cdapDeviceIDRegexp.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid device ID"})
		return
	}

	if s.cdapGw == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "CDAP gateway not enabled"})
		return
	}

	var body struct {
		WidgetID string `json:"widget_id"`
		Action   string `json:"action"`
		Value    any    `json:"value"`
		Reason   string `json:"reason,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if body.WidgetID == "" || body.Action == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "widget_id and action are required"})
		return
	}

	// Validate action
	validActions := map[string]bool{"set": true, "trigger": true, "execute": true, "reset": true, "query": true}
	if !validActions[body.Action] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid action. Must be: set, trigger, execute, reset, query"})
		return
	}

	operator := getUsernameFromCtx(r)
	commandID := fmt.Sprintf("cmd_%s_%d", id, commandCounter.Add(1))

	if err := s.cdapGw.SendCommandJSON(r.Context(), id, commandID, body.WidgetID, body.Action, body.Value, operator, body.Reason); err != nil {
		log.Printf("[cdap-api] SendCommand to %s failed: %v", id, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Device not connected or command failed"})
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":     "sent",
		"command_id": commandID,
		"device_id":  id,
	})
}

// handleCDAPListDevices returns all connected CDAP devices with their info.
// GET /api/cdap/devices
func (s *Server) handleCDAPListDevices(w http.ResponseWriter, r *http.Request) {
	if s.cdapGw == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "CDAP gateway not enabled"})
		return
	}

	ids := s.cdapGw.ListConnectedDevices()
	devices := make([]any, 0, len(ids))
	for _, id := range ids {
		if info := s.cdapGw.GetDeviceInfo(id); info != nil {
			devices = append(devices, info)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"devices": devices,
		"total":   len(devices),
	})
}

// handleCDAPStatus returns CDAP gateway status.
// GET /api/cdap/status
func (s *Server) handleCDAPStatus(w http.ResponseWriter, r *http.Request) {
	if s.cdapGw == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"enabled":   false,
			"connected": 0,
			"port":      0,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":   true,
		"connected": s.cdapGw.ActiveConnections(),
		"port":      s.cfg.CDAPPort,
		"tls":       s.cfg.CDAPTLSEnabled(),
	})
}
