package devworld

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// Onboarding scenarios take a brand-new partner from sign-up to working, through
// the real API only, as the restaurant, rider or admin app and the admin
// console would. Like every scenario they write no row. Two things are read
// from the local database, never written: the single-use link an email would
// carry (the local API sends no email), and nothing else.

// emailLink returns the newest link token emailed to the account with this
// email, for this notification kind. The API's delivery job carries it for an
// hour (notify.DeliverArgs); the local API logs the email instead of sending
// it. It refuses any database that is not this machine's.
func emailLink(ctx context.Context, email, kind string) (string, error) {
	dsn := os.Getenv("HG_POSTGRES_DSN")
	if err := AllowReset(os.Getenv("HG_ENV"), dsn); err != nil {
		return "", fmt.Errorf("devworld: reading an emailed link needs the local database (%w); run through make dev-scenario", err)
	}
	conn, err := connect(ctx, dsn)
	if err != nil {
		return "", err
	}
	defer conn.Close(ctx)
	deadline := time.Now().Add(20 * time.Second)
	for {
		var token string
		err := conn.QueryRow(ctx, `
			SELECT j.args->'overrides'->'EMAIL'->>'link_token'
			  FROM river_job j
			  JOIN notification n ON n.id = (j.args->>'notification_id')::uuid
			  JOIN account a ON a.id = n.account_id
			 WHERE j.kind = 'notify_deliver' AND lower(a.email) = lower($1) AND n.kind = $2
			   AND j.args->'overrides'->'EMAIL'->>'link_token' IS NOT NULL
			 ORDER BY j.id DESC
			 LIMIT 1`, email, kind).Scan(&token)
		if err == nil && token != "" {
			return token, nil
		}
		if time.Now().After(deadline) {
			return "", fmt.Errorf("devworld: no %s email for %s within 20s", kind, email)
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

// uploadPDF stores a small PDF through the real upload flow (createUpload, the
// presigned PUT, confirmUpload) and returns the stored object id.
func (c *apiClient) uploadPDF(ctx context.Context, title string) (string, error) {
	body := []byte("%PDF-1.4\n% devworld onboarding: " + title + "\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n")
	return c.uploadFile(ctx, title, "application/pdf", body)
}

// uploadFile is uploadPDF for any KYC content type.
func (c *apiClient) uploadFile(ctx context.Context, title, contentType string, body []byte) (string, error) {
	sum := sha256.Sum256(body)
	_, data, err := c.call(ctx, http.MethodPost, "/v1/uploads", map[string]any{
		"purpose": "KYC_DOCUMENT", "content_type": contentType,
		"byte_size": len(body), "sha256": hex.EncodeToString(sum[:]),
	}, true)
	if err != nil {
		return "", fmt.Errorf("devworld: createUpload %s: %w", title, err)
	}
	var ticket struct {
		UploadID        string            `json:"upload_id"`
		URL             string            `json:"url"`
		Method          string            `json:"method"`
		RequiredHeaders map[string]string `json:"required_headers"`
	}
	if err := json.Unmarshal(data, &ticket); err != nil || ticket.URL == "" {
		return "", fmt.Errorf("devworld: createUpload %s returned no URL", title)
	}
	req, err := http.NewRequestWithContext(ctx, ticket.Method, ticket.URL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	for k, v := range ticket.RequiredHeaders {
		req.Header.Set(k, v)
	}
	if req.Header.Get("x-amz-checksum-sha256") == "" {
		req.Header.Set("x-amz-checksum-sha256", base64.StdEncoding.EncodeToString(sum[:]))
	}
	req.ContentLength = int64(len(body))
	res, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("devworld: upload %s: %w", title, err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return "", fmt.Errorf("devworld: upload %s: storage answered %d: %s", title, res.StatusCode, trimBody(b))
	}
	if _, _, err := c.call(ctx, http.MethodPost, "/v1/uploads/"+ticket.UploadID+"/confirm", nil, true); err != nil {
		return "", fmt.Errorf("devworld: confirmUpload %s: %w", title, err)
	}
	return ticket.UploadID, nil
}

// connectPayouts creates the partner's Stripe Connect account. With the local
// fake Stripe (no HG_STRIPE_SECRET_KEY on the API) it is ready at once. With a
// test-mode key, Express onboarding is Stripe-hosted: the account starts with
// payouts off, so this prints the onboarding link and reports that the step
// waits for a person, rather than pretending it finished.
func (c *apiClient) connectPayouts(ctx context.Context) (bool, error) {
	_, data, err := c.call(ctx, http.MethodPost, "/v1/connect/account", map[string]any{}, true)
	if err != nil {
		return false, fmt.Errorf("devworld: createConnectAccount: %w", err)
	}
	var acct struct {
		StripeAccountID *string `json:"stripe_account_id"`
		PayoutsEnabled  bool    `json:"payouts_enabled"`
	}
	_ = json.Unmarshal(data, &acct)
	id := ""
	if acct.StripeAccountID != nil {
		id = *acct.StripeAccountID
	}
	fmt.Printf("connect  account %s  payouts_enabled %v\n", id, acct.PayoutsEnabled)
	if acct.PayoutsEnabled {
		return true, nil
	}
	_, link, err := c.call(ctx, http.MethodPost, "/v1/connect/onboarding-link", map[string]any{}, true)
	if err != nil {
		return false, fmt.Errorf("devworld: createConnectOnboardingLink: %w", err)
	}
	var l struct {
		URL string `json:"url"`
	}
	_ = json.Unmarshal(link, &l)
	fmt.Printf("connect  Stripe test-mode onboarding waits for a person: open %s\n", l.URL)
	fmt.Println("connect  once Stripe's account.updated reaches the API (stripe listen --forward-connect-to), finish in the consoles: docs/playbooks/restaurant/onboarding.md")
	return false, nil
}

// OnboardPassword is the password every onboarding scenario signs its new
// partner up with. The persona password is shorter than sign-up allows (the
// personas are seeded, not signed up).
const OnboardPassword = "Devworld!Onboard2026"

func randomSuffix() string {
	return newIdemKey()[:8]
}

func scenarioOnboardRestaurant(ctx context.Context, base string) error {
	// Refuse a non-local API before the first request: registering creates an
	// account, and the database guard in emailLink only runs after that.
	if err := AllowAPI(base); err != nil {
		return err
	}
	suffix := randomSuffix()
	email := "onboard-" + suffix + "@devworld.test"
	app, err := submitRestaurantApplication(ctx, base, email, "Devworld Onboard "+suffix, suffix)
	if err != nil {
		return err
	}
	owner, admin := app.Owner, app.Admin

	// 4. The admin reviews every document, runs the halal seven-check and approves.
	if err := admin.reviewRestaurantApplication(ctx, app.RestaurantID, app.BodyID, app.CertNumber, app.ValidUntil, suffix); err != nil {
		return err
	}
	if err := owner.printRestaurantState(ctx, "application approved"); err != nil {
		return err
	}

	// 5. Payout account.
	ready, err := owner.connectPayouts(ctx)
	if err != nil {
		return err
	}
	if !ready {
		return owner.printRestaurantState(ctx, "waiting on Stripe onboarding")
	}
	if err := owner.printRestaurantState(ctx, "payout account"); err != nil {
		return err
	}

	// 6. The first menu item, which waits for review until an admin approves it.
	_, cat, err := owner.call(ctx, http.MethodPost, "/v1/restaurant/menu/categories", map[string]any{"name": "Mains"}, true)
	if err != nil {
		return fmt.Errorf("devworld: createMenuCategory: %w", err)
	}
	var category struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(cat, &category)
	_, item, err := owner.call(ctx, http.MethodPost, "/v1/restaurant/menu/items", map[string]any{
		"category_id": category.ID, "name": "Chicken Karahi", "description": "Tomato and ginger karahi.",
		"ingredients_text": "chicken, tomato, ginger, garlic", "price_cents": 1899,
		"dietary_tags": []string{}, "allergen_tags": []string{}, "allergens_declared": true,
	}, true)
	if err != nil {
		return fmt.Errorf("devworld: createMenuItem: %w", err)
	}
	var created struct {
		PendingVersion *struct {
			ID string `json:"id"`
		} `json:"pending_version"`
	}
	_ = json.Unmarshal(item, &created)
	if created.PendingVersion == nil {
		return errors.New("devworld: the new menu item has no version waiting for review")
	}
	if err := owner.printRestaurantState(ctx, "menu item waiting for review"); err != nil {
		return err
	}
	if _, _, err := admin.call(ctx, http.MethodPost, "/v1/admin/menu-reviews/"+created.PendingVersion.ID+"/decision",
		map[string]any{"decision": "APPROVE"}, true); err != nil {
		return fmt.Errorf("devworld: decideMenuVersion: %w", err)
	}
	fmt.Println("menu  first item approved by admin-seed")
	state, err := owner.restaurantState(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("state  %s  (%s)\n", state, "menu approved")
	if state != "ACTIVE" {
		return fmt.Errorf("devworld: onboarding ended at %s, want ACTIVE", state)
	}
	// What a customer sees: the approved item, on the restaurant's public menu.
	buyer, err := customer(ctx, base, "amina")
	if err != nil {
		return err
	}
	_, menu, err := buyer.call(ctx, http.MethodGet, "/v1/restaurants/"+app.RestaurantID+"/menu", nil, false)
	if err != nil {
		return fmt.Errorf("devworld: getRestaurantMenu as a customer: %w", err)
	}
	if !strings.Contains(string(menu), `"Chicken Karahi"`) {
		return errors.New("devworld: the approved item is not on the customer menu")
	}
	fmt.Println("customer  amina sees Chicken Karahi on the menu")
	fmt.Printf("done  %s is ACTIVE; sign in at the restaurant console as %s / %s\n", app.RestaurantID, email, OnboardPassword)
	return nil
}

// submittedApplication is what submitRestaurantApplication leaves: a restaurant
// whose owner has signed up and submitted the four documents, waiting in the
// admin onboarding queue.
type submittedApplication struct {
	RestaurantID string
	BodyID       string
	CertNumber   string
	ValidUntil   string
	Owner        *apiClient
	Admin        *apiClient
}

// submitRestaurantApplication is the owner's half of restaurant onboarding,
// through the real API: sign up as name, confirm the email from the queued
// link, fill the profile and hours, upload and attach the four documents (the
// halal certificate with an accepted issuing body) and submit them. admin-seed
// signs in only to read the accepted issuing bodies. The caller has already
// refused a non-local API.
func submitRestaurantApplication(ctx context.Context, base, email, name, suffix string) (submittedApplication, error) {
	var out submittedApplication
	owner := newAPI(base, "restaurant-web")

	// 1. Sign up, then confirm the email from the link the API queued.
	_, data, err := owner.call(ctx, http.MethodPost, "/v1/auth/register/restaurant", map[string]any{
		"email": email, "password": OnboardPassword,
		"business_name": name, "terms_version": "2026-01",
	}, true)
	if err != nil {
		return out, fmt.Errorf("devworld: registerRestaurant: %w", err)
	}
	var reg struct {
		RestaurantID string `json:"restaurant_id"`
	}
	_ = json.Unmarshal(data, &reg)
	fmt.Printf("registered  %s  restaurant %s\n", email, reg.RestaurantID)
	token, err := emailLink(ctx, email, "AUTH_EMAIL_VERIFICATION")
	if err != nil {
		return out, err
	}
	if _, _, err := owner.call(ctx, http.MethodPost, "/v1/auth/email/verify", map[string]any{"token": token}, false); err != nil {
		return out, fmt.Errorf("devworld: verifyEmail: %w", err)
	}
	fmt.Println("email verified from the emailed link")
	if err := owner.signInPassword(ctx, email, OnboardPassword); err != nil {
		return out, err
	}
	if err := owner.printRestaurantState(ctx, "signed in"); err != nil {
		return out, err
	}

	// 2. Profile and opening hours.
	if _, _, err := owner.call(ctx, http.MethodPut, "/v1/restaurant/profile", map[string]any{
		"display_name": name, "legal_name": name + " Inc.",
		"phone_e164": "+14165550142", "description": "A kitchen the dev world onboarded end to end.",
		"line1": "1240 Danforth Avenue", "city": "Toronto", "province": "ON", "postal_code": "M4J 1M6",
		"latitude": 43.6827, "longitude": -79.3301, "cuisine_ids": []string{}, "avg_prep_minutes": 20,
	}, false); err != nil {
		return out, fmt.Errorf("devworld: submitRestaurantProfile: %w", err)
	}
	intervals := make([]map[string]any, 0, 7)
	for d := 0; d < 7; d++ {
		intervals = append(intervals, map[string]any{"day_of_week": d, "opens_at": "00:00", "closes_at": "23:45"})
	}
	if _, _, err := owner.call(ctx, http.MethodPut, "/v1/restaurant/hours", map[string]any{
		"intervals": intervals, "overrides": []any{},
	}, false); err != nil {
		return out, fmt.Errorf("devworld: setRestaurantHours: %w", err)
	}
	if err := owner.printRestaurantState(ctx, "profile and hours"); err != nil {
		return out, err
	}

	// 3. The document pack, the halal certificate with an accepted issuing body.
	admin, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return out, err
	}
	bodyID, err := admin.acceptedIssuingBody(ctx)
	if err != nil {
		return out, err
	}
	certNumber := "DW-ONB-" + strings.ToUpper(suffix)
	validUntil := time.Now().AddDate(1, 0, 0).Format("2006-01-02")
	for _, doc := range []string{"BUSINESS_LICENCE", "FOOD_SAFETY", "OWNER_ID", "HALAL_CERTIFICATE"} {
		objectID, err := owner.uploadPDF(ctx, doc)
		if err != nil {
			return out, err
		}
		in := map[string]any{"doc_type": doc, "stored_object_id": objectID}
		if doc == "HALAL_CERTIFICATE" {
			in["issuer_body_id"], in["certificate_number"], in["valid_until"] = bodyID, certNumber, validUntil
		}
		if _, _, err := owner.call(ctx, http.MethodPost, "/v1/restaurant/documents", in, true); err != nil {
			return out, fmt.Errorf("devworld: attachRestaurantDocument %s: %w", doc, err)
		}
		fmt.Printf("document  %s  uploaded and attached\n", doc)
	}
	if _, _, err := owner.call(ctx, http.MethodPost, "/v1/restaurant/documents/submit", nil, true); err != nil {
		return out, fmt.Errorf("devworld: submitRestaurantDocuments: %w", err)
	}
	if err := owner.printRestaurantState(ctx, "documents submitted"); err != nil {
		return out, err
	}
	return submittedApplication{
		RestaurantID: reg.RestaurantID, BodyID: bodyID, CertNumber: certNumber, ValidUntil: validUntil,
		Owner: owner, Admin: admin,
	}, nil
}

func (c *apiClient) restaurantState(ctx context.Context) (string, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/restaurant/onboarding/status", nil, false)
	if err != nil {
		return "", fmt.Errorf("devworld: getRestaurantOnboardingStatus: %w", err)
	}
	var st struct {
		OnboardingState string `json:"onboarding_state"`
	}
	_ = json.Unmarshal(data, &st)
	return st.OnboardingState, nil
}

func (c *apiClient) printRestaurantState(ctx context.Context, after string) error {
	state, err := c.restaurantState(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("state  %s  (%s)\n", state, after)
	return nil
}

// acceptedIssuingBody picks a halal issuing body the platform accepts.
func (c *apiClient) acceptedIssuingBody(ctx context.Context) (string, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/admin/halal-issuing-bodies?status=ACCEPTED", nil, false)
	if err != nil {
		return "", fmt.Errorf("devworld: listHalalIssuingBodies: %w", err)
	}
	var bodies []struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	_ = json.Unmarshal(data, &bodies)
	for _, b := range bodies {
		if b.Status == "ACCEPTED" {
			return b.ID, nil
		}
	}
	return "", errors.New("devworld: no accepted halal issuing body; run make dev-reset")
}

// reviewRestaurantApplication is what an admin does in the console: approve each
// document, transcribe and pass the halal certificate, then approve the
// application.
func (c *apiClient) reviewRestaurantApplication(ctx context.Context, restaurantID, bodyID, certNumber, validUntil, suffix string) error {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/admin/restaurant-applications/"+restaurantID, nil, false)
	if err != nil {
		return fmt.Errorf("devworld: getRestaurantApplication: %w", err)
	}
	var app struct {
		Documents []struct {
			ID      string `json:"id"`
			DocType string `json:"doc_type"`
		} `json:"documents"`
		HalalCertificate *struct {
			ID string `json:"id"`
		} `json:"halal_certificate"`
	}
	if err := json.Unmarshal(data, &app); err != nil {
		return fmt.Errorf("devworld: getRestaurantApplication: %w", err)
	}
	for _, d := range app.Documents {
		if _, _, err := c.call(ctx, http.MethodPost, "/v1/admin/restaurant-documents/"+d.ID+"/review",
			map[string]any{"decision": "APPROVE"}, true); err != nil {
			return fmt.Errorf("devworld: reviewRestaurantDocument %s: %w", d.DocType, err)
		}
		fmt.Printf("admin  approved %s\n", d.DocType)
	}
	if app.HalalCertificate == nil {
		return errors.New("devworld: the application has no halal certificate")
	}
	cert := "/v1/admin/halal-certificates/" + app.HalalCertificate.ID
	if _, _, err := c.call(ctx, http.MethodPut, cert+"/transcription", map[string]any{
		"certificate_number": certNumber, "issuing_body_id": bodyID,
		"certified_legal_name": "Devworld Onboard " + suffix + " Inc.", "certified_address": "1240 Danforth Avenue, Toronto",
		"scope": "WHOLE_ESTABLISHMENT", "issued_on": time.Now().AddDate(0, -1, 0).Format("2006-01-02"),
		"expires_on": validUntil,
	}, true); err != nil {
		return fmt.Errorf("devworld: transcribeHalalCertificate: %w", err)
	}
	checks := []map[string]any{}
	for _, k := range []string{"H1_LEGIBLE_COMPLETE", "H2_ISSUER_ACCEPTED", "H3_NAME_MATCH", "H4_ADDRESS_MATCH", "H6_SCOPE_SUFFICIENT"} {
		checks = append(checks, map[string]any{"check_key": k, "result": "PASS"})
	}
	if _, _, err := c.call(ctx, http.MethodPut, cert+"/checks", map[string]any{"checks": checks}, true); err != nil {
		return fmt.Errorf("devworld: recordHalalChecks: %w", err)
	}
	if _, _, err := c.call(ctx, http.MethodPost, cert+"/decision", map[string]any{"decision": "APPROVE"}, true); err != nil {
		return fmt.Errorf("devworld: decideHalalCertificate: %w", err)
	}
	fmt.Println("admin  halal certificate passed all seven checks")
	if _, _, err := c.call(ctx, http.MethodPost, "/v1/admin/restaurant-applications/"+restaurantID+"/decision", map[string]any{
		"decision": "APPROVE", "reason_code": "ALL_CHECKS_PASSED",
		"reason_text": "Dev world onboarding: every document and the halal certificate checked.",
	}, true); err != nil {
		return fmt.Errorf("devworld: decideRestaurantApplication: %w", err)
	}
	fmt.Println("admin  application approved")
	return nil
}
