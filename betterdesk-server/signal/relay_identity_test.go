package signal

import (
	"testing"
	"time"

	"github.com/unitronix/betterdesk-server/config"
	cryptopkg "github.com/unitronix/betterdesk-server/crypto"
	"github.com/unitronix/betterdesk-server/peer"
	pb "github.com/unitronix/betterdesk-server/proto"
)

// Recent RustDesk clients validate an incoming relay request against the relay
// they configured (check_port(..., RELAY_PORT)) and silently drop a mismatch.
// The server must therefore forward the target's own reported spelling instead
// of overwriting it with the server-derived endpoint, otherwise the relay pair
// never gets its second connection and the session dies with "Pair timeout".
func TestRelayAdvertisedToTargetPrefersPeerReportedRelay(t *testing.T) {
	target := &peer.Entry{ID: "TGT1", RelayServer: "desk.example.com"}

	got := relayAdvertisedToTarget(target, "85.14.70.12:21117")
	if got != "desk.example.com" {
		t.Fatalf("relay = %q, want the peer-reported value", got)
	}
}

func TestRelayAdvertisedToTargetFallsBackForOldClients(t *testing.T) {
	// Older clients never report a relay in PunchHoleSent.
	target := &peer.Entry{ID: "TGT2"}

	got := relayAdvertisedToTarget(target, "85.14.70.12:21117")
	if got != "85.14.70.12:21117" {
		t.Fatalf("relay = %q, want the server fallback", got)
	}
	if relayAdvertisedToTarget(nil, "fallback:21117") != "fallback:21117" {
		t.Fatal("nil target must use the fallback")
	}
}

// The reported relay is captured from PunchHoleSent, but sanitized: agent
// builds that report the API port as their relay must not poison forwarding.
func TestHandlePunchHoleSentRecordsSanitizedPeerRelay(t *testing.T) {
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	srv.localIP.Store("198.51.100.20")
	srv.cfg.RelayServers = "85.14.70.12"
	srv.cfg.RelayPort = 21117
	srv.cfg.APIPort = 21114

	target := &peer.Entry{
		ID:       "TGTREP1",
		UDPAddr:  udpAddr("203.0.113.80", 52100),
		ConnType: peer.ConnUDP,
		LastReg:  time.Now(),
	}
	srv.peers.Put(target)

	initiatorAddr := udpAddr("203.0.113.90", 51000)
	// This is what the broken agent reports: the API port as relay.
	srv.handlePunchHoleSent(&pb.PunchHoleSent{
		Id:          "TGTREP1",
		SocketAddr:  cryptopkg.EncodeAddr(initiatorAddr),
		RelayServer: "85.14.70.12:21114",
	}, udpAddr("203.0.113.80", 52100), true)

	entry := srv.peers.Get("TGTREP1")
	if entry == nil {
		t.Fatal("target disappeared")
	}
	if entry.RelayServer != "85.14.70.12:21117" {
		t.Fatalf("stored relay = %q, want the sanitized relay endpoint", entry.RelayServer)
	}
	if relayAdvertisedToTarget(entry, "fallback:21117") != "85.14.70.12:21117" {
		t.Fatalf("forwarded relay = %q, want the sanitized relay endpoint",
			relayAdvertisedToTarget(entry, "fallback:21117"))
	}
}
