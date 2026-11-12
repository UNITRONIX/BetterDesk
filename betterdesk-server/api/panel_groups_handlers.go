package api

// Panel grouping endpoints: device groups, their membership and ACL, folders,
// and per-user device grants.
//
// These are the write side of what the RustDesk client reads through
// /api/device-group/accessible and /api/peers/list. Until stage P2 of
// docs/important/console-backend-strangler.md the Node console owned the
// writes; Go now owns both, so the panel and the client can never disagree
// about who sees which device.
//
// Routes (mounted with requirePanelAdmin / requirePermission wrappers):
//
//	GET    /api/panel/device-groups                    list groups with ACL + count
//	POST   /api/panel/device-groups                    create or update a group
//	DELETE /api/panel/device-groups/{guid}             delete a group
//	GET    /api/panel/device-groups/{guid}/peers       membership
//	PUT    /api/panel/device-groups/{guid}/peers       replace membership
//	GET    /api/panel/device-groups/{guid}/acl         ACL
//	PUT    /api/panel/device-groups/{guid}/acl         replace ACL
//	GET    /api/panel/folders                          list folders
//	POST   /api/panel/folders                          create a folder
//	PUT    /api/panel/folders/{id}                     update a folder
//	DELETE /api/panel/folders/{id}                     delete a folder
//	PUT    /api/panel/devices/{id}/folder              assign / clear a folder
//	GET    /api/panel/users/{id}/grants                direct device grants
//	PUT    /api/panel/users/{id}/grants                replace direct grants

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/unitronix/betterdesk-server/auth"
	"github.com/unitronix/betterdesk-server/db"
)

// panelGroupStore returns the write store for the active database.
func (s *Server) panelGroupStore() (db.PanelGroupStore, error) {
	store, ok := s.db.(db.PanelGroupStore)
	if !ok {
		return nil, fmt.Errorf("the selected database does not support panel grouping")
	}
	return store, nil
}

// requirePanelGroupStore answers 503 (not 500) when the database cannot store
// panel grouping, so the console can fall back to its own writer during a
// staged rollout instead of showing a crash.
func (s *Server) requirePanelGroupStore(w http.ResponseWriter) (db.PanelGroupStore, bool) {
	store, err := s.panelGroupStore()
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return nil, false
	}
	return store, true
}

// panelGroupView is the JSON shape the console renders.
type panelGroupView struct {
	GUID           string   `json:"guid"`
	Name           string   `json:"name"`
	Note           string   `json:"note"`
	TeamID         string   `json:"team_id"`
	SourceType     string   `json:"source_type"`
	TagFilter      string   `json:"tag_filter"`
	MemberCount    int      `json:"member_count"`
	AllowedUsers   []string `json:"allowed_users"`
	AllowedGroups  []string `json:"allowed_groups"`
}

