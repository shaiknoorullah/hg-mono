package notify

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Enqueue helpers: resolve who a message goes to, build it and enqueue it, all
// inside the caller's transaction. They read the account_role, restaurant,
// rider_profile and payout rows the caller's change just wrote, which is why
// they take the transaction rather than a pool.
//
// Callers: the admin application decisions (internal/admin), and the payout
// messages from the payments module (internal/payments/payout_notices.go):
// sent from the bank payout's paid webhook, held from the payout run, failed
// from the run and the transfer and bank payout webhooks. Waiting for the
// account-state operations (issue #253, pull request #335):
// EnqueueRestaurantStanding and EnqueueRiderStanding.

// RestaurantRecipients is every account that holds a live owner or manager
// grant on the restaurant: the people who answer for its application, its
// standing and its money. Kitchen staff are not included.
func RestaurantRecipients(ctx context.Context, db DB, restaurantID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := db.Query(ctx, `
		SELECT DISTINCT account_id
		  FROM account_role
		 WHERE scope_type = 'RESTAURANT' AND scope_id = $1
		   AND role IN ('RESTAURANT_OWNER', 'RESTAURANT_MANAGER')
		   AND revoked_at IS NULL
		 ORDER BY account_id`, restaurantID)
	if err != nil {
		return nil, fmt.Errorf("notify: load owners and managers of %s: %w", restaurantID, err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, fmt.Errorf("notify: load owners and managers of %s: %w", restaurantID, err)
	}
	return ids, nil
}

func restaurantName(ctx context.Context, db DB, restaurantID uuid.UUID) (string, error) {
	var name string
	if err := db.QueryRow(ctx, `SELECT display_name FROM restaurant WHERE id = $1`, restaurantID).Scan(&name); err != nil {
		return "", fmt.Errorf("notify: load restaurant %s: %w", restaurantID, err)
	}
	return name, nil
}

func riderFirstName(ctx context.Context, db DB, accountID uuid.UUID) (string, error) {
	var name string
	err := db.QueryRow(ctx, `SELECT first_name FROM rider_profile WHERE account_id = $1`, accountID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "there", nil // "Hi there," — a rider with no profile row yet
	}
	if err != nil {
		return "", fmt.Errorf("notify: load rider %s: %w", accountID, err)
	}
	return name, nil
}

func enqueueEach(ctx context.Context, tx pgx.Tx, enq TxEnqueuer, recipients []uuid.UUID, build func(uuid.UUID) (New, error)) error {
	for _, id := range recipients {
		n, err := build(id)
		if err != nil {
			return err
		}
		if _, err := enq.Enqueue(ctx, tx, n); err != nil {
			return err
		}
	}
	return nil
}

// EnqueueRestaurantApplicationDecided tells every owner and manager of the
// restaurant how its application review ended.
func EnqueueRestaurantApplicationDecided(ctx context.Context, tx pgx.Tx, enq TxEnqueuer, restaurantID uuid.UUID,
	decision Decision, reasonText string, decidedAt time.Time) error {
	name, err := restaurantName(ctx, tx, restaurantID)
	if err != nil {
		return err
	}
	recipients, err := RestaurantRecipients(ctx, tx, restaurantID)
	if err != nil {
		return err
	}
	return enqueueEach(ctx, tx, enq, recipients, func(id uuid.UUID) (New, error) {
		return RestaurantApplicationDecided(RestaurantApplicationDecision{
			AccountID: id, RestaurantID: restaurantID, RestaurantName: name,
			Decision: decision, ReasonText: reasonText, DecidedAt: decidedAt,
		})
	})
}

// EnqueueRiderApplicationDecided tells a rider how their application review
// ended.
func EnqueueRiderApplicationDecided(ctx context.Context, tx pgx.Tx, enq TxEnqueuer, accountID uuid.UUID,
	decision Decision, reasonText string, decidedAt time.Time) error {
	first, err := riderFirstName(ctx, tx, accountID)
	if err != nil {
		return err
	}
	n, err := RiderApplicationDecided(RiderApplicationDecision{
		AccountID: accountID, FirstName: first, Decision: decision, ReasonText: reasonText, DecidedAt: decidedAt,
	})
	if err != nil {
		return err
	}
	_, err = enq.Enqueue(ctx, tx, n)
	return err
}

// EnqueueRestaurantStanding tells every owner and manager that the restaurant
// was suspended (suspended=true, with the reason shown to the restaurant) or
// reinstated. For the account-state operations of issue #253.
func EnqueueRestaurantStanding(ctx context.Context, tx pgx.Tx, enq TxEnqueuer, restaurantID uuid.UUID,
	suspended bool, reasonText string, changedAt time.Time) error {
	name, err := restaurantName(ctx, tx, restaurantID)
	if err != nil {
		return err
	}
	recipients, err := RestaurantRecipients(ctx, tx, restaurantID)
	if err != nil {
		return err
	}
	return enqueueEach(ctx, tx, enq, recipients, func(id uuid.UUID) (New, error) {
		return RestaurantStandingChanged(RestaurantStanding{
			AccountID: id, RestaurantID: restaurantID, RestaurantName: name,
			Suspended: suspended, ReasonText: reasonText, ChangedAt: changedAt,
		})
	})
}

// EnqueueRiderStanding tells a rider their account was paused or reinstated.
// For the account-state operations of issue #253.
func EnqueueRiderStanding(ctx context.Context, tx pgx.Tx, enq TxEnqueuer, accountID uuid.UUID,
	suspended bool, reasonText string, changedAt time.Time) error {
	first, err := riderFirstName(ctx, tx, accountID)
	if err != nil {
		return err
	}
	n, err := RiderStandingChanged(RiderStanding{
		AccountID: accountID, FirstName: first, Suspended: suspended, ReasonText: reasonText, ChangedAt: changedAt,
	})
	if err != nil {
		return err
	}
	_, err = enq.Enqueue(ctx, tx, n)
	return err
}

// EnqueuePayoutSent tells the payee that a PAID payout left: the restaurant's
// owners and managers, or the rider. Call it in the transaction that moves
// the payout to PAID, after the update. bankPayoutID names the bank payout
// that paid it (empty when there is none), so a payout paid again after its
// bank returned the first one is told again.
func EnqueuePayoutSent(ctx context.Context, tx pgx.Tx, enq TxEnqueuer, payoutID uuid.UUID, bankPayoutID string) error {
	p, owner, err := loadPayout(ctx, tx, payoutID, "PAID")
	if err != nil {
		return err
	}
	if p.PaidAt != nil {
		p.SentAt = *p.PaidAt
	}
	p.Occurrence = bankPayoutID
	return enqueueToPayee(ctx, tx, enq, owner, p.Payout, PayoutSent)
}

// EnqueuePayoutHeld tells the payee that a payout is HELD because Stripe has
// payouts turned off for them. Call it in the transaction that holds the
// payout, only when it was not held already.
func EnqueuePayoutHeld(ctx context.Context, tx pgx.Tx, enq TxEnqueuer, payoutID uuid.UUID) error {
	p, owner, err := loadPayout(ctx, tx, payoutID, "HELD")
	if err != nil {
		return err
	}
	return enqueueToPayee(ctx, tx, enq, owner, p.Payout, PayoutHeld)
}

// EnqueuePayoutFailed tells the payee that a payout did not reach them, in
// the transaction that records the failure. occurrence names this failure
// (see Payout.Occurrence); nextRun is when it is tried again, zero for none.
func EnqueuePayoutFailed(ctx context.Context, tx pgx.Tx, enq TxEnqueuer, payoutID uuid.UUID,
	problem PayoutProblem, occurrence string, nextRun time.Time) error {
	p, owner, err := loadPayout(ctx, tx, payoutID, "")
	if err != nil {
		return err
	}
	p.Occurrence = occurrence
	return enqueueToPayee(ctx, tx, enq, owner, p.Payout, func(q Payout) (New, error) {
		return PayoutFailed(PayoutFailure{Payout: q, Problem: problem, NextRun: nextRun})
	})
}

// payoutOwner is who a payout is owed to.
type payoutOwner struct {
	Type string // RESTAURANT or RIDER
	ID   uuid.UUID
}

type loadedPayout struct {
	Payout
	PaidAt *time.Time
}

// loadPayout reads what a payout message says. state, when set, is the state
// the caller just moved the payout to; any other state is an error, because
// the message would not be true.
func loadPayout(ctx context.Context, tx pgx.Tx, payoutID uuid.UUID, state string) (loadedPayout, payoutOwner, error) {
	var (
		p        loadedPayout
		owner    payoutOwner
		got      string
		zoneName string
	)
	err := tx.QueryRow(ctx, `
		SELECT ca.owner_type, ca.owner_id, p.state::text, p.amount_cents, p.period_start, p.period_end, p.paid_at,
		       COALESCE((SELECT r.timezone FROM restaurant r WHERE ca.owner_type = 'RESTAURANT' AND r.id = ca.owner_id),
		                (SELECT a.timezone FROM account a WHERE ca.owner_type = 'RIDER' AND a.id = ca.owner_id), '')
		  FROM payout p
		  JOIN connect_account ca ON ca.id = p.connect_account_id
		 WHERE p.id = $1`, payoutID).
		Scan(&owner.Type, &owner.ID, &got, &p.AmountCents, &p.PeriodStart, &p.PeriodEnd, &p.PaidAt, &zoneName)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, owner, fmt.Errorf("notify: no payout %s", payoutID)
	}
	if err != nil {
		return p, owner, fmt.Errorf("notify: load payout %s: %w", payoutID, err)
	}
	if state != "" && got != state {
		return p, owner, fmt.Errorf("notify: payout %s is %s, not %s", payoutID, got, state)
	}
	p.PayoutID, p.SentAt, p.Zone = payoutID, time.Now(), Zone(zoneName)
	return p, owner, nil
}

// enqueueToPayee builds one payout message for each person who hears about
// the payee's money: the restaurant's owners and managers, or the rider.
func enqueueToPayee(ctx context.Context, tx pgx.Tx, enq TxEnqueuer, owner payoutOwner, p Payout,
	build func(Payout) (New, error)) error {
	switch owner.Type {
	case "RESTAURANT":
		name, err := restaurantName(ctx, tx, owner.ID)
		if err != nil {
			return err
		}
		recipients, err := RestaurantRecipients(ctx, tx, owner.ID)
		if err != nil {
			return err
		}
		p.Role, p.PayeeName = RoleRestaurant, name
		return enqueueEach(ctx, tx, enq, recipients, func(id uuid.UUID) (New, error) {
			q := p
			q.AccountID = id
			return build(q)
		})
	case "RIDER":
		first, err := riderFirstName(ctx, tx, owner.ID)
		if err != nil {
			return err
		}
		p.Role, p.PayeeName, p.AccountID = RoleRider, first, owner.ID
		n, err := build(p)
		if err != nil {
			return err
		}
		_, err = enq.Enqueue(ctx, tx, n)
		return err
	default:
		return fmt.Errorf("notify: payout %s belongs to unknown owner type %q", p.PayoutID, owner.Type)
	}
}
