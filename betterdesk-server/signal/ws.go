package signal

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/unitronix/betterdesk-server/codec"
	"github.com/unitronix/betterdesk-server/config"
	"github.com/unitronix/betterdesk-server/peer"
	pb "github.com/unitronix/betterdesk-server/proto"
)

// serveWS starts the WebSocket signal listener (e.g., port 21118).
// RustDesk web clients connect here for the same signal protocol,
// using raw protobuf in binary WS frames (no 2-byte TCP header).
// Phase 3: Supports WSS when TLS is enabled for signal server.
func (s *Server) serveWS() {
	defer s.wg.Done()

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleWSUpgrade)

	addr := fmt.Sprintf(":%d", s.cfg.WSSignalPort())
	s.wsHTTP = &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  config.WSConnTimeout,
		WriteTimeout: config.WSConnTimeout,
		BaseContext: func(l net.Listener) context.Context {
			return s.ctx
		},
	}

	// Phase 3: Enable WSS if TLS is configured for signal server.
	if s.cfg.SignalTLSEnabled() {
		tlsCfg, err := config.LoadTLSConfig(s.cfg.TLSCertFile, s.cfg.TLSKeyFile)
		if err != nil {
			log.Printf("[signal] WSS TLS config error: %v", err)
			return
		}
		s.wsHTTP.TLSConfig = tlsCfg
		log.Printf("[signal] WSS listening on %s (TLS enabled)", addr)
		if err := s.wsHTTP.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
			log.Printf("[signal] WSS server error: %v", err)
		}
	} else {
		log.Printf("[signal] WS listening on %s", addr)
		if err := s.wsHTTP.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[signal] WS server error: %v", err)
		}
	}
}

// handleWSUpgrade upgrades an HTTP request to a WebSocket connection
// and enters the signal message loop.
func (s *Server) handleWSUpgrade(w http.ResponseWriter, r *http.Request) {
	opts := &websocket.AcceptOptions{}

	// M3: Validate WebSocket origin if configured. When AllowedWSOrigins is
	// empty, accept all origins for backward compatibility with web clients.
	allowed := s.cfg.GetAllowedWSOrigins()
	if len(allowed) > 0 {
		opts.OriginPatterns = allowed
	} else {
		opts.InsecureSkipVerify = true
	}

	ws, err := websocket.Accept(w, r, opts)
	if err != nil {
		log.Printf("[signal] WS upgrade error: %v", err)
		return
	}
	remoteAddr := r.RemoteAddr

	// Increase read limit for file transfer signaling
	ws.SetReadLimit(256 * 1024)

	wsc := codec.NewWSConn(ws, s.ctx, remoteAddr)

	// Persistent connection — read messages in a loop until close or error.
	s.wsSignalLoop(wsc)
}

// wsSignalLoop reads protobuf messages from a WS connection and dispatches them.
// Unlike TCP (single request-response), WS connections stay open for streaming
// heartbeats and bi-directional signaling.
func (s *Server) wsSignalLoop(wsc *codec.WSConn) {
	defer wsc.Close()

	remoteAddr := wsc.RemoteAddr()

	for {
		msg, err := wsc.ReadMessage()
		if err != nil {
			// Normal close or context cancelled — not an error
			select {
			case <-s.ctx.Done():
			default:
				if websocket.CloseStatus(err) == -1 {
					log.Printf("[signal] WS read from %s: %v", remoteAddr, err)
				}
			}
			return
		}

		switch {
		case msg.GetRegisterPeer() != nil:
			resp := s.handleRegisterPeerWS(msg.GetRegisterPeer(), remoteAddr)
			if resp != nil {
				wsc.WriteMessage(resp)
			}

		case msg.GetRegisterPk() != nil:
			fakeAddr, _ := net.ResolveUDPAddr("udp", remoteAddr)
			resp := s.processRegisterPk(msg.GetRegisterPk(), remoteAddr)
			if fakeAddr != nil {
				// Also update the entry to mark it as WS connected
				entry := s.peers.Get(msg.GetRegisterPk().Id)
				if entry != nil {
					entry.ConnType = peer.ConnWS
					entry.WSConn = wsc
				}
			}
			if resp != nil {
				wsc.WriteMessage(resp)
			}

		case msg.GetPunchHoleRequest() != nil:
			fakeAddr, _ := net.ResolveUDPAddr("udp", remoteAddr)
			resp := s.handlePunchHoleRequestTCP(msg.GetPunchHoleRequest(), fakeAddr)
			if resp != nil {
				wsc.WriteMessage(resp)
			}

		case msg.GetTestNatRequest() != nil:
			// NAT test over WS — extract port from remote address (limited value)
			fakeAddr, _ := net.ResolveTCPAddr("tcp", remoteAddr)
			resp := s.handleTestNat(msg.GetTestNatRequest(), fakeAddr)
			if resp != nil {
				wsc.WriteMessage(resp)
			}

		case msg.GetOnlineRequest() != nil:
			resp := s.handleOnlineRequest(msg.GetOnlineRequest())
			if resp != nil {
				wsc.WriteMessage(resp)
			}

		case msg.GetRequestRelay() != nil:
			// Use the TCP handler which returns an immediate RelayResponse with
			// signed PK — the UDP handler would send the response via UDP which
			// the WebSocket client cannot receive.
			fakeAddr, _ := net.ResolveUDPAddr("udp", remoteAddr)
			if fakeAddr != nil {
				resp := s.handleRequestRelayTCP(msg.GetRequestRelay(), fakeAddr)
				if resp != nil {
					wsc.WriteMessage(resp)
				}
			}

		case msg.GetFetchLocalAddr() != nil:
			fakeAddr, _ := net.ResolveUDPAddr("udp", remoteAddr)
			if fakeAddr != nil {
				s.handleFetchLocalAddr(msg.GetFetchLocalAddr(), fakeAddr)
			}

		case msg.GetLocalAddr() != nil:
			fakeAddr, _ := net.ResolveUDPAddr("udp", remoteAddr)
			if fakeAddr != nil {
				s.handleLocalAddr(msg.GetLocalAddr(), fakeAddr)
			}

		case msg.GetHc() != nil:
			resp := &pb.RendezvousMessage{
				Union: &pb.RendezvousMessage_Hc{
					Hc: &pb.HealthCheck{Token: msg.GetHc().Token},
				},
			}
			wsc.WriteMessage(resp)

		default:
			log.Printf("[signal] WS: unhandled message from %s", remoteAddr)
		}
	}
}

