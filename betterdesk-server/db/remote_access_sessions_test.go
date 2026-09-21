package db

import (
	"testing"
	"time"
)

func TestRemoteAccessSessionLifecycleSQLite(t *testing.T) {
	database := newTestDB(t)
	start := time.Date(2026, 7, 14, 8, 0, 0, 0, time.UTC)
	session := &RemoteAccessSession{
		SessionKey: "native:test-session", TargetID: "TARGET01", TargetUUID: "uuid-target",
		OperatorUsername: "support.alice", ControllerID: "SUPPORT1", ControllerName: "Alice PC",
		ConnectionType: 0, Source: "rustdesk_audit", StartedAt: start, LastSeenAt: start,
	}
	if err := database.UpsertRemoteAccessSession(session); err != nil {
		t.Fatal(err)
	}
	// A repeated audit post must be idempotent.
	if err := database.UpsertRemoteAccessSession(session); err != nil {
		t.Fatal(err)
	}
	rows, err := database.ListRemoteAccessSessions(RemoteAccessSessionFilter{
		TargetIDs: []string{"TARGET01"}, From: start.Add(-time.Hour), To: start.Add(time.Hour),
	})
	if err != nil || len(rows) != 1 {
		t.Fatalf("rows=%+v err=%v", rows, err)
	}
	open, err := database.GetOpenRemoteAccessSessions([]string{"TARGET01"})
	if err != nil || len(open["TARGET01"]) != 1 {
		t.Fatalf("open=%+v err=%v", open, err)
	}
	end := start.Add(90 * time.Minute)
	if err := database.EndRemoteAccessSession(session.SessionKey, end, "close"); err != nil {
		t.Fatal(err)
	}
	open, err = database.GetOpenRemoteAccessSessions([]string{"TARGET01"})
	if err != nil || len(open["TARGET01"]) != 0 {
		t.Fatalf("open after close=%+v err=%v", open, err)
	}
	rows, err = database.ListRemoteAccessSessions(RemoteAccessSessionFilter{
		Operators: []string{"support.alice"}, From: start.Add(-time.Hour), To: end.Add(time.Hour),
	})
	if err != nil || len(rows) != 1 || rows[0].EndedAt == nil || !rows[0].EndedAt.Equal(end) {
		t.Fatalf("closed rows=%+v err=%v", rows, err)
	}
}

func TestCloseOrphanedRemoteAccessSessionsSQLite(t *testing.T) {
	database := newTestDB(t)
	base := time.Date(2026, 8, 5, 6, 47, 0, 0, time.UTC)

	mkSession := func(key, target string, started time.Time, lastSeen time.Time) {
		t.Helper()
		if err := database.UpsertRemoteAccessSession(&RemoteAccessSession{
			SessionKey: key, TargetID: target, Source: "rustdesk_audit",
			StartedAt: started, LastSeenAt: lastSeen,
		}); err != nil {
			t.Fatal(err)
		}
	}

	// 1. Device is offline entirely — nothing can be connected to it.
	mkSession("audit:offline", "GONE01", base, base.Add(2*time.Minute))

	// 2. Device is online, but it reconnected after this session began, so the
	//    session belongs to a previous connection.
	mkSession("audit:predates", "BACK01", base, base.Add(time.Minute))
	if err := database.TouchDeviceOnlineSession("BACK01", base.Add(time.Hour), 0); err != nil {
		t.Fatal(err)
	}

	// 3. Device has been online since before this session started — it may well
	//    still be running, even though it has not been touched for a long time.
	if err := database.TouchDeviceOnlineSession("LIVE01", base.Add(-time.Hour), 0); err != nil {
		t.Fatal(err)
	}
	mkSession("audit:live", "LIVE01", base, base)

	n, err := database.CloseOrphanedRemoteAccessSessions(time.Minute, "device_not_connected")
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("closed %d sessions, want 2", n)
	}

	open, err := database.GetOpenRemoteAccessSessions([]string{"GONE01", "BACK01", "LIVE01"})
	if err != nil {
		t.Fatal(err)
	}
	if len(open["GONE01"]) != 0 {
		t.Error("session on an offline device stayed open")
	}
	if len(open["BACK01"]) != 0 {
		t.Error("session predating the current online session stayed open")
	}
	if len(open["LIVE01"]) != 1 {
		t.Fatalf("a session that may still be running was closed: %d open", len(open["LIVE01"]))
	}

	// Orphans must be ended at last_seen_at, never at "now", so the record does
	// not gain session time that never happened.
	rows, err := database.ListRemoteAccessSessions(RemoteAccessSessionFilter{
		TargetIDs: []string{"GONE01"}, From: base.Add(-time.Hour), To: base.Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].EndedAt == nil {
		t.Fatalf("expected one closed row, got %+v", rows)
	}
	if !rows[0].EndedAt.Equal(base.Add(2 * time.Minute)) {
		t.Errorf("ended_at = %v, want last_seen_at %v", rows[0].EndedAt, base.Add(2*time.Minute))
	}

	// A session that has only just been recorded must be left alone even when no
	// device online interval exists yet: the two are written by different paths.
	fresh := time.Now().UTC()
	if err := database.UpsertRemoteAccessSession(&RemoteAccessSession{
		SessionKey: "audit:just-started", TargetID: "BRANDNEW01", Source: "rustdesk_audit",
		StartedAt: fresh, LastSeenAt: fresh,
	}); err != nil {
		t.Fatal(err)
	}
	if n, err := database.CloseOrphanedRemoteAccessSessions(5*time.Minute, "device_not_connected"); err != nil {
		t.Fatal(err)
	} else if n != 0 {
		t.Fatalf("closed %d session(s) inside the grace period, want 0", n)
	}
	freshOpen, err := database.GetOpenRemoteAccessSessions([]string{"BRANDNEW01"})
	if err != nil {
		t.Fatal(err)
	}
	if len(freshOpen["BRANDNEW01"]) != 1 {
		t.Fatal("a session recorded seconds ago was reaped")
	}

	// Running it again must be a no-op.
	if n, err := database.CloseOrphanedRemoteAccessSessions(time.Minute, "device_not_connected"); err != nil || n != 0 {
		t.Fatalf("second run closed %d sessions (err=%v), want 0", n, err)
	}
}

