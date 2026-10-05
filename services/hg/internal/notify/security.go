package notify

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Security alerts (issue #348): the email an account gets when its password
// is changed or reset, or when it signs in on a device it has not used
// before (docs/spec/01-platform.md, "P-24 — Notification router": new-device
// login and password changed go by email to every role). The auth module
// enqueues it in the transaction that makes the change, beside the realtime
// account.security_event.
//
// The email has no link and no button, so it can never be used to sign anyone
// in, and it never names an IP address: only what happened, when, the coarse
// place when the session has one, and what to do if it wasn't the reader. It
// carries no Overrides, so it goes only to the account's verified email
// address (PgAccountLookup), through the same sender as every other email,
// which outside production delivers only to the allow-list (AllowListSender).

// KindSecurityAlert is notification.kind for the three security alerts.
const KindSecurityAlert Kind = "ACCOUNT_SECURITY_ALERT"

// SecurityAlertKind is what happened.
type SecurityAlertKind string

const (
	// SecurityPasswordChanged: the signed-in account changed its password.
	SecurityPasswordChanged SecurityAlertKind = "password_changed"
	// SecurityPasswordReset: the password was set with an emailed reset link.
	SecurityPasswordReset SecurityAlertKind = "password_reset"
	// SecurityNewDevice: a sign-in from a device the account has not used.
	SecurityNewDevice SecurityAlertKind = "new_device_login"
)

// SecurityAlert is the input to SecurityAlertEmail.
type SecurityAlert struct {
	AccountID uuid.UUID
	Role      RoleContext
	Kind      SecurityAlertKind
	// Ref names this one change, so a retried transaction sends one email:
	// the new session's id for a sign-in, the time the password was set for
	// a change or reset.
	Ref string
	At  time.Time
	// Place is the session's coarse place (session.ip_city) when known;
	// empty otherwise. Never an IP address.
	Place string
	Zone  *time.Location
}

// SecurityAlertEmail builds the security alert for one change.
func SecurityAlertEmail(a SecurityAlert) (New, error) {
	if a.AccountID == uuid.Nil || a.Ref == "" || a.At.IsZero() {
		return New{}, fmt.Errorf("notify: a security alert needs an account, a ref and a time")
	}
	var heading, summary, ifNotYou string
	switch a.Kind {
	case SecurityPasswordChanged:
		heading = "Your HalalGoes password was changed"
		summary = "The password for your HalalGoes account was changed, and every device was signed out."
		ifNotYou = "If this wasn't you, use \"Forgot password\" on the HalalGoes sign-in page now to choose a new password, then contact HalalGoes support."
	case SecurityPasswordReset:
		heading = "Your HalalGoes password was reset"
		summary = "The password for your HalalGoes account was reset with a link sent to this address, and every device was signed out."
		ifNotYou = "If this wasn't you, use \"Forgot password\" on the HalalGoes sign-in page now to choose a new password, check who can read this mailbox, then contact HalalGoes support."
	case SecurityNewDevice:
		heading = "New sign-in to your HalalGoes account"
		summary = "Your HalalGoes account was signed in on a device it has not used before."
		ifNotYou = "If this wasn't you, sign that device out from the list of signed-in devices in your account, then contact HalalGoes support."
	default:
		return New{}, fmt.Errorf("notify: unknown security alert %q", a.Kind)
	}
	place := "Not known"
	if a.Place != "" {
		place = SafeName(a.Place, "Not known")
	}
	when := FormatDateTime(a.At, zoneOrDefault(a.Zone))
	return New{
		AccountID:   a.AccountID,
		RoleContext: a.Role,
		Kind:        KindSecurityAlert,
		Title:       heading,
		Body:        summary + " If this wasn't you, contact HalalGoes support.",
		Priority:    PriorityHigh,
		Channels:    []Channel{ChannelEmail},
		DedupeKey:   fmt.Sprintf("security_alert:%s:%s", a.Kind, a.Ref),
		Email: &EmailSpec{Template: "security_alert", Vars: map[string]string{
			"Heading": heading, "Summary": summary, "When": when, "Place": place, "IfNotYou": ifNotYou,
		}},
	}, nil
}
