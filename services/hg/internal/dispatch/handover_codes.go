package dispatch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/handover"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// The rider's side of the two handover codes (contracts/README.md, "Neither
// code can be bypassed", from the security review on
// https://github.com/shaiknoorullah/hg-mono/issues/183; backend
// https://github.com/shaiknoorullah/hg-mono/issues/310 and
// https://github.com/shaiknoorullah/hg-mono/issues/259).
//
//   - PICKED_UP needs the pickup code the kitchen reads out. There is no
//     override_reason and no geofence in its place.
//   - At a met handover the only proof of delivery is the delivery code the
//     customer reads out. A photo or a statement is refused, before and after
//     the code locks.
//   - Five wrong codes per code per order lock the code. The lock raises a
//     HANDOVER_CODE_LOCKED alert on admin:ops in the same transaction and hands
//     the order to support, who can confirm the handover with
//     overrideHandoverCode (internal/admin). The rider has no way past it.
//
// The messages below are fixed strings: no error ever carries the code sent or
// the code expected.

// codeGate turns a handover.CheckTx result into the rider's answer. A nil
// refusal means the code matched and the step goes on. A refusal is returned
// after the caller commits, because a counted attempt and a lock alert must
// survive the refused step.
func codeGate(ctx context.Context, tx pgx.Tx, orderID string, kind handover.Kind, typed *string) (*serviceError, error) {
	res, err := handover.CheckTx(ctx, tx, orderID, kind, typed)
	if err != nil {
		return nil, err
	}
	switch res.Outcome {
	case handover.Matched:
		return nil, nil
	case handover.Missing:
		if kind == handover.Pickup {
			return newError(http.StatusUnprocessableEntity, CodePickupCodeRequired,
				"Ask the kitchen for the 4-digit pickup code.", nil), nil
		}
		return newError(http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"Ask the customer for their 4-digit delivery code.",
			[]httpx.FieldError{{Field: "otp_code", Code: "required", Message: "the customer's 4-digit delivery code is required"}}), nil
	case handover.Incorrect:
		return wrongCode(kind, res.AttemptsRemaining), nil
	case handover.LockedNow:
		if err := lockAlertTx(ctx, tx, orderID, kind); err != nil {
			return nil, err
		}
		return lockedCode(kind), nil
	default: // handover.Locked
		return lockedCode(kind), nil
	}
}

func wrongCode(kind handover.Kind, remaining int) *serviceError {
	left := fmt.Sprintf("%d attempts remaining.", remaining)
	if remaining == 1 {
		left = "1 attempt remaining."
	}
	details := map[string]any{"attempts_remaining": remaining}
	if kind == handover.Pickup {
		return newError(http.StatusUnprocessableEntity, CodePickupCodeIncorrect,
			"That pickup code is not right. "+left, details)
	}
	return newError(http.StatusUnprocessableEntity, CodeDeliveryCodeIncorrect,
		"That delivery code is not right. "+left, details)
}

func lockedCode(kind handover.Kind) *serviceError {
	if kind == handover.Pickup {
		return newError(http.StatusLocked, CodePickupCodeLocked,
			"Too many wrong codes. HalalGoes support is taking over this pickup; please wait at the counter.", nil)
	}
	return newError(http.StatusLocked, CodeDeliveryCodeLocked,
		"Too many wrong codes. HalalGoes support is taking over this delivery; please stay with the order.", nil)
}