// handleRegisterPeerWS processes a heartbeat over WebSocket.
// Similar to handleRegisterPeer but uses the WS remote address.
func (s *Server) handleRegisterPeerWS(msg *pb.RegisterPeer, remoteAddr string) *pb.RendezvousMessage {
	id := msg.Id
	if id == "" {
		return nil
	}

	existing := s.peers.Get(id)
	if existing != nil {
		// Reject banned peers — do not heartbeat or respond
		if existing.Banned {
			log.Printf("[signal] Rejected banned WS peer heartbeat: %s from %s", id, remoteAddr)
			return nil
		}

		// Update heartbeat (WS has no real UDP addr)
		existing.LastReg = time.Now()
		existing.Serial = msg.Serial
		existing.ConnType = peer.ConnWS
		existing.IP = remoteAddr

		requestPk := len(existing.PK) == 0
		s.db.UpdatePeerStatus(id, "ONLINE", remoteAddr)

		return &pb.RendezvousMessage{
			Union: &pb.RendezvousMessage_RegisterPeerResponse{
				RegisterPeerResponse: &pb.RegisterPeerResponse{
					RequestPk: requestPk,
				},
			},
		}
	}

	// Check if this peer is banned in the database (e.g. removed from memory
	// map after ban but trying to re-register via WS)
	if banned, _ := s.db.IsPeerBanned(id); banned {
		log.Printf("[signal] Rejected banned WS peer registration: %s from %s", id, remoteAddr)
		return nil
	}

	// New peer via WS
	entry := &peer.Entry{
		ID:       id,
		IP:       remoteAddr,
		Serial:   msg.Serial,
		ConnType: peer.ConnWS,
		LastReg:  time.Now(),
	}
	s.peers.Put(entry)

	log.Printf("[signal] New WS peer registered: %s from %s", id, remoteAddr)
	s.db.UpdatePeerStatus(id, "ONLINE", remoteAddr)

	return &pb.RendezvousMessage{
		Union: &pb.RendezvousMessage_RegisterPeerResponse{
			RegisterPeerResponse: &pb.RegisterPeerResponse{
				RequestPk: true,
			},
		},
	}
}

// sendToWSPeer sends a protobuf message to a peer connected via WebSocket.
func (s *Server) sendToWSPeer(id string, msg *pb.RendezvousMessage) error {
	entry := s.peers.Get(id)
	if entry == nil || entry.ConnType != peer.ConnWS || entry.WSConn == nil {
		return fmt.Errorf("peer %s not connected via WS", id)
	}
	wsc, ok := entry.WSConn.(*codec.WSConn)
	if !ok {
		return fmt.Errorf("peer %s has invalid WS connection", id)
	}
	return wsc.WriteMessage(msg)
}

// sendToPeer sends a protobuf message to a peer using whatever transport it's connected on.
func (s *Server) sendToPeer(id string, msg *pb.RendezvousMessage) {
	entry := s.peers.Get(id)
	if entry == nil {
		return
	}

	switch entry.ConnType {
	case peer.ConnUDP:
		if entry.UDPAddr != nil {
			s.sendUDP(msg, entry.UDPAddr)
		}
	case peer.ConnWS:
		if entry.WSConn != nil {
			wsc, ok := entry.WSConn.(*codec.WSConn)
			if ok {
				if err := wsc.WriteMessage(msg); err != nil {
					log.Printf("[signal] WS send to %s: %v", id, err)
				}
			}
		}
	case peer.ConnTCP:
		if entry.TCPConn != nil {
			if err := codec.WriteRawProto(entry.TCPConn, msg); err != nil {
				log.Printf("[signal] TCP send to %s: %v", id, err)
			}
		}
	}
}
