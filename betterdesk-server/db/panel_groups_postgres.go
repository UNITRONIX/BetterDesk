package db

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

// PostgreSQL implementation of PanelGroupStore (see panel_groups.go).
// Statements mirror the SQLite ones; only placeholders and the
// "no such table" guard differ.

func (pg *PostgresDB) deviceGroupIDPostgres(guid string) (int64, error) {
	var id int64
	err := pg.pool.QueryRow(pg.ctx,
		`SELECT id FROM device_groups WHERE guid = $1`, strings.TrimSpace(guid)).Scan(&id)
	return id, err
}

// ListDeviceGroupPeerIDs returns the peer IDs assigned to a device group.
func (pg *PostgresDB) ListDeviceGroupPeerIDs(groupGUID string) ([]string, error) {
	if !pg.pgHasTable("device_group_members") {
		return nil, nil
	}
	id, err := pg.deviceGroupIDPostgres(groupGUID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := pg.pool.Query(pg.ctx,
		`SELECT peer_id FROM device_group_members WHERE device_group_id = $1 ORDER BY peer_id ASC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var peerID string
		if err := rows.Scan(&peerID); err != nil {
			return nil, err
		}
		if peerID = strings.TrimSpace(peerID); peerID != "" {
			out = append(out, peerID)
		}
	}
	return out, rows.Err()
}

// SetDeviceGroupPeers replaces the group's membership in one transaction.
func (pg *PostgresDB) SetDeviceGroupPeers(groupGUID string, peerIDs []string) error {
	id, err := pg.deviceGroupIDPostgres(groupGUID)
	if err != nil {
		return err
	}
	ctx, cancel := pg.withTimeout()
	defer cancel()
	tx, err := pg.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM device_group_members WHERE device_group_id = $1`, id); err != nil {
		return err
	}
	for _, peerID := range dedupeStrings(peerIDs) {
		if _, err := tx.Exec(ctx,
			`INSERT INTO device_group_members (device_group_id, peer_id) VALUES ($1, $2)`, id, peerID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// GetDeviceGroupACL reads the usernames and user-group GUIDs allowed to see
// the group's devices.
func (pg *PostgresDB) GetDeviceGroupACL(groupGUID string) (*DeviceGroupACL, error) {
	acl := &DeviceGroupACL{AllowedUsers: []string{}, AllowedUserGroups: []string{}}
	id, err := pg.deviceGroupIDPostgres(groupGUID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if pg.pgHasTable("device_group_user_access") {
		rows, err := pg.pool.Query(pg.ctx, `
			SELECT u.username FROM device_group_user_access a
			INNER JOIN users u ON u.id = a.user_id
			WHERE a.device_group_id = $1
			ORDER BY u.username ASC`, id)
		if err != nil {
			return nil, err
		}
		users, err := scanStrings(rows)
		if err != nil {
			return nil, err
		}
		acl.AllowedUsers = users
	}
	if pg.pgHasTable("device_group_user_group_access") {
		rows, err := pg.pool.Query(pg.ctx, `
			SELECT ug.guid FROM device_group_user_group_access a
			INNER JOIN user_groups ug ON ug.id = a.user_group_id
			WHERE a.device_group_id = $1
			ORDER BY ug.name ASC`, id)
		if err != nil {
			return nil, err
		}
		guids, err := scanStrings(rows)
		if err != nil {
			return nil, err
		}
		acl.AllowedUserGroups = guids
	}
	return acl, nil
}

// SetDeviceGroupACL replaces the group's ACL in one transaction.
func (pg *PostgresDB) SetDeviceGroupACL(groupGUID string, acl *DeviceGroupACL) error {
	id, err := pg.deviceGroupIDPostgres(groupGUID)
	if err != nil {
		return err
	}
	ctx, cancel := pg.withTimeout()
	defer cancel()
	tx, err := pg.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM device_group_user_access WHERE device_group_id = $1`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM device_group_user_group_access WHERE device_group_id = $1`, id); err != nil {
		return err
	}
	if acl != nil {
		for _, username := range dedupeStrings(acl.AllowedUsers) {
			if _, err := tx.Exec(ctx, `
				INSERT INTO device_group_user_access (device_group_id, user_id)
				SELECT $1, id FROM users WHERE username = $2
				ON CONFLICT DO NOTHING`, id, username); err != nil {
				return err
			}
		}
		for _, guid := range dedupeStrings(acl.AllowedUserGroups) {
			if _, err := tx.Exec(ctx, `
				INSERT INTO device_group_user_group_access (device_group_id, user_group_id)
				SELECT $1, id FROM user_groups WHERE guid = $2
				ON CONFLICT DO NOTHING`, id, guid); err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}

// ── Folders ───────────────────────────────────────────────────────────

// ListFolders returns every panel folder.
func (pg *PostgresDB) ListPanelFolders() ([]*Folder, error) {
	if !pg.pgHasTable("folders") {
		return nil, nil
	}
	rows, err := pg.pool.Query(pg.ctx, `
		SELECT id, name, COALESCE(color,''), COALESCE(icon,''), COALESCE(sort_order,0), COALESCE(created_at::text,'')
		FROM folders ORDER BY sort_order ASC, name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Folder
	for rows.Next() {
		f := &Folder{}
		if err := rows.Scan(&f.ID, &f.Name, &f.Color, &f.Icon, &f.SortOrder, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// CreateFolder inserts a folder and reports the new id.
func (pg *PostgresDB) CreatePanelFolder(f *Folder) error {
	return pg.pool.QueryRow(pg.ctx,
		`INSERT INTO folders (name, color, icon, sort_order) VALUES ($1, $2, $3, $4) RETURNING id`,
		strings.TrimSpace(f.Name), f.Color, f.Icon, f.SortOrder).Scan(&f.ID)
}

// UpdateFolder changes a folder's name and presentation.
func (pg *PostgresDB) UpdatePanelFolder(id int64, f *Folder) error {
	_, err := pg.pool.Exec(pg.ctx,
		`UPDATE folders SET name = $1, color = $2, icon = $3, sort_order = $4 WHERE id = $5`,
		strings.TrimSpace(f.Name), f.Color, f.Icon, f.SortOrder, id)
	return err
}

// DeleteFolder removes a folder and its assignments.
func (pg *PostgresDB) DeletePanelFolder(id int64) error {
	ctx, cancel := pg.withTimeout()
	defer cancel()
	tx, err := pg.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM device_folder_assignments WHERE folder_id = $1`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM folders WHERE id = $1`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SetDeviceFolder assigns a device to a folder, or clears it when folderID is 0.
func (pg *PostgresDB) SetDevicePanelFolder(peerID string, folderID int64) error {
	peerID = strings.TrimSpace(peerID)
	if peerID == "" {
		return errors.New("device id is required")
	}
	if folderID <= 0 {
		_, err := pg.pool.Exec(pg.ctx,
			`DELETE FROM device_folder_assignments WHERE device_id = $1`, peerID)
		return err
	}
	_, err := pg.pool.Exec(pg.ctx, `
		INSERT INTO device_folder_assignments (device_id, folder_id) VALUES ($1, $2)
		ON CONFLICT (device_id) DO UPDATE SET folder_id = EXCLUDED.folder_id`, peerID, folderID)
	return err
}

// ListDeviceFolderAssignments returns device id → folder id.
func (pg *PostgresDB) ListPanelDeviceFolderAssignments() (map[string]int64, error) {
	out := make(map[string]int64)
	if !pg.pgHasTable("device_folder_assignments") {
		return out, nil
	}
	rows, err := pg.pool.Query(pg.ctx, `SELECT device_id, folder_id FROM device_folder_assignments`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var deviceID string
		var folderID int64
		if err := rows.Scan(&deviceID, &folderID); err != nil {
			return nil, err
		}
		if deviceID = strings.TrimSpace(deviceID); deviceID != "" {
			out[deviceID] = folderID
		}
	}
	return out, rows.Err()
}

// ── Per-user device grants ────────────────────────────────────────────

// ListUserPeerGrants returns the peer IDs granted directly to one user.
func (pg *PostgresDB) ListPanelUserPeerGrants(userID int64) ([]string, error) {
	if userID <= 0 || !pg.pgHasTable("user_peer_grants") {
		return nil, nil
	}
	rows, err := pg.pool.Query(pg.ctx,
		`SELECT peer_id FROM user_peer_grants WHERE user_id = $1 ORDER BY peer_id ASC`, userID)
	if err != nil {
		return nil, err
	}
	return scanStrings(rows)
}

// SetUserPeerGrants replaces one user's direct device grants.
func (pg *PostgresDB) SetUserPeerGrants(userID int64, peerIDs []string) error {
	if userID <= 0 {
		return errors.New("user id is required")
	}
	ctx, cancel := pg.withTimeout()
	defer cancel()
	tx, err := pg.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM user_peer_grants WHERE user_id = $1`, userID); err != nil {
		return err
	}
	for _, peerID := range dedupeStrings(peerIDs) {
		if _, err := tx.Exec(ctx,
			`INSERT INTO user_peer_grants (user_id, peer_id) VALUES ($1, $2)`, userID, peerID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// withTimeout derives a context for a multi-statement write.
func (pg *PostgresDB) withTimeout() (context.Context, context.CancelFunc) {
	if pg.queryTimeout <= 0 {
		return context.WithCancel(pg.ctx)
	}
	return context.WithTimeout(pg.ctx, pg.queryTimeout)
}

// scanStrings drains a single-column text result.
func scanStrings(rows pgx.Rows) ([]string, error) {
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		if value = strings.TrimSpace(value); value != "" {
			out = append(out, value)
		}
	}
	return out, rows.Err()
}
