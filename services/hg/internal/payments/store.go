package payments

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a row the caller expected does not exist.
var ErrNotFound = errors.New("not found")

// Repo is the payments persistence layer. It owns only this module's tables
// (payment_intent, saved_payment_method, webhook_event, refund, refund_line,
// ledger_batch, ledger_entry, connect_account, payout, earning_entry) plus
// read-only access to "order" and order_line for refund computation. It never
// writes another module's table.
type Repo struct {
	pool *pgxpool.Pool
}

// NewRepo builds a Repo over an existing pgx pool.
func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

// querier is satisfied by both *pgxpool.Pool and pgx.Tx, so read helpers work
// inside or outside a transaction.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconnCommandTag, error)
}

// pgconnCommandTag aliases the concrete tag so querier stays import-light.
type pgconnCommandTag = interface{ RowsAffected() int64 }

// ---------------------------------------------------------------------------
// Saved payment methods (C-24).
// ---------------------------------------------------------------------------

// ListPaymentMethods returns a customer's non-deleted saved cards, default first.
func (r *Repo) ListPaymentMethods(ctx context.Context, accountID string) ([]PaymentMethodDTO, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, brand, last4, exp_month, exp_year, is_default
		  FROM saved_payment_method
		 WHERE account_id = $1 AND deleted_at IS NULL
		 ORDER BY is_default DESC, created_at DESC`, accountID)
	if err != nil {
		return nil, fmt.Errorf("list payment methods: %w", err)
	}
	defer rows.Close()

	out := make([]PaymentMethodDTO, 0)
	for rows.Next() {
		var pm PaymentMethodDTO
		if err := rows.Scan(&pm.ID, &pm.Brand, &pm.Last4, &pm.ExpMonth, &pm.ExpYear, &pm.IsDefault); err != nil {
			return nil, err
		}
		out = append(out, pm)
	}
	return out, rows.Err()
}

// CountPaymentMethods returns the number of non-deleted saved cards (C-24 cap).
func (r *Repo) CountPaymentMethods(ctx context.Context, accountID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM saved_payment_method WHERE account_id = $1 AND deleted_at IS NULL`,
		accountID).Scan(&n)
	return n, err
}

// StripeCustomerID returns the account's stored Stripe customer id, if any.
// A saved payment method row carries no customer id column, so the source is
// the account table's stripe_customer_id if present; absence yields "".
func (r *Repo) StripeCustomerID(ctx context.Context, accountID string) (string, error) {
	var id *string
	err := r.pool.QueryRow(ctx,
		`SELECT stripe_customer_id FROM account WHERE id = $1`, accountID).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		// The account table may not carry this column in every schema revision;
		// treat a missing column as "no customer yet" rather than failing money.
		return "", nil
	}
	if id == nil {
		return "", nil
	}
	return *id, nil
}

