package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/session"
)

// These tests pin the password-hashing gates of #216
// (https://github.com/shaiknoorullah/hg-mono/issues/216): a burst never runs
// more hashes than the cap, the queue of waiters is bounded, a flood on one
// public form cannot lock sign-in out, a rate-limited request never takes a
// slot, and "busy" is never recorded as a failed sign-in.

// A burst of callers never runs more than the cap at once, and every caller
// that cannot get a slot within the wait is told "busy" rather than queued
// forever. This is what keeps ten parallel sign-ups from exhausting a replica.
func TestHashGate_CapsConcurrencyAndTurnsAwayTheRest(t *testing.T) {
	const capacity, callers = 2, 10
	g := newHashGate(audienceLogin, capacity, 20*time.Millisecond, callers)

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
	if got := g.rejected.Load(); got != callers-capacity {
		t.Fatalf("rejections counted = %d, want %d", got, callers-capacity)
	}
	// Released slots are reusable.
	slot, err := g.acquire(context.Background())
	if err != nil {
		t.Fatalf("acquire after release: %v", err)
	}
	slot.release()
}

// The queue in front of a full gate is bounded: once maxWaiters callers are
// waiting, the next one is turned away at once instead of holding a goroutine,
// a request and a connection for the whole wait.
func TestHashGate_BoundsTheQueue(t *testing.T) {
	g := newHashGate(audienceSignup, 1, 5*time.Second, 2)
	held, err := g.acquire(context.Background())
	if err != nil {
		t.Fatalf("take the only slot: %v", err)
	}
	defer held.release()

	ctx, cancel := context.WithCancel(context.Background())
	var waiting sync.WaitGroup
	for i := 0; i < 2; i++ {
		waiting.Add(1)
		go func() {
			defer waiting.Done()
			if slot, err := g.acquire(ctx); err == nil {
				slot.release()
			}
		}()
	}
	for deadline := time.Now().Add(2 * time.Second); g.waiters.Load() < 2; {
		if time.Now().After(deadline) {
			t.Fatalf("waiters = %d, want 2", g.waiters.Load())
		}
		time.Sleep(time.Millisecond)
	}

	start := time.Now()
	_, err = g.acquire(context.Background())
	var busy *HashBusyError
	if !errors.As(err, &busy) || busy.Reason != "too_many_waiting" {
		t.Fatalf("third waiter: got %v, want a HashBusyError for too_many_waiting", err)
	}
	if waited := time.Since(start); waited > time.Second {
		t.Fatalf("third waiter was held %s; it must be turned away at once", waited)
	}
	cancel()
	waiting.Wait()
	if got := g.waiters.Load(); got != 0 {
		t.Fatalf("waiters after the queue drained = %d, want 0", got)
	}
}

// The gates are separate: with every sign-up slot taken, login and staff still
// get a slot at once, and the slots of all gates add up to the configured cap.
func TestHashGates_SignupFloodLeavesLoginAndStaffASlot(t *testing.T) {
	for _, total := range []int{3, 4, 7, 64} {
		gs := newHashGates(total, time.Second, 0)
		sum := cap(gs.signup.slots) + cap(gs.login.slots) + cap(gs.staff.slots)
		if sum != total {
			t.Errorf("total %d: slots add up to %d", total, sum)
		}
		for _, g := range []*hashGate{gs.signup, gs.login, gs.staff} {
			if cap(g.slots) < 1 || g.maxWaiters < 1 {
				t.Errorf("total %d: gate %s has %d slots and %d waiters, want at least 1 of each",
					total, g.audience, cap(g.slots), g.maxWaiters)
			}
		}
	}

	gs := newHashGates(DefaultHashConcurrency, 50*time.Millisecond, 0)
	for i := 0; i < cap(gs.signup.slots); i++ {
		slot, err := gs.signup.acquire(context.Background())
		if err != nil {
			t.Fatalf("fill sign-up gate: %v", err)
		}
		defer slot.release()
	}
	if _, err := gs.signup.acquire(context.Background()); !errors.Is(err, ErrPasswordHashBusy) {
		t.Fatalf("sign-up gate full: got %v, want busy", err)
	}
	for _, a := range []hashAudience{audienceLogin, audienceStaff} {
		start := time.Now()
		slot, err := gs.gate(a).acquire(context.Background())
		if err != nil {
			t.Fatalf("%s with the sign-up gate full: %v", a, err)
		}
		slot.release()
		if waited := time.Since(start); waited > 10*time.Millisecond {
			t.Errorf("%s waited %s for a slot; it must not share the sign-up gate", a, waited)
		}
	}
}

