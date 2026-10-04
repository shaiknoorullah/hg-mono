package orders

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/money"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/pricing"
)

// EventEmitter is the boundary to the realtime module. orders.Store calls it
// inside Transition — in the same database transaction — so the outbox event
// and the state change commit atomically (the transactional outbox pattern).
//
// The concrete implementation lives in cmd/hg/main.go and calls
// realtime.EmitInTx; the orders package declares only this interface so it
// never imports realtime (the two modules are siblings, not dependents).
type EventEmitter interface {
	// EmitOrderTransition writes a realtime outbox event for the state change
	// inside the caller's transaction tx. It must not commit or roll back the
	// transaction; that responsibility stays with Transition.
	EmitOrderTransition(ctx context.Context, tx pgx.Tx, orderID, newState string) error
}

// Store is the orders module's data access. It takes the shared pgx pool from
// the top-level store; it never opens its own (per the store package's note).
// Every method that loads an owned entity takes the caller's account id and
// pushes the ownership predicate into SQL (P-07): there is no GetOrder(id), only
// GetOrderForCustomer(accountID, id).
type Store struct {
	pool    *pgxpool.Pool
	emitter EventEmitter    // optional; nil means no realtime events
	media   MediaURLBuilder // optional; nil renders every image URL as null
	// riderEarnings pays the rider inside the DELIVERED transition. Optional:
	// nil (tests, minimal wiring) delivers without writing earnings.
	riderEarnings RiderEarnings

	// platformTaxRegistrationNumber and platformLegalName are the O-01 values
	// (HG_TAX_HST_REGISTRATION_NUMBER / HG_TAX_PLATFORM_LEGAL_NAME) that the
	// receipt-snapshot writer stamps onto Receipt.platform_tax_registration_number
	// and .platform_legal_name at COMPLETED. Both empty until O-01 is resolved —
	// the contract renders the field only when configured, never a placeholder.
	platformTaxRegistrationNumber string
	platformLegalName             string
}

// MediaURLBuilder turns an already-fetched (bucket, object_key) into the public
// URL a client GETs directly. The order and cart projections join stored_object
// to fetch the key alongside the id, so building the URL costs no extra query.
// The concrete implementation is the catalog media resolver, injected in
// cmd/hg/main.go; the orders package declares only this interface so it never
// imports catalog (the two modules are siblings). A nil builder renders every
// image URL as null — contract-valid (a neutral placeholder), and the state in
// tests and minimal wiring.
type MediaURLBuilder interface {
	URLForKey(bucket, objectKey string) *string
}

// NewStore wraps a pgx pool. emitter may be nil: when nil, Transition skips
// the outbox write and no realtime event is emitted (safe for tests that do
// not provision the realtime schema).
func NewStore(pool *pgxpool.Pool, emitter ...EventEmitter) *Store {
	s := &Store{pool: pool}
	if len(emitter) > 0 {
		s.emitter = emitter[0]
	}
	return s
}

// RiderEarnings writes a rider's earnings for a delivered order: the ledger
// postings and the rider's earning lines, inside the transaction tx that
// moves the order to DELIVERED. The payee comes from the database (the
// order's DELIVERED assignment with its proof of delivery); riderAccountID,
// the rider completing the transition, is only checked against it. It must
// not commit or roll back tx, and it must write nothing when the order is
// already paid. The payments module implements it and cmd/hg/main.go injects
// it, so orders never imports payments
// (https://github.com/shaiknoorullah/hg-mono/issues/306).
type RiderEarnings interface {
	CreditDeliveryTx(ctx context.Context, tx pgx.Tx, orderID, riderAccountID string) error
}

// WithRiderEarnings attaches the rider earnings writer and returns the store.
func (s *Store) WithRiderEarnings(e RiderEarnings) *Store {
	s.riderEarnings = e
	return s
}

// WithMedia attaches the media URL builder and returns the store, so wiring can
// read as orders.NewStore(pool, emitter).WithMedia(resolver). A nil builder is
// accepted and leaves image URLs null.
func (s *Store) WithMedia(m MediaURLBuilder) *Store {
	s.media = m
	return s
}

