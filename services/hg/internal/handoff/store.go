package handoff

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors the service layer maps to contract error codes. Kept as
// sentinels (not *serviceError here) so the store package stays free of HTTP
// concerns — the handler/service boundary owns status codes, per the pattern
// files and orders already use.
var (
	ErrSealNotFound     = errors.New("handoff: seal not found")
	ErrSealAlreadyBound = errors.New("handoff: seal already bound")
	ErrNonceReplayed    = errors.New("handoff: nonce already used for this proof")
	ErrOrderNotFound    = errors.New("handoff: order not found")
)

// Store is the handoff module's data access. It takes the shared pgx pool, per
// the "modules call each other as functions, packages share one pool" rule —
// it never opens its own.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore wraps a pgx pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func inTx(ctx context.Context, pool *pgxpool.Pool, fn func(tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// RestaurantForAccount returns the restaurant id the account is scoped to via
// an account_role RESTAURANT grant, or ("", false) when none exists. Identical
// query to restaurant.Repo.RestaurantForAccount — kept local rather than
// imported so this module does not depend on the restaurant sibling for one
// read (P-07 ownership resolution belongs beside the module that needs it).
func (s *Store) RestaurantForAccount(ctx context.Context, accountID string) (string, bool) {
	if accountID == "" {
		return "", false
	}
	const q = `
		SELECT scope_id::text
		  FROM account_role
		 WHERE account_id = $1::uuid
		   AND scope_type = 'RESTAURANT'
		   AND role::text = ANY($2)
		   AND revoked_at IS NULL
		   AND scope_id IS NOT NULL
		 ORDER BY granted_at ASC, id ASC
		 LIMIT 1`
	restaurantRoles := []string{"RESTAURANT_OWNER", "RESTAURANT_MANAGER", "RESTAURANT_STAFF"}
	var id string
	if err := s.pool.QueryRow(ctx, q, accountID, restaurantRoles).Scan(&id); err != nil {
		return "", false
	}
	return id, true
}

// OrderScope is the subset of "order" every handoff proof needs to check
// ownership and mint/verify against, without importing the orders module.
type OrderScope struct {
	RestaurantID string
	AccountID    string // the customer
}

// LoadOrderScope reads the order's owning restaurant and customer account.
func (s *Store) LoadOrderScope(ctx context.Context, orderID string) (OrderScope, error) {
	var sc OrderScope
	err := s.pool.QueryRow(ctx, `SELECT restaurant_id::text, account_id::text FROM "order" WHERE id = $1`, orderID).
		Scan(&sc.RestaurantID, &sc.AccountID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sc, ErrOrderNotFound
	}
	if err != nil {
		return sc, fmt.Errorf("handoff: load order scope: %w", err)
	}
	return sc, nil
}

// RiderAssignedToOrder reports whether riderAccountID holds the live (not yet
// terminated) dispatch assignment for orderID — the ownership predicate for
// pickup-scan/delivery-scan pushed into SQL (P-07), never trusted from the body.
func (s *Store) RiderAssignedToOrder(ctx context.Context, riderAccountID, orderID string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
		  SELECT 1 FROM assignment
		   WHERE order_id = $1 AND rider_account_id = $2 AND terminated_at IS NULL)`,
		orderID, riderAccountID).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("handoff: check rider assignment: %w", err)
	}
	return ok, nil
}

// PodObjectReady reports whether objectID is a READY, POD-purpose stored_object
// scoped to orderID and uploaded by uploaderID, the account attaching it — the
// same check dispatch.RecordPod uses for proof of delivery, reused here because
// migration 00027 deliberately did not add a HANDOFF-specific bucket/purpose
// ("reuse the stored_object shape"). A photo someone else took is never
// attached as this account's evidence
// (https://github.com/shaiknoorullah/hg-mono/issues/359).
func (s *Store) PodObjectReady(ctx context.Context, objectID, orderID, uploaderID string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
		  SELECT 1 FROM stored_object
		   WHERE id = $1 AND state = 'READY' AND purpose = 'POD' AND order_id = $2
		     AND uploaded_by = $3 AND deleted_at IS NULL)`,
		objectID, orderID, uploaderID).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("handoff: check pod object: %w", err)
	}
	return ok, nil
}

// sealRow is the internal scan target for a package_seal row.
type sealRow struct {
	id                 string
	sealCode           string
	orderID            *string
	restaurantID       string
	status             string
	signedToken        *string
	boundAt            *time.Time
	pickupVerifiedAt   *time.Time
	deliveryVerifiedAt *time.Time
	createdAt          time.Time
	updatedAt          time.Time
}