func TestSupersedeSignalRelaySessionsSQLite(t *testing.T) {
	database := newTestDB(t)
	start := time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)

	// Signal observes the connection first and records it without an operator.
	if err := database.UpsertRemoteAccessSession(&RemoteAccessSession{
		SessionKey: "signal:relay-uuid-1", TargetID: "CFA01", Source: "signal_relay",
		ControllerName: "95.105.192.186", StartedAt: start, LastSeenAt: start,
	}); err != nil {
		t.Fatal(err)
	}
	// A logged-in client then reports the same connection with a real operator.
	audit := start.Add(2 * time.Second)
	if err := database.UpsertRemoteAccessSession(&RemoteAccessSession{
		SessionKey: "native:client-session-1", TargetID: "CFA01", Source: "rustdesk_audit",
		OperatorUsername: "Admin", ControllerID: "pcdoma", StartedAt: audit, LastSeenAt: audit,
	}); err != nil {
		t.Fatal(err)
	}
	n, err := database.SupersedeSignalRelaySessions("CFA01", audit)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("superseded %d rows, want 1", n)
	}

	// Exactly one session may remain open, otherwise the connected-time report
	// counts this single connection twice.
	open, err := database.GetOpenRemoteAccessSessions([]string{"CFA01"})
	if err != nil {
		t.Fatal(err)
	}
	if len(open["CFA01"]) != 1 {
		t.Fatalf("%d open sessions for one connection, want 1", len(open["CFA01"]))
	}
	if got := open["CFA01"][0].OperatorUsername; got != "Admin" {
		t.Errorf("surviving session operator = %q, want the audit row's %q", got, "Admin")
	}

	// A signal session for a different target must not be touched.
	if err := database.UpsertRemoteAccessSession(&RemoteAccessSession{
		SessionKey: "signal:relay-uuid-2", TargetID: "OTHER01", Source: "signal_relay",
		StartedAt: start, LastSeenAt: start,
	}); err != nil {
		t.Fatal(err)
	}
	if n, err := database.SupersedeSignalRelaySessions("CFA01", audit); err != nil || n != 0 {
		t.Fatalf("second supersede touched %d rows (err=%v), want 0", n, err)
	}
	otherOpen, err := database.GetOpenRemoteAccessSessions([]string{"OTHER01"})
	if err != nil {
		t.Fatal(err)
	}
	if len(otherOpen["OTHER01"]) != 1 {
		t.Error("an unrelated target's signal session was closed")
	}
}