// PaymentMethodOwned reports whether the card belongs to the account and is live.
func (r *Repo) PaymentMethodOwned(ctx context.Context, accountID, methodID string) (bool, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM saved_payment_method
		 WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL`, methodID, accountID).Scan(&n)
	return n > 0, err
}

// PaymentMethodInUse reports whether a saved card backs an order not in a
// terminal money state (P-16 / delete guard).
func (r *Repo) PaymentMethodInUse(ctx context.Context, accountID, methodID string) (bool, error) {
	var spmID string
	err := r.pool.QueryRow(ctx,
		`SELECT stripe_payment_method_id FROM saved_payment_method WHERE id = $1 AND account_id = $2`,
		methodID, accountID).Scan(&spmID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, ErrNotFound
		}
		return false, err
	}
	var n int
	err = r.pool.QueryRow(ctx, `
		SELECT count(*) FROM payment_intent pi
		 JOIN "order" o ON o.id = pi.order_id
		 WHERE pi.stripe_payment_method_id = $1
		   AND o.state NOT IN ('COMPLETED','CANCELLED','REJECTED','FAILED','RESOLVED')`,
		spmID).Scan(&n)
	return n > 0, err
}

// SoftDeletePaymentMethod marks a card deleted and, if it was default, promotes
// the most recently used remaining card, all in one transaction.
func (r *Repo) SoftDeletePaymentMethod(ctx context.Context, accountID, methodID string) error {
	return r.tx(ctx, func(tx pgx.Tx) error {
		var wasDefault bool
		err := tx.QueryRow(ctx, `
			UPDATE saved_payment_method SET deleted_at = now()
			 WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL
			 RETURNING is_default`, methodID, accountID).Scan(&wasDefault)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if !wasDefault {
			return nil
		}
		// Clear the flag on the deleted row and promote the newest remaining one.
		if _, err := tx.Exec(ctx,
			`UPDATE saved_payment_method SET is_default = false WHERE id = $1`, methodID); err != nil {
			return err
		}
		var next string
		err = tx.QueryRow(ctx, `
			SELECT id::text FROM saved_payment_method
			 WHERE account_id = $1 AND deleted_at IS NULL
			 ORDER BY created_at DESC LIMIT 1`, accountID).Scan(&next)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE saved_payment_method SET is_default = true WHERE id = $1`, next)
		return err
	})
}

// SetDefaultPaymentMethod makes a card the sole default for its account.
func (r *Repo) SetDefaultPaymentMethod(ctx context.Context, accountID, methodID string) (PaymentMethodDTO, error) {
	var pm PaymentMethodDTO
	err := r.tx(ctx, func(tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM saved_payment_method WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL`,
			methodID, accountID).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		if _, err := tx.Exec(ctx,
			`UPDATE saved_payment_method SET is_default = false WHERE account_id = $1 AND is_default AND deleted_at IS NULL`,
			accountID); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			UPDATE saved_payment_method SET is_default = true
			 WHERE id = $1 AND account_id = $2
			 RETURNING id::text, brand, last4, exp_month, exp_year, is_default`,
			methodID, accountID).Scan(&pm.ID, &pm.Brand, &pm.Last4, &pm.ExpMonth, &pm.ExpYear, &pm.IsDefault)
	})
	return pm, err
}

// ---------------------------------------------------------------------------
// Payment intents.
// ---------------------------------------------------------------------------

// IntentRow is the payment_intent row the module reads back.
type IntentRow struct {
	ID                    string
	OrderID               string
	Kind                  string
	StripePaymentIntentID string
	State                 string
	AmountAuthorizedCents int64
	AmountCapturedCents   int64
	AmountRefundedCents   int64
	Currency              string
	CardBrand             string
	CardLast4             string
	Wallet                string
	FailureCode           string
	DeclineCode           string
	AuthorizedAt          *time.Time
	CapturedAt            *time.Time
	LastEventAt           *time.Time
}

// GetOrderIntent returns the primary ORDER payment_intent for an order.
func (r *Repo) GetOrderIntent(ctx context.Context, orderID string) (IntentRow, error) {
	return scanIntent(r.pool.QueryRow(ctx, intentSelect+` WHERE order_id = $1 AND kind = 'ORDER'`, orderID))
}

// GetIntentByStripeID returns the payment_intent for a Stripe intent id.
func (r *Repo) GetIntentByStripeID(ctx context.Context, stripeID string) (IntentRow, error) {
	return scanIntent(r.pool.QueryRow(ctx, intentSelect+` WHERE stripe_payment_intent_id = $1`, stripeID))
}

const intentSelect = `
	SELECT id::text, order_id::text, kind::text, stripe_payment_intent_id, state::text,
	       amount_authorized_cents, amount_captured_cents, amount_refunded_cents, currency::text,
	       coalesce(card_brand,''), coalesce(card_last4,''), coalesce(wallet,''),
	       coalesce(failure_code,''), coalesce(decline_code,''),
	       authorized_at, captured_at, last_stripe_event_created_at
	  FROM payment_intent`

