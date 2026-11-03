package db

import (
	"testing"
	"time"
)

func TestLocalDayBounds(t *testing.T) {
	// Warsaw summer UTC+2 → getTimezoneOffset() = -120
	from, to, err := LocalDayBounds("2026-10-18", -120)
	if err != nil {
		t.Fatal(err)
	}
	if from.UTC().Format(time.RFC3339) != "2026-10-17T22:00:00Z" {
		t.Fatalf("from=%s", from.UTC().Format(time.RFC3339))
	}
	if to.Sub(from) != 24*time.Hour {
		t.Fatalf("span=%s", to.Sub(from))
	}
}

func TestAvailabilityHistoryRecordsTransitions(t *testing.T) {
	db, err := OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.Migrate(); err != nil {
		t.Fatal(err)
	}
	if err := db.UpsertPeer(&Peer{ID: "PEERAV01", UUID: "u1", Status: "OFFLINE"}); err != nil {
		t.Fatal(err)
	}

	// Disabled by default — no events
	if err := db.UpdatePeerStatus("PEERAV01", "ONLINE", "1.2.3.4", "heartbeat"); err != nil {
		t.Fatal(err)
	}
	from := time.Now().UTC().Add(-time.Hour)
	to := time.Now().UTC().Add(time.Hour)
	ev, err := db.GetPeerAvailabilityEvents("PEERAV01", from, to)
	if err != nil {
		t.Fatal(err)
	}
	if len(ev) != 0 {
		t.Fatalf("expected 0 events when disabled, got %d", len(ev))
	}

	if err := db.SetConfig(ConfigAvailabilityHistoryEnabled, "true"); err != nil {
		t.Fatal(err)
	}
	db.InvalidateAvailabilityHistoryCache()

	if err := db.UpdatePeerStatus("PEERAV01", "OFFLINE", "1.2.3.4", "signal"); err != nil {
		t.Fatal(err)
	}
	if err := db.UpdatePeerStatus("PEERAV01", "OFFLINE", "1.2.3.4", "signal"); err != nil {
		t.Fatal(err)
	}
	ev, err = db.GetPeerAvailabilityEvents("PEERAV01", from, to)
	if err != nil {
		t.Fatal(err)
	}
	if len(ev) != 1 {
		t.Fatalf("expected 1 transition, got %d", len(ev))
	}
	if ev[0].FromStatus != "ONLINE" || ev[0].ToStatus != "OFFLINE" || ev[0].Source != "signal" {
		t.Fatalf("unexpected event: %+v", ev[0])
	}

	// SetAllOffline must not flood history
	if err := db.SetAllOffline(); err != nil {
		t.Fatal(err)
	}
	ev, err = db.GetPeerAvailabilityEvents("PEERAV01", from, to)
	if err != nil {
		t.Fatal(err)
	}
	if len(ev) != 1 {
		t.Fatalf("SetAllOffline must not add events, got %d", len(ev))
	}
}
