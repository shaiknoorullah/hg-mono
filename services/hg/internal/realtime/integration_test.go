package realtime

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// These tests exercise the realtime store against a real, migrated Postgres. The
// DSN comes from HG_TEST_POSTGRES_DSN; when it is unset the tests skip with a
// clear message (never silently). The DSN is expected to point at a database
// with the 00019_realtime_outbox and identity/order/dispatch schema applied.

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("skipping realtime integration test: set HG_TEST_POSTGRES_DSN to a migrated Postgres to run it")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedAccount inserts a minimal account and session and returns their ids,
// registering cleanup. It uses a unique phone so parallel runs do not collide.
func seedAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (accountID, sessionID string) {
	t.Helper()
	// A valid E.164 number (account_phone_e164_shape: ^\+[1-9][0-9]{7,14}$).
	// The trailing digits come from the clock so parallel runs stay unique;
	// no separators, since E.164 permits digits only.
	phone := "+1416" + time.Now().Format("150405.000000")[7:13]
	err := pool.QueryRow(ctx, `
		INSERT INTO account (phone_e164) VALUES ($1) RETURNING id::text`, phone).Scan(&accountID)
	if err != nil {
		t.Fatalf("seed account: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM session WHERE account_id = $1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM realtime_ticket WHERE account_id = $1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM realtime_connection WHERE account_id = $1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM account WHERE id = $1`, accountID)
	})
	err = pool.QueryRow(ctx, `
		INSERT INTO session (family_id, account_id, amr, roles_snapshot, client, refresh_hash, idle_expires_at, absolute_expires_at)
		VALUES (uuid_generate_v7(), $1, 'otp', $2, 'customer-app', $3, now() + interval '1 day', now() + interval '30 days')
		RETURNING id::text`,
		accountID, json.RawMessage(`["CUSTOMER"]`), []byte("rh-"+accountID)).Scan(&sessionID)
	if err != nil {
		t.Fatalf("seed session: %v", err)
	}
	return accountID, sessionID
}

func TestIntegrationTicketMintConsumeReuse(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := NewStore(pool, "test-node")

	accountID, sessionID := seedAccount(t, ctx, pool)

	raw, expiresAt, err := store.MintTicket(ctx, accountID, sessionID, json.RawMessage(`["CUSTOMER"]`), "customer-app", nil)
	if err != nil {
		t.Fatalf("MintTicket: %v", err)
	}
	if !expiresAt.After(time.Now()) {
		t.Error("ticket already expired at mint")
	}

	// First consume succeeds and resolves the principal.
	p, err := store.ConsumeTicket(ctx, raw)
	if err != nil {
		t.Fatalf("first ConsumeTicket: %v", err)
	}
	if p.AccountID != accountID || p.SessionID != sessionID {
		t.Errorf("consumed principal = %+v, want account %s session %s", p, accountID, sessionID)
	}

	// Second consume is refused: single-use.
	if _, err := store.ConsumeTicket(ctx, raw); err != ErrTicketInvalid {
		t.Errorf("second ConsumeTicket err = %v, want ErrTicketInvalid", err)
	}

	// An unknown ticket is also refused.
	if _, err := store.ConsumeTicket(ctx, "not-a-real-ticket"); err != ErrTicketInvalid {
		t.Errorf("unknown ticket err = %v, want ErrTicketInvalid", err)
	}
}

func TestIntegrationExpiredTicketRefused(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := NewStore(pool, "test-node")
	accountID, sessionID := seedAccount(t, ctx, pool)

	// Insert a ticket that is already expired.
	raw := "expired-ticket-raw-value-1234567890"
	_, err := pool.Exec(ctx, `
		INSERT INTO realtime_ticket (ticket_hash, account_id, session_id, roles_snapshot, client, expires_at)
		VALUES ($1, $2, $3, $4, 'customer-app', now() - interval '1 minute')`,
		hashTicket(raw), accountID, sessionID, json.RawMessage(`["CUSTOMER"]`))
	if err != nil {
		t.Fatalf("seed expired ticket: %v", err)
	}
	if _, err := store.ConsumeTicket(ctx, raw); err != ErrTicketInvalid {
		t.Errorf("expired ticket err = %v, want ErrTicketInvalid", err)
	}
}

