package payments_test

import (
	"context"
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
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/payments"
)

// asCustomer authenticates every request as a signed-in customer, with an
// authenticator code even, so only the role decides.
type asCustomer struct{}

func (asCustomer) Authenticate(context.Context, *http.Request) (httpx.Principal, error) {
	return httpx.Principal{AccountID: "0a000000-0000-4000-8000-0000000c0570", SessionID: "0a000000-0000-4000-8000-00000005e551",
		Roles: []httpx.Role{httpx.RoleCustomer}, AMR: []string{"pwd+totp"}}, nil
}

// Someone who is not staff gets 403 from every refund review and chargeback
// route (deny by default, with the production role matrix), and the service
// refuses them as well, should a route ever be granted wrongly (#172).
func TestAdminRefundAndChargebackRoutesRefuseNonStaff(t *testing.T) {
	svc := payments.NewService(nil, payments.NewFakeStripe(), config.Stripe{}, nil)
	rt := httpx.NewRouter(httpx.Options{
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		Env:           string(config.EnvLocal),
		Authenticator: asCustomer{},
		Authorizer:    auth.Matrix{},
	})
	payments.Routes(rt, payments.NewHandler(svc, &config.Config{Env: config.EnvLocal}))
	if err := rt.Verify(); err != nil {
		t.Fatalf("routes: %v", err)
	}
	const refund, chargeback = "0a000000-0000-4000-8000-0000000ef001", "0a000000-0000-4000-8000-0000000cb001"
	for _, c := range []struct{ method, path, body string }{
		{"GET", "/v1/admin/refunds", ""},
		{"POST", "/v1/admin/refunds", `{"order_id":"` + refund + `","scope":"FULL","reason_code":"OTHER","reason_text":"a refund for myself"}`},
		{"POST", "/v1/admin/refunds/" + refund + "/approve", `{"reason_text":"approving it myself"}`},
		{"POST", "/v1/admin/refunds/" + refund + "/decline", `{"reason_text":"declining it myself"}`},
		{"GET", "/v1/admin/chargebacks", ""},
		{"GET", "/v1/admin/chargebacks/" + chargeback, ""},
		{"POST", "/v1/admin/chargebacks/" + chargeback + "/evidence-notes", `{"body":"evidence from me"}`},
	} {
		req := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "non-staff-key-0000000001")
		rec := httptest.NewRecorder()
		rt.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s %s as a customer: %d %s; want 403", c.method, c.path, rec.Code, rec.Body.String())
		}
	}

	customer := payments.Staff{AccountID: "0a000000-0000-4000-8000-0000000c0570", Roles: []string{"CUSTOMER"}, MFA: true}
	_, err := svc.ApproveRefund(context.Background(), refund, customer,
		payments.RefundDecisionInput{ReasonText: "approving it myself"}, nil)
	var de *payments.DomainError
	if !errors.As(err, &de) || de.Status != http.StatusForbidden {
		t.Errorf("service approval by a customer: %v; want 403", err)
	}
}
