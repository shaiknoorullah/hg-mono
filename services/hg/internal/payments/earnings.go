package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// Earnings and payout read services (D-26..D-28 / P-19), plus Connect status.

// ListEarningEntries returns a rider's earnings ledger as wire DTOs.
func (s *Service) ListEarningEntries(ctx context.Context, f ListEarningEntriesFilter) ([]EarningEntryDTO, error) {
	rows, err := s.repo.ListEarningEntries(ctx, f)
	if err != nil {
		return nil, err
	}
	out := make([]EarningEntryDTO, 0, len(rows))
	for _, e := range rows {
		out = append(out, earningToDTO(e))
	}
	return out, nil
}

func earningToDTO(e EarningEntryRow) EarningEntryDTO {
	return EarningEntryDTO{
		ID:                  e.ID,
		AssignmentID:        e.AssignmentID,
		OrderCode:           e.OrderCode,
		Type:                e.Type,
		Status:              e.Status,
		BaseCents:           e.BaseCents,
		DistanceCents:       e.DistanceCents,
		WaitCents:           e.WaitCents,
		SurgeMultiplier:     bpsToDecimal(e.SurgeMultiplierBps),
		GuaranteeTopupCents: e.GuaranteeTopupCents,
		TipCents:            e.TipCents,
		AdjustmentCents:     e.AdjustmentCents,
		GrossCents:          e.GrossCents,
		Currency:            e.Currency,
		BillableDistanceM:   e.BillableDistanceM,
		DistanceSource:      e.DistanceSource,
		FormulaVersion:      e.FormulaVersion,
		PayoutID:            e.PayoutID,
		EarnedAt:            tsFor(e.EarnedAt),
	}
}

// bpsToDecimal renders a basis-point surge multiplier as an exact decimal
// string frozen at offer time (never a float): 10000 → "1.00".
func bpsToDecimal(bps int32) string {
	if bps < 0 {
		bps = 0
	}
	whole := bps / 10000
	frac := (bps % 10000) / 100 // two decimal places
	return fmt.Sprintf("%d.%02d", whole, frac)
}

// EarningsSummary returns bucketed totals in the rider's timezone, zero-filled
// so a chart cannot lie by omission (D-27). The unpaid balance and next payout
// come from the ledger and the weekly-Monday schedule (S-04).
func (s *Service) EarningsSummary(ctx context.Context, accountID, period, tz string, from, to time.Time) (EarningsSummaryDTO, error) {
	unit := "week"
	switch period {
	case "DAY":
		unit = "day"
	case "WEEK":
		unit = "week"
	case "MONTH":
		unit = "month"
	default:
		return EarningsSummaryDTO{}, domainErr("VALIDATION_FAILED", 422, "period must be DAY, WEEK or MONTH")
	}
	if tz == "" {
		tz = "America/Toronto"
	}
	rows, err := s.repo.EarningsBuckets(ctx, accountID, unit, tz, from, to)
	if err != nil {
		return EarningsSummaryDTO{}, err
	}
	unpaid, err := s.repo.UnpaidBalanceCents(ctx, accountID)
	if err != nil {
		return EarningsSummaryDTO{}, err
	}

	byStart := make(map[string]EarningsBucketRow, len(rows))
	for _, b := range rows {
		byStart[b.BucketStart.UTC().Format(time.RFC3339)] = b
	}

	buckets := make([]EarningsBucketDTO, 0)
	var total EarningsBucketDTO
	// Zero-fill each period step in [from, to).
	for cur := from; cur.Before(to); cur = stepBucket(cur, unit) {
		key := cur.UTC().Format(time.RFC3339)
		b := byStart[key]
		dto := EarningsBucketDTO{
			BucketStart:     tsFor(cur),
			GrossCents:      b.GrossCents,
			DeliveryCents:   b.DeliveryCents,
			TipCents:        b.TipCents,
			BonusCents:      b.BonusCents,
			AdjustmentCents: b.AdjustmentCents,
			Trips:           b.Trips,
		}
		buckets = append(buckets, dto)
		total.GrossCents += b.GrossCents
		total.DeliveryCents += b.DeliveryCents
		total.TipCents += b.TipCents
		total.BonusCents += b.BonusCents
		total.AdjustmentCents += b.AdjustmentCents
		total.Trips += b.Trips
	}
	total.BucketStart = tsFor(from)

	// The next automatic payout run: Monday 09:00 America/Toronto
	// (payout_schedule.go).
	nextStr := tsFor(nextScheduledRun(s.now()))
	return EarningsSummaryDTO{
		Period:             period,
		Buckets:            buckets,
		Total:              total,
		UnpaidBalanceCents: unpaid,
		NextPayoutAt:       &nextStr,
		Currency:           "CAD",
	}, nil
}

