package signal

import (
	"log"
	"net"
	"sync/atomic"
	"time"

	"github.com/unitronix/betterdesk-server/crypto"
	"github.com/unitronix/betterdesk-server/peer"
	pb "github.com/unitronix/betterdesk-server/proto"
)

// pendingLAN is the server-side state for one native LAN address exchange.
// It is intentionally separate from relay correlation: LocalAddr is not a
// relay response and must not be allowed to borrow relay-session state.
type pendingLAN struct {
	key                string
	targetID           string
	initiatorID        string
	initiatorAddr      *net.UDPAddr
	initiatorTransport peer.ConnType
	relayServer        string
	socketAddrV6       []byte
	fallback           *pb.RendezvousMessage
	createdAt          time.Time
	timer              *time.Timer
	fired              atomic.Bool
}

func pendingLANKey(targetID string, initiatorAddr *net.UDPAddr) string {
	if initiatorAddr == nil {
		return targetID + "\x00"
	}
	return targetID + "\x00" + normalizeAddrKey(initiatorAddr.String())
}

func copyUDPAddr(addr *net.UDPAddr) *net.UDPAddr {
	if addr == nil {
		return nil
	}
	copyAddr := *addr
	copyAddr.IP = append(net.IP(nil), addr.IP...)
	return &copyAddr
}

func copyBytes(value []byte) []byte {
	return append([]byte(nil), value...)
}

func (s *Server) signedLANTargetKey(targetID string, target *peer.Entry) []byte {
	if s == nil || s.kp == nil || target == nil {
		return nil
	}
	targetPK := s.peerPublicKey(targetID, target)
	if len(targetPK) == 0 {
		return nil
	}
	signed, err := s.kp.SignIdPk(targetID, targetPK)
	if err != nil {
		log.Printf("[signal] LAN key signing failed for %s: %v", targetID, err)
		return nil
	}
	return signed
}

func (s *Server) lanFallbackResponse(targetID string, target *peer.Entry, relayServer string, socketAddrV6 []byte) *pb.RendezvousMessage {
	phr := &pb.PunchHoleResponse{
		SocketAddr:   encodePeerSocketAddr(target),
		Pk:           s.signedLANTargetKey(targetID, target),
		RelayServer:  relayServer,
		SocketAddrV6: copyBytes(socketAddrV6),
		Union:        &pb.PunchHoleResponse_NatType{NatType: pb.NatType_SYMMETRIC},
	}
	phr = ensurePunchHoleSocketAddr(phr, targetID, relayServer)
	return &pb.RendezvousMessage{
		Union: &pb.RendezvousMessage_PunchHoleResponse{
			PunchHoleResponse: phr,
		},
	}
}

func (s *Server) deliverLANResponse(p *pendingLAN, msg *pb.RendezvousMessage) bool {
	if p == nil || msg == nil {
		return false
	}
	if p.initiatorTransport == peer.ConnTCP &&
		s.forwardToInitiator(normalizeAddrKey(p.initiatorAddr.String()), msg) {
		return true
	}
	return s.sendUDP(msg, p.initiatorAddr)
}

func (s *Server) cancelPendingLAN(key string) bool {
	value, ok := s.pendingLANs.LoadAndDelete(key)
	if !ok {
		return false
	}
	p, ok := value.(*pendingLAN)
	if !ok || p == nil {
		return false
	}
	if p.fired.Swap(true) {
		return false
	}
	if p.timer != nil {
		p.timer.Stop()
	}
	return true
}

