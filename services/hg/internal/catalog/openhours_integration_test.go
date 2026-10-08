package catalog

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// TestCardOpenStateReadsHoursFromTheDatabase runs the list and detail reads
// against a database of its own: the hours, overrides, toggle and heartbeat the
// card query aggregates reach the open state, so a restaurant with no hours
// today reads CLOSED_HOURS with its next opening and a paused one reads PAUSED.
// https://github.com/shaiknoorullah/hg-mono/issues/645
func TestCardOpenStateReadsHoursFromTheDatabase(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), testseed.FreshDatabase(t, "catalog_hours"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	ctx := context.Background()

	// Three visible restaurants in Toronto: open all day every day; open all
	// day but not accepting orders; and one whose only hours are tomorrow's,
	// with today closed by an override as well.
	seed := func(slug string, accepting bool) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO restaurant (slug, legal_name, display_name, province, city, line1, postal_code,
			                        location, timezone, onboarding_state, account_state, is_accepting_orders,
			                        last_heartbeat_at, commission_rate_bps, tax_role, minimum_order_cents)
			VALUES ($1, 'Test Co', $1, 'ON', 'Toronto', '1 King St', 'M5J0C3',
			        ST_SetSRID(ST_MakePoint(-79.3810, 43.6412), 4326)::geography, 'America/Toronto',
			        'ACTIVE', 'LIVE', $2, now(), 0, 'RESTAURANT_IS_SUPPLIER', 0)
			RETURNING id`, slug, accepting).Scan(&id); err != nil {
			t.Fatalf("seed %s: %v", slug, err)
		}
		testseed.CertifyRestaurant(t, pool, id, 300)
		return id
	}
	open := seed("hours-open", true)
	paused := seed("hours-paused", false)
	closed := seed("hours-closed", true)

	if _, err := pool.Exec(ctx, `
		INSERT INTO restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, crosses_midnight)
		SELECT r, d, time '00:00', time '00:00', true
		  FROM unnest(ARRAY[$1::uuid, $2::uuid]) AS r CROSS JOIN generate_series(0, 6) AS d`,
		open, paused); err != nil {
		t.Fatalf("seed 24-hour hours: %v", err)
	}
	torontoToday := `(now() AT TIME ZONE 'America/Toronto')::date`
	if _, err := pool.Exec(ctx, `
		INSERT INTO restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at)
		VALUES ($1, extract(dow FROM `+torontoToday+` + 1)::int, time '11:00', time '22:00')`, closed); err != nil {
		t.Fatalf("seed tomorrow's hours: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO restaurant_hours_override (restaurant_id, on_date, is_closed)
		VALUES ($1, `+torontoToday+`, true)`, closed); err != nil {
		t.Fatalf("seed today's closure: %v", err)
	}

	h := &Handler{media: nilMedia{}}
	now := time.Now().UTC()
	toronto, _ := time.LoadLocation("America/Toronto")
	ly, lm, ld := now.In(toronto).Date()
	tomorrow11 := time.Date(ly, lm, ld+1, 11, 0, 0, 0, toronto)

	want := map[string]struct {
		state   string
		opensAt *time.Time
	}{
		open:   {availOpen, nil},
		paused: {availPaused, nil},
		closed: {availClosedHours, &tomorrow11},
	}

	lat, lng := 43.6412, -79.3810
	rows, err := NewRepo(pool).listVisible(ctx, listFilters{lat: &lat, lng: &lng, limit: 50})
	if err != nil {
		t.Fatalf("listVisible: %v", err)
	}
	seen := 0
	for _, rr := range rows {
		w, ok := want[rr.id]
		if !ok {
			continue
		}
		seen++
		info := h.cardFor(rr, true, now).Availability
		if info.State != w.state {
			t.Errorf("list: %s state = %q, want %q", rr.slug, info.State, w.state)
		}
		checkTime(t, rr.slug+" opens_at", info.OpensAt, w.opensAt)
	}
	if seen != len(want) {
		t.Fatalf("list returned %d of the %d seeded restaurants", seen, len(want))
	}

	rr, err := NewRepo(pool).getVisible(ctx, closed, &lat, &lng)
	if err != nil {
		t.Fatalf("getVisible: %v", err)
	}
	if info := h.cardFor(rr, true, now).Availability; info.State != availClosedHours {
		t.Errorf("detail: state = %q, want CLOSED_HOURS", info.State)
	}
}
