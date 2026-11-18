package api

import (
	"encoding/json"
	"testing"
)

func TestUpdateAddressBookPeerAliasPreservesDocument(t *testing.T) {
	input := `{"hash":"book-hash","tag_colors":{"Ops":"#ff0000"},"tags":["Ops"],"peers":[{"id":"PEER1","hash":"peer-hash","tags":["Ops"],"unknown":{"keep":true},"alias":"old"}]}`

	output, found, err := updateAddressBookPeerAlias(input, "PEER1", " New alias ")
	if err != nil {
		t.Fatalf("updateAddressBookPeerAlias: %v", err)
	}
	if !found {
		t.Fatal("expected existing peer to be found")
	}

	var book map[string]any
	if err := json.Unmarshal([]byte(output), &book); err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if book["hash"] != "book-hash" {
		t.Fatalf("top-level hash was not preserved: %#v", book["hash"])
	}
	peers := toPeerSlice(book["peers"])
	if len(peers) != 1 {
		t.Fatalf("peer count = %d, want 1", len(peers))
	}
	if peers[0]["alias"] != "New alias" || peers[0]["hash"] != "peer-hash" {
		t.Fatalf("peer fields were not preserved/updated: %#v", peers[0])
	}
	if unknown, ok := peers[0]["unknown"].(map[string]any); !ok || unknown["keep"] != true {
		t.Fatalf("unknown peer fields were not preserved: %#v", peers[0]["unknown"])
	}
}

func TestUpdateAddressBookPeerAliasAddsAndClears(t *testing.T) {
	output, found, err := updateAddressBookPeerAlias(`{"peers":[]}`, "PEER2", "Added")
	if err != nil {
		t.Fatalf("add alias: %v", err)
	}
	if !found || len(toPeerSlice(parseAddressBookMap(output)["peers"])) != 1 {
		t.Fatalf("expected a new peer alias, found=%v output=%s", found, output)
	}

	output, found, err = updateAddressBookPeerAlias(output, "PEER2", "")
	if err != nil {
		t.Fatalf("clear alias: %v", err)
	}
	if !found {
		t.Fatal("expected added peer to be found when clearing alias")
	}
	peers := toPeerSlice(parseAddressBookMap(output)["peers"])
	if peers[0]["alias"] != "" {
		t.Fatalf("alias = %#v, want empty", peers[0]["alias"])
	}
}

func TestUpdateAddressBookPeerAliasUsesLastDuplicate(t *testing.T) {
	input := `{"peers":[{"id":"PEER3","alias":"first"},{"id":"PEER3","alias":"last"}]}`
	output, _, err := updateAddressBookPeerAlias(input, "PEER3", "updated")
	if err != nil {
		t.Fatalf("update duplicate alias: %v", err)
	}
	peers := toPeerSlice(parseAddressBookMap(output)["peers"])
	if peers[0]["alias"] != "first" || peers[1]["alias"] != "updated" {
		t.Fatalf("duplicate update changed the wrong peers: %#v", peers)
	}
}
