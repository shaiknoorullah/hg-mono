package orders

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/money"
)

// OrderView is the customer projection (P-07) of an order, in the shape the
// handler renders to OrderCustomerView. It carries only what a customer may see;
// the rider is a public profile, never earnings, and there is no internal split.
type OrderView struct {
	ID                   string
	Code                 string
	State                string
	StateSince           time.Time
	DeadlineAt           *time.Time
	QuoteID              string
	RestaurantID         string
	RestaurantName       string
	RestaurantLogoURL    *string
	HalalStatus          string
	HalalCertifyingBody  *string
	HalalExpiresOn       *string
	DeliveryAddress      *OrderAddress
	Rider                *RiderPublicProfile
	DispatchState        *string
	Lines                []OrderViewLine
	SubtotalCents        int64
	DiscountCents        int64
	DeliveryFeeCents     int64
	ServiceFeeCents      int64
	TaxLines             []QuoteTaxLine
	TaxTotalCents        int64
	TipCents             int64
	TotalCents           int64
	Currency             string
	DeliveryInstructions []string
	SpecialInstructions  *string
	CancelReason         *string
	RejectReason         *string
	Fulfilment           string
	CanCancel            bool
	PlacedAt             time.Time
	AcceptedAt           *time.Time
	ReadyAt              *time.Time
	PickedUpAt           *time.Time
	DeliveredAt          *time.Time
	CompletedAt          *time.Time
}

// OrderViewLine is one customer-facing order line.
type OrderViewLine struct {
	LineNo         int
	MenuItemID     string
	Name           string
	VariantName    *string
	Quantity       int
	SpecialRequest *string
	UnitPriceCents int64
	LineTotalCents int64
	Currency       string
	Addons         []QuoteLineAddon
}

// OrderAddress is the customer's delivery address on the order projection
// (contract Address).
type OrderAddress struct {
	ID            string
	Label         *string
	Line1         string
	Line2         *string
	Unit          *string
	Buzzer        *string
	City          string
	Province      string
	PostalCode    string
	Country       string
	Latitude      float64
	Longitude     float64
	Timezone      string
	DeliveryNotes *string
	IsDefault     bool
}

// OrderSummary is one row of the customer's order history (OrderSummary schema).
type OrderSummary struct {
	ID             string
	Code           string
	State          string
	RestaurantID   string
	RestaurantName string
	RestaurantLogo *string
	ItemCount      int
	FirstItemNames []string
	TotalCents     int64
	Currency       string
	PlacedAt       time.Time
	DeadlineAt     *time.Time
}

// GetOrderForCustomer loads one order visible to the account via the
// order_visibility view (P-07): an unrelated principal gets ErrOrderNotFound,
// never a 403 that would confirm the order exists.
func (s *Store) GetOrderForCustomer(ctx context.Context, accountID, orderID string) (*OrderView, error) {
	var out *OrderView
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		v, err := s.loadOrderView(ctx, tx, accountID, orderID)
		out = v
		return err
	})
	return out, err
}

