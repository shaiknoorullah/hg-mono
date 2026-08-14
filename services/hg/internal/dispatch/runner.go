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
