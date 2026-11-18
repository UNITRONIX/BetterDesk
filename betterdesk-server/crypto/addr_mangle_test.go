package crypto

import (
	"encoding/hex"
	"net"
	"testing"
)

func TestEncodeDecodeIPv4(t *testing.T) {
	addr := &net.UDPAddr{
		IP:   net.ParseIP("192.168.1.100"),
		Port: 21116,
	}
	encoded := EncodeAddr(addr)

	decoded, err := DecodeAddr(encoded)
	if err != nil {
		t.Fatalf("decode error: %v", err)
	}

	if !decoded.IP.Equal(addr.IP) {
		t.Errorf("IP mismatch: got %v, want %v", decoded.IP, addr.IP)
	}
	if decoded.Port != addr.Port {
		t.Errorf("port mismatch: got %d, want %d", decoded.Port, addr.Port)
	}
}

func TestEncodeDecodeIPv6(t *testing.T) {
	addr := &net.UDPAddr{
		IP:   net.ParseIP("2001:db8::1"),
		Port: 443,
	}
	encoded := EncodeAddr(addr)

	if len(encoded) != 18 {
		t.Fatalf("expected 18 bytes for IPv6, got %d", len(encoded))
	}

	decoded, err := DecodeAddr(encoded)
	if err != nil {
		t.Fatalf("decode error: %v", err)
	}

	if !decoded.IP.Equal(addr.IP) {
		t.Errorf("IP mismatch: got %v, want %v", decoded.IP, addr.IP)
	}
	if decoded.Port != addr.Port {
		t.Errorf("port mismatch: got %d, want %d", decoded.Port, addr.Port)
	}
}

func TestEncodeDecodeIPv4MappedIPv6(t *testing.T) {
	// IPv4-mapped IPv6 like ::ffff:192.168.1.1 should encode as IPv4 (4 bytes)
	addr := &net.UDPAddr{
		IP:   net.ParseIP("::ffff:192.168.1.1"),
		Port: 8080,
	}
	encoded := EncodeAddr(addr)

	// To4() returns non-nil for IPv4-mapped addresses, so this uses the
	// variable-length IPv4 representation rather than the IPv6 representation.
	if len(encoded) == 0 || len(encoded) > 16 {
		t.Fatalf("expected variable-length IPv4 encoding, got %d bytes", len(encoded))
	}

	decoded, err := DecodeAddr(encoded)
	if err != nil {
		t.Fatalf("decode error: %v", err)
	}

	expected := net.ParseIP("192.168.1.1").To4()
	if !decoded.IP.Equal(expected) {
		t.Errorf("IP mismatch: got %v, want %v", decoded.IP, expected)
	}
	if decoded.Port != 8080 {
		t.Errorf("port mismatch: got %d, want 8080", decoded.Port)
	}
}

func TestDecodeInvalidLength(t *testing.T) {
	testCases := []int{0, 17, 19, 100}
	for _, n := range testCases {
		b := make([]byte, n)
		_, err := DecodeAddr(b)
		if err == nil {
			t.Errorf("expected error for length %d, got nil", n)
		}
	}
}

func TestEncodeDecodeString(t *testing.T) {
	encoded, err := EncodeAddrFromString("10.0.0.1:5000")
	if err != nil {
		t.Fatalf("encode error: %v", err)
	}

	s, err := DecodeAddrToString(encoded)
	if err != nil {
		t.Fatalf("decode error: %v", err)
	}

	if s != "10.0.0.1:5000" {
		t.Errorf("got %q, want %q", s, "10.0.0.1:5000")
	}
}

func TestEncodeDecodePort0(t *testing.T) {
	addr := &net.UDPAddr{IP: net.ParseIP("0.0.0.0"), Port: 0}
	encoded := EncodeAddr(addr)
	decoded, err := DecodeAddr(encoded)
	if err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if decoded.Port != 0 {
		t.Errorf("expected port 0, got %d", decoded.Port)
	}
}

