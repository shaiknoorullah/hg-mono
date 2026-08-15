package auth

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// httpDoer is the whole surface of net/http this package depends on for the
// Twilio adapter. Real code gets *http.Client (which satisfies this via Do);
// a unit test supplies a mock — the same pattern payments.StripeClient uses
// to keep "fabricated success" structurally impossible: every send here is a
// real HTTP call to Twilio in production, and every send is mockable in a
// unit test.
type httpDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// TwilioSMSSender delivers the OTP through the Twilio Messages API
// (POST /2010-04-01/Accounts/{AccountSid}/Messages.json). It resolves O-03
// (SMS / A2P registration) as a one-line config flip: set HG_SMS_PROVIDER=twilio
// plus the three Twilio env vars and this sender replaces LogSMSSender at boot
// (see NewSMSSenderFromEnv / cmd/hg/main.go). No A2P approval is required to
// build or test this adapter — only to send a real message once campaign
// registration completes; the HTTP contract is fixed and mockable today.
type TwilioSMSSender struct {
	client     httpDoer
	accountSID string
	authToken  string
	fromNumber string
	// MessagingServiceSID, when set, is sent instead of From — Twilio's
	// recommended way to send A2P 10DLC traffic. Optional.
	MessagingServiceSID string
	baseURL             string // overridable in tests; defaults to api.twilio.com
}

// NewTwilioSMSSender builds a Twilio-backed SMSSender. accountSID, authToken
// and fromNumber (or a messaging service SID set via MessagingServiceSID after
// construction) are required for SendOTP to succeed; client defaults to
// http.DefaultClient when nil.
func NewTwilioSMSSender(client httpDoer, accountSID, authToken, fromNumber string) *TwilioSMSSender {
	if client == nil {
		client = http.DefaultClient
	}
	return &TwilioSMSSender{
		client:     client,
		accountSID: accountSID,
		authToken:  authToken,
		fromNumber: fromNumber,
		baseURL:    "https://api.twilio.com",
	}
}

// SendOTP posts the OTP as an SMS body through Twilio. It never logs the code
// (matching LogSMSSender's contract) and returns a wrapped error on any
// non-2xx response or transport failure — it never fabricates success.
func (t *TwilioSMSSender) SendOTP(ctx context.Context, phone, code string) error {
	if t.accountSID == "" || t.authToken == "" {
		return errors.New("twilio: account sid and auth token are required")
	}
	if t.fromNumber == "" && t.MessagingServiceSID == "" {
		return errors.New("twilio: either a from number or a messaging service sid is required")
	}

	form := url.Values{}
	form.Set("To", phone)
	form.Set("Body", fmt.Sprintf("Your Halal Goes code is %s. It expires shortly. Do not share it.", code))
	if t.MessagingServiceSID != "" {
		form.Set("MessagingServiceSid", t.MessagingServiceSID)
	} else {
		form.Set("From", t.fromNumber)
	}

	endpoint := fmt.Sprintf("%s/2010-04-01/Accounts/%s/Messages.json", t.baseURL, t.accountSID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("twilio: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(t.accountSID, t.authToken)

	resp, err := t.client.Do(req)
	if err != nil {
		return fmt.Errorf("twilio: send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("twilio: send failed with status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}
