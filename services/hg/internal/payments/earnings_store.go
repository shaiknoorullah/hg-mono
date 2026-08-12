package payments

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Rider earnings and payout reads (D-26..D-28 / P-19). The earning_entry table
// mirrors RIDER_PAYABLE postings; the ledger remains the source of truth.

// EarningEntryRow is an earning_entry read back for the API.
type EarningEntryRow struct {
	ID                  string
	AssignmentID        *string
	OrderCode           *string
	Type                string
	Status              string
	BaseCents           int64
	DistanceCents       int64
	WaitCents           int64
	SurgeMultiplierBps  int32
	GuaranteeTopupCents int64
	TipCents            int64
	AdjustmentCents     int64
	GrossCents          int64
	Currency            string
	BillableDistanceM   *int32
	DistanceSource      *string
	FormulaVersion      int32
	PayoutID            *string
	EarnedAt            time.Time
}

const earningSelect = `
	SELECT id::text, assignment_id::text, order_code, type::text, status::text,
	       base_cents, distance_cents, wait_cents, surge_multiplier_bps,
	       guarantee_topup_cents, tip_cents, adjustment_cents, gross_cents, currency::text,
	       billable_distance_m, distance_source::text, formula_version, payout_id::text, earned_at
	  FROM earning_entry`

func scanEarning(rows pgx.Rows) (EarningEntryRow, error) {
	var e EarningEntryRow
	err := rows.Scan(&e.ID, &e.AssignmentID, &e.OrderCode, &e.Type, &e.Status,
		&e.BaseCents, &e.DistanceCents, &e.WaitCents, &e.SurgeMultiplierBps,
		&e.GuaranteeTopupCents, &e.TipCents, &e.AdjustmentCents, &e.GrossCents, &e.Currency,
		&e.BillableDistanceM, &e.DistanceSource, &e.FormulaVersion, &e.PayoutID, &e.EarnedAt)
	return e, err
}

// ListEarningEntriesFilter narrows a rider's earnings ledger.
type ListEarningEntriesFilter struct {
	AccountID string
	Types     []string
	Limit     int
	AfterID   string
}

