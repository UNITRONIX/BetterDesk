package db

import (
	"testing"
	"time"
)

// A running session has no ended_at (NULL). Listing and reading it must work,
// otherwise GET /api/billing/sessions fails as soon as one session is open.
func TestSQLiteBillingSessionsListRunningSession(t *testing.T) {
	db := newTestDB(t)
	started := time.Now().UTC().Add(-5 * time.Minute).Truncate(time.Second)
	ended := started.Add(3 * time.Minute)

	running := &BillingSession{
		ID: "sess-running", OrgID: "org-1", DeviceID: "dev-1",
		Status: "active", BillingPhase: "included", Currency: "EUR", StartedAt: started,
	}
	closed := &BillingSession{
		ID: "sess-closed", OrgID: "org-1", DeviceID: "dev-2",
		Status: "closed", BillingPhase: "included", Currency: "EUR",
		StartedAt: started.Add(-time.Hour), EndedAt: &ended,
	}
	for _, s := range []*BillingSession{running, closed} {
		if err := db.CreateBillingSession(s); err != nil {
			t.Fatalf("CreateBillingSession(%s): %v", s.ID, err)
		}
	}

	list, err := db.ListBillingSessions(BillingSessionFilter{})
	if err != nil {
		t.Fatalf("ListBillingSessions: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("want 2 sessions, got %d", len(list))
	}
	byID := map[string]*BillingSession{}
	for _, s := range list {
		byID[s.ID] = s
	}
	if r := byID["sess-running"]; r == nil || r.EndedAt != nil || !r.StartedAt.Equal(started) {
		t.Fatalf("running session wrong: %+v", r)
	}
	if c := byID["sess-closed"]; c == nil || c.EndedAt == nil || !c.EndedAt.Equal(ended) {
		t.Fatalf("closed session wrong: %+v", c)
	}

	active, err := db.ListBillingSessions(BillingSessionFilter{Status: "active"})
	if err != nil || len(active) != 1 || active[0].ID != "sess-running" {
		t.Fatalf("ListBillingSessions(active) = %v, %v", active, err)
	}
	got, err := db.GetBillingSession("sess-running")
	if err != nil || got.EndedAt != nil {
		t.Fatalf("GetBillingSession = %+v, %v", got, err)
	}
	if _, err := db.GetBillingSessionByRelayUUID(""); err != nil {
		t.Fatalf("GetBillingSessionByRelayUUID: %v", err)
	}
}

// Older SQLite schemas allow NULL in the optional text columns and timestamps.
func TestSQLiteBillingNullableColumns(t *testing.T) {
	db := newTestDB(t)
	mustExec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.db.Exec(q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	mustExec(`INSERT INTO billing_packages (id, name, description, included_minutes, overage_rate, currency, created_at, updated_at)
		VALUES ('pkg-1', 'Basic', NULL, 60, 1.5, 'EUR', NULL, NULL)`)
	mustExec(`INSERT INTO billing_session_ledger (session_id, event_type, details, created_at) VALUES ('s1', 'start', NULL, NULL)`)
	mustExec(`INSERT INTO billing_sessions (id, org_id, device_id, started_at, created_at, updated_at) VALUES ('s1', 'org-1', 'dev-1', datetime('now'), NULL, NULL)`)
	mustExec(`INSERT INTO billing_work_reports (session_id, summary, category, ticket_ref, created_at) VALUES ('s1', 'Fixed it', NULL, NULL, NULL)`)
	mustExec(`INSERT INTO billing_period_totals (contract_id, period_ym, updated_at) VALUES ('c1', '2026-11', NULL)`)

	if p, err := db.GetBillingPackage("pkg-1"); err != nil || p.Description != "" {
		t.Fatalf("GetBillingPackage = %+v, %v", p, err)
	}
	if ps, err := db.ListBillingPackages(); err != nil || len(ps) != 1 {
		t.Fatalf("ListBillingPackages = %v, %v", ps, err)
	}
	if es, err := db.ListBillingLedger("s1"); err != nil || len(es) != 1 {
		t.Fatalf("ListBillingLedger = %v, %v", es, err)
	}
	if s, err := db.GetBillingSession("s1"); err != nil || s.EndedAt != nil {
		t.Fatalf("GetBillingSession = %+v, %v", s, err)
	}
	if r, err := db.GetBillingWorkReportBySession("s1"); err != nil || r.Category != "" || r.TicketRef != "" {
		t.Fatalf("GetBillingWorkReportBySession = %+v, %v", r, err)
	}
	if rs, err := db.ListBillingWorkReports("org-1", 10); err != nil || len(rs) != 1 {
		t.Fatalf("ListBillingWorkReports = %v, %v", rs, err)
	}
	if pt, err := db.GetBillingPeriodTotal("c1", "2026-11"); err != nil || pt == nil {
		t.Fatalf("GetBillingPeriodTotal = %+v, %v", pt, err)
	}
	if pts, err := db.ListBillingPeriodTotalsByContract("c1"); err != nil || len(pts) != 1 {
		t.Fatalf("ListBillingPeriodTotalsByContract = %v, %v", pts, err)
	}
}
