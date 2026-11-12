package signal

import (
	"net"
	"testing"
	"time"

	"github.com/unitronix/betterdesk-server/codec"
	"github.com/unitronix/betterdesk-server/config"
	cryptopkg "github.com/unitronix/betterdesk-server/crypto"
	"github.com/unitronix/betterdesk-server/peer"
	pb "github.com/unitronix/betterdesk-server/proto"
)

func openLANInitiator(t *testing.T) (*net.UDPConn, *net.UDPAddr) {
	t.Helper()
	conn, err := net.ListenUDP("udp", udpAddr("127.0.0.1", 0))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn, conn.LocalAddr().(*net.UDPAddr)
}

func TestNativeLANExchangeReturnsPunchHoleResponse(t *testing.T) {
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	srv.cfg.SameNATRelay = false
	srv.cfg.P2PFallbackMs = 500
	targetRecv, targetAddr := attachTestUDPPair(t, srv)
	initiatorConn, initiatorAddr := openLANInitiator(t)
	t.Cleanup(func() {
		srv.cancelPendingLAN(pendingLANKey("LANTARGETSEC481", initiatorAddr))
	})

	putOnlinePeer(srv, "LANINIT481", initiatorAddr.IP.String(), initiatorAddr.Port, peer.ConnUDP)
	putOnlinePeer(srv, "LANTARGET481", targetAddr.IP.String(), targetAddr.Port, peer.ConnUDP)

	srv.handlePunchHoleRequest(&pb.PunchHoleRequest{
		Id: "LANTARGET481",
	}, initiatorAddr)

	fetch := readUDPRendezvous(t, targetRecv).GetFetchLocalAddr()
	if fetch == nil {
		t.Fatal("expected FetchLocalAddr at target")
	}
	requester, err := cryptopkg.DecodeAddr(fetch.SocketAddr)
	if err != nil || requester.String() != initiatorAddr.String() {
		t.Fatalf("requester endpoint = %v, %v; want %s", requester, err, initiatorAddr)
	}

	localAddr := cryptopkg.EncodeAddr(udpAddr("192.168.1.20", 54321))
	localAddrV6 := cryptopkg.EncodeAddr(udpAddr("fd00::20", 54322))
	srv.handleLocalAddr(&pb.LocalAddr{
		Id:           "LANTARGET481",
		SocketAddr:   fetch.SocketAddr,
		LocalAddr:    localAddr,
		SocketAddrV6: localAddrV6,
	}, targetAddr)

	response := readUDPRendezvous(t, initiatorConn).GetPunchHoleResponse()
	if response == nil || !response.GetIsLocal() {
		t.Fatalf("expected local PunchHoleResponse, got %+v", response)
	}
	gotLocal, err := cryptopkg.DecodeAddr(response.SocketAddr)
	if err != nil || gotLocal.String() != "192.168.1.20:54321" {
		t.Fatalf("local endpoint = %v, %v; want 192.168.1.20:54321", gotLocal, err)
	}
	if string(response.SocketAddrV6) != string(localAddrV6) {
		t.Fatalf("IPv6 endpoint was not preserved")
	}
	if _, ok := srv.pendingLANs.Load(pendingLANKey("LANTARGET481", initiatorAddr)); ok {
		t.Fatal("completed LAN request remained pending")
	}
}

func TestNativeLANExchangeForwardsResponseToTCPInitiator(t *testing.T) {
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	srv.cfg.SameNATRelay = false
	srv.cfg.P2PFallbackMs = 500
	targetRecv, targetAddr := attachTestUDPPair(t, srv)
	initiatorAddr := udpAddr("127.0.0.1", 51081)
	putOnlinePeer(srv, "LANINITTCP481", initiatorAddr.IP.String(), initiatorAddr.Port, peer.ConnTCP)
	putOnlinePeer(srv, "LANTARGETTCP481", targetAddr.IP.String(), targetAddr.Port, peer.ConnUDP)

	client, server := net.Pipe()
	t.Cleanup(func() {
		client.Close()
		server.Close()
	})
	srv.tcpPunchConns.Store(normalizeAddrKey(initiatorAddr.String()), &tcpPunchConn{
		conn:      server,
		createdAt: time.Now(),
		peerID:    "LANINITTCP481",
	})

	if response := srv.handlePunchHoleRequestTCP(
		&pb.PunchHoleRequest{Id: "LANTARGETTCP481"},
		initiatorAddr,
	); response != nil {
		t.Fatalf("LAN response must be asynchronous, got %+v", response)
	}

	fetch := readUDPRendezvous(t, targetRecv).GetFetchLocalAddr()
	if fetch == nil {
		t.Fatal("expected FetchLocalAddr at target")
	}
	responseCh := make(chan struct {
		msg *pb.RendezvousMessage
		err error
	}, 1)
	go func() {
		msg, err := codec.ReadRawProto(client, 2*time.Second)
		responseCh <- struct {
			msg *pb.RendezvousMessage
			err error
		}{msg: msg, err: err}
	}()
	srv.handleLocalAddr(&pb.LocalAddr{
		Id:         "LANTARGETTCP481",
		SocketAddr: fetch.SocketAddr,
		LocalAddr:  cryptopkg.EncodeAddr(udpAddr("192.168.1.30", 54323)),
	}, targetAddr)

	result := <-responseCh
	if result.err != nil {
		t.Fatalf("read TCP PunchHoleResponse: %v", result.err)
	}
	if result.msg == nil || result.msg.GetPunchHoleResponse() == nil ||
		!result.msg.GetPunchHoleResponse().GetIsLocal() {
		t.Fatalf("expected local TCP PunchHoleResponse, got %+v", result.msg)
	}
}

