package orders

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/idempotency"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/pricing"
)

// OrderInput is the createOrder request, assembled from the validated body. It
// carries a quote_id and delivery preferences — no amount (G-3).
type OrderInput struct {
	AccountID            string
	QuoteID              string
	PaymentMethodID      *string
	SavePaymentMethod    bool
	DeliveryInstructions []string
	SpecialInstructions  *string
	// Idem is the request's Idempotency-Key, claimed in the order's own
	// transaction; nil runs without one.
	Idem *idempotency.Key
}

// PreparedOrder is the result of the pre-payment order transaction: the order
// row is created in CREATED with a 15-minute deadline, its lines and add-ons are
// snapshotted, and the caller now asks the payment gateway for a client secret.
type PreparedOrder struct {
	OrderID      string
	OrderCode    string
	QuoteID      string
	TotalCents   int64
	RestaurantID string

	// RecordID is the idempotency record this request holds; the handler
	// completes it with the answer once the gateway has replied.
	RecordID string
	// Replay is the first answer to this key: send it and do nothing else.
	Replay *idempotency.Response
	// Resumed is set when an earlier attempt with this key created the order
	// but died before answering; State is the order's state now. The handler
	// finishes that attempt (the gateway call is keyed by the order id, so it
	// is safe to repeat).
	Resumed bool
	State   machine.State
}

// errOrderReplay rolls back a transaction that found the key already answered.
var errOrderReplay = errors.New("idempotent replay")

