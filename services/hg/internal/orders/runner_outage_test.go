package orders

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// These tests pin the outage path of the deadline runner (runner_outage.go;
// docs/spec/01-platform.md, "P-15 — Deadlines and timeout actions",
// "Outages"): a deadline that fell while no runner was running is handled once,
// as an outage, tagged in deadline_audit, with ops alerted — and a short gap is
// not an outage at all.
//
// Unlike the other integration tests in this package they do not skip without
// HG_TEST_POSTGRES_DSN: they start a throwaway PostGIS container instead, so
// they run in CI.
func TestDeadlineRunnerOutage(t *testing.T) {
	pool := migratedPool(t)
	ctx := context.Background()
	st := NewStore(pool)

	t.Run("deadlines in a gap over the threshold are handled once as outage actions", func(t *testing.T) {
		resetRunnerState(t, pool)
		unaccepted := orderIn(t, pool, st, machine.StateRestaurantPending)
		paid := orderIn(t, pool, st, machine.StatePreparing)

		// The runner stopped 10 minutes ago; both deadlines fell while it was away.
		setHeartbeat(t, pool, "-10 minutes")
		setDeadline(t, pool, unaccepted, "-5 minutes")
		setDeadline(t, pool, paid, "-3 minutes")

		alerts := &alertRecorder{}
		r := NewDeadlineRunner(st, nil, testLogger(), "outage-test").WithOpsAlerter(alerts)
		r.step(ctx)
		r.step(ctx) // a second tick must change nothing

		// Not yet accepted: cancelled as a platform error, so nothing counts
		// against the restaurant, and the action is tagged with the outage.
		var state, cancelReason string
		mustScan(t, pool.QueryRow(ctx, `SELECT state::text, cancel_reason::text FROM "order" WHERE id = $1`, unaccepted),
			&state, &cancelReason)
		if state != "CANCELLED" || cancelReason != "PLATFORM_ERROR" {
			t.Errorf("unaccepted order = %s / %s, want CANCELLED / PLATFORM_ERROR", state, cancelReason)
		}
		assertOutageAudit(t, pool, unaccepted, "OUTAGE_VOIDED")

		// Paid: fired once, no escalation used, re-armed from now.
		var escalations int
		var deadline time.Time
		mustScan(t, pool.QueryRow(ctx, `SELECT state::text, deadline_escalations, deadline_at FROM "order" WHERE id = $1`, paid),
			&state, &escalations, &deadline)
		if state != "PREPARING" || escalations != 0 {
			t.Errorf("paid order = %s with %d escalations, want PREPARING with 0", state, escalations)
		}
		if time.Until(deadline) < 9*time.Minute {
			t.Errorf("paid order re-armed to %s, want about 10 minutes from now", deadline)
		}
		assertOutageAudit(t, pool, paid, "OUTAGE_RE_ARMED")

		if n := alerts.count(); n != 1 {
			t.Errorf("ops alerts = %d, want exactly 1", n)
		}
		var outages int
		mustScan(t, pool.QueryRow(ctx, `SELECT count(*) FROM deadline_outage`), &outages)
		if outages != 1 {
			t.Errorf("outage windows = %d, want 1", outages)
		}
		// Every non-terminal order still has a deadline (AGENTS.md, "Non-negotiable
		// invariants": every non-terminal order state carries deadline_at).
		var missing int
		mustScan(t, pool.QueryRow(ctx, `SELECT count(*) FROM order_without_deadline`), &missing)
		if missing != 0 {
			t.Errorf("%d live orders lost their deadline", missing)
		}
	})

	t.Run("a gap under the threshold fires deadlines normally", func(t *testing.T) {
		resetRunnerState(t, pool)
		order := orderIn(t, pool, st, machine.StateRestaurantPending)
		setHeartbeat(t, pool, "-30 seconds")
		setDeadline(t, pool, order, "-10 seconds")

		alerts := &alertRecorder{}
		NewDeadlineRunner(st, nil, testLogger(), "outage-test").WithOpsAlerter(alerts).step(ctx)

		var cancelReason string
		var outageTagged bool
		mustScan(t, pool.QueryRow(ctx, `
			SELECT o.cancel_reason::text, a.outage_id IS NOT NULL
			  FROM "order" o JOIN deadline_audit a ON a.subject_id = o.id
			 WHERE o.id = $1`, order), &cancelReason, &outageTagged)
		if cancelReason != "RESTAURANT_TIMEOUT" || outageTagged {
			t.Errorf("short gap: cancel_reason=%s outage-tagged=%v, want RESTAURANT_TIMEOUT and untagged",
				cancelReason, outageTagged)
		}
		if n := alerts.count(); n != 0 {
			t.Errorf("short gap raised %d ops alerts, want 0", n)
		}
	})

	t.Run("a held runner fires nothing until it is released", func(t *testing.T) {
		resetRunnerState(t, pool)
		order := orderIn(t, pool, st, machine.StateRestaurantPending)
		setDeadline(t, pool, order, "-1 second")

		r := NewDeadlineRunner(st, nil, testLogger(), "held-test").WithHold(true)
		r.tick = 20 * time.Millisecond
		runCtx, stop := context.WithCancel(ctx)
		defer stop()
		done := make(chan struct{})
		go func() { r.Run(runCtx); close(done) }()

		time.Sleep(300 * time.Millisecond)
		if s := orderState(t, pool, order); s != "RESTAURANT_PENDING" {
			t.Fatalf("held runner moved the order to %s", s)
		}
		var beats int
		mustScan(t, pool.QueryRow(ctx, `SELECT count(*) FROM deadline_runner_heartbeat`), &beats)
		if beats != 0 {
			t.Fatalf("held runner wrote %d heartbeats, want 0", beats)
		}

		if _, err := pool.Exec(ctx, `INSERT INTO deadline_runner_release (released_by, reason) VALUES ('test', 'failover drill')`); err != nil {
			t.Fatalf("release: %v", err)
		}
		deadline := time.Now().Add(5 * time.Second)
		for orderState(t, pool, order) != "CANCELLED" {
			if time.Now().After(deadline) {
				t.Fatal("released runner never fired the due deadline")
			}
			time.Sleep(20 * time.Millisecond)
		}
		stop()
		<-done
	})
}