func TestLANExchangeRejectsUnexpectedSourceAndUnsolicitedResponse(t *testing.T) {
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	srv.cfg.SameNATRelay = false
	srv.cfg.P2PFallbackMs = 500
	targetRecv, targetAddr := attachTestUDPPair(t, srv)
	initiatorConn, initiatorAddr := openLANInitiator(t)
	putOnlinePeer(srv, "LANINITSEC481", initiatorAddr.IP.String(), initiatorAddr.Port, peer.ConnUDP)
	putOnlinePeer(srv, "LANTARGETSEC481", targetAddr.IP.String(), targetAddr.Port, peer.ConnUDP)

	srv.handlePunchHoleRequest(&pb.PunchHoleRequest{Id: "LANTARGETSEC481"}, initiatorAddr)
	fetch := readUDPRendezvous(t, targetRecv).GetFetchLocalAddr()
	local := cryptopkg.EncodeAddr(udpAddr("192.168.1.40", 54324))

	srv.handleLocalAddr(&pb.LocalAddr{
		Id:         "LANTARGETSEC481",
		SocketAddr: fetch.SocketAddr,
		LocalAddr:  local,
	}, udpAddr("192.168.1.99", targetAddr.Port))

	initiatorConn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	var buf [2048]byte
	if _, _, err := initiatorConn.ReadFromUDP(buf[:]); err == nil {
		t.Fatal("unexpected source completed LAN exchange")
	}

	srv.handleLocalAddr(&pb.LocalAddr{
		Id:         "UNKNOWN-LAN-TARGET",
		SocketAddr: fetch.SocketAddr,
		LocalAddr:  local,
	}, targetAddr)
	initiatorConn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	if _, _, err := initiatorConn.ReadFromUDP(buf[:]); err == nil {
		t.Fatal("unsolicited LocalAddr was forwarded")
	}
}

func TestLANExchangeTimeoutFallsBackToRelay(t *testing.T) {
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	srv.cfg.SameNATRelay = false
	srv.cfg.P2PFallbackMs = 30
	targetRecv, targetAddr := attachTestUDPPair(t, srv)
	initiatorConn, initiatorAddr := openLANInitiator(t)
	putOnlinePeer(srv, "LANINITTO481", initiatorAddr.IP.String(), initiatorAddr.Port, peer.ConnUDP)
	putOnlinePeer(srv, "LANTARGETTO481", targetAddr.IP.String(), targetAddr.Port, peer.ConnUDP)

	srv.handlePunchHoleRequest(&pb.PunchHoleRequest{Id: "LANTARGETTO481"}, initiatorAddr)
	if readUDPRendezvous(t, targetRecv).GetFetchLocalAddr() == nil {
		t.Fatal("expected FetchLocalAddr at target")
	}

	response := readUDPRendezvous(t, initiatorConn).GetPunchHoleResponse()
	if response == nil || response.GetIsLocal() ||
		response.GetNatType() != pb.NatType_SYMMETRIC {
		t.Fatalf("expected relay-capable fallback, got %+v", response)
	}
}

func TestLANExchangeKeepsWebSocketInitiatorOnRelayCompatiblePath(t *testing.T) {
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	srv.cfg.P2PFirst = false
	targetRecv, targetAddr := attachTestUDPPair(t, srv)
	initiatorAddr := udpAddr("127.0.0.1", 52181)
	putOnlinePeer(srv, "WSINIT481", initiatorAddr.IP.String(), initiatorAddr.Port, peer.ConnWS)
	putOnlinePeer(srv, "NATIVETARGET481", targetAddr.IP.String(), targetAddr.Port, peer.ConnTCP)

	response := srv.handlePunchHoleRequestTCPWithHint(
		&pb.PunchHoleRequest{Id: "NATIVETARGET481"},
		initiatorAddr,
		peer.ConnWS,
	)
	if response == nil || response.GetPunchHoleResponse() == nil {
		t.Fatalf("expected immediate WS-compatible response, got %+v", response)
	}
	forwarded := readUDPRendezvous(t, targetRecv)
	if forwarded.GetPunchHole() == nil || forwarded.GetFetchLocalAddr() != nil {
		t.Fatalf("WebSocket initiator must not start native LAN exchange: %+v", forwarded)
	}
}

