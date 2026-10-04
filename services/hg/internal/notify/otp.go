package notify

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// OTPArgs is the input to BuildOTP. AccountID may be the zero UUID for a
// not-yet-existing account during signup — P-02 explicitly requires identical
// behaviour whether or not the number is known, so this package does not
// require an account row to exist before sending a code.
type OTPArgs struct {
	AccountID uuid.UUID
	PhoneE164 string
	Code      string // the raw OTP digits, e.g. "482913"
	// ChallengeKey identifies the open OTP challenge (auth owns its shape,
	// typically hash(phone)+purpose). It becomes the DedupeKey, which is what
	// makes a re-request inside an open challenge re-send the *same* queued
	// job rather than mint a second one (P-02: "re-request ... does not
	// rotate it").
	ChallengeKey string
	// ExpiresInMinutes sizes both the must_reach deadline and the SMS copy.
	ExpiresInMinutes int
}

// BuildOTP is the generalized-SMSSender seam the brief asks for: auth calls
// this (via an Enqueuer it holds) instead of talking to an SMS provider
// directly. The contract requires Notification.body never contain a code, so
// the real code text lives only in New.Overrides[SMS].Body — a per-channel,
// per-job field that outbox.go copies into DeliverArgs.Overrides and that
// repo.go never writes to the notification table. The persisted row carries a
// generic, non-secret placeholder instead, so an inbox read mid-flow shows
// something true ("a code was sent") without becoming a second place a code
// leaks from.
//
// Channel plan is SMS-only: OTP is delivered on exactly the channel the user
// is proving they control. Adding PUSH/EMAIL to an OTP would let a stolen
// session on a different channel intercept a sign-in code.
func BuildOTP(a OTPArgs) New {
	minutes := a.ExpiresInMinutes
	if minutes <= 0 {
		minutes = 5
	}
	smsBody := fmt.Sprintf("Your HalalGoes verification code is %s. It expires in %d minutes. Don't share this code.", a.Code, minutes)

	return New{
		AccountID:   a.AccountID,
		RoleContext: RoleCustomer,
		Kind:        KindAuthOTP,
		Title:       "Verification code sent",
		Body:        fmt.Sprintf("A verification code was sent to %s.", maskPhone(a.PhoneE164)),
		Priority:    PriorityCritical,
		Channels:    []Channel{ChannelSMS},
		DedupeKey:   "otp:" + a.ChallengeKey,
		MustReach:   true,
		DeadlineAt:  time.Now().Add(time.Duration(minutes) * time.Minute),
		Overrides: map[Channel]ChannelOverride{
			ChannelSMS: {Target: a.PhoneE164, Body: smsBody},
		},
	}
}

// maskPhone renders the last 4 digits only, for the redacted inbox copy.
func maskPhone(e164 string) string {
	if len(e164) < 4 {
		return "your number"
	}
	return "•••" + e164[len(e164)-4:]
}
