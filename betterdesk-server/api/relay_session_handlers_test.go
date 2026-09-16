package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unitronix/betterdesk-server/db"
)

func TestRelaySessionEventEndsSignalSession(t *testing.T) {
	database := testSetupDB(t)
	defer database.Close()

	relayUUID := "b7822caf-d580-4ab9-9956-3f61263f7d98"
	start := time.Now().UTC().Add(-2 * time.Minute)
	if err := database.UpsertRemoteAccessSession(&db.RemoteAccessSession{
		SessionKey: "signal:" + relayUUID, TargetID: "CFA01", Source: "signal_relay",
		StartedAt: start, LastSeenAt: start,
	}); err != nil {
		t.Fatal(err)
	}

	srv := &Server{db: database}
	ended := start.Add(72 * time.Second)
	body, _ := json.Marshal(map[string]string{
		"action": "end", "relay_uuid": relayUUID,
		"ended_at": ended.Format(time.RFC3339Nano), "reason": "relay_session_ended",
	})
	rec := httptest.NewRecorder()
	srv.handleRelaySessionEvent(rec, httptest.NewRequest(http.MethodPost,
		"/api/relay/session-event", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	open, err := database.GetOpenRemoteAccessSessions([]string{"CFA01"})
	if err != nil {
		t.Fatal(err)
	}
	if len(open["CFA01"]) != 0 {
		t.Fatal("session stayed open after the relay reported it ended")
	}

	rows, err := database.ListRemoteAccessSessions(db.RemoteAccessSessionFilter{
		TargetIDs: []string{"CFA01"}, From: start.Add(-time.Hour), To: start.Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].EndedAt == nil {
		t.Fatalf("expected one closed row, got %+v", rows)
	}
	// The relay's own timestamp is kept, so the recorded duration is measured
	// rather than the moment the report happened to arrive.
	if got := rows[0].EndedAt.Sub(start).Round(time.Second); got != 72*time.Second {
		t.Errorf("duration = %v, want 72s", got)
	}
}

func TestRelaySessionEventRejectsFutureEndAndBadInput(t *testing.T) {
	database := testSetupDB(t)
	defer database.Close()
	srv := &Server{db: database}

	relayUUID := "11111111-2222-3333-4444-555555555555"
	start := time.Now().UTC().Add(-time.Minute)
	if err := database.UpsertRemoteAccessSession(&db.RemoteAccessSession{
		SessionKey: "signal:" + relayUUID, TargetID: "CFA02", Source: "signal_relay",
		StartedAt: start, LastSeenAt: start,
	}); err != nil {
		t.Fatal(err)
	}

	// A relay whose clock runs fast must not be able to inflate the session.
	future := time.Now().UTC().Add(2 * time.Hour)
	body, _ := json.Marshal(map[string]string{
		"action": "end", "relay_uuid": relayUUID, "ended_at": future.Format(time.RFC3339Nano),
	})
	rec := httptest.NewRecorder()
	srv.handleRelaySessionEvent(rec, httptest.NewRequest(http.MethodPost, "/api/relay/session-event", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	rows, err := database.ListRemoteAccessSessions(db.RemoteAccessSessionFilter{
		TargetIDs: []string{"CFA02"}, From: start.Add(-time.Hour), To: time.Now().UTC().Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].EndedAt == nil {
		t.Fatalf("expected one closed row, got %+v", rows)
	}
	if rows[0].EndedAt.After(time.Now().UTC().Add(time.Minute)) {
		t.Errorf("ended_at = %v, want clamped to now", rows[0].EndedAt)
	}

	for _, bad := range []map[string]string{
		{"action": "start", "relay_uuid": relayUUID},
		{"action": "end", "relay_uuid": "not-a-uuid"},
	} {
		b, _ := json.Marshal(bad)
		rec := httptest.NewRecorder()
		srv.handleRelaySessionEvent(rec, httptest.NewRequest(http.MethodPost, "/api/relay/session-event", bytes.NewReader(b)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("input %v: status = %d, want 400", bad, rec.Code)
		}
	}
}
