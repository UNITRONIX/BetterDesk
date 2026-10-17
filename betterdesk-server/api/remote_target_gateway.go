package api

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/unitronix/betterdesk-server/db"
)

const (
	remoteTargetDialTimeout = 10 * time.Second
	remoteTargetMaxMessage  = 16 << 20
)

// handleRemoteTargetTunnel is a narrow browser -> guacd bridge. The browser
// never receives the target host or stored password; the bridge rewrites the
// Guacamole connect instruction from the server-side target record.
func (s *Server) handleRemoteTargetTunnel(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	target, err := s.db.GetRemoteTarget(id)
	if err != nil || target == nil || !target.Enabled {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "remote target not found"})
		return
	}
	originalHost := target.Host
	resolvedHost, err := resolveRemoteTargetHost(originalHost)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "remote target is not allowed"})
		return
	}
	if target.CertFingerprint != "" {
		if err := verifyRemoteTargetCertificate(resolvedHost, target.Port, originalHost, target.CertFingerprint); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "remote certificate fingerprint mismatch"})
			return
		}
	}
	// Pin the resolved address for the lifetime of this session to prevent a
	// DNS-rebinding race between validation and guacd's own connection.
	target.Host = resolvedHost
	if s.cfg == nil || s.cfg.GuacdAddress == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "RDP/VNC gateway is not configured"})
		return
	}
	if err := validateGuacdAddress(s.cfg.GuacdAddress); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "invalid gateway address"})
		return
	}

	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{})
	if err != nil {
		return
	}
	defer ws.CloseNow()

	guacd, err := net.DialTimeout("tcp", s.cfg.GuacdAddress, remoteTargetDialTimeout)
	if err != nil {
		_ = ws.Close(websocket.StatusBadGateway, "gateway unavailable")
		return
	}
	defer guacd.Close()
	_ = guacd.SetDeadline(time.Now().Add(remoteTargetDialTimeout))

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	errCh := make(chan error, 2)
	argNames := []string{}
	var argNamesMu sync.RWMutex

	go func() {
		errCh <- s.remoteTargetBrowserToGuacd(ctx, ws, guacd, target, &argNames, &argNamesMu)
	}()
	go func() {
		errCh <- s.remoteTargetGuacdToBrowser(ctx, guacd, ws, &argNames, &argNamesMu)
	}()
	<-errCh
	cancel()
	_ = guacd.Close()
	_ = ws.Close(websocket.StatusNormalClosure, "session ended")
}

func (s *Server) remoteTargetBrowserToGuacd(ctx context.Context, ws *websocket.Conn, guacd net.Conn, target *db.RemoteTarget, argNames *[]string, argNamesMu *sync.RWMutex) error {
	parser := &guacInstructionParser{}
	for {
		messageType, data, err := ws.Read(ctx)
		if err != nil {
			return err
		}
		if messageType != websocket.MessageText || len(data) > remoteTargetMaxMessage {
			return fmt.Errorf("invalid Guacamole message")
		}
		instructions, err := parser.Feed(data)
		if err != nil {
			return err
		}
		for _, instruction := range instructions {
			switch instruction.opcode {
			case "select":
				instruction.args = []string{target.Protocol}
			case "connect":
				password, err := s.remoteTargetPassword(target)
				if err != nil {
					return err
				}
				argNamesMu.RLock()
				names := append([]string(nil), (*argNames)...)
				argNamesMu.RUnlock()
				instruction.args = rewriteRemoteTargetConnect(instruction.args, names, target, password)
			}
			if _, err := guacd.Write(encodeGuacInstruction(instruction)); err != nil {
				return err
			}
		}
	}
}

func (s *Server) remoteTargetGuacdToBrowser(ctx context.Context, guacd net.Conn, ws *websocket.Conn, argNames *[]string, argNamesMu *sync.RWMutex) error {
	buf := make([]byte, 64*1024)
	parser := &guacInstructionParser{}
	for {
		n, err := guacd.Read(buf)
		if n > 0 {
			data := append([]byte(nil), buf[:n]...)
			if instructions, parseErr := parser.Feed(data); parseErr == nil {
				for _, instruction := range instructions {
					if instruction.opcode == "args" {
						argNamesMu.Lock()
						*argNames = append((*argNames)[:0], instruction.args...)
						argNamesMu.Unlock()
					}
				}
			}
			if err := ws.Write(ctx, websocket.MessageText, data); err != nil {
				return err
			}
		}
		if err != nil {
			return err
		}
	}
}

func (s *Server) remoteTargetPassword(target *db.RemoteTarget) (string, error) {
	if target == nil || target.CredentialMode != "saved" {
		return "", nil
	}
	if target.CredentialCiphertext == "" {
		return "", fmt.Errorf("saved remote target credential is missing")
	}
	if s.remoteTargetVault == nil {
		return "", fmt.Errorf("remote target credential vault is not configured")
	}
	password, err := s.remoteTargetVault.Open(target.CredentialNonce, target.CredentialCiphertext, target.CredentialKeyID)
	if err != nil {
		log.Printf("[remote-target] credential decrypt failed for %s: %v", target.ID, err)
		return "", fmt.Errorf("remote target credential could not be decrypted")
	}
	return password, nil
}

