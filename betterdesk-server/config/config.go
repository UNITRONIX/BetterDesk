// Package config provides configuration management for BetterDesk server.
// Supports CLI flags, environment variables, and sensible defaults.
package config

import (
	"net"
	"os"
	"strconv"
	"strings"
)

// Enrollment mode constants for Dual Key System.
const (
	EnrollmentModeOpen    = "open"    // Accept all device registrations (backward compatible)
	EnrollmentModeManaged = "managed" // New devices need approval or valid token
	EnrollmentModeLocked  = "locked"  // Only devices with valid tokens can register
)

// Config holds all server configuration.
type Config struct {
	// Network
	SignalPort int // UDP+TCP signal port (default 21116)
	RelayPort  int // TCP relay port (default 21117)
	APIPort    int // HTTP API port (default 21114)

	// Mode
	Mode string // "all", "signal", "relay"

	// Database
	DBPath string // Database DSN: file path for SQLite, postgres:// URI for PostgreSQL

	// Crypto
	KeyFile string // Ed25519 key file path (without extension)

	// Servers
	RelayServers      string // Comma-separated relay server addresses
	RendezvousServers string // Comma-separated rendezvous server addresses

	// Network mask
	Mask string // LAN mask (e.g. "192.168.0.0/24")

	// Relay options
	AlwaysUseRelay bool // Force relay for all connections

	// Security
	BlocklistFile string // Path to blocklist file (IP/ID/CIDR)

	// Audit
	AuditLogFile string // Path to audit log file (JSON lines)

	// TLS
	TLSCertFile string // Path to TLS certificate file
	TLSKeyFile  string // Path to TLS key file

	// Logging
	LogFormat string // "text" or "json"

	// Admin
	AdminPort int // TCP admin interface port (0 = disabled)

	// Security — Authentication
	JWTSecret       string // Secret key for JWT signing (auto-generated if empty)
	JWTExpiry       int    // JWT token expiry in hours (default 24)
	AdminPassword   string // Password for admin TCP interface (empty = no auth)
	ForceHTTPS      bool   // Reject non-TLS API requests (except behind reverse proxy)
	TrustProxy      bool   // Trust X-Forwarded-For / X-Real-IP headers from reverse proxy
	RelayMaxConnsIP int    // Max relay connections per IP (0 = unlimited)
	InitAdminUser   string // Initial admin username (created on first start)
	InitAdminPass   string // Initial admin password (auto-generated if empty)

	// WebSocket security (M3)
	AllowedWSOrigins string // Comma-separated allowed WebSocket origins (empty = allow all)

	// TLS for signal/relay (Phase 3)
	TLSSignal bool // Enable TLS on TCP signal (:21116) and WS signal (:21118)
	TLSRelay  bool // Enable TLS on TCP relay (:21117) and WS relay (:21119)

	// Dual Key System - Enrollment Mode
	// "open" (default) - Accept all device registrations (backward compatible)
	// "managed" - New devices need to be approved or have a valid token
	// "locked" - Only devices with valid tokens can register
	EnrollmentMode string
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		SignalPort:      21116,
		RelayPort:       21117,
		APIPort:         21114,
		Mode:            "all",
		DBPath:          "./db_v2.sqlite3",
		KeyFile:         "id_ed25519",
		JWTExpiry:       24,
		RelayMaxConnsIP: 20,
		EnrollmentMode:  EnrollmentModeOpen, // Backward compatible default
	}
}

