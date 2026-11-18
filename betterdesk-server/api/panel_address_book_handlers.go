package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode"

	"github.com/unitronix/betterdesk-server/db"
)

const panelAddressBookAliasMaxLength = 128

type panelAddressBookAliasRequest struct {
	Alias string `json:"alias"`
}

// sanitizePanelAddressBookAlias keeps the panel write compatible with the
// legacy RustDesk client, which stores aliases as ordinary peer strings.
func sanitizePanelAddressBookAlias(value string) string {
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\t' && r != '\n' && r != '\r' {
			return -1
		}
		return r
	}, value)
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > panelAddressBookAliasMaxLength {
		runes = runes[:panelAddressBookAliasMaxLength]
	}
	return string(runes)
}

// updateAddressBookPeerAlias changes only peers[].alias in a legacy address
// book document. The map-based representation deliberately preserves all
// unknown top-level, peer, tag and hash fields.
func updateAddressBookPeerAlias(data, peerID, alias string) (string, bool, error) {
	book := parseAddressBookMap(data)
	id := strings.TrimSpace(peerID)
	alias = sanitizePanelAddressBookAlias(alias)

	var target map[string]any
	for _, rawPeer := range toPeerSlice(book["peers"]) {
		if strings.TrimSpace(stringValue(rawPeer["id"])) != id {
			continue
		}
		target = rawPeer
	}
	found := target != nil
	if found {
		target["alias"] = alias
	} else if id != "" && alias != "" {
		peers := append(toPeerSlice(book["peers"]), map[string]any{
			"id":    id,
			"alias": alias,
		})
		book["peers"] = peersToAny(peers)
		found = true
	}

	encoded, err := json.Marshal(book)
	if err != nil {
		return "", found, err
	}
	return string(encoded), found, nil
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	valueString, _ := value.(string)
	return valueString
}

// handlePanelAddressBookAlias updates the current operator's legacy
// RustDesk address book in the Go-owned database. It intentionally does not
// use the merged GET /api/ab document as the write source: that response may
// include organization overlays and ACL filtering.
func (s *Server) handlePanelAddressBookAlias(w http.ResponseWriter, r *http.Request) {
	username := getUsernameFromCtx(r)
	role := getRoleFromCtx(r)
	peerID := strings.TrimSpace(r.PathValue("id"))
	if username == "" || peerID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid address book peer"})
		return
	}

	peer, err := s.db.GetPeer(peerID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal error"})
		return
	}
	if peer == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Device not found"})
		return
	}

	user := s.rustDeskUserForGroups(r, username, role)
	peerByID := map[string]*db.Peer{peerID: peer}
	visible := s.rustDeskVisiblePeerSet(user, role, peerByID)
	if visible != nil && !visible[peerID] {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Device is outside your scope"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	var request panelAddressBookAliasRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	s.addressBookMu.Lock()
	defer s.addressBookMu.Unlock()

	data, err := s.db.GetAddressBook(username, "legacy")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal error"})
		return
	}
	updated, _, err := updateAddressBookPeerAlias(data, peerID, request.Alias)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal error"})
		return
	}
	if len(updated) > 512*1024 {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Address book too large"})
		return
	}
	if err := s.db.SaveAddressBook(username, "legacy", updated); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal error"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"address_book_alias": sanitizePanelAddressBookAlias(request.Alias),
	})
}
