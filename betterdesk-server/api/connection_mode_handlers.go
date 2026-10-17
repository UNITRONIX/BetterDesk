package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/unitronix/betterdesk-server/audit"
	"github.com/unitronix/betterdesk-server/db"
)

const connectionModeCapability = "connection-mode.remote-control"

type connectionModeRequest struct {
	Mode         string `json:"mode"`
	Reason       string `json:"reason"`
	OperatorID   string `json:"operator_id"`
	OperatorName string `json:"operator_name"`
}

type verifiedDeviceIdentity struct {
	ProductSKU   string   `json:"product_sku"`
	ConnMode     string   `json:"conn_mode"`
	Capabilities []string `json:"capabilities"`
	Schema       int      `json:"schema"`
}

func (s *Server) handleGetConnectionMode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.peerOrgScopeCheck(w, r, id) {
		return
	}
	peer, err := s.db.GetPeer(id)
	if err != nil || peer == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "peer_not_found"})
		return
	}
	writeJSON(w, http.StatusOK, s.connectionModeView(peer))
}

func (s *Server) handleSetConnectionMode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.peerOrgScopeCheck(w, r, id) {
		return
	}
	peer, err := s.db.GetPeer(id)
	if err != nil || peer == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "peer_not_found"})
		return
	}
	var body connectionModeRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body"})
		return
	}
	controllable, support := s.connectionModeEligibility(peer)
	if support {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "support_agent_permanent"})
		return
	}
	if !controllable {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "capability_required"})
		return
	}
	operatorID := strings.TrimSpace(body.OperatorID)
	operatorName := strings.TrimSpace(body.OperatorName)
	if operatorID == "" {
		operatorID = getUsernameFromCtx(r)
	}
	if operatorName == "" {
		operatorName = getUsernameFromCtx(r)
	}
	command, created, err := s.db.IssueConnectionMode(&db.ConnectionModeIssue{
		DeviceID:     id,
		Mode:         body.Mode,
		Reason:       body.Reason,
		OperatorID:   operatorID,
		OperatorName: operatorName,
	})
	if err != nil {
		writeConnectionModeError(w, err)
		return
	}
	if created && command != nil && s.auditLog != nil {
		s.auditLog.Log(audit.ActionConnectionModeChanged, operatorName, id, map[string]string{
			"operator_id":   command.OperatorID,
			"operator_name": command.OperatorName,
			"device_id":     command.DeviceID,
			"previous_mode": command.PreviousMode,
			"mode":          command.Mode,
			"reason":        command.Reason,
			"command_id":    command.CommandID,
			"revision":      strconv.FormatInt(command.Revision, 10),
			"issued_at":     strconv.FormatInt(command.IssuedAt, 10),
		})
	}
	policy, _ := s.db.GetConnectionModePolicy(id)
	writeJSON(w, http.StatusOK, map[string]any{
		"created": created,
		"command": command,
		"policy":  policy,
	})
}

func writeConnectionModeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrPeerNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "peer_not_found"})
	case errors.Is(err, db.ErrConnectionModeInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_mode"})
	case errors.Is(err, db.ErrConnectionModeReason):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "reason_required"})
	case errors.Is(err, db.ErrConnectionModeNoUUID):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "device_uuid_required"})
	case errors.Is(err, db.ErrConnectionModeBlocked):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "device_blocked"})
	default:
		writeInternalError(w, err, "IssueConnectionMode")
	}
}

func (s *Server) connectionModeView(peer *db.Peer) map[string]any {
	controllable, support := s.connectionModeEligibility(peer)
	policy, err := s.db.GetConnectionModePolicy(peer.ID)
	if err != nil {
		log.Printf("[api] connection mode policy for %s: %v", peer.ID, err)
	}
	command, err := s.db.LatestConnectionModeCommand(peer.ID)
	if err != nil {
		log.Printf("[api] connection mode command for %s: %v", peer.ID, err)
	}
	return map[string]any{
		"device_id":     peer.ID,
		"controllable":  controllable,
		"support_agent": support,
		"policy":        policy,
		"command":       command,
	}
}

func (s *Server) connectionModeEligibility(peer *db.Peer) (controllable, support bool) {
	if peer == nil {
		return false, false
	}
	identity := s.verifiedIdentity(peer.ID)
	if identity.ProductSKU == "betterdesk-support" {
		return false, true
	}
	if identity.ProductSKU == "" && (identity.ConnMode == db.ConnectionModeIncomingOnly || strings.EqualFold(peer.DeviceType, "betterdesk-support")) {
		return false, true
	}
	if identity.ProductSKU == "betterdesk-desktop" && hasConnectionModeCapability(identity.Capabilities) {
		return true, false
	}
	return false, false
}

func (s *Server) verifiedIdentity(deviceID string) verifiedDeviceIdentity {
	var identity verifiedDeviceIdentity
	snap, err := s.db.GetTelemetrySnapshot(deviceID, db.VerifiedIdentityKind)
	if err != nil || snap == nil || snap.Payload == "" {
		return identity
	}
	_ = json.Unmarshal([]byte(snap.Payload), &identity)
	return identity
}

func hasConnectionModeCapability(capabilities []string) bool {
	for _, capability := range capabilities {
		if capability == connectionModeCapability {
			return true
		}
	}
	return false
}

