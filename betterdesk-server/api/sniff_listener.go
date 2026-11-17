package api

import (
	"bytes"
	"io"
	"net"
	"sync/atomic"
	"time"
)

// protocolSniffListener lets the API port also serve relay traffic.
//
// Background: some RustDesk builds resolve a *portless* `relay-server` value
// with the API port instead of RELAY_PORT, so they dial `host:21114` using relay
// framing. That listener speaks HTTP, so the connection dies and the session
// fails with a relay pair timeout. Telling every operator to rebuild their
// agent bundle is not a fix we can ship: deployed agents keep their baked value.
//
// The two protocols are unambiguous at byte level, so the first byte decides:
//
//   - HTTP request methods start with an ASCII letter (GET/POST/HEAD/…).
//   - RustDesk's BytesCodec header starts with a length byte. Control frames on
//     this port are far below 64 KiB, so byte 0 is never an ASCII letter.
//
// Anything that looks like HTTP reaches the HTTP server untouched; anything else
// goes to the relay handler, which reads the normal relay framing.
type protocolSniffListener struct {
	net.Listener
	relay relayHandlerFunc
}

// relayHandlerFunc consumes a connection that carries relay framing.
type relayHandlerFunc func(net.Conn)

// sniffConn replays the sniffed byte before the real reader sees the stream.
type sniffConn struct {
	net.Conn
	reader io.Reader
}

func (c *sniffConn) Read(p []byte) (int, error) { return c.reader.Read(p) }

// RelayFallbackConnections counts connections served by the relay fallback on
// the API port. Non-zero means at least one client is using the compatibility
// path, which is worth surfacing in diagnostics.
var RelayFallbackConnections atomic.Int64

func newProtocolSniffListener(inner net.Listener, relay relayHandlerFunc) net.Listener {
	return &protocolSniffListener{Listener: inner, relay: relay}
}

// Accept accepts and classifies one connection. Relay connections are dispatched
// to the relay handler and never returned to the HTTP server.
func (l *protocolSniffListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}

		var first [1]byte
		if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
			conn.Close()
			continue
		}
		n, readErr := io.ReadFull(conn, first[:])
		// Whichever handler receives the connection owns its timeouts from here.
		_ = conn.SetReadDeadline(time.Time{})
		if readErr != nil || n == 0 {
			conn.Close()
			continue
		}

		replay := &sniffConn{Conn: conn, reader: io.MultiReader(bytes.NewReader(first[:n]), conn)}

		if isHTTPFirstByte(first[0]) {
			return replay, nil
		}
		if l.relay != nil {
			RelayFallbackConnections.Add(1)
			go l.relay(replay)
			continue
		}
		conn.Close()
	}
}

// isHTTPFirstByte reports whether b can start either an HTTP request line or a
// TLS ClientHello.
//
//   - RFC 9110 methods are all ASCII letters, so a letter cannot collide with the
//     length-prefixed relay framing used by RustDesk's BytesCodec.
//   - A TLS ClientHello starts with a handshake record (0x16). Clients that send
//     a portless relay-server value dial plaintext HTTP, but the same listener
//     may still accept TLS, so a handshake must reach the TLS server untouched.
func isHTTPFirstByte(b byte) bool {
	if b == 0x16 { // TLS handshake record
		return true
	}
	return (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z')
}
