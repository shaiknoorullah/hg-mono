package dispatch

import (
	"context"
	"log/slog"
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
// Two replicas may run it safely: the ORDER-level FOR UPDATE SKIP LOCKED in the
// claim query means each row is claimed by at most one replica per sweep. A
// second CreateWave for the same (order, wave_no) would hit the unique index
// on (order_id, wave_no) and return an error; that error is logged and ignored.
type DispatchRunner struct {
	svc           *Service
	log           *slog.Logger
	tick          time.Duration
	initialRadius int
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
	return &DispatchRunner{svc: svc, log: log, tick: tick, initialRadius: initialRadius}
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
func (r *DispatchRunner) Sweep(ctx context.Context) (int, error) {
	orders, err := r.svc.store.FindUndispatchedReadyOrders(ctx)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, orderID := range orders {
		_, waveErr := r.svc.RunWave(ctx, orderID, 1, r.initialRadius)
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

	// 2. Advance every order whose wave has lapsed (offer TTL + inter-wave gap).
	due, err := r.svc.store.FindWavesToEscalate(ctx, now, interWaveGap)
	if err != nil {
		return err
	}
	for _, d := range due {
		if d.Wave >= maxWaves || time.Duration(d.ElapsedS)*time.Second >= maxTotalSearch {
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

// escalateOne offers the next wave for a single lapsed order, widening the radius
// ladder when a radius is exhausted, and ending with NO_RIDER_FOUND if the ladder
// runs out. The wave number is the escalation round; the radius widens within it.
func (r *DispatchRunner) escalateOne(ctx context.Context, d waveToEscalate) {
	radius := d.RadiusM
	for {
		res, err := r.svc.RunWave(ctx, d.OrderID, d.Wave+1, radius)
		if err != nil {
			r.log.Warn("dispatch: escalation RunWave failed",
				slog.String("order_id", d.OrderID), slog.String("error", err.Error()))
			return
		}
		if res.Offered > 0 {
			return // next wave went out
		}
		// No offers at this radius (candidates exhausted): widen, or give up.
		ni := nextRadiusIndex(radius)
		if ni < 0 {
			if err := r.svc.store.MarkNoRiderFound(ctx, d.OrderID); err != nil {
				r.log.Warn("dispatch: mark no-rider-found failed",
					slog.String("order_id", d.OrderID), slog.String("error", err.Error()))
			}
			return
		}
		radius = radiusLadderM[ni]
	}
}
