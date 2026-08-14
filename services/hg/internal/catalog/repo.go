package catalog

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// errNotFound is the repository's not-found sentinel. Handlers translate it to a
// 404 — and crucially the halal predicate makes "not certified" and "does not
// exist" the same answer, so this is the only signal a customer ever gets.
var errNotFound = errors.New("catalog: not found")

// Repo is the catalogue data layer. It holds only a pool; it opens nothing.
type Repo struct {
	db *pgxpool.Pool
}

// NewRepo builds a Repo over an existing pool.
func NewRepo(db *pgxpool.Pool) *Repo { return &Repo{db: db} }

// restaurantRow is the internal projection scanned from the restaurant table for
// a customer card. Distance and availability are layered on top by the handler
// once an address is known.
type restaurantRow struct {
	id                string
	slug              string
	displayName       string
	description       *string
	line1             *string
	line2             *string
	city              *string
	province          *string
	postalCode        *string
	timezone          string
	publicPhone       *string
	ratingAvg         *float64
	ratingCount       int32
	priceBand         *string
	halalStatus       string
	minimumOrderCents int64
	avgPrepMinutes    int32
	deliveryRadiusM   int32
	// media object ids, resolved to public URLs by the MediaResolver.
	logoObjectID  *string
	coverObjectID *string
	// cuisines associated with the restaurant, projected for the card subtitle.
	cuisines []string
	// halal certificate fields, joined for the badge/panel.
	certifyingBody *string
	certExpiresOn  *time.Time
	// distance in metres from the query point; nil when no point supplied.
	distanceM *int32
	// lat/lng of the premises for the detail address block.
	latitude  *float64
	longitude *float64
}

// cardColumns is the shared SELECT list for a restaurant card. It never includes
// a price field the client could echo back.
const cardColumns = `
	r.id, r.slug, r.display_name, r.description,
	r.line1, r.line2, r.city, r.province::text, r.postal_code, r.timezone,
	r.public_phone_e164,
	r.rating_avg, r.rating_count, r.price_band::text, r.halal_status::text,
	r.minimum_order_cents, r.avg_prep_minutes, r.delivery_radius_m,
	r.logo_object_id::text, r.cover_object_id::text,
	COALESCE((
		SELECT array_agg(cu.name ORDER BY cu.sort_order, cu.name)
		  FROM restaurant_cuisine rc
		  JOIN cuisine cu ON cu.id = rc.cuisine_id
		 WHERE rc.restaurant_id = r.id AND cu.is_active
	), '{}') AS cuisines,
	b.name AS certifying_body,
	c.expires_on AS cert_expires_on`

// cardJoins joins the active halal certificate and its issuing body so the badge
// carries the certifying body name and expiry. LEFT JOIN because a visible
// restaurant is EXPIRING_SOON/CERTIFIED and therefore always has one, but the
// join must not itself re-gate.
const cardJoins = `
	FROM restaurant r
	LEFT JOIN halal_certificate c ON c.id = r.halal_certificate_id
	LEFT JOIN halal_issuing_body b ON b.id = c.issuing_body_id`

// scanCard scans one restaurant card row plus an optional distance and geo. The
// caller supplies whether the distance/geo columns are present.
func scanCard(row pgx.Row, withDistance, withGeo bool) (restaurantRow, error) {
	var rr restaurantRow
	dest := []any{
		&rr.id, &rr.slug, &rr.displayName, &rr.description,
		&rr.line1, &rr.line2, &rr.city, &rr.province, &rr.postalCode, &rr.timezone,
		&rr.publicPhone,
		&rr.ratingAvg, &rr.ratingCount, &rr.priceBand, &rr.halalStatus,
		&rr.minimumOrderCents, &rr.avgPrepMinutes, &rr.deliveryRadiusM,
		&rr.logoObjectID, &rr.coverObjectID, &rr.cuisines,
		&rr.certifyingBody, &rr.certExpiresOn,
	}
	if withGeo {
		dest = append(dest, &rr.latitude, &rr.longitude)
	}
	if withDistance {
		dest = append(dest, &rr.distanceM)
	}
	if err := row.Scan(dest...); err != nil {
		return restaurantRow{}, err
	}
	return rr, nil
}

