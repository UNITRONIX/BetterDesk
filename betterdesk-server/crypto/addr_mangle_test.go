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
	// IPv4-mapped IPv6 like ::ffff:192.168.1.1 uses the mangled IPv4 format.
	addr := &net.UDPAddr{
		IP:   net.ParseIP("::ffff:192.168.1.1"),
		Port: 8080,
	}
	encoded := EncodeAddr(addr)

	// To4() returns non-nil for IPv4-mapped addresses; IPv6 tuples have 18 bytes.
	if len(encoded) == 0 || len(encoded) > 16 {
		t.Fatalf("expected mangled IPv4 for IPv4-mapped IPv6, got %d bytes", len(encoded))
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

// Fixed fixtures generated from a standalone transcription of RustDesk AddrMangle.
// Protocol source: https://github.com/rustdesk/hbb_common/blob/master/src/lib.rs
// Zero timestamps, port carries, maximum timestamps and IPv6 port order are covered.
func TestRustDeskWireVectors(t *testing.T) {
	fixtures := []struct {
		address   string
		timestamp uint32
		wire      string
	}{
		{"0.0.0.0:0", 0, "-"},
		{"0.0.0.0:0", 1, "01000200000002"},
		{"0.0.0.0:0", 65535, "fffffeff0100feff01"},
		{"0.0.0.0:0", 65536, "000000000200000002"},
		{"0.0.0.0:0", 305419896, "7856f0ac6824f0ac6824"},
		{"0.0.0.0:0", 4294967295, "fffffeffffffffffffff01"},
		{"192.0.2.1:21116", 0, "7c520000000080010402"},
		{"192.0.2.1:21116", 1, "7d520200000082010402"},
		{"192.0.2.1:21116", 65535, "7b52ffff01007e010602"},
		{"192.0.2.1:21116", 65536, "7c520000020080010602"},
		{"192.0.2.1:21116", 305419896, "f4a8f0ac682470ae6c26"},
		{"192.0.2.1:21116", 4294967295, "7b52ffffffff7f01040202"},
		{"192.168.1.10:21118", 0, "7e520000000080510314"},
		{"192.168.1.10:21118", 1, "7f520200000082510314"},
		{"192.168.1.10:21118", 65535, "7d52ffff01007e510514"},
		{"192.168.1.10:21118", 65536, "7e520000020080510514"},
		{"192.168.1.10:21118", 305419896, "f6a8f0ac682470fe6b38"},
		{"192.168.1.10:21118", 4294967295, "7d52ffffffff7f51031402"},
		{"255.255.255.255:65535", 0, "ffff00000000feffffff01"},
		{"255.255.255.255:65535", 1, "0000030000000000000002"},
		{"255.255.255.255:65535", 65535, "feffffff0100fcff010002"},
		{"255.255.255.255:65535", 65536, "ffff00000200feff010002"},
		{"255.255.255.255:65535", 305419896, "7756f1ac6824eeac682402"},
		{"255.255.255.255:65535", 4294967295, "fefffffffffffdffffff03"},
		{"[2001:db8::1]:443", 0, "20010db8000000000000000000000001bb01"},
		{"[2001:db8::1]:443", 1, "20010db8000000000000000000000001bb01"},
		{"[2001:db8::1]:443", 65535, "20010db8000000000000000000000001bb01"},
		{"[2001:db8::1]:443", 65536, "20010db8000000000000000000000001bb01"},
		{"[2001:db8::1]:443", 305419896, "20010db8000000000000000000000001bb01"},
		{"[2001:db8::1]:443", 4294967295, "20010db8000000000000000000000001bb01"},
		{"[::1]:65535", 0, "00000000000000000000000000000001ffff"},
		{"[::1]:65535", 1, "00000000000000000000000000000001ffff"},
		{"[::1]:65535", 65535, "00000000000000000000000000000001ffff"},
		{"[::1]:65535", 65536, "00000000000000000000000000000001ffff"},
		{"[::1]:65535", 305419896, "00000000000000000000000000000001ffff"},
		{"[::1]:65535", 4294967295, "00000000000000000000000000000001ffff"},
	}
	for _, fixture := range fixtures {
		address, tm, wire := fixture.address, fixture.timestamp, fixture.wire
		want, err := net.ResolveUDPAddr("udp", address)
		if err != nil {
			t.Fatal(err)
		}
		if wire == "-" {
			if len(encodeIPv4(want, tm)) != 0 {
				t.Fatal("zero vector")
			}
			continue
		}
		encoded, err := hex.DecodeString(wire)
		if err != nil {
			t.Fatal(err)
		}
		got, err := DecodeAddr(encoded)
		if err != nil || !got.IP.Equal(want.IP) || got.Port != want.Port {
			t.Fatalf("Rust decode vector %s tm=%d: %v %v", address, tm, got, err)
		}
		var actual []byte
		if want.IP.To4() != nil {
			actual = encodeIPv4(want, tm)
		} else {
			actual = EncodeAddr(want)
		}
		if hex.EncodeToString(actual) != wire {
			t.Fatalf("Rust encode vector %s tm=%d got %x want %s", address, tm, actual, wire)
		}
	}
}

func TestInvalidInput(t *testing.T) {
	for _, n := range []int{0, 17, 19, 100} {
		if _, err := DecodeAddr(make([]byte, n)); err == nil {
			t.Fatalf("accepted length %d", n)
		}
	}
	for _, a := range []*net.UDPAddr{nil, {IP: nil, Port: 1}, {IP: net.IPv4(1, 2, 3, 4), Port: -1}, {IP: net.IPv4(1, 2, 3, 4), Port: 65536}} {
		if EncodeAddr(a) != nil {
			t.Fatal("accepted invalid address")
		}
	}
}

func TestHistoricalWrongAddress(t *testing.T) {
	// The old raw tuple deterministically decodes to the bogus address in the client log.
	a, err := DecodeAddr([]byte{192, 0, 2, 1, 0x52, 0x7c})
	if err != nil || a.String() != "127.255.214.193:63" {
		t.Fatalf("historical reproduction: %v %v", a, err)
	}
}
