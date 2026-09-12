package api

import (
	"crypto/ed25519"
	cryptoRand "crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/nacl/box"
	"golang.org/x/crypto/nacl/secretbox"
)

var telemetrySequenceMu sync.Mutex
var telemetryLastSequence = make(map[string]uint64)

const telemetryPrivateKeyConfig = "telemetry_x25519_private"

type telemetryEnvelope struct {
	Version            int    `json:"version"`
	DeviceID           string `json:"device_id"`
	Sequence           uint64 `json:"sequence"`
	ServerKeyID        string `json:"server_key_id"`
	EphemeralPublicKey string `json:"ephemeral_public_key"`
	ResponsePublicKey  string `json:"response_public_key,omitempty"`
	Nonce              string `json:"nonce"`
	Ciphertext         string `json:"ciphertext"`
	Signature          string `json:"signature"`
}

type openedTelemetryEnvelope struct {
	Payload           json.RawMessage
	ResponsePublicKey *[32]byte
}

func (s *Server) rememberSecureClientKey(deviceID string, key *[32]byte) {
	if key == nil || deviceID == "" {
		return
	}
	s.secureClientsMu.Lock()
	s.secureClientKeys[deviceID] = *key
	s.secureClientsMu.Unlock()
}

func (s *Server) secureClientKey(deviceID string) (*[32]byte, bool) {
	s.secureClientsMu.RLock()
	key, ok := s.secureClientKeys[deviceID]
	s.secureClientsMu.RUnlock()
	if !ok {
		return nil, false
	}
	return &key, true
}

func (s *Server) initializeTelemetryKeys() {
	if encoded, err := s.db.GetConfig(telemetryPrivateKeyConfig); err == nil && encoded != "" {
		if decoded, err := base64.StdEncoding.DecodeString(encoded); err == nil && len(decoded) == 32 {
			copy(s.telemetryPrivate[:], decoded)
			s.initializeTelemetryPublicKey()
			return
		}
	}
	if _, err := cryptoRand.Read(s.telemetryPrivate[:]); err != nil {
		return
	}
	if err := s.db.SetConfig(
		telemetryPrivateKeyConfig,
		base64.StdEncoding.EncodeToString(s.telemetryPrivate[:]),
	); err != nil {
		return
	}
	s.initializeTelemetryPublicKey()
}

func (s *Server) initializeTelemetryPublicKey() {
	curve25519.ScalarBaseMult(&s.telemetryPublic, &s.telemetryPrivate)
	s.telemetryReady = true
}

func telemetrySigningMessage(envelope telemetryEnvelope) []byte {
	message := fmt.Sprintf("%d|%s|%d|%s|%s|%s|%s",
		envelope.Version,
		envelope.DeviceID,
		envelope.Sequence,
		envelope.ServerKeyID,
		envelope.EphemeralPublicKey,
		envelope.Nonce,
		envelope.Ciphertext)
	if envelope.ResponsePublicKey != "" {
		message += "|" + envelope.ResponsePublicKey
	}
	return []byte(message)
}

func telemetryKeySigningMessage(version int, keyID, publicKey string) []byte {
	return []byte(fmt.Sprintf("%d|%s|%s", version, keyID, publicKey))
}

func (s *Server) telemetryKeyID() string {
	sum := sha256.Sum256(s.telemetryPublic[:])
	return hexPrefix(sum[:], 16)
}

func hexPrefix(data []byte, length int) string {
	const hex = "0123456789abcdef"
	if length > len(data)*2 {
		length = len(data) * 2
	}
	result := make([]byte, length)
	for i := 0; i < length; i++ {
		value := data[i/2]
		if i%2 == 0 {
			result[i] = hex[value>>4]
		} else {
			result[i] = hex[value&0x0f]
		}
	}
	return string(result)
}

