package signal

import (
	"testing"

	"github.com/unitronix/betterdesk-server/config"
	cryptopkg "github.com/unitronix/betterdesk-server/crypto"
	"github.com/unitronix/betterdesk-server/peer"
	pb "github.com/unitronix/betterdesk-server/proto"
)

// Upstream hbbs punches the target on every PunchHoleRequest, including the
// relay-only path. Two behaviours depend on it:
//
//   - the target learns the initiator address, needed to answer with
//     RelayResponse;
//   - the target replies PunchHoleSent, which carries the relay endpoint it
//     configured. Newer clients drop a RequestRelay whose relay_server differs
//     from their own value, so without that reply the server cannot know which
//     endpoint the target will accept.
//
// This test locks the punch in place for the forced-relay branch.
func TestForceRelayStillPunchesTarget(t *testing.T) {
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	srv.localIP.Store("198.51.100.20")

	recv, targetAddr := attachTestUDPPair(t, srv)
	putOnlinePeer(srv, "RELAYTGT1", targetAddr.IP.String(), targetAddr.Port, peer.ConnUDP)

	initiatorAddr := udpAddr("203.0.113.91", 51000)
	putOnlinePeer(srv, "RELAYINI1", initiatorAddr.IP.String(), initiatorAddr.Port, peer.ConnTCP)

	resp := srv.handlePunchHoleRequestTCP(&pb.PunchHoleRequest{
		Id:         "RELAYTGT1",
		ForceRelay: true,
	}, initiatorAddr)

	// The initiator still gets the SYMMETRIC punch response that makes it ask
	// for relay with its own UUID.
	phr := resp.GetPunchHoleResponse()
	if phr == nil {
		t.Fatalf("expected PunchHoleResponse for initiator, got %+v", resp)
	}

	// And the target must have received a PunchHole carrying the initiator addr.
	msg := readUDPRendezvous(t, recv)
	ph := msg.GetPunchHole()
	if ph == nil {
		t.Fatalf("target received %+v, want PunchHole", msg)
	}
	gotAddr, err := cryptopkg.DecodeAddr(ph.SocketAddr)
	if err != nil {
		t.Fatalf("decode punch socket_addr: %v", err)
	}
	if gotAddr == nil || !gotAddr.IP.Equal(initiatorAddr.IP) {
		t.Fatalf("punch socket_addr = %v, want the initiator %v", gotAddr, initiatorAddr)
	}
	// The punch must not mark the peer as a relay initiator. A SYMMETRIC or
	// force_relay marker makes it mint its own UUID (initiate=true) and answer
	// RelayResponse with that UUID instead of an empty one, which breaks the
	// pending correlation the initiator needs to pair.
	if ph.NatType == pb.NatType_SYMMETRIC {
		t.Fatal("nat_type must not be forced to SYMMETRIC: the peer would initiate relay with its own UUID")
	}
	if ph.ForceRelay {
		t.Fatal("force_relay must stay false: it makes the peer skip RequestRelay and use its own UUID")
	}
}

// The WebRTC offer must survive the relay-only punch as well.
func TestForceRelayPunchCarriesWebRTCOffer(t *testing.T) {
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	srv.localIP.Store("198.51.100.20")

	recv, targetAddr := attachTestUDPPair(t, srv)
	putOnlinePeer(srv, "RELAYTGT2", targetAddr.IP.String(), targetAddr.Port, peer.ConnUDP)

	const offer = "v=0\r\no=- 3 3 IN IP4 127.0.0.1\r\n"

	initiatorAddr := udpAddr("203.0.113.92", 51000)
	putOnlinePeer(srv, "RELAYINI2", initiatorAddr.IP.String(), initiatorAddr.Port, peer.ConnTCP)

	srv.handlePunchHoleRequestTCP(&pb.PunchHoleRequest{
		Id:             "RELAYTGT2",
		ForceRelay:     true,
		WebrtcSdpOffer: offer,
	}, initiatorAddr)

	msg := readUDPRendezvous(t, recv)
	ph := msg.GetPunchHole()
	if ph == nil {
		t.Fatalf("expected PunchHole, got %+v", msg)
	}
	if ph.GetWebrtcSdpOffer() != offer {
		t.Fatalf("webrtc_sdp_offer = %q, want it forwarded", ph.GetWebrtcSdpOffer())
	}
}
