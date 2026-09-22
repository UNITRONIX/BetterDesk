package db

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	ConnectionModeNormal       = "normal"
	ConnectionModeIncomingOnly = "incoming-only"
	ConnectionModeTTLSeconds   = 600

	ConnectionCommandQueued    = "queued"
	ConnectionCommandDelivered = "delivered"
	ConnectionCommandApplied   = "applied"
	ConnectionCommandRejected  = "rejected"
	ConnectionCommandExpired   = "expired"

	ConnectionRejectionSuperseded   = "superseded"
	ConnectionRejectionModeMismatch = "mode_mismatch"

	// VerifiedIdentityKind is the telemetry snapshot written only from a
	// signed BetterDesk envelope. Plaintext heartbeats must not overwrite it.
	VerifiedIdentityKind = "identity_verified"

	connectionModeReasonMax   = 500
	connectionModeOperatorMax = 128
	connectionModeCodeMax     = 120
)

var (
	ErrConnectionModeInvalid = errors.New("db: invalid connection mode")
	ErrConnectionModeReason  = errors.New("db: connection mode reason required")
	ErrConnectionModeNoUUID  = errors.New("db: device uuid required")
	ErrConnectionModeBlocked = errors.New("db: device is banned or deleted")
)

// ConnectionModePolicy is the server's memory of the mode requested for one device.
type ConnectionModePolicy struct {
	DeviceID        string `json:"device_id"`
	DeviceUUID      string `json:"device_uuid"`
	DesiredMode     string `json:"desired_mode"`
	EffectiveMode   string `json:"effective_mode"`
	Revision        int64  `json:"revision"`
	ActiveCommandID string `json:"active_command_id,omitempty"`
	UpdatedAt       string `json:"updated_at,omitempty"`
}

// ConnectionModeCommand is one idempotent mode change addressed to a device.
type ConnectionModeCommand struct {
	CommandID      string `json:"command_id"`
	DeviceID       string `json:"device_id"`
	DeviceUUID     string `json:"device_uuid"`
	Revision       int64  `json:"revision"`
	Mode           string `json:"mode"`
	Reason         string `json:"reason"`
	OperatorID     string `json:"operator_id"`
	OperatorName   string `json:"operator_name,omitempty"`
	PreviousMode   string `json:"previous_mode"`
	IssuedAt       int64  `json:"issued_at"`
	ExpiresAt      int64  `json:"expires_at"`
	Status         string `json:"status"`
	RejectionCode  string `json:"rejection_code,omitempty"`
	AcknowledgedAt int64  `json:"acknowledged_at,omitempty"`
	DeliveredAt    int64  `json:"delivered_at,omitempty"`
}

// ConnectionModeIssue is an operator request to change one device's mode.
type ConnectionModeIssue struct {
	DeviceID     string
	Mode         string
	Reason       string
	OperatorID   string
	OperatorName string
	Now          time.Time
}

// ConnectionModeAck is a signed client report for one command.
type ConnectionModeAck struct {
	DeviceID      string
	CommandID     string
	Revision      int64
	Status        string
	EffectiveMode string
	RejectionCode string
	Now           time.Time
}

type preparedConnectionModeIssue struct {
	Mode         string
	Reason       string
	OperatorID   string
	OperatorName string
	Now          time.Time
	ExpiresAt    int64
}

func prepareConnectionModeIssue(issue *ConnectionModeIssue) (preparedConnectionModeIssue, error) {
	if issue == nil {
		return preparedConnectionModeIssue{}, ErrConnectionModeInvalid
	}
	mode, err := NormalizeConnectionMode(issue.Mode)
	if err != nil {
		return preparedConnectionModeIssue{}, err
	}
	reason, err := normalizeConnectionModeReason(issue.Reason)
	if err != nil {
		return preparedConnectionModeIssue{}, err
	}
	now := issue.Now
	if now.IsZero() {
		now = time.Now()
	}
	now = now.UTC()
	return preparedConnectionModeIssue{
		Mode:         mode,
		Reason:       reason,
		OperatorID:   truncateRunes(strings.TrimSpace(issue.OperatorID), connectionModeOperatorMax),
		OperatorName: truncateRunes(strings.TrimSpace(issue.OperatorName), connectionModeOperatorMax),
		Now:          now,
		ExpiresAt:    now.Unix() + ConnectionModeTTLSeconds,
	}, nil
}

// NormalizeConnectionMode accepts only the two reversible desktop modes.
func NormalizeConnectionMode(mode string) (string, error) {
	switch strings.TrimSpace(mode) {
	case ConnectionModeNormal, ConnectionModeIncomingOnly:
		return strings.TrimSpace(mode), nil
	default:
		return "", ErrConnectionModeInvalid
	}
}

func normalizeConnectionModeReason(reason string) (string, error) {
	cleaned := strings.TrimSpace(stripControlChars(reason))
	if cleaned == "" {
		return "", ErrConnectionModeReason
	}
	return truncateRunes(cleaned, connectionModeReasonMax), nil
}

func normalizeConnectionRejection(code string) string {
	return truncateRunes(strings.TrimSpace(stripControlChars(code)), connectionModeCodeMax)
}

func stripControlChars(value string) string {
	return strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, value)
}

func truncateRunes(value string, max int) string {
	if max <= 0 || utf8.RuneCountInString(value) <= max {
		return value
	}
	runes := []rune(value)
	return string(runes[:max])
}

func connectionCommandInFlight(cmd *ConnectionModeCommand) bool {
	if cmd == nil {
		return false
	}
	return cmd.Status == ConnectionCommandQueued || cmd.Status == ConnectionCommandDelivered
}

func connectionCommandExpired(cmd *ConnectionModeCommand, now time.Time) bool {
	return connectionCommandInFlight(cmd) && cmd.ExpiresAt <= now.Unix()
}

const (
	issueDuplicate = "duplicate"
	issueUnchanged = "unchanged"
	issueCreate    = "create"
)

type issuePlan struct {
	Kind         string
	Existing     *ConnectionModeCommand
	Revision     int64
	PreviousMode string
	SupersedeID  string
}

func planConnectionModeIssue(policy *ConnectionModePolicy, active, applied *ConnectionModeCommand, mode string) issuePlan {
	previous := ConnectionModeNormal
	revisionBase := int64(0)
	if policy != nil {
		revisionBase = policy.Revision
		if policy.EffectiveMode != "" {
			previous = policy.EffectiveMode
		} else if policy.DesiredMode != "" {
			previous = policy.DesiredMode
		}
	}
	if connectionCommandInFlight(active) {
		if active.Mode == mode {
			return issuePlan{Kind: issueDuplicate, Existing: active}
		}
		return issuePlan{
			Kind:         issueCreate,
			Revision:     revisionBase + 1,
			PreviousMode: previous,
			SupersedeID:  active.CommandID,
		}
	}
	if policy != nil && policy.DesiredMode == mode && policy.EffectiveMode == mode {
		return issuePlan{Kind: issueUnchanged, Existing: applied}
	}
	return issuePlan{
		Kind:         issueCreate,
		Revision:     revisionBase + 1,
		PreviousMode: previous,
	}
}