func (s *Server) openTelemetryEnvelope(deviceID string, raw json.RawMessage) (*openedTelemetryEnvelope, error) {
	if !s.telemetryReady {
		return nil, fmt.Errorf("telemetry encryption is not initialized")
	}
	var envelope telemetryEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("invalid telemetry envelope: %w", err)
	}
	if envelope.Version != 1 || envelope.DeviceID != deviceID ||
		envelope.ServerKeyID != s.telemetryKeyID() {
		return nil, fmt.Errorf("telemetry envelope identity mismatch")
	}
	ephemeralBytes, err := base64.StdEncoding.DecodeString(envelope.EphemeralPublicKey)
	if err != nil || len(ephemeralBytes) != 32 {
		return nil, fmt.Errorf("invalid telemetry ephemeral key")
	}
	nonceBytes, err := base64.StdEncoding.DecodeString(envelope.Nonce)
	if err != nil || len(nonceBytes) != 24 {
		return nil, fmt.Errorf("invalid telemetry nonce")
	}
	ciphertext, err := base64.StdEncoding.DecodeString(envelope.Ciphertext)
	if err != nil || len(ciphertext) < secretbox.Overhead {
		return nil, fmt.Errorf("invalid telemetry ciphertext")
	}
	signature, err := base64.StdEncoding.DecodeString(envelope.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return nil, fmt.Errorf("invalid telemetry signature")
	}

	peer, err := s.db.GetPeer(deviceID)
	if err != nil || peer == nil || len(peer.PK) != ed25519.PublicKeySize ||
		!ed25519.Verify(ed25519.PublicKey(peer.PK), telemetrySigningMessage(envelope), signature) {
		return nil, fmt.Errorf("telemetry signature verification failed")
	}

	var ephemeralPublic [32]byte
	copy(ephemeralPublic[:], ephemeralBytes)
	var nonce [24]byte
	copy(nonce[:], nonceBytes)
	var shared [32]byte
	box.Precompute(&shared, &ephemeralPublic, &s.telemetryPrivate)
	plaintext, ok := secretbox.Open(nil, ciphertext, &nonce, &shared)
	if !ok || len(plaintext) > telemetryMaxPayloadBytes {
		return nil, fmt.Errorf("telemetry decryption failed")
	}

	telemetrySequenceMu.Lock()
	last := telemetryLastSequence[deviceID]
	if stored, err := s.db.GetConfig("telemetry_seq_" + deviceID); err == nil {
		if storedSequence, err := strconv.ParseUint(stored, 10, 64); err == nil && storedSequence > last {
			last = storedSequence
		}
	}
	if envelope.Sequence <= last {
		telemetrySequenceMu.Unlock()
		return nil, fmt.Errorf("telemetry replay rejected")
	}
	telemetryLastSequence[deviceID] = envelope.Sequence
	if err := s.db.SetConfig("telemetry_seq_"+deviceID, strconv.FormatUint(envelope.Sequence, 10)); err != nil {
		telemetrySequenceMu.Unlock()
		return nil, fmt.Errorf("telemetry sequence persistence failed: %w", err)
	}
	telemetrySequenceMu.Unlock()

	if !json.Valid(plaintext) {
		return nil, fmt.Errorf("decrypted telemetry is not JSON")
	}
	var responsePublicKey *[32]byte
	if envelope.ResponsePublicKey != "" {
		responseBytes, err := base64.StdEncoding.DecodeString(envelope.ResponsePublicKey)
		if err != nil || len(responseBytes) != 32 {
			return nil, fmt.Errorf("invalid telemetry response key")
		}
		key := &[32]byte{}
		copy(key[:], responseBytes)
		responsePublicKey = key
	}
	return &openedTelemetryEnvelope{
		Payload:           json.RawMessage(plaintext),
		ResponsePublicKey: responsePublicKey,
	}, nil
}

func (s *Server) sealTelemetryResponse(deviceID string, response any, clientPublicKey [32]byte) (map[string]any, error) {
	if !s.telemetryReady || s.keyPair == nil {
		return nil, fmt.Errorf("telemetry encryption is not initialized")
	}
	plaintext, err := json.Marshal(response)
	if err != nil {
		return nil, fmt.Errorf("marshal telemetry response: %w", err)
	}
	ephemeralPublic, ephemeralPrivate, err := box.GenerateKey(cryptoRand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate telemetry response key: %w", err)
	}
	var shared [32]byte
	box.Precompute(&shared, &clientPublicKey, ephemeralPrivate)
	var nonce [24]byte
	if _, err := cryptoRand.Read(nonce[:]); err != nil {
		return nil, fmt.Errorf("generate telemetry response nonce: %w", err)
	}
	ciphertext := secretbox.Seal(nil, plaintext, &nonce, &shared)
	ephemeralEncoded := base64.StdEncoding.EncodeToString(ephemeralPublic[:])
	nonceEncoded := base64.StdEncoding.EncodeToString(nonce[:])
	ciphertextEncoded := base64.StdEncoding.EncodeToString(ciphertext)
	sequence := uint64(time.Now().UnixNano())
	signingMessage := fmt.Sprintf("1|%s|%d|%s|%s|%s|%s",
		deviceID, sequence, s.telemetryKeyID(), ephemeralEncoded, nonceEncoded, ciphertextEncoded)
	signed := append(ed25519.Sign(s.keyPair.PrivateKey, []byte(signingMessage)), []byte(signingMessage)...)
	return map[string]any{
		"version":              1,
		"device_id":            deviceID,
		"sequence":             sequence,
		"server_key_id":        s.telemetryKeyID(),
		"ephemeral_public_key": ephemeralEncoded,
		"nonce":                nonceEncoded,
		"ciphertext":           ciphertextEncoded,
		"signature":            base64.StdEncoding.EncodeToString(signed),
	}, nil
}

func (s *Server) handleTelemetryKey(w http.ResponseWriter, _ *http.Request) {
	if !s.telemetryReady {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "telemetry_key_unavailable"})
		return
	}
	keyID := s.telemetryKeyID()
	publicKey := base64.StdEncoding.EncodeToString(s.telemetryPublic[:])
	message := telemetryKeySigningMessage(1, keyID, publicKey)
	signed := append(ed25519.Sign(s.keyPair.PrivateKey, message), message...)
	writeJSON(w, http.StatusOK, map[string]any{
		"version":    1,
		"key_id":     keyID,
		"public_key": publicKey,
		"signature":  base64.StdEncoding.EncodeToString(signed),
	})
}
