package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// The auth-then-capture lifecycle (P-16), exposed as internal service methods
// the orders module calls at checkout (Authorise), on restaurant acceptance
// (Capture) and on reject/timeout (Void). These are not HTTP handlers — they are
// the in-process seam between orders and payments, which is the whole point of a
// modular monolith: a function call, not a network hop.

// AuthoriseInput is the checkout authorisation request from the orders module.
// The amount is the server-priced order total; no client price ever reaches here.
type AuthoriseInput struct {
	OrderID        string
	AmountCents    int64
	Currency       string
	StripeCustomer string
	StripeMethod   string
	IdempotencyKey string
}

// Authorise creates a manual-capture PaymentIntent and stores the
// payment_intent row. Funds are held, not captured (P-16 / invariant 5).
func (s *Service) Authorise(ctx context.Context, in AuthoriseInput) (IntentRow, error) {
	if s.stripe == nil {
		return IntentRow{}, ErrStripeNotConfigured
	}
	cur := in.Currency
	if cur == "" {
		cur = "cad"
	}
	pi, err := s.stripe.CreatePaymentIntent(ctx, CreateIntentInput{
		AmountCents:     in.AmountCents,
		Currency:        cur,
		CustomerID:      in.StripeCustomer,
		PaymentMethodID: in.StripeMethod,
		Confirm:         in.StripeMethod != "",
		IdempotencyKey:  in.IdempotencyKey,
		OrderID:         in.OrderID,
	})
	if err != nil {
		return IntentRow{}, err
	}
	return s.repo.UpsertOrderIntent(ctx, in.OrderID, pi)
}

// Capture captures a previously authorised intent when the restaurant accepts.
// A full capture uses the authorised amount; a partial capture is supported for
// item substitutions. The CAPTURE ledger batch is posted from the
// payment_intent.succeeded webhook, not here, so capture and its accounting
// share the store-then-process idempotency boundary.
func (s *Service) Capture(ctx context.Context, orderID string, amountCents int64) (IntentRow, error) {
	if s.stripe == nil {
		return IntentRow{}, ErrStripeNotConfigured
	}
	cur, err := s.repo.GetOrderIntent(ctx, orderID)
	if err != nil {
		return IntentRow{}, err
	}
	pi, err := s.stripe.CapturePaymentIntent(ctx, cur.StripePaymentIntentID, amountCents, "capture:"+orderID)
	if err != nil {
		return IntentRow{}, err
	}
	return s.repo.UpsertOrderIntent(ctx, orderID, pi)
}

// Void cancels an uncaptured authorisation on reject or timeout (P-16 /
// invariant 5). No money moved, so there is no refund object and no ledger
// charge/refund pair — only the CANCELED payment state.
func (s *Service) Void(ctx context.Context, orderID string) (IntentRow, error) {
	if s.stripe == nil {
		return IntentRow{}, ErrStripeNotConfigured
	}
	cur, err := s.repo.GetOrderIntent(ctx, orderID)
	if err != nil {
		return IntentRow{}, err
	}
	pi, err := s.stripe.CancelPaymentIntent(ctx, cur.StripePaymentIntentID, "void:"+orderID)
	if err != nil {
		return IntentRow{}, err
	}
	return s.repo.UpsertOrderIntent(ctx, orderID, pi)
}