// migratedPool returns a pool on a migrated database with the launch reference
// data loaded: HG_TEST_POSTGRES_DSN when set, otherwise a PostGIS container
// (skipping only when there is no Docker to start one in).
func migratedPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		if _, err := os.Stat("/var/run/docker.sock"); err != nil && os.Getenv("DOCKER_HOST") == "" {
			t.Skip("no HG_TEST_POSTGRES_DSN and no Docker daemon to start Postgres in")
		}
		pg, err := tcpostgres.Run(ctx, "postgis/postgis:17-3.5",
			tcpostgres.WithDatabase("hg"), tcpostgres.WithUsername("hg"), tcpostgres.WithPassword("hg"),
			tcpostgres.BasicWaitStrategies())
		testcontainers.CleanupContainer(t, pg)
		if err != nil {
			t.Fatalf("start postgres: %v", err)
		}
		if dsn, err = pg.ConnectionString(ctx, "sslmode=disable"); err != nil {
			t.Fatalf("dsn: %v", err)
		}
	}

	migrations, _ := filepath.Abs("../../migrations")
	goose := exec.CommandContext(ctx, "go", "run", "github.com/pressly/goose/v3/cmd/goose@v3.24.3",
		"-dir", migrations, "postgres", dsn, "up")
	if out, err := goose.CombinedOutput(); err != nil {
		t.Fatalf("goose up: %v\n%s", err, out)
	}
	if err := testseed.Seed(dsn, false); err != nil {
		t.Fatalf("reference seed: %v", err)
	}

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// resetRunnerState clears heartbeats and outage windows before and after a
// case, so a window from one case never captures another case's deadlines.
func resetRunnerState(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	reset := func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM deadline_runner_heartbeat`)
		_, _ = pool.Exec(ctx, `DELETE FROM deadline_runner_release`)
		_, _ = pool.Exec(ctx, `DELETE FROM deadline_audit WHERE outage_id IS NOT NULL`)
		_, _ = pool.Exec(ctx, `DELETE FROM deadline_outage`)
	}
	reset()
	// Registered before orderIn's cleanups, so it runs after them (LIFO).
	t.Cleanup(reset)
}

// orderIn creates a fresh customer, restaurant and order, and walks the order
// to state through the one transition function.
func orderIn(t *testing.T, pool *pgxpool.Pool, st *Store, state machine.State) string {
	t.Helper()
	ctx := context.Background()
	b := seedBasics(t, pool)
	cart, err := st.AddCartLine(ctx, b.accountID, b.restaurantID, CartLineInput{MenuItemID: b.menuItemID, Quantity: 1}, false)
	if err != nil {
		t.Fatalf("cart: %v", err)
	}
	q, err := st.CreateQuote(ctx, QuoteRequest{AccountID: b.accountID, CartID: cart.ID,
		DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY"})
	if err != nil {
		t.Fatalf("quote: %v", err)
	}
	var fresh *Quote
	o, err := st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh)
	if err != nil {
		t.Fatalf("order: %v", err)
	}
	path := []TransitionRequest{
		{To: machine.StateAuthorized, Actor: machine.ActorSystem},
		{To: machine.StateRestaurantPending, Actor: machine.ActorSystem},
		{To: machine.StatePreparing, Actor: machine.ActorRestaurant, PrepEtaMinutes: 20},
	}
	for _, step := range path {
		if orderState(t, pool, o.OrderID) == string(state) {
			break
		}
		step.OrderID = o.OrderID
		if err := st.Transition(ctx, step); err != nil {
			t.Fatalf("transition to %s: %v", step.To, err)
		}
	}
	return o.OrderID
}

func setHeartbeat(t *testing.T, pool *pgxpool.Pool, ago string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO deadline_runner_heartbeat (owner, beat_at) VALUES ('stopped-runner', now() + $1::interval)`, ago); err != nil {
		t.Fatalf("heartbeat: %v", err)
	}
}