func (r sealRow) toDTO() PackageSeal {
	return PackageSeal{
		ID:                 r.id,
		SealCode:           r.sealCode,
		OrderID:            r.orderID,
		RestaurantID:       r.restaurantID,
		Status:             r.status,
		QRToken:            r.signedToken,
		BoundAt:            tsPtr(r.boundAt),
		PickupVerifiedAt:   tsPtr(r.pickupVerifiedAt),
		DeliveryVerifiedAt: tsPtr(r.deliveryVerifiedAt),
		CreatedAt:          ts(r.createdAt),
		UpdatedAt:          ts(r.updatedAt),
	}
}

const sealColumns = `id::text, seal_code, order_id::text, restaurant_id::text, status::text,
	signed_token, bound_at, pickup_verified_at, delivery_verified_at, created_at, updated_at`

func scanSealRow(row pgx.Row) (sealRow, error) {
	var s sealRow
	err := row.Scan(&s.id, &s.sealCode, &s.orderID, &s.restaurantID, &s.status,
		&s.signedToken, &s.boundAt, &s.pickupVerifiedAt, &s.deliveryVerifiedAt, &s.createdAt, &s.updatedAt)
	return s, err
}

// FindIssuedSealByCode locks and returns an ISSUED seal owned by restaurantID
// with the given seal_code, or ErrSealNotFound.
func (s *Store) findIssuedSealByCode(ctx context.Context, tx pgx.Tx, sealCode, restaurantID string) (sealRow, error) {
	row := tx.QueryRow(ctx, `
		SELECT `+sealColumns+`
		  FROM package_seal
		 WHERE seal_code = $1 AND restaurant_id = $2 AND status = 'ISSUED'
		   FOR UPDATE`,
		sealCode, restaurantID)
	sr, err := scanSealRow(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return sr, ErrSealNotFound
	}
	if err != nil {
		return sr, fmt.Errorf("handoff: find issued seal: %w", err)
	}
	return sr, nil
}