func scanIntent(row pgx.Row) (IntentRow, error) {
	var i IntentRow
	err := row.Scan(&i.ID, &i.OrderID, &i.Kind, &i.StripePaymentIntentID, &i.State,
		&i.AmountAuthorizedCents, &i.AmountCapturedCents, &i.AmountRefundedCents, &i.Currency,
		&i.CardBrand, &i.CardLast4, &i.Wallet, &i.FailureCode, &i.DeclineCode,
		&i.AuthorizedAt, &i.CapturedAt, &i.LastEventAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return IntentRow{}, ErrNotFound
	}
	return i, err
}

// AdvanceIntentState sets a payment_intent's state to `target` and stamps the
// matching timestamp. It also clears the deadline when moving into a terminal
// state so the deadline CHECK is satisfied. Returns applied=false when the row
// was already in that state (idempotent re-application).
func (r *Repo) AdvanceIntentState(ctx context.Context, stripeID string, target PaymentState) (bool, error) {
	var authoredCol, canceledCol string
	terminal := false
	switch target {
	case StateRequiresCapture:
		authoredCol = "authorized_at = coalesce(authorized_at, now())"
	case StateSucceeded:
		terminal = true
	case StateCanceled, StateFailed:
		terminal = true
		canceledCol = "canceled_at = coalesce(canceled_at, now())"
	}
	set := "state = $2"
	if authoredCol != "" {
		set += ", " + authoredCol
	}
	if canceledCol != "" {
		set += ", " + canceledCol
	}
	if terminal {
		set += ", deadline_at = NULL, deadline_action = NULL"
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE payment_intent SET `+set+`, last_stripe_event_created_at = now()
		 WHERE stripe_payment_intent_id = $1 AND state <> $2`, stripeID, string(target))
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// RecordCapture stamps a captured amount and posts the CAPTURE ledger batch in
// one transaction. Both the state move and the batch are idempotent: a
// redelivered succeeded event captures once and posts one batch (I-17.1).
func (r *Repo) RecordCapture(ctx context.Context, stripeID string, capturedCents int64, batch LedgerBatch) error {
	return r.tx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			UPDATE payment_intent
			   SET state = 'SUCCEEDED',
			       amount_captured_cents = $2,
			       captured_at = coalesce(captured_at, now()),
			       last_stripe_event_created_at = now(),
			       deadline_at = NULL, deadline_action = NULL
			 WHERE stripe_payment_intent_id = $1`, stripeID, capturedCents)
		if err != nil {
			return err
		}
		return insertBatch(ctx, tx, batch)
	})
}

// ---------------------------------------------------------------------------
// Orders (read-only) — for refund computation and ledger decomposition.
// ---------------------------------------------------------------------------

// GetOrderMoney reads an order's decomposed money plus its account/restaurant.
func (r *Repo) GetOrderMoney(ctx context.Context, orderID string) (OrderMoney, string, error) {
	var m OrderMoney
	var accountID string
	err := r.pool.QueryRow(ctx, `
		SELECT o.id::text, o.restaurant_id::text, o.account_id::text,
		       o.subtotal_cents, o.discount_cents, o.delivery_fee_cents, o.service_fee_cents,
		       o.tax_total_cents, o.tip_cents, o.total_cents,
		       o.commission_cents, o.restaurant_net_cents, o.rider_earnings_cents, o.platform_gross_cents,
		       coalesce((SELECT a.rider_account_id::text FROM assignment a
		                  WHERE a.order_id = o.id AND a.state = 'DELIVERED'
		                  ORDER BY a.created_at DESC LIMIT 1), '')
		  FROM "order" o WHERE o.id = $1`, orderID).Scan(
		&m.OrderID, &m.RestaurantID, &accountID,
		&m.SubtotalCents, &m.DiscountCents, &m.DeliveryFeeCents, &m.ServiceFeeCents,
		&m.TaxTotalCents, &m.TipCents, &m.TotalCents,
		&m.CommissionCents, &m.RestaurantNetCents, &m.RiderEarningsCents, &m.PlatformGrossCents,
		&m.RiderID)
	if errors.Is(err, pgx.ErrNoRows) {
		return OrderMoney{}, "", ErrNotFound
	}
	return m, accountID, err
}

