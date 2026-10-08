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

	// A signed-in password change over its per-account cap is refused before
	// the account is read or a slot is taken (security review of #216,
	// finding 2). It goes through the router, so the session's principal and
	// the role check are the real ones; with no store, a request that got past
	// the limiter would fail with 500.
	t.Run("password change per account", func(t *testing.T) {
		owner := httpx.Principal{AccountID: "0b3c3a52-6f0e-4d4e-9d1a-000000000216", SessionID: "sess-limited",
			Roles: []httpx.Role{httpx.RoleRestaurantOwner}, AMR: []string{"pwd"}}
		if err := rdb.Set(context.Background(), "rl:password_change:account:"+owner.AccountID, 5, time.Hour).Err(); err != nil {
			t.Fatalf("fill counter: %v", err)
		}
		router := httpx.NewRouter(httpx.Options{Env: "local", Authenticator: &fixedTOTPAuth{p: owner}, Authorizer: Matrix{}})
		Routes(router, h)
		before := totalAcquired()
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/password/change",
			strings.NewReader(`{"current_password":"correct horse battery","new_password":"a-brand-new-long-password"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-HG-Client", string(ClientRestaurantWeb))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusTooManyRequests {
			t.Fatalf("status = %d, want 429; body %s", rec.Code, rec.Body.String())
		}
		if code := errorCode(t, rec); code != "RATE_LIMITED" {
			t.Fatalf("error.code = %q, want RATE_LIMITED", code)
		}
		if rec.Header().Get("Retry-After") == "" {
			t.Fatal("429 without Retry-After")
		}
		if after := totalAcquired(); after != before {
			t.Fatalf("hashing slots taken = %d, want 0", after-before)
		}
	})
}

// With every sign-up slot held by a flood, a restaurant owner still signs in,
// and an admin signing in from the staff web app still reaches the TOTP step:
// each verified on the gate of the surface it signs in from.
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

// The gate is a function of the request, never of the account: sign-in picks it
// from the client surface alone, and a password change from the session's
// roles alone (security review of #216, findings 1 and 2).
func TestHashGateIsChosenFromTheRequestNeverTheAccount(t *testing.T) {
	for _, tc := range []struct {
		client ClientSurface
		want   hashAudience
	}{
		{ClientAdminWeb, audienceStaff},
		{ClientRestaurantWeb, audienceLogin},
		{ClientCustomerApp, audienceLogin},
		{ClientRiderApp, audienceLogin},
		{ClientWeb, audienceLogin},
		{ClientSurface(""), audienceLogin},
		{ClientSurface("ADMIN-WEB"), audienceLogin},
	} {
		if got := loginAudience(tc.client); got != tc.want {
			t.Errorf("sign-in from %q verifies on %s, want %s", tc.client, got, tc.want)
		}
	}
	for _, tc := range []struct {
		roles []httpx.Role
		want  hashAudience
	}{
		{nil, audienceLogin},
		{[]httpx.Role{httpx.RoleCustomer}, audienceLogin},
		{[]httpx.Role{httpx.RoleRider}, audienceLogin},
		{[]httpx.Role{httpx.RoleRestaurantOwner}, audienceLogin},
		{[]httpx.Role{httpx.RoleRestaurantManager, httpx.RoleRestaurantStaff}, audienceLogin},
		{[]httpx.Role{httpx.RoleSupportAgent}, audienceStaff},
		{[]httpx.Role{httpx.RoleAdmin}, audienceStaff},
		{[]httpx.Role{httpx.RoleSuperAdmin}, audienceStaff},
		{[]httpx.Role{httpx.RoleRestaurantOwner, httpx.RoleAdmin}, audienceStaff},
	} {
		if got := passwordChangeAudience(tc.roles); got != tc.want {
			t.Errorf("password change by %v hashes on %s, want %s", tc.roles, got, tc.want)
		}
	}
}

// On the staff web app's sign-in, an email with no account and a staff email
// answer exactly the same way, whether the staff gate is free or full: same
// status, same Retry-After, same body, the same full wait, and the same gate.
// On the public surface, a staff email under a full login gate is answered busy
// like any other email instead of slipping through on the staff gate. So
// neither a 503 nor its timing tells which emails exist or belong to staff
// (security review of #216, finding 1).
func TestStaffSignInAnswersAnUnknownEmailAndAStaffEmailTheSame(t *testing.T) {
	pool := hashTestPool(t)
	svc := loginTestService(t, pool)
	h := NewHandler(svc, nil, nil, svc.secrets)
	const password = "a-long-enough-password"
	admin := uniqueEmail("staffadmin")
	support := uniqueEmail("staffsupport")
	unknown := uniqueEmail("staffnobody")
	seedEmailAccount(t, pool, admin, password, httpx.RoleAdmin)
	seedEmailAccount(t, pool, support, password, httpx.RoleSupportAgent)

	const wait = 150 * time.Millisecond
	configureHashingForTest(t, DefaultHashConcurrency, wait)
	gates := passwordGates.Load()

	type answer struct {
		status     int
		retryAfter string
		body       string
		took       time.Duration
	}
	signIn := func(client ClientSurface, email string) answer {
		t.Helper()
		body := `{"email":"` + email + `","password":"not-the-password-at-all"}`
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-HG-Client", string(client))
		req.RemoteAddr = "203.0.113.70:51000"
		rec := httptest.NewRecorder()
		start := time.Now()
		h.Login(rec, req)
		return answer{rec.Code, rec.Header().Get("Retry-After"), withoutRequestID(t, rec), time.Since(start)}
	}
	emails := []string{unknown, admin, support}
	signInAll := func(client ClientSurface) []answer {
		t.Helper()
		out := make([]answer, len(emails))
		for i, e := range emails {
			out[i] = signIn(client, e)
		}
		return out
	}
	same := func(label string, answers []answer) {
		t.Helper()
		for i := 1; i < len(answers); i++ {
			a, b := answers[0], answers[i]
			if a.status != b.status || a.retryAfter != b.retryAfter || a.body != b.body {
				t.Fatalf("%s: %s answered %d %q %s but %s answered %d %q %s", label,
					emails[0], a.status, a.retryAfter, a.body, emails[i], b.status, b.retryAfter, b.body)
			}
		}
	}

	// Staff gate free: every email costs one verification on the staff gate
	// and none on the login gate, and all answer 401.
	staffBefore, loginBefore := gates.staff.acquired.Load(), gates.login.acquired.Load()
	free := signInAll(ClientAdminWeb)
	same("staff gate free", free)
	if free[0].status != http.StatusUnauthorized {
		t.Fatalf("staff gate free: status %d, want 401 (body %s)", free[0].status, free[0].body)
	}
	if got := gates.staff.acquired.Load() - staffBefore; got != 3 {
		t.Fatalf("staff gate free: %d staff slots taken for 3 sign-ins, want 3 (one verification each)", got)
	}
	if got := gates.login.acquired.Load() - loginBefore; got != 0 {
		t.Fatalf("staff gate free: %d login slots taken, want 0", got)
	}

	// Staff gate full: every email waits the whole wait and is answered busy.
	held, err := acquireHashSlot(context.Background(), audienceStaff)
	if err != nil {
		t.Fatalf("fill the staff gate: %v", err)
	}
	full := signInAll(ClientAdminWeb)
	held.release()
	same("staff gate full", full)
	if full[0].status != http.StatusServiceUnavailable || full[0].retryAfter != "1" {
		t.Fatalf("staff gate full: %d with Retry-After %q, want 503 with \"1\"", full[0].status, full[0].retryAfter)
	}
	for i, a := range full {
		if a.took < wait {
			t.Fatalf("staff gate full: sign-in %d answered after %s, before the %s wait ran out", i, a.took, wait)
		}
	}

	// Login gate full, staff gate free: on the public surface a staff email is
	// busy like an unknown one. Before the review it verified on the staff
	// gate and answered 401, which told it apart.
	held, err = acquireHashSlot(context.Background(), audienceLogin)
	if err != nil {
		t.Fatalf("fill the login gate: %v", err)
	}
	staffBefore = gates.staff.acquired.Load()
	public := signInAll(ClientRestaurantWeb)
	held.release()
	same("login gate full", public)
	if public[0].status != http.StatusServiceUnavailable {
		t.Fatalf("login gate full: status %d, want 503 (body %s)", public[0].status, public[0].body)
	}
	if got := gates.staff.acquired.Load() - staffBefore; got != 0 {
		t.Fatalf("login gate full: public sign-ins took %d staff slots, want 0", got)
	}
}

// A flood of password changes from sessions without a staff role (a customer
// from phone sign-in, a restaurant owner from sign-up) hashes on the login
// gate, never the staff gate, so an admin signing in from the staff web app
// still gets a slot at once and reaches the TOTP step (security review of
// #216, finding 2). The wait is short: had the flood shared the staff gate,
// the admin would have been turned away.
func TestCustomerPasswordChangeFloodDoesNotDelayStaffLogin(t *testing.T) {
	pool := hashTestPool(t)
	svc := loginTestService(t, pool)
	const password = "a-long-enough-password"
	admin := uniqueEmail("floodadmin")
	seedEmailAccount(t, pool, admin, password, httpx.RoleAdmin)
	// A phone-sign-in customer normally has no password and is turned away
	// before hashing; giving it one makes every attempt cost a verification,
	// the worst case for the gate.
	flooders := []httpx.Principal{
		{AccountID: seedEmailAccount(t, pool, uniqueEmail("floodcustomer"), password, httpx.RoleCustomer),
			SessionID: "sess-flood-customer", Roles: []httpx.Role{httpx.RoleCustomer}, AMR: []string{"otp"}},
		{AccountID: seedEmailAccount(t, pool, uniqueEmail("floodowner"), password, httpx.RoleRestaurantOwner),
			SessionID: "sess-flood-owner", Roles: []httpx.Role{httpx.RoleRestaurantOwner}, AMR: []string{"pwd"}},
	}

	configureHashingForTest(t, DefaultHashConcurrency, 300*time.Millisecond)
	gates := passwordGates.Load()

	stop := make(chan struct{})
	var flood sync.WaitGroup
	var mu sync.Mutex
	var unexpected error
	for i := 0; i < 12; i++ {
		p := flooders[i%len(flooders)]
		flood.Add(1)
		go func() {
			defer flood.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				_, err := svc.ChangePassword(context.Background(), p,
					"not-the-current-password", "a-brand-new-long-password", ClientCustomerApp)
				if !errors.Is(err, errInvalidCredentials) && !errors.Is(err, ErrPasswordHashBusy) {
					mu.Lock()
					unexpected = err
					mu.Unlock()
				}
			}
		}()
	}
	stopFlood := func() {
		select {
		case <-stop:
		default:
			close(stop)
			flood.Wait()
		}
	}
	defer stopFlood()

	// Wait until the flood fills whichever gate it hashes on and is being
	// turned away.
	for deadline := time.Now().Add(10 * time.Second); gates.login.rejected.Load()+gates.staff.rejected.Load() == 0; {
		if time.Now().After(deadline) {
			t.Fatal("the password-change flood never filled a gate")
		}
		time.Sleep(5 * time.Millisecond)
	}

	staffBefore := gates.staff.acquired.Load()
	ip := "203.0.113.80"
	_, err := svc.Login(context.Background(), admin, password, nil, ClientAdminWeb, nil, &ip)
	stopFlood()
	if !errors.Is(err, errMFARequired) {
		t.Fatalf("admin sign-in during a customer password-change flood = %v, want the TOTP step (password verified)", err)
	}
	if got := gates.staff.acquired.Load() - staffBefore; got != 1 {
		t.Fatalf("staff slots taken during the flood = %d, want 1 (the admin's own)", got)
	}
	if got := gates.staff.rejected.Load(); got != 0 {
		t.Fatalf("staff gate rejections = %d, want 0", got)
	}
	if gates.login.rejected.Load() == 0 {
		t.Fatal("the flood was never turned away on the login gate; it must hash there")
	}
	if unexpected != nil { // the flood has stopped: no more writers
		t.Fatalf("a flood password change answered %v, want invalid credentials or busy", unexpected)
	}
}

// ---- helpers ---------------------------------------------------------------

// withoutRequestID is the response body with error.request_id removed, the one
// field that differs between two otherwise identical answers.
func withoutRequestID(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var env map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode body: %v (body %s)", err, rec.Body.String())
	}
	if e, ok := env["error"].(map[string]any); ok {
		delete(e, "request_id")
	}
	out, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

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

// A password reset whose link cannot be used (made up, already used or
// expired) is answered without taking a hashing slot or a place in the
// sign-up gate's queue: it will never hash, so a flood of made-up links cannot
// keep real sign-ups and resets waiting (#448). A usable link still waits for a
// slot before it is consumed, so a busy answer leaves it working for a retry.
func TestUnusableResetLinkNeverTakesAHashingSlot(t *testing.T) {
	pool := hashTestPool(t)
	svc := loginTestService(t, pool)
	ctx := context.Background()
	accountID := seedEmailAccount(t, pool, uniqueEmail("reset"), "a-long-enough-password", httpx.RoleRestaurantOwner)
	used := mintLinkToken(t, pool, accountID, "PASSWORD_RESET", 30*time.Minute)
	if _, err := pool.Exec(ctx, `UPDATE credential_token SET consumed_at = now()
	                              WHERE account_id = $1 AND kind = 'PASSWORD_RESET'`, accountID); err != nil {
		t.Fatal(err)
	}
	expired := mintLinkToken(t, pool, accountID, "PASSWORD_RESET", -time.Minute)
	usable := mintLinkToken(t, pool, accountID, "PASSWORD_RESET", 30*time.Minute)

	configureHashingForTest(t, DefaultHashConcurrency, 20*time.Millisecond)
	held, err := acquireHashSlot(ctx, audienceSignup)
	if err != nil {
		t.Fatalf("fill the sign-up gate: %v", err)
	}
	defer held.release()
	ip := "203.0.113.60"
	const newPassword = "another-long-enough-password"
	before := totalAcquired()
	for name, tc := range map[string]struct {
		token string
		want  error
	}{
		"a made-up link":  {"hgt_made-up", ErrNotFound},
		"a used link":     {used, errTokenUsed},
		"an expired link": {expired, errTokenExpired},
	} {
		if err := svc.ResetPassword(ctx, tc.token, newPassword, "", &ip); !errors.Is(err, tc.want) {
			t.Errorf("%s with the sign-up gate full = %v, want %v", name, err, tc.want)
		}
	}
	if got := totalAcquired() - before; got != 0 {
		t.Errorf("unusable links took %d hashing slots, want 0", got)
	}
	if got := PasswordHashingRejections()[string(audienceSignup)]; got != 0 {
		t.Errorf("unusable links were turned away by the sign-up gate %d times, want 0", got)
	}

	if err := svc.ResetPassword(ctx, usable, newPassword, "", &ip); !errors.Is(err, ErrPasswordHashBusy) {
		t.Fatalf("a usable link with the sign-up gate full = %v, want busy", err)
	}
	held.release()
	if err := svc.ResetPassword(ctx, usable, newPassword, "", &ip); err != nil {
		t.Fatalf("the same link once a slot is free = %v, want the password reset", err)
	}
}
