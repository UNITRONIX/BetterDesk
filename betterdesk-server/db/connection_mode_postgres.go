package db

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (pg *PostgresDB) IssueConnectionMode(issue *ConnectionModeIssue) (*ConnectionModeCommand, bool, error) {
	prepared, err := prepareConnectionModeIssue(issue)
	if err != nil {
		return nil, false, err
	}
	ctx := pg.ctx
	tx, err := pg.pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback(ctx)

	deviceUUID, err := pgLockPeerForConnectionMode(ctx, tx, issue.DeviceID)
	if err != nil {
		return nil, false, err
	}
	policy, err := pgLoadConnectionPolicy(ctx, tx, issue.DeviceID, true)
	if err != nil {
		return nil, false, err
	}
	active, err := pgLoadActiveConnectionCommand(ctx, tx, policy)
	if err != nil {
		return nil, false, err
	}
	if connectionCommandExpired(active, prepared.Now) {
		if err := pgExpireConnectionCommand(ctx, tx, active, policy, prepared.Now); err != nil {
			return nil, false, err
		}
		active = nil
		if policy != nil {
			policy.ActiveCommandID = ""
		}
	}
	applied, err := pgLatestAppliedConnectionCommand(ctx, tx, issue.DeviceID)
	if err != nil {
		return nil, false, err
	}
	plan := planConnectionModeIssue(policy, active, applied, prepared.Mode)
	switch plan.Kind {
	case issueDuplicate, issueUnchanged:
		if err := tx.Commit(ctx); err != nil {
			return nil, false, err
		}
		return plan.Existing, false, nil
	}

	if plan.SupersedeID != "" {
		if err := pgSupersedeConnectionCommand(ctx, tx, plan.SupersedeID, prepared.Now); err != nil {
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
	if _, err := tx.Exec(ctx, `
		INSERT INTO device_connection_mode_commands (
			command_id, device_id, device_uuid, revision, mode, reason,
			operator_id, operator_name, previous_mode, issued_at, expires_at, status
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		command.CommandID, command.DeviceID, command.DeviceUUID, command.Revision,
		command.Mode, command.Reason, command.OperatorID, command.OperatorName,
		command.PreviousMode, command.IssuedAt, command.ExpiresAt, command.Status,
	); err != nil {
		return nil, false, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO device_connection_policies (
			device_id, device_uuid, desired_mode, effective_mode, revision, active_command_id, updated_at
		) VALUES ($1, $2, $3, '', $4, $5, $6)
		ON CONFLICT (device_id) DO UPDATE SET
			device_uuid = EXCLUDED.device_uuid,
			desired_mode = EXCLUDED.desired_mode,
			revision = EXCLUDED.revision,
			active_command_id = EXCLUDED.active_command_id,
			updated_at = EXCLUDED.updated_at`,
		command.DeviceID, command.DeviceUUID, command.Mode, command.Revision, command.CommandID, prepared.Now,
	); err != nil {
		return nil, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	return command, true, nil
}

func (pg *PostgresDB) GetConnectionModePolicy(deviceID string) (*ConnectionModePolicy, error) {
	return pgLoadConnectionPolicy(pg.ctx, pg.pool, deviceID, false)
}

func (pg *PostgresDB) LatestConnectionModeCommand(deviceID string) (*ConnectionModeCommand, error) {
	return pgSelectConnectionCommand(pg.ctx, pg.pool, `
		SELECT `+pgConnectionCommandColumns+`
		FROM device_connection_mode_commands
		WHERE device_id = $1
		ORDER BY revision DESC LIMIT 1`, deviceID)
}

func (pg *PostgresDB) DeliverableConnectionModeCommand(deviceID string, now time.Time) (*ConnectionModeCommand, error) {
	if now.IsZero() {
		now = time.Now()
	}
	now = now.UTC()
	ctx := pg.ctx
	tx, err := pg.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	policy, err := pgLoadConnectionPolicy(ctx, tx, deviceID, true)
	if err != nil {
		return nil, err
	}
	if policy == nil {
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return nil, nil
	}
	active, err := pgLoadActiveConnectionCommand(ctx, tx, policy)
	if err != nil {
		return nil, err
	}
	if active == nil {
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return nil, nil
	}
	if connectionCommandExpired(active, now) {
		if err := pgExpireConnectionCommand(ctx, tx, active, policy, now); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return nil, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return active, nil
}

func (pg *PostgresDB) MarkConnectionModeDelivered(commandID string, now time.Time) error {
	if now.IsZero() {
		now = time.Now()
	}
	now = now.UTC()
	_, err := pg.pool.Exec(pg.ctx, `
		UPDATE device_connection_mode_commands
		SET status = $1,
		    delivered_at = CASE WHEN status = $2 THEN $3 ELSE delivered_at END
		WHERE command_id = $4 AND status IN ($5, $6) AND expires_at > $7`,
		ConnectionCommandDelivered,
		ConnectionCommandQueued, now.Unix(),
		commandID, ConnectionCommandQueued, ConnectionCommandDelivered, now.Unix(),
	)
	return err
}

func (pg *PostgresDB) AcknowledgeConnectionMode(ack *ConnectionModeAck) (bool, error) {
	if ack == nil || strings.TrimSpace(ack.CommandID) == "" {
		return false, nil
	}
	now := ack.Now
	if now.IsZero() {
		now = time.Now()
	}
	now = now.UTC()
	ctx := pg.ctx
	tx, err := pg.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	command, err := pgSelectConnectionCommand(ctx, tx, `
		SELECT `+pgConnectionCommandColumns+`
		FROM device_connection_mode_commands
		WHERE command_id = $1 AND device_id = $2
		FOR UPDATE`, ack.CommandID, ack.DeviceID)
	if err != nil || command == nil {
		return false, err
	}
	if !connectionCommandInFlight(command) || command.Revision != ack.Revision {
		if err := tx.Commit(ctx); err != nil {
			return false, err
		}
		return false, nil
	}
	status := strings.ToLower(strings.TrimSpace(ack.Status))
	rejection := normalizeConnectionRejection(ack.RejectionCode)
	effective := strings.TrimSpace(ack.EffectiveMode)
	switch status {
	case ConnectionCommandApplied:
		if effective != command.Mode {
			status = ConnectionCommandRejected
			rejection = ConnectionRejectionModeMismatch
		}
	case ConnectionCommandRejected, ConnectionCommandExpired:
	default:
		if err := tx.Commit(ctx); err != nil {
			return false, err
		}
		return false, nil
	}
	if _, err := tx.Exec(ctx, `
		UPDATE device_connection_mode_commands
		SET status = $1, rejection_code = $2, acknowledged_at = $3
		WHERE command_id = $4 AND status IN ($5, $6)`,
		status, rejection, now.Unix(), command.CommandID,
		ConnectionCommandQueued, ConnectionCommandDelivered,
	); err != nil {
		return false, err
	}
	if status == ConnectionCommandApplied {
		if _, err := tx.Exec(ctx, `
			UPDATE device_connection_policies
			SET effective_mode = $1,
			    active_command_id = CASE WHEN active_command_id = $2 THEN '' ELSE active_command_id END,
			    updated_at = $3
			WHERE device_id = $4`,
			command.Mode, command.CommandID, now, command.DeviceID,
		); err != nil {
			return false, err
		}
	} else if _, err := tx.Exec(ctx, `
		UPDATE device_connection_policies
		SET active_command_id = CASE WHEN active_command_id = $1 THEN '' ELSE active_command_id END,
		    updated_at = $2
		WHERE device_id = $3`,
		command.CommandID, now, command.DeviceID,
	); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

const pgConnectionCommandColumns = `
	command_id, device_id, device_uuid, revision, mode, reason,
	operator_id, operator_name, previous_mode, issued_at, expires_at,
	status, rejection_code, acknowledged_at, delivered_at`

type pgQueryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func pgLockPeerForConnectionMode(ctx context.Context, tx pgx.Tx, deviceID string) (string, error) {
	var deviceUUID string
	var banned, deleted bool
	err := tx.QueryRow(ctx, `
		SELECT uuid, banned, soft_deleted FROM peers WHERE id = $1 FOR UPDATE`, deviceID).
		Scan(&deviceUUID, &banned, &deleted)
	if err == pgx.ErrNoRows {
		return "", ErrPeerNotFound
	}
	if err != nil {
		return "", err
	}
	if banned || deleted {
		return "", ErrConnectionModeBlocked
	}
	deviceUUID = strings.TrimSpace(deviceUUID)
	if deviceUUID == "" {
		return "", ErrConnectionModeNoUUID
	}
	return deviceUUID, nil
}

func pgLoadConnectionPolicy(ctx context.Context, q pgQueryer, deviceID string, lock bool) (*ConnectionModePolicy, error) {
	query := `
		SELECT device_id, device_uuid, desired_mode, effective_mode, revision,
		       active_command_id, updated_at::text
		FROM device_connection_policies WHERE device_id = $1`
	if lock {
		query += ` FOR UPDATE`
	}
	policy := &ConnectionModePolicy{}
	err := q.QueryRow(ctx, query, deviceID).Scan(
		&policy.DeviceID, &policy.DeviceUUID, &policy.DesiredMode, &policy.EffectiveMode,
		&policy.Revision, &policy.ActiveCommandID, &policy.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return policy, nil
}

func pgLoadActiveConnectionCommand(ctx context.Context, q pgQueryer, policy *ConnectionModePolicy) (*ConnectionModeCommand, error) {
	if policy == nil || policy.ActiveCommandID == "" {
		return nil, nil
	}
	return pgSelectConnectionCommand(ctx, q, `
		SELECT `+pgConnectionCommandColumns+`
		FROM device_connection_mode_commands WHERE command_id = $1`, policy.ActiveCommandID)
}

func pgLatestAppliedConnectionCommand(ctx context.Context, q pgQueryer, deviceID string) (*ConnectionModeCommand, error) {
	return pgSelectConnectionCommand(ctx, q, `
		SELECT `+pgConnectionCommandColumns+`
		FROM device_connection_mode_commands
		WHERE device_id = $1 AND status = $2
		ORDER BY revision DESC LIMIT 1`, deviceID, ConnectionCommandApplied)
}

func pgSelectConnectionCommand(ctx context.Context, q pgQueryer, query string, args ...any) (*ConnectionModeCommand, error) {
	command := &ConnectionModeCommand{}
	var acknowledged, delivered *int64
	err := q.QueryRow(ctx, query, args...).Scan(
		&command.CommandID, &command.DeviceID, &command.DeviceUUID, &command.Revision,
		&command.Mode, &command.Reason, &command.OperatorID, &command.OperatorName,
		&command.PreviousMode, &command.IssuedAt, &command.ExpiresAt, &command.Status,
		&command.RejectionCode, &acknowledged, &delivered,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if acknowledged != nil {
		command.AcknowledgedAt = *acknowledged
	}
	if delivered != nil {
		command.DeliveredAt = *delivered
	}
	return command, nil
}

func pgExpireConnectionCommand(ctx context.Context, tx pgx.Tx, command *ConnectionModeCommand, policy *ConnectionModePolicy, now time.Time) error {
	if _, err := tx.Exec(ctx, `
		UPDATE device_connection_mode_commands
		SET status = $1, acknowledged_at = $2
		WHERE command_id = $3 AND status IN ($4, $5)`,
		ConnectionCommandExpired, now.Unix(), command.CommandID,
		ConnectionCommandQueued, ConnectionCommandDelivered,
	); err != nil {
		return err
	}
	if policy == nil {
		return nil
	}
	_, err := tx.Exec(ctx, `
		UPDATE device_connection_policies
		SET active_command_id = CASE WHEN active_command_id = $1 THEN '' ELSE active_command_id END,
		    updated_at = $2
		WHERE device_id = $3`,
		command.CommandID, now, policy.DeviceID,
	)
	return err
}

func pgSupersedeConnectionCommand(ctx context.Context, tx pgx.Tx, commandID string, now time.Time) error {
	tag, err := tx.Exec(ctx, `
		UPDATE device_connection_mode_commands
		SET status = $1, rejection_code = $2, acknowledged_at = $3
		WHERE command_id = $4 AND status IN ($5, $6)`,
		ConnectionCommandRejected, ConnectionRejectionSuperseded, now.Unix(), commandID,
		ConnectionCommandQueued, ConnectionCommandDelivered,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrConnectionModeInvalid
	}
	return nil
}
