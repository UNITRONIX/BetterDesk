package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	cryptoRand "crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/unitronix/betterdesk-server/audit"
	"github.com/unitronix/betterdesk-server/auth"
	"github.com/unitronix/betterdesk-server/config"
	bdcrypto "github.com/unitronix/betterdesk-server/crypto"
	"github.com/unitronix/betterdesk-server/db"
	"github.com/unitronix/betterdesk-server/peer"
	"golang.org/x/crypto/nacl/box"
	"golang.org/x/crypto/nacl/secretbox"
)

var connectionModeDeviceSeq atomic.Uint64

func newConnectionModeFixture(t *testing.T) (*Server, string, string, ed25519.PrivateKey, *[32]byte, *[32]byte) {
	t.Helper()
	n := connectionModeDeviceSeq.Add(1)
	deviceID := "cm" + itoa(n) + "desk"
	if len(deviceID) < 6 || len(deviceID) > 16 {
		t.Fatalf("device id %q has invalid length", deviceID)
	}
	deviceUUID := "dXVpZC1maXh0dXJlLTE"
	database := testSetupDB(t)
	t.Cleanup(func() { database.Close() })
	pub, priv, err := ed25519.GenerateKey(cryptoRand.Reader)
	if err != nil {
		t.Fatalf("device key: %v", err)
	}
	if err := database.UpsertPeer(&db.Peer{ID: deviceID, UUID: deviceUUID, PK: pub}); err != nil {
		t.Fatalf("UpsertPeer: %v", err)
	}
	keyPair, err := bdcrypto.GenerateKeyPair()
	if err != nil {
		t.Fatalf("server key: %v", err)
	}
	srv := New(config.DefaultConfig(), database, peer.NewMap(), nil, "test")
	srv.SetKeyPair(keyPair)
	srv.SetAuditLogger(audit.NewLogger(""))
	responsePub, responsePriv, err := box.GenerateKey(cryptoRand.Reader)
	if err != nil {
		t.Fatalf("response key: %v", err)
	}
	return srv, deviceID, deviceUUID, priv, responsePub, responsePriv
}

func itoa(n uint64) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

func sealClientHeartbeat(t *testing.T, srv *Server, deviceID string, devicePriv ed25519.PrivateKey, seq uint64, payload any, responsePub *[32]byte) json.RawMessage {
	t.Helper()
	plain, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	ephPub, ephPriv, err := box.GenerateKey(cryptoRand.Reader)
	if err != nil {
		t.Fatalf("ephemeral: %v", err)
	}
	var shared [32]byte
	box.Precompute(&shared, &srv.telemetryPublic, ephPriv)
	var nonce [24]byte
	if _, err := cryptoRand.Read(nonce[:]); err != nil {
		t.Fatalf("nonce: %v", err)
	}
	ciphertext := secretbox.Seal(nil, plain, &nonce, &shared)
	env := telemetryEnvelope{
		Version:            1,
		DeviceID:           deviceID,
		Sequence:           seq,
		ServerKeyID:        srv.telemetryKeyID(),
		EphemeralPublicKey: base64.StdEncoding.EncodeToString(ephPub[:]),
		Nonce:              base64.StdEncoding.EncodeToString(nonce[:]),
		Ciphertext:         base64.StdEncoding.EncodeToString(ciphertext),
	}
	if responsePub != nil {
		env.ResponsePublicKey = base64.StdEncoding.EncodeToString(responsePub[:])
	}
	env.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(devicePriv, telemetrySigningMessage(env)))
	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	return raw
}

func postHeartbeat(t *testing.T, srv *Server, deviceID, deviceUUID string, envelope json.RawMessage) map[string]any {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"id":                  deviceID,
		"uuid":                deviceUUID,
		"betterdesk_envelope": envelope,
	})
	if err != nil {
		t.Fatalf("marshal heartbeat: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/heartbeat", bytes.NewReader(body))
	req.RemoteAddr = "198.51.100.10:1234"
	rec := httptest.NewRecorder()
	srv.handleClientHeartbeat(rec, req)
	var decoded map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode heartbeat %d %s: %v", rec.Code, rec.Body.String(), err)
	}
	return decoded
}

