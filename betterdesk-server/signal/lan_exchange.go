package signal

import (
	"log"
	"net"
	"time"

	"github.com/unitronix/betterdesk-server/crypto"
	pb "github.com/unitronix/betterdesk-server/proto"
)

// requestLANAddr asks the target to prepare a LAN listener and report its address.
// On a matching LocalAddr response, completeLANAddr returns that endpoint to the
// initiator in PunchHoleResponse with is_local=true; a timeout requests relay fallback.
func (s *Server) requestLANAddr(targetID string, initiator *net.UDPAddr, relayServer string) bool {
	target := s.peers.Get(targetID)
	if target == nil || initiator == nil {
		return false
	}
	var pk []byte
	if targetPK := s.peerPublicKey(targetID, target); len(targetPK) > 0 && s.kp != nil {
		var err error
		pk, err = s.kp.SignIdPk(targetID, targetPK)
		if err != nil {
			log.Printf("[signal] LAN key signing failed: %v", err)
			return false
		}
	}
	key := normalizeAddrKey(initiator.String())
	fallback := &pb.RendezvousMessage{Union: &pb.RendezvousMessage_PunchHoleResponse{PunchHoleResponse: &pb.PunchHoleResponse{
		SocketAddr: encodePeerSocketAddr(target), Pk: pk, RelayServer: relayServer,
		Union: &pb.PunchHoleResponse_NatType{NatType: pb.NatType_SYMMETRIC},
	}}}
	s.schedulePunchFallback(key, func() {
		log.Printf("[signal] LAN address exchange timed out for %s; relay fallback", targetID)
		if !s.forwardToInitiator(key, fallback) {
			s.sendUDP(fallback, initiator)
		}
	})
	fetch := &pb.RendezvousMessage{Union: &pb.RendezvousMessage_FetchLocalAddr{FetchLocalAddr: &pb.FetchLocalAddr{
		SocketAddr: crypto.EncodeAddr(initiator), RelayServer: relayServer,
	}}}
	if !s.sendToPeer(targetID, fetch) {
		s.cancelPunchFallback(key)
		return false
	}
	log.Printf("[signal] LAN FetchLocalAddr sent to %s for %s", targetID, initiator)
	return true
}

// completeLANAddr correlates LocalAddr with a pending request using the reported
// target ID and echoed initiator endpoint. It checks the observed source IP against
// the target record, but not the source port: the target may open a new TCP connection.
// This IP check does not distinguish devices sharing the same public NAT address.
func (s *Server) completeLANAddr(msg *pb.LocalAddr, sender *net.UDPAddr) {
	if msg == nil || sender == nil {
		return
	}
	initiator, err := crypto.DecodeAddr(msg.SocketAddr)
	if err != nil {
		return
	}
	local, err := crypto.DecodeAddr(msg.LocalAddr)
	if err != nil || local.Port == 0 || !local.IP.IsPrivate() {
		return
	}
	pending := s.getPendingRelayByAdvertised(msg.Id, initiator)
	if pending == nil || time.Since(pending.createdAt) > 30*time.Second || pending.targetID != msg.Id {
		return
	}
	if !s.relayResponseSourceMatchesTarget(msg.Id, sender) || !s.targetAcceptsInboundSession(msg.Id) {
		return
	}
	target := s.peers.Get(msg.Id)
	if target == nil || target.Banned || s.shouldForceRelayForPeers(pending.initiatorID, msg.Id) {
		return
	}
	connection := s.cfg.ConnectionSettings()
	if connection.AlwaysUseRelay || (connection.SameNATRelay && isSamePublicIP(sender, initiator)) {
		return
	}
	var pk []byte
	if targetPK := s.peerPublicKey(msg.Id, target); len(targetPK) > 0 && s.kp != nil {
		pk, err = s.kp.SignIdPk(msg.Id, targetPK)
		if err != nil {
			return
		}
	}
	relayServer := s.applyNetworkRelayPolicy(s.getRelayServer(), pending.initiatorID, msg.Id)
	resp := &pb.RendezvousMessage{Union: &pb.RendezvousMessage_PunchHoleResponse{PunchHoleResponse: &pb.PunchHoleResponse{
		SocketAddr: msg.LocalAddr, Pk: pk, RelayServer: relayServer,
		Union: &pb.PunchHoleResponse_IsLocal{IsLocal: true},
	}}}
	key := pending.correlationAddr
	s.cancelPunchFallback(key)
	if !s.forwardToInitiator(key, resp) {
		s.sendUDP(resp, initiator)
	}
	log.Printf("[signal] LAN PunchHoleResponse: target=%s local=%s initiator=%s", msg.Id, local, initiator)
}
