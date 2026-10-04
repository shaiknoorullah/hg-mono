package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Storage for the weekly payout run (issue #251): the payout_run and
// payout_run_line tables, the payout lifecycle from READY to PAID, and the
// restaurant order block. Migration 00030_payout_run.sql.

// Payee types, matching connect_account.owner_type.
const (
	PayeeRestaurant = "RESTAURANT"
	PayeeRider      = "RIDER"
)

// PayeeRef names the partner a payout is paid to: a restaurant by its
// restaurant id, a rider by their account id.
type PayeeRef struct {
	Type string
	ID   string
}

// Payout run kinds and states, mirroring the payout_run_kind and
// payout_run_state enums.
const (
	RunScheduled = "SCHEDULED"
	RunAdmin     = "ADMIN"

	RunQueued    = "QUEUED"
	RunRunning   = "RUNNING"
	RunSucceeded = "SUCCEEDED"
	RunFailed    = "FAILED"
)

// PayoutRunOutcome is what a run did for one partner: the payout_run_outcome
// enum, and the contract's PayoutRunOutcome.
type PayoutRunOutcome string

const (
	OutcomePaid             PayoutRunOutcome = "PAID"
	OutcomeHeld             PayoutRunOutcome = "HELD"
	OutcomeStillHeld        PayoutRunOutcome = "STILL_HELD"
	OutcomeReleased         PayoutRunOutcome = "RELEASED"
	OutcomeTransferFailed   PayoutRunOutcome = "TRANSFER_FAILED"
	OutcomeAlreadyPaid      PayoutRunOutcome = "ALREADY_PAID"
	OutcomeNothingDue       PayoutRunOutcome = "NOTHING_DUE"
	OutcomeCarriedNegative  PayoutRunOutcome = "CARRIED_NEGATIVE"
	OutcomeNoPayoutAccount  PayoutRunOutcome = "NO_PAYOUT_ACCOUNT"
	OutcomePartnerSuspended PayoutRunOutcome = "PARTNER_SUSPENDED"
	OutcomeOrdersBlocked    PayoutRunOutcome = "ORDERS_BLOCKED"
	OutcomeOrdersUnblocked  PayoutRunOutcome = "ORDERS_UNBLOCKED"
	OutcomeError            PayoutRunOutcome = "ERROR"
)

// PayoutRunRow is one payout_run row.
type PayoutRunRow struct {
	ID          string
	Kind        string
	State       string
	PeriodStart time.Time
	PeriodEnd   time.Time
	AsOf        time.Time
	DueAt       time.Time
	Payee       *PayeeRef
	RequestedBy *string
	Fingerprint *string
	Attempts    int32
	StartedAt   *time.Time
	FinishedAt  *time.Time
	Partners    int32
	Paid        int32
	Held        int32
	Released    int32
	Carried     int32
	Failed      int32
	PaidCents   int64
	HeldCents   int64
	Error       *string
	CreatedAt   time.Time
}

// PayoutRunLineRow is one payout_run_line row.
type PayoutRunLineRow struct {
	Payee       PayeeRef
	Outcome     PayoutRunOutcome
	PayoutID    *string
	AmountCents int64
	Detail      *string
	At          time.Time
}

const payoutRunColumns = `
	id::text, kind::text, state::text, period_start, period_end, as_of, due_at,
	payee_type, payee_id::text, requested_by::text, request_fingerprint, attempts,
	started_at, finished_at, partners, paid, held, released, carried, failed,
	paid_cents, held_cents, error, created_at`

func scanPayoutRun(row pgx.Row) (PayoutRunRow, error) {
	var r PayoutRunRow
	var payeeType, payeeID *string
	err := row.Scan(&r.ID, &r.Kind, &r.State, &r.PeriodStart, &r.PeriodEnd, &r.AsOf, &r.DueAt,
		&payeeType, &payeeID, &r.RequestedBy, &r.Fingerprint, &r.Attempts,
		&r.StartedAt, &r.FinishedAt, &r.Partners, &r.Paid, &r.Held, &r.Released, &r.Carried, &r.Failed,
		&r.PaidCents, &r.HeldCents, &r.Error, &r.CreatedAt)
	if err != nil {
		return r, err
	}
	if payeeType != nil && payeeID != nil {
		r.Payee = &PayeeRef{Type: *payeeType, ID: *payeeID}
	}
	return r, nil
}

// ensureScheduledRun inserts the automatic run for a closed period, once: the
// unique index on period_end makes a second insert, from any replica, a no-op.
func (r *Repo) ensureScheduledRun(ctx context.Context, p PayoutPeriod, due time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO payout_run (kind, period_start, period_end, as_of, due_at)
		VALUES ('SCHEDULED', $1, $2, $3, $3)
		ON CONFLICT (period_end) WHERE kind = 'SCHEDULED' DO NOTHING`,
		p.Start, p.End, due)
	return err
}

// nextDueRun returns the oldest unfinished run due by now, or ErrNotFound.
// Only the replica holding the payout lease calls it, so it takes no row
// lock.
func (r *Repo) nextDueRun(ctx context.Context, now time.Time) (PayoutRunRow, error) {
	run, err := scanPayoutRun(r.pool.QueryRow(ctx, `
		SELECT `+payoutRunColumns+`
		  FROM payout_run
		 WHERE finished_at IS NULL AND due_at <= $1
		 ORDER BY due_at, id
		 LIMIT 1`, now))
	if errors.Is(err, pgx.ErrNoRows) {
		return run, ErrNotFound
	}
	return run, err
}

// startRun marks a run RUNNING and counts the attempt. A run a worker
// abandoned is started again from the top; every step it repeats is
// idempotent, and the lines of the earlier attempt stay as they were.
func (r *Repo) startRun(ctx context.Context, id string) (int32, error) {
	var attempt int32
	err := r.pool.QueryRow(ctx, `
		UPDATE payout_run
		   SET state = 'RUNNING', attempts = attempts + 1, started_at = COALESCE(started_at, now()),
		       partners = 0, paid = 0, held = 0, released = 0, carried = 0, failed = 0,
		       paid_cents = 0, held_cents = 0, error = NULL
		 WHERE id = $1 AND finished_at IS NULL
		RETURNING attempts`, id).Scan(&attempt)
	return attempt, err
}

// runTally is what a run did, counted.
type runTally struct {
	Partners, Paid, Held, Released, Carried, Failed int32
	PaidCents, HeldCents                            int64
}

func (t *runTally) add(outcome PayoutRunOutcome, cents int64) {
	switch outcome {
	case OutcomePaid:
		t.Paid++
		t.PaidCents += cents
	case OutcomeReleased:
		t.Paid++
		t.Released++
		t.PaidCents += cents
	case OutcomeHeld:
		t.Held++
		t.HeldCents += cents
	case OutcomeCarriedNegative:
		t.Carried++
	case OutcomeTransferFailed, OutcomeError:
		t.Failed++
	}
}

// finishRun closes a run with its tally. A run with any failed line is FAILED;
// the payouts behind those lines stay owed and the next run tries again.
func (r *Repo) finishRun(ctx context.Context, id string, t runTally, runErr error) error {
	state := RunSucceeded
	if t.Failed > 0 || runErr != nil {
		state = RunFailed
	}
	var errText *string
	if runErr != nil {
		s := runErr.Error()
		errText = &s
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE payout_run
		   SET state = $2, finished_at = now(), partners = $3, paid = $4, held = $5, released = $6,
		       carried = $7, failed = $8, paid_cents = $9, held_cents = $10, error = $11
		 WHERE id = $1`,
		id, state, t.Partners, t.Paid, t.Held, t.Released, t.Carried, t.Failed, t.PaidCents, t.HeldCents, errText)
	return err
}