func setDeadline(t *testing.T, pool *pgxpool.Pool, orderID, ago string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE "order" SET deadline_at = now() + $1::interval WHERE id = $2`, ago, orderID); err != nil {
		t.Fatalf("deadline: %v", err)
	}
}

// assertOutageAudit checks the order has exactly one deadline_audit row, with
// the given outcome and an outage attached.
func assertOutageAudit(t *testing.T, pool *pgxpool.Pool, orderID, outcome string) {
	t.Helper()
	var n, tagged int
	mustScan(t, pool.QueryRow(context.Background(), `
		SELECT count(*), count(*) FILTER (WHERE outcome = $2 AND outage_id IS NOT NULL)
		  FROM deadline_audit WHERE subject_id = $1`, orderID, outcome), &n, &tagged)
	if n != 1 || tagged != 1 {
		t.Errorf("order %s: %d audit rows, %d tagged %s; want exactly one, tagged", orderID, n, tagged, outcome)
	}
}

func mustScan(t *testing.T, row pgx.Row, dest ...any) {
	t.Helper()
	if err := row.Scan(dest...); err != nil {
		t.Fatalf("scan: %v", err)
	}
}

// alertRecorder is an OpsAlerter that counts alerts instead of writing the
// realtime outbox (the realtime module is not wired in this package).
type alertRecorder struct {
	mu     sync.Mutex
	alerts []OpsAlert
}

func (a *alertRecorder) AlertOps(_ context.Context, _ pgx.Tx, alert OpsAlert) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.alerts = append(a.alerts, alert)
	return nil
}

func (a *alertRecorder) count() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.alerts)
}
