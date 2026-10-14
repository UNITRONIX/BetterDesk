// Role and Permission management handlers for the BetterDesk API (Phase 52 RBAC).
//
// Provides endpoints:
//
//	GET    /api/roles                                - List built-in and custom roles with permissions
//	POST   /api/roles                                - Create a custom role
//	PATCH  /api/roles/{role}                         - Update a custom role's description
//	DELETE /api/roles/{role}                         - Delete an unused custom role
//	GET    /api/roles/{role}/permissions              - Get effective permissions for a role
//	GET    /api/role-permissions                      - List all custom permission overrides
//	POST   /api/role-permissions                      - Set a custom permission override
//	DELETE /api/role-permissions/{role}/{permission}   - Delete a custom override
package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strings"

	"github.com/unitronix/betterdesk-server/audit"
	"github.com/unitronix/betterdesk-server/auth"
	"github.com/unitronix/betterdesk-server/db"
)

// builtinRoles is the ordered list of built-in roles exposed to the panel.
var builtinRoles = []string{
	auth.RoleSuperAdmin,
	auth.RoleAdmin,
	auth.RoleServerAdmin,
	auth.RoleGlobalAdmin,
	auth.RoleOperator,
	auth.RoleViewer,
	auth.RolePro,
}

const maxCustomRoleDescription = 200

// roleInfo describes a single role for the /api/roles response.
type roleInfo struct {
	Name          string   `json:"name"`
	Level         int      `json:"level"`
	IsSuperAdmin  bool     `json:"is_super_admin"`
	IsServerLevel bool     `json:"is_server_level"`
	IsCustom      bool     `json:"is_custom"`
	Description   string   `json:"description,omitempty"`
	UserCount     int      `json:"user_count"`
	Permissions   []string `json:"permissions"`
}

// defaultPermissions returns the built-in default permission list for a role.
// Custom roles have no defaults.
func defaultPermissions(role string) []string {
	if auth.IsSuperAdminRole(role) {
		return append([]string(nil), auth.AllPermissions...)
	}
	perms := make([]string, 0)
	for p, granted := range auth.DefaultRolePermissions[role] {
		if granted {
			perms = append(perms, p)
		}
	}
	sort.Strings(perms)
	return perms
}

// effectivePermissions merges a role's defaults with its DB overrides.
func (s *Server) effectivePermissions(role string) []string {
	permissions := make([]string, 0)
	for _, p := range auth.AllPermissions {
		if s.roleHasPermission(role, p) {
			permissions = append(permissions, p)
		}
	}
	return permissions
}

// allRoleNames returns built-in roles followed by custom roles.
func (s *Server) allRoleNames() []string {
	names := append([]string(nil), builtinRoles...)
	if s.db == nil {
		return names
	}
	custom, err := s.db.ListCustomRoles()
	if err != nil {
		log.Printf("api: list custom roles: %v", err)
		return names
	}
	for _, cr := range custom {
		names = append(names, cr.Name)
	}
	return names
}

func (s *Server) roleUserCount(role string) int {
	if s.db == nil {
		return 0
	}
	n, err := s.db.CountUsersWithRole(role)
	if err != nil {
		return 0
	}
	return n
}

// handleListRoles returns all built-in roles with their default permission sets,
// followed by custom roles with their granted permissions.
//
//	GET /api/roles
func (s *Server) handleListRoles(w http.ResponseWriter, r *http.Request) {
	result := make([]roleInfo, 0, len(builtinRoles))
	for _, role := range builtinRoles {
		result = append(result, roleInfo{
			Name:          role,
			Level:         auth.RoleLevel(role),
			IsSuperAdmin:  auth.IsSuperAdminRole(role),
			IsServerLevel: auth.IsServerLevel(role),
			UserCount:     s.roleUserCount(role),
			Permissions:   defaultPermissions(role),
		})
	}

	if s.db != nil {
		custom, err := s.db.ListCustomRoles()
		if err != nil {
			log.Printf("api: list custom roles: %v", err)
		}
		for _, cr := range custom {
			result = append(result, roleInfo{
				Name:        cr.Name,
				Level:       auth.RoleLevel(cr.Name),
				IsCustom:    true,
				Description: cr.Description,
				UserCount:   s.roleUserCount(cr.Name),
				Permissions: s.effectivePermissions(cr.Name),
			})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"roles":           result,
		"all_permissions": auth.AllPermissions,
	})
}

