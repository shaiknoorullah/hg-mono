package dispatch

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// The rider's PICKED_UP at the HTTP boundary (contracts/openapi.yaml,
// createAssignmentTransition; https://github.com/shaiknoorullah/hg-mono/issues/310):
// the pickup code belongs to PICKED_UP alone, PICKED_UP takes no override,
// a missing code is 422 PICKUP_CODE_REQUIRED, a wrong one 422
// PICKUP_CODE_INCORRECT with details.attempts_remaining, and no answer ever
// repeats a code.

// postAs sends body to the handler as riderID, through chi so the path's
// assignmentId is read as in production.
func postAs(t *testing.T, h http.HandlerFunc, pattern, path, riderID, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	r.Post(pattern, h)
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req = req.WithContext(httpx.WithPrincipalForTest(req.Context(), httpx.Principal{AccountID: riderID}))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

type envelope struct {
	Error struct {
		Code    string          `json:"code"`
		Details json.RawMessage `json:"details"`
	} `json:"error"`
}

func decodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder) envelope {
	t.Helper()
	var env envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return env
}

const transitionsPattern = "/v1/riders/me/assignments/{assignmentId}/transitions"

func transitionBody(fields string) string {
	return `{"occurred_at":"` + time.Now().UTC().Format(time.RFC3339) + `",` + fields + `}`
}

// TestCreateTransitionRefusesMalformedPickupBodies: the shape rules need no
// database, so they are refused before the service is reached.
func TestCreateTransitionRefusesMalformedPickupBodies(t *testing.T) {
	h := NewHandler(nil)
	path := "/v1/riders/me/assignments/0190a1b2-0000-7000-8000-000000000001/transitions"
	for _, c := range []struct{ name, fields, field string }{
		{"PICKED_UP with an override", `"to_state":"PICKED_UP","pickup_code":"1234","override_reason":"kitchen said so"`, "override_reason"},
		{"a pickup code that is not 4 digits", `"to_state":"PICKED_UP","pickup_code":"12a4"`, "pickup_code"},
		{"a pickup code on another step", `"to_state":"EN_ROUTE_TO_DROPOFF","pickup_code":"1234"`, "pickup_code"},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := postAs(t, h.CreateTransition, transitionsPattern, path, "0190a1b2-0000-7000-8000-0000000000aa", transitionBody(c.fields))
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422 (body %s)", rec.Code, rec.Body.String())
			}
			if env := decodeEnvelope(t, rec); env.Error.Code != string(httpx.CodeValidationFailed) || !strings.Contains(string(env.Error.Details), c.field) {
				t.Errorf("error = %s %s, want %s naming %s", env.Error.Code, env.Error.Details, httpx.CodeValidationFailed, c.field)
			}
			if strings.Contains(rec.Body.String(), "12a4") || strings.Contains(rec.Body.String(), "1234") {
				t.Errorf("the refusal repeats the code: %s", rec.Body.String())
			}
		})
	}

	// A syntax error's text can carry part of what was sent; the answer does not.
	rec := postAs(t, h.CreateTransition, transitionsPattern, path, "0190a1b2-0000-7000-8000-0000000000aa", `{"to_state":"PICKED_UP","pickup_code":98`+`76x}`)
	if rec.Code != http.StatusBadRequest || strings.Contains(rec.Body.String(), "9876") {
		t.Errorf("malformed body: status %d, body %s; want 400 without the code", rec.Code, rec.Body.String())
	}
}

// TestCreateTransitionAsksForTheKitchensCode: at the counter of a ready order,
// PICKED_UP without the code, with a wrong one, and with the right one.
func TestCreateTransitionAsksForTheKitchensCode(t *testing.T) {
	pool := openPool(t)
	svc, _, riders, assignmentID := counterFixture(t, pool, orders.NewStore(pool), 1, "READY_FOR_PICKUP", "PICKUP_OVERDUE")
	h := NewHandler(svc)
	path := "/v1/riders/me/assignments/" + assignmentID + "/transitions"

	rec := postAs(t, h.CreateTransition, transitionsPattern, path, riders[0], transitionBody(`"to_state":"PICKED_UP"`))
	if env := decodeEnvelope(t, rec); rec.Code != http.StatusUnprocessableEntity || env.Error.Code != string(CodePickupCodeRequired) {
		t.Fatalf("no code: %d %s, want 422 %s", rec.Code, env.Error.Code, CodePickupCodeRequired)
	}

	wrong := "0000"
	if wrong == testPickupCode {
		wrong = "1111"
	}
	rec = postAs(t, h.CreateTransition, transitionsPattern, path, riders[0], transitionBody(`"to_state":"PICKED_UP","pickup_code":"`+wrong+`"`))
	env := decodeEnvelope(t, rec)
	if rec.Code != http.StatusUnprocessableEntity || env.Error.Code != string(CodePickupCodeIncorrect) {
		t.Fatalf("wrong code: %d %s, want 422 %s", rec.Code, env.Error.Code, CodePickupCodeIncorrect)
	}
	var details struct {
		AttemptsRemaining int `json:"attempts_remaining"`
	}
	if err := json.Unmarshal(env.Error.Details, &details); err != nil || details.AttemptsRemaining != 4 {
		t.Errorf("wrong code details = %s, want attempts_remaining 4", env.Error.Details)
	}
	if strings.Contains(rec.Body.String(), wrong) || strings.Contains(rec.Body.String(), testPickupCode) {
		t.Errorf("the refusal repeats a code: %s", rec.Body.String())
	}

	rec = postAs(t, h.CreateTransition, transitionsPattern, path, riders[0], transitionBody(`"to_state":"PICKED_UP","pickup_code":"`+testPickupCode+`"`))
	if rec.Code != http.StatusOK {
		t.Fatalf("right code: status %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	var state string
	mustQueryRow(t, pool, `SELECT state::text FROM assignment WHERE id = $1`, []any{assignmentID}, &state)
	if state != "PICKED_UP" {
		t.Errorf("assignment = %s after the right code, want PICKED_UP", state)
	}
}
