package db

import (
	"sync"
	"testing"
	"time"
)

func TestConnectionModeIssueAckAndRetryIdentity(t *testing.T) {
	database := newTestDB(t)
	if err := database.UpsertPeer(&Peer{ID: "cmdevice1", UUID: "dXVpZC1kZXZpY2UtMQ"}); err != nil {
		t.Fatalf("UpsertPeer: %v", err)
	}

	first, created, err := database.IssueConnectionMode(&ConnectionModeIssue{
		DeviceID:     "cmdevice1",
		Mode:         ConnectionModeIncomingOnly,
		Reason:       "support session",
		OperatorID:   "7",
		OperatorName: "ada",
	})
	if err != nil || !created || first == nil {
		t.Fatalf("issue incoming: created=%v cmd=%#v err=%v", created, first, err)
	}
	if first.Revision != 1 || first.Status != ConnectionCommandQueued || first.PreviousMode != ConnectionModeNormal {
		t.Fatalf("unexpected first command: %#v", first)
	}
	if first.OperatorID != "7" || first.OperatorName != "ada" || first.Reason != "support session" {
		t.Fatalf("audit fields missing: %#v", first)
	}

	again, created, err := database.IssueConnectionMode(&ConnectionModeIssue{
		DeviceID: "cmdevice1", Mode: ConnectionModeIncomingOnly, Reason: "again", OperatorID: "8", OperatorName: "bob",
	})
	if err != nil || created || again.CommandID != first.CommandID || again.Revision != first.Revision {
		t.Fatalf("duplicate issue changed identity: created=%v again=%#v err=%v", created, again, err)
	}

	if err := database.MarkConnectionModeDelivered(first.CommandID, time.Unix(first.IssuedAt, 0)); err != nil {
		t.Fatalf("mark delivered: %v", err)
	}
	delivered, err := database.LatestConnectionModeCommand("cmdevice1")
	if err != nil || delivered.Status != ConnectionCommandDelivered || delivered.Revision != 1 {
		t.Fatalf("delivered command: %#v err=%v", delivered, err)
	}

	offline, err := database.DeliverableConnectionModeCommand("cmdevice1", time.Unix(first.IssuedAt, 0))
	if err != nil || offline == nil || offline.CommandID != first.CommandID {
		t.Fatalf("offline/queued retry command: %#v err=%v", offline, err)
	}

	updated, err := database.AcknowledgeConnectionMode(&ConnectionModeAck{
		DeviceID: "cmdevice1", CommandID: first.CommandID, Revision: first.Revision,
		Status: ConnectionCommandApplied, EffectiveMode: ConnectionModeIncomingOnly,
	})
	if err != nil || !updated {
		t.Fatalf("ack: updated=%v err=%v", updated, err)
	}
	policy, err := database.GetConnectionModePolicy("cmdevice1")
	if err != nil || policy.EffectiveMode != ConnectionModeIncomingOnly || policy.DesiredMode != ConnectionModeIncomingOnly {
		t.Fatalf("policy after ack: %#v err=%v", policy, err)
	}

	same, created, err := database.IssueConnectionMode(&ConnectionModeIssue{
		DeviceID: "cmdevice1", Mode: ConnectionModeIncomingOnly, Reason: "already applied", OperatorID: "7",
	})
	if err != nil || created || same.CommandID != first.CommandID {
		t.Fatalf("applied duplicate: created=%v cmd=%#v err=%v", created, same, err)
	}
}

