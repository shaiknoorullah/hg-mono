package handoff

import (
	"context"
	"crypto/ed25519"
	"errors"
	"log/slog"
	"net/http"
	"time"
)

// OrderLifecycle is the seam from handoff to the orders module (P-14: orders is
// the only writer of order.state). It is the same shape internal/dispatch
// already declares for its own PICKED_UP/DELIVERED bridge, plus OpenDispute for
// the tamper-report path — kept as an interface, not a direct import, for the
// same reason dispatch's is: it keeps the dependency direction clean and lets
// tests inject a fake. cmd/hg/main.go wires one concrete adapter that satisfies
// both this interface and dispatch.OrderLifecycle.
type OrderLifecycle interface {
	// ConfirmPickup advances the order from READY_FOR_PICKUP to PICKED_UP (T12).
	ConfirmPickup(ctx context.Context, orderID, riderAccountID string) error
	// CompleteDelivery advances the order from PICKED_UP/ARRIVED to DELIVERED (T15/T16).
	CompleteDelivery(ctx context.Context, orderID, riderAccountID string) error
	// OpenDispute advances DELIVERED/COMPLETED to DISPUTED (T19), actor CUSTOMER —
	// the only actor a customer-filed tamper report can trigger this edge as.
	OpenDispute(ctx context.Context, orderID, customerAccountID, reason string) error
}

// Service is the module's use-case layer: identity/ownership checks, seal-token
// mint/verify, the store call, and — on a proof that gates one — the
// OrderLifecycle bridge call. Handlers hold a *Service and nothing else.
type Service struct {
	store     *Store
	lifecycle OrderLifecycle // nil is safe: bridge calls are skipped, logged at WARN
	priv      ed25519.PrivateKey
	pub       ed25519.PublicKey
	log       *slog.Logger
	now       func() time.Time
}

// NewService builds a Service. priv signs new seal tokens (restaurant bind);
// pub verifies scanned ones (rider pickup/delivery scans) — both are auth's
// existing P-04 Ed25519 signing key (Secrets.SigningPriv/SigningPub), reused
// rather than a second key pair minted for this module alone.
func NewService(store *Store, lifecycle OrderLifecycle, priv ed25519.PrivateKey, pub ed25519.PublicKey, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{store: store, lifecycle: lifecycle, priv: priv, pub: pub, log: log, now: func() time.Time { return time.Now().UTC() }}
}

// ---------------------------------------------------------------------------
// Seal bind (restaurant).
// ---------------------------------------------------------------------------

// BindSeal binds a physical seal to orderID for the calling restaurant staff's
// own restaurant (P-07: the restaurant scope comes from account_role, never
// from the body), mints the signed QR token, and appends the SEAL event.
func (s *Service) BindSeal(ctx context.Context, actorAccountID, orderID, sealCode string) (PackageSeal, error) {
	restaurantID, ok := s.store.RestaurantForAccount(ctx, actorAccountID)
	if !ok {
		return PackageSeal{}, newError(http.StatusForbidden, CodeSealNotFound, "You are not registered to any restaurant.", nil)
	}
	scope, err := s.store.LoadOrderScope(ctx, orderID)
	if err != nil {
		if errors.Is(err, ErrOrderNotFound) {
			return PackageSeal{}, newError(http.StatusNotFound, httpxNotFound, "No such order.", nil)
		}
		return PackageSeal{}, err
	}
	if scope.RestaurantID != restaurantID {
		// Another restaurant's order: answer as if the seal does not exist
		// rather than leaking that the order belongs to someone else (P-07).
		return PackageSeal{}, newError(http.StatusNotFound, CodeSealNotFound, "No such seal.", nil)
	}

	nonce, err := NewNonce()
	if err != nil {
		return PackageSeal{}, err
	}
	// The seal id is not known until the row is located inside the store's
	// transaction (findIssuedSealByCode), so the store mints... no: the token
	// must be signed over the *real* seal id. We resolve the seal id first in
	// a short read, then mint, then bind — a second bind attempt on a race loses
	// to the UPDATE ... WHERE status = 'ISSUED' guard exactly like every other
	// conditional-update pattern in this codebase (P-32's accept-offer race).
	sealID, err := s.resolveIssuedSealID(ctx, sealCode, restaurantID)
	if err != nil {
		return PackageSeal{}, err
	}
	token, err := MintSealToken(s.priv, SealClaims{OrderID: orderID, SealID: sealID, Nonce: nonce})
	if err != nil {
		return PackageSeal{}, err
	}

	seal, _, err := s.store.BindSeal(ctx, sealCode, orderID, restaurantID, actorAccountID, token, nonce, s.now())
	if err != nil {
		switch {
		case errors.Is(err, ErrSealNotFound):
			return PackageSeal{}, newError(http.StatusNotFound, CodeSealNotFound, "No such seal code for this restaurant.", nil)
		case errors.Is(err, ErrSealAlreadyBound):
			return PackageSeal{}, newError(http.StatusConflict, CodeSealAlreadyBound, "This seal is already bound to an order.", nil)
		default:
			return PackageSeal{}, err
		}
	}
	return seal, nil
}

