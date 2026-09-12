package db

import (
	"testing"
	"time"
)

func TestTelemetrySnapshotsAndCommands(t *testing.T) {
	database := newTestDB(t)

	err := database.SaveTelemetrySnapshot(&TelemetrySnapshot{
		DeviceID:    "TEL123",
		Kind:        "metrics",
		SampleID:    "sample-1",
		Status:      "ok",
		Payload:     `{"cpu_percent":12.5}`,
		CollectedAt: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("SaveTelemetrySnapshot: %v", err)
	}

	snapshot, err := database.GetTelemetrySnapshot("TEL123", "metrics")
	if err != nil {
		t.Fatalf("GetTelemetrySnapshot: %v", err)
	}
	if snapshot == nil || snapshot.SampleID != "sample-1" || snapshot.Status != "ok" {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}

	commandID, err := database.QueueTelemetryCommand(&TelemetryCommand{
		DeviceID:  "TEL123",
		Command:   "collect.metrics",
		Args:      `{}`,
		ExpiresAt: time.Now().UTC().Add(time.Minute).Format("2006-01-02 15:04:05"),
	})
	if err != nil {
		t.Fatalf("QueueTelemetryCommand: %v", err)
	}
	commands, err := database.GetPendingTelemetryCommands("TEL123", 10)
	if err != nil {
		t.Fatalf("GetPendingTelemetryCommands: %v", err)
	}
	if len(commands) != 1 || commands[0].ID != commandID {
		t.Fatalf("unexpected commands: %#v", commands)
	}

	if err := database.CompleteTelemetryCommand(commandID, "ok", `{"status":"ok"}`); err != nil {
		t.Fatalf("CompleteTelemetryCommand: %v", err)
	}
	commands, err = database.GetPendingTelemetryCommands("TEL123", 10)
	if err != nil {
		t.Fatalf("GetPendingTelemetryCommands after completion: %v", err)
	}
	if len(commands) != 0 {
		t.Fatalf("completed command still pending: %#v", commands)
	}
}
