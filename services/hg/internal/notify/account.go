package notify

import (
	"fmt"

	"github.com/google/uuid"
)

// Kinds for the notices an admin account action sends
// (https://github.com/shaiknoorullah/hg-mono/issues/253). The routing, templates
// and real transports for every non-order message are
// https://github.com/shaiknoorullah/hg-mono/issues/248; until then these rows are
// written to the inbox and their delivery jobs are queued, like every other
// notification.
const (
	KindAccountSuspended   Kind = "ACCOUNT_SUSPENDED"
	KindAccountReinstated  Kind = "ACCOUNT_REINSTATED"
	KindAccountBanned      Kind = "ACCOUNT_BANNED"
	KindAccountDeactivated Kind = "ACCOUNT_DEACTIVATED"
	KindRestaurantDelisted Kind = "RESTAURANT_DELISTED"
)

// AccountStateNotice is the input to NotifyAccountStateChanged: one applied
// account action, for one recipient. The caller passes the display name it
// already has; the notice never carries the staff member's free-text reason,
// only fixed wording (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-29--in-flight-order-treatment-on-entity-state-change,
// rule 5: reasons come from a fixed catalogue, never free text).
type AccountStateNotice struct {
	// EventID is the account history row's id. Each recipient gets the notice
	// once per event, however often the caller retries.
	EventID     uuid.UUID
	AccountID   uuid.UUID
	RoleContext RoleContext // RoleRestaurant, RoleRider or RoleCustomer
	Action      string      // contracts/openapi.yaml AccountAction
	ToState     string      // the account's state after the action
	// DisplayName is the restaurant's name, for restaurant notices.
	DisplayName string
}

// NotifyAccountStateChanged builds the notice for one account action. Riders get
// a push and an inbox row (the platform spec's router row for a paused rider being
// reinstated); restaurants an email and an inbox row; customers a push, a text
// message if the push does not land, and an inbox row. ok is false when the
// action sends no notice.
func NotifyAccountStateChanged(e AccountStateNotice) (n New, ok bool) {
	var kind Kind
	var title, body string
	priority := PriorityHigh

	switch e.RoleContext {
	case RoleRider:
		switch {
		case e.Action == "REINSTATE":
			kind, priority = KindAccountReinstated, PriorityNormal
			title = "You can go online again"
			body = "HalalGoes has reinstated your rider account. Go online to get delivery offers."
		case e.Action == "CONFIRM_BAN":
			kind = KindAccountBanned
			title = "Your rider account is closed"
			body = "HalalGoes has permanently stopped your rider account. You will still be paid what you have earned. Contact support if you think this is wrong."
		case e.Action == "DEACTIVATE":
			kind = KindAccountDeactivated
			title = "Your rider account is deactivated"
			body = "We have deactivated your rider account as you asked. You will still be paid what you have earned. Contact support to reactivate it."
		case e.ToState == "SUSPENDED":
			kind = KindAccountSuspended
			title = "Your rider account is paused"
			body = "HalalGoes has paused your account, so you will not get new delivery offers. If you are on a delivery, finish it: you will be paid for it. Contact support to find out more."
		default:
			return New{}, false
		}
		n = New{Channels: []Channel{ChannelPush, ChannelInApp}}

	case RoleRestaurant:
		name := e.DisplayName
		if name == "" {
			name = "Your restaurant"
		}
		switch {
		case e.Action == "REINSTATE" && e.ToState == "LIVE":
			kind, priority = KindAccountReinstated, PriorityNormal
			title = fmt.Sprintf("%s is back on HalalGoes", name)
			body = fmt.Sprintf("HalalGoes has reinstated %s. Customers can find it and order again.", name)
		case e.Action == "REINSTATE":
			kind, priority = KindAccountReinstated, PriorityNormal
			title = fmt.Sprintf("%s is reinstated but not yet listed", name)
			body = fmt.Sprintf("HalalGoes has reinstated %s, but customers cannot see it until its halal certificate is current and nothing else holds it back. Contact support to find out what is left.", name)
		case e.Action == "CONFIRM_BAN":
			kind = KindAccountBanned
			title = fmt.Sprintf("%s is banned from HalalGoes", name)
			body = fmt.Sprintf("HalalGoes has permanently removed %s. Contact support about any money still owed.", name)
		case e.Action == "DEACTIVATE":
			kind = KindAccountDeactivated
			title = fmt.Sprintf("%s is deactivated", name)
			body = fmt.Sprintf("We have deactivated %s as you asked. Contact support to reactivate it.", name)
		case e.Action == "DELIST":
			kind = KindRestaurantDelisted
			title = fmt.Sprintf("%s is hidden from customers", name)
			body = fmt.Sprintf("HalalGoes has taken %s out of customer listings until the problem is fixed. You can still edit your menu and opening hours. Contact support to find out more.", name)
		case e.ToState == "SUSPENDED":
			kind = KindAccountSuspended
			title = fmt.Sprintf("%s is suspended", name)
			body = fmt.Sprintf("HalalGoes has suspended %s. Customers cannot find it or order from it, and its menu is locked. Orders you have already accepted carry on. Contact support to find out more.", name)
		default:
			return New{}, false
		}
		n = New{Channels: []Channel{ChannelEmail, ChannelInApp}}

	case RoleCustomer:
		switch {
		case e.Action == "REINSTATE":
			kind, priority = KindAccountReinstated, PriorityNormal
			title = "Your HalalGoes account is active again"
			body = "You can sign in and order again."
		case e.Action == "CONFIRM_BAN":
			kind = KindAccountBanned
			title = "Your HalalGoes account is closed"
			body = "HalalGoes has permanently closed your account. Any refund you are owed will still be paid."
		case e.ToState == "SUSPENDED":
			kind = KindAccountSuspended
			title = "Your HalalGoes account is suspended"
			body = "You cannot sign in or place orders for now. Any refund you are owed will still be paid. Contact support to find out more."
		default:
			return New{}, false
		}
		n = New{Channels: standardChannels()}

	default:
		return New{}, false
	}

	n.AccountID = e.AccountID
	n.RoleContext = e.RoleContext
	n.Kind = kind
	n.Title = title
	n.Body = body
	n.Priority = priority
	n.DedupeKey = "account_state:" + e.EventID.String()
	n.GroupKey = "account_state"
	n.Data = map[string]any{"action": e.Action, "state": e.ToState}
	return n, true
}