func openSealedHeartbeat(t *testing.T, srv *Server, response map[string]any, responsePriv *[32]byte) map[string]any {
	t.Helper()
	envelope, ok := response["betterdesk_envelope"].(map[string]any)
	if !ok {
		t.Fatalf("response is not sealed: %#v", response)
	}
	if _, leaked := response["connection_mode_command"]; leaked {
		t.Fatal("connection_mode_command leaked beside the envelope")
	}
	if envelope["server_key_id"] != srv.telemetryKeyID() {
		t.Fatalf("server_key_id = %v", envelope["server_key_id"])
	}
	signed, err := base64.StdEncoding.DecodeString(envelope["signature"].(string))
	if err != nil || len(signed) < ed25519.SignatureSize {
		t.Fatalf("response signature: %v", err)
	}
	if !ed25519.Verify(srv.keyPair.PublicKey, signed[ed25519.SignatureSize:], signed[:ed25519.SignatureSize]) {
		t.Fatal("server response signature did not verify")
	}
	ephRaw, _ := base64.StdEncoding.DecodeString(envelope["ephemeral_public_key"].(string))
	nonceRaw, _ := base64.StdEncoding.DecodeString(envelope["nonce"].(string))
	ciphertext, _ := base64.StdEncoding.DecodeString(envelope["ciphertext"].(string))
	var eph [32]byte
	var nonce [24]byte
	copy(eph[:], ephRaw)
	copy(nonce[:], nonceRaw)
	var shared [32]byte
	box.Precompute(&shared, &eph, responsePriv)
	plain, ok := secretbox.Open(nil, ciphertext, &nonce, &shared)
	if !ok {
		t.Fatal("response decrypt failed")
	}
	var payload map[string]any
	if err := json.Unmarshal(plain, &payload); err != nil {
		t.Fatalf("response json: %v", err)
	}
	assertCommandNotInStrategy(t, payload)
	return payload
}

func assertCommandNotInStrategy(t *testing.T, payload map[string]any) {
	t.Helper()
	strategy, _ := payload["strategy"].(map[string]any)
	if strategy == nil {
		return
	}
	if _, ok := strategy["connection_mode_command"]; ok {
		t.Fatal("connection_mode_command was placed in strategy")
	}
	if opts, ok := strategy["config_options"].(map[string]any); ok {
		if _, exists := opts["connection_mode_command"]; exists {
			t.Fatal("connection_mode_command was placed in config_options")
		}
	}
}

func desktopIdentity(deviceID, deviceUUID, mode string) map[string]any {
	return map[string]any{
		"id":           deviceID,
		"uuid":         deviceUUID,
		"product_sku":  "betterdesk-desktop",
		"conn_mode":    mode,
		"capabilities": []string{"connection-mode.remote-control"},
		"modified_at":  0,
	}
}

