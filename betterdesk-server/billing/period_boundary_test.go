package billing

import (
	"testing"
	"time"
)

func TestSplitAtMonthBoundaryMidnightWarsaw(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Warsaw")
	if err != nil {
		t.Fatal(err)
	}
	// 31 Mar 2026 23:50 Warsaw
	from := time.Date(2026, 3, 31, 23, 50, 0, 0, loc)
	// 1 Apr 2026 00:10 Warsaw
	to := time.Date(2026, 4, 1, 0, 10, 0, 0, loc)
	if !CrossesMonthBoundary(from, to, loc) {
		t.Fatal("expected month boundary cross")
	}
	boundary, ok := SplitAtMonthBoundary(from, to, loc)
	if !ok {
		t.Fatal("expected boundary")
	}
	if PeriodYMAt(from, loc) != "2026-03" || PeriodYMAt(boundary, loc) != "2026-04" {
		t.Fatalf("periods: from=%s boundary=%s", PeriodYMAt(from, loc), PeriodYMAt(boundary, loc))
	}
	if !boundary.Equal(time.Date(2026, 4, 1, 0, 0, 0, 0, loc)) {
		t.Fatalf("boundary = %v", boundary)
	}
}

func TestPeriodYMAtDoesNotChangeOnLimitEdit(t *testing.T) {
	// History immutability is enforced by storing included_limit_snapshot on period totals;
	// this smoke test only verifies period keys stay calendar-stable.
	loc := time.UTC
	p1 := PeriodYMAt(time.Date(2026, 1, 15, 12, 0, 0, 0, loc), loc)
	p2 := PeriodYMAt(time.Date(2026, 2, 1, 0, 0, 0, 0, loc), loc)
	if p1 == p2 {
		t.Fatal("January and February must differ")
	}
}