// ListEarningEntries returns a rider's earnings ledger, newest first.
func (r *Repo) ListEarningEntries(ctx context.Context, f ListEarningEntriesFilter) ([]EarningEntryRow, error) {
	sql := earningSelect + ` WHERE account_id = $1`
	args := []any{f.AccountID}
	if len(f.Types) > 0 {
		args = append(args, f.Types)
		sql += " AND type = ANY($2)"
	}
	if f.AfterID != "" {
		args = append(args, f.AfterID)
		sql += " AND id < $" + itoa(len(args))
	}
	limit := f.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	sql += " ORDER BY id DESC LIMIT " + itoa(limit)

	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]EarningEntryRow, 0)
	for rows.Next() {
		e, err := scanEarning(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// UnpaidBalanceCents returns the sum of a rider's not-yet-paid earnings.
func (r *Repo) UnpaidBalanceCents(ctx context.Context, accountID string) (int64, error) {
	var sum int64
	err := r.pool.QueryRow(ctx, `
		SELECT coalesce(sum(gross_cents),0) FROM earning_entry
		 WHERE account_id = $1 AND payout_id IS NULL AND status <> 'REVERSED'`, accountID).Scan(&sum)
	return sum, err
}

// EarningsBucketRow aggregates earnings for one time bucket.
type EarningsBucketRow struct {
	BucketStart     time.Time
	GrossCents      int64
	DeliveryCents   int64
	TipCents        int64
	BonusCents      int64
	AdjustmentCents int64
	Trips           int32
}

// EarningsBuckets aggregates a rider's earnings between [from, to) truncated to
// the given unit ('day' | 'week' | 'month') in the given timezone.
func (r *Repo) EarningsBuckets(ctx context.Context, accountID, unit, tz string, from, to time.Time) ([]EarningsBucketRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT date_trunc($2, earned_at AT TIME ZONE $3) AS bucket,
		       coalesce(sum(gross_cents),0),
		       coalesce(sum(CASE WHEN type = 'DELIVERY' THEN gross_cents ELSE 0 END),0),
		       coalesce(sum(tip_cents),0),
		       coalesce(sum(CASE WHEN type = 'BONUS' THEN gross_cents ELSE 0 END),0),
		       coalesce(sum(adjustment_cents),0),
		       coalesce(count(*) FILTER (WHERE type = 'DELIVERY'),0)::int
		  FROM earning_entry
		 WHERE account_id = $1 AND earned_at >= $4 AND earned_at < $5
		 GROUP BY bucket ORDER BY bucket`, accountID, unit, tz, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]EarningsBucketRow, 0)
	for rows.Next() {
		var b EarningsBucketRow
		if err := rows.Scan(&b.BucketStart, &b.GrossCents, &b.DeliveryCents,
			&b.TipCents, &b.BonusCents, &b.AdjustmentCents, &b.Trips); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Payouts.
// ---------------------------------------------------------------------------

// PayoutRow is a payout read back for the API.
type PayoutRow struct {
	ID             string
	PeriodStart    time.Time
	PeriodEnd      time.Time
	AmountCents    int64
	Currency       string
	State          string
	HoldReason     *string
	EntryCount     int32
	PaidAt         *time.Time
	FailureMessage *string
}

const payoutSelect = `
	SELECT p.id::text, p.period_start, p.period_end, p.amount_cents, p.currency::text,
	       p.state::text, p.hold_reason, p.entry_count, p.paid_at, p.failure_message
	  FROM payout p
	  JOIN connect_account ca ON ca.id = p.connect_account_id`

func scanPayout(rows pgx.Rows) (PayoutRow, error) {
	var p PayoutRow
	err := rows.Scan(&p.ID, &p.PeriodStart, &p.PeriodEnd, &p.AmountCents, &p.Currency,
		&p.State, &p.HoldReason, &p.EntryCount, &p.PaidAt, &p.FailureMessage)
	return p, err
}

// ListPayoutsFilter narrows a partner's payout history.
type ListPayoutsFilter struct {
	OwnerType string // 'RIDER' | 'RESTAURANT'
	OwnerID   string
	Limit     int
	AfterID   string
}

// ListPayouts returns a partner's payouts, newest first.
func (r *Repo) ListPayouts(ctx context.Context, f ListPayoutsFilter) ([]PayoutRow, error) {
	sql := payoutSelect + ` WHERE ca.owner_type = $1 AND ca.owner_id = $2`
	args := []any{f.OwnerType, f.OwnerID}
	if f.AfterID != "" {
		args = append(args, f.AfterID)
		sql += " AND p.id < $3"
	}
	limit := f.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	sql += " ORDER BY p.id DESC LIMIT " + itoa(limit)

	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]PayoutRow, 0)
	for rows.Next() {
		p, err := scanPayout(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetPayout returns one payout owned by the partner, or ErrNotFound.
func (r *Repo) GetPayout(ctx context.Context, ownerType, ownerID, payoutID string) (PayoutRow, error) {
	rows, err := r.pool.Query(ctx,
		payoutSelect+` WHERE ca.owner_type = $1 AND ca.owner_id = $2 AND p.id = $3`,
		ownerType, ownerID, payoutID)
	if err != nil {
		return PayoutRow{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return PayoutRow{}, ErrNotFound
	}
	return scanPayout(rows)
}

// GetPayoutByID returns one payout by its id, ignoring ownership.
func (r *Repo) GetPayoutByID(ctx context.Context, payoutID string) (PayoutRow, error) {
	rows, err := r.pool.Query(ctx, payoutSelect+` WHERE p.id = $1`, payoutID)
	if err != nil {
		return PayoutRow{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return PayoutRow{}, ErrNotFound
	}
	return scanPayout(rows)
}

// PayoutEntries returns the earning entries stamped with a payout's id.
func (r *Repo) PayoutEntries(ctx context.Context, payoutID string) ([]EarningEntryRow, error) {
	rows, err := r.pool.Query(ctx, earningSelect+` WHERE payout_id = $1 ORDER BY earned_at`, payoutID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]EarningEntryRow, 0)
	for rows.Next() {
		e, err := scanEarning(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Connect account.
// ---------------------------------------------------------------------------

// ConnectRow is a connect_account read back.
type ConnectRow struct {
	ID               string
	StripeAccountID  string
	ChargesEnabled   bool
	PayoutsEnabled   bool
	DetailsSubmitted bool
	DisabledReason   *string
	CurrentlyDue     []string
	EventuallyDue    []string
	PastDue          []string
	PayoutInterval   string
}

// GetConnectAccount returns a partner's connect_account or ErrNotFound.
func (r *Repo) GetConnectAccount(ctx context.Context, ownerType, ownerID string) (ConnectRow, error) {
	var c ConnectRow
	var reqs []byte
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, stripe_account_id, charges_enabled, payouts_enabled, details_submitted,
		       disabled_reason, requirements, payout_interval::text
		  FROM connect_account WHERE owner_type = $1 AND owner_id = $2`,
		ownerType, ownerID).Scan(&c.ID, &c.StripeAccountID, &c.ChargesEnabled, &c.PayoutsEnabled,
		&c.DetailsSubmitted, &c.DisabledReason, &reqs, &c.PayoutInterval)
	if errors.Is(err, pgx.ErrNoRows) {
		return ConnectRow{}, ErrNotFound
	}
	if err != nil {
		return ConnectRow{}, err
	}
	c.CurrentlyDue, c.EventuallyDue, c.PastDue = parseRequirements(reqs)
	return c, nil
}

// itoa is a tiny local int→string to keep query builders import-light.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
