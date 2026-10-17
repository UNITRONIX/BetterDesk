package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/unitronix/betterdesk-server/audit"
	"github.com/unitronix/betterdesk-server/db"
)

const (
	telemetryMaxPayloadBytes = 512 * 1024
	telemetryCommandTTL      = 10 * time.Minute
)

var allowedTelemetryCommands = map[string]bool{
	"collect.hardware":  true,
	"collect.metrics":   true,
	"collect.services":  true,
	"collect.processes": true,
	"collect.events":    true,
	"collect.activity":  true,
	"files.browse":      true,
	"files.read":        true,
	"service.control":   true,
	"process.terminate": true,
}

type clientTelemetryEnvelope struct {
	Schema      int                            `json:"telemetry_schema"`
	SampleID    string                         `json:"sample_id"`
	CollectedAt string                         `json:"collected_at"`
	Metrics     json.RawMessage                `json:"metrics"`
	Status      map[string]string              `json:"status"`
	Snapshots   []clientTelemetrySnapshot      `json:"snapshots"`
	Results     []clientTelemetryCommandResult `json:"results"`
}

type clientTelemetrySnapshot struct {
	Kind        string          `json:"kind"`
	SampleID    string          `json:"sample_id"`
	Status      string          `json:"status"`
	CollectedAt string          `json:"collected_at"`
	Data        json.RawMessage `json:"data"`
}

type clientTelemetryCommandResult struct {
	ID     int64           `json:"id"`
	Status string          `json:"status"`
	Result json.RawMessage `json:"result"`
}

type queuedTelemetryCommand struct {
	ID      int64           `json:"id"`
	Command string          `json:"command"`
	Args    json.RawMessage `json:"args"`
	Expires string          `json:"expires_at"`
}

func telemetryStatus(status string) string {
	switch status {
	case "ok", "unsupported", "permission_denied", "unavailable", "error":
		return status
	default:
		return "error"
	}
}

func telemetryJSON(raw json.RawMessage, max int) (string, error) {
	if len(raw) == 0 {
		return "{}", nil
	}
	if len(raw) > max || !json.Valid(raw) {
		return "", fmt.Errorf("invalid telemetry JSON")
	}
	return string(raw), nil
}

func (s *Server) saveTelemetrySnapshot(deviceID, kind, sampleID, status, collectedAt string, data json.RawMessage) {
	if strings.TrimSpace(kind) == "" || len(kind) > 32 {
		return
	}
	payload, err := telemetryJSON(data, telemetryMaxPayloadBytes)
	if err != nil {
		return
	}
	if collectedAt == "" {
		collectedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if err := s.db.SaveTelemetrySnapshot(&db.TelemetrySnapshot{
		DeviceID:    deviceID,
		Kind:        kind,
		SampleID:    sampleID,
		Status:      telemetryStatus(status),
		Payload:     payload,
		CollectedAt: collectedAt,
	}); err != nil {
		s.auditLog.Log(audit.ActionTelemetrySnapshotError, deviceID, kind,
			map[string]string{"error": err.Error()})
	}
}

func (s *Server) saveClientTelemetry(deviceID string, raw json.RawMessage) {
	if len(raw) == 0 || len(raw) > telemetryMaxPayloadBytes {
		return
	}
	var envelope clientTelemetryEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return
	}
	if envelope.Schema != 0 && envelope.Schema != 1 {
		return
	}
	if len(envelope.Metrics) > 0 {
		s.saveTelemetrySnapshot(deviceID, "metrics", envelope.SampleID, envelope.Status["metrics"],
			envelope.CollectedAt, envelope.Metrics)
	}
	for _, snapshot := range envelope.Snapshots {
		s.saveTelemetrySnapshot(deviceID, snapshot.Kind, snapshot.SampleID,
			snapshot.Status, snapshot.CollectedAt, snapshot.Data)
	}
	for _, result := range envelope.Results {
		if result.ID <= 0 {
			continue
		}
		var resultObject struct {
			Snapshot *clientTelemetrySnapshot `json:"snapshot"`
		}
		if len(result.Result) > 0 && json.Unmarshal(result.Result, &resultObject) == nil &&
			resultObject.Snapshot != nil {
			snapshot := resultObject.Snapshot
			s.saveTelemetrySnapshot(deviceID, snapshot.Kind, snapshot.SampleID,
				snapshot.Status, snapshot.CollectedAt, snapshot.Data)
		}
		resultJSON, err := telemetryJSON(result.Result, 256*1024)
		if err != nil {
			resultJSON = `{"status":"error","code":"invalid_result"}`
		}
		status := result.Status
		switch status {
		case "queued", "ok", "rejected", "unsupported", "permission_denied", "error":
		default:
			status = "error"
		}
		if err := s.db.CompleteTelemetryCommand(result.ID, status, resultJSON); err != nil {
			s.auditLog.Log(audit.ActionTelemetryCommandResult, deviceID, fmt.Sprint(result.ID),
				map[string]string{"error": err.Error()})
		}
	}
}