func issueMode(t *testing.T, srv *Server, deviceID, mode, reason, operator string) map[string]any {
	t.Helper()
	body, _ := json.Marshal(map[string]string{
		"mode": mode, "reason": reason, "operator_id": operator, "operator_name": operator,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/peers/"+deviceID+"/connection-mode", bytes.NewReader(body))
	req.SetPathValue("id", deviceID)
	ctx := context.WithValue(req.Context(), ctxKeyRole, auth.RoleAdmin)
	ctx = context.WithValue(ctx, ctxKeyUsername, operator)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	srv.requirePermission(auth.PermDeviceConnectionMode, srv.handleSetConnectionMode)(rec, req)
	var decoded map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode issue %d %s: %v", rec.Code, rec.Body.String(), err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("issue status %d: %s", rec.Code, rec.Body.String())
	}
	return decoded
}

func TestConnectionModeRoundTripAndPlaintextHold(t *testing.T) {
	srv, deviceID, deviceUUID, devicePriv, responsePub, responsePriv := newConnectionModeFixture(t)

	identify := postHeartbeat(t, srv, deviceID, deviceUUID, sealClientHeartbeat(t, srv, deviceID, devicePriv, 1, desktopIdentity(deviceID, deviceUUID, "normal"), responsePub))
	opened := openSealedHeartbeat(t, srv, identify, responsePriv)
	if _, ok := opened["connection_mode_command"]; ok {
		t.Fatal("command delivered before an operator request")
	}

	plainReq := httptest.NewRequest(http.MethodPost, "/api/heartbeat", bytes.NewReader([]byte(`{"id":"`+deviceID+`","conn_mode":"incoming-only","product_sku":"betterdesk-support"}`)))
	plainReq.RemoteAddr = "198.51.100.11:9"
	plainRec := httptest.NewRecorder()
	srv.handleClientHeartbeat(plainRec, plainReq)
	if bytes.Contains(plainRec.Body.Bytes(), []byte("connection_mode_command")) {
		t.Fatalf("plaintext heartbeat carried a command: %s", plainRec.Body.String())
	}

	issued := issueMode(t, srv, deviceID, "incoming-only", "support session", "ada")
	command := issued["command"].(map[string]any)
	if command["mode"] != "incoming-only" || command["revision"].(float64) != 1 {
		t.Fatalf("issued command: %#v", command)
	}

	delivered := postHeartbeat(t, srv, deviceID, deviceUUID, sealClientHeartbeat(t, srv, deviceID, devicePriv, 2, desktopIdentity(deviceID, deviceUUID, "normal"), responsePub))
	payload := openSealedHeartbeat(t, srv, delivered, responsePriv)
	wire := payload["connection_mode_command"].(map[string]any)
	if wire["command_id"] != command["command_id"] || wire["revision"].(float64) != 1 || wire["target_uuid"] != deviceUUID || wire["target_id"] != deviceID || wire["mode"] != "incoming-only" {
		t.Fatalf("wire command: %#v", wire)
	}

	retryBody := desktopIdentity(deviceID, deviceUUID, "normal")
	retried := postHeartbeat(t, srv, deviceID, deviceUUID, sealClientHeartbeat(t, srv, deviceID, devicePriv, 3, retryBody, responsePub))
	retryPayload := openSealedHeartbeat(t, srv, retried, responsePriv)
	retryWire := retryPayload["connection_mode_command"].(map[string]any)
	if retryWire["command_id"] != wire["command_id"] || retryWire["revision"] != wire["revision"] {
		t.Fatalf("retry changed command identity: %#v", retryWire)
	}

	ack := desktopIdentity(deviceID, deviceUUID, "incoming-only")
	ack["effective_conn_mode"] = "incoming-only"
	ack["policy_revision"] = 1
	ack["policy_status"] = "applied"
	ack["last_command_id"] = wire["command_id"]
	acked := postHeartbeat(t, srv, deviceID, deviceUUID, sealClientHeartbeat(t, srv, deviceID, devicePriv, 4, ack, responsePub))
	ackedPayload := openSealedHeartbeat(t, srv, acked, responsePriv)
	if _, ok := ackedPayload["connection_mode_command"]; ok {
		t.Fatal("applied command was delivered again")
	}

	back := issueMode(t, srv, deviceID, "normal", "session finished", "ada")
	backCmd := back["command"].(map[string]any)
	if backCmd["command_id"] == command["command_id"] || backCmd["revision"].(float64) != 2 || backCmd["mode"] != "normal" {
		t.Fatalf("return to normal: %#v", backCmd)
	}
	events := srv.auditLog.Recent(5)
	if len(events) < 2 || events[0].Action != audit.ActionConnectionModeChanged {
		t.Fatalf("audit events: %#v", events)
	}
	details := events[0].Details
	if details["operator_name"] != "ada" || details["device_id"] != deviceID || details["previous_mode"] != "incoming-only" || details["mode"] != "normal" || details["reason"] != "session finished" || details["issued_at"] == "" {
		t.Fatalf("audit details: %#v", details)
	}
}

func TestConnectionModeBadSignatureStaysQueued(t *testing.T) {
	srv, deviceID, deviceUUID, devicePriv, responsePub, _ := newConnectionModeFixture(t)
	postHeartbeat(t, srv, deviceID, deviceUUID, sealClientHeartbeat(t, srv, deviceID, devicePriv, 1, desktopIdentity(deviceID, deviceUUID, "normal"), responsePub))
	issueMode(t, srv, deviceID, "incoming-only", "hold", "ada")

	env := sealClientHeartbeat(t, srv, deviceID, devicePriv, 2, desktopIdentity(deviceID, deviceUUID, "normal"), responsePub)
	var tampered telemetryEnvelope
	if err := json.Unmarshal(env, &tampered); err != nil {
		t.Fatal(err)
	}
	tampered.Signature = base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, ed25519.SignatureSize))
	raw, _ := json.Marshal(tampered)
	response := postHeartbeat(t, srv, deviceID, deviceUUID, raw)
	if _, ok := response["betterdesk_envelope"]; ok || response["connection_mode_command"] != nil {
		t.Fatalf("bad signature delivered a command: %#v", response)
	}
	if bytes.Contains([]byte(mustJSON(response)), []byte("connection_mode_command")) {
		t.Fatal("bad signature response contained the command")
	}
	latest, err := srv.db.LatestConnectionModeCommand(deviceID)
	if err != nil || latest.Status != db.ConnectionCommandQueued {
		t.Fatalf("command status after bad signature: %#v err=%v", latest, err)
	}

	spoof := map[string]any{
		"id": deviceID, "effective_conn_mode": "incoming-only", "policy_revision": 1,
		"policy_status": "applied", "last_command_id": latest.CommandID,
	}
	plain, _ := json.Marshal(spoof)
	req := httptest.NewRequest(http.MethodPost, "/api/heartbeat", bytes.NewReader(plain))
	req.RemoteAddr = "198.51.100.12:9"
	rec := httptest.NewRecorder()
	srv.handleClientHeartbeat(rec, req)
	latest, err = srv.db.LatestConnectionModeCommand(deviceID)
	if err != nil || latest.Status != db.ConnectionCommandQueued {
		t.Fatalf("plaintext ack was accepted: %#v err=%v", latest, err)
	}
}

