package api

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/unitronix/betterdesk-server/audit"
	"github.com/unitronix/betterdesk-server/db"
)

const (
	remoteTargetProtocolRDP = "rdp"
	remoteTargetProtocolVNC = "vnc"
)

var remoteTargetFingerprintPattern = regexp.MustCompile(`^[a-f0-9]{32,128}([: -][a-f0-9]{2,})*$`)

type remoteTargetRequest struct {
	OrgID           string `json:"org_id"`
	Name            string `json:"name"`
	Protocol        string `json:"protocol"`
	Platform        string `json:"platform"`
	Host            string `json:"host"`
	Port            int    `json:"port"`
	Username        string `json:"username"`
	CredentialMode  string `json:"credential_mode"`
	TLSMode         string `json:"tls_mode"`
	CertFingerprint string `json:"cert_fingerprint"`
	Enabled         *bool  `json:"enabled"`
}

type remoteTargetCredentialRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func validateRemoteTargetRequest(body *remoteTargetRequest) error {
	body.Name = strings.TrimSpace(body.Name)
	body.OrgID = strings.TrimSpace(body.OrgID)
	body.Protocol = strings.ToLower(strings.TrimSpace(body.Protocol))
	body.Platform = strings.TrimSpace(body.Platform)
	body.Host = strings.TrimSpace(body.Host)
	body.Username = strings.TrimSpace(body.Username)
	body.CredentialMode = strings.ToLower(strings.TrimSpace(body.CredentialMode))
	body.TLSMode = strings.ToLower(strings.TrimSpace(body.TLSMode))
	body.CertFingerprint = strings.ToLower(strings.TrimSpace(body.CertFingerprint))
	if body.Name == "" || len(body.Name) > 160 {
		return fmt.Errorf("name is required and must be at most 160 characters")
	}
	if body.Protocol != remoteTargetProtocolRDP && body.Protocol != remoteTargetProtocolVNC {
		return fmt.Errorf("protocol must be rdp or vnc")
	}
	if body.Host == "" || len(body.Host) > 253 || strings.ContainsAny(body.Host, "\r\n\t /\\") {
		return fmt.Errorf("invalid host")
	}
	if net.ParseIP(body.Host) == nil && strings.Contains(body.Host, ":") {
		return fmt.Errorf("invalid host")
	}
	if body.Port < 1 || body.Port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535")
	}
	if body.CredentialMode == "" {
		body.CredentialMode = "prompt"
	}
	if body.CredentialMode != "saved" && body.CredentialMode != "prompt" && body.CredentialMode != "none" {
		return fmt.Errorf("credential_mode must be saved, prompt, or none")
	}
	if body.TLSMode == "" {
		body.TLSMode = "preferred"
	}
	if body.TLSMode != "required" && body.TLSMode != "preferred" && body.TLSMode != "disabled" {
		return fmt.Errorf("tls_mode must be required, preferred, or disabled")
	}
	if body.CertFingerprint != "" && len(body.CertFingerprint) > 128 {
		return fmt.Errorf("certificate fingerprint is too long")
	}
	return nil
}

func (s *Server) handleListRemoteTargets(w http.ResponseWriter, r *http.Request) {
	orgID := strings.TrimSpace(r.URL.Query().Get("org_id"))
	includeDisabled := r.URL.Query().Get("include_disabled") == "true"
	targets, err := s.db.ListRemoteTargets(orgID, includeDisabled)
	if err != nil {
		writeInternalError(w, err, "ListRemoteTargets")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"targets": targets})
}

func (s *Server) handleGetRemoteTarget(w http.ResponseWriter, r *http.Request) {
	target, err := s.db.GetRemoteTarget(r.PathValue("id"))
	if err != nil {
		writeInternalError(w, err, "GetRemoteTarget")
		return
	}
	if target == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "remote target not found"})
		return
	}
	writeJSON(w, http.StatusOK, target)
}

