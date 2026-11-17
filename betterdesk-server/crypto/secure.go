// Package crypto — secure TCP handshake for the BetterDesk signal server.
//
// Implements the RustDesk "secure TCP" protocol used by newer clients (≥1.2.x):
//
// Protocol flow:
//  1. Server accepts TCP connection
//  2. Server sends KeyExchange{keys: [ed25519_sign(server_curve25519_pubkey)]}
//     The signed payload is 96 bytes: [64-byte Ed25519 signature][32-byte Curve25519 pubkey]
//     (matches libsodium crypto_sign combined mode)
//  3. Client verifies Ed25519 signature, extracts server's Curve25519 pubkey
//  4. Client sends KeyExchange{keys: [nacl_box_encrypted_sym_key, client_curve25519_pubkey]}
//  5. Server decrypts symmetric key using NaCl box
//  6. All subsequent messages encrypted with NaCl secretbox
//
// Backward compatible: if client sends a non-KeyExchange message (old client),
// the server processes it directly without encryption.
package crypto

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha512"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"time"

	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/nacl/box"
	"golang.org/x/crypto/nacl/secretbox"

	"github.com/unitronix/betterdesk-server/codec"
	pb "github.com/unitronix/betterdesk-server/proto"
	"google.golang.org/protobuf/proto"
)

// Ed25519ToCurve25519PrivateKey converts an Ed25519 private key to a
// Curve25519 private key suitable for X25519 key exchange.
// This mirrors libsodium's crypto_sign_ed25519_sk_to_curve25519.
func Ed25519ToCurve25519PrivateKey(edPriv ed25519.PrivateKey) [32]byte {
	// Ed25519 private key is 64 bytes: [32-byte seed][32-byte public key].
	// The Curve25519 scalar is derived by hashing the seed with SHA-512 and
	// clamping the first 32 bytes.
	seed := edPriv[:32]
	h := sha512.Sum512(seed)
	h[0] &= 248
	h[31] &= 127
	h[31] |= 64
	var curvePriv [32]byte
	copy(curvePriv[:], h[:32])
	return curvePriv
}

// Ed25519ToCurve25519PublicKey converts an Ed25519 public key to a
// Curve25519 public key.  Uses the scalar multiplication identity:
//
//	curve25519_pubkey = scalar_mult(curve25519_privkey, basepoint)
//
// Since we derive the scalar from the private key, we can also derive
// the public key from the private key directly.
//
// Alternatively, we compute it from the Ed25519 private key to ensure
// consistency: curvePriv * basepoint = curvePub.
func Ed25519ToCurve25519PublicKey(edPriv ed25519.PrivateKey) ([32]byte, error) {
	curvePriv := Ed25519ToCurve25519PrivateKey(edPriv)
	curvePub, err := curve25519.X25519(curvePriv[:], curve25519.Basepoint)
	if err != nil {
		return [32]byte{}, fmt.Errorf("secure: curve25519 scalar mult: %w", err)
	}
	var pub [32]byte
	copy(pub[:], curvePub)
	return pub, nil
}

// SecureTCPConn wraps a net.Conn with NaCl secretbox encryption/decryption.
// After the key exchange, all reads and writes go through this wrapper.
type SecureTCPConn struct {
	conn      net.Conn
	key       [32]byte // symmetric NaCl secretbox key
	sendNonce uint64
	recvNonce uint64
	sendMu    sync.Mutex
	recvMu    sync.Mutex
}

// makeNonce builds a 24-byte NaCl nonce from a sequential counter.
// Format: [u64 LE counter][16 zero bytes] — matches RustDesk convention.
func makeNonce(counter uint64) [24]byte {
	var nonce [24]byte
	binary.LittleEndian.PutUint64(nonce[:8], counter)
	return nonce
}

// Read reads and decrypts data from the underlying connection.
// This implements the io.Reader interface at the raw level, but for
// the RustDesk protocol we use ReadMessage instead.
func (sc *SecureTCPConn) Read(p []byte) (int, error) {
	return sc.conn.Read(p)
}

// Write writes data to the underlying connection.
func (sc *SecureTCPConn) Write(p []byte) (int, error) {
	return sc.conn.Write(p)
}

// Close closes the underlying connection.
func (sc *SecureTCPConn) Close() error {
	return sc.conn.Close()
}

// RemoteAddr returns the remote address.
func (sc *SecureTCPConn) RemoteAddr() net.Addr {
	return sc.conn.RemoteAddr()
}

// LocalAddr returns the local address.
func (sc *SecureTCPConn) LocalAddr() net.Addr {
	return sc.conn.LocalAddr()
}

// SetDeadline sets the read and write deadlines.
func (sc *SecureTCPConn) SetDeadline(t time.Time) error {
	return sc.conn.SetDeadline(t)
}