func TestConnectionModeSupportAgentRejectsNormal(t *testing.T) {
	srv, deviceID, deviceUUID, devicePriv, responsePub, _ := newConnectionModeFixture(t)
	payload := map[string]any{
		"id": deviceID, "uuid": deviceUUID, "product_sku": "betterdesk-support",
		"conn_mode": "incoming-only", "capabilities": []string{"connection-mode.remote-control"},
	}
	postHeartbeat(t, srv, deviceID, deviceUUID, sealClientHeartbeat(t, srv, deviceID, devicePriv, 1, payload, responsePub))
	body, _ := json.Marshal(map[string]string{"mode": "normal", "reason": "promote", "operator_id": "ada", "operator_name": "ada"})
	req := httptest.NewRequest(http.MethodPost, "/api/peers/"+deviceID+"/connection-mode", bytes.NewReader(body))
	req.SetPathValue("id", deviceID)
	req = req.WithContext(context.WithValue(req.Context(), ctxKeyRole, auth.RoleAdmin))
	rec := httptest.NewRecorder()
	srv.handleSetConnectionMode(rec, req)
	if rec.Code != http.StatusConflict || !bytes.Contains(rec.Body.Bytes(), []byte("support_agent_permanent")) {
		t.Fatalf("support agent response %d %s", rec.Code, rec.Body.String())
	}
	latest, err := srv.db.LatestConnectionModeCommand(deviceID)
	if err != nil || latest != nil {
		t.Fatalf("support agent stored a command: %#v err=%v", latest, err)
	}
}