// GetOrderLines reads an order's lines for PARTIAL_ITEMS computation.
func (r *Repo) GetOrderLines(ctx context.Context, orderID string) ([]OrderLine, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT line_no, quantity, line_total_cents, tax_category::text
		  FROM order_line WHERE order_id = $1 ORDER BY line_no`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]OrderLine, 0)
	for rows.Next() {
		var l OrderLine
		if err := rows.Scan(&l.LineNo, &l.Quantity, &l.LineTotalCents, &l.TaxCategory); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// PriorRefundedCents returns the sum of an order's non-void refunds (I-18.1).
func (r *Repo) PriorRefundedCents(ctx context.Context, q querier, orderID string) (int64, error) {
	if q == nil {
		q = poolQuerier{r.pool}
	}
	var sum int64
	err := q.QueryRow(ctx, `
		SELECT coalesce(sum(amount_cents),0) FROM refund
		 WHERE order_id = $1 AND state NOT IN ('DECLINED','CANCELLED','FAILED')`, orderID).Scan(&sum)
	return sum, err
}

// IssuedByOperatorSince returns the sum of refund amounts an operator has issued
// (as requested_by) since `since`, over refunds that still count against the
// cap. It is the numerator of the A-33 rolling authority window: the cap is a
// 24-hour window, not a per-request limit, so many small refunds still trip it.
// DECLINED and CANCELLED refunds never happened for the customer, so they do not
// consume the window.
func (r *Repo) IssuedByOperatorSince(ctx context.Context, operatorID string, since time.Time) (int64, error) {
	var sum int64
	err := r.pool.QueryRow(ctx, `
		SELECT coalesce(sum(amount_cents),0) FROM refund
		 WHERE requested_by = $1
		   AND requested_at >= $2
		   AND state NOT IN ('DECLINED','CANCELLED')`, operatorID, since).Scan(&sum)
	return sum, err
}

// ---------------------------------------------------------------------------
// Refunds — write path.
// ---------------------------------------------------------------------------

// CreateRefundParams carries everything needed to persist a refund plus its
// balanced ledger batch in one transaction (P-18: transactional compensation).
type CreateRefundParams struct {
	OrderID         string
	PaymentIntentID string
	Kind            RefundKind
	Scope           RefundScope
	ReasonCode      string
	Note            string
	AmountCents     int64
	TaxCents        int64
	Split           LiabilitySplit
	State           RefundState
	ApprovalStatus  string // "", PENDING, APPROVED, DECLINED
	RequestedBy     string
	ApprovedBy      string
	DeadlineAction  string
	Lines           []RefundLineAmount
	Ledger          *LedgerBatch // nil until AUTHORISED
	Money           OrderMoney
}

// CreateRefund inserts the refund, its lines and (when provided) its balanced
// ledger batch in a single transaction. The deferred triggers assert
// refund≤captured and batch balance at COMMIT.
func (r *Repo) CreateRefund(ctx context.Context, p CreateRefundParams) (string, error) {
	var refundID string
	err := r.tx(ctx, func(tx pgx.Tx) error {
		var deadlineAt *time.Time
		if !terminalRefund(p.State) {
			d := time.Now().Add(2 * time.Minute)
			deadlineAt = &d
		}
		var approval *string
		if p.ApprovalStatus != "" {
			approval = &p.ApprovalStatus
		}
		var approvedBy *string
		if p.ApprovedBy != "" {
			approvedBy = &p.ApprovedBy
		}
		var action *string
		if p.DeadlineAction != "" {
			action = &p.DeadlineAction
		}
		err := tx.QueryRow(ctx, `
			INSERT INTO refund (order_id, payment_intent_id, kind, scope, reason_code, note,
			                    amount_cents, tax_cents,
			                    restaurant_chargeback_cents, rider_chargeback_cents, platform_absorbed_cents,
			                    state, approval_status, requested_by, approved_by,
			                    deadline_at, deadline_action)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
			RETURNING id::text`,
			p.OrderID, p.PaymentIntentID, string(p.Kind), string(p.Scope), p.ReasonCode, nullStr(p.Note),
			p.AmountCents, p.TaxCents,
			p.Split.RestaurantChargebackCents, p.Split.RiderChargebackCents, p.Split.PlatformAbsorbedCents,
			string(p.State), approval, p.RequestedBy, approvedBy,
			deadlineAt, action).Scan(&refundID)
		if err != nil {
			return err
		}
		for _, l := range p.Lines {
			if _, err := tx.Exec(ctx, `
				INSERT INTO refund_line (refund_id, order_line_no, quantity, amount_cents)
				VALUES ($1,$2,$3,$4)`, refundID, l.OrderLineNo, l.Quantity, l.AmountCents); err != nil {
				return err
			}
		}
		if p.Ledger != nil {
			p.Ledger.RefundID = refundID
			if err := insertBatch(ctx, tx, *p.Ledger); err != nil {
				return err
			}
		}
		return nil
	})
	return refundID, err
}

// RefundRow is a refund read back for the API.
type RefundRow struct {
	ID             string
	OrderID        string
	Kind           string
	Scope          string
	ReasonCode     string
	AmountCents    int64
	TaxCents       int64
	Currency       string
	State          string
	RestaurantCB   int64
	RiderCB        int64
	PlatformAbsorb int64
	Note           string
	RequestedAt    time.Time
	SettledAt      *time.Time
	FailureMessage string
}

// The refund table carries no currency of its own; a refund is always in the
// currency of the payment_intent it compensates (money is int64 cents, CAD at
// launch). Source it from the joined intent so the DTO's required `currency`
// field is authoritative rather than assumed.
const refundSelect = `
	SELECT r.id::text, r.order_id::text, r.kind::text, r.scope::text, r.reason_code::text,
	       r.amount_cents, r.tax_cents, pi.currency::text, r.state::text,
	       r.restaurant_chargeback_cents, r.rider_chargeback_cents, r.platform_absorbed_cents,
	       coalesce(r.note,''), r.requested_at, r.settled_at, coalesce(r.failure_message,'')
	  FROM refund r
	  JOIN payment_intent pi ON pi.id = r.payment_intent_id`

func scanRefund(row pgx.Row) (RefundRow, error) {
	var rr RefundRow
	err := row.Scan(&rr.ID, &rr.OrderID, &rr.Kind, &rr.Scope, &rr.ReasonCode,
		&rr.AmountCents, &rr.TaxCents, &rr.Currency, &rr.State,
		&rr.RestaurantCB, &rr.RiderCB, &rr.PlatformAbsorb,
		&rr.Note, &rr.RequestedAt, &rr.SettledAt, &rr.FailureMessage)
	if errors.Is(err, pgx.ErrNoRows) {
		return RefundRow{}, ErrNotFound
	}
	return rr, err
}

// GetRefund reads one refund by id.
func (r *Repo) GetRefund(ctx context.Context, id string) (RefundRow, error) {
	return scanRefund(r.pool.QueryRow(ctx, refundSelect+` WHERE r.id = $1`, id))
}

// ListRefundsFilter narrows a refund list.
type ListRefundsFilter struct {
	OrderID   string
	AccountID string // when set, restrict to refunds of this customer's orders
	States    []string
	Limit     int
	AfterID   string // keyset cursor (id < AfterID, newest first)
}

// ListRefunds returns refunds newest-first with keyset pagination.
func (r *Repo) ListRefunds(ctx context.Context, f ListRefundsFilter) ([]RefundRow, error) {
	sql := `
		SELECT r.id::text, r.order_id::text, r.kind::text, r.scope::text, r.reason_code::text,
		       r.amount_cents, r.tax_cents, pi.currency::text, r.state::text,
		       r.restaurant_chargeback_cents, r.rider_chargeback_cents, r.platform_absorbed_cents,
		       coalesce(r.note,''), r.requested_at, r.settled_at, coalesce(r.failure_message,'')
		  FROM refund r
		  JOIN payment_intent pi ON pi.id = r.payment_intent_id`
	args := []any{}
	conds := []string{}
	add := func(cond string, val any) {
		args = append(args, val)
		conds = append(conds, fmt.Sprintf(cond, len(args)))
	}
	if f.OrderID != "" {
		add("r.order_id = $%d", f.OrderID)
	}
	if f.AccountID != "" {
		add("r.order_id IN (SELECT id FROM \"order\" WHERE account_id = $%d)", f.AccountID)
	}
	if len(f.States) > 0 {
		add("r.state = ANY($%d)", f.States)
	}
	if f.AfterID != "" {
		add("r.id < $%d", f.AfterID)
	}
	where := ""
	for i, c := range conds {
		if i == 0 {
			where = " WHERE " + c
		} else {
			where += " AND " + c
		}
	}
	limit := f.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	sql += where + " ORDER BY r.id DESC LIMIT " + fmt.Sprint(limit)

	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]RefundRow, 0)
	for rows.Next() {
		var rr RefundRow
		if err := rows.Scan(&rr.ID, &rr.OrderID, &rr.Kind, &rr.Scope, &rr.ReasonCode,
			&rr.AmountCents, &rr.TaxCents, &rr.Currency, &rr.State,
			&rr.RestaurantCB, &rr.RiderCB, &rr.PlatformAbsorb,
			&rr.Note, &rr.RequestedAt, &rr.SettledAt, &rr.FailureMessage); err != nil {
			return nil, err
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}

// OrderOwnedBy reports whether the order belongs to the account.
func (r *Repo) OrderOwnedBy(ctx context.Context, orderID, accountID string) (bool, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM "order" WHERE id = $1 AND account_id = $2`, orderID, accountID).Scan(&n)
	return n > 0, err
}

