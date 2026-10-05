package devworld

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"math/big"
	"net/http"
	"time"
)

// onboardPhoneLow and onboardPhoneHigh bound the numbers onboard-rider signs
// up with: inside the local fixed-code range (+15550100100–199,
// auth/testcode.go) and clear of the personas' numbers.
const (
	onboardPhoneLow  = 160
	onboardPhoneHigh = 199
)

// scenarioOnboardRider takes a phone number nobody has used since the last
// reset from sign-in to online: profile, vehicle, documents, the admin's review
// and approval, the payout account, then going online.
func scenarioOnboardRider(ctx context.Context, base string) error {
	rider, phone, err := freshRider(ctx, base)
	if err != nil {
		return err
	}
	fmt.Printf("signed in  new rider %s\n", phone)
	if err := rider.printRiderState(ctx, "signed in"); err != nil {
		return err
	}

	if _, _, err := rider.call(ctx, http.MethodPost, "/v1/riders/me/onboarding/profile", map[string]any{
		"first_name": "Yusuf", "last_name": "Onboard", "date_of_birth": "1994-06-01",
	}, false); err != nil {
		return fmt.Errorf("devworld: submitRiderProfile: %w", err)
	}
	if err := rider.printRiderState(ctx, "profile"); err != nil {
		return err
	}
	if _, _, err := rider.call(ctx, http.MethodPost, "/v1/riders/me/onboarding/vehicle", map[string]any{
		"vehicle_type": "BICYCLE",
	}, false); err != nil {
		return fmt.Errorf("devworld: submitRiderVehicle: %w", err)
	}
	if err := rider.printRiderState(ctx, "vehicle: bicycle"); err != nil {
		return err
	}

	// A bicycle needs a government ID and a profile photo.
	expires := time.Now().AddDate(2, 0, 0).Format("2006-01-02")
	idDoc, err := rider.uploadPDF(ctx, "GOVERNMENT_ID")
	if err != nil {
		return err
	}
	photo, err := profilePhoto()
	if err != nil {
		return err
	}
	photoDoc, err := rider.uploadFile(ctx, "PROFILE_PHOTO", "image/png", photo)
	if err != nil {
		return err
	}
	for _, d := range []map[string]any{
		{"doc_type": "GOVERNMENT_ID", "stored_object_id": idDoc, "expires_on": expires},
		{"doc_type": "PROFILE_PHOTO", "stored_object_id": photoDoc},
	} {
		if _, _, err := rider.call(ctx, http.MethodPost, "/v1/riders/me/documents", d, true); err != nil {
			return fmt.Errorf("devworld: attachRiderDocument %s: %w", d["doc_type"], err)
		}
		fmt.Printf("document  %s  uploaded and attached\n", d["doc_type"])
	}
	if _, _, err := rider.call(ctx, http.MethodPost, "/v1/riders/me/onboarding/documents", nil, true); err != nil {
		return fmt.Errorf("devworld: submitRiderDocuments: %w", err)
	}
	if err := rider.printRiderState(ctx, "documents submitted"); err != nil {
		return err
	}

	// The admin approves each document, then the application.
	admin, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return err
	}
	_, me, err := rider.call(ctx, http.MethodGet, "/v1/riders/me", nil, false)
	if err != nil {
		return fmt.Errorf("devworld: getRiderMe: %w", err)
	}
	var who struct {
		AccountID string `json:"account_id"`
	}
	_ = json.Unmarshal(me, &who)
	_, app, err := admin.call(ctx, http.MethodGet, "/v1/admin/rider-applications/"+who.AccountID, nil, false)
	if err != nil {
		return fmt.Errorf("devworld: getRiderApplication: %w", err)
	}
	var application struct {
		Documents []struct {
			ID      string `json:"id"`
			DocType string `json:"doc_type"`
		} `json:"documents"`
	}
	_ = json.Unmarshal(app, &application)
	for _, d := range application.Documents {
		if _, _, err := admin.call(ctx, http.MethodPost, "/v1/admin/rider-documents/"+d.ID+"/review",
			map[string]any{"decision": "APPROVE"}, true); err != nil {
			return fmt.Errorf("devworld: reviewRiderDocument %s: %w", d.DocType, err)
		}
		fmt.Printf("admin  approved %s\n", d.DocType)
	}
	if _, _, err := admin.call(ctx, http.MethodPost, "/v1/admin/rider-applications/"+who.AccountID+"/decision", map[string]any{
		"decision": "APPROVE", "reason_code": "ALL_CHECKS_PASSED",
		"reason_text": "Dev world onboarding: identity, age and photo checked.",
	}, true); err != nil {
		return fmt.Errorf("devworld: decideRiderApplication: %w", err)
	}
	fmt.Println("admin  application approved")
	if err := rider.printRiderState(ctx, "application approved"); err != nil {
		return err
	}

	ready, err := rider.connectPayouts(ctx)
	if err != nil {
		return err
	}
	if !ready {
		return rider.printRiderState(ctx, "waiting on Stripe onboarding")
	}
	state, err := rider.riderState(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("state  %s  (payout account)\n", state)
	if state != "ACTIVE" {
		return fmt.Errorf("devworld: onboarding ended at %s, want ACTIVE", state)
	}

	// Online beside the seeded restaurant, where dispatch can offer it work.
	if _, _, err := rider.call(ctx, http.MethodPut, "/v1/riders/me/availability", map[string]any{
		"is_online": true, "latitude": 43.6842, "longitude": -79.3310, "accuracy_m": 8,
	}, false); err != nil {
		return fmt.Errorf("devworld: setRiderAvailability: %w", err)
	}
	fmt.Println("online  the new rider is online beside bismillah-grill")
	fmt.Printf("done  rider %s is ACTIVE and online; sign in on the rider app with %s and code %s\n",
		who.AccountID, phone, "000000")
	return nil
}

