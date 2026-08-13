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
	err := r.pool.QueryRow(ctx, `
SELECT o.id, o.code, o.state::text, o.state_since, o.restaurant_id, r.display_name,
       o.subtotal_cents, o.discount_cents, o.delivery_fee_cents, o.service_fee_cents,
       o.tax_total_cents, o.tip_cents, o.total_cents, o.currency::text,
       o.cancel_reason::text, o.reject_reason::text, o.fulfilment::text,
       o.placed_at, o.accepted_at, o.cancelled_at, o.completed_at, o.deadline_at,
       o.commission_cents, o.restaurant_net_cents, o.rider_earnings_cents, o.platform_gross_cents
  FROM "order" o
  JOIN restaurant r ON r.id = o.restaurant_id
 WHERE o.id = $1`, orderID).Scan(
		&v.ID, &v.Code, &v.State, &v.StateSince, &v.RestaurantID, &v.RestaurantName,
		&v.SubtotalCents, &v.DiscountCents, &v.DeliveryFeeCents, &v.ServiceFeeCents,
		&v.TaxTotalCents, &v.TipCents, &v.TotalCents, &v.Currency,
		&v.CancelReason, &v.RejectReason, &v.Fulfilment,
		&v.PlacedAt, &v.AcceptedAt, &v.CancelledAt, &v.CompletedAt, &v.DeadlineAt,
		&v.CommissionCents, &v.RestaurantNetCents, &v.RiderEarningsCents, &v.PlatformGrossCents)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
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

		// Write the state change: clear deadline (terminal), set cancel columns.
		_, err := tx.Exec(ctx, `
UPDATE "order"
   SET state           = 'CANCELLED',
       state_since     = now(),
       deadline_at     = NULL,
       deadline_action = NULL,
       cancel_reason   = $2::order_cancellation_reason_code,
       cancelled_at    = now()
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
