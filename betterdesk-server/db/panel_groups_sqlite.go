package db

import (
	"database/sql"
	"strings"
)

// SQLite implementation of PanelGroupStore (see panel_groups.go).
//
// Every statement touches only the panel-owned tables, and every write is
// scoped to one group / folder inside a transaction, so a half-applied ACL can
// never be observed by the RustDesk sync reader in this process.

func (s *SQLiteDB) deviceGroupID(guid string) (int64, error) {
	var id int64
	err := s.db.QueryRow(`SELECT id FROM device_groups WHERE guid = ?`, strings.TrimSpace(guid)).Scan(&id)
	return id, err
}

// ListDeviceGroupPeerIDs returns the peer IDs assigned to a device group.
func (s *SQLiteDB) ListDeviceGroupPeerIDs(groupGUID string) ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, err := s.deviceGroupID(groupGUID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(
		`SELECT peer_id FROM device_group_members WHERE device_group_id = ? ORDER BY peer_id ASC`, id)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			return nil, nil
		}
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
func (s *SQLiteDB) SetDeviceGroupPeers(groupGUID string, peerIDs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, err := s.deviceGroupID(groupGUID)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM device_group_members WHERE device_group_id = ?`, id); err != nil {
		return err
	}
	seen := make(map[string]bool, len(peerIDs))
	for _, raw := range peerIDs {
		peerID := strings.TrimSpace(raw)
		if peerID == "" || seen[peerID] {
			continue
		}
		seen[peerID] = true
		if _, err := tx.Exec(
			`INSERT INTO device_group_members (device_group_id, peer_id) VALUES (?, ?)`, id, peerID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetDeviceGroupACL reads the usernames and user-group GUIDs allowed to see
// the group's devices.
func (s *SQLiteDB) GetDeviceGroupACL(groupGUID string) (*DeviceGroupACL, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	acl := &DeviceGroupACL{AllowedUsers: []string{}, AllowedUserGroups: []string{}}
	id, err := s.deviceGroupID(groupGUID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	users, err := s.aclUsernames(id)
	if err != nil {
		return nil, err
	}
	groups, err := s.aclUserGroupGUIDs(id)
	if err != nil {
		return nil, err
	}
	acl.AllowedUsers = users
	acl.AllowedUserGroups = groups
	return acl, nil
}

func (s *SQLiteDB) aclUsernames(groupID int64) ([]string, error) {
	rows, err := s.db.Query(`
		SELECT u.username FROM device_group_user_access a
		INNER JOIN users u ON u.id = a.user_id
		WHERE a.device_group_id = ?
		ORDER BY u.username ASC`, groupID)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			return []string{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		if name = strings.TrimSpace(name); name != "" {
			out = append(out, name)
		}
	}
	return out, rows.Err()
}

func (s *SQLiteDB) aclUserGroupGUIDs(groupID int64) ([]string, error) {
	rows, err := s.db.Query(`
		SELECT ug.guid FROM device_group_user_group_access a
		INNER JOIN user_groups ug ON ug.id = a.user_group_id
		WHERE a.device_group_id = ?
		ORDER BY ug.name ASC`, groupID)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			return []string{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var guid string
		if err := rows.Scan(&guid); err != nil {
			return nil, err
		}
		if guid = strings.TrimSpace(guid); guid != "" {
			out = append(out, guid)
		}
	}
	return out, rows.Err()
}

// SetDeviceGroupACL replaces the group's ACL in one transaction. Usernames that
// no longer exist are ignored rather than failing the whole write, so a stale
// entry in a form does not block saving the rest.
func (s *SQLiteDB) SetDeviceGroupACL(groupGUID string, acl *DeviceGroupACL) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, err := s.deviceGroupID(groupGUID)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM device_group_user_access WHERE device_group_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM device_group_user_group_access WHERE device_group_id = ?`, id); err != nil {
		return err
	}
	if acl != nil {
		for _, username := range dedupeStrings(acl.AllowedUsers) {
			if _, err := tx.Exec(`
				INSERT OR IGNORE INTO device_group_user_access (device_group_id, user_id)
				SELECT ?, id FROM users WHERE username = ?`, id, username); err != nil {
				return err
			}
		}
		for _, guid := range dedupeStrings(acl.AllowedUserGroups) {
			if _, err := tx.Exec(`
				INSERT OR IGNORE INTO device_group_user_group_access (device_group_id, user_group_id)
				SELECT ?, id FROM user_groups WHERE guid = ?`, id, guid); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

// ── Folders ───────────────────────────────────────────────────────────

// ListFolders returns every panel folder.
func (s *SQLiteDB) ListPanelFolders() ([]*Folder, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rows, err := s.db.Query(
		`SELECT id, name, COALESCE(color,''), COALESCE(icon,''), COALESCE(sort_order,0), COALESCE(created_at,'')
		 FROM folders ORDER BY sort_order ASC, name ASC`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			return nil, nil
		}
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
func (s *SQLiteDB) CreatePanelFolder(f *Folder) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	res, err := s.db.Exec(
		`INSERT INTO folders (name, color, icon, sort_order) VALUES (?, ?, ?, ?)`,
		strings.TrimSpace(f.Name), f.Color, f.Icon, f.SortOrder)
	if err != nil {
		return err
	}
	if id, err := res.LastInsertId(); err == nil {
		f.ID = id
	}
	return nil
}

// UpdateFolder changes a folder's name and presentation.
func (s *SQLiteDB) UpdatePanelFolder(id int64, f *Folder) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(
		`UPDATE folders SET name = ?, color = ?, icon = ?, sort_order = ? WHERE id = ?`,
		strings.TrimSpace(f.Name), f.Color, f.Icon, f.SortOrder, id)
	return err
}

// DeleteFolder removes a folder; assignments go with it (foreign key).
func (s *SQLiteDB) DeletePanelFolder(id int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM device_folder_assignments WHERE folder_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM folders WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// SetDeviceFolder assigns a device to a folder, or clears it when folderID is 0.
func (s *SQLiteDB) SetDevicePanelFolder(peerID string, folderID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	peerID = strings.TrimSpace(peerID)
	if peerID == "" {
		return sql.ErrNoRows
	}
	if folderID <= 0 {
		_, err := s.db.Exec(`DELETE FROM device_folder_assignments WHERE device_id = ?`, peerID)
		return err
	}
	_, err := s.db.Exec(
		`INSERT INTO device_folder_assignments (device_id, folder_id) VALUES (?, ?)
		 ON CONFLICT(device_id) DO UPDATE SET folder_id = excluded.folder_id`, peerID, folderID)
	return err
}

// ListDeviceFolderAssignments returns device id → folder id.
func (s *SQLiteDB) ListPanelDeviceFolderAssignments() (map[string]int64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]int64)
	rows, err := s.db.Query(`SELECT device_id, folder_id FROM device_folder_assignments`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			return out, nil
		}
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
func (s *SQLiteDB) ListPanelUserPeerGrants(userID int64) ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if userID <= 0 {
		return nil, nil
	}
	rows, err := s.db.Query(
		`SELECT peer_id FROM user_peer_grants WHERE user_id = ? ORDER BY peer_id ASC`, userID)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			return nil, nil
		}
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

// SetUserPeerGrants replaces one user's direct device grants.
func (s *SQLiteDB) SetUserPeerGrants(userID int64, peerIDs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if userID <= 0 {
		return sql.ErrNoRows
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM user_peer_grants WHERE user_id = ?`, userID); err != nil {
		return err
	}
	for _, raw := range dedupeStrings(peerIDs) {
		if _, err := tx.Exec(
			`INSERT INTO user_peer_grants (user_id, peer_id) VALUES (?, ?)`, userID, raw); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// dedupeStrings trims, drops empties and removes duplicates while keeping order.
func dedupeStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(values))
	out := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}
