package admin

// The admin actions that suspend, reinstate, delist, deactivate or ban a
// restaurant, a rider or a customer (https://github.com/shaiknoorullah/hg-mono/issues/253).
// Which action is legal from which state, and what it does to orders already in
// progress, is internal/accountstate. This file applies one action in one
// transaction: the state change, the effects on work in progress, the history
// row, the audit record and the notices commit together or not at all.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/accountstate"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// orderTransitioner moves an order through the order state machine inside the
// caller's transaction. *orders.Store is the production implementation; the
// state machine stays the only writer of order.state.
type orderTransitioner interface {
	TransitionInTx(ctx context.Context, tx pgx.Tx, req orders.TransitionRequest, effects ...func(pgx.Tx) error) error
}

// notificationEnqueuer writes a notification and its delivery job in the
// caller's transaction (*notify.Enqueuer, the transactional outbox).
type notificationEnqueuer interface {
	Enqueue(ctx context.Context, tx pgx.Tx, n notify.New) (notify.EnqueueResult, error)
}

// authorisationReleaser releases the payment authorisation of an order cancelled
// before the restaurant accepted it. It runs after the commit, like the
// restaurant's own reject path, and is idempotent per order.
type authorisationReleaser interface {
	Void(ctx context.Context, orderID string) error
}

// Errors an account action can end in, each mapped to one contract error code by
// the handler.
var (
	// errIdempotencyKeyReuse: the same Idempotency-Key was sent with a different request.
	errIdempotencyKeyReuse = errors.New("admin: idempotency key reused for a different account action")
	// errActOnOwnAccount: staff cannot act on their own account or their own restaurant.
	errActOnOwnAccount = errors.New("admin: staff cannot act on their own account")
	// errStaffAccount: staff accounts are managed through the staff operations.
	errStaffAccount = errors.New("admin: a staff account is not changed by a rider or customer action")
	// errConfirmOwnProposal: the person who proposed a ban cannot confirm it.
	errConfirmOwnProposal = errors.New("admin: a ban needs a second person to confirm it")
	// errMFARequired: the caller's session was not signed in with two-step sign-in.
	errMFARequired = errors.New("admin: account actions need a session signed in with two-step sign-in")
)

// permissionError: the action needs a permission the caller's role lacks.
type permissionError struct{ permission string }

func (e permissionError) Error() string { return "admin: missing permission " + e.permission }

// halalCertificateRequiredError: a delisted restaurant cannot be relisted without
// a current, admin-verified halal certificate.
type halalCertificateRequiredError struct{ state string }

func (e halalCertificateRequiredError) Error() string {
	return "admin: relisting needs a current halal certificate, have " + e.state
}

// inFlightOrdersError: a customer's ban waits for their accepted orders to finish.
type inFlightOrdersError struct{ orderIDs []string }

func (e inFlightOrdersError) Error() string { return "admin: orders still in progress" }

// accountActionInput is one validated account action.
type accountActionInput struct {
	Subject    accountstate.Subject
	SubjectID  string
	Action     accountstate.Action
	ReasonCode string
	ReasonText string
	// IdemKey is the request's Idempotency-Key: a retry returns the first result.
	IdemKey string
	// Principal is the verified caller. ApplyAccountAction checks its role and its
	// two-step sign-in itself, so no caller, HTTP or not, can skip them.
	Principal httpx.Principal
	Actor     auditActor
}

// accountInFlight is AccountActionInFlight in the contract.
type accountInFlight struct {
	Cancelled  []string `json:"cancelled_order_ids"`
	Refunded   []string `json:"refunded_order_ids"`
	Continuing []string `json:"continuing_order_ids"`
	Withdrawn  []string `json:"withdrawn_offer_ids"`
}

func newInFlight() accountInFlight {
	return accountInFlight{Cancelled: []string{}, Refunded: []string{}, Continuing: []string{}, Withdrawn: []string{}}
}

// accountStateChangeRow is one account_state_event row: AccountStateChange.
type accountStateChangeRow struct {
	ID              string
	SubjectType     string
	SubjectID       string
	Action          string
	FromState       string
	ToState         string
	ReasonCode      string
	ReasonText      string
	ActorAccountID  string
	InFlight        accountInFlight
	DelistReasons   []string
	SessionsRevoked int
	CreatedAt       time.Time
	requestHash     []byte
	// Replayed is true when this is a retry returning the first result.
	Replayed bool
	// releaseOrderIDs are the orders cancelled before acceptance whose payment
	// authorisation the handler releases after the commit. Empty on a replay.
	releaseOrderIDs []string
}