func (s *Server) handlePanelDeviceGroupsList(w http.ResponseWriter, r *http.Request) {
	store, ok := s.requirePanelGroupStore(w)
	if !ok {
		return
	}
	groups, err := s.db.ListDeviceGroups()
	if err != nil {
		writeInternalError(w, err, "ListDeviceGroups")
		return
	}
	out := make([]panelGroupView, 0, len(groups))
	for _, g := range groups {
		view := panelGroupView{
			GUID:          g.GUID,
			Name:          g.Name,
			Note:          g.Note,
			TeamID:        g.TeamID,
			SourceType:    g.SourceType,
			TagFilter:     g.TagFilter,
			AllowedUsers:  []string{},
			AllowedGroups: []string{},
		}
		if peers, err := store.ListDeviceGroupPeerIDs(g.GUID); err == nil {
			view.MemberCount = len(peers)
		}
		if acl, err := store.GetDeviceGroupACL(g.GUID); err == nil && acl != nil {
			view.AllowedUsers = acl.AllowedUsers
			view.AllowedGroups = acl.AllowedUserGroups
		}
		out = append(out, view)
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": out, "total": len(out)})
}

type panelGroupBody struct {
	GUID          string   `json:"guid"`
	Name          string   `json:"name"`
	Note          string   `json:"note"`
	TeamID        string   `json:"team_id"`
	SourceType    string   `json:"source_type"`
	TagFilter     string   `json:"tag_filter"`
	AllowedUsers  []string `json:"allowed_users"`
	AllowedGroups []string `json:"allowed_groups"`
	// The console's form also accepts a single comma-separated string.
	AllowedUsersRaw  string `json:"allowed_users_csv"`
	AllowedGroupsRaw string `json:"allowed_groups_csv"`
}

// handlePanelDeviceGroupsSave creates or updates a group and its ACL.
func (s *Server) handlePanelDeviceGroupsSave(w http.ResponseWriter, r *http.Request) {
	store, ok := s.requirePanelGroupStore(w)
	if !ok {
		return
	}
	var body panelGroupBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	body.GUID = strings.TrimSpace(body.GUID)
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}
	if len(body.Name) > 80 {
		body.Name = body.Name[:80]
	}
	sourceType := "manual"
	if body.SourceType == "tag" {
		sourceType = "tag"
	}
	tagFilter := ""
	if sourceType == "tag" {
		tagFilter = truncStr(strings.TrimSpace(body.TagFilter), 50)
	}
	note := truncStr(body.Note, 512)
	teamID := truncStr(strings.TrimSpace(body.TeamID), 64)

	var created bool
	if body.GUID == "" {
		g := &db.DeviceGroup{
			Name:       body.Name,
			Note:       note,
			TeamID:     teamID,
			SourceType: sourceType,
			TagFilter:  tagFilter,
		}
		if err := s.db.CreateDeviceGroup(g); err != nil {
			writeInternalError(w, err, "CreateDeviceGroup")
			return
		}
		body.GUID = g.GUID
		created = true
	} else {
		existing, err := s.db.GetDeviceGroup(body.GUID)
		if err != nil {
			writeInternalError(w, err, "GetDeviceGroup")
			return
		}
		if existing == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "group not found"})
			return
		}
		update := &db.DeviceGroup{
			GUID:       body.GUID,
			Name:       body.Name,
			Note:       note,
			TeamID:     teamID,
			SourceType: sourceType,
			TagFilter:  tagFilter,
		}
		if err := s.db.UpdateDeviceGroup(body.GUID, update); err != nil {
			writeInternalError(w, err, "UpdateDeviceGroup")
			return
		}
	}

	// The form may send either arrays or one comma-separated field.
	users := body.AllowedUsers
	if len(users) == 0 && body.AllowedUsersRaw != "" {
		users = strings.Split(body.AllowedUsersRaw, ",")
	}
	groups := body.AllowedGroups
	if len(groups) == 0 && body.AllowedGroupsRaw != "" {
		groups = strings.Split(body.AllowedGroupsRaw, ",")
	}
	if err := store.SetDeviceGroupACL(body.GUID, &db.DeviceGroupACL{
		AllowedUsers:      users,
		AllowedUserGroups: groups,
	}); err != nil {
		writeInternalError(w, err, "SetDeviceGroupACL")
		return
	}

	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, map[string]any{
		"guid":          body.GUID,
		"name":          body.Name,
		"source_type":   sourceType,
		"tag_filter":    tagFilter,
		"allowed_users": dedupe(users),
		"allowed_groups": dedupe(groups),
		"created":       created,
	})
}

func (s *Server) handlePanelDeviceGroupsDelete(w http.ResponseWriter, r *http.Request) {
	guid := strings.TrimSpace(r.PathValue("guid"))
	if guid == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "guid is required"})
		return
	}
	existing, err := s.db.GetDeviceGroup(guid)
	if err != nil {
		writeInternalError(w, err, "GetDeviceGroup")
		return
	}
	if existing == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "group not found"})
		return
	}
	if err := s.db.DeleteDeviceGroup(guid); err != nil {
		writeInternalError(w, err, "DeleteDeviceGroup")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"guid": guid, "deleted": true})
}

func (s *Server) handlePanelDeviceGroupPeersGet(w http.ResponseWriter, r *http.Request) {
	store, ok := s.requirePanelGroupStore(w)
	if !ok {
		return
	}
	guid := strings.TrimSpace(r.PathValue("guid"))
	peers, err := store.ListDeviceGroupPeerIDs(guid)
	if err != nil {
		writeInternalError(w, err, "ListDeviceGroupPeerIDs")
		return
	}
	if peers == nil {
		peers = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"guid": guid, "peers": peers, "total": len(peers)})
}

