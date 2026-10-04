package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// A burst of callers never runs more than the cap at once, and every caller
// that cannot get a slot within the wait is told "busy" rather than queued
// forever. This is what keeps ten parallel sign-ups from exhausting a replica.
func TestHashGate_CapsConcurrencyAndTurnsAwayTheRest(t *testing.T) {
	const capacity, callers = 2, 10
	g := newHashGate(capacity, 20*time.Millisecond)

	var inFlight, maxInFlight, busy atomic.Int32
	var attempted, done sync.WaitGroup
	attempted.Add(callers)
	done.Add(callers)
	holdUntil := make(chan struct{})

	for i := 0; i < callers; i++ {
		go func() {
			defer done.Done()
			slot, err := g.acquire(context.Background())
			attempted.Done()
			if err != nil {
				if !errors.Is(err, ErrPasswordHashBusy) {
					t.Errorf("acquire: got %v, want ErrPasswordHashBusy", err)
				}
				busy.Add(1)
				return
			}
			defer slot.release()
			n := inFlight.Add(1)
			for {
				m := maxInFlight.Load()
				if n <= m || maxInFlight.CompareAndSwap(m, n) {
					break
				}
			}
			<-holdUntil // hold the slot until every caller has tried
			inFlight.Add(-1)
		}()
	}
	attempted.Wait()
	close(holdUntil)
	done.Wait()

	if got := maxInFlight.Load(); got != capacity {
		t.Fatalf("max hashes in flight = %d, want %d", got, capacity)
	}
	if got := busy.Load(); got != callers-capacity {
		t.Fatalf("callers turned away = %d, want %d", got, callers-capacity)
	}
	// Released slots are reusable.
	slot, err := g.acquire(context.Background())
	if err != nil {
		t.Fatalf("acquire after release: %v", err)
	}
	slot.release()
}

// When hashing is at capacity, sign-up answers 503 with Retry-After and the
// contract's TIMEOUT code through the normal error envelope — not a 500, and
// not a hang.
func TestRegisterRestaurant_HashingAtCapacity_Is503WithRetryAfter(t *testing.T) {
	ConfigurePasswordHashing(1, 10*time.Millisecond)
	t.Cleanup(func() { ConfigurePasswordHashing(DefaultHashConcurrency, DefaultHashWait) })
	held, err := acquireHashSlot(context.Background())
	if err != nil {
		t.Fatalf("take the only slot: %v", err)
	}
	defer held.release()

	secrets := &Secrets{CurrentTermsVersion: "2026-01"}
	h := NewHandler(NewService(nil, nil, nil, nil, nil, secrets, nil), nil, nil, secrets)
	body := `{"email":"owner@example.test","password":"a-long-enough-password","business_name":"Halal Grill","terms_version":"2026-01"}`
	rec := httptest.NewRecorder()
	h.RegisterRestaurant(rec, httptest.NewRequest(http.MethodPost, "/v1/auth/register/restaurant", strings.NewReader(body)))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 (body: %s)", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Retry-After"); got != "1" {
		t.Fatalf("Retry-After = %q, want \"1\"", got)
	}
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	if env.Error.Code != "TIMEOUT" {
		t.Fatalf("error.code = %q, want TIMEOUT", env.Error.Code)
	}
}