// freshRider signs in with the first number in the onboarding range that has
// no rider profile yet, so the scenario starts at sign-up on any world.
func freshRider(ctx context.Context, base string) (*apiClient, string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(onboardPhoneHigh-onboardPhoneLow+1))
	if err != nil {
		return nil, "", err
	}
	start := int(n.Int64())
	for i := 0; i <= onboardPhoneHigh-onboardPhoneLow; i++ {
		phone := fmt.Sprintf("+15550100%d", onboardPhoneLow+(start+i)%(onboardPhoneHigh-onboardPhoneLow+1))
		c := newAPI(base, "rider-app")
		if err := c.signInPhone(ctx, phone); err != nil {
			return nil, "", err
		}
		if state, err := c.riderState(ctx); err == nil && (state == "PHONE_VERIFIED" || state == "REGISTERED") {
			return c, phone, nil
		}
	}
	return nil, "", fmt.Errorf("devworld: every onboarding number +15550100%d–%d is taken; run make dev-reset", onboardPhoneLow, onboardPhoneHigh)
}

func (c *apiClient) riderState(ctx context.Context) (string, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/riders/me/onboarding/status", nil, false)
	if err != nil {
		return "", fmt.Errorf("devworld: getRiderOnboardingStatus: %w", err)
	}
	var st struct {
		OnboardingState string `json:"onboarding_state"`
	}
	_ = json.Unmarshal(data, &st)
	return st.OnboardingState, nil
}

func (c *apiClient) printRiderState(ctx context.Context, after string) error {
	state, err := c.riderState(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("state  %s  (%s)\n", state, after)
	return nil
}

// profilePhoto is a 64×64 PNG of noise: a real image, and over the 1 KiB the
// upload confirmation requires of one.
func profilePhoto() ([]byte, error) {
	img := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	if _, err := rand.Read(img.Pix); err != nil {
		return nil, err
	}
	for i := 3; i < len(img.Pix); i += 4 {
		img.Pix[i] = 0xff
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
