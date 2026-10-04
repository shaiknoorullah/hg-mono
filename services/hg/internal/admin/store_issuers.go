package admin

// store_issuers.go keeps the catalog in step with the issuing-body registry.
//
// A certificate vouches for a restaurant only while its issuing body is ACCEPTED
// (halal_certification_at, migration 00033_halal_certified_now.sql, and
// halal_refresh_restaurant_status, migration 00009_halal.sql). When a super admin
// changes a body's status, SetIssuingBodyStatus calls resyncIssuerRestaurantsTx in
// the same transaction, so when it commits the catalog, the order path and the
// stored restaurant row agree: every restaurant holding a certificate from the
// body has its stored halal state derived again, a LIVE restaurant the platform
// can no longer vouch for is delisted (hidden, no badge, menu not locked: the
// recommended answer in https://github.com/shaiknoorullah/hg-mono/issues/269),
// and a restaurant delisted only for its certificate is listed again once the
// body is accepted again, or once a current certificate from an accepted body
// is approved (relistOnApprovalTx, called by Decide). Each change is audited,
// its owners and managers are told through the notification outbox, and a
// body's status change alerts the admin:ops channel.
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/346

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/catalog"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// The delisting reasons for a certificate that no longer vouches. They are the
// words the halal expiry job (https://github.com/shaiknoorullah/hg-mono/pull/274)
// and the admin account actions (https://github.com/shaiknoorullah/hg-mono/pull/335)
// use, so whichever of them reinstates or relists the restaurant clears them.
const (
	delistHalalUnverified = "HALAL_CERTIFICATE_UNVERIFIED"
	delistHalalExpired    = "HALAL_CERTIFICATE_EXPIRED"
)

// issuerSystemPrincipal names the part of the platform that delists and relists
// a restaurant when its certificate's issuing body stops or starts being
// accepted. It is not a person: the super admin's decision is about the body,
// and this principal applies its consequence to each restaurant. The audit rows
// carry it beside the super admin who caused it.
//
// TODO(https://github.com/shaiknoorullah/hg-mono/pull/335): once the account-state
// single writer lands, a restaurant's account_state changes only with a history
// row naming a system principal and one reason (account_state_rule, migration
// 00035_account_state_single_writer.sql). setIssuerListingTx is the one place
// this file writes the listing, so adopting it is one change there: record the
// change as this principal (delisting with HALAL_CERTIFICATE_UNVERIFIED or
// HALAL_CERTIFICATE_EXPIRED), and relist as that pull request's HALAL_RENEWAL
// principal. Tracked in https://github.com/shaiknoorullah/hg-mono/issues/355.
const issuerSystemPrincipal = "HALAL_ISSUER"

// Notification kinds. notification.kind is a plain string (contract
// Notification.kind), so new kinds need no migration.
const (
	// A body's acceptance was withdrawn, or given again.
	KindHalalIssuerWithdrawn  notify.Kind = "HALAL_ISSUER_WITHDRAWN"
	KindHalalIssuerReaccepted notify.Kind = "HALAL_ISSUER_REACCEPTED"
	// A certificate approval listed the restaurant again (or, failing closed,
	// found it could not vouch for it).
	KindRestaurantRelisted notify.Kind = "RESTAURANT_RELISTED"
	KindRestaurantDelisted notify.Kind = "RESTAURANT_DELISTED"
)

// alertKindIssuerStatus is the admin.alert kind for one restaurant affected by
// a body's status change: the category the issuing-body registry spec raises a
// case under (docs/spec/05-admin.md, "A-16 — Halal issuing-body registry",
// rule 2). Support cases do not exist yet
// (https://github.com/shaiknoorullah/hg-mono/issues/273), so the alert stands in.
const alertKindIssuerStatus = "HALAL_ISSUER_STATUS_CHANGE"

// The owners' messages go by email and in-app, like the halal expiry job's.
// TODO(https://github.com/shaiknoorullah/hg-mono/pull/350): the email goes out
// through that pull request's generic template until it has one of its own.
var issuerMessageChannels = []notify.Channel{notify.ChannelEmail, notify.ChannelInApp}

// Enqueuer is the write side of the notification outbox (*notify.Enqueuer): it
// writes the notification row and its delivery job in the caller's transaction.
type Enqueuer interface {
	Enqueue(ctx context.Context, tx pgx.Tx, n notify.New) (notify.EnqueueResult, error)
}