// ---------------------------------------------------------------------------
// Webhooks — store-then-process (P-17).
// ---------------------------------------------------------------------------

// InsertWebhookEvent inserts an event; a duplicate (provider, stripe_event_id)
// is the idempotency boundary and returns inserted=false without error.
func (r *Repo) InsertWebhookEvent(ctx context.Context, ev StripeEvent) (inserted bool, err error) {
	deadline := time.Now().Add(2 * time.Second)
	tag, err := r.pool.Exec(ctx, `
		INSERT INTO webhook_event (provider, stripe_event_id, type, api_version, payload,
		                           livemode, event_created_at, deadline_at, deadline_action)
		VALUES ('stripe', $1, $2, $3, $4, $5, to_timestamp($6), $7, 'process_webhook')
		ON CONFLICT (provider, stripe_event_id) DO NOTHING`,
		ev.ID, ev.Type, nullStr(ev.APIVersion), ev.RawPayload,
		ev.LiveMode, ev.Created, deadline)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// storedEvent is one webhook_event row awaiting its business effect.
type storedEvent struct {
	ID            string // webhook_event.id
	StripeEventID string
	Payload       []byte
}

// UnprocessedWebhookEventsSince lists the stored payment_intent events
// created at or after since that have not been applied yet, oldest first.
// Only the types with an effect here (intentEventTargets) are listed: any
// other event stays pending for the handler that will own it.
func (r *Repo) UnprocessedWebhookEventsSince(ctx context.Context, since time.Time) ([]storedEvent, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, stripe_event_id, payload
		  FROM webhook_event
		 WHERE provider = 'stripe' AND processed_at IS NULL AND event_created_at >= $1
		   AND type = ANY($2)
		 ORDER BY event_created_at, received_at`, since, intentEventTypes())
	if err != nil {
		return nil, fmt.Errorf("list unprocessed webhook events: %w", err)
	}
	defer rows.Close()
	var out []storedEvent
	for rows.Next() {
		var e storedEvent
		if err := rows.Scan(&e.ID, &e.StripeEventID, &e.Payload); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// MarkWebhookEventProcessed stamps an applied event. processed_at is what lets
// the row drop its deadline (webhook_event_deadline_required). When applying
// the event found something for a person, exc is filed in the same
// transaction, so an event is never marked done without its exception.
func (r *Repo) MarkWebhookEventProcessed(ctx context.Context, id string, exc *catchUpException) error {
	return r.tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			UPDATE webhook_event
			   SET processed_at = now(), attempts = attempts + 1, last_error = NULL,
			       deadline_at = NULL, deadline_action = NULL, lease_until = NULL, lease_owner = NULL
			 WHERE id = $1 AND processed_at IS NULL`, id); err != nil {
			return err
		}
		if exc == nil {
			return nil
		}
		return fileException(ctx, tx, *exc)
	})
}

