package db

import (
	"time"
)

const (
	// ConnectionSessionDebounce is how long a repeated PunchHole/RequestRelay
	// for the same host+peer reuses an open session instead of inserting another.
	ConnectionSessionDebounce = 2 * time.Minute

	// DefaultConnectionSessionRetentionDays keeps session rows for Metrics history.
	DefaultConnectionSessionRetentionDays = 90
)

// PeerConnectionSession is a server-observed remote-control attempt.
// Started from signal (PunchHole / RequestRelay); ended when the relay UUID
// closes, or left open for pure P2P until cleanup/reuse closes it.
type PeerConnectionSession struct {
	ID              int64      `json:"id"`
	HostID          string     `json:"host_id"`
	PeerID          string     `json:"peer_id"`
	PeerName        string     `json:"peer_name,omitempty"`
	PeerIP          string     `json:"peer_ip,omitempty"`
	Username        string     `json:"username,omitempty"`
	Transport       string     `json:"transport"`
	RelayUUID       string     `json:"relay_uuid,omitempty"`
	StartedAt       time.Time  `json:"started_at"`
	EndedAt         *time.Time `json:"ended_at,omitempty"`
	DurationSeconds *int64     `json:"duration_seconds,omitempty"`
	Source          string     `json:"source"`
	Active          bool       `json:"active"`
}

// FillDerived sets Active and DurationSeconds from StartedAt/EndedAt.
func (s *PeerConnectionSession) FillDerived() {
	if s == nil {
		return
	}
	s.Active = s.EndedAt == nil
	if s.EndedAt != nil && !s.StartedAt.IsZero() {
		sec := int64(s.EndedAt.Sub(s.StartedAt).Seconds())
		if sec < 0 {
			sec = 0
		}
		s.DurationSeconds = &sec
	} else if s.Active && !s.StartedAt.IsZero() {
		sec := int64(time.Since(s.StartedAt).Seconds())
		if sec < 0 {
			sec = 0
		}
		s.DurationSeconds = &sec
	}
}
