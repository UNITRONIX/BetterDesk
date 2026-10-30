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
//   - IPv4: timestamp-mangled integer, little-endian with trailing zero bytes removed.
//   - IPv6: [16 bytes IP] + [2 bytes port little-endian] = 18 bytes.
//
// EncodeAddr encodes a UDP address into the mangled byte format.
func EncodeAddr(addr *net.UDPAddr) []byte {
	if addr == nil || addr.Port < 0 || addr.Port > 65535 {
		return nil
	}
	if addr.IP.To4() != nil {
		return encodeIPv4(addr, uint32(time.Now().UnixMicro()))
	}
	// IPv6: 16 bytes IP + 2 bytes port, little-endian.
	ip := addr.IP.To16()
	if ip == nil {
		return nil
	}
	buf := make([]byte, 18)
	copy(buf, ip)
	binary.LittleEndian.PutUint16(buf[16:], uint16(addr.Port))
	return buf
}

func encodeIPv4(addr *net.UDPAddr, tm uint32) []byte {
	// Rust uses a u128: ((ip + tm) << 49) | (tm << 17) | (port + (tm & 0xffff)).
	// Keep the carry of ip+tm in a uint64 and split the result into two limbs.
	sum := uint64(binary.LittleEndian.Uint32(addr.IP.To4())) + uint64(tm)
	lo := (sum << 49) | (uint64(tm) << 17) | (uint64(addr.Port) + uint64(tm&0xffff))
	hi := sum >> 15
	buf := make([]byte, 16)
	binary.LittleEndian.PutUint64(buf, lo)
	binary.LittleEndian.PutUint64(buf[8:], hi)
	n := len(buf)
	for n > 0 && buf[n-1] == 0 {
		n--
	}
	return buf[:n]
}

// DecodeAddr decodes a mangled byte slice back to a UDP address.
// Returns error if the byte slice is empty or has an unsupported length.
func DecodeAddr(b []byte) (*net.UDPAddr, error) {
	if len(b) == 18 {
		ip := append(net.IP(nil), b[:16]...)
		return &net.UDPAddr{IP: ip, Port: int(binary.LittleEndian.Uint16(b[16:]))}, nil
	}
	if len(b) == 0 || len(b) > 16 {
		return nil, fmt.Errorf("addr_mangle: invalid length %d", len(b))
	}
	var padded [16]byte
	copy(padded[:], b)
	lo := binary.LittleEndian.Uint64(padded[:8])
	hi := binary.LittleEndian.Uint64(padded[8:])
	tm := uint32(lo >> 17)
	ipValue := uint32(((lo >> 49) | (hi << 15)) - uint64(tm))
	port := uint16(uint32(lo&0xffffff) - (tm & 0xffff))
	ip := make(net.IP, 4)
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
