package signal

import (
	"github.com/unitronix/betterdesk-server/config"
	"github.com/unitronix/betterdesk-server/crypto"
	"github.com/unitronix/betterdesk-server/peer"
	pb "github.com/unitronix/betterdesk-server/proto"
	"net"
	"testing"
	"time"
)

func TestLANExchangeReturnsPrivateAddress(t *testing.T) {
	for _, tcp := range []bool{false, true} {
		t.Run(map[bool]string{false: "UDP", true: "TCP"}[tcp], func(t *testing.T) {
			srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
			srv.cfg.SameNATRelay = false
			recv, target := attachTestUDPPair(t, srv)
			init, err := net.ListenUDP("udp", udpAddr("127.0.0.1", 0))
			if err != nil {
				t.Fatal(err)
			}
			defer init.Close()
			from := init.LocalAddr().(*net.UDPAddr)
			putOnlinePeer(srv, "LANINIT", from.IP.String(), from.Port, peer.ConnUDP)
			putOnlinePeer(srv, "LANTARGET", target.IP.String(), target.Port, peer.ConnUDP)
			defer srv.cancelPunchFallback(normalizeAddrKey(from.String()))
			if tcp {
				if got := srv.handlePunchHoleRequestTCP(&pb.PunchHoleRequest{Id: "LANTARGET"}, from); got != nil {
					t.Fatalf("premature public response: %v", got)
				}
			} else {
				srv.handlePunchHoleRequest(&pb.PunchHoleRequest{Id: "LANTARGET"}, from)
			}
			fetch := readUDPRendezvous(t, recv).GetFetchLocalAddr()
			if fetch == nil {
				t.Fatal("expected FetchLocalAddr, not PunchHole")
			}
			caller, err := crypto.DecodeAddr(fetch.SocketAddr)
			if err != nil || caller.String() != from.String() {
				t.Fatalf("caller endpoint: %v %v", caller, err)
			}
			local := crypto.EncodeAddr(udpAddr("192.168.1.20", 54321))
			srv.handleLocalAddr(&pb.LocalAddr{Id: "LANTARGET", SocketAddr: fetch.SocketAddr, LocalAddr: local}, target)
			response := readUDPRendezvous(t, init).GetPunchHoleResponse()
			if response == nil || !response.GetIsLocal() {
				t.Fatal("expected local PunchHoleResponse")
			}
			got, err := crypto.DecodeAddr(response.SocketAddr)
			if err != nil || got.String() != "192.168.1.20:54321" {
				t.Fatalf("returned public or incorrect endpoint: %v %v", got, err)
			}
			if srv.cancelPunchFallback(normalizeAddrKey(from.String())) {
				t.Fatal("LAN response did not cancel fallback")
			}
		})
	}
}

func TestLANExchangeRejectsUnsolicitedResponse(t *testing.T) {
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	recv, target := attachTestUDPPair(t, srv)
	putOnlinePeer(srv, "LANTARGET", target.IP.String(), target.Port, peer.ConnUDP)
	srv.handleLocalAddr(&pb.LocalAddr{Id: "LANTARGET", SocketAddr: crypto.EncodeAddr(target), LocalAddr: crypto.EncodeAddr(udpAddr("192.168.1.20", 54321))}, target)
	recv.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	var b [2048]byte
	if _, _, err := recv.ReadFromUDP(b[:]); err == nil {
		t.Fatal("unsolicited LocalAddr was forwarded")
	}
}

func TestLANExchangeTimeoutFallsBackToRelay(t *testing.T) {
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	srv.cfg.SameNATRelay = false
	srv.cfg.P2PFallbackMs = 30
	recv, target := attachTestUDPPair(t, srv)
	init, err := net.ListenUDP("udp", udpAddr("127.0.0.1", 0))
	if err != nil {
		t.Fatal(err)
	}
	defer init.Close()
	from := init.LocalAddr().(*net.UDPAddr)
	putOnlinePeer(srv, "LANINIT", from.IP.String(), from.Port, peer.ConnUDP)
	putOnlinePeer(srv, "LANTARGET", target.IP.String(), target.Port, peer.ConnUDP)
	if !srv.requestLANAddr("LANTARGET", from, "relay.example:21117") {
		t.Fatal("request failed")
	}
	if readUDPRendezvous(t, recv).GetFetchLocalAddr() == nil {
		t.Fatal("missing fetch")
	}
	resp := readUDPRendezvous(t, init).GetPunchHoleResponse()
	if resp == nil || resp.GetIsLocal() || resp.GetNatType() != pb.NatType_SYMMETRIC {
		t.Fatalf("unsafe fallback: %v", resp)
	}
}
