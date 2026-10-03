package db

import (
	"fmt"

	"github.com/jackc/pgx/v5"
)

const remoteTargetColumnsPG = `
	id, org_id, name, protocol, platform, host, port, username,
	credential_mode, credential_ciphertext, credential_nonce, credential_key_id,
	tls_mode, cert_fingerprint, enabled, last_test_at, last_test_status,
	last_test_error, created_by, created_at, updated_at`

func scanRemoteTargetPG(row interface{ Scan(...any) error }) (*RemoteTarget, error) {
	target := &RemoteTarget{}
	err := row.Scan(
		&target.ID, &target.OrgID, &target.Name, &target.Protocol,
		&target.Platform, &target.Host, &target.Port, &target.Username,
		&target.CredentialMode, &target.CredentialCiphertext,
		&target.CredentialNonce, &target.CredentialKeyID, &target.TLSMode,
		&target.CertFingerprint, &target.Enabled, &target.LastTestAt,
		&target.LastTestStatus, &target.LastTestError, &target.CreatedBy,
		&target.CreatedAt, &target.UpdatedAt,
	)
	return target, err
}

func (pg *PostgresDB) CreateRemoteTarget(target *RemoteTarget) error {
	if target == nil {
		return fmt.Errorf("db: nil remote target")
	}
	_, err := pg.pool.Exec(pg.ctx, `
		INSERT INTO remote_targets (`+remoteTargetColumnsPG+`)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
		        $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())`,
		target.ID, target.OrgID, target.Name, target.Protocol, target.Platform,
		target.Host, target.Port, target.Username, target.CredentialMode,
		target.CredentialCiphertext, target.CredentialNonce, target.CredentialKeyID,
		target.TLSMode, target.CertFingerprint, target.Enabled, target.LastTestAt,
		target.LastTestStatus, target.LastTestError, target.CreatedBy,
	)
	return err
}

func (pg *PostgresDB) GetRemoteTarget(id string) (*RemoteTarget, error) {
	target, err := scanRemoteTargetPG(pg.pool.QueryRow(pg.ctx,
		`SELECT `+remoteTargetColumnsPG+` FROM remote_targets WHERE id = $1`, id,
	))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return target, err
}

func (pg *PostgresDB) ListRemoteTargets(orgID string, includeDisabled bool) ([]*RemoteTarget, error) {
	query := `SELECT ` + remoteTargetColumnsPG + ` FROM remote_targets WHERE org_id = $1`
	if !includeDisabled {
		query += ` AND enabled = TRUE`
	}
	query += ` ORDER BY name, id`
	rows, err := pg.pool.Query(pg.ctx, query, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var targets []*RemoteTarget
	for rows.Next() {
		target, err := scanRemoteTargetPG(rows)
		if err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	return targets, rows.Err()
}

func (pg *PostgresDB) UpdateRemoteTarget(target *RemoteTarget) error {
	if target == nil {
		return fmt.Errorf("db: nil remote target")
	}
	_, err := pg.pool.Exec(pg.ctx, `
		UPDATE remote_targets SET
			org_id = $1, name = $2, protocol = $3, platform = $4, host = $5, port = $6,
			username = $7, credential_mode = $8, credential_ciphertext = $9,
			credential_nonce = $10, credential_key_id = $11, tls_mode = $12,
			cert_fingerprint = $13, enabled = $14, last_test_at = $15,
			last_test_status = $16, last_test_error = $17, updated_at = NOW()
		WHERE id = $18`,
		target.OrgID, target.Name, target.Protocol, target.Platform, target.Host,
		target.Port, target.Username, target.CredentialMode,
		target.CredentialCiphertext, target.CredentialNonce, target.CredentialKeyID,
		target.TLSMode, target.CertFingerprint, target.Enabled, target.LastTestAt,
		target.LastTestStatus, target.LastTestError, target.ID,
	)
	return err
}

func (pg *PostgresDB) DeleteRemoteTarget(id string) error {
	result, err := pg.pool.Exec(pg.ctx, `DELETE FROM remote_targets WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
