package catalog

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// The home feed's section queries — C-09.
//
// Every section is a list of restaurant cards drawn through the same two gates:
// visiblePredicate (only CERTIFIED / EXPIRING_SOON, LIVE, undeleted — C-09 rule
// 3, one predicate for feed, search and detail) and an ST_DWithin radius around
// the request point. The radius applies to the personal sections too: C-09 AC1
// requires every section to be absent where nothing is in range, because a
// restaurant you ordered from elsewhere cannot deliver to where you are now.
//
// Radii, windows, rail sizes and the trending floor come from discovery_config,
// never from constants (P-33; the old feed's hard-coded numbers were B31).

// orderAgainLookback is how many of the customer's most recent delivered orders
// order_again and you_might_like read. C-09 rule 2 fixes it at 20; it is a
// definition of the section rather than a tuning knob, unlike the rail size.
const orderAgainLookback = 20

// youMightLikeCuisines is how many of the customer's most-ordered cuisines
// you_might_like matches against. C-09 rule 2: "top-3".
const youMightLikeCuisines = 3

var errNoDiscoveryConfig = errors.New("catalog: no effective discovery_config row")

// discoveryConfig is the effective P-33 configuration for the feed.
type discoveryConfig struct {
	nearbyRadiusM      int
	trendingWindowDays int
	railSize           int
	trendingMinOrders  int
}

// currentDiscoveryConfig reads the newest discovery_config version in effect.
// A missing row is a deployment fault — the seed always writes version 1 — and
// is reported as one rather than papered over with defaults, which would be the
// constants P-33 forbids.
func (rp *Repo) currentDiscoveryConfig(ctx context.Context) (discoveryConfig, error) {
	var c discoveryConfig
	err := rp.db.QueryRow(ctx, `
		SELECT nearby_radius_m, trending_window_days, rail_size, trending_min_orders
		  FROM discovery_config
		 WHERE effective_from <= now()
		 ORDER BY version DESC
		 LIMIT 1`).Scan(&c.nearbyRadiusM, &c.trendingWindowDays, &c.railSize, &c.trendingMinOrders)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, errNoDiscoveryConfig
	}
	return c, err
}

// point is a validated request coordinate.
type point struct{ lat, lng float64 }

// feedQuery is what distinguishes one section from another. Everything else —
// columns, joins, the visibility gate and the radius — is shared.
type feedQuery struct {
	with    string   // CTE definitions, without the WITH keyword
	join    string   // extra join clause, after the card joins
	where   []string // extra predicates, ANDed after the visibility and radius gates
	orderBy string
}

