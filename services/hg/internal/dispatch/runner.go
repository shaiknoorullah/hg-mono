package dispatch

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"
)

// DispatchRunner is the backstop sweep that ensures every READY_FOR_PICKUP order
// with no dispatch row yet gets its first offer wave. It ticks every ~5 s, finds
// orders that are ready but have not been dispatched yet, and calls
// Service.RunWave(orderID, 1, initialRadiusM) for each one.
//
// This is the "backstop sweep" referenced in the dispatch doc.go and is the
// mechanism that drives the demo path: a restaurant marking an order READY will
// cause this runner to create the first wave within one tick interval.
//
// Two replicas may run it safely. Both may sweep the same new ready order, but
// the dispatch row it creates is the arbiter: the second replica's first wave
// finds it already run (CreateWave, errWaveNotOpen) and does nothing. A due
// search is claimed under the dispatch row's lease (ClaimWavesToEscalate), so
// only one replica runs its next wave or ends it.
type DispatchRunner struct {
	svc           *Service
	log           *slog.Logger
	tick          time.Duration
	initialRadius int
	owner         string // this replica, in dispatch.lease_owner
}

// NewDispatchRunner builds a DispatchRunner. initialRadius is the first-wave
// search radius in metres (typically 3000). tick is the sweep interval.
func NewDispatchRunner(svc *Service, log *slog.Logger, initialRadius int, tick time.Duration) *DispatchRunner {
	if tick <= 0 {
		tick = 5 * time.Second
	}
	if initialRadius <= 0 {
		initialRadius = radiusLadderM[0] // 3000 m
	}
	return &DispatchRunner{svc: svc, log: log, tick: tick, initialRadius: initialRadius, owner: leaseOwner()}
}

// leaseOwner names this replica in dispatch.lease_owner: the host, the process
// and a random suffix, so two runners never share a name.
func leaseOwner() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "hg"
	}
	var b [4]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("dispatch:%s:%d:%s", host, os.Getpid(), hex.EncodeToString(b[:]))
}

// Run loops until ctx is cancelled, sweeping for unDispatched ready orders each
// tick.
func (r *DispatchRunner) Run(ctx context.Context) {
	t := time.NewTicker(r.tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			n, err := r.Sweep(ctx)
			if err != nil {
				r.log.Warn("dispatch sweep failed", slog.String("error", err.Error()))
			} else if n > 0 {
				r.log.Info("dispatch sweep: launched first waves", slog.Int("orders", n))
			}
			if err := r.EscalateAndExpire(ctx); err != nil {
				r.log.Warn("dispatch escalation failed", slog.String("error", err.Error()))
			}
		}
	}
}

// Sweep finds orders in READY_FOR_PICKUP with no dispatch row and runs the first
// offer wave for each. Returns the number of orders for which a wave was started.
// A first wave that finds nobody is still started: it creates the dispatch row,
// and escalation widens the search from there
// (https://github.com/shaiknoorullah/hg-mono/issues/294).
func (r *DispatchRunner) Sweep(ctx context.Context) (int, error) {
	orders, err := r.svc.store.FindUndispatchedReadyOrders(ctx)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, orderID := range orders {
		_, waveErr := r.svc.RunWave(ctx, orderID, 1, r.initialRadius)
		if errors.Is(waveErr, errWaveNotOpen) {
			continue // another replica started this order's search first
		}
		if waveErr != nil {
			r.log.Warn("dispatch runner: RunWave failed",
				slog.String("order_id", orderID),
				slog.String("error", waveErr.Error()))
			continue
		}
		count++
	}
	return count, nil
}

// EscalateAndExpire is the wave-sequencing half of the runner (D-15): it expires
// offers whose TTL has passed, advances every order whose wave has lapsed to the
// next wave (widening the radius ladder, giving up at the wave/time budget with
// NO_RIDER_FOUND), and forces unresponsive riders offline. Called every tick.
func (r *DispatchRunner) EscalateAndExpire(ctx context.Context) error {
	now := r.svc.now()

	// 1. Expire lapsed PENDING offers so they are excluded from the next wave and
	//    counted toward the unresponsive streak.
	if _, err := r.svc.store.ExpireDueOffers(ctx, now); err != nil {
		return err
	}

	// 2. Advance every order whose wave has lapsed (offer TTL + inter-wave gap),
	//    holding each under this replica's lease.
	due, err := r.svc.store.ClaimWavesToEscalate(ctx, now, interWaveGap, r.owner)
	if err != nil {
		return err
	}
	for _, d := range due {
		if d.RoundWaves >= maxWaves || time.Duration(d.ElapsedS)*time.Second >= maxTotalSearch {
			if err := r.svc.store.MarkNoRiderFound(ctx, d.OrderID); err != nil {
				r.log.Warn("dispatch: mark no-rider-found failed",
					slog.String("order_id", d.OrderID), slog.String("error", err.Error()))
			}
			continue
		}
		r.escalateOne(ctx, d)
	}

	// 3. Force riders with three consecutive expired offers offline (UNRESPONSIVE).
	if n, err := r.svc.store.SweepUnresponsiveRiders(ctx); err != nil {
		return err
	} else if n > 0 {
		r.log.Info("dispatch: riders auto-offlined for unresponsiveness", slog.Int64("riders", n))
	}
	return nil
}

// escalateOne runs the next wave for a single lapsed order. The wave number is
// the escalation round; the radius ladder widens across rounds and within one:
//
//   - after a wave that found nobody, the next searches one rung wider (staying
//     on the widest): "Given zero candidates at 3 km, When the wave completes,
//     Then the next wave uses radius 6 km" (docs/spec/04-rider.md, "D-13 —
//     Dispatch: candidate selection, ranking and offer waves", acceptance
//     criterion 5);
//   - after a wave whose riders let it lapse, the next searches the same radius
//     for the next riders, widening at once while a radius has nobody left
//     (step 3 of the same section).
//
// A wave that finds nobody is written empty and holds the search, so a rider
// who comes online meanwhile is found by the next one. The search ends in
// NO_RIDER_FOUND only at the wave or time budget (EscalateAndExpire), never
// because one pass found nobody (https://github.com/shaiknoorullah/hg-mono/issues/294).
func (r *DispatchRunner) escalateOne(ctx context.Context, d waveToEscalate) {
	_, err := r.svc.runWave(ctx, d.OrderID, d.Wave+1, nextWaveRadii(d.RadiusM, d.LastWaveEmpty))
	if errors.Is(err, errWaveNotOpen) {
		return // the wave was run, or the search ended, under another replica
	}
	if err != nil {
		r.log.Warn("dispatch: escalation RunWave failed",
			slog.String("order_id", d.OrderID), slog.String("error", err.Error()))
	}
}

// nextWaveRadii is the radii the wave after one at radiusM searches, nearest
// first (escalateOne): one rung wider after an empty wave, else radiusM and
// every wider rung of the ladder.
func nextWaveRadii(radiusM int, lastWaveEmpty bool) []int {
	var wider []int
	for _, r := range radiusLadderM {
		if r > radiusM {
			wider = append(wider, r)
		}
	}
	if lastWaveEmpty {
		if len(wider) == 0 {
			return []int{radiusM}
		}
		return wider[:1]
	}
	return append([]int{radiusM}, wider...)
}