func (s *Store) loadOrderView(ctx context.Context, tx pgx.Tx, accountID, orderID string) (*OrderView, error) {
	var v OrderView
	var halalCertExpiresOn *time.Time
	var logoBucket, logoKey *string
	// The restaurant's logo object (READY only) is joined from stored_object so
	// logo_image_url carries the direct public URL — logo_object_id is a
	// stored_object UUID, not a URI, so it is resolved through the media builder
	// rather than emitted raw (the contract types it `format: uri`). The halal
	// seal (C-12) is joined here from the active certificate + issuing body so
	// the customer order view can carry the restaurant's HalalBadge.
	err := tx.QueryRow(ctx, `
		SELECT o.id, o.code, o.state::text, o.state_since, o.deadline_at, o.quote_id,
		       o.restaurant_id, r.display_name, so_logo.bucket, so_logo.object_key,
		       r.halal_status::text, b.name AS certifying_body, cert.expires_on AS cert_expires_on,
		       d.state::text AS dispatch_state,
		       o.subtotal_cents, o.discount_cents, o.delivery_fee_cents, o.service_fee_cents,
		       o.tax_total_cents, o.tip_cents, o.total_cents, o.currency::text,
		       o.delivery_instructions, o.special_instructions,
		       o.cancel_reason::text, o.reject_reason::text, o.fulfilment::text,
		       o.placed_at, o.accepted_at, o.ready_at, o.picked_up_at, o.delivered_at, o.completed_at
		  FROM "order" o
		  JOIN order_visibility ov ON ov.order_id = o.id AND ov.account_id = $1 AND ov.via = 'CUSTOMER'
		  JOIN restaurant r ON r.id = o.restaurant_id
		  LEFT JOIN halal_certificate cert ON cert.id = r.halal_certificate_id
		  LEFT JOIN halal_issuing_body b ON b.id = cert.issuing_body_id
		  LEFT JOIN stored_object so_logo ON so_logo.id = r.logo_object_id AND so_logo.state = 'READY'
		  LEFT JOIN dispatch d ON d.order_id = o.id
		 WHERE o.id = $2`, accountID, orderID).Scan(
		&v.ID, &v.Code, &v.State, &v.StateSince, &v.DeadlineAt, &v.QuoteID,
		&v.RestaurantID, &v.RestaurantName, &logoBucket, &logoKey,
		&v.HalalStatus, &v.HalalCertifyingBody, &halalCertExpiresOn,
		&v.DispatchState,
		&v.SubtotalCents, &v.DiscountCents, &v.DeliveryFeeCents, &v.ServiceFeeCents,
		&v.TaxTotalCents, &v.TipCents, &v.TotalCents, &v.Currency,
		&v.DeliveryInstructions, &v.SpecialInstructions,
		&v.CancelReason, &v.RejectReason, &v.Fulfilment,
		&v.PlacedAt, &v.AcceptedAt, &v.ReadyAt, &v.PickedUpAt, &v.DeliveredAt, &v.CompletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load order: %w", err)
	}
	if halalCertExpiresOn != nil {
		s := halalCertExpiresOn.Format("2006-01-02")
		v.HalalExpiresOn = &s
	}
	v.RestaurantLogoURL = s.mediaURL(logoBucket, logoKey)

	// can_cancel: free only while cancellation is free (before restaurant accepts).
	st := machine.State(v.State)
	v.CanCancel = st == machine.StateCreated || st == machine.StateAuthorized || st == machine.StateRestaurantPending

	lineRows, err := tx.Query(ctx, `
		SELECT line_no, menu_item_id, name_snapshot, variant_name, quantity, special_request,
		       line_unit_cents, line_total_cents
		  FROM order_line WHERE order_id = $1 ORDER BY line_no`, orderID)
	if err != nil {
		return nil, fmt.Errorf("load order_line: %w", err)
	}
	defer lineRows.Close()
	for lineRows.Next() {
		var l OrderViewLine
		if err := lineRows.Scan(&l.LineNo, &l.MenuItemID, &l.Name, &l.VariantName, &l.Quantity,
			&l.SpecialRequest, &l.UnitPriceCents, &l.LineTotalCents); err != nil {
			return nil, err
		}
		l.Currency = v.Currency
		v.Lines = append(v.Lines, l)
	}
	if err := lineRows.Err(); err != nil {
		return nil, err
	}
	lineRows.Close()

	for i := range v.Lines {
		aRows, err := tx.Query(ctx, `
			SELECT addon_id, addon_name, addon_quantity, addon_price_cents
			  FROM order_line_addon WHERE order_id = $1 AND line_no = $2 ORDER BY addon_id`,
			orderID, v.Lines[i].LineNo)
		if err != nil {
			return nil, err
		}
		for aRows.Next() {
			var a QuoteLineAddon
			if err := aRows.Scan(&a.AddonID, &a.AddonName, &a.AddonQuantity, &a.PriceCents); err != nil {
				aRows.Close()
				return nil, err
			}
			v.Lines[i].Addons = append(v.Lines[i].Addons, a)
		}
		if err := aRows.Err(); err != nil {
			aRows.Close()
			return nil, err
		}
		aRows.Close()
	}

	// Tax lines from the order's quote (the customer decomposition).
	taxRows, err := tx.Query(ctx, `
		SELECT seq, jurisdiction_code, tax_kind::text, statutory_label, rate::text,
		       base_cents, amount_cents, rebate_applied, remittable_by::text
		  FROM quote_tax_line WHERE quote_id = $1 ORDER BY seq`, v.QuoteID)
	if err != nil {
		return nil, fmt.Errorf("load tax lines: %w", err)
	}
	defer taxRows.Close()
	for taxRows.Next() {
		var tl QuoteTaxLine
		var rateStr string
		if err := taxRows.Scan(&tl.Seq, &tl.JurisdictionCode, &tl.TaxKind, &tl.StatutoryLabel, &rateStr,
			&tl.BaseCents, &tl.AmountCents, &tl.RebateApplied, &tl.RemittableBy); err != nil {
			return nil, err
		}
		// The rate was read and dropped, so the order view and the receipt
		// printed every rate as "0" (https://github.com/shaiknoorullah/hg-mono/issues/511).
		tl.Rate, _ = money.RateFromDecimalString(rateStr)
		v.TaxLines = append(v.TaxLines, tl)
	}
	if err := taxRows.Err(); err != nil {
		return nil, err
	}

	// Delivery address (contract Address). Null for PICKUP orders. Latitude and
	// longitude are decomposed from the geography point (never a stored lat/lng).
	var a OrderAddress
	addrErr := tx.QueryRow(ctx, `
		SELECT a.id, a.label, a.line1, a.line2, a.unit, a.buzzer, a.city, a.province::text,
		       a.postal_code, a.country, ST_Y(a.location::geometry), ST_X(a.location::geometry),
		       a.timezone, a.delivery_notes, a.is_default
		  FROM "order" o JOIN address a ON a.id = o.delivery_address_id
		 WHERE o.id = $1 AND o.delivery_address_id IS NOT NULL`, orderID).Scan(
		&a.ID, &a.Label, &a.Line1, &a.Line2, &a.Unit, &a.Buzzer, &a.City, &a.Province,
		&a.PostalCode, &a.Country, &a.Latitude, &a.Longitude,
		&a.Timezone, &a.DeliveryNotes, &a.IsDefault)
	if addrErr == nil {
		v.DeliveryAddress = &a
	} else if !errors.Is(addrErr, pgx.ErrNoRows) {
		return nil, fmt.Errorf("load delivery address: %w", addrErr)
	}

	// Assigned rider's public profile (C-32). Absent until a rider is on the
	// order; the customer never sees earnings, phone or record (P-07).
	var rp RiderPublicProfile
	riderErr := tx.QueryRow(ctx, `
		SELECT rp.first_name, left(rp.last_name, 1), NULL::text, rv.vehicle_type::text, rp.rating_avg
		  FROM dispatch d
		  JOIN rider_profile rp ON rp.account_id = d.rider_account_id
		  JOIN rider_vehicle rv ON rv.account_id = d.rider_account_id AND rv.is_active AND rv.deleted_at IS NULL
		 WHERE d.order_id = $1 AND d.rider_account_id IS NOT NULL`, orderID).Scan(
		&rp.FirstName, &rp.LastInitial, &rp.PhotoURL, &rp.VehicleType, &rp.RatingAvg)
	if riderErr == nil {
		v.Rider = &rp
	} else if !errors.Is(riderErr, pgx.ErrNoRows) {
		return nil, fmt.Errorf("load rider: %w", riderErr)
	}

	return &v, nil
}