// When hashing is at capacity, sign-up answers 503 with Retry-After and the
// contract's TIMEOUT code through the normal error envelope — not a 500, and
// not a hang.
func TestRegisterRestaurant_HashingAtCapacity_Is503WithRetryAfter(t *testing.T) {
	configureHashingForTest(t, DefaultHashConcurrency, 10*time.Millisecond)
	held, err := acquireHashSlot(context.Background(), audienceSignup)
	if err != nil {
		t.Fatalf("take the only sign-up slot: %v", err)
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
	if code := errorCode(t, rec); code != "TIMEOUT" {
		t.Fatalf("error.code = %q, want TIMEOUT", code)
	}
	if got := PasswordHashingRejections()[string(audienceSignup)]; got != 1 {
		t.Fatalf("sign-up rejections = %d, want 1", got)
	}
}

// A request over its rate limit is answered 429 before it takes a hashing
// slot, so a flood that the limiter refuses costs no argon2id work and cannot
// fill a gate. The service has no store: a request that got past the limiter
// would panic on its first store call.
func TestRateLimitedRequestsNeverTakeAHashingSlot(t *testing.T) {
	rdb := startRedis(t)
	configureHashingForTest(t, DefaultHashConcurrency, 10*time.Millisecond)
	secrets := &Secrets{CurrentTermsVersion: "2026-01"}
	h := NewHandler(NewService(nil, NewRateLimiter(rdb, nil), nil, nil, nil, secrets, nil), nil, nil, secrets)

	cases := []struct {
		name, key string
		max       int64
		handler   http.HandlerFunc
		path      string
		body      string
	}{
		{"login per email", "rl:login:email:flood@example.com", 10, h.Login, "/v1/auth/login",
			`{"email":"flood@example.com","password":"correct horse battery"}`},
		{"sign-up per email", "rl:register:email:flood@example.com", 5, h.RegisterRestaurant, "/v1/auth/register/restaurant",
			`{"email":"Flood@Example.com","password":"correct horse battery","business_name":"Bismillah Grill","terms_version":"2026-01"}`},
		{"password reset per IP", "rl:reset:ip:203.0.113.40", 10, h.ResetPassword, "/v1/auth/password/reset",
			`{"token":"` + strings.Repeat("t", 43) + `","new_password":"correct horse battery"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := rdb.Set(context.Background(), tc.key, tc.max, time.Hour).Err(); err != nil {
				t.Fatalf("fill counter: %v", err)
			}
			before := totalAcquired()
			req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req.RemoteAddr = "203.0.113.40:51000"
			rec := httptest.NewRecorder()
			func() {
				defer func() {
					if p := recover(); p != nil {
						t.Fatalf("the request went past the limiter and reached the store: %v", p)
					}
				}()
				tc.handler(rec, req)
			}()
			if rec.Code != http.StatusTooManyRequests {
				t.Fatalf("status = %d, want 429; body %s", rec.Code, rec.Body.String())
			}
			if code := errorCode(t, rec); code != "RATE_LIMITED" {
				t.Fatalf("error.code = %q, want RATE_LIMITED", code)
			}
			if after := totalAcquired(); after != before {
				t.Fatalf("hashing slots taken = %d, want 0", after-before)
			}
		})
	}
}

// With every sign-up slot held by a flood, a restaurant owner still signs in,
// and an admin still reaches the TOTP step: each verified on its own gate.
func TestLoginSucceedsWhileSignupGateIsFull(t *testing.T) {
	pool := hashTestPool(t)
	svc := loginTestService(t, pool)
	owner := uniqueEmail("owner")
	admin := uniqueEmail("admin")
	const password = "a-long-enough-password"
	seedEmailAccount(t, pool, owner, password, httpx.RoleRestaurantOwner)
	seedEmailAccount(t, pool, admin, password, httpx.RoleAdmin)

	configureHashingForTest(t, DefaultHashConcurrency, 2*time.Second)
	held, err := acquireHashSlot(context.Background(), audienceSignup)
	if err != nil {
		t.Fatalf("fill the sign-up gate: %v", err)
	}
	defer held.release()

	ip := "203.0.113.50"
	if _, err := svc.Login(context.Background(), owner, password, nil, ClientRestaurantWeb, nil, &ip); err != nil {
		t.Fatalf("owner login with the sign-up gate full: %v", err)
	}
	// Fill the login gate too: the admin verifies on the staff gate.
	loginHeld, err := acquireHashSlot(context.Background(), audienceLogin)
	if err != nil {
		t.Fatalf("fill the login gate: %v", err)
	}
	defer loginHeld.release()
	if _, err := svc.Login(context.Background(), admin, password, nil, ClientAdminWeb, nil, &ip); !errors.Is(err, errMFARequired) {
		t.Fatalf("admin login with the sign-up and login gates full = %v, want the TOTP step (password verified)", err)
	}
}

// "Busy" is not a failed sign-in: with every login slot taken, the right
// password is answered busy and no BAD_PASSWORD row is written, so a flood
// cannot push a real user into the lockout. An unknown email is answered
// exactly the same way under load, and costs a verification when a slot is
// free, so neither the status nor the timing tells which emails exist.
func TestBusyLoginIsNotAFailedAttemptAndUnknownEmailsLookTheSame(t *testing.T) {
	pool := hashTestPool(t)
	svc := loginTestService(t, pool)
	owner := uniqueEmail("busy")
	unknown := uniqueEmail("nobody")
	const password = "a-long-enough-password"
	seedEmailAccount(t, pool, owner, password, httpx.RoleRestaurantOwner)

	configureHashingForTest(t, DefaultHashConcurrency, 20*time.Millisecond)
	ip := "203.0.113.60"
	login := func(email string) error {
		_, err := svc.Login(context.Background(), email, password, nil, ClientRestaurantWeb, nil, &ip)
		return err
	}

	gates := passwordGates.Load()
	before := gates.login.acquired.Load()
	if err := login(unknown); !errors.Is(err, errInvalidCredentials) {
		t.Fatalf("unknown email = %v, want invalid credentials", err)
	}
	if got := gates.login.acquired.Load() - before; got != 1 {
		t.Fatalf("unknown email took %d login slots, want 1 (it must pay for a verification)", got)
	}

	held, err := acquireHashSlot(context.Background(), audienceLogin)
	if err != nil {
		t.Fatalf("fill the login gate: %v", err)
	}
	defer held.release()
	for _, email := range []string{owner, unknown} {
		if err := login(email); !errors.Is(err, ErrPasswordHashBusy) {
			t.Fatalf("login for %s with the login gate full = %v, want busy", email, err)
		}
	}

	var failed int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM login_attempt
		WHERE email = $1 AND outcome IN ('BAD_PASSWORD', 'BAD_TOTP')`, owner).Scan(&failed); err != nil {
		t.Fatalf("count attempts: %v", err)
	}
	if failed != 0 {
		t.Fatalf("failed attempts recorded for a busy login = %d, want 0", failed)
	}
}

// ---- helpers ---------------------------------------------------------------

// configureHashingForTest installs fresh gates and restores the defaults after.
func configureHashingForTest(t *testing.T, total int, wait time.Duration) {
	t.Helper()
	ConfigurePasswordHashing(total, wait, 0)
	t.Cleanup(func() { ConfigurePasswordHashing(DefaultHashConcurrency, DefaultHashWait, 0) })
}

func totalAcquired() uint64 {
	gs := passwordGates.Load()
	return gs.signup.acquired.Load() + gs.login.acquired.Load() + gs.staff.acquired.Load()
}

func errorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode error envelope: %v (body %s)", err, rec.Body.String())
	}
	return env.Error.Code
}

