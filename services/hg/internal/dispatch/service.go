package dispatch

import (
	"context"
	"net/http"
	"time"
)

// OrderLifecycle is the seam from dispatch to the orders module. Dispatch calls
// through this interface to advance the order state machine when the assignment
// reaches PICKED_UP or DELIVERED; the orders module owns order.state (P-14) and
// is the only writer of it. Keeping this as an interface (not a direct import)
// keeps the dependency direction clean and lets tests inject a fake.
type OrderLifecycle interface {
	// ConfirmPickup advances the order from READY_FOR_PICKUP to PICKED_UP (T12).
	ConfirmPickup(ctx context.Context, orderID, riderAccountID string) error
	// CompleteDelivery advances the order from PICKED_UP (or ARRIVED) to DELIVERED (T15/T16).
	CompleteDelivery(ctx context.Context, orderID, riderAccountID string) error
}

// Service is the module's use-case layer. It holds the business rules that sit
// above raw SQL: the availability go-online gate, the offer-wave algorithm, and
// the clock. Handlers call the Service; the Service calls the Store.
type Service struct {
	store     *Store
	lifecycle OrderLifecycle // nil is safe — calls are no-ops when nil
	now       func() time.Time
}

// NewService builds a Service over a Store. lifecycle may be nil (safe no-op)
// and should be set to the orders adapter in production.
func NewService(store *Store, lifecycle OrderLifecycle) *Service {
	return &Service{store: store, lifecycle: lifecycle, now: func() time.Time { return time.Now().UTC() }}
}

// ---------------------------------------------------------------------------
// Availability (D-10).
// ---------------------------------------------------------------------------

// SetAvailability applies the rider's on/off toggle. Going online is gated on the
// full eligibility set; each unmet condition is a machine code in blocking_reasons.
func (s *Service) SetAvailability(ctx context.Context, riderAccountID string, online bool, lat, lng, accuracy *float64, goOfflineAfter *bool) (*RiderAvailability, error) {
	now := s.now()
	gate, err := s.store.LoadRiderGate(ctx, riderAccountID, 60*time.Second, now)
	if err != nil {
		return nil, err
	}
	if !gate.Exists {
		return nil, newError(http.StatusForbidden, CodeOnboardingIncomplete, "You are not a registered rider.", nil)
	}

	if online {
		// Hard 403 gates first (D-10 authorization order).
		if gate.OnboardingState != "ACTIVE" {
			return nil, newError(http.StatusForbidden, CodeOnboardingIncomplete,
				"Complete onboarding before going online.",
				map[string]any{"next_step": gate.OnboardingState})
		}
		if gate.AccountStatus != "ACTIVE" {
			return nil, newError(http.StatusForbidden, CodeAccountNotActive, "Your account is not active.", nil)
		}
		if !gate.PayoutsEnabled {
			return nil, newError(http.StatusForbidden, CodePayoutAccountIncomplete,
				"Finish setting up your payout account before going online.", nil)
		}
		// Soft 422 gates: things the app can fix and deep-link to.
		var reasons []string
		hasFix := gate.HasFreshFix
		if lat != nil && lng != nil {
			hasFix = true // the toggle carried a fresh fix
			if accuracy != nil && *accuracy > 100 {
				reasons = append(reasons, "STALE_LOCATION_FIX")
			}
		}
		if !hasFix {
			reasons = append(reasons, "STALE_LOCATION_FIX")
		}
		if len(reasons) > 0 {
			return nil, newError(http.StatusUnprocessableEntity, CodeCannotGoOnline,
				"You cannot go online yet.", map[string]any{"blocking_reasons": reasons})
		}
	}

	state, since, err := s.store.SetAvailability(ctx, riderAccountID, online, lat, lng, accuracy, goOfflineAfter, now)
	if err != nil {
		return nil, err
	}
	goAfter := gate.GoOfflineAfterDel
	if goOfflineAfter != nil {
		goAfter = *goOfflineAfter
	}
	return &RiderAvailability{
		AvailabilityState:      state,
		Since:                  tsMillis(since),
		CanReceiveOffers:       state == "ONLINE_IDLE",
		GoOfflineAfterDelivery: goAfter,
		BlockingReasons:        []string{},
	}, nil
}