// WithPlatformTaxInfo attaches the O-01 platform tax-registration number and
// legal name (from config.Tax) and returns the store, so wiring reads as
// orders.NewStore(pool, emitter).WithPlatformTaxInfo(cfg.Tax.HSTRegistrationNumber, cfg.Tax.PlatformLegalName).
// Both empty is the honest default while O-01 is unresolved: the receipt
// writer renders the field only when configured.
func (s *Store) WithPlatformTaxInfo(registrationNumber, legalName string) *Store {
	s.platformTaxRegistrationNumber = registrationNumber
	s.platformLegalName = legalName
	return s
}

// PlatformTaxRegistrationNumber returns the configured HST/GST registration
// number, or "" when O-01 is unresolved. The receipt-snapshot writer must
// never substitute a placeholder for an empty value (I-08 in spirit).
func (s *Store) PlatformTaxRegistrationNumber() string { return s.platformTaxRegistrationNumber }

// PlatformLegalName returns the configured platform legal name, or "" when
// unset.
func (s *Store) PlatformLegalName() string { return s.platformLegalName }

// mediaURL builds the public URL for an optional (bucket, object_key) pair, or
// nil when no media resolver is wired or the object is absent. Centralised so
// the order/cart read paths never dereference a nil builder.
func (s *Store) mediaURL(bucket, objectKey *string) *string {
	if s.media == nil || bucket == nil || objectKey == nil {
		return nil
	}
	return s.media.URLForKey(*bucket, *objectKey)
}

// Sentinel errors mapped to typed HTTP responses by the handlers.
var (
	ErrCartNotFound        = errors.New("cart not found")
	ErrCartEmpty           = errors.New("cart is empty")
	ErrDifferentRestaurant = errors.New("cart belongs to a different restaurant")
	ErrItemUnavailable     = errors.New("cart references an unavailable item")
	ErrRestaurantClosed    = errors.New("restaurant is not accepting orders")
	ErrQuoteNotFound       = errors.New("quote not found")
	ErrQuoteExpired        = errors.New("quote expired")
	ErrQuoteStale          = errors.New("quote is stale")
	ErrOrderNotFound       = errors.New("order not found")
	ErrActiveOrderExists   = errors.New("an active order already exists")
	ErrIllegalTransition   = errors.New("illegal state transition")
	ErrProvinceNotServed   = errors.New("province not served")
)

// resolvedContext is everything Compute needs, read from Postgres inside the
// quote transaction, plus the exact rows read (for the state hash).
type resolvedContext struct {
	inputs            pricing.Inputs
	cartID            string
	restaurantID      string
	deliveryAddressID *string
	pricingConfigID   string
	jurisdiction      string
	stateRows         []stateRow
}

// stateRow is one (table, id, version-ish, value) tuple that entered the price.
// The state hash is the sha256 of the sorted, serialised set of these, so a
// concurrent price edit between quote and order changes the hash (P-09).
type stateRow struct {
	Kind  string
	ID    string
	Value int64
}

// canonicalInput is the deterministic serialisation of the money-relevant
// request inputs. Its sha256 is input_hash (P-09): same request ⇒ same hash.
type canonicalInput struct {
	CartID            string          `json:"cart_id"`
	DeliveryAddressID *string         `json:"delivery_address_id"`
	Fulfilment        string          `json:"fulfilment"`
	TipCents          int64           `json:"tip_cents"`
	PromoCode         *string         `json:"promo_code"`
	Lines             []canonicalLine `json:"lines"`
}

type canonicalLine struct {
	MenuItemID     string           `json:"menu_item_id"`
	VariantID      *string          `json:"variant_id"`
	Quantity       int              `json:"quantity"`
	SpecialRequest *string          `json:"special_request"`
	Addons         []canonicalAddon `json:"addons"`
}

type canonicalAddon struct {
	AddonID  string `json:"addon_id"`
	Quantity int    `json:"quantity"`
}