// addRunLine appends one line to a run's audit trail.
func (r *Repo) addRunLine(ctx context.Context, runID string, attempt int32, payee PayeeRef,
	outcome PayoutRunOutcome, payoutID string, cents int64, detail string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO payout_run_line (run_id, attempt, payee_type, payee_id, outcome, payout_id, amount_cents, detail)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		runID, attempt, payee.Type, payee.ID, string(outcome), nullUUID(payoutID), cents, nullStr(detail))
	return err
}

// runPayees lists the partners a run for every partner looks at: anyone with
// unpaid earnings before the cutoff, anyone with a payout still owed (held,
// waiting for a transfer, or mid-transfer), and every restaurant whose orders
// are blocked, so a recovered balance lifts the block.
func (r *Repo) runPayees(ctx context.Context, cutoff time.Time) ([]PayeeRef, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT le.counterparty_type::text, le.counterparty_id::text
		  FROM ledger_entry le
		 WHERE le.payout_id IS NULL
		   AND ((le.account = 'RESTAURANT_PAYABLE' AND le.counterparty_type = 'RESTAURANT')
		     OR (le.account = 'RIDER_PAYABLE' AND le.counterparty_type = 'RIDER'))
		   AND le.counterparty_id IS NOT NULL
		   AND le.created_at < $1
		UNION
		SELECT ca.owner_type, ca.owner_id::text
		  FROM payout p JOIN connect_account ca ON ca.id = p.connect_account_id
		 WHERE p.state IN ('READY', 'TRANSFERRING', 'HELD')
		UNION
		SELECT 'RESTAURANT', rc.restaurant_id::text
		  FROM restaurant_collection rc
		 WHERE rc.closed_at IS NULL`, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PayeeRef
	for rows.Next() {
		var p PayeeRef
		if err := rows.Scan(&p.Type, &p.ID); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Type != out[j].Type {
			return out[i].Type < out[j].Type
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

// payeeExists reports whether the id names a restaurant or a rider.
func (r *Repo) payeeExists(ctx context.Context, p PayeeRef) (bool, error) {
	q := `SELECT EXISTS (SELECT 1 FROM restaurant WHERE id = $1)`
	if p.Type == PayeeRider {
		q = `SELECT EXISTS (SELECT 1 FROM rider_profile WHERE account_id = $1)`
	}
	var ok bool
	err := r.pool.QueryRow(ctx, q, p.ID).Scan(&ok)
	return ok, err
}

// restaurantSuspended reports whether a restaurant is suspended or banned. A
// suspended restaurant is not paid until it is reinstated
// (docs/spec/03-restaurant.md, "R-32 — Payout schedule, preferences and
// payout requests", rule 2); its balance stays intact.
func (r *Repo) restaurantSuspended(ctx context.Context, restaurantID string) (bool, string, error) {
	var state string
	err := r.pool.QueryRow(ctx, `SELECT account_state::text FROM restaurant WHERE id = $1`, restaurantID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, "", nil
	}
	if err != nil {
		return false, "", err
	}
	return state == "SUSPENDED" || state == "BANNED", state, nil
}

// owedPayout is a payout created earlier that has not reached the partner:
// held, waiting for a transfer, or interrupted mid-transfer.
type owedPayout struct {
	ID          string
	State       string
	PeriodEnd   time.Time
	AmountCents int64
}

// owedPayouts lists a partner's payouts that are not yet PAID or FAILED.
func (r *Repo) owedPayouts(ctx context.Context, p PayeeRef) ([]owedPayout, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT po.id::text, po.state::text, po.period_end, po.amount_cents
		  FROM payout po JOIN connect_account ca ON ca.id = po.connect_account_id
		 WHERE ca.owner_type = $1 AND ca.owner_id = $2
		   AND po.state IN ('READY', 'TRANSFERRING', 'HELD')
		 ORDER BY po.period_end, po.id`, p.Type, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []owedPayout
	for rows.Next() {
		var o owedPayout
		if err := rows.Scan(&o.ID, &o.State, &o.PeriodEnd, &o.AmountCents); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// periodPayout is the outcome of building one partner's payout for a period.
// A payout created READY has no Outcome yet: its transfer decides it.
type periodPayout struct {
	Outcome     PayoutRunOutcome
	Ready       bool
	PayoutID    string
	State       string // the payout's state when it already existed or was created
	AmountCents int64  // the payout, or the balance carried
	HoldReason  string
}

// createPeriodPayout builds one partner's payout for a period: it sums the
// partner's unpaid earnings created before the cutoff (carried balances from
// earlier weeks included), and when the sum is positive creates the payout and
// stamps it on exactly those ledger entries. It never creates a second payout
// for the same partner and period, never a zero or negative one, and writes
// the audit event in the same transaction.
//
// The rules: docs/spec/01-platform.md, "P-19 — Stripe Connect: onboarding and
// payouts (Canada)". Each entry is paid at most once (the stamp only moves
// from NULL, and the claim UPDATE re-checks it); the payout's amount is
// exactly the sum of its entries (a deferred trigger in
// 00018_payouts_earnings.sql); a partner with payouts turned off gets a HELD
// payout with the reason and no transfer; a negative balance is carried and
// netted against later earnings.
func (r *Repo) createPeriodPayout(ctx context.Context, payee PayeeRef, period PayoutPeriod,
	readyBy, heldUntil time.Time, runID string) (periodPayout, error) {
	var out periodPayout
	err := r.tx(ctx, func(tx pgx.Tx) error {
		var c ConnectRow
		var reqs []byte
		err := tx.QueryRow(ctx, `
			SELECT id::text, stripe_account_id, charges_enabled, payouts_enabled, details_submitted,
			       disabled_reason, requirements, payout_interval::text
			  FROM connect_account WHERE owner_type = $1 AND owner_id = $2 FOR UPDATE`,
			payee.Type, payee.ID).Scan(&c.ID, &c.StripeAccountID, &c.ChargesEnabled, &c.PayoutsEnabled,
			&c.DetailsSubmitted, &c.DisabledReason, &reqs, &c.PayoutInterval)
		if errors.Is(err, pgx.ErrNoRows) {
			// No Stripe account yet: the balance accrues and is paid once
			// onboarding completes.
			out.Outcome = OutcomeNoPayoutAccount
			return nil
		}
		if err != nil {
			return err
		}
		c.CurrentlyDue, c.EventuallyDue, c.PastDue, _ = parseRequirements(reqs)

		// One payout per partner per period. The connect_account row lock
		// above serialises runs for this partner, so this read cannot race;
		// the unique index payout_once_per_period is the backstop.
		err = tx.QueryRow(ctx, `
			SELECT id::text, state::text, amount_cents FROM payout
			 WHERE connect_account_id = $1 AND period_end = $2`,
			c.ID, period.End).Scan(&out.PayoutID, &out.State, &out.AmountCents)
		if err == nil {
			out.Outcome = OutcomeAlreadyPaid
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		p, err := r.previewPayout(ctx, tx, c, payee.Type, payee.ID, period.End)
		if err != nil {
			return err
		}
		out.AmountCents = p.AmountCents
		switch {
		case p.EntryCount == 0:
			out.Outcome = OutcomeNothingDue
			return nil
		case p.AmountCents <= 0:
			// Carried and netted against later earnings; nothing is stamped,
			// so these entries are counted again next week.
			out.Outcome = OutcomeCarriedNegative
			return nil
		}

		state, deadline, action := "READY", readyBy, "execute_transfer"
		var holdReason *string
		if !c.PayoutsEnabled {
			state, deadline, action = "HELD", heldUntil, "release_held"
			hr := holdReasonFor(c)
			holdReason = &hr
			out.HoldReason = hr
		}
		err = tx.QueryRow(ctx, `
			INSERT INTO payout (connect_account_id, period_start, period_end, amount_cents,
			                    state, hold_reason, entry_count, deadline_at, deadline_action)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			RETURNING id::text`,
			c.ID, period.Start, period.End, p.AmountCents, state, holdReason, p.EntryCount,
			deadline, action).Scan(&out.PayoutID)
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE ledger_entry SET payout_id = $1
			 WHERE id = ANY($2) AND payout_id IS NULL`, out.PayoutID, p.EntryIDs)
		if err != nil {
			return err
		}
		if int(tag.RowsAffected()) != len(p.EntryIDs) {
			return fmt.Errorf("payout claim race: expected %d entries, claimed %d", len(p.EntryIDs), tag.RowsAffected())
		}
		out.State = state
		out.Outcome, action = OutcomeHeld, "payout.held"
		if state == "READY" {
			out.Outcome, out.Ready, action = "", true, "payout.created"
		}
		return writeJobAudit(ctx, tx, jobAudit{
			action: action, subjectType: "payout", subjectID: out.PayoutID, amountCents: &p.AmountCents,
			reason: holdReason,
			after: map[string]any{
				"run_id": runID, "payee_type": payee.Type, "payee_id": payee.ID, "state": state,
				"period_start": period.Start, "period_end": period.End, "entry_count": p.EntryCount,
			},
		})
	})
	if isUniqueViolation(err, "payout_once_per_period") {
		// Another worker created this period's payout first.
		return periodPayout{Outcome: OutcomeAlreadyPaid}, nil
	}
	return out, err
}

// holdReasonFor is the reason a payout is held, with Stripe's exact list of
// what the partner still has to provide.
func holdReasonFor(c ConnectRow) string {
	if len(c.CurrentlyDue) > 0 {
		return "requirements_due: " + joinComma(c.CurrentlyDue)
	}
	return "payouts_disabled"
}

// transferClaim is a payout claimed for its Stripe transfer.
type transferClaim struct {
	Claimed         bool   // this worker may call Stripe
	Held            bool   // payouts are off for the partner: the payout is (still) HELD
	WasHeld         bool   // it was HELD before this claim
	State           string // the payout's state when it was not claimed
	PriorAttempts   int32  // transfer attempts before this one: above 0, Stripe may already have it
	AmountCents     int64
	StripeAccountID string
	HoldReason      string
}

// claimTransfer takes a payout for its transfer: READY, HELD from an earlier
// period, or TRANSFERRING with a lapsed lease (a worker stopped mid-transfer).
// If Stripe has payouts turned off for the partner, the payout is held (or
// stays held) instead and no transfer may be made.
func (r *Repo) claimTransfer(ctx context.Context, payoutID, owner string, heldUntil time.Time) (transferClaim, error) {
	var out transferClaim
	err := r.tx(ctx, func(tx pgx.Tx) error {
		// The account first, then the payout: the same order createPeriodPayout
		// takes them in.
		var c ConnectRow
		var reqs []byte
		err := tx.QueryRow(ctx, `
			SELECT ca.id::text, ca.stripe_account_id, ca.payouts_enabled, ca.requirements
			  FROM connect_account ca
			 WHERE ca.id = (SELECT connect_account_id FROM payout WHERE id = $1)
			 FOR UPDATE`, payoutID).Scan(&c.ID, &c.StripeAccountID, &c.PayoutsEnabled, &reqs)
		if err != nil {
			return err
		}
		c.CurrentlyDue, c.EventuallyDue, c.PastDue, _ = parseRequirements(reqs)

		var leaseLive bool
		err = tx.QueryRow(ctx, `
			SELECT state::text, amount_cents, attempts, COALESCE(lease_until > now(), false)
			  FROM payout WHERE id = $1 FOR UPDATE`, payoutID).Scan(&out.State, &out.AmountCents, &out.PriorAttempts, &leaseLive)
		if err != nil {
			return err
		}
		out.WasHeld = out.State == "HELD"
		switch out.State {
		case "READY", "HELD":
		case "TRANSFERRING":
			if leaseLive {
				return nil // another worker is calling Stripe for it right now
			}
		default:
			return nil // PAID or FAILED: nothing to do
		}

		if !c.PayoutsEnabled {
			out.Held = true
			out.HoldReason = holdReasonFor(c)
			_, err := tx.Exec(ctx, `
				UPDATE payout
				   SET state = 'HELD', hold_reason = $2, deadline_at = $3, deadline_action = 'release_held',
				       lease_until = NULL, lease_owner = NULL
				 WHERE id = $1`, payoutID, out.HoldReason, heldUntil)
			if err != nil || out.WasHeld {
				return err
			}
			// Stripe turned payouts off after this payout was built.
			return writeJobAudit(ctx, tx, jobAudit{
				action: "payout.held", subjectType: "payout", subjectID: payoutID, amountCents: &out.AmountCents,
				reason: &out.HoldReason, after: map[string]any{"state": "HELD", "was": out.State},
			})
		}
		_, err = tx.Exec(ctx, `
			UPDATE payout
			   SET state = 'TRANSFERRING', attempts = attempts + 1, hold_reason = NULL,
			       lease_owner = $2, lease_until = now() + interval '10 minutes',
			       deadline_at = now() + interval '10 minutes', deadline_action = 'execute_transfer'
			 WHERE id = $1`, payoutID, owner)
		if err != nil {
			return err
		}
		out.Claimed = true
		out.StripeAccountID = c.StripeAccountID
		return nil
	})
	return out, err
}

// markTransferred records the Stripe transfer and closes the payout as PAID.
func (r *Repo) markTransferred(ctx context.Context, payoutID, transferID, runID string, released bool, cents int64) error {
	return r.tx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE payout
			   SET state = 'PAID', stripe_transfer_id = $2, paid_at = now(), last_error = NULL,
			       failure_message = NULL, deadline_at = NULL, deadline_action = NULL,
			       lease_until = NULL, lease_owner = NULL
			 WHERE id = $1 AND state = 'TRANSFERRING'`, payoutID, transferID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return fmt.Errorf("payout %s was not TRANSFERRING when its transfer %s returned", payoutID, transferID)
		}
		return writeJobAudit(ctx, tx, jobAudit{
			action: "payout.transferred", subjectType: "payout", subjectID: payoutID, amountCents: &cents,
			after: map[string]any{"run_id": runID, "stripe_transfer_id": transferID, "released": released},
		})
	})
}

// markTransferFailed puts a payout back to READY with the error, to be tried
// again by the next run. Stripe remembers an idempotency key's result for at
// least 24 hours, so a retry within a day of a refusal gets the same refusal;
// the weekly run is well past that.
func (r *Repo) markTransferFailed(ctx context.Context, payoutID, msg, runID string, retryBy time.Time, cents int64) error {
	return r.tx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			UPDATE payout
			   SET state = 'READY', last_error = $2, failure_message = $2,
			       deadline_at = $3, deadline_action = 'execute_transfer',
			       lease_until = NULL, lease_owner = NULL
			 WHERE id = $1 AND state = 'TRANSFERRING'`, payoutID, msg, retryBy)
		if err != nil {
			return err
		}
		failed := "FAILED"
		return writeJobAudit(ctx, tx, jobAudit{
			action: "payout.transfer_failed", subjectType: "payout", subjectID: payoutID, amountCents: &cents,
			outcome: &failed, reason: &msg, after: map[string]any{"run_id": runID},
		})
	})
}

// payeeBalance is a partner's balance as the ledger has it: unpaid earnings
// up to asOf plus payouts created but not yet transferred. When it is below
// zero, NegativeSince is when it last went below zero.
type payeeBalance struct {
	Cents         int64
	NegativeSince *time.Time
}

// balanceAt reads a partner's balance, and when it is negative, since when.
// The running sum over the unpaid entries, oldest first, finds the start of
// the stretch that is still below zero; payouts still owed count as money
// the partner has, so a held payout can cover a chargeback.
func (r *Repo) balanceAt(ctx context.Context, p PayeeRef, asOf time.Time) (payeeBalance, error) {
	var b payeeBalance
	var owed int64
	if err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(sum(po.amount_cents), 0)::bigint
		  FROM payout po JOIN connect_account ca ON ca.id = po.connect_account_id
		 WHERE ca.owner_type = $1 AND ca.owner_id = $2 AND po.state IN ('READY', 'TRANSFERRING', 'HELD')`,
		p.Type, p.ID).Scan(&owed); err != nil {
		return b, err
	}
	rows, err := r.pool.Query(ctx, `
		SELECT created_at, amount_cents
		  FROM ledger_entry
		 WHERE account = $1 AND counterparty_type = $2 AND counterparty_id = $3
		   AND payout_id IS NULL AND created_at <= $4
		 ORDER BY created_at, id`,
		string(payableAccount(p.Type)), p.Type, p.ID, asOf)
	if err != nil {
		return b, err
	}
	defer rows.Close()
	running := owed
	var since *time.Time
	for rows.Next() {
		var at time.Time
		var cents int64
		if err := rows.Scan(&at, &cents); err != nil {
			return b, err
		}
		running += cents
		switch {
		case running >= 0:
			since = nil
		case since == nil:
			t := at
			since = &t
		}
	}
	if err := rows.Err(); err != nil {
		return b, err
	}
	b.Cents = running
	if running < 0 {
		b.NegativeSince = since
	}
	return b, nil
}

// openCollection blocks a restaurant's new orders for a balance that has been
// negative too long. It reports false when one is already open.
func (r *Repo) openCollection(ctx context.Context, restaurantID string, b payeeBalance, runID string, days int) (bool, error) {
	opened := false
	err := r.tx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			INSERT INTO restaurant_collection (restaurant_id, balance_cents, negative_since, opened_by_run)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (restaurant_id) WHERE closed_at IS NULL DO NOTHING`,
			restaurantID, b.Cents, *b.NegativeSince, runID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		opened = true
		reason := fmt.Sprintf("balance below zero for more than %d days", days)
		return writeJobAudit(ctx, tx, jobAudit{
			action: "restaurant.orders_blocked", subjectType: "restaurant", subjectID: restaurantID,
			amountCents: &b.Cents, reasonCode: strPtrNonEmpty("NEGATIVE_BALANCE"), reason: &reason,
			after: map[string]any{"run_id": runID, "negative_since": *b.NegativeSince},
		})
	})
	return opened, err
}

// closeCollection lifts a restaurant's order block. It reports false when
// none was open.
func (r *Repo) closeCollection(ctx context.Context, restaurantID, runID, reason string, cents int64) (bool, error) {
	closed := false
	err := r.tx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE restaurant_collection
			   SET closed_at = now(), closed_by_run = $2, close_reason = $3
			 WHERE restaurant_id = $1 AND closed_at IS NULL`, restaurantID, runID, reason)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		closed = true
		return writeJobAudit(ctx, tx, jobAudit{
			action: "restaurant.orders_unblocked", subjectType: "restaurant", subjectID: restaurantID,
			amountCents: &cents, reasonCode: &reason, after: map[string]any{"run_id": runID},
		})
	})
	return closed, err
}

