package api

import (
	"bytes"
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

// The API port also serves relay framing for clients that resolve a portless
// `relay-server` to the API port. HTTP and TLS must keep working untouched.

func listenSniff(t *testing.T) (net.Listener, *capturedConns) {
	t.Helper()
	inner, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { inner.Close() })

	captured := &capturedConns{}
	ln := newProtocolSniffListener(inner, func(c net.Conn) {
		captured.add(c)
	})
	return ln, captured
}

type capturedConns struct {
	mu    sync.Mutex
	conns []net.Conn
}

func (c *capturedConns) add(conn net.Conn) {
	c.mu.Lock()
	c.conns = append(c.conns, conn)
	c.mu.Unlock()
}

func (c *capturedConns) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.conns)
}

// acceptInBackground waits for one connection the sniffer returns to HTTP.
func acceptInBackground(ln net.Listener) <-chan net.Conn {
	ch := make(chan net.Conn, 1)
	go func() {
		conn, err := ln.Accept()
		if err == nil {
			ch <- conn
		}
		close(ch)
	}()
	return ch
}

func TestSniffListenerPassesHTTPToHTTPServer(t *testing.T) {
	ln, captured := listenSniff(t)
	accepted := acceptInBackground(ln)

	client, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { client.Close() })

	const request = "GET /api/health HTTP/1.1\r\nHost: x\r\n\r\n"
	if _, err := client.Write([]byte(request)); err != nil {
		t.Fatalf("write: %v", err)
	}

	select {
	case conn := <-accepted:
		if conn == nil {
			t.Fatal("sniffer did not hand the HTTP connection to the server")
		}
		t.Cleanup(func() { conn.Close() })
		// The sniffed byte must be replayed so the HTTP parser sees a full request.
		buf := make([]byte, len(request))
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		if _, err := io.ReadFull(conn, buf); err != nil {
			t.Fatalf("read replayed request: %v", err)
		}
		if !bytes.Equal(buf, []byte(request)) {
			t.Fatalf("replayed bytes = %q, want the original request", buf)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for HTTP accept")
	}

	if captured.len() != 0 {
		t.Fatalf("HTTP request was misrouted to relay (%d conns)", captured.len())
	}
}

func TestSniffListenerPassesTLSHandshakeToHTTPServer(t *testing.T) {
	ln, captured := listenSniff(t)
	accepted := acceptInBackground(ln)

	client, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { client.Close() })

	// TLS record type 22 (handshake) followed by version bytes.
	if _, err := client.Write([]byte{0x16, 0x03, 0x01, 0x00, 0x40}); err != nil {
		t.Fatalf("write: %v", err)
	}

	select {
	case conn := <-accepted:
		if conn == nil {
			t.Fatal("TLS ClientHello must reach the TLS server, not the relay")
		}
		t.Cleanup(func() { conn.Close() })
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for TLS accept")
	}
	if captured.len() != 0 {
		t.Fatalf("TLS handshake was misrouted to relay (%d conns)", captured.len())
	}
}

func TestSniffListenerRoutesRelayFramingToRelay(t *testing.T) {
	ln, captured := listenSniff(t)
	accepted := acceptInBackground(ln)

	client, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { client.Close() })

	// RustDesk BytesCodec frame: a length header, never an ASCII letter.
	if _, err := client.Write([]byte{0x08, 0x01, 0x10, 0x02}); err != nil {
		t.Fatalf("write: %v", err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for captured.len() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if captured.len() != 1 {
		t.Fatalf("relay framing was not routed to the relay handler (%d)", captured.len())
	}
	if RelayFallbackConnections.Load() == 0 {
		t.Fatal("fallback counter did not increment")
	}

	// The HTTP side must not have seen this connection.
	select {
	case conn := <-accepted:
		if conn != nil {
			conn.Close()
			t.Fatal("relay connection leaked to the HTTP server")
		}
	case <-time.After(200 * time.Millisecond):
		// expected: no HTTP accept happened
	}
}

func TestIsHTTPFirstByte(t *testing.T) {
	for _, b := range []byte("GETPOSTHEADPUTPATCHDELETEOPTIONS") {
		if !isHTTPFirstByte(b) {
			t.Fatalf("%q must be treated as HTTP", string(b))
		}
	}
	if !isHTTPFirstByte(0x16) {
		t.Fatal("TLS handshake byte must reach the TLS server")
	}
	// Relay framing length bytes are not ASCII letters.
	for _, b := range []byte{0x00, 0x01, 0x08, 0x10, 0x7f, 0x80, 0xff} {
		if isHTTPFirstByte(b) {
			t.Fatalf("byte 0x%02x must not be treated as HTTP", b)
		}
	}
}
