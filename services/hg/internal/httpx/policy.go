package httpx

import (
	"context"
	"fmt"
	"time"
)

// Action is a noun.verb permission from the closed, compile-time enumerated set
// described in P-05. Handlers never pass a string literal (I-05.2); constants
// live beside the module that owns the noun.
type Action string

// RateClass selects the request timeout, the body limit and — once P-38 lands —
// the token bucket. Every route declares one.
type RateClass string

const (
	ClassAuth     RateClass = "AUTH"
	ClassRead     RateClass = "READ"
	ClassWrite    RateClass = "WRITE"
	ClassMoney    RateClass = "MONEY"
	ClassUpload   RateClass = "UPLOAD"
	ClassRealtime RateClass = "REALTIME"
	ClassWebhook  RateClass = "WEBHOOK"
)

// Timeout is the per-class context deadline from the P-06 chain, stage 5.
func (c RateClass) Timeout() time.Duration {
	switch c {
	case ClassRead:
		return 5 * time.Second
	case ClassWrite:
		return 15 * time.Second
	case ClassMoney:
		return 20 * time.Second
	case ClassUpload:
		return 60 * time.Second
	case ClassAuth, ClassRealtime:
		return 5 * time.Second
	case ClassWebhook:
		return 15 * time.Second
	default:
		return 15 * time.Second
	}
}

// DefaultMaxBody is the P-06 stage-6 body limit: 1 MiB, except AUTH at 16 KiB.
func (c RateClass) DefaultMaxBody() int64 {
	switch c {
	case ClassAuth:
		return 16 << 10
	case ClassUpload:
		return 32 << 20
	default:
		return 1 << 20
	}
}

func (c RateClass) valid() bool {
	switch c {
	case ClassAuth, ClassRead, ClassWrite, ClassMoney, ClassUpload, ClassRealtime, ClassWebhook:
		return true
	}
	return false
}

// Policy is the mandatory registration argument from P-06. There is no way to
// add a handler without one, and Router.Verify rejects an incoherent one at boot
// rather than at the first request.
type Policy struct {
	// Action is the permission the caller must hold. Required unless Public.
	Action Action
	// Public must be set explicitly and is mutually exclusive with Action. It is
	// the only way an operation may be called unauthenticated; the contract
	// fixes that set (x-roles: [PUBLIC]).
	Public bool
	// Class selects timeout, body limit and rate bucket. Required.
	Class RateClass
	// Idempotent requires an Idempotency-Key header (P-37). Every MONEY-class
	// route must set it (I-37.4), enforced by Verify.
	Idempotent bool
	// MaxBody overrides Class.DefaultMaxBody when non-zero.
	MaxBody int64
	// OperationID is the contract's operationId, carried into logs so a log line
	// can be matched against contracts/openapi.yaml without guessing.
	OperationID string
	// LocalOnly marks a route that must exist only when HG_ENV=local. Router
	// refuses to register one outside local.
	LocalOnly bool
}

func (p Policy) validate(method, pattern string) error {
	switch {
	case p.Action == "" && !p.Public:
		return fmt.Errorf("%s %s: policy declares neither Action nor Public — G-4 denies by default, so this route is unreachable by construction", method, pattern)
	case p.Action != "" && p.Public:
		return fmt.Errorf("%s %s: policy declares both Action %q and Public — they are mutually exclusive", method, pattern, p.Action)
	case !p.Class.valid():
		return fmt.Errorf("%s %s: policy has no RateClass", method, pattern)
	case p.Class == ClassMoney && !p.Idempotent:
		return fmt.Errorf("%s %s: MONEY-class route is not Idempotent — I-37.4 requires an Idempotency-Key on every money route", method, pattern)
	}
	return nil
}

func (p Policy) maxBody() int64 {
	if p.MaxBody > 0 {
		return p.MaxBody
	}
	return p.Class.DefaultMaxBody()
}

// RouteInfo is a resolved route: the policy plus the pattern it was registered
// under. It is placed in the request context before the chain runs.
type RouteInfo struct {
	Method  string
	Pattern string
	Policy  Policy
}

type routeCtxKey struct{}

func withRoute(ctx context.Context, ri RouteInfo) context.Context {
	return context.WithValue(ctx, routeCtxKey{}, ri)
}

// RouteFrom returns the resolved route for this request. ok is false when no
// registered route matched — which the Guard treats as a denial.
func RouteFrom(ctx context.Context) (RouteInfo, bool) {
	ri, ok := ctx.Value(routeCtxKey{}).(RouteInfo)
	return ri, ok
}

type methodMismatchKey struct{}

func withMethodMismatch(ctx context.Context) context.Context {
	return context.WithValue(ctx, methodMismatchKey{}, true)
}

// methodMismatch reports that the path is registered but not for this method.
func methodMismatch(ctx context.Context) bool {
	v, _ := ctx.Value(methodMismatchKey{}).(bool)
	return v
}
