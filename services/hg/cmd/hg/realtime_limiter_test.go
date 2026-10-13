package main

import (
	"context"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
)

// TestRealtimeLimiterRefusesOverTheLimit: the realtime request limits (issue
// #288) reach auth's limiter through realtimeLimiter. A count over the limit
// must come back as a refusal, never as an error: the realtime handler lets
// a request through on an error (Redis down), so misreading auth's refusal
// would switch every realtime limit off.
func TestRealtimeLimiterRefusesOverTheLimit(t *testing.T) {
	l := realtimeLimiter{auth.NewMemoryRateLimiter()}
	ctx := context.Background()
	for i, want := range []bool{true, true, false} {
		ok, err := l.Allow(ctx, "rt_ticket", "session:s1", 2, time.Minute)
		if err != nil || ok != want {
			t.Fatalf("call %d: Allow = %v, %v; want %v, nil", i+1, ok, err, want)
		}
	}
	if ok, err := l.Allow(ctx, "rt_ticket", "session:s2", 2, time.Minute); err != nil || !ok {
		t.Fatalf("another session: Allow = %v, %v; want true, nil (its own budget)", ok, err)
	}
}
