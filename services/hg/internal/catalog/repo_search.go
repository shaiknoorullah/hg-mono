package catalog

import (
	"context"
	"fmt"
	"strings"
)

// searchRestaurants runs the halal-gated restaurant search. When q is present it
// blends tsvector meaning with pg_trgm typo tolerance; absent q it browses.
// Distance re-ranks when a query point is supplied (P-33/C-10).
func (rp *Repo) searchRestaurants(ctx context.Context, q string, lat, lng *float64, cursor string, limit int) ([]restaurantRow, error) {
	args := []any{}
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }

	where := []string{visiblePredicate}
	var rankExpr string
	if q != "" {
		qp := arg(q)
		where = append(where, fmt.Sprintf(
			"(r.search_tsv @@ plainto_tsquery('english', hg_unaccent(%s)) OR r.display_name %% %s)", qp, qp))
		rankExpr = fmt.Sprintf(
			"ts_rank(r.search_tsv, plainto_tsquery('english', hg_unaccent(%s))) + similarity(r.display_name, %s)", qp, qp)
	} else {
		rankExpr = "coalesce(r.rating_avg, 0)"
	}

	distanceExpr := ", NULL::int AS distance_m"
	if lat != nil && lng != nil {
		pt := fmt.Sprintf("ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography", arg(*lng), arg(*lat))
		distanceExpr = ", ST_Distance(r.location, " + pt + ")::int AS distance_m"
	}
	geoExpr := ", ST_Y(r.location::geometry) AS latitude, ST_X(r.location::geometry) AS longitude"

	if cursor != "" {
		where = append(where, fmt.Sprintf("r.id > %s::uuid", arg(cursor)))
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	query := "SELECT " + cardColumns + geoExpr + distanceExpr + cardJoins +
		" WHERE " + strings.Join(where, " AND ") +
		" ORDER BY (" + rankExpr + ") DESC, r.id ASC" +
		fmt.Sprintf(" LIMIT %d", limit+1)

	rows, err := rp.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []restaurantRow
	for rows.Next() {
		rr, err := scanCard(rows, lat != nil && lng != nil, true)
		if err != nil {
			return nil, err
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}

// dishSearchRow is a dish result joined to its parent restaurant card.
type dishSearchRow struct {
	menuItemID  string
	name        string
	description *string
	priceCents  int64
	currency    string
	restaurant  restaurantRow
}

// searchDishes searches live menu-item versions for restaurants that pass the
// halal predicate. A dish whose restaurant is invisible never appears — the gate
// is on the restaurant, applied through the join.
func (rp *Repo) searchDishes(ctx context.Context, q string, lat, lng *float64, cursor string, limit int) ([]dishSearchRow, error) {
	if q == "" {
		return nil, nil
	}
	args := []any{}
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }
	qp := arg(q)

	distanceExpr := ", NULL::int AS distance_m"
	if lat != nil && lng != nil {
		pt := fmt.Sprintf("ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography", arg(*lng), arg(*lat))
		distanceExpr = ", ST_Distance(r.location, " + pt + ")::int AS distance_m"
	}
	geoExpr := ", ST_Y(r.location::geometry) AS latitude, ST_X(r.location::geometry) AS longitude"

	where := []string{
		visiblePredicate,
		"mi.deleted_at IS NULL",
		"mi.availability_state <> 'HIDDEN'",
		fmt.Sprintf("(mv.search_tsv @@ plainto_tsquery('english', hg_unaccent(%s)) OR mv.name %% %s)", qp, qp),
	}
	if cursor != "" {
		where = append(where, fmt.Sprintf("mi.id > %s::uuid", arg(cursor)))
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	query := `
		SELECT mi.id::text, mv.name, mv.description, mi.price_cents, mi.currency::text,
		` + cardColumns + geoExpr + distanceExpr + `
		  FROM menu_item mi
		  JOIN menu_item_version mv ON mv.id = mi.live_version_id
		  JOIN restaurant r ON r.id = mi.restaurant_id
		  LEFT JOIN halal_certificate c ON c.id = r.halal_certificate_id
		  LEFT JOIN halal_issuing_body b ON b.id = c.issuing_body_id
		 WHERE ` + strings.Join(where, " AND ") + `
		 ORDER BY mi.id ASC
		 LIMIT ` + fmt.Sprintf("%d", limit+1)

	rows, err := rp.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []dishSearchRow
	withDistance := lat != nil && lng != nil
	for rows.Next() {
		var d dishSearchRow
		var rr restaurantRow
		dest := []any{&d.menuItemID, &d.name, &d.description, &d.priceCents, &d.currency,
			&rr.id, &rr.slug, &rr.displayName, &rr.description,
			&rr.line1, &rr.line2, &rr.city, &rr.province, &rr.postalCode, &rr.timezone,
			&rr.publicPhone,
			&rr.ratingAvg, &rr.ratingCount, &rr.priceBand, &rr.halalStatus,
			&rr.minimumOrderCents, &rr.avgPrepMinutes, &rr.deliveryRadiusM,
			&rr.certifyingBody, &rr.certExpiresOn,
			&rr.latitude, &rr.longitude,
		}
		if withDistance {
			dest = append(dest, &rr.distanceM)
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		d.restaurant = rr
		out = append(out, d)
	}
	return out, rows.Err()
}