// accountActionDeps are the collaborators owned by other modules.
type accountActionDeps struct {
	orders orderTransitioner
	notify notificationEnqueuer // nil: no notices (tests that do not look at them)
}

// requestHash fingerprints the request a key was first used for.
func accountActionRequestHash(in accountActionInput) []byte {
	h := sha256.New()
	for _, part := range []string{string(in.Subject), in.SubjectID, string(in.Action), in.ReasonCode, in.ReasonText} {
		h.Write([]byte(part))
		h.Write([]byte{0})
	}
	return h.Sum(nil)
}

// ApplyAccountAction applies one account action, or returns the first result
// when the same caller retries with the same Idempotency-Key. It is the only code
// that applies a staff member's account action, and it holds every gate itself:
// the caller is an admin or a super admin signed in with two-step sign-in, a ban
// needs a second (super admin) person, and nobody acts on their own account. The
// database refuses any other path (migration 00045).
func (r *Repo) ApplyAccountAction(ctx context.Context, deps accountActionDeps, in accountActionInput) (accountStateChangeRow, error) {
	if err := checkAccountActionCaller(in); err != nil {
		return accountStateChangeRow{}, err
	}
	hash := accountActionRequestHash(in)
	var out accountStateChangeRow
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = r.applyAccountActionTx(ctx, tx, deps, in, hash)
		return err
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "account_state_event_idempotency" {
		// A concurrent first attempt with the same key committed while this one
		// ran. Its result is the answer, exactly once.
		err = r.inTx(ctx, func(tx pgx.Tx) error {
			var found bool
			var lerr error
			out, found, lerr = loadAccountEventByKeyTx(ctx, tx, in.Actor.staffID, in.IdemKey)
			if lerr != nil {
				return lerr
			}
			if !found {
				return fmt.Errorf("account action: idempotency conflict without a row")
			}
			if !bytes.Equal(out.requestHash, hash) {
				return errIdempotencyKeyReuse
			}
			out.Replayed = true
			return nil
		})
	}
	return out, err
}

// checkAccountActionCaller is the caller half of the gates: an admin or a super
// admin, signed in with two-step sign-in, recorded as themselves. The HTTP handler
// checks the same before it reads the body; this is the check that holds for
// every caller.
func checkAccountActionCaller(in accountActionInput) error {
	p := in.Principal
	if p.Anonymous || p.AccountID == "" || (!p.HasRole(httpx.RoleAdmin) && !p.HasRole(httpx.RoleSuperAdmin)) {
		return permissionError{permission: string(in.Subject) + ".account_state_change"}
	}
	if !hasAMR(p, "pwd+totp") {
		return errMFARequired
	}
	if in.Actor.staffID != p.AccountID {
		return fmt.Errorf("account action: the recorded actor %q is not the caller %q", in.Actor.staffID, p.AccountID)
	}
	return nil
}