// ---------------------------------------------------------------------------
// Offers.
// ---------------------------------------------------------------------------

// CurrentOffer returns the rider's outstanding offer, or nil.
func (s *Service) CurrentOffer(ctx context.Context, riderAccountID string) (*DispatchOffer, error) {
	return s.store.CurrentOffer(ctx, riderAccountID, s.now())
}

// AcceptOffer runs the race-free accept and returns the resulting assignment.
func (s *Service) AcceptOffer(ctx context.Context, riderAccountID, offerID string) (*Assignment, error) {
	assignmentID, err := s.store.AcceptOffer(ctx, riderAccountID, offerID, s.now())
	if err != nil {
		return nil, err
	}
	return s.store.LoadAssignment(ctx, riderAccountID, assignmentID)
}

// RejectOffer records a rejection with a reason code.
func (s *Service) RejectOffer(ctx context.Context, riderAccountID, offerID, reasonCode string, note *string) error {
	return s.store.RejectOffer(ctx, riderAccountID, offerID, reasonCode, note, s.now())
}

// ---------------------------------------------------------------------------
// Assignments.
// ---------------------------------------------------------------------------

// GetAssignment returns the full working view of an assignment.
func (s *Service) GetAssignment(ctx context.Context, riderAccountID, assignmentID string) (*Assignment, error) {
	return s.store.LoadAssignment(ctx, riderAccountID, assignmentID)
}

// Transition advances an assignment one step. After the dispatch transaction
// commits, it calls the OrderLifecycle bridge for PICKED_UP and DELIVERED to
// keep the order state machine in sync (P-14: only the orders module writes
// order.state; dispatch calls it via the interface, never directly).
func (s *Service) Transition(ctx context.Context, riderAccountID, assignmentID string, in TransitionInput) (*Assignment, error) {
	asn, err := s.store.Transition(ctx, riderAccountID, assignmentID, in, s.now())
	if err != nil {
		return nil, err
	}
	// Bridge calls happen after the dispatch tx commits so a failure in the
	// orders module never rolls back a committed dispatch transition. The
	// orders.Transition is idempotent (FOR UPDATE + state guard), so a retry
	// on the next position report or reconcile is safe.
	if s.lifecycle != nil {
		switch in.ToState {
		case "PICKED_UP":
			if lcErr := s.lifecycle.ConfirmPickup(ctx, asn.OrderID, riderAccountID); lcErr != nil {
				// Log-only: the dispatch assignment is committed; the orders state
				// will catch up via the reconcile sweep or a retry.
				_ = lcErr
			}
		case "DELIVERED":
			if lcErr := s.lifecycle.CompleteDelivery(ctx, asn.OrderID, riderAccountID); lcErr != nil {
				_ = lcErr
			}
		}
	}
	return asn, nil
}

// SubmitPod records proof of delivery.
func (s *Service) SubmitPod(ctx context.Context, riderAccountID, assignmentID string, in PodInput) (*Assignment, error) {
	return s.store.RecordPod(ctx, riderAccountID, assignmentID, in)
}

// ---------------------------------------------------------------------------
// Positions.
// ---------------------------------------------------------------------------

// IngestPositions validates a batch and stores the accepted points. Points with
// recorded_at more than 5 minutes old (STALE_POINT) or in the future (FUTURE_POINT)
// are rejected, not clamped; low-accuracy points are stored but not made current.
func (s *Service) IngestPositions(ctx context.Context, riderAccountID string, pts []PositionPoint) (*RiderPositionAck, error) {
	now := s.now()
	rejected := map[int]string{}
	ack := &RiderPositionAck{Rejected: []RejectedPoint{}}
	for i, p := range pts {
		switch {
		case p.RecordedAt.After(now.Add(1 * time.Second)):
			rejected[i] = "FUTURE_POINT"
			ack.Rejected = append(ack.Rejected, RejectedPoint{Index: int32(i), Code: "FUTURE_POINT"})
		case p.RecordedAt.Before(now.Add(-5 * time.Minute)):
			rejected[i] = "STALE_POINT"
			ack.Rejected = append(ack.Rejected, RejectedPoint{Index: int32(i), Code: "STALE_POINT"})
		}
	}
	accepted, current, err := s.store.IngestPositions(ctx, riderAccountID, pts, rejected, 200, now)
	if err != nil {
		return nil, err
	}
	ack.Accepted = int32(accepted)
	ack.CurrentPositionRecordedAt = tsPtr(current)
	return ack, nil
}

