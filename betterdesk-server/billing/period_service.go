package billing

import (
	"log"
	"time"

	"github.com/unitronix/betterdesk-server/db"
)

func (s *Service) nowUTC() time.Time {
	if s.clock != nil {
		return s.clock.NowUTC()
	}
	return time.Now().UTC()
}

func (s *Service) billingLocation() *time.Location {
	tz := ""
	if s.clock != nil {
		tz = s.clock.BillingTimezone()
	}
	if tz == "" {
		return time.UTC
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		log.Printf("[billing] invalid BILLING_TIMEZONE %q: %v — using UTC", tz, err)
		return time.UTC
	}
	return loc
}

func (s *Service) billingTimezoneName() string {
	if s.clock != nil {
		if tz := s.clock.BillingTimezone(); tz != "" {
			return tz
		}
	}
	return "UTC"
}

// EnsureContractPeriod resets remaining_minutes at month start while keeping history
// in billing_period_totals. Limit edits only affect the current period pool.
func (s *Service) EnsureContractPeriod(contract *db.BillingContract) error {
	if contract == nil {
		return nil
	}
	loc := s.billingLocation()
	now := s.nowUTC()
	period := string(PeriodYMAt(now, loc))
	if contract.CurrentPeriodYM == period {
		return nil
	}

	pkg, _ := s.db.GetBillingPackage(contract.PackageID)
	limit := contract.RemainingMinutes
	if pkg != nil {
		limit = pkg.IncludedMinutes
	}

	// Snapshot prior month usage into history if we are rolling forward.
	if contract.CurrentPeriodYM != "" && contract.CurrentPeriodYM != period {
		includedUsed := 0
		if pkg != nil {
			includedUsed = pkg.IncludedMinutes - contract.RemainingMinutes
			if includedUsed < 0 {
				includedUsed = 0
			}
		}
		// Do not overwrite session-driven totals — only seed limit snapshot / fill gap.
		existing, _ := s.db.GetBillingPeriodTotal(contract.ID, contract.CurrentPeriodYM)
		if existing == nil {
			_ = s.db.UpsertBillingPeriodTotal(&db.BillingPeriodTotal{
				ContractID:            contract.ID,
				PackageID:             contract.PackageID,
				PeriodYM:              contract.CurrentPeriodYM,
				Timezone:              s.billingTimezoneName(),
				IncludedMinutesUsed:   includedUsed,
				IncludedLimitSnapshot: limit,
			})
		} else if existing.IncludedLimitSnapshot == 0 && limit > 0 {
			existing.IncludedLimitSnapshot = limit
			_ = s.db.UpsertBillingPeriodTotal(existing)
		}
	}

	contract.CurrentPeriodYM = period
	if pkg != nil {
		contract.RemainingMinutes = pkg.IncludedMinutes
	}
	return s.db.UpdateBillingContract(contract)
}

func (s *Service) applyUsageToPeriod(contractID, packageID string, from, to time.Time, includedUsed, overageMin int, amountOverage float64, limitSnapshot int) {
	loc := s.billingLocation()
	period := string(PeriodYMAt(from, loc))
	_ = s.db.AddBillingPeriodUsage(contractID, packageID, period, s.billingTimezoneName(), includedUsed, overageMin, amountOverage, limitSnapshot)
	_ = to // reserved for multi-segment callers
}

// settleCrossingMonth splits active session usage at the billing-month boundary
// without interrupting the remote connection. Mutates a in place; syncs to the
// live map when the relay is still registered.
func (s *Service) settleCrossingMonth(a *activeSession) {
	if a == nil {
		return
	}
	loc := s.billingLocation()
	now := s.nowUTC()
	// Loop in case a session spans multiple month boundaries (rare / clock skew tests).
	for {
		boundary, ok := SplitAtMonthBoundary(a.StartedAt, now, loc)
		if !ok {
			break
		}

		rawSecs := int(boundary.Sub(a.StartedAt).Seconds())
		if rawSecs < 0 {
			rawSecs = 0
		}
		roundMin := s.roundMinForContract(a.ContractID)
		billedMin := roundUpMinutes(rawSecs, roundMin)
		includedUsed := min(billedMin, a.RemainingAtStart)
		overageMin := 0
		if billedMin > a.RemainingAtStart {
			overageMin = billedMin - a.RemainingAtStart
		}
		amountOverage := (float64(overageMin) / 60.0) * a.OverageRate

		contract, err := s.db.GetBillingContract(a.ContractID)
		packageID := ""
		limitSnap := a.RemainingAtStart + includedUsed
		if err == nil && contract != nil {
			packageID = contract.PackageID
			if pkg, _ := s.db.GetBillingPackage(packageID); pkg != nil {
				limitSnap = pkg.IncludedMinutes
			}
			newRemaining := contract.RemainingMinutes - includedUsed
			if newRemaining < 0 {
				newRemaining = 0
			}
			contract.RemainingMinutes = newRemaining
			_ = s.db.UpdateBillingContract(contract)
			_ = s.EnsureContractPeriod(contract)
			contract, _ = s.db.GetBillingContract(a.ContractID)
		}

		s.applyUsageToPeriod(a.ContractID, packageID, a.StartedAt, boundary, includedUsed, overageMin, amountOverage, limitSnap)

		_ = s.db.InsertBillingLedgerEntry(&db.BillingSessionLedger{
			SessionID: a.ID,
			EventType: "month_boundary",
			Details:   string(PeriodYMAt(a.StartedAt, loc)) + "->" + string(PeriodYMAt(boundary, loc)),
		})

		if sess, err := s.db.GetBillingSession(a.ID); err == nil && sess != nil {
			sess.BilledMinutes += billedMin
			sess.IncludedMinutesUsed += includedUsed
			sess.OverageMinutes += overageMin
			sess.AmountOverage += amountOverage
			sess.AmountIncluded += (float64(includedUsed) / 60.0) * a.HourlyRate
			_ = s.db.UpdateBillingSession(sess)
		}

		a.StartedAt = boundary
		a.LastBilledMin = 0
		a.Phase = PhaseIncluded
		if contract != nil {
			a.RemainingAtStart = contract.RemainingMinutes
		} else {
			a.RemainingAtStart = 0
		}

		s.mu.Lock()
		if cur, ok := s.active[a.RelayUUID]; ok {
			cur.StartedAt = a.StartedAt
			cur.LastBilledMin = 0
			cur.RemainingAtStart = a.RemainingAtStart
			cur.Phase = PhaseIncluded
		}
		s.mu.Unlock()
	}
}

func (s *Service) roundMinForContract(contractID string) int {
	if contract, err := s.db.GetBillingContract(contractID); err == nil && contract != nil {
		if pkg, err := s.db.GetBillingPackage(contract.PackageID); err == nil && pkg != nil && pkg.RoundingMinutes > 0 {
			return pkg.RoundingMinutes
		}
	}
	return s.roundMin
}