// handleCreateCustomRole creates a custom role, optionally seeded with the
// effective permissions of an existing role or an explicit permission list.
//
//	POST /api/roles
//	Body: {"name": "helpdesk", "description": "...", "copy_from": "operator", "permissions": ["device.view"]}
func (s *Server) handleCreateCustomRole(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		CopyFrom    string   `json:"copy_from"`
		Permissions []string `json:"permissions"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}

	body.Name = strings.TrimSpace(body.Name)
	body.Description = strings.TrimSpace(body.Description)
	if !auth.ValidCustomRoleName(body.Name) {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "Invalid role name: use 2-32 lowercase letters, digits or underscores, starting with a letter, and not a built-in role",
		})
		return
	}
	if len(body.Description) > maxCustomRoleDescription {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Description is too long"})
		return
	}
	if existing, err := s.db.GetCustomRole(body.Name); err == nil && existing != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Role already exists"})
		return
	}

	granted := make(map[string]bool)
	if body.CopyFrom != "" {
		if !s.isKnownRole(body.CopyFrom) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid copy_from role"})
			return
		}
		for _, p := range s.effectivePermissions(body.CopyFrom) {
			granted[p] = true
		}
	}
	for _, p := range body.Permissions {
		if !auth.ValidPermission(p) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid permission: " + p})
			return
		}
		granted[p] = true
	}
	perms := make([]string, 0, len(granted))
	for _, p := range auth.AllPermissions {
		if granted[p] {
			perms = append(perms, p)
		}
	}

	role := &db.CustomRole{
		Name:        body.Name,
		Description: body.Description,
		CreatedBy:   getUsernameFromCtx(r),
	}
	if err := s.db.CreateCustomRole(role, perms); err != nil {
		log.Printf("api: create custom role %q: %v", body.Name, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create role"})
		return
	}

	if s.auditLog != nil {
		s.auditLog.Log(audit.ActionRoleCreated, s.remoteIP(r), getUsernameFromCtx(r), map[string]string{
			"role": body.Name, "copy_from": body.CopyFrom,
		})
	}

	writeJSON(w, http.StatusCreated, roleInfo{
		Name:        role.Name,
		Level:       auth.RoleLevel(role.Name),
		IsCustom:    true,
		Description: role.Description,
		Permissions: perms,
	})
}

// handleUpdateCustomRole updates the description of a custom role.
//
//	PATCH /api/roles/{role}
//	Body: {"description": "..."}
func (s *Server) handleUpdateCustomRole(w http.ResponseWriter, r *http.Request) {
	role := r.PathValue("role")
	if auth.ValidRole(role) || !s.isKnownRole(role) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Custom role not found"})
		return
	}

	var body struct {
		Description string `json:"description"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	body.Description = strings.TrimSpace(body.Description)
	if len(body.Description) > maxCustomRoleDescription {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Description is too long"})
		return
	}

	if err := s.db.UpdateCustomRole(role, body.Description); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update role"})
		return
	}

	if s.auditLog != nil {
		s.auditLog.Log(audit.ActionRoleUpdated, s.remoteIP(r), getUsernameFromCtx(r), map[string]string{"role": role})
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleDeleteCustomRole deletes a custom role and its permission rows.
// Built-in roles cannot be deleted, and a role still assigned to users is kept.
//
//	DELETE /api/roles/{role}
func (s *Server) handleDeleteCustomRole(w http.ResponseWriter, r *http.Request) {
	role := r.PathValue("role")
	if auth.ValidRole(role) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Built-in roles cannot be deleted"})
		return
	}
	if !s.isKnownRole(role) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Custom role not found"})
		return
	}

	n, err := s.db.CountUsersWithRole(role)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to check role usage"})
		return
	}
	if n > 0 {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":      "Role is still assigned to users; reassign them first",
			"user_count": n,
		})
		return
	}

	if err := s.db.DeleteCustomRole(role); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to delete role"})
		return
	}

	if s.auditLog != nil {
		s.auditLog.Log(audit.ActionRoleDeleted, s.remoteIP(r), getUsernameFromCtx(r), map[string]string{"role": role})
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleGetRolePermissions returns the effective permission list for a specific role,
// merging defaults with custom DB overrides.
//
//	GET /api/roles/{role}/permissions
func (s *Server) handleGetRolePermissions(w http.ResponseWriter, r *http.Request) {
	role := r.PathValue("role")
	if !s.isKnownRole(role) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid role"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"role":        role,
		"permissions": s.effectivePermissions(role),
	})
}