func (s *Server) handlePanelDeviceGroupPeersPut(w http.ResponseWriter, r *http.Request) {
	store, ok := s.requirePanelGroupStore(w)
	if !ok {
		return
	}
	guid := strings.TrimSpace(r.PathValue("guid"))
	var body struct {
		Peers []string `json:"peers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if existing, err := s.db.GetDeviceGroup(guid); err != nil {
		writeInternalError(w, err, "GetDeviceGroup")
		return
	} else if existing == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "group not found"})
		return
	}
	if err := store.SetDeviceGroupPeers(guid, body.Peers); err != nil {
		writeInternalError(w, err, "SetDeviceGroupPeers")
		return
	}
	peers, _ := store.ListDeviceGroupPeerIDs(guid)
	if peers == nil {
		peers = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"guid": guid, "peers": peers, "total": len(peers)})
}

func (s *Server) handlePanelDeviceGroupACLGet(w http.ResponseWriter, r *http.Request) {
	store, ok := s.requirePanelGroupStore(w)
	if !ok {
		return
	}
	guid := strings.TrimSpace(r.PathValue("guid"))
	acl, err := store.GetDeviceGroupACL(guid)
	if err != nil {
		writeInternalError(w, err, "GetDeviceGroupACL")
		return
	}
	if acl == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "group not found"})
		return
	}
	writeJSON(w, http.StatusOK, acl)
}

func (s *Server) handlePanelDeviceGroupACLPut(w http.ResponseWriter, r *http.Request) {
	store, ok := s.requirePanelGroupStore(w)
	if !ok {
		return
	}
	guid := strings.TrimSpace(r.PathValue("guid"))
	var body db.DeviceGroupACL
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if existing, err := s.db.GetDeviceGroup(guid); err != nil {
		writeInternalError(w, err, "GetDeviceGroup")
		return
	} else if existing == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "group not found"})
		return
	}
	if err := store.SetDeviceGroupACL(guid, &body); err != nil {
		writeInternalError(w, err, "SetDeviceGroupACL")
		return
	}
	acl, err := store.GetDeviceGroupACL(guid)
	if err != nil {
		writeInternalError(w, err, "GetDeviceGroupACL")
		return
	}
	writeJSON(w, http.StatusOK, acl)
}

// ── Folders ───────────────────────────────────────────────────────────

func (s *Server) handlePanelFoldersList(w http.ResponseWriter, r *http.Request) {
	store, ok := s.requirePanelGroupStore(w)
	if !ok {
		return
	}
	folders, err := store.ListPanelFolders()
	if err != nil {
		writeInternalError(w, err, "ListPanelFolders")
		return
	}
	if folders == nil {
		folders = []*db.Folder{}
	}
	assignments, err := store.ListPanelDeviceFolderAssignments()
	if err != nil {
		writeInternalError(w, err, "ListPanelDeviceFolderAssignments")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"folders":     folders,
		"assignments": assignments,
	})
}

func (s *Server) handlePanelFoldersCreate(w http.ResponseWriter, r *http.Request) {
	store, ok := s.requirePanelGroupStore(w)
	if !ok {
		return
	}
	var body db.Folder
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	body.Name = truncStr(strings.TrimSpace(body.Name), 80)
	if body.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}
	if body.Color == "" {
		body.Color = "#6366f1"
	}
	if body.Icon == "" {
		body.Icon = "folder"
	}
	if err := store.CreatePanelFolder(&body); err != nil {
		writeInternalError(w, err, "CreatePanelFolder")
		return
	}
	writeJSON(w, http.StatusCreated, body)
}

func (s *Server) handlePanelFoldersUpdate(w http.ResponseWriter, r *http.Request) {
	store, ok := s.requirePanelGroupStore(w)
	if !ok {
		return
	}
	id, ok := parsePanelID(w, r.PathValue("id"))
	if !ok {
		return
	}
	var body db.Folder
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	body.Name = truncStr(strings.TrimSpace(body.Name), 80)
	if body.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}
	if err := store.UpdatePanelFolder(id, &body); err != nil {
		writeInternalError(w, err, "UpdatePanelFolder")
		return
	}
	body.ID = id
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) handlePanelFoldersDelete(w http.ResponseWriter, r *http.Request) {
	store, ok := s.requirePanelGroupStore(w)
	if !ok {
		return
	}
	id, ok := parsePanelID(w, r.PathValue("id"))
	if !ok {
		return
	}
	if err := store.DeletePanelFolder(id); err != nil {
		writeInternalError(w, err, "DeletePanelFolder")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "deleted": true})
}

// handlePanelDeviceFolder assigns a device to a folder (folder_id 0 clears it).
func (s *Server) handlePanelDeviceFolder(w http.ResponseWriter, r *http.Request) {
	store, ok := s.requirePanelGroupStore(w)
	if !ok {
		return
	}
	peerID := strings.TrimSpace(r.PathValue("id"))
	if peerID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "device id is required"})
		return
	}
	var body struct {
		FolderID int64 `json:"folder_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if err := store.SetDevicePanelFolder(peerID, body.FolderID); err != nil {
		writeInternalError(w, err, "SetDevicePanelFolder")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"device_id": peerID, "folder_id": body.FolderID})
}