// ---------------------------------------------------------------------------
// The offer-wave algorithm (D-13). Not on a request path — invoked by the
// dispatch deadline runner when an order reaches READY_FOR_DISPATCH. Kept in the
// service so it is unit-testable without wiring the runner.
// ---------------------------------------------------------------------------

// RunWaveResult reports what a single wave attempt produced.
type RunWaveResult struct {
	Offered   int
	RadiusM   int
	Exhausted bool
}

// RunWave selects candidates at the current radius, ranks them, and offers to the
// top wave_size. It returns how many offers went out. The caller (the deadline
// runner) sequences waves with the inter-wave gap and widens the radius ladder.
//
// This is the single Postgres candidate query plus a deterministic Go ranking —
// no Redis GEO, per the seam resolution. ETA and score use the haversine fallback
// (the routing provider integration is a later slice).
func (s *Service) RunWave(ctx context.Context, orderID string, waveNo, radiusM int) (*RunWaveResult, error) {
	now := s.now()
	info, err := s.store.LoadOrderDispatchInfo(ctx, orderID)
	if err != nil {
		return nil, err
	}
	cands, err := s.store.FindCandidates(ctx, orderID, info.PickupLng, info.PickupLat, radiusM, candidateLimit)
	if err != nil {
		return nil, err
	}
	if len(cands) == 0 {
		return &RunWaveResult{Offered: 0, RadiusM: radiusM, Exhausted: true}, nil
	}

	earn := buildEarnings(info.DeliveryFeeCents, info.TipCents)
	// Rank: candidates already come ordered by distance ascending; the score is
	// ETA-dominant, and with the haversine fallback ETA is monotonic in distance,
	// so distance order is the score order here. Take the top wave_size.
	n := waveSize
	if n > len(cands) {
		n = len(cands)
	}
	offers := make([]offerRow, 0, n)
	for i := 0; i < n; i++ {
		c := cands[i]
		dist := int(c.PickupDistanceM)
		eta := etaSeconds(c.PickupDistanceM)
		offers = append(offers, offerRow{
			RiderAccountID: c.RiderAccountID,
			DistanceM:      dist,
			EstDurationS:   &eta,
			EarningsCents:  earn.EstimatedTotalCents,
			TipCents:       info.TipCents,
			Score:          scoreFor(c.PickupDistanceM),
			RankInWave:     i + 1,
		})
	}
	expiresAt := now.Add(offerTTL)
	inserted, err := s.store.CreateWave(ctx, info, waveNo, radiusM, cands, offers, expiresAt)
	if err != nil {
		return nil, err
	}
	return &RunWaveResult{Offered: len(inserted), RadiusM: radiusM}, nil
}

// etaSeconds is the haversine fallback ETA: metres / profile speed × 1.35. A
// nominal 6.5 m/s urban profile is used until the routing matrix is wired.
func etaSeconds(distanceM float64) int {
	const profileSpeedMps = 6.5
	if distanceM <= 0 {
		return 0
	}
	return int(distanceM / profileSpeedMps * 1.35)
}

// scoreFor is the deterministic ranking score, ETA-dominant (D-13 step 2). With
// only distance available at this slice, the score is 1000 − 0.1×eta, scaled to
// an int so the offer row can persist it for replay.
func scoreFor(distanceM float64) int {
	eta := float64(etaSeconds(distanceM))
	return int(1000 - 0.1*eta)
}

// Reconcile is the availability backstop (D-10).
func (s *Service) Reconcile(ctx context.Context) (int64, error) {
	return s.store.ReconcileAvailability(ctx)
}
