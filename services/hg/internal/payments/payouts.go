package payments

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Payout execution (P-19 / S-04): weekly, Monday, automatic, no minimum.
//
// Separate charges and transfers. Each payout aggregates the partner's unpaid
// RIDER_PAYABLE (or RESTAURANT_PAYABLE) ledger entries, stamps payout_id on
// exactly those rows (so a row is never paid twice — I-19.1), and its
// amount_cents equals their sum (I-19.2, enforced by the deferred trigger). The
// Stripe transfer is idempotency-keyed by the payout id (I-19.4). A partner
// with payouts_enabled=false gets a HELD payout with the exact requirement list,
// and no transfer is attempted (I-19.3).

// ErrNothingToPay is returned by RunWeeklyPayout when a partner has no unpaid
// balance for the period: the cron treats it as a no-op, not a failure.
var ErrNothingToPay = errors.New("nothing to pay this period")

// PayoutPreview is what a run would pay a partner before it is executed.
type PayoutPreview struct {
	ConnectAccountID string
	StripeAccountID  string
	PayoutsEnabled   bool
	AmountCents      int64
	EntryCount       int32
	EntryIDs         []int64
	HoldReason       string
}

// account is which ledger account a partner type draws from.
func payableAccount(ownerType string) LedgerAccount {
	if ownerType == "RIDER" {
		return AcctRiderPayable
	}
	return AcctRestaurantPayable
}

// previewPayout sums a partner's unpaid payable entries up to the cutoff.
func (r *Repo) previewPayout(ctx context.Context, tx pgx.Tx, c ConnectRow, ownerType, ownerID string, cutoff time.Time) (PayoutPreview, error) {
	p := PayoutPreview{ConnectAccountID: c.ID, StripeAccountID: c.StripeAccountID, PayoutsEnabled: c.PayoutsEnabled}
	rows, err := tx.Query(ctx, `
		SELECT le.id, le.amount_cents
		  FROM ledger_entry le
		 WHERE le.account = $1
		   AND le.counterparty_type = $2
		   AND le.counterparty_id = $3
		   AND le.payout_id IS NULL
		   AND le.created_at < $4
		 FOR UPDATE`,
		string(payableAccount(ownerType)), ownerType, ownerID, cutoff)
	if err != nil {
		return p, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, amt int64
		if err := rows.Scan(&id, &amt); err != nil {
			return p, err
		}
		p.EntryIDs = append(p.EntryIDs, id)
		p.AmountCents += amt
		p.EntryCount++
	}
	return p, rows.Err()
}

// RunPayout builds and persists one partner's payout for [periodStart, cutoff),
// stamping the claimed ledger entries and, for an enabled account, marking it
// READY for the transfer step. It returns the created payout id, or "" when
// there is nothing to pay (no entries) — no zero-amount payout is created.
func (r *Repo) RunPayout(ctx context.Context, ownerType, ownerID string, periodStart, cutoff time.Time) (string, PayoutPreview, error) {
	var payoutID string
	var preview PayoutPreview
	err := r.tx(ctx, func(tx pgx.Tx) error {
		var c ConnectRow
		var reqs []byte
		err := tx.QueryRow(ctx, `
			SELECT id::text, stripe_account_id, charges_enabled, payouts_enabled, details_submitted,
			       disabled_reason, requirements, payout_interval::text
			  FROM connect_account WHERE owner_type = $1 AND owner_id = $2 FOR UPDATE`,
			ownerType, ownerID).Scan(&c.ID, &c.StripeAccountID, &c.ChargesEnabled, &c.PayoutsEnabled,
			&c.DetailsSubmitted, &c.DisabledReason, &reqs, &c.PayoutInterval)
		if errors.Is(err, pgx.ErrNoRows) {
			// I-19.5: no connect account yet — balances accrue, paid retroactively.
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		c.CurrentlyDue, c.EventuallyDue, c.PastDue = parseRequirements(reqs)

		p, err := r.previewPayout(ctx, tx, c, ownerType, ownerID, cutoff)
		if err != nil {
			return err
		}
		preview = p
		if p.EntryCount == 0 {
			return nil // nothing to pay; no row created (acceptance 2/5)
		}

		state := "READY"
		var holdReason *string
		if !c.PayoutsEnabled {
			// I-19.3: no transfer for a disabled account; HELD with a reason.
			state = "HELD"
			hr := "payouts_disabled"
			if len(c.CurrentlyDue) > 0 {
				hr = "requirements_due: " + joinComma(c.CurrentlyDue)
			}
			holdReason = &hr
		}

		deadline := time.Now().Add(1 * time.Minute)
		err = tx.QueryRow(ctx, `
			INSERT INTO payout (connect_account_id, period_start, period_end, amount_cents,
			                    state, hold_reason, entry_count, deadline_at, deadline_action)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'execute_transfer')
			RETURNING id::text`,
			c.ID, periodStart, cutoff, p.AmountCents, state, holdReason, p.EntryCount, deadline).Scan(&payoutID)
		if err != nil {
			return err
		}

		// Stamp payout_id on exactly the claimed entries (the one mutation the
		// ledger permits, from NULL only). Guarded by payout_id IS NULL so a
		// concurrent run cannot double-claim.
		tag, err := tx.Exec(ctx, `
			UPDATE ledger_entry SET payout_id = $1
			 WHERE id = ANY($2) AND payout_id IS NULL`, payoutID, p.EntryIDs)
		if err != nil {
			return err
		}
		if int(tag.RowsAffected()) != len(p.EntryIDs) {
			return fmt.Errorf("payout claim race: expected %d entries, claimed %d", len(p.EntryIDs), tag.RowsAffected())
		}
		return nil
	})
	return payoutID, preview, err
}

// MarkPayoutTransferred records a successful Stripe transfer against a payout
// and advances it to PAID.
func (r *Repo) MarkPayoutTransferred(ctx context.Context, payoutID, stripeTransferID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE payout
		   SET state = 'PAID', stripe_transfer_id = $2, paid_at = now(),
		       deadline_at = NULL, deadline_action = NULL
		 WHERE id = $1`, payoutID, stripeTransferID)
	return err
}

// MarkPayoutFailed records a permanent transfer failure.
func (r *Repo) MarkPayoutFailed(ctx context.Context, payoutID, msg string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE payout
		   SET state = 'FAILED', failure_message = $2, last_error = $2,
		       deadline_at = NULL, deadline_action = NULL
		 WHERE id = $1`, payoutID, msg)
	return err
}