// ── Per-user grants ───────────────────────────────────────────────────

func (s *Server) handlePanelUserGrantsGet(w http.ResponseWriter, r *http.Request) {
	store, ok := s.requirePanelGroupStore(w)
	if !ok {
		return
	}
	id, ok := parsePanelID(w, r.PathValue("id"))
	if !ok {
		return
	}
	grants, err := store.ListPanelUserPeerGrants(id)
	if err != nil {
		writeInternalError(w, err, "ListPanelUserPeerGrants")
		return
	}
	if grants == nil {
		grants = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"user_id": id, "peers": grants, "total": len(grants)})
}

func (s *Server) handlePanelUserGrantsPut(w http.ResponseWriter, r *http.Request) {
	store, ok := s.requirePanelGroupStore(w)
	if !ok {
		return
	}
	id, ok := parsePanelID(w, r.PathValue("id"))
	if !ok {
		return
	}
	var body struct {
		Peers []string `json:"peers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if err := store.SetUserPeerGrants(id, body.Peers); err != nil {
		writeInternalError(w, err, "SetUserPeerGrants")
		return
	}
	grants, _ := store.ListPanelUserPeerGrants(id)
	if grants == nil {
		grants = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"user_id": id, "peers": grants, "total": len(grants)})
}

// ── helpers ───────────────────────────────────────────────────────────

func parsePanelID(w http.ResponseWriter, raw string) (int64, bool) {
	raw = strings.TrimSpace(raw)
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return 0, false
	}
	return id, true
}

func dedupe(values []string) []string {
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

// registerPanelGroupRoutes mounts the grouping endpoints. Writes need
// device.edit (groups) or user.edit (grants); reads need device.view or
// user.view, so a viewer can see the folders but not change them.
func (s *Server) registerPanelGroupRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/panel/device-groups",
		s.requirePermission(auth.PermDeviceView, s.handlePanelDeviceGroupsList))
	mux.HandleFunc("POST /api/panel/device-groups",
		s.requirePermission(auth.PermDeviceEdit, s.handlePanelDeviceGroupsSave))
	mux.HandleFunc("DELETE /api/panel/device-groups/{guid}",
		s.requirePermission(auth.PermDeviceEdit, s.handlePanelDeviceGroupsDelete))
	mux.HandleFunc("GET /api/panel/device-groups/{guid}/peers",
		s.requirePermission(auth.PermDeviceView, s.handlePanelDeviceGroupPeersGet))
	mux.HandleFunc("PUT /api/panel/device-groups/{guid}/peers",
		s.requirePermission(auth.PermDeviceEdit, s.handlePanelDeviceGroupPeersPut))
	mux.HandleFunc("GET /api/panel/device-groups/{guid}/acl",
		s.requirePermission(auth.PermDeviceView, s.handlePanelDeviceGroupACLGet))
	mux.HandleFunc("PUT /api/panel/device-groups/{guid}/acl",
		s.requirePermission(auth.PermDeviceEdit, s.handlePanelDeviceGroupACLPut))

	mux.HandleFunc("GET /api/panel/folders",
		s.requirePermission(auth.PermDeviceView, s.handlePanelFoldersList))
	mux.HandleFunc("POST /api/panel/folders",
		s.requirePermission(auth.PermDeviceEdit, s.handlePanelFoldersCreate))
	mux.HandleFunc("PUT /api/panel/folders/{id}",
		s.requirePermission(auth.PermDeviceEdit, s.handlePanelFoldersUpdate))
	mux.HandleFunc("DELETE /api/panel/folders/{id}",
		s.requirePermission(auth.PermDeviceEdit, s.handlePanelFoldersDelete))
	mux.HandleFunc("PUT /api/panel/devices/{id}/folder",
		s.requirePermission(auth.PermDeviceEdit, s.handlePanelDeviceFolder))

	mux.HandleFunc("GET /api/panel/users/{id}/grants",
		s.requirePermission(auth.PermUserView, s.handlePanelUserGrantsGet))
	mux.HandleFunc("PUT /api/panel/users/{id}/grants",
		s.requirePermission(auth.PermUserEdit, s.handlePanelUserGrantsPut))
}