// UpsertOrderIntent inserts or updates the ORDER payment_intent for an order
// from a Stripe intent, keeping card display fields and the amounts current.
func (r *Repo) UpsertOrderIntent(ctx context.Context, orderID string, pi *StripeIntent) (IntentRow, error) {
	state := string(stateFromStripe(pi.Status))
	authorized := pi.AmountCents
	if pi.AmountCapturableCents > 0 {
		authorized = pi.AmountCapturableCents + pi.AmountReceivedCents
	}
	captured := pi.AmountReceivedCents
	terminal := stateFromStripe(pi.Status)
	var deadlineAt *time.Time
	var deadlineAction *string
	if terminal != StateSucceeded && terminal != StateCanceled && terminal != StateFailed {
		d := time.Now().Add(20 * time.Minute)
		deadlineAt = &d
		a := "await_capture"
		deadlineAction = &a
	}

	err := r.tx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO payment_intent (order_id, kind, stripe_payment_intent_id, stripe_customer_id,
			                            stripe_payment_method_id, state, amount_authorized_cents,
			                            amount_captured_cents, currency, card_brand, card_last4, card_country,
			                            wallet, failure_code, failure_message, decline_code,
			                            authorized_at, captured_at, deadline_at, deadline_action)
			VALUES ($1, 'ORDER', $2, NULL, NULL, $3, $4, $5, 'CAD', $6, $7, $8, $9, $10, $11, $12,
			        $13, $14, $15, $16)
			ON CONFLICT (stripe_payment_intent_id) DO UPDATE SET
			  state = EXCLUDED.state,
			  amount_authorized_cents = GREATEST(payment_intent.amount_authorized_cents, EXCLUDED.amount_authorized_cents),
			  amount_captured_cents = GREATEST(payment_intent.amount_captured_cents, EXCLUDED.amount_captured_cents),
			  card_brand = COALESCE(EXCLUDED.card_brand, payment_intent.card_brand),
			  card_last4 = COALESCE(EXCLUDED.card_last4, payment_intent.card_last4),
			  wallet = COALESCE(EXCLUDED.wallet, payment_intent.wallet),
			  failure_code = EXCLUDED.failure_code,
			  failure_message = EXCLUDED.failure_message,
			  decline_code = EXCLUDED.decline_code,
			  captured_at = COALESCE(payment_intent.captured_at, EXCLUDED.captured_at),
			  deadline_at = EXCLUDED.deadline_at,
			  deadline_action = EXCLUDED.deadline_action,
			  updated_at = now()`,
			orderID, pi.ID, state, authorized, captured,
			nullStr(pi.CardBrand), nullStr(pi.CardLast4), nullStr(pi.CardCountry),
			nullStr(pi.Wallet), nullStr(pi.FailureCode), nullStr(pi.FailureMessage), nullStr(pi.DeclineCode),
			authAt(terminal), capAt(terminal, captured), deadlineAt, deadlineAction)
		return err
	})
	if err != nil {
		return IntentRow{}, fmt.Errorf("upsert order intent: %w", err)
	}
	return r.GetIntentByStripeID(ctx, pi.ID)
}

func authAt(st PaymentState) any {
	if paymentStateRank[st] >= paymentStateRank[StateRequiresCapture] {
		return time.Now()
	}
	return nil
}

func capAt(st PaymentState, captured int64) any {
	if st == StateSucceeded && captured > 0 {
		return time.Now()
	}
	return nil
}

// InsertConnectAccount stores a newly created Express connected account.
func (r *Repo) InsertConnectAccount(ctx context.Context, ownerType, ownerID string, acct *StripeAccount) error {
	reqs, _ := json.Marshal(connectReqsMap(acct))
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `
		INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, country, default_currency,
		                             charges_enabled, payouts_enabled, details_submitted, requirements,
		                             disabled_reason, payout_interval, payout_anchor, minimum_payout_cents)
		VALUES ($1, $2, $3, 'CA', 'CAD', $4, $5, $6, $7, $8, 'WEEKLY', 1, 0)
		ON CONFLICT (owner_type, owner_id) DO NOTHING`,
		ownerType, ownerID, acct.ID, acct.ChargesEnabled, acct.PayoutsEnabled,
		acct.DetailsSubmitted, reqs, nullStr(acct.DisabledReason)); err != nil {
		return err
	}
	// A restaurant's payout account reaching READY advances PAYOUT_PENDING → MENU_PENDING
	// (R-11). Idempotent: no-ops unless payouts are enabled and the state is PAYOUT_PENDING.
	if ownerType == "RESTAURANT" {
		if err := restaurant.RecomputeOnboarding(ctx, tx, ownerID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// connectUpdate is what applying an account.updated snapshot did.
type connectUpdate int

const (
	connectUnknown connectUpdate = iota // no connect_account has this Stripe id
	connectStale                        // a newer snapshot was already applied
	connectApplied
)

// updateConnectFromStripe applies an account.updated webhook to
// connect_account inside the caller's transaction (docs/spec/01-platform.md,
// "P-19 — Stripe Connect: onboarding and payouts (Canada)", step 4:
// account.updated keeps it current). asOf is the event's creation time:
// an account is a snapshot with no lifecycle order, so an older snapshot
// arriving after a newer one is skipped rather than allowed to undo it.
func updateConnectFromStripe(ctx context.Context, tx pgx.Tx, acct *StripeAccount, asOf time.Time) (connectUpdate, error) {
	reqs, _ := json.Marshal(connectReqsMap(acct))
	var ownerType, ownerID string
	err := tx.QueryRow(ctx, `
		UPDATE connect_account
		   SET charges_enabled = $2, payouts_enabled = $3, details_submitted = $4,
		       requirements = $5, disabled_reason = $6, last_stripe_event_created_at = $7, updated_at = now()
		 WHERE stripe_account_id = $1
		   AND (last_stripe_event_created_at IS NULL OR last_stripe_event_created_at <= $7)
		RETURNING owner_type::text, owner_id::text`,
		acct.ID, acct.ChargesEnabled, acct.PayoutsEnabled, acct.DetailsSubmitted,
		reqs, nullStr(acct.DisabledReason), asOf).Scan(&ownerType, &ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		var known bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM connect_account WHERE stripe_account_id = $1)`,
			acct.ID).Scan(&known); err != nil {
			return connectUnknown, err
		}
		if known {
			return connectStale, nil
		}
		return connectUnknown, nil
	}
	if err != nil {
		return connectUnknown, err
	}
	// A restaurant's payout account reaching READY advances PAYOUT_PENDING → MENU_PENDING (R-11).
	if ownerType == "RESTAURANT" {
		if err := restaurant.RecomputeOnboarding(ctx, tx, ownerID); err != nil {
			return connectUnknown, err
		}
	}
	return connectApplied, nil
}

// connectReqsMap builds the requirements JSONB map to store. The
// requirements_deadline unix timestamp is embedded so GetConnectAccount can
// surface it as the contract ConnectRequirements.deadline date-time string.
func connectReqsMap(acct *StripeAccount) map[string]any {
	m := map[string]any{
		"currently_due":  acct.CurrentlyDue,
		"eventually_due": acct.EventuallyDue,
		"past_due":       acct.PastDue,
	}
	if acct.Deadline != nil && *acct.Deadline != 0 {
		m["requirements_deadline"] = *acct.Deadline
	}
	return m
}
