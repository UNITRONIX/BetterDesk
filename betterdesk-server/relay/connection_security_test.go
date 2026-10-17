package relay

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/unitronix/betterdesk-server/codec"
	"github.com/unitronix/betterdesk-server/config"
	"github.com/unitronix/betterdesk-server/crypto"
	pb "github.com/unitronix/betterdesk-server/proto"
	"github.com/unitronix/betterdesk-server/sessiongrant"
)

// Connection security suite — local loopback only.
// Covers unauthorized relay access, ticket consumption, and server-key impersonation guards.

func TestConnectionSecurity_UnauthorizedRelayUUIDRejected(t *testing.T) {
	// Direct claim path (same gate used by TCP/WS) — no long auth-wait sleep.
	srv := New(config.DefaultConfig())
	srv.ctx, srv.cancel = context.WithCancel(context.Background())
	defer srv.cancel()

	if srv.claimRelayUUID("attacker-guessed-uuid-no-ticket", "127.0.0.1:40000") {
		t.Fatal("guessed relay UUID must be rejected without signal ticket")
	}
	if srv.ActiveSessions.Load() != 0 {
		t.Fatal("unauthorized claim must not create an active session")
	}
}

func TestConnectionSecurity_UnauthorizedTCPDoesNotPair(t *testing.T) {
	cfg := config.DefaultConfig()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	cfg.RelayPort = port

	srv := New(cfg)
	if err := srv.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()

	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 3*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	req := &pb.RendezvousMessage{
		Union: &pb.RendezvousMessage_RequestRelay{
			RequestRelay: &pb.RequestRelay{
				Uuid: "tcp-attacker-uuid-no-ticket",
				Id:   "ATTACKER",
			},
		},
	}
	if err := codec.WriteRawProto(conn, req); err != nil {
		t.Fatal(err)
	}

	// Give the server a short window; must never mark an active paired session.
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if srv.ActiveSessions.Load() != 0 {
			t.Fatal("unauthorized TCP RequestRelay produced active session")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestConnectionSecurity_ThirdClaimCannotJoinPairedRelay(t *testing.T) {
	registry := NewAuthorizationRegistry()
	uuid := "pair-security-uuid-001"
	if !registry.Authorize(uuid, "INIT", "TARGET") {
		t.Fatal("authorize")
	}
	if !registry.Claim(uuid) || !registry.Claim(uuid) {
		t.Fatal("pair claims")
	}
	if registry.Claim(uuid) {
		t.Fatal("third party must not claim consumed relay ticket")
	}
}

func TestConnectionSecurity_RevokedPeerCannotClaim(t *testing.T) {
	registry := NewAuthorizationRegistry()
	uuid := "revoked-security-uuid"
	if !registry.Authorize(uuid, "BANNED", "TARGET") {
		t.Fatal("authorize")
	}
	registry.RevokeForPeer("BANNED")
	if registry.Claim(uuid) {
		t.Fatal("revoked peer ticket must not be claimable")
	}
}

func TestConnectionSecurity_SessionGrantRejectsWrongKeyAndDevice(t *testing.T) {
	now := time.Now().UTC()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := sessiongrant.NewSigner(priv)
	if err != nil {
		t.Fatal(err)
	}

	token, err := signer.Issue(sessiongrant.Claims{
		DeviceID:     "BD-12345",
		OperatorID:   "op-1",
		SessionID:    "sess-1",
		Transport:    "relay",
		Initiator:    "operator",
		Capabilities: []string{"desktop"},
		ExpiresAt:    now.Add(5 * time.Minute).Unix(),
		Nonce:        "n1",
	})
	if err != nil {
		t.Fatal(err)
	}

	// Wrong device → reject (session hijack / retarget)
	if _, err := sessiongrant.Verify(token, signer.PublicKey(), "BD-OTHER", "relay", now); err == nil {
		t.Fatal("expected device binding rejection")
	}
	// Wrong transport → reject
	if _, err := sessiongrant.Verify(token, signer.PublicKey(), "BD-12345", "cdap", now); err == nil {
		t.Fatal("expected transport binding rejection")
	}

	// Impersonation: different server key must not verify
	_, evilPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	evilPub := evilPriv.Public().(ed25519.PublicKey)
	if _, err := sessiongrant.Verify(token, evilPub, "BD-12345", "relay", now); err == nil {
		t.Fatal("expected rejection under attacker public key")
	}
}

func TestConnectionSecurity_ServerIdPkSignatureNotForgeableWithWrongKey(t *testing.T) {
	honest, err := crypto.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	attacker, err := crypto.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	peerPk := make([]byte, 32)
	peerPk[0] = 0x42
	signed, err := honest.SignIdPk("VICTIM-PEER", peerPk)
	if err != nil {
		t.Fatal(err)
	}
	sig := signed[:ed25519.SignatureSize]
	payload := signed[ed25519.SignatureSize:]

	if !ed25519.Verify(honest.PublicKey, payload, sig) {
		t.Fatal("honest key must verify own signature")
	}
	if ed25519.Verify(attacker.PublicKey, payload, sig) {
		t.Fatal("attacker key must not verify honest IdPk signature (server spoof)")
	}
}
