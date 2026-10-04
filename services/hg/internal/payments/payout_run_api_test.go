package payments

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// The admin trigger names who and as of when, never an amount, and only from
// a session that signed in with two-step sign-in. Every case here is refused
// before anything is queued; the last reaches the service, which has no
// payout runner and answers 503, proving the body itself was accepted.
func TestCreatePayoutRun_TakesNoAmountAndNeedsTwoStepSignIn(t *testing.T) {
	h := NewHandler(NewService(nil, nil, config.Stripe{}, nil), &config.Config{})
	const payee = `{"type": "RIDER", "id": "019ffe57-fbd0-7355-ade8-b03ea7943578"}`
	cases := []struct {
		name   string
		amr    []string
		body   string
		status int
		code   string
	}{
		{"an amount", []string{"pwd+totp"},
			`{"reason": "pay the rider before the holiday", "payee": ` + payee + `, "amount_cents": 50000}`,
			http.StatusUnprocessableEntity, "VALIDATION_FAILED"},
		{"an amount inside the payee", []string{"pwd+totp"},
			`{"reason": "pay the rider before the holiday", "payee": {"type": "RIDER", "id": "019ffe57-fbd0-7355-ade8-b03ea7943578", "amount_cents": 1}}`,
			http.StatusUnprocessableEntity, "VALIDATION_FAILED"},
		{"no reason", []string{"pwd+totp"}, `{"payee": ` + payee + `}`,
			http.StatusUnprocessableEntity, "VALIDATION_FAILED"},
		{"a session without two-step sign-in", []string{"pwd"},
			`{"reason": "pay the rider before the holiday", "payee": ` + payee + `}`,
			http.StatusForbidden, "MFA_REQUIRED"},
		{"a valid request", []string{"pwd+totp"},
			`{"reason": "pay the rider before the holiday", "payee": ` + payee + `}`,
			http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/v1/admin/payout-runs", strings.NewReader(c.body))
			r = r.WithContext(httpx.WithPrincipalForTest(r.Context(), httpx.Principal{
				AccountID: "019ff68d-af0f-7e5b-a1ab-25bfa033f6f5", Roles: []httpx.Role{httpx.RoleAdmin}, AMR: c.amr,
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
