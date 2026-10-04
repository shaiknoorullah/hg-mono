package admin

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/payments"
)

// OrdersRepo holds its own pool reference (same pool as Repo, passed at
// construction) for the admin-order queries. These queries never filter by
// account_id — staff may read any order (A-38).
type OrdersRepo struct {
	pool *pgxpool.Pool
	st   *orders.Store
}

// NewOrdersRepo builds the admin order repository.
func NewOrdersRepo(pool *pgxpool.Pool) *OrdersRepo {
	return &OrdersRepo{pool: pool, st: orders.NewStore(pool)}
}

// adminOrderSummaryRow is a raw projection from the database used to build
// the wire OrderSummary (admin variant includes restaurant name and code).
type adminOrderSummaryRow struct {
	ID             string
	Code           string
	State          string
	RestaurantID   string
	RestaurantName string
	TotalCents     int64
	Currency       string
	PlacedAt       time.Time
}

// adminOrderRow is the full admin view projection.
type adminOrderRow struct {
	// Customer-visible fields.
	ID               string
	Code             string
	State            string
	StateSince       time.Time
	RestaurantID     string
	RestaurantName   string
	SubtotalCents    int64
	DiscountCents    int64
	DeliveryFeeCents int64
	ServiceFeeCents  int64
	TaxTotalCents    int64
	TipCents         int64
	TotalCents       int64
	Currency         string
	CancelReason     *string
	RejectReason     *string
	Fulfilment       string
	PlacedAt         time.Time
	AcceptedAt       *time.Time
	CancelledAt      *time.Time
	CompletedAt      *time.Time
	DeadlineAt       *time.Time

	// Admin-only split columns.
	CommissionCents    int64
	RestaurantNetCents int64
	RiderEarningsCents int64
	PlatformGrossCents int64

	// Transition history for timeline.
	Transitions []adminTransitionRow

	// Order lines (from order_line joined with optional addons).
	Lines []adminOrderLineRow

	// Payment projection (nil when no payment_intent exists for the order).
	Payment *adminPaymentRow

	// Refunds for the order, requested-at ascending.
	Refunds []adminRefundRow

	// Money is the order's payment, refund and chargeback history, read by the
	// payments module, which owns those tables (#172).
	Money payments.MoneyHistory

	// dispatch_state from the order's dispatch row (nil until the restaurant
	// accepts and a dispatch machine exists for the order).
	DispatchState *string

	// delivery_address (contract Address), nil for PICKUP orders or orders with
	// no delivery_address_id.
	DeliveryAddress *adminAddressRow

	// rider is the assigned rider's masked public ref (no phone, no earnings),
	// nil until a rider is on the order (A-38 / P-07).
	Rider *adminRiderRow

	// LiveMapBox data (admin-only widening of OrderAdminView): restaurant
	// coordinates, destination coordinates and the rider's live position.
	RestaurantLat, RestaurantLng float64
	RiderLocation                *orders.RiderLocation
}

// adminAddressRow is the delivery address projection (contract Address). Latitude
// and longitude are decomposed from the geography point, never stored columns.
type adminAddressRow struct {
	ID            string
	Label         *string
	Line1         string
	Line2         *string
	Unit          *string
	Buzzer        *string
	City          string
	Province      string
	PostalCode    string
	Country       string
	Latitude      float64
	Longitude     float64
	Timezone      string
	DeliveryNotes *string
	IsDefault     bool
}

// adminRiderRow is the assigned rider's PII-free public ref (contract
// RiderPublicProfile): display name masked to first name + last initial, vehicle
// type and rating — never phone, email, earnings or record.
type adminRiderRow struct {
	FirstName   string
	LastInitial string
	PhotoURL    *string
	VehicleType string
	RatingAvg   *float64
}

type adminPaymentRow struct {
	State                 string
	Kind                  *string
	AmountAuthorizedCents int64
	AmountCapturedCents   int64
	AmountRefundedCents   int64
	Currency              string
	CardBrand             *string
	CardLast4             *string
	Wallet                *string
	FailureCode           *string
	DeclineCode           *string
	AuthorizedAt          *time.Time
	CapturedAt            *time.Time
}