// ---------------------------------------------------------------------------
// Admin requests and reads.
// ---------------------------------------------------------------------------

// insertAdminRun queues a run an admin asked for, with its audit event, in
// one transaction. A retried request (same admin, same Idempotency-Key)
// returns the first run and inserted=false.
func (r *Repo) insertAdminRun(ctx context.Context, period PayoutPeriod, asOf, due time.Time, payee *PayeeRef,
	requestedBy, key, fingerprint string, actor adminActor) (PayoutRunRow, bool, error) {
	var run PayoutRunRow
	inserted := false
	err := r.tx(ctx, func(tx pgx.Tx) error {
		var payeeType, payeeID any
		if payee != nil {
			payeeType, payeeID = payee.Type, payee.ID
		}
		row, err := scanPayoutRun(tx.QueryRow(ctx, `
			INSERT INTO payout_run (kind, period_start, period_end, as_of, due_at, payee_type, payee_id,
			                        requested_by, idempotency_key, request_fingerprint)
			VALUES ('ADMIN', $1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (requested_by, idempotency_key) WHERE kind = 'ADMIN' DO NOTHING
			RETURNING `+payoutRunColumns,
			period.Start, period.End, asOf, due, payeeType, payeeID, requestedBy, key, fingerprint))
		if errors.Is(err, pgx.ErrNoRows) {
			run, err = scanPayoutRun(tx.QueryRow(ctx, `
				SELECT `+payoutRunColumns+` FROM payout_run
				 WHERE kind = 'ADMIN' AND requested_by = $1 AND idempotency_key = $2`, requestedBy, key))
			return err
		}
		if err != nil {
			return err
		}
		run, inserted = row, true
		after := map[string]any{"period_start": period.Start, "period_end": period.End, "as_of": asOf}
		if payee != nil {
			after["payee_type"], after["payee_id"] = payee.Type, payee.ID
		}
		return writeAdminAudit(ctx, tx, actor, "payout_run.request", "payout_run", run.ID, after)
	})
	return run, inserted, err
}