func rewriteRemoteTargetConnect(values, names []string, target *db.RemoteTarget, savedPassword string) []string {
	out := append([]string(nil), values...)
	for len(out) < len(names) {
		out = append(out, "")
	}
	for index, name := range names {
		switch strings.ToLower(name) {
		case "hostname", "host", "server":
			out[index] = target.Host
		case "port":
			out[index] = strconv.Itoa(target.Port)
		case "username", "user":
			if target.Username != "" {
				out[index] = target.Username
			}
		case "password":
			if savedPassword != "" {
				out[index] = savedPassword
			}
		case "ignore-cert":
			// Never enable trust-all implicitly.
			out[index] = "false"
		}
	}
	return out
}

func validateGuacdAddress(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("guacd must bind to loopback")
	}
	return nil
}

func verifyRemoteTargetCertificate(host string, port int, serverName, expected string) error {
	dialer := &net.Dialer{Timeout: remoteTargetDialTimeout}
	conn, err := tls.DialWithDialer(dialer, "tcp", net.JoinHostPort(host, strconv.Itoa(port)), &tls.Config{
		MinVersion:         tls.VersionTLS12,
		ServerName:         serverName,
		InsecureSkipVerify: true, // fingerprint validation below is the trust decision
	})
	if err != nil {
		return err
	}
	defer conn.Close()
	state := conn.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		return fmt.Errorf("remote target did not provide a certificate")
	}
	sum := sha256.Sum256(state.PeerCertificates[0].Raw)
	actual := hex.EncodeToString(sum[:])
	want := strings.NewReplacer(":", "", " ", "", "-", "").Replace(strings.ToLower(expected))
	if actual != want {
		return fmt.Errorf("certificate fingerprint mismatch")
	}
	return nil
}

func resolveRemoteTargetHost(host string) (string, error) {
	clean := strings.TrimSpace(strings.ToLower(host))
	if clean == "" || clean == "localhost" || clean == "metadata.google.internal" || clean == "metadata.goog" {
		return "", fmt.Errorf("blocked host")
	}
	ips, err := net.LookupIP(clean)
	if err != nil || len(ips) == 0 {
		return "", fmt.Errorf("host resolution failed")
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() || ip.IsMulticast() {
			return "", fmt.Errorf("blocked address")
		}
		if ip.Equal(net.ParseIP("169.254.169.254")) {
			return "", fmt.Errorf("blocked metadata address")
		}
	}
	return ips[0].String(), nil
}

type guacInstruction struct {
	opcode string
	args   []string
}

type guacInstructionParser struct {
	buffer []byte
}

func (p *guacInstructionParser) Feed(data []byte) ([]guacInstruction, error) {
	p.buffer = append(p.buffer, data...)
	var out []guacInstruction
	for {
		if len(p.buffer) == 0 {
			break
		}
		instruction, consumed, complete, err := parseGuacInstruction(p.buffer)
		if err != nil {
			return nil, err
		}
		if !complete {
			break
		}
		p.buffer = p.buffer[consumed:]
		out = append(out, instruction)
		if len(p.buffer) > remoteTargetMaxMessage {
			return nil, fmt.Errorf("Guacamole instruction too large")
		}
	}
	return out, nil
}

func parseGuacInstruction(data []byte) (guacInstruction, int, bool, error) {
	var fields []string
	index := 0
	for {
		dot := index
		for dot < len(data) && data[dot] >= '0' && data[dot] <= '9' {
			dot++
		}
		if dot == index {
			return guacInstruction{}, 0, false, fmt.Errorf("invalid Guacamole length")
		}
		if dot >= len(data) {
			return guacInstruction{}, 0, false, nil
		}
		if data[dot] != '.' {
			return guacInstruction{}, 0, false, fmt.Errorf("invalid Guacamole length")
		}
		length, err := strconv.Atoi(string(data[index:dot]))
		if err != nil || length < 0 || length > remoteTargetMaxMessage {
			return guacInstruction{}, 0, false, fmt.Errorf("invalid Guacamole field length")
		}
		start := dot + 1
		end := start + length
		if end >= len(data) {
			return guacInstruction{}, 0, false, nil
		}
		fields = append(fields, string(data[start:end]))
		switch data[end] {
		case ',':
			index = end + 1
		case ';':
			if len(fields) == 0 || fields[0] == "" {
				return guacInstruction{}, 0, false, fmt.Errorf("empty Guacamole opcode")
			}
			return guacInstruction{opcode: fields[0], args: fields[1:]}, end + 1, true, nil
		default:
			return guacInstruction{}, 0, false, fmt.Errorf("invalid Guacamole separator")
		}
		if index >= len(data) {
			return guacInstruction{}, 0, false, nil
		}
	}
}

func encodeGuacInstruction(instruction guacInstruction) []byte {
	fields := append([]string{instruction.opcode}, instruction.args...)
	var builder strings.Builder
	for index, field := range fields {
		if index > 0 {
			builder.WriteByte(',')
		}
		builder.WriteString(strconv.Itoa(len([]byte(field))))
		builder.WriteByte('.')
		builder.WriteString(field)
	}
	builder.WriteByte(';')
	return []byte(builder.String())
}