type adminRefundRow struct {
	ID          string
	Kind        string
	Scope       *string
	ReasonCode  string
	AmountCents int64
	TaxCents    int64
	Currency    string
	State       string
	Note        *string
	RequestedAt time.Time
	SettledAt   *time.Time
}

type adminOrderLineRow struct {
	LineNo         int
	MenuItemID     string
	Name           string
	VariantName    *string
	Quantity       int
	SpecialRequest *string
	UnitPriceCents int64
	LineTotalCents int64
	Currency       string
}

type adminTransitionRow struct {
	FromState  *string
	ToState    string
	ActorKind  string
	Reason     *string
	OccurredAt time.Time
}

// ListOrders returns all orders keyset-paginated by placed_at desc, with an
// optional state filter. No account_id filter — admins see everything (A-38).
func (r *OrdersRepo) ListOrders(ctx context.Context, stateFilter string, limit int, cursor *time.Time, cursorID *string) ([]adminOrderSummaryRow, error) {
	args := []any{}
	where := ""

	argIdx := 1
	if stateFilter != "" {
		args = append(args, stateFilter)
		where += " AND o.state::text = $" + itoa(argIdx)
		argIdx++
	}
	if cursor != nil && cursorID != nil {
		args = append(args, *cursor, *cursorID)
		where += " AND (o.placed_at, o.id::text) < ($" + itoa(argIdx) + ", $" + itoa(argIdx+1) + ")"
		argIdx += 2
	}
	args = append(args, limit+1)
	limitIdx := argIdx

	q := `
SELECT o.id, o.code, o.state::text, o.restaurant_id, r.display_name,
       o.total_cents, o.currency::text, o.placed_at
  FROM "order" o
  JOIN restaurant r ON r.id = o.restaurant_id
 WHERE 1=1` + where + `
 ORDER BY o.placed_at DESC, o.id DESC
 LIMIT $` + itoa(limitIdx)

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []adminOrderSummaryRow
	for rows.Next() {
		var s adminOrderSummaryRow
		if err := rows.Scan(&s.ID, &s.Code, &s.State, &s.RestaurantID, &s.RestaurantName,
			&s.TotalCents, &s.Currency, &s.PlacedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetOrder loads the full admin view of one order. It does NOT filter by
// account_id — admins see any order (A-38, IDOR: returns ErrNotFound if the
// order does not exist, never a 403 that leaks existence).
func (r *OrdersRepo) GetOrder(ctx context.Context, orderID string) (*adminOrderRow, error) {
	var v adminOrderRow
	// dispatch_state is joined here (one dispatch row per order, LEFT JOIN because
	// it exists only after the restaurant accepts). Restaurant coordinates are
	// decomposed here too, for the admin live-map (LiveMapBox) widening.
	err := r.pool.QueryRow(ctx, `
SELECT o.id, o.code, o.state::text, o.state_since, o.restaurant_id, r.display_name,
       o.subtotal_cents, o.discount_cents, o.delivery_fee_cents, o.service_fee_cents,
       o.tax_total_cents, o.tip_cents, o.total_cents, o.currency::text,
       o.cancel_reason::text, o.reject_reason::text, o.fulfilment::text,
       o.placed_at, o.accepted_at, o.cancelled_at, o.completed_at, o.deadline_at,
       o.commission_cents, o.restaurant_net_cents, o.rider_earnings_cents, o.platform_gross_cents,
       d.state::text AS dispatch_state,
       ST_Y(r.location::geometry), ST_X(r.location::geometry)
  FROM "order" o
  JOIN restaurant r ON r.id = o.restaurant_id
  LEFT JOIN dispatch d ON d.order_id = o.id
 WHERE o.id = $1`, orderID).Scan(
		&v.ID, &v.Code, &v.State, &v.StateSince, &v.RestaurantID, &v.RestaurantName,
		&v.SubtotalCents, &v.DiscountCents, &v.DeliveryFeeCents, &v.ServiceFeeCents,
		&v.TaxTotalCents, &v.TipCents, &v.TotalCents, &v.Currency,
		&v.CancelReason, &v.RejectReason, &v.Fulfilment,
		&v.PlacedAt, &v.AcceptedAt, &v.CancelledAt, &v.CompletedAt, &v.DeadlineAt,
		&v.CommissionCents, &v.RestaurantNetCents, &v.RiderEarningsCents, &v.PlatformGrossCents,
		&v.DispatchState,
		&v.RestaurantLat, &v.RestaurantLng)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	// Delivery address (contract Address). Null for PICKUP orders. Latitude and
	// longitude are decomposed from the geography point, never stored columns.
	var a adminAddressRow
	addrErr := r.pool.QueryRow(ctx, `
SELECT a.id, a.label, a.line1, a.line2, a.unit, a.buzzer, a.city, a.province::text,
       a.postal_code, a.country, ST_Y(a.location::geometry), ST_X(a.location::geometry),
       a.timezone, a.delivery_notes, a.is_default
  FROM "order" o JOIN address a ON a.id = o.delivery_address_id
 WHERE o.id = $1 AND o.delivery_address_id IS NOT NULL`, orderID).Scan(
		&a.ID, &a.Label, &a.Line1, &a.Line2, &a.Unit, &a.Buzzer, &a.City, &a.Province,
		&a.PostalCode, &a.Country, &a.Latitude, &a.Longitude,
		&a.Timezone, &a.DeliveryNotes, &a.IsDefault)
	if addrErr == nil {
		v.DeliveryAddress = &a
	} else if !errors.Is(addrErr, pgx.ErrNoRows) {
		return nil, fmt.Errorf("load delivery address: %w", addrErr)
	}

	// Assigned rider's masked public ref (no phone, no earnings — P-07). Joined
	// via the order's dispatch row; absent until a rider is on the order.
	var rd adminRiderRow
	riderErr := r.pool.QueryRow(ctx, `
SELECT rp.first_name, left(rp.last_name, 1), NULL::text, rv.vehicle_type::text, rp.rating_avg
  FROM dispatch d
  JOIN rider_profile rp ON rp.account_id = d.rider_account_id
  JOIN rider_vehicle rv ON rv.account_id = d.rider_account_id AND rv.is_active AND rv.deleted_at IS NULL
 WHERE d.order_id = $1 AND d.rider_account_id IS NOT NULL`, orderID).Scan(
		&rd.FirstName, &rd.LastInitial, &rd.PhotoURL, &rd.VehicleType, &rd.RatingAvg)
	if riderErr == nil {
		v.Rider = &rd
	} else if !errors.Is(riderErr, pgx.ErrNoRows) {
		return nil, fmt.Errorf("load rider: %w", riderErr)
	}

	// Rider live position for the admin LiveMapBox. Unlike the customer-scoped
	// getOrderTracking (gated to PICKED_UP/ARRIVED), admin sees it for the whole
	// trip once a rider is assigned — admin oversight is not subject to that
	// pickup-only gate. Absent (nil) until a rider is on the order.
	_, riderLoc, posErr := r.st.LoadRiderForOrder(ctx, orderID)
	if posErr == nil {
		v.RiderLocation = riderLoc
	} else if !errors.Is(posErr, pgx.ErrNoRows) {
		return nil, fmt.Errorf("load rider position: %w", posErr)
	}

	// Load transitions for timeline.
	tRows, err := r.pool.Query(ctx, `
SELECT from_state::text, to_state::text, actor_kind::text, reason, at
  FROM order_transition WHERE order_id = $1 ORDER BY at ASC`, orderID)
	if err != nil {
		return nil, err
	}
	defer tRows.Close()
	for tRows.Next() {
		var tr adminTransitionRow
		if err := tRows.Scan(&tr.FromState, &tr.ToState, &tr.ActorKind, &tr.Reason, &tr.OccurredAt); err != nil {
			return nil, err
		}
		v.Transitions = append(v.Transitions, tr)
	}
	if err := tRows.Err(); err != nil {
		return nil, err
	}

	// Load order lines.
	lRows, err := r.pool.Query(ctx, `
SELECT line_no, menu_item_id, name_snapshot, variant_name, quantity, special_request,
       line_unit_cents, line_total_cents
  FROM order_line WHERE order_id = $1 ORDER BY line_no`, orderID)
	if err != nil {
		return nil, err
	}
	defer lRows.Close()
	for lRows.Next() {
		var l adminOrderLineRow
		if err := lRows.Scan(&l.LineNo, &l.MenuItemID, &l.Name, &l.VariantName, &l.Quantity,
			&l.SpecialRequest, &l.UnitPriceCents, &l.LineTotalCents); err != nil {
			return nil, err
		}
		l.Currency = v.Currency
		v.Lines = append(v.Lines, l)
	}
	if err := lRows.Err(); err != nil {
		return nil, err
	}

	// Load the primary ORDER payment_intent (at most one per order). Absent for
	// orders that never reached checkout; the admin view then reports a valid
	// zero-amount payment in the REQUIRES_PAYMENT_METHOD state.
	var pay adminPaymentRow
	pErr := r.pool.QueryRow(ctx, `
SELECT state::text, kind::text,
       amount_authorized_cents, amount_captured_cents, amount_refunded_cents, currency::text,
       card_brand, card_last4, wallet, failure_code, decline_code, authorized_at, captured_at
  FROM payment_intent
 WHERE order_id = $1 AND kind = 'ORDER'
 ORDER BY created_at DESC
 LIMIT 1`, orderID).Scan(
		&pay.State, &pay.Kind,
		&pay.AmountAuthorizedCents, &pay.AmountCapturedCents, &pay.AmountRefundedCents, &pay.Currency,
		&pay.CardBrand, &pay.CardLast4, &pay.Wallet, &pay.FailureCode, &pay.DeclineCode,
		&pay.AuthorizedAt, &pay.CapturedAt)
	if pErr == nil {
		v.Payment = &pay
	} else if !errors.Is(pErr, pgx.ErrNoRows) {
		return nil, pErr
	}

	// Load refunds for the order (contract: OrderAdminView.refunds is required).
	// The refund table carries no currency of its own; it is always the order's
	// currency (single-currency-per-order invariant).
	rfRows, err := r.pool.Query(ctx, `
SELECT id, kind::text, scope::text, reason_code::text,
       amount_cents, tax_cents, state::text, note, requested_at, settled_at
  FROM refund
 WHERE order_id = $1
 ORDER BY requested_at ASC`, orderID)
	if err != nil {
		return nil, err
	}
	defer rfRows.Close()
	for rfRows.Next() {
		var rf adminRefundRow
		if err := rfRows.Scan(&rf.ID, &rf.Kind, &rf.Scope, &rf.ReasonCode,
			&rf.AmountCents, &rf.TaxCents, &rf.State, &rf.Note,
			&rf.RequestedAt, &rf.SettledAt); err != nil {
			return nil, err
		}
		rf.Currency = v.Currency
		v.Refunds = append(v.Refunds, rf)
	}
	if err := rfRows.Err(); err != nil {
		return nil, err
	}

	if v.Money, err = payments.OrderMoneyHistory(ctx, r.pool, orderID); err != nil {
		return nil, fmt.Errorf("load money history: %w", err)
	}

	return &v, nil
}

// cancellableFromAny are the states from which an admin can cancel an order.
// Terminal states (COMPLETED, CANCELLED, REJECTED, FAILED, RESOLVED) and any
// post-pickup state are never cancellable by admin — COMPLETED is terminal,
// and PICKED_UP/ARRIVED/DELIVERED still technically could go to CANCELLED via T13
// but only via SYSTEM (no-rider-found), not via admin action (A-38).
var adminCancellableStates = map[machine.State]bool{
	machine.StateCreated:           true,
	machine.StateAuthorized:        true,
	machine.StateRestaurantPending: true,
	machine.StatePreparing:         true,
	// READY_FOR_PICKUP is not in T11; the machine only allows SYSTEM cancel from there (T13).
	// Per A-38 the spec says admin can cancel after acceptance (PREPARING) which maps to T11.
}

// CancelOrder executes the admin/support cancellation of an order.
//
// For post-acceptance states (PREPARING) the transition goes through the shared
// Store.Transition (T11: ActorSupport allowed). For pre-acceptance states
// (CREATED, AUTHORIZED, RESTAURANT_PENDING) the machine actor table only lists
// CUSTOMER and SYSTEM (T3/T5/T8); we perform the transition directly via SQL
// inside the same invariants (deadline cleared, cancel_reason set, transition row
// appended) to support the A-38 admin override.
//
// Returns ErrNotFound when the order does not exist, *orders.IllegalTransitionError
// when the state is terminal or not cancellable.
func (r *OrdersRepo) CancelOrder(ctx context.Context, actor auditActor, orderID, reasonCode string, in cancelOrderAdminInput) (*adminOrderRow, error) {
	var result *adminOrderRow
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		// Lock the order row and read its current state.
		var stateStr string
		qErr := tx.QueryRow(ctx,
			`SELECT state::text FROM "order" WHERE id=$1 FOR UPDATE`, orderID).Scan(&stateStr)
		if errors.Is(qErr, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if qErr != nil {
			return qErr
		}

		from := machine.State(stateStr)

		// Terminal states cannot be cancelled (they have no cancellable edge in T).
		if machine.IsTerminal(from) {
			return &orders.IllegalTransitionError{
				From:    from,
				To:      machine.StateCancelled,
				Allowed: machine.AllowedFrom(from),
			}
		}

		// Only the states enumerated as admin-cancellable are permitted (A-38).
		if !adminCancellableStates[from] {
			return &orders.IllegalTransitionError{
				From:    from,
				To:      machine.StateCancelled,
				Allowed: machine.AllowedFrom(from),
			}
		}

		// Determine which actor kind to use. T11 (PREPARING→CANCELLED) accepts
		// ActorSupport and ActorAdmin. For pre-acceptance states T3/T5/T8 accept only
		// CUSTOMER/SYSTEM, so we write the transition row directly as ADMIN actor.
		actorKind := machine.ActorAdmin
		if from == machine.StatePreparing {
			actorKind = machine.ActorSupport // T11 lists SUPPORT/ADMIN; SUPPORT covers both
		}

		// Write the state change: clear the deadline (CANCELLED is terminal) AND
		// reset the lease/escalation columns the shared machine transition resets
		// (I-14/I-15), so a cancelled order can never remain claimable by the
		// deadline runner or carry a stale escalation count.
		_, err := tx.Exec(ctx, `
UPDATE "order"
   SET state               = 'CANCELLED',
       state_since         = now(),
       deadline_at         = NULL,
       deadline_action     = NULL,
       deadline_escalations = 0,
       lease_until         = NULL,
       lease_owner         = NULL,
       cancel_reason       = $2::order_cancellation_reason_code,
       cancelled_at        = now()
 WHERE id = $1 AND state::text = $3`,
			orderID, reasonCode, string(from))
		if err != nil {
			return fmt.Errorf("cancel order: %w", err)
		}

		// Append the transition row.
		fromStr := string(from)
		_, err = tx.Exec(ctx, `
INSERT INTO order_transition (order_id, from_state, to_state, actor_kind, actor_account_id, reason, request_id)
VALUES ($1, $2::order_state, 'CANCELLED', $3::order_actor_kind, $4, $5, $6)`,
			orderID, fromStr, string(actorKind), nilIfEmpty(actor.staffID), in.ReasonText, nilIfEmpty(actor.requestID))
		if err != nil {
			return fmt.Errorf("insert order_transition: %w", err)
		}

		// MONEY (contract A-38 / T11): "Cancelling after acceptance always issues a
		// refund per the liability matrix, in the same transaction as the state
		// change — there is no path where the state change commits and the money
		// does not." Post-acceptance states have a CAPTURED payment; we post the
		// refund row and its balanced REFUND ledger batch here, inside the cancel
		// transaction, so the reversal commits atomically with the state change.
		// Pre-acceptance states carry only an authorisation (no capture): there is
		// nothing to refund, the auth is voided by the payments outbox, and no
		// ledger movement is required (T3/T5/T8: "auth voided").
		if from == machine.StatePreparing {
			if err := postCaptureReversal(ctx, tx, orderID, actor, in); err != nil {
				return err
			}
		}

		// Audit the cancel inside the same transaction (A-04: atomic).
		if aErr := writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "order.cancel_support",
			subjectType: "ORDER",
			subjectID:   &orderID,
			outcome:     "SUCCESS",
			reasonCode:  &in.ReasonCode,
			reason:      &in.ReasonText,
			after:       map[string]any{"state": "CANCELLED"},
		}); aErr != nil {
			return aErr
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Load and return the final state (outside the cancel tx).
	result, err = r.GetOrder(ctx, orderID)
	return result, err
}

// postCaptureReversal issues the refund that a post-acceptance (PREPARING)
// admin cancellation requires, inside the caller's cancel transaction. It reads
// the order's captured payment and its decomposed money, computes a FULL refund
// (the whole still-captured amount, net of any prior refunds), builds the
// balanced REFUND ledger batch with the payments module's own decomposition
// (so the money math is single-sourced, never duplicated here), and inserts the
// refund row plus the ledger batch/entries. If the batch does not balance to a
// zero residual it refuses to write — the money-zero-residual invariant is
// enforced before COMMIT, not merely hoped for.
//
// The liability reason is PLATFORM_INITIATED_CANCELLATION: the platform chose to
// cancel a live order, so the platform absorbs the cost and the restaurant/rider
// are made whole. This is the safe default; a future refund_kind-driven policy
// can refine the split without changing the atomicity guarantee.
func postCaptureReversal(ctx context.Context, tx pgx.Tx, orderID string, actor auditActor, in cancelOrderAdminInput) error {
	// Locate the captured ORDER payment_intent. Post-acceptance orders were
	// captured on acceptance (invariant 5), so exactly one must exist.
	var intentID string
	var capturedCents int64
	err := tx.QueryRow(ctx, `
SELECT id::text, amount_captured_cents
  FROM payment_intent
 WHERE order_id = $1 AND kind = 'ORDER'
 ORDER BY created_at DESC
 LIMIT 1`, orderID).Scan(&intentID, &capturedCents)
	if errors.Is(err, pgx.ErrNoRows) {
		// No captured payment despite a post-acceptance state: this is a data
		// integrity fault, not a normal path. Fail closed so we never cancel a
		// captured order while silently skipping the reversal.
		return fmt.Errorf("post-acceptance order %s has no ORDER payment_intent to reverse", orderID)
	}
	if err != nil {
		return fmt.Errorf("load payment_intent: %w", err)
	}
	// Nothing captured (e.g. a zero-total order): no money moved, no reversal.
	if capturedCents <= 0 {
		return nil
	}

	// Amount already refunded (exclude terminal-void states), so a re-cancel or a
	// prior partial refund is never double-reversed.
	var priorRefunded int64
	if err := tx.QueryRow(ctx, `
SELECT coalesce(sum(amount_cents),0) FROM refund
 WHERE order_id = $1 AND state NOT IN ('DECLINED','CANCELLED','FAILED')`, orderID).Scan(&priorRefunded); err != nil {
		return fmt.Errorf("sum prior refunds: %w", err)
	}
	refundCents := capturedCents - priorRefunded
	if refundCents <= 0 {
		// Already fully refunded; the state change alone is correct.
		return nil
	}

	// Decomposed order money, sourced from the order row via the payments module.
	m, taxCents, err := loadOrderMoneyTx(ctx, tx, orderID)
	if err != nil {
		return err
	}

	// Liability split + balanced batch come entirely from payments (single source
	// of the money math). itemNet is the refund net of its tax portion.
	const reversalReason = "PLATFORM_INITIATED_CANCELLATION"
	itemNet := refundCents - taxCents
	if itemNet < 0 {
		itemNet = 0
	}
	split := payments.ComputeLiabilitySplit(reversalReason, refundCents, itemNet, m.RiderEarningsCents)
	batch := payments.BuildRefundBatch(m, split, refundCents,
		fmt.Sprintf("admin-cancel-refund:%s", orderID), "admin:order.cancel")
	if !batch.Balanced() {
		return fmt.Errorf("refusing to post unbalanced cancel-refund batch (residual=%d)", batch.Residual())
	}

	// Insert the refund row: AUTHORISED, approved by the member of staff who
	// cancelled (the schema refuses a refund that moves money with no
	// approver, refund_money_needs_approver), and due to the payments refund
	// sender at once, which sends it to Stripe (payments/refund_sender.go,
	// #318).
	requestedBy := actor.staffID
	if requestedBy == "" {
		// requested_by is NOT NULL; fall back to the system account. This never
		// happens on an authenticated staff route but keeps the write total.
		return fmt.Errorf("cannot post cancel refund: no staff actor on request")
	}
	var refundID string
	if err := tx.QueryRow(ctx, `
INSERT INTO refund (order_id, payment_intent_id, kind, scope, reason_code, note,
                    amount_cents, tax_cents,
                    restaurant_chargeback_cents, rider_chargeback_cents, platform_absorbed_cents,
                    state, approval_status, requested_by, approved_by, approved_at, deadline_at, deadline_action)
VALUES ($1,$2,'FULL','FULL',$3::refund_reason_code,$4,
        $5,$6,$7,$8,$9,
        'AUTHORISED','APPROVED',$10,$10, now(), now(),$11)
RETURNING id::text`,
		orderID, intentID, reversalReason, in.ReasonText,
		refundCents, taxCents,
		split.RestaurantChargebackCents, split.RiderChargebackCents, split.PlatformAbsorbedCents,
		requestedBy, payments.RefundActionSubmit).Scan(&refundID); err != nil {
		return fmt.Errorf("insert cancel refund: %w", err)
	}

	// Post the balanced ledger batch and its entries, tied to the refund.
	var batchID string
	if err := tx.QueryRow(ctx, `
INSERT INTO ledger_batch (kind, order_id, refund_id, idempotency_key, posted_by, memo)
VALUES ('REFUND', $1, $2, $3, $4, 'admin cancel refund')
RETURNING id::text`,
		orderID, refundID, batch.IdempotencyKey, batch.PostedBy).Scan(&batchID); err != nil {
		return fmt.Errorf("insert ledger_batch: %w", err)
	}
	for _, e := range batch.Entries {
		if _, err := tx.Exec(ctx, `
INSERT INTO ledger_entry (batch_id, order_id, account, counterparty_type, counterparty_id,
                          amount_cents, component, memo)
VALUES ($1, $2, $3::ledger_account, $4, $5, $6, $7::ledger_component, $8)`,
			batchID, orderID, string(e.Account),
			nilIfEmpty(string(e.CounterpartyType)), nilIfEmptyUUID(e.CounterpartyID),
			e.AmountCents, string(e.Component), e.Memo); err != nil {
			return fmt.Errorf("insert ledger_entry: %w", err)
		}
	}
	return nil
}

// loadOrderMoneyTx reads the order's decomposed money (and its tax total)
// inside the caller's transaction, mirroring payments.Repo.GetOrderMoney but
// scoped to the open tx so the read participates in the cancel's snapshot.
func loadOrderMoneyTx(ctx context.Context, tx pgx.Tx, orderID string) (payments.OrderMoney, int64, error) {
	var m payments.OrderMoney
	err := tx.QueryRow(ctx, `
SELECT o.id::text, o.restaurant_id::text,
       o.subtotal_cents, o.discount_cents, o.delivery_fee_cents, o.service_fee_cents,
       o.tax_total_cents, o.tip_cents, o.total_cents,
       o.commission_cents, o.restaurant_net_cents, o.rider_earnings_cents, o.platform_gross_cents,
       coalesce((SELECT a.rider_account_id::text FROM assignment a
                  WHERE a.order_id = o.id AND a.state = 'DELIVERED'
                  ORDER BY a.created_at DESC LIMIT 1), '')
  FROM "order" o WHERE o.id = $1`, orderID).Scan(
		&m.OrderID, &m.RestaurantID,
		&m.SubtotalCents, &m.DiscountCents, &m.DeliveryFeeCents, &m.ServiceFeeCents,
		&m.TaxTotalCents, &m.TipCents, &m.TotalCents,
		&m.CommissionCents, &m.RestaurantNetCents, &m.RiderEarningsCents, &m.PlatformGrossCents,
		&m.RiderID)
	if err != nil {
		return payments.OrderMoney{}, 0, fmt.Errorf("load order money: %w", err)
	}
	return m, m.TaxTotalCents, nil
}

// nilIfEmptyUUID returns nil for an empty counterparty id so the NULL-able
// ledger_entry.counterparty_id is written as NULL, not an empty string that a
// uuid column would reject.
func nilIfEmptyUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (r *OrdersRepo) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
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

// itoa is a tiny helper to avoid importing strconv or fmt just for index building.
func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	// For our use (max ~5 args) this is sufficient.
	return string([]byte{byte('0' + n/10), byte('0' + n%10)})
}
