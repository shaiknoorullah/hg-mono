package orders

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// The restaurant's prep delay (docs/spec/03-restaurant.md, "R-26 — Delay
// handling and rider communication"). A delay is not a change of state, but
// it moves the order's deadline and is logged in the order's transition log,
// both of which this module owns (docs/spec/01-platform.md, "P-14 — Order
// lifecycle states and transitions"); the restaurant once wrote both itself
// and told nobody (https://github.com/shaiknoorullah/hg-mono/issues/351).

// Delay limits per order (R-26 rule 1): beyond them the restaurant cancels or
// escalates.
const (
	MaxDelaysPerOrder   = 3
	MaxDelayTotalMinute = 45
)

// ErrDelayLimitReached: the order already has MaxDelaysPerOrder delays, this
// one would take the total past MaxDelayTotalMinute, or the order was never
// accepted.
var ErrDelayLimitReached = errors.New("delay limit reached")

// DelayRequest is one prep delay. AddedMinutes is a canned increment (5, 10,
// 15 or 20) and ReasonCode a delay_reason_code; the caller validates both.
type DelayRequest struct {
	OrderID        string
	AddedMinutes   int
	ReasonCode     string
	ActorAccountID string // the restaurant staff account
	RequestID      string
}

// DelayNotifier is implemented by an EventEmitter that also tells the customer
// their order is running late. delayNo counts this order's delays from 1.
type DelayNotifier interface {
	EmitOrderDelay(ctx context.Context, tx pgx.Tx, orderID string, delayNo, addedMinutes int) error
}

// DelayInTx delays a PREPARING order inside the caller's transaction, after
// the caller's ownership lock: it checks the limits against the order's
// order_delay rows, moves deadline_at and promised_ready_at, records the
// delay, writes the PREPARING → PREPARING order_transition row, emits
// order.state_changed with the new deadline, and hands the delay to the
// notifier. It returns ErrOrderNotFound, *IllegalTransitionError when the
// order is not PREPARING, or ErrDelayLimitReached. The caller commits tx.
func (s *Store) DelayInTx(ctx context.Context, tx pgx.Tx, req DelayRequest) error {
	var stateStr string
	var deadlineAt, acceptedAt, promisedReadyAt *time.Time
	err := tx.QueryRow(ctx, `
		SELECT state::text, deadline_at, accepted_at, promised_ready_at
		  FROM "order" WHERE id = $1 FOR UPDATE`, req.OrderID).
		Scan(&stateStr, &deadlineAt, &acceptedAt, &promisedReadyAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrOrderNotFound
	}
	if err != nil {
		return fmt.Errorf("lock order: %w", err)
	}
	from := machine.State(stateStr)
	if from != machine.StatePreparing {
		return &IllegalTransitionError{From: from, To: machine.StatePreparing, Allowed: machine.AllowedFrom(from)}
	}
	// An order in PREPARING that was never accepted did not come through the
	// restaurant's accept, and is not delayable.
	if acceptedAt == nil {
		return ErrDelayLimitReached
	}

	var count, total int
	if err := tx.QueryRow(ctx, `
		SELECT count(*), COALESCE(sum(added_minutes), 0) FROM order_delay WHERE order_id = $1`,
		req.OrderID).Scan(&count, &total); err != nil {
		return fmt.Errorf("read delays: %w", err)
	}
	if count >= MaxDelaysPerOrder || total+req.AddedMinutes > MaxDelayTotalMinute {
		return ErrDelayLimitReached
	}

	add := time.Duration(req.AddedMinutes) * time.Minute
	now := time.Now().UTC()
	base := now
	if deadlineAt != nil && deadlineAt.After(base) {
		base = *deadlineAt
	}
	newDeadline := base.Add(add)
	var newPromised *time.Time
	if promisedReadyAt != nil {
		p := promisedReadyAt.Add(add)
		newPromised = &p
	}

	if _, err := tx.Exec(ctx, `
		UPDATE "order" SET deadline_at = $2, promised_ready_at = $3, updated_at = now() WHERE id = $1`,
		req.OrderID, newDeadline, newPromised); err != nil {
		return fmt.Errorf("extend deadline: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_delay (order_id, added_minutes, reason_code, previous_deadline_at, new_deadline_at,
		                         previous_promised_ready_at, new_promised_ready_at, created_by)
		VALUES ($1, $2, $3::delay_reason_code, $4, $5, $6, $7, $8)`,
		req.OrderID, req.AddedMinutes, req.ReasonCode, deadlineAt, newDeadline,
		promisedReadyAt, newPromised, nullIfEmpty(req.ActorAccountID)); err != nil {
		return fmt.Errorf("record delay: %w", err)
	}
	reason := fmt.Sprintf("restaurant delayed %d minutes: %s", req.AddedMinutes, req.ReasonCode)
	if err := insertTransition(ctx, tx, req.OrderID, &from, machine.StatePreparing,
		machine.ActorRestaurant, req.ActorAccountID, reason, req.RequestID); err != nil {
		return fmt.Errorf("insert transition: %w", err)
	}

	// The order's participants hear of the new deadline on the order's
	// channel, as for any entry in its transition log.
	o, err := loadOrderFacts(ctx, tx, req.OrderID)
	if err != nil {
		return err
	}
	st := contract.OrderState(machine.StatePreparing)
	if err := realtime.EmitOrder(ctx, tx, req.OrderID, realtime.OrderStateChanged{
		OrderID: req.OrderID, From: &st, To: st,
		At:         realtime.At(now),
		Reason:     &req.ReasonCode,
		ActorKind:  contract.OrderActorKind(machine.ActorRestaurant),
		DeadlineAt: realtime.AtPtr(o.deadlineAt),
		EtaAt:      realtime.AtPtr(o.etaAt),
	}); err != nil {
		return fmt.Errorf("emit delay: %w", err)
	}
	if n, ok := s.emitter.(DelayNotifier); ok {
		if err := n.EmitOrderDelay(ctx, tx, req.OrderID, count+1, req.AddedMinutes); err != nil {
			return fmt.Errorf("notify delay: %w", err)
		}
	}
	return nil
}