func (s *Server) rememberVerifiedIdentity(deviceID string, body clientHeartbeatRequest) {
	if body.ProductSKU == "" && body.ConnMode == "" && len(body.Capabilities) == 0 {
		return
	}
	payload, err := json.Marshal(verifiedDeviceIdentity{
		ProductSKU:   body.ProductSKU,
		ConnMode:     body.ConnMode,
		Capabilities: body.Capabilities,
		Schema:       body.TelemetrySchema,
	})
	if err != nil {
		return
	}
	s.saveTelemetrySnapshot(deviceID, "identity", "", "ok", "", payload)
	s.saveTelemetrySnapshot(deviceID, db.VerifiedIdentityKind, "", "ok", "", payload)
	s.classifyPeerFromClient(deviceID, body.ProductSKU, body.ConnMode, true)
}

func (s *Server) rememberUnverifiedIdentity(deviceID string, body clientHeartbeatRequest) {
	if snap, err := s.db.GetTelemetrySnapshot(deviceID, db.VerifiedIdentityKind); err == nil && snap != nil {
		return
	}
	if body.ProductSKU == "" && body.ConnMode == "" && len(body.Capabilities) == 0 {
		return
	}
	payload, err := json.Marshal(verifiedDeviceIdentity{
		ProductSKU:   body.ProductSKU,
		ConnMode:     body.ConnMode,
		Capabilities: body.Capabilities,
		Schema:       body.TelemetrySchema,
	})
	if err != nil {
		return
	}
	s.saveTelemetrySnapshot(deviceID, "identity", "", "ok", "", payload)
	s.classifyPeerFromClient(deviceID, body.ProductSKU, body.ConnMode, false)
}

func (s *Server) classifyPeerFromClient(deviceID, productSKU, connMode string, trusted bool) {
	deviceType := classifyBetterDeskDevice(productSKU, connMode)
	if deviceType == "" {
		return
	}
	if !trusted && deviceType == "betterdesk-support" && s.verifiedIdentity(deviceID).ProductSKU == "betterdesk-desktop" {
		return
	}
	if err := s.db.UpdatePeerFields(deviceID, map[string]string{"device_type": deviceType}); err != nil {
		log.Printf("[api] failed to classify BetterDesk device %s: %v", deviceID, err)
	}
}

func (s *Server) withholdClientStrategy(deviceID string, body clientHeartbeatRequest, peerDeviceType string, envelopeVerified bool) bool {
	if envelopeVerified {
		if body.ProductSKU == "betterdesk-support" || body.ConnMode == db.ConnectionModeIncomingOnly {
			return true
		}
	} else if identity := s.verifiedIdentity(deviceID); identity.ProductSKU != "" || identity.ConnMode != "" {
		if identity.ProductSKU == "betterdesk-support" || identity.ConnMode == db.ConnectionModeIncomingOnly {
			return true
		}
	} else if classifyBetterDeskDevice(body.ProductSKU, body.ConnMode) == "betterdesk-support" || strings.EqualFold(peerDeviceType, "betterdesk-support") {
		return true
	}
	policy, err := s.db.GetConnectionModePolicy(deviceID)
	return err == nil && policy != nil && policy.DesiredMode == db.ConnectionModeIncomingOnly
}

func (s *Server) processConnectionModeAck(deviceID string, body clientHeartbeatRequest) {
	if strings.TrimSpace(body.LastCommandID) == "" || strings.TrimSpace(body.PolicyStatus) == "" {
		return
	}
	updated, err := s.db.AcknowledgeConnectionMode(&db.ConnectionModeAck{
		DeviceID:      deviceID,
		CommandID:     body.LastCommandID,
		Revision:      body.PolicyRevision,
		Status:        body.PolicyStatus,
		EffectiveMode: body.EffectiveConnMode,
		RejectionCode: body.PolicyError,
		Now:           time.Now().UTC(),
	})
	if err != nil {
		log.Printf("[api] connection mode ack for %s: %v", deviceID, err)
		return
	}
	if !updated {
		return
	}
}

func connectionModeWire(command *db.ConnectionModeCommand) map[string]any {
	return map[string]any{
		"command_id":  command.CommandID,
		"revision":    command.Revision,
		"target_id":   command.DeviceID,
		"target_uuid": command.DeviceUUID,
		"mode":        command.Mode,
		"issued_at":   command.IssuedAt,
		"expires_at":  command.ExpiresAt,
		"reason":      command.Reason,
	}
}

func (s *Server) writeHeartbeatResponse(w http.ResponseWriter, deviceID string, publicResp map[string]any, responseKey *[32]byte) {
	if responseKey == nil {
		writeJSON(w, http.StatusOK, publicResp)
		return
	}
	payload := make(map[string]any, len(publicResp)+1)
	for key, value := range publicResp {
		payload[key] = value
	}
	var deliverID string
	if command, err := s.db.DeliverableConnectionModeCommand(deviceID, time.Now().UTC()); err != nil {
		log.Printf("[api] connection mode delivery for %s: %v", deviceID, err)
	} else if command != nil {
		payload["connection_mode_command"] = connectionModeWire(command)
		deliverID = command.CommandID
	}
	envelope, err := s.sealTelemetryResponse(deviceID, payload, *responseKey)
	if err != nil {
		writeJSON(w, http.StatusOK, publicResp)
		return
	}
	if deliverID != "" {
		if err := s.db.MarkConnectionModeDelivered(deliverID, time.Now().UTC()); err != nil {
			log.Printf("[api] connection mode delivered mark for %s: %v", deviceID, err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"betterdesk_envelope": envelope})
}
