package devworld

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// The application scenarios split onboard-restaurant at the admin's desk, so a
// person can work the halal seven-check and the application decision in the
// admin console (issue #678). application-in-review submits a new restaurant's
// application and stops; application-reject has admin-seed record the seven
// checks with one failing and reject it. Both go through the real API only.

// applicationNamePrefix marks the restaurants application-in-review signs up.
// application-reject finds its target in the admin queue by this prefix, and
// rebuilds the owner's email from the suffix that follows it.
const applicationNamePrefix = "Devworld Application "

func applicationEmail(suffix string) string {
	return "application-" + suffix + "@devworld.test"
}

// The address the certificate is transcribed with in application-reject. The
// profile says 1240 Danforth Avenue, so check H4 (address match) fails.
const applicationCertAddress = "88 Gerrard Street East, Toronto"

type applicationSummary struct {
	RestaurantID     string     `json:"restaurant_id"`
	DisplayName      string     `json:"display_name"`
	OnboardingState  string     `json:"onboarding_state"`
	AssignedAdminID  *string    `json:"assigned_admin_id"`
	ReviewLockExpiry *time.Time `json:"review_lock_expires_at"`
}

type halalCheck struct {
	CheckKey       string  `json:"check_key"`
	Result         string  `json:"result"`
	ComputedResult *string `json:"computed_result"`
	CheckedAt      *string `json:"checked_at"`
}

type halalCert struct {
	ID                  string       `json:"id"`
	Status              string       `json:"status"`
	Checks              []halalCheck `json:"checks"`
	RejectionReasonCode *string      `json:"rejection_reason_code"`
}

type applicationDetail struct {
	OnboardingState string `json:"onboarding_state"`
	Documents       []struct {
		ID      string `json:"id"`
		DocType string `json:"doc_type"`
		State   string `json:"state"`
	} `json:"documents"`
	HalalCertificate *halalCert `json:"halal_certificate"`
}

func (c *apiClient) application(ctx context.Context, restaurantID string) (applicationDetail, error) {
	var app applicationDetail
	_, data, err := c.call(ctx, http.MethodGet, "/v1/admin/restaurant-applications/"+restaurantID, nil, false)
	if err != nil {
		return app, fmt.Errorf("devworld: getRestaurantApplication: %w", err)
	}
	if err := json.Unmarshal(data, &app); err != nil {
		return app, fmt.Errorf("devworld: getRestaurantApplication: %w", err)
	}
	return app, nil
}

// reviewQueue is the admin onboarding queue in DOCUMENTS_REVIEW, oldest first.
func (c *apiClient) reviewQueue(ctx context.Context) ([]applicationSummary, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/admin/restaurant-applications?state=DOCUMENTS_REVIEW&limit=100", nil, false)
	if err != nil {
		return nil, fmt.Errorf("devworld: listRestaurantApplications: %w", err)
	}
	var queue []applicationSummary
	if err := json.Unmarshal(data, &queue); err != nil {
		return nil, fmt.Errorf("devworld: listRestaurantApplications: %w", err)
	}
	return queue, nil
}

// recordedChecks lists the checks a person or the server has recorded a
// result for. A certificate nobody has transcribed or checked has none.
func recordedChecks(cert *halalCert) []string {
	var out []string
	if cert == nil {
		return out
	}
	for _, ch := range cert.Checks {
		if ch.Result != "NOT_ASSESSED" || ch.CheckedAt != nil {
			out = append(out, ch.CheckKey+"="+ch.Result)
		}
	}
	return out
}

// newestDevworldApplication picks the newest application in the queue that
// application-in-review signed up, and the suffix its owner's email carries.
func newestDevworldApplication(queue []applicationSummary) (applicationSummary, string, bool) {
	for i := len(queue) - 1; i >= 0; i-- {
		a := queue[i]
		if a.OnboardingState == "DOCUMENTS_REVIEW" && strings.HasPrefix(a.DisplayName, applicationNamePrefix) {
			return a, strings.TrimPrefix(a.DisplayName, applicationNamePrefix), true
		}
	}
	return applicationSummary{}, "", false
}

