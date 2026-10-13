package notify

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Builders for the notifications outside the order lifecycle: account
// emails, application decisions, account standing, payouts and halal
// certificate expiry (issue #248). Each returns a New that the caller enqueues
// in the same transaction as the change it reports, so the message exists if
// and only if the change committed (doc.go).
//
// Every builder:
//   - writes an inbox title and body that hold no secret: no token, no code,
//     no full address (docs/spec/01-platform.md, "P-24 — Notification
//     router", rule I-24.5);
//   - names an email template from packages/emails and fills it with
//     display values formatted here (money from integer cents, 12-hour times);
//   - sets a dedupe key, so a retried transaction or a double-click produces
//     one notification, not two emails.
//
// Which roles get which channel follows the router matrix in the same spec
// section: restaurants and admins by email and inbox; riders by push with
// email beside it (riders have no web app to link to, so their emails carry no
// button).

// TxEnqueuer is the outbox's write side as other modules hold it
// (*Enqueuer implements it).
type TxEnqueuer interface {
	Enqueue(ctx context.Context, tx pgx.Tx, n New) (EnqueueResult, error)
}

// Kinds for the notifications this file builds. notification.kind is a plain
// string, so a new kind needs no migration.
const (
	KindEmailVerification                  Kind = "AUTH_EMAIL_VERIFICATION"
	KindPasswordReset                      Kind = "AUTH_PASSWORD_RESET"
	KindStaffInvite                        Kind = "STAFF_INVITE"
	KindRestaurantApplicationApproved      Kind = "RESTAURANT_APPLICATION_APPROVED"
	KindRestaurantApplicationChangesNeeded Kind = "RESTAURANT_APPLICATION_CHANGES_REQUESTED"
	KindRestaurantApplicationRejected      Kind = "RESTAURANT_APPLICATION_REJECTED"
	KindRiderApplicationApproved           Kind = "RIDER_APPLICATION_APPROVED"
	KindRiderApplicationChangesNeeded      Kind = "RIDER_APPLICATION_CHANGES_REQUESTED"
	KindRiderApplicationRejected           Kind = "RIDER_APPLICATION_REJECTED"
	KindRestaurantSuspended                Kind = "RESTAURANT_SUSPENDED"
	KindRestaurantReinstated               Kind = "RESTAURANT_REINSTATED"
	KindRiderSuspended                     Kind = "RIDER_SUSPENDED"
	KindRiderReinstated                    Kind = "RIDER_REINSTATED"
	KindPayoutSent                         Kind = "PAYOUT_SENT"
	KindPayoutHeld                         Kind = "PAYOUT_HELD"
	KindPayoutFailed                       Kind = "PAYOUT_FAILED"
	// The two halal certificate kinds match the ones the expiry job in pull
	// request #274 already writes (internal/halalexpiry/messages.go there).
	KindHalalCertificateExpiring Kind = "HALAL_CERTIFICATE_EXPIRING"
	KindHalalCertificateExpired  Kind = "HALAL_CERTIFICATE_EXPIRED"
)

// Paths on the restaurant and admin web apps that an email's button opens
// (joined to Links by the renderer). The three token paths are new routes the
// web apps add to consume the token through the existing API operations
// (verifyEmail, resetPassword): issue #329.
const (
	PathVerifyEmail   = "/verify-email"
	PathResetPassword = "/reset-password"
	PathAcceptInvite  = "/accept-invite"
	PathOnboarding    = "/onboarding"
	PathSignIn        = "/login"
	PathOrders        = "/orders"
)

