package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

// Limits on the link emails anyone can trigger without signing in: sign-up
// verification, "resend verification" and "forgot password". Real email now
// leaves the building (issue #59), so each of these is a way to send mail to
// an address someone else chose. Both limits are checked before any token is
// stored or any email is queued.
//
// Rebuild source: none needed. The counters live in Redis like every other
// rate limit; a flush allows a few extra emails, never a wrong one (AGENTS.md,
// "Architecture in one picture": Redis is disposable).
const (
	// linkEmailsPerAddress caps emails of one kind to one address an hour.
	linkEmailsPerAddress = 3
	// linkEmailsPerClient caps emails of one kind requested from one client
	// address (an IPv4 address, or an IPv6 /64: httpx.RateLimitKey) an hour.
	linkEmailsPerClient = 10
	// uniformLinkDelay is how long the forgot-password and resend
	// operations take, whatever happened: an unknown address, a known one, a
	// rate limit. Equal timing keeps the response from saying whether an
	// account exists. Queuing an email takes a few milliseconds, well inside it.
	uniformLinkDelay = 300 * time.Millisecond
)

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

// allowLinkEmail counts one email of kind towards the client's and the
// address's limits. It returns ErrRateLimited over either, and
// ErrLimiterUnavailable when Redis cannot answer, in which case the caller
// sends nothing (fail closed).
func (s *Service) allowLinkEmail(ctx context.Context, kind, email, clientKey string) error {
	if clientKey == "" {
		clientKey = "unknown"
	}
	if err := s.rl.Allow(ctx, "rl:email:"+kind+":from:"+clientKey, linkEmailsPerClient, time.Hour); err != nil {
		return err
	}
	return s.rl.Allow(ctx, "rl:email:"+kind+":to:"+rateLimitAddress(email), linkEmailsPerAddress, time.Hour)
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
