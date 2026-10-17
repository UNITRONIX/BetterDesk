package db

import (
	"database/sql"
	"fmt"
)

func scanRemoteTarget(row interface{ Scan(...any) error }) (*RemoteTarget, error) {
	target := &RemoteTarget{}
	var lastTestAt, createdAt, updatedAt sql.NullString
	err := row.Scan(
		&target.ID, &target.OrgID, &target.Name, &target.Protocol,
		&target.Platform, &target.Host, &target.Port, &target.Username,
		&target.CredentialMode, &target.CredentialCiphertext,
		&target.CredentialNonce, &target.CredentialKeyID, &target.TLSMode,
		&target.CertFingerprint, &target.Enabled, &lastTestAt,
		&target.LastTestStatus, &target.LastTestError, &target.CreatedBy,
		&createdAt, &updatedAt,
	)
	if err != nil {
		return nil, err
	}
	target.LastTestAt = parseTimePtr(lastTestAt)
	target.CreatedAt = parseTime(createdAt)
	target.UpdatedAt = parseTime(updatedAt)
	return target, nil
}

const remoteTargetColumns = `
	id, org_id, name, protocol, platform, host, port, username,
	credential_mode, credential_ciphertext, credential_nonce, credential_key_id,
	tls_mode, cert_fingerprint, enabled, last_test_at, last_test_status,
	last_test_error, created_by, created_at, updated_at`

func (s *SQLiteDB) CreateRemoteTarget(target *RemoteTarget) error {
	if target == nil {
		return fmt.Errorf("db: nil remote target")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`
		INSERT INTO remote_targets (`+remoteTargetColumns+`)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
		target.ID, target.OrgID, target.Name, target.Protocol, target.Platform,
		target.Host, target.Port, target.Username, target.CredentialMode,
		target.CredentialCiphertext, target.CredentialNonce, target.CredentialKeyID,
		target.TLSMode, target.CertFingerprint, target.Enabled, target.LastTestAt,
		target.LastTestStatus, target.LastTestError, target.CreatedBy,
	)
	return err
}

func (s *SQLiteDB) GetRemoteTarget(id string) (*RemoteTarget, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	target, err := scanRemoteTarget(s.db.QueryRow(
		`SELECT `+remoteTargetColumns+` FROM remote_targets WHERE id = ?`, id,
	))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return target, err
}

func (s *SQLiteDB) ListRemoteTargets(orgID string, includeDisabled bool) ([]*RemoteTarget, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	query := `SELECT ` + remoteTargetColumns + ` FROM remote_targets WHERE org_id = ?`
	args := []any{orgID}
	if !includeDisabled {
		query += ` AND enabled = 1`
	}
	query += ` ORDER BY name, id`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var targets []*RemoteTarget
	for rows.Next() {
		target, err := scanRemoteTarget(rows)
		if err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	return targets, rows.Err()
}

func (s *SQLiteDB) UpdateRemoteTarget(target *RemoteTarget) error {
	if target == nil {
		return fmt.Errorf("db: nil remote target")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`
		UPDATE remote_targets SET
			org_id = ?, name = ?, protocol = ?, platform = ?, host = ?, port = ?,
			username = ?, credential_mode = ?, credential_ciphertext = ?,
			credential_nonce = ?, credential_key_id = ?, tls_mode = ?,
			cert_fingerprint = ?, enabled = ?, last_test_at = ?,
			last_test_status = ?, last_test_error = ?, updated_at = datetime('now')
		WHERE id = ?`,
		target.OrgID, target.Name, target.Protocol, target.Platform, target.Host,
		target.Port, target.Username, target.CredentialMode,
		target.CredentialCiphertext, target.CredentialNonce, target.CredentialKeyID,
		target.TLSMode, target.CertFingerprint, target.Enabled, target.LastTestAt,
		target.LastTestStatus, target.LastTestError, target.ID,
	)
	return err
}

func (s *SQLiteDB) DeleteRemoteTarget(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	result, err := s.db.Exec(`DELETE FROM remote_targets WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return sql.ErrNoRows
	}
	return nil
}