func (r *Repo) applyAccountActionTx(ctx context.Context, tx pgx.Tx, deps accountActionDeps, in accountActionInput, hash []byte) (accountStateChangeRow, error) {
	// A retry with the same key returns the first result and changes nothing.
	if prev, found, err := loadAccountEventByKeyTx(ctx, tx, in.Actor.staffID, in.IdemKey); err != nil {
		return prev, err
	} else if found {
		if !bytes.Equal(prev.requestHash, hash) {
			return prev, errIdempotencyKeyReuse
		}
		prev.Replayed = true
		return prev, nil
	}

	// The database clock decides whether a ban proposal has lapsed, the same clock
	// the two-person trigger in migration 00044 uses.
	var now time.Time
	if err := tx.QueryRow(ctx, `SELECT now()`).Scan(&now); err != nil {
		return accountStateChangeRow{}, err
	}

	var a accountApplier
	switch in.Subject {
	case accountstate.Restaurant:
		a = &restaurantApplier{}
	case accountstate.Rider:
		a = &riderApplier{}
	case accountstate.Customer:
		a = &customerApplier{}
	default:
		return accountStateChangeRow{}, fmt.Errorf("account action: unknown subject %q", in.Subject)
	}

	// Lock the account and read its state; every later read and write in this
	// transaction sees it as it is now.
	from, err := a.lock(ctx, tx, in)
	if err != nil {
		return accountStateChangeRow{}, err
	}

	// A ban proposal is pending when the account's latest action proposed one less
	// than 7 days ago. A system principal's row (the halal expiry delisting) names
	// no person, so its actor reads as empty.
	var lastAction, lastActor string
	var lastAt time.Time
	err = tx.QueryRow(ctx, `
SELECT action::text, COALESCE(actor_account_id::text, ''), created_at
  FROM account_state_event
 WHERE subject_type = $1::account_subject_type AND subject_id = $2
 ORDER BY created_at DESC, id DESC
 LIMIT 1`, string(in.Subject), in.SubjectID).Scan(&lastAction, &lastActor, &lastAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return accountStateChangeRow{}, err
	}
	banProposed := lastAction == string(accountstate.ProposeBan) && accountstate.BanPending(lastAt, now)

	d, err := accountstate.Decide(accountstate.Request{
		Subject: in.Subject, From: from, Action: in.Action, BanProposed: banProposed,
	})
	if err != nil {
		return accountStateChangeRow{}, err
	}
	if d.SuperAdminOnly && !in.Principal.HasRole(httpx.RoleSuperAdmin) {
		return accountStateChangeRow{}, permissionError{permission: d.Permission}
	}
	if in.Action == accountstate.ConfirmBan && lastActor == in.Actor.staffID {
		return accountStateChangeRow{}, errConfirmOwnProposal
	}

	out := accountStateChangeRow{
		SubjectType: string(in.Subject), SubjectID: in.SubjectID, Action: string(in.Action),
		FromState: from, ToState: d.To, ReasonCode: in.ReasonCode, ReasonText: in.ReasonText,
		ActorAccountID: in.Actor.staffID, InFlight: newInFlight(), DelistReasons: []string{},
		requestHash: hash,
	}
	// Work in progress first: orders, offers, a rider going offline. Then the state.
	if err := a.apply(ctx, tx, deps, in, now, &out); err != nil {
		return accountStateChangeRow{}, err
	}
	if err := r.writeAccountStateTx(ctx, tx, in, hash, &out); err != nil {
		return accountStateChangeRow{}, err
	}

	if deps.notify != nil {
		eventID, err := uuid.Parse(out.ID)
		if err != nil {
			return accountStateChangeRow{}, err
		}
		recipients, err := a.recipients(ctx, tx, in.SubjectID)
		if err != nil {
			return accountStateChangeRow{}, err
		}
		for _, rcpt := range recipients {
			n, ok := notify.NotifyAccountStateChanged(notify.AccountStateNotice{
				EventID: eventID, AccountID: rcpt, RoleContext: a.roleContext(),
				Action: out.Action, ToState: out.ToState, DisplayName: a.displayName(),
			})
			if !ok {
				continue
			}
			if _, err := deps.notify.Enqueue(ctx, tx, n); err != nil {
				return accountStateChangeRow{}, fmt.Errorf("account action: enqueue notice: %w", err)
			}
		}
	}
	return out, nil
}

// writeAccountStateTx is the state change itself, made by the database function
// account_state_apply (migration 00045), the only writer of an account's state:
// the application role cannot UPDATE the state columns. It is given the caller's
// access token, not an account id: it hashes the token, finds the live two-step
// session it was issued for, and acts as that session's account. It reads the
// actor's grants as they stand, checks the transition, the two-person ban and the
// own-account rule again, decides a restaurant's listing from its certificate,
// ends the sessions a confirmed ban ends, and writes the state, the history row and
// the audit row together.
func (r *Repo) writeAccountStateTx(ctx context.Context, tx pgx.Tx, in accountActionInput, hash []byte, out *accountStateChangeRow) error {
	inFlightJSON, err := json.Marshal(out.InFlight)
	if err != nil {
		return err
	}
	request, err := json.Marshal(map[string]string{
		"request_id": in.Actor.requestID, "ip": in.Actor.ip, "user_agent": in.Actor.userAgent,
	})
	if err != nil {
		return err
	}
	return tx.QueryRow(ctx, `
SELECT event_id::text, from_state, to_state, delist_reasons, sessions_revoked, created_at
  FROM account_state_apply($1::account_subject_type, $2, $3::account_action, $4, $5, $6, $7, $8, $9, $10)`,
		string(in.Subject), in.SubjectID, string(in.Action), in.Principal.Credential(), in.ReasonCode, in.ReasonText,
		in.IdemKey, hash, string(inFlightJSON), string(request)).Scan(
		&out.ID, &out.FromState, &out.ToState, &out.DelistReasons, &out.SessionsRevoked, &out.CreatedAt)
}