// errNotifierNotWired refuses a status change that has restaurant owners to tell
// when the repository was built without the notification outbox: the change and
// the message commit together or not at all.
var errNotifierNotWired = errors.New("admin: issuing-body status change has owners to notify, but no notification outbox is wired (Repo.WithNotifier)")

// WithNotifier gives the repository the notification outbox that status changes
// of issuing bodies write to. cmd/hg/main.go wires notify.Client's Enqueuer.
func (r *Repo) WithNotifier(e Enqueuer) *Repo {
	r.notify = e
	return r
}

// halalCurrent reports whether a halal display state vouches for a restaurant.
// It is the catalog's rule, so a restaurant is listed exactly when a customer
// could see it. Anything else, an empty value included, does not.
func halalCurrent(state string) bool { return catalog.IsHalalVisible(state) }

// isHalalDelistReason reports whether a delisting reason is the certificate's
// own, which a current certificate clears.
func isHalalDelistReason(reason string) bool {
	return reason == delistHalalUnverified || reason == delistHalalExpired
}

// issuerListing is where a restaurant's listing lands once its halal state has
// been derived again after an issuing body's status changed. stored is the
// restaurant row's halal_status after the refresh, now the state as of now from
// halal_certification_at; the restaurant is vouched for only when both are.
//
//   - Not vouched for: the certificate's reason is added (UNVERIFIED when no
//     certificate counts, EXPIRED when the one that counts has lapsed) and a
//     LIVE restaurant becomes DELISTED.
//   - Vouched for: the certificate's reasons are cleared, and a DELISTED
//     restaurant that had one of them, and has no other reason and a finished
//     onboarding, is LIVE again.
//
// Only LIVE and DELISTED move. A suspended, banned, deactivated, closed or
// pending restaurant keeps its state and its reasons: an admin's action or the
// end of onboarding decides those, from the certificate as it is then.
func issuerListing(from string, reasons []string, stored, now string, canGoLive bool) (string, []string) {
	out := make([]string, 0, len(reasons)+1)
	out = append(out, reasons...)
	if from != "LIVE" && from != "DELISTED" {
		return from, out
	}
	if !halalCurrent(stored) || !halalCurrent(now) {
		state := now
		if halalCurrent(now) {
			state = stored
		}
		reason := delistHalalUnverified
		if state == "EXPIRED" {
			reason = delistHalalExpired
		}
		if !containsString(out, reason) {
			out = append(out, reason)
		}
		return "DELISTED", out
	}
	kept := out[:0]
	cleared := false
	for _, r := range out {
		if isHalalDelistReason(r) {
			cleared = true
			continue
		}
		kept = append(kept, r)
	}
	if from == "DELISTED" && cleared && len(kept) == 0 && canGoLive {
		return "LIVE", kept
	}
	return from, kept
}