// SetReadDeadline sets the read deadline.
func (sc *SecureTCPConn) SetReadDeadline(t time.Time) error {
	return sc.conn.SetReadDeadline(t)
}

// SetWriteDeadline sets the write deadline.
func (sc *SecureTCPConn) SetWriteDeadline(t time.Time) error {
	return sc.conn.SetWriteDeadline(t)
}

// ReadMessage reads a framed message, decrypts it, and unmarshals the protobuf.
func (sc *SecureTCPConn) ReadMessage(timeout time.Duration) (*pb.RendezvousMessage, error) {
	if timeout > 0 {
		if err := sc.conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
			return nil, fmt.Errorf("secure: set deadline: %w", err)
		}
		defer sc.conn.SetReadDeadline(time.Time{})
	}

	// Read the framed ciphertext
	ciphertext, err := codec.ReadRawBytes(sc.conn, 0) // deadline already set above
	if err != nil {
		return nil, err
	}

	// Decrypt — RustDesk uses pre-increment: first message uses nonce=1
	sc.recvMu.Lock()
	sc.recvNonce++
	nonce := makeNonce(sc.recvNonce)
	sc.recvMu.Unlock()

	plaintext, ok := secretbox.Open(nil, ciphertext, &nonce, &sc.key)
	if !ok {
		return nil, fmt.Errorf("secure: decryption failed (nonce=%d)", sc.recvNonce)
	}

	// Unmarshal protobuf
	msg := &pb.RendezvousMessage{}
	if err := proto.Unmarshal(plaintext, msg); err != nil {
		return nil, fmt.Errorf("secure: unmarshal: %w", err)
	}
	return msg, nil
}

// WriteMessage marshals a protobuf, encrypts it, and writes a framed message.
func (sc *SecureTCPConn) WriteMessage(msg *pb.RendezvousMessage) error {
	data, err := proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("secure: marshal: %w", err)
	}

	// RustDesk uses pre-increment: first message uses nonce=1
	sc.sendMu.Lock()
	sc.sendNonce++
	nonce := makeNonce(sc.sendNonce)
	sc.sendMu.Unlock()

	ciphertext := secretbox.Seal(nil, data, &nonce, &sc.key)
	return codec.WriteRawBytes(sc.conn, ciphertext)
}

// ReadRawDecrypted reads a framed encrypted message and decrypts it to raw bytes.
// Useful for relay scenarios where we decrypt, then re-encrypt for another connection.
func (sc *SecureTCPConn) ReadRawDecrypted(timeout time.Duration) ([]byte, error) {
	if timeout > 0 {
		if err := sc.conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
			return nil, fmt.Errorf("secure: set deadline: %w", err)
		}
		defer sc.conn.SetReadDeadline(time.Time{})
	}

	ciphertext, err := codec.ReadRawBytes(sc.conn, 0)
	if err != nil {
		return nil, err
	}

	sc.recvMu.Lock()
	sc.recvNonce++
	nonce := makeNonce(sc.recvNonce)
	sc.recvMu.Unlock()

	plaintext, ok := secretbox.Open(nil, ciphertext, &nonce, &sc.key)
	if !ok {
		return nil, fmt.Errorf("secure: decryption failed (nonce=%d)", sc.recvNonce)
	}

	return plaintext, nil
}

// WriteRawEncrypted encrypts raw bytes and writes a framed message.
// Useful for relay scenarios where we received decrypted data from another connection.
func (sc *SecureTCPConn) WriteRawEncrypted(data []byte) error {
	sc.sendMu.Lock()
	sc.sendNonce++
	nonce := makeNonce(sc.sendNonce)
	sc.sendMu.Unlock()

	ciphertext := secretbox.Seal(nil, data, &nonce, &sc.key)
	return codec.WriteRawBytes(sc.conn, ciphertext)
}

// HandshakeResult holds the outcome of the TCP security handshake.
type HandshakeResult struct {
	// Secure is true if encryption was negotiated.
	Secure bool

	// SecureConn is set when Secure is true — use for encrypted I/O.
	SecureConn *SecureTCPConn

	// FirstMsg is set when Secure is false — the first (unencrypted) message
	// already read from the client (old client that doesn't do key exchange).
	FirstMsg *pb.RendezvousMessage
}