// loadAccountEventByKeyTx finds the result a caller's earlier request with this
// Idempotency-Key produced.
func loadAccountEventByKeyTx(ctx context.Context, tx pgx.Tx, actorID, key string) (accountStateChangeRow, bool, error) {
	var out accountStateChangeRow
	var inFlight []byte
	err := tx.QueryRow(ctx, `
SELECT id::text, subject_type::text, subject_id::text, action::text, from_state, to_state,
       reason_code, reason_text, actor_account_id::text, in_flight, delist_reasons,
       sessions_revoked, created_at, request_hash
  FROM account_state_event
 WHERE actor_account_id = $1 AND idempotency_key = $2`, actorID, key).Scan(
		&out.ID, &out.SubjectType, &out.SubjectID, &out.Action, &out.FromState, &out.ToState,
		&out.ReasonCode, &out.ReasonText, &out.ActorAccountID, &inFlight, &out.DelistReasons,
		&out.SessionsRevoked, &out.CreatedAt, &out.requestHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, false, nil
	}
	if err != nil {
		return out, false, err
	}
	out.InFlight = newInFlight()
	if err := json.Unmarshal(inFlight, &out.InFlight); err != nil {
		return out, false, err
	}
	if out.DelistReasons == nil {
		out.DelistReasons = []string{}
	}
	return out, true, nil
}

// accountApplier is the part of an account action that differs by subject.
type accountApplier interface {
	// lock locks the account row, checks the caller may act on it, and returns its
	// current state. A missing account is ErrNotFound.
	lock(ctx context.Context, tx pgx.Tx, in accountActionInput) (string, error)
	// apply checks the subject's own preconditions, for a clear refusal, and
	// settles work in progress. It never writes the state: account_state_apply does.
	apply(ctx context.Context, tx pgx.Tx, deps accountActionDeps, in accountActionInput, now time.Time, out *accountStateChangeRow) error
	// recipients are the accounts the notice goes to.
	recipients(ctx context.Context, tx pgx.Tx, subjectID string) ([]uuid.UUID, error)
	roleContext() notify.RoleContext
	displayName() string
}

// cancelOrderTx cancels one order through the order state machine as the system,
// and refunds it in full when it was already accepted (captured). The order row
// is already locked by the caller.
func cancelOrderTx(ctx context.Context, tx pgx.Tx, deps accountActionDeps, in accountActionInput,
	orderID, cancelReason string, outcome accountstate.OrderOutcome, refundReason string) error {
	reason := fmt.Sprintf("account action: %s %s %s", in.Subject, in.Action, in.ReasonCode)
	if err := deps.orders.TransitionInTx(ctx, tx, orders.TransitionRequest{
		OrderID: orderID, To: machine.StateCancelled, Actor: machine.ActorSystem,
		ActorAccountID: in.Actor.staffID, Reason: reason, RequestID: in.Actor.requestID,
		CancelReason: &cancelReason,
	}); err != nil {
		return fmt.Errorf("cancel order %s: %w", orderID, err)
	}
	if outcome == accountstate.CancelRefund {
		// Full refund of everything the customer paid, in this transaction, through
		// the same balanced ledger batch an admin cancellation posts.
		return postCaptureReversal(ctx, tx, orderID, in.Actor, in.ReasonText, refundReason)
	}
	return nil
}

// --- restaurants -------------------------------------------------------------

type restaurantApplier struct {
	name string
}

func (a *restaurantApplier) roleContext() notify.RoleContext { return notify.RoleRestaurant }
func (a *restaurantApplier) displayName() string             { return a.name }