func hashInput(ci canonicalInput) []byte {
	// Sort lines and addons so identity is order-independent (two lines added in
	// either order hash the same).
	sort.Slice(ci.Lines, func(i, j int) bool {
		if ci.Lines[i].MenuItemID != ci.Lines[j].MenuItemID {
			return ci.Lines[i].MenuItemID < ci.Lines[j].MenuItemID
		}
		vi, vj := "", ""
		if ci.Lines[i].VariantID != nil {
			vi = *ci.Lines[i].VariantID
		}
		if ci.Lines[j].VariantID != nil {
			vj = *ci.Lines[j].VariantID
		}
		return vi < vj
	})
	for _, l := range ci.Lines {
		sort.Slice(l.Addons, func(i, j int) bool { return l.Addons[i].AddonID < l.Addons[j].AddonID })
	}
	b, _ := json.Marshal(ci)
	sum := sha256.Sum256(b)
	return sum[:]
}

func hashState(rows []stateRow) []byte {
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Kind != rows[j].Kind {
			return rows[i].Kind < rows[j].Kind
		}
		return rows[i].ID < rows[j].ID
	})
	h := sha256.New()
	for _, r := range rows {
		h.Write([]byte(r.Kind))
		h.Write([]byte(r.ID))
		var buf [8]byte
		binary.BigEndian.PutUint64(buf[:], uint64(r.Value))
		h.Write(buf[:])
	}
	return h.Sum(nil)
}

// Quote is the persisted quote row plus its lines and tax lines, in the shape
// the handlers render to the contract's Quote schema.
type Quote struct {
	ID                    string
	AccountID             string
	CartID                string
	RestaurantID          string
	DeliveryAddressID     *string
	Fulfilment            string
	Currency              string
	SubtotalCents         int64
	DiscountItemsCents    int64
	DiscountDeliveryCents int64
	DiscountServiceCents  int64
	DeliveryFeeCents      int64
	ServiceFeeCents       int64
	TaxTotalCents         int64
	TipCents              int64
	TotalCents            int64
	BillableKM            int
	RouteMeters           int
	RouteSource           string
	PromoCode             *string
	ExpiresAt             time.Time
	CreatedAt             time.Time
	Lines                 []QuoteLine
	TaxLines              []QuoteTaxLine
	Discount              *pricing.Discount
	// internal split, not returned to the customer but copied onto the order.
	CommissionCents               int64
	RestaurantNetCents            int64
	RiderEarningsCents            int64
	PlatformGrossCents            int64
	RestaurantFundedDiscountCents int64
	PlatformFundedDiscountCents   int64
	PricingConfigID               string
	TaxJurisdictionCode           string
	InputHash                     []byte
	StateHash                     []byte
}

// QuoteLine mirrors quote_line + its addons.
type QuoteLine struct {
	LineNo             int
	MenuItemID         string
	MenuItemVersionID  *string
	MenuItemName       string
	VariantID          *string
	VariantName        *string
	VariantPricingMode *string
	Quantity           int
	BasePriceCents     int64
	VariantPartCents   int64
	AddonsPartCents    int64
	LineUnitCents      int64
	LineTotalCents     int64
	SpecialRequest     *string
	TaxCategory        string
	Addons             []QuoteLineAddon
}

// QuoteLineAddon mirrors quote_line_addon.
type QuoteLineAddon struct {
	AddonID       string
	AddonName     string
	AddonQuantity int
	PriceCents    int64
}

// QuoteTaxLine mirrors quote_tax_line.
type QuoteTaxLine struct {
	Seq              int
	JurisdictionCode string
	TaxKind          string
	StatutoryLabel   string
	Rate             money.Rate
	BaseCents        int64
	AmountCents      int64
	RebateApplied    bool
	RemittableBy     string
}

// txFunc runs inside a transaction; helper to keep call sites short.
func (s *Store) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// bpsToRate converts an integer basis-point commission rate to an exact Rate.
func bpsToRate(bps int) money.Rate {
	if bps <= 0 {
		return money.Rate{Num: 0, Den: 1}
	}
	return money.Rate{Num: int64(bps), Den: 10000}
}

var _ = fmt.Sprintf