func restaurantOrAdmin(role RoleContext) error {
	if role != RoleRestaurant && role != RoleAdmin {
		return fmt.Errorf("notify: %s has no web app to link to", role)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Sign-in and account emails: each carries one single-use link.
// ---------------------------------------------------------------------------

// LinkEmail is the input to the three single-use-link emails.
type LinkEmail struct {
	AccountID uuid.UUID
	// Role picks the web app the link opens: RESTAURANT or ADMIN.
	Role RoleContext
	// To is the address the account registered, verified or not: these
	// emails are how an address gets verified.
	To string
	// Token is the plaintext single-use token. It travels only in the
	// delivery job and the email itself (ChannelOverride.LinkToken).
	Token string
	// TokenID identifies the token row (credential_token.id); it makes the
	// dedupe key, so one token produces one email.
	TokenID   string
	ExpiresAt time.Time
	Zone      *time.Location
}

func (a LinkEmail) validate() error {
	if err := restaurantOrAdmin(a.Role); err != nil {
		return err
	}
	if a.To == "" || a.Token == "" || a.TokenID == "" {
		return fmt.Errorf("notify: a link email needs an address, a token and a token id")
	}
	return nil
}

func linkEmail(a LinkEmail, kind Kind, title, body, template, path string, vars map[string]string) (New, error) {
	if err := a.validate(); err != nil {
		return New{}, err
	}
	if vars == nil {
		vars = map[string]string{}
	}
	vars["ExpiresAt"] = FormatDateTime(a.ExpiresAt, a.Zone)
	return New{
		AccountID:   a.AccountID,
		RoleContext: a.Role,
		Kind:        kind,
		Title:       title,
		Body:        body,
		Priority:    PriorityHigh,
		Channels:    []Channel{ChannelEmail},
		DedupeKey:   strings.ToLower(string(kind)) + ":" + a.TokenID,
		Email:       &EmailSpec{Template: template, Vars: vars, LinkPath: path},
		Overrides:   map[Channel]ChannelOverride{ChannelEmail: {Target: a.To, LinkToken: a.Token}},
	}, nil
}

// EmailVerification is the restaurant sign-up email that confirms the address
// (docs/spec/01-platform.md, "P-03 — Email and password sign-in").
func EmailVerification(a LinkEmail) (New, error) {
	return linkEmail(a, KindEmailVerification,
		"Confirm your email",
		fmt.Sprintf("We sent a link to confirm your email address to %s.", maskEmail(a.To)),
		"email_verification", PathVerifyEmail, nil)
}

// PasswordReset is the forgot-password email.
func PasswordReset(a LinkEmail) (New, error) {
	return linkEmail(a, KindPasswordReset,
		"Password reset requested",
		fmt.Sprintf("We sent a link to reset your password to %s. If it was not you, ignore it: your password stays the same.", maskEmail(a.To)),
		"password_reset", PathResetPassword, nil)
}

// StaffInvite is the input to the staff invitation email. It carries no text
// the inviter typed: the email names only the HalalGoes team and a role from
// a fixed list, so an invitation cannot be turned into a message of someone
// else's choosing.
type StaffInvite struct {
	LinkEmail
	// PlatformRole is the role granted: SUPPORT_AGENT, ADMIN or SUPER_ADMIN.
	PlatformRole string
}

// ErrNotInvitable is returned for an invitation HalalGoes does not send:
// anything but HalalGoes's own admin staff. Restaurant accounts are
// owner-only at launch (docs/decisions/README.md, "Staff accounts"), so
// restaurant staff get no invitation email in 1.0.
var ErrNotInvitable = errors.New("notify: only HalalGoes admin staff are invited by email")

// ErrInviteLimited is returned when an invitation would pass a daily limit
// per invited account or per inviter.
var ErrInviteLimited = errors.New("notify: too many staff invitations today")

// StaffInviteEmail invites a new HalalGoes staff account to set its password
// (docs/spec/05-admin.md, "A-01 — Staff account provisioning"; contract:
// createStaffUser). The link consumes the token through the reset-password
// operation, which sets the first password, until the invitation acceptance
// flow of issue #170 exists.
func StaffInviteEmail(a StaffInvite) (New, error) {
	label, ok := staffRoleLabel(a.PlatformRole)
	if a.Role != RoleAdmin || !ok {
		return New{}, ErrNotInvitable
	}
	return linkEmail(a.LinkEmail, KindStaffInvite,
		"You're invited to HalalGoes",
		fmt.Sprintf("You are invited to join the HalalGoes team. Set your password from the link we emailed to %s.", maskEmail(a.To)),
		"staff_invite", PathAcceptInvite,
		map[string]string{"RoleLabel": label})
}

// StaffInvitation is a new INVITED HalalGoes staff account to send an
// invitation to. The address is not part of it: the inviter reads it from the
// invited account's own row, so the email can only go to the account being
// invited.
type StaffInvitation struct {
	AccountID    uuid.UUID
	PlatformRole string    // SUPPORT_AGENT, ADMIN or SUPER_ADMIN
	InvitedBy    uuid.UUID // the inviting staff member; uuid.Nil when unknown
}

// StaffInviter mints a staff invitation inside the caller's transaction: the
// single-use token and the email that carries it. The auth module implements
// it (auth.Service.InviteStaff), because the token is a sign-in credential;
// the admin module calls it from the transaction that creates the invited
// account.
type StaffInviter interface {
	InviteStaff(ctx context.Context, tx pgx.Tx, inv StaffInvitation) error
}

// staffRoleLabel words a platform staff role for the invitation; any other
// role is not invitable.
func staffRoleLabel(role string) (string, bool) {
	switch role {
	case "SUPER_ADMIN":
		return "a super admin", true
	case "ADMIN":
		return "an admin", true
	case "SUPPORT_AGENT":
		return "a support agent", true
	default:
		return "", false
	}
}

// ---------------------------------------------------------------------------
// Application decisions
// ---------------------------------------------------------------------------

// Decision mirrors the contract's RestaurantDecision enum (used for riders too).
type Decision string

// The three application decisions.
const (
	// DecisionApprove approves the application.
	DecisionApprove Decision = "APPROVE"
	// DecisionRequestChanges sends the application back for changes.
	DecisionRequestChanges Decision = "REQUEST_CHANGES"
	// DecisionReject turns the application down.
	DecisionReject Decision = "REJECT"
)

// RestaurantApplicationDecision is the input to the restaurant decision message.
type RestaurantApplicationDecision struct {
	AccountID      uuid.UUID // one owner or manager
	RestaurantID   uuid.UUID
	RestaurantName string
	Decision       Decision
	// ReasonText is the admin's reason (contract:
	// RestaurantDecisionInput.reason_text), shown verbatim in the inbox row
	// and never in the email. The internal note is never passed.
	ReasonText string
	DecidedAt  time.Time
}

// RestaurantApplicationDecided tells a restaurant's owner the outcome of its
// application review (router matrix row onboarding.state_changed: email and
// inbox). The admin's reason goes in the inbox row, where the restaurant app
// shows it; the email says only that there is a decision and links to it, so
// no text typed by anyone but HalalGoes's templates reaches an inbox.
func RestaurantApplicationDecided(a RestaurantApplicationDecision) (New, error) {
	a.RestaurantName = SafeName(a.RestaurantName, "your restaurant")
	var kind Kind
	var template, title, body string
	switch a.Decision {
	case DecisionApprove:
		kind, template = KindRestaurantApplicationApproved, "restaurant_application_approved"
		title = "Application approved"
		body = fmt.Sprintf("%s is approved. Sign in to see what is left before you go live.", a.RestaurantName)
	case DecisionRequestChanges:
		kind, template = KindRestaurantApplicationChangesNeeded, "restaurant_application_changes_requested"
		title = "Changes needed on your application"
		body = fmt.Sprintf("Before we can approve %s, we need some changes: %s", a.RestaurantName, a.ReasonText)
	case DecisionReject:
		kind, template = KindRestaurantApplicationRejected, "restaurant_application_rejected"
		title = "Application not approved"
		body = fmt.Sprintf("We could not approve %s: %s", a.RestaurantName, a.ReasonText)
	default:
		return New{}, fmt.Errorf("notify: unknown restaurant decision %q", a.Decision)
	}
	return New{
		AccountID:   a.AccountID,
		RoleContext: RoleRestaurant,
		Kind:        kind,
		Title:       title,
		Body:        body,
		DeepLink:    "restaurant/onboarding/" + a.RestaurantID.String(),
		Priority:    PriorityHigh,
		Channels:    []Channel{ChannelEmail, ChannelInApp},
		DedupeKey:   fmt.Sprintf("restaurant_application:%s:%d", a.RestaurantID, a.DecidedAt.UnixMicro()),
		GroupKey:    "restaurant_application:" + a.RestaurantID.String(),
		Data:        map[string]any{"restaurant_id": a.RestaurantID.String(), "decision": string(a.Decision)},
		Email: &EmailSpec{Template: template, LinkPath: PathOnboarding, Vars: map[string]string{
			"RestaurantName": a.RestaurantName,
		}},
	}, nil
}

// RiderApplicationDecision is the input to the rider decision message.
type RiderApplicationDecision struct {
	AccountID  uuid.UUID
	FirstName  string
	Decision   Decision
	ReasonText string // shown in the inbox row, never the email (contract: RiderDecisionInput.reason_text)
	DecidedAt  time.Time
}

// RiderApplicationDecided tells a rider the outcome of their application
// (router matrix: push and inbox; email goes beside push as a record). As for
// restaurants, the admin's reason is in the inbox row, not the email.
func RiderApplicationDecided(a RiderApplicationDecision) (New, error) {
	a.FirstName = SafeName(a.FirstName, "there")
	var kind Kind
	var template, title, body string
	switch a.Decision {
	case DecisionApprove:
		kind, template = KindRiderApplicationApproved, "rider_application_approved"
		title = "You're approved to deliver"
		body = "Your application is approved. Set up payouts in the app to start taking deliveries."
	case DecisionRequestChanges:
		kind, template = KindRiderApplicationChangesNeeded, "rider_application_changes_requested"
		title = "Changes needed on your application"
		body = "Before we can approve your application, we need some changes: " + a.ReasonText
	case DecisionReject:
		kind, template = KindRiderApplicationRejected, "rider_application_rejected"
		title = "Application not approved"
		body = "We could not approve your application: " + a.ReasonText
	default:
		return New{}, fmt.Errorf("notify: unknown rider decision %q", a.Decision)
	}
	return New{
		AccountID:   a.AccountID,
		RoleContext: RoleRider,
		Kind:        kind,
		Title:       title,
		Body:        body,
		DeepLink:    "rider/onboarding",
		Priority:    PriorityHigh,
		Channels:    []Channel{ChannelPush, ChannelEmail, ChannelInApp},
		DedupeKey:   fmt.Sprintf("rider_application:%s:%d", a.AccountID, a.DecidedAt.UnixMicro()),
		GroupKey:    "rider_application:" + a.AccountID.String(),
		Data:        map[string]any{"decision": string(a.Decision)},
		Email: &EmailSpec{Template: template, Vars: map[string]string{
			"FirstName": a.FirstName,
		}},
	}, nil
}

// ---------------------------------------------------------------------------
// Account standing: suspension and reinstatement
// ---------------------------------------------------------------------------

// RestaurantStanding is the input to the restaurant suspended and reinstated
// messages.
type RestaurantStanding struct {
	AccountID      uuid.UUID // one owner or manager
	RestaurantID   uuid.UUID
	RestaurantName string
	Suspended      bool   // false means reinstated
	ReasonText     string // required when suspending; the note shown to the restaurant
	ChangedAt      time.Time
}

// RestaurantStandingChanged reports a suspension or a reinstatement
// (docs/spec/03-restaurant.md, "R-36 — Account status, suspension,
// reinstatement and in-flight orders": ACCOUNT_SUSPENDED and
// ACCOUNT_REINSTATED go by inbox and email).
func RestaurantStandingChanged(a RestaurantStanding) (New, error) {
	a.RestaurantName = SafeName(a.RestaurantName, "your restaurant")
	n := New{
		AccountID:   a.AccountID,
		RoleContext: RoleRestaurant,
		Priority:    PriorityHigh,
		Channels:    []Channel{ChannelEmail, ChannelInApp},
		GroupKey:    "restaurant_standing:" + a.RestaurantID.String(),
		Data:        map[string]any{"restaurant_id": a.RestaurantID.String()},
	}
	if a.Suspended {
		if a.ReasonText == "" {
			return New{}, fmt.Errorf("notify: a suspension notice needs the reason")
		}
		n.Kind = KindRestaurantSuspended
		n.Title = "Your restaurant is suspended"
		n.Body = fmt.Sprintf("%s is not taking new orders for now. Orders you already accepted still complete. Reason: %s", a.RestaurantName, a.ReasonText)
		n.DedupeKey = fmt.Sprintf("restaurant_suspended:%s:%d", a.RestaurantID, a.ChangedAt.UnixMicro())
		n.Email = &EmailSpec{Template: "restaurant_suspended", LinkPath: PathSignIn, Vars: map[string]string{
			"RestaurantName": a.RestaurantName,
		}}
		return n, nil
	}
	n.Kind = KindRestaurantReinstated
	n.Title = "Your restaurant is back"
	n.Body = fmt.Sprintf("The suspension on %s is lifted. You can take orders again.", a.RestaurantName)
	n.DedupeKey = fmt.Sprintf("restaurant_reinstated:%s:%d", a.RestaurantID, a.ChangedAt.UnixMicro())
	n.Email = &EmailSpec{Template: "restaurant_reinstated", LinkPath: PathOrders, Vars: map[string]string{
		"RestaurantName": a.RestaurantName,
	}}
	return n, nil
}

// RiderStanding is the input to the rider suspended and reinstated messages.
type RiderStanding struct {
	AccountID  uuid.UUID
	FirstName  string
	Suspended  bool
	ReasonText string
	ChangedAt  time.Time
}

// RiderStandingChanged reports a rider's pause or reinstatement
// (docs/decisions/README.md, "Notifying a paused rider who is reinstated").
func RiderStandingChanged(a RiderStanding) (New, error) {
	a.FirstName = SafeName(a.FirstName, "there")
	n := New{
		AccountID:   a.AccountID,
		RoleContext: RoleRider,
		Priority:    PriorityHigh,
		Channels:    []Channel{ChannelPush, ChannelEmail, ChannelInApp},
		GroupKey:    "rider_standing:" + a.AccountID.String(),
	}
	if a.Suspended {
		if a.ReasonText == "" {
			return New{}, fmt.Errorf("notify: a suspension notice needs the reason")
		}
		n.Kind = KindRiderSuspended
		n.Title = "Your rider account is paused"
		n.Body = "You cannot go online for now. Reason: " + a.ReasonText
		n.DedupeKey = fmt.Sprintf("rider_suspended:%s:%d", a.AccountID, a.ChangedAt.UnixMicro())
		n.Email = &EmailSpec{Template: "rider_suspended", Vars: map[string]string{
			"FirstName": a.FirstName,
		}}
		return n, nil
	}
	n.Kind = KindRiderReinstated
	n.Title = "You can deliver again"
	n.Body = "Your rider account is active again. Go online whenever you are ready."
	n.DedupeKey = fmt.Sprintf("rider_reinstated:%s:%d", a.AccountID, a.ChangedAt.UnixMicro())
	n.Email = &EmailSpec{Template: "rider_reinstated", Vars: map[string]string{"FirstName": a.FirstName}}
	return n, nil
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

// Payout is the input to the payout-sent message.
type Payout struct {
	AccountID   uuid.UUID
	Role        RoleContext // RESTAURANT or RIDER
	PayeeName   string      // the restaurant's name, or the rider's first name
	PayoutID    uuid.UUID
	AmountCents int64
	// PeriodStart and PeriodEnd bound the earnings paid, as the payout row
	// stores them: PeriodEnd is the exclusive cutoff instant.
	PeriodStart, PeriodEnd time.Time
	SentAt                 time.Time
	Zone                   *time.Location
	// Occurrence names one sending or failure of the payout, so each is one
	// message however often it is retried: the bank payout that paid it, or
	// the transfer attempt or bank payout that failed. Required for a failure.
	Occurrence string
}

// PayoutSent tells a partner their payout left (router matrix row
// payout.paid: email and inbox for restaurants; push, email and inbox for
// riders).
func PayoutSent(a Payout) (New, error) {
	if a.Role != RoleRestaurant && a.Role != RoleRider {
		return New{}, fmt.Errorf("notify: payouts go to restaurants and riders, not %s", a.Role)
	}
	a.PayeeName = SafeName(a.PayeeName, "you")
	amount := FormatCents(a.AmountCents)
	period := periodText(a.PeriodStart, a.PeriodEnd, a.Zone)
	return New{
		AccountID:   a.AccountID,
		RoleContext: a.Role,
		Kind:        KindPayoutSent,
		Title:       "Payout sent",
		Body:        fmt.Sprintf("We sent you %s for %s.", amount, period),
		Priority:    PriorityNormal,
		Channels:    payoutChannels(a.Role),
		DedupeKey:   payoutSentKey(a),
		GroupKey:    "payout:" + a.PayoutID.String(),
		Data:        map[string]any{"payout_id": a.PayoutID.String(), "amount_cents": a.AmountCents},
		Email: &EmailSpec{Template: "payout_sent", Vars: map[string]string{
			"PayeeName": a.PayeeName, "Amount": amount, "PeriodText": period,
			"SentAt": FormatDateTime(a.SentAt, a.Zone),
		}},
	}, nil
}

func payoutChannels(role RoleContext) []Channel {
	if role == RoleRider {
		return []Channel{ChannelPush, ChannelEmail, ChannelInApp}
	}
	return []Channel{ChannelEmail, ChannelInApp}
}

// PayoutHeld tells a partner that a payout is held because Stripe has payouts
// turned off for them: Stripe needs something from them first (router matrix
// row connect.requirements_changed / payouts_enabled=false). It names no
// Stripe requirement code: the payout setup screen shows what is due.
func PayoutHeld(a Payout) (New, error) {
	if a.Role != RoleRestaurant && a.Role != RoleRider {
		return New{}, fmt.Errorf("notify: payouts go to restaurants and riders, not %s", a.Role)
	}
	a.PayeeName = SafeName(a.PayeeName, "you")
	amount := FormatCents(a.AmountCents)
	period := periodText(a.PeriodStart, a.PeriodEnd, a.Zone)
	// One template for restaurants and riders, so no button: riders have no
	// web app to link to (as for payout_sent).
	spec := &EmailSpec{Template: "payout_held", Vars: map[string]string{
		"PayeeName": a.PayeeName, "Amount": amount, "PeriodText": period,
	}}
	return New{
		AccountID:   a.AccountID,
		RoleContext: a.Role,
		Kind:        KindPayoutHeld,
		Title:       "Payout on hold",
		Body: fmt.Sprintf("Your payout of %s for %s is on hold: Stripe needs more information before we can pay you. "+
			"Finish your payout setup and we pay you on the next payout run.", amount, period),
		Priority:  PriorityHigh,
		Channels:  payoutChannels(a.Role),
		DedupeKey: "payout_held:" + a.PayoutID.String(),
		GroupKey:  "payout:" + a.PayoutID.String(),
		Data:      map[string]any{"payout_id": a.PayoutID.String(), "amount_cents": a.AmountCents},
		Email:     spec,
	}, nil
}

// PayoutProblem is why a payout did not reach the partner, which decides what
// the message asks of them.
type PayoutProblem string

// The three ways a payout fails.
const (
	// PayoutRetrying: our request to Stripe failed. Nothing is asked of the
	// partner; the next payout run tries again.
	PayoutRetrying PayoutProblem = "RETRYING"
	// PayoutBankReturned: the bank payout failed or the bank returned it. The
	// money is back in the partner's Stripe balance; they check their bank
	// details, and the next run pays it out again.
	PayoutBankReturned PayoutProblem = "BANK_RETURNED"
	// PayoutStopped: Stripe failed or reversed the transfer. It is final until
	// a person at HalalGoes looks at it.
	PayoutStopped PayoutProblem = "STOPPED"
)

// PayoutFailure is the input to the payout-failed message.
type PayoutFailure struct {
	Payout
	Problem PayoutProblem
	// NextRun is when the next payout run tries again (RETRYING and
	// BANK_RETURNED); zero leaves the date out.
	NextRun time.Time
}

// PayoutFailed tells a partner a payout did not reach them and what happens
// next (router matrix row payout.failed: email and inbox for restaurants;
// push, email and inbox for riders). It never shows Stripe's own error text.
func PayoutFailed(a PayoutFailure) (New, error) {
	if a.Role != RoleRestaurant && a.Role != RoleRider {
		return New{}, fmt.Errorf("notify: payouts go to restaurants and riders, not %s", a.Role)
	}
	if a.Occurrence == "" {
		return New{}, fmt.Errorf("notify: a payout failure needs an occurrence for its dedupe key")
	}
	a.PayeeName = SafeName(a.PayeeName, "you")
	amount := FormatCents(a.AmountCents)
	period := periodText(a.PeriodStart, a.PeriodEnd, a.Zone)
	when := "on the next payout run"
	if !a.NextRun.IsZero() {
		when = "on the next payout run, " + FormatDateOnly(a.NextRun.In(zoneOrDefault(a.Zone)))
	}
	var title, nextStep string
	switch a.Problem {
	case PayoutRetrying:
		title = "Payout delayed"
		nextStep = "We could not send it this time. You do not need to do anything: we try again " + when + "."
	case PayoutBankReturned:
		title = "Payout returned by your bank"
		nextStep = "Your bank did not accept it, so the money is back in your Stripe balance. Check your bank " +
			"details in your payout setup; we pay it out again " + when + "."
	case PayoutStopped:
		title = "Payout not completed"
		nextStep = "Our team is looking into it and will contact you. Nothing you earned is lost."
	default:
		return New{}, fmt.Errorf("notify: unknown payout problem %q", a.Problem)
	}
	spec := &EmailSpec{Template: "payout_failed", Vars: map[string]string{
		"PayeeName": a.PayeeName, "Amount": amount, "PeriodText": period, "NextStep": nextStep,
	}}
	return New{
		AccountID:   a.AccountID,
		RoleContext: a.Role,
		Kind:        KindPayoutFailed,
		Title:       title,
		Body:        fmt.Sprintf("Your payout of %s for %s did not reach you. %s", amount, period, nextStep),
		Priority:    PriorityHigh,
		Channels:    payoutChannels(a.Role),
		DedupeKey:   "payout_failed:" + a.PayoutID.String() + ":" + a.Occurrence,
		GroupKey:    "payout:" + a.PayoutID.String(),
		Data: map[string]any{"payout_id": a.PayoutID.String(), "amount_cents": a.AmountCents,
			"problem": string(a.Problem)},
		Email: spec,
	}, nil
}

func zoneOrDefault(loc *time.Location) *time.Location {
	if loc == nil {
		return defaultZone
	}
	return loc
}

// payoutSentKey is one message per payout, and one more each time its bank
// payout is made again after the bank returned one: Occurrence, when set,
// names the bank payout.
func payoutSentKey(a Payout) string {
	if a.Occurrence == "" {
		return "payout_sent:" + a.PayoutID.String()
	}
	return "payout_sent:" + a.PayoutID.String() + ":" + a.Occurrence
}

// periodText is "28 Sep – 4 Oct 2026": the start date through the day before
// the exclusive cutoff.
func periodText(start, endExclusive time.Time, loc *time.Location) string {
	if loc == nil {
		loc = defaultZone
	}
	s := start.In(loc)
	e := endExclusive.In(loc).Add(-time.Nanosecond)
	if s.Year() == e.Year() {
		return s.Format("2 Jan") + " – " + e.Format("2 Jan 2006")
	}
	return s.Format("2 Jan 2006") + " – " + e.Format("2 Jan 2006")
}

// ---------------------------------------------------------------------------
// Halal certificate expiry
// ---------------------------------------------------------------------------

// Certificate is the input to the renewal reminder and lapse messages.
type Certificate struct {
	AccountID      uuid.UUID // one owner or manager
	RestaurantID   uuid.UUID
	CertificateID  uuid.UUID
	RestaurantName string
	IssuerName     string    // the certifying body, e.g. "HMA Canada"
	ExpiresOn      time.Time // a calendar date
}

func (c Certificate) safe() Certificate {
	c.RestaurantName = SafeName(c.RestaurantName, "your restaurant")
	c.IssuerName = SafeName(c.IssuerName, "your certifying body")
	return c
}

// CertificateRenewalReminder is the reminder sent 30, 14, 7 and 1 days before
// a halal certificate expires (docs/decisions/README.md, "Certificate renewal
// reminders to restaurants"). daysBefore is the reminder threshold (it makes
// the dedupe key, so each threshold sends once); daysLeft is the days actually
// left on the day it is sent.
//
// It states dates, never a halal status, and carries no colour: the email's
// "expiring" tint is the design system's own (packages/emails/src/palette.ts).
func CertificateRenewalReminder(c Certificate, daysBefore, daysLeft int) New {
	c = c.safe()
	timeLeft := fmt.Sprintf("in %d days", daysLeft)
	switch daysLeft {
	case 0:
		timeLeft = "today"
	case 1:
		timeLeft = "tomorrow"
	}
	priority := PriorityNormal
	if daysBefore <= 7 {
		priority = PriorityHigh
	}
	expires := FormatDateOnly(c.ExpiresOn)
	return New{
		AccountID:   c.AccountID,
		RoleContext: RoleRestaurant,
		Kind:        KindHalalCertificateExpiring,
		Title:       "Halal certificate expires " + timeLeft,
		Body: fmt.Sprintf("Your halal certificate from %s expires on %s. Upload the renewed certificate "+
			"so %s stays listed: customers stop seeing it the day after the certificate expires.",
			c.IssuerName, expires, c.RestaurantName),
		Priority: priority,
		Channels: []Channel{ChannelEmail, ChannelInApp},
		Data: map[string]any{
			"restaurant_id":  c.RestaurantID.String(),
			"certificate_id": c.CertificateID.String(),
			"expires_on":     c.ExpiresOn.Format(time.DateOnly),
			"days_before":    daysBefore,
		},
		DedupeKey: fmt.Sprintf("halal_certificate_reminder:%s:%d", c.CertificateID, daysBefore),
		GroupKey:  "halal_certificate:" + c.CertificateID.String(),
		Email: &EmailSpec{Template: "certificate_renewal_reminder", LinkPath: PathOnboarding, Vars: map[string]string{
			"RestaurantName": c.RestaurantName, "IssuerName": c.IssuerName,
			"ExpiresOn": expires, "TimeLeft": timeLeft,
		}},
	}
}

// CertificateLapsed tells a restaurant its halal certificate expired and the
// restaurant is hidden from customers until a renewed one is approved. The
// state is told as "we can't currently vouch", never as a verdict on the food
// (AGENTS.md "Non-negotiable invariants" #9).
func CertificateLapsed(c Certificate) New {
	c = c.safe()
	expired := FormatDateOnly(c.ExpiresOn)
	return New{
		AccountID:   c.AccountID,
		RoleContext: RoleRestaurant,
		Kind:        KindHalalCertificateExpired,
		Title:       "Halal certificate expired",
		Body: fmt.Sprintf("Your halal certificate from %s expired on %s. %s is hidden from customers "+
			"until a renewed certificate is approved.", c.IssuerName, expired, c.RestaurantName),
		Priority: PriorityHigh,
		Channels: []Channel{ChannelEmail, ChannelInApp},
		Data: map[string]any{
			"restaurant_id":  c.RestaurantID.String(),
			"certificate_id": c.CertificateID.String(),
			"expires_on":     c.ExpiresOn.Format(time.DateOnly),
		},
		DedupeKey: "halal_certificate_expired:" + c.CertificateID.String(),
		GroupKey:  "halal_certificate:" + c.CertificateID.String(),
		Email: &EmailSpec{Template: "certificate_lapsed", LinkPath: PathOnboarding, Vars: map[string]string{
			"RestaurantName": c.RestaurantName, "IssuerName": c.IssuerName, "ExpiredOn": expired,
		}},
	}
}