func (a *restaurantApplier) lock(ctx context.Context, tx pgx.Tx, in accountActionInput) (string, error) {
	var state string
	err := tx.QueryRow(ctx, `
SELECT account_state::text, display_name FROM restaurant
 WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, in.SubjectID).Scan(&state, &a.name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	// Staff who also work for this restaurant do not judge it.
	var own bool
	if err := tx.QueryRow(ctx, `
SELECT EXISTS (SELECT 1 FROM account_role
                WHERE account_id = $1 AND scope_type = 'RESTAURANT' AND scope_id = $2
                  AND revoked_at IS NULL)`, in.Actor.staffID, in.SubjectID).Scan(&own); err != nil {
		return "", err
	}
	if own {
		return "", errActOnOwnAccount
	}
	return state, nil
}

func (a *restaurantApplier) apply(ctx context.Context, tx pgx.Tx, deps accountActionDeps, in accountActionInput, now time.Time, out *accountStateChangeRow) error {
	if in.Action != accountstate.Reinstate {
		return a.settleOrders(ctx, tx, deps, in, out)
	}
	// The clear refusals for a reinstatement; account_state_apply decides the
	// listing itself and refuses the same.
	var onboarding, timezone string
	var hasLocation bool
	if err := tx.QueryRow(ctx, `
SELECT onboarding_state::text, timezone, location IS NOT NULL
  FROM restaurant WHERE id = $1`, in.SubjectID).Scan(&onboarding, &timezone, &hasLocation); err != nil {
		return err
	}
	if onboarding != "ACTIVE" || !hasLocation {
		return preconditionError{Blockers: []string{
			"The restaurant has not finished onboarding, so it cannot be listed."}}
	}
	if out.FromState == accountstate.StateDelisted {
		// Relisting is the admin saying the causes are fixed, but never without a
		// current, admin-verified halal certificate.
		cert, err := restaurantHalalCertificateTx(ctx, tx, in.SubjectID)
		if err != nil {
			return err
		}
		if certState := accountstate.CertificationState(cert, accountstate.LocalDate(timezone, now)); !accountstate.CertificateCurrent(certState) {
			return halalCertificateRequiredError{state: certState}
		}
	}
	return nil
}

// settleOrders applies the in-progress order rules to every unfinished order of
// the restaurant. The order rows are locked first, so an order cannot be accepted
// between reading its state and deciding its fate.
func (a *restaurantApplier) settleOrders(ctx context.Context, tx pgx.Tx, deps accountActionDeps, in accountActionInput, out *accountStateChangeRow) error {
	type ord struct{ id, state string }
	rows, err := tx.Query(ctx, `
SELECT id::text, state::text FROM "order"
 WHERE restaurant_id = $1
   AND state NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'RESOLVED')
 ORDER BY created_at, id
 FOR UPDATE`, in.SubjectID)
	if err != nil {
		return err
	}
	var list []ord
	for rows.Next() {
		var o ord
		if err := rows.Scan(&o.id, &o.state); err != nil {
			rows.Close()
			return err
		}
		list = append(list, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, o := range list {
		outcome := accountstate.RestaurantOrderOutcome(in.Action, in.ReasonCode, o.state)
		switch outcome {
		case accountstate.Continue:
			out.InFlight.Continuing = append(out.InFlight.Continuing, o.id)
			continue
		case accountstate.CancelRelease:
			out.releaseOrderIDs = append(out.releaseOrderIDs, o.id)
		case accountstate.CancelRefund:
			out.InFlight.Refunded = append(out.InFlight.Refunded, o.id)
		}
		if err := cancelOrderTx(ctx, tx, deps, in, o.id, "RESTAURANT_CLOSED", outcome,
			accountstate.RefundReasonFor(in.ReasonCode)); err != nil {
			return err
		}
		out.InFlight.Cancelled = append(out.InFlight.Cancelled, o.id)
	}
	return nil
}

// recipients are the restaurant's owners and managers. Front-of-house staff run
// the order screen; the account's standing is the owners' business.
func (a *restaurantApplier) recipients(ctx context.Context, tx pgx.Tx, restaurantID string) ([]uuid.UUID, error) {
	return accountIDs(ctx, tx, `
SELECT DISTINCT account_id FROM account_role
 WHERE scope_type = 'RESTAURANT' AND scope_id = $1 AND revoked_at IS NULL
   AND role IN ('RESTAURANT_OWNER', 'RESTAURANT_MANAGER')
 ORDER BY account_id`, restaurantID)
}

// restaurantHalalCertificateTx reads the restaurant's admin-verified halal
// certificate the way the order path does
// (https://github.com/shaiknoorullah/hg-mono/pull/298, halal_certification_at):
// APPROVED, or later moved to EXPIRED, verified by an admin, from an ACCEPTED
// issuing body, not deleted; an APPROVED one wins over an EXPIRED one, and the
// later expiry within each. Nothing a request carries, and no pending upload,
// ever counts. account_state_complete_onboarding() (migration 00045) reads it the
// same way when onboarding lists a restaurant.
func restaurantHalalCertificateTx(ctx context.Context, tx pgx.Tx, restaurantID string) (accountstate.HalalCertificate, error) {
	var c accountstate.HalalCertificate
	err := tx.QueryRow(ctx, `
SELECT hc.status::text, hc.expires_on, hc.grace_until
  FROM halal_certificate hc
  JOIN halal_issuing_body b ON b.id = hc.issuing_body_id
 WHERE hc.restaurant_id = $1
   AND hc.status IN ('APPROVED', 'EXPIRED')
   AND hc.verified_by IS NOT NULL
   AND hc.verified_at IS NOT NULL
   AND b.status = 'ACCEPTED'
   AND hc.deleted_at IS NULL
 ORDER BY (hc.status = 'APPROVED') DESC, hc.expires_on DESC, hc.id DESC
 LIMIT 1`, restaurantID).Scan(&c.Status, &c.ExpiresOn, &c.GraceUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return accountstate.HalalCertificate{}, nil
	}
	return c, err
}

// --- riders ------------------------------------------------------------------

type riderApplier struct{}

func (a *riderApplier) roleContext() notify.RoleContext { return notify.RoleRider }
func (a *riderApplier) displayName() string             { return "" }

func (a *riderApplier) lock(ctx context.Context, tx pgx.Tx, in accountActionInput) (string, error) {
	if in.SubjectID == in.Actor.staffID {
		return "", errActOnOwnAccount
	}
	var state string
	var isStaff bool
	err := tx.QueryRow(ctx, `
SELECT rp.account_status::text,
       EXISTS (SELECT 1 FROM account_role r WHERE r.account_id = rp.account_id AND r.revoked_at IS NULL
                  AND r.role IN ('SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN'))
  FROM rider_profile rp
 WHERE rp.account_id = $1 AND rp.deleted_at IS NULL FOR UPDATE OF rp`, in.SubjectID).Scan(&state, &isStaff)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	// A rider's ban ends every session of the account, staff sessions included.
	if isStaff {
		return "", errStaffAccount
	}
	return state, nil
}

func (a *riderApplier) apply(ctx context.Context, tx pgx.Tx, deps accountActionDeps, in accountActionInput, now time.Time, out *accountStateChangeRow) error {
	var onboarding, availability string
	if err := tx.QueryRow(ctx, `
SELECT onboarding_state::text, availability_state::text FROM rider_profile WHERE account_id = $1`,
		in.SubjectID).Scan(&onboarding, &availability); err != nil {
		return err
	}

	if in.Action == accountstate.Reinstate {
		if onboarding != "ACTIVE" {
			return preconditionError{Blockers: []string{
				"The rider has not finished onboarding, so they cannot be reinstated to take deliveries."}}
		}
	} else {
		// New offers stop at once: every offer waiting for this rider is withdrawn,
		// and dispatch offers only to ACTIVE riders.
		rows, err := tx.Query(ctx, `
UPDATE dispatch_offer
   SET state = 'WITHDRAWN', outcome = 'WITHDRAWN', outcome_at = now()
 WHERE rider_account_id = $1 AND state = 'PENDING'
RETURNING id::text`, in.SubjectID)
		if err != nil {
			return fmt.Errorf("withdraw offers: %w", err)
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			out.InFlight.Withdrawn = append(out.InFlight.Withdrawn, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		// The current delivery finishes: the rider is paid for it and goes offline
		// afterwards. A rider who is online and idle goes offline now
		// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--redesign-decisions-owner-2026-09-28).
		switch availability {
		case "ON_DELIVERY":
			if _, err := tx.Exec(ctx, `
UPDATE rider_profile SET go_offline_after_delivery = true WHERE account_id = $1`, in.SubjectID); err != nil {
				return err
			}
		case "ONLINE_IDLE", "ONLINE_STALE":
			if _, err := tx.Exec(ctx, `
UPDATE rider_profile
   SET availability_state = 'OFFLINE', is_online = false, availability_changed_at = now()
 WHERE account_id = $1`, in.SubjectID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
INSERT INTO rider_availability_event (account_id, from_state, to_state, reason, actor_kind)
VALUES ($1, $2::rider_availability_state, 'OFFLINE', $3, 'ADMIN')`,
				in.SubjectID, availability, "ACCOUNT_"+string(in.Action)); err != nil {
				return err
			}
		}
		ids, err := stringColumn(ctx, tx, `
SELECT order_id::text FROM dispatch
 WHERE rider_account_id = $1 AND state IN ('ASSIGNED', 'AT_RESTAURANT', 'CARRYING', 'AT_CUSTOMER')
 ORDER BY assigned_at`, in.SubjectID)
		if err != nil {
			return err
		}
		out.InFlight.Continuing = append(out.InFlight.Continuing, ids...)
	}
	return nil
}