// catchUpException is a disagreement with Stripe that the catch-up leaves for
// a person, as a reconciliation_exception row (docs/spec/01-platform.md,
// "P-17 — Webhooks, idempotency and reconciliation").
type catchUpException struct {
	Kind           string // one of catchUpExceptionKinds
	StripeObjectID string // the PaymentIntent
	OrderID        string // empty when this database has no row for it
}

// FileCatchUpException files exc unless the same kind is already open for the
// same payment.
func (r *Repo) FileCatchUpException(ctx context.Context, exc catchUpException) error {
	return r.tx(ctx, func(tx pgx.Tx) error { return fileException(ctx, tx, exc) })
}

func fileException(ctx context.Context, tx pgx.Tx, exc catchUpException) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO reconciliation_exception (kind, stripe_object_id, order_id)
		SELECT $1, $2, $3::uuid
		 WHERE NOT EXISTS (SELECT 1 FROM reconciliation_exception
		                    WHERE kind = $1 AND stripe_object_id = $2 AND resolved_at IS NULL)`,
		exc.Kind, exc.StripeObjectID, nullUUID(exc.OrderID))
	if err != nil {
		return fmt.Errorf("file reconciliation exception %s for %s: %w", exc.Kind, exc.StripeObjectID, err)
	}
	return nil
}

// OpenCatchUpExceptions lists every unresolved exception of a kind the
// catch-up files, oldest first.
func (r *Repo) OpenCatchUpExceptions(ctx context.Context) ([]catchUpException, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT kind, coalesce(stripe_object_id, ''), coalesce(order_id::text, '')
		  FROM reconciliation_exception
		 WHERE resolved_at IS NULL AND kind = ANY($1)
		 ORDER BY detected_at, id`, catchUpExceptionKinds)
	if err != nil {
		return nil, fmt.Errorf("list open reconciliation exceptions: %w", err)
	}
	defer rows.Close()
	var out []catchUpException
	for rows.Next() {
		var e catchUpException
		if err := rows.Scan(&e.Kind, &e.StripeObjectID, &e.OrderID); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// RecordWebhookEventFailure counts a failed attempt and keeps the row pending,
// deadline and all, so it is retried.
func (r *Repo) RecordWebhookEventFailure(ctx context.Context, id, lastError string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE webhook_event SET attempts = attempts + 1, last_error = $2
		 WHERE id = $1 AND processed_at IS NULL`, id, lastError)
	return err
}

// IntentStripeIDsTouchedSince lists the Stripe ids of every payment_intent
// row written at or after since, oldest first.
func (r *Repo) IntentStripeIDsTouchedSince(ctx context.Context, since time.Time) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT stripe_payment_intent_id FROM payment_intent
		 WHERE updated_at >= $1 ORDER BY updated_at`, since)
	if err != nil {
		return nil, fmt.Errorf("list recently touched payment intents: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Ledger.
// ---------------------------------------------------------------------------

// PostBatch inserts a balanced ledger batch and its entries in one transaction.
// A CAPTURE batch whose idempotency_key already exists is a no-op (I-17.1).
func (r *Repo) PostBatch(ctx context.Context, b LedgerBatch) error {
	return r.tx(ctx, func(tx pgx.Tx) error { return insertBatch(ctx, tx, b) })
}

// LedgerBatchPosted reports whether a batch with this idempotency key exists.
func (r *Repo) LedgerBatchPosted(ctx context.Context, idempotencyKey string) (bool, error) {
	var posted bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM ledger_batch WHERE idempotency_key = $1)`, idempotencyKey).Scan(&posted)
	return posted, err
}

func insertBatch(ctx context.Context, tx pgx.Tx, b LedgerBatch) error {
	_, err := postBatchTx(ctx, tx, b)
	return err
}

// postedBatch is a batch this call wrote: its id and its entries' ids, in the
// order of LedgerBatch.Entries.
type postedBatch struct {
	ID       string
	EntryIDs []int64
}

// postBatchTx inserts a balanced batch and its entries. A batch whose
// idempotency key is already posted is a no-op and returns nil, so a caller
// that writes rows alongside the batch (rider earnings) writes them once.
func postBatchTx(ctx context.Context, tx pgx.Tx, b LedgerBatch) (*postedBatch, error) {
	if !b.Balanced() {
		return nil, fmt.Errorf("refusing to post unbalanced batch (residual=%d, entries=%d)", b.Residual(), len(b.Entries))
	}
	var batchID string
	err := tx.QueryRow(ctx, `
		INSERT INTO ledger_batch (kind, order_id, refund_id, payout_id, idempotency_key, posted_by, memo)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id::text`,
		string(b.Kind), nullUUID(b.OrderID), nullUUID(b.RefundID), nullUUID(b.PayoutID),
		b.IdempotencyKey, b.PostedBy, nullStr(b.Memo)).Scan(&batchID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Duplicate idempotency key: the batch is already posted. No-op.
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	posted := &postedBatch{ID: batchID, EntryIDs: make([]int64, 0, len(b.Entries))}
	for _, e := range b.Entries {
		var id int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO ledger_entry (batch_id, order_id, account, counterparty_type, counterparty_id,
			                          amount_cents, component, memo)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING id`,
			batchID, nullUUID(b.OrderID), string(e.Account), nullStr(string(e.CounterpartyType)),
			nullUUID(e.CounterpartyID), e.AmountCents, string(e.Component), nullStr(e.Memo)).Scan(&id); err != nil {
			return nil, err
		}
		posted.EntryIDs = append(posted.EntryIDs, id)
	}
	return posted, nil
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

func (r *Repo) tx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func terminalRefund(s RefundState) bool {
	switch s {
	case RefundSucceeded, RefundSettled, RefundDeclined, RefundCancelled:
		return true
	}
	return false
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// poolQuerier adapts *pgxpool.Pool to querier's Exec tag type.
type poolQuerier struct{ p *pgxpool.Pool }

func (q poolQuerier) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return q.p.QueryRow(ctx, sql, args...)
}
func (q poolQuerier) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return q.p.Query(ctx, sql, args...)
}
func (q poolQuerier) Exec(ctx context.Context, sql string, args ...any) (pgconnCommandTag, error) {
	return q.p.Exec(ctx, sql, args...)
}