func loginTestService(t *testing.T, pool *pgxpool.Pool) *Service {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return NewService(NewStore(pool), NewRateLimiter(nil, nil), NewLogSMSSender(nil, false),
		session.NewIssuer("k1", priv, "hg-api"), session.NewDenySet(), testSecrets(t), nil)
}

// hashTestPool returns a migrated Postgres: the one in HG_TEST_POSTGRES_DSN
// when set, otherwise a throwaway container migrated with goose (the pattern
// of internal/notify/testdb_test.go). It skips when neither is available.
func hashTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if os.Getenv("HG_TEST_POSTGRES_DSN") != "" {
		return openTestPool(t)
	}
	if !dockerSocketPresent() {
		t.Skip("skipping: no Docker daemon and no HG_TEST_POSTGRES_DSN for the Postgres-backed hashing tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	c, err := tcpostgres.Run(ctx, "postgis/postgis:17-3.5",
		tcpostgres.WithDatabase("hg"), tcpostgres.WithUsername("hg"), tcpostgres.WithPassword("hg"),
		testcontainers.WithWaitStrategy(wait.ForLog("database system is ready to accept connections").
			WithOccurrence(2).WithStartupTimeout(2*time.Minute)))
	if err != nil {
		t.Skipf("skipping: could not start the postgres container: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(c); err != nil {
			t.Logf("terminating container: %v", err)
		}
	})
	dsn, err := c.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}
	migrations, err := filepath.Abs("../../migrations")
	if err != nil {
		t.Fatal(err)
	}
	goose := exec.CommandContext(ctx, "go", "run", "github.com/pressly/goose/v3/cmd/goose@v3.24.3",
		"-dir", migrations, "postgres", dsn, "up")
	if out, err := goose.CombinedOutput(); err != nil {
		t.Fatalf("goose up: %v\n%s", err, out)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}