func scenarioApplicationInReview(ctx context.Context, base string) error {
	// Refuse a non-local API before the first request, as onboard-restaurant does.
	if err := AllowAPI(base); err != nil {
		return err
	}
	suffix := randomSuffix()
	email := applicationEmail(suffix)
	app, err := submitRestaurantApplication(ctx, base, email, applicationNamePrefix+suffix, suffix)
	if err != nil {
		return err
	}
	state, err := app.Owner.restaurantState(ctx)
	if err != nil {
		return err
	}
	if state != "DOCUMENTS_REVIEW" {
		return fmt.Errorf("devworld: the application ended at %s, want DOCUMENTS_REVIEW", state)
	}

	// What the admin console sees: the application in the queue, its halal
	// certificate pending with no check recorded.
	detail, err := app.Admin.application(ctx, app.RestaurantID)
	if err != nil {
		return err
	}
	if detail.HalalCertificate == nil || detail.HalalCertificate.Status != "PENDING" {
		return errors.New("devworld: the application has no pending halal certificate")
	}
	if rec := recordedChecks(detail.HalalCertificate); len(rec) > 0 {
		return fmt.Errorf("devworld: the new halal certificate already has checks recorded: %s", strings.Join(rec, ", "))
	}
	fmt.Printf("halal  certificate %s  PENDING, no checks recorded\n", detail.HalalCertificate.ID)
	queue, err := app.Admin.reviewQueue(ctx)
	if err != nil {
		return err
	}
	ahead, found := 0, false
	for _, a := range queue {
		if a.RestaurantID == app.RestaurantID {
			found = true
			break
		}
		if a.AssignedAdminID == nil || (a.ReviewLockExpiry != nil && a.ReviewLockExpiry.Before(time.Now())) {
			ahead++
		}
	}
	if !found {
		return errors.New("devworld: the application is not in the admin onboarding queue")
	}
	fmt.Printf("queue  %d in review; take-next opens this one after %d older unclaimed application(s)\n", len(queue), ahead)
	fmt.Printf("done  %s %q waits in DOCUMENTS_REVIEW; the owner signs in as %s / %s\n",
		app.RestaurantID, applicationNamePrefix+suffix, email, OnboardPassword)
	fmt.Println("next  work it in the admin console (make dev-admin), or run make dev-scenario s=application-reject")
	return nil
}

