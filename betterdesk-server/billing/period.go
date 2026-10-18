package billing

import (
	"fmt"
	"time"
)

// PeriodYM is a billing calendar month key in the configured timezone (YYYY-MM).
type PeriodYM string

// PeriodYMAt returns the billing period for instant t in loc.
func PeriodYMAt(t time.Time, loc *time.Location) PeriodYM {
	if loc == nil {
		loc = time.UTC
	}
	local := t.In(loc)
	return PeriodYM(fmt.Sprintf("%04d-%02d", local.Year(), int(local.Month())))
}

// MonthBounds returns [start, end) for periodYM in loc (end = first instant of next month).
func MonthBounds(period PeriodYM, loc *time.Location) (start, end time.Time, err error) {
	if loc == nil {
		loc = time.UTC
	}
	var y, m int
	if _, err = fmt.Sscanf(string(period), "%d-%d", &y, &m); err != nil || y < 1970 || m < 1 || m > 12 {
		return time.Time{}, time.Time{}, fmt.Errorf("invalid period %q", period)
	}
	start = time.Date(y, time.Month(m), 1, 0, 0, 0, 0, loc)
	end = start.AddDate(0, 1, 0)
	return start, end, nil
}

// CrossesMonthBoundary reports whether [from, to] spans more than one billing month in loc.
func CrossesMonthBoundary(from, to time.Time, loc *time.Location) bool {
	return PeriodYMAt(from, loc) != PeriodYMAt(to, loc)
}

// SplitAtMonthBoundary returns the instant of the next month start after from (in loc),
// if to is after that boundary. Otherwise returns zero time and false.
func SplitAtMonthBoundary(from, to time.Time, loc *time.Location) (boundary time.Time, ok bool) {
	if !CrossesMonthBoundary(from, to, loc) {
		return time.Time{}, false
	}
	period := PeriodYMAt(from, loc)
	_, end, err := MonthBounds(period, loc)
	if err != nil {
		return time.Time{}, false
	}
	if !to.After(end) {
		return time.Time{}, false
	}
	return end, true
}
