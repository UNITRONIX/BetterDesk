package db

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/google/uuid"
)

func (s *SQLiteDB) IssueConnectionMode(issue *ConnectionModeIssue) (*ConnectionModeCommand, bool, error) {
	prepared, err := prepareConnectionModeIssue(issue)
	if err != nil {
		return nil, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.BeginTx(context.Background(), &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()

	deviceUUID, err := sqliteLockPeerForConnectionMode(tx, issue.DeviceID)
	if err != nil {
		return nil, false, err
	}
	policy, err := sqliteLoadConnectionPolicy(tx, issue.DeviceID)
	if err != nil {
		return nil, false, err
	}
	active, err := sqliteLoadActiveConnectionCommand(tx, policy)
	if err != nil {
		return nil, false, err
	}
	if connectionCommandExpired(active, prepared.Now) {
		if err := sqliteExpireConnectionCommand(tx, active, policy, prepared.Now); err != nil {
			return nil, false, err
		}
		active = nil
		if policy != nil {
			policy.ActiveCommandID = ""
		}
	}
	applied, err := sqliteLatestAppliedConnectionCommand(tx, issue.DeviceID)
	if err != nil {
		return nil, false, err
	}
	plan := planConnectionModeIssue(policy, active, applied, prepared.Mode)
	switch plan.Kind {
	case issueDuplicate, issueUnchanged:
		if err := tx.Commit(); err != nil {
			return nil, false, err
		}
		return plan.Existing, false, nil
	}

	if plan.SupersedeID != "" {
		if err := sqliteSupersedeConnectionCommand(tx, plan.SupersedeID, prepared.Now); err != nil {
			return nil, false, err
		}
	}
	command := &ConnectionModeCommand{
		CommandID:    uuid.NewString(),
		DeviceID:     issue.DeviceID,
		DeviceUUID:   deviceUUID,
		Revision:     plan.Revision,
		Mode:         prepared.Mode,
		Reason:       prepared.Reason,
		OperatorID:   prepared.OperatorID,
		OperatorName: prepared.OperatorName,
		PreviousMode: plan.PreviousMode,
		IssuedAt:     prepared.Now.Unix(),
		ExpiresAt:    prepared.ExpiresAt,
		Status:       ConnectionCommandQueued,
	}
	if _, err := tx.Exec(`
		INSERT INTO device_connection_mode_commands (
			command_id, device_id, device_uuid, revision, mode, reason,
			operator_id, operator_name, previous_mode, issued_at, expires_at, status
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		command.CommandID, command.DeviceID, command.DeviceUUID, command.Revision,
		command.Mode, command.Reason, command.OperatorID, command.OperatorName,
		command.PreviousMode, command.IssuedAt, command.ExpiresAt, command.Status,
	); err != nil {
		return nil, false, err
	}
	updatedAt := prepared.Now.Format("2006-01-02 15:04:05")
	if _, err := tx.Exec(`
		INSERT INTO device_connection_policies (
			device_id, device_uuid, desired_mode, effective_mode, revision, active_command_id, updated_at
		) VALUES (?, ?, ?, '', ?, ?, ?)
		ON CONFLICT(device_id) DO UPDATE SET
			device_uuid = excluded.device_uuid,
			desired_mode = excluded.desired_mode,
			revision = excluded.revision,
			active_command_id = excluded.active_command_id,
			updated_at = excluded.updated_at`,
		command.DeviceID, command.DeviceUUID, command.Mode, command.Revision, command.CommandID, updatedAt,
	); err != nil {
		return nil, false, err
	}
	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	return command, true, nil
}

func (s *SQLiteDB) GetConnectionModePolicy(deviceID string) (*ConnectionModePolicy, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return sqliteLoadConnectionPolicy(s.db, deviceID)
}

func (s *SQLiteDB) LatestConnectionModeCommand(deviceID string) (*ConnectionModeCommand, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return sqliteSelectConnectionCommand(s.db, `
		SELECT `+sqliteConnectionCommandColumns+`
		FROM device_connection_mode_commands
		WHERE device_id = ?
		ORDER BY revision DESC LIMIT 1`, deviceID)
}

func (s *SQLiteDB) DeliverableConnectionModeCommand(deviceID string, now time.Time) (*ConnectionModeCommand, error) {
	if now.IsZero() {
		now = time.Now()
	}
	now = now.UTC()
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.BeginTx(context.Background(), &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	policy, err := sqliteLoadConnectionPolicy(tx, deviceID)
	if err != nil || policy == nil {
		if err != nil {
			return nil, err
		}
		return nil, tx.Commit()
	}
	active, err := sqliteLoadActiveConnectionCommand(tx, policy)
	if err != nil {
		return nil, err
	}
	if active == nil {
		return nil, tx.Commit()
	}
	if connectionCommandExpired(active, now) {
		if err := sqliteExpireConnectionCommand(tx, active, policy, now); err != nil {
			return nil, err
		}
		return nil, tx.Commit()
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return active, nil
}

func (s *SQLiteDB) MarkConnectionModeDelivered(commandID string, now time.Time) error {
	if now.IsZero() {
		now = time.Now()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`
		UPDATE device_connection_mode_commands
		SET status = ?,
		    delivered_at = CASE WHEN status = ? THEN ? ELSE delivered_at END
		WHERE command_id = ? AND status IN (?, ?) AND expires_at > ?`,
		ConnectionCommandDelivered,
		ConnectionCommandQueued, now.UTC().Unix(),
		commandID, ConnectionCommandQueued, ConnectionCommandDelivered, now.UTC().Unix(),
	)
	return err
}

func (s *SQLiteDB) AcknowledgeConnectionMode(ack *ConnectionModeAck) (bool, error) {
	if ack == nil || strings.TrimSpace(ack.CommandID) == "" {
		return false, nil
	}
	now := ack.Now
	if now.IsZero() {
		now = time.Now()
	}
	now = now.UTC()
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.BeginTx(context.Background(), &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	command, err := sqliteSelectConnectionCommand(tx, `
		SELECT `+sqliteConnectionCommandColumns+`
		FROM device_connection_mode_commands
		WHERE command_id = ? AND device_id = ?`, ack.CommandID, ack.DeviceID)
	if err != nil || command == nil {
		return false, err
	}
	if !connectionCommandInFlight(command) || command.Revision != ack.Revision {
		return false, tx.Commit()
	}
	status := strings.ToLower(strings.TrimSpace(ack.Status))
	rejection := normalizeConnectionRejection(ack.RejectionCode)
	effective := strings.TrimSpace(ack.EffectiveMode)
	switch status {
	case ConnectionCommandApplied:
		if effective != command.Mode {
			status = ConnectionCommandRejected
			rejection = ConnectionRejectionModeMismatch
			effective = ""
		}
	case ConnectionCommandRejected, ConnectionCommandExpired:
	default:
		return false, tx.Commit()
	}
	if _, err := tx.Exec(`
		UPDATE device_connection_mode_commands
		SET status = ?, rejection_code = ?, acknowledged_at = ?
		WHERE command_id = ? AND status IN (?, ?)`,
		status, rejection, now.Unix(), command.CommandID,
		ConnectionCommandQueued, ConnectionCommandDelivered,
	); err != nil {
		return false, err
	}
	if status == ConnectionCommandApplied {
		if _, err := tx.Exec(`
			UPDATE device_connection_policies
			SET effective_mode = ?,
			    active_command_id = CASE WHEN active_command_id = ? THEN '' ELSE active_command_id END,
			    updated_at = ?
			WHERE device_id = ?`,
			command.Mode, command.CommandID, now.Format("2006-01-02 15:04:05"), command.DeviceID,
		); err != nil {
			return false, err
		}
	} else if _, err := tx.Exec(`
		UPDATE device_connection_policies
		SET active_command_id = CASE WHEN active_command_id = ? THEN '' ELSE active_command_id END,
		    updated_at = ?
		WHERE device_id = ?`,
		command.CommandID, now.Format("2006-01-02 15:04:05"), command.DeviceID,
	); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

const sqliteConnectionCommandColumns = `
	command_id, device_id, device_uuid, revision, mode, reason,
	operator_id, operator_name, previous_mode, issued_at, expires_at,
	status, rejection_code, acknowledged_at, delivered_at`

type sqliteQueryer interface {
	QueryRow(query string, args ...any) *sql.Row
}

func sqliteLockPeerForConnectionMode(tx *sql.Tx, deviceID string) (string, error) {
	var deviceUUID string
	var banned, deleted int
	err := tx.QueryRow(`SELECT uuid, banned, soft_deleted FROM peers WHERE id = ?`, deviceID).
		Scan(&deviceUUID, &banned, &deleted)
	if err == sql.ErrNoRows {
		return "", ErrPeerNotFound
	}
	if err != nil {
		return "", err
	}
	if banned != 0 || deleted != 0 {
		return "", ErrConnectionModeBlocked
	}
	deviceUUID = strings.TrimSpace(deviceUUID)
	if deviceUUID == "" {
		return "", ErrConnectionModeNoUUID
	}
	return deviceUUID, nil
}

func sqliteLoadConnectionPolicy(q sqliteQueryer, deviceID string) (*ConnectionModePolicy, error) {
	policy := &ConnectionModePolicy{}
	err := q.QueryRow(`
		SELECT device_id, device_uuid, desired_mode, effective_mode, revision, active_command_id, updated_at
		FROM device_connection_policies WHERE device_id = ?`, deviceID).Scan(
		&policy.DeviceID, &policy.DeviceUUID, &policy.DesiredMode, &policy.EffectiveMode,
		&policy.Revision, &policy.ActiveCommandID, &policy.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return policy, nil
}

func sqliteLoadActiveConnectionCommand(q sqliteQueryer, policy *ConnectionModePolicy) (*ConnectionModeCommand, error) {
	if policy == nil || policy.ActiveCommandID == "" {
		return nil, nil
	}
	return sqliteSelectConnectionCommand(q, `
		SELECT `+sqliteConnectionCommandColumns+`
		FROM device_connection_mode_commands WHERE command_id = ?`, policy.ActiveCommandID)
}

func sqliteLatestAppliedConnectionCommand(q sqliteQueryer, deviceID string) (*ConnectionModeCommand, error) {
	return sqliteSelectConnectionCommand(q, `
		SELECT `+sqliteConnectionCommandColumns+`
		FROM device_connection_mode_commands
		WHERE device_id = ? AND status = ?
		ORDER BY revision DESC LIMIT 1`, deviceID, ConnectionCommandApplied)
}

func sqliteSelectConnectionCommand(q sqliteQueryer, query string, args ...any) (*ConnectionModeCommand, error) {
	command := &ConnectionModeCommand{}
	var acknowledged, delivered sql.NullInt64
	err := q.QueryRow(query, args...).Scan(
		&command.CommandID, &command.DeviceID, &command.DeviceUUID, &command.Revision,
		&command.Mode, &command.Reason, &command.OperatorID, &command.OperatorName,
		&command.PreviousMode, &command.IssuedAt, &command.ExpiresAt, &command.Status,
		&command.RejectionCode, &acknowledged, &delivered,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if acknowledged.Valid {
		command.AcknowledgedAt = acknowledged.Int64
	}
	if delivered.Valid {
		command.DeliveredAt = delivered.Int64
	}
	return command, nil
}

func sqliteExpireConnectionCommand(tx *sql.Tx, command *ConnectionModeCommand, policy *ConnectionModePolicy, now time.Time) error {
	if _, err := tx.Exec(`
		UPDATE device_connection_mode_commands
		SET status = ?, acknowledged_at = ?
		WHERE command_id = ? AND status IN (?, ?)`,
		ConnectionCommandExpired, now.Unix(), command.CommandID,
		ConnectionCommandQueued, ConnectionCommandDelivered,
	); err != nil {
		return err
	}
	if policy == nil {
		return nil
	}
	_, err := tx.Exec(`
		UPDATE device_connection_policies
		SET active_command_id = CASE WHEN active_command_id = ? THEN '' ELSE active_command_id END,
		    updated_at = ?
		WHERE device_id = ?`,
		command.CommandID, now.Format("2006-01-02 15:04:05"), policy.DeviceID,
	)
	return err
}

func sqliteSupersedeConnectionCommand(tx *sql.Tx, commandID string, now time.Time) error {
	result, err := tx.Exec(`
		UPDATE device_connection_mode_commands
		SET status = ?, rejection_code = ?, acknowledged_at = ?
		WHERE command_id = ? AND status IN (?, ?)`,
		ConnectionCommandRejected, ConnectionRejectionSuperseded, now.Unix(), commandID,
		ConnectionCommandQueued, ConnectionCommandDelivered,
	)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return ErrConnectionModeInvalid
	}
	return nil
}