// NegotiateSecureTCP performs the secure TCP handshake on a newly accepted
// signal connection.
//
// Flow:
//  1. Send server's Curve25519 public key as KeyExchange
//  2. Read the client's first response
//  3. If KeyExchange → complete handshake, return SecureConn
//  4. If other message → old client, return that message for direct handling
//
// The edPriv parameter is the server's Ed25519 private key (64 bytes).
func NegotiateSecureTCP(conn net.Conn, edPriv ed25519.PrivateKey) (*HandshakeResult, error) {
	// Derive Curve25519 keys from Ed25519 identity key
	curvePriv := Ed25519ToCurve25519PrivateKey(edPriv)
	curvePub, err := Ed25519ToCurve25519PublicKey(edPriv)
	if err != nil {
		return nil, fmt.Errorf("secure: derive curve25519 key: %w", err)
	}

	// Step 1: Send Ed25519-signed Curve25519 public key as KeyExchange.
	// RustDesk clients expect libsodium crypto_sign combined format:
	// [64-byte Ed25519 signature][32-byte Curve25519 pubkey] = 96 bytes.
	signature := ed25519.Sign(edPriv, curvePub[:]) // 64 bytes (detached)
	signedPubKey := make([]byte, 0, 96)
	signedPubKey = append(signedPubKey, signature...)   // first 64 bytes: signature
	signedPubKey = append(signedPubKey, curvePub[:]...) // last 32 bytes: pubkey

	keMsg := &pb.RendezvousMessage{
		Union: &pb.RendezvousMessage_KeyExchange{
			KeyExchange: &pb.KeyExchange{
				Keys: [][]byte{signedPubKey},
			},
		},
	}
	if err := codec.WriteRawProto(conn, keMsg); err != nil {
		return nil, fmt.Errorf("secure: send KeyExchange: %w", err)
	}
	log.Printf("[signal] Sent signed KeyExchange to %s (sig=%d + pubkey=%d = %d bytes)",
		conn.RemoteAddr(), len(signature), len(curvePub), len(signedPubKey))

	// Step 2: Read client's first response (30s timeout)
	resp, err := codec.ReadRawProto(conn, 30*time.Second)
	if err != nil {
		// A silent peer here means it never completed our KeyExchange. Log the
		// transport detail so a systematic handshake failure (every new client,
		// zero "secure established") is distinguishable from ordinary churn.
		return nil, fmt.Errorf("secure: read client response: %w", err)
	}

	// Step 3: Check if it's a KeyExchange
	if ke := resp.GetKeyExchange(); ke != nil {
		// New client completing secure handshake
		keys := ke.GetKeys()
		log.Printf("[signal] client KeyExchange from %s: keys=%d version=%d signedParams=%d bytes",
			conn.RemoteAddr(), len(keys), ke.GetVersion(), len(ke.GetSignedParams()))
		if len(keys) < 2 {
			return nil, fmt.Errorf("secure: KeyExchange from client has %d keys (expected ≥2)", len(keys))
		}

		// Client sends: keys[0] = ephemeral Curve25519 public key (32 bytes)
		//               keys[1] = NaCl box-encrypted symmetric key (48 bytes = 32 + 16 MAC)
		clientPubKeyBytes := keys[0]
		encryptedSymKey := keys[1]

		if len(clientPubKeyBytes) != 32 {
			return nil, fmt.Errorf("secure: client public key is %d bytes (expected 32)", len(clientPubKeyBytes))
		}
		if len(encryptedSymKey) != 48 {
			log.Printf("[signal] Warning: encrypted sym key is %d bytes (expected 48)", len(encryptedSymKey))
		}

		var clientPub [32]byte
		copy(clientPub[:], clientPubKeyBytes)

		// Decrypt the symmetric key using NaCl box
		// box.Open(out, box, nonce, senderPublicKey, recipientPrivateKey)
		var zeroNonce [24]byte
		symKeyBytes, ok := box.Open(nil, encryptedSymKey, &zeroNonce, &clientPub, &curvePriv)
		if !ok {
			return nil, fmt.Errorf("secure: failed to decrypt symmetric key from client")
		}
		if len(symKeyBytes) != 32 {
			return nil, fmt.Errorf("secure: symmetric key is %d bytes (expected 32)", len(symKeyBytes))
		}

		var symKey [32]byte
		copy(symKey[:], symKeyBytes)

		log.Printf("[signal] Secure TCP established with %s (sym_key_len=%d)", conn.RemoteAddr(), len(symKeyBytes))

		return &HandshakeResult{
			Secure: true,
			SecureConn: &SecureTCPConn{
				conn: conn,
				key:  symKey,
			},
		}, nil
	}

	// Step 4: Not a KeyExchange — old client, return the message for direct handling
	log.Printf("[signal] Non-secure TCP from %s (old client, no KeyExchange; got %T)", conn.RemoteAddr(), resp.GetUnion())
	return &HandshakeResult{
		Secure:   false,
		FirstMsg: resp,
	}, nil
}

// GenerateEphemeralX25519 generates a random X25519 keypair for one-shot use.
// Not currently needed (we derive from Ed25519), but available for future use.
func GenerateEphemeralX25519() (publicKey, privateKey [32]byte, err error) {
	_, err = io.ReadFull(rand.Reader, privateKey[:])
	if err != nil {
		return
	}
	pub, err := curve25519.X25519(privateKey[:], curve25519.Basepoint)
	if err != nil {
		return
	}
	copy(publicKey[:], pub)
	return
}