// feedCards runs one section's query. build receives the placeholder allocator
// so a section's own parameters number after the point and radius.
//
// It returns at most limit rows. listVisible deliberately returns limit+1 so a
// caller can detect a next page; the feed has no pages, and appending that extra
// row is how the old feed shipped one card over its rail.
func (rp *Repo) feedCards(ctx context.Context, pt point, radiusM, limit int,
	build func(arg func(any) string) feedQuery) ([]restaurantRow, error) {
	args := []any{}
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }

	at := fmt.Sprintf("ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography", arg(pt.lng), arg(pt.lat))
	radius := arg(radiusM)
	q := build(arg)

	sql := ""
	if q.with != "" {
		sql = "WITH " + q.with + "\n"
	}
	sql += "SELECT " + cardColumns +
		", ST_Y(r.location::geometry) AS latitude, ST_X(r.location::geometry) AS longitude" +
		", ST_Distance(r.location, " + at + ")::int AS distance_m" +
		cardJoins + "\n" + q.join +
		"\n WHERE " + visiblePredicate +
		"\n   AND ST_DWithin(r.location, " + at + ", " + radius + ")"
	for _, w := range q.where {
		sql += "\n   AND " + w
	}
	sql += "\n ORDER BY " + q.orderBy + fmt.Sprintf("\n LIMIT %d", limit)

	rows, err := rp.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []restaurantRow
	for rows.Next() {
		rr, err := scanCard(rows, true, true)
		if err != nil {
			return nil, err
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}

// feedOrderAgain: distinct restaurants from the customer's last 20 delivered
// orders, most recent first (C-09 rule 2).
//
// "Delivered" is delivered_at IS NOT NULL, not state = 'DELIVERED': a delivered
// order moves on to COMPLETED (or DISPUTED / RESOLVED), so matching the state
// would drop nearly every past order.
func (rp *Repo) feedOrderAgain(ctx context.Context, accountID string, pt point, cfg discoveryConfig) ([]restaurantRow, error) {
	return rp.feedCards(ctx, pt, cfg.nearbyRadiusM, cfg.railSize, func(arg func(any) string) feedQuery {
		return feedQuery{
			with: fmt.Sprintf(`recent AS (
				SELECT restaurant_id, max(delivered_at) AS last_at
				  FROM (SELECT restaurant_id, delivered_at
				          FROM "order"
				         WHERE account_id = %s AND delivered_at IS NOT NULL
				         ORDER BY delivered_at DESC
				         LIMIT %d) last_n
				 GROUP BY restaurant_id)`, arg(accountID), orderAgainLookback),
			join:    "JOIN recent ON recent.restaurant_id = r.id",
			orderBy: "recent.last_at DESC, r.id ASC",
		}
	})
}

// feedNearYou: visible restaurants inside the radius, nearest first.
func (rp *Repo) feedNearYou(ctx context.Context, pt point, cfg discoveryConfig) ([]restaurantRow, error) {
	return rp.feedCards(ctx, pt, cfg.nearbyRadiusM, cfg.railSize, func(func(any) string) feedQuery {
		return feedQuery{orderBy: "distance_m ASC, r.id ASC"}
	})
}

// feedTrending: restaurants inside the radius ranked by delivered orders within
// the trending window, among those with at least trending_min_orders (C-09 rule
// 2). Ranked by plain count: P-33 mentions decay, but a decayed score is not
// defined anywhere, and a count is reproducible and testable.
func (rp *Repo) feedTrending(ctx context.Context, pt point, cfg discoveryConfig) ([]restaurantRow, error) {
	return rp.feedCards(ctx, pt, cfg.nearbyRadiusM, cfg.railSize, func(arg func(any) string) feedQuery {
		return feedQuery{
			with: fmt.Sprintf(`counts AS (
				SELECT restaurant_id, count(*) AS n
				  FROM "order"
				 WHERE delivered_at >= now() - make_interval(days => %s::int)
				 GROUP BY restaurant_id
				HAVING count(*) >= %s)`, arg(cfg.trendingWindowDays), arg(cfg.trendingMinOrders)),
			join:    "JOIN counts ON counts.restaurant_id = r.id",
			orderBy: "counts.n DESC, r.id ASC",
		}
	})
}

// feedYouMightLike: restaurants sharing a cuisine with the customer's top-3
// ordered cuisines, excluding those already shown in order_again (C-09 rule 2).
// Ordered by rating, then distance.
func (rp *Repo) feedYouMightLike(ctx context.Context, accountID string, pt point, cfg discoveryConfig,
	exclude []string) ([]restaurantRow, error) {
	if exclude == nil {
		exclude = []string{}
	}
	return rp.feedCards(ctx, pt, cfg.nearbyRadiusM, cfg.railSize, func(arg func(any) string) feedQuery {
		return feedQuery{
			with: fmt.Sprintf(`top_cuisines AS (
				SELECT rc.cuisine_id
				  FROM "order" o
				  JOIN restaurant_cuisine rc ON rc.restaurant_id = o.restaurant_id
				 WHERE o.account_id = %s AND o.delivered_at IS NOT NULL
				 GROUP BY rc.cuisine_id
				 ORDER BY count(*) DESC, rc.cuisine_id
				 LIMIT %d)`, arg(accountID), youMightLikeCuisines),
			where: []string{
				`EXISTS (SELECT 1 FROM restaurant_cuisine mine
				          WHERE mine.restaurant_id = r.id
				            AND mine.cuisine_id IN (SELECT cuisine_id FROM top_cuisines))`,
				fmt.Sprintf("r.id <> ALL(%s::uuid[])", arg(exclude)),
			},
			orderBy: "r.rating_avg DESC NULLS LAST, distance_m ASC, r.id ASC",
		}
	})
}