func TestEncodeDecodeMaxPort(t *testing.T) {
	addr := &net.UDPAddr{IP: net.ParseIP("255.255.255.255"), Port: 65535}
	encoded := EncodeAddr(addr)
	decoded, err := DecodeAddr(encoded)
	if err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if decoded.Port != 65535 {
		t.Errorf("expected port 65535, got %d", decoded.Port)
	}
	if !decoded.IP.Equal(net.ParseIP("255.255.255.255")) {
		t.Errorf("IP mismatch: got %v", decoded.IP)
	}
}

func BenchmarkEncodeIPv4(b *testing.B) {
	addr := &net.UDPAddr{IP: net.ParseIP("192.168.1.1"), Port: 21116}
	for i := 0; i < b.N; i++ {
		EncodeAddr(addr)
	}
}

func BenchmarkDecodeIPv4(b *testing.B) {
	data := EncodeAddr(&net.UDPAddr{IP: net.ParseIP("192.168.1.1"), Port: 21116})
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		DecodeAddr(data)
	}
}

func TestAddrMangleProtocolVectors(t *testing.T) {
	vectors := []struct {
		name      string
		address   string
		timestamp uint32
		wire      string
	}{
		{
			name:      "ipv4-basic",
			address:   "192.0.2.1:21116",
			timestamp: 0,
			wire:      "7c520000000080010402",
		},
		{
			name:      "ipv4-timestamp",
			address:   "192.0.2.1:21116",
			timestamp: 1,
			wire:      "7d520200000082010402",
		},
		{
			name:      "ipv4-port-carry",
			address:   "192.0.2.1:21116",
			timestamp: 65535,
			wire:      "7b52ffff01007e010602",
		},
		{
			name:      "ipv4-maximum",
			address:   "255.255.255.255:65535",
			timestamp: 4294967295,
			wire:      "fefffffffffffdffffff03",
		},
		{
			name:      "ipv6-little-endian-port",
			address:   "[2001:db8::1]:443",
			timestamp: 0,
			wire:      "20010db8000000000000000000000001bb01",
		},
	}

	for _, vector := range vectors {
		t.Run(vector.name, func(t *testing.T) {
			want, err := net.ResolveUDPAddr("udp", vector.address)
			if err != nil {
				t.Fatal(err)
			}
			wire, err := hex.DecodeString(vector.wire)
			if err != nil {
				t.Fatal(err)
			}

			got, err := DecodeAddr(wire)
			if err != nil {
				t.Fatalf("DecodeAddr: %v", err)
			}
			if !got.IP.Equal(want.IP) || got.Port != want.Port {
				t.Fatalf("decoded address = %s, want %s", got, want)
			}

			var encoded []byte
			if want.IP.To4() != nil {
				encoded = encodeIPv4(want, vector.timestamp)
			} else {
				encoded = EncodeAddr(want)
			}
			if gotWire := hex.EncodeToString(encoded); gotWire != vector.wire {
				t.Fatalf("encoded wire = %s, want %s", gotWire, vector.wire)
			}
		})
	}
}

func TestAddrMangleRejectsInvalidEndpoints(t *testing.T) {
	for _, addr := range []*net.UDPAddr{
		nil,
		{IP: nil, Port: 1},
		{IP: net.IPv4(1, 2, 3, 4), Port: -1},
		{IP: net.IPv4(1, 2, 3, 4), Port: 65536},
	} {
		if got := EncodeAddr(addr); got != nil {
			t.Fatalf("EncodeAddr(%v) = %x, want nil", addr, got)
		}
	}
}

func TestAddrMangleHistoricalWrongAddress(t *testing.T) {
	// This is the old fixed tuple from issue #481. The stock decoder reads it
	// as a different valid endpoint, demonstrating the interoperability failure
	// without importing any client source.
	got, err := DecodeAddr([]byte{192, 0, 2, 1, 0x52, 0x7c})
	if err != nil {
		t.Fatalf("DecodeAddr: %v", err)
	}
	if got.String() != "127.255.214.193:63" {
		t.Fatalf("historical address = %s, want 127.255.214.193:63", got)
	}
}
