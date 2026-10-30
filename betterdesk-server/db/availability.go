package db

import (
	"strconv"
	"strings"
	"sync"
	"time"
)

// server_config keys for optional peer availability history (#455).
const (
	ConfigAvailabilityHistoryEnabled       = "availability_history_enabled"
	ConfigAvailabilityHistoryRetentionDays = "availability_history_retention_days"
	DefaultAvailabilityHistoryRetention    = 30
)

// PeerAvailabilityEvent is one observed peer status transition.
type PeerAvailabilityEvent struct {
	ID         int64     `json:"id"`
	PeerID     string    `json:"peer_id"`
	FromStatus string    `json:"from_status"`
	ToStatus   string    `json:"to_status"`
	Source     string    `json:"source"`
	CreatedAt  time.Time `json:"created_at"`
}

// availabilityGate caches enable/retention lookups so heartbeat-hot paths
// do not hit server_config on every status touch.
type availabilityGate struct {
	mu            sync.RWMutex
	enabled       bool
	retentionDays int
	loadedAt      time.Time
	ttl           time.Duration
}

func newAvailabilityGate() *availabilityGate {
	return &availabilityGate{
		retentionDays: DefaultAvailabilityHistoryRetention,
		ttl:           5 * time.Second,
	}
}

func (g *availabilityGate) invalidate() {
	g.mu.Lock()
	g.loadedAt = time.Time{}
	g.mu.Unlock()
}

func (g *availabilityGate) refresh(getConfig func(key string) (string, error)) (enabled bool, retentionDays int) {
	g.mu.RLock()
	if !g.loadedAt.IsZero() && time.Since(g.loadedAt) < g.ttl {
		enabled, retentionDays = g.enabled, g.retentionDays
		g.mu.RUnlock()
		return enabled, retentionDays
	}
	g.mu.RUnlock()

	enabled = false
	retentionDays = DefaultAvailabilityHistoryRetention
	if v, err := getConfig(ConfigAvailabilityHistoryEnabled); err == nil {
		enabled = parseTruthyConfig(v)
	}
	if v, err := getConfig(ConfigAvailabilityHistoryRetentionDays); err == nil && strings.TrimSpace(v) != "" {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && n > 0 {
			if n > 3650 {
				n = 3650
			}
			retentionDays = n
		}
	}

	g.mu.Lock()
	g.enabled = enabled
	g.retentionDays = retentionDays
	g.loadedAt = time.Now()
	g.mu.Unlock()
	return enabled, retentionDays
}

func parseTruthyConfig(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "y", "yes", "on":
		return true
	default:
		return false
	}
}

// LocalDayBounds converts a browser-local calendar day (YYYY-MM-DD) and
// JavaScript Date.getTimezoneOffset() (minutes west of UTC) into a half-open
// UTC interval [from, to).
func LocalDayBounds(day string, tzOffsetMinutes int) (from, to time.Time, err error) {
	t, err := time.ParseInLocation("2006-01-02", day, time.UTC)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	from = t.Add(time.Duration(tzOffsetMinutes) * time.Minute)
	to = from.Add(24 * time.Hour)
	return from, to, nil
}
