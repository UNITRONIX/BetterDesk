package db

import "time"

// BillingPeriodTotal is an immutable monthly usage snapshot for a contract.
// Limit edits later must not rewrite historical rows — only current remaining_minutes.
type BillingPeriodTotal struct {
	ID                   int64     `json:"id,omitempty"`
	ContractID           string    `json:"contract_id"`
	PackageID            string    `json:"package_id"`
	PeriodYM             string    `json:"period_ym"` // YYYY-MM in billing timezone
	Timezone             string    `json:"timezone"`
	IncludedMinutesUsed  int       `json:"included_minutes_used"`
	OverageMinutes       int       `json:"overage_minutes"`
	AmountOverage        float64   `json:"amount_overage"`
	IncludedLimitSnapshot int      `json:"included_limit_snapshot"` // package/contract limit at period open
	UpdatedAt            time.Time `json:"updated_at"`
}