func joinComma(ss []string) string {
	out := ""
	for i, s := range ss {
		if i > 0 {
			out += ","
		}
		out += s
	}
	return out
}

// ---------------------------------------------------------------------------
// Service: the weekly run and the transfer step.
// ---------------------------------------------------------------------------

// RunWeeklyPayout builds a partner's payout for the current period and, when the
// account is enabled, immediately attempts the Stripe transfer. The whole thing
// is idempotency-keyed by the payout id so a retry after a timeout creates
// exactly one Stripe transfer (I-19.4 / acceptance 3).
func (s *Service) RunWeeklyPayout(ctx context.Context, ownerType, ownerID string) (PayoutDTO, error) {
	if s.stripe == nil {
		return PayoutDTO{}, ErrStripeNotConfigured
	}
	now := s.now()
	periodStart := nextMondayUTC(now).AddDate(0, 0, -7)
	cutoff := nextMondayUTC(now)

	payoutID, preview, err := s.repo.RunPayout(ctx, ownerType, ownerID, periodStart, cutoff)
	if errors.Is(err, ErrNotFound) {
		return PayoutDTO{}, domainErr(string(CodeStepNotAvailable), 409,
			"This partner has no payout account yet; the balance will be paid once onboarding completes.")
	}
	if err != nil {
		return PayoutDTO{}, err
	}
	if payoutID == "" {
		// Nothing to pay this period — no zero-amount payout is created
		// (acceptance 2/5). This is a normal, non-error outcome for the cron.
		return PayoutDTO{}, ErrNothingToPay
	}

	// A HELD payout (payouts_enabled=false) makes no transfer (I-19.3).
	if preview.PayoutsEnabled {
		tr, terr := s.stripe.CreateTransfer(ctx, CreateTransferInput{
			AmountCents:     preview.AmountCents,
			Currency:        "cad",
			DestinationAcct: preview.StripeAccountID,
			IdempotencyKey:  "po:" + payoutID,
			PayoutID:        payoutID,
			TransferGroup:   "payout_" + payoutID,
		})
		if terr != nil {
			_ = s.repo.MarkPayoutFailed(ctx, payoutID, terr.Error())
			s.log.ErrorContext(ctx, "payout transfer failed", "payout_id", payoutID, "error", terr.Error())
			return PayoutDTO{}, terr
		}
		if err := s.repo.MarkPayoutTransferred(ctx, payoutID, tr.ID); err != nil {
			return PayoutDTO{}, err
		}
	}

	p, err := s.repo.GetPayoutByID(ctx, payoutID)
	if err != nil {
		return PayoutDTO{}, err
	}
	return payoutToDTO(p), nil
}
