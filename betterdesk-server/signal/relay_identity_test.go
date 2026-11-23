package signal

import (
	"testing"
	"time"

	"github.com/unitronix/betterdesk-server/config"
	cryptopkg "github.com/unitronix/betterdesk-server/crypto"
	"github.com/unitronix/betterdesk-server/peer"
	pb "github.com/unitronix/betterdesk-server/proto"
)

// A peer's own relay value wins over the server-derived one, because the peer
// validates the incoming request against its own configuration.
func TestRelayAdvertisedToTargetPrefersPeerReportedRelay(t *testing.T) {
	target := &peer.Entry{ID: "TGT1", RelayServer: "desk.example.com"}

	got := relayAdvertisedToTarget(target, "85.14.70.12:21117", relayShapeInfo{})
	if got != "desk.example.com" {
		t.Fatalf("relay = %q, want the peer-reported value", got)
	}
}

func TestRelayAdvertisedToTargetFallsBackForOldClients(t *testing.T) {
	// Older clients never report a relay in PunchHoleSent. Send the bare host so
	// the peer's own check_port() normalises it to RELAY_PORT — that matches a
	// client configured as either `host` or `host:21117`. Production confirmed
	// this shape pairs, while a forced :21117 did not.
	target := &peer.Entry{ID: "TGT2"}

	got := relayAdvertisedToTarget(target, "85.14.70.12:21117", relayShapeInfo{})
	if got != "85.14.70.12" {
		t.Fatalf("relay = %q, want the bare host", got)
	}
	if relayAdvertisedToTarget(nil, "fallback", relayShapeInfo{}) != "fallback" {
		t.Fatal("nil target must use the fallback unchanged")
	}
	// Hostname fallbacks keep working too.
	if got := relayAdvertisedToTarget(target, "desk.example.com:21117", relayShapeInfo{}); got != "desk.example.com" {
		t.Fatalf("relay = %q, want the bare host", got)
	}
}

// The reported relay is stored verbatim: the peer validates incoming relay
// requests against its own value, so rewriting it makes the peer drop them.
// A peer reporting the API port works because that port also speaks relay
// framing (api/sniff_listener.go).
func TestHandlePunchHoleSentRecordsPeerRelayVerbatim(t *testing.T) {
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
	// The failing agent reports the API port as its relay.
	srv.handlePunchHoleSent(&pb.PunchHoleSent{
		Id:          "TGTREP1",
		SocketAddr:  cryptopkg.EncodeAddr(initiatorAddr),
		RelayServer: "85.14.70.12:21114",
	}, udpAddr("203.0.113.80", 52100), true)

	entry := srv.peers.Get("TGTREP1")
	if entry == nil {
		t.Fatal("target disappeared")
	}
	if entry.RelayServer != "85.14.70.12:21114" {
		t.Fatalf("stored relay = %q, want the peer's own value (rewriting it makes the peer drop the request)", entry.RelayServer)
	}
	// Regression on 40200e82: the peer's own spelling is forwarded verbatim.
	if got := relayAdvertisedToTarget(entry, "fallback:21117", relayShapeInfo{}); got != "85.14.70.12:21114" {
		t.Fatalf("forwarded relay = %q, want the peer's own value", got)
	}
}

// relayFleetServer builds a server whose relay is 85.14.70.12:21117 on the
// standard ports, which is what the production fleet reports.
func relayFleetServer(t *testing.T) *Server {
	t.Helper()
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	srv.cfg.RelayServers = "85.14.70.12"
	srv.cfg.RelayPort = 21117
	srv.cfg.APIPort = 21114
	srv.cfg.SignalPort = 21116
	return srv
}

// classifyClientRelay names the client's style; every decision downstream depends
// on this staying honest about what the client actually sent.
func TestClassifyClientRelay(t *testing.T) {
	srv := relayFleetServer(t)

	cases := []struct {
		name  string
		input string
		shape relayShape
		host  string
		port  int
	}{
		{"empty", "", relayShapePortless, "", 0},
		{"bare host", "85.14.70.12", relayShapePortless, "85.14.70.12", 0},
		{"bare hostname", "desk.example.com", relayShapePortless, "desk.example.com", 0},
		{"relay port", "85.14.70.12:21117", relayShapeExplicitRelay, "85.14.70.12", 21117},
		{"api port", "85.14.70.12:21114", relayShapeServicePort, "85.14.70.12", 21114},
		{"signal port", "85.14.70.12:21116", relayShapeServicePort, "85.14.70.12", 21116},
		{"ws relay port", "85.14.70.12:21119", relayShapeServicePort, "85.14.70.12", 21119},
		{"custom port", "85.14.70.12:34567", relayShapeCustom, "85.14.70.12", 34567},
		{"garbage", "not an address", relayShapePortless, "not an address", 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := srv.classifyClientRelay(tc.input)
			if got.shape != tc.shape {
				t.Fatalf("shape = %v, want %v", got.shape, tc.shape)
			}
			if got.host != tc.host {
				t.Fatalf("host = %q, want %q", got.host, tc.host)
			}
			if got.port != tc.port {
				t.Fatalf("port = %d, want %d", got.port, tc.port)
			}
		})
	}
}