// resolveIssuedSealID is a read-only lookup so BindSeal can mint a token bound
// to the real seal id before the transactional bind. It is not itself the
// authority on "is this seal bindable" — the transactional UPDATE ... WHERE
// status = 'ISSUED' in Store.BindSeal is, exactly like every other race in this
// codebase resolves via a conditional write, never a read-then-trust.
func (s *Service) resolveIssuedSealID(ctx context.Context, sealCode, restaurantID string) (string, error) {
	id, err := s.store.issuedSealID(ctx, sealCode, restaurantID)
	if err != nil {
		if errors.Is(err, ErrSealNotFound) {
			return "", newError(http.StatusNotFound, CodeSealNotFound, "No such seal code for this restaurant.", nil)
		}
		return "", err
	}
	return id, nil
}

// ---------------------------------------------------------------------------
// Pickup / delivery scans (rider).
// ---------------------------------------------------------------------------

type scanInput struct {
	QRToken       string
	SealIntact    bool
	Latitude      *float64
	Longitude     *float64
	PhotoObjectID *string
}

// PickupScan verifies the rider's QR proof and gates READY_FOR_PICKUP → PICKED_UP.
func (s *Service) PickupScan(ctx context.Context, riderAccountID, orderID string, in scanInput) (HandoffScanResult, error) {
	claims, err := s.verifyProof(ctx, riderAccountID, orderID, in)
	if err != nil {
		return HandoffScanResult{}, err
	}
	seal, event, err := s.store.PickupScan(ctx, orderID, riderAccountID, claims.Nonce, MethodQR, in.SealIntact,
		in.Latitude, in.Longitude, in.PhotoObjectID, s.now())
	if err != nil {
		return HandoffScanResult{}, translateScanErr(err)
	}
	if s.lifecycle != nil {
		if lcErr := s.lifecycle.ConfirmPickup(ctx, orderID, riderAccountID); lcErr != nil {
			return HandoffScanResult{}, translateLifecycleErr(lcErr)
		}
	}
	return HandoffScanResult{Seal: seal, Event: event, OrderState: "PICKED_UP"}, nil
}

// DeliveryScan is PickupScan's delivery-time twin, gating PICKED_UP/ARRIVED → DELIVERED.
func (s *Service) DeliveryScan(ctx context.Context, riderAccountID, orderID string, in scanInput) (HandoffScanResult, error) {
	claims, err := s.verifyProof(ctx, riderAccountID, orderID, in)
	if err != nil {
		return HandoffScanResult{}, err
	}
	seal, event, err := s.store.DeliveryScan(ctx, orderID, riderAccountID, claims.Nonce, MethodQR, in.SealIntact,
		in.Latitude, in.Longitude, in.PhotoObjectID, s.now())
	if err != nil {
		return HandoffScanResult{}, translateScanErr(err)
	}
	if s.lifecycle != nil {
		if lcErr := s.lifecycle.CompleteDelivery(ctx, orderID, riderAccountID); lcErr != nil {
			return HandoffScanResult{}, translateLifecycleErr(lcErr)
		}
	}
	return HandoffScanResult{Seal: seal, Event: event, OrderState: "DELIVERED"}, nil
}