// GetActiveOrder returns the customer's one active order or nil: the order that
// refuses a second checkout, so an order under review after a problem report is
// not it (machine.CountsAsActive; issue
// https://github.com/shaiknoorullah/hg-mono/issues/260). The order history's
// Active section still lists every unfinished order (ListOrders).
func (s *Store) GetActiveOrder(ctx context.Context, accountID string) (*OrderView, error) {
	var out *OrderView
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var orderID string
		err := tx.QueryRow(ctx, `
			SELECT id FROM "order"
			 WHERE account_id = $1
			   AND state::text = ANY($2)
			 ORDER BY placed_at DESC LIMIT 1`, accountID, machine.ActiveStates()).Scan(&orderID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // out stays nil
		}
		if err != nil {
			return err
		}
		v, err := s.loadOrderView(ctx, tx, accountID, orderID)
		out = v
		return err
	})
	return out, err
}

// ListOrders returns the customer's order history, newest first, keyset
// paginated by placed_at. statusGroup filters ACTIVE vs PAST when non-empty.
func (s *Store) ListOrders(ctx context.Context, accountID string, statusGroup string, limit int, cursor *time.Time) ([]OrderSummary, *time.Time, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	terminal := "('COMPLETED','CANCELLED','REJECTED','FAILED','RESOLVED')"
	where := `o.account_id = $1`
	switch statusGroup {
	case "ACTIVE":
		where += ` AND o.state NOT IN ` + terminal
	case "PAST":
		where += ` AND o.state IN ` + terminal
	}
	args := []any{accountID}
	if cursor != nil {
		args = append(args, *cursor)
		where += fmt.Sprintf(` AND o.placed_at < $%d`, len(args))
	}
	args = append(args, limit+1)
	q := fmt.Sprintf(`
		SELECT o.id, o.code, o.state::text, o.restaurant_id, r.display_name,
		       o.total_cents, o.currency::text, o.placed_at, o.deadline_at
		  FROM "order" o JOIN restaurant r ON r.id = o.restaurant_id
		 WHERE %s ORDER BY o.placed_at DESC LIMIT $%d`, where, len(args))

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("list orders: %w", err)
	}
	defer rows.Close()
	var out []OrderSummary
	for rows.Next() {
		var o OrderSummary
		if err := rows.Scan(&o.ID, &o.Code, &o.State, &o.RestaurantID, &o.RestaurantName,
			&o.TotalCents, &o.Currency, &o.PlacedAt, &o.DeadlineAt); err != nil {
			return nil, nil, err
		}
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	var next *time.Time
	if len(out) > limit {
		out = out[:limit]
		t := out[len(out)-1].PlacedAt
		next = &t
	}

	// Enrich each summary with item_count and first two names.
	for i := range out {
		if err := s.fillSummaryItems(ctx, &out[i]); err != nil {
			return nil, nil, err
		}
	}
	return out, next, nil
}