// CreateOrder re-executes the quote and compares it to the stored quote. On any
// difference it returns ErrQuoteStale with the freshly computed quote; on expiry
// ErrQuoteExpired; on an existing active order ErrActiveOrderExists. Otherwise it
// creates the order, its lines and add-ons and the CREATED-state transition in
// one transaction, and returns a PreparedOrder for the caller to hand to the
// payment gateway.
//
// The PaymentIntent creation is a network call and therefore cannot live inside
// this transaction; the caller (handler) performs it after this returns and, on
// gateway failure, calls FailOrderCreation to roll the order back to a terminal
// FAILED state (or the handler wraps the whole thing so the order row is only
// committed once the gateway has answered — see the handler).
func (s *Store) CreateOrder(ctx context.Context, in OrderInput, freshQuote **Quote) (*PreparedOrder, error) {
	var prepared *PreparedOrder
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		// The Idempotency-Key first, before any refusal can be computed from
		// the order an earlier attempt with it made: a retried checkout gets
		// that attempt's answer, not ACTIVE_ORDER_EXISTS
		// (https://github.com/shaiknoorullah/hg-mono/issues/363). A refusal
		// below rolls the claim back with everything else, so the same key
		// can be sent again.
		var recordID string
		if in.Idem != nil {
			c, err := idempotency.Claim(ctx, tx, in.Idem)
			if err != nil {
				return err
			}
			if c.Replay != nil {
				prepared = &PreparedOrder{Replay: c.Replay}
				return errOrderReplay
			}
			if c.ResourceID != "" {
				p := PreparedOrder{OrderID: c.ResourceID, RecordID: c.RecordID, Resumed: true}
				var state string
				if err := tx.QueryRow(ctx, `
					SELECT code, quote_id::text, total_cents, restaurant_id::text, state::text
					  FROM "order" WHERE id = $1`, c.ResourceID).
					Scan(&p.OrderCode, &p.QuoteID, &p.TotalCents, &p.RestaurantID, &state); err != nil {
					return fmt.Errorf("load the order an earlier attempt made: %w", err)
				}
				p.State = machine.State(state)
				prepared = &p
				return nil
			}
			recordID = c.RecordID
		}

		// No new orders while staff have paused them platform-wide
		// (https://github.com/shaiknoorullah/hg-mono/issues/244). First, and
		// FOR SHARE: the lock lasts until this transaction ends, so a pause
		// committing meanwhile waits for this order or makes it refuse here;
		// an order is never created after the pause committed.
		if err := requireOrderingOpen(ctx, tx, true); err != nil {
			return err
		}

		// Load the stored quote, owned by the account, FOR UPDATE so a concurrent
		// order for the same quote serialises.
		stored, err := s.loadQuoteTx(ctx, tx, in.QuoteID, in.AccountID)
		if err != nil {
			return err
		}
		if time.Now().UTC().After(stored.ExpiresAt) {
			return ErrQuoteExpired
		}

		// One active order per customer, where an order under review after a
		// problem report does not count (machine.CountsAsActive holds the rule
		// and the owner's decision behind it; issue
		// https://github.com/shaiknoorullah/hg-mono/issues/260).
		//
		// The same customer's checkouts queue on this lock until this
		// transaction ends, so a second one counts only after the first has
		// committed. Without it two racing checkouts both counted zero and both
		// placed an order.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
			"order.create:"+in.AccountID); err != nil {
			return fmt.Errorf("lock the customer's checkout: %w", err)
		}
		var activeCount int
		err = tx.QueryRow(ctx, `
			SELECT count(*) FROM "order"
			 WHERE account_id = $1
			   AND state::text = ANY($2)`,
			in.AccountID, machine.ActiveStates()).Scan(&activeCount)
		if err != nil {
			return fmt.Errorf("count active: %w", err)
		}
		if activeCount > 0 {
			return ErrActiveOrderExists
		}

		// Re-execute the quote from current DB state and compare (P-09/I-09.5).
		req := QuoteRequest{
			AccountID: in.AccountID, CartID: stored.CartID,
			DeliveryAddressID: stored.DeliveryAddressID, Fulfilment: stored.Fulfilment,
			TipCents: stored.TipCents, PromoCode: stored.PromoCode,
		}
		rc, err := s.resolve(ctx, tx, req)
		if err != nil {
			return err
		}
		res, err := pricing.Compute(rc.inputs)
		if err != nil {
			return err
		}
		// The comparison that protects the money: totals and the whole customer
		// decomposition must match. A single divergent cent is QUOTE_STALE.
		if !quoteMatches(stored, res) {
			expiresAt := time.Now().UTC().Add(time.Duration(maxInt(rc.inputs.Config.QuoteTTLSeconds, 600)) * time.Second)
			newQ, perr := s.persistQuote(ctx, tx, req, rc, res, stored.InputHash, stored.StateHash, expiresAt)
			if perr != nil {
				return perr
			}
			if freshQuote != nil {
				*freshQuote = newQ
			}
			return ErrQuoteStale
		}

		// Create the order in CREATED with the 15-minute EXPIRE_PAYMENT deadline.
		now := time.Now().UTC()
		deadlineAt, deadlineAction, ok := machine.ComputeDeadline(machine.StateCreated, now, 0)
		if !ok {
			return fmt.Errorf("internal: CREATED has no deadline")
		}
		code, err := newOrderCode()
		if err != nil {
			return err
		}

		deliveryInstructions := in.DeliveryInstructions
		if deliveryInstructions == nil {
			deliveryInstructions = []string{}
		}
		var orderID string
		err = tx.QueryRow(ctx, `
			INSERT INTO "order" (
				code, quote_id, account_id, restaurant_id, delivery_address_id, fulfilment,
				state, state_since, deadline_at, deadline_action,
				currency, subtotal_cents, discount_cents, delivery_fee_cents, service_fee_cents,
				tax_total_cents, tip_cents, total_cents,
				commission_cents, restaurant_net_cents, rider_earnings_cents, platform_gross_cents,
				delivery_instructions, special_instructions, placed_at
			) VALUES (
				$1,$2,$3,$4,$5,$6,
				'CREATED',$7,$8,$9,
				'CAD',$10,$11,$12,$13,
				$14,$15,$16,
				$17,$18,$19,$20,
				$21::delivery_instruction[],$22,$7
			) RETURNING id`,
			code, stored.ID, in.AccountID, stored.RestaurantID, stored.DeliveryAddressID, stored.Fulfilment,
			now, deadlineAt, deadlineAction,
			stored.SubtotalCents,
			stored.DiscountItemsCents+stored.DiscountDeliveryCents+stored.DiscountServiceCents,
			stored.DeliveryFeeCents, stored.ServiceFeeCents,
			stored.TaxTotalCents, stored.TipCents, stored.TotalCents,
			stored.CommissionCents, stored.RestaurantNetCents, stored.RiderEarningsCents, stored.PlatformGrossCents,
			deliveryInstructions, in.SpecialInstructions,
		).Scan(&orderID)
		if err != nil {
			return fmt.Errorf("insert order: %w", err)
		}

		// Order lines + add-ons, copied from the quote (add-on money never dropped).
		for _, l := range stored.Lines {
			_, err := tx.Exec(ctx, `
				INSERT INTO order_line (
					order_id, line_no, menu_item_id, item_version_id, name_snapshot,
					variant_id, variant_name, variant_pricing_mode, quantity,
					base_price_cents, variant_part_cents, addons_part_cents,
					line_unit_cents, line_total_cents, special_request, tax_category
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
				orderID, l.LineNo, l.MenuItemID, l.MenuItemVersionID, l.MenuItemName,
				l.VariantID, l.VariantName, l.VariantPricingMode, l.Quantity,
				l.BasePriceCents, l.VariantPartCents, l.AddonsPartCents,
				l.LineUnitCents, l.LineTotalCents, l.SpecialRequest, l.TaxCategory)
			if err != nil {
				return fmt.Errorf("insert order_line: %w", err)
			}
			for _, a := range l.Addons {
				_, err := tx.Exec(ctx, `
					INSERT INTO order_line_addon (order_id, line_no, addon_id, addon_name, addon_quantity, addon_price_cents)
					VALUES ($1,$2,$3,$4,$5,$6)`,
					orderID, l.LineNo, a.AddonID, a.AddonName, a.AddonQuantity, a.PriceCents)
				if err != nil {
					return fmt.Errorf("insert order_line_addon: %w", err)
				}
			}
		}

		// The creation transition (I-14.2: one row per state change).
		if err := insertTransition(ctx, tx, orderID, nil, machine.StateCreated,
			machine.ActorCustomer, in.AccountID, "order placed", ""); err != nil {
			return err
		}
		// The cart becomes the order (C-23 rule 1): consumed in the same transaction, so a
		// placed order never leaves its lines behind in the cart bar. A payment that fails
		// is retried against this order, not a new cart; an unpaid order that ends offers
		// "Put these items back in your cart" (C-23 rule 8).
		if _, err := tx.Exec(ctx, `
			UPDATE cart SET deleted_at = now()
			 WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL`,
			stored.CartID, in.AccountID); err != nil {
			return fmt.Errorf("consume the cart: %w", err)
		}
		// order.created and the first order.state_changed, in this transaction
		// (events.go). Creation has no notification of its own, so the notifier
		// is not called.
		if err := emitOrderEvents(ctx, tx, transitionFacts{
			OrderID: orderID, To: machine.StateCreated,
			Actor: machine.ActorCustomer, ActorAccountID: in.AccountID,
		}); err != nil {
			return fmt.Errorf("emit order created: %w", err)
		}

		if recordID != "" {
			if err := idempotency.Attach(ctx, tx, recordID, "order", orderID); err != nil {
				return fmt.Errorf("attach the order to its idempotency key: %w", err)
			}
		}

		prepared = &PreparedOrder{
			OrderID: orderID, OrderCode: code, QuoteID: stored.ID,
			TotalCents: stored.TotalCents, RestaurantID: stored.RestaurantID,
			RecordID: recordID, State: machine.StateCreated,
		}
		return nil
	})
	if errors.Is(err, errOrderReplay) {
		return prepared, nil
	}
	if err != nil {
		return nil, err
	}
	return prepared, nil
}

// quoteMatches compares the stored quote to a freshly computed result. Any
// difference in the customer-facing decomposition or the line shape is a
// mismatch (QUOTE_STALE). The internal split is derived from the same inputs, so
// comparing the customer numbers plus the lines is sufficient and matches what
// the customer re-confirms.
func quoteMatches(stored *Quote, res pricing.Result) bool {
	if stored.TotalCents != res.TotalCents.Cents() ||
		stored.SubtotalCents != res.SubtotalCents.Cents() ||
		stored.DeliveryFeeCents != res.DeliveryFeeCents.Cents() ||
		stored.ServiceFeeCents != res.ServiceFeeCents.Cents() ||
		stored.TaxTotalCents != res.TaxTotalCents.Cents() ||
		stored.TipCents != res.TipCents.Cents() ||
		stored.DiscountItemsCents != res.DiscountItemsCents.Cents() ||
		stored.DiscountDeliveryCents != res.DiscountDeliveryCents.Cents() ||
		stored.DiscountServiceCents != res.DiscountServiceCents.Cents() {
		return false
	}
	if len(stored.Lines) != len(res.Lines) {
		return false
	}
	for i := range stored.Lines {
		if stored.Lines[i].LineTotalCents != res.Lines[i].LineTotalCents.Cents() ||
			stored.Lines[i].MenuItemID != res.Lines[i].MenuItemID ||
			stored.Lines[i].Quantity != res.Lines[i].Quantity {
			return false
		}
	}
	return true
}

// insertTransition writes one order_transition row (I-14.2).
func insertTransition(ctx context.Context, tx pgx.Tx, orderID string, from *machine.State, to machine.State,
	actor machine.ActorKind, actorAccountID, reason, requestID string) error {
	var fromVal *string
	if from != nil {
		s := string(*from)
		fromVal = &s
	}
	var actorAcct *string
	if actorAccountID != "" {
		actorAcct = &actorAccountID
	}
	var reqID *string
	if requestID != "" {
		reqID = &requestID
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO order_transition (order_id, from_state, to_state, actor_kind, actor_account_id, reason, request_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		orderID, fromVal, string(to), string(actor), actorAcct, nullIfEmpty(reason), reqID)
	return err
}

// newOrderCode mints a human-readable order code like HG-8F3K2Q.
func newOrderCode() (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no confusable chars
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := []byte("HG-XXXXXX")
	for i := 0; i < 6; i++ {
		out[3+i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(out), nil
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

var _ = errors.Is