// GetPayoutRun returns one run, or ErrNotFound.
func (r *Repo) GetPayoutRun(ctx context.Context, id string) (PayoutRunRow, error) {
	run, err := scanPayoutRun(r.pool.QueryRow(ctx, `SELECT `+payoutRunColumns+` FROM payout_run WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return run, ErrNotFound
	}
	return run, err
}

// ListPayoutRuns returns runs newest first (ids are time-ordered), after the
// keyset cursor when one is given.
func (r *Repo) ListPayoutRuns(ctx context.Context, limit int, afterID string) ([]PayoutRunRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	sql := `SELECT ` + payoutRunColumns + ` FROM payout_run`
	args := []any{}
	if afterID != "" {
		sql += ` WHERE id < $1`
		args = append(args, afterID)
	}
	sql += ` ORDER BY id DESC LIMIT ` + itoa(limit)
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PayoutRunRow
	for rows.Next() {
		run, err := scanPayoutRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, run)
	}
	return out, rows.Err()
}

// PayoutRunLines returns a run's lines in the order they were written.
func (r *Repo) PayoutRunLines(ctx context.Context, runID string) ([]PayoutRunLineRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT payee_type, payee_id::text, outcome::text, payout_id::text, amount_cents, detail, created_at
		  FROM payout_run_line WHERE run_id = $1 ORDER BY id`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PayoutRunLineRow
	for rows.Next() {
		var l PayoutRunLineRow
		var outcome string
		if err := rows.Scan(&l.Payee.Type, &l.Payee.ID, &outcome, &l.PayoutID, &l.AmountCents, &l.Detail, &l.At); err != nil {
			return nil, err
		}
		l.Outcome = PayoutRunOutcome(outcome)
		out = append(out, l)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// The audit trail (docs/spec/01-platform.md, "P-35 — Append-only audit
// trail": payout creation, execution and hold are audited money actions).
// ---------------------------------------------------------------------------

// jobAudit is one audit_event the payout worker writes.
type jobAudit struct {
	action      string
	subjectType string
	subjectID   string
	outcome     *string // SUCCESS when nil
	reasonCode  *string
	reason      *string
	amountCents *int64
	after       map[string]any
}

// adminActor is the verified identity behind an admin request. It always
// comes from the session, never from the body.
type adminActor struct {
	AccountID string
	Roles     []string
	RequestID string
	SessionID string
}

// auditInsert is the audit_event insert. The table's BEFORE INSERT trigger
// computes day, seq and the hash chain; the placeholders only satisfy NOT
// NULL at parse time.
const auditInsert = `
	INSERT INTO audit_event
	  (actor_kind, actor_account_id, actor_roles, action, subject_type, subject_id,
	   outcome, reason_code, reason, after, amount_cents, request_id, session_id,
	   day, seq, prev_hash, hash)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
	        current_date, 0, '\x00'::bytea, '\x00'::bytea)`

func writeJobAudit(ctx context.Context, tx pgx.Tx, a jobAudit) error {
	outcome := "SUCCESS"
	if a.outcome != nil {
		outcome = *a.outcome
	}
	after, err := jsonOrNil(a.after)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, auditInsert, "JOB", nil, nil, a.action, a.subjectType, nullUUID(a.subjectID),
		outcome, a.reasonCode, a.reason, after, a.amountCents, nil, nil)
	return err
}

func writeAdminAudit(ctx context.Context, tx pgx.Tx, actor adminActor, action, subjectType, subjectID string,
	after map[string]any) error {
	afterJSON, err := jsonOrNil(after)
	if err != nil {
		return err
	}
	var roles any
	if len(actor.Roles) > 0 {
		b, err := json.Marshal(actor.Roles)
		if err != nil {
			return err
		}
		roles = string(b)
	}
	_, err = tx.Exec(ctx, auditInsert, "ACCOUNT", nullUUID(actor.AccountID), roles, action, subjectType,
		nullUUID(subjectID), "SUCCESS", nil, nil, afterJSON, nil, nullStr(actor.RequestID), nullUUID(actor.SessionID))
	return err
}

func jsonOrNil(m map[string]any) (any, error) {
	if m == nil {
		return nil, nil
	}
	b, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func strPtrNonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// isUniqueViolation reports whether err is a unique violation on the named
// constraint or index.
func isUniqueViolation(err error, name string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == name
}