func (a *riderApplier) recipients(_ context.Context, _ pgx.Tx, riderID string) ([]uuid.UUID, error) {
	id, err := uuid.Parse(riderID)
	if err != nil {
		return nil, err
	}
	return []uuid.UUID{id}, nil
}

// --- customers ---------------------------------------------------------------

type customerApplier struct{}

func (a *customerApplier) roleContext() notify.RoleContext { return notify.RoleCustomer }
func (a *customerApplier) displayName() string             { return "" }

func (a *customerApplier) lock(ctx context.Context, tx pgx.Tx, in accountActionInput) (string, error) {
	if in.SubjectID == in.Actor.staffID {
		return "", errActOnOwnAccount
	}
	var state string
	var isCustomer, isStaff bool
	err := tx.QueryRow(ctx, `
SELECT a.status::text,
       EXISTS (SELECT 1 FROM account_role r WHERE r.account_id = a.id AND r.revoked_at IS NULL
                  AND r.role = 'CUSTOMER'),
       EXISTS (SELECT 1 FROM account_role r WHERE r.account_id = a.id AND r.revoked_at IS NULL
                  AND r.role IN ('SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN'))
  FROM account a
 WHERE a.id = $1 AND a.deleted_at IS NULL
 FOR UPDATE OF a`, in.SubjectID).Scan(&state, &isCustomer, &isStaff)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if !isCustomer {
		return "", ErrNotFound
	}
	if isStaff {
		return "", errStaffAccount
	}
	return state, nil
}

