package tablets_test

import (
	"context"
	"sort"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/devworld"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/devworld/tablets"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// TestBeatTouchesOnlyTheDevWorldsLiveRestaurants seeds the dev world into a
// database of its own, beside two restaurants that are not the dev world's,
// lets every heartbeat go stale, and beats once. Exactly the catalogue's
// restaurants that take orders are touched. The paused persona, the personas
// that are not live or have their toggle off, and anything not owned by a seed
// account keep their stale heartbeat.
func TestBeatTouchesOnlyTheDevWorldsLiveRestaurants(t *testing.T) {
	dsn := testseed.FreshDatabase(t, "devworld_tablets")
	ctx := context.Background()
	if err := devworld.ApplyPersonas(ctx, dsn); err != nil {
		t.Fatal(err)
	}
	if err := devworld.ApplyCatalogue(ctx, dsn); err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	// Two live, accepting restaurants outside the dev world: one wholly
	// ordinary, and one whose restaurant e-mail is at the seed domain but whose
	// owner is not a seed account.
	outsider := func(slug, restaurantEmail, ownerEmail string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			WITH o AS (
			  INSERT INTO account (email, email_verified_at, status, timezone)
			  VALUES ($3, now(), 'ACTIVE', 'America/Toronto') RETURNING id
			), r AS (
			  INSERT INTO restaurant (slug, legal_name, display_name, email, province, city, line1, postal_code,
			                          location, timezone, onboarding_state, account_state, is_accepting_orders,
			                          last_heartbeat_at, commission_rate_bps, tax_role, minimum_order_cents)
			  VALUES ($1, 'Test Co', $1, $2, 'ON', 'Toronto', '1 King St', 'M5J0C3',
			          ST_SetSRID(ST_MakePoint(-79.3810, 43.6412), 4326)::geography, 'America/Toronto',
			          'ACTIVE', 'LIVE', true, now(), 0, 'RESTAURANT_IS_SUPPLIER', 0)
			  RETURNING id
			)
			INSERT INTO account_role (account_id, role, scope_type, scope_id)
			SELECT o.id, 'RESTAURANT_OWNER', 'RESTAURANT', r.id FROM o, r`,
			slug, restaurantEmail, ownerEmail); err != nil {
			t.Fatalf("seed %s: %v", slug, err)
		}
	}
	outsider("real-kitchen", "owner@real-kitchen.example", "owner@real-kitchen.example")
	outsider("lookalike", "lookalike@seed.hg", "owner@lookalike.example")

	if _, err := pool.Exec(ctx, `UPDATE restaurant SET last_heartbeat_at = now() - interval '1 hour'`); err != nil {
		t.Fatal(err)
	}
	n, err := tablets.Beat(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}

	rows, err := pool.Query(ctx, `
		SELECT slug FROM restaurant
		 WHERE last_heartbeat_at > now() - interval '1 minute' ORDER BY slug`)
	if err != nil {
		t.Fatal(err)
	}
	var touched []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		touched = append(touched, s)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}

	var want []string
	for _, r := range devworld.Catalogue {
		if r.Slug != "paused" {
			want = append(want, r.Slug)
		}
	}
	sort.Strings(want)
	if int(n) != len(touched) {
		t.Errorf("Beat reported %d rows, %d have a fresh heartbeat", n, len(touched))
	}
	if len(touched) != len(want) {
		t.Fatalf("touched %v\nwant    %v", touched, want)
	}
	for i := range want {
		if touched[i] != want[i] {
			t.Fatalf("touched %v\nwant    %v", touched, want)
		}
	}
}