func TestLANExchangeKeepsParallelInitiatorsSeparate(t *testing.T) {
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	srv.cfg.SameNATRelay = false
	srv.cfg.P2PFallbackMs = 500
	targetRecv, targetAddr := attachTestUDPPair(t, srv)
	initA, addrA := openLANInitiator(t)
	initB, addrB := openLANInitiator(t)
	targetID := "LANTARGETPAR481"
	target := &peer.Entry{
		ID:         targetID,
		UDPAddr:    targetAddr,
		ConnType:   peer.ConnUDP,
		LastReg:    time.Now(),
		StatusTier: peer.StatusOnline,
	}
	srv.peers.Put(target)

	if _, ok := srv.beginLANExchange(targetID, target, "LANINITA481", addrA, peer.ConnUDP, "relay.example:21117", nil); !ok {
		t.Fatal("first LAN exchange did not start")
	}
	if _, ok := srv.beginLANExchange(targetID, target, "LANINITB481", addrB, peer.ConnUDP, "relay.example:21117", nil); !ok {
		t.Fatal("second LAN exchange did not start")
	}

	fetchA := readUDPRendezvous(t, targetRecv).GetFetchLocalAddr()
	fetchB := readUDPRendezvous(t, targetRecv).GetFetchLocalAddr()
	if fetchA == nil || fetchB == nil {
		t.Fatal("expected two FetchLocalAddr messages")
	}
	requesterA, err := cryptopkg.DecodeAddr(fetchA.SocketAddr)
	if err != nil {
		t.Fatal(err)
	}
	requesterB, err := cryptopkg.DecodeAddr(fetchB.SocketAddr)
	if err != nil {
		t.Fatal(err)
	}
	if requesterA.String() == requesterB.String() {
		t.Fatal("parallel initiator endpoints were not distinct")
	}

	srv.handleLocalAddr(&pb.LocalAddr{
		Id:         targetID,
		SocketAddr: fetchA.SocketAddr,
		LocalAddr:  cryptopkg.EncodeAddr(udpAddr("192.168.1.51", 54351)),
	}, targetAddr)
	srv.handleLocalAddr(&pb.LocalAddr{
		Id:         targetID,
		SocketAddr: fetchB.SocketAddr,
		LocalAddr:  cryptopkg.EncodeAddr(udpAddr("192.168.1.52", 54352)),
	}, targetAddr)

	if response := readUDPRendezvous(t, initA).GetPunchHoleResponse(); response == nil || !response.GetIsLocal() {
		t.Fatalf("first parallel response = %+v", response)
	}
	if response := readUDPRendezvous(t, initB).GetPunchHoleResponse(); response == nil || !response.GetIsLocal() {
		t.Fatalf("second parallel response = %+v", response)
	}
}

func TestHandleFetchLocalAddrUsesRegisteredTCPTarget(t *testing.T) {
	srv, _ := newTestSignalServer(t, config.EnrollmentModeOpen)
	client, server := net.Pipe()
	t.Cleanup(func() {
		client.Close()
		server.Close()
	})

	targetAddr := udpAddr("127.0.0.1", 52081)
	srv.peers.Put(&peer.Entry{
		ID:       "LANTARGETTCPROUTE481",
		IP:       targetAddr.String(),
		ConnType: peer.ConnTCP,
		LastReg:  time.Now(),
	})
	srv.tcpPunchConns.Store(normalizeAddrKey(targetAddr.String()), &tcpPunchConn{
		conn:      server,
		createdAt: time.Now(),
		peerID:    "LANTARGETTCPROUTE481",
	})

	initiatorAddr := udpAddr("127.0.0.1", 52082)
	responseCh := make(chan struct {
		msg *pb.RendezvousMessage
		err error
	}, 1)
	go func() {
		msg, err := codec.ReadRawProto(client, 2*time.Second)
		responseCh <- struct {
			msg *pb.RendezvousMessage
			err error
		}{msg: msg, err: err}
	}()
	srv.handleFetchLocalAddr(&pb.FetchLocalAddr{
		SocketAddr:  cryptopkg.EncodeAddr(targetAddr),
		RelayServer: "relay.example:21117",
	}, initiatorAddr)

	result := <-responseCh
	if result.err != nil {
		t.Fatalf("read TCP FetchLocalAddr: %v", result.err)
	}
	if result.msg.GetFetchLocalAddr() == nil {
		t.Fatalf("expected FetchLocalAddr, got %+v", result.msg)
	}
	requester, err := cryptopkg.DecodeAddr(result.msg.GetFetchLocalAddr().SocketAddr)
	if err != nil || requester.String() != initiatorAddr.String() {
		t.Fatalf("forwarded requester = %v, %v; want %s", requester, err, initiatorAddr)
	}
}