func TestConnectionModeRequiresCapabilityAndUUID(t *testing.T) {
	srv, deviceID, deviceUUID, devicePriv, responsePub, _ := newConnectionModeFixture(t)
	payload := desktopIdentity(deviceID, deviceUUID, "normal")
	payload["capabilities"] = []string{"telemetry.metrics"}
	postHeartbeat(t, srv, deviceID, deviceUUID, sealClientHeartbeat(t, srv, deviceID, devicePriv, 1, payload, responsePub))
	body, _ := json.Marshal(map[string]string{"mode": "incoming-only", "reason": "try", "operator_name": "ada"})
	req := httptest.NewRequest(http.MethodPost, "/api/peers/"+deviceID+"/connection-mode", bytes.NewReader(body))
	req.SetPathValue("id", deviceID)
	req = req.WithContext(context.WithValue(req.Context(), ctxKeyRole, auth.RoleAdmin))
	rec := httptest.NewRecorder()
	srv.handleSetConnectionMode(rec, req)
	if rec.Code != http.StatusConflict || !bytes.Contains(rec.Body.Bytes(), []byte("capability_required")) {
		t.Fatalf("missing capability %d %s", rec.Code, rec.Body.String())
	}

	emptyID := "cmnouuid1"
	if err := srv.db.UpsertPeer(&db.Peer{ID: emptyID, UUID: "", PK: []byte("not-used-here-but-long")}); err != nil {
		t.Fatal(err)
	}
	// Eligibility requires a verified desktop identity before the UUID check.
	identity, _ := json.Marshal(map[string]any{
		"product_sku": "betterdesk-desktop", "conn_mode": "normal",
		"capabilities": []string{"connection-mode.remote-control"},
	})
	if err := srv.db.SaveTelemetrySnapshot(&db.TelemetrySnapshot{
		DeviceID: emptyID, Kind: db.VerifiedIdentityKind, Status: "ok", Payload: string(identity),
	}); err != nil {
		t.Fatal(err)
	}
	body, _ = json.Marshal(map[string]string{"mode": "incoming-only", "reason": "missing uuid", "operator_name": "ada"})
	req = httptest.NewRequest(http.MethodPost, "/api/peers/"+emptyID+"/connection-mode", bytes.NewReader(body))
	req.SetPathValue("id", emptyID)
	req = req.WithContext(context.WithValue(req.Context(), ctxKeyRole, auth.RoleAdmin))
	rec = httptest.NewRecorder()
	srv.handleSetConnectionMode(rec, req)
	if rec.Code != http.StatusConflict || !bytes.Contains(rec.Body.Bytes(), []byte("device_uuid_required")) {
		t.Fatalf("missing uuid %d %s", rec.Code, rec.Body.String())
	}
}

func TestConnectionModeViewerForbidden(t *testing.T) {
	srv, deviceID, _, _, _, _ := newConnectionModeFixture(t)
	body, _ := json.Marshal(map[string]string{"mode": "incoming-only", "reason": "nope"})
	req := httptest.NewRequest(http.MethodPost, "/api/peers/"+deviceID+"/connection-mode", bytes.NewReader(body))
	req.SetPathValue("id", deviceID)
	req = req.WithContext(context.WithValue(req.Context(), ctxKeyRole, auth.RoleViewer))
	rec := httptest.NewRecorder()
	srv.requirePermission(auth.PermDeviceConnectionMode, srv.handleSetConnectionMode)(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("viewer status %d %s", rec.Code, rec.Body.String())
	}
}

func mustJSON(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}