func (s *Store) fillSummaryItems(ctx context.Context, o *OrderSummary) error {
	rows, err := s.pool.Query(ctx, `
		SELECT name_snapshot, quantity FROM order_line WHERE order_id = $1 ORDER BY line_no`, o.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		var qty int
		if err := rows.Scan(&name, &qty); err != nil {
			return err
		}
		o.ItemCount += qty
		if len(o.FirstItemNames) < 2 {
			o.FirstItemNames = append(o.FirstItemNames, name)
		}
	}
	return rows.Err()
}

// CancelOrder is the customer's free cancellation (T9): permitted only in
// CREATED, AUTHORIZED or RESTAURANT_PENDING. After acceptance it returns
// ErrCancellationWindowClosed. The transition runs conditionally; the race
// between the tap and the restaurant's acceptance resolves to one winner.
func (s *Store) CancelOrder(ctx context.Context, accountID, orderID, reasonCode string, note *string) (*OrderView, error) {
	var out *OrderView
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		// Ownership + current state.
		var state string
		err := tx.QueryRow(ctx, `
			SELECT o.state::text FROM "order" o
			  JOIN order_visibility ov ON ov.order_id = o.id AND ov.account_id = $1 AND ov.via = 'CUSTOMER'
			 WHERE o.id = $2 FOR UPDATE OF o`, accountID, orderID).Scan(&state)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrderNotFound
		}
		if err != nil {
			return err
		}
		st := machine.State(state)
		if st != machine.StateCreated && st != machine.StateAuthorized && st != machine.StateRestaurantPending {
			return ErrCancellationWindowClosed
		}
		cancelReason := "CUSTOMER_CANCELLED"
		if err := s.transitionTx(ctx, tx, TransitionRequest{
			OrderID: orderID, To: machine.StateCancelled, Actor: machine.ActorCustomer,
			ActorAccountID: accountID, Reason: "customer cancelled",
			CancelReason: &cancelReason, CustomerCancelReason: &reasonCode,
		}); err != nil {
			return err
		}
		v, err := s.loadOrderView(ctx, tx, accountID, orderID)
		out = v
		return err
	})
	return out, err
}

// ErrCancellationWindowClosed is returned when a customer cancels after
// restaurant acceptance (409 CANCELLATION_WINDOW_CLOSED).
var ErrCancellationWindowClosed = errors.New("cancellation window closed")