// listFilters is the parsed, validated set of the nine discovery filters.
type listFilters struct {
	lat, lng     *float64
	maxDistanceM *int32
	cuisineIDs   []string
	openNow      *bool
	minRating    *float64
	priceBands   []string
	dietary      []string
	sort         string
	limit        int
	cursor       string
}

// listVisible runs the halal-gated list with the nine filters and keyset paging.
//
// PostGIS: when a query point is supplied, distance_m is ST_Distance on
// geography (metres) and max_distance_m becomes an ST_DWithin gate. Ordering is
// by the requested sort; the default RECOMMENDED blends rating and distance.
func (rp *Repo) listVisible(ctx context.Context, f listFilters) ([]restaurantRow, error) {
	args := []any{}
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }

	var distanceExpr, geoExpr string
	withDistance := f.lat != nil && f.lng != nil
	if withDistance {
		pt := fmt.Sprintf("ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography",
			arg(*f.lng), arg(*f.lat))
		distanceExpr = ", ST_Distance(r.location, " + pt + ")::int AS distance_m"
	} else {
		distanceExpr = ", NULL::int AS distance_m"
	}
	geoExpr = ", ST_Y(r.location::geometry) AS latitude, ST_X(r.location::geometry) AS longitude"

	where := []string{visiblePredicate}
	if withDistance && f.maxDistanceM != nil {
		pt := fmt.Sprintf("ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography",
			arg(*f.lng), arg(*f.lat))
		where = append(where, fmt.Sprintf("ST_DWithin(r.location, %s, %s)", pt, arg(int(*f.maxDistanceM))))
	}
	if f.minRating != nil {
		where = append(where, fmt.Sprintf("r.rating_avg >= %s", arg(*f.minRating)))
	}
	if len(f.priceBands) > 0 {
		where = append(where, fmt.Sprintf("r.price_band::text = ANY(%s)", arg(f.priceBands)))
	}
	if len(f.cuisineIDs) > 0 {
		where = append(where, fmt.Sprintf(
			"EXISTS (SELECT 1 FROM restaurant_cuisine rc WHERE rc.restaurant_id = r.id AND rc.cuisine_id = ANY(%s::uuid[]))",
			arg(f.cuisineIDs)))
	}
	if len(f.dietary) > 0 {
		// A restaurant matches a dietary filter when any live menu item version
		// carries the tag.
		where = append(where, fmt.Sprintf(
			`EXISTS (SELECT 1 FROM menu_item mi
			   JOIN menu_item_version mv ON mv.id = mi.live_version_id
			  WHERE mi.restaurant_id = r.id AND mi.deleted_at IS NULL
			    AND mv.dietary_tags && %s::dietary_tag[])`,
			arg(f.dietary)))
	}
	// Keyset cursor: id > cursor, id ascending as the tiebreak. The cursor is the
	// last id of the previous page; the ordering column is appended so paging is
	// stable regardless of sort.
	if f.cursor != "" {
		where = append(where, fmt.Sprintf("r.id > %s::uuid", arg(f.cursor)))
	}

	orderBy := "r.id ASC"
	switch f.sort {
	case "RATING_DESC":
		orderBy = "r.rating_avg DESC NULLS LAST, r.id ASC"
	case "DISTANCE_ASC", "ETA_ASC":
		if withDistance {
			orderBy = "distance_m ASC NULLS LAST, r.id ASC"
		}
	case "RECOMMENDED", "":
		if withDistance {
			orderBy = "(coalesce(r.rating_avg,0) * 2 - (distance_m::numeric / 5000)) DESC, r.id ASC"
		} else {
			orderBy = "r.rating_avg DESC NULLS LAST, r.id ASC"
		}
	}

	limit := f.limit
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	q := "SELECT " + cardColumns + geoExpr + distanceExpr + cardJoins +
		" WHERE " + strings.Join(where, " AND ") +
		" ORDER BY " + orderBy +
		fmt.Sprintf(" LIMIT %d", limit+1)

	rows, err := rp.db.Query(ctx, q, args...)
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