// issuedSealID is a plain (untransacted, unlocked) lookup of an ISSUED seal's
// id, used only to mint a token bound to the real seal id before the
// transactional bind. It is not the authority on bindability — Store.BindSeal's
// UPDATE ... WHERE status = 'ISSUED' is — so a race here just costs a wasted
// mint, never a wrongly-bound seal.
func (s *Store) issuedSealID(ctx context.Context, sealCode, restaurantID string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		SELECT id::text FROM package_seal
		 WHERE seal_code = $1 AND restaurant_id = $2 AND status = 'ISSUED'`,
		sealCode, restaurantID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrSealNotFound
	}
	if err != nil {
		return "", fmt.Errorf("handoff: issued seal id: %w", err)
	}
	return id, nil
}

// BindSeal binds sealID to orderID with a freshly minted signed token, inside
// its own transaction, and appends the SEAL handoff_event. It returns
// ErrSealAlreadyBound if a concurrent bind won the race (the WHERE status =
// 'ISSUED' guard on the UPDATE, or the package_seal_order unique index if this
// order already carries a different seal).
func (s *Store) BindSeal(ctx context.Context, sealCode, orderID, restaurantID, actorAccountID, token, nonce string, now time.Time) (PackageSeal, HandoffEvent, error) {
	var seal PackageSeal
	var event HandoffEvent
	err := inTx(ctx, s.pool, func(tx pgx.Tx) error {
		sr, err := s.findIssuedSealByCode(ctx, tx, sealCode, restaurantID)
		if err != nil {
			return err
		}
		row := tx.QueryRow(ctx, `
			UPDATE package_seal
			   SET order_id = $2, signed_token = $3, status = 'BOUND', bound_at = $4
			 WHERE id = $1 AND status = 'ISSUED'
			 RETURNING `+sealColumns,
			sr.id, orderID, token, now)
		updated, err := scanSealRow(row)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrSealAlreadyBound
		}
		if err != nil {
			if isUniqueViolation(err) {
				return ErrSealAlreadyBound
			}
			return fmt.Errorf("handoff: bind seal: %w", err)
		}
		seal = updated.toDTO()

		ev, err := insertEvent(ctx, tx, insertEventInput{
			OrderID:        orderID,
			SealID:         &updated.id,
			Type:           EventSeal,
			Actor:          ActorRestaurant,
			ActorAccountID: &actorAccountID,
			Method:         MethodQR,
			Nonce:          &nonce,
			At:             now,
		})
		if err != nil {
			return err
		}
		event = ev
		return nil
	})
	return seal, event, err
}

// FindSealByOrder returns the (possibly not-yet-bound-to-this-order — callers
// pass an order id, so absence means no seal has ever been bound here) seal row
// for orderID, locked FOR UPDATE for the scan handlers' read-verify-write.
func (s *Store) findSealByOrder(ctx context.Context, tx pgx.Tx, orderID string) (sealRow, error) {
	row := tx.QueryRow(ctx, `
		SELECT `+sealColumns+`
		  FROM package_seal
		 WHERE order_id = $1
		   FOR UPDATE`,
		orderID)
	sr, err := scanSealRow(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return sr, ErrSealNotFound
	}
	if err != nil {
		return sr, fmt.Errorf("handoff: find seal by order: %w", err)
	}
	return sr, nil
}

type insertEventInput struct {
	OrderID        string
	SealID         *string
	Type           string
	Actor          string
	ActorAccountID *string
	Method         string
	Nonce          *string
	SealIntact     *bool
	Latitude       *float64
	Longitude      *float64
	PhotoObjectID  *string
	Note           *string
	At             time.Time
}

func insertEvent(ctx context.Context, tx pgx.Tx, in insertEventInput) (HandoffEvent, error) {
	var ev HandoffEvent
	var geo any
	if in.Latitude != nil && in.Longitude != nil {
		geo = fmt.Sprintf("SRID=4326;POINT(%f %f)", *in.Longitude, *in.Latitude)
	}
	row := tx.QueryRow(ctx, `
		INSERT INTO handoff_event
		  (order_id, seal_id, type, actor, actor_account_id, method, nonce,
		   seal_intact, geo, photo_object_id, note, at)
		VALUES
		  ($1, $2, $3::handoff_event_type, $4::handoff_actor, $5, $6::handoff_method, $7,
		   $8, ST_GeogFromText($9), $10, $11, $12)
		RETURNING id::text, order_id::text, seal_id::text, type::text, actor::text,
		          actor_account_id::text, method::text, seal_intact,
		          ST_Y(geo::geometry), ST_X(geo::geometry), photo_object_id::text, note, at`,
		in.OrderID, in.SealID, in.Type, in.Actor, in.ActorAccountID, in.Method, in.Nonce,
		in.SealIntact, geo, in.PhotoObjectID, in.Note, in.At)

	var lat, lng *float64
	var at time.Time
	err := row.Scan(&ev.ID, &ev.OrderID, &ev.SealID, &ev.Type, &ev.Actor,
		&ev.ActorAccountID, &ev.Method, &ev.SealIntact, &lat, &lng, &ev.PhotoObjectID, &ev.Note, &at)
	if err != nil {
		if isUniqueViolation(err) {
			return ev, ErrNonceReplayed
		}
		return ev, fmt.Errorf("handoff: insert event: %w", err)
	}
	ev.Latitude, ev.Longitude = lat, lng
	ev.At = ts(at)
	return ev, nil
}

// applyPickupVerification updates the seal after a pickup-scan: status becomes
// PICKUP_VERIFIED when the seal was reported intact, or TAMPER_REPORTED
// otherwise — identity still succeeded (the rider scanned the right seal), so
// the caller still advances the order; only the integrity signal differs.
func (s *Store) applyPickupVerification(ctx context.Context, tx pgx.Tx, sealID string, intact bool, now time.Time) (PackageSeal, error) {
	status := StatusPickupVerified
	if !intact {
		status = StatusTamperReported
	}
	row := tx.QueryRow(ctx, `
		UPDATE package_seal
		   SET status = $2, pickup_verified_at = $3
		 WHERE id = $1
		 RETURNING `+sealColumns,
		sealID, status, now)
	sr, err := scanSealRow(row)
	if err != nil {
		return PackageSeal{}, fmt.Errorf("handoff: apply pickup verification: %w", err)
	}
	return sr.toDTO(), nil
}

// applyDeliveryVerification is applyPickupVerification's delivery-time twin.
func (s *Store) applyDeliveryVerification(ctx context.Context, tx pgx.Tx, sealID string, intact bool, now time.Time) (PackageSeal, error) {
	status := StatusDeliveryVerified
	if !intact {
		status = StatusTamperReported
	}
	row := tx.QueryRow(ctx, `
		UPDATE package_seal
		   SET status = $2, delivery_verified_at = $3
		 WHERE id = $1
		 RETURNING `+sealColumns,
		sealID, status, now)
	sr, err := scanSealRow(row)
	if err != nil {
		return PackageSeal{}, fmt.Errorf("handoff: apply delivery verification: %w", err)
	}
	return sr.toDTO(), nil
}

// markTampered flips the seal to TAMPER_REPORTED for a customer-filed report,
// leaving the verified-at timestamps untouched (the scans genuinely happened;
// only the customer's later inspection is new evidence).
func (s *Store) markTampered(ctx context.Context, tx pgx.Tx, sealID string) (PackageSeal, error) {
	row := tx.QueryRow(ctx, `
		UPDATE package_seal
		   SET status = 'TAMPER_REPORTED'
		 WHERE id = $1
		 RETURNING `+sealColumns,
		sealID)
	sr, err := scanSealRow(row)
	if err != nil {
		return PackageSeal{}, fmt.Errorf("handoff: mark tampered: %w", err)
	}
	return sr.toDTO(), nil
}

// PickupScan runs the full pickup-scan write (seal update + event insert) in
// one transaction. It does not itself advance order.state — the caller invokes
// OrderLifecycle.ConfirmPickup after this commits (see service.go).
func (s *Store) PickupScan(ctx context.Context, orderID, riderAccountID, nonce, method string, intact bool, lat, lng *float64, photoObjectID *string, now time.Time) (PackageSeal, HandoffEvent, error) {
	var seal PackageSeal
	var event HandoffEvent
	err := inTx(ctx, s.pool, func(tx pgx.Tx) error {
		sr, err := s.findSealByOrder(ctx, tx, orderID)
		if err != nil {
			return err
		}
		scoped := eventNonce(nonce, EventPickup)
		ev, err := insertEvent(ctx, tx, insertEventInput{
			OrderID: orderID, SealID: &sr.id, Type: EventPickup, Actor: ActorRider,
			ActorAccountID: &riderAccountID, Method: method, Nonce: &scoped,
			SealIntact: &intact, Latitude: lat, Longitude: lng, PhotoObjectID: photoObjectID, At: now,
		})
		if err != nil {
			return err
		}
		updated, err := s.applyPickupVerification(ctx, tx, sr.id, intact, now)
		if err != nil {
			return err
		}
		seal, event = updated, ev
		return nil
	})
	return seal, event, err
}

// DeliveryScan is PickupScan's delivery-time twin.
func (s *Store) DeliveryScan(ctx context.Context, orderID, riderAccountID, nonce, method string, intact bool, lat, lng *float64, photoObjectID *string, now time.Time) (PackageSeal, HandoffEvent, error) {
	var seal PackageSeal
	var event HandoffEvent
	err := inTx(ctx, s.pool, func(tx pgx.Tx) error {
		sr, err := s.findSealByOrder(ctx, tx, orderID)
		if err != nil {
			return err
		}
		scoped := eventNonce(nonce, EventDelivery)
		ev, err := insertEvent(ctx, tx, insertEventInput{
			OrderID: orderID, SealID: &sr.id, Type: EventDelivery, Actor: ActorRider,
			ActorAccountID: &riderAccountID, Method: method, Nonce: &scoped,
			SealIntact: &intact, Latitude: lat, Longitude: lng, PhotoObjectID: photoObjectID, At: now,
		})
		if err != nil {
			return err
		}
		updated, err := s.applyDeliveryVerification(ctx, tx, sr.id, intact, now)
		if err != nil {
			return err
		}
		seal, event = updated, ev
		return nil
	})
	return seal, event, err
}

// TamperReport records the customer's post-delivery tamper report: a PHOTO
// event, no nonce (not a QR proof), and the seal flipped to TAMPER_REPORTED.
func (s *Store) TamperReport(ctx context.Context, orderID, customerAccountID, photoObjectID, note string, now time.Time) (PackageSeal, HandoffEvent, error) {
	var seal PackageSeal
	var event HandoffEvent
	err := inTx(ctx, s.pool, func(tx pgx.Tx) error {
		sr, err := s.findSealByOrder(ctx, tx, orderID)
		if err != nil {
			return err
		}
		ev, err := insertEvent(ctx, tx, insertEventInput{
			OrderID: orderID, SealID: &sr.id, Type: EventTamper, Actor: ActorCustomer,
			ActorAccountID: &customerAccountID, Method: MethodPhoto,
			PhotoObjectID: &photoObjectID, Note: &note, At: now,
		})
		if err != nil {
			return err
		}
		updated, err := s.markTampered(ctx, tx, sr.id)
		if err != nil {
			return err
		}
		seal, event = updated, ev
		return nil
	})
	return seal, event, err
}

func ts(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

func tsPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := ts(*t)
	return &s
}
