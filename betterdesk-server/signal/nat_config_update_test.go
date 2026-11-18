package signal

import (
	"net"
	"testing"

	"github.com/unitronix/betterdesk-server/config"
	pb "github.com/unitronix/betterdesk-server/proto"
)

// ConfigUpdate.rendezvous_servers tells the client which ID server to use.
// Advertising relay addresses there makes newer clients reconnect their signal
// socket to the relay port and stop answering punch/relay requests, so every
// relay session times out.
func TestHandleTestNatNeverAdvertisesRelayServersAsRendezvous(t *testing.T) {
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	srv.cfg.RelayServers = "85.14.70.12"
	srv.cfg.SignalPort = 21116

	resp := srv.handleTestNat(&pb.TestNatRequest{Serial: 1}, &net.TCPAddr{
		IP:   net.ParseIP("203.0.113.10"),
		Port: 54321,
	})
	if resp == nil {
		t.Fatal("handleTestNat returned nil")
	}
	nat := resp.GetTestNatResponse()
	if nat == nil {
		t.Fatalf("expected TestNatResponse, got %+v", resp)
	}
	if nat.Port != 54321 {
		t.Fatalf("port = %d, want the caller source port", nat.Port)
	}

	// No RENDEZVOUS_SERVERS configured -> no ConfigUpdate at all.
	if nat.Cu != nil {
		t.Fatalf("relay-only config must not produce ConfigUpdate, got %v", nat.Cu.GetRendezvousServers())
	}
}

func TestHandleTestNatAdvertisesConfiguredRendezvousServers(t *testing.T) {
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	srv.cfg.RelayServers = "85.14.70.12"
	srv.cfg.RendezvousServers = "desk.example.com"
	srv.cfg.SignalPort = 21116

	resp := srv.handleTestNat(&pb.TestNatRequest{Serial: 7}, &net.TCPAddr{
		IP:   net.ParseIP("203.0.113.10"),
		Port: 51000,
	})
	cu := resp.GetTestNatResponse().GetCu()
	if cu == nil {
		t.Fatal("expected ConfigUpdate when RENDEZVOUS_SERVERS is set")
	}
	if cu.Serial != 8 {
		t.Fatalf("serial = %d, want msg.Serial+1", cu.Serial)
	}
	got := cu.GetRendezvousServers()
	if len(got) != 1 || got[0] != "desk.example.com:21116" {
		t.Fatalf("rendezvous_servers = %v, want [desk.example.com:21116]", got)
	}
	// Regression guard: the relay endpoint must never leak into this list.
	for _, entry := range got {
		if entry == "85.14.70.12:21117" || entry == "85.14.70.12" {
			t.Fatalf("relay address advertised as rendezvous server: %q", entry)
		}
	}
}

func TestGetRendezvousServersAddsSignalPort(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.SignalPort = 21116
	cfg.RendezvousServers = " desk.example.com , 198.51.100.7:21116 "

	got := cfg.GetRendezvousServers()
	want := []string{"desk.example.com:21116", "198.51.100.7:21116"}
	if len(got) != len(want) {
		t.Fatalf("GetRendezvousServers = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("entry %d = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestGetRendezvousServersEmptyWhenUnset(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.RelayServers = "85.14.70.12"
	cfg.RendezvousServers = ""
	if got := cfg.GetRendezvousServers(); got != nil {
		t.Fatalf("GetRendezvousServers = %v, want nil (relay config must not be reused)", got)
	}
}
