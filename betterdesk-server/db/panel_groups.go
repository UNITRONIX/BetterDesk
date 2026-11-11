package db

// Panel-owned device grouping: members, ACL and folders.
//
// The Node console used to write these tables and Go only read them
// (db/panel_sync.go, db/console_auth.go). Go now owns the writes as well
// (docs/important/console-backend-strangler.md, stage P2), so the reading and
// writing paths share one implementation and one set of SQL statements.
//
// A group is identified by its GUID on the wire and by its numeric id in the
// tables; helpers below resolve one to the other so handlers never have to.
//
// The method names carry a "Panel" prefix where the read-only PanelSyncStore
// already used the shorter name with a different return type — the two
// interfaces coexist on purpose while the RustDesk sync path is unchanged.

// Folder is a panel folder chip (the device list's left rail).
type Folder struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	Icon      string `json:"icon"`
	SortOrder int    `json:"sort_order"`
	CreatedAt string `json:"created_at"`
}

// DeviceGroupACL is who may see the devices of a group. An empty ACL means
// "everyone who may view devices", matching the console's behaviour.
type DeviceGroupACL struct {
	AllowedUsers      []string `json:"allowed_users"`       // usernames
	AllowedUserGroups []string `json:"allowed_user_groups"` // user group GUIDs
}

// PanelGroupStore is the write side of panel device grouping. Implemented by
// both database engines; kept separate from Database so the interface stays
// readable.
type PanelGroupStore interface {
	// Membership: peer IDs in a device group.
	ListDeviceGroupPeerIDs(groupGUID string) ([]string, error)
	SetDeviceGroupPeers(groupGUID string, peerIDs []string) error

	// ACL: usernames and user-group GUIDs allowed to see the group's devices.
	GetDeviceGroupACL(groupGUID string) (*DeviceGroupACL, error)
	SetDeviceGroupACL(groupGUID string, acl *DeviceGroupACL) error

	// Folders.
	ListPanelFolders() ([]*Folder, error)
	CreatePanelFolder(f *Folder) error
	UpdatePanelFolder(id int64, f *Folder) error
	DeletePanelFolder(id int64) error
	SetDevicePanelFolder(peerID string, folderID int64) error // folderID 0 unassigns
	ListPanelDeviceFolderAssignments() (map[string]int64, error)

	// Per-user device grants (the console's "allow this person this device").
	ListPanelUserPeerGrants(userID int64) ([]string, error)
	SetUserPeerGrants(userID int64, peerIDs []string) error
}

// Compile-time checks: both engines must satisfy the store.
var (
	_ PanelGroupStore = (*SQLiteDB)(nil)
	_ PanelGroupStore = (*PostgresDB)(nil)
)
