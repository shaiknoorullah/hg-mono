package orders

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// countingEscalator records every pickup escalation the runner carries out.
type countingEscalator struct {
	mu    sync.Mutex
	calls []PickupEscalation
	err   error
}

func (e *countingEscalator) EscalatePickup(_ context.Context, _ pgx.Tx, p PickupEscalation) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.calls = append(e.calls, p)
	return e.err
}

func (e *countingEscalator) seen() []PickupEscalation {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]PickupEscalation(nil), e.calls...)
}

// makeDue puts an order in state with a deadline that has just passed, the
// given action and escalation count, and no lease: what the deadline runner
// finds when the state's deadline lapses.
func makeDue(t *testing.T, pool *pgxpool.Pool, orderID string, state machine.State, action string, escalations int) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		UPDATE "order"
		   SET state = $2, deadline_at = now() - interval '1 second', deadline_action = $3,
		       deadline_escalations = $4, lease_until = NULL, lease_owner = NULL
		 WHERE id = $1`, orderID, string(state), action, escalations); err != nil {
		t.Fatalf("make %s due in %s: %v", orderID, state, err)
	}
}

// claimOne is the runner's claim for one order: the same lease, the same
// columns. ok is false when the order is not claimable (not due, or leased by
// another runner). The sweep's own claim takes every due order in the
// database; tests that share one database claim only their own.
func claimOne(r *DeadlineRunner, orderID string) (c claimedOrder, ok bool, err error) {
	var state string
	err = r.store.pool.QueryRow(context.Background(), `
		UPDATE "order" SET lease_until = now() + interval '30 seconds', lease_owner = $2
		 WHERE id = $1 AND deadline_at IS NOT NULL AND deadline_at <= now()
		   AND (lease_until IS NULL OR lease_until < now())
		RETURNING id, state::text, deadline_action, deadline_escalations, deadline_at,
		          COALESCE(prep_eta_minutes, 0), accepted_at, restaurant_id`,
		orderID, r.owner).Scan(&c.id, &state, &c.action, &c.escalations, &c.deadlineAt,
		&c.prepEtaMinutes, &c.acceptedAt, &c.restaurantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, false, nil
	}
	if err != nil {
		return c, false, err
	}
	c.state = machine.State(state)
	return c, true, nil
}

// mustClaim claims a lapsed order for r, failing the test when it cannot.
func mustClaim(t *testing.T, r *DeadlineRunner, orderID string) claimedOrder {
	t.Helper()
	c, ok, err := claimOne(r, orderID)
	if err != nil {
		t.Fatalf("claim %s: %v", orderID, err)
	}
	if !ok {
		t.Fatalf("the lapsed order %s was not claimable", orderID)
	}
	return c
}

// TestIntegrationEveryNonTerminalStateHasADeadlineHandler walks every state
// that leaves the transition table and is not terminal, makes its deadline
// lapse in the database, and fires the runner on it. Each must be handled: an
// audit row for the state's action, and the order either moved on or carries
// a fresh deadline. A state whose deadline no handler knows fails here, so a
// ready order can never again sit with a deadline that fails on every pass
// (https://github.com/shaiknoorullah/hg-mono/issues/293).
func TestIntegrationEveryNonTerminalStateHasADeadlineHandler(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	runner := NewDeadlineRunner(st, nil, testLogger(), "test-every-state")
	ctx := context.Background()

	var checked int
	for _, state := range machine.AllStates {
		if machine.IsTerminal(state) || len(machine.AllowedFrom(state)) == 0 {
			continue
		}
		checked++
		t.Run(string(state), func(t *testing.T) {
			spec, ok := machine.DeadlineFor(state)
			if !ok {
				t.Fatalf("non-terminal %s has no deadline in the deadline table", state)
			}
			orderID, _, _ := buildCreatedOrder(t, pool, st)
			makeDue(t, pool, orderID, state, spec.Action, 0)

			c := mustClaim(t, runner, orderID)
			if err := runner.fire(ctx, c); err != nil {
				t.Fatalf("no handler for %s (%s): %v", state, spec.Action, err)
			}

			var audits int
			var after string
			var rearmed bool
			if err := pool.QueryRow(ctx, `
				SELECT (SELECT count(*) FROM deadline_audit
				         WHERE subject_type = 'order' AND subject_id = o.id AND action = $2),
				       o.state::text, COALESCE(o.deadline_at > now(), false)
				  FROM "order" o WHERE o.id = $1`, orderID, spec.Action).Scan(&audits, &after, &rearmed); err != nil {
				t.Fatalf("read the handled order: %v", err)
			}
			if audits != 1 {
				t.Errorf("%d deadline_audit rows for %s, want 1", audits, spec.Action)
			}
			if after == string(state) && !rearmed {
				t.Errorf("order still %s with a lapsed deadline: the deadline was not handled", state)
			}
		})
	}
	if checked == 0 {
		t.Fatal("no non-terminal states found in the transition table")
	}
}

// TestIntegrationLapsedPickupEscalatesExactlyOnce: a ready order whose pickup
// deadline lapses is escalated once (re-dispatch, ops alert, customer notice
// through the escalator), audited once and re-armed 10 minutes on, however
// many runners race for it and however often a claim is replayed. At the cap
// it is still escalated and re-armed, never abandoned. An order marked ready
// before #293 was fixed carries RIDER_NO_SHOW and is handled the same way
// (https://github.com/shaiknoorullah/hg-mono/issues/293).
func TestIntegrationLapsedPickupEscalatesExactlyOnce(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	esc := &countingEscalator{}
	runners := []*DeadlineRunner{
		NewDeadlineRunner(st, nil, testLogger(), "test-pickup-a").WithPickupEscalator(esc),
		NewDeadlineRunner(st, nil, testLogger(), "test-pickup-b").WithPickupEscalator(esc),
	}

	orderID, _, _ := buildCreatedOrder(t, pool, st)
	makeDue(t, pool, orderID, machine.StateReadyForPickup, "RIDER_NO_SHOW", 0)

	// Two runners claim and fire at once; then the winning claim is replayed,
	// as a runner that crashed after committing would.
	claims := make([]*claimedOrder, len(runners))
	var wg sync.WaitGroup
	for i, r := range runners {
		wg.Add(1)
		go func(i int, r *DeadlineRunner) {
			defer wg.Done()
			c, ok, err := claimOne(r, orderID)
			if err != nil {
				t.Errorf("claim: %v", err)
				return
			}
			if ok {
				claims[i] = &c
				if err := r.fire(ctx, c); err != nil {
					t.Errorf("fire: %v", err)
				}
			}
		}(i, r)
	}
	wg.Wait()
	var winner *claimedOrder
	for _, c := range claims {
		if c != nil {
			if winner != nil {
				t.Fatal("two runners claimed the same lapse")
			}
			winner = c
		}
	}
	if winner == nil {
		t.Fatal("no runner claimed the lapsed order")
	}
	if err := runners[0].fire(ctx, *winner); err != nil {
		t.Fatalf("replayed fire: %v", err)
	}

	calls := esc.seen()
	if len(calls) != 1 {
		t.Fatalf("escalated %d times, want exactly once", len(calls))
	}
	if calls[0].OrderID != orderID || calls[0].Lapse != 1 || calls[0].CapReached {
		t.Errorf("escalation = %+v, want order %s, lapse 1, cap not reached", calls[0], orderID)
	}
	if d := time.Until(calls[0].NextDeadlineAt); d < 9*time.Minute || d > 11*time.Minute {
		t.Errorf("next deadline in %v, want about 10 minutes", d)
	}
	assertPickupDeadline(t, pool, orderID, 1, "RE_ARMED")

	// The third lapse reaches the cap: still escalated and re-armed, never
	// left with a lapsed deadline, and audited as CAP_REACHED.
	makeDue(t, pool, orderID, machine.StateReadyForPickup, machine.ActionPickupOverdue, 2)
	if err := runners[1].fire(ctx, mustClaim(t, runners[1], orderID)); err != nil {
		t.Fatalf("fire at the cap: %v", err)
	}
	calls = esc.seen()
	if len(calls) != 2 || calls[1].Lapse != 3 || !calls[1].CapReached {
		t.Fatalf("escalations = %+v, want a second one at lapse 3 with the cap reached", calls)
	}
	assertPickupDeadline(t, pool, orderID, 3, "CAP_REACHED")
}

// TestIntegrationFailedPickupEscalationIsRetried: when an effect of the
// escalation fails, nothing of the lapse commits (no audit row, the deadline
// still lapsed), so the next claim retries it.
func TestIntegrationFailedPickupEscalationIsRetried(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	esc := &countingEscalator{err: errors.New("dispatch unavailable (simulated)")}
	runner := NewDeadlineRunner(st, nil, testLogger(), "test-pickup-retry").WithPickupEscalator(esc)

	orderID, _, _ := buildCreatedOrder(t, pool, st)
	makeDue(t, pool, orderID, machine.StateReadyForPickup, machine.ActionPickupOverdue, 0)
	if err := runner.fire(ctx, mustClaim(t, runner, orderID)); err == nil {
		t.Fatal("fire succeeded although the escalation failed")
	}

	var audits, escalations int
	var lapsed bool
	if err := pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM deadline_audit WHERE subject_id = o.id),
		       o.deadline_escalations, o.deadline_at <= now()
		  FROM "order" o WHERE o.id = $1`, orderID).Scan(&audits, &escalations, &lapsed); err != nil {
		t.Fatalf("read order: %v", err)
	}
	if audits != 0 || escalations != 0 || !lapsed {
		t.Errorf("after a failed escalation: %d audit rows, %d escalations, lapsed=%v; want 0, 0, true",
			audits, escalations, lapsed)
	}
}