func (a *customerApplier) apply(ctx context.Context, tx pgx.Tx, deps accountActionDeps, in accountActionInput, _ time.Time, out *accountStateChangeRow) error {
	if in.Action != accountstate.Reinstate {
		type ord struct{ id, state string }
		rows, err := tx.Query(ctx, `
SELECT id::text, state::text FROM "order"
 WHERE account_id = $1
   AND state NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'RESOLVED')
 ORDER BY created_at, id
 FOR UPDATE`, in.SubjectID)
		if err != nil {
			return err
		}
		var list []ord
		for rows.Next() {
			var o ord
			if err := rows.Scan(&o.id, &o.state); err != nil {
				rows.Close()
				return err
			}
			list = append(list, o)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		// A ban waits until the customer's accepted orders have finished.
		if in.Action == accountstate.ConfirmBan {
			var blocking []string
			for _, o := range list {
				if accountstate.CustomerBanBlockedBy(o.state) {
					blocking = append(blocking, o.id)
				}
			}
			if len(blocking) > 0 {
				return inFlightOrdersError{orderIDs: blocking}
			}
		}
		for _, o := range list {
			outcome := accountstate.CustomerOrderOutcome(in.Action, o.state)
			if outcome == accountstate.Continue {
				out.InFlight.Continuing = append(out.InFlight.Continuing, o.id)
				continue
			}
			if err := cancelOrderTx(ctx, tx, deps, in, o.id, "SUPPORT_CANCELLED", outcome, ""); err != nil {
				return err
			}
			out.InFlight.Cancelled = append(out.InFlight.Cancelled, o.id)
			out.releaseOrderIDs = append(out.releaseOrderIDs, o.id)
		}
	}
	// One person has one account: account_state_apply sets this status, the
	// person's. Anything other than ACTIVE refuses new sessions and stops their
	// access tokens within 10 seconds.
	return nil
}

func (a *customerApplier) recipients(_ context.Context, _ pgx.Tx, customerID string) ([]uuid.UUID, error) {
	id, err := uuid.Parse(customerID)
	if err != nil {
		return nil, err
	}
	return []uuid.UUID{id}, nil
}

// --- small helpers -----------------------------------------------------------

func accountIDs(ctx context.Context, tx pgx.Tx, query string, args ...any) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func stringColumn(ctx context.Context, tx pgx.Tx, query string, args ...any) ([]string, error) {
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func containsString(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}
