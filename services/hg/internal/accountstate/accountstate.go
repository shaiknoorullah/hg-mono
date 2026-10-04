// Package accountstate holds the rules for the admin actions that suspend,
// reinstate, delist, deactivate or ban a restaurant, a rider or a customer
// (https://github.com/shaiknoorullah/hg-mono/issues/253). It is pure: no
// database, no clock it reads itself, no HTTP. internal/admin applies these
// rules inside one transaction; other modules ask it questions such as "is this
// restaurant's menu locked?".
//
// The specs it implements:
//   - restaurant actions: https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-22--restaurant-account-state-actions-suspend--ban--deactivate--reinstate--delist
//   - rider actions: https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-27--rider-account-state-actions
//   - customer actions: https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-28--customer-account-state-actions
//   - what happens to orders already in progress: https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-29--in-flight-order-treatment-on-entity-state-change
//
// "Suspend", "ban", "deactivate" and "delist" are never synonyms. Suspending is a
// reversible penalty. A ban is permanent and needs two people: an admin or super
// admin proposes it, which suspends the account, and a different super admin
// confirms it within 7 days or the proposal lapses. Deactivating is a voluntary
// exit at the partner's own request. Delisting takes a restaurant out of customer
// listings without a penalty. Reinstating undoes any of them.
package accountstate

import (
	"fmt"
	"time"
)

// Subject is whose account an action changes. The values are the contract's
// AccountSubjectType.
type Subject string

const (
	Restaurant Subject = "RESTAURANT"
	Rider      Subject = "RIDER"
	Customer   Subject = "CUSTOMER"
)

// Action is one named account action: the contract's AccountAction.
type Action string

const (
	Suspend    Action = "SUSPEND"
	Reinstate  Action = "REINSTATE"
	Delist     Action = "DELIST"
	ProposeBan Action = "PROPOSE_BAN"
	ConfirmBan Action = "CONFIRM_BAN"
	Deactivate Action = "DEACTIVATE"
)

// allActions is every action, in the order the "allowed actions" list reports them.
var allActions = []Action{Suspend, Reinstate, Delist, ProposeBan, ConfirmBan, Deactivate}

// The account states. A restaurant uses RestaurantAccountState, a rider
// RiderAccountStatus and a customer AccountStatus (all in contracts/openapi.yaml).
const (
	StatePending     = "PENDING"
	StateLive        = "LIVE"
	StateDelisted    = "DELISTED"
	StateSuspended   = "SUSPENDED"
	StateBanned      = "BANNED"
	StateDeactivated = "DEACTIVATED"
	StateClosed      = "CLOSED"
	StateActive      = "ACTIVE"
	StateDeleted     = "DELETED"
)

// BanProposalWindow is how long a proposed ban waits for a second person. After
// it, the proposal lapses and the account stays suspended. The database refuses
// a confirmation outside it too (migration 00034).
const BanProposalWindow = 7 * 24 * time.Hour

// edge is one row of a subject's transition table.
type edge struct {
	from []string
	to   string
	// superAdminOnly marks an edge only a super admin may take: confirming a ban,
	// and reinstating a banned account.
	superAdminOnly bool
	// permission is the admin spec's permission name for this edge, reported on a
	// 403 (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#72-restaurant-domain).
	permission string
}

// table is the state machine for each subject. A (state, action) pair absent
// from it is an illegal transition.
var table = map[Subject]map[Action][]edge{
	Restaurant: {
		Suspend:    {{from: []string{StateLive, StateDelisted}, to: StateSuspended, permission: "restaurant.suspend"}},
		Delist:     {{from: []string{StateLive}, to: StateDelisted, permission: "restaurant.delist"}},
		ProposeBan: {{from: []string{StateLive, StateDelisted, StateSuspended}, to: StateSuspended, permission: "restaurant.propose_ban"}},
		ConfirmBan: {{from: []string{StateSuspended}, to: StateBanned, superAdminOnly: true, permission: "restaurant.confirm_ban"}},
		Deactivate: {{from: []string{StateLive, StateDelisted}, to: StateDeactivated, permission: "restaurant.deactivate_on_request"}},
		Reinstate: {
			{from: []string{StateSuspended, StateDeactivated, StateDelisted}, to: StateLive, permission: "restaurant.reinstate"},
			{from: []string{StateBanned}, to: StateLive, superAdminOnly: true, permission: "restaurant.unban"},
		},
	},
	Rider: {
		Suspend:    {{from: []string{StateActive}, to: StateSuspended, permission: "rider.suspend"}},
		ProposeBan: {{from: []string{StateActive, StateSuspended}, to: StateSuspended, permission: "rider.propose_ban"}},
		ConfirmBan: {{from: []string{StateSuspended}, to: StateBanned, superAdminOnly: true, permission: "rider.confirm_ban"}},
		Deactivate: {{from: []string{StateActive, StateSuspended}, to: StateDeactivated, permission: "rider.deactivate_on_request"}},
		Reinstate: {
			{from: []string{StateSuspended, StateDeactivated}, to: StateActive, permission: "rider.reinstate"},
			{from: []string{StateBanned}, to: StateActive, superAdminOnly: true, permission: "rider.unban"},
		},
	},
	Customer: {
		Suspend:    {{from: []string{StateActive}, to: StateSuspended, permission: "customer.suspend"}},
		ProposeBan: {{from: []string{StateActive, StateSuspended}, to: StateSuspended, permission: "customer.propose_ban"}},
		ConfirmBan: {{from: []string{StateSuspended}, to: StateBanned, superAdminOnly: true, permission: "customer.confirm_ban"}},
		Reinstate: {
			{from: []string{StateSuspended}, to: StateActive, permission: "customer.reinstate"},
			{from: []string{StateBanned}, to: StateActive, superAdminOnly: true, permission: "customer.unban"},
		},
	},
}

