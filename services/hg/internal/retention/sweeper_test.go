package retention

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// The retention pass is pinned against a real, migrated Postgres: what it may
// delete is decided by foreign keys, CHECKs and cascades that only the
// database knows. The database is HG_TEST_POSTGRES_DSN when set, otherwise a
// throwaway container; with neither, the test skips and says why.
func migratedDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		_, sockErr := os.Stat("/var/run/docker.sock")
		if sockErr != nil && os.Getenv("DOCKER_HOST") == "" {
			t.Skip("skipping: set HG_TEST_POSTGRES_DSN or run Docker; the retention pass needs a real Postgres")
		}
		pg, err := tcpostgres.Run(ctx, "postgis/postgis:17-3.5",
			tcpostgres.WithDatabase("hg"), tcpostgres.WithUsername("hg"), tcpostgres.WithPassword("hg"),
			tcpostgres.BasicWaitStrategies())
		if err != nil {
			t.Skipf("skipping: the Postgres container did not start: %v", err)
		}
		t.Cleanup(func() { _ = pg.Terminate(context.Background()) })
		if dsn, err = pg.ConnectionString(ctx, "sslmode=disable"); err != nil {
			t.Fatalf("container dsn: %v", err)
		}
	}

	migrations, err := filepath.Abs(filepath.Join("..", "..", "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	goose := exec.CommandContext(ctx, "go", "run", "github.com/pressly/goose/v3/cmd/goose@v3.24.3",
		"-dir", migrations, "postgres", dsn, "up")
	if out, err := goose.CombinedOutput(); err != nil {
		t.Fatalf("migrate: %v\n%s", err, out)
	}
	if err := testseed.Seed(dsn, true); err != nil {
		t.Fatalf("seed: %v", err)
	}

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func testSweeper(pool *pgxpool.Pool) *Sweeper {
	s := New(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	// One row per batch: every rule has to loop, and a batch boundary falls
	// inside a session family, which is where a wrong order would break the
	// rotated_to foreign key.
	s.batch = 1
	s.pause = 0
	return s
}

func TestRetentionPass(t *testing.T) {
	pool := migratedDB(t)
	ctx := context.Background()

	forgetPasses := func(t *testing.T) {
		t.Helper()
		if _, err := pool.Exec(ctx, `DELETE FROM job_run WHERE job = $1`, jobName); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("one replica runs a pass per hour", func(t *testing.T) {
		forgetPasses(t)
		replicas := []*Sweeper{testSweeper(pool), testSweeper(pool), testSweeper(pool)}
		reports := make([]Report, len(replicas))
		errs := make([]error, len(replicas))
		var wg sync.WaitGroup
		for i, s := range replicas {
			wg.Add(1)
			go func() {
				defer wg.Done()
				reports[i], errs[i] = s.Pass(ctx)
			}()
		}
		wg.Wait()

		ran := 0
		for i := range replicas {
			if errs[i] != nil {
				t.Fatalf("replica %d: %v", i, errs[i])
			}
			if reports[i].Ran {
				ran++
			}
		}
		if ran != 1 {
			t.Fatalf("%d replicas ran a pass at once; want exactly 1", ran)
		}
		if again, err := replicas[0].Pass(ctx); err != nil || again.Ran {
			t.Fatalf("a second pass inside the hour ran=%v err=%v; want it refused", again.Ran, err)
		}
	})

	t.Run("deletes what has expired and keeps everything else", func(t *testing.T) {
		forgetPasses(t)
		gone, kept := seedRetentionCases(t, ctx, pool)

		rep, err := testSweeper(pool).Pass(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if !rep.Ran || len(rep.Failed) > 0 {
			t.Fatalf("pass ran=%v failed=%v", rep.Ran, rep.Failed)
		}
		for _, r := range gone {
			if n := count(t, ctx, pool, r); n != 0 {
				t.Errorf("%s: still there; it is past its retention", r)
			}
		}
		for _, r := range kept {
			if n := count(t, ctx, pool, r); n == 0 {
				t.Errorf("%s: deleted; it must be kept", r)
			}
		}
	})
}

// row names one seeded row by a table and a WHERE clause that matches it.
type row struct {
	why   string
	table string
	where string
}

func (r row) String() string { return r.table + " (" + r.why + ")" }

func count(t *testing.T, ctx context.Context, pool *pgxpool.Pool, r row) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM %s WHERE %s`, r.table, r.where)).Scan(&n); err != nil {
		t.Fatalf("%s: %v", r, err)
	}
	return n
}

// The fixture customer and the fixture quote that an order was placed from
// (migrations/test/fixtures.sql).
const (
	fxCustomer     = "11111111-1111-4111-8111-111111111111"
	fxOrderedQuote = "77777777-7777-4777-8777-777777777777"
	orphanQuote    = "5900000a-0000-4000-8000-000000000001"
)

// seedRetentionCases writes, for every rule, rows that are past retention and
// rows that look old but must survive, and returns which is which.
func seedRetentionCases(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (gone, kept []row) {
	t.Helper()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("seed: %v\n%s", err, sql)
		}
	}

	// Rows a previous run left behind (they were kept) would collide on their
	// fixed ids when HG_TEST_POSTGRES_DSN names a long-lived database.
	for _, sql := range []string{
		`DELETE FROM realtime_ticket WHERE ticket_hash IN ('ret-old', 'ret-new')`,
		`DELETE FROM realtime_connection WHERE id IN ('5c000000-0000-4000-8000-000000000001', '5c000000-0000-4000-8000-000000000002', '5c000000-0000-4000-8000-000000000003')`,
		`DELETE FROM session WHERE family_id IN ('5f000000-0000-4000-8000-000000000001', '5f000000-0000-4000-8000-000000000002', '5f000000-0000-4000-8000-000000000003', '5f000000-0000-4000-8000-000000000004')`,
		`DELETE FROM outbox_message WHERE channel LIKE 'ret:%'`,
		`DELETE FROM realtime_event WHERE channel LIKE 'ret:%'`,
		`DELETE FROM login_attempt WHERE email LIKE 'ret-%@test.local'`,
		`DELETE FROM otp_challenge WHERE phone_e164 IN ('+14165550901', '+14165550902')`,
		`DELETE FROM idempotency_record WHERE path_template = '/ret'`,
		`DELETE FROM webhook_event WHERE stripe_event_id LIKE 'evt_ret_%'`,
		`DELETE FROM search_query_log WHERE q LIKE 'ret-%'`,
		`DELETE FROM notification WHERE kind = 'ret'`,
		`DELETE FROM quote WHERE id = '` + orphanQuote + `'`,
	} {
		exec(sql)
	}

	// Sessions. A dead family of two (a rotated into b), both unusable for
	// 100 days, with an expired ticket on a and a long-closed socket on b: all
	// four go, the ticket and socket first. A live family whose first member
	// was rotated 200 days ago: that member stays, because presenting it again
	// is how a stolen token is caught. The live ticket and socket hang off a
	// third, fresh family, so nothing but liveness protects the second. A
	// fourth family is dead but a socket closed 10 days ago still points at
	// it: it waits for the socket's own retention.
	exec(`
		INSERT INTO session (id, family_id, account_id, amr, roles_snapshot, client, refresh_hash,
		                     issued_at, idle_expires_at, absolute_expires_at)
		VALUES ('5e000000-0000-4000-8000-0000000000b0', '5f000000-0000-4000-8000-000000000001', $1, 'otp', '[]',
		        'customer-app', 'ret-dead-b', now() - interval '199 days',
		        now() - interval '100 days', now() - interval '100 days'),
		       ('5e000000-0000-4000-8000-0000000000d0', '5f000000-0000-4000-8000-000000000002', $1, 'otp', '[]',
		        'customer-app', 'ret-live-d', now() - interval '1 day',
		        now() + interval '29 days', now() + interval '170 days'),
		       ('5e000000-0000-4000-8000-0000000000e0', '5f000000-0000-4000-8000-000000000003', $1, 'otp', '[]',
		        'customer-app', 'ret-live-e', now() - interval '1 hour',
		        now() + interval '30 days', now() + interval '180 days'),
		       ('5e000000-0000-4000-8000-0000000000f0', '5f000000-0000-4000-8000-000000000004', $1, 'otp', '[]',
		        'customer-app', 'ret-dead-f', now() - interval '200 days',
		        now() - interval '100 days', now() - interval '100 days')`, fxCustomer)
	exec(`
		INSERT INTO session (id, family_id, account_id, amr, roles_snapshot, client, refresh_hash,
		                     issued_at, idle_expires_at, absolute_expires_at, rotated_at, rotated_to)
		VALUES ('5e000000-0000-4000-8000-0000000000a0', '5f000000-0000-4000-8000-000000000001', $1, 'otp', '[]',
		        'customer-app', 'ret-dead-a', now() - interval '200 days',
		        now() - interval '170 days', now() - interval '100 days',
		        now() - interval '199 days', '5e000000-0000-4000-8000-0000000000b0'),
		       ('5e000000-0000-4000-8000-0000000000c0', '5f000000-0000-4000-8000-000000000002', $1, 'otp', '[]',
		        'customer-app', 'ret-live-c', now() - interval '200 days',
		        now() - interval '170 days', now() - interval '100 days',
		        now() - interval '1 day', '5e000000-0000-4000-8000-0000000000d0')`, fxCustomer)
	exec(`
		INSERT INTO realtime_ticket (id, ticket_hash, account_id, session_id, roles_snapshot, client, expires_at)
		VALUES ('5a000000-0000-4000-8000-000000000001', 'ret-old', $1, '5e000000-0000-4000-8000-0000000000a0',
		        '[]', 'customer-app', now() - interval '2 days'),
		       ('5a000000-0000-4000-8000-000000000002', 'ret-new', $1, '5e000000-0000-4000-8000-0000000000e0',
		        '[]', 'customer-app', now() + interval '30 seconds')`, fxCustomer)
	exec(`
		INSERT INTO realtime_connection (id, account_id, session_id, node_id, client,
		                                 connected_at, last_seen_at, disconnected_at)
		VALUES ('5c000000-0000-4000-8000-000000000001', $1, '5e000000-0000-4000-8000-0000000000b0', 'n',
		        'customer-app', now() - interval '41 days', now() - interval '40 days', now() - interval '40 days'),
		       ('5c000000-0000-4000-8000-000000000002', $1, '5e000000-0000-4000-8000-0000000000e0', 'n',
		        'customer-app', now() - interval '1 hour', now(), NULL),
		       ('5c000000-0000-4000-8000-000000000003', $1, '5e000000-0000-4000-8000-0000000000f0', 'n',
		        'customer-app', now() - interval '11 days', now() - interval '10 days', now() - interval '10 days')`, fxCustomer)
	gone = append(gone,
		row{"a dead family's rotated session", "session", `id = '5e000000-0000-4000-8000-0000000000a0'`},
		row{"a dead family's last session", "session", `id = '5e000000-0000-4000-8000-0000000000b0'`},
		row{"an expired ticket", "realtime_ticket", `id = '5a000000-0000-4000-8000-000000000001'`},
		row{"a socket closed 40 days ago", "realtime_connection", `id = '5c000000-0000-4000-8000-000000000001'`})
	kept = append(kept,
		row{"a live family's rotated session", "session", `id = '5e000000-0000-4000-8000-0000000000c0'`},
		row{"a live session", "session", `id = '5e000000-0000-4000-8000-0000000000d0'`},
		row{"a live ticket", "realtime_ticket", `id = '5a000000-0000-4000-8000-000000000002'`},
		row{"a live socket", "realtime_connection", `id = '5c000000-0000-4000-8000-000000000002'`},
		row{"a dead session a recent socket still refers to", "session", `id = '5e000000-0000-4000-8000-0000000000f0'`},
		row{"that socket, closed 10 days ago", "realtime_connection", `id = '5c000000-0000-4000-8000-000000000003'`})

	// Realtime events and the outbox. A published row goes together with its
	// 8-day-old event; an unpublished row is a backlog and stays however old.
	exec(`
		INSERT INTO realtime_event (id, ulid, channel, seq, type, payload, created_at)
		VALUES ('5b000000-0000-4000-8000-000000000001', 'u1', 'ret:old', 1, 't', '{}', now() - interval '8 days'),
		       ('5b000000-0000-4000-8000-000000000002', 'u2', 'ret:new', 1, 't', '{}', now())`)
	exec(`
		INSERT INTO outbox_message (kind, channel, realtime_event_id, seq, payload, published_at, created_at)
		VALUES ('REALTIME', 'ret:old', '5b000000-0000-4000-8000-000000000001', 1, '{}',
		        now() - interval '8 days', now() - interval '8 days'),
		       ('REALTIME', 'ret:new', '5b000000-0000-4000-8000-000000000002', 1, '{}', now(), now()),
		       ('REALTIME', 'ret:stuck', NULL, 1, '{}', NULL, now() - interval '30 days')`)
	gone = append(gone,
		row{"an 8-day-old event", "realtime_event", `id = '5b000000-0000-4000-8000-000000000001'`},
		row{"its published outbox row", "outbox_message", `channel = 'ret:old'`})
	kept = append(kept,
		row{"today's event", "realtime_event", `id = '5b000000-0000-4000-8000-000000000002'`},
		row{"today's published outbox row", "outbox_message", `channel = 'ret:new'`},
		row{"an unpublished outbox row", "outbox_message", `channel = 'ret:stuck'`})

	// Sign-in records.
	exec(`
		INSERT INTO login_attempt (email, ip, outcome, at)
		VALUES ('ret-old@test.local', '10.0.0.1', 'BAD_PASSWORD', now() - interval '91 days'),
		       ('ret-new@test.local', '10.0.0.1', 'BAD_PASSWORD', now())`)
	exec(`
		INSERT INTO otp_challenge (phone_e164, purpose, code_hash, created_at, last_sent_at, expires_at, window_ends_at)
		VALUES ('+14165550901', 'SIGN_IN', 'h', now() - interval '32 days', now() - interval '32 days',
		        now() - interval '32 days', now() - interval '31 days'),
		       ('+14165550902', 'SIGN_IN', 'h', now(), now(), now() + interval '5 minutes', now() + interval '15 minutes')`)
	gone = append(gone,
		row{"a 91-day-old attempt", "login_attempt", `email = 'ret-old@test.local'`},
		row{"a challenge closed 31 days ago", "otp_challenge", `phone_e164 = '+14165550901'`})
	kept = append(kept,
		row{"today's attempt", "login_attempt", `email = 'ret-new@test.local'`},
		row{"an open challenge", "otp_challenge", `phone_e164 = '+14165550902'`})

	// Idempotency records: expired, expired but still leased, live.
	exec(`
		INSERT INTO idempotency_record (account_id, method, path_template, key, request_hash, state,
		                                expires_at, lease_until)
		VALUES ($1, 'POST', '/ret', 'ret-expired-0000001', 'h', 'IN_PROGRESS', now() - interval '2 hours', NULL),
		       ($1, 'POST', '/ret', 'ret-leased-00000001', 'h', 'IN_PROGRESS', now() - interval '2 hours',
		        now() + interval '1 minute'),
		       ($1, 'POST', '/ret', 'ret-live-0000000001', 'h', 'IN_PROGRESS', now() + interval '23 hours', NULL)`,
		fxCustomer)
	gone = append(gone, row{"an expired record", "idempotency_record", `key = 'ret-expired-0000001'`})
	kept = append(kept,
		row{"an expired record a request still holds", "idempotency_record", `key = 'ret-leased-00000001'`},
		row{"a live record", "idempotency_record", `key = 'ret-live-0000000001'`})

	// Stripe webhooks: processed a year ago, never processed, processed today.
	exec(`
		INSERT INTO webhook_event (stripe_event_id, type, payload, livemode, event_created_at, received_at,
		                           processed_at, deadline_at, deadline_action)
		VALUES ('evt_ret_old', 't', '{}', false, now() - interval '366 days', now() - interval '366 days',
		        now() - interval '366 days', NULL, NULL),
		       ('evt_ret_pending', 't', '{}', false, now() - interval '400 days', now() - interval '400 days',
		        NULL, now() - interval '399 days', 'PROCESS'),
		       ('evt_ret_new', 't', '{}', false, now(), now(), now(), NULL, NULL)`)
	exec(`
		INSERT INTO search_query_log (q, at)
		VALUES ('ret-old', now() - interval '181 days'), ('ret-new', now())`)
	gone = append(gone,
		row{"a webhook processed 366 days ago", "webhook_event", `stripe_event_id = 'evt_ret_old'`},
		row{"a 181-day-old search", "search_query_log", `q = 'ret-old'`})
	kept = append(kept,
		row{"a webhook never processed", "webhook_event", `stripe_event_id = 'evt_ret_pending'`},
		row{"today's webhook", "webhook_event", `stripe_event_id = 'evt_ret_new'`},
		row{"today's search", "search_query_log", `q = 'ret-new'`})

	// Notifications. An old one goes with its deliveries; an old one still on
	// an escalation deadline stays, and so does its stuck QUEUED delivery; a
	// new one stays but loses its 31-day-old finished delivery.
	exec(`
		INSERT INTO notification (id, account_id, role_context, kind, title, body, created_at,
		                          deadline_at, deadline_action)
		VALUES ('5d000000-0000-4000-8000-000000000001', $1, 'CUSTOMER', 'ret', 't', 'b',
		        now() - interval '91 days', NULL, NULL),
		       ('5d000000-0000-4000-8000-000000000002', $1, 'CUSTOMER', 'ret', 't', 'b',
		        now() - interval '91 days', now() + interval '1 minute', 'ESCALATE'),
		       ('5d000000-0000-4000-8000-000000000003', $1, 'CUSTOMER', 'ret', 't', 'b', now(), NULL, NULL)`,
		fxCustomer)
	exec(`
		INSERT INTO notification_delivery (notification_id, channel, target, state, queued_at)
		VALUES ('5d000000-0000-4000-8000-000000000001', 'PUSH', 'ret-1', 'SENT', now() - interval '91 days'),
		       ('5d000000-0000-4000-8000-000000000002', 'PUSH', 'ret-2', 'QUEUED', now() - interval '91 days'),
		       ('5d000000-0000-4000-8000-000000000003', 'PUSH', 'ret-3', 'DELIVERED', now() - interval '31 days'),
		       ('5d000000-0000-4000-8000-000000000003', 'INAPP', 'ret-4', 'DELIVERED', now())`)
	gone = append(gone,
		row{"a 91-day-old notification", "notification", `id = '5d000000-0000-4000-8000-000000000001'`},
		row{"its delivery", "notification_delivery", `target = 'ret-1'`},
		row{"a 31-day-old finished delivery", "notification_delivery", `target = 'ret-3'`})
	kept = append(kept,
		row{"an old notification still escalating", "notification", `id = '5d000000-0000-4000-8000-000000000002'`},
		row{"a delivery still queued", "notification_delivery", `target = 'ret-2'`},
		row{"today's notification", "notification", `id = '5d000000-0000-4000-8000-000000000003'`},
		row{"today's delivery", "notification_delivery", `target = 'ret-4'`})

	// Quotes. One nobody ordered from, expired 31 days ago, goes with its
	// lines; the fixture quote an order was placed from stays, however old.
	// The copy and its tax lines go in one transaction: a quote's tax total
	// must equal its tax lines at commit.
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		for _, sql := range []string{`
			INSERT INTO quote (id, account_id, cart_id, restaurant_id, delivery_address_id, fulfilment,
			                   pricing_config_id, tax_jurisdiction_code,
			                   subtotal_cents, delivery_fee_cents, service_fee_cents, tax_total_cents, tip_cents,
			                   total_cents, input_hash, state_hash, expires_at)
			SELECT $2, account_id, cart_id, restaurant_id, delivery_address_id,
			       fulfilment, pricing_config_id, tax_jurisdiction_code,
			       subtotal_cents, delivery_fee_cents, service_fee_cents, tax_total_cents, tip_cents,
			       total_cents, input_hash, state_hash, now() - interval '31 days'
			  FROM quote WHERE id = $1`, `
			INSERT INTO quote_line (quote_id, line_no, menu_item_id, menu_item_name, quantity, base_price_cents,
			                        variant_part_cents, addons_part_cents, line_unit_cents, line_total_cents,
			                        tax_category)
			SELECT $2, line_no, menu_item_id, menu_item_name, quantity, base_price_cents,
			       variant_part_cents, addons_part_cents, line_unit_cents, line_total_cents, tax_category
			  FROM quote_line WHERE quote_id = $1`, `
			INSERT INTO quote_tax_line (quote_id, seq, jurisdiction_code, tax_kind, statutory_label, rate,
			                            base_cents, amount_cents, remittable_by)
			SELECT $2, seq, jurisdiction_code, tax_kind, statutory_label, rate,
			       base_cents, amount_cents, remittable_by
			  FROM quote_tax_line WHERE quote_id = $1`,
		} {
			if _, err := tx.Exec(ctx, sql, fxOrderedQuote, orphanQuote); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("seed quote: %v", err)
	}
	exec(`UPDATE quote SET expires_at = now() - interval '31 days' WHERE id = $1`, fxOrderedQuote)
	gone = append(gone,
		row{"an expired quote nobody ordered from", "quote", `id = '` + orphanQuote + `'`},
		row{"its lines", "quote_line", `quote_id = '` + orphanQuote + `'`},
		row{"its tax lines", "quote_tax_line", `quote_id = '` + orphanQuote + `'`})
	kept = append(kept,
		row{"a quote an order was placed from", "quote", `id = '` + fxOrderedQuote + `'`},
		row{"that quote's lines", "quote_line", `quote_id = '` + fxOrderedQuote + `'`})

	// The sweep's own history.
	exec(`INSERT INTO job_run (job, started_at, finished_at)
	      VALUES ($1, now() - interval '91 days', now() - interval '91 days')`, jobName)
	gone = append(gone, row{"a 91-day-old pass", "job_run", `job = '` + jobName + `' AND started_at < now() - interval '90 days'`})

	return gone, kept
}
