package auth

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/system"
)

// getPublicConfig.terms_version is exactly the version registerRestaurant
// accepts, so the register page sends it on the first submit and is never
// refused with TERMS_VERSION_STALE
// (https://github.com/shaiknoorullah/hg-mono/issues/738).
func TestPublicConfigTermsVersionIsTheOneRegistrationAccepts(t *testing.T) {
	// Test-only throwaway values; HG_AUTH_TERMS_VERSION is unset, so this is
	// the default version a fresh deployment runs with.
	testEnv := map[string]string{
		"HG_OTP_PEPPER":            strings.Repeat("p", 32),
		"HG_AUTH_SIGNING_KEY_SEED": base64.StdEncoding.EncodeToString(make([]byte, ed25519.SeedSize)),
	}
	secrets, err := LoadSecrets(func(k string) string { return testEnv[k] }, false)
	if err != nil {
		t.Fatalf("load default secrets: %v", err)
	}

	// The same wiring as cmd/hg: the system handler gets the auth secret.
	sys := system.NewHandler(&config.Config{Env: config.EnvLocal}, nil, time.Now(), nil,
		secrets.CurrentTermsVersion).
		WithOrderingStatus(func(context.Context) (bool, *time.Time, error) { return false, nil, nil })
	rec := httptest.NewRecorder()
	sys.PublicConfig(rec, httptest.NewRequest(http.MethodGet, "/v1/config/public", nil))
	var env struct {
		Data struct {
			TermsVersion *string `json:"terms_version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("getPublicConfig: %d %s (%v)", rec.Code, rec.Body.String(), err)
	}
	if env.Data.TermsVersion == nil || *env.Data.TermsVersion == "" {
		t.Fatalf("getPublicConfig omits terms_version: %s", rec.Body.String())
	}

	// Hold the only sign-up hashing slot: a registration that gets past the
	// terms check answers 503 TIMEOUT before it touches the (absent) store.
	configureHashingForTest(t, DefaultHashConcurrency, 10*time.Millisecond)
	held, err := acquireHashSlot(context.Background(), audienceSignup)
	if err != nil {
		t.Fatalf("take the only sign-up slot: %v", err)
	}
	defer held.release()

	h := NewHandler(NewService(nil, nil, nil, nil, nil, secrets, nil), nil, nil, secrets)
	register := func(version string) *httptest.ResponseRecorder {
		body := `{"email":"owner@example.test","password":"a-long-enough-password",` +
			`"business_name":"Halal Grill","terms_version":"` + version + `"}`
		rec := httptest.NewRecorder()
		h.RegisterRestaurant(rec, httptest.NewRequest(http.MethodPost, "/v1/auth/register/restaurant",
			strings.NewReader(body)))
		return rec
	}

	if rec := register(*env.Data.TermsVersion); errorCode(t, rec) == string(CodeTermsVersionStale) {
		t.Fatalf("registration refused the version getPublicConfig reported (%q): %s",
			*env.Data.TermsVersion, rec.Body.String())
	}
	// The legacy app's old hard-coded value, which never matched.
	if rec := register("2026-01-01"); rec.Code != http.StatusConflict ||
		errorCode(t, rec) != string(CodeTermsVersionStale) {
		t.Fatalf("a stale version: %d %s, want 409 TERMS_VERSION_STALE", rec.Code, rec.Body.String())
	}
}
