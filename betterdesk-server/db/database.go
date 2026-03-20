// Package db defines the database interface and models for the BetterDesk server.
// Implementations: sqlite.go (default), postgres.go (PostgreSQL via pgx/v5).
package db

import "time"

// Peer represents a registered RustDesk device.
type Peer struct {
	ID           string     `json:"id"`
	UUID         string     `json:"uuid"`
	PK           []byte     `json:"pk"`
	IP           string     `json:"ip"`
	User         string     `json:"user,omitempty"`
	Hostname     string     `json:"hostname,omitempty"`
	OS           string     `json:"os,omitempty"`
	Version      string     `json:"version,omitempty"`
	Status       string     `json:"status"` // ONLINE, OFFLINE, DEGRADED, CRITICAL
	NATType      int        `json:"nat_type"`
	LastOnline   time.Time  `json:"last_online"`
	CreatedAt    time.Time  `json:"created_at"`
	Disabled     bool       `json:"disabled"`
	Banned       bool       `json:"banned"`
	BanReason    string     `json:"ban_reason,omitempty"`
	BannedAt     *time.Time `json:"banned_at,omitempty"`
	SoftDeleted  bool       `json:"soft_deleted"`
	DeletedAt    *time.Time `json:"deleted_at,omitempty"`
	Note         string     `json:"note,omitempty"`
	Tags         string     `json:"tags,omitempty"`
	DeviceType   string     `json:"device_type,omitempty"`    // CDAP: desktop, mobile, headless, kiosk, etc.
	LinkedPeerID string     `json:"linked_peer_id,omitempty"` // CDAP: paired device (e.g., mobile→desktop)
	HeartbeatSeq int64      `json:"-"`                        // internal heartbeat counter
}

// ServerConfig stores runtime configuration in the database.
type ServerConfig struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// User represents an API user account.
type User struct {
	ID           int64  `json:"id"`
	Username     string `json:"username"`
	PasswordHash string `json:"-"`
	Role         string `json:"role"` // admin, operator, viewer
	TOTPSecret   string `json:"-"`
	TOTPEnabled  bool   `json:"totp_enabled"`
	CreatedAt    string `json:"created_at"`
	LastLogin    string `json:"last_login,omitempty"`
}

// APIKey represents a scoped API key for programmatic access.
type APIKey struct {
	ID        int64  `json:"id"`
	KeyHash   string `json:"-"`
	KeyPrefix string `json:"key_prefix"` // First 8 chars for identification
	Name      string `json:"name"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
	ExpiresAt string `json:"expires_at,omitempty"`
	LastUsed  string `json:"last_used,omitempty"`
}

// IDChangeHistory tracks peer ID changes.
type IDChangeHistory struct {
	OldID     string    `json:"old_id"`
	NewID     string    `json:"new_id"`
	ChangedAt time.Time `json:"changed_at"`
	Reason    string    `json:"reason,omitempty"`
}

// PeerMetric represents a single heartbeat metric data point.
type PeerMetric struct {
	ID        int64     `json:"id"`
	PeerID    string    `json:"peer_id"`
	CPU       float64   `json:"cpu_usage"`
	Memory    float64   `json:"memory_usage"`
	Disk      float64   `json:"disk_usage"`
	CreatedAt time.Time `json:"created_at"`
}

// DeviceToken represents a unique enrollment token for device registration.
// Dual Key System: supports both global server key (backward compatible) and
// per-device tokens for enhanced security.
type DeviceToken struct {
	ID         int64      `json:"id"`
	Token      string     `json:"token"`             // Unique enrollment token (32 chars)
	TokenHash  string     `json:"-"`                 // SHA256 hash for storage
	Name       string     `json:"name"`              // Friendly name for the token
	PeerID     string     `json:"peer_id,omitempty"` // Bound peer ID (after enrollment)
	Status     string     `json:"status"`            // pending, active, revoked, expired
	MaxUses    int        `json:"max_uses"`          // 0 = unlimited, 1 = single-use
	UseCount   int        `json:"use_count"`         // Current use count
	CreatedAt  time.Time  `json:"created_at"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"` // Optional expiration
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	CreatedBy  string     `json:"created_by,omitempty"` // Admin who created the token
	Note       string     `json:"note,omitempty"`
}