// lockAlertTx raises the admin.alert that hands a locked order to support, in
// the transaction that counted the fifth wrong code (contracts/websocket.md,
// admin:ops). It names the order and which handover, never the code.
func lockAlertTx(ctx context.Context, tx pgx.Tx, orderID string, kind handover.Kind) error {
	message := "Five wrong pickup codes at the counter. The pickup is with support."
	if kind == handover.Delivery {
		message = "Five wrong delivery codes at a met handover. The delivery is with support."
	}
	payload, err := json.Marshal(map[string]any{
		"severity":     "WARNING",
		"kind":         "HANDOVER_CODE_LOCKED",
		"subject_type": "ORDER",
		"subject_id":   orderID,
		"message":      message,
		"at":           httpx.Timestamp(time.Now()),
	})
	if err != nil {
		return err
	}
	oid := orderID
	if _, _, err := realtime.EmitInTx(ctx, tx, realtime.AdminOpsChannel, "admin.alert", 1, nil, payload, &oid, nil); err != nil {
		return fmt.Errorf("raise handover-code lock alert: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Support's side: the assignment half of overrideHandoverCode.
// ---------------------------------------------------------------------------

// LiveAssignment is an order's live (not yet terminated) assignment, locked in
// the caller's transaction.
type LiveAssignment struct {
	ID                string
	RiderAccountID    string
	State             string
	RequiredPodMethod string
	ArrivedPickupAt   *time.Time
}

// LockLiveAssignmentTx locks the order's live assignment for a support
// override. It returns nil when the order has none. Lock order matches the
// rider's path: the assignment first, then the order.
func LockLiveAssignmentTx(ctx context.Context, tx pgx.Tx, orderID string) (*LiveAssignment, error) {
	var a LiveAssignment
	var pod *string
	err := tx.QueryRow(ctx, `
SELECT id, rider_account_id, state::text, required_pod_method::text, arrived_pickup_at
  FROM assignment
 WHERE order_id = $1 AND terminated_at IS NULL
 FOR UPDATE`, orderID).Scan(&a.ID, &a.RiderAccountID, &a.State, &pod, &a.ArrivedPickupAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lock live assignment: %w", err)
	}
	if pod != nil {
		a.RequiredPodMethod = *pod
	}
	return &a, nil
}

// AwaitsHandover reports whether the assignment is the rider standing at the
// handover support is confirming: at the counter (ARRIVED_AT_PICKUP) for the
// pickup, at the drop-off (ARRIVED_AT_DROPOFF) of a met handover for the
// delivery (contracts/openapi.yaml, overrideHandoverCode).
func (a *LiveAssignment) AwaitsHandover(kind handover.Kind) bool {
	if a == nil {
		return false
	}
	if kind == handover.Pickup {
		return a.State == "ARRIVED_AT_PICKUP"
	}
	return a.State == "ARRIVED_AT_DROPOFF" && a.RequiredPodMethod == "OTP"
}

// ErrNotAwaitingHandover is SupportConfirmTx's refusal: the order has no live
// assignment waiting on that handover.
var ErrNotAwaitingHandover = errors.New("dispatch: the assignment is not waiting on that handover")

// SupportConfirmTx moves the assignment over a handover support confirmed,
// inside the override's transaction: PICKED_UP for the pickup, DELIVERED for
// the delivery. A delivery confirmed by support is the proof of delivery, so
// pod_recorded is set; and as for any delivered assignment the rider's
// availability is restored and the dispatch row completes. actorKind is
// SUPPORT or ADMIN, and the transition row carries the override's reason.
//
// The preconditions are in the UPDATE's WHERE clause, not taken from a: the
// assignment must belong to orderID, be live, and be at the counter
// (ARRIVED_AT_PICKUP) for the pickup, or at the door of a met handover
// (ARRIVED_AT_DROPOFF, required_pod_method OTP) for the delivery. The rider
// whose availability is restored is the one on the row. So a stale or forged
// LiveAssignment moves nothing: anything else is ErrNotAwaitingHandover. The
// caller holds the row lock (LockLiveAssignmentTx) in the same transaction.
func SupportConfirmTx(ctx context.Context, tx pgx.Tx, orderID string, a *LiveAssignment, kind handover.Kind, actorKind, actorAccountID, reason string, now time.Time) error {
	if a == nil {
		return ErrNotAwaitingHandover
	}
	from, to := "ARRIVED_AT_PICKUP", "PICKED_UP"
	var riderAccountID string
	var err error
	if kind == handover.Pickup {
		var wait *int
		if a.ArrivedPickupAt != nil {
			w := int(now.Sub(*a.ArrivedPickupAt).Seconds())
			if w < 0 {
				w = 0
			}
			wait = &w
		}
		err = tx.QueryRow(ctx, `
UPDATE assignment
   SET state = 'PICKED_UP', state_since = now(), picked_up_at = now(),
       pickup_wait_seconds = COALESCE($3, pickup_wait_seconds)
 WHERE id = $1 AND order_id = $2 AND terminated_at IS NULL
   AND state = 'ARRIVED_AT_PICKUP'
RETURNING rider_account_id::text`, a.ID, orderID, wait).Scan(&riderAccountID)
	} else {
		from, to = "ARRIVED_AT_DROPOFF", "DELIVERED"
		err = tx.QueryRow(ctx, `
UPDATE assignment
   SET state = 'DELIVERED', state_since = now(), delivered_at = now(),
       terminated_at = now(), pod_recorded = true
 WHERE id = $1 AND order_id = $2 AND terminated_at IS NULL
   AND state = 'ARRIVED_AT_DROPOFF' AND required_pod_method = 'OTP'
RETURNING rider_account_id::text`, a.ID, orderID).Scan(&riderAccountID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotAwaitingHandover
	}
	if err != nil {
		return fmt.Errorf("override %s: %w", strings.ToLower(string(kind)), err)
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO assignment_transition (assignment_id, from_state, to_state, actor_kind, actor_account_id, reason)
VALUES ($1, $2, $3, $4, $5, $6)`, a.ID, from, to, actorKind, actorAccountID, reason); err != nil {
		return fmt.Errorf("override transition row: %w", err)
	}
	if to == "DELIVERED" {
		if err := restoreAvailabilityTx(ctx, tx, riderAccountID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
UPDATE dispatch SET state = 'COMPLETED', state_since = now(),
                    deadline_at = NULL, deadline_action = NULL
 WHERE order_id = $1 AND rider_account_id = $2`,
			orderID, riderAccountID); err != nil {
			return fmt.Errorf("override completes dispatch: %w", err)
		}
	}
	return nil
}
