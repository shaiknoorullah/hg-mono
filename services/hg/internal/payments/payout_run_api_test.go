package payments

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

const (
	testAdminID = "019ff68d-af0f-7e5b-a1ab-25bfa033f6f5"
	testRiderID = "019ffe57-fbd0-7355-ade8-b03ea7943578"
	validBody   = `{"reason": "pay the rider before the holiday", "payee": {"type": "RIDER", "id": "` + testRiderID + `"}}`
)

// Only an admin or a super admin, signed in with two-step sign-in, can run a
// payout. A customer, a rider, restaurant staff or a support agent is refused
// by the route (the role matrix) and again by the service itself, so no other
// caller can reach the money path without an admin principal either.
func TestPayoutRun_OnlyAnAdminCanRunOne(t *testing.T) {
	notAdmins := map[string]httpx.Principal{
		"customer":         {AccountID: testRiderID, Roles: []httpx.Role{httpx.RoleCustomer}, AMR: []string{"otp"}},
		"rider":            {AccountID: testRiderID, Roles: []httpx.Role{httpx.RoleRider}, AMR: []string{"otp"}},
		"restaurant owner": {AccountID: testAdminID, Roles: []httpx.Role{httpx.RoleRestaurantOwner}, AMR: []string{"pwd+totp"}},
		"restaurant staff": {AccountID: testAdminID, Roles: []httpx.Role{httpx.RoleRestaurantStaff}, AMR: []string{"pwd+totp"}},
		"support agent":    {AccountID: testAdminID, Roles: []httpx.Role{httpx.RoleSupportAgent}, AMR: []string{"pwd+totp"}},
		"nobody":           httpx.AnonymousPrincipal(),
	}
	admin := httpx.Principal{AccountID: testAdminID, Roles: []httpx.Role{httpx.RoleAdmin}, AMR: []string{"pwd+totp"}}
	req := PayoutRunRequest{Reason: "pay the rider before the holiday", Payee: &PayeeRef{Type: PayeeRider, ID: testRiderID},
		IdempotencyKey: "authz-0000000000001"}

	// Through the HTTP route, with the real role matrix.
	svc := NewService(nil, nil, config.Stripe{}, nil)
	rt := httpx.NewRouter(httpx.Options{
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		Env:           "production",
		CORSOrigins:   []string{"http://localhost:5173"},
		Authenticator: fixedPrincipal{},
		Authorizer:    auth.Matrix{},
	})
	Routes(rt, NewHandler(svc, &config.Config{Env: config.EnvProduction}))
	post := func(p httpx.Principal) int {
		r := httptest.NewRequest(http.MethodPost, "/v1/admin/payout-runs", strings.NewReader(validBody))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", "authz-0000000000001")
		r = r.WithContext(context.WithValue(r.Context(), fixedPrincipalKey{}, p))
		w := httptest.NewRecorder()
		rt.ServeHTTP(w, r)
		return w.Code
	}
	for name, p := range notAdmins {
		want := http.StatusForbidden
		if p.Anonymous {
			want = http.StatusUnauthorized
		}
		if got := post(p); got != want {
			t.Errorf("POST /v1/admin/payout-runs as %s: %d, want %d", name, got, want)
		}
	}
	// An admin passes every check; with no Stripe there is no runner, so the
	// service answers 503 after authorising.
	if got := post(admin); got != http.StatusServiceUnavailable {
		t.Errorf("POST /v1/admin/payout-runs as an admin: %d, want 503 (authorised, no Stripe here)", got)
	}

	// Straight into the service and the runner, past the route.
	svc.WithPayoutRunner(NewPayoutRunner(nil, nil, PayoutPolicy{}, "test", nil))
	for name, p := range notAdmins {
		ctx := httpx.WithPrincipalForTest(context.Background(), p)
		var de *DomainError
		if _, _, err := svc.RequestPayoutRun(ctx, req); !errors.As(err, &de) || de.Status != http.StatusForbidden {
			t.Errorf("service call as %s: err=%v, want 403", name, err)
		}
		if _, _, err := svc.payouts.Request(ctx, req); !errors.Is(err, ErrNotPayoutAdmin) {
			t.Errorf("runner call as %s: err=%v, want ErrNotPayoutAdmin", name, err)
		}
		if _, err := svc.ListPayoutRuns(ctx, 20, ""); !errors.As(err, &de) || de.Status != http.StatusForbidden {
			t.Errorf("listing runs as %s: err=%v, want 403", name, err)
		}
	}
	if _, _, err := svc.payouts.Request(context.Background(), req); !errors.Is(err, ErrNotPayoutAdmin) {
		t.Errorf("runner call with no principal at all: err=%v, want ErrNotPayoutAdmin", err)
	}
	noTwoStep := admin
	noTwoStep.AMR = []string{"pwd"}
	if _, _, err := svc.payouts.Request(httpx.WithPrincipalForTest(context.Background(), noTwoStep), req); !errors.Is(err, ErrTwoStepRequired) {
		t.Errorf("an admin without two-step sign-in: err=%v, want ErrTwoStepRequired", err)
	}
}

// The admin trigger names who and as of when, never an amount: a body with
// one is refused before anything is queued. The last case reaches the
// service, which has no payout runner here and answers 503, proving the body
// itself was accepted.
func TestCreatePayoutRun_TakesNoAmount(t *testing.T) {
	h := NewHandler(NewService(nil, nil, config.Stripe{}, nil), &config.Config{})
	cases := []struct {
		name   string
		amr    []string
		body   string
		status int
		code   string
	}{
		{"an amount", []string{"pwd+totp"},
			`{"reason": "pay the rider before the holiday", "payee": {"type": "RIDER", "id": "` + testRiderID + `"}, "amount_cents": 50000}`,
			http.StatusUnprocessableEntity, "VALIDATION_FAILED"},
		{"an amount inside the payee", []string{"pwd+totp"},
			`{"reason": "pay the rider before the holiday", "payee": {"type": "RIDER", "id": "` + testRiderID + `", "amount_cents": 1}}`,
			http.StatusUnprocessableEntity, "VALIDATION_FAILED"},
		{"no reason", []string{"pwd+totp"}, `{"payee": {"type": "RIDER", "id": "` + testRiderID + `"}}`,
			http.StatusUnprocessableEntity, "VALIDATION_FAILED"},
		{"a session without two-step sign-in", []string{"pwd"}, validBody, http.StatusForbidden, "MFA_REQUIRED"},
		{"a valid request", []string{"pwd+totp"}, validBody, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/v1/admin/payout-runs", strings.NewReader(c.body))
			r = r.WithContext(httpx.WithPrincipalForTest(r.Context(), httpx.Principal{
				AccountID: testAdminID, Roles: []httpx.Role{httpx.RoleAdmin}, AMR: c.amr,
			}))
			w := httptest.NewRecorder()
			h.CreatePayoutRun(w, r)
			var env struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			_ = json.Unmarshal(w.Body.Bytes(), &env)
			if w.Code != c.status || env.Error.Code != c.code {
				t.Fatalf("got %d %s, want %d %s: %s", w.Code, env.Error.Code, c.status, c.code, w.Body.String())
			}
		})
	}
}

// fixedPrincipal authenticates whoever the test put in the request context.
type fixedPrincipal struct{}

type fixedPrincipalKey struct{}

func (fixedPrincipal) Authenticate(ctx context.Context, _ *http.Request) (httpx.Principal, error) {
	if p, ok := ctx.Value(fixedPrincipalKey{}).(httpx.Principal); ok {
		return p, nil
	}
	return httpx.AnonymousPrincipal(), nil
}