func (s *Server) handleCreateRemoteTarget(w http.ResponseWriter, r *http.Request) {
	var body remoteTargetRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if err := validateRemoteTargetRequest(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	target := &db.RemoteTarget{
		ID:              "rt_" + strings.ReplaceAll(uuid.New().String(), "-", ""),
		OrgID:           body.OrgID,
		Name:            body.Name,
		Protocol:        body.Protocol,
		Platform:        body.Platform,
		Host:            body.Host,
		Port:            body.Port,
		Username:        body.Username,
		CredentialMode:  body.CredentialMode,
		TLSMode:         body.TLSMode,
		CertFingerprint: body.CertFingerprint,
		Enabled:         enabled,
		CreatedBy:       getUsernameFromCtx(r),
	}
	if err := s.db.CreateRemoteTarget(target); err != nil {
		writeInternalError(w, err, "CreateRemoteTarget")
		return
	}
	if s.auditLog != nil {
		s.auditLog.Log(audit.Action("remote_target_created"), s.remoteIP(r), target.ID,
			map[string]string{"protocol": target.Protocol, "host": target.Host})
	}
	writeJSON(w, http.StatusCreated, target)
}

func (s *Server) handleTestRemoteTarget(w http.ResponseWriter, r *http.Request) {
	var body remoteTargetRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if err := validateRemoteTargetRequest(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	host, err := resolveRemoteTargetHost(body.Host)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "remote target is not allowed"})
		return
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(body.Port)), 5*time.Second)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "remote target is unreachable"})
		return
	}
	_ = conn.Close()
	writeJSON(w, http.StatusOK, map[string]any{
		"reachable": true,
		"protocol":  body.Protocol,
		"host":      body.Host,
		"port":      body.Port,
	})
}

func (s *Server) handleUpdateRemoteTarget(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	target, err := s.db.GetRemoteTarget(id)
	if err != nil {
		writeInternalError(w, err, "GetRemoteTarget")
		return
	}
	if target == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "remote target not found"})
		return
	}
	var body remoteTargetRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if body.Name == "" {
		body.Name = target.Name
	}
	if body.Protocol == "" {
		body.Protocol = target.Protocol
	}
	if body.Host == "" {
		body.Host = target.Host
	}
	if body.Port == 0 {
		body.Port = target.Port
	}
	if body.CredentialMode == "" {
		body.CredentialMode = target.CredentialMode
	}
	if body.TLSMode == "" {
		body.TLSMode = target.TLSMode
	}
	if body.Username == "" {
		body.Username = target.Username
	}
	if body.OrgID == "" {
		body.OrgID = target.OrgID
	}
	if body.CertFingerprint == "" {
		body.CertFingerprint = target.CertFingerprint
	}
	if err := validateRemoteTargetRequest(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	target.OrgID, target.Name, target.Protocol = body.OrgID, body.Name, body.Protocol
	target.Platform, target.Host, target.Port = body.Platform, body.Host, body.Port
	target.Username, target.CredentialMode = body.Username, body.CredentialMode
	target.TLSMode, target.CertFingerprint = body.TLSMode, body.CertFingerprint
	if body.Enabled != nil {
		target.Enabled = *body.Enabled
	}
	if err := s.db.UpdateRemoteTarget(target); err != nil {
		writeInternalError(w, err, "UpdateRemoteTarget")
		return
	}
	if s.auditLog != nil {
		s.auditLog.Log(audit.Action("remote_target_updated"), s.remoteIP(r), target.ID,
			map[string]string{"protocol": target.Protocol, "host": target.Host})
	}
	writeJSON(w, http.StatusOK, target)
}

func (s *Server) handleDeleteRemoteTarget(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.db.DeleteRemoteTarget(id); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "remote target not found"})
		return
	}
	if s.auditLog != nil {
		s.auditLog.Log(audit.Action("remote_target_deleted"), s.remoteIP(r), id, nil)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "id": id})
}