// The two directions of one session must stay compatible with every client
// generation. Any change to an existing row is a regression.
func TestRelaySessionShapesAreBackwardsCompatible(t *testing.T) {
	srv := relayFleetServer(t)

	cases := []struct {
		name             string
		peerReported     string // what the target said in PunchHoleSent ("" = never reported)
		initiatorSent    string // raw RequestRelay.RelayServer from the initiator
		wantForTarget    string
		wantForInitiator string
	}{
		{
			name:             "old client reports api port",
			peerReported:     "85.14.70.12:21114",
			initiatorSent:    "",
			wantForTarget:    "85.14.70.12:21114",
			wantForInitiator: "85.14.70.12:21117",
		},
		{
			name:             "old client never reports relay",
			peerReported:     "",
			initiatorSent:    "",
			wantForTarget:    "85.14.70.12",
			wantForInitiator: "85.14.70.12:21117",
		},
		{
			name:             "new client explicit relay port",
			peerReported:     "85.14.70.12:21117",
			initiatorSent:    "85.14.70.12:21117",
			wantForTarget:    "85.14.70.12:21117",
			wantForInitiator: "85.14.70.12:21117",
		},
		{
			name:             "new client portless config",
			peerReported:     "85.14.70.12",
			initiatorSent:    "85.14.70.12",
			wantForTarget:    "85.14.70.12",
			wantForInitiator: "85.14.70.12:21117",
		},
		{
			// The only new behaviour: the target never reported, but the
			// initiator proved this fleet maps a portless relay to the API port.
			name:             "hint from initiator api port reaches unreported target",
			peerReported:     "",
			initiatorSent:    "85.14.70.12:21114",
			wantForTarget:    "85.14.70.12:21114",
			wantForInitiator: "85.14.70.12:21117",
		},
		{
			// A hint about a different relay host must not steer our advertisement:
			// the target still gets the proven bare-host fallback, exactly as before.
			name:             "hint for foreign host ignored",
			peerReported:     "",
			initiatorSent:    "other.example.com:21114",
			wantForTarget:    "other.example.com",
			wantForInitiator: "other.example.com:21117",
		},
		{
			name:             "peer report wins over hint",
			peerReported:     "85.14.70.12:21117",
			initiatorSent:    "85.14.70.12:21114",
			wantForTarget:    "85.14.70.12:21117",
			wantForInitiator: "85.14.70.12:21117",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			target := &peer.Entry{ID: "TGT-" + tc.name, RelayServer: tc.peerReported}
			relayServer := srv.sanitizeClientRelayAddress(tc.initiatorSent)
			hint := srv.initiatorRelayHint(tc.initiatorSent)

			if got := relayAdvertisedToTarget(target, relayServer, hint); got != tc.wantForTarget {
				t.Fatalf("relay to target = %q, want %q", got, tc.wantForTarget)
			}
			if relayServer != tc.wantForInitiator {
				t.Fatalf("relay to initiator = %q, want %q", relayServer, tc.wantForInitiator)
			}
		})
	}
}

// A service-port hint is only trusted for our own relay host: otherwise any peer
// could steer what the target is told to dial.
func TestInitiatorRelayHintRequiresOwnRelayHost(t *testing.T) {
	srv := relayFleetServer(t)

	if got := srv.initiatorRelayHint(""); got.shape != relayShapePortless {
		t.Fatalf("empty hint shape = %v, want portless", got.shape)
	}
	if got := srv.initiatorRelayHint("85.14.70.12"); got.shape != relayShapePortless {
		t.Fatalf("portless hint shape = %v, want portless", got.shape)
	}
	if got := srv.initiatorRelayHint("85.14.70.12:21117"); got.shape != relayShapePortless {
		t.Fatalf("explicit relay hint shape = %v, want portless (proven path)", got.shape)
	}
	if got := srv.initiatorRelayHint("85.14.70.12:21114"); got.shape != relayShapeServicePort {
		t.Fatalf("api port hint shape = %v, want service port", got.shape)
	}
	if got := srv.initiatorRelayHint("198.51.100.7:21114"); got.shape != relayShapePortless {
		t.Fatalf("foreign host hint shape = %v, want portless", got.shape)
	}
}