// LoadEnv overrides config values from environment variables.
// Environment variables take precedence over CLI flags.
func (c *Config) LoadEnv() {
	// SIGNAL_PORT takes precedence over PORT.
	// This avoids conflicts in Docker single-container setups where PORT=5000
	// is intended for the Node.js console, not the Go signal server.
	if v := os.Getenv("SIGNAL_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.SignalPort = n
		}
	} else if v := os.Getenv("PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.SignalPort = n
		}
	}
	if v := os.Getenv("RELAY_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.RelayPort = n
		}
	}
	if v := os.Getenv("API_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.APIPort = n
		}
	}
	if v := os.Getenv("MODE"); v != "" {
		c.Mode = strings.ToLower(v)
	}
	if v := os.Getenv("DB_URL"); v != "" {
		c.DBPath = v
	}
	if v := os.Getenv("KEY_FILE"); v != "" {
		c.KeyFile = v
	}
	if v := os.Getenv("RELAY_SERVERS"); v != "" {
		c.RelayServers = v
	}
	if v := os.Getenv("RENDEZVOUS_SERVERS"); v != "" {
		c.RendezvousServers = v
	}
	if v := os.Getenv("MASK"); v != "" {
		c.Mask = v
	}
	if strings.ToUpper(os.Getenv("ALWAYS_USE_RELAY")) == "Y" {
		c.AlwaysUseRelay = true
	}
	if v := os.Getenv("BLOCKLIST_FILE"); v != "" {
		c.BlocklistFile = v
	}
	if v := os.Getenv("AUDIT_LOG_FILE"); v != "" {
		c.AuditLogFile = v
	}
	if v := os.Getenv("TLS_CERT"); v != "" {
		c.TLSCertFile = v
	}
	if v := os.Getenv("TLS_KEY"); v != "" {
		c.TLSKeyFile = v
	}
	if v := os.Getenv("LOG_FORMAT"); v != "" {
		c.LogFormat = strings.ToLower(v)
	}
	if v := os.Getenv("ADMIN_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.AdminPort = n
		}
	}
	if v := os.Getenv("JWT_SECRET"); v != "" {
		c.JWTSecret = v
	}
	if v := os.Getenv("JWT_EXPIRY_HOURS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.JWTExpiry = n
		}
	}
	if v := os.Getenv("ADMIN_PASSWORD"); v != "" {
		c.AdminPassword = v
	}
	if strings.ToUpper(os.Getenv("FORCE_HTTPS")) == "Y" {
		c.ForceHTTPS = true
	}
	if strings.ToUpper(os.Getenv("TRUST_PROXY")) == "Y" {
		c.TrustProxy = true
	}
	if v := os.Getenv("RELAY_MAX_CONNS_PER_IP"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.RelayMaxConnsIP = n
		}
	}
	if v := os.Getenv("INIT_ADMIN_USER"); v != "" {
		c.InitAdminUser = v
	}
	if v := os.Getenv("INIT_ADMIN_PASS"); v != "" {
		c.InitAdminPass = v
	}
	if v := os.Getenv("WS_ALLOWED_ORIGINS"); v != "" {
		c.AllowedWSOrigins = v
	}
	if strings.ToUpper(os.Getenv("TLS_SIGNAL")) == "Y" {
		c.TLSSignal = true
	}
	if strings.ToUpper(os.Getenv("TLS_RELAY")) == "Y" {
		c.TLSRelay = true
	}
	if v := os.Getenv("ENROLLMENT_MODE"); v != "" {
		mode := strings.ToLower(v)
		if mode == "open" || mode == "managed" || mode == "locked" {
			c.EnrollmentMode = mode
		}
	}
}

// NATTestPort returns the NAT test port (signal port - 1).
func (c *Config) NATTestPort() int {
	return c.SignalPort - 1
}

// WSSignalPort returns the WebSocket signal port (signal port + 2).
func (c *Config) WSSignalPort() int {
	return c.SignalPort + 2
}

// WSRelayPort returns the WebSocket relay port (relay port + 2).
func (c *Config) WSRelayPort() int {
	return c.RelayPort + 2
}

// GetRelayServers parses the comma-separated relay server list.
// Ensures each entry includes a port; appends the default RelayPort if missing.
func (c *Config) GetRelayServers() []string {
	if c.RelayServers == "" {
		return nil
	}
	servers := strings.Split(c.RelayServers, ",")
	result := make([]string, 0, len(servers))
	for _, s := range servers {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		// Add default relay port if not specified.
		// net.SplitHostPort handles IPv6 bracketed addresses correctly.
		if _, _, err := net.SplitHostPort(s); err != nil {
			s = net.JoinHostPort(s, strconv.Itoa(c.RelayPort))
		}
		result = append(result, s)
	}
	return result
}

// GetAllowedWSOrigins parses the comma-separated list of allowed WebSocket origins.
// Returns nil if empty (meaning all origins are allowed for backward compatibility).
// Supports glob patterns accepted by nhooyr.io/websocket:
//   - "*" matches any origin
//   - "*.example.com" matches subdomains
//   - "https://app.example.com" matches exact origin
func (c *Config) GetAllowedWSOrigins() []string {
	if c.AllowedWSOrigins == "" {
		return nil
	}
	origins := strings.Split(c.AllowedWSOrigins, ",")
	result := make([]string, 0, len(origins))
	for _, o := range origins {
		o = strings.TrimSpace(o)
		if o != "" {
			result = append(result, o)
		}
	}
	return result
}

// HasTLSCert returns true if both TLS certificate and key files are configured.
func (c *Config) HasTLSCert() bool {
	return c.TLSCertFile != "" && c.TLSKeyFile != ""
}

// SignalTLSEnabled returns true if TLS should be used for signal server
// TCP and WebSocket listeners. Requires both --tls-signal flag and valid cert/key.
func (c *Config) SignalTLSEnabled() bool {
	return c.TLSSignal && c.HasTLSCert()
}

// RelayTLSEnabled returns true if TLS should be used for relay server
// TCP and WebSocket listeners. Requires both --tls-relay flag and valid cert/key.
func (c *Config) RelayTLSEnabled() bool {
	return c.TLSRelay && c.HasTLSCert()
}