func scenarioApplicationReject(ctx context.Context, base string) error {
	// Refuse a non-local API before the first request: the decision is final.
	if err := AllowAPI(base); err != nil {
		return err
	}
	admin, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return err
	}
	queue, err := admin.reviewQueue(ctx)
	if err != nil {
		return err
	}
	target, suffix, ok := newestDevworldApplication(queue)
	if !ok {
		return errors.New("devworld: no application from application-in-review waits in the queue; run make dev-scenario s=application-in-review first")
	}
	fmt.Printf("application  %s %q  %s\n", target.RestaurantID, target.DisplayName, target.OnboardingState)
	detail, err := admin.application(ctx, target.RestaurantID)
	if err != nil {
		return err
	}

	// 1. Every document is in order.
	for _, d := range detail.Documents {
		if d.State == "APPROVED" {
			continue
		}
		if _, _, err := admin.call(ctx, http.MethodPost, "/v1/admin/restaurant-documents/"+d.ID+"/review",
			map[string]any{"decision": "APPROVE"}, true); err != nil {
			return fmt.Errorf("devworld: reviewRestaurantDocument %s: %w", d.DocType, err)
		}
		fmt.Printf("admin  approved %s\n", d.DocType)
	}

	// 2. The seven checks. The certificate names another address, so H4 fails.
	if detail.HalalCertificate == nil {
		return errors.New("devworld: the application has no halal certificate")
	}
	certPath := "/v1/admin/halal-certificates/" + detail.HalalCertificate.ID
	bodyID, err := admin.acceptedIssuingBody(ctx)
	if err != nil {
		return err
	}
	if _, _, err := admin.call(ctx, http.MethodPut, certPath+"/transcription", map[string]any{
		"certificate_number": "DW-ONB-" + strings.ToUpper(suffix), "issuing_body_id": bodyID,
		"certified_legal_name": applicationNamePrefix + suffix + " Inc.", "certified_address": applicationCertAddress,
		"scope": "WHOLE_ESTABLISHMENT", "issued_on": time.Now().AddDate(0, -1, 0).Format("2006-01-02"),
		"expires_on": time.Now().AddDate(1, 0, 0).Format("2006-01-02"),
	}, true); err != nil {
		return fmt.Errorf("devworld: transcribeHalalCertificate: %w", err)
	}
	checks := []map[string]any{}
	for _, k := range []string{"H1_LEGIBLE_COMPLETE", "H2_ISSUER_ACCEPTED", "H3_NAME_MATCH", "H6_SCOPE_SUFFICIENT"} {
		checks = append(checks, map[string]any{"check_key": k, "result": "PASS"})
	}
	checks = append(checks, map[string]any{"check_key": "H4_ADDRESS_MATCH", "result": "FAIL",
		"note": "The certificate names " + applicationCertAddress + ", not the premises at 1240 Danforth Avenue."})
	_, data, err := admin.call(ctx, http.MethodPut, certPath+"/checks", map[string]any{"checks": checks}, true)
	if err != nil {
		return fmt.Errorf("devworld: recordHalalChecks: %w", err)
	}
	var cert halalCert
	if err := json.Unmarshal(data, &cert); err != nil {
		return fmt.Errorf("devworld: recordHalalChecks: %w", err)
	}
	if len(cert.Checks) != 7 {
		return fmt.Errorf("devworld: the certificate has %d checks recorded, want 7", len(cert.Checks))
	}
	for _, ch := range cert.Checks {
		fmt.Printf("check  %-22s %s\n", ch.CheckKey, ch.Result)
	}

	// 3. The instrument refuses approval with a failing check; the admin rejects.
	_, _, err = admin.call(ctx, http.MethodPost, certPath+"/decision", map[string]any{"decision": "APPROVE"}, true)
	if !isCode(err, "CHECK_FAILED") {
		return fmt.Errorf("devworld: approving a certificate with H4 failing answered %v, want CHECK_FAILED", err)
	}
	fmt.Println("halal  approval refused: CHECK_FAILED")
	if _, _, err := admin.call(ctx, http.MethodPost, certPath+"/decision", map[string]any{
		"decision": "REJECT", "reason_code": "ADDRESS_MISMATCH",
		"reason_text": "The certificate is issued for a different address than your premises.",
	}, true); err != nil {
		return fmt.Errorf("devworld: decideHalalCertificate: %w", err)
	}
	fmt.Println("halal  certificate rejected: ADDRESS_MISMATCH")

	// 4. The application decision, with the reason the owner is sent verbatim.
	reason := "Your halal certificate names " + applicationCertAddress + ", not your premises. We cannot verify it for this address."
	if _, _, err := admin.call(ctx, http.MethodPost, "/v1/admin/restaurant-applications/"+target.RestaurantID+"/decision", map[string]any{
		"decision": "REJECT", "reason_code": "HALAL_CERTIFICATION_INVALID", "reason_text": reason,
	}, true); err != nil {
		return fmt.Errorf("devworld: decideRestaurantApplication: %w", err)
	}
	fmt.Println("admin  application rejected: HALAL_CERTIFICATION_INVALID")

	// 5. What the owner sees after signing in.
	email := applicationEmail(suffix)
	owner := newAPI(base, "restaurant-web")
	if err := owner.signInPassword(ctx, email, OnboardPassword); err != nil {
		return err
	}
	_, data, err = owner.call(ctx, http.MethodGet, "/v1/restaurant/onboarding/status", nil, false)
	if err != nil {
		return fmt.Errorf("devworld: getRestaurantOnboardingStatus: %w", err)
	}
	var st struct {
		OnboardingState string `json:"onboarding_state"`
		CurrentStep     string `json:"current_step"`
	}
	_ = json.Unmarshal(data, &st)
	fmt.Printf("owner  %s  state %s  step %s\n", email, st.OnboardingState, st.CurrentStep)
	if st.OnboardingState != "DOCUMENTS_REJECTED" {
		return fmt.Errorf("devworld: the rejection left the restaurant in %s, want DOCUMENTS_REJECTED", st.OnboardingState)
	}
	seen, err := owner.notificationWith(ctx, reason)
	if err != nil {
		return err
	}
	if !seen {
		return errors.New("devworld: the owner has no notification carrying the rejection reason")
	}
	fmt.Printf("owner  notified: %q\n", reason)
	fmt.Printf("done  %s is DOCUMENTS_REJECTED; sign in at the restaurant console as %s / %s\n", target.RestaurantID, email, OnboardPassword)
	return nil
}

// notificationWith reports whether the signed-in account has a notification
// whose text contains want. The decision is notified in the same transaction.
func (c *apiClient) notificationWith(ctx context.Context, want string) (bool, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/notifications?limit=20", nil, false)
	if err != nil {
		return false, fmt.Errorf("devworld: listNotifications: %w", err)
	}
	return strings.Contains(string(data), want), nil
}