func TestConnectionModeRevisionMonotonicAndSupersede(t *testing.T) {
	database := newTestDB(t)
	if err := database.UpsertPeer(&Peer{ID: "cmdevice2", UUID: "dXVpZC1kZXZpY2UtMg"}); err != nil {
		t.Fatalf("UpsertPeer: %v", err)
	}
	modes := []string{ConnectionModeIncomingOnly, ConnectionModeNormal, ConnectionModeIncomingOnly}
	var last *ConnectionModeCommand
	for i, mode := range modes {
		cmd, created, err := database.IssueConnectionMode(&ConnectionModeIssue{
			DeviceID: "cmdevice2", Mode: mode, Reason: "switch", OperatorID: "1", OperatorName: "op",
		})
		if err != nil || !created {
			t.Fatalf("issue %d: created=%v err=%v", i, created, err)
		}
		if cmd.Revision != int64(i+1) {
			t.Fatalf("revision %d = %d", i, cmd.Revision)
		}
		if last != nil && cmd.Revision <= last.Revision {
			t.Fatalf("revision moved backwards: %d -> %d", last.Revision, cmd.Revision)
		}
		last = cmd
	}
	active, err := database.DeliverableConnectionModeCommand("cmdevice2", time.Unix(last.IssuedAt, 0))
	if err != nil || active == nil || active.Revision != 3 || active.Mode != ConnectionModeIncomingOnly {
		t.Fatalf("active command: %#v err=%v", active, err)
	}
	var superseded int
	if err := database.db.QueryRow(`
		SELECT COUNT(*) FROM device_connection_mode_commands
		WHERE device_id = ? AND status = ? AND rejection_code = ?`,
		"cmdevice2", ConnectionCommandRejected, ConnectionRejectionSuperseded).Scan(&superseded); err != nil {
		t.Fatalf("count superseded: %v", err)
	}
	if superseded != 2 {
		t.Fatalf("superseded count = %d", superseded)
	}
}

func TestConnectionModeUniqueCommandAndRevision(t *testing.T) {
	database := newTestDB(t)
	if err := database.UpsertPeer(&Peer{ID: "cmdevice3", UUID: "dXVpZC1kZXZpY2UtMw"}); err != nil {
		t.Fatalf("UpsertPeer: %v", err)
	}
	cmd, _, err := database.IssueConnectionMode(&ConnectionModeIssue{
		DeviceID: "cmdevice3", Mode: ConnectionModeNormal, Reason: "baseline", OperatorID: "1",
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	_, err = database.db.Exec(`
		INSERT INTO device_connection_mode_commands (
			command_id, device_id, device_uuid, revision, mode, reason, issued_at, expires_at, status
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		cmd.CommandID, "cmdevice3", cmd.DeviceUUID, 99, ConnectionModeNormal, "replay", cmd.IssuedAt, cmd.ExpiresAt, ConnectionCommandQueued)
	if err == nil {
		t.Fatal("duplicate command_id was inserted")
	}
	_, err = database.db.Exec(`
		INSERT INTO device_connection_mode_commands (
			command_id, device_id, device_uuid, revision, mode, reason, issued_at, expires_at, status
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"other-command", "cmdevice3", cmd.DeviceUUID, cmd.Revision, ConnectionModeNormal, "replay", cmd.IssuedAt, cmd.ExpiresAt, ConnectionCommandQueued)
	if err == nil {
		t.Fatal("duplicate device_uuid+revision was inserted")
	}
}

func TestConnectionModeExpiryDoesNotRevert(t *testing.T) {
	database := newTestDB(t)
	if err := database.UpsertPeer(&Peer{ID: "cmdevice4", UUID: "dXVpZC1kZXZpY2UtNA"}); err != nil {
		t.Fatalf("UpsertPeer: %v", err)
	}
	cmd, _, err := database.IssueConnectionMode(&ConnectionModeIssue{
		DeviceID: "cmdevice4", Mode: ConnectionModeIncomingOnly, Reason: "temporary", OperatorID: "1",
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	got, err := database.DeliverableConnectionModeCommand("cmdevice4", time.Unix(cmd.ExpiresAt+1, 0))
	if err != nil {
		t.Fatalf("deliver expired: %v", err)
	}
	if got != nil {
		t.Fatalf("expired command was delivered: %#v", got)
	}
	latest, err := database.LatestConnectionModeCommand("cmdevice4")
	if err != nil || latest.Status != ConnectionCommandExpired || latest.Mode != ConnectionModeIncomingOnly || latest.Revision != 1 {
		t.Fatalf("expired command: %#v err=%v", latest, err)
	}
	var count int
	if err := database.db.QueryRow(`SELECT COUNT(*) FROM device_connection_mode_commands WHERE device_id = ?`, "cmdevice4").Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("expiry created extra commands: %d", count)
	}
	policy, err := database.GetConnectionModePolicy("cmdevice4")
	if err != nil || policy.DesiredMode != ConnectionModeIncomingOnly || policy.EffectiveMode != "" {
		t.Fatalf("policy changed on expiry: %#v err=%v", policy, err)
	}
}

func TestConnectionModeRejectsBlockedDevices(t *testing.T) {
	database := newTestDB(t)
	if err := database.UpsertPeer(&Peer{ID: "cmdevice5", UUID: ""}); err != nil {
		t.Fatalf("UpsertPeer: %v", err)
	}
	if _, _, err := database.IssueConnectionMode(&ConnectionModeIssue{
		DeviceID: "cmdevice5", Mode: ConnectionModeNormal, Reason: "no uuid", OperatorID: "1",
	}); err != ErrConnectionModeNoUUID {
		t.Fatalf("empty uuid err = %v", err)
	}
	if err := database.UpsertPeer(&Peer{ID: "cmdevice6", UUID: "dXVpZC1iYW4"}); err != nil {
		t.Fatalf("UpsertPeer banned: %v", err)
	}
	if err := database.BanPeer("cmdevice6", "blocked"); err != nil {
		t.Fatalf("BanPeer: %v", err)
	}
	if _, _, err := database.IssueConnectionMode(&ConnectionModeIssue{
		DeviceID: "cmdevice6", Mode: ConnectionModeNormal, Reason: "banned", OperatorID: "1",
	}); err != ErrConnectionModeBlocked {
		t.Fatalf("banned err = %v", err)
	}
}

func TestConnectionModeConcurrentOperators(t *testing.T) {
	database := newTestDB(t)
	if err := database.UpsertPeer(&Peer{ID: "cmdevice7", UUID: "dXVpZC1jb25jdXJyZW50"}); err != nil {
		t.Fatalf("UpsertPeer: %v", err)
	}
	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make([]*ConnectionModeCommand, 2)
	errs := make([]error, 2)
	modes := []string{ConnectionModeIncomingOnly, ConnectionModeNormal}
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			results[i], _, errs[i] = database.IssueConnectionMode(&ConnectionModeIssue{
				DeviceID: "cmdevice7", Mode: modes[i], Reason: "race", OperatorID: "op", OperatorName: "op",
			})
		}(i)
	}
	close(start)
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("concurrent issue %d: %v", i, err)
		}
	}
	if results[0].Revision == results[1].Revision {
		t.Fatalf("concurrent revisions collided: %#v %#v", results[0], results[1])
	}
	active, err := database.DeliverableConnectionModeCommand("cmdevice7", time.Now().UTC())
	if err != nil || active == nil || active.Revision != 2 {
		t.Fatalf("expected one active revision 2, got %#v err=%v", active, err)
	}
}

func TestConnectionModeAckSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/restart.db"
	database, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := database.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := database.UpsertPeer(&Peer{ID: "cmdevice8", UUID: "dXVpZC1yZXN0YXJ0"}); err != nil {
		t.Fatalf("UpsertPeer: %v", err)
	}
	cmd, _, err := database.IssueConnectionMode(&ConnectionModeIssue{
		DeviceID: "cmdevice8", Mode: ConnectionModeIncomingOnly, Reason: "before restart", OperatorID: "9", OperatorName: "nina",
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if err := database.MarkConnectionModeDelivered(cmd.CommandID, time.Unix(cmd.IssuedAt, 0)); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if err := database.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	reopened, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	t.Cleanup(func() { reopened.Close() })
	if err := reopened.Migrate(); err != nil {
		t.Fatalf("remigrate: %v", err)
	}
	updated, err := reopened.AcknowledgeConnectionMode(&ConnectionModeAck{
		DeviceID: "cmdevice8", CommandID: cmd.CommandID, Revision: cmd.Revision,
		Status: ConnectionCommandApplied, EffectiveMode: ConnectionModeIncomingOnly,
	})
	if err != nil || !updated {
		t.Fatalf("ack after restart: updated=%v err=%v", updated, err)
	}
	latest, err := reopened.LatestConnectionModeCommand("cmdevice8")
	if err != nil || latest.Status != ConnectionCommandApplied || latest.CommandID != cmd.CommandID || latest.Revision != cmd.Revision {
		t.Fatalf("command after restart: %#v err=%v", latest, err)
	}
	if latest.OperatorID != "9" || latest.Reason != "before restart" || latest.PreviousMode != ConnectionModeNormal {
		t.Fatalf("audit lost across restart: %#v", latest)
	}
}
