package devworld

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// The rider ledger scenarios (https://github.com/shaiknoorullah/hg-mono/issues/708). They give a rider persona a delivery
// history through the API, the way rider-sim gets one from `make dev-journey`,
// so the earnings and history screens show real rows.
//
//   - rider-earnings: rider-payout delivers one order, which settles. Its
//     earning entries are written by the settle, once, in the ledger.
//   - rider-history: rider-history delivers one order, then accepts a second
//     that an admin cancels, so its history holds a DELIVERED and a
//     CANCELLED_BY_PLATFORM assignment.
//
// Two things are not made here, both because the platform has no operation for
// them yet: a RETURNED assignment (the rider's exception step is not built; pay
// for an interrupted delivery is an open owner question,
// https://github.com/shaiknoorullah/hg-mono/issues/164), and a paid
// payout. A rider's earning is paid by the first payout run after it has aged
// an hour and its week has closed on a Monday 00:00 in Toronto; no scenario
// moves the ledger's clock, so a fresh world reads NOTHING_DUE until Monday.

// riderScenarioTimeout is how long rider-earnings and rider-history may run:
// a delivery that settles takes up to the two-minute delivered deadline, and
// rider-history runs a second order after it.
const riderScenarioTimeout = 12 * time.Minute

// riderSlugs are every rider persona that goes online in a scenario.
var riderSlugs = []string{"rider-sim", "rider-sim-2", "rider-payout", "rider-history"}

// othersOffline takes every rider persona except keep out of the dispatch pool,
// so the offer for the scenario's order can only reach keep.
func othersOffline(ctx context.Context, base, keep string) error {
	for _, slug := range riderSlugs {
		if slug == keep {
			continue
		}
		rider, err := riderAs(ctx, base, slug)
		if err != nil {
			return err
		}
		if _, _, err := rider.call(ctx, http.MethodPut, "/v1/riders/me/availability", map[string]any{"is_online": false}, false); err != nil {
			return fmt.Errorf("devworld: %s go offline: %w", slug, err)
		}
	}
	return nil
}

// deliverAs runs one order from the restaurant to a settled delivery with the
// rider persona slug, leaving that rider offline and asking for no refund.
func deliverAs(ctx context.Context, base, slug string) error {
	if err := othersOffline(ctx, base, slug); err != nil {
		return err
	}
	return RunJourney(ctx, base, JourneyOptions{
		Route: "short", Speed: "max", Auto: "all",
		NoRefundRequest: true, EndShift: true, Rider: slug,
	})
}

func scenarioRiderEarnings(ctx context.Context, base string) error {
	if err := AllowAPI(base); err != nil {
		return err
	}
	if err := deliverAs(ctx, base, "rider-payout"); err != nil {
		return err
	}
	if err := printRiderLedger(ctx, base, "rider-payout"); err != nil {
		return err
	}
	return ledgerBalanced(ctx)
}

func scenarioRiderHistory(ctx context.Context, base string) error {
	if err := AllowAPI(base); err != nil {
		return err
	}
	if err := deliverAs(ctx, base, "rider-history"); err != nil {
		return err
	}
	fmt.Println("== a delivery the platform cancels")
	if err := cancelAfterRiderAccepts(ctx, base, "rider-history"); err != nil {
		return err
	}
	if err := printRiderLedger(ctx, base, "rider-history"); err != nil {
		return err
	}
	return ledgerBalanced(ctx)
}

// cancelAfterRiderAccepts readies an order, lets the rider persona accept its
// offer, then has admin-seed cancel the order: the order is CANCELLED with a
// full refund and the rider's assignment ends CANCELLED_BY_PLATFORM, in the
// order's own transaction (internal/dispatch/release.go).
func cancelAfterRiderAccepts(ctx context.Context, base, slug string) error {
	rider, err := riderAs(ctx, base, slug)
	if err != nil {
		return err
	}
	start := approachStart("short")
	if err := rider.goOnline(ctx, start); err != nil {
		return err
	}
	fmt.Printf("rider online  %s  %.5f,%.5f\n", slug, start.Lat, start.Lng)
	_, order, err := pickCustomer(ctx, base, states(statePending, statePreparing, stateReady))
	if err != nil {
		return err
	}
	kitchen, err := restaurant(ctx, base, "bismillah-grill")
	if err != nil {
		return err
	}
	if order, err = advanceTo(ctx, kitchen, order, stateReady); err != nil {
		return err
	}
	offer, err := rider.waitOffer(ctx, order.ID, offerWait)
	if err != nil {
		return err
	}
	assignmentID, _, err := rider.acceptOffer(ctx, offer.OfferID)
	if err != nil {
		return err
	}
	fmt.Printf("assignment  %s  accepted by %s for %s\n", assignmentID, slug, order.Code)
	admin, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return err
	}
	status, data, err := admin.call(ctx, http.MethodPost, "/v1/admin/orders/"+order.ID+"/cancel", map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Devworld: support cancelled the order after the rider accepted it.",
		"case_id":     uuid.NewString(),
	}, true)
	if err != nil {
		return fmt.Errorf("devworld: admin cancel: %w", err)
	}
	var view struct {
		State string `json:"state"`
	}
	_ = json.Unmarshal(data, &view)
	fmt.Printf("admin cancel  http %d  %s  %s\n", status, order.Code, view.State)
	if view.State != "CANCELLED" {
		return fmt.Errorf("devworld: admin cancel left %s in %s", order.Code, view.State)
	}
	if _, data, err := rider.call(ctx, http.MethodGet, "/v1/riders/me/assignments/"+assignmentID, nil, false); err == nil {
		var asn struct {
			State string `json:"state"`
		}
		if json.Unmarshal(data, &asn) == nil && asn.State != "" {
			fmt.Printf("assignment  %s  %s\n", assignmentID, asn.State)
		}
	}
	return rider.goOffline(ctx)
}

// printRiderLedger shows what the rider's earnings and payouts screens will
// list: the earning entries and the payouts.
func printRiderLedger(ctx context.Context, base, slug string) error {
	rider, err := riderAs(ctx, base, slug)
	if err != nil {
		return err
	}
	for _, p := range []struct{ label, path string }{
		{"earning entries", "/v1/riders/me/earnings/entries?limit=50"},
		{"payouts", "/v1/riders/me/payouts?limit=10"},
	} {
		_, data, err := rider.call(ctx, http.MethodGet, p.path, nil, false)
		if err != nil {
			return fmt.Errorf("devworld: %s %s: %w", slug, p.label, err)
		}
		var rows []json.RawMessage
		if err := json.Unmarshal(data, &rows); err != nil {
			return fmt.Errorf("devworld: %s %s: unreadable answer: %w", slug, p.label, err)
		}
		fmt.Printf("%s  %s  %d\n", slug, p.label, len(rows))
	}
	fmt.Printf("%s  payouts stay empty until a payout run after the rider's week closes (Monday 00:00 Toronto)\n", slug)
	return nil
}