// DeviceTokenStatus constants
const (
	TokenStatusPending = "pending" // Created, not yet used
	TokenStatusActive  = "active"  // Bound to a peer
	TokenStatusRevoked = "revoked" // Manually revoked
	TokenStatusExpired = "expired" // Past expiration date
)

// Database is the interface for all database operations.
// Designed to support SQLite (now) and PostgreSQL (future) as drop-in implementations.
type Database interface {
	// Lifecycle
	Close() error
	Migrate() error

	// Peer operations
	GetPeer(id string) (*Peer, error)
	GetPeerByUUID(uuid string) (*Peer, error)
	UpsertPeer(p *Peer) error
	DeletePeer(id string) error     // soft delete
	HardDeletePeer(id string) error // permanent delete
	ListPeers(includeDeleted bool) ([]*Peer, error)
	GetPeerCount() (total int, online int, err error)

	// Status tracking
	UpdatePeerStatus(id string, status string, ip string) error
	UpdatePeerSysinfo(id, hostname, os, version string) error
	SetAllOffline() error

	// Peer field updates
	UpdatePeerFields(id string, fields map[string]string) error

	// Ban system
	BanPeer(id string, reason string) error
	UnbanPeer(id string) error
	IsPeerBanned(id string) (bool, error)
	IsPeerSoftDeleted(id string) (bool, error)

	// ID change
	ChangePeerID(oldID, newID string) error
	GetIDChangeHistory(id string) ([]*IDChangeHistory, error)

	// CDAP: linked device queries
	GetLinkedPeers(id string) ([]*Peer, error)

	// Tags
	UpdatePeerTags(id, tags string) error
	ListPeersByTag(tag string) ([]*Peer, error)

	// Config
	GetConfig(key string) (string, error)
	SetConfig(key, value string) error
	DeleteConfig(key string) error

	// Users
	CreateUser(u *User) error
	GetUser(username string) (*User, error)
	GetUserByID(id int64) (*User, error)
	ListUsers() ([]*User, error)
	UpdateUser(u *User) error
	DeleteUser(id int64) error
	UpdateUserLogin(id int64) error
	UserCount() (int, error)

	// API Keys
	CreateAPIKey(k *APIKey) error
	GetAPIKeyByHash(keyHash string) (*APIKey, error)
	ListAPIKeys() ([]*APIKey, error)
	DeleteAPIKey(id int64) error
	TouchAPIKey(id int64) error

	// Device Tokens (Dual Key System)
	CreateDeviceToken(t *DeviceToken) error
	GetDeviceToken(id int64) (*DeviceToken, error)
	GetDeviceTokenByHash(tokenHash string) (*DeviceToken, error)
	GetDeviceTokenByPeerID(peerID string) (*DeviceToken, error)
	ListDeviceTokens(includeRevoked bool) ([]*DeviceToken, error)
	UpdateDeviceToken(t *DeviceToken) error
	RevokeDeviceToken(id int64) error
	BindTokenToPeer(tokenHash, peerID string) error
	IncrementTokenUse(tokenHash string) error
	ValidateToken(tokenHash string) (*DeviceToken, error) // Returns token if valid, nil if invalid/expired/revoked
	CleanupExpiredTokens() (int64, error)

	// Address Book
	GetAddressBook(username, abType string) (string, error) // Returns JSON data string; abType: "legacy" or "personal"
	SaveAddressBook(username, abType, data string) error

	// Peer Metrics (heartbeat CPU/memory/disk)
	SavePeerMetric(peerID string, cpu, memory, disk float64) error
	GetPeerMetrics(peerID string, limit int) ([]*PeerMetric, error)
	GetLatestPeerMetric(peerID string) (*PeerMetric, error)
	CleanupOldMetrics(maxAge time.Duration) (int64, error) // Delete metrics older than maxAge
}