func containsString(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// issuerRestaurant is one restaurant holding a certificate from the body, read
// under its row lock.
type issuerRestaurant struct {
	id        string
	name      string
	state     string
	reasons   []string
	halal     string
	canGoLive bool
}

// issuerChange is what happened to one restaurant.
type issuerChange struct {
	issuerRestaurant
	toState   string
	toReasons []string
	toHalal   string
}

func (c issuerChange) delisted() bool { return c.state == "LIVE" && c.toState == "DELISTED" }
func (c issuerChange) relisted() bool { return c.state == "DELISTED" && c.toState == "LIVE" }
func (c issuerChange) changed() bool {
	return c.toState != c.state || c.toHalal != c.halal
}

// issuerRestaurantColumns reads an issuerRestaurant from a `restaurant` aliased r.
const issuerRestaurantColumns = `r.id::text, r.display_name, r.account_state::text, r.delist_reasons,
       r.halal_status::text,
       r.onboarding_state = 'ACTIVE' AND r.location IS NOT NULL AND r.province IS NOT NULL`

func (ir *issuerRestaurant) scanTargets() []any {
	return []any{&ir.id, &ir.name, &ir.state, &ir.reasons, &ir.halal, &ir.canGoLive}
}

// listingCause is what moved a restaurant's listing: a super admin changing an
// issuing body's status, or an admin approving a certificate.
type listingCause struct {
	// body is the body whose status changed, or that issued the approved
	// certificate.
	body issuingBodyRow
	// decidedAt is when the body's status changed (status changes only).
	decidedAt time.Time
	// certificateID is the approved certificate (approvals only).
	certificateID string
}

func (c listingCause) approval() bool { return c.certificateID != "" }

// resyncIssuerRestaurantsTx applies a body's new status to every restaurant
// holding a certificate from it, inside the transaction that changed the
// status, after the body row is locked and updated.
//
// Lock order: the body row first (SetIssuingBodyStatus), then the restaurants
// FOR UPDATE in id order, the order a certificate approval takes them in
// (Decide locks the body FOR SHARE, and the certificate trigger then writes the
// restaurant). Two status changes sharing restaurants lock them in the same id
// order, so they queue rather than deadlock. Orders hold the restaurant row FOR
// SHARE until they commit (orders.LockOrderableRestaurant), so an order in
// flight either commits first and is then refused by the restaurant's own
// accept check, or waits and is refused.
func (r *Repo) resyncIssuerRestaurantsTx(ctx context.Context, tx pgx.Tx, actor auditActor, body issuingBodyRow, decidedAt time.Time) error {
	rows, err := tx.Query(ctx, `
SELECT `+issuerRestaurantColumns+`
  FROM restaurant r
 WHERE r.deleted_at IS NULL
   AND r.id IN (SELECT hc.restaurant_id FROM halal_certificate hc
                 WHERE hc.issuing_body_id = $1 AND hc.deleted_at IS NULL)
 ORDER BY r.id
   FOR UPDATE OF r`, body.ID)
	if err != nil {
		return fmt.Errorf("lock the restaurants holding certificates from body %s: %w", body.ID, err)
	}
	var affected []issuerRestaurant
	for rows.Next() {
		var ir issuerRestaurant
		if err := rows.Scan(ir.scanTargets()...); err != nil {
			rows.Close()
			return err
		}
		affected = append(affected, ir)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, ir := range affected {
		ch, err := setIssuerListingTx(ctx, tx, ir)
		if err != nil {
			return err
		}
		if !ch.changed() {
			continue
		}
		if err := r.reportListingChangeTx(ctx, tx, actor, listingCause{body: body, decidedAt: decidedAt}, ch); err != nil {
			return err
		}
	}
	return nil
}

// relistOnApprovalTx moves a restaurant's listing once a certificate of it is
// approved, in the approval's transaction: a restaurant delisted only because
// no certificate vouched for it (its body was withdrawn, or its certificate
// lapsed) is listed again, as the owners were told it would be. The approval
// itself is audited by Decide; this audits and announces only a change of
// listing.
func (r *Repo) relistOnApprovalTx(ctx context.Context, tx pgx.Tx, actor auditActor, cert certRow) error {
	cause := listingCause{certificateID: cert.ID}
	if cert.IssuingBodyID != nil {
		if err := tx.QueryRow(ctx, `SELECT id::text, name, status::text FROM halal_issuing_body WHERE id = $1`,
			*cert.IssuingBodyID).Scan(&cause.body.ID, &cause.body.Name, &cause.body.Status); err != nil {
			return fmt.Errorf("read the issuing body of certificate %s: %w", cert.ID, err)
		}
	}
	var ir issuerRestaurant
	err := tx.QueryRow(ctx, `SELECT `+issuerRestaurantColumns+`
  FROM restaurant r WHERE r.id = $1 AND r.deleted_at IS NULL FOR UPDATE`, cert.RestaurantID).Scan(ir.scanTargets()...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("lock restaurant %s: %w", cert.RestaurantID, err)
	}
	ch, err := setIssuerListingTx(ctx, tx, ir)
	if err != nil {
		return err
	}
	if ch.toState == ch.state {
		return nil
	}
	return r.reportListingChangeTx(ctx, tx, actor, cause, ch)
}

// setIssuerListingTx derives one restaurant's stored halal state again and
// moves its listing to match. It is the only code in this file that writes a
// restaurant's account_state or delist_reasons (see issuerSystemPrincipal).
func setIssuerListingTx(ctx context.Context, tx pgx.Tx, ir issuerRestaurant) (issuerChange, error) {
	// The stored state's own derivation, the one the certificate trigger runs.
	if _, err := tx.Exec(ctx, `SELECT halal_refresh_restaurant_status($1::uuid)`, ir.id); err != nil {
		return issuerChange{}, fmt.Errorf("derive the halal state of restaurant %s: %w", ir.id, err)
	}
	var stored, now *string
	var state string
	var reasons []string
	if err := tx.QueryRow(ctx, `
SELECT r.halal_status::text, hn.halal_status::text, r.account_state::text, r.delist_reasons
  FROM restaurant r
  LEFT JOIN LATERAL halal_certification_at(r.id, now()) hn ON true
 WHERE r.id = $1`, ir.id).Scan(&stored, &now, &state, &reasons); err != nil {
		return issuerChange{}, fmt.Errorf("read the halal state of restaurant %s: %w", ir.id, err)
	}
	ch := issuerChange{issuerRestaurant: ir, toHalal: deref(stored)}
	ch.toState, ch.toReasons = issuerListing(state, reasons, deref(stored), deref(now), ir.canGoLive)
	if ch.toState != state || !sameStrings(ch.toReasons, reasons) {
		if _, err := tx.Exec(ctx, `
UPDATE restaurant SET account_state = $2::restaurant_account_state, delist_reasons = $3
 WHERE id = $1`, ir.id, ch.toState, ch.toReasons); err != nil {
			return issuerChange{}, fmt.Errorf("move the listing of restaurant %s to %s: %w", ir.id, ch.toState, err)
		}
	}
	return ch, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// reportListingChangeTx writes the audit row and the owners' and managers'
// messages for one restaurant whose halal state or listing changed, and, when a
// body's status caused it, the ops alert; all in the transaction that changed it.
func (r *Repo) reportListingChangeTx(ctx context.Context, tx pgx.Tx, actor auditActor, cause listingCause, ch issuerChange) error {
	action := "restaurant.halal_status_changed"
	var reasonCode *string
	switch {
	case ch.delisted():
		action = "restaurant.delisted"
		for _, rc := range ch.toReasons {
			if isHalalDelistReason(rc) {
				reasonCode = ptr(rc)
			}
		}
	case ch.relisted():
		action = "restaurant.relisted"
	}
	after := map[string]any{
		"account_state": ch.toState, "delist_reasons": ch.toReasons, "halal_status": ch.toHalal,
		"issuing_body_id": cause.body.ID, "system_principal": issuerSystemPrincipal,
	}
	if cause.approval() {
		after["certificate_id"] = cause.certificateID
	} else {
		after["issuing_body_status"] = cause.body.Status
	}
	if err := writeAudit(ctx, tx, auditEntry{
		actor:       actor,
		action:      action,
		subjectType: "RESTAURANT",
		subjectID:   ptr(ch.id),
		outcome:     "SUCCESS",
		reasonCode:  reasonCode,
		before: map[string]any{
			"account_state": ch.state, "delist_reasons": ch.reasons, "halal_status": ch.halal,
		},
		after: after,
	}); err != nil {
		return fmt.Errorf("audit restaurant %s: %w", ch.id, err)
	}

	recipients, err := restaurantOwnersAndManagersTx(ctx, tx, ch.id)
	if err != nil {
		return err
	}
	if len(recipients) > 0 && r.notify == nil {
		return errNotifierNotWired
	}
	for _, acct := range recipients {
		if _, err := r.notify.Enqueue(ctx, tx, listingMessage(acct, cause, ch)); err != nil {
			return fmt.Errorf("notify %s about restaurant %s: %w", acct, ch.id, err)
		}
	}
	if cause.approval() {
		return nil
	}

	severity := "WARNING"
	if cause.body.Status == "ACCEPTED" && halalCurrent(ch.toHalal) {
		severity = "INFO"
	}
	payload, err := json.Marshal(map[string]any{
		"severity":     severity,
		"kind":         alertKindIssuerStatus,
		"subject_type": "RESTAURANT",
		"subject_id":   ch.id,
		"message": fmt.Sprintf("%s: halal state %s, now %s; listing %s, now %s. Its certifying body %s was set to %s.",
			ch.name, ch.halal, ch.toHalal, ch.state, ch.toState, cause.body.Name, cause.body.Status),
		"at": cause.decidedAt.UTC().Format(time.RFC3339),
	})
	if err != nil {
		return err
	}
	if _, _, err := realtime.EmitInTx(ctx, tx, "admin:ops", "admin.alert", 1, nil, payload, nil, nil); err != nil {
		return fmt.Errorf("alert ops about restaurant %s: %w", ch.id, err)
	}
	return nil
}

// restaurantOwnersAndManagersTx lists the accounts that run a restaurant: its
// owners and managers, not front-of-house staff, as the halal expiry job does.
func restaurantOwnersAndManagersTx(ctx context.Context, tx pgx.Tx, restaurantID string) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `
SELECT DISTINCT account_id FROM account_role
 WHERE scope_type = 'RESTAURANT' AND scope_id = $1 AND revoked_at IS NULL
   AND role IN ('RESTAURANT_OWNER', 'RESTAURANT_MANAGER')
 ORDER BY account_id`, restaurantID)
	if err != nil {
		return nil, fmt.Errorf("list the owners of restaurant %s: %w", restaurantID, err)
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

// listingMessage is the message to one owner or manager. It quotes the body's
// name and the restaurant's, never the super admin's justification (free text
// stays out of messages), states no halal status word and carries no colour
// (notify/doc.go, "Halal invariants that touch this package").
func listingMessage(account uuid.UUID, cause listingCause, ch issuerChange) notify.New {
	body := cause.body
	n := notify.New{
		AccountID:   account,
		RoleContext: notify.RoleRestaurant,
		Channels:    issuerMessageChannels,
		Data: map[string]any{
			"restaurant_id":   ch.id,
			"issuing_body_id": body.ID,
			"account_state":   ch.toState,
		},
		// One message per recipient per decision, however often it is retried.
		DedupeKey: fmt.Sprintf("halal_issuing_body:%s:%d:%s", body.ID, cause.decidedAt.UnixNano(), ch.id),
		GroupKey:  "restaurant_listing:" + ch.id,
	}
	if cause.approval() {
		n.Data["certificate_id"] = cause.certificateID
		n.DedupeKey = fmt.Sprintf("halal_certificate_approved:%s:%s", cause.certificateID, ch.id)
		if ch.relisted() {
			n.Kind, n.Priority = KindRestaurantRelisted, notify.PriorityNormal
			n.Title = "Your restaurant is listed again"
			n.Body = fmt.Sprintf("Your halal certificate from %s was approved, so %s is visible to customers "+
				"and can take orders.", body.Name, ch.name)
			return n
		}
		n.Kind, n.Priority = KindRestaurantDelisted, notify.PriorityHigh
		n.Title = "Your restaurant is hidden from customers"
		n.Body = fmt.Sprintf("HalalGoes cannot vouch for the halal certificate of %s now, so it is hidden from "+
			"customers and cannot take new orders. Your menu is not locked.", ch.name)
		return n
	}
	n.Data["issuing_body_status"] = body.Status
	n.Kind, n.Priority = KindHalalIssuerWithdrawn, notify.PriorityHigh
	if body.Status == "ACCEPTED" {
		n.Kind = KindHalalIssuerReaccepted
	}
	switch {
	case ch.relisted():
		n.Priority = notify.PriorityNormal
		n.Title = "Your restaurant is listed again"
		n.Body = fmt.Sprintf("HalalGoes accepts halal certificates from %s again, so %s is visible "+
			"to customers and can take orders.", body.Name, ch.name)
	case halalCurrent(ch.toHalal) && body.Status == "ACCEPTED":
		n.Priority = notify.PriorityNormal
		n.Title = "Your halal certificate counts again"
		n.Body = fmt.Sprintf("HalalGoes accepts halal certificates from %s again.", body.Name)
	case halalCurrent(ch.toHalal):
		n.Priority = notify.PriorityNormal
		n.Title = "A halal certificate of yours no longer counts"
		n.Body = fmt.Sprintf("HalalGoes no longer accepts halal certificates from %s. %s stays listed "+
			"on another certificate of yours that HalalGoes accepts.", body.Name, ch.name)
	case ch.delisted():
		n.Title = "Your restaurant is hidden from customers"
		n.Body = fmt.Sprintf("HalalGoes no longer accepts halal certificates from %s, so %s is hidden from "+
			"customers and cannot take new orders. It is listed again once a current certificate from a "+
			"certifying body HalalGoes accepts is approved. Your menu is not locked.", body.Name, ch.name)
	default:
		n.Title = "Your halal certificate no longer counts"
		n.Body = fmt.Sprintf("HalalGoes cannot vouch for the halal certificate of %s now: upload a current "+
			"certificate from a certifying body HalalGoes accepts.", ch.name)
	}
	return n
}
