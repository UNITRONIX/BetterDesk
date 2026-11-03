package db

import (
	"path/filepath"
	"testing"
	"time"
)

func TestPeerConnectionSessionDebounceAndEnd(t *testing.T) {
	path := filepath.Join(t.TempDir(), "conn_sess.db")
	db, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	defer db.Close()
	if err := db.Migrate(); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	id1, err := db.StartPeerConnectionSession(&PeerConnectionSession{
		HostID:    "HOST1",
		PeerID:    "PEER1",
		PeerName:  "Caller",
		PeerIP:    "1.2.3.4",
		Username:  "admin",
		Transport: "punch_hole",
		Source:    "signal",
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if id1 <= 0 {
		t.Fatalf("expected id > 0, got %d", id1)
	}

	id2, err := db.StartPeerConnectionSession(&PeerConnectionSession{
		HostID:    "HOST1",
		PeerID:    "PEER1",
		Transport: "request_relay",
		RelayUUID: "uuid-abc",
		Source:    "signal",
	})
	if err != nil {
		t.Fatalf("Start debounce: %v", err)
	}
	if id2 != id1 {
		t.Fatalf("debounce should reuse id %d, got %d", id1, id2)
	}

	list, err := db.ListPeerConnectionSessions("HOST1", 10)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("list len = %d, want 1", len(list))
	}
	if list[0].RelayUUID != "uuid-abc" {
		t.Fatalf("relay uuid = %q, want uuid-abc", list[0].RelayUUID)
	}
	if !list[0].Active {
		t.Fatal("expected active session")
	}

	if err := db.EndPeerConnectionSessionByRelay("uuid-abc"); err != nil {
		t.Fatalf("End: %v", err)
	}
	list, err = db.ListPeerConnectionSessions("HOST1", 10)
	if err != nil {
		t.Fatalf("List after end: %v", err)
	}
	if len(list) != 1 || list[0].Active || list[0].EndedAt == nil {
		t.Fatalf("expected ended session, got %+v", list[0])
	}
	if list[0].DurationSeconds == nil {
		t.Fatal("expected duration_seconds")
	}

	// After end, a new start should create a new row.
	time.Sleep(10 * time.Millisecond)
	id3, err := db.StartPeerConnectionSession(&PeerConnectionSession{
		HostID:    "HOST1",
		PeerID:    "PEER1",
		Transport: "punch_hole",
	})
	if err != nil {
		t.Fatalf("Start after end: %v", err)
	}
	if id3 == id1 {
		t.Fatalf("expected new session id, got same %d", id3)
	}
}
