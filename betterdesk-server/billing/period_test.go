package billing

import (
	"testing"
	"time"
)

func TestPeriodYMAtWarsaw(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Warsaw")
	if err != nil {
		t.Fatal(err)
	}
	// 2026-03-31 23:30 Warsaw
	ts := time.Date(2026, 3, 31, 23, 30, 0, 0, loc)
	if got := PeriodYMAt(ts, loc); got != "2026-03" {
		t.Fatalf("got %s", got)
	}
	// Just after midnight April 1 Warsaw
	ts2 := time.Date(2026, 4, 1, 0, 10, 0, 0, loc)
	if got := PeriodYMAt(ts2, loc); got != "2026-04" {
		t.Fatalf("got %s", got)
	}
}

func TestSplitAtMonthBoundary(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Warsaw")
	if err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, 3, 31, 23, 50, 0, 0, loc)
	to := time.Date(2026, 4, 1, 0, 10, 0, 0, loc)
	boundary, ok := SplitAtMonthBoundary(from, to, loc)
	if !ok {
		t.Fatal("expected boundary")
	}
	want := time.Date(2026, 4, 1, 0, 0, 0, 0, loc)
	if !boundary.Equal(want) {
		t.Fatalf("boundary %v want %v", boundary, want)
	}
	if CrossesMonthBoundary(from, from.Add(5*time.Minute), loc) {
		t.Fatal("same month should not cross")
	}
}
