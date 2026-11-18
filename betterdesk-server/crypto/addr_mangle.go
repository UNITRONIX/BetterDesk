// Package crypto provides cryptographic utilities for the BetterDesk server.
// Includes AddrMangle (address encoding/decoding) and Ed25519 key management.
package crypto

import (
	"encoding/binary"
	"fmt"
	"net"
	"time"
)

// AddrMangle encodes and decodes socket addresses in the format used by RustDesk protocol.
//
// Format:
//   IPv4: timestamp-mangled integer, little-endian, trailing zero bytes removed.
//   IPv6: [16 bytes IP] + [2 bytes port little-endian] = 18 bytes.

// EncodeAddr encodes a UDP address into the mangled byte format.
func EncodeAddr(addr *net.UDPAddr) []byte {
	if addr == nil || addr.Port < 0 || addr.Port > 65535 {
		return nil
	}
	if addr.IP.To4() != nil {
		return encodeIPv4(addr, uint32(time.Now().UnixMicro()))
	}

	ip6 := addr.IP.To16()
	if ip6 == nil {
		return nil
	}
	buf := make([]byte, 18)
	copy(buf[0:16], ip6)
	binary.LittleEndian.PutUint16(buf[16:18], uint16(addr.Port))
	return buf
}

// encodeIPv4 encodes an IPv4 endpoint with a caller-provided timestamp.
// Keeping the timestamp injectable makes protocol vectors deterministic without
// changing the wire behavior of EncodeAddr.
func encodeIPv4(addr *net.UDPAddr, timestamp uint32) []byte {
	ip := addr.IP.To4()
	ipValue := uint64(binary.LittleEndian.Uint32(ip))
	sum := ipValue + uint64(timestamp)

	// The value is a 128-bit integer:
	// ((ip + timestamp) << 49) |
	// (timestamp << 17) |
	// (port + (timestamp & 0xffff)).
	low := (sum << 49) |
		(uint64(timestamp) << 17) |
		(uint64(addr.Port) + uint64(timestamp&0xffff))
	high := sum >> 15

	buf := make([]byte, 16)
	binary.LittleEndian.PutUint64(buf[0:8], low)
	binary.LittleEndian.PutUint64(buf[8:16], high)

	end := len(buf)
	for end > 0 && buf[end-1] == 0 {
		end--
	}
	return buf[:end]
}

// DecodeAddr decodes a mangled byte slice back to a UDP address.
// Returns error if the byte slice is empty or has an unsupported length.
func DecodeAddr(b []byte) (*net.UDPAddr, error) {
	if len(b) == 18 {
		ip := append(net.IP(nil), b[:16]...)
		port := binary.LittleEndian.Uint16(b[16:18])
		return &net.UDPAddr{IP: ip, Port: int(port)}, nil
	}
	if len(b) == 0 || len(b) > 16 {
		return nil, fmt.Errorf("addr_mangle: invalid length %d", len(b))
	}

	var padded [16]byte
	copy(padded[:], b)
	low := binary.LittleEndian.Uint64(padded[0:8])
	high := binary.LittleEndian.Uint64(padded[8:16])

	timestamp := uint32(low >> 17)
	ipValue := uint32(((low >> 49) | (high << 15)) - uint64(timestamp))
	port := uint16(uint32(low&0xffffff) - (timestamp & 0xffff))

	ip := make(net.IP, net.IPv4len)
	binary.LittleEndian.PutUint32(ip, ipValue)
	return &net.UDPAddr{IP: ip, Port: int(port)}, nil
}

// EncodeAddrFromString encodes a host:port string into the mangled byte format.
func EncodeAddrFromString(address string) ([]byte, error) {
	addr, err := net.ResolveUDPAddr("udp", address)
	if err != nil {
		return nil, fmt.Errorf("addr_mangle: failed to resolve %q: %w", address, err)
	}
	return EncodeAddr(addr), nil
}

// DecodeAddrToString decodes mangled bytes and returns a "host:port" string.
func DecodeAddrToString(b []byte) (string, error) {
	addr, err := DecodeAddr(b)
	if err != nil {
		return "", err
	}
	return addr.String(), nil
}