// verifyProof runs the checks shared by both scans: the rider holds the live
// assignment for this order (P-07), the token's signature verifies, its
// order_id matches the path, and — when a photo was attached — it is a READY
// POD object scoped to this order.
func (s *Service) verifyProof(ctx context.Context, riderAccountID, orderID string, in scanInput) (SealClaims, error) {
	assigned, err := s.store.RiderAssignedToOrder(ctx, riderAccountID, orderID)
	if err != nil {
		return SealClaims{}, err
	}
	if !assigned {
		return SealClaims{}, newError(http.StatusNotFound, httpxNotFound, "No such assignment.", nil)
	}
	claims, err := VerifySealToken(s.pub, in.QRToken)
	if err != nil {
		return SealClaims{}, newError(http.StatusUnprocessableEntity, CodeSealTokenInvalid, "The scanned code could not be verified.", nil)
	}
	if claims.OrderID != orderID {
		return SealClaims{}, newError(http.StatusUnprocessableEntity, CodeSealOrderMismatch, "This seal belongs to a different order.", nil)
	}
	if in.PhotoObjectID != nil {
		ready, err := s.store.PodObjectReady(ctx, *in.PhotoObjectID, orderID)
		if err != nil {
			return SealClaims{}, err
		}
		if !ready {
			return SealClaims{}, newError(http.StatusUnprocessableEntity, CodePodRequired, "The referenced photo is not a READY proof object for this order.", nil)
		}
	}
	return claims, nil
}

// ---------------------------------------------------------------------------
// Tamper report (customer).
// ---------------------------------------------------------------------------

// TamperReport records the customer's post-delivery report and opens the
// dispute flow. It never fails the order or touches money itself — A-33/A-35
// decide that from the scan-and-photo trail this call hands over.
func (s *Service) TamperReport(ctx context.Context, customerAccountID, orderID, photoObjectID, note string) (HandoffScanResult, error) {
	scope, err := s.store.LoadOrderScope(ctx, orderID)
	if err != nil {
		if errors.Is(err, ErrOrderNotFound) {
			return HandoffScanResult{}, newError(http.StatusNotFound, httpxNotFound, "No such order.", nil)
		}
		return HandoffScanResult{}, err
	}
	if scope.AccountID != customerAccountID {
		return HandoffScanResult{}, newError(http.StatusNotFound, httpxNotFound, "No such order.", nil)
	}
	ready, err := s.store.PodObjectReady(ctx, photoObjectID, orderID)
	if err != nil {
		return HandoffScanResult{}, err
	}
	if !ready {
		return HandoffScanResult{}, newError(http.StatusUnprocessableEntity, CodePodRequired, "The referenced photo is not a READY proof object for this order.", nil)
	}

	seal, event, err := s.store.TamperReport(ctx, orderID, customerAccountID, photoObjectID, note, s.now())
	if err != nil {
		if errors.Is(err, ErrSealNotFound) {
			return HandoffScanResult{}, newError(http.StatusNotFound, CodeSealNotFound, "No seal was ever bound to this order.", nil)
		}
		return HandoffScanResult{}, err
	}
	if s.lifecycle != nil {
		if lcErr := s.lifecycle.OpenDispute(ctx, orderID, customerAccountID, "customer tamper report"); lcErr != nil {
			return HandoffScanResult{}, translateLifecycleErr(lcErr)
		}
	}
	return HandoffScanResult{Seal: seal, Event: event, OrderState: "DISPUTED"}, nil
}

func translateScanErr(err error) error {
	switch {
	case errors.Is(err, ErrSealNotFound):
		return newError(http.StatusNotFound, CodeSealNotFound, "No seal is bound to this order.", nil)
	case errors.Is(err, ErrNonceReplayed):
		return newError(http.StatusUnprocessableEntity, CodeSealNonceReplayed, "This code was already used for this step.", nil)
	default:
		return err
	}
}

// translateLifecycleErr renders an OrderLifecycle rejection (the order was not
// in the state the transition table requires) as the same 409
// ILLEGAL_TRANSITION shape the rest of the API uses. This package deliberately
// does not import orders' concrete error type (the interface seam, mirroring
// dispatch's), so the mapping is necessarily generic — the detail string still
// carries the underlying reason for the log/response.
func translateLifecycleErr(err error) error {
	return newError(http.StatusConflict, CodeIllegalTransition,
		"The order is not in a state that allows this step.", map[string]any{"detail": err.Error()})
}