func (s *Server) beginLANExchange(
	targetID string,
	target *peer.Entry,
	initiatorID string,
	initiatorAddr *net.UDPAddr,
	initiatorTransport peer.ConnType,
	relayServer string,
	socketAddrV6 []byte,
) (*pendingLAN, bool) {
	if s == nil || target == nil || initiatorAddr == nil || target.ConnType == peer.ConnWS {
		return nil, false
	}

	fetch := &pb.RendezvousMessage{
		Union: &pb.RendezvousMessage_FetchLocalAddr{
			FetchLocalAddr: &pb.FetchLocalAddr{
				SocketAddr:   crypto.EncodeAddr(initiatorAddr),
				RelayServer:  relayServer,
				SocketAddrV6: copyBytes(socketAddrV6),
			},
		},
	}
	if len(fetch.GetFetchLocalAddr().SocketAddr) == 0 {
		return nil, false
	}

	key := pendingLANKey(targetID, initiatorAddr)
	p := &pendingLAN{
		key:                key,
		targetID:           targetID,
		initiatorID:        initiatorID,
		initiatorAddr:      copyUDPAddr(initiatorAddr),
		initiatorTransport: initiatorTransport,
		relayServer:        relayServer,
		socketAddrV6:       copyBytes(socketAddrV6),
		fallback:           s.lanFallbackResponse(targetID, target, relayServer, nil),
		createdAt:          time.Now(),
	}
	delay := time.Duration(s.cfg.ConnectionSettings().P2PFallbackMs) * time.Millisecond
	if delay <= 0 {
		delay = 2 * time.Second
	}
	p.timer = time.AfterFunc(delay, func() {
		if p.fired.Swap(true) {
			return
		}
		s.pendingLANs.Delete(key)
		log.Printf("[signal] LAN address exchange timed out for %s; relay fallback", targetID)
		s.deliverLANResponse(p, p.fallback)
	})

	if old, loaded := s.pendingLANs.LoadOrStore(key, p); loaded {
		if previous, ok := old.(*pendingLAN); ok && previous != nil {
			s.cancelPendingLAN(key)
		}
		s.pendingLANs.Store(key, p)
	}

	if !s.sendToPeer(targetID, fetch) {
		s.cancelPendingLAN(key)
		return p, false
	}

	log.Printf("[signal] LAN FetchLocalAddr sent to %s for %s", targetID, initiatorAddr)
	return p, true
}

func isUsableLANEndpoint(addr *net.UDPAddr) bool {
	return addr != nil &&
		addr.IP != nil &&
		addr.Port > 0 &&
		isPrivateIP(addr.IP)
}

// completeLANAddr accepts only a response belonging to a live LAN request.
// The source-IP comparison is correlation, not authentication; the target key
// remains server-signed in the resulting PunchHoleResponse.
func (s *Server) completeLANAddr(msg *pb.LocalAddr, sender *net.UDPAddr) {
	if s == nil || msg == nil || sender == nil || msg.Id == "" {
		return
	}

	initiatorAddr, err := crypto.DecodeAddr(msg.SocketAddr)
	if err != nil || initiatorAddr == nil {
		return
	}
	localAddr, err := crypto.DecodeAddr(msg.LocalAddr)
	if err != nil || !isUsableLANEndpoint(localAddr) {
		return
	}

	key := pendingLANKey(msg.Id, initiatorAddr)
	value, ok := s.pendingLANs.Load(key)
	if !ok {
		return
	}
	p, ok := value.(*pendingLAN)
	if !ok || p == nil || p.targetID != msg.Id ||
		time.Since(p.createdAt) > 30*time.Second {
		s.cancelPendingLAN(key)
		return
	}

	if !s.relayResponseSourceMatchesTarget(msg.Id, sender) ||
		!s.targetAcceptsInboundSession(msg.Id) {
		return
	}
	target := s.peers.Get(msg.Id)
	if target == nil || target.Banned ||
		s.shouldForceRelayForPeers(p.initiatorID, msg.Id) {
		return
	}
	connection := s.cfg.ConnectionSettings()
	if connection.AlwaysUseRelay ||
		(connection.SameNATRelay && isSamePublicIP(sender, initiatorAddr)) {
		return
	}
	if !s.cancelPendingLAN(key) {
		return
	}

	resp := &pb.RendezvousMessage{
		Union: &pb.RendezvousMessage_PunchHoleResponse{
			PunchHoleResponse: &pb.PunchHoleResponse{
				SocketAddr:   copyBytes(msg.LocalAddr),
				Pk:           s.signedLANTargetKey(msg.Id, target),
				RelayServer:  p.relayServer,
				SocketAddrV6: copyBytes(msg.SocketAddrV6),
				Union:        &pb.PunchHoleResponse_IsLocal{IsLocal: true},
			},
		},
	}
	log.Printf("[signal] LAN PunchHoleResponse: target=%s local=%s initiator=%s",
		msg.Id, localAddr, initiatorAddr)
	s.deliverLANResponse(p, resp)
}
