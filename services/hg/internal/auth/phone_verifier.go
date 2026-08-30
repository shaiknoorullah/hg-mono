package auth

import (
	"context"
	"errors"
)

// PhoneVerifier is the seam for a provider that generates, delivers AND
// validates the OTP itself — Twilio Verify is the reference implementation.
//
// It is deliberately distinct from SMSSender: an SMSSender only transports a
// code this service generated and stored (the self-hosted challenge path),
// whereas a PhoneVerifier owns the code end to end, so nothing is stored locally
// and the local hash-compare is never run. The auth service selects the path at
// wiring time: a nil PhoneVerifier keeps the self-hosted default (dev unchanged);
// a configured one takes over requestOtp/verifyOtp without any other change to
// the resolve-or-create-account + issue-session logic (P-02 is preserved: Start
// runs for any number, existence is resolved only after an approved Check).
type PhoneVerifier interface {
	// Start begins a verification: the provider generates and sends a code to
	// phone over channel ("whatsapp" or "sms"). It never returns or logs a code
	// (the provider holds it). A transient failure is a normal error; callers on
	// the request path swallow it so the response cannot signal number validity.
	Start(ctx context.Context, phone, channel string) error
	// Check validates code for phone. approved is true only when the provider
	// reports the code correct. A wrong or still-pending code is (false, nil).
	// An exhausted or absent verification is (false, ErrVerifyNoPending). Any
	// other failure is a wrapped transport/provider error.
	Check(ctx context.Context, phone, code string) (approved bool, err error)
}

// ErrVerifyNoPending is returned by a PhoneVerifier.Check when the provider has
// no live verification to check against — it expired, was already approved, hit
// the provider's max-check-attempts cap, or never existed. The service maps it
// to OTP_INVALID_OR_EXPIRED, which is also the anti-enumeration-safe answer: it
// says nothing about whether the phone belongs to an account.
var ErrVerifyNoPending = errors.New("auth: no pending phone verification")