// Request is one proposed action against one account's current state.
type Request struct {
	Subject Subject
	From    string
	Action  Action
	// BanProposed is true when the account's latest action is a ban proposal that
	// has not lapsed (less than BanProposalWindow old). A ban can be confirmed only
	// then, and cannot be proposed twice.
	BanProposed bool
}

// Decision is what a legal action does.
type Decision struct {
	// To is the state the action moves the account to. Reinstating a restaurant
	// says LIVE here; the caller returns it to DELISTED instead when its halal
	// certificate is not current or a delisting reason remains (ReinstatedState).
	To string
	// SuperAdminOnly is true when only a super admin may take this action.
	SuperAdminOnly bool
	// Permission names the permission the action needs, for a 403's details.
	Permission string
}

// IllegalTransitionError is an action that is not legal from the current state.
type IllegalTransitionError struct {
	Subject Subject
	From    string
	Action  Action
	// Allowed lists the actions that are legal from From, so the admin console can
	// offer only those.
	Allowed []Action
	// Why says, in plain words, what is wrong.
	Why string
}

func (e *IllegalTransitionError) Error() string {
	return fmt.Sprintf("illegal account action: %s %s from %s: %s", e.Subject, e.Action, e.From, e.Why)
}

// Decide checks one action against the subject's state machine and returns
// where it leads, or an *IllegalTransitionError.
func Decide(r Request) (Decision, error) {
	d, why, ok := lookup(r)
	if !ok {
		return Decision{}, &IllegalTransitionError{
			Subject: r.Subject, From: r.From, Action: r.Action,
			Allowed: AllowedActions(r.Subject, r.From, r.BanProposed), Why: why,
		}
	}
	return d, nil
}

func lookup(r Request) (Decision, string, bool) {
	edges, ok := table[r.Subject][r.Action]
	if !ok {
		return Decision{}, fmt.Sprintf("%s does not apply to a %s", r.Action, r.Subject), false
	}
	switch {
	case r.Action == ConfirmBan && !r.BanProposed:
		return Decision{}, "there is no ban proposal less than 7 days old to confirm", false
	case r.Action == ProposeBan && r.BanProposed:
		return Decision{}, "a ban is already proposed and waiting for confirmation", false
	}
	for _, e := range edges {
		for _, f := range e.from {
			if f == r.From {
				return Decision{To: e.to, SuperAdminOnly: e.superAdminOnly, Permission: e.permission}, "", true
			}
		}
	}
	return Decision{}, fmt.Sprintf("%s is not possible from %s", r.Action, r.From), false
}

// AllowedActions lists the actions legal from a state, in a stable order.
func AllowedActions(s Subject, from string, banProposed bool) []Action {
	out := []Action{}
	for _, a := range allActions {
		if _, _, ok := lookup(Request{Subject: s, From: from, Action: a, BanProposed: banProposed}); ok {
			out = append(out, a)
		}
	}
	return out
}

// BanPending reports whether a ban proposed at proposedAt is still waiting at
// now: true for less than BanProposalWindow, then it lapses.
func BanPending(proposedAt, now time.Time) bool {
	return now.Before(proposedAt.Add(BanProposalWindow))
}

// MenuLocked reports whether a restaurant in this account state may have its
// menu changed by anyone, admins included. Suspended and banned restaurants are
// locked; a delisted one is not, so it can get its menu ready to be listed again
// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01).
// The lock follows the state, never the reason. Enforcing it on each menu write
// is https://github.com/shaiknoorullah/hg-mono/issues/256.
func MenuLocked(restaurantState string) bool {
	return restaurantState == StateSuspended || restaurantState == StateBanned
}

// RevokesSessions reports whether an action ends every sign-in session of the
// people it affects. Only a confirmed ban does: a suspended rider must still
// finish a delivery and see earnings, and a suspended customer's tokens already
// stop working because their account status is no longer ACTIVE.
func RevokesSessions(a Action) bool { return a == ConfirmBan }