func TestIntegrationSubscribeAuthz(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := NewStore(pool, "test-node")

	owner, _ := seedAccount(t, ctx, pool)
	stranger, _ := seedAccount(t, ctx, pool)

	// The owner may always subscribe to its own account channel; a stranger gets
	// not_found (the channel does not exist for them).
	ch, _ := ParseChannel(AccountChannel(owner))
	if g, err := store.AuthorizeSubscribe(ctx, owner, []string{"CUSTOMER"}, ch); err != nil || g.Result != SubAllowed || g.Viewer != ViewAccountOwner {
		t.Errorf("owner account subscribe = %v (err %v), want SubAllowed", g, err)
	}
	if g, err := store.AuthorizeSubscribe(ctx, stranger, []string{"CUSTOMER"}, ch); err != nil || g.Result != SubNotFound || g.Viewer != ViewNone {
		t.Errorf("stranger account subscribe = %v (err %v), want SubNotFound", g, err)
	}

	// admin:ops requires a privileged role.
	adminCh, _ := ParseChannel(AdminOpsChannel)
	if g, _ := store.AuthorizeSubscribe(ctx, owner, []string{"CUSTOMER"}, adminCh); g.Result != SubForbidden {
		t.Errorf("customer admin:ops = %v, want SubForbidden", g)
	}
	if g, _ := store.AuthorizeSubscribe(ctx, owner, []string{"ADMIN"}, adminCh); g.Result != SubAllowed || g.Viewer != ViewSupport {
		t.Errorf("admin admin:ops = %v, want SubAllowed", g)
	}

	// A non-existent order is not_found for anyone (404-vs-403: existence hidden).
	orderCh, _ := ParseChannel(OrderChannel("00000000-0000-7000-8000-000000000000"))
	if g, _ := store.AuthorizeSubscribe(ctx, owner, []string{"CUSTOMER"}, orderCh); g.Result != SubNotFound {
		t.Errorf("nonexistent order = %v, want SubNotFound", g)
	}
}

func TestIntegrationEmitAndReplay(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := NewStore(pool, "test-node")

	channel := "order:" + "11111111-2222-7333-8444-555555555555"
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM outbox_message WHERE channel = $1`, channel)
		_, _ = pool.Exec(bg, `DELETE FROM realtime_event WHERE channel = $1`, channel)
		_, _ = pool.Exec(bg, `DELETE FROM channel_cursor WHERE channel = $1`, channel)
	})

	// Emit three events in three transactions; seq must be gapless 1,2,3.
	for i := 1; i <= 3; i++ {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		seq, ulid, err := EmitInTx(ctx, tx, channel, "order.state_changed", 1, nil,
			json.RawMessage(`{"to":"CREATED"}`), nil, nil)
		if err != nil {
			tx.Rollback(ctx)
			t.Fatalf("EmitInTx: %v", err)
		}
		if seq != int64(i) {
			t.Errorf("emit %d seq = %d, want %d", i, seq, i)
		}
		if ulid == "" {
			t.Error("emit produced an empty ulid")
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("commit: %v", err)
		}
	}

	// Head is 3.
	head, err := store.ChannelHead(ctx, channel)
	if err != nil || head != 3 {
		t.Fatalf("ChannelHead = %d (err %v), want 3", head, err)
	}

	// Replay after seq 1 returns events 2 and 3.
	events, truncated, err := store.Replay(ctx, channel, 1)
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if truncated {
		t.Error("a 2-event gap must not be truncated")
	}
	if len(events) != 2 || events[0].Seq != 2 || events[1].Seq != 3 {
		t.Errorf("replay returned %d events starting %v", len(events), seqs(events))
	}

	// Each event has exactly one REALTIME outbox row (the outbox invariant).
	var missing int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM realtime_event_without_outbox WHERE channel = $1`, channel).Scan(&missing); err != nil {
		t.Fatalf("outbox invariant query: %v", err)
	}
	if missing != 0 {
		t.Errorf("%d realtime events have no outbox row — the transactional outbox invariant is violated", missing)
	}
}

func seqs(events []StoredEvent) []int64 {
	out := make([]int64, len(events))
	for i, e := range events {
		out[i] = e.Seq
	}
	return out
}

func TestIntegrationEmitRollbackLeavesNothing(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	channel := "order:" + "99999999-8888-7777-8666-555555555555"
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM outbox_message WHERE channel = $1`, channel)
		_, _ = pool.Exec(bg, `DELETE FROM realtime_event WHERE channel = $1`, channel)
		_, _ = pool.Exec(bg, `DELETE FROM channel_cursor WHERE channel = $1`, channel)
	})

	// Emit inside a transaction that is then rolled back: no event may survive.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, _, err := EmitInTx(ctx, tx, channel, "order.created", 1, nil, json.RawMessage(`{}`), nil, nil); err != nil {
		tx.Rollback(ctx)
		t.Fatalf("EmitInTx: %v", err)
	}
	if err := tx.Rollback(ctx); err != nil && err != pgx.ErrTxClosed {
		t.Fatalf("rollback: %v", err)
	}

	var eventCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM realtime_event WHERE channel = $1`, channel).Scan(&eventCount); err != nil {
		t.Fatalf("count events: %v", err)
	}
	if eventCount != 0 {
		t.Errorf("a rolled-back emit left %d events; an event must exist iff its state change committed", eventCount)
	}
}