// assertPickupDeadline checks a ready order after a handled lapse: still
// READY_FOR_PICKUP, re-armed about 10 minutes on with the deadline table's
// action, the escalation count advanced, the lease released, and exactly one
// audit row for the lapse just handled.
func assertPickupDeadline(t *testing.T, pool *pgxpool.Pool, orderID string, escalations int, outcome string) {
	t.Helper()
	var state, action, lastOutcome string
	var gotEscalations, audits int
	var inSeconds int64
	var leased bool
	if err := pool.QueryRow(context.Background(), `
		SELECT o.state::text, o.deadline_action, o.deadline_escalations,
		       EXTRACT(EPOCH FROM (o.deadline_at - now()))::bigint,
		       o.lease_owner IS NOT NULL,
		       (SELECT count(*) FROM deadline_audit a
		         WHERE a.subject_id = o.id AND a.action = $2 AND a.escalation_no = $3 - 1),
		       COALESCE((SELECT a.outcome FROM deadline_audit a
		         WHERE a.subject_id = o.id AND a.escalation_no = $3 - 1), '')
		  FROM "order" o WHERE o.id = $1`, orderID, machine.ActionPickupOverdue, escalations).
		Scan(&state, &action, &gotEscalations, &inSeconds, &leased, &audits, &lastOutcome); err != nil {
		t.Fatalf("read order: %v", err)
	}
	if state != string(machine.StateReadyForPickup) || action != machine.ActionPickupOverdue {
		t.Errorf("order = %s with action %s, want READY_FOR_PICKUP with %s", state, action, machine.ActionPickupOverdue)
	}
	if gotEscalations != escalations || leased {
		t.Errorf("escalations = %d (leased=%v), want %d with the lease released", gotEscalations, leased, escalations)
	}
	if in := time.Duration(inSeconds) * time.Second; in < 9*time.Minute || in > 11*time.Minute {
		t.Errorf("deadline re-armed %v ahead, want about 10 minutes", in)
	}
	if audits != 1 || lastOutcome != outcome {
		t.Errorf("%d audit rows for lapse %d with outcome %q, want 1 with %q", audits, escalations, lastOutcome, outcome)
	}
}
