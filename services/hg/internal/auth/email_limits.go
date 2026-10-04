package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

// Limits on the link emails anyone can trigger without signing in: sign-up
// verification, "resend verification" and "forgot password". Real email now
// leaves the building (issue #59), so each of these is a way to send mail to
// an address someone else chose. The limits are checked before any token is
// stored or any email is queued, and they are shaped so that an attacker
// cannot use them to lock the real owner out of their own account:
//
//   - The tight limit is per (address, client address): one attacker's
//     network can bother a mailbox a little, and the owner, asking from their
//     own network, still gets through.
//   - A client address has an overall hourly budget across every address.
//   - A looser cap per address (hourly and daily) is the last line against
//     mail bombing from many networks. When it is hit the caller still gets
//     the generic answer, and the log raises an alert: one address hitting it
//     is an attack signal.
//
// Rebuild source: none needed. The counters live in Redis like every other
// rate limit; a flush allows a few extra emails, never a wrong one (AGENTS.md,
// "Architecture in one picture": Redis is disposable).
const (
	// linkEmailsPerAddressAndClient caps emails of one kind to one address
	// requested from one client address (httpx.RateLimitKey: an IPv4
	// address, or an IPv6 /64) an hour.
	linkEmailsPerAddressAndClient = 3
	// linkEmailsPerClient caps emails of one kind one client address can
	// request an hour, whichever addresses it names.
	linkEmailsPerClient = 10
	// linkEmailsPerAddressHour and linkEmailsPerAddressDay cap emails of one
	// kind to one address from everywhere together.
	linkEmailsPerAddressHour = 10
	linkEmailsPerAddressDay  = 20
	// uniformLinkDelay is how long the forgot-password and resend
	// operations take, whatever happened: an unknown address, a known one, a
	// rate limit. Equal timing keeps the response from saying whether an
	// account exists. Queuing an email takes a few milliseconds, well inside it.
	uniformLinkDelay = 300 * time.Millisecond
	// liveTokensPerKind is how many unused links of one kind an account can
	// hold at once: a new one does not cancel the last, so an attacker asking
	// for resets cannot cancel the link the owner is about to click, but the
	// oldest beyond three stops working.
	liveTokensPerKind = 3
)

// errAddressCapped is the per-address cap: the caller answers generically.
var errAddressCapped = errors.New("auth: email cap reached for this address")

// Email kinds for the limit keys.
const (
	emailKindReset  = "reset"
	emailKindVerify = "verify"
)

// rateLimitAddress normalises an address so that one mailbox is one counter:
// lower case, the domain in its IDNA ASCII form, and any +tag dropped from the
// local part ("Owner+1@Example.com" and "owner@example.com" share a limit).
// An address that does not parse is keyed on its lower-cased text, which is
// still one counter per spelling the attacker can only grow by typing new
// addresses — each of which the client-address limit also counts.
func rateLimitAddress(email string) string {
	addr := strings.TrimSpace(email)
	if c, err := notify.CanonicalEmail(addr); err == nil {
		addr = c
	}
	addr = strings.ToLower(addr)
	at := strings.LastIndexByte(addr, '@')
	if at <= 0 {
		return addr
	}
	local, domain := addr[:at], addr[at:]
	if plus := strings.IndexByte(local, '+'); plus > 0 {
		local = local[:plus]
	}
	return local + domain
}

// allowLinkEmail counts one email of kind towards the limits above, tightest
// first, so a request one client is refused for never counts towards the
// address's overall cap. It returns ErrRateLimited when the client is over
// its own limits (the caller may say so: it reveals nothing about the
// account), errAddressCapped when the address is over its overall cap (the
// caller answers generically), and ErrLimiterUnavailable when Redis cannot
// answer (the caller sends nothing).
func (s *Service) allowLinkEmail(ctx context.Context, kind, email, clientKey string) error {
	if clientKey == "" {
		clientKey = "unknown"
	}
	addr := rateLimitAddress(email)
	if err := s.rl.Allow(ctx, "rl:email:"+kind+":from:"+clientKey, linkEmailsPerClient, time.Hour); err != nil {
		return err
	}
	if err := s.rl.Allow(ctx, "rl:email:"+kind+":to:"+addr+":from:"+clientKey, linkEmailsPerAddressAndClient, time.Hour); err != nil {
		return err
	}
	for _, c := range []struct {
		suffix string
		limit  int64
		window time.Duration
	}{
		{":hour", linkEmailsPerAddressHour, time.Hour},
		{":day", linkEmailsPerAddressDay, 24 * time.Hour},
	} {
		if err := s.rl.Allow(ctx, "rl:email:"+kind+":to:"+addr+c.suffix, c.limit, c.window); err != nil {
			if !limited(err) {
				return err
			}
			// An attack signal: many networks asking for mail to one
			// address. Logged at error level for the log alerts (issue #65);
			// the address itself is hashed, never logged.
			sum := sha256.Sum256([]byte(addr))
			s.log.ErrorContext(ctx, "email cap reached for one address: possible mail bombing",
				"alert", true, "kind", kind, "window", c.window.String(),
				"address_sha256", hex.EncodeToString(sum[:8]))
			return errAddressCapped
		}
	}
	return nil
}

// answerUniformly holds the response until at least linkEmailDelay has passed
// since start, so every outcome of an unauthenticated email request takes the
// same time.
func (s *Service) answerUniformly(ctx context.Context, start time.Time) {
	wait := s.linkEmailDelay - time.Since(start)
	if wait <= 0 {
		return
	}
	t := time.NewTimer(wait)
	defer t.Stop()
	select {
	case <-t.C:
	case <-ctx.Done():
	}
}

// limited reports whether err is a limit the caller should report as 429.
func limited(err error) bool { return errors.Is(err, ErrRateLimited) }