func (s *Server) handleGetRemoteTargetCredentialStatus(w http.ResponseWriter, r *http.Request) {
	target, err := s.db.GetRemoteTarget(r.PathValue("id"))
	if err != nil {
		writeInternalError(w, err, "GetRemoteTarget")
		return
	}
	if target == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "remote target not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"username":        target.Username,
		"password_set":    target.CredentialCiphertext != "",
		"credential_mode": target.CredentialMode,
	})
}

func (s *Server) handleSetRemoteTargetCredentials(w http.ResponseWriter, r *http.Request) {
	if s.remoteTargetVault == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "remote target credential vault is not configured",
		})
		return
	}
	target, err := s.db.GetRemoteTarget(r.PathValue("id"))
	if err != nil {
		writeInternalError(w, err, "GetRemoteTarget")
		return
	}
	if target == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "remote target not found"})
		return
	}
	var body remoteTargetCredentialRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	if len(body.Username) > 256 || len(body.Password) > 4096 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "credential value too long"})
		return
	}
	if body.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password is required"})
		return
	}
	nonce, ciphertext, keyID, err := s.remoteTargetVault.Seal(body.Password)
	if err != nil {
		writeInternalError(w, err, "SealRemoteTargetCredential")
		return
	}
	target.Username = body.Username
	target.CredentialMode = "saved"
	target.CredentialNonce = nonce
	target.CredentialCiphertext = ciphertext
	target.CredentialKeyID = keyID
	if err := s.db.UpdateRemoteTarget(target); err != nil {
		writeInternalError(w, err, "UpdateRemoteTargetCredential")
		return
	}
	if s.auditLog != nil {
		s.auditLog.Log(audit.Action("remote_target_credential_set"), s.remoteIP(r), target.ID,
			map[string]string{"actor": getUsernameFromCtx(r)})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok", "username": target.Username, "password_set": true,
	})
}

func (s *Server) handleClearRemoteTargetCredentials(w http.ResponseWriter, r *http.Request) {
	target, err := s.db.GetRemoteTarget(r.PathValue("id"))
	if err != nil {
		writeInternalError(w, err, "GetRemoteTarget")
		return
	}
	if target == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "remote target not found"})
		return
	}
	target.CredentialMode = "prompt"
	target.CredentialCiphertext = ""
	target.CredentialNonce = ""
	target.CredentialKeyID = ""
	if err := s.db.UpdateRemoteTarget(target); err != nil {
		writeInternalError(w, err, "ClearRemoteTargetCredential")
		return
	}
	if s.auditLog != nil {
		s.auditLog.Log(audit.Action("remote_target_credential_cleared"), s.remoteIP(r), target.ID,
			map[string]string{"actor": getUsernameFromCtx(r)})
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "credential_mode": "prompt"})
}

func (s *Server) handleAcceptRemoteTargetCertificate(w http.ResponseWriter, r *http.Request) {
	target, err := s.db.GetRemoteTarget(r.PathValue("id"))
	if err != nil {
		writeInternalError(w, err, "GetRemoteTarget")
		return
	}
	if target == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "remote target not found"})
		return
	}
	var body struct {
		Fingerprint string `json:"fingerprint"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	body.Fingerprint = strings.ToLower(strings.Join(strings.Fields(body.Fingerprint), ""))
	if !remoteTargetFingerprintPattern.MatchString(body.Fingerprint) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid certificate fingerprint"})
		return
	}
	target.CertFingerprint = body.Fingerprint
	if err := s.db.UpdateRemoteTarget(target); err != nil {
		writeInternalError(w, err, "AcceptRemoteTargetCertificate")
		return
	}
	if s.auditLog != nil {
		s.auditLog.Log(audit.Action("remote_target_certificate_trusted"), s.remoteIP(r), target.ID,
			map[string]string{"actor": getUsernameFromCtx(r), "fingerprint": body.Fingerprint})
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "fingerprint": body.Fingerprint})
}