func (s *Server) telemetryCommandsForDevice(deviceID string) []queuedTelemetryCommand {
	commands, err := s.db.GetPendingTelemetryCommands(deviceID, 10)
	if err != nil {
		return nil
	}
	result := make([]queuedTelemetryCommand, 0, len(commands))
	for _, command := range commands {
		args := json.RawMessage(command.Args)
		if !json.Valid(args) {
			args = json.RawMessage(`{}`)
		}
		result = append(result, queuedTelemetryCommand{
			ID: command.ID, Command: command.Command, Args: args, Expires: command.ExpiresAt,
		})
	}
	return result
}

// handleGetPeerTelemetry returns the latest bounded snapshots for a device.
func (s *Server) handleGetPeerTelemetry(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("id")
	peer, err := s.db.GetPeer(deviceID)
	if err != nil || peer == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "device_not_found"})
		return
	}

	kinds := []string{"identity", "metrics", "hardware", "services", "processes", "events", "activity", "files"}
	snapshots := make(map[string]any, len(kinds))
	for _, kind := range kinds {
		snapshot, err := s.db.GetTelemetrySnapshot(deviceID, kind)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "telemetry_read_failed"})
			return
		}
		if snapshot == nil {
			continue
		}
		var payload any
		if err := json.Unmarshal([]byte(snapshot.Payload), &payload); err != nil {
			payload = map[string]string{"status": "error"}
		}
		snapshots[kind] = map[string]any{
			"sample_id":    snapshot.SampleID,
			"status":       snapshot.Status,
			"collected_at": snapshot.CollectedAt,
			"received_at":  snapshot.ReceivedAt,
			"data":         payload,
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"device_id": deviceID,
		"schema":    1,
		"snapshots": snapshots,
	})
}

// handleRefreshPeerHardware queues a bounded inventory refresh command.
func (s *Server) handleRefreshPeerHardware(w http.ResponseWriter, r *http.Request) {
	s.queueTelemetryCommand(w, r, "collect.hardware", json.RawMessage(`{}`))
}

// handleQueuePeerTelemetryCommand queues an allowlisted device command.
func (s *Server) handleQueuePeerTelemetryCommand(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Command string          `json:"command"`
		Args    json.RawMessage `json:"args"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_command"})
		return
	}
	s.queueTelemetryCommand(w, r, body.Command, body.Args)
}

func (s *Server) queueTelemetryCommand(w http.ResponseWriter, r *http.Request, command string, args json.RawMessage) {
	deviceID := r.PathValue("id")
	if !allowedTelemetryCommands[command] {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "command_not_allowed"})
		return
	}
	peer, err := s.db.GetPeer(deviceID)
	if err != nil || peer == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "device_not_found"})
		return
	}
	if snapshot, err := s.db.GetTelemetrySnapshot(deviceID, "identity"); err == nil && snapshot != nil {
		var identity struct {
			ProductSKU string `json:"product_sku"`
		}
		if json.Unmarshal([]byte(snapshot.Payload), &identity) == nil &&
			identity.ProductSKU == "betterdesk-support" && command != "collect.metrics" {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "support_agent_restricted"})
			return
		}
	}
	if len(args) == 0 {
		args = json.RawMessage(`{}`)
	}
	argsJSON, err := telemetryJSON(args, 32*1024)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_command_args"})
		return
	}
	commandID, err := s.db.QueueTelemetryCommand(&db.TelemetryCommand{
		DeviceID:  deviceID,
		Command:   command,
		Args:      argsJSON,
		ExpiresAt: time.Now().UTC().Add(telemetryCommandTTL).Format("2006-01-02 15:04:05"),
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "command_queue_failed"})
		return
	}
	s.auditLog.Log(audit.ActionTelemetryCommandQueued, "operator", deviceID,
		map[string]string{"command": command, "command_id": fmt.Sprint(commandID)})
	writeJSON(w, http.StatusAccepted, map[string]any{
		"accepted":   true,
		"command_id": commandID,
		"device_id":  deviceID,
	})
}