func stepBucket(t time.Time, unit string) time.Time {
	switch unit {
	case "day":
		return t.AddDate(0, 0, 1)
	case "month":
		return t.AddDate(0, 1, 0)
	default: // week
		return t.AddDate(0, 0, 7)
	}
}

// ---------------------------------------------------------------------------
// Payouts.
// ---------------------------------------------------------------------------

// ListPayouts returns a partner's payout history.
func (s *Service) ListPayouts(ctx context.Context, f ListPayoutsFilter) ([]PayoutDTO, error) {
	rows, err := s.repo.ListPayouts(ctx, f)
	if err != nil {
		return nil, err
	}
	out := make([]PayoutDTO, 0, len(rows))
	for _, p := range rows {
		out = append(out, payoutToDTO(p))
	}
	return out, nil
}

// GetPayoutDetail returns one payout and its contributing entries.
func (s *Service) GetPayoutDetail(ctx context.Context, ownerType, ownerID, payoutID string) (PayoutDetailDTO, error) {
	p, err := s.repo.GetPayout(ctx, ownerType, ownerID, payoutID)
	if errors.Is(err, ErrNotFound) {
		return PayoutDetailDTO{}, domainErr(httpxNotFound, 404, "No such payout.")
	}
	if err != nil {
		return PayoutDetailDTO{}, err
	}
	entries, err := s.repo.PayoutEntries(ctx, payoutID)
	if err != nil {
		return PayoutDetailDTO{}, err
	}
	dtoEntries := make([]EarningEntryDTO, 0, len(entries))
	for _, e := range entries {
		dtoEntries = append(dtoEntries, earningToDTO(e))
	}
	return PayoutDetailDTO{PayoutDTO: payoutToDTO(p), Entries: dtoEntries}, nil
}

func payoutToDTO(p PayoutRow) PayoutDTO {
	return PayoutDTO{
		ID:             p.ID,
		PeriodStart:    tsFor(p.PeriodStart),
		PeriodEnd:      tsFor(p.PeriodEnd),
		AmountCents:    p.AmountCents,
		Currency:       p.Currency,
		State:          p.State,
		HoldReason:     p.HoldReason,
		EntryCount:     p.EntryCount,
		PaidAt:         tsPtr(p.PaidAt),
		FailureMessage: p.FailureMessage,
	}
}

// ---------------------------------------------------------------------------
// Connect status (P-19).
// ---------------------------------------------------------------------------

// GetConnectStatus returns a partner's payout-account readiness, surfacing
// Stripe's requirement lists verbatim (P-19). A partner with no connect_account
// yet returns a zeroed, not-ready status rather than 404 so onboarding can
// render the "start" state.
func (s *Service) GetConnectStatus(ctx context.Context, ownerType, ownerID string) (ConnectStatusDTO, error) {
	c, err := s.repo.GetConnectAccount(ctx, ownerType, ownerID)
	if errors.Is(err, ErrNotFound) {
		return ConnectStatusDTO{
			ChargesEnabled: false, PayoutsEnabled: false, DetailsSubmitted: false,
			Requirements:   ConnectRequirementsDTO{CurrentlyDue: []string{}, EventuallyDue: []string{}, PastDue: []string{}},
			PayoutInterval: "WEEKLY",
		}, nil
	}
	if err != nil {
		return ConnectStatusDTO{}, err
	}
	return s.connectStatusFrom(c), nil
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// parseRequirements pulls the three Stripe requirement lists and the optional
// deadline out of the stored requirements JSONB, tolerating an empty or absent
// object. The deadline is a Unix timestamp stored under "requirements_deadline"
// (embedded when a Stripe account has a current_deadline set).
func parseRequirements(raw []byte) (currentlyDue, eventuallyDue, pastDue []string, deadline *int64) {
	if len(raw) == 0 {
		return nil, nil, nil, nil
	}
	var r struct {
		CurrentlyDue         []string `json:"currently_due"`
		EventuallyDue        []string `json:"eventually_due"`
		PastDue              []string `json:"past_due"`
		RequirementsDeadline *int64   `json:"requirements_deadline"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, nil, nil, nil
	}
	return r.CurrentlyDue, r.EventuallyDue, r.PastDue, r.RequirementsDeadline
}