// getVisible loads one customer-visible restaurant by id, applying the shared
// predicate. A restaurant that is not visible is errNotFound — indistinguishable
// from "does not exist", which is the C-13 requirement.
func (rp *Repo) getVisible(ctx context.Context, id string, lat, lng *float64) (restaurantRow, error) {
	args := []any{id}
	distanceExpr := ", NULL::int AS distance_m"
	if lat != nil && lng != nil {
		args = append(args, *lng, *lat)
		distanceExpr = ", ST_Distance(r.location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)::int AS distance_m"
	}
	geoExpr := ", ST_Y(r.location::geometry) AS latitude, ST_X(r.location::geometry) AS longitude"
	q := "SELECT " + cardColumns + geoExpr + distanceExpr + cardJoins +
		" WHERE r.id = $1::uuid AND " + visiblePredicate
	// distanceExpr always projects a distance_m column (ST_Distance or NULL::int),
	// so the scan must always consume it — otherwise the field count mismatches the
	// destinations and pgx errors, which surfaced as a 500 on the point-less detail
	// read. withDistance is therefore true regardless of whether a point was given.
	rr, err := scanCard(rp.db.QueryRow(ctx, q, args...), true, true)
	if errors.Is(err, pgx.ErrNoRows) {
		return restaurantRow{}, errNotFound
	}
	return rr, err
}

// certificationRow is the certification-panel projection.
type certificationRow struct {
	halalStatus       string
	certifyingBody    *string
	certificateNumber *string
	scope             *string
	issuedOn          *time.Time
	expiresOn         *time.Time
	verifiedAt        *time.Time
	documentID        *string
}

// getCertification loads the certification panel for a visible restaurant.
func (rp *Repo) getCertification(ctx context.Context, id string) (certificationRow, error) {
	const q = `
		SELECT r.halal_status::text,
		       b.name, c.certificate_number, c.scope::text,
		       c.issued_on, c.expires_on, c.verified_at, c.document_id::text
		  FROM restaurant r
		  LEFT JOIN halal_certificate c ON c.id = r.halal_certificate_id
		  LEFT JOIN halal_issuing_body b ON b.id = c.issuing_body_id
		 WHERE r.id = $1::uuid AND ` + visiblePredicate
	var cr certificationRow
	err := rp.db.QueryRow(ctx, q, id).Scan(
		&cr.halalStatus, &cr.certifyingBody, &cr.certificateNumber, &cr.scope,
		&cr.issuedOn, &cr.expiresOn, &cr.verifiedAt, &cr.documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return certificationRow{}, errNotFound
	}
	return cr, err
}

// hoursRow is one trading interval.
type hoursRow struct {
	dayOfWeek       int32
	opensAt         string
	closesAt        string
	crossesMidnight bool
}

// getHours returns the standard weekly trading hours for a restaurant.
func (rp *Repo) getHours(ctx context.Context, id string) ([]hoursRow, error) {
	const q = `
		SELECT day_of_week, to_char(opens_at, 'HH24:MI'), to_char(closes_at, 'HH24:MI'), crosses_midnight
		  FROM restaurant_hours
		 WHERE restaurant_id = $1::uuid
		 ORDER BY day_of_week, opens_at`
	rows, err := rp.db.Query(ctx, q, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []hoursRow
	for rows.Next() {
		var h hoursRow
		if err := rows.Scan(&h.dayOfWeek, &h.opensAt, &h.closesAt, &h.crossesMidnight); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}