// handleListRolePermissionOverrides returns all custom permission overrides from the DB.
//
//	GET /api/role-permissions
func (s *Server) handleListRolePermissionOverrides(w http.ResponseWriter, r *http.Request) {
	roleFilter := r.URL.Query().Get("role")

	type override struct {
		Role       string `json:"role"`
		Permission string `json:"permission"`
		Granted    bool   `json:"granted"`
	}

	var result []override

	for _, role := range s.allRoleNames() {
		if roleFilter != "" && role != roleFilter {
			continue
		}
		overrides, err := s.db.ListRolePermissions(role)
		if err != nil {
			continue
		}
		for _, o := range overrides {
			result = append(result, override{
				Role:       role,
				Permission: o.Permission,
				Granted:    o.Granted,
			})
		}
	}

	if result == nil {
		result = []override{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"overrides": result})
}

// handleSetRolePermission creates or updates a custom permission override.
//
//	POST /api/role-permissions
//	Body: {"role": "operator", "permission": "device.delete", "granted": true}
func (s *Server) handleSetRolePermission(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Role       string `json:"role"`
		Permission string `json:"permission"`
		Granted    bool   `json:"granted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}

	if !s.isKnownRole(body.Role) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid role"})
		return
	}
	if !auth.ValidPermission(body.Permission) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid permission"})
		return
	}

	// Cannot modify super_admin/admin permissions
	if auth.IsSuperAdminRole(body.Role) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Cannot override super admin permissions"})
		return
	}

	if err := s.db.SetRolePermission(body.Role, body.Permission, body.Granted); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to set permission"})
		return
	}

	if s.auditLog != nil {
		granted := "false"
		if body.Granted {
			granted = "true"
		}
		s.auditLog.Log(audit.ActionRolePermissionChanged, s.remoteIP(r), getUsernameFromCtx(r), map[string]string{
			"role": body.Role, "permission": body.Permission, "granted": granted,
		})
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleDeleteRolePermission removes a custom permission override, reverting to defaults.
//
//	DELETE /api/role-permissions/{role}/{permission}
func (s *Server) handleDeleteRolePermission(w http.ResponseWriter, r *http.Request) {
	role := r.PathValue("role")
	permission := r.PathValue("permission")

	if !s.isKnownRole(role) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid role"})
		return
	}
	if !auth.ValidPermission(permission) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid permission"})
		return
	}

	if err := s.db.DeleteRolePermission(role, permission); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to delete override"})
		return
	}

	if s.auditLog != nil {
		s.auditLog.Log(audit.ActionRolePermissionChanged, s.remoteIP(r), getUsernameFromCtx(r), map[string]string{
			"role": role, "permission": permission, "granted": "default",
		})
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
